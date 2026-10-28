import DetectionRuleException from "../../../Models/DatabaseModels/DetectionRuleException";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../Types/ObjectID";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import {
  DETECTION_RULE_EXCEPTION_ENTITY_FIELDS,
  DETECTION_RULE_EXCEPTION_WILDCARD,
  DetectionRuleExceptionKind,
  DetectionRuleExceptionShape,
  doesDetectionRuleExceptionApply,
  isDetectionRuleExceptionCidr,
  isDetectionRuleExceptionEntityType,
  normalizeDetectionRuleExceptionField,
  normalizeDetectionRuleExceptionValue,
  readDetectionRuleExceptionDate,
} from "../../../Types/SecurityEvent/DetectionRuleException";
import DetectionRuleExceptionService from "../../Services/DetectionRuleExceptionService";
import Select from "../../Types/Database/Select";
import {
  SQL,
  Statement,
  escapeIlikePattern,
} from "../AnalyticsDatabase/Statement";
import {
  buildIpInRangeExpression,
  resolveSigmaField,
} from "./Sigma/SigmaClickhouseCompiler";

/*
 * A detection rule's exceptions as SQL: the condition an event meets when
 * one of them skips it, over the SecurityEvent table, every value bound as a
 * parameter (Types/SecurityEvent/DetectionRuleException has the rules).
 *
 *   - an entity: the fields its kind is read from (principalUser and
 *     targetUser for a user...), and the event's observables;
 *   - a value: the field as a Sigma rule names it (resolveSigmaField: a
 *     typed field, a Sigma spelling of one, or an attribute key);
 *   - a time window: the event's time, from its start up to its end.
 *
 * Text is compared whatever the case; * stands for any run of characters,
 * and nothing else is a wildcard (a Windows path keeps its backslashes); an
 * IP address entity may be a CIDR range.
 *
 * The rule's runs AND `NOT (<any exception>)` into what they read, so a
 * skipped event never counts toward the rule's threshold.
 */

// The lambda parameter for an array's elements: named so no column can shadow it.
const ELEMENT: string = "__exception_element";

// Every column an exception is read with, for the rule's runs.
export const DETECTION_RULE_EXCEPTION_SELECT: Select<DetectionRuleException> = {
  _id: true,
  detectionRuleId: true,
  kind: true,
  entityType: true,
  fieldName: true,
  value: true,
  startsAt: true,
  endsAt: true,
  expiresAt: true,
};

function textParam(value: string): Statement {
  return SQL`${{ type: TableColumnType.Text, value }}`;
}

/*
 * Whether a text expression is the value: whatever the case, * for any run
 * of characters; an address range for an IP address entity.
 */
function textMatches(
  expression: Statement,
  value: string,
  options: { isAddressRange: boolean },
): Statement {
  if (options.isAddressRange) {
    return buildIpInRangeExpression(expression, value);
  }

  const lowered: string = value.toLowerCase();
  const statement: Statement = SQL`lowerUTF8(`;
  statement.append(expression);

  if (lowered.includes(DETECTION_RULE_EXCEPTION_WILDCARD)) {
    // Each piece literal (LIKE's own % _ and \ escaped), the stars between them any run.
    const pattern: string = lowered
      .split(DETECTION_RULE_EXCEPTION_WILDCARD)
      .map((piece: string): string => {
        return escapeIlikePattern(piece);
      })
      .join("%");

    statement.append(") LIKE ");
    statement.append(textParam(pattern));
    return statement;
  }

  statement.append(") = ");
  statement.append(textParam(lowered));
  return statement;
}

// Whether any element of an array column is the value.
function anyElementMatches(
  column: string,
  value: string,
  options: { isAddressRange: boolean },
): Statement {
  const statement: Statement = new Statement([`arrayExists(${ELEMENT} -> `]);
  statement.append(textMatches(new Statement([ELEMENT], []), value, options));
  statement.append(`, ${column})`);
  return statement;
}

function orAll(parts: Array<Statement>): Statement {
  const statement: Statement = SQL`(`;

  parts.forEach((part: Statement, index: number): void => {
    if (index > 0) {
      statement.append(" OR ");
    }

    statement.append(SQL`(`);
    statement.append(part);
    statement.append(")");
  });

  statement.append(")");
  return statement;
}

/*
 * The condition an event meets when this exception skips it; null for an
 * exception that names nothing it can match (a row written by hand through
 * the API that the checks would refuse now).
 */
