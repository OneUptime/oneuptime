import { formatReaderFigure } from "Common/Types/DateLanguage";
import {
  BytesReading,
  formatBytes,
  getBytesReading,
} from "../../../Components/TelemetryResource/telemetryFormat";

/*
 * OPENSTACK'S FIGURES, IN THE READER'S DIGITS.
 *
 * Every size OpenStack's pages write - a volume, a pool, a flavor's memory,
 * what a project holds - was written with toFixed: Latin digits whatever
 * the page's language, so a Persian Overview put "6.0 TiB" beside counts
 * that read "۲۰" (issue #7191). Here the same figure in the same unit (B,
 * KiB, MiB, GiB, TiB, one decimal under ten and none from ten up) is
 * written in the reader's digits and decimal sign (formatReaderFigure):
 * "۶٫۰ TiB" in Persian, "6,0 TiB" in German, exactly as before in English,
 * and in Latin digits in Arabic, which writes them by choice.
 *
 * A size is a number and a unit in Latin letters, so on a page read from
 * the right it is drawn as a value of its own (a bdi, IsolatedText) or set
 * apart in its sentence (SentenceOptions' setsValuesApart): otherwise the
 * line puts its unit first ("TiB ۶٫۰").
 *
 * A chart's axis and tooltip keep Latin digits, as every chart in the
 * product does (formatOpenStackChartBytes): changing only OpenStack's would
 * mix the two on one page.
 *
 * React-free, so the node tests and the capacity view share these.
 */

export interface OpenStackFigureOptions {
  // The reader's language; the page's (getDateDisplayLanguage) when not given.
  language?: string | undefined;
}

// "۶٫۰ TiB", "480 GiB": a size in the reader's digits, in formatBytes' unit.
export function formatOpenStackBytes(
  bytes: number,
  options?: OpenStackFigureOptions,
): string {
  if (!Number.isFinite(bytes)) {
    return "—";
  }

  const reading: BytesReading = getBytesReading(bytes);

  return `${formatReaderFigure(reading.value, {
    decimals: reading.decimals,
    language: options?.language,
  })} ${reading.unit}`;
}

// A chart's axis and tooltip: Latin digits, as every chart writes them.
export function formatOpenStackChartBytes(bytes: number): string {
  return formatBytes(bytes);
}

// "۲۰", "۱٫۵": a whole count as it is, one with a fraction to one decimal.
export function formatOpenStackCount(
  count: number,
  options?: OpenStackFigureOptions,
): string {
  return formatReaderFigure(count, {
    decimals: Number.isInteger(count) ? 0 : 1,
    language: options?.language,
  });
}

/*
 * "۹۲%": a share rounded to a whole percent, in the reader's digits, with
 * the percent sign the OpenStack pages already write after their own
 * (translator.formatNumber(...) + "%"). Which side a percent sign goes on
 * in Persian is #7196's, for every page at once.
 */
export function formatOpenStackPercent(
  percent: number,
  options?: OpenStackFigureOptions,
): string {
  return `${formatReaderFigure(Math.round(percent), {
    decimals: 0,
    language: options?.language,
  })}%`;
}
