import React, { useState, useEffect, useCallback, useRef } from "react";
import { RefreshCw, TrendingUp, TrendingDown, Minus, Activity, Radio, Settings2, KeyRound } from "lucide-react";

const ASSETS = [
  { symbol: "EUR/USD", label: "EUR / USD" },
  { symbol: "GBP/USD", label: "GBP / USD" },
  { symbol: "USD/JPY", label: "USD / JPY" },
  { symbol: "AUD/USD", label: "AUD / USD" },
  { symbol: "USD/CAD", label: "USD / CAD" },
  { symbol: "EUR/JPY", label: "EUR / JPY" },
];

const INTERVALS = [
  { value: "1min", label: "1m" },
  { value: "5min", label: "5m" },
  { value: "15min", label: "15m" },
];

const INDICATOR_KEYS = ["trend", "momentum", "macd", "meanReversion"];
const DEFAULT_WEIGHTS = { trend: 1, momentum: 1, macd: 1, meanReversion: 1 };

function ema(values, period) {
  const k = 2 / (period + 1);
  const out = [values[0]];
  for (let i = 1; i < values.length; i++) out.push(values[i] * k + out[i - 1] * (1 - k));
  return out;
}

function rsi(values, period = 14) {
  let gains = 0, losses = 0;
  const out = new Array(values.length).fill(50);
  for (let i = 1; i <= period; i++) {
    const diff = values[i] - values[i - 1];
    if (diff >= 0) gains += diff; else losses -= diff;
  }
  let avgGain = gains / period, avgLoss = losses / period;
  out[period] = 100 - 100 / (1 + (avgLoss === 0 ? 100 : avgGain / avgLoss));
  for (let i = period + 1; i < values.length; i++) {
    const diff = values[i] - values[i - 1];
    const gain = diff > 0 ? diff : 0;
    const loss = diff < 0 ? -diff : 0;
    avgGain = (avgGain * (period - 1) + gain) / period;
    avgLoss = (avgLoss * (period - 1) + loss) / period;
    out[i] = 100 - 100 / (1 + (avgLoss === 0 ? 100 : avgGain / avgLoss));
  }
  return out;
}

function macdHistogram(values) {
  const ema12 = ema(values, 12);
  const ema26 = ema(values, 26);
  const macdLine = values.map((_, i) => ema12[i] - ema26[i]);
  const signalLine = ema(macdLine, 9);
  return macdLine.map((v, i) => v - signalLine[i]);
}

function bollinger(values, period = 20, mult = 2) {
  const out = [];
  for (let i = 0; i < values.length; i++) {
    if (i < period - 1) { out.push({ upper: NaN, lower: NaN, mid: NaN }); continue; }
    const slice = values.slice(i - period + 1, i + 1);
    const mean = slice.reduce((a, b) => a + b, 0) / period;
    const variance = slice.reduce((a, b) => a + (b - mean) ** 2, 0) / period;
    const sd = Math.sqrt(variance);
    out.push({ upper: mean + mult * sd, lower: mean - mult * sd, mid: mean });
  }
  return out;
}

function computeIndicatorScores(closes) {
  const last = closes.length - 1;
  const e9 = ema(closes, 9), e21 = ema(closes, 21);
  const trendRaw = (e9[last] - e21[last]) / e21[last];
  const trend = Math.max(-1, Math.min(1, trendRaw * 400));
  const r = rsi(closes)[last];
  const momentum = Math.max(-1, Math.min(1, (r - 50) / 25));
  const hist = macdHistogram(closes);
  const h0 = hist[last], h1 = hist[last - 1] ?? h0;
  const macdScore = Math.max(-1, Math.min(1, (h0 / closes[last]) * 1000 + (h0 > h1 ? 0.15 : -0.15)));
  const bb = bollinger(closes)[last];
  let meanReversion = 0;
  if (!isNaN(bb.upper)) {
    const width = bb.upper - bb.lower;
    const pos = (closes[last] - bb.mid) / (width / 2);
    meanReversion = Math.max(-1, Math.min(1, -pos * 0.8));
  }
  return { trend, momentum, macd: macdScore, meanReversion, rsiValue: r };
}

