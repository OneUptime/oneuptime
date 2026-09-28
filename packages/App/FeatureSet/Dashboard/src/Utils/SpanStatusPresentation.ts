import { SpanStatus } from "Common/Models/AnalyticsModels/Span";

/*
 * How a span status looks and reads everywhere the Dashboard shows one: the
 * Traces chart and Status facet, the trace list rows, the span panel, the
 * dashboard trace widgets and the status dot in tables. Kept free of React so
 * the node tests can pin every value.
 *
 * Unset is OpenTelemetry's default status. Instrumentation sets Error when an
 * operation fails and leaves successful spans Unset; Ok is for code that
 * explicitly marks a span as successful. So on a healthy service most spans
 * are Unset, and a neutral grey made the Traces chart read as "mostly
 * unknown" (issue #4118). Unset therefore uses the success green and says
 * "no error" where there is room to; Error is the only alarming color. The
 * wording is about the status field: recording an exception does not change
 * a span's status, so an Unset span can still carry exceptions.
 *
 * Only the presentation lives here. The stored values (0 / 1 / 2), the
 * "Unset" name that filters, monitors and the API use, and the `status:unset`
 * search term all stay as they are.
 *
 * The chart colors were checked as a set, on the light (#ffffff) and dark
 * (#172033) card, for every pair — not only the neighbours in the chart's
 * stack (Ok, Unset, Error): Ok and Error touch whenever a bucket has no Unset
 * spans. Every pair stays apart for full color vision and under simulated
 * deuteranopia and protanopia. That rules out a darker green for Ok (it
 * collapses into red for protanopes), so the explicit Ok is cyan. The old
 * grey Unset failed (it sat next to Ok at the same lightness).
 * SpanStatusPresentation.test.ts pins those numbers. Keep them six-digit hex:
 * some consumers append an alpha suffix or parse the value.
 */

export interface SpanStatusPresentation {
  status: SpanStatus;
  // The status's own name, as filters, search, monitors and the API use it.
  label: string;
  // Legends, facets and filter chips, where there is room to explain Unset.
  displayLabel: string;
  // One sentence for tooltips.
  description: string;
  // Six-digit hex for chart series, facet dots and other inline colors.
  color: string;
  /*
   * Tailwind classes, as literal strings: Theme.css re-colors them for dark
   * mode by exact class name.
   */
  dotClassName: string;
  ringClassName: string;
  barClassName: string;
  barTrackClassName: string;
  pillClassName: string;
  // Accent for a pill that draws a border or a ring around pillClassName.
  pillBorderClassName: string;
  pillRingClassName: string;
}

const UNSET: SpanStatusPresentation = {
  status: SpanStatus.Unset,
  label: "Unset",
  displayLabel: "Unset (no error)",
  description:
    "No error status was set. Unset is the OpenTelemetry default for spans that finish without one.",
  color: "#10b981",
  dotClassName: "bg-emerald-500",
  ringClassName: "ring-emerald-200",
  barClassName: "bg-emerald-500",
  barTrackClassName: "bg-gray-100",
  pillClassName: "bg-emerald-50 text-emerald-700",
  pillBorderClassName: "border-emerald-100",
  pillRingClassName: "ring-emerald-600/10",
};

const OK: SpanStatusPresentation = {
  status: SpanStatus.Ok,
  label: "Ok",
  displayLabel: "Ok",
  description:
    "Explicitly marked successful by the application or a trace pipeline.",
  color: "#0891b2",
  dotClassName: "bg-cyan-600",
  ringClassName: "ring-cyan-200",
  barClassName: "bg-cyan-600",
  barTrackClassName: "bg-gray-100",
  pillClassName: "bg-cyan-50 text-cyan-800",
  pillBorderClassName: "border-cyan-100",
  pillRingClassName: "ring-cyan-600/10",
};

const ERROR: SpanStatusPresentation = {
  status: SpanStatus.Error,
  label: "Error",
  displayLabel: "Error",
  description: "The operation failed: the span's status is Error.",
  color: "#ef4444",
  dotClassName: "bg-red-500",
  ringClassName: "ring-red-100",
  barClassName: "bg-red-500",
  barTrackClassName: "bg-red-50",
  pillClassName: "bg-red-50 text-red-700",
  pillBorderClassName: "border-red-100",
  pillRingClassName: "ring-red-600/10",
};

// In the order the Traces chart stacks them, bottom to top.
export const SPAN_STATUS_PRESENTATIONS: ReadonlyArray<SpanStatusPresentation> =
  [OK, UNSET, ERROR];

/*
 * Accepts the stored number, a facet or chart key ("0" / "1" / "2"), or a
 * missing value. Anything that is not Ok or Error reads as Unset — the same
 * rule the server uses when it buckets the Traces chart.
 */
export function getSpanStatusPresentation(
  status: SpanStatus | number | string | null | undefined,
): SpanStatusPresentation {
  const code: number = Number(status);
  if (code === SpanStatus.Ok) {
    return OK;
  }
  if (code === SpanStatus.Error) {
    return ERROR;
  }
  return UNSET;
}

// Keyed by the stored value as a string ("0" / "1" / "2"), like facets are.
export function getSpanStatusColorMap(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const presentation of SPAN_STATUS_PRESENTATIONS) {
    map[String(presentation.status)] = presentation.color;
  }
  return map;
}

export function getSpanStatusDisplayLabelMap(): Record<string, string> {
  const map: Record<string, string> = {};
  for (const presentation of SPAN_STATUS_PRESENTATIONS) {
    map[String(presentation.status)] = presentation.displayLabel;
  }
  return map;
}
