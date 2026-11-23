import DataSecurityAiProposal from "../../../../../Models/DatabaseModels/DataSecurityAiProposal";
import DataStoreFinding from "../../../../../Models/DatabaseModels/DataStoreFinding";
import { sha256Hex } from "../../../../../Types/AutoRemediation/RemediationPlanFingerprint";
import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import DataConfidence from "../../../../../Types/DataSecurity/DataConfidence";
import { DataSecurityAiProposalKind } from "../../../../../Types/DataSecurity/DataSecurityAi";
import OneUptimeDate from "../../../../../Types/Date";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../../../Utils/Markdown/FeedMarkdown";
import DataStoreFindingService from "../../../../Services/DataStoreFindingService";
import { queueDataSecurityEvaluation } from "../../../DataSecurity/DataSecurityJobs";
import CallerPermission from "../../../Permission/CallerPermission";
import {
  DataSecurityAiAction,
  DataSecurityAiActor,
  DataSecurityAiChangeMade,
  DataSecurityAiChangeUndone,
  DataSecurityAiPlanOutcome,
  DataSecurityAiPlannedChange,
} from "../DataSecurityAiAction";

/*
 * ONEUPTIME AI CONFIRMS FINDINGS ON ITS OWN, ONLY WHERE A RULE SAYS SO
 * (#10372).
 *
 * OneUptime AI's verdict on a finding that waits for a person is a
 * proposal on the finding's own row (DataSecurityFindingVerdicts). Only
 * where a Data Security AI rule sets Judge to Without asking does it act on
 * a Confirm itself - confirming raises a store's sensitivity and the
 * severity of its issues - and then only on the team's own confirmation of
 * a finding like it, or a field whose name says it holds the type
 * (canConfirmOnItsOwn). The store's confirmations of one run are one
 * proposal, made without asking: on the store's timeline, in Done by AI,
 * undone with one press. Where the hour's circuit breaker stops it, it
 * waits for a person in Data Security > AI, who approves it as their own
 * confirmation.
 *
 * A confirmation counts as High, as a person's does (DataStoreFindingService
 * sets it for a person; here for OneUptime AI's own, with isConfirmedByAi,
 * so it is never precedent for its verdicts). A finding a person decided in
 * between is left as they decided it, by the change and by Undo.
 *
 * Nothing here, nor anywhere, marks a finding not sensitive: a person does.
 */

// What a proposal to confirm a store's findings plans: names and places only.
export interface ConfirmFindingsPlan {
  dataStoreId: string;
  storeName: string;
  findings: Array<{
    findingId: string;
    dataTypeId: string;
    dataTypeName: string;
    location: string;
    reason: string;
  }>;
}

// The most findings one proposal confirms.
export const MAX_FINDINGS_CONFIRMED_AT_ONCE: number = 40;

export const CONFIRM_FINDINGS_PERMISSION_MESSAGE: string =
  "Approving this confirms findings of a data store, and you do not have permission to change findings. Ask a Project Owner or Project Admin, or for Edit Data Store Finding.";

export const UNDO_CONFIRMED_FINDINGS_PERMISSION_MESSAGE: string =
  "Undoing this takes back the confirmation of findings of a data store, and you do not have permission to change findings. Ask a Project Owner or Project Admin, or for Edit Data Store Finding.";

function readText(value: unknown, maxLength: number): string {
  return typeof value === "string" ? value.trim().slice(0, maxLength) : "";
}

export function readConfirmFindingsPlan(
  value: unknown,
): ConfirmFindingsPlan | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }

  const plan: JSONObject = value as JSONObject;
  const dataStoreId: string = readText(plan["dataStoreId"], 64);
  const findings: ConfirmFindingsPlan["findings"] = Array.isArray(
    plan["findings"],
  )
    ? (plan["findings"] as Array<unknown>)
        .map((entry: unknown): ConfirmFindingsPlan["findings"][number] => {
          const item: JSONObject =
            entry && typeof entry === "object" && !Array.isArray(entry)
              ? (entry as JSONObject)
              : {};

          return {
            findingId: readText(item["findingId"], 64),
            dataTypeId: readText(item["dataTypeId"], 100),
            dataTypeName: readText(item["dataTypeName"], 100),
            location: readText(item["location"], 500),
            reason: readText(item["reason"], 500),
          };
        })
        .filter((item: { findingId: string }): boolean => {
          return ObjectID.isValidUUID(item.findingId);
        })
        .slice(0, MAX_FINDINGS_CONFIRMED_AT_ONCE)
    : [];

  return dataStoreId && findings.length > 0
    ? {
        dataStoreId,
        storeName: readText(plan["storeName"], 500),
        findings,
      }
    : null;
}

