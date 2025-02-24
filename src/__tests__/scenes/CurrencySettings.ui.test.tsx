import { describe, expect, it } from '@jest/globals'
import * as React from 'react'
import TestRenderer from 'react-test-renderer'

import { CurrencySettingsScene } from '../../components/scenes/CurrencySettingsScene'
import { defaultAccount } from '../../reducers/CoreReducer'
import { FakeProviders, FakeState } from '../../util/fake/FakeProviders'
import { fakeEdgeAppSceneProps } from '../../util/fake/fakeSceneProps'

describe('CurrencySettings', () => {
  it('should render', () => {
    const currencyInfo: any = {
      currencyCode: 'BTG',
      defaultSettings: {},
      denominations: [
        { name: 'BTG', multiplier: '100000000', symbol: '₿' },
        { name: 'mBTG', multiplier: '100000', symbol: 'm₿' },
        { name: 'bits', multiplier: '100', symbol: 'ƀ' }
      ],
      pluginId: 'bitcoin-gold'
    }

    const state: FakeState = {
      core: {
        account: {
          ...defaultAccount,
          currencyConfig: {
            'bitcoin-gold': {
              currencyInfo,
              watch: () => () => {}
            }
          }
        }
      }
    }

    const renderer = TestRenderer.create(
      <FakeProviders initialState={state}>
        <CurrencySettingsScene
          {...fakeEdgeAppSceneProps('currencySettings', {
            currencyInfo
          })}
        />
      </FakeProviders>
    )

    expect(renderer.toJSON()).toMatchSnapshot()
    renderer.unmount()
  })
})
