import { useCallback, useSyncExternalStore } from 'react'

const DEFAULT_STATE = {
  viewMode: 'cleaned',
  changeScope: 'all',
  changeType: 'all',
  activeChangeIndex: 0,
  changeStages: [],
  changeLoading: false,
}

const states = new Map()
const listeners = new Map()

function keyFor(datasetId) {
  return datasetId ? String(datasetId) : '__no_dataset__'
}

function getState(key, preferredViewMode) {
  if (!states.has(key)) {
    states.set(key, {
      ...DEFAULT_STATE,
      viewMode: preferredViewMode || DEFAULT_STATE.viewMode,
    })
  }
  return states.get(key)
}

function notify(key) {
  const subscribers = listeners.get(key)
  if (!subscribers) return
  subscribers.forEach((listener) => listener())
}

function subscribe(key, listener) {
  if (!listeners.has(key)) listeners.set(key, new Set())
  listeners.get(key).add(listener)
  return () => {
    listeners.get(key)?.delete(listener)
  }
}

function setPartialState(key, patch) {
  const current = getState(key)
  const nextPatch = typeof patch === 'function' ? patch(current) : patch
  const next = { ...current, ...nextPatch }
  if (
    next.viewMode === current.viewMode &&
    next.changeScope === current.changeScope &&
    next.changeType === current.changeType &&
    next.activeChangeIndex === current.activeChangeIndex &&
    next.changeStages === current.changeStages &&
    next.changeLoading === current.changeLoading
  ) {
    return
  }
  states.set(key, next)
  notify(key)
}

export function useDatasetTableState(datasetId, preferredViewMode = 'cleaned') {
  const key = keyFor(datasetId)
  getState(key, preferredViewMode)
  const state = useSyncExternalStore(
    useCallback((listener) => subscribe(key, listener), [key]),
    useCallback(() => getState(key), [key]),
    useCallback(() => getState(key), [key]),
  )

  const setViewMode = useCallback(
    (value) => {
      setPartialState(key, (current) => ({
        viewMode: typeof value === 'function' ? value(current.viewMode) : value,
      }))
    },
    [key],
  )

  const setChangeScope = useCallback(
    (value) => {
      setPartialState(key, (current) => ({
        changeScope: typeof value === 'function' ? value(current.changeScope) : value,
      }))
    },
    [key],
  )

  const setActiveChangeIndex = useCallback(
    (value) => {
      setPartialState(key, (current) => ({
        activeChangeIndex: typeof value === 'function' ? value(current.activeChangeIndex) : value,
      }))
    },
    [key],
  )

  const setChangeType = useCallback(
    (value) => {
      setPartialState(key, (current) => ({
        changeType: typeof value === 'function' ? value(current.changeType) : value,
      }))
    },
    [key],
  )

  const setChangeStages = useCallback(
    (value) => {
      setPartialState(key, (current) => ({
        changeStages: typeof value === 'function' ? value(current.changeStages) : value,
      }))
    },
    [key],
  )

  const setChangeLoading = useCallback(
    (value) => {
      setPartialState(key, (current) => ({
        changeLoading: typeof value === 'function' ? value(current.changeLoading) : value,
      }))
    },
    [key],
  )

  const resetTableState = useCallback(() => {
    setPartialState(key, { ...DEFAULT_STATE, viewMode: preferredViewMode || DEFAULT_STATE.viewMode })
  }, [key, preferredViewMode])

  return {
    ...state,
    setViewMode,
    setChangeScope,
    setChangeType,
    setActiveChangeIndex,
    setChangeStages,
    setChangeLoading,
    resetTableState,
  }
}
