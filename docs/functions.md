# CandleEdge Functions Documentation

## 📊 Statistical Engine Functions

---

### `StatsEngine.computePatternStats(patternId, candles, lookbacks)`

**Purpose:**  
Calculates historical performance statistics for a specific pattern across the candle dataset.

### Inputs

- `patternId` *(string)* — Pattern identifier like `"ascending_triangle"` or `"doji"`
- `candles` *(array)* — Array of OHLCV candle objects
- `lookbacks` *(array, optional)* — Forward windows to analyze  
  Defaults to:

```javascript
[3, 5, 10, 20]
```

### Output

```javascript
{
  forwardBars: number,
  bullishProb: number,
  bearishProb: number,
  avgMovePct: number,
  medianMovePct: number,
  sampleSize: number,
  bias: string,
  confidence: string,
  decisionText: string,
  weightedScore: number
}
```

### Important Logic

- Uses caching via:

```javascript
`${patternId}_${candleCount}_${lastCandleTime}`
```

- Uses dataset signature caching
- Uses occurrence caching
- Skips occurrences without enough future candles
- Selects the strongest forward window using weighted scoring:
  - Directional strength → 50%
  - Magnitude → 30%
  - Sample reliability → 20%

### Why It Exists

Provides deterministic and reproducible statistics without machine learning or hidden server-side logic.

---

# 📈 Pattern Detection Functions

---

### `detectPatternsAtCandle(candles, idx)`

**Purpose:**  
Identifies all candlestick and chart patterns that complete at a specific candle index.

### Inputs

- `candles` *(array)* — Full OHLCV candle array
- `idx` *(integer)* — Candle index to inspect

### Output

```javascript
{
  id: string,
  name: string,
  icon: string,
  type: string,
  bias: string,
  status: string,
  anchors?: object
}
```

### Important Logic

- Candlestick patterns are checked first
- Chart patterns evaluate after 40 candles
- Chart patterns analyze up to 200 previous candles
- Complex patterns search multiple peak/trough combinations
- Uses confirmation windows for recently completed structures
- Optional debug logging can be enabled
- Pattern detectors return `null` if criteria are not met

### Why It Exists

Centralizes all pattern detection logic into one reusable function.

---

### `isRecentlyConfirmed(point, currentIdx, maxBarsAgo)`

**Purpose:**  
Checks whether a pattern anchor point occurred recently enough to count as confirmed.

### Inputs

- `point` *(object)* — Point containing `.index`
- `currentIdx` *(integer)* — Current candle index
- `maxBarsAgo` *(integer, optional)* — Maximum candles ago

### Output

```javascript
true | false
```

### Why It Exists

Allows patterns to remain visible shortly after formation instead of appearing only on one exact candle.

---

### `debugLog(message, data)`

**Purpose:**  
Optional debug logging helper for pattern detection analysis.

### Important Logic

Debugging is controlled using:

```javascript
ENABLE_DEBUG = true
```

### Why It Exists

Helps troubleshoot why certain structures are or are not detected.

---

### `findSwingPoints(candles, windowSize)`

**Purpose:**  
Finds swing highs and swing lows inside candle data.

### Inputs

- `candles` *(array)* — Candle dataset
- `windowSize` *(integer, optional)* — Local comparison range

### Output

```javascript
{
  highs: [{ index, price, time }],
  lows: [{ index, price, time }]
}
```

### Important Logic

- Swing highs must exceed surrounding highs
- Swing lows must fall below surrounding lows
- Uses strict inequality to avoid flat-zone detection

### Why It Exists

Provides the geometric anchor points used for chart pattern detection.

---

### `findLocalExtrema(candles, lookback)`

**Purpose:**  
Finds broader local peaks and troughs used for complex structure analysis.

### Important Logic

Used by:

- Double Tops
- Triple Bottoms
- Head and Shoulders
- Cup and Handle

### Why It Exists

Provides cleaner extrema detection for multi-point structures.

---

# 📐 Chart Pattern Detectors

---

### Included Detectors

- `detectAscendingTriangle`
- `detectDescendingTriangle`
- `detectSymmetricalTriangle`
- `detectRisingWedge`
- `detectFallingWedge`
- `detectBullishPennant`
- `detectBearishPennant`
- `detectBullFlag`
- `detectBearFlag`
- `detectRectangleRange`
- `detectRisingChannel`
- `detectFallingChannel`
- `detectDoubleTop`
- `detectDoubleBottom`
- `detectTripleTop`
- `detectTripleBottom`
- `detectCupAndHandle`
- `detectHeadAndShoulders`
- `detectInverseHeadAndShoulders`
- `detectBOSBullish`
- `detectBOSBearish`
- `detectLiquiditySweepHigh`
- `detectLiquiditySweepLow`
- `detectHigherHigh`
- `detectHigherLow`
- `detectLowerHigh`
- `detectLowerLow`
- `detectSupportBounce`
- `detectResistanceRejection`

### Inputs

- `highs` *(array)* — Swing highs
- `lows` *(array)* — Swing lows

### Output

Returns:

```javascript
{
  name,
  icon,
  bias,
  upper1,
  upper2,
  lower1,
  lower2
}
```

Or returns:

```javascript
null
```

if no valid structure is detected.

### Why They Exist

Each chart structure uses different geometric conditions. Keeping detectors separate improves maintainability and extensibility.

---

# 🧪 Validation Helpers

---

### `hasValidPullbackBetweenPeaks(candles, peak1Idx, peak2Idx)`

**Purpose:**  
Validates that there is a meaningful pullback between two peaks.

### Important Logic

- Requires at least 1% retracement
- Prevents false Double Top and Triple Top detections

### Why It Exists

