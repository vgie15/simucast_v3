/* ============================================================
 * PAGE: REPORT (BUILD & EXPORT)
 * Keywords: report, build report, export, pdf, html, sections, summary
 * ============================================================ */
import React, { useState } from 'react'
import { Chart } from 'chart.js'
import { api } from '../../api'
import { AIInsightCard } from '../ai/AIExplainers'
import { BusyOverlay, InlineSpinner, SkeletonCards } from '../common/LoadingStates'
import HelpButton from '../common/HelpButton'
import { useAuth } from '../providers/AuthProvider'
import PageGuide from '../common/PageGuide'

const SECTIONS = [
  { key: 'summary', label: 'Executive summary' },
  { key: 'descriptives', label: 'Descriptive insights' },
  { key: 'tests', label: 'Analysis and predictive insights' },
  { key: 'models', label: 'Model performance' },
  { key: 'ai_interpretation', label: 'AI interpretation' },
  { key: 'documentation', label: 'Appendix actions' },
]

// Page component for selecting report sections, building the report, and exporting HTML/PDF.
export default function ReportPage({ dataset }) {
  const auth = useAuth()
  const [selected, setSelected] = useState(SECTIONS.map((s) => s.key))
  const [report, setReport] = useState(null)
  const [loading, setLoading] = useState(false)

  if (!dataset) return <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>Upload a dataset first.</p>

  const toggle = (key) => {
    setSelected(selected.includes(key) ? selected.filter((k) => k !== key) : [...selected, key])
  }

  const build = async () => {
    if (auth.isGuest) {
      auth.requireAccountForReports()
      return
    }
    setLoading(true)
    try {
      const r = await api.buildReport(dataset.id, selected)
      setReport(r)
    } finally {
      setLoading(false)
    }
  }

  const exportJson = () => {
    if (!report) return
    const blob = new Blob([JSON.stringify(report, null, 2)], { type: 'application/json' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `simucast_report_${dataset.name}.json`
    a.click()
  }

  const reportHtml = (charts = {}) => {
    if (!report) return ''
    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapeHtml(report.title)} report</title>
  <style>
    @page {
      size: letter;
      margin: 20mm 18mm 18mm;
      @bottom-right {
        content: "Page " counter(page) " of " counter(pages);
        color: #667085;
        font-size: 9px;
      }
    }
    * { box-sizing: border-box; }
    body {
      font-family: Arial, Helvetica, sans-serif;
      color: #16202a;
      background: #fff;
      margin: 0 auto;
      max-width: 780px;
      line-height: 1.55;
      font-size: 12.5px;
    }
    .cover {
      min-height: 210px;
      padding: 56px 0 28px;
      border-bottom: 2px solid #16202a;
      margin-bottom: 28px;
    }
    h1 { margin: 0 0 8px; font-size: 28px; line-height: 1.1; letter-spacing: 0; }
    .meta { color: #667085; font-size: 11px; display: grid; gap: 3px; }
    .report-header {
      display: none;
      color: #667085;
      border-bottom: 1px solid #d9dee7;
      font-size: 10px;
      padding-bottom: 6px;
      margin-bottom: 18px;
    }
    section {
      break-inside: avoid;
      page-break-inside: avoid;
      margin: 0 0 28px;
      padding-top: 2px;
    }
    section.appendix {
      break-before: page;
      page-break-before: always;
    }
    h2 {
      margin: 0 0 12px;
      font-size: 17px;
      line-height: 1.2;
      border-bottom: 1px solid #cfd6e0;
      padding-bottom: 7px;
      break-after: avoid;
      page-break-after: avoid;
    }
    .chart-img {
      display: block;
      width: 100%;
      max-width: 640px;
      margin: 10px auto 6px;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .chart-caption {
      text-align: center;
      font-size: 11px;
      color: #667085;
      margin: 0 0 14px;
    }
    .insight-card {
      border: 1px solid #d9dee7;
      background: #f8fafc;
      border-radius: 8px;
      padding: 13px 15px;
      margin: 10px 0 14px;
    }
    p { white-space: pre-line; margin: 0; }
    .entry {
      padding: 9px 11px;
      border: 1px solid #e5e7eb;
      border-radius: 7px;
      margin: 8px 0;
      font-size: 11.5px;
      break-inside: avoid;
      page-break-inside: avoid;
    }
    .entry strong { text-transform: capitalize; }
    .entry .stamp { color: #667085; font-size: 10.5px; display: block; margin-bottom: 2px; }
    .appendix .entry { padding: 6px 8px; font-size: 10.5px; margin: 5px 0; }
    .model-table, table {
      border-collapse: collapse;
      width: 100%;
      font-size: 11.5px;
      margin-top: 10px;
    }
    th, td { border: 1px solid #dde3ec; padding: 7px 8px; text-align: left; vertical-align: top; }
    th { background: #eef2f7; color: #344054; font-weight: 700; }
    td.num, th.num { text-align: right; font-variant-numeric: tabular-nums; }
    tbody tr:nth-child(even) td { background: #fbfcfe; }
    .label { color: #667085; font-size: 10.5px; text-transform: uppercase; letter-spacing: .02em; }
    .note { margin-top: 6px; color: #344054; }
    .muted { color: #667085; }
    @media print {
      body { max-width: none; }
      .report-header { display: flex; justify-content: space-between; }
      .cover { padding-top: 24px; min-height: 160px; }
    }
  </style>
</head>
<body>
  <div class="cover">
    <h1>${escapeHtml(report.title)}</h1>
    <div class="meta">
      <span>Generated by SimuCast</span>
      <span>${new Date(report.generated_at).toLocaleString()}</span>
      <span>${report.dataset?.rows ?? ''} rows - ${report.dataset?.columns ?? ''} variables</span>
    </div>
  </div>
  <div class="report-header">
    <span>Project: ${escapeHtml(report.title)}</span>
    <span>Generated by SimuCast - ${new Date(report.generated_at).toLocaleString()}</span>
  </div>
  ${report.sections.map((sec, index) => sectionHtml(sec, index, charts)).join('')}
</body>
</html>`
  }

  const exportHtml = () => {
    if (!report) return
    const charts = renderChartImages(report)
    const blob = new Blob([reportHtml(charts)], { type: 'text/html' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `simucast_report_${dataset.name}.html`
    a.click()
    URL.revokeObjectURL(url)
  }

  const printReport = () => {
    if (!report) return
    const charts = renderChartImages(report)
    const w = window.open('', '_blank')
    if (!w) return
    w.document.write(reportHtml(charts))
    w.document.close()
    w.focus()
    w.print()
  }

  return (
    <>
      <h1 className="ax-page-title">Auto-report</h1>
      <p className="ax-page-sub">Structured analysis report with interpreted findings, model results, and an appendix trail.</p>
      <PageGuide
        title="Build the report from saved work"
        meta="Report"
        steps={['Select sections', 'Generate', 'Review', 'Export']}
      >
        Reports are clearest when they reuse the analyses, model results, scenarios, AI explanations, and history already saved in the project.
      </PageGuide>

      <div style={{ display: 'grid', gridTemplateColumns: '200px 1fr', gap: 14 }}>
        <div>
          <p className="ax-lbl" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            Sections
            <HelpButton
              title="Report sections"
              text="Choose which saved outputs should appear in the generated report. The report combines dataset context, analyses, model results, what-if scenarios, saved AI explanations, and documentation."
            />
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
            {SECTIONS.map((s) => (
              <label key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 12, cursor: 'pointer' }}>
                <input type="checkbox" checked={selected.includes(s.key)} onChange={() => toggle(s.key)} />
                {s.label}
              </label>
            ))}
          </div>
          <div style={{ marginTop: 16, display: 'flex', flexDirection: 'column', gap: 6 }}>
            <button className="ax-btn prim" disabled={loading} onClick={build}>
              {loading ? <InlineSpinner label="Generating report..." /> : 'Generate report'}
            </button>
            <button className="ax-btn" disabled={!report} onClick={printReport}>Print report</button>
            <button className="ax-btn" disabled={!report} onClick={exportHtml}>Export HTML</button>
            <button className="ax-btn" disabled={!report} onClick={exportJson}>Export JSON</button>
          </div>
        </div>

        <div className={`ax-card ax-busy-host ${loading ? 'is-busy' : ''}`} style={{ padding: 18, minHeight: 400 }} id="ax-report-preview">
          <BusyOverlay
            active={loading}
            title="Generating report..."
            detail="Collecting analyses, models, scenarios, and documentation into a structured report."
          />
          {loading && !report ? (
            <SkeletonCards count={4} />
          ) : !report ? (
            <p style={{ fontSize: 12, color: 'var(--color-text-secondary)' }}>
              Press "Generate report" to build a document from your current analyses.
            </p>
          ) : (
            <>
              <p style={{ fontSize: 18, fontWeight: 500, margin: 0, display: 'flex', alignItems: 'center', gap: 6 }}>
                {report.title}
                <HelpButton
                  title="Report preview"
                  text="This preview shows the structured report before export. Saved analyses and AI explanations are reused here so the report reflects the work already completed in the project."
                />
              </p>
              <p style={{ fontSize: 11, color: 'var(--color-text-secondary)', margin: '2px 0 16px' }}>
                Generated by SimuCast - {new Date(report.generated_at).toLocaleString()}
              </p>

              <AIInsightCard
                datasetId={dataset.id}
                step="report-summary"
                params={{ sections: selected }}
                result={{
                  title: report.title,
                  sections: report.sections?.map((sec) => ({ title: sec.title, body: sec.body })),
                  dataset: report.dataset,
                }}
                title="Executive summary (AI)"
                question="Write a tight executive summary of this analysis pipeline for a non-technical stakeholder: what the data is, what was done, the headline finding, the main caveat, and 2–3 next steps."
                refreshKey={report.generated_at}
              />

              {report.sections.map((sec, i) => (
                <div key={i} style={{ marginBottom: 18 }}>
                  <p style={{ fontSize: 14, fontWeight: 500, margin: '0 0 6px' }}>{sec.title}</p>
                  {sec.body && (
                    <p style={{ fontSize: 12, color: 'var(--color-text-secondary)', margin: 0, lineHeight: 1.6, whiteSpace: 'pre-line' }}>{sec.body}</p>
                  )}
                  {sec.data?.stats && (
                    <table className="ax-tbl" style={{ fontSize: 11, marginTop: 6 }}>
                      <thead>
                        <tr><th>Variable</th><th>n</th><th>Mean</th><th>SD</th><th>Min</th><th>Max</th></tr>
                      </thead>
                      <tbody>
                        {sec.data.stats.filter((s) => s.kind === 'numeric').map((s) => (
                          <tr key={s.variable}>
                            <td>{s.variable}</td>
                            <td>{s.n?.toLocaleString()}</td>
                            <td>{s.mean?.toFixed(3) ?? '—'}</td>
                            <td>{s.std?.toFixed(3) ?? '—'}</td>
                            <td>{s.min?.toFixed(3) ?? '—'}</td>
                            <td>{s.max?.toFixed(3) ?? '—'}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  )}
                  {sec.items && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 4, marginTop: 6 }}>
                      {sec.items.map((it, j) => (
                        <div key={j} style={{ fontSize: 11, color: 'var(--color-text-secondary)', padding: '4px 8px', background: 'var(--color-background-secondary)', borderRadius: 4 }}>
                          {it.created_at && <span>{new Date(it.created_at).toLocaleString()} - </span>}
                          {it.kind && <strong>{it.kind}: </strong>}
                          {it.name && <strong>{it.name} ({it.algorithm}): </strong>}
                          {it.summary || it.result?.interpretation || formatInline(it.metrics) || JSON.stringify(it.result || it.metrics).slice(0, 120)}
                          {(it.detail?.notes || []).map((n) => (
                            <p key={n.id} style={{ margin: '4px 0 0', color: 'var(--color-text-primary)' }}>
                              Note: {n.text}
                            </p>
                          ))}
                          {it.detail?.mapping && (
                            <p style={{ margin: '4px 0 0' }}>
                              Mapping: {Object.entries(it.detail.mapping).map(([from, to]) => `${from} to ${to}`).join('; ')}
                            </p>
                          )}
                          {it.feature_influence && (
                            <p style={{ margin: '4px 0 0' }}>
                              Feature influence: {normalizeInfluence(it.feature_influence).slice(0, 5).map((x) => x.feature).join(', ')}
                            </p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ))}
            </>
          )}
        </div>
      </div>
    </>
  )
}

// Returns an inline metrics string for a model based on its task type.
function formatInline(m) {
  if (!m) return ''
  if (m.task === 'classification') {
    const parts = [`accuracy ${(m.accuracy * 100).toFixed(1)}%`]
    if (m.auc != null) parts.push(`AUC ${m.auc.toFixed(3)}`)
    return parts.join(', ')
  }
  if (m.task === 'regression') {
    return `R2 ${m.r2?.toFixed(3) ?? '-'}, RMSE ${m.rmse?.toFixed(3) ?? '-'}`
  }
  return ''
}

// Builds the HTML markup for one report section including tables, charts, and items.
function sectionHtml(sec, index = 0, charts = {}) {
  const body = sec.body ? `<div class="insight-card"><p>${escapeHtml(sec.body)}</p></div>` : ''
  const stats = sec.data?.stats
    ? `<table><thead><tr><th>Variable</th><th class="num">n</th><th class="num">Mean</th><th class="num">SD</th><th class="num">Min</th><th class="num">Max</th></tr></thead><tbody>${
        sec.data.stats.filter((s) => s.kind === 'numeric').map((s) => (
          `<tr><td>${escapeHtml(s.variable)}</td><td class="num">${s.n ?? ''}</td><td class="num">${fmtHtml(s.mean)}</td><td class="num">${fmtHtml(s.std)}</td><td class="num">${fmtHtml(s.min)}</td><td class="num">${fmtHtml(s.max)}</td></tr>`
        )).join('')
      }</tbody></table>`
    : ''
  const histogramImgs = sec.title === 'Descriptive insights' && charts.histograms
    ? Object.entries(charts.histograms).map(([variable, src]) => (
        `<img class="chart-img" src="${src}" alt="Distribution of ${escapeHtml(variable)}" /><p class="chart-caption">Distribution of ${escapeHtml(variable)}</p>`
      )).join('')
    : ''
  const items = sec.items && sec.title === 'Model performance'
    ? modelTableHtml(sec.items) + (sec.items || []).map((it, j) => (
        charts.influences && charts.influences[j]
          ? `<img class="chart-img" src="${charts.influences[j]}" alt="Feature influence for ${escapeHtml(it.name || it.algorithm || '')}" /><p class="chart-caption">Feature influence - ${escapeHtml(it.name || it.algorithm || '')}${it.target ? ` (target: ${escapeHtml(it.target)})` : ''}</p>`
          : ''
      )).join('')
    : sec.items
    ? sec.items.map((it, j) => {
        const scatterImg = charts.scatters && charts.scatters[`${index}-${j}`]
          ? `<img class="chart-img" src="${charts.scatters[`${index}-${j}`]}" alt="Scatter plot" /><p class="chart-caption">Relationship scatter</p>`
          : ''
        return `<div class="entry">${
          it.created_at ? `<span class="stamp">${escapeHtml(new Date(it.created_at).toLocaleString())}</span>` : ''
        }${it.kind ? `<strong>${escapeHtml(it.kind)}</strong>: ` : ''}${
          escapeHtml(it.summary || it.result?.interpretation || formatInline(it.metrics) || JSON.stringify(it.result || it.metrics || it.detail || {}).slice(0, 180))
        }${influenceHtml(it.feature_influence)}${notesHtml(it.detail?.notes)}${mappingHtml(it.detail?.mapping)}</div>${scatterImg}`
      }).join('')
    : ''
  const sectionClass = sec.title.startsWith('Appendix') ? 'appendix' : ''
  return `<section class="${sectionClass}"><h2>${escapeHtml(sec.title)}</h2>${body}${stats}${histogramImgs}${items}</section>`
}

// Builds the HTML table summarizing model algorithm, target, task, metric, and top factors.
function modelTableHtml(items) {
  if (!items?.length) return ''
  return `<table class="model-table"><thead><tr><th>Model</th><th>Target</th><th>Task</th><th class="num">Primary metric</th><th>Notes</th></tr></thead><tbody>${
    items.map((it) => {
      const metrics = it.metrics || {}
      const primary = metrics.task === 'classification'
        ? `Accuracy ${pctHtml(metrics.accuracy)}${metrics.auc != null ? `, AUC ${fmtHtml(metrics.auc)}` : ''}`
        : `R2 ${fmtHtml(metrics.r2)}, RMSE ${fmtHtml(metrics.rmse)}`
      const influence = normalizeInfluence(it.feature_influence).slice(0, 3).map((x) => x.feature).filter(Boolean).join(', ')
      return `<tr><td><strong>${escapeHtml(it.algorithm || it.name)}</strong></td><td>${escapeHtml(it.target || '')}</td><td>${escapeHtml(metrics.task || '')}</td><td class="num">${escapeHtml(primary)}</td><td>${influence ? `Top factors: ${escapeHtml(influence)}` : '<span class="muted">No influence summary</span>'}</td></tr>`
    }).join('')
  }</tbody></table>`
}

// Returns HTML for a notes block listing each note text inside a labeled container.
function notesHtml(notes) {
  if (!notes?.length) return ''
  return `<div class="note"><strong>Notes:</strong>${notes.map((n) => `<div>${escapeHtml(n.text)}</div>`).join('')}</div>`
}

// Returns collapsible HTML listing category mapping pairs from original to recoded values.
function mappingHtml(mapping) {
  if (!mapping) return ''
  return `<details style="margin-top:6px;"><summary>Category mapping</summary><ul>${
    Object.entries(mapping).map(([from, to]) => `<li>${escapeHtml(from)} to ${escapeHtml(to)}</li>`).join('')
  }</ul></details>`
}

// Returns HTML listing the top feature influence names for an analysis item.
function influenceHtml(value) {
  const influence = normalizeInfluence(value)
  if (!influence.length) return ''
  return `<div class="note"><span class="label">Feature influence</span><br />${escapeHtml(influence.slice(0, 5).map((x) => x.feature).join(', '))}</div>`
}

// Normalizes feature influence into an array of feature/strength objects from any input shape.
function normalizeInfluence(value) {
  if (Array.isArray(value)) return value
  if (!value || typeof value !== 'object') return []
  return Object.entries(value).map(([feature, strength]) => ({ feature, strength }))
}

// Returns a numeric value formatted to three decimals or empty string for non-numbers.
function fmtHtml(v) {
  return typeof v === 'number' ? v.toFixed(3) : ''
}

// Returns a numeric value formatted as a one-decimal percentage or empty string.
function pctHtml(v) {
  return typeof v === 'number' ? `${(v * 100).toFixed(1)}%` : ''
}

// Escapes HTML-sensitive characters in a string so it can be safely embedded into markup.
function escapeHtml(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;')
}

// Renders a Chart.js config off-screen and returns a base64 PNG data URL of the chart.
function renderChartToDataUrl(config, width = 720, height = 420) {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  // Render off-screen so it never flashes in the UI
  canvas.style.position = 'fixed'
  canvas.style.left = '-99999px'
  canvas.style.top = '0'
  document.body.appendChild(canvas)
  let url = ''
  let chart
  try {
    chart = new Chart(canvas, {
      ...config,
      options: {
        ...(config.options || {}),
        responsive: false,
        animation: false,
        devicePixelRatio: 2,
      },
    })
    url = chart.toBase64Image('image/png', 1.0)
  } catch (err) {
    console.warn('Chart render failed', err)
  } finally {
    if (chart) chart.destroy()
    canvas.remove()
  }
  return url
}

// Generates data-URL chart images for histograms, scatter plots, and feature influence bars.
function renderChartImages(report) {
  const out = { histograms: {}, scatters: {}, influences: {} }
  if (!report || !Array.isArray(report.sections)) return out

  report.sections.forEach((sec, secIdx) => {
    if (sec.title === 'Descriptive insights' && sec.data?.histograms) {
      const entries = Object.entries(sec.data.histograms).slice(0, 4)
      entries.forEach(([variable, hist]) => {
        if (!hist?.bins?.length || !hist?.counts?.length) return
        const labels = hist.bins.slice(0, -1).map((b, i) => {
          const next = hist.bins[i + 1]
          return `${fmtNum(b)}-${fmtNum(next)}`
        })
        const url = renderChartToDataUrl({
          type: 'bar',
          data: {
            labels,
            datasets: [{ label: variable, data: hist.counts, backgroundColor: '#7F77DD', borderRadius: 2 }],
          },
          options: {
            plugins: { legend: { display: false }, title: { display: true, text: `Distribution of ${variable}`, font: { size: 14 } } },
            scales: {
              y: { beginAtZero: true, ticks: { font: { size: 10 } } },
              x: { ticks: { font: { size: 9 }, maxRotation: 45, minRotation: 45 } },
            },
          },
        })
        if (url) out.histograms[variable] = url
      })
    }

    if (Array.isArray(sec.items) && sec.title !== 'Model performance' && sec.title !== 'Appendix: Project actions') {
      sec.items.forEach((it, j) => {
        const result = it.result || {}
        const points = Array.isArray(result.scatter_points) ? result.scatter_points : null
        const vars = Array.isArray(result.variables) ? result.variables : []
        if (!points || vars.length !== 2) return
        const chartPoints = points
          .map(([x, y]) => ({ x: Number(x), y: Number(y) }))
          .filter((p) => Number.isFinite(p.x) && Number.isFinite(p.y))
        if (!chartPoints.length) return
        const xs = chartPoints.map((p) => p.x)
        const ys = chartPoints.map((p) => p.y)
        const xMean = avgArr(xs)
        const yMean = avgArr(ys)
        const denom = xs.reduce((s, x) => s + ((x - xMean) ** 2), 0) || 1
        const slope = xs.reduce((s, x, i) => s + ((x - xMean) * (ys[i] - yMean)), 0) / denom
        const intercept = yMean - slope * xMean
        const minX = Math.min(...xs)
        const maxX = Math.max(...xs)
        const trend = [{ x: minX, y: intercept + slope * minX }, { x: maxX, y: intercept + slope * maxX }]
        const url = renderChartToDataUrl({
          type: 'scatter',
          data: {
            datasets: [
              { label: 'Rows', data: chartPoints, backgroundColor: 'rgba(249,115,22,0.55)', pointRadius: 3 },
              { label: 'Trend', data: trend, type: 'line', borderColor: '#111827', borderWidth: 2, pointRadius: 0, showLine: true, fill: false },
            ],
          },
          options: {
            plugins: { legend: { display: false }, title: { display: true, text: `${vars[0]} vs ${vars[1]}`, font: { size: 14 } } },
            scales: {
              x: { title: { display: true, text: vars[0] }, ticks: { font: { size: 10 } } },
              y: { title: { display: true, text: vars[1] }, ticks: { font: { size: 10 } } },
            },
          },
        })
        if (url) out.scatters[`${secIdx}-${j}`] = url
      })
    }

    if (sec.title === 'Model performance' && Array.isArray(sec.items)) {
      sec.items.forEach((it, j) => {
        const influence = normalizeInfluence(it.feature_influence)
          .map((x) => ({ feature: x.feature, value: Math.abs(Number(x.strength) || 0) }))
          .filter((x) => x.feature && Number.isFinite(x.value))
          .sort((a, b) => b.value - a.value)
          .slice(0, 8)
        if (!influence.length) return
        const url = renderChartToDataUrl({
          type: 'bar',
          data: {
            labels: influence.map((x) => x.feature),
            datasets: [{ label: 'Influence', data: influence.map((x) => x.value), backgroundColor: '#0ea5e9', borderRadius: 2 }],
          },
          options: {
            indexAxis: 'y',
            plugins: { legend: { display: false }, title: { display: true, text: `Feature influence - ${it.name || it.algorithm || ''}`, font: { size: 14 } } },
            scales: {
              x: { beginAtZero: true, ticks: { font: { size: 10 } } },
              y: { ticks: { font: { size: 10 } } },
            },
          },
        }, 720, Math.max(260, 28 * influence.length + 80))
        if (url) out.influences[j] = url
      })
    }
  })
  return out
}

// Returns the arithmetic mean of an array, or zero when the array is empty.
function avgArr(arr) {
  if (!arr.length) return 0
  return arr.reduce((sum, v) => sum + v, 0) / arr.length
}

// Formats a finite number with adaptive decimal precision for histogram bin labels.
function fmtNum(v) {
  if (typeof v !== 'number' || !Number.isFinite(v)) return ''
  if (Math.abs(v) >= 100) return v.toFixed(0)
  if (Math.abs(v) >= 10) return v.toFixed(1)
  return v.toFixed(2)
}
