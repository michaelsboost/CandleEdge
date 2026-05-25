// ============================================================================
// CandleEdge - Market Structure & Pattern Probability Scanner
// ============================================================================
// A client-side market structure scanner that detects candlestick and chart
// patterns, draws detected structures on an interactive chart, and computes
// historical probabilities from the loaded dataset.
//
// All statistics are descriptive only - based solely on the loaded data.
// No AI, no predictions, no external APIs for analysis.
// ============================================================================

// ============================================================================
// STATISTICAL ENGINE with Pattern Cache Optimization
// ============================================================================
const statsCache = new Map();
const patternOccurrenceCache = new Map();

function getDatasetSignature(candles) {
    if (!candles.length) return '';
    return `${candles.length}_${candles[0]?.time}_${candles[candles.length-1]?.time}`;
}

function getPatternOccurrences(patternId, candles) {
    const datasetSig = getDatasetSignature(candles);
    const cacheKey = `${patternId}_${datasetSig}`;
    
    if (patternOccurrenceCache.has(cacheKey)) {
        return patternOccurrenceCache.get(cacheKey);
    }
    
    const occurrences = [];
    for(let i = 0; i < candles.length - 20; i++) {
        const patternsAtCandle = detectPatternsAtCandle(candles, i);
        const match = patternsAtCandle.find(p => p.id === patternId);
        if(match) {
            occurrences.push({ idx: i, bias: match.bias });
        }
    }
    
    patternOccurrenceCache.set(cacheKey, occurrences);
    return occurrences;
}

function clearAnalysisCaches() {
    statsCache.clear();
    patternOccurrenceCache.clear();
}

const StatsEngine = {
    computePatternStats(patternId, candles, lookbacks = [3,5,10,20]) {
        const cacheKey = `${patternId}_${candles.length}_${candles[candles.length-1]?.time}`;
        if (statsCache.has(cacheKey)) return statsCache.get(cacheKey);
        
        const occurrences = getPatternOccurrences(patternId, candles);
        if(occurrences.length < 5) return null;
        
        const results = {};
        for(let windowBars of lookbacks) {
            const forwardReturns = [];
            let bullishCount = 0, bearishCount = 0;
            for(let occ of occurrences) {
                const endIdx = occ.idx + windowBars;
                if(endIdx >= candles.length) continue;
                const startPrice = candles[occ.idx].close;
                const endPrice = candles[endIdx].close;
                const pctMove = ((endPrice - startPrice) / startPrice) * 100;
                forwardReturns.push(pctMove);
                if(pctMove > 0) bullishCount++;
                else if(pctMove < 0) bearishCount++;
            }
            if(forwardReturns.length < 3) continue;
            const avgMove = forwardReturns.reduce((a,b)=>a+b,0)/forwardReturns.length;
            const sorted = [...forwardReturns].sort((a,b)=>a-b);
            const medianMove = sorted[Math.floor(sorted.length/2)];
            const bullishProb = (bullishCount / forwardReturns.length) * 100;
            const bearishProb = (bearishCount / forwardReturns.length) * 100;
            results[windowBars] = { bullishProb, bearishProb, avgMove, medianMove, sampleSize: forwardReturns.length };
        }
        
        let bestWindow = null, bestScore = -Infinity;
        for(let [window, stats] of Object.entries(results)) {
            if(stats.sampleSize < 5) continue;
            const directionalStrength = Math.max(stats.bullishProb, stats.bearishProb);
            const directionMultiplier = (directionalStrength - 50) / 50;
            const magnitudeScore = Math.min(Math.abs(stats.avgMove) / 8, 1.0);
            const sampleReliability = Math.min(stats.sampleSize / 30, 1.0);
            let weighted = (directionMultiplier * 0.5) + (magnitudeScore * 0.3) + (sampleReliability * 0.2);
            if(weighted > bestScore) { bestScore = weighted; bestWindow = parseInt(window); }
        }
        if(!bestWindow) return null;
        const best = results[bestWindow];
        const bias = best.bullishProb > best.bearishProb ? 'bullish' : (best.bearishProb > best.bullishProb ? 'bearish' : 'neutral');
        
        let confidence = 'Low';
        if (best.sampleSize >= 30) confidence = 'High';
        else if (best.sampleSize >= 15) confidence = 'Moderate';
        
        const patternName = patternId.replace(/_/g,' ');
        const decisionText = `Based on ${best.sampleSize} prior occurrences of ${patternName} in the loaded dataset, price moved ${bias} ${bias === 'bullish' ? best.bullishProb.toFixed(0) : best.bearishProb.toFixed(0)}% of the time after ${bestWindow} candles. Average move was ${best.avgMove > 0 ? '+' : ''}${best.avgMove.toFixed(2)}%, median move was ${best.medianMove.toFixed(2)}%. Confidence is ${confidence} because sample size is ${best.sampleSize}.`;
        
        const result = {
            forwardBars: bestWindow, bullishProb: Math.round(best.bullishProb), bearishProb: Math.round(best.bearishProb),
            avgMovePct: best.avgMove, medianMovePct: best.medianMove, sampleSize: best.sampleSize,
            bias: bias, confidence: confidence, decisionText: decisionText, weightedScore: bestScore
        };
        statsCache.set(cacheKey, result);
        return result;
    }
};

// ============================================================================
// TREND DETECTION & MARKET CONTEXT
// ============================================================================

function isUptrend(candles, idx, period = 20) {
    if(idx < period) return false;
    return candles[idx].close > candles[idx - period].close;
}

function isDowntrend(candles, idx, period = 20) {
    if(idx < period) return false;
    return candles[idx].close < candles[idx - period].close;
}

function recentMovePct(candles, idx, period = 20) {
    if(idx < period) return 0;
    return ((candles[idx].close - candles[idx - period].close) / candles[idx - period].close) * 100;
}

function isRecentlyConfirmed(point, currentIdx, maxBarsAgo = 15) {
    if(!point || point.index === undefined) return false;
    return point.index <= currentIdx && (currentIdx - point.index) <= maxBarsAgo;
}

// Debug logging helper (can be enabled/disabled)
let ENABLE_DEBUG = false;
function debugLog(message, data) {
    if(ENABLE_DEBUG && data && data.peaks !== undefined) {
        console.log(`[CandleEdge Debug] ${message} - Peaks: ${data.peaks.length}, Troughs: ${data.troughs.length}, Current idx: ${data.idx}`);
    } else if(ENABLE_DEBUG) {
        console.log(`[CandleEdge Debug] ${message}`);
    }
}

// ============================================================================
// CANDLE MATH UTILITIES
// ============================================================================

function candleParts(c) {
    let body = Math.abs(c.close - c.open);
    let range = c.high - c.low || 1;
    let upper = c.high - Math.max(c.open, c.close);
    let lower = Math.min(c.open, c.close) - c.low;
    return { body, range, upper, lower };
}

function isBodyLarge(c) {
    let { body, range } = candleParts(c);
    return body > range * 0.5;
}

function isBodySmall(c) {
    let { body, range } = candleParts(c);
    return body <= range * 0.3;
}

// ============================================================================
// BASE CANDLESTICK PATTERNS
// ============================================================================

function isDoji(c) {
    let { body, range } = candleParts(c);
    return body <= range * 0.12;
}

function isDragonflyDoji(c) {
    let { body, upper, lower, range } = candleParts(c);
    return body <= range * 0.1 && lower > range * 0.6 && upper < range * 0.1;
}

function isGravestoneDoji(c) {
    let { body, upper, lower, range } = candleParts(c);
    return body <= range * 0.1 && upper > range * 0.6 && lower < range * 0.1;
}

function isLongLeggedDoji(c) {
    let { body, upper, lower, range } = candleParts(c);
    return body <= range * 0.1 && upper > range * 0.3 && lower > range * 0.3;
}

function isSpinningTop(c) {
    let { body, range } = candleParts(c);
    let bodyPct = body / range;
    return bodyPct > 0.1 && bodyPct < 0.4;
}

function isBullishEngulfing(candles, i) {
    if(i < 1) return false;
    let p = candles[i-1], c = candles[i];
    return p.close < p.open && c.close > c.open && c.open <= p.close && c.close >= p.open;
}

function isBearishEngulfing(candles, i) {
    if(i < 1) return false;
    let p = candles[i-1], c = candles[i];
    return p.close > p.open && c.close < c.open && c.open >= p.close && c.close <= p.open;
}

function isBullishOutsideBar(candles, i) {
    if(i < 1) return false;
    let p = candles[i-1], c = candles[i];
    return c.close > c.open && c.high > p.high && c.low < p.low;
}

function isBearishOutsideBar(candles, i) {
    if(i < 1) return false;
    let p = candles[i-1], c = candles[i];
    return c.close < c.open && c.high > p.high && c.low < p.low;
}

function isInsideBar(candles, i) {
    if(i < 1) return false;
    let p = candles[i-1], c = candles[i];
    return c.high < p.high && c.low > p.low;
}

function isHammer(candles, idx) {
    if(idx < 20) return false;
    let c = candles[idx];
    let { body, upper, lower } = candleParts(c);
    let isShape = body > 0 && lower > body * 2 && upper < body * 0.5 && c.close > c.open;
    return isShape && isDowntrend(candles, idx, 20);
}

function isInvertedHammer(candles, idx) {
    if(idx < 20) return false;
    let c = candles[idx];
    let { body, upper, lower } = candleParts(c);
    let isShape = body > 0 && upper > body * 2 && lower < body * 0.5 && c.close < c.open;
    return isShape && isDowntrend(candles, idx, 20);
}

function isHangingMan(candles, idx) {
    if(idx < 20) return false;
    let c = candles[idx];
    let { body, upper, lower } = candleParts(c);
    let isShape = body > 0 && lower > body * 2 && upper < body * 0.5 && c.close < c.open;
    return isShape && isUptrend(candles, idx, 20);
}

function isShootingStar(candles, idx) {
    if(idx < 20) return false;
    let c = candles[idx];
    let { body, upper, lower } = candleParts(c);
    let isShape = body > 0 && upper > body * 2 && lower < body * 0.5 && c.close < c.open;
    return isShape && isUptrend(candles, idx, 20);
}

