import { add, div, lt, max, mul, sub, toFixed } from 'biggystring'
import { asArray, asBoolean, asNumber, asObject, asOptional, asString } from 'cleaners'
import { EdgeCorePluginOptions, EdgeCurrencyWallet, InsufficientFundsError } from 'edge-core-js'

import { cleanMultiFetch, fetchInfo, fetchWaterfall } from '../../../util/network'
import { ChangeQuote, ChangeQuoteRequest, StakePlugin, StakePolicy, StakePosition, StakePositionRequest, StakeProviderInfo } from '../types'
import { asInfoServerResponse, InfoServerResponse } from '../util/internalTypes'

const EXCHANGE_INFO_UPDATE_FREQ_MS = 10 * 60 * 1000 // 2 min
const INBOUND_ADDRESSES_UPDATE_FREQ_MS = 10 * 60 * 1000 // 2 min
const MIDGARD_SERVERS_DEFAULT = ['https://midgard.thorchain.info']
const THORNODE_SERVERS_DEFAULT = ['https://thornode.ninerealms.com']

// When withdrawing from a vault, this represents a withdrawal of 100% of the staked amount.
// Transactions send minAmount + basis points from 0 - TC_SAVERS_WITHDRAWAL_SCALE_UNITS to
// communicate what % to withdraw. ie. Withdraw 75% of staked amount on LTC sends minAmount + basis points
// to the pool address. (10000 + 7500 sats)
const TC_SAVERS_WITHDRAWAL_SCALE_UNITS = '10000'
const DIVIDE_PRECISION = 18

// Thorchain max units per 1 unit of any supported currency
export const THOR_LIMIT_UNITS = '100000000'

interface PolicyCurrencyInfo {
  type: 'utxo' | 'evm'
  minAmount: string
}

const asInboundAddresses = asArray(
  asObject({
    address: asString,
    chain: asString,
    outbound_fee: asString,
    synth_mint_paused: asOptional(asBoolean),
    halted: asBoolean
  })
)

const asExchangeInfo = asObject({
  swap: asObject({
    plugins: asObject({
      thorchain: asObject({
        midgardServers: asArray(asString),
        thornodeServers: asOptional(asArray(asString)),
        nineRealmsServers: asOptional(asArray(asString)),
        thorSwapServers: asOptional(asArray(asString))
      })
    })
  })
})

const asSaver = asObject({
  asset: asString,
  asset_address: asString,
  last_add_height: asNumber,
  units: asString,
  asset_deposit_value: asString
})

const asSavers = asArray(asSaver)

const asPool = asObject({
  asset: asString,
  status: asString,
  assetPrice: asString,
  assetPriceUSD: asString,
  assetDepth: asString,
  saversDepth: asString,
  saversUnits: asString,
  runeDepth: asString
})

const asPools = asArray(asPool)
const asQuoteDeposit = asObject({
  expected_amount_out: asString,
  inbound_address: asString
})

type ExchangeInfo = ReturnType<typeof asExchangeInfo>
type InboundAddresses = ReturnType<typeof asInboundAddresses>

const utxoInfo: PolicyCurrencyInfo = {
  type: 'utxo',
  minAmount: '10000'
}

const evmInfo: PolicyCurrencyInfo = {
  type: 'evm',
  minAmount: '0'
}

const policyCurrencyInfos: { [pluginId: string]: PolicyCurrencyInfo } = {
  avalanche: evmInfo,
  bitcoin: utxoInfo,
  bitcoincash: utxoInfo,
  dogecoin: { ...utxoInfo, minAmount: '100000000' },
  ethereum: evmInfo,
  litecoin: utxoInfo
}

const stakeProviderInfo: StakeProviderInfo = {
  displayName: 'Thorchain Savers',
  pluginId: 'thorchain',
  stakeProviderId: 'tcsavers'
}