// What a confirmation proposal made: the findings it confirmed, and as whom.
function readConfirmedIds(result: JSONObject | undefined): Array<string> {
  const ids: unknown = result?.["confirmedFindingIds"];

  return Array.isArray(ids)
    ? ids.filter((id: unknown): id is string => {
        return typeof id === "string" && ObjectID.isValidUUID(id);
      })
    : [];
}

function findingLine(
  finding: ConfirmFindingsPlan["findings"][number],
): MarkdownText {
  return mdText`**${finding.dataTypeName || finding.dataTypeId}** at \`${finding.location}\``;
}

/*
 * The change: the store's findings OneUptime AI confirms, with each
 * verdict's reason. Its plan key is the findings it confirms, so the same
 * set is never proposed twice.
 */
export function planConfirmFindings(plan: ConfirmFindingsPlan): DataSecurityAiPlannedChange {
  const findings: ConfirmFindingsPlan["findings"] = plan.findings.slice(
    0,
    MAX_FINDINGS_CONFIRMED_AT_ONCE,
  );
  const ids: Array<string> = findings
    .map((finding: { findingId: string }): string => {
      return finding.findingId.toLowerCase();
    })
    .sort();
  const count: number = findings.length;

  return {
    title:
      count === 1
        ? `Confirm 1 finding of ${plan.storeName || "a data store"}`
        : `Confirm ${count} findings of ${plan.storeName || "a data store"}`,
    changeMarkdown: FeedMarkdown.join(
      [
        mdText`OneUptime AI confirms these findings, as a person's Confirm does: each counts as High toward the store's sensitivity and its checks.`,
        ...findings.map(
          (finding: ConfirmFindingsPlan["findings"][number]): MarkdownText => {
            return mdText`- ${findingLine(finding)}`;
          },
        ),
      ],
      "\n",
    ).toString(),
    reasonMarkdown: FeedMarkdown.join(
      findings.map(
        (finding: ConfirmFindingsPlan["findings"][number]): MarkdownText => {
          return mdText`- ${findingLine(finding)}: ${finding.reason}`;
        },
      ),
      "\n",
    ).toString(),
    proofMarkdown: mdText`Each rests on your team's own confirmation of a finding like it, or on a field whose name says it holds the type. The store's checks run again with them, as they do after a person confirms a finding.`.toString(),
    undoMarkdown: mdText`Undo takes the confirmations back: each finding is Low again and waits for a person. A finding someone decided since is left as they decided it.`.toString(),
    plan: plan as unknown as JSONObject,
    planKey: `confirm:${sha256Hex(ids.join(",")).slice(0, 32)}`,
    meetsDefaultConditions: false,
  };
}

function holdsFindingEdit(props: DatabaseCommonInteractionProps): boolean {
  return CallerPermission.holdsAnyOf(
    props,
    new DataStoreFinding().updateRecordPermissions,
  );
}

