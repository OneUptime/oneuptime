import ObjectID from "../../../Types/ObjectID";
import SecurityDetectionSource from "../../../Types/SecurityCase/SecurityDetectionSource";
import SecurityPlaybookTrigger from "../../../Types/SecurityPlaybook/SecurityPlaybookTrigger";
import SecurityCasePriorities from "../../../Utils/SecurityCase/SecurityCasePriorities";

/*
 * Whether a playbook runs on its own for a case: pure, so the rule a
 * playbook's conditions read is tested apart from the database.
 *
 * The conditions read the detection that triggered the run (the one that
 * opened the case, or the one that just joined it) where they name a
 * detection - its source, its rule - and the case's priority as it is now,
 * after the detection raised it, ranked by its place in the project's list
 * (SecurityCasePriorities). A case opened by hand has no detection, so a
 * playbook limited to a source or to rules does not run on it.
 */
export interface PlaybookConditions {
  isEnabled: boolean;
  trigger: SecurityPlaybookTrigger | string | undefined;
  // One of the project's priorities; empty runs on every priority.
  minimumPriorityId?: ObjectID | string | null | undefined;
  detectionSource?: SecurityDetectionSource | string | null | undefined;
  detectionRuleIds?: Array<string> | null | undefined;
}

export interface PlaybookTriggerEvent {
  trigger: SecurityPlaybookTrigger;
  // The project's case priorities, which the minimum is compared through.
  priorities: ReadonlyArray<unknown>;
  casePriorityId: ObjectID | string | null | undefined;
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

  if (
    !SecurityCasePriorities.isAtLeast(
      event.priorities,
      event.casePriorityId,
      playbook.minimumPriorityId,
    )
  ) {
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
