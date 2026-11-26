import { translationKey, Translator } from "Common/Types/Translator";
import { formatReaderFigure } from "Common/Types/DateLanguage";
import { EMPTY_VALUE_MARK } from "Common/Types/EmptyValueMark";
import {
  XcpNgHostPowerState,
  XcpNgVmPowerState,
} from "Common/Types/XcpNg/XcpNgTelemetry";
import { getNoStatusYetText } from "./DashboardWidgetFallbackWords";

/*
 * Pure, React-free helpers behind the XCP-ng host and VM dashboard
 * widgets: what state a row is drawn in, in which color, and how its
 * figures are written. Kept out of the .tsx files so the states - the part
 * an operator acts on - are unit-tested in the node test environment.
 *
 * A state is worded here, once, in the reader's language (the translator
 * handed in): a row draws its text as it comes, and a honeycomb tile or the
 * legend is told the words are the reader's already (isStatusUserContent,
 * isLabelUserContent), so nothing looks them up twice.
 */

export interface XcpNgWidgetState {
  // In the reader's words.
  text: string;
  color: string;
  textColor: string;
}

export interface XcpNgWidgetLegendItem {
  // In the reader's words.
  label: string;
  color: string;
  isLabelUserContent: true;
}

export const XCP_NG_WIDGET_COLORS: {
  running: string;
  disabled: string;
  notRunning: string;
  halted: string;
  paused: string;
  suspended: string;
  noStatus: string;
} = {
  running: "#10b981",
  disabled: "#f59e0b",
  notRunning: "#ef4444",
  halted: "#9ca3af",
  paused: "#f59e0b",
  suspended: "#8b5cf6",
  noStatus: "#d1d5db",
};

const TEXT_COLORS: {
  success: string;
  warning: string;
  danger: string;
  muted: string;
} = {
  success: "var(--ou-success-text, #047857)",
  warning: "var(--ou-warning-text, #b45309)",
  danger: "var(--ou-danger-text, #b91c1c)",
  muted: "var(--ou-text-muted, #6b7280)",
};

// The states' words, keys of the Dashboard's locales.
export const XCP_NG_RUNNING_TEXT: string = translationKey("Running");
export const XCP_NG_DISABLED_TEXT: string = translationKey("Disabled");
export const XCP_NG_HALTED_TEXT: string = translationKey("Halted");
export const XCP_NG_UNKNOWN_TEXT: string = translationKey("Unknown");
export const XCP_NG_PAUSED_TEXT: string = translationKey("Paused");
export const XCP_NG_SUSPENDED_TEXT: string = translationKey("Suspended");
export const XCP_NG_NOT_RUNNING_TEXT: string = translationKey("Not running");

function wordOf(translator: Translator, key: string): string {
  return translator.translateText(key) || key;
}

// The part of an XcpNgResource row its state is read from.
export interface XcpNgStateRow {
  isUp?: boolean | null | undefined;
  isEnabled?: boolean | null | undefined;
  powerState?: string | null | undefined;
}

/*
 * A host's state. Running hosts are green, and amber when disabled: in
 * maintenance mode, or left disabled by an evacuation, XAPI starts no VM on
 * it and HA cannot fail over to it. A host that is not running is red, as
 * Xen Orchestra names it: Halted, or Unknown when the pool master lost
 * contact with it (the Host Offline template fires for both). A host Xen
 * Orchestra has said nothing about yet has no status yet.
 */
export function getXcpNgHostState(
  row: XcpNgStateRow,
  translator: Translator,
): XcpNgWidgetState {
  if (row.isUp === true) {
    if (row.isEnabled === false) {
      return {
        text: wordOf(translator, XCP_NG_DISABLED_TEXT),
        color: XCP_NG_WIDGET_COLORS.disabled,
        textColor: TEXT_COLORS.warning,
      };
    }

    return {
      text: wordOf(translator, XCP_NG_RUNNING_TEXT),
      color: XCP_NG_WIDGET_COLORS.running,
      textColor: TEXT_COLORS.success,
    };
  }

  if (row.isUp === false) {
    return {
      text: wordOf(
        translator,
        row.powerState === XcpNgHostPowerState.Halted
          ? XCP_NG_HALTED_TEXT
          : XCP_NG_UNKNOWN_TEXT,
      ),
      color: XCP_NG_WIDGET_COLORS.notRunning,
      textColor: TEXT_COLORS.danger,
    };
  }

  return {
    text: getNoStatusYetText(translator),
    color: XCP_NG_WIDGET_COLORS.noStatus,
    textColor: TEXT_COLORS.muted,
  };
}

/*
 * The host legend says what each color means: a red tile is a host that
 * is not running, whichever of Halted or Unknown its tooltip names.
 */
