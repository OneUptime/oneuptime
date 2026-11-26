import { JSONObject, JSONValue } from "../../../../Types/JSON";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import {
  ONEUPTIME_ACTOR_ATTRIBUTE,
  ONEUPTIME_ACTOR_ATTRIBUTES,
  ONEUPTIME_ACTOR_CONNECTION_ATTRIBUTE,
  ONEUPTIME_ACTOR_VALUE,
} from "../../../../Types/SecurityEvent/OneUptimeActor";
import SecurityLogFormat, {
  SECURITY_LOG_FORMAT_ATTRIBUTE,
} from "../../../../Types/SecurityEvent/SecurityLogFormat";
import {
  MAX_EVENT_MESSAGE_LENGTH,
  cutText,
} from "../../../../Utils/SecurityEvent/LogParsers/SecurityLogLine";
import GlobalCache from "../../../Infrastructure/GlobalCache";
import logger from "../../Logger";
import { AwsCallerSession, CloudChange } from "../CloudConnectorTypes";
import { AwsRolePurpose, getRoleSessionName } from "./AwsSts";

/*
 * ONEUPTIME'S OWN AWS SESSION, TOLD EXACTLY (#10427, #10428).
 *
 * OneUptime reads a customer's AWS accounts - and Data Security's
 * responses change them - through the cloud connection's role, in a
 * session it names OneUptime-<connection id> (AwsSts.getRoleSessionName).
 * The account's CloudTrail records every call of that session, and
 * Security Events reads the same CloudTrail: without knowing the session
 * as OneUptime's, Data Security's refused reads looked like someone
 * probing a stolen key, and its own fix of a shared snapshot like the
 * snapshot being shared.
 *
 * A session's name is chosen by whoever signs in, so a name proves
 * nothing: anyone the role's trust policy lets in could name a session
 * OneUptime-<connection id>. What only OneUptime holds is the key AWS
 * handed it: every sign-in gets a new temporary key (ASIA...), CloudTrail
 * records on every call the key it was signed with (userIdentity
 * .accessKeyId), and only the holder of the key's secret can sign with it.
 * So:
 *
 *   - each time OneUptime signs in to a Cloud Connect connection's role
 *     (AwsCloudConnector.getCredentials, through AwsSts.assumeRole), it
 *     remembers the ID of the key AWS handed it - never its secret or its
 *     session token - with the project, the connection, the role, the
 *     sign-in's purpose and the session's life, in the shared cache for
 *     every server (remember);
 *   - a call is OneUptime's own only when it was signed with one of those
 *     keys, AND was made while that session lasted, AND its session is
 *     exactly that connection's - the connection's role, by account and
 *     name, and the session name OneUptime gives that connection - AND
 *     nothing in the record says another made the session or the call: no
 *     source identity (OneUptime never sets one), no AWS service acting for
 *     it, no person of IAM Identity Center, no web identity
 *     (isOneUptimeAwsSession).
 *
 * Anything short of that is not OneUptime's own, and everything it does
 * stays as it was: a different session of the same role, the same session
 * name on another role or in another session (a key of its own), another
 * project's session in this account, a project's Amazon SES role (a
 * sign-in of another purpose), a record with no key or no time, a call
 * timed outside its session, a key the cache has forgotten - after the
 * cache restarted, or one another OneUptime handed out - or cannot be asked
 * about. When OneUptime cannot tell, a person is told, as before (#10426:
 * fail toward a person).
 *
 * A key's ID is remembered until two hours after its session ends: a call
 * reaches OneUptime well after it is made - CloudTrail delivers in about
 * five minutes, LookupEvents lags by up to fifteen, a scan can fall behind
 * - and a call made near a session's end must still be known. An expired
 * key signs nothing, so the ID kept longer lets nothing in; and the call's
 * own time must fall within the session (CLOCK_SKEW_MS either side), so
 * the hours kept after it never stretch what the session could have done.
 * A scan more than two hours behind keeps the alert.
 */

const NAMESPACE: string = "oneuptime-aws-session";

// How long a key's ID is remembered after its session ends.
export const ONEUPTIME_AWS_SESSION_KEPT_AFTER_EXPIRY_MS: number =
  2 * 60 * 60 * 1000;

// How far the cloud's clock and OneUptime's may differ: a call is in its session within this either side.
export const ONEUPTIME_AWS_SESSION_CLOCK_SKEW_MS: number = 5 * 60 * 1000;