const ConfirmFindingsAction: DataSecurityAiAction = {
  kind: DataSecurityAiProposalKind.ConfirmFindings,

  // A store's findings, never an issue's: the engine never plans it.
  appliesToCheck(): boolean {
    return false;
  },

  async plan(): Promise<DataSecurityAiPlanOutcome> {
    return { kind: "nothing", detail: "not-for-an-issue" };
  },

  getApproveRefusal(data: {
    props: DatabaseCommonInteractionProps;
  }): string | null {
    return holdsFindingEdit(data.props)
      ? null
      : CONFIRM_FINDINGS_PERMISSION_MESSAGE;
  },

  getUndoRefusal(data: {
    props: DatabaseCommonInteractionProps;
  }): string | null {
    return holdsFindingEdit(data.props)
      ? null
      : UNDO_CONFIRMED_FINDINGS_PERMISSION_MESSAGE;
  },

  async apply(data: {
    projectId: ObjectID;
    proposal: DataSecurityAiProposal;
    actor: DataSecurityAiActor;
  }): Promise<DataSecurityAiChangeMade> {
    const plan: ConfirmFindingsPlan | null = readConfirmFindingsPlan(
      data.proposal.plan,
    );

    if (!plan) {
      throw new BadDataException(
        "This proposal no longer says which findings it confirms, so nothing was done.",
      );
    }

    // OneUptime AI on its own: no person approved it.
    const isOneUptimeAi: boolean = !data.actor.userId;
    const confirmed: Array<ConfirmFindingsPlan["findings"][number]> = [];

    for (const finding of plan.findings) {
      const row: DataStoreFinding | null =
        await DataStoreFindingService.findOneBy({
          query: {
            _id: new ObjectID(finding.findingId),
            projectId: data.projectId,
            dataStoreId: new ObjectID(plan.dataStoreId),
          },
          select: { _id: true, isSuppressed: true, isConfirmed: true },
          props: { isRoot: true },
        });

      // Gone, or a person decided it since: left as it is.
      if (!row?.id || row.isSuppressed || row.isConfirmed) {
        continue;
      }

      await DataStoreFindingService.updateOneById({
        id: row.id,
        data: { isConfirmed: true },
        props: data.actor.props,
      });

      if (isOneUptimeAi) {
        // What a person's confirmation sets, as OneUptime AI's own.
        await DataStoreFindingService.updateColumnsByIdWithoutHooks({
          id: row.id,
          data: {
            confidence: DataConfidence.High,
            isConfirmedByAi: true,
            decidedAt: OneUptimeDate.getCurrentDate(),
          },
        });
      }

      confirmed.push(finding);
    }

    if (confirmed.length > 0) {
      await queueDataSecurityEvaluation(data.projectId);
    }

    return {
      result: {
        confirmedFindingIds: confirmed.map(
          (finding: { findingId: string }): string => {
            return finding.findingId;
          },
        ),
        byOneUptimeAi: isOneUptimeAi,
      },
      summaryMarkdown: (confirmed.length === 0
        ? mdText`Every finding it would confirm was decided already, so none was confirmed.`
        : FeedMarkdown.join(
            [
              mdText`Confirmed, and counted as High:`,
              FeedMarkdown.join(confirmed.map(findingLine)),
            ],
            " ",
          )
      ).toString(),
    };
  },

  async undo(data: {
    projectId: ObjectID;
    proposal: DataSecurityAiProposal;
    actor: DataSecurityAiActor;
  }): Promise<DataSecurityAiChangeUndone> {
    const ids: Array<string> = readConfirmedIds(data.proposal.result);
    const byOneUptimeAi: boolean =
      data.proposal.result?.["byOneUptimeAi"] === true;
    let undone: number = 0;

    for (const id of ids) {
      const row: DataStoreFinding | null =
        await DataStoreFindingService.findOneBy({
          query: { _id: new ObjectID(id), projectId: data.projectId },
          select: {
            _id: true,
            isSuppressed: true,
            isConfirmed: true,
            isConfirmedByAi: true,
          },
          props: { isRoot: true },
        });

      /*
       * Taken back only while it stands as this change left it: a person
       * who decided it since - which makes it theirs - keeps their decision.
       */
      if (
        !row?.id ||
        !row.isConfirmed ||
        row.isSuppressed ||
        (byOneUptimeAi && !row.isConfirmedByAi)
      ) {
        continue;
      }

      await DataStoreFindingService.updateOneById({
        id: row.id,
        data: { isConfirmed: false },
        props: data.actor.props,
      });

      if (!data.actor.userId) {
        await DataStoreFindingService.updateColumnsByIdWithoutHooks({
          id: row.id,
          data: {
            confidence: DataConfidence.Low,
            isConfirmedByAi: false,
            decidedAt: null,
          } as never,
        });
      }

      undone++;
    }

    if (undone > 0) {
      await queueDataSecurityEvaluation(data.projectId);
    }

    return {
      summaryMarkdown: (undone > 0
        ? mdText`The confirmations were taken back: the findings are Low again and wait for a person.`
        : mdText`Every finding it confirmed was decided since, so each was left as it was.`
      ).toString(),
    };
  },
};

export default ConfirmFindingsAction;