function isThreeWhiteSoldiers(candles, i) {
    if(i < 2) return false;
    let a = candles[i-2], b = candles[i-1], c = candles[i];
    return a.close > a.open && b.close > b.open && c.close > c.open && b.close > a.close && c.close > b.close;
}

function isThreeBlackCrows(candles, i) {
    if(i < 2) return false;
    let a = candles[i-2], b = candles[i-1], c = candles[i];
    return a.close < a.open && b.close < b.open && c.close < c.open && b.close < a.close && c.close < b.close;
}

function isMorningStar(candles, idx) {
    if(idx < 22) return false;
    let a = candles[idx-2], b = candles[idx-1], c = candles[idx];
    let aBearish = (a.close - a.open) < -(a.high - a.low) * 0.5;
    let bSmall = Math.abs(b.close - b.open) <= (b.high - b.low) * 0.3;
    let cBullish = (c.close - c.open) > (c.high - c.low) * 0.5;
    let cClosesIntoA = c.close > a.open + (a.close - a.open) * 0.5;
    return aBearish && bSmall && cBullish && cClosesIntoA && isDowntrend(candles, idx, 20);
}

function isEveningStar(candles, idx) {
    if(idx < 22) return false;
    let a = candles[idx-2], b = candles[idx-1], c = candles[idx];
    let aBullish = (a.close - a.open) > (a.high - a.low) * 0.5;
    let bSmall = Math.abs(b.close - b.open) <= (b.high - b.low) * 0.3;
    let cBearish = (c.close - c.open) < -(c.high - c.low) * 0.5;
    let cClosesIntoA = c.close < a.open + (a.close - a.open) * 0.5;
    return aBullish && bSmall && cBearish && cClosesIntoA && isUptrend(candles, idx, 20);
}

function isPiercingPattern(candles, idx) {
    if(idx < 21) return false;
    let a = candles[idx-1], b = candles[idx];
    let aBearish = (a.close - a.open) < -(a.high - a.low) * 0.5;
    let bBullish = (b.close - b.open) > (b.high - b.low) * 0.5;
    let bOpensBelow = b.open <= a.close;
    let bClosesAbove = b.close > (a.open + a.close) / 2;
    let bClosesBelow = b.close < a.open;
    return aBearish && bBullish && bOpensBelow && bClosesAbove && bClosesBelow && isDowntrend(candles, idx, 20);
}

function isDarkCloudCover(candles, idx) {
    if(idx < 21) return false;
    let a = candles[idx-1], b = candles[idx];
    let aBullish = (a.close - a.open) > (a.high - a.low) * 0.5;
    let bBearish = (b.close - b.open) < -(b.high - b.low) * 0.5;
    let bOpensAbove = b.open >= a.close;
    let bClosesBelow = b.close < (a.open + a.close) / 2;
    let bClosesAbove = b.close > a.open;
    return aBullish && bBearish && bOpensAbove && bClosesBelow && bClosesAbove && isUptrend(candles, idx, 20);
}

function isTweezerTop(candles, idx) {
    if(idx < 21) return false;
    let a = candles[idx-1], b = candles[idx];
    let highDiff = Math.abs(a.high - b.high) / a.high;
    let aBullish = a.close > a.open;
    let bBearish = b.close < b.open;
    return highDiff <= 0.001 && aBullish && bBearish && isUptrend(candles, idx, 20);
}

function isTweezerBottom(candles, idx) {
    if(idx < 21) return false;
    let a = candles[idx-1], b = candles[idx];
    let lowDiff = Math.abs(a.low - b.low) / a.low;
    let aBearish = a.close < a.open;
    let bBullish = b.close > b.open;
    return lowDiff <= 0.001 && aBearish && bBullish && isDowntrend(candles, idx, 20);
}

function isBullishHarami(candles, idx) {
    if(idx < 21) return false;
    let a = candles[idx-1], b = candles[idx];
    let aBearish = (a.close - a.open) < -(a.high - a.low) * 0.5;
    let bBullish = b.close > b.open;
    let bContained = b.open > a.close && b.close < a.open;
    return aBearish && bBullish && bContained && isDowntrend(candles, idx, 20);
}

function isBearishHarami(candles, idx) {
    if(idx < 21) return false;
    let a = candles[idx-1], b = candles[idx];
    let aBullish = (a.close - a.open) > (a.high - a.low) * 0.5;
    let bBearish = b.close < b.open;
    let bContained = b.open < a.close && b.close > a.open;
    return aBullish && bBearish && bContained && isUptrend(candles, idx, 20);
}

function isBullishKicker(candles, idx) {
    if(idx < 1) return false;
    let a = candles[idx-1], b = candles[idx];
    return a.close < a.open && b.close > b.open && b.open >= a.close;
}

function isBearishKicker(candles, idx) {
    if(idx < 1) return false;
    let a = candles[idx-1], b = candles[idx];
    return a.close > a.open && b.close < b.open && b.open <= a.close;
}

function isBullishMarubozu(c) {
    let { body, upper, lower } = candleParts(c);
    let range = c.high - c.low;
    let wickRatio = (upper + lower) / range;
    return body > 0 && c.close > c.open && wickRatio < 0.1;
}

function isBearishMarubozu(c) {
    let { body, upper, lower } = candleParts(c);
    let range = c.high - c.low;
    let wickRatio = (upper + lower) / range;
    return body > 0 && c.close < c.open && wickRatio < 0.1;
}

function isNR4(candles, i) {
    if(i < 3) return false;
    let currentRange = candles[i].high - candles[i].low;
    for(let j = 1; j <= 3; j++) {
        let prevRange = candles[i-j].high - candles[i-j].low;
        if(prevRange <= currentRange) return false;
    }
    return true;
}

function isNR7(candles, i) {
    if(i < 6) return false;
    let currentRange = candles[i].high - candles[i].low;
    for(let j = 1; j <= 6; j++) {
        let prevRange = candles[i-j].high - candles[i-j].low;
        if(prevRange <= currentRange) return false;
    }
    return true;
}

function isLongLowerWickRejection(c) {
    let { body, lower } = candleParts(c);
    return body > 0 && lower >= body * 3;
}

function isLongUpperWickRejection(c) {
    let { body, upper } = candleParts(c);
    return body > 0 && upper >= body * 3;
}

// ============================================================================
// SWING POINT & LOCAL EXTREMA DETECTION
// ============================================================================

function findSwingPoints(candles, windowSize = 3) {
    let highs = [], lows = [];
    for(let i = windowSize; i < candles.length - windowSize; i++) {
        let isHigh = true, isLow = true;
        for(let j = -windowSize; j <= windowSize; j++) {
            if(j === 0) continue;
            if(candles[i].high <= candles[i+j].high) isHigh = false;
            if(candles[i].low >= candles[i+j].low) isLow = false;
        }
        if(isHigh) highs.push({ index: i, price: candles[i].high, time: candles[i].time });
        if(isLow) lows.push({ index: i, price: candles[i].low, time: candles[i].time });
    }
    return { highs, lows };
}

function findLocalExtrema(candles, lookback = 5) {
    let peaks = [], troughs = [];
    for(let i = lookback; i < candles.length - lookback; i++) {
        let isPeak = true, isTrough = true;
        for(let j = 1; j <= lookback; j++) {
            if(candles[i].high <= candles[i-j].high || candles[i].high <= candles[i+j].high) isPeak = false;
            if(candles[i].low >= candles[i-j].low || candles[i].low >= candles[i+j].low) isTrough = false;
        }
        if(isPeak) peaks.push({ index: i, price: candles[i].high, time: candles[i].time });
        if(isTrough) troughs.push({ index: i, price: candles[i].low, time: candles[i].time });
    }
    return { peaks, troughs };
}

// ============================================================================
// MATH HELPERS FOR TRENDLINES
// ============================================================================

function percentSlope(p1, p2, distance) {
    if(distance <= 0) return 0;
    let pctChange = ((p2 - p1) / p1) * 100;
    return pctChange / distance;
}

function lineValue(p1, p2, idx1, idx2, x) {
    if(idx2 === idx1) return p1;
    let slope = (p2 - p1) / (idx2 - idx1);
    return p1 + slope * (x - idx1);
}

const FLAT_THRESHOLD = 0.03;
const TREND_THRESHOLD = 0.03;

// ============================================================================
// STRUCTURAL CHART PATTERNS
// ============================================================================

function detectAscendingTriangle(highs, lows) {
    if(highs.length < 2 || lows.length < 2) return null;
    let h1 = highs[highs.length-2], h2 = highs[highs.length-1];
    let l1 = lows[lows.length-2], l2 = lows[lows.length-1];
    let hDist = h2.index - h1.index;
    let lDist = l2.index - l1.index;
    let hSlopePct = percentSlope(h1.price, h2.price, hDist);
    let lSlopePct = percentSlope(l1.price, l2.price, lDist);
    if(Math.abs(hSlopePct) < FLAT_THRESHOLD && lSlopePct > TREND_THRESHOLD && l1.price < h1.price) {
        return { name: "Ascending Triangle", icon: "📐", bias: "bullish", upper1: h1, upper2: h2, lower1: l1, lower2: l2 };
    }
    return null;
}

function detectDescendingTriangle(highs, lows) {
    if(highs.length < 2 || lows.length < 2) return null;
    let h1 = highs[highs.length-2], h2 = highs[highs.length-1];
    let l1 = lows[lows.length-2], l2 = lows[lows.length-1];
    let hDist = h2.index - h1.index;
    let lDist = l2.index - l1.index;
    let hSlopePct = percentSlope(h1.price, h2.price, hDist);
    let lSlopePct = percentSlope(l1.price, l2.price, lDist);
    if(hSlopePct < -TREND_THRESHOLD && Math.abs(lSlopePct) < FLAT_THRESHOLD && h2.price > l2.price) {
        return { name: "Descending Triangle", icon: "📐", bias: "bearish", upper1: h1, upper2: h2, lower1: l1, lower2: l2 };
    }
    return null;
}