// The longest session AWS hands out: no session is taken to last longer.
export const ONEUPTIME_AWS_SESSION_LONGEST_MS: number = 12 * 60 * 60 * 1000;

// Keys asked of the shared cache in one round trip.
const RECALL_BATCH: number = 500;

/*
 * What OneUptime remembers of a key AWS handed it: the connection and the
 * role it signed in to, what the sign-in was for, and when the session
 * began and ends.
 */
export interface OneUptimeAwsSessionKey {
  connectionId: string;
  roleArn: string;
  purpose: AwsRolePurpose;
  issuedAtMs: number;
  expiresAtMs: number;
}

interface AssumedRoleArn {
  partition: string;
  accountId: string;
  roleName: string;
  sessionName: string;
}

interface RoleArn {
  partition: string;
  accountId: string;
  roleName: string;
}

const ASSUMED_ROLE_ARN: RegExp =
  /^arn:(aws[a-z-]*):sts::([0-9]{12}):assumed-role\/([^/]+)\/([^/]+)$/;
const ROLE_ARN_START: RegExp = /^arn:(aws[a-z-]*):iam::([0-9]{12}):role\//;

// arn:aws:sts::<account>:assumed-role/<role>/<session>, or null.
export function parseAssumedRoleArn(arn: string): AssumedRoleArn | null {
  const match: RegExpExecArray | null = ASSUMED_ROLE_ARN.exec(arn.trim());

  if (!match) {
    return null;
  }

  return {
    partition: match[1]!,
    accountId: match[2]!,
    roleName: match[3]!,
    sessionName: match[4]!,
  };
}

// arn:aws:iam::<account>:role/<path/><role>, or null: a role's name is its last segment.
export function parseRoleArn(arn: string): RoleArn | null {
  const text: string = arn.trim();
  const match: RegExpExecArray | null = ROLE_ARN_START.exec(text);

  if (!match) {
    return null;
  }

  const path: string = text.slice(match[0].length);
  const roleName: string = path.slice(path.lastIndexOf("/") + 1);

  if (!roleName) {
    return null;
  }

  return { partition: match[1]!, accountId: match[2]!, roleName };
}

function textOf(value: JSONValue | undefined): string {
  if (typeof value === "string") {
    return value.trim();
  }

  return typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : "";
}

function objectOf(value: JSONValue | undefined): JSONObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : {};
}

// Who signed the call, from a CloudTrail record as CloudTrail writes it.
export function readAwsCallerSessionOfRecord(
  record: JSONObject,
): AwsCallerSession {
  const identity: JSONObject = objectOf(record["userIdentity"]);
  const context: JSONObject = objectOf(identity["sessionContext"]);

  return {
    type: textOf(identity["type"]),
    arn: textOf(identity["arn"]),
    accountId: textOf(identity["accountId"]),
    principalId: textOf(identity["principalId"]),
    accessKeyId: textOf(identity["accessKeyId"]),
    issuerArn: textOf(objectOf(context["sessionIssuer"])["arn"]),
    sourceIdentity: textOf(context["sourceIdentity"]),
    invokedBy: textOf(identity["invokedBy"]),
    onBehalfOf: textOf(objectOf(identity["onBehalfOf"])["userId"]),
    webIdentityProvider: textOf(
      objectOf(context["webIdFederationData"])["federatedProvider"],
    ),
  };
}

/*
 * Who signed the call, from a security event's attributes: the record's
 * fields as CloudTrailLogParser keeps them, flattened.
 */
export function readAwsCallerSessionOfAttributes(
  attributes: JSONObject,
): AwsCallerSession {
  const read: (key: string) => string = (key: string): string => {
    return textOf(attributes[key]);
  };

  return {
    type: read("userIdentity.type"),
    arn: read("userIdentity.arn"),
    accountId: read("userIdentity.accountId"),
    principalId: read("userIdentity.principalId"),
    accessKeyId: read("userIdentity.accessKeyId"),
    issuerArn: read("userIdentity.sessionContext.sessionIssuer.arn"),
    sourceIdentity: read("userIdentity.sessionContext.sourceIdentity"),
    invokedBy: read("userIdentity.invokedBy"),
    onBehalfOf: read("userIdentity.onBehalfOf.userId"),
    webIdentityProvider: read(
      "userIdentity.sessionContext.webIdFederationData.federatedProvider",
    ),
  };
}

/*
 * Whether a call could be OneUptime's own at all - an assumed role's
 * session, signed with a key, that nothing says another made - and so is
 * worth asking what OneUptime remembers of its key.
 */
