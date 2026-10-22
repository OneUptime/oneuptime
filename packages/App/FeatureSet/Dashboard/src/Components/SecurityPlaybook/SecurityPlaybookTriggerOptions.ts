import SecurityPlaybookTrigger, {
  SECURITY_PLAYBOOK_TRIGGERS,
  isAiSecurityPlaybookTrigger,
} from "Common/Types/SecurityPlaybook/SecurityPlaybookTrigger";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * A playbook's Trigger picker, on the create form (Playbooks) and the edit
 * form (PlaybookView): each trigger with a line saying when it runs, so the
 * field's own description stays one short sentence.
 *
 * Triaged as Likely Malicious is set off by OneUptime AI, so a new playbook
 * is offered it only while the project's AI is on; a playbook already set
 * to it keeps it on its edit form, where it simply waits until AI is on.
 *
 * React-free, so a plain test pins every option and word (the option shape
 * is the Dropdown's, written out so nothing here reaches React).
 */

export interface SecurityPlaybookTriggerOption {
  value: SecurityPlaybookTrigger;
  label: string;
  description: string;
}

export const SECURITY_PLAYBOOK_TRIGGER_FIELD_DESCRIPTION: string =
  translationKey("When the playbook runs on its own.");

export const SECURITY_PLAYBOOK_TRIGGER_DESCRIPTIONS: Record<
  SecurityPlaybookTrigger,
  string
> = {
  [SecurityPlaybookTrigger.CaseOpened]: translationKey(
    "Once, as a case opens.",
  ),
  [SecurityPlaybookTrigger.DetectionAdded]: translationKey(
    "Each time a new detection joins an open case.",
  ),
  [SecurityPlaybookTrigger.TriagedAsLikelyMalicious]: translationKey(
    "Once, when OneUptime AI's triage reads the case as Likely Malicious.",
  ),
  [SecurityPlaybookTrigger.Manual]: translationKey(
    "Only when someone runs it.",
  ),
};

export function getSecurityPlaybookTriggerOptions(data: {
  isAiOffered: boolean;
  // The edit form: every trigger, so the playbook's own stays shown.
  isEditing: boolean;
}): Array<SecurityPlaybookTriggerOption> {
  return SECURITY_PLAYBOOK_TRIGGERS.filter(
    (trigger: SecurityPlaybookTrigger): boolean => {
      return (
        data.isEditing ||
        data.isAiOffered ||
        !isAiSecurityPlaybookTrigger(trigger)
      );
    },
  ).map((trigger: SecurityPlaybookTrigger): SecurityPlaybookTriggerOption => {
    return {
      value: trigger,
      label: trigger,
      description: SECURITY_PLAYBOOK_TRIGGER_DESCRIPTIONS[trigger],
    };
  });
}
