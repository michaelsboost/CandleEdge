# CandleEdge Model Notes

## 📘 Purpose

CandleEdge is a client-side market structure analysis tool designed to help traders and analysts understand how specific candlestick and chart patterns historically behaved within their own dataset.

Rather than attempting to predict the future, CandleEdge performs descriptive statistical analysis on historical price data.

The tool explores questions like:

- When this pattern appeared before, what happened next?
- How often did price move higher after 5 candles?
- Did the pattern behave differently after 10 or 20 candles?
- Is there enough historical sample size to trust the statistics?

All calculations are deterministic and reproducible.

No machine learning.  
No hidden server-side scoring.  
No AI-generated trading signals.

Just transparent arithmetic applied directly to the loaded dataset.

---

# 📊 Statistical Engine

## 🧠 Core Principle

The statistical engine is purely descriptive.

It scans backward through historical candle data, identifies every occurrence of a pattern, then measures how price behaved afterward.

The engine does **not**:

- predict future outcomes
- forecast markets
- generate trading advice
- use machine learning

Instead, it measures:

> “What historically happened after this structure appeared in this dataset?”

---

## 📈 Forward Return Calculation

When a pattern appears at candle index `i`, the engine calculates:

```txt
forward_return =
(close[i + window] - close[i]) / close[i] × 100
```

Forward windows tested:

- 3 candles
- 5 candles
- 10 candles
- 20 candles

### Example

If:

- candle 100 closes at `$100`
- candle 105 closes at `$108`

Then:

```txt
forward_return = +8%
```

---

## 📉 Directional Probability

For every pattern and forward window:

### Bullish Count

```txt
forward_return > 0
```

### Bearish Count

```txt
forward_return < 0
```

Probabilities are calculated using:

```txt
bullish_probability =
(bullish_count / total_occurrences) × 100
```

```txt
bearish_probability =
(bearish_count / total_occurrences) × 100
```

---

# 🧪 Sample Size Requirements

The engine requires a minimum of:

```txt
5 historical occurrences
```

before reporting statistics.

This prevents conclusions from being drawn from extremely limited data.

---

## 📊 Confidence Grading

| Sample Size | Confidence |
|---|---|
| 30+ | High |
| 15-29 | Moderate |
| 5-14 | Low |

Confidence grading is based entirely on sample size.

No AI scoring or hidden weighting systems are involved.

---

# ⚖️ Weighted Scoring Model

When multiple forward windows are available, CandleEdge selects the strongest one using a weighted scoring formula.

## Formula

```txt
score =
(direction_strength × 0.5) +
(magnitude_score × 0.3) +
(sample_reliability × 0.2)
```

---

## Components

### Direction Strength

Measures how far probability deviates from random chance (50%).

### Magnitude Score

Measures average move size.

Normalized and capped at:

```txt
8%
```

### Sample Reliability

Measures dataset reliability based on occurrence count.

Normalized against:

```txt
30 occurrences
```

---

## Why This Weighting Exists

The weighting prioritizes:

1. Directional edge
2. Move magnitude
3. Sample reliability

This prevents the engine from overvaluing:

- tiny move sizes
- low sample counts
- statistically weak structures

---

# 🚫 Why CandleEdge Is Descriptive, Not Predictive

The engine intentionally avoids predictive claims because:

---

## 1. Market Conditions Change

A pattern that worked during one regime may fail during another.

Examples:

- bull markets
- bear markets
- high volatility periods
- low liquidity periods

---

## 2. Sample Sizes Are Limited

Even 100 occurrences is relatively small in financial market analysis.

---

## 3. No Causal Mechanism

Patterns do not cause price movement.

They are simply recurring structural behaviors observed in historical data.

---

## 4. Overfitting Risk

Historical structures may only reflect the specific dataset being analyzed.

What worked in one market may fail in another.

---

## Core Philosophy

CandleEdge never says:

> “This pattern will work.”

Instead it says:

> “This pattern historically behaved this way in this dataset.”

---

# 🕯️ Candlestick Pattern Detection

## Included Candlestick Patterns

- Doji
- Bullish Engulfing
- Bearish Engulfing
- Inside Bar
- Hammer
- Shooting Star
- Three White Soldiers
- Three Black Crows

---

## Detection Logic

