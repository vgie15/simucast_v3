/* ============================================================
 * PAGE: STATISTICAL TESTS
 * Keywords: tests, t-test, anova, chi-square, correlation, pearson, scatter
 * ============================================================ */
import React, { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Scatter } from 'react-chartjs-2'
import { api } from '../../api'
import { WhatThisMeans, DecisionTakeaway, CorrelationHeatmap } from './AnalysisExplainPanel'
import { useDialog } from '../common/DialogProvider'
import { InlineSpinner, SkeletonCards } from '../common/LoadingStates'

const TESTS = [
  {
    key: 't',
    label: 'Independent t-test',
    summary: 'Compare the average of one numeric measure across exactly two groups.',
    use: 'Use when the group variable has two categories and the measure is numeric.',
    tells: 'How strongly variables move together',
    avoid: 'Avoid when there are more than two groups; use ANOVA instead.',
  },
  {
    key: 'anova',
    label: 'ANOVA',
    summary: 'Compare the average of one numeric measure across three or more groups.',
    use: 'Use when the group variable has multiple categories and the measure is numeric.',
    tells: 'Which group means differ and by how much',
    avoid: 'Avoid when you only have two groups; a t-test is simpler.',
  },
  {
    key: 'chi',
    label: 'Chi-square',
    summary: 'Test whether two categorical variables are associated.',
    use: 'Use when both variables are categorical.',
    tells: 'Whether category distributions differ from independence',
    avoid: 'Avoid when expected table counts are very low.',
  },
  {
    key: 'corr',
    label: 'Correlation',
    summary: 'Measure direction and strength of numeric relationships.',
    use: 'Use when selected variables are numeric.',
    tells: 'How strongly variables move together',
    avoid: 'Avoid interpreting correlation as causation.',
  },
]

