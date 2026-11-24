import ApiKey from "../../../Models/DatabaseModels/ApiKey";
import DetectionRuleException from "../../../Models/DatabaseModels/DetectionRuleException";
import TableColumnType from "../../../Types/AnalyticsDatabase/TableColumnType";
import Includes from "../../../Types/BaseDatabase/Includes";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
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
import { getApiKeyPrincipal } from "../../../Types/SecurityEvent/OneUptimeActorPrincipal";
import { escapeRegExp } from "../../../Utils/RegExpEscape";
import ApiKeyService from "../../Services/ApiKeyService";
import DetectionRuleExceptionService from "../../Services/DetectionRuleExceptionService";
import Select from "../../Types/Database/Select";
import { SQL, Statement } from "../AnalyticsDatabase/Statement";
import { resolveSigmaField } from "./Sigma/SigmaClickhouseCompiler";
import {
  SECURITY_VALUE_WILDCARD,
  buildAnyElementMatches,
  buildTextMatchesValue,
  orAllStatements,
} from "./SecurityValueMatch";

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
 *
 * AN EXCEPTION THAT NAMES A PROJECT API KEY BY ITS NAME (#10630). Until
 * #10630 an audit-log event named the key that acted by its name, in
 * principalUser ("terraform"), so an exception for the user "terraform" -
 * or for the value principalUser terraform - skipped the key. A key is no
 * person: its events name it "api-key:" and its id now, so it is never
 * offered as a user to suspend and two keys of one name are two actors
 * (Types/SecurityEvent/OneUptimeActorPrincipal), with its name kept in the
 * message and in audit.api_key_name. Such an exception still skips the
 * key: when a rule's exceptions are loaded, each that names users - an
 * entity exception for a user, or a value exception on principalUser - is
 * matched against the names of the project's API keys, as a value is
 * matched here (whatever the case, * for any run), and also skips the
 * principals of the keys it names (apiKeyPrincipals). So "terraform" skips
 * every key named terraform, as it did, and the events stored before
 * #10630, which name it; "api-key:<id>" skips that key alone. The
 * comparison stays on principalUser, which every rule reads anyway: no read
 * takes the events' attributes for it, and it does not need the key's name
 * to stay in the event.
 */

/*
 * An exception as a rule's runs read it: the stored one, and for one that
 * names users, the principals of the project's API keys whose name it
 * names (#10630).
 */
export interface DetectionRuleExceptionRead
  extends DetectionRuleExceptionShape {
  apiKeyPrincipals?: ReadonlyArray<string> | undefined;
}

// An exception the loader read, with the row it came from.
export interface LoadedDetectionRuleException
  extends DetectionRuleExceptionRead {
  id: ObjectID | undefined;
  detectionRuleId: ObjectID | undefined;
}

// The most API key principals one exception skips by name.
export const MAX_API_KEY_PRINCIPALS_PER_EXCEPTION: number = 100;

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
 * of characters; an address range for an IP address entity. The same
 * comparison a watchlist's values make (SecurityValueMatch).
 */
function textMatches(
  expression: Statement,
  value: string,
  options: { isAddressRange: boolean },
): Statement {
  return buildTextMatchesValue(expression, value, options);
}

// Whether any element of an array column is the value.
function anyElementMatches(
  column: string,
  value: string,
  options: { isAddressRange: boolean },
): Statement {
  return buildAnyElementMatches({
    column,
    elementName: ELEMENT,
    matchElement: (element: Statement): Statement => {
      return textMatches(element, value, options);
    },
  });
}

function orAll(parts: Array<Statement>): Statement {
  return orAllStatements(parts);
}

// principalUser is one of the API keys the exception names by their name.
function principalIsOneOf(principals: ReadonlyArray<string>): Statement {
  return SQL`lowerUTF8(principalUser) IN ${{
    type: TableColumnType.ArrayText,
    value: principals.map((principal: string): string => {
      return principal.toLowerCase();
    }),
  }}`;
}

// The API keys an exception names by their name, as principals (#10630).
function apiKeyPrincipalsOf(
  exception: DetectionRuleExceptionRead,
): ReadonlyArray<string> {
  return (exception.apiKeyPrincipals || []).slice(
    0,
    MAX_API_KEY_PRINCIPALS_PER_EXCEPTION,
  );
}

/*
 * Whether an exception names users, and so may name a project API key by
 * its name: an entity exception for a user, or a value exception whose
 * field is principalUser (by name, or a Sigma spelling of it).
 */
export function doesDetectionRuleExceptionNameUsers(
  exception: DetectionRuleExceptionShape,
): boolean {
  if (exception.kind === DetectionRuleExceptionKind.Entity) {
    return exception.entityType === SecurityEntityType.User;
  }

  if (exception.kind !== DetectionRuleExceptionKind.Value) {
    return false;
  }

  const field: string = normalizeDetectionRuleExceptionField(
    exception.fieldName,
  );

  if (!field) {
    return false;
  }

  const resolved: ReturnType<typeof resolveSigmaField> =
    resolveSigmaField(field);

  return resolved.kind === "textColumn" && resolved.column === "principalUser";
}

/*
 * Whether a text is the exception's value as the SQL here compares them
 * (buildTextMatchesValue): whatever the case, * for any run of characters
 * and nothing else a wildcard. An empty value, or a lone *, is nothing.
 */
export function doesDetectionRuleExceptionValueMatchText(
  value: unknown,
  text: string | null | undefined,
): boolean {
  const pattern: string = normalizeDetectionRuleExceptionValue(value);
  const candidate: string = (text || "").toLowerCase();

  if (!pattern || pattern === DETECTION_RULE_EXCEPTION_WILDCARD || !candidate) {
    return false;
  }

  const lowered: string = pattern.toLowerCase();

  if (!lowered.includes(SECURITY_VALUE_WILDCARD)) {
    return candidate === lowered;
  }

  // Each piece literal, the stars between them any run, newlines included.
  return new RegExp(
    `^${lowered
      .split(SECURITY_VALUE_WILDCARD)
      .map((piece: string): string => {
        return escapeRegExp(piece);
      })
      .join("[\\s\\S]*")}$`,
  ).test(candidate);
}

/*
 * The principals of the API keys whose name an exception's value names
 * (#10630), at most MAX_API_KEY_PRINCIPALS_PER_EXCEPTION: none for an
 * exception that names no users.
 */
export function getApiKeyPrincipalsNamedBy(
  exception: DetectionRuleExceptionShape,
  apiKeys: ReadonlyArray<{ id: string; name: string }>,
): Array<string> {
  if (!doesDetectionRuleExceptionNameUsers(exception)) {
    return [];
  }

  const principals: Array<string> = [];

  for (const apiKey of apiKeys) {
    const principal: string = getApiKeyPrincipal(apiKey.id);

    if (
      principal &&
      !principals.includes(principal) &&
      doesDetectionRuleExceptionValueMatchText(exception.value, apiKey.name)
    ) {
      principals.push(principal);
    }

    if (principals.length >= MAX_API_KEY_PRINCIPALS_PER_EXCEPTION) {
      break;
    }
  }

  return principals;
}

/*
 * The condition an event meets when this exception skips it; null for an
 * exception that names nothing it can match (a row written by hand through
 * the API that the checks would refuse now).
 */
export function buildDetectionRuleExceptionMatch(
  exception: DetectionRuleExceptionRead,
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

    // The project's API keys a user exception names by their name (#10630).
    if (exception.entityType === SecurityEntityType.User) {
      const principals: ReadonlyArray<string> = apiKeyPrincipalsOf(exception);

      if (principals.length > 0) {
        parts.push(principalIsOneOf(principals));
      }
    }

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
      default: {
        // A typed text column, from the compiler's fixed set.
        const match: Statement = textMatches(
          new Statement([resolved.column], []),
          value,
          { isAddressRange: false },
        );
        const principals: ReadonlyArray<string> =
          resolved.column === "principalUser"
            ? apiKeyPrincipalsOf(exception)
            : [];

        // The project's API keys a principalUser value names by their name (#10630).
        return principals.length > 0
          ? orAll([match, principalIsOneOf(principals)])
          : match;
      }
    }
  }

  return null;
}