function detectSymmetricalTriangle(highs, lows) {
    if(highs.length < 2 || lows.length < 2) return null;
    let h1 = highs[highs.length-2], h2 = highs[highs.length-1];
    let l1 = lows[lows.length-2], l2 = lows[lows.length-1];
    let hDist = h2.index - h1.index;
    let lDist = l2.index - l1.index;
    let hSlopePct = percentSlope(h1.price, h2.price, hDist);
    let lSlopePct = percentSlope(l1.price, l2.price, lDist);
    if(hSlopePct < -TREND_THRESHOLD && lSlopePct > TREND_THRESHOLD && h2.price > l2.price) {
        return { name: "Symmetrical Triangle", icon: "🔺", bias: "neutral", upper1: h1, upper2: h2, lower1: l1, lower2: l2 };
    }
    return null;
}

function detectRisingWedge(highs, lows) {
    if(highs.length < 2 || lows.length < 2) return null;
    let h1 = highs[highs.length-2], h2 = highs[highs.length-1];
    let l1 = lows[lows.length-2], l2 = lows[lows.length-1];
    let hSlopePct = percentSlope(h1.price, h2.price, h2.index - h1.index);
    let lSlopePct = percentSlope(l1.price, l2.price, l2.index - l1.index);
    if(hSlopePct > 0 && lSlopePct > 0 && hSlopePct < lSlopePct) {
        return { name: "Rising Wedge", icon: "📈", bias: "bearish", upper1: h1, upper2: h2, lower1: l1, lower2: l2 };
    }
    return null;
}

function detectFallingWedge(highs, lows) {
    if(highs.length < 2 || lows.length < 2) return null;
    let h1 = highs[highs.length-2], h2 = highs[highs.length-1];
    let l1 = lows[lows.length-2], l2 = lows[lows.length-1];
    let hSlopePct = percentSlope(h1.price, h2.price, h2.index - h1.index);
    let lSlopePct = percentSlope(l1.price, l2.price, l2.index - l1.index);
    if(hSlopePct < 0 && lSlopePct < 0 && hSlopePct < lSlopePct) {
        return { name: "Falling Wedge", icon: "📉", bias: "bullish", upper1: h1, upper2: h2, lower1: l1, lower2: l2 };
    }
    return null;
}

function detectBullishPennant(highs, lows) {
    if(highs.length < 5 || lows.length < 5) return null;
    let flagpoleStart = lows[0];
    let flagpoleEnd = highs[highs.length-4];
    let flagpole = flagpoleEnd.price - flagpoleStart.price;
    let flagpolePct = (flagpole / flagpoleStart.price) * 100;
    if(flagpolePct < 2) return null;
    let upperSlope = percentSlope(highs[highs.length-3].price, highs[highs.length-1].price, highs[highs.length-1].index - highs[highs.length-3].index);
    let lowerSlope = percentSlope(lows[lows.length-3].price, lows[lows.length-1].price, lows[lows.length-1].index - lows[lows.length-3].index);
    if(upperSlope < -0.01 && lowerSlope > 0.01) {
        return { name: "Bullish Pennant", icon: "🏁", bias: "bullish", upper1: highs[highs.length-2], upper2: highs[highs.length-1], lower1: lows[lows.length-2], lower2: lows[lows.length-1] };
    }
    return null;
}

function detectBearishPennant(highs, lows) {
    if(highs.length < 5 || lows.length < 5) return null;
    let flagpoleStart = highs[0];
    let flagpoleEnd = lows[lows.length-4];
    let flagpole = flagpoleStart.price - flagpoleEnd.price;
    let flagpolePct = (flagpole / flagpoleStart.price) * 100;
    if(flagpolePct < 2) return null;
    let upperSlope = percentSlope(highs[highs.length-3].price, highs[highs.length-1].price, highs[highs.length-1].index - highs[highs.length-3].index);
    let lowerSlope = percentSlope(lows[lows.length-3].price, lows[lows.length-1].price, lows[lows.length-1].index - lows[lows.length-3].index);
    if(upperSlope > 0.01 && lowerSlope < -0.01) {
        return { name: "Bearish Pennant", icon: "🏁", bias: "bearish", upper1: highs[highs.length-2], upper2: highs[highs.length-1], lower1: lows[lows.length-2], lower2: lows[lows.length-1] };
    }
    return null;
}

// Helper to find valid pullback between two peaks for double/triple top validation
function hasValidPullbackBetweenPeaks(candles, peak1Idx, peak2Idx) {
    let lowestBetween = Infinity;
    for(let i = peak1Idx + 1; i < peak2Idx; i++) {
        if(candles[i].low < lowestBetween) lowestBetween = candles[i].low;
    }
    let avgPeakPrice = (candles[peak1Idx].high + candles[peak2Idx].high) / 2;
    let pullbackDepth = (avgPeakPrice - lowestBetween) / avgPeakPrice;
    return pullbackDepth > 0.01; // At least 1% pullback
}

function hasValidBounceBetweenTroughs(candles, trough1Idx, trough2Idx) {
    let highestBetween = -Infinity;
    for(let i = trough1Idx + 1; i < trough2Idx; i++) {
        if(candles[i].high > highestBetween) highestBetween = candles[i].high;
    }
    let avgTroughPrice = (candles[trough1Idx].low + candles[trough2Idx].low) / 2;
    let bounceHeight = (highestBetween - avgTroughPrice) / avgTroughPrice;
    return bounceHeight > 0.01; // At least 1% bounce
}

// Improved Double Top detection with pullback validation and combination search
function detectDoubleTop(candles, peaks, currentIdx, confirmationWindow = 15) {
    if(peaks.length < 2) return null;
    
    // Search all possible peak pairs within the last 50 peaks
    let bestMatch = null;
    for(let i = Math.max(0, peaks.length - 20); i < peaks.length - 1; i++) {
        for(let j = i + 1; j < peaks.length; j++) {
            let p1 = peaks[i], p2 = peaks[j];
            let separation = p2.index - p1.index;
            if(separation < 5) continue;
            
            let priceDiff = Math.abs(p1.price - p2.price) / p1.price;
            if(priceDiff > 0.04) continue;
            
            // Validate pullback between peaks
            if(!hasValidPullbackBetweenPeaks(candles, p1.index, p2.index)) continue;
            
            // Check if second peak was confirmed within window
            if(isRecentlyConfirmed(p2, currentIdx, confirmationWindow)) {
                if(!bestMatch || (priceDiff < Math.abs(bestMatch.peak1.price - bestMatch.peak2.price) / bestMatch.peak1.price)) {
                    bestMatch = { peak1: p1, peak2: p2 };
                }
            }
        }
    }
    
    if(bestMatch) {
        return { name: "Double Top", icon: "📉", bias: "bearish", peak1: bestMatch.peak1, peak2: bestMatch.peak2 };
    }
    return null;
}

function detectDoubleBottom(candles, troughs, currentIdx, confirmationWindow = 15) {
    if(troughs.length < 2) return null;
    
    let bestMatch = null;
    for(let i = Math.max(0, troughs.length - 20); i < troughs.length - 1; i++) {
        for(let j = i + 1; j < troughs.length; j++) {
            let t1 = troughs[i], t2 = troughs[j];
            let separation = t2.index - t1.index;
            if(separation < 5) continue;
            
            let priceDiff = Math.abs(t1.price - t2.price) / t1.price;
            if(priceDiff > 0.04) continue;
            
            if(!hasValidBounceBetweenTroughs(candles, t1.index, t2.index)) continue;
            
            if(isRecentlyConfirmed(t2, currentIdx, confirmationWindow)) {
                if(!bestMatch || (priceDiff < Math.abs(bestMatch.trough1.price - bestMatch.trough2.price) / bestMatch.trough1.price)) {
                    bestMatch = { trough1: t1, trough2: t2 };
                }
            }
        }
    }
    
    if(bestMatch) {
        return { name: "Double Bottom", icon: "📈", bias: "bullish", trough1: bestMatch.trough1, trough2: bestMatch.trough2 };
    }
    return null;
}

function detectTripleTop(candles, peaks, currentIdx, confirmationWindow = 15) {
    if(peaks.length < 3) return null;
    
    for(let i = Math.max(0, peaks.length - 25); i < peaks.length - 2; i++) {
        for(let j = i + 1; j < peaks.length - 1; j++) {
            for(let k = j + 1; k < peaks.length; k++) {
                let p1 = peaks[i], p2 = peaks[j], p3 = peaks[k];
                
                let priceDiff12 = Math.abs(p1.price - p2.price) / p1.price;
                let priceDiff23 = Math.abs(p2.price - p3.price) / p2.price;
                let priceDiff13 = Math.abs(p1.price - p3.price) / p1.price;
                
                if(priceDiff12 <= 0.03 && priceDiff23 <= 0.03 && priceDiff13 <= 0.04 &&
                   hasValidPullbackBetweenPeaks(candles, p1.index, p2.index) &&
                   hasValidPullbackBetweenPeaks(candles, p2.index, p3.index) &&
                   isRecentlyConfirmed(p3, currentIdx, confirmationWindow)) {
                    return { name: "Triple Top", icon: "📉", bias: "bearish", peak1: p1, peak2: p2, peak3: p3 };
                }
            }
        }
    }
    return null;
}

function detectTripleBottom(candles, troughs, currentIdx, confirmationWindow = 15) {
    if(troughs.length < 3) return null;
    
    for(let i = Math.max(0, troughs.length - 25); i < troughs.length - 2; i++) {
        for(let j = i + 1; j < troughs.length - 1; j++) {
            for(let k = j + 1; k < troughs.length; k++) {
                let t1 = troughs[i], t2 = troughs[j], t3 = troughs[k];
                
                let priceDiff12 = Math.abs(t1.price - t2.price) / t1.price;
                let priceDiff23 = Math.abs(t2.price - t3.price) / t2.price;
                let priceDiff13 = Math.abs(t1.price - t3.price) / t1.price;
                
                if(priceDiff12 <= 0.03 && priceDiff23 <= 0.03 && priceDiff13 <= 0.04 &&
                   hasValidBounceBetweenTroughs(candles, t1.index, t2.index) &&
                   hasValidBounceBetweenTroughs(candles, t2.index, t3.index) &&
                   isRecentlyConfirmed(t3, currentIdx, confirmationWindow)) {
                    return { name: "Triple Bottom", icon: "📈", bias: "bullish", trough1: t1, trough2: t2, trough3: t3 };
                }
            }
        }
    }
    return null;
}