function compositeSignal(scores, weights) {
  const totalWeight = INDICATOR_KEYS.reduce((s, k) => s + weights[k], 0) || 1;
  const composite = INDICATOR_KEYS.reduce((s, k) => s + scores[k] * weights[k], 0) / totalWeight;
  let label = "NEUTRAL", tone = "neutral";
  if (composite > 0.45) { label = "STRONG BUY"; tone = "bull"; }
  else if (composite > 0.15) { label = "BUY"; tone = "bull"; }
  else if (composite < -0.45) { label = "STRONG SELL"; tone = "bear"; }
  else if (composite < -0.15) { label = "SELL"; tone = "bear"; }
  return { composite, label, tone };
}

async function loadWeights() {
  try { const v = localStorage.getItem("fx-indicator-weights"); return v ? JSON.parse(v) : { ...DEFAULT_WEIGHTS }; }
  catch { return { ...DEFAULT_WEIGHTS }; }
}
async function saveWeights(w) { try { localStorage.setItem("fx-indicator-weights", JSON.stringify(w)); } catch {} }
async function loadHistory() {
  try { const v = localStorage.getItem("fx-signal-history"); return v ? JSON.parse(v) : []; }
  catch { return []; }
}
async function saveHistory(h) { try { localStorage.setItem("fx-signal-history", JSON.stringify(h.slice(-300))); } catch {} }
const EMPTY_STATS = { trend: { w: 0, l: 0 }, momentum: { w: 0, l: 0 }, macd: { w: 0, l: 0 }, meanReversion: { w: 0, l: 0 } };
async function loadStats() {
  try { const v = localStorage.getItem("fx-indicator-stats"); return v ? JSON.parse(v) : { ...EMPTY_STATS }; }
  catch { return { ...EMPTY_STATS }; }
}
async function saveStats(s) { try { localStorage.setItem("fx-indicator-stats", JSON.stringify(s)); } catch {} }
async function loadApiKey() {
  try { return localStorage.getItem("fx-api-key-td") || ""; }
  catch { return ""; }
}
async function saveApiKey(k) { try { localStorage.setItem("fx-api-key-td", k); } catch {} }

const toneColor = { bull: "#4FD1C5", bear: "#E8734A", neutral: "#8A8F98" };

function ConvictionBar({ value, tone }) {
  const pct = Math.abs(value) * 50;
  const isBull = value >= 0;
  return (
    <div className="relative h-2 w-full rounded-full bg-[#20222C] overflow-hidden">
      <div className="absolute left-1/2 top-0 bottom-0 w-px bg-[#3A3D4A]" />
      <div className="absolute top-0 bottom-0 rounded-full transition-all duration-500"
        style={{ width: `${pct}%`, left: isBull ? "50%" : `${50 - pct}%`, background: toneColor[tone] }} />
    </div>
  );
}