export default function TestsPage({ dataset, initialData }) {
  const dialog = useDialog()
  const [kind, setKind] = useState('t')
  const [group, setGroup] = useState('')
  const [measure, setMeasure] = useState('')
  const [varA, setVarA] = useState('')
  const [varB, setVarB] = useState('')
  const [corrVars, setCorrVars] = useState([])
  const [result, setResult] = useState(null)
  const [loading, setLoading] = useState(false)
  const [restoring, setRestoring] = useState(false)
  const [draftReady, setDraftReady] = useState(false)
  const [lastRunTime, setLastRunTime] = useState('')
  const [explainMode, setExplainMode] = useState(false)
  const [explainPopup, setExplainPopup] = useState(null)
  const leftScrollRef = React.useRef(null)
  const rightScrollRef = React.useRef(null)

  const variables = dataset?.variables || []
  const numericVars = variables.filter((v) => ['numeric', 'int', 'float', 'binary'].includes(v.dtype))
  const categoricalVars = variables.filter((v) => ['category', 'binary'].includes(v.dtype))
  const selectedTest = TESTS.find((t) => t.key === kind) || TESTS[0]
  const canRun = kind === 'corr' ? corrVars.length >= 2 : kind === 'chi' ? varA && varB : group && measure
  const pairRecs = recommendedTestPairs(kind, numericVars, categoricalVars)

  useEffect(() => {
    if (!dataset?.id) return
    let alive = true
    setRestoring(true)

    const raw = window.localStorage.getItem(`simucast.analysisState.${dataset.id}`)
    if (raw) {
      try {
        const saved = JSON.parse(raw)
        setKind(saved.kind || 't')
        setGroup(saved.group || '')
        setMeasure(saved.measure || '')
        setVarA(saved.varA || '')
        setVarB(saved.varB || '')
        setCorrVars(saved.corrVars || [])
        setResult(saved.result || null)
        setLastRunTime(saved.lastRunTime || '')
        
        // Restore scroll positions after render
        setTimeout(() => {
          if (leftScrollRef.current && saved.leftScroll) {
            leftScrollRef.current.scrollTop = saved.leftScroll
          }
          if (rightScrollRef.current && saved.rightScroll) {
            rightScrollRef.current.scrollTop = saved.rightScroll
          }
        }, 100)

        setRestoring(false)
        setDraftReady(true)
        return
      } catch (err) {
        console.warn('Could not restore analysis state from localStorage', err)
      }
    }

    if (initialData?.tab === 'tests' && initialData?.datasetId === dataset.id && initialData.analyses) {
      const latest = (initialData.analyses.analyses || []).find((a) => {
        const k = String(a.kind || '')
        return ['test_t', 'test_anova', 'test_chi', 'test_analysis_corr'].includes(k)
      })
      if (latest) {
        const restoredKind = String(latest.kind || '').replace(/^test_/, '').replace('analysis_corr', 'corr')
        const config = latest.config || {}
        setKind(restoredKind || 't')
        setResult(latest.result || null)
        setGroup(config.group || '')
        setMeasure(config.measure || '')
        setVarA(config.var_a || '')
        setVarB(config.var_b || '')
        setCorrVars(config.variables || [])
        if (latest.created_at) {
          const timeStr = new Date(latest.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          setLastRunTime(timeStr)
        }
      } else {
        setResult(null)
      }
      setRestoring(false)
      setDraftReady(true)
      return
    }

    api.listAnalyses(dataset.id, '', 20)
      .then((r) => {
        if (!alive) return
        const latest = (r.analyses || []).find((a) => {
          const k = String(a.kind || '')
          return ['test_t', 'test_anova', 'test_chi', 'test_analysis_corr'].includes(k)
        })
        if (!latest) {
          setResult(null)
          return
        }
        const restoredKind = String(latest.kind || '').replace(/^test_/, '').replace('analysis_corr', 'corr')
        const config = latest.config || {}
        setKind(restoredKind || 't')
        setResult(latest.result || null)
        setGroup(config.group || '')
        setMeasure(config.measure || '')
        setVarA(config.var_a || '')
        setVarB(config.var_b || '')
        setCorrVars(config.variables || [])
        if (latest.created_at) {
          const timeStr = new Date(latest.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
          setLastRunTime(timeStr)
        }
      })
      .finally(() => {
        if (alive) {
          setRestoring(false)
          setDraftReady(true)
        }
      })

    return () => {
      alive = false
    }
  }, [dataset?.id])

  useEffect(() => {
    if (!dataset?.id || !draftReady) return
    
    const save = () => {
      const state = {
        kind,
        group,
        measure,
        varA,
        varB,
        corrVars,
        result,
        lastRunTime,
        leftScroll: leftScrollRef.current ? leftScrollRef.current.scrollTop : 0,
        rightScroll: rightScrollRef.current ? rightScrollRef.current.scrollTop : 0,
      }
      window.localStorage.setItem(`simucast.analysisState.${dataset.id}`, JSON.stringify(state))
    }

    save()

    const leftEl = leftScrollRef.current
    const rightEl = rightScrollRef.current

    const handleScroll = () => {
      save()
    }

    if (leftEl) leftEl.addEventListener('scroll', handleScroll)
    if (rightEl) rightEl.addEventListener('scroll', handleScroll)

    return () => {
      if (leftEl) leftEl.removeEventListener('scroll', handleScroll)
      if (rightEl) rightEl.removeEventListener('scroll', handleScroll)
    }
  }, [
    dataset?.id,
    draftReady,
    kind,
    group,
    measure,
    varA,
    varB,
    corrVars.join(','),
    result,
    lastRunTime,
  ])

  useEffect(() => {
    const raw = window.sessionStorage.getItem('simucast.fixTarget')
    if (!raw) return
    let target = null
    try {
      target = JSON.parse(raw)
    } catch {
      return
    }
    if (target?.page !== 'tests') return
    window.sessionStorage.removeItem('simucast.fixTarget')
    if (target.section === 'fix-correlation-test') {
      setKind('corr')
      setCorrVars((current) => current.length >= 2 ? current : numericVars.slice(0, 4).map((v) => v.name))
    }
    setTimeout(() => highlightSection(target.section), 180)
  }, [dataset?.id])

  useEffect(() => {
    document.body.classList.toggle('ax-explain-mode-on', explainMode)
    return () => document.body.classList.remove('ax-explain-mode-on')
  }, [explainMode])

  const openExplain = (meta, event) => {
    if (!explainMode) return
    event?.preventDefault?.()
    event?.stopPropagation?.()
    const target = event?.currentTarget || event?.target
    const sourceRect = target?.getBoundingClientRect ? target.getBoundingClientRect() : null
    setExplainPopup(buildAnalysisExplainMeta(meta, {
      dataset,
      kind,
      selectedTest,
      group,
      measure,
      varA,
      varB,
      corrVars,
      numericVars,
      categoricalVars,
      result,
      canRun,
      lastRunTime,
      sourceEl: target?.getBoundingClientRect ? target : null,
      sourceRect,
    }))
  }

  const explainAttrs = (meta, className = '', capture = false) => {
    const attrs = {
      className: `${className} ${explainMode ? 'ax-explain-selectable' : ''}`.trim(),
      [capture ? 'onClickCapture' : 'onClick']: (event) => openExplain(meta, event),
      title: explainMode ? `Explain ${meta.title}` : undefined,
    }
    if (capture) attrs.onPointerDownCapture = (event) => openExplain(meta, event)
    return attrs
  }

  useEffect(() => {
    if (!explainMode) return undefined
    const onEdgeTab = (event) => {
      const tab = event.target?.closest?.('.ax-edge-tab')
      const floating = event.target?.closest?.('.ax-floating-pill-action')
      if (!tab && !floating) return
      event.preventDefault()
      event.stopPropagation()
      if (floating) {
        const isDataset = floating.classList.contains('dataset')
        setExplainPopup(buildAnalysisExplainMeta({
          id: isDataset ? 'floating-dataset-button' : 'floating-ask-ai-button',
          title: isDataset ? 'Dataset button' : 'Ask AI button',
          type: 'floating-action',
        }, {
          dataset,
          kind,
          selectedTest,
          group,
          measure,
          varA,
          varB,
          corrVars,
          numericVars,
          categoricalVars,
          result,
          canRun,
          lastRunTime,
          sourceEl: floating,
          sourceRect: floating.getBoundingClientRect(),
        }))
        return
      }
      const isHistory = tab.classList.contains('history')
      setExplainPopup(buildAnalysisExplainMeta({
        id: isHistory ? 'side-history-tab' : 'side-guide-tab',
        title: isHistory ? 'History tab' : 'Guide tab',
        type: 'side-tab',
      }, {
        dataset,
        kind,
        selectedTest,
        group,
        measure,
        varA,
        varB,
        corrVars,
        numericVars,
        categoricalVars,
        result,
        canRun,
        lastRunTime,
        sourceEl: tab,
        sourceRect: tab.getBoundingClientRect(),
      }))
    }
    document.addEventListener('pointerdown', onEdgeTab, true)
    document.addEventListener('click', onEdgeTab, true)
    return () => {
      document.removeEventListener('pointerdown', onEdgeTab, true)
      document.removeEventListener('click', onEdgeTab, true)
    }
  }, [explainMode, dataset, kind, selectedTest, group, measure, varA, varB, corrVars, numericVars, categoricalVars, result, canRun, lastRunTime])

  if (!dataset) return <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Upload a dataset first.</p>

  const run = async () => {
    if (!canRun) return
    setLoading(true)
    setResult(null)
    try {
      let body = { kind }
      if (kind === 't' || kind === 'anova') body = { kind, group, measure }
      if (kind === 'chi') body = { kind, var_a: varA, var_b: varB }
      if (kind === 'corr') body = { kind: 'analysis_corr', variables: corrVars }
      const r = await api.runTest(dataset.id, body)
      setResult(r)
      const timeStr = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
      setLastRunTime(timeStr)
    } catch (err) {
      await dialog.alert({ title: 'Test Failed', message: err.message, variant: 'danger' })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="ax-test-layout">
      {/* LEFT COLUMN */}
      <div className="ax-test-left">
        {/* Header: title + subtitle only — separator line sits right below */}
        <div {...explainAttrs({ id: 'sidebar-header', title: 'Statistical Analysis header', type: 'sidebar' }, 'ax-test-left-sticky')}>
          <h1 className="ax-test-title">Statistical Analysis</h1>
          <p className="ax-test-sub">Evaluate relationships, compare groups, and turn results into decisions</p>
        </div>

        {/* Pinned context block: test type picker + info — always visible, never scrolls */}
        <div {...explainAttrs({ id: 'test-type-section', title: 'Test type section', type: 'test-type' }, 'ax-test-left-context')}>
          <p className="ax-test-section-label">TEST TYPE</p>
          <div className="ax-test-pills">
            {TESTS.map((t) => (
              <button
                key={t.key}
                className={`ax-test-pill ${kind === t.key ? 'active' : ''}`}
                type="button"
                onClick={(event) => {
                  if (explainMode) return openExplain({ id: `test-button-${t.key}`, title: t.label, type: 'test-button', test: t }, event)
                  setKind(t.key); setResult(null)
                }}
              >
                {t.label}
              </button>
            ))}
          </div>

          <div {...explainAttrs({ id: 'test-help-box', title: 'Test guidance box', type: 'help-box' }, 'ax-test-info-box')}>
            <div className="ax-test-info-row">
              <span className="ax-test-info-key">Use when:</span>
              <span className="ax-test-info-val">{selectedTest.use}</span>
            </div>
            <div className="ax-test-info-row">
              <span className="ax-test-info-key">Tells you:</span>
              <span className="ax-test-info-val">{selectedTest.tells}</span>
            </div>
            <div className="ax-test-info-row">
              <span className="ax-test-info-key">Avoid:</span>
              <span className="ax-test-info-val">{selectedTest.avoid}</span>
            </div>
          </div>
        </div>

        <div ref={leftScrollRef} className="ax-test-left-scroll">
          <p className="ax-test-section-label">VARIABLES</p>
          {(kind === 't' || kind === 'anova') && (
            <div {...explainAttrs({ id: 'variables-section', title: 'Variables section', type: 'variables' }, 'ax-test-selects')}>
              <div {...explainAttrs({ id: 'group-variable-control', title: 'Group variable dropdown', type: 'control' }, 'ax-test-select-group', true)}>
                <label className="ax-test-select-label">Group variable (categorical)</label>
                <select className="ax-test-select" value={group} onChange={(e) => !explainMode && setGroup(e.target.value)}>
                  <option value="">- select -</option>
                  {categoricalVars.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
                </select>
              </div>
              <div {...explainAttrs({ id: 'measure-variable-control', title: 'Measure variable dropdown', type: 'control' }, 'ax-test-select-group', true)}>
                <label className="ax-test-select-label">Measure variable (numeric)</label>
                <select className="ax-test-select" value={measure} onChange={(e) => !explainMode && setMeasure(e.target.value)}>
                  <option value="">- select -</option>
                  {numericVars.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
                </select>
              </div>
            </div>
          )}
          {kind === 'chi' && (
            <div {...explainAttrs({ id: 'variables-section', title: 'Variables section', type: 'variables' }, 'ax-test-selects')}>
              <div {...explainAttrs({ id: 'category-variable-a-control', title: 'Category variable A dropdown', type: 'control' }, 'ax-test-select-group', true)}>
                <label className="ax-test-select-label">Category variable A</label>
                <select className="ax-test-select" value={varA} onChange={(e) => !explainMode && setVarA(e.target.value)}>
                  <option value="">- select -</option>
                  {categoricalVars.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
                </select>
              </div>
              <div {...explainAttrs({ id: 'category-variable-b-control', title: 'Category variable B dropdown', type: 'control' }, 'ax-test-select-group', true)}>
                <label className="ax-test-select-label">Category variable B</label>
                <select className="ax-test-select" value={varB} onChange={(e) => !explainMode && setVarB(e.target.value)}>
                  <option value="">- select -</option>
                  {categoricalVars.map((v) => <option key={v.name} value={v.name}>{v.name}</option>)}
                </select>
              </div>
            </div>
          )}
          {kind === 'corr' && (
            <>
              <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '0 0 6px' }}>Pick at least two</p>
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                {numericVars.map((v) => (
                  <span
                    key={v.name}
                    className={`ax-chip ${corrVars.includes(v.name) ? 'active' : ''} ${explainMode ? 'ax-explain-selectable' : ''}`}
                    onClick={(event) => {
                      if (explainMode) return openExplain({ id: `corr-variable-${v.name}`, title: `${v.name} correlation variable`, type: 'variable-chip', variable: v }, event)
                      setCorrVars(corrVars.includes(v.name) ? corrVars.filter((x) => x !== v.name) : [...corrVars, v.name])
                    }}
                  >
                    {v.name}
                  </span>
                ))}
              </div>
            </>
          )}

          {pairRecs.length > 0 && (
            <div {...explainAttrs({ id: 'recommended-pair', title: 'Recommended pair', type: 'recommendation' }, 'ax-test-rec-row')}>
              <span className="ax-test-rec-text">
                Recommended: <strong>{pairRecs[0].label}</strong>
              </span>
              <button
                className="ax-test-rec-link"
                type="button"
                onClick={(event) => {
                  if (explainMode) return openExplain({ id: 'use-recommended-pair', title: 'Use this recommended pair', type: 'action' }, event)
                  if (kind === 'corr') setCorrVars(pairRecs[0].variables)
                  if (kind === 'chi') { setVarA(pairRecs[0].varA); setVarB(pairRecs[0].varB) }
                  if (kind === 't' || kind === 'anova') { setGroup(pairRecs[0].group); setMeasure(pairRecs[0].measure) }
                }}
              >
                Use this →
              </button>
            </div>
          )}
        </div>

        <div className="ax-test-run-area" style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
          {loading && <div className="ax-test-loading-bar"><div className="ax-test-loading-fill" /></div>}
          <button
            {...explainAttrs({ id: 'run-test-button', title: 'Run test button', type: 'action' }, 'ax-test-run-btn', true)}
            style={{ flex: 1 }}
            disabled={!explainMode && (loading || !canRun)}
            onClick={(event) => {
              if (explainMode) return openExplain({ id: 'run-test-button', title: 'Run test button', type: 'action' }, event)
              run()
            }}
          >
            {loading ? <InlineSpinner label="Running test..." /> : '▶ Run test'}
          </button>
          {!loading && lastRunTime && (
            <span className="ax-test-last-run" style={{ fontSize: 11, color: 'var(--color-text-tertiary, #9ca3af)', whiteSpace: 'nowrap' }}>
              Last run · {lastRunTime}
            </span>
          )}
        </div>
      </div>

      {/* RIGHT COLUMN */}
      <div className="ax-test-right">
        <div style={{ display: 'flex', justifyContent: 'flex-end', padding: '10px 16px 0' }}>
          <button
            type="button"
            className={`ax-explain-mode-toggle ${explainMode ? 'active' : ''}`}
            onClick={() => {
              setExplainMode((current) => !current)
              setExplainPopup(null)
            }}
            title={explainMode ? 'Turn off Explain Mode' : 'Turn on Explain Mode'}
          >
            ✨ Explain Mode <span />
          </button>
        </div>
        <div ref={rightScrollRef} id="fix-correlation-test" className="ax-test-right-scroll">
          {(!result && !loading && !restoring) && (
            <div {...explainAttrs({ id: 'empty-results-state', title: 'Blank results state', type: 'empty' }, 'ax-test-empty')} style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', minHeight: '300px', padding: '40px 20px', textAlign: 'center' }}>
              <div className="ax-test-empty-icon" style={{ marginBottom: 16 }}>
                <svg width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="#f97316" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" style={{ opacity: 0.8 }}>
                  <line x1="18" y1="20" x2="18" y2="10"></line>
                  <line x1="12" y1="20" x2="12" y2="4"></line>
                  <line x1="6" y1="20" x2="6" y2="14"></line>
                </svg>
              </div>
              <p className="ax-test-empty-text" style={{ fontSize: '13px', fontWeight: 500, color: 'var(--color-text-secondary, #6b7280)', maxWidth: '320px', margin: 0 }}>
                Select a test type and variables, then click Run Test to see results.
              </p>
            </div>
          )}

          {(loading || restoring) && !result && (
            <div style={{ padding: '20px 0' }}>
              <SkeletonCards count={2} />
            </div>
          )}

          {result && (
            <TestResult
              kind={kind}
              result={result}
              setup={{ group, measure, varA, varB, corrVars }}
              datasetId={dataset.id}
              explainMode={explainMode}
              openExplain={openExplain}
            />
          )}
        </div>
      </div>
      {explainPopup && (
        <AnalysisExplainPopup
          datasetId={dataset.id}
          element={explainPopup}
          onClose={() => setExplainPopup(null)}
        />
      )}
    </div>
  )
}

function highlightSection(section) {
  const el = document.getElementById(section)
  if (!el) return
  el.scrollIntoView({ behavior: 'smooth', block: 'center' })
  el.classList.add('ax-fix-highlight')
  window.setTimeout(() => el.classList.remove('ax-fix-highlight'), 2600)
}

function recommendedTestPairs(kind, numericVars = [], categoricalVars = []) {
  const nums = numericVars.map((v) => v.name)
  const cats = categoricalVars.map((v) => v.name)
  if (kind === 'corr') {
    const preferred = nums.filter((name) => /score|gpa|rate|hours|income|age/i.test(name)).slice(0, 4)
    const variables = preferred.length >= 2 ? preferred : nums.slice(0, 4)
    return variables.length >= 2 ? [{ label: variables.slice(0, 3).join(' + '), variables }] : []
  }
  if (kind === 'chi') {
    const pairs = []
    for (let i = 0; i < cats.length; i += 1) {
      for (let j = i + 1; j < cats.length; j += 1) {
        pairs.push({ label: `${cats[i]} + ${cats[j]}`, varA: cats[i], varB: cats[j] })
      }
    }
    return pairs.slice(0, 1)
  }
  const groups = categoricalVars
    .filter((v) => kind === 't' ? Number(v.unique || 0) === 2 || v.dtype === 'binary' : Number(v.unique || 0) !== 2)
    .map((v) => v.name)
  const groupList = groups.length ? groups : cats
  return groupList.slice(0, 1).flatMap((g) => nums.slice(0, 1).map((m) => ({
    label: `${m} + ${g}`,
    group: g,
    measure: m,
  }))).slice(0, 1)
}

function TestResult({ kind, result, setup, datasetId, explainMode, openExplain }) {
  const summary = summarizeResult(kind, result, setup)
  const sig = summary.significant
  const explainAttrs = (meta, className = '') => ({
    className: `${className} ${explainMode ? 'ax-explain-selectable' : ''}`.trim(),
    onClick: (event) => openExplain?.({ ...meta, summary }, event),
    title: explainMode ? `Explain ${meta.title}` : undefined,
  })

  return (
    <div className="ax-test-results">
      {/* Section A — Metrics Row */}
      <div className="ax-test-metrics">
        <div {...explainAttrs({ id: 'metric-strongest-pair', title: 'Strongest pair card', type: 'metric' }, 'ax-test-metric-card hero')}>
          <div className="ax-test-metric-accent hero-accent" />
          <p className="ax-test-metric-label">STRONGEST PAIR</p>
          <p className="ax-test-metric-value hero-value">{summary.metrics[0]?.value || '-'}</p>
        </div>
        <div {...explainAttrs({ id: 'metric-r-value', title: kind === 'corr' ? 'R value card' : 'Statistic card', type: 'metric' }, `ax-test-metric-card ${sig ? 'sig' : 'not-sig'}`)}>
          <div className={`ax-test-metric-accent ${sig ? 'sig-accent' : 'not-sig-accent-r'}`} />
          <p className="ax-test-metric-label">R VALUE</p>
          <p className="ax-test-metric-value">{summary.metrics[1]?.value || '-'}</p>
          <p className="ax-test-metric-sub">Pearson correlation</p>
        </div>
        <div {...explainAttrs({ id: 'metric-p-value', title: 'P value card', type: 'metric' }, `ax-test-metric-card ${sig ? 'sig' : 'not-sig'}`)}>
          <div className={`ax-test-metric-accent ${sig ? 'sig-accent' : 'not-sig-accent-gray'}`} />
          <p className="ax-test-metric-label">P VALUE</p>
          <p className="ax-test-metric-value">{summary.metrics[2]?.value || '-'}</p>
          <p className="ax-test-metric-sub">α = 0.05 threshold</p>
        </div>
        <div {...explainAttrs({ id: 'metric-strength', title: 'Strength card', type: 'metric' }, `ax-test-metric-card ${sig ? 'sig' : 'not-sig'}`)}>
          <div className={`ax-test-metric-accent ${sig ? 'sig-accent' : 'not-sig-accent-slate'}`} />
          <p className="ax-test-metric-label">STRENGTH</p>
          <p className="ax-test-metric-value">{summary.metrics[3]?.value || '-'}</p>
        </div>
      </div>

      {/* Section B — Verdict */}
      <div {...explainAttrs({ id: 'significance-banner', title: 'Significance banner', type: 'verdict' }, `ax-test-verdict ${sig ? 'verdict-sig' : 'verdict-not-sig'}`)}>
        <div className={`ax-test-verdict-bar ${sig ? 'verdict-bar-sig' : 'verdict-bar-not-sig'}`} />
        <div className="ax-test-verdict-left">
          <div className={`ax-test-verdict-icon ${sig ? 'verdict-icon-sig' : 'verdict-icon-not-sig'}`}>
            {sig ? (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12" /></svg>
            ) : (
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
            )}
          </div>
          <div>
            <p className="ax-test-verdict-text">{summary.verdict}</p>
            <p className="ax-test-verdict-sub">{summary.decision}</p>
          </div>
        </div>
        <span className={`ax-test-verdict-badge ${sig ? 'badge-sig' : 'badge-not-sig'}`}>
          {sig ? 'Significant' : 'Not significant'}
        </span>
      </div>

      {/* Section 1 — What This Means */}
      <div {...explainAttrs({ id: 'what-this-means', title: 'What this means section', type: 'interpretation' })}>
        <WhatThisMeans kind={kind} result={result} setup={setup} />
      </div>

      {/* Section 2 — Decision Takeaway */}
      <div {...explainAttrs({ id: 'decision-takeaway', title: 'Decision takeaway card', type: 'decision' })}>
        <DecisionTakeaway kind={kind} result={result} />
      </div>

      {/* Supplementary charts for non-corr tests */}
      {kind === 't' && (
        <div {...explainAttrs({ id: 'group-mean-chart', title: 'Group mean comparison chart', type: 'visualization' })}>
          <GroupMeanBars means={[
            { label: result.group_labels?.[0] || 'Group 1', value: result.mean_group_1 },
            { label: result.group_labels?.[1] || 'Group 2', value: result.mean_group_2 },
          ]} measure={setup.measure} />
        </div>
      )}
      {kind === 'anova' && (
        <div {...explainAttrs({ id: 'group-mean-chart', title: 'Group mean comparison chart', type: 'visualization' })}>
          <GroupMeanBars means={Object.entries(result.group_means || {}).map(([label, value]) => ({ label, value }))} measure={setup.measure} />
        </div>
      )}
      {kind === 'chi' && (
        <div {...explainAttrs({ id: 'contingency-table', title: 'Contingency table', type: 'table' })}>
          <ContingencyTable result={result} />
        </div>
      )}
      {kind === 'corr' && (
        <>
          <div {...explainAttrs({ id: 'correlation-scatter', title: 'Correlation scatter plot', type: 'visualization' })}>
            <CorrelationScatter result={result} />
          </div>
          <div {...explainAttrs({ id: 'correlation-heatmap', title: 'Correlation heatmap', type: 'heatmap' })}>
            <CorrelationHeatmap result={result} datasetId={datasetId} />
          </div>
        </>
      )}
    </div>
  )
}

function AnalysisExplainPopup({ datasetId, element, onClose }) {
  const [aiText, setAiText] = useState(null)
  const [loading, setLoading] = useState(false)
  const [mode, setMode] = useState('normal')
  const [followUpInput, setFollowUpInput] = useState('')
  const [followUpLoading, setFollowUpLoading] = useState(false)
  const [position, setPosition] = useState(() => getAnalysisExplainPosition(getLiveAnalysisExplainRect(element)))

  useEffect(() => {
    const updatePosition = () => setPosition(getAnalysisExplainPosition(getLiveAnalysisExplainRect(element)))
    updatePosition()
    window.addEventListener('resize', updatePosition)
    window.addEventListener('scroll', updatePosition, true)
    return () => {
      window.removeEventListener('resize', updatePosition)
      window.removeEventListener('scroll', updatePosition, true)
    }
  }, [element?.id, element?.sourceEl, element?.sourceRect])

  const fetchAI = async (variant = 'normal') => {
    if (!datasetId || !element) return
    setLoading(true)
    try {
      const question = variant === 'simple'
        ? `Explain this Statistical Analysis UI section in very simple terms, one or two sentences: ${element.title}.`
        : variant === 'technical'
          ? `Give a concise technical explanation for this Statistical Analysis UI section: ${element.title}. Include the current values and statistical implication.`
          : `Explain this Statistical Analysis UI section in plain language for a student using SimuCast: ${element.title}. Include what it means, what the current dataset values imply, why it matters, and a recommendation.`
      const payload = {
        title: element.title,
        type: element.type,
        currentValues: element.values,
        fallbackDatasetExplanation: element.datasetExplanation,
        fallbackVerdict: element.verdict,
      }
      const response = await api.aiExplain(datasetId, `analysis-${element.id}-${variant}`, payload, question, { element: payload })
      setAiText(cleanAnalysisExplainText(response?.explanation, element.datasetExplanation))
    } catch {
      setAiText(element.datasetExplanation)
    } finally {
      setLoading(false)
    }
  }

  const askFollowUp = async () => {
    if (!datasetId || !followUpInput.trim()) return
    setFollowUpLoading(true)
    try {
      const payload = {
        title: element.title,
        type: element.type,
        currentValues: element.values,
        previousExplanation: aiText || element.datasetExplanation,
      }
      const response = await api.aiExplain(datasetId, `analysis-${element.id}-followup`, payload, followUpInput, { element: payload })
      setAiText(cleanAnalysisExplainText(response?.explanation, element.datasetExplanation))
      setFollowUpInput('')
      setMode('normal')
    } catch {
      setAiText(element.datasetExplanation)
    } finally {
      setFollowUpLoading(false)
    }
  }

  useEffect(() => {
    setAiText(null)
    fetchAI()
    const onKey = (event) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [element?.id, datasetId])

  return createPortal(
    <div
      className={`ax-expand-explain-popup ax-explain-placement-${position.placement}`}
      style={{ top: position.top, left: position.left, '--explain-popup-max-height': `${position.maxHeight}px` }}
      role="dialog"
      aria-modal="true"
      aria-label={`${element.title} explanation`}
    >
      <span
        className="ax-expand-explain-arrow"
        style={{ top: position.arrowTop, left: position.arrowLeft }}
        aria-hidden="true"
      />
      <div className="ax-expand-explain-popup-head">
        <div>
          <p>AI Explain &middot; {element.title}</p>
        </div>
        <button type="button" onClick={onClose} aria-label="Close explanation">&times;</button>
      </div>
      <div className="ax-expand-explain-popup-body">
        <section>
          <span>What this means</span>
          <p>{element.simple}</p>
        </section>
        <section>
          <span>In your dataset</span>
          {loading ? (
            <div className="ax-expand-explain-loading">
              <InlineSpinner label="" />
              <strong>Generating explanation...</strong>
            </div>
          ) : (
            <p>{aiText || element.datasetExplanation}</p>
          )}
        </section>
        <section>
          <span>Why it matters</span>
          <p>{element.whyItMatters}</p>
        </section>
        <section>
          <span>Verdict / recommendation</span>
          <p className={`ax-expand-explain-verdict ${element.verdictTone}`}>{element.verdict}</p>
        </section>
      </div>
      {mode === 'followup' && (
        <div className="ax-expand-explain-followup">
          <input
            type="text"
            value={followUpInput}
            onChange={(event) => setFollowUpInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') askFollowUp()
            }}
            placeholder="Ask a follow-up..."
          />
          <button type="button" onClick={askFollowUp} disabled={followUpLoading || !followUpInput.trim()}>
            {followUpLoading ? '...' : 'Ask'}
          </button>
        </div>
      )}
      <div className="ax-expand-explain-popup-foot">
        <button type="button" className="ax-btn mini" onClick={() => fetchAI('simple')} disabled={loading}>
          {loading ? 'Retrying...' : 'Explain simpler'}
        </button>
        <button type="button" className="ax-btn mini" onClick={() => fetchAI('technical')} disabled={loading}>Technical details</button>
        <button type="button" className="ax-btn mini" onClick={() => setMode(mode === 'followup' ? 'normal' : 'followup')}>
          {mode === 'followup' ? 'Close chat' : 'Ask follow-up'}
        </button>
      </div>
    </div>,
    document.body,
  )
}

function getAnalysisExplainPosition(sourceRect) {
  const popupW = 374
  const gap = 8
  const padding = 12
  const viewportW = typeof window === 'undefined' ? 1280 : window.innerWidth
  const viewportH = typeof window === 'undefined' ? 720 : window.innerHeight
  const popupH = Math.max(280, Math.min(560, viewportH - (padding * 2)))
  const anchor = normalizeAnalysisExplainRect(sourceRect)
  if (!anchor) {
    return { top: 84, left: padding, placement: 'right-start', arrowTop: 24, arrowLeft: -6, maxHeight: popupH }
  }

  const placements = anchor.bottom > viewportH * 0.68
    ? ['top-start', 'right-start', 'left-start', 'bottom-start']
    : ['right-start', 'left-start', 'bottom-start', 'top-start']
  for (const placement of placements) {
    const candidate = buildAnalysisExplainCandidate(placement, anchor, popupW, popupH, gap, padding, viewportW, viewportH)
    if (!analysisRectsOverlap(candidate.rect, anchor)) return candidate
  }

  const rightSpace = viewportW - anchor.right - gap - padding
  const leftSpace = anchor.left - gap - padding
  const fallbackPlacement = rightSpace >= leftSpace ? 'right-start' : 'left-start'
  return buildAnalysisExplainCandidate(fallbackPlacement, anchor, popupW, popupH, gap, padding, viewportW, viewportH)
}

function buildAnalysisExplainCandidate(placement, anchor, popupW, popupH, gap, padding, viewportW, viewportH) {
  let left = anchor.right + gap
  let top = anchor.top
  if (placement === 'left-start') {
    left = anchor.left - popupW - gap
    top = anchor.top
  } else if (placement === 'bottom-start') {
    left = anchor.left
    top = anchor.bottom + gap
  } else if (placement === 'top-start') {
    left = anchor.left
    top = anchor.top - popupH - gap
  }

  left = analysisClamp(left, padding, Math.max(padding, viewportW - popupW - padding))
  top = analysisClamp(top, padding, Math.max(padding, viewportH - popupH - padding))

  const rect = { left, top, right: left + popupW, bottom: top + popupH }
  const arrow = getAnalysisExplainArrowPosition(placement, anchor, rect, popupW, popupH)
  return { top, left, placement, rect, maxHeight: popupH, ...arrow }
}

function getLiveAnalysisExplainRect(element) {
  if (element?.sourceEl?.isConnected && typeof element.sourceEl.getBoundingClientRect === 'function') {
    return element.sourceEl.getBoundingClientRect()
  }
  return element?.sourceRect || null
}

function getAnalysisExplainArrowPosition(placement, anchor, popup, popupW, popupH) {
  if (placement === 'right-start' || placement === 'left-start') {
    return {
      arrowLeft: placement === 'right-start' ? -6 : popupW - 6,
      arrowTop: analysisClamp(anchor.top + Math.min(anchor.height / 2, 20) - popup.top, 18, popupH - 18),
    }
  }
  return {
    arrowLeft: analysisClamp(anchor.left + Math.min(anchor.width / 2, 30) - popup.left, 18, popupW - 18),
    arrowTop: placement === 'bottom-start' ? -6 : popupH - 6,
  }
}

function normalizeAnalysisExplainRect(rect) {
  if (!rect) return null
  const left = Number(rect.left)
  const top = Number(rect.top)
  const width = Number(rect.width || rect.right - rect.left)
  const height = Number(rect.height || rect.bottom - rect.top)
  if (![left, top, width, height].every(Number.isFinite)) return null
  return { left, top, width, height, right: left + width, bottom: top + height }
}

function analysisRectsOverlap(a, b) {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top
}

function analysisClamp(value, min, max) {
  return Math.min(Math.max(value, min), max)
}

function cleanAnalysisExplainText(text, fallback) {
  const value = String(text || '').trim()
  if (!value) return fallback
  const lower = value.toLowerCase()
  const looksRaw =
    value.startsWith('{') ||
    value.startsWith('[') ||
    lower.includes('anthropic_api_key') ||
    lower.includes('api key') ||
    lower.includes('traceback') ||
    lower.includes('request payload') ||
    lower.includes('"clicked') ||
    lower.includes('"pvalue"') ||
    lower.includes('"selectedtest"') ||
    lower.includes('params: {')
  return looksRaw ? fallback : value
}

function buildAnalysisExplainMeta(meta, context) {
  const {
    dataset,
    kind,
    selectedTest,
    group,
    measure,
    varA,
    varB,
    corrVars,
    numericVars,
    categoricalVars,
    result,
    canRun,
    lastRunTime,
    sourceEl,
    sourceRect,
  } = context
  const summary = meta.summary || (result ? summarizeResult(kind, result, { group, measure, varA, varB, corrVars }) : null)
  const pair = result?.strongest_pair
  const pValue = kind === 'corr' ? pair?.p : result?.p
  const statistic = kind === 't' ? result?.t : kind === 'anova' ? result?.f : kind === 'chi' ? result?.chi2 : pair?.r
  const selectedVariables = kind === 'corr' ? corrVars : kind === 'chi' ? [varA, varB].filter(Boolean) : [group, measure].filter(Boolean)
  const values = {
    page: 'Analysis',
    datasetName: dataset?.name || dataset?.file_name || dataset?.filename || 'dataset',
    testType: selectedTest?.label || kind,
    group,
    measure,
    varA,
    varB,
    corrVars,
    selectedVariables,
    numericVariables: numericVars?.length || 0,
    categoricalVariables: categoricalVars?.length || 0,
    canRun,
    lastRunTime,
    pValue,
    statistic,
    significant: summary?.significant,
    decision: summary?.decision,
    verdict: summary?.verdict,
    strength: summary?.metrics?.[3]?.value,
  }
  const base = {
    id: meta.id,
    title: meta.title,
    type: meta.type,
    values,
    sourceEl,
    sourceRect,
    verdictTone: 'good',
  }

  const variablesText = selectedVariables.length ? selectedVariables.join(' and ') : 'the selected variables'
  const testLabel = selectedTest?.label || 'the selected test'
  const hasResult = !!result
  const sigTone = hasResult && summary?.significant ? 'good' : hasResult ? 'warning' : 'warning'

  const templates = {
    'sidebar-header': {
      simple: 'This page runs statistical tests to compare groups or measure relationships between variables.',
      datasetExplanation: `${values.datasetName} has ${values.numericVariables} numeric variables and ${values.categoricalVariables} categorical variables available for analysis.`,
      whyItMatters: 'Choosing the right test helps avoid misleading conclusions before modeling.',
      verdict: 'Start with the question you want to answer, then pick the matching test type.',
      verdictTone: 'good',
    },
    'test-type-section': {
      simple: 'The test type controls what kind of relationship SimuCast evaluates.',
      datasetExplanation: `The current selection is ${testLabel}. ${selectedTest?.summary || ''}`,
      whyItMatters: 'Different tests expect different variable types, so the wrong test can produce meaningless results.',
      verdict: selectedTest?.use || 'Choose a test that matches your variables.',
      verdictTone: 'good',
    },
    'test-help-box': {
      simple: 'This guidance explains when the selected test is appropriate and when to avoid it.',
      datasetExplanation: `${testLabel} is selected. It tells you: ${selectedTest?.tells || 'the relationship between chosen variables'}.`,
      whyItMatters: 'This keeps the analysis defensible by matching the method to the data.',
      verdict: selectedTest?.avoid || 'Review the assumptions before running the test.',
      verdictTone: 'good',
    },
    'variables-section': {
      simple: 'This section selects which columns will be used by the statistical test.',
      datasetExplanation: selectedVariables.length ? `The selected variables are ${variablesText}.` : 'No complete variable pair has been selected yet.',
      whyItMatters: 'The result only describes the variables selected here, not the whole dataset.',
      verdict: canRun ? 'Ready to run. The selected variables are enough for this test.' : 'Select the required variables before running the test.',
      verdictTone: canRun ? 'good' : 'warning',
    },
    'recommended-pair': {
      simple: 'The recommended pair suggests columns that likely fit the selected test.',
      datasetExplanation: `For ${testLabel}, SimuCast is using variable types from this dataset to suggest a valid pair.`,
      whyItMatters: 'It reduces setup mistakes and helps users find a useful first analysis quickly.',
      verdict: 'Use it as a starting point, then adjust if your research question needs different variables.',
      verdictTone: 'good',
    },
    'run-test-button': {
      simple: 'This button sends the selected test and variables to the backend and computes the result.',
      datasetExplanation: canRun ? `Ready to run ${testLabel} on ${variablesText}.` : 'The current setup is incomplete, so the test cannot run yet.',
      whyItMatters: 'Running the test creates the p-value, statistic, strength, and interpretation used in the result cards.',
      verdict: canRun ? 'Run this after confirming the variables match your question.' : 'Complete the missing selections first.',
      verdictTone: canRun ? 'good' : 'warning',
    },
    'empty-results-state': {
      simple: 'This blank state means no statistical result is currently available on the page.',
      datasetExplanation: 'Choose a test type and variables, then run the test to produce result cards and interpretation.',
      whyItMatters: 'The page cannot make a statistical claim until a test has been run.',
      verdict: 'Run a test to generate analysis evidence.',
      verdictTone: 'warning',
    },
    'metric-strongest-pair': {
      simple: 'This card identifies the variable pair or comparison represented by the current result.',
      datasetExplanation: summary?.metrics?.[0]?.value ? `The active comparison is ${summary.metrics[0].value}.` : 'No active comparison is available yet.',
      whyItMatters: 'It anchors the interpretation so users know exactly which variables the statistics describe.',
      verdict: hasResult ? 'Use this as the headline relationship for the result.' : 'Run a test first.',
      verdictTone: hasResult ? 'good' : 'warning',
    },
    'metric-r-value': {
      simple: 'This card shows the main statistic or relationship value for the selected test.',
      datasetExplanation: hasResult ? `The reported value is ${summary?.metrics?.[1]?.value || fmt(statistic)}.` : 'No statistic has been computed yet.',
      whyItMatters: 'The statistic gives the size or direction of the observed relationship.',
      verdict: hasResult ? 'Interpret this together with the p-value and strength card.' : 'Run a test first.',
      verdictTone: hasResult ? 'good' : 'warning',
    },
    'metric-p-value': {
      simple: 'The p-value estimates whether the observed result is unlikely under a no-relationship assumption.',
      datasetExplanation: hasResult ? `The p-value is ${summary?.metrics?.[2]?.value || fmt(pValue)} with a 0.05 threshold.` : 'No p-value has been computed yet.',
      whyItMatters: 'It helps decide whether the result is statistically significant.',
      verdict: hasResult && summary?.significant ? 'Statistically significant at 0.05.' : hasResult ? 'Not statistically significant at 0.05.' : 'Run a test first.',
      verdictTone: sigTone,
    },
    'metric-strength': {
      simple: 'This card summarizes how strong the observed relationship or difference is.',
      datasetExplanation: hasResult ? `The result strength is ${summary?.metrics?.[3]?.value || 'available in the result'}.` : 'No strength label is available yet.',
      whyItMatters: 'A result can be statistically significant but still too small to matter practically.',
      verdict: hasResult ? 'Use this to judge practical importance, not just statistical significance.' : 'Run a test first.',
      verdictTone: hasResult ? 'good' : 'warning',
    },
    'significance-banner': {
      simple: 'This banner translates the test result into a decision about statistical significance.',
      datasetExplanation: summary?.decision || 'No decision is available yet.',
      whyItMatters: 'It turns p-values into a readable conclusion for reports and decisions.',
      verdict: summary?.verdict || 'Run a test first.',
      verdictTone: sigTone,
    },
    'what-this-means': {
      simple: 'This section explains the statistical result in plain language.',
      datasetExplanation: summary?.conclusion || 'No interpretation is available yet.',
      whyItMatters: 'It helps translate statistical output into a sentence that can be used in a report.',
      verdict: summary?.predictive || 'Run a test first.',
      verdictTone: hasResult ? 'good' : 'warning',
    },
    'decision-takeaway': {
      simple: 'This card summarizes whether the relationship is useful for decision-making or prediction.',
      datasetExplanation: summary?.predictive || 'No decision takeaway is available yet.',
      whyItMatters: 'Statistical significance is not the same as usefulness, so this keeps the conclusion practical.',
      verdict: hasResult ? 'Use this as the short recommendation after reviewing the details.' : 'Run a test first.',
      verdictTone: hasResult ? 'good' : 'warning',
    },
    'group-mean-chart': {
      simple: 'This chart compares average values across groups.',
      datasetExplanation: `The chart visualizes ${measure || 'the measure'} across ${group || 'the selected group variable'}.`,
      whyItMatters: 'The visual makes it easier to see which group is higher or lower than the others.',
      verdict: 'Use the chart to support, not replace, the statistical test result.',
      verdictTone: 'good',
    },
    'contingency-table': {
      simple: 'This table shows how two categorical variables distribute together.',
      datasetExplanation: `The table compares ${varA || 'variable A'} with ${varB || 'variable B'}.`,
      whyItMatters: 'It shows which category combinations drive the chi-square result.',
      verdict: 'Review row percentages to understand the association pattern.',
      verdictTone: 'good',
    },
    'correlation-scatter': {
      simple: 'This scatter plot shows the shape and direction of a numeric relationship.',
      datasetExplanation: pair ? `The strongest pair is ${pair.var_a} and ${pair.var_b}, with r = ${fmt(pair.r)}.` : 'No correlation pair is selected yet.',
      whyItMatters: 'It helps detect whether the relationship is linear, noisy, or affected by outliers.',
      verdict: pair ? 'Use this plot to confirm that the correlation is visually sensible.' : 'Run a correlation test first.',
      verdictTone: pair ? 'good' : 'warning',
    },
    'correlation-heatmap': {
      simple: 'This heatmap compares numeric variable pairs by correlation strength.',
      datasetExplanation: pair ? `${pair.var_a} and ${pair.var_b} are the strongest selected pair.` : 'No correlation matrix is available yet.',
      whyItMatters: 'It quickly shows which numeric variables move together most strongly.',
      verdict: 'Prioritize stronger cells for interpretation, but avoid treating correlation as causation.',
      verdictTone: 'good',
    },
    'side-guide-tab': {
      simple: 'The Guide tab opens contextual help for the current page.',
      datasetExplanation: 'It is available while working on the Analysis page.',
      whyItMatters: 'It keeps instructions close without leaving the workflow.',
      verdict: 'Use it when you need page guidance.',
      verdictTone: 'good',
    },
    'side-history-tab': {
      simple: 'The History tab opens prior actions and runs.',
      datasetExplanation: lastRunTime ? `The last analysis run was around ${lastRunTime}.` : 'No recent analysis run is recorded in this page state.',
      whyItMatters: 'History helps track how the dataset and analyses changed over time.',
      verdict: 'Use it to audit previous actions.',
      verdictTone: 'good',
    },
    'floating-dataset-button': {
      simple: 'The Dataset button opens the floating dataset preview.',
      datasetExplanation: `It lets you inspect ${values.datasetName} without leaving the Analysis page.`,
      whyItMatters: 'Checking the rows and columns helps confirm the selected variables before running a test.',
      verdict: 'Use it to verify the data behind the analysis.',
      verdictTone: 'good',
    },
    'floating-ask-ai-button': {
      simple: 'The Ask AI button opens the general SimuCast assistant.',
      datasetExplanation: `It can answer broader questions about ${values.datasetName} and the current analysis workflow.`,
      whyItMatters: 'This is separate from Explain Mode: Ask AI is conversational, while Explain Mode explains clicked UI elements.',
      verdict: 'Use Ask AI for broader follow-up questions.',
      verdictTone: 'good',
    },
  }

  const buttonTemplate = meta.type === 'test-button' ? {
    simple: `${meta.title} is one of the available statistical test types.`,
    datasetExplanation: `${meta.test?.summary || meta.title} Current dataset variables include ${values.numericVariables} numeric and ${values.categoricalVariables} categorical columns.`,
    whyItMatters: meta.test?.use || 'The selected test must match the selected variable types.',
    verdict: meta.test?.avoid || 'Choose this only when it matches your question.',
    verdictTone: 'good',
  } : null

  const variableTemplate = meta.type === 'variable-chip' ? {
    simple: 'This chip selects or removes a numeric variable from the correlation test.',
    datasetExplanation: `${meta.variable?.name || meta.title} is available as a numeric correlation input.`,
    whyItMatters: 'Correlation compares numeric variables pair by pair.',
    verdict: 'Select at least two numeric variables before running correlation.',
    verdictTone: 'good',
  } : null

  return {
    ...base,
    ...(templates[meta.id] || buttonTemplate || variableTemplate || {
      simple: `${meta.title} is part of the Statistical Analysis workflow.`,
      datasetExplanation: `${testLabel} is selected with ${variablesText}.`,
      whyItMatters: 'This control affects what the analysis computes or how the result is interpreted.',
      verdict: 'Review it before using the result in a report.',
      verdictTone: 'good',
    }),
  }
}

function CorrelationScatter({ result }) {
  const pair = result.strongest_pair
  const vars = result.variables || []
  const points = result.scatter_points || []
  if (!pair || vars.length !== 2 || points.length === 0) return null

  const chartPoints = points.map(([x, y]) => ({ x: Number(x), y: Number(y) })).filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
  if (!chartPoints.length) return null
  const xs = chartPoints.map((p) => p.x)
  const ys = chartPoints.map((p) => p.y)
  const xMean = avg(xs)
  const yMean = avg(ys)
  const denom = xs.reduce((sum, x) => sum + ((x - xMean) ** 2), 0) || 1
  const slope = xs.reduce((sum, x, i) => sum + ((x - xMean) * (ys[i] - yMean)), 0) / denom
  const intercept = yMean - slope * xMean
  const minX = Math.min(...xs)
  const maxX = Math.max(...xs)
  const trend = [
    { x: minX, y: intercept + slope * minX },
    { x: maxX, y: intercept + slope * maxX },
  ]

  return (
    <div className="ax-test-scatter">
      <p style={{ fontSize: 13, fontWeight: 600, margin: '0 0 4px' }}>Relationship scatter plot</p>
      <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '0 0 8px' }}>
        {vars[0]} and {vars[1]}. The line shows the overall trend.
      </p>
      <div style={{ height: 200 }}>
        <Scatter
          data={{
            datasets: [
              { label: 'Rows', data: chartPoints, backgroundColor: 'rgba(249,115,22,0.45)', pointRadius: 2.5 },
              { label: 'Trend', data: trend, type: 'line', borderColor: '#111827', borderWidth: 2, pointRadius: 0, showLine: true },
            ],
          }}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            plugins: { legend: { display: false } },
            scales: {
              x: { title: { display: true, text: vars[0], font: { size: 10 } }, ticks: { font: { size: 9 } } },
              y: { title: { display: true, text: vars[1], font: { size: 10 } }, ticks: { font: { size: 9 } } },
            },
          }}
        />
      </div>
    </div>
  )
}

