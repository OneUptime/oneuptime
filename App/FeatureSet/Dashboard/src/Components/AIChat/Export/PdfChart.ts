import { AIChatWidget, AIChatWidgetType } from "Common/Types/AI/AIChatTypes";
import {
  ExportChartPoint,
  ExportChartSeries,
  chartHasData,
  chartIsTimeBased,
  formatChartValue,
  toExportChartSeries,
} from "Common/UI/Utils/AIChatExport/ChatWidgetData";
import PdfDocument, { PDF_COLORS } from "./PdfDocument";

/*
 * Draws a chart widget as real vector graphics.
 *
 * The chat renders these through Recharts in the DOM, which the exporter has no
 * access to, so the chart is rebuilt from the widget's typed data: axes, ticks,
 * grid, and marks. It uses the same nine-colour palette the on-screen charts
 * use (LineChartPalette / BarChartPalette), assigned by series position and
 * wrapping the same way, so a series keeps its colour between screen and paper.
 *
 * Two deliberate differences from the screen, both in the export's favour:
 * points are plotted as returned rather than re-bucketed (see
 * ChatWidgetData.toExportChartSeries), and lines are drawn as straight segments
 * rather than Recharts' monotone spline — a spline would need d3's curve
 * algorithm ported to match, and an approximation that bends data in a report
 * is worse than an honest polyline.
 */

// LineChartPalette / BarChartPalette resolved to hex via chartColors.
const CHART_PALETTE: Array<string> = [
  "#6366f1", // indigo
  "#f43f5e", // rose
  "#10b981", // emerald
  "#f59e0b", // amber
  "#06b6d4", // cyan
  "#6b7280", // gray
  "#ec4899", // pink
  "#84cc16", // lime
  "#d946ef", // fuchsia
];

const PLOT_HEIGHT: number = 168;
const Y_GUTTER: number = 46;
const X_AXIS_HEIGHT: number = 14;
const TICK_FONT_SIZE: number = 7;
const LEGEND_FONT_SIZE: number = 7.5;

/*
 * What a chart needs end to end, legend included. Callers reserve this before
 * drawing a chart's title so the title cannot be stranded on the page above.
 */
export const CHART_BLOCK_HEIGHT: number = PLOT_HEIGHT + X_AXIS_HEIGHT + 26;

export function chartColorForIndex(index: number): string {
  return CHART_PALETTE[index % CHART_PALETTE.length] as string;
}

/*
 * Round tick values for a domain — the 1/2/5/10 ladder, the same shape d3 and
 * Recharts use, so the axis reads the way the on-screen one does.
 */
function niceTicks(min: number, max: number, count: number): Array<number> {
  if (!isFinite(min) || !isFinite(max)) {
    return [0];
  }
  if (min === max) {
    return [min];
  }

  const span: number = max - min;
  const rawStep: number = span / Math.max(1, count - 1);
  const magnitude: number = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized: number = rawStep / magnitude;

  let step: number = magnitude;
  if (normalized > 5) {
    step = magnitude * 10;
  } else if (normalized > 2) {
    step = magnitude * 5;
  } else if (normalized > 1) {
    step = magnitude * 2;
  }

  const start: number = Math.floor(min / step) * step;
  const ticks: Array<number> = [];
  for (let value: number = start; value <= max + step / 2; value += step) {
    if (value >= min - step / 2) {
      // Kill float drift like 0.30000000000000004.
      ticks.push(Number(value.toPrecision(12)));
    }
  }

  return ticks.length > 0 ? ticks : [min, max];
}

