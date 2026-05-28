"use client";

/**
 * PRICE CHART — TradingView lightweight-charts v4 wrapper.
 *
 * Client-only render (lib window'a bağlı).
 * Dynamic import üst sayfa seviyesinde yapılır (ssr: false).
 */

import { useEffect, useRef } from "react";
import {
  createChart,
  type IChartApi,
  type ISeriesApi,
  type CandlestickData,
  type LineData,
  type SeriesMarker,
  type Time,
} from "lightweight-charts";
import type { ChartSeries } from "@/lib/chart/types";

interface Props {
  series: ChartSeries;
  height?: number;
}

const COLOR_UP = "#22c55e";
const COLOR_DOWN = "#ef4444";
const COLOR_EMA20 = "#3b82f6";
const COLOR_EMA50 = "#f59e0b";
const COLOR_GRID = "#e5e5e5";
const COLOR_TEXT = "#525252";

export function PriceChart({ series, height = 400 }: Props): React.ReactElement {
  const containerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<"Candlestick"> | null>(null);
  const ema20SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);
  const ema50SeriesRef = useRef<ISeriesApi<"Line"> | null>(null);

  // ─── Mount ───
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const chart = createChart(container, {
      width: container.clientWidth,
      height,
      layout: {
        background: { color: "transparent" },
        textColor: COLOR_TEXT,
        fontFamily:
          "ui-monospace, SFMono-Regular, 'SF Mono', Menlo, monospace",
      },
      grid: {
        vertLines: { color: COLOR_GRID },
        horzLines: { color: COLOR_GRID },
      },
      timeScale: {
        timeVisible: true,
        secondsVisible: false,
        borderColor: COLOR_GRID,
      },
      rightPriceScale: {
        borderColor: COLOR_GRID,
      },
      crosshair: { mode: 1 },
    });
    chartRef.current = chart;

    const candle = chart.addCandlestickSeries({
      upColor: COLOR_UP,
      downColor: COLOR_DOWN,
      wickUpColor: COLOR_UP,
      wickDownColor: COLOR_DOWN,
      borderVisible: false,
    });
    candleSeriesRef.current = candle;

    const ro = new ResizeObserver((entries) => {
      for (const e of entries) {
        chart.applyOptions({ width: e.contentRect.width });
      }
    });
    ro.observe(container);

    return () => {
      ro.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      ema20SeriesRef.current = null;
      ema50SeriesRef.current = null;
    };
  }, [height]);

  // ─── Props değişti ───
  useEffect(() => {
    const chart = chartRef.current;
    const candleSeries = candleSeriesRef.current;
    if (!chart || !candleSeries) return;

    candleSeries.setData(series.candles as CandlestickData<Time>[]);

    // EMA20
    if (series.ema20 && series.ema20.length > 0) {
      if (!ema20SeriesRef.current) {
        ema20SeriesRef.current = chart.addLineSeries({
          color: COLOR_EMA20,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
        });
      }
      ema20SeriesRef.current.setData(series.ema20 as LineData<Time>[]);
    } else if (ema20SeriesRef.current) {
      chart.removeSeries(ema20SeriesRef.current);
      ema20SeriesRef.current = null;
    }

    // EMA50
    if (series.ema50 && series.ema50.length > 0) {
      if (!ema50SeriesRef.current) {
        ema50SeriesRef.current = chart.addLineSeries({
          color: COLOR_EMA50,
          lineWidth: 2,
          priceLineVisible: false,
          lastValueVisible: false,
        });
      }
      ema50SeriesRef.current.setData(series.ema50 as LineData<Time>[]);
    } else if (ema50SeriesRef.current) {
      chart.removeSeries(ema50SeriesRef.current);
      ema50SeriesRef.current = null;
    }

    // Markers (v4 API: series.setMarkers)
    if (series.markers && series.markers.length > 0) {
      const markers: SeriesMarker<Time>[] = series.markers.map((m) => ({
        time: m.time as Time,
        position: m.position,
        color: m.color,
        shape: m.shape,
        text: m.text,
      }));
      candleSeries.setMarkers(markers);
    } else {
      candleSeries.setMarkers([]);
    }

    chart.timeScale().fitContent();
  }, [series]);

  return <div ref={containerRef} className="w-full" style={{ height }} />;
}