export function buildDetectionRuleExceptionMatch(
  exception: DetectionRuleExceptionShape,
): Statement | null {
  if (exception.kind === DetectionRuleExceptionKind.TimeWindow) {
    const startsAt: Date | null = readDetectionRuleExceptionDate(
      exception.startsAt,
    );
    const endsAt: Date | null = readDetectionRuleExceptionDate(
      exception.endsAt,
    );

    if (!startsAt || !endsAt || endsAt.getTime() <= startsAt.getTime()) {
      return null;
    }

    return SQL`(time >= ${{
      type: TableColumnType.DateTime64,
      value: startsAt,
    }} AND time < ${{
      type: TableColumnType.DateTime64,
      value: endsAt,
    }})`;
  }

  const value: string = normalizeDetectionRuleExceptionValue(exception.value);

  // An empty value, or a lone *, would skip everything: never a match.
  if (!value || value === DETECTION_RULE_EXCEPTION_WILDCARD) {
    return null;
  }

  if (exception.kind === DetectionRuleExceptionKind.Entity) {
    if (!isDetectionRuleExceptionEntityType(exception.entityType)) {
      return null;
    }

    const isAddressRange: boolean =
      exception.entityType === SecurityEntityType.IpAddress &&
      isDetectionRuleExceptionCidr(value);

    const fields: ReadonlyArray<string> =
      DETECTION_RULE_EXCEPTION_ENTITY_FIELDS[exception.entityType] || [];

    // The fields come from the fixed list above, never from a caller.
    const parts: Array<Statement> = fields.map((field: string): Statement => {
      return textMatches(new Statement([field], []), value, {
        isAddressRange,
      });
    });

    parts.push(anyElementMatches("observables", value, { isAddressRange }));

    return orAll(parts);
  }

  if (exception.kind === DetectionRuleExceptionKind.Value) {
    const field: string = normalizeDetectionRuleExceptionField(
      exception.fieldName,
    );

    if (!field) {
      return null;
    }

    const resolved: ReturnType<typeof resolveSigmaField> =
      resolveSigmaField(field);

    switch (resolved.kind) {
      case "attribute": {
        const expression: Statement = SQL`attributes[`;
        expression.append(textParam(resolved.attributeKey));
        expression.append("]");
        return textMatches(expression, value, { isAddressRange: false });
      }
      case "numberColumn":
        return textMatches(
          new Statement([`toString(${resolved.column})`], []),
          value,
          { isAddressRange: false },
        );
      case "arrayColumn":
        return anyElementMatches(resolved.column, value, {
          isAddressRange: false,
        });
      default:
        // A typed text column, from the compiler's fixed set.
        return textMatches(new Statement([resolved.column], []), value, {
          isAddressRange: false,
        });
    }
  }

  return null;
}

/*
 * The condition an event meets when any of these exceptions skips it, or
 * null when none can skip anything.
 */
export function buildDetectionRuleExceptionsMatch(
  exceptions: ReadonlyArray<DetectionRuleExceptionShape>,
): Statement | null {
  const matches: Array<Statement> = [];

  for (const exception of exceptions) {
    const match: Statement | null = buildDetectionRuleExceptionMatch(exception);

    if (match) {
      matches.push(match);
    }
  }

  return matches.length > 0 ? orAll(matches) : null;
}

/*
 * What a rule's run ANDs into its read: the events no exception skips. Null
 * when none can skip anything.
 */
export function buildDetectionRuleExceptionsFilter(
  exceptions: ReadonlyArray<DetectionRuleExceptionShape>,
): Statement | null {
  const match: Statement | null = buildDetectionRuleExceptionsMatch(exceptions);

  if (!match) {
    return null;
  }

  const statement: Statement = SQL`NOT `;
  statement.append(match);
  return statement;
}

// Two restrictions on a read, ANDed; either may be missing.
export function andRestrictions(
  first: Statement | null | undefined,
  second: Statement | null | undefined,
): Statement | undefined {
  if (!first) {
    return second || undefined;
  }

  if (!second) {
    return first;
  }

  const statement: Statement = SQL`(`;
  statement.append(first);
  statement.append(") AND (");
  statement.append(second);
  statement.append(")");
  return statement;
}

export default class DetectionRuleExceptions {
  /*
   * The exceptions that take part in a read of a project's events from
   * `from` to `until`, made at `now` (doesDetectionRuleExceptionApply), by
   * rule id: one read for every rule a turn evaluates, or for the rules
   * named.
   */
  public static async loadForProject(data: {
    projectId: ObjectID;
    ruleIds?: Array<ObjectID> | undefined;
    from: Date;
    until: Date;
    now: Date;
  }): Promise<Map<string, Array<DetectionRuleException>>> {
    const byRule: Map<string, Array<DetectionRuleException>> = new Map();

    if (data.ruleIds && data.ruleIds.length === 0) {
      return byRule;
    }

    const exceptions: Array<DetectionRuleException> =
      await DetectionRuleExceptionService.findAllBy({
        query: {
          projectId: data.projectId,
          ...(data.ruleIds
            ? {
                detectionRuleId: new Includes(
                  data.ruleIds.map((id: ObjectID): string => {
                    return id.toString();
                  }),
                ),
              }
            : {}),
        },
        select: DETECTION_RULE_EXCEPTION_SELECT,
        sort: {
          _id: SortOrder.Ascending,
        },
        props: {
          isRoot: true,
        },
      });

    for (const exception of exceptions) {
      if (!exception.detectionRuleId) {
        continue;
      }

      if (
        !doesDetectionRuleExceptionApply(exception, {
          from: data.from,
          until: data.until,
          now: data.now,
        })
      ) {
        continue;
      }

      const key: string = exception.detectionRuleId.toString();
      const list: Array<DetectionRuleException> = byRule.get(key) || [];
      list.push(exception);
      byRule.set(key, list);
    }

    return byRule;
  }

  // One rule's exceptions that take part in a read (loadForProject, for one rule).
  public static async loadForRule(data: {
    projectId: ObjectID;
    ruleId: ObjectID;
    from: Date;
    until: Date;
    now: Date;
  }): Promise<Array<DetectionRuleException>> {
    const byRule: Map<
      string,
      Array<DetectionRuleException>
    > = await this.loadForProject({
      projectId: data.projectId,
      ruleIds: [data.ruleId],
      from: data.from,
      until: data.until,
      now: data.now,
    });

    return byRule.get(data.ruleId.toString()) || [];
  }
}