function formatTimeLabel(date: Date, spanMs: number): string {
  const TWO_HOURS: number = 2 * 60 * 60 * 1000;
  const TWO_DAYS: number = 2 * 24 * 60 * 60 * 1000;
  const TWO_YEARS: number = 2 * 365 * 24 * 60 * 60 * 1000;

  if (spanMs <= TWO_HOURS) {
    return date.toLocaleTimeString(undefined, {
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  if (spanMs <= TWO_DAYS) {
    return date.toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  }
  if (spanMs <= TWO_YEARS) {
    return date.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  }
  return date.toLocaleDateString(undefined, {
    month: "short",
    year: "numeric",
  });
}

export default class PdfChart {
  private readonly pdf: PdfDocument;

  public constructor(pdf: PdfDocument) {
    this.pdf = pdf;
  }

  private drawEmptyState(): void {
    this.pdf.ensureSpace(40);
    this.pdf.paragraph("No data points in this range.", {
      size: 8.5,
      color: PDF_COLORS.faint,
    });
    this.pdf.moveDown(4);
  }

  private drawLegend(series: Array<ExportChartSeries>, width: number): void {
    const lineHeight: number = this.pdf.lineHeight(LEGEND_FONT_SIZE, 1.6);
    let x: number = this.pdf.left;

    this.pdf.ensureSpace(lineHeight);
    this.pdf.setStyle({ size: LEGEND_FONT_SIZE, color: PDF_COLORS.muted });

    series.forEach((item: ExportChartSeries, index: number) => {
      const label: string = this.pdf.sanitize(
        item.name || `Series ${index + 1}`,
      );
      this.pdf.setStyle({ size: LEGEND_FONT_SIZE, color: PDF_COLORS.muted });
      const labelWidth: number = this.pdf.textWidth(label) + 16;

      // Wrap the legend rather than run past the margin.
      if (x + labelWidth > this.pdf.left + width && x > this.pdf.left) {
        this.pdf.y += lineHeight;
        this.pdf.ensureSpace(lineHeight);
        x = this.pdf.left;
      }

      this.pdf.circle(
        x + 3,
        this.pdf.y + LEGEND_FONT_SIZE / 2,
        2.5,
        chartColorForIndex(index),
      );
      this.pdf.setStyle({ size: LEGEND_FONT_SIZE, color: PDF_COLORS.muted });
      this.pdf.drawLine(label, x + 9, this.pdf.y);

      x += labelWidth;
    });

    this.pdf.y += lineHeight;
  }

  public draw(widget: AIChatWidget): void {
    const series: Array<ExportChartSeries> = toExportChartSeries(widget);

    if (!chartHasData(series)) {
      this.drawEmptyState();
      return;
    }

    const isBar: boolean = widget.type === AIChatWidgetType.BarChart;
    const isTime: boolean = chartIsTimeBased(series);

    // The plot is atomic: move the whole thing rather than split it.
    const legendHeight: number = series.length > 1 ? 16 : 0;
    this.pdf.ensureSpace(PLOT_HEIGHT + X_AXIS_HEIGHT + legendHeight + 8);

    if (series.length > 1) {
      this.drawLegend(series, this.pdf.contentWidth);
    }

    const plotX0: number = this.pdf.left + Y_GUTTER;
    const plotX1: number = this.pdf.right;
    const plotY0: number = this.pdf.y;
    const plotY1: number = plotY0 + PLOT_HEIGHT;
    const plotWidth: number = plotX1 - plotX0;

    // ---- Y domain ------------------------------------------------------
    const values: Array<number> = series.flatMap((item: ExportChartSeries) => {
      return item.points.map((point: ExportChartPoint) => {
        return point.y;
      });
    });

    const dataMin: number = Math.min(...values);
    const dataMax: number = Math.max(...values);

    /*
     * Bars are anchored at zero; lines are not. The line chart deliberately
     * zooms to the data range so a slow drift in a cumulative counter is still
     * legible, and the export keeps that behaviour.
     */
    let yMin: number = isBar ? Math.min(0, dataMin) : dataMin;
    let yMax: number = dataMax;

    if (yMin === yMax) {
      // A flat series would otherwise divide by zero; give it some air.
      yMin = yMin === 0 ? -1 : yMin - Math.abs(yMin) * 0.1;
      yMax = yMax === 0 ? 1 : yMax + Math.abs(yMax) * 0.1;
    }

    const ticks: Array<number> = niceTicks(yMin, yMax, 5);
    const axisMin: number = Math.min(yMin, ...ticks);
    const axisMax: number = Math.max(yMax, ...ticks);

    const toY: (value: number) => number = (value: number): number => {
      const ratio: number = (value - axisMin) / (axisMax - axisMin || 1);
      return plotY1 - ratio * PLOT_HEIGHT;
    };

    // ---- Grid + Y ticks ------------------------------------------------
    this.pdf.doc.setLineDashPattern([2, 2], 0);
    for (const tick of ticks) {
      const y: number = toY(tick);
      this.pdf.hairline(plotX0, y, plotX1, y, PDF_COLORS.subtleBorder);
    }
    this.pdf.doc.setLineDashPattern([], 0);

    this.pdf.setStyle({ size: TICK_FONT_SIZE, color: PDF_COLORS.muted });
    for (const tick of ticks) {
      const label: string = this.pdf.sanitize(
        formatChartValue(tick, widget.data.unit),
      );
      this.pdf.setStyle({ size: TICK_FONT_SIZE, color: PDF_COLORS.muted });
      this.pdf.doc.text(label, plotX0 - 5, toY(tick), {
        baseline: "middle",
        align: "right",
      });
    }

    // ---- X positions ---------------------------------------------------
    const categories: Array<string> = [];
    if (!isTime) {
      for (const item of series) {
        for (const point of item.points) {
          if (!categories.includes(point.x)) {
            categories.push(point.x);
          }
        }
      }
    }

    const times: Array<number> = isTime
      ? series.flatMap((item: ExportChartSeries) => {
          return item.points.map((point: ExportChartPoint) => {
            return (point.date as Date).getTime();
          });
        })
      : [];

    const timeMin: number = isTime ? Math.min(...times) : 0;
    const timeMax: number = isTime ? Math.max(...times) : 0;
    const timeSpan: number = timeMax - timeMin;

    const slotWidth: number =
      categories.length > 0 ? plotWidth / categories.length : 0;

    const toX: (point: ExportChartPoint) => number = (
      point: ExportChartPoint,
    ): number => {
      if (isTime) {
        if (timeSpan === 0) {
          return plotX0 + plotWidth / 2;
        }
        const ratio: number =
          ((point.date as Date).getTime() - timeMin) / timeSpan;
        return plotX0 + ratio * plotWidth;
      }
      const index: number = categories.indexOf(point.x);
      return plotX0 + slotWidth * (index + 0.5);
    };

    // ---- Marks ---------------------------------------------------------
    if (isBar) {
      this.drawBars(series, {
        plotX0,
        plotWidth,
        plotY1,
        toX,
        toY,
        axisMin,
        isTime,
        categoryCount: categories.length || 1,
      });
    } else {
      this.drawLines(series, toX, toY);
    }

    // ---- X labels ------------------------------------------------------
    this.drawXLabels({
      isTime: isTime,
      categories: categories,
      timeMin: timeMin,
      timeSpan: timeSpan,
      plotX0: plotX0,
      plotWidth: plotWidth,
      plotY1: plotY1,
      slotWidth: slotWidth,
    });

    this.pdf.y = plotY1 + X_AXIS_HEIGHT + 6;
  }

  private drawLines(
    series: Array<ExportChartSeries>,
    toX: (point: ExportChartPoint) => number,
    toY: (value: number) => number,
  ): void {
    series.forEach((item: ExportChartSeries, index: number) => {
      if (item.points.length === 0) {
        return;
      }

      const color: string = chartColorForIndex(index);
      const sorted: Array<ExportChartPoint> = [...item.points].sort(
        (a: ExportChartPoint, b: ExportChartPoint) => {
          return toX(a) - toX(b);
        },
      );

      this.pdf.doc.setDrawColor(color);
      this.pdf.doc.setLineWidth(1.2);
      this.pdf.doc.setLineJoin("round");
      this.pdf.doc.setLineCap("round");

      /*
       * A single point draws no stroke, so it gets a dot instead — otherwise
       * the series would silently vanish from the chart.
       */
      if (sorted.length === 1) {
        const only: ExportChartPoint = sorted[0] as ExportChartPoint;
        this.pdf.circle(toX(only), toY(only.y), 1.8, color);
        return;
      }

      for (let i: number = 1; i < sorted.length; i++) {
        const previous: ExportChartPoint = sorted[i - 1] as ExportChartPoint;
        const current: ExportChartPoint = sorted[i] as ExportChartPoint;
        this.pdf.doc.line(
          toX(previous),
          toY(previous.y),
          toX(current),
          toY(current.y),
        );
      }
    });

    this.pdf.doc.setLineWidth(0.5);
  }

  private drawBars(
    series: Array<ExportChartSeries>,
    layout: {
      plotX0: number;
      plotWidth: number;
      plotY1: number;
      toX: (point: ExportChartPoint) => number;
      toY: (value: number) => number;
      axisMin: number;
      isTime: boolean;
      categoryCount: number;
    },
  ): void {
    const zeroY: number = layout.toY(Math.max(0, layout.axisMin));

    /*
     * Bars are grouped, never stacked — matching the chat, which ignores
     * data.stacked because its BarChart never forwards a stacked type.
     */
    const slot: number = layout.isTime
      ? layout.plotWidth / Math.max(1, this.countDistinctX(series))
      : layout.plotWidth / Math.max(1, layout.categoryCount);

    const groupWidth: number = slot * 0.9;
    const barWidth: number = Math.max(
      0.6,
      groupWidth / Math.max(1, series.length),
    );

    series.forEach((item: ExportChartSeries, index: number) => {
      this.pdf.doc.setFillColor(chartColorForIndex(index));

      for (const point of item.points) {
        const center: number = layout.toX(point);
        const x: number = center - groupWidth / 2 + index * barWidth;
        const y: number = layout.toY(point.y);
        const height: number = Math.abs(zeroY - y);

        if (height < 0.4) {
          continue;
        }

        this.pdf.doc.rect(x, Math.min(y, zeroY), barWidth, height, "F");
      }
    });
  }

  private countDistinctX(series: Array<ExportChartSeries>): number {
    const seen: Set<string> = new Set();
    for (const item of series) {
      for (const point of item.points) {
        seen.add(point.x);
      }
    }
    return seen.size;
  }

  /*
   * Labels are thinned to whatever fits: the widest label plus a gap decides
   * how many can be drawn, then an even stride picks them. Recharts thins by
   * measuring rendered pixels, which is not reproducible here, so this is a
   * deterministic stand-in rather than a match.
   */
  private drawXLabels(layout: {
    isTime: boolean;
    categories: Array<string>;
    timeMin: number;
    timeSpan: number;
    plotX0: number;
    plotWidth: number;
    plotY1: number;
    slotWidth: number;
  }): void {
    this.pdf.setStyle({ size: TICK_FONT_SIZE, color: PDF_COLORS.muted });

    const labels: Array<{ text: string; x: number }> = [];

    if (layout.isTime) {
      const sampleCount: number = 6;
      for (let i: number = 0; i < sampleCount; i++) {
        const ratio: number = sampleCount === 1 ? 0 : i / (sampleCount - 1);
        const time: number = layout.timeMin + layout.timeSpan * ratio;
        labels.push({
          text: formatTimeLabel(new Date(time), layout.timeSpan),
          x: layout.plotX0 + layout.plotWidth * ratio,
        });
      }
    } else {
      layout.categories.forEach((category: string, index: number) => {
        labels.push({
          text: category,
          x: layout.plotX0 + layout.slotWidth * (index + 0.5),
        });
      });
    }

    if (labels.length === 0) {
      return;
    }

    const widest: number = Math.max(
      ...labels.map((label: { text: string }) => {
        return this.pdf.textWidth(this.pdf.sanitize(label.text));
      }),
    );

    const maxLabels: number = Math.max(
      1,
      Math.floor(layout.plotWidth / (widest + 12)),
    );
    const stride: number = Math.max(1, Math.ceil(labels.length / maxLabels));

    labels.forEach((label: { text: string; x: number }, index: number) => {
      if (index % stride !== 0 && index !== labels.length - 1) {
        return;
      }

      const text: string = this.pdf.sanitize(label.text);
      const width: number = this.pdf.textWidth(text);

      // Keep the first and last labels inside the plot box.
      const x: number = Math.min(
        Math.max(label.x, layout.plotX0 + width / 2),
        layout.plotX0 + layout.plotWidth - width / 2,
      );

      this.pdf.doc.text(text, x, layout.plotY1 + 4, {
        baseline: "top",
        align: "center",
      });
    });
  }
}