// Cup and Handle - search for best combination across recent peaks/troughs
function detectCupAndHandle(candles, peaks, troughs, currentIdx, confirmationWindow = 20) {
    if(peaks.length < 3 || troughs.length < 3) return null;
    
    let bestMatch = null;
    let bestScore = -Infinity;
    
    // Search through recent peaks and troughs combinations
    for(let i = Math.max(0, peaks.length - 15); i < peaks.length - 2; i++) {
        for(let j = Math.max(0, troughs.length - 15); j < troughs.length - 1; j++) {
            for(let k = i + 1; k < peaks.length - 1; k++) {
                for(let l = j + 1; l < troughs.length; l++) {
                    let leftRim = peaks[i];
                    let cupLow = troughs[j];
                    let rightRim = peaks[k];
                    let handleLow = troughs[l];
                    
                    // Proper ordering
                    if(!(leftRim.index < cupLow.index && cupLow.index < rightRim.index && rightRim.index < handleLow.index)) continue;
                    
                    // Left and right rims should be at similar price levels (within 5%)
                    let rimDiff = Math.abs(leftRim.price - rightRim.price) / leftRim.price;
                    if(rimDiff > 0.05) continue;
                    
                    // Cup depth meaningful (at least 3% from rim to trough)
                    let cupDepth = (leftRim.price - cupLow.price) / leftRim.price;
                    if(cupDepth < 0.03) continue;
                    
                    // Cup symmetry
                    let leftToLow = cupLow.index - leftRim.index;
                    let lowToRight = rightRim.index - cupLow.index;
                    let symmetryRatio = Math.min(leftToLow, lowToRight) / Math.max(leftToLow, lowToRight);
                    if(symmetryRatio < 0.4) continue;
                    
                    // Handle depth less than 50% of cup depth
                    let handleDepth = (rightRim.price - handleLow.price) / rightRim.price;
                    if(handleDepth > cupDepth * 0.5) continue;
                    
                    // Check if handle low is recent
                    if(isRecentlyConfirmed(handleLow, currentIdx, confirmationWindow)) {
                        let score = (cupDepth * 10) + symmetryRatio + (1 - handleDepth/cupDepth);
                        if(score > bestScore) {
                            bestScore = score;
                            bestMatch = { leftRim, cupLow, rightRim, handleLow };
                        }
                    }
                }
            }
        }
    }
    
    if(bestMatch) {
        return { name: "Cup and Handle", icon: "🏆", bias: "bullish", leftRim: bestMatch.leftRim, cupLow: bestMatch.cupLow, rightRim: bestMatch.rightRim, handleLow: bestMatch.handleLow };
    }
    return null;
}

// Neckline detection for Head and Shoulders
function findHSNeckline(candles, leftIdx, headIdx, rightIdx) {
    let low1 = Infinity, low1Idx = leftIdx;
    let low2 = Infinity, low2Idx = headIdx;
    for(let i = leftIdx; i <= headIdx; i++) {
        if(candles[i].low < low1) { low1 = candles[i].low; low1Idx = i; }
    }
    for(let i = headIdx; i <= rightIdx; i++) {
        if(candles[i].low < low2) { low2 = candles[i].low; low2Idx = i; }
    }
    return { 
        p1: { index: low1Idx, price: low1, time: candles[low1Idx].time }, 
        p2: { index: low2Idx, price: low2, time: candles[low2Idx].time } 
    };
}

// Improved Head and Shoulders - search across all peak triplets
function detectHeadAndShoulders(candles, peaks, currentIdx, confirmationWindow = 20) {
    if(peaks.length < 3) return null;
    
    let bestMatch = null;
    let bestScore = -Infinity;
    
    // Search through all peak triplets within recent history
    for(let i = Math.max(0, peaks.length - 25); i < peaks.length - 2; i++) {
        for(let j = i + 1; j < peaks.length - 1; j++) {
            for(let k = j + 1; k < peaks.length; k++) {
                let left = peaks[i];
                let head = peaks[j];
                let right = peaks[k];
                
                // Head must be above both shoulders
                if(head.price <= left.price || head.price <= right.price) continue;
                
                // Shoulder height similarity (within 25%)
                let shoulderDiff = Math.abs(left.price - right.price) / left.price;
                if(shoulderDiff > 0.25) continue;
                
                // Minimum separation between points
                let leftToHead = head.index - left.index;
                let headToRight = right.index - head.index;
                if(leftToHead < 3 || headToRight < 3) continue;
                
                // Check if right shoulder was confirmed within window
                if(isRecentlyConfirmed(right, currentIdx, confirmationWindow)) {
                    let neckline = findHSNeckline(candles, left.index, head.index, right.index);
                    let score = (head.price / left.price) + (1 - shoulderDiff);
                    if(score > bestScore) {
                        bestScore = score;
                        bestMatch = { leftShoulder: left, head: head, rightShoulder: right, neckline1: neckline.p1, neckline2: neckline.p2 };
                    }
                }
            }
        }
    }
    
    if(bestMatch) {
        return { name: "Head and Shoulders", icon: "🔄", bias: "bearish", leftShoulder: bestMatch.leftShoulder, head: bestMatch.head, rightShoulder: bestMatch.rightShoulder, neckline1: bestMatch.neckline1, neckline2: bestMatch.neckline2 };
    }
    return null;
}

function findIHSNeckline(candles, leftIdx, headIdx, rightIdx) {
    let high1 = -Infinity, high1Idx = leftIdx;
    let high2 = -Infinity, high2Idx = headIdx;
    for(let i = leftIdx; i <= headIdx; i++) {
        if(candles[i].high > high1) { high1 = candles[i].high; high1Idx = i; }
    }
    for(let i = headIdx; i <= rightIdx; i++) {
        if(candles[i].high > high2) { high2 = candles[i].high; high2Idx = i; }
    }
    return { 
        p1: { index: high1Idx, price: high1, time: candles[high1Idx].time }, 
        p2: { index: high2Idx, price: high2, time: candles[high2Idx].time } 
    };
}

function detectInverseHeadAndShoulders(candles, troughs, currentIdx, confirmationWindow = 20) {
    if(troughs.length < 3) return null;
    
    let bestMatch = null;
    let bestScore = -Infinity;
    
    for(let i = Math.max(0, troughs.length - 25); i < troughs.length - 2; i++) {
        for(let j = i + 1; j < troughs.length - 1; j++) {
            for(let k = j + 1; k < troughs.length; k++) {
                let left = troughs[i];
                let head = troughs[j];
                let right = troughs[k];
                
                if(head.price >= left.price || head.price >= right.price) continue;
                
                let shoulderDiff = Math.abs(left.price - right.price) / left.price;
                if(shoulderDiff > 0.25) continue;
                
                let leftToHead = head.index - left.index;
                let headToRight = right.index - head.index;
                if(leftToHead < 3 || headToRight < 3) continue;
                
                if(isRecentlyConfirmed(right, currentIdx, confirmationWindow)) {
                    let neckline = findIHSNeckline(candles, left.index, head.index, right.index);
                    let score = (left.price / head.price) + (1 - shoulderDiff);
                    if(score > bestScore) {
                        bestScore = score;
                        bestMatch = { leftTrough: left, head: head, rightTrough: right, neckline1: neckline.p1, neckline2: neckline.p2 };
                    }
                }
            }
        }
    }
    
    if(bestMatch) {
        return { name: "Inverse Head and Shoulders", icon: "🔄", bias: "bullish", leftTrough: bestMatch.leftTrough, head: bestMatch.head, rightTrough: bestMatch.rightTrough, neckline1: bestMatch.neckline1, neckline2: bestMatch.neckline2 };
    }
    return null;
}

function detectBullFlag(highs, lows) {
    if(highs.length < 5 || lows.length < 4) return null;
    let flagpoleStart = lows[0];
    let flagpoleEnd = highs[highs.length-3];
    let flagpole = flagpoleEnd.price - flagpoleStart.price;
    let flagpolePct = (flagpole / flagpoleStart.price) * 100;
    if(flagpolePct < 2) return null;
    let channelUpper = highs[highs.length-2], channelLower = highs[highs.length-1];
    let channelSlope = percentSlope(channelUpper.price, channelLower.price, channelLower.index - channelUpper.index);
    if(channelSlope < -TREND_THRESHOLD) {
        return { name: "Bull Flag", icon: "🏁", bias: "bullish", upper1: channelUpper, upper2: channelLower, lower1: lows[lows.length-2], lower2: lows[lows.length-1] };
    }
    return null;
}

function detectBearFlag(highs, lows) {
    if(highs.length < 4 || lows.length < 5) return null;
    let flagpoleStart = highs[0];
    let flagpoleEnd = lows[lows.length-3];
    let flagpole = flagpoleStart.price - flagpoleEnd.price;
    let flagpolePct = (flagpole / flagpoleStart.price) * 100;
    if(flagpolePct < 2) return null;
    let channelLower = lows[lows.length-2], channelUpper = lows[lows.length-1];
    let channelSlope = percentSlope(channelLower.price, channelUpper.price, channelUpper.index - channelLower.index);
    if(channelSlope > TREND_THRESHOLD) {
        return { name: "Bear Flag", icon: "🏁", bias: "bearish", upper1: highs[highs.length-2], upper2: highs[highs.length-1], lower1: channelLower, lower2: channelUpper };
    }
    return null;
}

function detectRectangleRange(highs, lows) {
    if(highs.length < 3 || lows.length < 3) return null;
    let h1 = highs[highs.length-3], h2 = highs[highs.length-1];
    let l1 = lows[lows.length-3], l2 = lows[lows.length-1];
    let hSlope = percentSlope(h1.price, h2.price, h2.index - h1.index);
    let lSlope = percentSlope(l1.price, l2.price, l2.index - l1.index);
    let rangeHeight = Math.abs((h1.price + h2.price) / 2 - (l1.price + l2.price) / 2) / ((h1.price + h2.price) / 2);
    if(Math.abs(hSlope) < FLAT_THRESHOLD && Math.abs(lSlope) < FLAT_THRESHOLD && rangeHeight > 0.01) {
        return { name: "Rectangle Range", icon: "⬜", bias: "neutral", upper1: h1, upper2: h2, lower1: l1, lower2: l2 };
    }
    return null;
}