const policies: StakePolicy[] = [
  {
    stakePolicyId: 'tcsavers/bitcoin:btc=bitcoin:btc',
    stakeProviderInfo,
    apy: 0,
    rewardAssets: [{ pluginId: 'bitcoin', currencyCode: 'BTC' }],
    stakeAssets: [{ pluginId: 'bitcoin', currencyCode: 'BTC' }]
  },
  {
    stakePolicyId: 'tcsavers/litecoin:ltc=litecoin:ltc',
    stakeProviderInfo,
    apy: 0,
    rewardAssets: [{ pluginId: 'litecoin', currencyCode: 'LTC' }],
    stakeAssets: [{ pluginId: 'litecoin', currencyCode: 'LTC' }]
  },
  {
    stakePolicyId: 'tcsavers/bitcoincash:bch=bitcoincash:bch',
    stakeProviderInfo,
    apy: 0,
    rewardAssets: [{ pluginId: 'bitcoincash', currencyCode: 'BCH' }],
    stakeAssets: [{ pluginId: 'bitcoincash', currencyCode: 'BCH' }]
  },
  {
    stakePolicyId: 'tcsavers/dogecoin:doge=dogecoin:doge',
    stakeProviderInfo,
    apy: 0,
    rewardAssets: [{ pluginId: 'dogecoin', currencyCode: 'DOGE' }],
    stakeAssets: [{ pluginId: 'dogecoin', currencyCode: 'DOGE' }]
  },
  {
    stakePolicyId: 'tcsavers/ethereum:eth=ethereum:eth',
    stakeProviderInfo,
    apy: 0,
    rewardAssets: [{ pluginId: 'ethereum', currencyCode: 'ETH' }],
    stakeAssets: [{ pluginId: 'ethereum', currencyCode: 'ETH' }]
  },
  {
    stakePolicyId: 'tcsavers/avalanche:avax=avalanche:avax',
    stakeProviderInfo,
    apy: 0,
    rewardAssets: [{ pluginId: 'avalanche', currencyCode: 'AVAX' }],
    stakeAssets: [{ pluginId: 'avalanche', currencyCode: 'AVAX' }]
  }
]

const MAINNET_CODE_TRANSCRIPTION: { [cc: string]: string } = {
  bitcoin: 'BTC',
  bitcoincash: 'BCH',
  binancechain: 'BNB',
  litecoin: 'LTC',
  ethereum: 'ETH',
  dogecoin: 'DOGE',
  avalanche: 'AVAX',
  thorchain: 'THOR'
}

let exchangeInfo: ExchangeInfo | undefined
let exchangeInfoLastUpdate: number = 0
let inboundAddresses: InboundAddresses | undefined

let midgardServers: string[] = MIDGARD_SERVERS_DEFAULT
let thornodeServers: string[] = THORNODE_SERVERS_DEFAULT

let inboundAddressesLastUpdate: number = 0

