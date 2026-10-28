import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/DetectionRuleException";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import RelationValueUtil from "../Utils/Database/RelationValueUtil";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import PositiveNumber from "../../Types/PositiveNumber";
import {
  DETECTION_RULE_EXCEPTIONS_PER_RULE_MAX,
  DetectionRuleExceptionCheckOptions,
  DetectionRuleExceptionColumns,
  DetectionRuleExceptionKind,
  DetectionRuleExceptionShape,
  getDetectionRuleExceptionColumns,
  getDetectionRuleExceptionProblem,
  isDetectionRuleExceptionKind,
  normalizeDetectionRuleExceptionField,
  normalizeDetectionRuleExceptionValue,
  readDetectionRuleExceptionDate,
} from "../../Types/SecurityEvent/DetectionRuleException";

/*
 * The columns an exception is made of: an update that names any of them is
 * checked as the exception it leaves behind. The rule is named either way a
 * write can name it: its id column, or the relation a form's dropdown sends
 * ({ _id }).
 */
const EXCEPTION_COLUMNS: ReadonlyArray<string> = [
  "detectionRuleId",
  "detectionRule",
  "kind",
  "entityType",
  "fieldName",
  "value",
  "startsAt",
  "endsAt",
  "expiresAt",
  "reason",
];

/*
 * The columns each kind does not use, cleared when an exception becomes
 * that kind, so a row never carries a stale field of a kind it no longer is.
 */
const COLUMNS_OTHER_KINDS_CLEAR: Readonly<
  Record<DetectionRuleExceptionKind, ReadonlyArray<string>>
> = {
  [DetectionRuleExceptionKind.Entity]: ["fieldName", "startsAt", "endsAt"],
  [DetectionRuleExceptionKind.Value]: ["entityType", "startsAt", "endsAt"],
  [DetectionRuleExceptionKind.TimeWindow]: [
    "entityType",
    "fieldName",
    "value",
    "expiresAt",
  ],
};

/*
 * The rule a write names, under either of its names: the id column, or the
 * relation. Undefined when the write names none; null when it clears it.
 */
export function getWrittenDetectionRuleId(
  data: JSONObject,
): string | null | undefined {
  if (data["detectionRuleId"] !== undefined) {
    return RelationValueUtil.getRelationId(data["detectionRuleId"]);
  }

  if (data["detectionRule"] === undefined) {
    return undefined;
  }

  return RelationValueUtil.getRelationId(data["detectionRule"]);
}

/*
 * A detection rule's exceptions (Types/SecurityEvent/DetectionRuleException):
 * each one checked as the form checks it, stored with only the columns of
 * its kind, and at most DETECTION_RULE_EXCEPTIONS_PER_RULE_MAX per rule. The
 * rule must be the project's own (ProjectReferencesService).
 */
