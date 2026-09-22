import { describe, expect, it, vi } from 'vitest'
import * as integrationsRoute from './settings.integrations'

type ConnectorActions = {
  authorize(providerId: string): Promise<void>
  disconnect(providerId: string): Promise<void>
}

type CreateConnectorActions = (dependencies: {
  request: <T>(path: string, init?: RequestInit) => Promise<T>
  navigate: (url: string) => void
  reload: () => Promise<void>
  reportError: (message: string) => void
}) => ConnectorActions

describe('integration connector page actions', () => {
  it('exposes connector actions with page-level error handling', () => {
    const createConnectorActions = Reflect.get(integrationsRoute, 'createConnectorActions')

    expect(createConnectorActions).toBeTypeOf('function')
  })

  it('reports authorization failures without navigating', async () => {
    const createConnectorActions = Reflect.get(
      integrationsRoute,
      'createConnectorActions',
    ) as CreateConnectorActions
    const navigate = vi.fn()
    const reportError = vi.fn()
    const actions = createConnectorActions({
      request: vi.fn().mockRejectedValue(new Error('authorization unavailable')),
      navigate,
      reload: vi.fn(),
      reportError,
    })

    await actions.authorize('notion')

    expect(reportError).toHaveBeenCalledWith('authorization unavailable')
    expect(navigate).not.toHaveBeenCalled()
  })

  it('navigates after authorization succeeds', async () => {
    const createConnectorActions = Reflect.get(
      integrationsRoute,
      'createConnectorActions',
    ) as CreateConnectorActions
    const navigate = vi.fn()
    const actions = createConnectorActions({
      request: vi.fn().mockResolvedValue({ url: 'https://auth.example/authorize' }),
      navigate,
      reload: vi.fn(),
      reportError: vi.fn(),
    })

    await actions.authorize('notion')

    expect(navigate).toHaveBeenCalledWith('https://auth.example/authorize')
  })

  it('reports disconnect failures without refreshing connector state', async () => {
    const createConnectorActions = Reflect.get(
      integrationsRoute,
      'createConnectorActions',
    ) as CreateConnectorActions
    const reload = vi.fn()
    const reportError = vi.fn()
    const actions = createConnectorActions({
      request: vi.fn().mockRejectedValue(new Error('disconnect unavailable')),
      navigate: vi.fn(),
      reload,
      reportError,
    })

    await actions.disconnect('notion')

    expect(reportError).toHaveBeenCalledWith('disconnect unavailable')
    expect(reload).not.toHaveBeenCalled()
  })

  it('refreshes connector state after disconnect succeeds', async () => {
    const createConnectorActions = Reflect.get(
      integrationsRoute,
      'createConnectorActions',
    ) as CreateConnectorActions
    const order: string[] = []
    const actions = createConnectorActions({
      request: vi.fn().mockImplementation(async () => {
        order.push('delete')
      }),
      navigate: vi.fn(),
      reload: vi.fn().mockImplementation(async () => {
        order.push('reload')
      }),
      reportError: vi.fn(),
    })

    await actions.disconnect('notion')

    expect(order).toEqual(['delete', 'reload'])
  })
})