export const makeTcSaversPlugin = async (opts?: EdgeCorePluginOptions): Promise<StakePlugin> => {
  const fetchResponse = await fetchInfo(`v1/apyValues`)
    .then(async res => {
      if (!res.ok) {
        throw new Error(`Fetch APY invalid response: ${await res.text()}`)
      }
      return res
    })
    .catch(err => {
      console.warn(`Fetch APY failed: ${err.message}`)
    })
  if (fetchResponse != null) {
    try {
      const fetchResponseJson = await fetchResponse.json()
      const infoServerResponse = asInfoServerResponse(fetchResponseJson)
      updatePolicyApys(infoServerResponse)
    } catch (err: any) {
      console.warn(`Parsing Fetch APY failed: ${err.message}`)
    }
  }

  const instance: StakePlugin = {
    policies,
    async fetchChangeQuote(request: ChangeQuoteRequest): Promise<ChangeQuote> {
      const { action, stakePolicyId, currencyCode, wallet } = request
      const policy = getPolicyFromId(stakePolicyId)
      const { pluginId, currencyCode: policyCurrencyCode } = policy.stakeAssets[0]

      if (currencyCode !== policyCurrencyCode) {
        throw new Error('Currency code mismatch between request and policy')
      }

      if (pluginId !== wallet.currencyInfo.pluginId) {
        throw new Error('pluginId mismatch between request and policy')
      }

      if (currencyCode !== wallet.currencyInfo.currencyCode) {
        throw new Error('Only mainnet coins supported for staking')
      }

      return changeQuoteFuncs[action](request, policy)
    },
    async fetchStakePosition(request: StakePositionRequest): Promise<StakePosition> {
      await updateInboundAddresses()
      const { stakePolicyId, wallet } = request
      const policy = getPolicyFromId(stakePolicyId)
      const { pluginId, currencyCode } = policy.stakeAssets[0]
      const mainnetCode = MAINNET_CODE_TRANSCRIPTION[pluginId]
      const asset = `${mainnetCode}.${currencyCode}`

      const { primaryAddress } = await getPrimaryAddress(wallet, currencyCode)

      const [saversResponse, poolsResponse] = await Promise.all([
        fetchWaterfall(thornodeServers, `/thorchain/pool/${asset}/savers`),
        fetchWaterfall(midgardServers, `/v2/pools`)
      ])

      if (!saversResponse.ok) {
        const responseText = await saversResponse.text()
        throw new Error(`Thorchain could not fetch /pool/savers: ${responseText}`)
      }
      const saversJson = await saversResponse.json()
      const savers = asSavers(saversJson)

      if (!poolsResponse.ok) {
        const responseText = await poolsResponse.text()
        throw new Error(`Thorchain could not fetch /v2/pools: ${responseText}`)
      }
      const poolsJson = await poolsResponse.json()
      const pools = asPools(poolsJson)

      const saver = savers.find(s => s.asset_address.toLowerCase() === primaryAddress.toLowerCase())
      const pool = pools.find(p => p.asset === asset)
      let stakedAmount = '0'
      let earnedAmount = '0'
      if (saver != null && pool != null) {
        const { units, asset_deposit_value: assetDepositValue } = saver
        const { saversDepth, saversUnits } = pool
        stakedAmount = assetDepositValue
        const redeemableValue = div(mul(units, saversDepth), saversUnits, DIVIDE_PRECISION)
        earnedAmount = sub(redeemableValue, stakedAmount)

        // Convert from Thor units to exchangeAmount
        stakedAmount = div(stakedAmount, THOR_LIMIT_UNITS, DIVIDE_PRECISION)
        earnedAmount = div(earnedAmount, THOR_LIMIT_UNITS, DIVIDE_PRECISION)

        // Convert from exchangeAmount to nativeAmount
        stakedAmount = await wallet.denominationToNative(stakedAmount, currencyCode)
        earnedAmount = await wallet.denominationToNative(earnedAmount, currencyCode)

        // Truncate decimals
        stakedAmount = toFixed(stakedAmount, 0, 0)
        earnedAmount = toFixed(earnedAmount, 0, 0)

        // Cap negative value to 0
        earnedAmount = max(earnedAmount, '0')
      }

      return {
        allocations: [
          {
            pluginId,
            currencyCode,
            allocationType: 'staked',
            nativeAmount: stakedAmount
          },
          {
            pluginId,
            currencyCode,
            allocationType: 'earned',
            nativeAmount: earnedAmount
          }
        ],
        canStake: true,
        canUnstake: true,
        canClaim: true
      }
    }
  }
  return instance
}

const updatePolicyApys = (infoServerResponse: InfoServerResponse) => {
  policies.forEach(policy => {
    const apy = infoServerResponse.policies[policy.stakePolicyId]
    if (apy != null) {
      policy.apy = apy
    }
  })
}

const getPolicyFromId = (policyId: string): StakePolicy => {
  const policy = policies.find(policy => policy.stakePolicyId === policyId)
  if (policy == null) throw new Error(`Cannot find policy ${policyId}`)
  return policy
}

