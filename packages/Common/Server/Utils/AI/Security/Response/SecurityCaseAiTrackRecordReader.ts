import SecurityCaseStepCheck from "../../../../../Models/DatabaseModels/SecurityCaseStepCheck";
import SecurityDetection from "../../../../../Models/DatabaseModels/SecurityDetection";
import Includes from "../../../../../Types/BaseDatabase/Includes";
import ObjectID from "../../../../../Types/ObjectID";
import { SecurityCaseAiActionKind } from "../../../../../Types/SecurityCase/SecurityCaseAi";
import { SecurityCaseAiTrackRecord } from "../../../../../Types/SecurityCase/SecurityCaseAiActionEvidence";
import SecurityCaseStepCheckState from "../../../../../Types/SecurityCase/SecurityCaseStepCheckState";
import { RESPONSE_STEP_KINDS } from "../../../../../Utils/SecurityCase/ResponsePlan/ResponsePlanKeys";
import SecurityCaseStepCheckService from "../../../../Services/SecurityCaseStepCheckService";
import SecurityDetectionService from "../../../../Services/SecurityDetectionService";
import QueryHelper from "../../../../Types/Database/QueryHelper";
import logger from "../../../Logger";

/*
 * HOW OFTEN THE SAME ACTION HELD ON CASES LIKE THIS ONE (#10352), as
 * RemediationTrackRecordReader says it of an incident's fix: "Blocking the
 * address held on 14 of 15 similar cases."
 *
 * Similar cases are the project's other cases the same detection rule
 * opened. An action held on one when OneUptime's own check of its step
 * found it so - Verified - and did not when the check found it stop
 * holding (Regressed): what OneUptime saw, whoever did the step, a person
 * or OneUptime AI. A case whose step was never settled either way is not
 * counted.
 *
 * Only actions a check reads: a block, a containment of an account or a
 * host, the fix of a route. Never throws: no track record is said when it
 * cannot be read.
 */

// The step each action is checked by.
export const SECURITY_CASE_AI_TRACKED_STEP_KINDS: Partial<
  Record<SecurityCaseAiActionKind, string>
> = {
  [SecurityCaseAiActionKind.BlockAddress]: RESPONSE_STEP_KINDS.blockIp,
  [SecurityCaseAiActionKind.ContainAccount]: RESPONSE_STEP_KINDS.user,
  [SecurityCaseAiActionKind.ContainHost]: RESPONSE_STEP_KINDS.host,
  [SecurityCaseAiActionKind.RequestCodeFix]: RESPONSE_STEP_KINDS.fixPublicApp,
};

// The most similar cases read.
export const SECURITY_CASE_AI_TRACK_RECORD_CASE_LIMIT: number = 200;

/*
 * The cases' checks of the step, case by case: held where one was Verified
 * and none Regressed, not held where one Regressed.
 */
export function summarizeSecurityCaseAiTrackRecord(
  rows: ReadonlyArray<{ securityCaseId: string; state: string }>,
): SecurityCaseAiTrackRecord {
  const byCase: Map<string, { held: boolean; regressed: boolean }> = new Map();

  for (const row of rows) {
    const seen: { held: boolean; regressed: boolean } = byCase.get(
      row.securityCaseId,
    ) || { held: false, regressed: false };

    if (row.state === SecurityCaseStepCheckState.Verified) {
      seen.held = true;
    }

    if (row.state === SecurityCaseStepCheckState.Regressed) {
      seen.regressed = true;
    }

    byCase.set(row.securityCaseId, seen);
  }

  let similar: number = 0;
  let held: number = 0;

  for (const seen of byCase.values()) {
    if (seen.regressed) {
      similar++;
    } else if (seen.held) {
      similar++;
      held++;
    }
  }

  return { similar, held };
}

export default class SecurityCaseAiTrackRecordReader {
  public static async read(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
    detectionRuleId: ObjectID | null;
    kind: SecurityCaseAiActionKind;
  }): Promise<SecurityCaseAiTrackRecord | null> {
    const stepKind: string | undefined =
      SECURITY_CASE_AI_TRACKED_STEP_KINDS[data.kind];

    if (!stepKind || !data.detectionRuleId) {
      return null;
    }

    try {
      const detections: Array<SecurityDetection> =
        await SecurityDetectionService.findBy({
          query: {
            projectId: data.projectId,
            detectionRuleId: data.detectionRuleId,
            securityCaseId: QueryHelper.notEquals(data.securityCaseId),
          },
          select: { securityCaseId: true },
          skip: 0,
          limit: SECURITY_CASE_AI_TRACK_RECORD_CASE_LIMIT,
          props: { isRoot: true },
        });
      const caseIds: Array<string> = Array.from(
        new Set(
          detections
            .map((detection: SecurityDetection): string => {
              return detection.securityCaseId?.toString() || "";
            })
            .filter(Boolean),
        ),
      );

      if (caseIds.length === 0) {
        return { similar: 0, held: 0 };
      }

      const checks: Array<SecurityCaseStepCheck> =
        await SecurityCaseStepCheckService.findBy({
          query: {
            projectId: data.projectId,
            securityCaseId: new Includes(caseIds),
            stepKey: QueryHelper.startsWith(`${stepKind}:`),
            state: new Includes([
              SecurityCaseStepCheckState.Verified,
              SecurityCaseStepCheckState.Regressed,
            ]),
          },
          select: { securityCaseId: true, state: true },
          skip: 0,
          limit: SECURITY_CASE_AI_TRACK_RECORD_CASE_LIMIT * 4,
          props: { isRoot: true },
        });

      return summarizeSecurityCaseAiTrackRecord(
        checks.map(
          (
            check: SecurityCaseStepCheck,
          ): {
            securityCaseId: string;
            state: string;
          } => {
            return {
              securityCaseId: check.securityCaseId?.toString() || "",
              state: check.state || "",
            };
          },
        ),
      );
    } catch (error) {
      logger.error(
        `SecurityCaseAiTrackRecordReader: could not read how ${data.kind} went on cases like ${data.securityCaseId.toString()}:`,
      );
      logger.error(error);
      return null;
    }
  }
}
