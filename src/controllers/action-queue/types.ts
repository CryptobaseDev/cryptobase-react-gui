import { EdgeAccount, EdgeNetworkFee, EdgeTransaction } from 'edge-core-js'

import { Dispatch, GetState } from '../../types/reduxTypes'

//
// Action Operations
//
export type ActionOpTypes =
  | 'seq'
  | 'par'
  | 'wyre-buy'
  | 'wyre-sell'
  | 'loan-borrow'
  | 'loan-deposit'
  | 'loan-repay'
  | 'loan-withdraw'
  | 'swap'
  | 'toast'
  | 'delay'

export interface SeqActionOp {
  type: 'seq'
  actions: ActionOp[]
}
export interface ParActionOp {
  type: 'par'
  actions: ActionOp[]
}
export interface BroadcastTxActionOp {
  type: 'broadcast-tx'
  pluginId: string
  rawTx: Uint8Array
}
export interface WyreBuyActionOp {
  type: 'wyre-buy'
  nativeAmount: string
  walletId: string
  tokenId?: string
}
export interface WyreSellActionOp {
  type: 'wyre-sell'
  wyreAccountId: string
  nativeAmount: string
  walletId: string
  tokenId?: string
}
export interface LoanBorrowActionOp {
  type: 'loan-borrow'
  borrowPluginId: string
  nativeAmount: string
  walletId: string
  tokenId?: string
}
export interface LoanDepositActionOp {
  type: 'loan-deposit'
  borrowPluginId: string
  nativeAmount: string
  walletId: string
  tokenId?: string
}
export interface LoanRepayActionOp {
  type: 'loan-repay'
  borrowPluginId: string
  nativeAmount: string
  walletId: string
  tokenId?: string
  fromTokenId?: string
}
export interface LoanWithdrawActionOp {
  type: 'loan-withdraw'
  borrowPluginId: string
  nativeAmount: string
  walletId: string
  tokenId?: string
}
export interface SwapActionOp {
  type: 'swap'
  amountFor: 'from' | 'to'
  fromTokenId?: string
  fromWalletId: string
  nativeAmount: string
  toTokenId?: string
  toWalletId: string
}
export type ActionOp =
  | SeqActionOp
  | ParActionOp
  | BroadcastTxActionOp
  | WyreBuyActionOp
  | WyreSellActionOp
  | LoanBorrowActionOp
  | LoanDepositActionOp
  | LoanRepayActionOp
  | LoanWithdrawActionOp
  | SwapActionOp

//
// Action (After) Effects
//

export interface SeqEffect {
  type: 'seq'
  opIndex: number
  childEffects: Array<ActionEffect | null> // null is only for dryrun
}
export interface ParEffect {
  type: 'par'
  childEffects: Array<ActionEffect | null> // null is only for dryrun
}
export interface AddressBalanceEffect {
  type: 'address-balance'
  address: string
  aboveAmount?: string
  belowAmount?: string
  walletId: string
  tokenId?: string
}
export interface PushEventEffect {
  type: 'push-event'
  eventId: string
  effect?: ActionEffect
}
export interface PriceLevelEffect {
  type: 'price-level'
  currencyPair: string
  aboveRate?: number
  belowRate?: number
}
export interface TxConfsEffect {
  type: 'tx-confs'
  txId: string
  walletId: string
  confirmations: number
}
export interface DoneEffect {
  type: 'done'
  error?: Error
  cancelled?: boolean
}

export type ActionEffect = SeqEffect | ParEffect | AddressBalanceEffect | PushEventEffect | PriceLevelEffect | TxConfsEffect | DoneEffect

//
// Action Program
//

// Storage:
export interface ActionProgram {
  programId: string
  actionOp: ActionOp
  // Development mode flag
  mockMode?: boolean
}
export interface ActionProgramState {
  clientId: string
  programId: string
  effect?: ActionEffect

  // Flags:
  effective: boolean // Whether the effect is observed
  executing: boolean // Whether the program is executing

  lastExecutionTime: number // The time when the effect was checked
  nextExecutionTime: number // The next time when the effect should be checked again
}

export interface ActionQueueItem {
  program: ActionProgram
  state: ActionProgramState
}
export interface ActionQueueMap {
  [id: string]: ActionQueueItem
}

// Runtime:
export interface BroadcastTx {
  walletId: string
  networkFee: EdgeNetworkFee
  tx: EdgeTransaction
}
export interface EffectCheckResult {
  delay: number
  isEffective: boolean
  updatedEffect?: ActionEffect
}
export interface ExecutableAction {
  dryrun: (pendingTxMap: Readonly<PendingTxMap>) => Promise<ExecutionOutput | null>
  execute: () => Promise<ExecutionOutput>
}
export interface ExecutionContext {
  account: EdgeAccount
  clientId: string

  // Methods
  evaluateAction: (program: ActionProgram, state: ActionProgramState) => Promise<ExecutableAction>
  checkActionEffect: (effect: ActionEffect) => Promise<EffectCheckResult>

  // Redux Methods
  dispatch: Dispatch
  getState: GetState
}
export interface ExecutionOutput {
  effect: ActionEffect
  broadcastTxs: BroadcastTx[]
}
export interface ExecutionResults {
  nextState: ActionProgramState
}
export interface PendingTxMap {
  [walletId: string]: EdgeTransaction[] | undefined
}

//
// Action Display API
//

export type ActionDisplayStatus = 'pending' | 'active' | 'done' | Error

export interface ActionDisplayInfo {
  title: string
  message: string
  status: ActionDisplayStatus
  steps: ActionDisplayInfo[]
}