const stakeRequest = async (request: ChangeQuoteRequest, policy: StakePolicy): Promise<ChangeQuote> => {
  const { wallet, nativeAmount, currencyCode } = request
  const { pluginId } = wallet.currencyInfo

  const policyCurrencyInfo = policyCurrencyInfos[pluginId]
  const walletBalance = wallet.balances[currencyCode]
  const { minAmount } = policyCurrencyInfo
  const minStakeAmount = add(minAmount, TC_SAVERS_WITHDRAWAL_SCALE_UNITS)
  const exchangeAmount = await wallet.nativeToDenomination(nativeAmount, currencyCode)
  const thorAmount = toFixed(mul(exchangeAmount, THOR_LIMIT_UNITS), 0, 0)

  if (lt(nativeAmount, minStakeAmount)) {
    throw new Error(`Must stake at least ${exchangeAmount} ${currencyCode}`)
  }

  if (lt(walletBalance, nativeAmount)) {
    throw new InsufficientFundsError({ currencyCode })
  }

  await updateInboundAddresses()

  const mainnetCode = MAINNET_CODE_TRANSCRIPTION[wallet.currencyInfo.pluginId]
  const { primaryAddress, addressBalance } = await getPrimaryAddress(wallet, currencyCode)

  const asset = `${mainnetCode}.${mainnetCode}`
  const path = `/thorchain/quote/saver/deposit?asset=${asset}&address=${primaryAddress}&amount=${thorAmount}`
  const quoteDeposit = await cleanMultiFetch(asQuoteDeposit, thornodeServers, path)
  const { inbound_address: poolAddress, expected_amount_out: expectedAmountOut } = quoteDeposit

  const slippageThorAmount = sub(thorAmount, expectedAmountOut)
  const slippageDisplayAmount = div(slippageThorAmount, THOR_LIMIT_UNITS, DIVIDE_PRECISION)
  const slippageNativeAmount = await wallet.denominationToNative(slippageDisplayAmount, currencyCode)
  const utxoSourceAddress = primaryAddress
  const forceChangeAddress = primaryAddress
  let needsFundingPrimary = false
  let networkFee = '0'

  if (lt(addressBalance, nativeAmount)) {
    // Easy check to see if primary address doesn't have enough funds
    needsFundingPrimary = true
  } else {
    try {
      // Try to spend right out of the primaryAddress
      const estimateTx = await wallet.makeSpend({
        spendTargets: [{ publicAddress: poolAddress, nativeAmount }],
        otherParams: { outputSort: 'targets', utxoSourceAddress, forceChangeAddress }
      })
      networkFee = estimateTx.networkFee
    } catch (e: unknown) {
      if (e instanceof InsufficientFundsError) {
        needsFundingPrimary = true
      }
    }
  }

  if (needsFundingPrimary) {
    // Estimate the total cost to create the two transactions
    // 1. Fund the primary address with the requestedAmount + fees for tx #2
    // 2. Send the requested amount to the pool address

    const estimateTx = await wallet.makeSpend({
      spendTargets: [{ publicAddress: primaryAddress, nativeAmount }]
    })
    networkFee = estimateTx.networkFee

    const remainingBalance = sub(sub(walletBalance, mul(networkFee, '2')), nativeAmount)
    if (lt(remainingBalance, '0')) {
      throw new InsufficientFundsError({ currencyCode })
    }
  }

  const totalFee = add(slippageNativeAmount, needsFundingPrimary ? mul(networkFee, '2') : networkFee)
  return {
    allocations: [
      {
        allocationType: 'stake',
        pluginId,
        currencyCode,
        nativeAmount
      },
      {
        allocationType: 'fee',
        pluginId,
        currencyCode,
        nativeAmount: toFixed(totalFee, 0, 0)
      }
    ],
    approve: async () => {
      if (needsFundingPrimary) {
        // Transfer funds into the primary address
        const tx = await wallet.makeSpend({
          spendTargets: [
            {
              publicAddress: primaryAddress,
              nativeAmount: add(networkFee, nativeAmount)
            }
          ],
          metadata: { name: 'Thorchain Savers', category: 'Expense:Network Fee' },
          otherParams: { forceChangeAddress }
        })
        const signedTx = await wallet.signTx(tx)
        const broadcastedTx = await wallet.broadcastTx(signedTx)
        await wallet.saveTx(broadcastedTx)
      }
      // Spend from primary address to pool address
      const tx = await wallet.makeSpend({
        spendTargets: [{ publicAddress: poolAddress, nativeAmount }],

        // Use otherParams to meet Thorchain Savers requirements
        // 1. Sort the outputs by how they are sent to makeSpend making the target output the 1st, change 2nd
        // 2. Only use UTXOs from the primary address (index 0)
        // 3. Force change to go to the primary address
        otherParams: { outputSort: 'targets', utxoSourceAddress, forceChangeAddress },
        metadata: { name: 'Thorchain Savers', category: 'Transfer:Staking' }
      })
      const signedTx = await wallet.signTx(tx)
      const broadcastedTx = await wallet.broadcastTx(signedTx)
      await wallet.saveTx(broadcastedTx)
    }
  }
}

