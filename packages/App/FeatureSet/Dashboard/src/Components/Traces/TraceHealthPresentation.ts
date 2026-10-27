import OneUptimeDate from "Common/Types/Date";
import {
  TraceHealthHint,
  TraceHealthReport,
} from "Common/Types/Telemetry/TraceHealth";
import {
  composedValue,
  TemplateValues,
  translationKey,
  Translator,
} from "Common/UI/Utils/TranslateTemplate";

/*
 * The words and numbers of the "Trace health" card (TraceHealthCard) - the
 * pure half, so the suites read it without a browser. The server decides
 * which numbers look poor (the thresholds live in one place,
 * Common/Server/Utils/Telemetry/TraceHealth) and sends them as hints; this
 * says what each tile is called, how its number is written, and what a hint
 * tells the reader to do, with the docs section that explains it.
 *
 * Labels and hints are English keys (translationKey), looked up where they
 * are drawn. Values and the sample sentence are written here, in the
 * reader's language, with the translator the card hands in.
 */

export const TRACE_HEALTH_TITLE: string = translationKey("Trace health");

export const TRACE_HEALTH_DESCRIPTION: string = translationKey(
  "Whether this service's traces arrive whole, and whether its logs link to them.",
);

export enum TraceHealthTileKey {
  CompleteTraces = "CompleteTraces",
  OneSpanTraces = "OneSpanTraces",
  LinkedLogs = "LinkedLogs",
}

export interface TraceHealthTileHint {
  // What usually causes it and what to do, as an English key.
  text: string;
  // The words of the link to the docs section, as an English key.
  linkText: string;
  docsUrl: string;
}

export interface TraceHealthTile {
  key: TraceHealthTileKey;
  // An English key.
  label: string;
  // Written in the reader's language: "98%", "No logs".
  value: string;
  isPoor: boolean;
  // Only on a tile that looks poor.
  hint: TraceHealthTileHint | null;
}

/*
 * What each hint says and where it points: the Kubernetes agent's pages,
 * because its eBPF traces and pod logs are where these show up most. Docs
 * links are written whole, so DocsLinksResolve holds each to a heading the
 * page has.
 */
export const TRACE_HEALTH_HINTS: Readonly<
  Record<TraceHealthHint, TraceHealthTileHint>
> = {
  [TraceHealthHint.MissingParentSpans]: {
    text: translationKey(
      "Some spans arrive without the span they belong to: usually a sender dropping spans under load, or a database proxy the Kubernetes agent does not recognise (add it to ebpf.databaseProxyNames).",
    ),
    linkText: translationKey("How the agent links spans"),
    docsUrl: "/docs/telemetry/kubernetes-agent#what-ebpf-traces-look-like",
  },
  [TraceHealthHint.OneSpanTraces]: {
    text: translationKey(
      "Many traces are a single span: usually background work that no request started, or calls the agent could not link to the request they belong to.",
    ),
    linkText: translationKey("Why some traces are one span"),
    docsUrl: "/docs/telemetry/kubernetes-agent#what-ebpf-traces-look-like",
  },
  [TraceHealthHint.UnlinkedLogs]: {
    text: translationKey(
      "Most logs carry no trace id. Turn on log correlation in the agent, or send logs through your OpenTelemetry SDK.",
    ),
    linkText: translationKey("Link logs to traces"),
    docsUrl: "/docs/monitor/kubernetes-agent#linking-logs-to-traces",
  },
};

export const TRACE_HEALTH_TILE_LABELS: Readonly<
  Record<TraceHealthTileKey, string>
> = {
  [TraceHealthTileKey.CompleteTraces]: translationKey("Traces with every span"),
  [TraceHealthTileKey.OneSpanTraces]: translationKey("One-span traces"),
  [TraceHealthTileKey.LinkedLogs]: translationKey("Logs linked to a trace"),
};

// What the logs tile says when the service has no logs in the window.
export const TRACE_HEALTH_NO_LOGS: string = translationKey("No logs");

// A number that was not measured.
const NOT_MEASURED: string = "—";

/*
 * The card is shown once a report has come back with spans in it: never
 * while it loads, when the service sent no span in the window, or when the
 * report could not be read.
 */
export function isTraceHealthShown(
  report: TraceHealthReport | null,
): report is TraceHealthReport {
  return Boolean(report && report.spanCount > 0);
}

/*
 * A share as a percentage the reader's way ("98%", "99,6 %"). A whole
 * percent, except at the ends: a share above 0 never reads 0% and one below
 * 1 never reads 100%, so a sliver of missing spans is not rounded away.
 */