function detectRisingChannel(highs, lows) {
    if(highs.length < 2 || lows.length < 2) return null;
    let h1 = highs[highs.length-2], h2 = highs[highs.length-1];
    let l1 = lows[lows.length-2], l2 = lows[lows.length-1];
    let hSlope = percentSlope(h1.price, h2.price, h2.index - h1.index);
    let lSlope = percentSlope(l1.price, l2.price, l2.index - l1.index);
    if(hSlope > TREND_THRESHOLD && lSlope > TREND_THRESHOLD && Math.abs(hSlope - lSlope) < TREND_THRESHOLD) {
        return { name: "Rising Channel", icon: "📈", bias: "bullish", upper1: h1, upper2: h2, lower1: l1, lower2: l2 };
    }
    return null;
}

function detectFallingChannel(highs, lows) {
    if(highs.length < 2 || lows.length < 2) return null;
    let h1 = highs[highs.length-2], h2 = highs[highs.length-1];
    let l1 = lows[lows.length-2], l2 = lows[lows.length-1];
    let hSlope = percentSlope(h1.price, h2.price, h2.index - h1.index);
    let lSlope = percentSlope(l1.price, l2.price, l2.index - l1.index);
    if(hSlope < -TREND_THRESHOLD && lSlope < -TREND_THRESHOLD && Math.abs(hSlope - lSlope) < TREND_THRESHOLD) {
        return { name: "Falling Channel", icon: "📉", bias: "bearish", upper1: h1, upper2: h2, lower1: l1, lower2: l2 };
    }
    return null;
}

function detectBOSBullish(candles, idx, swings) {
    if(swings.highs.length < 2 || idx < 1) return null;
    let recentHigh = swings.highs[swings.highs.length-1];
    let previousHigh = swings.highs[swings.highs.length-2];
    if(candles[idx].high > previousHigh.price && recentHigh.index === idx && recentHigh.price > previousHigh.price * 1.005) {
        return { name: "Break of Structure", icon: "🔨", bias: "bullish", brokenLevel: previousHigh.price, breakoutCandle: idx };
    }
    return null;
}

function detectBOSBearish(candles, idx, swings) {
    if(swings.lows.length < 2 || idx < 1) return null;
    let recentLow = swings.lows[swings.lows.length-1];
    let previousLow = swings.lows[swings.lows.length-2];
    if(candles[idx].low < previousLow.price && recentLow.index === idx && recentLow.price < previousLow.price * 0.995) {
        return { name: "Break of Structure", icon: "🔨", bias: "bearish", brokenLevel: previousLow.price, breakoutCandle: idx };
    }
    return null;
}

function detectLiquiditySweepHigh(candles, idx, swings) {
    if(swings.highs.length < 2 || idx < 1) return null;
    let previousHigh = swings.highs[swings.highs.length-2];
    if(candles[idx].high > previousHigh.price && candles[idx].close < previousHigh.price) {
        return { name: "Liquidity Sweep High", icon: "🧹", bias: "bearish", sweptLevel: previousHigh.price, sweepCandle: idx };
    }
    return null;
}

function detectLiquiditySweepLow(candles, idx, swings) {
    if(swings.lows.length < 2 || idx < 1) return null;
    let previousLow = swings.lows[swings.lows.length-2];
    if(candles[idx].low < previousLow.price && candles[idx].close > previousLow.price) {
        return { name: "Liquidity Sweep Low", icon: "🧹", bias: "bullish", sweptLevel: previousLow.price, sweepCandle: idx };
    }
    return null;
}

function detectHigherHigh(swings) {
    if(swings.highs.length < 2) return null;
    let h1 = swings.highs[swings.highs.length-2], h2 = swings.highs[swings.highs.length-1];
    if(h2.price > h1.price) {
        return { name: "Higher High", icon: "📈", bias: "bullish", point1: h1, point2: h2 };
    }
    return null;
}

function detectLowerLow(swings) {
    if(swings.lows.length < 2) return null;
    let l1 = swings.lows[swings.lows.length-2], l2 = swings.lows[swings.lows.length-1];
    if(l2.price < l1.price) {
        return { name: "Lower Low", icon: "📉", bias: "bearish", point1: l1, point2: l2 };
    }
    return null;
}

function detectHigherLow(swings) {
    if(swings.lows.length < 2) return null;
    let l1 = swings.lows[swings.lows.length-2], l2 = swings.lows[swings.lows.length-1];
    if(l2.price > l1.price) {
        return { name: "Higher Low", icon: "📈", bias: "bullish", point1: l1, point2: l2 };
    }
    return null;
}

function detectLowerHigh(swings) {
    if(swings.highs.length < 2) return null;
    let h1 = swings.highs[swings.highs.length-2], h2 = swings.highs[swings.highs.length-1];
    if(h2.price < h1.price) {
        return { name: "Lower High", icon: "📉", bias: "bearish", point1: h1, point2: h2 };
    }
    return null;
}

function detectSupportBounce(candles, idx, troughs) {
    if(troughs.length < 2 || idx < 1) return null;
    let support = troughs[troughs.length-2];
    if(candles[idx].low <= support.price * 1.005 && candles[idx].close > support.price && candles[idx].close > candles[idx].open) {
        return { name: "Support Bounce", icon: "🔄", bias: "bullish", supportLevel: support.price, bounceCandle: idx };
    }
    return null;
}

function detectResistanceRejection(candles, idx, peaks) {
    if(peaks.length < 2 || idx < 1) return null;
    let resistance = peaks[peaks.length-2];
    if(candles[idx].high >= resistance.price * 0.995 && candles[idx].close < resistance.price && candles[idx].close < candles[idx].open) {
        return { name: "Resistance Rejection", icon: "🔄", bias: "bearish", resistanceLevel: resistance.price, rejectionCandle: idx };
    }
    return null;
}

// ============================================================================
// MAIN PATTERN DETECTION ORCHESTRATOR
// ============================================================================

