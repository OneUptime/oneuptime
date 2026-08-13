import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The single metric tile used across the on-call policy surfaces.
 *
 * This markup was previously a local `getStatTile` closure inside
 * EscalationSummary.tsx, and the OnCallPolicy directory already carries roughly
 * five near-identical chip/tile class strings between EscalationSummary,
 * OnCallPolicySummary and the rule cards. Adding a readiness card would have
 * made it a third copy of this exact tile, so it moves here instead: one place
 * that decides what a tile looks like, and one place to change when it stops
 * looking right.
 *
 * `tone` exists because the readiness tiles have to mean something — an amber
 * "Needs setup: 3" and a red "Unreachable: 1" are not the same statement as
 * "Levels: 3". The default tone reproduces the original indigo tile byte for
 * byte so the escalation summary is visually unchanged by the move.
 *
 * Colours are hardcoded light-mode (bg-white, text-gray-900, border-gray-200) to
 * match every other surface in this directory. There is no dark-mode variant
 * anywhere in EscalationSummary or Card, and a single dark-aware tile would be
 * the odd one out rather than a step towards dark mode.
 */

export type StatTileTone = "neutral" | "positive" | "warning" | "critical";

export interface ComponentProps {
  icon: IconProp;
  label: string;
  value: string;
  tone?: StatTileTone | undefined;
}

interface ToneClassNames {
  iconWrapperClassName: string;
  iconClassName: string;
  valueClassName: string;
}

const toneClassNames: Record<StatTileTone, ToneClassNames> = {
  neutral: {
    iconWrapperClassName: "bg-indigo-50",
    iconClassName: "text-indigo-600",
    valueClassName: "text-gray-900",
  },
  positive: {
    iconWrapperClassName: "bg-emerald-50",
    iconClassName: "text-emerald-600",
    valueClassName: "text-gray-900",
  },
  warning: {
    iconWrapperClassName: "bg-amber-50",
    iconClassName: "text-amber-600",
    valueClassName: "text-amber-700",
  },
  critical: {
    iconWrapperClassName: "bg-red-50",
    iconClassName: "text-red-600",
    valueClassName: "text-red-700",
  },
};

const StatTile: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const tone: ToneClassNames = toneClassNames[props.tone || "neutral"];

  return (
    <div className="flex items-center gap-3 rounded-xl border border-gray-200 bg-white px-4 py-3">
      <div
        className={`flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-lg ${tone.iconWrapperClassName}`}
      >
        <Icon icon={props.icon} className={`h-4 w-4 ${tone.iconClassName}`} />
      </div>
      <div className="min-w-0">
        <div
          className={`truncate text-lg font-semibold leading-tight ${tone.valueClassName}`}
        >
          {props.value}
        </div>
        <div className="truncate text-xs text-gray-500">{props.label}</div>
      </div>
    </div>
  );
};

export default StatTile;
