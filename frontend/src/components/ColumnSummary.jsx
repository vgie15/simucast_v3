/* ============================================================
 * COMPONENT: COLUMN SUMMARY
 * Keywords: column, summary, stats
 * ============================================================ */
import React, { useMemo } from 'react'

// Cell component rendering a compact summary of a column based on its dtype.
export default function ColumnSummary({ variable, rows }) {
  const dtype = variable?.dtype
  const name = variable?.name
  const values = useMemo(() => {
    if (!rows?.length || !name) return []
    return rows
      .map((r) => r[name])
      .filter((v) => v !== null && v !== undefined && v !== '')
  }, [rows, name])

  if (dtype === 'numeric' || dtype === 'int' || dtype === 'float') {
    const nums = values.map((v) => Number(v)).filter((n) => Number.isFinite(n))
    if (!nums.length) return <EmptyCell />
    return <NumericMiniHistogram nums={nums} />
  }

  if (dtype === 'binary') {
    return <CategoryBars values={values} maxRows={2} />
  }

  if (dtype === 'category') {
    return <CategoryBars values={values} maxRows={2} />
  }

  // text / id / datetime / fallback
  const unique = new Set(values).size
  return (
    <div className="ax-cs-meta">
      <span>{unique.toLocaleString()} unique</span>
    </div>
  )
}

// Renders a placeholder dash when a column has no displayable values.
function EmptyCell() {
  return <div className="ax-cs-meta">—</div>
}

// Renders a tiny SVG histogram summarising the distribution of numeric values.
function NumericMiniHistogram({ nums, bins = 10 }) {
  const min = Math.min(...nums)
  const max = Math.max(...nums)
  const range = max - min || 1
  const counts = new Array(bins).fill(0)
  for (const n of nums) {
    const idx = Math.min(bins - 1, Math.floor(((n - min) / range) * bins))
    counts[idx]++
  }
  const peak = Math.max(...counts) || 1
  const bw = 100 / bins
  const total = nums.length
  return (
    <div className="ax-cs-numeric">
      <svg className="ax-cs-hist" viewBox="0 0 100 30" preserveAspectRatio="none">
        {counts.map((c, i) => {
          const h = (c / peak) * 28
          const lo = min + (range * i) / bins
          const hi = min + (range * (i + 1)) / bins
          const pct = total ? Math.round((c / total) * 100) : 0
          return (
            <rect
              key={i}
              x={i * bw + 0.4}
              y={30 - h}
              width={bw - 0.8}
              height={h}
              fill="currentColor"
            >
              <title>{`${formatNumber(lo)}–${formatNumber(hi)}: ${c.toLocaleString()} (${pct}%)`}</title>
            </rect>
          )
        })}
      </svg>
      <div className="ax-cs-numeric-axis">
        <span>{formatNumber(min)}</span>
        <span>{formatNumber(max)}</span>
      </div>
    </div>
  )
}

// Renders the top categorical values with their relative percentage shares.
function CategoryBars({ values, maxRows = 2 }) {
  const counts = new Map()
  for (const v of values) {
    const key = String(v)
    counts.set(key, (counts.get(key) || 0) + 1)
  }
  const total = values.length || 1
  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1]).slice(0, maxRows)
  if (!sorted.length) return <EmptyCell />
  return (
    <div className="ax-cs-cats">
      {sorted.map(([key, count]) => {
        const pct = Math.round((count / total) * 100)
        return (
          <div
            key={key}
            className="ax-cs-cat-row"
            title={`${key}: ${count.toLocaleString()} (${pct}%)`}
          >
            <span className="ax-cs-cat-label">{key}</span>
            <span className="ax-cs-cat-pct">{pct}%</span>
          </div>
        )
      })}
    </div>
  )
}

// Formats a number compactly, using grouping for large values and fixed decimals otherwise.
function formatNumber(n) {
  if (!Number.isFinite(n)) return ''
  if (Math.abs(n) >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 })
  if (Number.isInteger(n)) return String(n)
  return n.toFixed(2)
}
