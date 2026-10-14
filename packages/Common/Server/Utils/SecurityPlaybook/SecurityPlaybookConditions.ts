import SecurityCasePriority, {
  isPriorityAtLeast,
} from "../../../Types/SecurityCase/SecurityCasePriority";
import SecurityDetectionSource from "../../../Types/SecurityCase/SecurityDetectionSource";
import SecurityPlaybookTrigger from "../../../Types/SecurityPlaybook/SecurityPlaybookTrigger";

/*
 * Whether a playbook runs on its own for a case: pure, so the rule a
 * playbook's conditions read is tested apart from the database.
 *
 * The conditions read the detection that triggered the run (the one that
 * opened the case, or the one that just joined it) where they name a
 * detection - its source, its rule - and the case's priority as it is now,
 * after the detection raised it. A case opened by hand has no detection, so
 * a playbook limited to a source or to rules does not run on it.
 */
export interface PlaybookConditions {
  isEnabled: boolean;
  trigger: SecurityPlaybookTrigger | string | undefined;
  minimumPriority?: SecurityCasePriority | string | null | undefined;
  detectionSource?: SecurityDetectionSource | string | null | undefined;
  detectionRuleIds?: Array<string> | null | undefined;
}

export interface PlaybookTriggerEvent {
  trigger: SecurityPlaybookTrigger;
  casePriority: SecurityCasePriority | string | undefined;
  // The detection behind the event; undefined for a case opened by hand.
  detection?:
    | {
        source: SecurityDetectionSource | string | undefined;
        detectionRuleId?: string | undefined;
      }
    | undefined;
}

export function doesPlaybookMatch(
  playbook: PlaybookConditions,
  event: PlaybookTriggerEvent,
): boolean {
  if (!playbook.isEnabled) {
    return false;
  }

  // A Manual playbook never runs on its own, whatever the event.
  if (
    event.trigger === SecurityPlaybookTrigger.Manual ||
    playbook.trigger !== event.trigger
  ) {
    return false;
  }

  if (!isPriorityAtLeast(event.casePriority, playbook.minimumPriority)) {
    return false;
  }

  if (playbook.detectionSource) {
    if (
      !event.detection ||
      event.detection.source !== playbook.detectionSource
    ) {
      return false;
    }
  }

  const ruleIds: Array<string> = (playbook.detectionRuleIds || []).filter(
    (id: string): boolean => {
      return Boolean(id);
    },
  );

  if (ruleIds.length > 0) {
    const ruleId: string | undefined = event.detection?.detectionRuleId;

    if (!ruleId || !ruleIds.includes(ruleId)) {
      return false;
    }
  }

  return true;
}
