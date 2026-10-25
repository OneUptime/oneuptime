import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import SecurityCaseStage from "../../Types/SecurityCase/SecurityCaseStage";
import { isSecurityCaseVerdict } from "../../Types/SecurityCase/SecurityCaseVerdict";
import {
  SecurityPlaybookActionDefinition,
  SecurityPlaybookActionType,
  getSecurityPlaybookAction,
} from "../../Types/SecurityPlaybook/SecurityPlaybookAction";
import { SecurityPlaybookStep } from "../../Types/SecurityPlaybook/SecurityPlaybookStep";
import SecurityCasePriorities from "./SecurityCasePriorities";
import SecurityCaseStatuses from "./SecurityCaseStatuses";

/*
 * WHAT A PLAYBOOK'S STEPS MAY NAME OF THE PROJECT'S CASE PRIORITIES AND
 * STATUSES.
 *
 * Set priority, Set status and Check threat intel's "raise the priority"
 * name one of the project's own by id (parseSecurityPlaybookSteps checks
 * the id's shape). Against the project's lists, when a playbook is saved:
 *
 *   - each priority and status is one of the project's;
 *   - Set status moves a case on: never to the status every case starts in;
 *   - a status that closes a case comes with a verdict, as Close Case asks
 *     for one, and a status that does not keeps none.
 *
 * Archived values are allowed: a playbook is an automation its author set
 * up, and keeps running as it was built (Common/Utils/ArchivableValues).
 * Pure, so the server and the tests read the same rules.
 */

function stepLabel(index: number, step: SecurityPlaybookStep): string {
  const definition: SecurityPlaybookActionDefinition | undefined =
    getSecurityPlaybookAction(step.action);

  return `Step ${index + 1} (${definition?.title || step.action})`;
}

function readText(config: JSONObject, key: string): string {
  const value: unknown = config[key];

  return typeof value === "string" ? value.trim() : "";
}

/*
 * The steps, each checked against the project's lists and cleaned (a
 * verdict on a status that does not close is dropped). Throws a message
 * that names the step and says what to fix.
 */
export function validateSecurityPlaybookStepValues(data: {
  steps: Array<SecurityPlaybookStep>;
  priorities: ReadonlyArray<unknown>;
  statuses: ReadonlyArray<unknown>;
}): Array<SecurityPlaybookStep> {
  return data.steps.map(
    (step: SecurityPlaybookStep, index: number): SecurityPlaybookStep => {
      const label: string = stepLabel(index, step);
      const config: JSONObject = step.config || {};

      switch (step.action) {
        case SecurityPlaybookActionType.SetCasePriority: {
          if (
            !SecurityCasePriorities.find(
              data.priorities,
              readText(config, "priorityId"),
            )
          ) {
            throw new BadDataException(
              `${label}: choose one of this project's case priorities.`,
            );
          }

          return step;
        }

        case SecurityPlaybookActionType.SetCaseStatus: {
          const statusId: string = readText(config, "statusId");
          const stage: SecurityCaseStage | null = SecurityCaseStatuses.getStage(
            data.statuses,
            statusId,
          );

          if (stage === null) {
            throw new BadDataException(
              `${label}: choose one of this project's case statuses.`,
            );
          }

          const newStatus: unknown = SecurityCaseStatuses.getStatusOfStage(
            data.statuses,
            SecurityCaseStage.New,
          );

          if (
            newStatus &&
            SecurityCaseStatuses.toRows([newStatus])[0]!.id.toLowerCase() ===
              statusId.toLowerCase()
          ) {
            throw new BadDataException(
              `${label}: every case starts in this status - choose one a case moves on to.`,
            );
          }

          // Only a status that closes the case takes a verdict.
          if (stage !== SecurityCaseStage.Closed) {
            const withoutVerdict: JSONObject = { ...config };
            delete withoutVerdict["verdict"];

            return { ...step, config: withoutVerdict };
          }

          if (!isSecurityCaseVerdict(readText(config, "verdict"))) {
            throw new BadDataException(
              `${label}: a case is closed with a verdict - choose one.`,
            );
          }

          return step;
        }

        case SecurityPlaybookActionType.CheckThreatIntel: {
          const raisePriorityToId: string = readText(
            config,
            "raisePriorityToId",
          );

          if (
            raisePriorityToId &&
            !SecurityCasePriorities.find(data.priorities, raisePriorityToId)
          ) {
            throw new BadDataException(
              `${label}: choose one of this project's case priorities to raise the case to, or none.`,
            );
          }

          return step;
        }

        default:
          return step;
      }
    },
  );
}
