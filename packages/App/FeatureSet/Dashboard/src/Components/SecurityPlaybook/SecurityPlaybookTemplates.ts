import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import SecurityCasePriority from "Common/Types/SecurityCase/SecurityCasePriority";
import SecurityCaseStatus from "Common/Types/SecurityCase/SecurityCaseStatus";
import SecurityDetectionSource from "Common/Types/SecurityCase/SecurityDetectionSource";
import { SecurityPlaybookActionType } from "Common/Types/SecurityPlaybook/SecurityPlaybookAction";
import { SecurityPlaybookStep } from "Common/Types/SecurityPlaybook/SecurityPlaybookStep";
import SecurityPlaybookTrigger from "Common/Types/SecurityPlaybook/SecurityPlaybookTrigger";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * Playbooks to start from. Each is a complete, working playbook built only
 * from steps that need nothing of the project's own - no channel, no
 * connection, no person - so it saves as it is and runs at once; the
 * playbook's page is where a step that does name something is added.
 */
export interface SecurityPlaybookTemplate {
  key: string;
  name: string;
  description: string;
  icon: IconProp;
  trigger: SecurityPlaybookTrigger;
  minimumPriority?: SecurityCasePriority | undefined;
  detectionSource?: SecurityDetectionSource | undefined;
  getSteps: () => Array<SecurityPlaybookStep>;
}

function step(
  action: SecurityPlaybookActionType,
  config: SecurityPlaybookStep["config"],
  flags: Partial<
    Pick<
      SecurityPlaybookStep,
      "requiresApproval" | "continueOnFailure" | "onlyIfThreatIntelMatched"
    >
  > = {},
): SecurityPlaybookStep {
  return {
    id: ObjectID.generate().toString(),
    action,
    config,
    requiresApproval: flags.requiresApproval || false,
    continueOnFailure: flags.continueOnFailure || false,
    onlyIfThreatIntelMatched: flags.onlyIfThreatIntelMatched || false,
  };
}

export const SECURITY_PLAYBOOK_TEMPLATES: ReadonlyArray<SecurityPlaybookTemplate> =
  [
    {
      key: "enrich",
      name: translationKey("Enrich New Cases"),
      description: translationKey(
        "As a case opens: check its entities against threat intel, count their recent activity, and leave a triage checklist on the case.",
      ),
      icon: IconProp.MagnifyingGlass,
      trigger: SecurityPlaybookTrigger.CaseOpened,
      getSteps: (): Array<SecurityPlaybookStep> => {
        return [
          step(
            SecurityPlaybookActionType.CheckThreatIntel,
            { raisePriorityTo: SecurityCasePriority.High },
            { continueOnFailure: true },
          ),
          step(
            SecurityPlaybookActionType.LookUpEntityActivity,
            { lookbackInHours: 24 },
            { continueOnFailure: true },
          ),
          step(SecurityPlaybookActionType.AddCaseNote, {
            note: "Triage checklist for {{case.number}}:\n\n- [ ] Is the activity expected for these entities?\n- [ ] Did any entity match threat intel?\n- [ ] Is anything else in the project talking to them?\n- [ ] Contain, or close with a verdict.",
          }),
        ];
      },
    },
    {
      key: "known-bad",
      name: translationKey("Escalate Known-Bad Indicators"),
      description: translationKey(
        "When a detection joins a case: if any entity is a known threat-intel indicator, raise the case to Critical and move it to Investigating.",
      ),
      icon: IconProp.Bug,
      trigger: SecurityPlaybookTrigger.DetectionAdded,
      getSteps: (): Array<SecurityPlaybookStep> => {
        return [
          step(SecurityPlaybookActionType.CheckThreatIntel, {}),
          step(
            SecurityPlaybookActionType.SetCasePriority,
            { priority: SecurityCasePriority.Critical },
            { onlyIfThreatIntelMatched: true },
          ),
          step(
            SecurityPlaybookActionType.SetCaseStatus,
            { status: SecurityCaseStatus.Investigating },
            { onlyIfThreatIntelMatched: true },
          ),
        ];
      },
    },
    {
      key: "imported-alerts",
      name: translationKey("Triage Imported Alerts"),
      description: translationKey(
        "For cases opened from a connected product's alerts: count the entities' activity across all your events and note where to look first.",
      ),
      icon: IconProp.Link,
      trigger: SecurityPlaybookTrigger.CaseOpened,
      detectionSource: SecurityDetectionSource.ConnectedProduct,
      getSteps: (): Array<SecurityPlaybookStep> => {
        return [
          step(
            SecurityPlaybookActionType.LookUpEntityActivity,
            { lookbackInHours: 72 },
            { continueOnFailure: true },
          ),
          step(SecurityPlaybookActionType.AddCaseNote, {
            note: "This case was opened from an alert raised by a connected security product. Compare its activity above with the alert in that product before acting.",
          }),
        ];
      },
    },
  ];