function GroupMeanBars({ means, measure }) {
  const max = Math.max(...means.map((m) => Math.abs(Number(m.value) || 0)), 1)
  return (
    <div className="ax-test-mean-bars">
      <p style={{ fontSize: 13, fontWeight: 600, margin: '0 0 8px' }}>Group mean comparison</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
        {means.map((m) => (
          <div key={m.label} style={{ display: 'grid', gridTemplateColumns: '140px 1fr 60px', gap: 8, alignItems: 'center', fontSize: 12 }}>
            <span title={m.label} style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{m.label}</span>
            <span style={{ height: 7, background: 'var(--color-background-secondary)', borderRadius: 4, overflow: 'hidden' }}>
              <span style={{ display: 'block', height: '100%', width: `${Math.min(100, Math.abs(Number(m.value) || 0) / max * 100)}%`, background: '#7F77DD' }} />
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', textAlign: 'right' }}>{fmt(m.value)}</span>
          </div>
        ))}
      </div>
      <p style={{ fontSize: 10, color: 'var(--color-text-secondary)', margin: '6px 0 0' }}>Higher bars = higher average {measure}</p>
    </div>
  )
}

function ContingencyTable({ result }) {
  const rows = Object.keys(result.contingency || {})
  const cols = rows.length ? Object.keys(result.contingency[rows[0]] || {}) : []
  return (
    <div className="ax-test-contingency">
      <p style={{ fontSize: 13, fontWeight: 600, margin: '0 0 6px' }}>Contingency table</p>
      <div style={{ overflow: 'auto' }}>
        <table className="ax-tbl">
          <thead>
            <tr><th></th>{cols.map((c) => <th key={c}>{c}</th>)}</tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r}>
                <td style={{ fontWeight: 500 }}>{r}</td>
                {cols.map((c) => (
                  <td key={c}>
                    {result.contingency[r]?.[c] ?? 0}
                    <span style={{ color: 'var(--color-text-tertiary)', marginLeft: 4 }}>({fmt(result.row_percentages?.[r]?.[c])}%)</span>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function summarizeResult(kind, result, setup) {
  if (kind === 't') {
    const diff = Number(result.mean_group_1) - Number(result.mean_group_2)
    const effect = effectLabel(Math.abs(result.cohens_d), [0.2, 0.5, 0.8])
    const higher = diff >= 0 ? result.group_labels?.[0] : result.group_labels?.[1]
    return {
      significant: !!result.significant,
      verdict: result.significant ? 'Significant relationship found' : 'No significant relationship found',
      decision: result.significant
        ? `Reject the null hypothesis (p = ${fmt(result.p)} < 0.05)`
        : `Fail to reject the null hypothesis (p = ${fmt(result.p)} > 0.05)`,
      metrics: [
        { label: 'strongest pair', value: `${setup.group} / ${setup.measure}` },
        { label: 'r', value: fmt(result.cohens_d) },
        { label: 'p value', value: fmt(result.p) },
        { label: 'strength', value: effect },
      ],
      conclusion: result.significant
        ? `There is evidence that average ${setup.measure} differs by ${setup.group}. ${higher} has the higher observed mean.`
        : `The observed mean difference in ${setup.measure} by ${setup.group} was not statistically strong enough at p < 0.05.`,
      predictive: `${setup.group} can be used as a simple, non-model indicator of expected ${setup.measure}: the observed group mean difference is ${fmt(diff)}.`,
    }
  }
  if (kind === 'anova') {
    const means = Object.entries(result.group_means || {}).sort((a, b) => Number(b[1]) - Number(a[1]))
    const effect = effectLabel(Number(result.eta_squared), [0.01, 0.06, 0.14])
    return {
      significant: !!result.significant,
      verdict: result.significant ? 'Significant group differences' : 'No significant group differences',
      decision: result.significant
        ? `Reject the null hypothesis (p = ${fmt(result.p)} < 0.05)`
        : `Fail to reject the null hypothesis (p = ${fmt(result.p)} > 0.05)`,
      metrics: [
        { label: 'strongest pair', value: `${setup.group} / ${setup.measure}` },
        { label: 'r', value: fmt(result.eta_squared) },
        { label: 'p value', value: fmt(result.p) },
        { label: 'strength', value: effect },
      ],
      conclusion: result.significant
        ? `At least one ${setup.group} category has a different average ${setup.measure}. Highest: ${means[0]?.[0] || 'the leading group'}.`
        : `The average ${setup.measure} does not show a statistically significant difference across ${setup.group} groups.`,
      predictive: `${setup.group} gives a simple expectation signal for ${setup.measure}; compare group means to see which categories tend to be higher or lower.`,
    }
  }
  if (kind === 'chi') {
    const effect = effectLabel(Number(result.cramers_v), [0.1, 0.3, 0.5])
    return {
      significant: !!result.significant,
      verdict: result.significant ? 'Significant association found' : 'No significant association',
      decision: result.significant
        ? `Reject the null hypothesis (p = ${fmt(result.p)} < 0.05)`
        : `Fail to reject the null hypothesis (p = ${fmt(result.p)} > 0.05)`,
      metrics: [
        { label: 'strongest pair', value: `${setup.varA} / ${setup.varB}` },
        { label: 'r', value: fmt(result.cramers_v) },
        { label: 'p value', value: fmt(result.p) },
        { label: 'strength', value: effect },
      ],
      conclusion: result.significant
        ? `There is evidence that ${setup.varA} and ${setup.varB} are associated. Category percentages differ more than expected by chance.`
        : `There is not enough evidence to say ${setup.varA} and ${setup.varB} are associated at p < 0.05.`,
      predictive: `Use the contingency percentages as a simple probability-style guide: each row shows how ${setup.varB} tends to distribute within ${setup.varA}.`,
    }
  }
  const pair = result.strongest_pair
  const r = pair?.r ?? 0
  const strength = corrStrength(Math.abs(r))
  return {
    significant: pair ? pair.p < 0.05 : false,
    verdict: pair ? (pair.p < 0.05 ? 'Significant relationship found' : 'No significant relationship found') : 'No pairs computed',
    decision: pair
      ? (pair.p < 0.05
        ? `Reject the null hypothesis (p = ${fmt(pair.p)} < 0.05)`
        : `Fail to reject the null hypothesis (p = ${fmt(pair.p)} > 0.05)`)
      : 'Select at least two numeric variables.',
    metrics: [
      { label: 'strongest pair', value: pair ? `${pair.var_a} / ${pair.var_b}` : '-' },
      { label: 'r', value: fmt(r) },
      { label: 'p value', value: pair ? fmt(pair.p) : '-' },
      { label: 'strength', value: strength },
    ],
    conclusion: pair
      ? `${pair.var_a} and ${pair.var_b} show the strongest relationship among selected variables. Direction is ${r >= 0 ? 'positive' : 'negative'}, strength is ${strength}.`
      : 'No pairwise correlation could be computed.',
    predictive: pair
      ? `As ${pair.var_a} ${r >= 0 ? 'increases' : 'increases'}, ${pair.var_b} tends to ${r >= 0 ? 'increase' : 'decrease'}. This is association, not a full model prediction.`
      : 'Select at least two numeric variables to produce trend-style insight.',
  }
}

function effectLabel(value, cutoffs) {
  if (value >= cutoffs[2]) return 'large'
  if (value >= cutoffs[1]) return 'moderate'
  if (value >= cutoffs[0]) return 'small'
  return 'very small'
}

function avg(values) {
  return values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1)
}

function corrStrength(value) {
  if (value >= 0.7) return 'strong'
  if (value >= 0.4) return 'moderate'
  if (value >= 0.2) return 'weak'
  return 'very weak'
}

function fmt(v) {
  if (v === null || v === undefined || Number.isNaN(v)) return '-'
  if (typeof v !== 'number') return v
  if (Math.abs(v) < 0.001 && v !== 0) return v.toExponential(2)
  return v.toFixed(3)
}
