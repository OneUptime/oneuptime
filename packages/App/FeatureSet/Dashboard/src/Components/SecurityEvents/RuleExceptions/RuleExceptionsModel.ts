import {
  ADDRESS_RANGE_LABEL,
  STATUS_ENDS_AT,
  STATUS_EXPIRES,
  STATUS_NO_EXPIRY,
  STATUS_STARTS_AT,
  TIME_WINDOW_LABEL,
  VALUE_IN_FIELD,
} from "./RuleExceptionsCopy";
import Color from "Common/Types/Color";
import { Gray500, Green, Indigo500 } from "Common/Types/BrandColors";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import {
  SecurityEntity,
  SecurityEntityType,
  getSecurityEntityIcon,
} from "Common/Types/SecurityCase/SecurityEntity";
import {
  DetectionRuleExceptionKind,
  DetectionRuleExceptionShape,
  DetectionRuleExceptionStatus,
  getDetectionRuleExceptionStatus,
  isDetectionRuleExceptionCidr,
  isDetectionRuleExceptionEntityType,
  readDetectionRuleExceptionDate,
} from "Common/Types/SecurityEvent/DetectionRuleException";

/*
 * What the Rule Exceptions list and the Add Exception dialog show of an
 * exception, worked out without React, so it is pinned in a plain test:
 * what a row skips and how it says what kind of thing that is, where the
 * exception stands, and what the dialog starts with when it is opened from
 * a rule's row or from a case's detection.
 */

/*
 * One of the list's sentences: an en.json key and the values it takes. A
 * time is handed over as a date, written in the reader's language where the
 * sentence is drawn. A line with no key is its time alone ("2 days ago").
 */
export interface RuleExceptionLine {
  key?: string | undefined;
  field?: string | undefined;
  time?: Date | undefined;
  from?: Date | undefined;
  until?: Date | undefined;
  /*
   * The time as how far ahead or how long ago it is ("in 30 days", "2 days
   * ago"), not as a date: the date itself is under the pointer.
   */
  isTimeRelative?: boolean | undefined;
}

// What the Skips cell shows: the thing skipped, and what kind of thing it is.
export interface RuleExceptionSkipsView {
  icon: IconProp;
  // The value or pattern as written; null for a time window.
  value: string | null;
  // A time window's times, drawn in place of a value; null for the others.
  window: { from: Date | undefined; until: Date | undefined } | null;
  // The line under it: the entity's type, "Value of processName", or "Time window".
  kind: RuleExceptionLine;
}

export function getRuleExceptionSkipsView(
  exception: DetectionRuleExceptionShape,
): RuleExceptionSkipsView {
  if (exception.kind === DetectionRuleExceptionKind.TimeWindow) {
    return {
      icon: IconProp.Clock,
      value: null,
      window: {
        from: readDetectionRuleExceptionDate(exception.startsAt) || undefined,
        until: readDetectionRuleExceptionDate(exception.endsAt) || undefined,
      },
      kind: { key: TIME_WINDOW_LABEL },
    };
  }

  const value: string = (exception.value || "").trim();

  if (exception.kind === DetectionRuleExceptionKind.Value) {
    return {
      icon: IconProp.Filter,
      value,
      window: null,
      kind: { key: VALUE_IN_FIELD, field: (exception.fieldName || "").trim() },
    };
  }

  const entityType: string = isDetectionRuleExceptionEntityType(
    exception.entityType,
  )
    ? exception.entityType
    : SecurityEntityType.Other;

  const isRange: boolean =
    entityType === SecurityEntityType.IpAddress &&
    isDetectionRuleExceptionCidr(value);

  return {
    icon: getSecurityEntityIcon(entityType),
    value,
    window: null,
    kind: { key: isRange ? ADDRESS_RANGE_LABEL : entityType },
  };
}

// The pill's color: green while it skips, indigo before a window starts, grey once it is over.
export function getRuleExceptionStatusColor(
  status: DetectionRuleExceptionStatus,
): Color {
  switch (status) {
    case DetectionRuleExceptionStatus.Active:
      return Green;
    case DetectionRuleExceptionStatus.Upcoming:
      return Indigo500;
    default:
      return Gray500;
  }
}

