// ============================================================================
// STATISTICAL ENGINE
// ============================================================================
// Caches computed statistics to avoid redundant calculations
// Key format: `${patternId}_${candleCount}_${lastCandleTime}`
const statsCache = new Map();

const StatsEngine = {
    // Computes historical performance statistics for a given pattern across the candle dataset
    // patternId: string identifier like "ascending_triangle", "doji", etc.
    // candles: array of OHLCV candle objects
    // lookbacks: forward window sizes to analyze (3,5,10,20 candles)
    computePatternStats(patternId, candles, lookbacks = [3,5,10,20]) {
        const cacheKey = `${patternId}_${candles.length}_${candles[candles.length-1]?.time}`;
        if (statsCache.has(cacheKey)) return statsCache.get(cacheKey);
        
        // Find all historical occurrences of this exact pattern
        const occurrences = [];
        for(let i = 0; i < candles.length - Math.max(...lookbacks) - 1; i++) {
            const patternsAtCandle = detectPatternsAtCandle(candles, i);
            const match = patternsAtCandle.find(p => p.id === patternId);
            if(match && i < candles.length - 20) {
                occurrences.push({ idx: i, bias: match.bias });
            }
        }
        // Minimum 5 occurrences needed for statistical relevance
        if(occurrences.length < 5) return null;
        
        // Calculate returns for each forward window
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
        
        // Select the best forward window using weighted scoring:
        // - Directional strength (how skewed the probability is)
        // - Average move magnitude
        // - Sample size reliability
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
        
        // Confidence grading based purely on sample size (no AI/ML)
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
// PATTERN DETECTION LOGIC
// ============================================================================
// Finds swing highs and lows using a local window comparison
// windowSize: number of candles on each side to check for local max/min
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

// Math helpers for trendline calculations
function percentSlope(p1, p2, distance) { if(distance <= 0) return 0; let pctChange = ((p2 - p1) / p1) * 100; return pctChange / distance; }
function lineValue(p1, p2, idx1, idx2, x) { if(idx2 === idx1) return p1; let slope = (p2 - p1) / (idx2 - idx1); return p1 + slope * (x - idx1); }

// Thresholds for detecting flat vs sloping trendlines (0.03% per candle)
const FLAT_THRESHOLD = 0.03, TREND_THRESHOLD = 0.03;

// ============================================================================
// CANDLESTICK PATTERN DETECTORS
// ============================================================================
function candleParts(c) { let body = Math.abs(c.close - c.open); let range = c.high - c.low || 1; let upper = c.high - Math.max(c.open, c.close); let lower = Math.min(c.open, c.close) - c.low; return { body, range, upper, lower }; }
function isDoji(c) { let { body, range } = candleParts(c); return body <= range * 0.12; }
function isBullishEngulfing(candles, i) { if(i<1) return false; let p=candles[i-1], c=candles[i]; return p.close<p.open && c.close>c.open && c.open<=p.close && c.close>=p.open; }
function isBearishEngulfing(candles, i) { if(i<1) return false; let p=candles[i-1], c=candles[i]; return p.close>p.open && c.close<c.open && c.open>=p.close && c.close<=p.open; }
function isInsideBar(candles, i) { if(i<1) return false; let p=candles[i-1], c=candles[i]; return c.high<p.high && c.low>p.low; }
function isHammer(c) { let { body, upper, lower } = candleParts(c); return body>0 && lower>body*2 && upper<body*0.5 && c.close>c.open; }
function isShootingStar(c) { let { body, upper, lower } = candleParts(c); return body>0 && upper>body*2 && lower<body*0.5 && c.close<c.open; }
function isThreeWhiteSoldiers(candles, i) { if(i<2) return false; let a=candles[i-2], b=candles[i-1], c=candles[i]; return a.close>a.open && b.close>b.open && c.close>c.open && b.close>a.close && c.close>b.close; }
function isThreeBlackCrows(candles, i) { if(i<2) return false; let a=candles[i-2], b=candles[i-1], c=candles[i]; return a.close<a.open && b.close<b.open && c.close<c.open && b.close<a.close && c.close<b.close; }

// ============================================================================
// CHART PATTERN DETECTORS (Triangles, Wedges, Pennants)
// ============================================================================
// Each detector returns an object with name, icon, bias, and anchor points (upper1, upper2, lower1, lower2)
// Anchors are used later for drawing trendlines on the chart
function detectAscendingTriangle(highs, lows) { if(highs.length < 2 || lows.length < 2) return null; let h1 = highs[highs.length-2], h2 = highs[highs.length-1]; let l1 = lows[lows.length-2], l2 = lows[lows.length-1]; let hDist = h2.index - h1.index; let lDist = l2.index - l1.index; let hSlopePct = percentSlope(h1.price, h2.price, hDist); let lSlopePct = percentSlope(l1.price, l2.price, lDist); if(Math.abs(hSlopePct) < FLAT_THRESHOLD && lSlopePct > TREND_THRESHOLD && l1.price < h1.price) return { name: "Ascending Triangle", icon: "📐", bias: "bullish", upper1: h1, upper2: h2, lower1: l1, lower2: l2 }; return null; }
function detectDescendingTriangle(highs, lows) { if(highs.length < 2 || lows.length < 2) return null; let h1 = highs[highs.length-2], h2 = highs[highs.length-1]; let l1 = lows[lows.length-2], l2 = lows[lows.length-1]; let hDist = h2.index - h1.index; let lDist = l2.index - l1.index; let hSlopePct = percentSlope(h1.price, h2.price, hDist); let lSlopePct = percentSlope(l1.price, l2.price, lDist); if(hSlopePct < -TREND_THRESHOLD && Math.abs(lSlopePct) < FLAT_THRESHOLD && h2.price > l2.price) return { name: "Descending Triangle", icon: "📐", bias: "bearish", upper1: h1, upper2: h2, lower1: l1, lower2: l2 }; return null; }
function detectSymmetricalTriangle(highs, lows) { if(highs.length < 2 || lows.length < 2) return null; let h1 = highs[highs.length-2], h2 = highs[highs.length-1]; let l1 = lows[lows.length-2], l2 = lows[lows.length-1]; let hDist = h2.index - h1.index; let lDist = l2.index - l1.index; let hSlopePct = percentSlope(h1.price, h2.price, hDist); let lSlopePct = percentSlope(l1.price, l2.price, lDist); if(hSlopePct < -TREND_THRESHOLD && lSlopePct > TREND_THRESHOLD && h2.price > l2.price) return { name: "Symmetrical Triangle", icon: "🔺", bias: "neutral", upper1: h1, upper2: h2, lower1: l1, lower2: l2 }; return null; }
function detectRisingWedge(highs, lows) { if(highs.length < 2 || lows.length < 2) return null; let h1 = highs[highs.length-2], h2 = highs[highs.length-1]; let l1 = lows[lows.length-2], l2 = lows[lows.length-1]; let hSlopePct = percentSlope(h1.price, h2.price, h2.index - h1.index); let lSlopePct = percentSlope(l1.price, l2.price, l2.index - l1.index); if(hSlopePct > 0 && lSlopePct > 0 && hSlopePct < lSlopePct) return { name: "Rising Wedge", icon: "📈", bias: "bearish", upper1: h1, upper2: h2, lower1: l1, lower2: l2 }; return null; }
function detectFallingWedge(highs, lows) { if(highs.length < 2 || lows.length < 2) return null; let h1 = highs[highs.length-2], h2 = highs[highs.length-1]; let l1 = lows[lows.length-2], l2 = lows[lows.length-1]; let hSlopePct = percentSlope(h1.price, h2.price, h2.index - h1.index); let lSlopePct = percentSlope(l1.price, l2.price, l2.index - l1.index); if(hSlopePct < 0 && lSlopePct < 0 && hSlopePct < lSlopePct) return { name: "Falling Wedge", icon: "📉", bias: "bullish", upper1: h1, upper2: h2, lower1: l1, lower2: l2 }; return null; }
function detectBullishPennant(highs, lows) { if(highs.length < 3 || lows.length < 3) return null; let flagpole = highs[highs.length-3].price - lows[lows.length-3].price; if(flagpole > 0) return { name: "Bullish Pennant", icon: "🏁", bias: "bullish", upper1: highs[highs.length-2], upper2: highs[highs.length-1], lower1: lows[lows.length-2], lower2: lows[lows.length-1] }; return null; }
function detectBearishPennant(highs, lows) { if(highs.length < 3 || lows.length < 3) return null; let flagpole = highs[highs.length-3].price - lows[lows.length-3].price; if(flagpole < 0) return { name: "Bearish Pennant", icon: "🏁", bias: "bearish", upper1: highs[highs.length-2], upper2: highs[highs.length-1], lower1: lows[lows.length-2], lower2: lows[lows.length-1] }; return null; }

// Main pattern detection orchestrator - called for each candle index
// Returns an array of detected pattern objects
function detectPatternsAtCandle(candles, idx) {
    let patterns = [];
    // Candlestick patterns (single or multi-candle)
    if(isDoji(candles[idx])) patterns.push({ id: "doji", name: "Doji", icon: "➕", type: "candle", bias: "neutral", status: "Single candle" });
    if(isBullishEngulfing(candles, idx)) patterns.push({ id: "bullish_engulfing", name: "Bullish Engulfing", icon: "🟢", type: "candle", bias: "bullish", status: "Two-candle reversal" });
    if(isBearishEngulfing(candles, idx)) patterns.push({ id: "bearish_engulfing", name: "Bearish Engulfing", icon: "🔴", type: "candle", bias: "bearish", status: "Two-candle reversal" });
    if(isInsideBar(candles, idx)) patterns.push({ id: "inside_bar", name: "Inside Bar", icon: "📦", type: "candle", bias: "neutral", status: "Inside range" });
    if(isHammer(candles[idx])) patterns.push({ id: "hammer", name: "Hammer", icon: "🔨", type: "candle", bias: "bullish", status: "Potential reversal" });
    if(isShootingStar(candles[idx])) patterns.push({ id: "shooting_star", name: "Shooting Star", icon: "⭐", type: "candle", bias: "bearish", status: "Potential reversal" });
    if(isThreeWhiteSoldiers(candles, idx)) patterns.push({ id: "three_white_soldiers", name: "Three White Soldiers", icon: "👩‍👩‍👧", type: "candle", bias: "bullish", status: "Strong momentum" });
    if(isThreeBlackCrows(candles, idx)) patterns.push({ id: "three_black_crows", name: "Three Black Crows", icon: "🐦‍⬛", type: "candle", bias: "bearish", status: "Strong momentum" });
    
    // Chart patterns (require swing points, only check after 30 candles for sufficient data)
    if(idx > 30) {
        let start = Math.max(0, idx - 100);
        let windowCandles = candles.slice(start, idx + 1);
        let swings = findSwingPoints(windowCandles, 3);
        swings.highs.forEach(p => { p.index += start; p.time = candles[p.index].time; p.price = candles[p.index].high; });
        swings.lows.forEach(p => { p.index += start; p.time = candles[p.index].time; p.price = candles[p.index].low; });
        if(swings.highs.length >= 2 && swings.lows.length >= 2) {
            let ascending = detectAscendingTriangle(swings.highs, swings.lows); if(ascending) patterns.push({ id: "ascending_triangle", name: ascending.name, icon: ascending.icon, type: "chart", bias: ascending.bias, status: "Detected", anchors: ascending });
            let descending = detectDescendingTriangle(swings.highs, swings.lows); if(descending) patterns.push({ id: "descending_triangle", name: descending.name, icon: descending.icon, type: "chart", bias: descending.bias, status: "Detected", anchors: descending });
            let symmetrical = detectSymmetricalTriangle(swings.highs, swings.lows); if(symmetrical) patterns.push({ id: "symmetrical_triangle", name: symmetrical.name, icon: symmetrical.icon, type: "chart", bias: symmetrical.bias, status: "Detected", anchors: symmetrical });
            let risingWedge = detectRisingWedge(swings.highs, swings.lows); if(risingWedge) patterns.push({ id: "rising_wedge", name: risingWedge.name, icon: risingWedge.icon, type: "chart", bias: risingWedge.bias, status: "Detected", anchors: risingWedge });
            let fallingWedge = detectFallingWedge(swings.highs, swings.lows); if(fallingWedge) patterns.push({ id: "falling_wedge", name: fallingWedge.name, icon: fallingWedge.icon, type: "chart", bias: fallingWedge.bias, status: "Detected", anchors: fallingWedge });
            let bullishPennant = detectBullishPennant(swings.highs, swings.lows); if(bullishPennant) patterns.push({ id: "bullish_pennant", name: bullishPennant.name, icon: bullishPennant.icon, type: "chart", bias: bullishPennant.bias, status: "Detected", anchors: bullishPennant });
            let bearishPennant = detectBearishPennant(swings.highs, swings.lows); if(bearishPennant) patterns.push({ id: "bearish_pennant", name: bearishPennant.name, icon: bearishPennant.icon, type: "chart", bias: bearishPennant.bias, status: "Detected", anchors: bearishPennant });
        }
    }
    return patterns;
}

// ============================================================================
// DATA UTILITIES
// ============================================================================
// Generates synthetic random candle data for demo mode
function generateRandomCandles(count) { let candles=[], price=25000+Math.random()*5000; for(let i=0;i<count;i++){ let open=price, close=price+(Math.random()-0.5)*200, high=Math.max(open,close)+Math.random()*100, low=Math.min(open,close)-Math.random()*100; candles.push({ time:Date.now()/1000-(count-i)*3600, open, high, low, close, volume:Math.random()*10000 }); price=close; } return candles; }

// Resamples candles to a specified timeframe (1m,5m,15m,1h,1d) by aggregating
function resampleCandles(candles, tf) { const mins={'1m':1,'5m':5,'15m':15,'1h':60,'1d':1440}[tf]||60; let res=[], group=null; for(let c of candles){ let t=Math.floor(c.time/(mins*60))*(mins*60); if(!group||group.time!==t){ if(group) res.push(group); group={time:t,open:c.open,high:c.high,low:c.low,close:c.close,volume:c.volume}; } else { group.high=Math.max(group.high,c.high); group.low=Math.min(group.low,c.low); group.close=c.close; group.volume+=c.volume; } } if(group) res.push(group); return res; }

// Calculates simple moving average for a given period
function calculateMA(data, p) { let ma=[]; for(let i=p-1;i<data.length;i++){ let sum=0; for(let j=0;j<p;j++) sum+=data[i-j].close; ma.push({time:data[i].time, value:sum/p}); } return ma; }

// ============================================================================
// ALPINE.JS APPLICATION COMPONENT
// ============================================================================
// Registers the 'tradingDashboard' component with Alpine.js
document.addEventListener('alpine:init', () => {
    Alpine.data('tradingDashboard', () => ({
        // ====================================================================
        // REACTIVE STATE PROPERTIES
        // ====================================================================
        activeMode:'demo',                    // 'demo', 'csv', or 'crypto'
        cryptoSymbol:'BTC-USD',               // Current crypto symbol for live mode
        cryptoTimeframe:'15m',                // Timeframe for crypto data
        wsStatus:'disconnected',              // WebSocket connection status
        livePrice:null,                       // Latest ticker price
        scannerActive:false,                  // Auto-scanner toggle
        connectionError:'',                   // Error message for connection failures
        ws:null,                              // WebSocket instance
        historicalData:[],                    // Raw OHLCV candle array
        selectedTimeframe:'1h',               // Current chart timeframe
        chart:null,                           // Lightweight Charts instance
        candlestickSeries:null,               // Main candlestick series
        ma20Series:null,                      // 20-period moving average line
        ma50Series:null,                      // 50-period moving average line
        testCount:500,                        // Number of demo candles to generate
        qualifiedBestEdge:null,               // Best statistically-validated pattern
        activeTab:'current',                  // 'current', 'recent', or 'historical'
        historicalLimit:50,                   // Max historical patterns to display
        selectedPattern:null,                 // Currently selected pattern (for drawing)
        extraSeries:[],                       // Additional chart series (trendlines, etc.)
        userFocusedPattern:false,             // Whether user manually focused a pattern
        currentPatterns:[],                   // Patterns within last 20 candles
        recentPatterns:[],                    // Patterns within last 100 candles
        historicalPatterns:[],                // Patterns older than 100 candles
        bestChartStructure:null,              // Best detected chart pattern (without stats)
        bestCandlestick:null,                 // Best detected candlestick pattern
        
        // ====================================================================
        // INITIALIZATION METHODS
        // ====================================================================
        initApp(){ this.resetToSampleData(); this.initChart(); },
        
        // Initializes the Lightweight Charts instance
        initChart(){ let div=document.getElementById('candlestick-chart'); if(!div) return; this.chart=LightweightCharts.createChart(div,{width:div.clientWidth,height:420,layout:{background:{type:'solid',color:'#020617'},textColor:'#CBD5E1'},grid:{vertLines:{color:'#1E293B'},horzLines:{color:'#1E293B'}}}); this.candlestickSeries=this.chart.addCandlestickSeries({upColor:'#22C55E',downColor:'#EF4444'}); this.ma20Series=this.chart.addLineSeries({color:'#F59E0B',lineWidth:1}); this.ma50Series=this.chart.addLineSeries({color:'#8B5CF6',lineWidth:1}); window.addEventListener('resize',()=>this.chart?.applyOptions({width:div.clientWidth})); this.updateChart(); },
        
        // ====================================================================
        // CHART & DATA MANAGEMENT
        // ====================================================================
        // Updates chart with current data and triggers pattern re-scan
        updateChart(){ if(!this.candlestickSeries) return; let data = resampleCandles(this.historicalData, this.selectedTimeframe); if(!data.length) return; this.candlestickSeries.setData(data); this.ma20Series.setData(calculateMA(data,20)); this.ma50Series.setData(calculateMA(data,50)); this.scanAllPatterns(); },
        
        // Scans all candles for patterns and organizes them into current/recent/historical
        scanAllPatterns(){
            let display = resampleCandles(this.historicalData, this.selectedTimeframe);
            if(!display.length) return;
            let current=[], recent=[], historical=[];
            for(let i=0;i<display.length;i++){
                let patterns = detectPatternsAtCandle(display, i);
                for(let p of patterns){
                    let patternObj = { id: `${p.id}_${i}`, baseId: p.id, name: p.name, icon: p.icon, type: p.type, bias: p.bias, status: p.status, candleIndex: i, time: display[i].time, anchors: p.anchors };
                    const stats = StatsEngine.computePatternStats(p.id, display, [3,5,10,20]);
                    if(stats) patternObj.stats = stats;
                    if(i >= display.length - 20) current.push(patternObj);
                    else if(i >= display.length - 100) recent.push(patternObj);
                    else historical.push(patternObj);
                }
            }
            this.currentPatterns = current; this.recentPatterns = recent; this.historicalPatterns = historical;
            this.bestChartStructure = current.find(p => p.type === 'chart') || recent.find(p => p.type === 'chart');
            this.bestCandlestick = current.find(p => p.type === 'candle') || recent.find(p => p.type === 'candle');
            let candidates = [...current, ...recent].filter(p => p.stats && p.stats.sampleSize >= 5);
            if(candidates.length) {
                candidates.sort((a,b) => (b.stats?.weightedScore || 0) - (a.stats?.weightedScore || 0));
                const best = candidates[0];
                this.qualifiedBestEdge = { ...best.stats, name: best.name, icon: best.icon, bias: best.stats.bias };
            } else { this.qualifiedBestEdge = null; }
        },
        
        // ====================================================================
        // CHART DRAWING & PATTERN VISUALIZATION
        // ====================================================================
        // Clears all manually drawn trendlines and markers
        clearDrawing(){ this.extraSeries.forEach(s => this.chart?.removeSeries(s)); this.extraSeries = []; this.selectedPattern = null; this.userFocusedPattern = false; this.candlestickSeries?.setMarkers([]); },
        
        // Draws the selected pattern's structure on the chart (trendlines + markers)
        drawStructureOnChart(pattern){
            if(!this.chart) return;
            const display = resampleCandles(this.historicalData, this.selectedTimeframe);
            if(pattern.type === 'candle'){
                if(display[pattern.candleIndex]) this.candlestickSeries.setMarkers([{ time: display[pattern.candleIndex].time, position: pattern.bias === 'bearish' ? 'aboveBar' : 'belowBar', color: pattern.bias === 'bearish' ? '#EF4444' : '#22C55E', shape: pattern.bias === 'bearish' ? 'arrowDown' : 'arrowUp', text: `${pattern.icon} ${pattern.name}` }]);
                return;
            }
            if(pattern.type !== 'chart' || !pattern.anchors) return;
            const a = pattern.anchors;
            if(a.upper1 && a.upper2 && a.lower1 && a.lower2){
                const endIdx = Math.min(display.length - 1, pattern.candleIndex + 10);
                const drawTrendline = (p1, p2, color) => { const series = this.chart.addLineSeries({ color, lineWidth: 3, lineStyle: 0 }); const startIdx = p1.index; const finalIdx = Math.max(p2.index, endIdx); const data = []; for(let x = startIdx; x <= finalIdx; x++){ if(!display[x]) continue; data.push({ time: display[x].time, value: lineValue(p1.price, p2.price, p1.index, p2.index, x) }); } series.setData(data); this.extraSeries.push(series); };
                drawTrendline(a.upper1, a.upper2, '#F59E0B');
                drawTrendline(a.lower1, a.lower2, '#22D3EE');
                this.candlestickSeries.setMarkers([{ time: a.upper1.time, position: 'aboveBar', color: '#F59E0B', shape: 'circle', text: 'Upper' }, { time: a.upper2.time, position: 'aboveBar', color: '#F59E0B', shape: 'circle', text: 'Upper' }, { time: a.lower1.time, position: 'belowBar', color: '#22D3EE', shape: 'circle', text: 'Lower' }, { time: a.lower2.time, position: 'belowBar', color: '#22D3EE', shape: 'circle', text: 'Lower' }]);
            }
        },
        
        // Zooms and pans the chart to focus on the pattern's location
        focusChartAroundPattern(pattern){
            const display = resampleCandles(this.historicalData, this.selectedTimeframe);
            if(!display.length) return;
            let indexes = [pattern.candleIndex];
            if(pattern.anchors){ ['upper1','upper2','lower1','lower2'].forEach(k => { if(pattern.anchors[k]) indexes.push(pattern.anchors[k].index); }); }
            const minIdx = Math.max(0, Math.min(...indexes) - 20);
            const maxIdx = Math.min(display.length - 1, Math.max(...indexes) + 20);
            this.chart?.timeScale().setVisibleRange({ from: display[minIdx].time, to: display[maxIdx].time });
        },
        
        // Handler for clicking a pattern card - draws it on chart and focuses view
        selectAndDrawPattern(pattern){ this.clearDrawing(); this.selectedPattern = pattern; this.userFocusedPattern = true; this.drawStructureOnChart(pattern); this.focusChartAroundPattern(pattern); },
        
        // ====================================================================
        // USER INTERFACE ACTIONS
        // ====================================================================
        setTimeframe(tf){ this.clearDrawing(); this.selectedTimeframe = tf; this.updateChart(); },
        setMode(mode){ this.activeMode = mode; if(mode === 'demo') this.resetToSampleData(); else if(mode === 'crypto') this.connectCoinbaseLive(); else if(mode === 'csv') { this.historicalData = []; this.updateChart(); } },
        resetToSampleData(){ if(this.ws) this.ws.close(); this.historicalData = generateRandomCandles(this.testCount); this.activeMode='demo'; this.updateChart(); },
        
        // ====================================================================
        // CSV IMPORT PARSER
        // ====================================================================
        // Handles CSV file upload, parsing with PapaParse, and converting to candle format
        // Supports headers: DATE, OPEN, HIGH, LOW, CLOSE, ADJ CLOSE, VOLUME (case-insensitive, quoted)
        // Dates can be Unix timestamps or strings like "May 22, 2026"
        loadCSVFile(e){
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
                        // Get date from DATE column (uppercase in CSV)
                        const dateRaw = row.date;
                        
                        let time = Number(dateRaw);
                        
                        if(isNaN(time)) {
                            // Parse human-readable dates like "May 22, 2026"
                            const parsedDate = new Date(dateRaw);
                            time = Math.floor(parsedDate.getTime() / 1000);
                        }
                        
                        // Use ADJ CLOSE if CLOSE is missing, otherwise use standard CLOSE
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
                    })
                    .filter(c => 
                        Number.isFinite(c.time) && 
                        Number.isFinite(c.open) && 
                        Number.isFinite(c.high) && 
                        Number.isFinite(c.low) && 
                        Number.isFinite(c.close)
                    )
                    .sort((a,b) => a.time - b.time);

                    if(ohlcv.length < 50) {
                        throw new Error(`Only ${ohlcv.length} valid candles found. Need at least 50.`);
                    }

                    this.clearDrawing();
                    this.historicalData = ohlcv;
                    this.activeMode = 'csv';
                    this.updateChart();

                } catch(err) {
                    alert("CSV import failed: " + err.message);
                }
            };

            reader.readAsText(file);
            e.target.value = '';
        },
        
        // ====================================================================
        // COINBASE LIVE CRYPTO INTEGRATION
        // ====================================================================
        connectCoinbaseLive(){ this.disconnectWebSocket(); this.fetchCoinbaseCandles(); },
        
        // Fetches historical candles from Coinbase REST API (granularity = 900 seconds = 15m)
        async fetchCoinbaseCandles(){ let url=`https://api.exchange.coinbase.com/products/${this.cryptoSymbol}/candles?granularity=900`; try{ let resp=await fetch(url); if(resp.ok){ let data=await resp.json(); this.historicalData=data.map(arr=>({ time:arr[0], low:arr[1], high:arr[2], open:arr[3], close:arr[4], volume:arr[5] })).sort((a,b)=>a.time-b.time); this.updateChart(); } } catch(e){} },
        
        disconnectWebSocket(){ if(this.ws){ try{ this.ws.close(); }catch(e){} this.ws=null; } this.wsStatus='disconnected'; },
        onSymbolChange(){ if(this.activeMode==='crypto') this.connectCoinbaseLive(); },
        onTimeframeChange(){ this.selectedTimeframe = this.cryptoTimeframe; if(this.activeMode==='crypto') this.connectCoinbaseLive(); },
        toggleScannerMode(){ this.scannerActive=!this.scannerActive; },
        shareApp(){ if(navigator.share) navigator.share({title:"CandleEdge"}); else alert("Link copied"); }
    }));
});