export function couldBeOneUptimeAwsSession(caller: AwsCallerSession): boolean {
  return (
    caller.type === "AssumedRole" &&
    Boolean(caller.accessKeyId) &&
    !caller.sourceIdentity &&
    !caller.invokedBy &&
    !caller.onBehalfOf &&
    !caller.webIdentityProvider &&
    parseAssumedRoleArn(caller.arn) !== null
  );
}

function isSameRole(
  a: { partition: string; accountId: string; roleName: string },
  b: { partition: string; accountId: string; roleName: string },
): boolean {
  // IAM holds a role's name whatever its case: two roles of one account never differ by case alone.
  return (
    a.partition === b.partition &&
    a.accountId === b.accountId &&
    a.roleName.toLowerCase() === b.roleName.toLowerCase()
  );
}

// Whether the call was made while the session lasted, give or take the clocks' difference.
export function isWithinOneUptimeAwsSession(
  calledAt: Date | null | undefined,
  remembered: Pick<OneUptimeAwsSessionKey, "issuedAtMs" | "expiresAtMs">,
): boolean {
  const time: number = calledAt ? calledAt.getTime() : NaN;

  return (
    Number.isFinite(time) &&
    time >= remembered.issuedAtMs - ONEUPTIME_AWS_SESSION_CLOCK_SKEW_MS &&
    time <= remembered.expiresAtMs + ONEUPTIME_AWS_SESSION_CLOCK_SKEW_MS
  );
}

/*
 * Whether the call is OneUptime's own: signed with a key AWS handed
 * OneUptime for a Cloud Connect connection (`remembered`, what OneUptime
 * kept of the record's key), made while that session lasted (`calledAt`,
 * the record's own time), in the session OneUptime gives that key's
 * connection, on the role it signed in to - and nothing in the record says
 * another made the session or the call. False whenever any of it is missing
 * or differs.
 */
export function isOneUptimeAwsSession(
  caller: AwsCallerSession,
  remembered: OneUptimeAwsSessionKey | null | undefined,
  calledAt: Date | null | undefined,
): boolean {
  if (!remembered || !couldBeOneUptimeAwsSession(caller)) {
    return false;
  }

  // A Cloud Connect sign-in's: a project's Amazon SES role is not a connection's.
  if (remembered.purpose !== AwsRolePurpose.CloudConnect) {
    return false;
  }

  // Made while the session lasted: the hours its key is kept after never count.
  if (!isWithinOneUptimeAwsSession(calledAt, remembered)) {
    return false;
  }

  const session: AssumedRoleArn | null = parseAssumedRoleArn(caller.arn);
  const role: RoleArn | null = parseRoleArn(remembered.roleArn);

  if (!session || !role || !remembered.connectionId) {
    return false;
  }

  // The name OneUptime gives this connection's sessions, exactly.
  if (session.sessionName !== getRoleSessionName(remembered.connectionId)) {
    return false;
  }

  // The role OneUptime signed in to: its partition, account and name.
  if (!isSameRole(session, role)) {
    return false;
  }

  // What else the record says of the session agrees, where it says it.
  if (caller.accountId && caller.accountId !== session.accountId) {
    return false;
  }

  if (
    caller.principalId &&
    !caller.principalId.endsWith(`:${session.sessionName}`)
  ) {
    return false;
  }

  if (caller.issuerArn) {
    const issuer: RoleArn | null = parseRoleArn(caller.issuerArn);

    if (!issuer || !isSameRole(issuer, role)) {
      return false;
    }
  }

  return true;
}

function keyOf(projectId: string, accessKeyId: string): string {
  return `${projectId.toLowerCase()}:${accessKeyId}`;
}

// A remembered value, or null for anything this file did not write.
function readRemembered(value: string | null): OneUptimeAwsSessionKey | null {
  if (!value) {
    return null;
  }

  try {
    const parsed: unknown = JSON.parse(value);

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return null;
    }

    const connectionId: unknown = (parsed as JSONObject)["connectionId"];
    const roleArn: unknown = (parsed as JSONObject)["roleArn"];
    const purpose: unknown = (parsed as JSONObject)["purpose"];
    const issuedAtMs: unknown = (parsed as JSONObject)["issuedAtMs"];
    const expiresAtMs: unknown = (parsed as JSONObject)["expiresAtMs"];

    if (
      typeof connectionId !== "string" ||
      !connectionId ||
      typeof roleArn !== "string" ||
      !parseRoleArn(roleArn) ||
      !Object.values(AwsRolePurpose).includes(purpose as AwsRolePurpose) ||
      typeof issuedAtMs !== "number" ||
      typeof expiresAtMs !== "number" ||
      !Number.isFinite(issuedAtMs) ||
      !Number.isFinite(expiresAtMs) ||
      expiresAtMs <= issuedAtMs
    ) {
      return null;
    }

    return {
      connectionId,
      roleArn,
      purpose: purpose as AwsRolePurpose,
      issuedAtMs,
      expiresAtMs,
    };
  } catch {
    return null;
  }
}

