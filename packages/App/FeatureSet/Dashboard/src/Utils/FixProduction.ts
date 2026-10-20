import FixProductionCheck from "Common/Types/AI/FixProductionCheck";
import FixProductionStatus from "Common/Types/AI/FixProductionStatus";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  AITaskTone,
  FIX_PRODUCTION_LABELS,
  getFixProductionTone,
} from "./ExceptionAIAssistance";

/*
 * What production showed about a merged AI fix (FixProductionVerifier on
 * the server), in words, by what the fix was watched for
 * (FixProductionCheck). Waiting for the deploy and watching read the same
 * for every fix; what a verdict means does not: an exception that stopped,
 * an operation made faster, a monitor that stopped raising incidents,
 * telemetry that arrives. Pure, so every word is pinned by tests; each
 * label is English, wrapped in translationKey() so the extractor finds it,
 * and translated where it is drawn.
 */

const WAITING: Pick<
  Record<FixProductionStatus, string>,
  | FixProductionStatus.AwaitingDeploy
  | FixProductionStatus.Watching
  | FixProductionStatus.Unverifiable
> = {
  [FixProductionStatus.AwaitingDeploy]:
    FIX_PRODUCTION_LABELS[FixProductionStatus.AwaitingDeploy],
  [FixProductionStatus.Watching]:
    FIX_PRODUCTION_LABELS[FixProductionStatus.Watching],
  [FixProductionStatus.Unverifiable]:
    FIX_PRODUCTION_LABELS[FixProductionStatus.Unverifiable],
};

export const FIX_PRODUCTION_CHECK_LABELS: Record<
  FixProductionCheck,
  Record<FixProductionStatus, string>
> = {
  [FixProductionCheck.Exception]: FIX_PRODUCTION_LABELS,
  [FixProductionCheck.Performance]: {
    ...WAITING,
    [FixProductionStatus.Verified]: translationKey("Faster in production"),
    [FixProductionStatus.Regressed]: translationKey("Still slow after the fix"),
  },
  [FixProductionCheck.Recurrence]: {
    ...WAITING,
    [FixProductionStatus.Verified]: translationKey("Fixed in production"),
    [FixProductionStatus.Regressed]: translationKey(
      "Happened again after the fix",
    ),
  },
  [FixProductionCheck.Telemetry]: {
    ...WAITING,
    [FixProductionStatus.Verified]: translationKey("Arriving in production"),
    [FixProductionStatus.Regressed]: translationKey(
      "Telemetry stopped after the fix",
    ),
  },
};

// The fields of a verdict its words are chosen by.
export interface FixProductionWords {
  status: FixProductionStatus;
  // Absent: an exception fix, the only kind watched before the checks.
  check?: FixProductionCheck | undefined;
}

export function getFixProductionLabel(production: FixProductionWords): string {
  return FIX_PRODUCTION_CHECK_LABELS[
    production.check || FixProductionCheck.Exception
  ][production.status];
}

export function getFixProductionVerdictTone(
  production: FixProductionWords,
): AITaskTone {
  return getFixProductionTone(production.status);
}
