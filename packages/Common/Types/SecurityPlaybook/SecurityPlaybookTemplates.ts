import IconProp from "../Icon/IconProp";
import ObjectID from "../ObjectID";
import SecurityCasePriorityLevel from "../SecurityCase/SecurityCasePriorityLevel";
import SecurityCaseStage from "../SecurityCase/SecurityCaseStage";
import SecurityDetectionSource from "../SecurityCase/SecurityDetectionSource";
import { SecurityPlaybookActionType } from "./SecurityPlaybookAction";
import { SecurityPlaybookStep } from "./SecurityPlaybookStep";
import { SecurityPlaybookStepOutcome } from "./SecurityPlaybookStepCondition";
import SecurityPlaybookTrigger from "./SecurityPlaybookTrigger";

/*
 * Playbooks to start from. Each is a complete, working playbook built only
 * from steps that need nothing of the project's own - no channel, no
 * connection, no person - so it saves as it is and runs at once; the
 * playbook's page is where a step that does name something is added.
 *
 * Shared by the dashboard (Playbooks: "Start from a template") and the
 * server (the one-click setup turns the first one on).
 *
 * A template names case priorities and statuses by what they mean - the
 * high priority, the acknowledged status - never by name: every project
 * keeps one of each (SecurityCasePriorityLevel, SecurityCaseStage), and the
 * playbook made from a template names the project's own by id
 * (SecurityTemplateRecords hands getSteps the project's ids).
 */
export interface SecurityPlaybookTemplateValues {
  // The id of the project's built-in priority of a level ("" when it has none).
  priorityId: (level: SecurityCasePriorityLevel) => string;
  // The id of the project's built-in status of a stage ("" when it has none).
  statusId: (stage: SecurityCaseStage) => string;
}

export interface SecurityPlaybookTemplateDefinition {
  key: string;
  title: string;
  description: string;
  icon: IconProp;
  trigger: SecurityPlaybookTrigger;
  minimumPriorityLevel?: SecurityCasePriorityLevel | undefined;
  detectionSource?: SecurityDetectionSource | undefined;
  getSteps: (
    values: SecurityPlaybookTemplateValues,
  ) => Array<SecurityPlaybookStep>;
}

function step(
  action: SecurityPlaybookActionType,
  config: SecurityPlaybookStep["config"],
  flags: Partial<
    Pick<
      SecurityPlaybookStep,
      | "requiresApproval"
      | "continueOnFailure"
      | "onlyIfThreatIntelMatched"
      | "runIf"
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
    ...(flags.runIf ? { runIf: flags.runIf } : {}),
  };
}

// The template the one-click setup turns on: it enriches every new case.
export const ENRICH_NEW_CASES_TEMPLATE_KEY: string = "enrich";

export const SECURITY_PLAYBOOK_TEMPLATE_DEFINITIONS: ReadonlyArray<SecurityPlaybookTemplateDefinition> =
  [
    {
      key: ENRICH_NEW_CASES_TEMPLATE_KEY,
      title: "Enrich New Cases",
      description:
        "As a case opens: check its entities against threat intel, count their recent activity, and leave a triage checklist on the case.",
      icon: IconProp.MagnifyingGlass,
      trigger: SecurityPlaybookTrigger.CaseOpened,
      getSteps: (
        values: SecurityPlaybookTemplateValues,
      ): Array<SecurityPlaybookStep> => {
        return [
          step(
            SecurityPlaybookActionType.CheckThreatIntel,
            {
              raisePriorityToId: values.priorityId(
                SecurityCasePriorityLevel.High,
              ),
            },
            { continueOnFailure: true },
          ),
          step(
            SecurityPlaybookActionType.LookUpEntityActivity,
            { lookbackInHours: 24 },
            { continueOnFailure: true },
          ),
          // The triage checklist, as the case's own tasks to tick off.
          step(SecurityPlaybookActionType.AddCaseTasks, {
            tasks: [
              "Check that the activity is expected for these entities",
              "Check whether any entity matched threat intel",
              "Check what else in the project talks to them",
              "Contain them, or close the case with a verdict",
            ],
          }),
        ];
      },
    },
    {
      key: "known-bad",
      title: "Escalate Known-Bad Indicators",
      description:
        "When a detection joins a case: if any entity is a known threat-intel indicator, raise the case to Critical and move it to Investigating.",
      icon: IconProp.Bug,
      trigger: SecurityPlaybookTrigger.DetectionAdded,
      getSteps: (
        values: SecurityPlaybookTemplateValues,
      ): Array<SecurityPlaybookStep> => {
        const check: SecurityPlaybookStep = step(
          SecurityPlaybookActionType.CheckThreatIntel,
          {},
        );
        // Both run only on a match: the branch threat intel decides.
        const onMatch: SecurityPlaybookStep["runIf"] = {
          stepId: check.id,
          outcome: SecurityPlaybookStepOutcome.Found,
        };

        return [
          check,
          step(
            SecurityPlaybookActionType.SetCasePriority,
            {
              priorityId: values.priorityId(SecurityCasePriorityLevel.Critical),
            },
            { runIf: onMatch },
          ),
          step(
            SecurityPlaybookActionType.SetCaseStatus,
            { statusId: values.statusId(SecurityCaseStage.Acknowledged) },
            { runIf: onMatch },
          ),
        ];
      },
    },
    {
      key: "imported-alerts",
      title: "Triage Imported Alerts",
      description:
        "For cases opened from a connected product's alerts: count the entities' activity across all your events and note where to look first.",
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
    {
      key: "attack-evidence",
      title: "Keep the Evidence of an Attack",
      description:
        "As a case opens: keep the session replays of the requests behind it, note their traces and exceptions, ask OneUptime AI to fix the code an attack broke, and leave a response checklist.",
      icon: IconProp.Archive,
      trigger: SecurityPlaybookTrigger.CaseOpened,
      minimumPriorityLevel: SecurityCasePriorityLevel.High,
      getSteps: (): Array<SecurityPlaybookStep> => {
        return [
          step(
            SecurityPlaybookActionType.PreserveEvidence,
            {},
            { continueOnFailure: true },
          ),
          step(
            SecurityPlaybookActionType.FixWithAi,
            {},
            { continueOnFailure: true },
          ),
          // The response checklist, as the case's own tasks to tick off.
          step(SecurityPlaybookActionType.AddCaseTasks, {
            tasks: [
              "Open the traces in the evidence note: did any request reach the app, or the database?",
              "Watch the session replays: what did the attacker do before and after?",
              "Block the source address, and add a Run a runbook step to this playbook that does it next time",
              "Review the AI's fix before it is merged",
            ],
          }),
        ];
      },
    },
  ];

export function getSecurityPlaybookTemplateDefinition(
  key: string,
): SecurityPlaybookTemplateDefinition | undefined {
  return SECURITY_PLAYBOOK_TEMPLATE_DEFINITIONS.find(
    (template: SecurityPlaybookTemplateDefinition): boolean => {
      return template.key === key;
    },
  );
}