export function getXcpNgHostLegend(
  translator: Translator,
): Array<XcpNgWidgetLegendItem> {
  return [
    {
      label: wordOf(translator, XCP_NG_RUNNING_TEXT),
      color: XCP_NG_WIDGET_COLORS.running,
      isLabelUserContent: true,
    },
    {
      label: wordOf(translator, XCP_NG_DISABLED_TEXT),
      color: XCP_NG_WIDGET_COLORS.disabled,
      isLabelUserContent: true,
    },
    {
      label: wordOf(translator, XCP_NG_NOT_RUNNING_TEXT),
      color: XCP_NG_WIDGET_COLORS.notRunning,
      isLabelUserContent: true,
    },
    {
      label: getNoStatusYetText(translator),
      color: XCP_NG_WIDGET_COLORS.noStatus,
      isLabelUserContent: true,
    },
  ];
}

/*
 * A VM's state, as Xen Orchestra names its power state. Halted is gray,
 * not red - a halted VM is often a planned shutdown (a VM kept for
 * failover, a batch worker); the VM Stopped template alerts on one that
 * halts after running. Paused is amber: the VM holds its memory but runs
 * nothing, which nobody leaves for long on purpose. Suspended is someone's
 * choice, its memory saved to disk. A VM that is not running in a state
 * this version does not know is drawn as not running.
 */
export function getXcpNgVmState(
  row: XcpNgStateRow,
  translator: Translator,
): XcpNgWidgetState {
  if (row.isUp === true) {
    return {
      text: wordOf(translator, XCP_NG_RUNNING_TEXT),
      color: XCP_NG_WIDGET_COLORS.running,
      textColor: TEXT_COLORS.success,
    };
  }

  if (row.powerState === XcpNgVmPowerState.Paused) {
    return {
      text: wordOf(translator, XCP_NG_PAUSED_TEXT),
      color: XCP_NG_WIDGET_COLORS.paused,
      textColor: TEXT_COLORS.warning,
    };
  }

  if (row.powerState === XcpNgVmPowerState.Suspended) {
    return {
      text: wordOf(translator, XCP_NG_SUSPENDED_TEXT),
      color: XCP_NG_WIDGET_COLORS.suspended,
      textColor: TEXT_COLORS.muted,
    };
  }

  if (row.powerState === XcpNgVmPowerState.Halted) {
    return {
      text: wordOf(translator, XCP_NG_HALTED_TEXT),
      color: XCP_NG_WIDGET_COLORS.halted,
      textColor: TEXT_COLORS.muted,
    };
  }

  if (row.isUp === false) {
    return {
      text: wordOf(translator, XCP_NG_NOT_RUNNING_TEXT),
      color: XCP_NG_WIDGET_COLORS.halted,
      textColor: TEXT_COLORS.muted,
    };
  }

  return {
    text: getNoStatusYetText(translator),
    color: XCP_NG_WIDGET_COLORS.noStatus,
    textColor: TEXT_COLORS.muted,
  };
}

export function getXcpNgVmLegend(
  translator: Translator,
): Array<XcpNgWidgetLegendItem> {
  return [
    {
      label: wordOf(translator, XCP_NG_RUNNING_TEXT),
      color: XCP_NG_WIDGET_COLORS.running,
      isLabelUserContent: true,
    },
    {
      label: wordOf(translator, XCP_NG_PAUSED_TEXT),
      color: XCP_NG_WIDGET_COLORS.paused,
      isLabelUserContent: true,
    },
    {
      label: wordOf(translator, XCP_NG_SUSPENDED_TEXT),
      color: XCP_NG_WIDGET_COLORS.suspended,
      isLabelUserContent: true,
    },
    {
      label: wordOf(translator, XCP_NG_HALTED_TEXT),
      color: XCP_NG_WIDGET_COLORS.halted,
      isLabelUserContent: true,
    },
    {
      label: getNoStatusYetText(translator),
      color: XCP_NG_WIDGET_COLORS.noStatus,
      isLabelUserContent: true,
    },
  ];
}

export function toFiniteNumber(value: unknown): number | undefined {
  if (value === undefined || value === null || value === "") {
    return undefined;
  }
  const numeric: number = Number(value);
  return Number.isFinite(numeric) ? numeric : undefined;
}

/*
 * A percent of the inventory (a host's or a VM's latest CPU or memory), in
 * the reader's digits, decimal sign and percent sign ("42.5%", "42,5 %",
 * "۴۲٫۵٪"), or the quiet mark for one it has not reported.
 */
export function formatXcpNgPercent(
  value: unknown,
  translator: Translator,
): string {
  const numeric: number | undefined = toFiniteNumber(value);

  if (numeric === undefined) {
    return EMPTY_VALUE_MARK;
  }

  return formatReaderFigure(numeric, {
    decimals: 1,
    isPercent: true,
    language: translator.language,
  });
}

/*
 * A percent's color in a row: amber from 70%, red from 90%, as the VMware
 * host widget bands a host's load, so a host or VM heading for saturation
 * stands out before an alert template fires.
 */
export function getXcpNgPercentTextColor(value: unknown): string {
  const numeric: number | undefined = toFiniteNumber(value);

  if (numeric === undefined) {
    return TEXT_COLORS.muted;
  }

  if (numeric >= 90) {
    return TEXT_COLORS.danger;
  }

  if (numeric >= 70) {
    return TEXT_COLORS.warning;
  }

  return TEXT_COLORS.muted;
}