function detectPatternsAtCandle(candles, idx) {
    let patterns = [];
    let c = candles[idx];
    
    // === CANDLESTICK PATTERNS ===
    
    if(isDoji(c)) patterns.push({ id: "doji", name: "Doji", icon: "➕", type: "candle", bias: "neutral", status: "Single candle" });
    if(isDragonflyDoji(c)) patterns.push({ id: "dragonfly_doji", name: "Dragonfly Doji", icon: "🪰", type: "candle", bias: "bullish", status: "Reversal signal" });
    if(isGravestoneDoji(c)) patterns.push({ id: "gravestone_doji", name: "Gravestone Doji", icon: "🪦", type: "candle", bias: "bearish", status: "Reversal signal" });
    if(isLongLeggedDoji(c)) patterns.push({ id: "long_legged_doji", name: "Long Legged Doji", icon: "🦵", type: "candle", bias: "neutral", status: "Indecision" });
    if(isSpinningTop(c)) patterns.push({ id: "spinning_top", name: "Spinning Top", icon: "🎠", type: "candle", bias: "neutral", status: "Indecision" });
    
    if(isBullishEngulfing(candles, idx)) patterns.push({ id: "bullish_engulfing", name: "Bullish Engulfing", icon: "🟢", type: "candle", bias: "bullish", status: "Two-candle reversal" });
    if(isBearishEngulfing(candles, idx)) patterns.push({ id: "bearish_engulfing", name: "Bearish Engulfing", icon: "🔴", type: "candle", bias: "bearish", status: "Two-candle reversal" });
    if(isBullishOutsideBar(candles, idx)) patterns.push({ id: "bullish_outside_bar", name: "Bullish Outside Bar", icon: "📊", type: "candle", bias: "bullish", status: "Strong momentum" });
    if(isBearishOutsideBar(candles, idx)) patterns.push({ id: "bearish_outside_bar", name: "Bearish Outside Bar", icon: "📊", type: "candle", bias: "bearish", status: "Strong momentum" });
    if(isInsideBar(candles, idx)) patterns.push({ id: "inside_bar", name: "Inside Bar", icon: "📦", type: "candle", bias: "neutral", status: "Inside range" });
    
    if(isHammer(candles, idx)) patterns.push({ id: "hammer", name: "Hammer", icon: "🔨", type: "candle", bias: "bullish", status: "Potential reversal after downtrend" });
    if(isInvertedHammer(candles, idx)) patterns.push({ id: "inverted_hammer", name: "Inverted Hammer", icon: "🔨", type: "candle", bias: "bullish", status: "Potential reversal after downtrend" });
    if(isHangingMan(candles, idx)) patterns.push({ id: "hanging_man", name: "Hanging Man", icon: "🪢", type: "candle", bias: "bearish", status: "Potential reversal after uptrend" });
    if(isShootingStar(candles, idx)) patterns.push({ id: "shooting_star", name: "Shooting Star", icon: "⭐", type: "candle", bias: "bearish", status: "Potential reversal after uptrend" });
    
    if(isThreeWhiteSoldiers(candles, idx)) patterns.push({ id: "three_white_soldiers", name: "Three White Soldiers", icon: "👩‍👩‍👧", type: "candle", bias: "bullish", status: "Strong momentum" });
    if(isThreeBlackCrows(candles, idx)) patterns.push({ id: "three_black_crows", name: "Three Black Crows", icon: "🐦‍⬛", type: "candle", bias: "bearish", status: "Strong momentum" });
    
    if(isMorningStar(candles, idx)) patterns.push({ id: "morning_star", name: "Morning Star", icon: "⭐", type: "candle", bias: "bullish", status: "Three-candle reversal after downtrend" });
    if(isEveningStar(candles, idx)) patterns.push({ id: "evening_star", name: "Evening Star", icon: "⭐", type: "candle", bias: "bearish", status: "Three-candle reversal after uptrend" });
    if(isPiercingPattern(candles, idx)) patterns.push({ id: "piercing_pattern", name: "Piercing Pattern", icon: "📌", type: "candle", bias: "bullish", status: "Two-candle reversal after downtrend" });
    if(isDarkCloudCover(candles, idx)) patterns.push({ id: "dark_cloud_cover", name: "Dark Cloud Cover", icon: "☁️", type: "candle", bias: "bearish", status: "Two-candle reversal after uptrend" });
    
    if(isTweezerTop(candles, idx)) patterns.push({ id: "tweezer_top", name: "Tweezer Top", icon: "✂️", type: "candle", bias: "bearish", status: "Two-candle reversal after uptrend" });
    if(isTweezerBottom(candles, idx)) patterns.push({ id: "tweezer_bottom", name: "Tweezer Bottom", icon: "✂️", type: "candle", bias: "bullish", status: "Two-candle reversal after downtrend" });
    if(isBullishHarami(candles, idx)) patterns.push({ id: "bullish_harami", name: "Bullish Harami", icon: "🤰", type: "candle", bias: "bullish", status: "Two-candle reversal after downtrend" });
    if(isBearishHarami(candles, idx)) patterns.push({ id: "bearish_harami", name: "Bearish Harami", icon: "🤰", type: "candle", bias: "bearish", status: "Two-candle reversal after uptrend" });
    
    if(isBullishKicker(candles, idx)) patterns.push({ id: "bullish_kicker", name: "Bullish Kicker", icon: "⚡", type: "candle", bias: "bullish", status: "Strong reversal" });
    if(isBearishKicker(candles, idx)) patterns.push({ id: "bearish_kicker", name: "Bearish Kicker", icon: "⚡", type: "candle", bias: "bearish", status: "Strong reversal" });
    
    if(isBullishMarubozu(c)) patterns.push({ id: "bullish_marubozu", name: "Bullish Marubozu", icon: "📊", type: "candle", bias: "bullish", status: "Strong momentum" });
    if(isBearishMarubozu(c)) patterns.push({ id: "bearish_marubozu", name: "Bearish Marubozu", icon: "📊", type: "candle", bias: "bearish", status: "Strong momentum" });
    
    if(isNR4(candles, idx)) patterns.push({ id: "nr4", name: "NR4", icon: "📏", type: "candle", bias: "neutral", status: "Narrow range - potential breakout" });
    if(isNR7(candles, idx)) patterns.push({ id: "nr7", name: "NR7", icon: "📏", type: "candle", bias: "neutral", status: "Very narrow range - high probability breakout" });
    
    if(isLongLowerWickRejection(c)) patterns.push({ id: "long_lower_wick_rejection", name: "Long Lower Wick Rejection", icon: "🕯️", type: "candle", bias: "bullish", status: "Buyer rejection" });
    if(isLongUpperWickRejection(c)) patterns.push({ id: "long_upper_wick_rejection", name: "Long Upper Wick Rejection", icon: "🕯️", type: "candle", bias: "bearish", status: "Seller rejection" });
    
    // === CHART PATTERNS (reduced requirement from 80 to 40 candles) ===
    
    if(idx > 40) {
        let start = Math.max(0, idx - 200);
        let windowCandles = candles.slice(start, idx + 1);
        let swings = findSwingPoints(windowCandles, 3);
        
        swings.highs.forEach(p => { p.index += start; p.time = candles[p.index].time; p.price = candles[p.index].high; });
        swings.lows.forEach(p => { p.index += start; p.time = candles[p.index].time; p.price = candles[p.index].low; });
        
        let extrema = findLocalExtrema(windowCandles, 5);
        let globalPeaks = extrema.peaks.map(p => ({ index: p.index + start, price: p.price, time: candles[p.index + start].time }));
        let globalTroughs = extrema.troughs.map(p => ({ index: p.index + start, price: p.price, time: candles[p.index + start].time }));
        
        // Debug output (enable by setting ENABLE_DEBUG = true above)
        debugLog(`Pattern scan at idx ${idx}`, { peaks: globalPeaks.length, troughs: globalTroughs.length, idx });
        
        // Triangles, Wedges, Pennants
        if(swings.highs.length >= 3 && swings.lows.length >= 3) {
            let ascending = detectAscendingTriangle(swings.highs, swings.lows); if(ascending) patterns.push({ id: "ascending_triangle", name: ascending.name, icon: ascending.icon, type: "chart", bias: ascending.bias, status: "Detected", anchors: ascending });
            let descending = detectDescendingTriangle(swings.highs, swings.lows); if(descending) patterns.push({ id: "descending_triangle", name: descending.name, icon: descending.icon, type: "chart", bias: descending.bias, status: "Detected", anchors: descending });
            let symmetrical = detectSymmetricalTriangle(swings.highs, swings.lows); if(symmetrical) patterns.push({ id: "symmetrical_triangle", name: symmetrical.name, icon: symmetrical.icon, type: "chart", bias: symmetrical.bias, status: "Detected", anchors: symmetrical });
            let risingWedge = detectRisingWedge(swings.highs, swings.lows); if(risingWedge) patterns.push({ id: "rising_wedge", name: risingWedge.name, icon: risingWedge.icon, type: "chart", bias: risingWedge.bias, status: "Detected", anchors: risingWedge });
            let fallingWedge = detectFallingWedge(swings.highs, swings.lows); if(fallingWedge) patterns.push({ id: "falling_wedge", name: fallingWedge.name, icon: fallingWedge.icon, type: "chart", bias: fallingWedge.bias, status: "Detected", anchors: fallingWedge });
            let bullishPennant = detectBullishPennant(swings.highs, swings.lows); if(bullishPennant) patterns.push({ id: "bullish_pennant", name: bullishPennant.name, icon: bullishPennant.icon, type: "chart", bias: bullishPennant.bias, status: "Detected", anchors: bullishPennant });
            let bearishPennant = detectBearishPennant(swings.highs, swings.lows); if(bearishPennant) patterns.push({ id: "bearish_pennant", name: bearishPennant.name, icon: bearishPennant.icon, type: "chart", bias: bearishPennant.bias, status: "Detected", anchors: bearishPennant });
            
            let risingChannel = detectRisingChannel(swings.highs, swings.lows); if(risingChannel) patterns.push({ id: "rising_channel", name: risingChannel.name, icon: risingChannel.icon, type: "chart", bias: risingChannel.bias, status: "Detected", anchors: risingChannel });
            let fallingChannel = detectFallingChannel(swings.highs, swings.lows); if(fallingChannel) patterns.push({ id: "falling_channel", name: fallingChannel.name, icon: fallingChannel.icon, type: "chart", bias: fallingChannel.bias, status: "Detected", anchors: fallingChannel });
            let rectangle = detectRectangleRange(swings.highs, swings.lows); if(rectangle) patterns.push({ id: "rectangle_range", name: rectangle.name, icon: rectangle.icon, type: "chart", bias: rectangle.bias, status: "Detected", anchors: rectangle });
            
            let bullFlag = detectBullFlag(swings.highs, swings.lows); if(bullFlag) patterns.push({ id: "bull_flag", name: bullFlag.name, icon: bullFlag.icon, type: "chart", bias: bullFlag.bias, status: "Detected", anchors: bullFlag });
            let bearFlag = detectBearFlag(swings.highs, swings.lows); if(bearFlag) patterns.push({ id: "bear_flag", name: bearFlag.name, icon: bearFlag.icon, type: "chart", bias: bearFlag.bias, status: "Detected", anchors: bearFlag });
        }
        
        // Double/Triple Tops and Bottoms
        let doubleTop = detectDoubleTop(candles, globalPeaks, idx, 20); if(doubleTop) patterns.push({ id: "double_top", name: doubleTop.name, icon: doubleTop.icon, type: "chart", bias: doubleTop.bias, status: "Confirmed", anchors: doubleTop });
        let doubleBottom = detectDoubleBottom(candles, globalTroughs, idx, 20); if(doubleBottom) patterns.push({ id: "double_bottom", name: doubleBottom.name, icon: doubleBottom.icon, type: "chart", bias: doubleBottom.bias, status: "Confirmed", anchors: doubleBottom });
        let tripleTop = detectTripleTop(candles, globalPeaks, idx, 20); if(tripleTop) patterns.push({ id: "triple_top", name: tripleTop.name, icon: tripleTop.icon, type: "chart", bias: tripleTop.bias, status: "Confirmed", anchors: tripleTop });
        let tripleBottom = detectTripleBottom(candles, globalTroughs, idx, 20); if(tripleBottom) patterns.push({ id: "triple_bottom", name: tripleBottom.name, icon: tripleBottom.icon, type: "chart", bias: tripleBottom.bias, status: "Confirmed", anchors: tripleBottom });
        
        // Cup and Handle
        let cupAndHandle = detectCupAndHandle(candles, globalPeaks, globalTroughs, idx, 25);
        if(cupAndHandle) patterns.push({ id: "cup_and_handle", name: cupAndHandle.name, icon: cupAndHandle.icon, type: "chart", bias: cupAndHandle.bias, status: "Formed", anchors: cupAndHandle });
        
        // Head and Shoulders
        let headShoulders = detectHeadAndShoulders(candles, globalPeaks, idx, 25);
        if(headShoulders) patterns.push({ id: "head_shoulders", name: headShoulders.name, icon: headShoulders.icon, type: "chart", bias: headShoulders.bias, status: "Confirmed", anchors: headShoulders });
        
        let inverseHeadShoulders = detectInverseHeadAndShoulders(candles, globalTroughs, idx, 25);
        if(inverseHeadShoulders) patterns.push({ id: "inverse_head_shoulders", name: inverseHeadShoulders.name, icon: inverseHeadShoulders.icon, type: "chart", bias: inverseHeadShoulders.bias, status: "Confirmed", anchors: inverseHeadShoulders });
        
        // Market structure patterns
        if(swings.highs.length >= 2 && swings.lows.length >= 2) {
            let bosBullish = detectBOSBullish(candles, idx, swings); if(bosBullish) patterns.push({ id: "bos_bullish", name: bosBullish.name, icon: bosBullish.icon, type: "chart", bias: bosBullish.bias, status: "Detected", anchors: bosBullish });
            let bosBearish = detectBOSBearish(candles, idx, swings); if(bosBearish) patterns.push({ id: "bos_bearish", name: bosBearish.name, icon: bosBearish.icon, type: "chart", bias: bosBearish.bias, status: "Detected", anchors: bosBearish });
            let liqSweepHigh = detectLiquiditySweepHigh(candles, idx, swings); if(liqSweepHigh) patterns.push({ id: "liquidity_sweep_high", name: liqSweepHigh.name, icon: liqSweepHigh.icon, type: "chart", bias: liqSweepHigh.bias, status: "Detected", anchors: liqSweepHigh });
            let liqSweepLow = detectLiquiditySweepLow(candles, idx, swings); if(liqSweepLow) patterns.push({ id: "liquidity_sweep_low", name: liqSweepLow.name, icon: liqSweepLow.icon, type: "chart", bias: liqSweepLow.bias, status: "Detected", anchors: liqSweepLow });
            
            let higherHigh = detectHigherHigh(swings); if(higherHigh && isRecentlyConfirmed(higherHigh.point2, idx, 15)) patterns.push({ id: "higher_high", name: higherHigh.name, icon: higherHigh.icon, type: "chart", bias: higherHigh.bias, status: "Detected", anchors: higherHigh });
            let lowerLow = detectLowerLow(swings); if(lowerLow && isRecentlyConfirmed(lowerLow.point2, idx, 15)) patterns.push({ id: "lower_low", name: lowerLow.name, icon: lowerLow.icon, type: "chart", bias: lowerLow.bias, status: "Detected", anchors: lowerLow });
            let higherLow = detectHigherLow(swings); if(higherLow && isRecentlyConfirmed(higherLow.point2, idx, 15)) patterns.push({ id: "higher_low", name: higherLow.name, icon: higherLow.icon, type: "chart", bias: higherLow.bias, status: "Detected", anchors: higherLow });
            let lowerHigh = detectLowerHigh(swings); if(lowerHigh && isRecentlyConfirmed(lowerHigh.point2, idx, 15)) patterns.push({ id: "lower_high", name: lowerHigh.name, icon: lowerHigh.icon, type: "chart", bias: lowerHigh.bias, status: "Detected", anchors: lowerHigh });
            
            let supportBounce = detectSupportBounce(candles, idx, swings.lows); if(supportBounce) patterns.push({ id: "support_bounce", name: supportBounce.name, icon: supportBounce.icon, type: "chart", bias: supportBounce.bias, status: "Detected", anchors: supportBounce });
            let resistanceRejection = detectResistanceRejection(candles, idx, swings.highs); if(resistanceRejection) patterns.push({ id: "resistance_rejection", name: resistanceRejection.name, icon: resistanceRejection.icon, type: "chart", bias: resistanceRejection.bias, status: "Detected", anchors: resistanceRejection });
        }
    }
    
    return patterns;
}

