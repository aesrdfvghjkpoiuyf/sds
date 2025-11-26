"use client"

import { useState, useEffect, useCallback, useRef } from "react"
import jsPDF from "jspdf"

const BLUE = "#262A42"
const GREEN = "#61D48A"
const API_KEY = "f1a1d4ea-2999-46e2-94a8-c77be61ee709"
const API_URL = "https://mfapi.advisorkhoj.com/calc/getFutureValueCalcResult"

const MIN_REQUEST_INTERVAL = 1000
const DEBOUNCE_DELAY = 500
const CACHE_DURATION = 10 * 60 * 1000
const MAX_CACHE_SIZE = 100

interface CalculationResult {
  current_cost: number
  inflation_rate: number
  no_years: number
  future_amount: number
}

interface CacheEntry {
  result: CalculationResult
  timestamp: number
  hitCount: number
}

export default function FutureValueCalculator() {
  const [currentCost, setCurrentCost] = useState(2500000)
  const [inflationRate, setInflationRate] = useState(6)
  const [years, setYears] = useState(10)
  const [result, setResult] = useState<CalculationResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [mounted, setMounted] = useState(false)

  const cacheRef = useRef<Map<string, CacheEntry>>(new Map())
  const debounceTimerRef = useRef<NodeJS.Timeout | null>(null)
  const lastRequestTimeRef = useRef<number>(0)
  const requestQueueRef = useRef<boolean>(false)
  const pendingRequestRef = useRef<boolean>(false)

  const getCacheKey = useCallback((cost: number, rate: number, yrs: number) => `${cost}-${rate}-${yrs}`, [])

  const isCacheValid = useCallback((timestamp: number) => {
    return Date.now() - timestamp < CACHE_DURATION
  }, [])

  const fetchCalculation = useCallback(
    async (cost: number, rate: number, yrs: number) => {
      if (pendingRequestRef.current) {
        return
      }

      const cacheKey = getCacheKey(cost, rate, yrs)
      const cached = cacheRef.current.get(cacheKey)
      if (cached && isCacheValid(cached.timestamp)) {
        cached.hitCount++
        setResult(cached.result)
        setError(null)
        setLoading(false)
        return
      }

      const now = Date.now()
      const timeSinceLastRequest = now - lastRequestTimeRef.current

      if (timeSinceLastRequest < MIN_REQUEST_INTERVAL) {
        requestQueueRef.current = true
        return
      }

      pendingRequestRef.current = true
      setLoading(true)
      setError(null)

      try {
        const params = new URLSearchParams({
          key: API_KEY,
          current_cost: Math.floor(cost).toString(),
          inflation_rate: rate.toString(),
          no_years: Math.floor(yrs).toString(),
        })

        const response = await fetch(`${API_URL}?${params}`, {
          method: "GET",
          headers: {
            Accept: "application/json",
          },
        })

        const data = await response.json()

        if (response.status === 429 || data.status === 429) {
          setError("Rate limit exceeded. Please wait before making another request.")
          pendingRequestRef.current = false
          setLoading(false)
          return
        }

        if (!response.ok || (data.status && data.status !== 200)) {
          throw new Error(data.status_msg || "Failed to calculate future value")
        }

        const calculationResult: CalculationResult = {
          current_cost: data.current_cost || cost,
          inflation_rate: data.inflation_rate || rate,
          no_years: data.no_years || yrs,
          future_amount: data.future_amount || 0,
        }

        cacheRef.current.set(cacheKey, {
          result: calculationResult,
          timestamp: Date.now(),
          hitCount: 1,
        })

        if (cacheRef.current.size > MAX_CACHE_SIZE) {
          let oldestKey: string | null = null
          let oldestTime = Date.now()

          for (const [key, entry] of cacheRef.current.entries()) {
            if (entry.timestamp < oldestTime) {
              oldestTime = entry.timestamp
              oldestKey = key
            }
          }

          if (oldestKey) {
            cacheRef.current.delete(oldestKey)
          }
        }

        setResult(calculationResult)
        lastRequestTimeRef.current = Date.now()
        setLoading(false)
      } catch (err) {
        const errorMessage = err instanceof Error ? err.message : "An error occurred"
        setError(errorMessage)
        setLoading(false)
      } finally {
        pendingRequestRef.current = false

        if (requestQueueRef.current) {
          requestQueueRef.current = false
          const retryTime = MIN_REQUEST_INTERVAL - (Date.now() - lastRequestTimeRef.current)
          if (retryTime > 0) {
            setTimeout(() => {
              fetchCalculation(currentCost, inflationRate, years)
            }, retryTime)
          }
        }
      }
    },
    [getCacheKey, isCacheValid, currentCost, inflationRate, years],
  )

  useEffect(() => {
    setMounted(true)
  }, [])

  useEffect(() => {
    if (mounted) {
      fetchCalculation(currentCost, inflationRate, years)
    }
  }, [mounted, fetchCalculation])

  useEffect(() => {
    if (!mounted) return

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current)
    }

    debounceTimerRef.current = setTimeout(() => {
      fetchCalculation(currentCost, inflationRate, years)
    }, DEBOUNCE_DELAY)

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current)
      }
    }
  }, [currentCost, inflationRate, years, mounted, fetchCalculation])

  const formatCurrency = (value: number) => {
    return new Intl.NumberFormat("en-IN", {
      style: "currency",
      currency: "INR",
      minimumFractionDigits: 0,
      maximumFractionDigits: 0,
    }).format(value)
  }

  const chartPercentage = result ? (result.current_cost / (result.current_cost + result.future_amount)) * 100 : 50

  const generatePiePaths = () => {
    const percentage = chartPercentage
    const startAngle = (-90 * Math.PI) / 180
    const endAngle = startAngle + (percentage / 100) * 2 * Math.PI

    const x1 = 100 + 80 * Math.cos(startAngle)
    const y1 = 100 + 80 * Math.sin(startAngle)
    const x2 = 100 + 80 * Math.cos(endAngle)
    const y2 = 100 + 80 * Math.sin(endAngle)

    const largeArc = percentage > 50 ? 1 : 0

    const bluePath = `M 100 100 L ${x1} ${y1} A 80 80 0 ${largeArc} 1 ${x2} ${y2} Z`
    const greenStart = endAngle
    const greenEnd = greenStart + ((100 - percentage) / 100) * 2 * Math.PI
    const x3 = 100 + 80 * Math.cos(greenEnd)
    const y3 = 100 + 80 * Math.sin(greenEnd)
    const greenLargeArc = 100 - percentage > 50 ? 1 : 0
    const greenPath = `M 100 100 L ${x2} ${y2} A 80 80 0 ${greenLargeArc} 1 ${x3} ${y3} Z`

    return { bluePath, greenPath }
  }

  const downloadPDF = () => {
    if (!result) return

    try {
      const doc = new jsPDF()
      const pageWidth = doc.internal.pageSize.getWidth()
      const pageHeight = doc.internal.pageSize.getHeight()

      doc.setFontSize(11)
      doc.setFont("helvetica", "bold")
      doc.setTextColor(100, 116, 139)
      doc.text("Fiscus Grow", 20, 15)

      doc.setFontSize(18)
      doc.setFont("helvetica", "bold")
      doc.setTextColor(30, 41, 59)
      doc.text("Future Value Inflation Calculator", 20, 25)

      let yPos = 40

      // Input Values Section Header
      doc.setFontSize(12)
      doc.setFont("helvetica", "bold")
      doc.setTextColor(30, 41, 59)
      doc.text("Your Input Values", 20, yPos)
      yPos += 8

      // Input table
      const inputData = [
        ["Name", "Value"],
        ["Current Cost", formatCurrency(currentCost)],
        ["Inflation (% per annum)", `${inflationRate} %`],
        ["Number of Years", `${years} Years`],
      ]

      doc.setFontSize(10)
      const colWidths = [(pageWidth - 40) / 2, (pageWidth - 40) / 2]
      const rowHeight = 7
      let tableY = yPos

      doc.setDrawColor(0, 0, 0)
      doc.setLineWidth(0.5)

      // Header row
      doc.setFont("helvetica", "bold")
      let xPos = 20
      for (let i = 0; i < inputData[0].length; i++) {
        doc.setFillColor(200, 200, 200)
        doc.rect(xPos, tableY, colWidths[i], rowHeight, "FD")
        xPos += colWidths[i]
      }
      tableY += rowHeight

      // Data rows
      doc.setFont("helvetica", "normal")
      for (let row = 1; row < inputData.length; row++) {
        xPos = 20
        for (let col = 0; col < inputData[row].length; col++) {
          doc.setFillColor(255, 255, 255)
          doc.rect(xPos, tableY, colWidths[col], rowHeight, "FD")
          xPos += colWidths[col]
        }
        tableY += rowHeight
      }

      tableY = yPos
      doc.setTextColor(0, 0, 0)
      doc.setFont("helvetica", "bold")
      xPos = 20
      for (let i = 0; i < inputData[0].length; i++) {
        doc.text(inputData[0][i], xPos + 2, tableY + 5.5)
        xPos += colWidths[i]
      }
      tableY += rowHeight

      doc.setFont("helvetica", "normal")
      for (let row = 1; row < inputData.length; row++) {
        xPos = 20
        for (let col = 0; col < inputData[row].length; col++) {
          const cellText = String(inputData[row][col])
            .replace(/^[^a-zA-Z0-9Rs.%\s-]/g, "")
            .trim()
          doc.text(cellText, xPos + 2, tableY + 5.5)
          xPos += colWidths[col]
        }
        tableY += rowHeight
      }

      yPos = tableY + 8

      // Result Section Header
      doc.setFontSize(12)
      doc.setFont("helvetica", "bold")
      doc.setTextColor(30, 41, 59)
      doc.text("Result", 20, yPos)
      yPos += 8

      // Result table
      const resultData = [
        ["Name", "Value"],
        ["Current Cost", formatCurrency(currentCost)],
        ["Inflation (% per annum)", `${inflationRate} %`],
        ["Number of Years", `${years} Years`],
        ["Future Cost", formatCurrency(result.future_amount)],
      ]

      tableY = yPos

      // Header row
      doc.setFont("helvetica", "bold")
      xPos = 20
      for (let i = 0; i < resultData[0].length; i++) {
        doc.setFillColor(200, 200, 200)
        doc.rect(xPos, tableY, colWidths[i], rowHeight, "FD")
        xPos += colWidths[i]
      }
      tableY += rowHeight

      // Data rows
      doc.setFont("helvetica", "normal")
      for (let row = 1; row < resultData.length; row++) {
        xPos = 20
        for (let col = 0; col < resultData[row].length; col++) {
          doc.setFillColor(255, 255, 255)
          doc.rect(xPos, tableY, colWidths[col], rowHeight, "FD")
          xPos += colWidths[col]
        }
        tableY += rowHeight
      }

      tableY = yPos
      doc.setTextColor(0, 0, 0)
      doc.setFont("helvetica", "bold")
      xPos = 20
      for (let i = 0; i < resultData[0].length; i++) {
        doc.text(resultData[0][i], xPos + 2, tableY + 5.5)
        xPos += colWidths[i]
      }
      tableY += rowHeight

      doc.setFont("helvetica", "normal")
      for (let row = 1; row < resultData.length; row++) {
        xPos = 20
        for (let col = 0; col < resultData[row].length; col++) {
          const cellText = String(resultData[row][col])
            .replace(/^[^a-zA-Z0-9Rs.%\s-]/g, "")
            .trim()
          doc.text(cellText, xPos + 2, tableY + 5.5)
          xPos += colWidths[col]
        }
        tableY += rowHeight
      }

      doc.save("future-value-calculator-report.pdf")
    } catch (err) {
      console.error("Error generating PDF:", err)
    }
  }

  const { bluePath, greenPath } = generatePiePaths()

  return (
    <div
      style={{
        backgroundColor: "#f8f9fa",
        padding: "12px",
        minHeight: "100vh",
        fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, sans-serif',
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr",
          gap: "16px",
          maxWidth: "1200px",
          margin: "0 auto",
        }}
        className="responsive-grid"
      >
        {/* LEFT PANEL - Inputs */}
        <div>
          <div
            style={{
              background: "white",
              borderRadius: "8px",
              padding: "16px",
              boxShadow: "0 1px 4px rgba(0, 0, 0, 0.08)",
              border: "1px solid #e5e7eb",
            }}
          >
            {/* Current Cost */}
            <div style={{ marginBottom: "18px" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "8px",
                  flexWrap: "wrap",
                  gap: "8px",
                }}
              >
                <span style={{ fontSize: "12px", color: "#333", fontWeight: "500" }}>Current Cost (₹)</span>
                <input
                  type="number"
                  value={currentCost}
                  onChange={(e) => setCurrentCost(Number(e.target.value))}
                  style={{
                    width: "80px",
                    padding: "4px 8px",
                    border: "1px solid #e5e7eb",
                    borderRadius: "5px",
                    fontSize: "12px",
                    fontWeight: "600",
                    color: "#333",
                    textAlign: "right",
                    background: "#f9fafb",
                  }}
                />
              </div>
              <input
                type="range"
                min="100000"
                max="10000000"
                step="100000"
                value={currentCost}
                onChange={(e) => setCurrentCost(Number(e.target.value))}
                style={{
                  width: "100%",
                  height: "5px",
                  borderRadius: "5px",
                  background: "#e5e7eb",
                  outline: "none",
                  accentColor: BLUE,
                }}
              />
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(5, 1fr)",
                  fontSize: "10px",
                  color: "#888",
                  marginTop: "5px",
                  gap: "2px",
                }}
              >
                <span style={{ textAlign: "left" }}>₹1L</span>
                <span style={{ textAlign: "center" }}>₹2.5C</span>
                <span style={{ textAlign: "center" }}>₹5C</span>
                <span style={{ textAlign: "center" }}>₹7.5C</span>
                <span style={{ textAlign: "right" }}>₹10C</span>
              </div>
            </div>

            {/* Inflation Rate */}
            <div style={{ marginBottom: "18px" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "8px",
                  flexWrap: "wrap",
                  gap: "8px",
                }}
              >
                <span style={{ fontSize: "12px", color: "#333", fontWeight: "500" }}>Inflation (% per annum)</span>
                <input
                  type="number"
                  value={inflationRate}
                  onChange={(e) => setInflationRate(Number(e.target.value))}
                  style={{
                    width: "80px",
                    padding: "4px 8px",
                    border: "1px solid #e5e7eb",
                    borderRadius: "5px",
                    fontSize: "12px",
                    fontWeight: "600",
                    color: "#333",
                    textAlign: "right",
                    background: "#f9fafb",
                  }}
                />
              </div>
              <input
                type="range"
                min="0"
                max="20"
                step="0.5"
                value={inflationRate}
                onChange={(e) => setInflationRate(Number(e.target.value))}
                style={{
                  width: "100%",
                  height: "5px",
                  borderRadius: "5px",
                  background: "#e5e7eb",
                  outline: "none",
                  accentColor: BLUE,
                }}
              />
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(5, 1fr)",
                  fontSize: "10px",
                  color: "#888",
                  marginTop: "5px",
                  gap: "2px",
                }}
              >
                <span style={{ textAlign: "left" }}>0</span>
                <span style={{ textAlign: "center" }}>5</span>
                <span style={{ textAlign: "center" }}>10</span>
                <span style={{ textAlign: "center" }}>15</span>
                <span style={{ textAlign: "right" }}>20</span>
              </div>
            </div>

            {/* Number of Years */}
            <div style={{ marginBottom: "18px" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  marginBottom: "8px",
                  flexWrap: "wrap",
                  gap: "8px",
                }}
              >
                <span style={{ fontSize: "12px", color: "#333", fontWeight: "500" }}>Number of Years</span>
                <input
                  type="number"
                  value={years}
                  onChange={(e) => setYears(Number(e.target.value))}
                  style={{
                    width: "80px",
                    padding: "4px 8px",
                    border: "1px solid #e5e7eb",
                    borderRadius: "5px",
                    fontSize: "12px",
                    fontWeight: "600",
                    color: "#333",
                    textAlign: "right",
                    background: "#f9fafb",
                  }}
                />
              </div>
              <input
                type="range"
                min="1"
                max="30"
                step="1"
                value={years}
                onChange={(e) => setYears(Number(e.target.value))}
                style={{
                  width: "100%",
                  height: "5px",
                  borderRadius: "5px",
                  background: "#e5e7eb",
                  outline: "none",
                  accentColor: BLUE,
                }}
              />
              <div
                style={{
                  display: "grid",
                  gridTemplateColumns: "repeat(5, 1fr)",
                  fontSize: "10px",
                  color: "#888",
                  marginTop: "5px",
                  gap: "2px",
                }}
              >
                <span style={{ textAlign: "left" }}>1</span>
                <span style={{ textAlign: "center" }}>7.5</span>
                <span style={{ textAlign: "center" }}>15</span>
                <span style={{ textAlign: "center" }}>22.5</span>
                <span style={{ textAlign: "right" }}>30</span>
              </div>
            </div>

            {/* Results Summary */}
            <div style={{ marginTop: "18px", paddingTop: "18px", borderTop: "1px solid #e5e7eb" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "8px 0",
                  fontSize: "12px",
                }}
              >
                <span style={{ fontWeight: "500", color: "#333" }}>Invested Amount</span>
                <span style={{ fontWeight: "700", fontSize: "13px" }}>{formatCurrency(currentCost)}</span>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "8px 0",
                  fontSize: "12px",
                }}
              >
                <span style={{ fontWeight: "500", color: "#333" }}>Inflation Cost</span>
                <span style={{ fontWeight: "700", fontSize: "13px" }}>
                  {result ? formatCurrency(result.future_amount - result.current_cost) : "₹0"}
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  alignItems: "center",
                  padding: "8px 0",
                  fontSize: "12px",
                  borderTop: "1px solid #e5e7eb",
                  marginTop: "8px",
                  paddingTop: "12px",
                }}
              >
                <span style={{ fontWeight: "700", color: "#333" }}>Future Value</span>
                <span style={{ fontWeight: "700", fontSize: "15px", color: GREEN }}>
                  {result ? formatCurrency(result.future_amount) : "₹0"}
                </span>
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div
                style={{
                  marginTop: "12px",
                  padding: "10px",
                  backgroundColor: "#fee",
                  border: "1px solid #fcc",
                  borderRadius: "6px",
                  color: "#c33",
                  fontSize: "12px",
                }}
              >
                Error: {error}
              </div>
            )}
          </div>
        </div>

        {/* RIGHT PANEL - Charts */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "1fr",
            gap: "16px",
          }}
        >
          {/* Pie Chart */}
          <div
            style={{
              background: "white",
              borderRadius: "8px",
              padding: "16px",
              boxShadow: "0 1px 4px rgba(0, 0, 0, 0.08)",
              border: "1px solid #e5e7eb",
            }}
          >
            <h3 style={{ marginTop: "0", marginBottom: "12px", fontSize: "14px", fontWeight: "600", color: "#333" }}>
              Future Value Calculator - Pie Chart
            </h3>

            <div style={{ display: "flex", justifyContent: "center", alignItems: "center", minHeight: "280px" }}>
              <svg width="240" height="240" viewBox="0 0 200 200" style={{ maxWidth: "100%", height: "auto" }}>
                <path d={bluePath} fill={BLUE} />
                <path d={greenPath} fill={GREEN} />
              </svg>
            </div>

            <div
              style={{
                display: "flex",
                justifyContent: "center",
                gap: "24px",
                marginTop: "16px",
                flexWrap: "wrap",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <div
                  style={{
                    width: "14px",
                    height: "14px",
                    backgroundColor: BLUE,
                    borderRadius: "2px",
                  }}
                ></div>
                <span style={{ fontSize: "12px", color: "#666" }}>Current Cost</span>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
                <div
                  style={{
                    width: "14px",
                    height: "14px",
                    backgroundColor: GREEN,
                    borderRadius: "2px",
                  }}
                ></div>
                <span style={{ fontSize: "12px", color: "#666" }}>Future Cost</span>
              </div>
            </div>
          </div>

          {/* Summary Card */}
          <div
            style={{
              background: "white",
              borderRadius: "8px",
              padding: "16px",
              boxShadow: "0 1px 4px rgba(0, 0, 0, 0.08)",
              border: "1px solid #e5e7eb",
            }}
          >
            <h3 style={{ marginTop: "0", marginBottom: "12px", fontSize: "14px", fontWeight: "600", color: "#333" }}>
              Summary
            </h3>

            <div style={{ display: "grid", gap: "12px" }}>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  paddingBottom: "10px",
                  borderBottom: "1px solid #e5e7eb",
                }}
              >
                <span style={{ fontSize: "12px", color: "#666" }}>Current Cost</span>
                <span style={{ fontSize: "12px", fontWeight: "600", color: "#333" }}>
                  {formatCurrency(currentCost)}
                </span>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  paddingBottom: "10px",
                  borderBottom: "1px solid #e5e7eb",
                }}
              >
                <span style={{ fontSize: "12px", color: "#666" }}>Inflation Rate</span>
                <span style={{ fontSize: "12px", fontWeight: "600", color: "#333" }}>{inflationRate}%</span>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  paddingBottom: "10px",
                  borderBottom: "1px solid #e5e7eb",
                }}
              >
                <span style={{ fontSize: "12px", color: "#666" }}>Time Period</span>
                <span style={{ fontSize: "12px", fontWeight: "600", color: "#333" }}>{years} Years</span>
              </div>
              <div
                style={{
                  display: "flex",
                  justifyContent: "space-between",
                  paddingTop: "10px",
                  paddingBottom: "10px",
                }}
              >
                <span style={{ fontSize: "13px", fontWeight: "600", color: "#333" }}>Future Value</span>
                <span style={{ fontSize: "15px", fontWeight: "700", color: GREEN }}>
                  {result ? formatCurrency(result.future_amount) : "₹0"}
                </span>
              </div>
            </div>
          </div>

          {/* Download Button Section */}
          <div
            style={{
              background: "white",
              borderRadius: "8px",
              padding: "16px",
              boxShadow: "0 1px 4px rgba(0, 0, 0, 0.08)",
              border: "1px solid #e5e7eb",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "12px",
            }}
          >
            <button
              onClick={downloadPDF}
              disabled={!result}
              style={{
                padding: "10px 20px",
                backgroundColor: result ? BLUE : "#ccc",
                color: "white",
                border: "none",
                borderRadius: "6px",
                fontSize: "13px",
                fontWeight: "600",
                cursor: result ? "pointer" : "not-allowed",
                transition: "background-color 0.2s",
                display: "flex",
                alignItems: "center",
                gap: "8px",
              }}
              onMouseEnter={(e) => {
                if (result) e.currentTarget.style.backgroundColor = "#0d53cb"
              }}
              onMouseLeave={(e) => {
                if (result) e.currentTarget.style.backgroundColor = BLUE
              }}
            >
              <span>📄</span> Download PDF
            </button>
          </div>
        </div>
      </div>

      <style>{`
        @media (max-width: 768px) {
          .responsive-grid {
            grid-template-columns: 1fr !important;
            gap: 12px !important;
          }
        }

        @media (min-width: 769px) {
          .responsive-grid {
            grid-template-columns: 1fr 1fr !important;
            gap: 16px !important;
          }

          .responsive-grid > div:last-child {
            display: grid;
            grid-template-columns: 1fr;
            gap: 16px;
          }
        }

        input[type="number"]::-webkit-outer-spin-button,
        input[type="number"]::-webkit-inner-spin-button {
          -webkit-appearance: none;
          margin: 0;
        }

        input[type="number"] {
          -moz-appearance: textfield;
        }

        input[type="range"] {
          -webkit-appearance: slider-horizontal;
          cursor: pointer;
        }
      `}</style>
    </div>
  )
}