export function formatTraceHealthShare(
  share: number | null,
  language: string,
): string {
  if (share === null || !Number.isFinite(share)) {
    return NOT_MEASURED;
  }

  const percent: number = Math.min(100, Math.max(0, share * 100));
  let shown: number = Math.round(percent);
  let fractionDigits: number = 0;

  if (percent > 0 && percent < 1) {
    shown = Math.max(0.1, Math.ceil(percent * 10) / 10);
    fractionDigits = 1;
  } else if (percent > 99 && percent < 100) {
    shown = Math.min(99.9, Math.floor(percent * 10) / 10);
    fractionDigits = 1;
  }

  const options: Intl.NumberFormatOptions = {
    style: "percent",
    maximumFractionDigits: fractionDigits,
  };

  try {
    return new Intl.NumberFormat(language, options).format(shown / 100);
  } catch {
    return new Intl.NumberFormat("en", options).format(shown / 100);
  }
}

function tile(data: {
  key: TraceHealthTileKey;
  value: string;
  hint: TraceHealthHint;
  report: TraceHealthReport;
}): TraceHealthTile {
  const isPoor: boolean = data.report.hints.includes(data.hint);

  return {
    key: data.key,
    label: TRACE_HEALTH_TILE_LABELS[data.key],
    value: data.value,
    isPoor,
    hint: isPoor ? TRACE_HEALTH_HINTS[data.hint] : null,
  };
}

// The three tiles, in the order the card shows them.
export function getTraceHealthTiles(
  report: TraceHealthReport,
  translator: Translator,
): Array<TraceHealthTile> {
  return [
    tile({
      key: TraceHealthTileKey.CompleteTraces,
      value: formatTraceHealthShare(
        report.orphanSpanShare === null ? null : 1 - report.orphanSpanShare,
        translator.language,
      ),
      hint: TraceHealthHint.MissingParentSpans,
      report,
    }),
    tile({
      key: TraceHealthTileKey.OneSpanTraces,
      value: formatTraceHealthShare(
        report.singleSpanTraceShare,
        translator.language,
      ),
      hint: TraceHealthHint.OneSpanTraces,
      report,
    }),
    tile({
      key: TraceHealthTileKey.LinkedLogs,
      value:
        report.logsLinkedShare === null
          ? translator.translateText(TRACE_HEALTH_NO_LOGS) ||
            TRACE_HEALTH_NO_LOGS
          : formatTraceHealthShare(report.logsLinkedShare, translator.language),
      hint: TraceHealthHint.UnlinkedLogs,
      report,
    }),
  ];
}

/*
 * What the numbers were measured on, for the (i) beside the card's title:
 * the window, the share of traces read, and how many spans, traces and logs
 * that was. Kept off the face of the card. One whole sentence for each
 * case, so a locale words each its own way.
 */
export function describeTraceHealthSample(
  report: TraceHealthReport,
  translator: Translator,
): string {
  const values: TemplateValues = {
    start: OneUptimeDate.getDateAsLocalDayMonthTimeString(report.startTime),
    end: OneUptimeDate.getDateAsLocalDayMonthTimeString(report.endTime),
    percent: translator.formatNumber(report.samplePercent),
    spans: composedValue((sentence: Translator): string => {
      return sentence.translatePlural(
        { one: "{{count}} span", other: "{{count}} spans" },
        report.spanCount,
      );
    }),
    traces: composedValue((sentence: Translator): string => {
      return sentence.translatePlural(
        { one: "{{count}} trace", other: "{{count}} traces" },
        report.traceCount,
      );
    }),
    logs: composedValue((sentence: Translator): string => {
      return sentence.translatePlural(
        { one: "{{count}} log", other: "{{count}} logs" },
        report.logCount,
      );
    }),
  };

  const isSampled: boolean = report.samplePercent < 100;

  if (report.logCount === 0) {
    return isSampled
      ? translator.translateTemplate(
          "Measured from {{start}} to {{end}} on a {{percent}}% sample of the traces this service has spans in: {{spans}} in {{traces}}.",
          values,
        )
      : translator.translateTemplate(
          "Measured from {{start}} to {{end}} on every trace this service has spans in: {{spans}} in {{traces}}.",
          values,
        );
  }

  return isSampled
    ? translator.translateTemplate(
        "Measured from {{start}} to {{end}} on a {{percent}}% sample of the traces this service has spans in, {{spans}} in {{traces}}, and on all of its logs: {{logs}}.",
        values,
      )
    : translator.translateTemplate(
        "Measured from {{start}} to {{end}} on every trace this service has spans in, {{spans}} in {{traces}}, and on all of its logs: {{logs}}.",
        values,
      );
}