// ============================================================================
// DATA UTILITIES
// ============================================================================

function generateRandomCandles(count) {
    let candles = [], price = 25000 + Math.random() * 5000;
    for(let i = 0; i < count; i++) {
        let open = price;
        let close = price + (Math.random() - 0.5) * 200;
        let high = Math.max(open, close) + Math.random() * 100;
        let low = Math.min(open, close) - Math.random() * 100;
        candles.push({ time: Date.now() / 1000 - (count - i) * 3600, open, high, low, close, volume: Math.random() * 10000 });
        price = close;
    }
    return candles;
}

function resampleCandles(candles, tf) {
    const mins = { '1m': 1, '5m': 5, '15m': 15, '1h': 60, '1d': 1440 }[tf] || 60;
    let res = [], group = null;
    for(let c of candles) {
        let t = Math.floor(c.time / (mins * 60)) * (mins * 60);
        if(!group || group.time !== t) {
            if(group) res.push(group);
            group = { time: t, open: c.open, high: c.high, low: c.low, close: c.close, volume: c.volume };
        } else {
            group.high = Math.max(group.high, c.high);
            group.low = Math.min(group.low, c.low);
            group.close = c.close;
            group.volume += c.volume;
        }
    }
    if(group) res.push(group);
    return res;
}

function calculateMA(data, p) {
    let ma = [];
    for(let i = p - 1; i < data.length; i++) {
        let sum = 0;
        for(let j = 0; j < p; j++) sum += data[i - j].close;
        ma.push({ time: data[i].time, value: sum / p });
    }
    return ma;
}

// ============================================================================
// ALPINE.JS APPLICATION COMPONENT
// ============================================================================

