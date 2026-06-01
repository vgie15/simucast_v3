export function getCohortColor(primaryColor, index, total) {
  if (total <= 1) return primaryColor
  const hex = (primaryColor || '#f97316').replace('#', '')
  if (!/^[0-9a-f]{6}$/i.test(hex)) return primaryColor
  const r = parseInt(hex.substring(0, 2), 16)
  const g = parseInt(hex.substring(2, 4), 16)
  const b = parseInt(hex.substring(4, 6), 16)
  let rNorm = r / 255, gNorm = g / 255, bNorm = b / 255
  let max = Math.max(rNorm, gNorm, bNorm), min = Math.min(rNorm, gNorm, bNorm)
  let h, s, l = (max + min) / 2
  if (max === min) {
    h = s = 0
  } else {
    let d = max - min
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    switch (max) {
      case rNorm: h = (gNorm - bNorm) / d + (gNorm < bNorm ? 6 : 0); break
      case gNorm: h = (bNorm - rNorm) / d + 2; break
      case bNorm: h = (rNorm - gNorm) / d + 4; break
    }
    h /= 6
  }
  h = Math.round(h * 360)
  s = Math.round(s * 100)
  l = Math.round(l * 100)
  const hueShift = Math.round((h + (index * (360 / total))) % 360)
  const lightnessShift = Math.max(25, Math.min(75, l + (index % 2 === 0 ? 5 : -5)))
  return `hsl(${hueShift}, ${s}%, ${lightnessShift}%)`
}

export function prepareChartData(rows, chartType, xAxis, yAxis, groupBy, agg, color) {
  if (!rows || !rows.length || !xAxis) return null

  if (chartType === 'histogram') {
    const vals = rows.map(r => Number(r[xAxis])).filter(Number.isFinite)
    if (!vals.length) return null
    const min = Math.min(...vals)
    const max = Math.max(...vals)
    const binCount = 10
    const step = (max - min) / binCount || 1
    const bins = Array.from({ length: binCount }, (_, i) => ({
      lo: min + i * step,
      hi: min + (i + 1) * step,
      label: `${(min + i * step).toFixed(1)}-${(min + (i + 1) * step).toFixed(1)}`,
      count: 0
    }))
    if (!groupBy) {
      rows.forEach(r => {
        const val = Number(r[xAxis])
        if (Number.isFinite(val)) {
          const binIdx = Math.min(binCount - 1, Math.floor((val - min) / step))
          if (binIdx >= 0 && binIdx < binCount) bins[binIdx].count++
        }
      })
      return { labels: bins.map(b => b.label), datasets: [{ label: xAxis, data: bins.map(b => b.count), backgroundColor: color, borderRadius: 4 }] }
    } else {
      const groups = Array.from(new Set(rows.map(r => String(r[groupBy] ?? 'None'))))
      const datasets = groups.map((grp, idx) => {
        const grpBins = bins.map(b => ({ ...b, count: 0 }))
        rows.filter(r => String(r[groupBy] ?? 'None') === grp).forEach(r => {
          const val = Number(r[xAxis])
          if (Number.isFinite(val)) {
            const binIdx = Math.min(binCount - 1, Math.floor((val - min) / step))
            if (binIdx >= 0 && binIdx < binCount) grpBins[binIdx].count++
          }
        })
        return { label: grp, data: grpBins.map(b => b.count), backgroundColor: getCohortColor(color, idx, groups.length), borderRadius: 4 }
      })
      return { labels: bins.map(b => b.label), datasets }
    }
  }

  if (chartType === 'scatter' || chartType === 'bubble') {
    if (!yAxis) return null
    const points = rows.map(r => ({
      x: Number(r[xAxis]), y: Number(r[yAxis]),
      r: chartType === 'bubble' ? 8 : undefined, row: r
    })).filter(pt => Number.isFinite(pt.x) && Number.isFinite(pt.y))
    if (chartType === 'bubble') {
      const yVals = points.map(pt => Math.abs(pt.y))
      const maxY = Math.max(...yVals, 1)
      points.forEach(pt => { pt.r = Math.max(4, Math.min(25, (Math.abs(pt.y) / maxY) * 20)) })
    }
    if (!groupBy) {
      return { datasets: [{ label: `${xAxis} vs ${yAxis}`, data: points, backgroundColor: color, pointRadius: chartType === 'bubble' ? undefined : 6, pointHoverRadius: chartType === 'bubble' ? undefined : 8 }] }
    } else {
      const groups = Array.from(new Set(rows.map(r => String(r[groupBy] ?? 'None'))))
      const datasets = groups.map((grp, idx) => ({
        label: grp,
        data: points.filter(pt => String(pt.row[groupBy] ?? 'None') === grp),
        backgroundColor: getCohortColor(color, idx, groups.length),
        pointRadius: chartType === 'bubble' ? undefined : 6,
        pointHoverRadius: chartType === 'bubble' ? undefined : 8
      }))
      return { datasets }
    }
  }

  if (!yAxis) return null
  const xVals = Array.from(new Set(rows.map(r => String(r[xAxis] ?? 'None')))).sort()
  const aggregateValue = (groupRows, col, type) => {
    if (type === 'Count') return groupRows.length
    const nums = groupRows.map(r => Number(r[col])).filter(Number.isFinite)
    if (!nums.length) return 0
    if (type === 'Sum') return nums.reduce((a, b) => a + b, 0)
    if (type === 'Mean') return nums.reduce((a, b) => a + b, 0) / nums.length
    if (type === 'Max') return Math.max(...nums)
    return 0
  }
  if (!groupBy) {
    const data = xVals.map(xVal => aggregateValue(rows.filter(r => String(r[xAxis] ?? 'None') === xVal), yAxis, agg))
    const bgColors = chartType === 'pie' ? xVals.map((_, idx) => getCohortColor(color, idx, xVals.length)) : color
    return {
      labels: xVals,
      datasets: [{
        label: yAxis || 'Count', data, backgroundColor: bgColors,
        borderColor: chartType === 'line' || chartType === 'radar' ? color : undefined,
        borderWidth: chartType === 'line' || chartType === 'radar' ? 2 : undefined,
        fill: chartType === 'radar' ? 'origin' : false,
        tension: chartType === 'line' ? 0.25 : undefined,
        borderRadius: chartType === 'bar' || chartType === 'horizontal bar' ? 4 : undefined
      }]
    }
  } else {
    const groups = Array.from(new Set(rows.map(r => String(r[groupBy] ?? 'None'))))
    const datasets = groups.map((grp, idx) => ({
      label: grp,
      data: xVals.map(xVal => aggregateValue(rows.filter(r => String(r[xAxis] ?? 'None') === xVal && String(r[groupBy] ?? 'None') === grp), yAxis, agg)),
      backgroundColor: getCohortColor(color, idx, groups.length),
      borderColor: chartType === 'line' || chartType === 'radar' ? getCohortColor(color, idx, groups.length) : undefined,
      borderWidth: chartType === 'line' || chartType === 'radar' ? 2 : undefined,
      fill: chartType === 'radar' ? 'origin' : false,
      tension: chartType === 'line' ? 0.25 : undefined,
      borderRadius: chartType === 'bar' || chartType === 'horizontal bar' ? 4 : undefined
    }))
    return { labels: xVals, datasets }
  }
}