const unstakeRequest = async (request: ChangeQuoteRequest, policy: StakePolicy): Promise<ChangeQuote> => {
  const { pluginId, currencyCode } = policy.stakeAssets[0]

  return {
    allocations: [
      {
        allocationType: 'unstake',
        pluginId,
        currencyCode,
        nativeAmount: '0'
      }
    ],
    approve: async () => {}
  }
}

const changeQuoteFuncs = {
  stake: stakeRequest,
  unstake: unstakeRequest,
  claim: unstakeRequest
}

const headers = {
  'Content-Type': 'application/json'
}

const updateInboundAddresses = async (): Promise<void> => {
  const now = Date.now()
  if (now - exchangeInfoLastUpdate > EXCHANGE_INFO_UPDATE_FREQ_MS || exchangeInfo == null) {
    try {
      const exchangeInfoResponse = await fetchInfo('v1/exchangeInfo/edge')

      if (exchangeInfoResponse.ok) {
        const responseJson = await exchangeInfoResponse.json()
        exchangeInfo = asExchangeInfo(responseJson)
        exchangeInfoLastUpdate = now
      } else {
        // Error is ok. We just use defaults
        console.warn('Error getting info server exchangeInfo. Using defaults...')
      }
    } catch (e: any) {
      console.log('Error getting info server exchangeInfo. Using defaults...', e.message)
    }
  }

  if (exchangeInfo != null) {
    midgardServers = exchangeInfo.swap.plugins.thorchain.midgardServers
    thornodeServers = exchangeInfo.swap.plugins.thorchain.thornodeServers ?? thornodeServers
  }

  if (now - inboundAddressesLastUpdate > INBOUND_ADDRESSES_UPDATE_FREQ_MS || inboundAddresses == null) {
    // Get current pool
    const [iaResponse] = await Promise.all([
      fetchWaterfall(midgardServers, 'v2/thorchain/inbound_addresses', {
        headers
      })
    ])

    if (!iaResponse.ok) {
      const responseText = await iaResponse.text()
      throw new Error(`Thorchain could not fetch inbound_addresses: ${responseText}`)
    }

    const iaJson = await iaResponse.json()
    inboundAddresses = asInboundAddresses(iaJson)
    inboundAddressesLastUpdate = now
  }
}

const getPrimaryAddress = async (wallet: EdgeCurrencyWallet, currencyCode: string): Promise<{ primaryAddress: string; addressBalance: string }> => {
  const { publicAddress, nativeBalance, segwitAddress, segwitNativeBalance } = await wallet.getReceiveAddress({ forceIndex: 0, currencyCode })
  const primaryAddress = segwitAddress ?? publicAddress
  const addressBalance = segwitAddress != null ? segwitNativeBalance ?? '0' : nativeBalance ?? '0'

  return { primaryAddress, addressBalance }
}
