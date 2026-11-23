import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/DataStoreFinding";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnUpdate } from "../Types/Database/Hooks";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import {
  queueDataSecurityEvaluation,
  queueDataSecurityScanTuning,
} from "../Utils/DataSecurity/DataSecurityJobs";
import DataConfidence from "../../Types/DataSecurity/DataConfidence";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";

/*
 * Findings are OneUptime's to write. What a person changes is whether a
 * finding is sensitive at all, and whether it holds what the scan - or
 * OneUptime AI - was not sure it holds: both decide the store's
 * sensitivity and so its checks, so either change queues the project's
 * evaluation.
 *
 * A finding a person confirms counts as High confidence: once the update
 * is written its confidence is set to High as OneUptime's own write (a
 * person cannot set a confidence), and to Low when the confirmation is
 * taken back - only a Low finding is offered to confirm, and the next scan
 * says again what a detector is sure of. The finding writer keeps a
 * confirmed finding's High (DataSecurityFindingWriter).
 *
 * A person's decision is precedent for OneUptime AI's verdicts on findings
 * like it (#10372): when it was made is kept (decidedAt), and it is the
 * person's, so a confirmation OneUptime AI made on its own stops being its
 * own (isConfirmedByAi). A finding marked not sensitive has OneUptime AI
 * look again at what the project's decisions say of its scans - a data
 * type every finding of which was marked not sensitive, a location always
 * marked so (DataSecurityScanTuning) - a few minutes on, once for a
 * person's several marks.
 *
 * OneUptime never marks a finding not sensitive on its own, OneUptime AI
 * included, under any rule (#10372): a leak marked as noise is a leak
 * nobody looks at again. An update of OneUptime's own - root, with no
 * person - that would do it is refused here, whoever wrote it.
 */

export const ONLY_A_PERSON_MARKS_NOT_SENSITIVE_MESSAGE: string =
  "Only a person can mark a finding as not sensitive, with their reason. OneUptime and OneUptime AI never do it on their own.";

interface FindingUpdateCarry {
  projectIds: Array<ObjectID>;
  // The rows a person confirmed, or took the confirmation back from.
  confirmation?: { ids: Array<ObjectID>; isConfirmed: boolean } | undefined;
  // The rows a person decided, or took a decision back from: when, or null.
  decision?: { ids: Array<ObjectID>; decidedAt: Date | null } | undefined;
  // A person marked them not sensitive: what the scans could stop looking for.
  isMarkedNotSensitive?: boolean | undefined;
}

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    const data: JSONObject = updateBy.data as unknown as JSONObject;
    const isJudged: boolean =
      data["isSuppressed"] !== undefined || data["isConfirmed"] !== undefined;

    // OneUptime's own write never marks a finding not sensitive.
    if (
      data["isSuppressed"] === true &&
      updateBy.props.isRoot &&
      !updateBy.props.userId
    ) {
      throw new BadDataException(ONLY_A_PERSON_MARKS_NOT_SENSITIVE_MESSAGE);
    }

    if (!isJudged || updateBy.props.isRoot) {
      return { updateBy, carryForward: null };
    }

    if (data["isSuppressed"] === false) {
      data["suppressedReason"] = null;
    }

    const rows: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      { _id: true, projectId: true },
    );
    const ids: Array<ObjectID> = rows
      .map((row: Model): ObjectID | undefined => {
        return row.id || undefined;
      })
      .filter((id: ObjectID | undefined): id is ObjectID => {
        return Boolean(id);
      });

    const carry: FindingUpdateCarry = {
      projectIds: rows
        .map((row: Model): ObjectID | undefined => {
          return row.projectId;
        })
        .filter((projectId: ObjectID | undefined): projectId is ObjectID => {
          return Boolean(projectId);
        }),
    };

    if (typeof data["isConfirmed"] === "boolean") {
      carry.confirmation = { ids, isConfirmed: data["isConfirmed"] };
    }

    // Decided when it is marked either way; taken back when only undone.
    const isDecided: boolean =
      data["isSuppressed"] === true || data["isConfirmed"] === true;

    carry.decision = {
      ids,
      decidedAt: isDecided ? OneUptimeDate.getCurrentDate() : null,
    };
    carry.isMarkedNotSensitive = data["isSuppressed"] === true;

    return { updateBy, carryForward: carry };
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    _updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    const carry: FindingUpdateCarry | null =
      (onUpdate.carryForward as FindingUpdateCarry | null) || null;

    if (!carry) {
      return onUpdate;
    }

    const confirmed: Set<string> = new Set(
      (carry.confirmation?.ids || []).map((id: ObjectID): string => {
        return id.toString();
      }),
    );
    const ids: Array<ObjectID> = [...(carry.decision?.ids || [])];

    // A confirmation's rows that the decision did not list, written too.
    for (const id of carry.confirmation?.ids || []) {
      if (
        !ids.some((other: ObjectID): boolean => {
          return other.toString() === id.toString();
        })
      ) {
        ids.push(id);
      }
    }

    for (const id of ids) {
      const columns: JSONObject = {};

      if (confirmed.has(id.toString())) {
        columns["confidence"] = carry.confirmation?.isConfirmed
          ? DataConfidence.High
          : DataConfidence.Low;
      }

      if (carry.decision) {
        // A person's decision: never OneUptime AI's own confirmation again.
        columns["decidedAt"] = carry.decision.decidedAt;
        columns["isConfirmedByAi"] = false;
      }

      await this.updateColumnsByIdWithoutHooks({
        id,
        data: columns as never,
      });
    }

    const seen: Set<string> = new Set();

    for (const projectId of carry.projectIds) {
      if (!seen.has(projectId.toString())) {
        seen.add(projectId.toString());
        await queueDataSecurityEvaluation(projectId);

        if (carry.isMarkedNotSensitive) {
          await queueDataSecurityScanTuning(projectId);
        }
      }
    }

    return onUpdate;
  }
}

export default new Service();
