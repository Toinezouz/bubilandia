import { useEffect, useRef, useState } from 'react';
import uPlot from 'uplot';
import 'uplot/dist/uPlot.min.css';
import styles from './chart.module.css';

/**
 * Small single-series chart built on uPlot (≈ 20 kB gz, canvas, fast on phones).
 * - x is the point index (one point per session / week), labelled with `xLabels`;
 * - line: 2 px line + 8 px markers; bars: rounded data-ends with a gap between bars;
 * - optional target band (e.g. weekly sets goal) drawn behind the data;
 * - touch or hover anywhere on the plot selects the nearest point and shows it in the
 *   readout above the chart (default: the latest point).
 * Colours come from the CSS tokens, so light/dark mode follow the app theme.
 */
interface ChartProps {
  kind: 'line' | 'bars';
  /** One label per point (dates), used on the axis and in the readout. */
  xLabels: string[];
  y: Array<number | null>;
  formatY: (value: number) => string;
  /** Accessible summary of what the chart shows. */
  ariaLabel: string;
  band?: { min: number; max: number; label: string };
  height?: number;
}

function token(name: string, fallback: string): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return v || fallback;
}

function useColorScheme(): string {
  const [scheme, setScheme] = useState(() => (window.matchMedia('(prefers-color-scheme: light)').matches ? 'light' : 'dark'));
  useEffect(() => {
    const mq = window.matchMedia('(prefers-color-scheme: light)');
    const on = () => setScheme(mq.matches ? 'light' : 'dark');
    mq.addEventListener('change', on);
    return () => mq.removeEventListener('change', on);
  }, []);
  return scheme;
}

export function Chart({ kind, xLabels, y, formatY, ariaLabel, band, height = 180 }: ChartProps) {
  const holder = useRef<HTMLDivElement>(null);
  const lastIndex = y.length - 1;
  const [selected, setSelected] = useState(lastIndex);
  const scheme = useColorScheme();
  // Recreate the chart only when the data really changes (parents rebuild arrays on each render).
  const dataKey = JSON.stringify([kind, xLabels, y, band, height]);
  const fmt = useRef(formatY);
  fmt.current = formatY;

  useEffect(() => setSelected(lastIndex), [lastIndex]);

  useEffect(() => {
    const el = holder.current;
    if (!el || y.length === 0) return;
    const accent = token('--accent', '#f97362');
    const muted = token('--text-muted', '#9ca3af');
    const grid = token('--border', '#2f3540');
    const surface = token('--surface', '#1a1d24');
    const ok = token('--ok', '#4ade80');
    const font = '13px -apple-system, system-ui, sans-serif';

    const xs = y.map((_, i) => i);
    const finite = y.filter((v): v is number => v !== null);
    const top = Math.max(...finite, band?.max ?? 0);
    const bottom = kind === 'bars' ? 0 : Math.min(...finite);
    const pad = kind === 'bars' ? top * 0.12 : Math.max((top - bottom) * 0.15, top * 0.03, 1);

    const series: uPlot.Series =
      kind === 'line'
        ? {
            stroke: accent,
            width: 2,
            points: { show: true, size: 8, width: 2, stroke: accent, fill: surface },
          }
        : {
            stroke: accent,
            fill: accent,
            width: 0,
            paths: uPlot.paths.bars!({ size: [0.62, 44], gap: 2, radius: 0.18 }),
            points: { show: false },
          };

    const opts: uPlot.Options = {
      width: el.clientWidth,
      height,
      padding: [12, 8, 0, 0],
      legend: { show: false },
      cursor: {
        drag: { x: false, y: false },
        points: { size: 12, width: 2, stroke: accent, fill: surface },
        y: false,
      },
      scales: {
        x: { time: false, range: kind === 'bars' ? [-0.6, xs.length - 0.4] : [-0.3, xs.length - 0.7] },
        y: { range: [Math.max(0, bottom - pad), top + pad] },
      },
      axes: [
        {
          stroke: muted,
          font,
          grid: { show: false },
          ticks: { show: false },
          space: 56,
          incrs: [1, 2, 3, 4, 5, 10, 20, 50],
          values: (_u, splits) => splits.map((i) => (Number.isInteger(i) ? (xLabels[i] ?? '') : '')),
        },
        {
          stroke: muted,
          font,
          size: 46,
          grid: { stroke: grid, width: 1 },
          ticks: { show: false },
          space: 36,
          values: (_u, splits) => splits.map((v) => fmt.current(v)),
        },
      ],
      series: [{}, series],
      hooks: {
        drawClear: [
          (u) => {
            if (!band) return;
            const { ctx } = u;
            const y1 = u.valToPos(band.max, 'y', true);
            const y2 = u.valToPos(band.min, 'y', true);
            ctx.save();
            ctx.fillStyle = ok;
            ctx.globalAlpha = 0.14;
            ctx.fillRect(u.bbox.left, y1, u.bbox.width, Math.max(2, y2 - y1));
            ctx.restore();
          },
        ],
        setCursor: [
          (u) => {
            const idx = u.cursor.idx;
            if (idx !== null && idx !== undefined) setSelected(idx);
          },
        ],
      },
    };

    const u = new uPlot(opts, [xs, y], el);
    // Show the latest point by default.
    if (lastIndex >= 0) u.setCursor({ left: u.valToPos(lastIndex, 'x'), top: u.valToPos(y[lastIndex] ?? 0, 'y') });

    // Touch: uPlot follows the mouse; also follow a finger (tap or slide) on the plot.
    const over = u.over;
    over.style.touchAction = 'pan-y';
    const follow = (e: PointerEvent) => {
      if (e.pointerType === 'mouse') return;
      const r = over.getBoundingClientRect();
      u.setCursor({ left: e.clientX - r.left, top: e.clientY - r.top });
    };
    over.addEventListener('pointerdown', follow);
    over.addEventListener('pointermove', follow);
    const keepLatest = () => lastIndex >= 0 && u.setCursor({ left: u.valToPos(lastIndex, 'x'), top: u.valToPos(y[lastIndex] ?? 0, 'y') });
    over.addEventListener('mouseleave', keepLatest);

    const ro = new ResizeObserver(() => u.setSize({ width: el.clientWidth, height }));
    ro.observe(el);
    return () => {
      ro.disconnect();
      over.removeEventListener('pointerdown', follow);
      over.removeEventListener('pointermove', follow);
      over.removeEventListener('mouseleave', keepLatest);
      u.destroy();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- dataKey covers kind/xLabels/y/band/height
  }, [dataKey, scheme]);

  const value = y[selected];
  return (
    <figure className={styles.figure} aria-label={ariaLabel} role="img">
      <figcaption className={styles.readout} aria-live="polite">
        <span className={styles.readoutLabel}>{xLabels[selected] ?? ''}</span>
        <strong className={styles.readoutValue}>{value === null || value === undefined ? '—' : formatY(value)}</strong>
        {band && <span className={styles.readoutBand}>{band.label}</span>}
      </figcaption>
      <div ref={holder} className={styles.plot} />
    </figure>
  );
}
