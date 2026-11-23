import AIRun from "../../../../../Models/DatabaseModels/AIRun";
import Project from "../../../../../Models/DatabaseModels/Project";
import SecurityCase from "../../../../../Models/DatabaseModels/SecurityCase";
import SecurityCaseAiAction from "../../../../../Models/DatabaseModels/SecurityCaseAiAction";
import User from "../../../../../Models/DatabaseModels/User";
import Includes from "../../../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../../../Types/BaseDatabase/SortOrder";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import {
  SecurityCaseAiActionKind,
  SecurityCaseAiActionStatus,
  SecurityCaseAiLimits,
  readSecurityCaseAiLimits,
} from "../../../../../Types/SecurityCase/SecurityCaseAi";
import { readSecurityCaseAiActionEvidence } from "../../../../../Types/SecurityCase/SecurityCaseAiActionEvidence";
import ProjectService from "../../../../Services/ProjectService";
import SecurityCaseAiActionService from "../../../../Services/SecurityCaseAiActionService";
import SecurityCaseService from "../../../../Services/SecurityCaseService";
import UserService from "../../../../Services/UserService";
import SecurityCaseResponse, {
  SECURITY_CASE_RESPONSE_NOT_STARTED_MESSAGES,
  SecurityCaseResponseNotStartedCode,
} from "./SecurityCaseResponse";
import { SECURITY_CASE_AI_LOG_LIMIT } from "./SecurityCaseResponseLook";

/*
 * WHAT THE CASE'S ONEUPTIME AI CARD IS TOLD OF ONEUPTIME AI WORKING THE
 * CASE (#10352; POST /security-case/:caseId/ai-response): the responder's
 * log.
 *
 *   - isOn and modes: whether the project lets OneUptime AI work cases,
 *     and what it may do on each kind of step - so the card says what it
 *     will do before it does it;
 *   - state: working, waiting for people, handed to people (and why),
 *     finished; when it took the case and when it looks again;
 *   - run: its latest look;
 *   - actions: every thing it did, asked about or left, and why, newest
 *     first - each with the step it was for, the check it read, how often
 *     the same action held on cases like this one, the playbook run that
 *     carried it out or asks for it, who decided and who undid it;
 *   - notStartedReason: what stops Respond with AI now, or null.
 *
 * For whoever may read the case (the route checks it). Nothing here is a
 * model's text: OneUptime's own sentences by code, its checks' evidence,
 * and the closing report it wrote from the case's records.
 */

export default class SecurityCaseResponseStatus {
  public static async read(data: {
    projectId: ObjectID;
    securityCaseId: ObjectID;
  }): Promise<JSONObject> {
    const [securityCase, project, rows, run]: [
      SecurityCase | null,
      Project | null,
      Array<SecurityCaseAiAction>,
      AIRun | null,
    ] = await Promise.all([
      SecurityCaseService.findOneBy({
        query: { _id: data.securityCaseId, projectId: data.projectId },
        select: {
          _id: true,
          projectId: true,
          closedAt: true,
          securityCaseStatusId: true,
          securityCasePriorityId: true,
          aiVerdict: true,
          aiSuggestedSecurityCasePriorityId: true,
          aiTriagePromptInjectionSuspected: true,
          aiResponseState: true,
          aiHandOffReason: true,
          aiTookCaseAt: true,
          aiNextLookAt: true,
          aiClosedAt: true,
          createdAt: true,
          lastDetectedAt: true,
        },
        props: { isRoot: true },
      }),
      ProjectService.findOneById({
        id: data.projectId,
        select: {
          _id: true,
          enableAutomaticSecurityCaseResponse: true,
          securityCaseAiCaseMode: true,
          securityCaseAiEdgeMode: true,
          securityCaseAiAccountsMode: true,
          securityCaseAiHostsMode: true,
          securityCaseAiCodeMode: true,
          securityCaseAiCloseMode: true,
          securityCaseAiOnItsOwnStamps: true,
        },
        props: { isRoot: true },
      }),
      SecurityCaseAiActionService.findBy({
        query: {
          projectId: data.projectId,
          securityCaseId: data.securityCaseId,
        },
        select: {
          _id: true,
          kind: true,
          status: true,
          reason: true,
          handOffReason: true,
          area: true,
          mode: true,
          stepKey: true,
          target: true,
          evidence: true,
          report: true,
          securityPlaybookRunId: true,
          detectionRuleId: true,
          askedAt: true,
          decidedAt: true,
          decidedByUserId: true,
          doneAt: true,
          undoneAt: true,
          undoneByUserId: true,
          createdAt: true,
        },
        sort: { createdAt: SortOrder.Descending },
        skip: 0,
        limit: SECURITY_CASE_AI_LOG_LIMIT,
        props: { isRoot: true },
      }),
      SecurityCaseResponse.findLatestRun(data),
    ]);

    const limits: SecurityCaseAiLimits = readSecurityCaseAiLimits(project);
    const names: Map<string, string> = await this.readNames(rows);

    let notStarted: SecurityCaseResponseNotStartedCode | null =
      await SecurityCaseResponse.getNotStartedReason({
        projectId: data.projectId,
      });

    if (!notStarted && securityCase) {
      notStarted =
        await SecurityCaseResponse.getCaseNotStartedReason(securityCase);
    }

    return {
      isOn: limits.isOn,
      modes: limits.modes as unknown as JSONObject,
      state: securityCase?.aiResponseState || null,
      handOffReason: securityCase?.aiHandOffReason || null,
      tookCaseAt: securityCase?.aiTookCaseAt
        ? new Date(securityCase.aiTookCaseAt).toISOString()
        : null,
      nextLookAt: securityCase?.aiNextLookAt
        ? new Date(securityCase.aiNextLookAt).toISOString()
        : null,
      closedAt: securityCase?.aiClosedAt
        ? new Date(securityCase.aiClosedAt).toISOString()
        : null,
      run: run
        ? {
            _id: run.id!.toString(),
            status: run.status || null,
            createdAt: run.createdAt
              ? new Date(run.createdAt).toISOString()
              : null,
            completedAt: run.completedAt
              ? new Date(run.completedAt).toISOString()
              : null,
            errorMessage: run.errorMessage || null,
          }
        : null,
      actions: rows.map((row: SecurityCaseAiAction): JSONObject => {
        return this.toJson(row, names);
      }),
      notStartedReason: notStarted
        ? {
            code: notStarted,
            message: SECURITY_CASE_RESPONSE_NOT_STARTED_MESSAGES[notStarted],
          }
        : null,
    };
  }