// A record's own time: when the call was made, as CloudTrail says; null when it says none.
function readCallTime(value: JSONValue | undefined): Date | null {
  const text: string = textOf(value);
  const time: Date = new Date(text);

  return text && !Number.isNaN(time.getTime()) ? time : null;
}

function describeError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

// How a call of OneUptime's own reads in an event's message.
function describeOwnCall(attributes: JSONObject): string {
  const readOnly: string = textOf(attributes["readOnly"]).toLowerCase();

  if (readOnly === "true") {
    return "OneUptime's own read";
  }

  return readOnly === "false"
    ? "OneUptime's own change"
    : "OneUptime's own call";
}

export default class OneUptimeAwsSessions {
  /*
   * Remembers the ID of a key AWS handed OneUptime when it signed in to a
   * connection's role - the ID alone, never the key's secret or its session
   * token - until two hours after its session ends
   * (ONEUPTIME_AWS_SESSION_KEPT_AFTER_EXPIRY_MS). `issuedAtMs` is when the
   * sign-in was asked for, `expiresAtMs` when AWS said the session ends.
   * Never throws: a key that cannot be remembered leaves its session's calls
   * as anyone's.
   */
  public static async remember(data: {
    projectId: string;
    connectionId: string;
    roleArn: string;
    purpose: AwsRolePurpose;
    accessKeyId: string;
    issuedAtMs: number;
    expiresAtMs: number;
  }): Promise<void> {
    const accessKeyId: string = (data.accessKeyId || "").trim();

    if (
      !accessKeyId ||
      !data.projectId ||
      !data.connectionId ||
      !parseRoleArn(data.roleArn) ||
      !Number.isFinite(data.issuedAtMs) ||
      !Number.isFinite(data.expiresAtMs) ||
      data.expiresAtMs <= data.issuedAtMs
    ) {
      return;
    }

    // No session lasts longer than AWS hands out, whatever an answer said.
    const expiresAtMs: number = Math.min(
      data.expiresAtMs,
      data.issuedAtMs + ONEUPTIME_AWS_SESSION_LONGEST_MS,
    );
    const remembered: OneUptimeAwsSessionKey = {
      connectionId: data.connectionId,
      roleArn: data.roleArn.trim(),
      purpose: data.purpose,
      issuedAtMs: data.issuedAtMs,
      expiresAtMs,
    };
    const keptMs: number =
      Math.max(0, expiresAtMs - Date.now()) +
      ONEUPTIME_AWS_SESSION_KEPT_AFTER_EXPIRY_MS;

    try {
      await GlobalCache.setString(
        NAMESPACE,
        keyOf(data.projectId, accessKeyId),
        JSON.stringify(remembered),
        { expiresInSeconds: Math.ceil(keptMs / 1000) },
      );
    } catch (error) {
      logger.debug(
        `Cloud connections: the shared cache could not keep connection ${data.connectionId}'s session key, so its calls are not told as OneUptime's own (${describeError(error)}).`,
      );
    }
  }

  /*
   * What OneUptime remembers of these keys, for the project: the keys AWS
   * handed it, each with its connection and role. A key it did not hand
   * out, or that is forgotten, is not in the answer; when the shared cache
   * cannot be asked, none is.
   */
  public static async recall(
    projectId: string,
    accessKeyIds: Array<string>,
  ): Promise<Map<string, OneUptimeAwsSessionKey>> {
    const remembered: Map<string, OneUptimeAwsSessionKey> = new Map();
    const keys: Array<string> = Array.from(
      new Set(
        accessKeyIds
          .map((key: string): string => {
            return (key || "").trim();
          })
          .filter((key: string): boolean => {
            return key.length > 0;
          }),
      ),
    );

    if (!projectId || keys.length === 0) {
      return remembered;
    }

    try {
      for (let start: number = 0; start < keys.length; start += RECALL_BATCH) {
        const batch: Array<string> = keys.slice(start, start + RECALL_BATCH);
        const values: Array<string | null> = await GlobalCache.getStrings(
          NAMESPACE,
          batch.map((key: string): string => {
            return keyOf(projectId, key);
          }),
        );

        batch.forEach((key: string, index: number): void => {
          const value: OneUptimeAwsSessionKey | null = readRemembered(
            values[index] || null,
          );

          if (value) {
            remembered.set(key, value);
          }
        });
      }
    } catch (error) {
      logger.debug(
        `Cloud connections: the shared cache could not be asked which calls were OneUptime's own in project ${projectId}, so none is (${describeError(error)}).`,
      );
      return new Map();
    }

    return remembered;
  }

