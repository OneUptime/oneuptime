import { jest } from "@jest/globals";
import fs from "fs";
import path from "path";
import GlobalCache from "../../Server/Infrastructure/GlobalCache";
import { JSONObject } from "../../Types/JSON";
import { SecurityLogLine } from "../../Utils/SecurityEvent/LogParsers/SecurityLogLine";

/*
 * CLOUDTRAIL AS AWS RECORDS IT, FOR #10427 AND #10428 - Tests/Fixtures/CloudTrail:
 *
 *   - RecordedRoleSessionRefusals.json: Stratus Red Team's recording of
 *     aws.discovery.ec2-download-user-data (github.com/DataDog/stratus-red-team,
 *     docs/detonation-logs, Apache-2.0): fifteen calls of one role's session
 *     AWS refused, and the two sign-ins that made it - one session name, two
 *     keys. Its account, keys, session tokens, Region, address and user
 *     agent are replaced by documentation values.
 *   - DataSecurityRefusedReads.json: twenty-five reads of Data Security's
 *     that AWS refused, in OneUptime's own session, field for field in the
 *     shape of the recorded refusals.
 *   - SnapshotSharing.json: Stratus Red Team's recorded ModifyDBSnapshotAttribute
 *     (aws.exfiltration.rds-share-snapshot), and in its shape Data Security's
 *     own Revoke sharing, another session of the same role making the
 *     snapshot public, OneUptime's session name with a key OneUptime was
 *     never handed, and a change whose parameters are not recorded.
 *
 * Not a test file itself, so jest does not run it.
 */

const FIXTURES: string = path.join(__dirname, "../Fixtures/CloudTrail");

// OneUptime's own session in the samples: the project, its connection and the role it signs in to.
export const RECORDED_PROJECT_ID: string =
  "11111111-1111-4111-8111-111111111111";
export const RECORDED_CONNECTION_ID: string =
  "33333333-3333-4333-8333-333333333333";
export const RECORDED_ACCOUNT_ID: string = "111122223333";
export const RECORDED_ROLE_NAME: string = "OneUptimeReadOnly-5f3a9c1e";
export const RECORDED_ROLE_ARN: string = `arn:aws:iam::${RECORDED_ACCOUNT_ID}:role/${RECORDED_ROLE_NAME}`;
export const RECORDED_SESSION_NAME: string =
  "OneUptime-33333333333343338333333333333333";
export const RECORDED_SESSION_KEY: string = "ASIA2ONEUPTIMEXAMPLE";
/*
 * When OneUptime's session in the samples began - its creationDate - and
 * when it ends: an hour later, the session OneUptime asks AWS for.
 */
export const RECORDED_SESSION_ISSUED_MS: number = new Date(
  "2026-11-20T10:00:58Z",
).getTime();
export const RECORDED_SESSION_EXPIRES_MS: number =
  RECORDED_SESSION_ISSUED_MS + 60 * 60 * 1000;

export type CloudTrailRecording =
  | "RecordedRoleSessionRefusals"
  | "DataSecurityRefusedReads"
  | "SnapshotSharing";

// A recording's records, as CloudTrail wrote them: a fresh copy each time.
export function readCloudTrailRecording(
  name: CloudTrailRecording,
): Array<JSONObject> {
  const document: JSONObject = JSON.parse(
    fs.readFileSync(path.join(FIXTURES, `${name}.json`), "utf8"),
  ) as JSONObject;

  return document["Records"] as Array<JSONObject>;
}

// Records as one log line of a CloudTrail log file, as a shipper forwards it.
export function cloudTrailLogLine(
  records: Array<JSONObject>,
  time: Date = new Date("2026-11-20T10:05:00Z"),
): SecurityLogLine {
  return {
    body: JSON.stringify({ Records: records }),
    attributes: {},
    time,
  };
}

/*
 * The same call, as if another session had made it: the session's name,
 * role and key, written everywhere CloudTrail writes them (the ARN, the
 * principal id, the session issuer). What is not said stays the record's.
 */
export function asSession(
  record: JSONObject,
  session: {
    sessionName?: string | undefined;
    roleName?: string | undefined;
    accountId?: string | undefined;
    accessKeyId?: string | undefined;
    sourceIdentity?: string | undefined;
    invokedBy?: string | undefined;
  },
): JSONObject {
  const copy: JSONObject = JSON.parse(JSON.stringify(record)) as JSONObject;
  const identity: JSONObject = copy["userIdentity"] as JSONObject;
  const context: JSONObject = identity["sessionContext"] as JSONObject;
  const issuer: JSONObject = context["sessionIssuer"] as JSONObject;
  const accountId: string = session.accountId || RECORDED_ACCOUNT_ID;
  const roleName: string = session.roleName || RECORDED_ROLE_NAME;
  const sessionName: string = session.sessionName || RECORDED_SESSION_NAME;
  const roleId: string = String(issuer["principalId"]);

  identity["arn"] =
    `arn:aws:sts::${accountId}:assumed-role/${roleName}/${sessionName}`;
  identity["principalId"] = `${roleId}:${sessionName}`;
  identity["accountId"] = accountId;
  identity["accessKeyId"] = session.accessKeyId || RECORDED_SESSION_KEY;
  issuer["arn"] = `arn:aws:iam::${accountId}:role/${roleName}`;
  issuer["userName"] = roleName;
  issuer["accountId"] = accountId;

  if (session.sourceIdentity) {
    context["sourceIdentity"] = session.sourceIdentity;
  }

  if (session.invokedBy) {
    identity["invokedBy"] = session.invokedBy;
  }

  return copy;
}

// The same call, as if an IAM user had made it with a long-lived key.
export function asIamUser(record: JSONObject, userName: string): JSONObject {
  const copy: JSONObject = JSON.parse(JSON.stringify(record)) as JSONObject;

  copy["userIdentity"] = {
    type: "IAMUser",
    principalId: "AIDA2ALICEEXAMPLE001",
    arn: `arn:aws:iam::${RECORDED_ACCOUNT_ID}:user/${userName}`,
    accountId: RECORDED_ACCOUNT_ID,
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    userName,
  };

  return copy;
}

/*
 * The shared cache, in memory: what OneUptimeAwsSessions remembers and
 * recalls. `failing` makes every call fail, as an unreachable cache does.
 */
export interface MemoryGlobalCache {
  values: Map<string, string>;
  failing: boolean;
}

export function installMemoryGlobalCache(): MemoryGlobalCache {
  const cache: MemoryGlobalCache = { values: new Map(), failing: false };

  jest
    .spyOn(GlobalCache, "setString")
    .mockImplementation(
      async (namespace: string, key: string, value: string): Promise<void> => {
        if (cache.failing) {
          throw new Error("Cache is not connected");
        }

        cache.values.set(`${namespace}-${key}`, value);
      },
    );

  jest
    .spyOn(GlobalCache, "getStrings")
    .mockImplementation(
      async (
        namespace: string,
        keys: Array<string>,
      ): Promise<Array<string | null>> => {
        if (cache.failing) {
          throw new Error("Cache is not connected");
        }

        return keys.map((key: string): string | null => {
          return cache.values.get(`${namespace}-${key}`) || null;
        });
      },
    );

  return cache;
}