function Sparkline({ data, tone }) {
  if (!data || data.length < 2) return <div style={{ height: 44 }} />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const points = data.map((v, i) => {
    const x = (i / (data.length - 1)) * 100;
    const y = 40 - ((v - min) / range) * 36 - 2;
    return `${x},${y}`;
  }).join(" ");
  return (
    <svg width="100%" height="44" viewBox="0 0 100 44" preserveAspectRatio="none">
      <polyline points={points} fill="none" stroke={toneColor[tone]} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

function SignalIcon({ tone }) {
  if (tone === "bull") return <TrendingUp size={16} strokeWidth={2.5} />;
  if (tone === "bear") return <TrendingDown size={16} strokeWidth={2.5} />;
  return <Minus size={16} strokeWidth={2.5} />;
}

export default function MarketScanner() {
  const [interval_, setInterval_] = useState("5min");
  const [assetData, setAssetData] = useState({});
  const [weights, setWeights] = useState(DEFAULT_WEIGHTS);
  const [stats, setStats] = useState(null);
  const [loading, setLoading] = useState(false);
  const [lastUpdated, setLastUpdated] = useState(null);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [error, setError] = useState(null);
  const [showWeights, setShowWeights] = useState(false);
  const [apiKey, setApiKey] = useState("");
  const [apiKeyInput, setApiKeyInput] = useState("");
  const [showKeyPanel, setShowKeyPanel] = useState(false);
  const historyRef = useRef([]);

  useEffect(() => {
    (async () => {
      setWeights(await loadWeights());
      setStats(await loadStats());
      historyRef.current = await loadHistory();
      const key = await loadApiKey();
      setApiKey(key);
      setApiKeyInput(key);
      if (!key) setShowKeyPanel(true);
    })();
  }, []);

  const evaluatePastSignals = useCallback(async (currentPrices) => {
    const history = historyRef.current;
    const now = Date.now();
    const horizonMs = 15 * 60 * 1000;
    let statsChanged = false;
    const newStats = await loadStats();
    for (const sig of history) {
      if (sig.evaluated) continue;
      if (now - sig.ts < horizonMs) continue;
      const currentPrice = currentPrices[sig.symbol];
      if (currentPrice == null) continue;
      const priceMoveUp = currentPrice > sig.price;
      sig.evaluated = true;
      sig.outcomeCorrect = {};
      for (const k of INDICATOR_KEYS) {
        const predictedUp = sig.scores[k] >= 0;
        const correct = predictedUp === priceMoveUp;
        sig.outcomeCorrect[k] = correct;
        if (correct) newStats[k].w += 1; else newStats[k].l += 1;
        statsChanged = true;
      }
    }
    if (statsChanged) {
      await saveStats(newStats);
      await saveHistory(history);
      const newWeights = {};
      for (const k of INDICATOR_KEYS) {
        const { w, l } = newStats[k];
        const total = w + l;
        const winRate = total > 0 ? w / total : 0.5;
        newWeights[k] = Math.max(0.4, Math.min(1.6, 0.4 + winRate * 1.2));
      }
      setWeights(newWeights);
      await saveWeights(newWeights);
      setStats(newStats);
    }
  }, []);

  const scan = useCallback(async () => {
    if (!apiKey) { setShowKeyPanel(true); return; }
    setLoading(true);
    setError(null);
    try {
      const results = {};
      const currentPrices = {};
      for (const asset of ASSETS) {
        const url = `https://api.twelvedata.com/time_series?symbol=${encodeURIComponent(asset.symbol)}&interval=${interval_}&outputsize=100&apikey=${apiKey}`;
        const res = await fetch(url);
        const json = await res.json();
        if (json.status === "error" || !json.values) {
          throw new Error(json.message || `Failed to fetch ${asset.symbol}`);
        }
        const closes = json.values.map((v) => parseFloat(v.close)).reverse();
        const scores = computeIndicatorScores(closes);
        const currentWeights = await loadWeights();
        const signal = compositeSignal(scores, currentWeights);
        results[asset.symbol] = { closes, scores, signal, price: closes[closes.length - 1] };
        currentPrices[asset.symbol] = closes[closes.length - 1];
        historyRef.current.push({ ts: Date.now(), symbol: asset.symbol, scores, price: closes[closes.length - 1], evaluated: false });
      }
      setAssetData(results);
      await saveHistory(historyRef.current);
      await evaluatePastSignals(currentPrices);
      setLastUpdated(new Date());
    } catch (e) {
      setError(e.message || "Could not reach market data.");
    } finally {
      setLoading(false);
    }
  }, [interval_, evaluatePastSignals, apiKey]);

  useEffect(() => { if (apiKey) scan(); }, [interval_, apiKey]); // eslint-disable-line

  useEffect(() => {
    if (!autoRefresh || !apiKey) return;
    const id = window.setInterval(() => scan(), 60000);
    return () => window.clearInterval(id);
  }, [autoRefresh, scan, apiKey]);

  const handleSaveKey = async () => {
    await saveApiKey(apiKeyInput.trim());
    setApiKey(apiKeyInput.trim());
    setShowKeyPanel(false);
  };

  const evaluatedCount = stats ? INDICATOR_KEYS.reduce((s, k) => s + stats[k].w + stats[k].l, 0) : 0;

  return (
    <div className="min-h-screen bg-[#0F1016] text-[#E7E5E0] font-sans">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;600;700&family=JetBrains+Mono:wght@400;500;600&family=Inter:wght@400;500;600&display=swap');
        .font-display { font-family: 'Space Grotesk', sans-serif; }
        .font-mono { font-family: 'JetBrains Mono', monospace; }
        .font-sans { font-family: 'Inter', sans-serif; }
      `}</style>
      <div className="border-b border-[#20222C] bg-[#14151D]">
        <div className="max-w-6xl mx-auto px-5 py-4 flex items-center justify-between flex-wrap gap-3">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded bg-[#E8A33D] flex items-center justify-center">
              <Radio size={16} className="text-[#0F1016]" strokeWidth={2.5} />
            </div>
            <div>
              <h1 className="font-display font-700 text-lg tracking-tight leading-none">SIGNAL DESK</h1>
              <p className="font-mono text-[10px] text-[#6B6F7B] tracking-wide mt-0.5">ADAPTIVE FX / OTC SCANNER</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {INTERVALS.map((iv) => (
              <button key={iv.value} onClick={() => setInterval_(iv.value)}
                className={`font-mono text-xs px-2.5 py-1.5 rounded border transition-colors ${interval_ === iv.value ? "bg-[#E8A33D] text-[#0F1016] border-[#E8A33D]" : "border-[#2A2D38] text-[#8A8F98] hover:border-[#4A4E5C]"}`}>
                {iv.label}
              </button>
            ))}
            <button onClick={() => setAutoRefresh((a) => !a)}
              className={`font-mono text-xs px-2.5 py-1.5 rounded border transition-colors ${autoRefresh ? "border-[#4FD1C5] text-[#4FD1C5]" : "border-[#2A2D38] text-[#8A8F98] hover:border-[#4A4E5C]"}`}>
              AUTO {autoRefresh ? "ON" : "OFF"}
            </button>
            <button onClick={scan} disabled={loading}
              className="font-mono text-xs px-3 py-1.5 rounded bg-[#20222C] border border-[#2A2D38] text-[#E7E5E0] hover:border-[#4A4E5C] flex items-center gap-1.5 disabled:opacity-50">
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
              {loading ? "SCANNING" : "SCAN"}
            </button>
            <button onClick={() => setShowKeyPanel((s) => !s)}
              className="font-mono text-xs px-2.5 py-1.5 rounded border border-[#2A2D38] text-[#8A8F98] hover:border-[#4A4E5C]" title="API key">
              <KeyRound size={13} />
            </button>
          </div>
        </div>
      </div>
      <div className="max-w-6xl mx-auto px-5 py-6">
        {showKeyPanel && (
          <div className="mb-6 bg-[#14151D] border border-[#2A2D38] rounded-xl p-4">
            <div className="font-display font-600 text-sm mb-1.5">Connect your Twelve Data key</div>
            <p className="font-mono text-[11px] text-[#8A8F98] leading-relaxed mb-3">
              Free tier covers 800 calls/day, 8/minute — comfortably enough for scans every minute or two across these six pairs.
            </p>
            <div className="flex gap-2 flex-wrap">
              <input type="text" value={apiKeyInput} onChange={(e) => setApiKeyInput(e.target.value)}
                autoCapitalize="off" autoCorrect="off" spellCheck={false} placeholder="Paste your Twelve Data API key"
                className="flex-1 min-w-[220px] bg-[#0F1016] border border-[#2A2D38] rounded px-3 py-2 font-mono text-xs text-[#E7E5E0] focus:outline-none focus:border-[#E8A33D]" />
              <button onClick={handleSaveKey} className="font-mono text-xs px-4 py-2 rounded bg-[#E8A33D] text-[#0F1016] font-600">
                Save & Scan
              </button>
            </div>
          </div>
        )}
        <div className="flex items-center justify-between mb-5 flex-wrap gap-2">
          <div className="font-mono text-xs text-[#6B6F7B]">
            {lastUpdated ? `Last scan ${lastUpdated.toLocaleTimeString()}` : "Awaiting first scan…"}
            {error && <span className="text-[#E8734A] ml-3">⚠ {error}</span>}
          </div>
          <button onClick={() => setShowWeights((s) => !s)} className="font-mono text-[11px] text-[#6B6F7B] hover:text-[#E7E5E0] flex items-center gap-1">
            <Settings2 size={12} /> indicator weights ({evaluatedCount} signals evaluated)
          </button>
        </div>
        {showWeights && (
          <div className="mb-6 grid grid-cols-2 md:grid-cols-4 gap-3">
            {INDICATOR_KEYS.map((k) => {
              const s = stats ? stats[k] : { w: 0, l: 0 };
              const total = s.w + s.l;
              const winRate = total > 0 ? ((s.w / total) * 100).toFixed(0) : "—";
              return (
                <div key={k} className="bg-[#14151D] border border-[#20222C] rounded-lg p-3">
                  <div className="font-mono text-[10px] text-[#6B6F7B] uppercase tracking-wide">{k}</div>
                  <div className="font-display text-lg mt-0.5">{weights[k]?.toFixed(2)}×</div>
                  <div className="font-mono text-[10px] text-[#6B6F7B] mt-1">{winRate}% win · {total} calls</div>
                </div>
              );
            })}
          </div>
        )}
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {ASSETS.map((asset) => {
            const data = assetData[asset.symbol];
            if (!data) return <div key={asset.symbol} className="bg-[#14151D] border border-[#20222C] rounded-xl p-4 h-[168px] animate-pulse" />;
            const { signal, scores, closes, price } = data;
            const decimals = asset.symbol.includes("JPY") ? 3 : 5;
            return (
              <div key={asset.symbol} className="bg-[#14151D] border border-[#20222C] rounded-xl p-4">
                <div className="flex items-start justify-between mb-2">
                  <div>
                    <div className="font-display font-600 text-sm">{asset.label}</div>
                    <div className="font-mono text-xs text-[#6B6F7B]">{price.toFixed(decimals)}</div>
                  </div>
                  <div className="flex items-center gap-1 px-2 py-1 rounded font-mono text-[11px] font-600"
                    style={{ color: toneColor[signal.tone], backgroundColor: `${toneColor[signal.tone]}1A` }}>
                    <SignalIcon tone={signal.tone} /> {signal.label}
                  </div>
                </div>
                <Sparkline data={closes.slice(-40)} tone={signal.tone} />
                <div className="mt-2 mb-1"><ConvictionBar value={signal.composite} tone={signal.tone} /></div>
                <div className="flex justify-between font-mono text-[9px] text-[#6B6F7B]">
                  <span>SELL</span><span>conviction {Math.abs(signal.composite * 100).toFixed(0)}%</span><span>BUY</span>
                </div>
                <div className="mt-3 pt-3 border-t border-[#20222C] grid grid-cols-4 gap-1.5">
                  {INDICATOR_KEYS.map((k) => {
                    const v = scores[k];
                    const t = v > 0.1 ? "bull" : v < -0.1 ? "bear" : "neutral";
                    return (
                      <div key={k} className="text-center">
                        <div className="font-mono text-[9px] text-[#6B6F7B] uppercase">{k.slice(0, 4)}</div>
                        <div className="font-mono text-[11px] font-600" style={{ color: toneColor[t] }}>{v > 0 ? "+" : ""}{v.toFixed(2)}</div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-8 pt-5 border-t border-[#20222C] font-mono text-[11px] text-[#6B6F7B] leading-relaxed">
          <Activity size={12} className="inline mr-1.5 -mt-0.5" />
          Composite score blends trend (EMA9/21), momentum (RSI-14), MACD histogram, and Bollinger mean-reversion, weighted by each indicator's live win rate against 15-minute-forward price moves — weights update automatically as history accumulates. Live forex feed via Twelve Data; IQ Option's weekend OTC pairs are synthetic but track the same underlying rate, so signals carry over. On fixed-payout, short-expiry instruments the payout structure (typically 70–90% return vs. 100% loss) means you need real accuracy above roughly 55–58% just to break even, so treat conviction % as one input, not a trigger on its own.
        </div>
      </div>
    </div>
  );
}
