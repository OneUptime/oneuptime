import React, { FunctionComponent, ReactElement } from "react";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * StorageArray.healthStatus as a pill: 0 = OK, 1 = Warning, 2 = Critical —
 * the same scale as CephCluster.healthStatus — written by the metrics
 * ingest scan from the array's own open alerts and hardware status. null
 * means no batch has carried both the alert and the hardware series yet.
 */
export enum StorageArrayHealthState {
  Ok = "ok",
  Warning = "warning",
  Critical = "critical",
  Unknown = "unknown",
}

export function getStorageArrayHealthState(
  healthStatus: number | null | undefined,
): StorageArrayHealthState {
  if (healthStatus === null || healthStatus === undefined) {
    return StorageArrayHealthState.Unknown;
  }
  const value: number = Number(healthStatus);
  if (!Number.isFinite(value)) {
    return StorageArrayHealthState.Unknown;
  }
  if (value >= 2) {
    return StorageArrayHealthState.Critical;
  }
  if (value >= 1) {
    return StorageArrayHealthState.Warning;
  }
  return StorageArrayHealthState.Ok;
}

interface HealthPillStyle {
  label: string;
  labelWithPrefix: string;
  badge: string;
  dot: string;
}

const HEALTH_PILL_STYLES: Record<StorageArrayHealthState, HealthPillStyle> = {
  [StorageArrayHealthState.Ok]: {
    label: translationKey("OK"),
    labelWithPrefix: translationKey("Health OK"),
    badge: "bg-emerald-50 text-emerald-700 ring-emerald-200",
    dot: "bg-emerald-500",
  },
  [StorageArrayHealthState.Warning]: {
    label: translationKey("Warning"),
    labelWithPrefix: translationKey("Health Warning"),
    badge: "bg-amber-50 text-amber-700 ring-amber-200",
    dot: "bg-amber-500",
  },
  [StorageArrayHealthState.Critical]: {
    label: translationKey("Critical"),
    labelWithPrefix: translationKey("Health Critical"),
    badge: "bg-red-50 text-red-700 ring-red-200",
    dot: "bg-red-500",
  },
  [StorageArrayHealthState.Unknown]: {
    label: translationKey("Unknown"),
    labelWithPrefix: translationKey("Health Unknown"),
    badge: "bg-gray-50 text-gray-600 ring-gray-200",
    dot: "bg-gray-400",
  },
};

export function getStorageArrayHealthPillStyle(
  healthStatus: number | null | undefined,
): HealthPillStyle {
  return HEALTH_PILL_STYLES[getStorageArrayHealthState(healthStatus)];
}

export interface ComponentProps {
  healthStatus: number | null | undefined;
  // "Health OK" rather than "OK", for a pill that stands on its own.
  showHealthPrefix?: boolean | undefined;
}

const StorageArrayHealthPill: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const style: HealthPillStyle = getStorageArrayHealthPillStyle(
    props.healthStatus,
  );

  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-0.5 text-xs font-medium ring-1 ring-inset ${style.badge}`}
    >
      <span className={`h-1.5 w-1.5 rounded-full ${style.dot}`} />
      {translator.translateText(
        props.showHealthPrefix ? style.labelWithPrefix : style.label,
      )}
    </span>
  );
};

export default StorageArrayHealthPill;