### Doji

```txt
body ≤ 12% of total range
```

### Hammer

- Small body
- Long lower wick
- Lower wick ≥ 2× body
- Small upper wick

### Engulfing

Second candle fully engulfs the previous candle body.

### Three White Soldiers

Three consecutive bullish candles with progressively higher closes.

---

# 📐 Chart Pattern Detection

## Included Chart Structures

- Ascending Triangle
- Descending Triangle
- Symmetrical Triangle
- Rising Wedge
- Falling Wedge
- Bullish Pennant
- Bearish Pennant

---

## Swing Point Detection

Chart patterns rely on local swing highs and lows.

A candle becomes a swing high when:

```txt
high[i] > surrounding highs
```

A candle becomes a swing low when:

```txt
low[i] < surrounding lows
```

The default comparison window is:

```txt
±3 candles
```

---

## Anchor Points

Chart structures preserve:

- upper1
- upper2
- lower1
- lower2

These anchor points are later used for:

- trendline drawing
- chart visualization
- pattern focus mode

---

# 📂 CSV Import Normalization

## Supported Columns

```txt
DATE
OPEN
HIGH
LOW
CLOSE
ADJ CLOSE
VOLUME
```

---

## Import Processing Pipeline

### 1. Header Cleanup

Headers are:

- trimmed
- lowercased
- quote-stripped

### 2. Date Parsing

Supports:

- Unix timestamps
- human-readable dates

Example:

```txt
May 22, 2026
```

### 3. Numeric Parsing

OHLCV values converted into floating-point numbers.

### 4. CLOSE Fallback

If `CLOSE` is missing:

```txt
ADJ CLOSE
```

is used instead.

### 5. Invalid Row Filtering

Rows with invalid numeric values are removed.

### 6. Chronological Sorting

Candles sorted from oldest → newest.

---

# ⏱️ Timeframe Resampling

CandleEdge supports:

- 1m
- 5m
- 15m
- 1h
- 1d

---

## Aggregation Rules

```txt
open   = first candle open
high   = highest high
low    = lowest low
close  = last candle close
volume = summed volume
```

---

## Time Bucketing

Candles are grouped using:

```txt
floor(timestamp / timeframe_seconds)
```

This ensures deterministic aggregation.

---

# 🖥️ Client-Side Architecture

CandleEdge runs entirely inside the browser.

No backend server is required.

---

## Why Client-Side?

### Privacy

Your data never leaves your machine.

### Transparency

All calculations are visible in the source code.

### Simplicity

No:

- accounts
- API keys
- cloud infrastructure
- deployments

### Cost Efficiency

No ongoing server expenses.

---

# 🌐 External Requests

The application only performs external requests for:

- Alpine.js
- Lightweight Charts
- PapaParse
- Tailwind CSS
- Coinbase public market data

CSV analysis and demo mode work entirely offline after initial page load.

---

# ⚠️ Limitations

---

## Small Sample Sizes

Patterns with very low occurrence counts should be treated cautiously.

Example:

```txt
5 wins out of 5 occurrences
```

is statistically interesting but still weak evidence.

---

## Survivorship Bias

Imported datasets may exclude:

- failed assets
- delisted securities
- bankrupt companies

This can distort historical results.

---

## Look-Ahead Constraints

Patterns near the end of the dataset may not have enough future candles available for larger forward windows.

The engine automatically skips incomplete occurrences.

---

## Rule-Based Pattern Simplification

Pattern detection is binary:

- detected
- not detected

Real-world market structures exist on a spectrum and may not fit perfect definitions.

---

## No Transaction Costs

Statistics do not include:

- spreads
- commissions
- slippage
- liquidity constraints

Real trading performance would differ.

---

## No Risk Metrics

CandleEdge currently does not calculate:

- drawdown
- volatility
- Sharpe ratio
- risk-adjusted returns

The focus is purely on directional probability and move magnitude.

---

# 🧠 Design Philosophy

CandleEdge intentionally avoids:

- hype-driven AI marketing
- black-box predictions
- hidden scoring systems
- unverifiable analytics

The project focuses on:

- transparency
- deterministic analysis
- reproducibility
- statistical exploration
- educational market analysis

Every calculation occurs directly inside the browser using the user's own dataset.