/*
 * The condition an event meets when any of these exceptions skips it, or
 * null when none can skip anything.
 */
export function buildDetectionRuleExceptionsMatch(
  exceptions: ReadonlyArray<DetectionRuleExceptionRead>,
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
  exceptions: ReadonlyArray<DetectionRuleExceptionRead>,
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
   * named. Those that name users carry the principals of the project's API
   * keys whose name they name (#10630), read once for them all.
   */
  public static async loadForProject(data: {
    projectId: ObjectID;
    ruleIds?: Array<ObjectID> | undefined;
    from: Date;
    until: Date;
    now: Date;
  }): Promise<Map<string, Array<LoadedDetectionRuleException>>> {
    const byRule: Map<string, Array<LoadedDetectionRuleException>> = new Map();

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

    const applying: Array<DetectionRuleException> = exceptions.filter(
      (exception: DetectionRuleException): boolean => {
        return (
          Boolean(exception.detectionRuleId) &&
          doesDetectionRuleExceptionApply(exception, {
            from: data.from,
            until: data.until,
            now: data.now,
          })
        );
      },
    );

    const apiKeys: Array<{ id: string; name: string }> = applying.some(
      (exception: DetectionRuleException): boolean => {
        return doesDetectionRuleExceptionNameUsers(exception);
      },
    )
      ? await this.readApiKeyNames(data.projectId)
      : [];

    for (const exception of applying) {
      const key: string = exception.detectionRuleId!.toString();
      const list: Array<LoadedDetectionRuleException> = byRule.get(key) || [];
      const apiKeyPrincipals: Array<string> = getApiKeyPrincipalsNamedBy(
        exception,
        apiKeys,
      );

      list.push({
        id: exception.id || undefined,
        detectionRuleId: exception.detectionRuleId,
        kind: exception.kind,
        entityType: exception.entityType,
        fieldName: exception.fieldName,
        value: exception.value,
        startsAt: exception.startsAt,
        endsAt: exception.endsAt,
        expiresAt: exception.expiresAt,
        ...(apiKeyPrincipals.length > 0 ? { apiKeyPrincipals } : {}),
      });
      byRule.set(key, list);
    }

    return byRule;
  }

  /*
   * The project's API keys, by id and name, for the exceptions that name
   * one by its name (#10630). At most LIMIT_PER_PROJECT, oldest first.
   */
  public static async readApiKeyNames(
    projectId: ObjectID,
  ): Promise<Array<{ id: string; name: string }>> {
    const apiKeys: Array<ApiKey> = await ApiKeyService.findAllBy({
      query: { projectId },
      select: { _id: true, name: true },
      sort: { _id: SortOrder.Ascending },
      limit: LIMIT_PER_PROJECT,
      props: { isRoot: true },
    });

    const named: Array<{ id: string; name: string }> = [];

    for (const apiKey of apiKeys) {
      const id: string = apiKey.id?.toString() || "";
      const name: string = (apiKey.name || "").toString().trim();

      if (id && name) {
        named.push({ id, name });
      }
    }

    return named;
  }

  // One rule's exceptions that take part in a read (loadForProject, for one rule).
  public static async loadForRule(data: {
    projectId: ObjectID;
    ruleId: ObjectID;
    from: Date;
    until: Date;
    now: Date;
  }): Promise<Array<LoadedDetectionRuleException>> {
    const byRule: Map<
      string,
      Array<LoadedDetectionRuleException>
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