document.addEventListener('alpine:init', () => {
    Alpine.data('tradingDashboard', () => ({
        activeMode: 'demo',
        cryptoSymbol: 'BTC-USD',
        cryptoTimeframe: '15m',
        wsStatus: 'disconnected',
        livePrice: null,
        scannerActive: false,
        connectionError: '',
        ws: null,
        historicalData: [],
        selectedTimeframe: '1h',
        chart: null,
        candlestickSeries: null,
        ma20Series: null,
        ma50Series: null,
        testCount: 500,
        qualifiedBestEdge: null,
        activeTab: 'current',
        historicalLimit: 50,
        selectedPattern: null,
        extraSeries: [],
        userFocusedPattern: false,
        currentPatterns: [],
        recentPatterns: [],
        historicalPatterns: [],
        bestChartStructure: null,
        bestCandlestick: null,
        
        initApp() { this.resetToSampleData(); this.initChart(); },
        
        initChart() {
            let div = document.getElementById('candlestick-chart');
            if(!div) return;
            this.chart = LightweightCharts.createChart(div, {
                width: div.clientWidth, height: 420,
                layout: { background: { type: 'solid', color: '#020617' }, textColor: '#CBD5E1' },
                grid: { vertLines: { color: '#1E293B' }, horzLines: { color: '#1E293B' } }
            });
            this.candlestickSeries = this.chart.addCandlestickSeries({ upColor: '#22C55E', downColor: '#EF4444' });
            this.ma20Series = this.chart.addLineSeries({ color: '#F59E0B', lineWidth: 1 });
            this.ma50Series = this.chart.addLineSeries({ color: '#8B5CF6', lineWidth: 1 });
            window.addEventListener('resize', () => this.chart?.applyOptions({ width: div.clientWidth }));
            this.updateChart();
        },
        
        updateChart() {
            if(!this.candlestickSeries) return;
            let data = resampleCandles(this.historicalData, this.selectedTimeframe);
            if(!data.length) return;
            this.candlestickSeries.setData(data);
            this.ma20Series.setData(calculateMA(data, 20));
            this.ma50Series.setData(calculateMA(data, 50));
            this.scanAllPatterns();
        },
        
        scanAllPatterns() {
            let display = resampleCandles(this.historicalData, this.selectedTimeframe);
            if(!display.length) return;
            let current = [], recent = [], historical = [];
            for(let i = 0; i < display.length; i++) {
                let patterns = detectPatternsAtCandle(display, i);
                for(let p of patterns) {
                    let patternObj = {
                        id: `${p.id}_${i}`, baseId: p.id, name: p.name, icon: p.icon,
                        type: p.type, bias: p.bias, status: p.status,
                        candleIndex: i, time: display[i].time, anchors: p.anchors
                    };
                    const stats = StatsEngine.computePatternStats(p.id, display, [3, 5, 10, 20]);
                    if(stats) patternObj.stats = stats;
                    if(i >= display.length - 20) current.push(patternObj);
                    else if(i >= display.length - 100) recent.push(patternObj);
                    else historical.push(patternObj);
                }
            }
            this.currentPatterns = current;
            this.recentPatterns = recent;
            this.historicalPatterns = historical;
            this.bestChartStructure = current.find(p => p.type === 'chart') || recent.find(p => p.type === 'chart');
            this.bestCandlestick = current.find(p => p.type === 'candle') || recent.find(p => p.type === 'candle');
            let candidates = [...current, ...recent].filter(p => p.stats && p.stats.sampleSize >= 5);
            if(candidates.length) {
                candidates.sort((a, b) => (b.stats?.weightedScore || 0) - (a.stats?.weightedScore || 0));
                const best = candidates[0];
                this.qualifiedBestEdge = { ...best.stats, name: best.name, icon: best.icon, bias: best.stats.bias };
            } else {
                this.qualifiedBestEdge = null;
            }
        },
        
        clearDrawing() {
            this.extraSeries.forEach(s => this.chart?.removeSeries(s));
            this.extraSeries = [];
            this.selectedPattern = null;
            this.userFocusedPattern = false;
            this.candlestickSeries?.setMarkers([]);
        },
        
        drawStructureOnChart(pattern) {
            if(!this.chart) return;
            const display = resampleCandles(this.historicalData, this.selectedTimeframe);
            if(pattern.type === 'candle') {
                if(display[pattern.candleIndex]) {
                    this.candlestickSeries.setMarkers([{
                        time: display[pattern.candleIndex].time,
                        position: pattern.bias === 'bearish' ? 'aboveBar' : 'belowBar',
                        color: pattern.bias === 'bearish' ? '#EF4444' : '#22C55E',
                        shape: pattern.bias === 'bearish' ? 'arrowDown' : 'arrowUp',
                        text: `${pattern.icon} ${pattern.name}`
                    }]);
                }
                return;
            }
            if(pattern.type !== 'chart' || !pattern.anchors) return;
            const a = pattern.anchors;
            
            if(a.upper1 && a.upper2 && a.lower1 && a.lower2 && a.upper1.index !== undefined) {
                const endIdx = Math.min(display.length - 1, pattern.candleIndex + 10);
                const drawTrendline = (p1, p2, color) => {
                    const series = this.chart.addLineSeries({ color, lineWidth: 3, lineStyle: 0 });
                    const startIdx = p1.index;
                    const finalIdx = Math.max(p2.index, endIdx);
                    const data = [];
                    for(let x = startIdx; x <= finalIdx && x < display.length; x++) {
                        if(!display[x]) continue;
                        data.push({ time: display[x].time, value: lineValue(p1.price, p2.price, p1.index, p2.index, x) });
                    }
                    series.setData(data);
                    this.extraSeries.push(series);
                };
                drawTrendline(a.upper1, a.upper2, '#F59E0B');
                drawTrendline(a.lower1, a.lower2, '#22D3EE');
                this.candlestickSeries.setMarkers([
                    { time: a.upper1.time, position: 'aboveBar', color: '#F59E0B', shape: 'circle', text: 'Upper' },
                    { time: a.upper2.time, position: 'aboveBar', color: '#F59E0B', shape: 'circle', text: 'Upper' },
                    { time: a.lower1.time, position: 'belowBar', color: '#22D3EE', shape: 'circle', text: 'Lower' },
                    { time: a.lower2.time, position: 'belowBar', color: '#22D3EE', shape: 'circle', text: 'Lower' }
                ]);
            }
            else if(a.neckline1 && a.neckline2) {
                const endIdx = Math.min(display.length - 1, pattern.candleIndex + 10);
                const series = this.chart.addLineSeries({ color: '#A855F7', lineWidth: 2, lineStyle: 1 });
                const data = [];
                for(let x = a.neckline1.index; x <= Math.max(a.neckline2.index, endIdx) && x < display.length; x++) {
                    if(!display[x]) continue;
                    data.push({ time: display[x].time, value: lineValue(a.neckline1.price, a.neckline2.price, a.neckline1.index, a.neckline2.index, x) });
                }
                series.setData(data);
                this.extraSeries.push(series);
                if(a.leftShoulder) {
                    this.candlestickSeries.setMarkers([
                        { time: a.leftShoulder.time, position: 'aboveBar', color: '#F59E0B', shape: 'circle', text: 'Left' },
                        { time: a.head.time, position: 'aboveBar', color: '#EF4444', shape: 'circle', text: 'Head' },
                        { time: a.rightShoulder.time, position: 'aboveBar', color: '#F59E0B', shape: 'circle', text: 'Right' }
                    ]);
                } else if(a.leftTrough) {
                    this.candlestickSeries.setMarkers([
                        { time: a.leftTrough.time, position: 'belowBar', color: '#22D3EE', shape: 'circle', text: 'Left' },
                        { time: a.head.time, position: 'belowBar', color: '#10B981', shape: 'circle', text: 'Head' },
                        { time: a.rightTrough.time, position: 'belowBar', color: '#22D3EE', shape: 'circle', text: 'Right' }
                    ]);
                }
            }
            else if(a.peak1 && a.peak2) {
                let markers = [];
                if(a.peak1) markers.push({ time: a.peak1.time, position: 'aboveBar', color: '#F59E0B', shape: 'circle', text: 'Peak 1' });
                if(a.peak2) markers.push({ time: a.peak2.time, position: 'aboveBar', color: '#EF4444', shape: 'circle', text: 'Peak 2' });
                if(a.peak3) markers.push({ time: a.peak3.time, position: 'aboveBar', color: '#EF4444', shape: 'circle', text: 'Peak 3' });
                this.candlestickSeries.setMarkers(markers);
            }
            else if(a.trough1 && a.trough2) {
                let markers = [];
                if(a.trough1) markers.push({ time: a.trough1.time, position: 'belowBar', color: '#22D3EE', shape: 'circle', text: 'Trough 1' });
                if(a.trough2) markers.push({ time: a.trough2.time, position: 'belowBar', color: '#10B981', shape: 'circle', text: 'Trough 2' });
                if(a.trough3) markers.push({ time: a.trough3.time, position: 'belowBar', color: '#10B981', shape: 'circle', text: 'Trough 3' });
                this.candlestickSeries.setMarkers(markers);
            }
            else if(a.leftRim && a.cupLow && a.rightRim && a.handleLow) {
                this.candlestickSeries.setMarkers([
                    { time: a.leftRim.time, position: 'aboveBar', color: '#F59E0B', shape: 'circle', text: 'Left Rim' },
                    { time: a.cupLow.time, position: 'belowBar', color: '#22D3EE', shape: 'circle', text: 'Cup Low' },
                    { time: a.rightRim.time, position: 'aboveBar', color: '#F59E0B', shape: 'circle', text: 'Right Rim' },
                    { time: a.handleLow.time, position: 'belowBar', color: '#10B981', shape: 'circle', text: 'Handle Low' }
                ]);
            }
            else if(a.breakoutCandle !== undefined && display[a.breakoutCandle]) {
                this.candlestickSeries.setMarkers([{
                    time: display[a.breakoutCandle].time,
                    position: pattern.bias === 'bullish' ? 'belowBar' : 'aboveBar',
                    color: '#A855F7',
                    shape: pattern.bias === 'bullish' ? 'arrowUp' : 'arrowDown',
                    text: 'BOS'
                }]);
            }
            else if(a.sweepCandle !== undefined && display[a.sweepCandle]) {
                this.candlestickSeries.setMarkers([{
                    time: display[a.sweepCandle].time,
                    position: pattern.bias === 'bearish' ? 'aboveBar' : 'belowBar',
                    color: '#EC4899',
                    shape: 'circle',
                    text: 'Sweep'
                }]);
            }
            else if(a.supportLevel !== undefined && a.bounceCandle !== undefined && display[a.bounceCandle]) {
                this.candlestickSeries.setMarkers([{
                    time: display[a.bounceCandle].time,
                    position: 'belowBar',
                    color: '#22C55E',
                    shape: 'arrowUp',
                    text: 'Bounce'
                }]);
            }
            else if(a.resistanceLevel !== undefined && a.rejectionCandle !== undefined && display[a.rejectionCandle]) {
                this.candlestickSeries.setMarkers([{
                    time: display[a.rejectionCandle].time,
                    position: 'aboveBar',
                    color: '#EF4444',
                    shape: 'arrowDown',
                    text: 'Reject'
                }]);
            }
            else if(a.point1 && a.point2) {
                this.candlestickSeries.setMarkers([
                    { time: a.point1.time, position: pattern.bias === 'bullish' ? 'belowBar' : 'aboveBar', color: '#F59E0B', shape: 'circle', text: 'Swing' },
                    { time: a.point2.time, position: pattern.bias === 'bullish' ? 'belowBar' : 'aboveBar', color: '#F59E0B', shape: 'circle', text: 'Swing' }
                ]);
            }
        },
        
        focusChartAroundPattern(pattern) {
            const display = resampleCandles(this.historicalData, this.selectedTimeframe);
            if(!display.length) return;
            let indexes = [pattern.candleIndex];
            if(pattern.anchors) {
                const anchorKeys = ['upper1', 'upper2', 'lower1', 'lower2', 'peak1', 'peak2', 'peak3', 'trough1', 'trough2', 'trough3', 'leftShoulder', 'head', 'rightShoulder', 'leftTrough', 'rightTrough', 'neckline1', 'neckline2', 'point1', 'point2', 'leftRim', 'cupLow', 'rightRim', 'handleLow'];
                anchorKeys.forEach(k => {
                    if(pattern.anchors[k] && pattern.anchors[k].index !== undefined) indexes.push(pattern.anchors[k].index);
                });
            }
            const minIdx = Math.max(0, Math.min(...indexes) - 20);
            const maxIdx = Math.min(display.length - 1, Math.max(...indexes) + 20);
            this.chart?.timeScale().setVisibleRange({ from: display[minIdx].time, to: display[maxIdx].time });
        },
        
        selectAndDrawPattern(pattern) {
            this.clearDrawing();
            this.selectedPattern = pattern;
            this.userFocusedPattern = true;
            this.drawStructureOnChart(pattern);
            this.focusChartAroundPattern(pattern);
        },
        
        setTimeframe(tf) {
            this.clearDrawing();
            this.selectedTimeframe = tf;
            this.updateChart();
        },
        
        setMode(mode) {
            this.activeMode = mode;
            if(mode === 'demo') this.resetToSampleData();
            else if(mode === 'crypto') this.connectCoinbaseLive();
            else if(mode === 'csv') {
                this.historicalData = [];
                clearAnalysisCaches();
                this.updateChart();
            }
        },
        
        resetToSampleData() {
            if(this.ws) this.ws.close();
            this.historicalData = generateRandomCandles(this.testCount);
            this.activeMode = 'demo';
            clearAnalysisCaches();
            this.updateChart();
        },
        
        loadCSVFile(e) {
            const file = e.target.files[0];
            if(!file) return;
            const reader = new FileReader();
            reader.onload = ev => {
                try {
                    const parsed = Papa.parse(ev.target.result, {
                        header: true,
                        skipEmptyLines: true,
                        transformHeader: h => h.trim().replace(/"/g, '').toLowerCase()
                    });
                    const ohlcv = parsed.data.map(row => {
                        const dateRaw = row.date;
                        let time = Number(dateRaw);
                        if(isNaN(time)) {
                            const parsedDate = new Date(dateRaw);
                            time = Math.floor(parsedDate.getTime() / 1000);
                        }
                        let closeValue = parseFloat(row.close);
                        if(isNaN(closeValue) && row.adj_close) {
                            closeValue = parseFloat(row.adj_close);
                        }
                        return {
                            time: time,
                            open: parseFloat(row.open),
                            high: parseFloat(row.high),
                            low: parseFloat(row.low),
                            close: closeValue,
                            volume: parseFloat(row.volume || 0)
                        };
                    }).filter(c => Number.isFinite(c.time) && Number.isFinite(c.open) && Number.isFinite(c.high) && Number.isFinite(c.low) && Number.isFinite(c.close))
                      .sort((a, b) => a.time - b.time);
                    if(ohlcv.length < 50) {
                        throw new Error(`Only ${ohlcv.length} valid candles found. Need at least 50.`);
                    }
                    this.clearDrawing();
                    this.historicalData = ohlcv;
                    this.activeMode = 'csv';
                    clearAnalysisCaches();
                    this.updateChart();
                } catch(err) {
                    alert("CSV import failed: " + err.message);
                }
            };
            reader.readAsText(file);
            e.target.value = '';
        },
        
        connectCoinbaseLive() { this.disconnectWebSocket(); this.fetchCoinbaseCandles(); },
        
        async fetchCoinbaseCandles() {
            let url = `https://api.exchange.coinbase.com/products/${this.cryptoSymbol}/candles?granularity=900`;
            try {
                let resp = await fetch(url);
                if(resp.ok) {
                    let data = await resp.json();
                    this.historicalData = data.map(arr => ({ time: arr[0], low: arr[1], high: arr[2], open: arr[3], close: arr[4], volume: arr[5] })).sort((a, b) => a.time - b.time);
                    clearAnalysisCaches();
                    this.updateChart();
                }
            } catch(e) {}
        },
        
        disconnectWebSocket() {
            if(this.ws) {
                try { this.ws.close(); } catch(e) {}
                this.ws = null;
            }
            this.wsStatus = 'disconnected';
        },
        
        onSymbolChange() { if(this.activeMode === 'crypto') this.connectCoinbaseLive(); },
        onTimeframeChange() { this.selectedTimeframe = this.cryptoTimeframe; if(this.activeMode === 'crypto') this.connectCoinbaseLive(); },
        toggleScannerMode() { this.scannerActive = !this.scannerActive; },
        shareApp() { if(navigator.share) navigator.share({ title: "CandleEdge" }); else alert("Link copied"); }
    }));
});