Ensures patterns contain meaningful price structure instead of consecutive swing highs.

---

### `hasValidBounceBetweenTroughs(candles, trough1Idx, trough2Idx)`

**Purpose:**  
Validates that there is a meaningful bounce between two troughs.

### Important Logic

- Requires at least 1% recovery
- Prevents false Double Bottom and Triple Bottom detections

### Why It Exists

Ensures patterns contain meaningful price recovery instead of consecutive swing lows.

---

# ⚙️ Data Processing Functions

---

### `resampleCandles(candles, tf)`

**Purpose:**  
Aggregates candle data into larger timeframes.

### Supported Timeframes

- `1m`
- `5m`
- `15m`
- `1h`
- `1d`

### Important Logic

- Groups candles by timeframe bucket
- Uses:
  - first open
  - highest high
  - lowest low
  - last close
  - summed volume

### Why It Exists

Allows the same dataset to be analyzed across multiple resolutions.

---

### `calculateMA(data, period)`

**Purpose:**  
Calculates Simple Moving Average values.

### Inputs

- `data` *(array)* — Candle or value dataset
- `period` *(integer)* — SMA period

### Output

```javascript
[
  { time, value }
]
```

### Important Logic

- No forward filling
- Uses arithmetic mean only

### Why It Exists

Provides trend overlays and market context.

---

# 🖥️ UI & Chart Functions

---

### `updateChart()`

**Purpose:**  
Refreshes chart data and re-runs pattern scanning.

### Important Logic

- Resamples candles
- Updates:
  - candlestick series
  - MA20
  - MA50
- Triggers:

```javascript
scanAllPatterns()
```

### Why It Exists

Centralizes chart refresh logic.

---

### `scanAllPatterns()`

**Purpose:**  
Scans all candles, computes statistics, and organizes patterns into categories.

### Pattern Categories

- Current → last 20 candles
- Recent → last 100 candles
- Historical → older than 100 candles

### Important Logic

- Attaches statistical results to patterns
- Selects strongest statistical edge
- Avoids redundant calculations through caching

### Why It Exists

Separates analysis logic from rendering logic.

---

### `drawStructureOnChart(pattern)`

**Purpose:**  
Draws pattern geometry on the interactive chart.

### Important Logic

#### Candlestick Patterns

- Draws directional marker

#### Chart Patterns

- Draws:
  - upper trendline
  - lower trendline
  - neckline lines
  - anchor markers
  - BOS markers
  - liquidity sweep markers
  - support/resistance markers

### Why It Exists

Provides visual structure confirmation directly on the chart.

---

### `focusChartAroundPattern(pattern)`

**Purpose:**  
Zooms and pans chart view around a selected structure.

### Important Logic

- Adds 20-candle padding
- Includes all anchor points in visible range

### Why It Exists

Improves usability and structure inspection.

---

# 📂 Data Source Functions

---

### `loadCSVFile(e)`

**Purpose:**  
Imports CSV market data and converts it into CandleEdge OHLCV format.

### Supported Columns

```txt
DATE, OPEN, HIGH, LOW, CLOSE, ADJ CLOSE, VOLUME
```

### Important Logic

- Supports:
  - quoted headers
  - lowercase/uppercase headers
  - timestamps
  - human-readable dates
- Falls back to `ADJ CLOSE`
- Filters invalid rows
- Requires minimum 50 candles
- Sorts chronologically

### Why It Exists

Allows users to analyze their own historical market data.

---

### `fetchCoinbaseCandles()`

**Purpose:**  
Fetches historical crypto candles from Coinbase.

### Important Logic

- Uses Coinbase REST API
- Uses 15-minute granularity
- Converts Coinbase format into CandleEdge format

### Why It Exists

Provides live crypto analysis without requiring API keys.

---

# 📊 Chart Initialization

---

### `initChart()`

**Purpose:**  
Creates and configures the Lightweight Charts instance.

### Important Logic

- Creates:
  - candlestick series
  - MA20
  - MA50
- Applies:
  - dark theme
  - responsive resizing
  - custom chart colors

### Why It Exists

Centralizes chart configuration and initialization.

---

# 🔄 Overall Data Flow

---

## 1. Data Loading

Data enters through:

- CSV import
- Demo generator
- Coinbase fetch

↓

## 2. Resampling

```javascript
resampleCandles()
```

converts data into the selected timeframe.

↓

## 3. Chart Rendering

Resampled candles are sent to Lightweight Charts.

↓

## 4. Pattern Detection

```javascript
detectPatternsAtCandle()
```

runs across the dataset.

↓

## 4b. Pattern Combination Search

Complex structures such as Double Tops, Triple Bottoms, Head and Shoulders, and Cup and Handle search multiple recent peak/trough combinations and select the strongest valid match.

↓

## 4c. Confirmation Windows

Patterns remain valid for a configurable number of candles after formation, usually 15–25 candles.

↓

## 5. Statistical Analysis

```javascript
StatsEngine.computePatternStats()
```

calculates probabilities and edge metrics.

↓

## 6. UI Organization

Patterns are grouped into:

- Current
- Recent
- Historical

↓

## 7. User Interaction

Selecting a pattern triggers:

- chart drawing
- trendlines
- zoom focus

↓

## 8. Timeframe Changes

Changing timeframe:

- clears drawings
- resamples candles
- rescans patterns
- redraws chart

---

# 🧠 Design Philosophy

CandleEdge intentionally avoids:

- AI-generated predictions
- hidden server-side calculations
- opaque scoring systems
- black-box analytics

The project focuses on:

- transparency
- deterministic analysis
- reproducibility
- local-first computation
- educational statistical exploration

All calculations occur directly in the browser using the user's loaded dataset.