export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  // The words a problem is answered with: the shared rules' first, as a 400.
  public static assertValid(
    exception: DetectionRuleExceptionShape,
    options: DetectionRuleExceptionCheckOptions,
  ): void {
    const problem: string | null = getDetectionRuleExceptionProblem(
      exception,
      options,
    );

    if (problem) {
      throw new BadDataException(problem);
    }
  }

  // Whether a rule has room for one more exception.
  private async assertRuleHasRoom(detectionRuleId: ObjectID): Promise<void> {
    const count: PositiveNumber = await this.countBy({
      query: {
        detectionRuleId,
      },
      props: {
        isRoot: true,
      },
    });

    if (count.toNumber() >= DETECTION_RULE_EXCEPTIONS_PER_RULE_MAX) {
      throw new BadDataException(
        `A rule keeps at most ${DETECTION_RULE_EXCEPTIONS_PER_RULE_MAX} exceptions. Remove the ones it no longer needs, or change the rule itself.`,
      );
    }
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    const ruleId: string | null | undefined = getWrittenDetectionRuleId(
      createBy.data as unknown as JSONObject,
    );

    if (!ruleId) {
      throw new BadDataException("Choose the detection rule that skips it.");
    }

    Service.assertValid(createBy.data, {
      now: OneUptimeDate.getCurrentDate(),
      isExpiryNew: true,
    });

    const columns: DetectionRuleExceptionColumns =
      getDetectionRuleExceptionColumns(createBy.data);

    // Only the columns of its kind, normalized; null clears the rest.
    Object.assign(createBy.data as unknown as JSONObject, columns);

    // The rule by its id column, however the write named it.
    createBy.data.detectionRuleId = new ObjectID(ruleId);

    await this.assertRuleHasRoom(createBy.data.detectionRuleId);

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    const data: JSONObject = updateBy.data as unknown as JSONObject;

    const isExceptionChanged: boolean = EXCEPTION_COLUMNS.some(
      (column: string): boolean => {
        return data[column] !== undefined;
      },
    );

    if (!isExceptionChanged) {
      return { updateBy, carryForward: null };
    }

    // The update's own values, normalized as a create's are.
    if (data["value"] !== undefined && data["value"] !== null) {
      data["value"] = normalizeDetectionRuleExceptionValue(data["value"]);
    }

    if (data["fieldName"] !== undefined && data["fieldName"] !== null) {
      data["fieldName"] = normalizeDetectionRuleExceptionField(
        data["fieldName"],
      );
    }

    if (typeof data["reason"] === "string") {
      data["reason"] = (data["reason"] as string).trim();
    }

    if (
      data["kind"] !== undefined &&
      isDetectionRuleExceptionKind(data["kind"])
    ) {
      for (const column of COLUMNS_OTHER_KINDS_CLEAR[data["kind"]]) {
        data[column] = null;
      }
    }

    const writtenRuleId: string | null | undefined =
      getWrittenDetectionRuleId(data);

    // An exception always belongs to a rule: it is moved, never set loose.
    if (writtenRuleId === null) {
      throw new BadDataException("Choose the detection rule that skips it.");
    }

    const rows: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      {
        _id: true,
        detectionRuleId: true,
        kind: true,
        entityType: true,
        fieldName: true,
        value: true,
        startsAt: true,
        endsAt: true,
        expiresAt: true,
        reason: true,
      },
    );

    const now: Date = OneUptimeDate.getCurrentDate();

    for (const row of rows) {
      // The exception the update leaves behind: the row, with what the update writes.
      const merged: DetectionRuleExceptionShape = {
        kind: pick(data, "kind", row.kind),
        entityType: pick(data, "entityType", row.entityType),
        fieldName: pick(data, "fieldName", row.fieldName),
        value: pick(data, "value", row.value),
        startsAt: pick(data, "startsAt", row.startsAt),
        endsAt: pick(data, "endsAt", row.endsAt),
        expiresAt: pick(data, "expiresAt", row.expiresAt),
        reason: pick(data, "reason", row.reason),
      };

      Service.assertValid(merged, {
        now,
        // An expiry is checked when it changes: an expired exception's reason can still be edited.
        isExpiryNew:
          data["expiresAt"] !== undefined &&
          !isSameDate(data["expiresAt"], row.expiresAt),
      });

      const movesRule: boolean =
        typeof writtenRuleId === "string" &&
        writtenRuleId.toLowerCase() !==
          (row.detectionRuleId?.toString() || "").toLowerCase();

      if (movesRule) {
        await this.assertRuleHasRoom(new ObjectID(writtenRuleId as string));
      }
    }

    return { updateBy, carryForward: null };
  }
}

// The update's value for a column when it writes one (null included), else the row's.
function pick<T>(data: JSONObject, column: string, current: T): T {
  return data[column] !== undefined ? (data[column] as unknown as T) : current;
}

function isSameDate(next: unknown, current: Date | undefined): boolean {
  const nextDate: Date | null = readDetectionRuleExceptionDate(next);
  const currentDate: Date | null = readDetectionRuleExceptionDate(current);

  if (!nextDate || !currentDate) {
    return !nextDate && !currentDate;
  }

  return nextDate.getTime() === currentDate.getTime();
}

export default new Service();