  /*
   * The changes of a batch OneUptime made in its own sessions, each with
   * the connection and role it was made through. Only AWS changes say who
   * signed them (actorSession); every other change is anyone's.
   */
  public static async findOwnChanges(data: {
    projectId: string;
    changes: Array<CloudChange>;
  }): Promise<Map<CloudChange, OneUptimeAwsSessionKey>> {
    const own: Map<CloudChange, OneUptimeAwsSessionKey> = new Map();
    const candidates: Array<CloudChange> = data.changes.filter(
      (change: CloudChange): boolean => {
        return (
          change.kind === "change" &&
          Boolean(change.actorSession) &&
          couldBeOneUptimeAwsSession(change.actorSession!)
        );
      },
    );

    if (candidates.length === 0) {
      return own;
    }

    const remembered: Map<string, OneUptimeAwsSessionKey> = await this.recall(
      data.projectId,
      candidates.map((change: CloudChange): string => {
        return change.actorSession!.accessKeyId;
      }),
    );

    for (const change of candidates) {
      const key: OneUptimeAwsSessionKey | undefined = remembered.get(
        change.actorSession!.accessKeyId,
      );

      if (
        key &&
        isOneUptimeAwsSession(change.actorSession!, key, change.time)
      ) {
        own.set(change, key);
      }
    }

    return own;
  }

  /*
   * Marks the CloudTrail events OneUptime's own sessions made - as "Your
   * logs" and Cloud audit logs make them - with oneuptime.actor =
   * oneuptime and the connection whose session it was, and says so first
   * in the event's message ("OneUptime's own read: ..."). Whatever an
   * arriving record says under those keys is dropped first, from every
   * event: only OneUptime says an event is its own. Returns how many it
   * marked. Never throws: an event it cannot tell stays as it was.
   */
  public static async markSecurityEvents(data: {
    projectId: string;
    events: Array<NormalizedSecurityEvent>;
  }): Promise<number> {
    const candidates: Array<{
      event: NormalizedSecurityEvent;
      caller: AwsCallerSession;
    }> = [];

    for (const event of data.events) {
      for (const key of ONEUPTIME_ACTOR_ATTRIBUTES) {
        delete event.attributes[key];
      }

      if (
        event.attributes[SECURITY_LOG_FORMAT_ATTRIBUTE] !==
        SecurityLogFormat.AwsCloudTrail
      ) {
        continue;
      }

      const caller: AwsCallerSession = readAwsCallerSessionOfAttributes(
        event.attributes,
      );

      if (couldBeOneUptimeAwsSession(caller)) {
        candidates.push({ event, caller });
      }
    }

    if (candidates.length === 0) {
      return 0;
    }

    const remembered: Map<string, OneUptimeAwsSessionKey> = await this.recall(
      data.projectId,
      candidates.map((candidate: { caller: AwsCallerSession }): string => {
        return candidate.caller.accessKeyId;
      }),
    );
    let marked: number = 0;

    for (const { event, caller } of candidates) {
      const key: OneUptimeAwsSessionKey | undefined = remembered.get(
        caller.accessKeyId,
      );

      // When the call was made, as the record says: not when it was read, or stored.
      const calledAt: Date | null = readCallTime(event.attributes["eventTime"]);

      if (!key || !isOneUptimeAwsSession(caller, key, calledAt)) {
        continue;
      }

      event.attributes[ONEUPTIME_ACTOR_ATTRIBUTE] = ONEUPTIME_ACTOR_VALUE;
      event.attributes[ONEUPTIME_ACTOR_CONNECTION_ATTRIBUTE] = key.connectionId;
      event.message = cutText(
        `${describeOwnCall(event.attributes)}: ${event.message}`,
        MAX_EVENT_MESSAGE_LENGTH,
      );
      marked++;
    }

    return marked;
  }
}