/*
 * The line under the pill: how soon it stops skipping, or starts, or how
 * long ago it stopped - "Expires in 30 days", "Starts in 21 hours", "Ends
 * in 3 hours", "2 days ago" under Expired or Ended. A window's own times
 * are in its row already, and the pill says which way it went, so the line
 * says only how far off.
 */
export function getRuleExceptionStatusLine(
  exception: DetectionRuleExceptionShape,
  now: Date,
): RuleExceptionLine {
  const status: DetectionRuleExceptionStatus = getDetectionRuleExceptionStatus(
    exception,
    now,
  );

  if (exception.kind === DetectionRuleExceptionKind.TimeWindow) {
    const startsAt: Date | undefined =
      readDetectionRuleExceptionDate(exception.startsAt) || undefined;
    const endsAt: Date | undefined =
      readDetectionRuleExceptionDate(exception.endsAt) || undefined;

    if (status === DetectionRuleExceptionStatus.Upcoming) {
      return { key: STATUS_STARTS_AT, time: startsAt, isTimeRelative: true };
    }

    if (status === DetectionRuleExceptionStatus.Ended) {
      return { time: endsAt, isTimeRelative: true };
    }

    return { key: STATUS_ENDS_AT, time: endsAt, isTimeRelative: true };
  }

  const expiresAt: Date | undefined =
    readDetectionRuleExceptionDate(exception.expiresAt) || undefined;

  if (!expiresAt) {
    return { key: STATUS_NO_EXPIRY };
  }

  return status === DetectionRuleExceptionStatus.Expired
    ? { time: expiresAt, isTimeRelative: true }
    : { key: STATUS_EXPIRES, time: expiresAt, isTimeRelative: true };
}

/*
 * How many of each rule's exceptions skip something now, by rule id: the
 * count under a rule's name. Expired exceptions and windows over or not
 * started yet are not counted.
 */
export function countActiveExceptionsByRule(
  exceptions: ReadonlyArray<
    DetectionRuleExceptionShape & { detectionRuleId?: unknown }
  >,
  now: Date,
): Map<string, number> {
  const counts: Map<string, number> = new Map();

  for (const exception of exceptions) {
    const ruleId: string = exception.detectionRuleId
      ? String(exception.detectionRuleId)
      : "";

    if (!ruleId) {
      continue;
    }

    if (
      getDetectionRuleExceptionStatus(exception, now) !==
      DetectionRuleExceptionStatus.Active
    ) {
      continue;
    }

    counts.set(ruleId, (counts.get(ruleId) || 0) + 1);
  }

  return counts;
}

/*
 * The entity a case's detection is about, to start an exception with: the
 * one the rule grouped it by when that is a user, a host or an address,
 * else the first such entity it names. Null when it names none.
 */
export function getDetectionExceptionEntity(detection: {
  groupValue?: string | undefined | null;
  entities: ReadonlyArray<SecurityEntity>;
}): SecurityEntity | null {
  const skippable: Array<SecurityEntity> = detection.entities.filter(
    (entity: SecurityEntity): boolean => {
      return (
        isDetectionRuleExceptionEntityType(entity.type) &&
        Boolean(entity.value && entity.value.trim())
      );
    },
  );

  const groupValue: string = (detection.groupValue || "").trim().toLowerCase();

  if (groupValue) {
    const grouped: SecurityEntity | undefined = skippable.find(
      (entity: SecurityEntity): boolean => {
        return entity.value.trim().toLowerCase() === groupValue;
      },
    );

    if (grouped) {
      return grouped;
    }
  }

  return skippable[0] || null;
}

/*
 * What Add Exception starts with: the rule (the form's rule dropdown holds
 * its id), and - from a case's detection - the entity it is about. Without
 * an entity it starts on an entity of the first kind, for the person to
 * fill in.
 */
export function getRuleExceptionInitialValues(data: {
  detectionRuleId?: string | undefined;
  entity?: SecurityEntity | null | undefined;
}): JSONObject {
  const values: JSONObject = {
    kind: DetectionRuleExceptionKind.Entity,
    entityType: data.entity ? data.entity.type : SecurityEntityType.User,
  };

  if (data.detectionRuleId) {
    values["detectionRule"] = data.detectionRuleId;
  }

  if (data.entity) {
    values["value"] = data.entity.value.trim();
  }

  return values;
}