  // One row of the log, as the card reads it.
  public static toJson(
    row: SecurityCaseAiAction,
    names: Map<string, string>,
  ): JSONObject {
    const iso: (value: Date | undefined) => string | null = (
      value: Date | undefined,
    ): string | null => {
      return value ? new Date(value).toISOString() : null;
    };

    return {
      _id: row.id!.toString(),
      kind: row.kind || null,
      status: row.status || null,
      reason: row.reason || null,
      handOffReason: row.handOffReason || null,
      area: row.area || null,
      mode: row.mode || null,
      stepKey: row.stepKey || null,
      target: row.target || null,
      evidence: readSecurityCaseAiActionEvidence(
        row.evidence,
      ) as unknown as JSONObject,
      report:
        row.kind === SecurityCaseAiActionKind.CloseCase
          ? row.report || null
          : null,
      securityPlaybookRunId: row.securityPlaybookRunId?.toString() || null,
      detectionRuleId: row.detectionRuleId?.toString() || null,
      askedAt: iso(row.askedAt),
      decidedAt: iso(row.decidedAt),
      decidedByName: row.decidedByUserId
        ? names.get(row.decidedByUserId.toString()) || null
        : null,
      doneAt: iso(row.doneAt),
      undoneAt: iso(row.undoneAt),
      undoneByName: row.undoneByUserId
        ? names.get(row.undoneByUserId.toString()) || null
        : null,
      createdAt: iso(row.createdAt),
      /*
       * Asked of a person on the card itself: what only OneUptime AI does
       * - taking the case, marking a step, an exception. Every other ask is
       * the playbook engine's approval, decided where its run is.
       */
      isDecidedOnCard:
        row.status === SecurityCaseAiActionStatus.Asked &&
        !row.securityPlaybookRunId,
    };
  }

  // The names of the people who decided or undid one of OneUptime AI's actions.
  private static async readNames(
    rows: Array<SecurityCaseAiAction>,
  ): Promise<Map<string, string>> {
    const ids: Array<string> = Array.from(
      new Set(
        rows
          .flatMap((row: SecurityCaseAiAction): Array<string> => {
            return [
              row.decidedByUserId?.toString() || "",
              row.undoneByUserId?.toString() || "",
            ];
          })
          .filter(Boolean),
      ),
    );
    const names: Map<string, string> = new Map();

    if (ids.length === 0) {
      return names;
    }

    const users: Array<User> = await UserService.findBy({
      query: { _id: new Includes(ids) },
      select: { _id: true, name: true, email: true },
      skip: 0,
      limit: ids.length,
      props: { isRoot: true },
    });

    for (const user of users) {
      names.set(
        user.id!.toString(),
        user.name?.toString() || user.email?.toString() || "",
      );
    }

    return names;
  }
}
