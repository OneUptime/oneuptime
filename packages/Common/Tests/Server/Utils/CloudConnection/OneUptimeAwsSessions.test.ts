import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import {
  AwsRolePurpose,
  getRoleSessionName,
} from "../../../../Server/Utils/CloudConnection/Aws/AwsSts";
import OneUptimeAwsSessions, {
  ONEUPTIME_AWS_SESSION_CLOCK_SKEW_MS,
  ONEUPTIME_AWS_SESSION_KEPT_AFTER_EXPIRY_MS,
  ONEUPTIME_AWS_SESSION_LONGEST_MS,
  OneUptimeAwsSessionKey,
  couldBeOneUptimeAwsSession,
  isOneUptimeAwsSession as isOwnSessionAt,
  isWithinOneUptimeAwsSession,
  parseAssumedRoleArn,
  parseRoleArn,
  readAwsCallerSessionOfAttributes,
  readAwsCallerSessionOfRecord,
} from "../../../../Server/Utils/CloudConnection/Aws/OneUptimeAwsSessions";
import {
  AwsCallerSession,
  CloudChange,
} from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import { JSONObject } from "../../../../Types/JSON";
import NormalizedSecurityEvent from "../../../../Types/SecurityEvent/NormalizedSecurityEvent";
import {
  ONEUPTIME_ACTOR_ATTRIBUTE,
  ONEUPTIME_ACTOR_CONNECTION_ATTRIBUTE,
} from "../../../../Types/SecurityEvent/OneUptimeActor";
import CloudTrailLogParser from "../../../../Utils/SecurityEvent/LogParsers/CloudTrailLogParser";
import SecurityLogParser from "../../../../Utils/SecurityEvent/LogParsers/SecurityLogParser";
import {
  MemoryGlobalCache,
  RECORDED_ACCOUNT_ID,
  RECORDED_CONNECTION_ID,
  RECORDED_PROJECT_ID,
  RECORDED_ROLE_ARN,
  RECORDED_ROLE_NAME,
  RECORDED_SESSION_EXPIRES_MS,
  RECORDED_SESSION_ISSUED_MS,
  RECORDED_SESSION_KEY,
  RECORDED_SESSION_NAME,
  asIamUser,
  asSession,
  cloudTrailLogLine,
  installMemoryGlobalCache,
  readCloudTrailRecording,
} from "../../../Helpers/CloudTrailRecordings";

/*
 * ONEUPTIME'S OWN AWS SESSION, TOLD EXACTLY (#10427). A call is OneUptime's
 * own only when it was signed with a key AWS handed OneUptime itself for a
 * Cloud Connect connection, made while that session lasted, in the session
 * OneUptime gives that key's connection, on the role it signed in to, and
 * nothing in the record says another made the session or the call.
 * Anything short of that is anyone's, and every rule reads it as before.
 */

const OTHER_PROJECT_ID: string = "22222222-2222-4222-8222-222222222222";
const OTHER_CONNECTION_ID: string = "44444444-4444-4444-8444-444444444444";

const REMEMBERED: OneUptimeAwsSessionKey = {
  connectionId: RECORDED_CONNECTION_ID,
  roleArn: RECORDED_ROLE_ARN,
  purpose: AwsRolePurpose.CloudConnect,
  issuedAtMs: RECORDED_SESSION_ISSUED_MS,
  expiresAtMs: RECORDED_SESSION_EXPIRES_MS,
};

const MINUTE_MS: number = 60 * 1000;
const HOUR_MS: number = 60 * MINUTE_MS;

// When the samples' first call was made: inside the session OneUptime remembers.
const CALLED_AT: Date = new Date("2026-11-20T10:01:14Z");

// The recognition, of a call made when the samples' first call was.
function isOneUptimeAwsSession(
  caller: AwsCallerSession,
  remembered: OneUptimeAwsSessionKey | null | undefined,
): boolean {
  return isOwnSessionAt(caller, remembered, CALLED_AT);
}

// OneUptime's own refused read, as CloudTrail recorded it.
function ownRecord(): JSONObject {
  return readCloudTrailRecording("DataSecurityRefusedReads")[0]!;
}

function callerOf(record: JSONObject): AwsCallerSession {
  return readAwsCallerSessionOfRecord(record);
}

function eventsOf(records: Array<JSONObject>): Array<NormalizedSecurityEvent> {
  return SecurityLogParser.parse(cloudTrailLogLine(records));
}

async function rememberOwnKey(
  projectId: string = RECORDED_PROJECT_ID,
): Promise<void> {
  await OneUptimeAwsSessions.remember({
    projectId,
    connectionId: RECORDED_CONNECTION_ID,
    roleArn: RECORDED_ROLE_ARN,
    purpose: AwsRolePurpose.CloudConnect,
    accessKeyId: RECORDED_SESSION_KEY,
    issuedAtMs: RECORDED_SESSION_ISSUED_MS,
    expiresAtMs: RECORDED_SESSION_EXPIRES_MS,
  });
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the samples are OneUptime's own session", () => {
  test("its session name is the one AwsSts gives the connection", () => {
    expect(getRoleSessionName(RECORDED_CONNECTION_ID)).toBe(
      RECORDED_SESSION_NAME,
    );
  });
});

describe("who signed a call, as CloudTrail records it", () => {
  test("reads every field of a recorded session", () => {
    expect(callerOf(ownRecord())).toEqual({
      type: "AssumedRole",
      arn: `arn:aws:sts::${RECORDED_ACCOUNT_ID}:assumed-role/${RECORDED_ROLE_NAME}/${RECORDED_SESSION_NAME}`,
      accountId: RECORDED_ACCOUNT_ID,
      principalId: `AROA2ONEUPTIMEROLE01:${RECORDED_SESSION_NAME}`,
      accessKeyId: RECORDED_SESSION_KEY,
      issuerArn: RECORDED_ROLE_ARN,
      sourceIdentity: "",
      invokedBy: "",
      onBehalfOf: "",
      webIdentityProvider: "",
    });
  });

  test("reads the same from a security event's attributes as from the record", () => {
    const records: Array<JSONObject> = [
      ownRecord(),
      asSession(ownRecord(), { sourceIdentity: "alice@example.com" }),
      asSession(ownRecord(), { invokedBy: "cloudformation.amazonaws.com" }),
    ];
    const events: Array<NormalizedSecurityEvent> = eventsOf(records);

    expect(events).toHaveLength(records.length);

    events.forEach((event: NormalizedSecurityEvent, index: number) => {
      expect(readAwsCallerSessionOfAttributes(event.attributes)).toEqual(
        callerOf(records[index]!),
      );
    });
  });

  test("reads what the recorded Stratus Red Team session says, every field", () => {
    const refused: JSONObject = readCloudTrailRecording(
      "RecordedRoleSessionRefusals",
    ).find((record: JSONObject): boolean => {
      return Boolean(record["errorCode"]);
    })!;

    expect(callerOf(refused)).toMatchObject({
      type: "AssumedRole",
      accessKeyId: "ASIA2SECONDSIGNINXMP",
      issuerArn:
        "arn:aws:iam::444455556666:role/stratus-red-team-get-usr-data-role",
    });
  });

  test("a record with no userIdentity says nothing", () => {
    expect(readAwsCallerSessionOfRecord({ eventName: "x" })).toMatchObject({
      type: "",
      arn: "",
      accessKeyId: "",
    });
  });

  test("parses a session's ARN, and a role's with its path", () => {
    expect(
      parseAssumedRoleArn(
        "arn:aws-us-gov:sts::123456789012:assumed-role/Reader/OneUptime-abc",
      ),
    ).toEqual({
      partition: "aws-us-gov",
      accountId: "123456789012",
      roleName: "Reader",
      sessionName: "OneUptime-abc",
    });
    expect(parseAssumedRoleArn("arn:aws:iam::123456789012:user/alice")).toBe(
      null,
    );
    expect(
      parseAssumedRoleArn(
        "arn:aws:sts::123456789012:assumed-role/Reader/s/extra",
      ),
    ).toBe(null);
    expect(
      parseRoleArn("arn:aws:iam::123456789012:role/service-role/data/Reader"),
    ).toEqual({
      partition: "aws",
      accountId: "123456789012",
      roleName: "Reader",
    });
    expect(parseRoleArn("arn:aws:iam::123456789012:role/")).toBe(null);
    expect(parseRoleArn("arn:aws:iam::12345:role/Reader")).toBe(null);
  });
});

describe("isOneUptimeAwsSession", () => {
  test("OneUptime's own session, signed with the key AWS handed it: OneUptime's own", () => {
    expect(isOneUptimeAwsSession(callerOf(ownRecord()), REMEMBERED)).toBe(true);
  });

  test("a role named in another case is the same role: IAM holds a name whatever its case", () => {
    expect(
      isOneUptimeAwsSession(callerOf(ownRecord()), {
        ...REMEMBERED,
        roleArn: RECORDED_ROLE_ARN.toLowerCase(),
      }),
    ).toBe(true);
  });

  test.each<[string, JSONObject]>([
    [
      "another session of the same role",
      asSession(ownRecord(), {
        sessionName: "temp-admin",
        accessKeyId: RECORDED_SESSION_KEY,
      }),
    ],
    [
      "the session OneUptime gives another connection",
      asSession(ownRecord(), {
        sessionName: getRoleSessionName(OTHER_CONNECTION_ID),
      }),
    ],
    [
      "OneUptime's session name on another role",
      asSession(ownRecord(), { roleName: "AdminAccess" }),
    ],
    [
      "OneUptime's session name and role in another account",
      asSession(ownRecord(), { accountId: "999988887777" }),
    ],
    [
      "a session that carries a source identity, which OneUptime never sets",
      asSession(ownRecord(), { sourceIdentity: "alice@example.com" }),
    ],
    [
      "a call an AWS service made on the session's behalf",
      asSession(ownRecord(), { invokedBy: "cloudformation.amazonaws.com" }),
    ],
    ["an IAM user", asIamUser(ownRecord(), "alice")],
  ])("%s is not OneUptime's own", (_case: string, record: JSONObject) => {
    expect(isOneUptimeAwsSession(callerOf(record), REMEMBERED)).toBe(false);
  });

  test("a key OneUptime does not remember is not OneUptime's own, whatever the session says", () => {
    expect(isOneUptimeAwsSession(callerOf(ownRecord()), null)).toBe(false);
    expect(isOneUptimeAwsSession(callerOf(ownRecord()), undefined)).toBe(false);
  });

  test("a key OneUptime remembers for another connection's role is not this session's", () => {
    expect(
      isOneUptimeAwsSession(callerOf(ownRecord()), {
        ...REMEMBERED,
        connectionId: OTHER_CONNECTION_ID,
      }),
    ).toBe(false);
    expect(
      isOneUptimeAwsSession(callerOf(ownRecord()), {
        ...REMEMBERED,
        roleArn: `arn:aws:iam::${RECORDED_ACCOUNT_ID}:role/AnotherRole`,
      }),
    ).toBe(false);
  });

  test("what else the record says of the session must agree, where it says it", () => {
    const own: AwsCallerSession = callerOf(ownRecord());

    expect(
      isOneUptimeAwsSession(
        { ...own, principalId: "AROAX:temp-admin" },
        REMEMBERED,
      ),
    ).toBe(false);
    expect(
      isOneUptimeAwsSession(
        {
          ...own,
          issuerArn: `arn:aws:iam::${RECORDED_ACCOUNT_ID}:role/AnotherRole`,
        },
        REMEMBERED,
      ),
    ).toBe(false);
    expect(
      isOneUptimeAwsSession({ ...own, accountId: "999988887777" }, REMEMBERED),
    ).toBe(false);
    expect(
      isOneUptimeAwsSession({ ...own, issuerArn: "not an arn" }, REMEMBERED),
    ).toBe(false);
    // Left out, they say nothing against it.
    expect(
      isOneUptimeAwsSession(
        { ...own, principalId: "", issuerArn: "", accountId: "" },
        REMEMBERED,
      ),
    ).toBe(true);
  });

  test.each<[string, Partial<AwsCallerSession>]>([
    ["no key", { accessKeyId: "" }],
    ["not a role's session", { type: "IAMUser" }],
    ["a person of IAM Identity Center", { onBehalfOf: "a1b2c3d4" }],
    ["a web identity", { webIdentityProvider: "accounts.google.com" }],
    ["an ARN that is not a session's", { arn: RECORDED_ROLE_ARN }],
  ])(
    "%s could not be OneUptime's own",
    (_case: string, change: Partial<AwsCallerSession>) => {
      const caller: AwsCallerSession = { ...callerOf(ownRecord()), ...change };

      expect(couldBeOneUptimeAwsSession(caller)).toBe(false);
      expect(isOneUptimeAwsSession(caller, REMEMBERED)).toBe(false);
    },
  );
});

describe("when the call was made, and what the sign-in was for", () => {
  test("a call made while the session lasted is its own, give or take five minutes of the clocks", () => {
    const own: AwsCallerSession = callerOf(ownRecord());

    for (const at of [
      RECORDED_SESSION_ISSUED_MS,
      RECORDED_SESSION_EXPIRES_MS,
      RECORDED_SESSION_ISSUED_MS - ONEUPTIME_AWS_SESSION_CLOCK_SKEW_MS,
      RECORDED_SESSION_EXPIRES_MS + ONEUPTIME_AWS_SESSION_CLOCK_SKEW_MS,
    ]) {
      expect(isOwnSessionAt(own, REMEMBERED, new Date(at))).toBe(true);
    }

    expect(ONEUPTIME_AWS_SESSION_CLOCK_SKEW_MS).toBe(5 * MINUTE_MS);
  });

  test("a call recorded with the key but made after the session ended keeps the alert: the hours its key is kept never count", () => {
    const own: AwsCallerSession = callerOf(ownRecord());

    for (const at of [
      RECORDED_SESSION_EXPIRES_MS + ONEUPTIME_AWS_SESSION_CLOCK_SKEW_MS + 1,
      RECORDED_SESSION_EXPIRES_MS + HOUR_MS,
      RECORDED_SESSION_EXPIRES_MS + ONEUPTIME_AWS_SESSION_KEPT_AFTER_EXPIRY_MS,
    ]) {
      expect(isOwnSessionAt(own, REMEMBERED, new Date(at))).toBe(false);
    }
  });

  test("a call made before the session was asked for is not its own", () => {
    expect(
      isOwnSessionAt(
        callerOf(ownRecord()),
        REMEMBERED,
        new Date(
          RECORDED_SESSION_ISSUED_MS - ONEUPTIME_AWS_SESSION_CLOCK_SKEW_MS - 1,
        ),
      ),
    ).toBe(false);
  });

  test("a call whose time is not known is not its own", () => {
    const own: AwsCallerSession = callerOf(ownRecord());

    expect(isOwnSessionAt(own, REMEMBERED, null)).toBe(false);
    expect(isOwnSessionAt(own, REMEMBERED, undefined)).toBe(false);
    expect(isOwnSessionAt(own, REMEMBERED, new Date("not a time"))).toBe(false);
    expect(isWithinOneUptimeAwsSession(null, REMEMBERED)).toBe(false);
  });

  test("a key of a project's Amazon SES sign-in is never a connection's session, whatever else matches", () => {
    expect(
      isOneUptimeAwsSession(callerOf(ownRecord()), {
        ...REMEMBERED,
        purpose: AwsRolePurpose.AmazonSes,
      }),
    ).toBe(false);
  });

  test("marked: a record made in the session; left as it was: one timed after it, or with no time", async () => {
    installMemoryGlobalCache();
    await rememberOwnKey();

    const late: JSONObject = {
      ...ownRecord(),
      eventTime: new Date(
        RECORDED_SESSION_EXPIRES_MS + 30 * MINUTE_MS,
      ).toISOString(),
    };
    const timeless: JSONObject = { ...ownRecord() };
    delete timeless["eventTime"];
    const events: Array<NormalizedSecurityEvent> = eventsOf([
      ownRecord(),
      late,
      timeless,
    ]);

    expect(
      await OneUptimeAwsSessions.markSecurityEvents({
        projectId: RECORDED_PROJECT_ID,
        events,
      }),
    ).toBe(1);
    expect(
      events.map((event: NormalizedSecurityEvent): unknown => {
        return event.attributes[ONEUPTIME_ACTOR_ATTRIBUTE];
      }),
    ).toEqual(["oneuptime", undefined, undefined]);
  });
});

describe("a key OneUptime no longer holds keeps the alert", () => {
  test("the shared cache lost it - it restarted - so the call is anyone's", async () => {
    const cache: MemoryGlobalCache = installMemoryGlobalCache();
    await rememberOwnKey();
    cache.values.clear();

    const events: Array<NormalizedSecurityEvent> = eventsOf([ownRecord()]);

    expect(
      await OneUptimeAwsSessions.markSecurityEvents({
        projectId: RECORDED_PROJECT_ID,
        events,
      }),
    ).toBe(0);
  });

  test("another OneUptime handed it out - its own cache, not this one's - so the call is anyone's", async () => {
    // Another installation signed in: what it remembered is in its cache.
    const theirs: MemoryGlobalCache = installMemoryGlobalCache();
    await rememberOwnKey();
    expect(theirs.values.size).toBe(1);
    jest.restoreAllMocks();

    // This OneUptime's cache never held the key.
    installMemoryGlobalCache();

    const events: Array<NormalizedSecurityEvent> = eventsOf([ownRecord()]);

    expect(
      await OneUptimeAwsSessions.markSecurityEvents({
        projectId: RECORDED_PROJECT_ID,
        events,
      }),
    ).toBe(0);
  });

  test("a key past what is kept of it - two hours after its session - is forgotten, so the call is anyone's", async () => {
    const cache: MemoryGlobalCache = installMemoryGlobalCache();
    await rememberOwnKey();

    // What the shared cache does when the key's entry expires.
    cache.values.delete(
      `oneuptime-aws-session-${RECORDED_PROJECT_ID}:${RECORDED_SESSION_KEY}`,
    );

    expect(
      (
        await OneUptimeAwsSessions.recall(RECORDED_PROJECT_ID, [
          RECORDED_SESSION_KEY,
        ])
      ).size,
    ).toBe(0);
  });
});

describe("the keys OneUptime remembers", () => {
  test("a key is remembered for its project, with its connection and role, and recalled", async () => {
    const cache: MemoryGlobalCache = installMemoryGlobalCache();

    await rememberOwnKey();

    expect(Array.from(cache.values.keys())).toEqual([
      `oneuptime-aws-session-${RECORDED_PROJECT_ID}:${RECORDED_SESSION_KEY}`,
    ]);
    expect(
      await OneUptimeAwsSessions.recall(RECORDED_PROJECT_ID, [
        RECORDED_SESSION_KEY,
        "ASIA2ANOTHERSESSION1",
      ]),
    ).toEqual(new Map([[RECORDED_SESSION_KEY, REMEMBERED]]));
  });

  test("another project never recalls it", async () => {
    installMemoryGlobalCache();
    await rememberOwnKey();

    expect(
      (
        await OneUptimeAwsSessions.recall(OTHER_PROJECT_ID, [
          RECORDED_SESSION_KEY,
        ])
      ).size,
    ).toBe(0);
  });

  test("it is kept until two hours after its session ends, and no longer", async () => {
    installMemoryGlobalCache();
    jest.spyOn(Date, "now").mockReturnValue(RECORDED_SESSION_ISSUED_MS);
    const setString: SpyInstance<typeof GlobalCache.setString> = jest.spyOn(
      GlobalCache,
      "setString",
    );

    await rememberOwnKey();

    const options: { expiresInSeconds: number } = setString.mock
      .calls[0]![3] as { expiresInSeconds: number };

    // The hour the session lasts, then two.
    expect(ONEUPTIME_AWS_SESSION_KEPT_AFTER_EXPIRY_MS).toBe(2 * HOUR_MS);
    expect(options.expiresInSeconds).toBe((HOUR_MS + 2 * HOUR_MS) / 1000);
  });

  test("a session remembered after it ended is kept two hours from then", async () => {
    installMemoryGlobalCache();
    jest
      .spyOn(Date, "now")
      .mockReturnValue(RECORDED_SESSION_EXPIRES_MS + 10 * MINUTE_MS);
    const setString: SpyInstance<typeof GlobalCache.setString> = jest.spyOn(
      GlobalCache,
      "setString",
    );

    await rememberOwnKey();

    expect(
      (setString.mock.calls[0]![3] as { expiresInSeconds: number })
        .expiresInSeconds,
    ).toBe((2 * HOUR_MS) / 1000);
  });

  test("a session that says it lasts for years is taken to last no longer than the longest AWS hands out", async () => {
    const cache: MemoryGlobalCache = installMemoryGlobalCache();
    jest.spyOn(Date, "now").mockReturnValue(RECORDED_SESSION_ISSUED_MS);
    const setString: SpyInstance<typeof GlobalCache.setString> = jest.spyOn(
      GlobalCache,
      "setString",
    );

    await OneUptimeAwsSessions.remember({
      projectId: RECORDED_PROJECT_ID,
      connectionId: RECORDED_CONNECTION_ID,
      roleArn: RECORDED_ROLE_ARN,
      purpose: AwsRolePurpose.CloudConnect,
      accessKeyId: RECORDED_SESSION_KEY,
      issuedAtMs: RECORDED_SESSION_ISSUED_MS,
      expiresAtMs: new Date("2099-01-01T00:00:00Z").getTime(),
    });

    expect(
      (setString.mock.calls[0]![3] as { expiresInSeconds: number })
        .expiresInSeconds,
    ).toBe(
      (ONEUPTIME_AWS_SESSION_LONGEST_MS +
        ONEUPTIME_AWS_SESSION_KEPT_AFTER_EXPIRY_MS) /
        1000,
    );
    expect(
      (JSON.parse(Array.from(cache.values.values())[0]!) as JSONObject)[
        "expiresAtMs"
      ],
    ).toBe(RECORDED_SESSION_ISSUED_MS + ONEUPTIME_AWS_SESSION_LONGEST_MS);
  });

  test("only the key's ID is kept: the value holds no secret, token or key", async () => {
    const cache: MemoryGlobalCache = installMemoryGlobalCache();

    await rememberOwnKey();

    expect(Array.from(cache.values.values())).toEqual([
      JSON.stringify({
        connectionId: RECORDED_CONNECTION_ID,
        roleArn: RECORDED_ROLE_ARN,
        purpose: AwsRolePurpose.CloudConnect,
        issuedAtMs: RECORDED_SESSION_ISSUED_MS,
        expiresAtMs: RECORDED_SESSION_EXPIRES_MS,
      }),
    ]);
  });

  test.each<
    [string, Partial<Parameters<typeof OneUptimeAwsSessions.remember>[0]>]
  >([
    ["no key", { accessKeyId: " " }],
    ["no connection", { connectionId: "" }],
    ["no project", { projectId: "" }],
    ["a role ARN that is not one", { roleArn: "OneUptimeReadOnly" }],
    ["no start", { issuedAtMs: NaN }],
    ["no end", { expiresAtMs: NaN }],
    [
      "an end that is not after its start",
      { expiresAtMs: RECORDED_SESSION_ISSUED_MS },
    ],
  ])(
    "nothing is remembered for %s",
    async (
      _case: string,
      change: Partial<Parameters<typeof OneUptimeAwsSessions.remember>[0]>,
    ) => {
      const cache: MemoryGlobalCache = installMemoryGlobalCache();

      await OneUptimeAwsSessions.remember({
        projectId: RECORDED_PROJECT_ID,
        connectionId: RECORDED_CONNECTION_ID,
        roleArn: RECORDED_ROLE_ARN,
        purpose: AwsRolePurpose.CloudConnect,
        accessKeyId: RECORDED_SESSION_KEY,
        issuedAtMs: RECORDED_SESSION_ISSUED_MS,
        expiresAtMs: RECORDED_SESSION_EXPIRES_MS,
        ...change,
      });

      expect(cache.values.size).toBe(0);
    },
  );

  test("a cache that cannot be reached remembers nothing and fails nothing, and recalls nothing", async () => {
    const cache: MemoryGlobalCache = installMemoryGlobalCache();
    cache.failing = true;

    await expect(rememberOwnKey()).resolves.toBeUndefined();
    expect(
      (
        await OneUptimeAwsSessions.recall(RECORDED_PROJECT_ID, [
          RECORDED_SESSION_KEY,
        ])
      ).size,
    ).toBe(0);
  });

  test("a value this file did not write is no key of OneUptime's", async () => {
    const cache: MemoryGlobalCache = installMemoryGlobalCache();
    const key: string = `oneuptime-aws-session-${RECORDED_PROJECT_ID}:${RECORDED_SESSION_KEY}`;

    for (const value of [
      "yes",
      "[]",
      JSON.stringify({ connectionId: RECORDED_CONNECTION_ID }),
      JSON.stringify({ connectionId: "", roleArn: RECORDED_ROLE_ARN }),
      JSON.stringify({ connectionId: 7, roleArn: RECORDED_ROLE_ARN }),
      JSON.stringify({ ...REMEMBERED, roleArn: "x" }),
      // Written before a key said its purpose and its session's life.
      JSON.stringify({
        connectionId: RECORDED_CONNECTION_ID,
        roleArn: RECORDED_ROLE_ARN,
      }),
      JSON.stringify({ ...REMEMBERED, purpose: "something-else" }),
      JSON.stringify({ ...REMEMBERED, issuedAtMs: "yesterday" }),
      JSON.stringify({ ...REMEMBERED, expiresAtMs: null }),
      JSON.stringify({
        ...REMEMBERED,
        expiresAtMs: REMEMBERED.issuedAtMs - 1,
      }),
    ]) {
      cache.values.set(key, value);

      expect(
        (
          await OneUptimeAwsSessions.recall(RECORDED_PROJECT_ID, [
            RECORDED_SESSION_KEY,
          ])
        ).size,
      ).toBe(0);
    }
  });

  test("many keys are asked in batches, each once", async () => {
    installMemoryGlobalCache();
    const getStrings: SpyInstance<typeof GlobalCache.getStrings> = jest.spyOn(
      GlobalCache,
      "getStrings",
    );
    const keys: Array<string> = Array.from(
      { length: 1200 },
      (_value: unknown, index: number): string => {
        return `ASIA2KEY${String(index).padStart(12, "0")}`;
      },
    );

    await OneUptimeAwsSessions.recall(RECORDED_PROJECT_ID, [...keys, ...keys]);

    expect(getStrings).toHaveBeenCalledTimes(3);
    expect(
      getStrings.mock.calls.reduce(
        (total: number, call: [string, Array<string>]): number => {
          return total + call[1].length;
        },
        0,
      ),
    ).toBe(1200);
  });
});

describe("markSecurityEvents", () => {
  test("marks OneUptime's own refused reads as OneUptime's, names the connection, and says so first", async () => {
    installMemoryGlobalCache();
    await rememberOwnKey();

    const events: Array<NormalizedSecurityEvent> = eventsOf(
      readCloudTrailRecording("DataSecurityRefusedReads"),
    );
    const marked: number = await OneUptimeAwsSessions.markSecurityEvents({
      projectId: RECORDED_PROJECT_ID,
      events,
    });

    expect(marked).toBe(25);

    for (const event of events) {
      expect(event.attributes[ONEUPTIME_ACTOR_ATTRIBUTE]).toBe("oneuptime");
      expect(event.attributes[ONEUPTIME_ACTOR_CONNECTION_ATTRIBUTE]).toBe(
        RECORDED_CONNECTION_ID,
      );
      expect(event.message.startsWith("OneUptime's own read: ")).toBe(true);
      // Kept as the refusal it is: still searchable by what AWS said.
      expect(event.statusName).toBe("Failure");
      expect(event.attributes["errorCode"]).toBe("AccessDenied");
    }

    expect(events[0]!.message).toBe(
      `OneUptime's own read: arn:aws:sts::${RECORDED_ACCOUNT_ID}:assumed-role/${RECORDED_ROLE_NAME}/${RECORDED_SESSION_NAME} called GetBucketOwnershipControls on s3.amazonaws.com (AccessDenied)`,
    );
  });

  test("a change in OneUptime's session says change, and a call that says neither says call", async () => {
    installMemoryGlobalCache();
    await rememberOwnKey();

    const write: JSONObject = { ...ownRecord(), readOnly: false };
    const unsaid: JSONObject = { ...ownRecord() };
    delete unsaid["readOnly"];
    const events: Array<NormalizedSecurityEvent> = [
      ...eventsOf([write]),
      ...eventsOf([unsaid]),
    ];

    await OneUptimeAwsSessions.markSecurityEvents({
      projectId: RECORDED_PROJECT_ID,
      events,
    });

    expect(events[0]!.message.startsWith("OneUptime's own change: ")).toBe(
      true,
    );
    expect(events[1]!.message.startsWith("OneUptime's own call: ")).toBe(true);
  });

  test("another session, another principal, an unremembered key: nothing marked", async () => {
    installMemoryGlobalCache();
    await rememberOwnKey();

    const events: Array<NormalizedSecurityEvent> = eventsOf([
      asSession(ownRecord(), {
        sessionName: "temp-admin",
        accessKeyId: "ASIA2ANOTHERSESSION1",
      }),
      asSession(ownRecord(), { accessKeyId: "ASIA2NOTONEUPTIMES01" }),
      asIamUser(ownRecord(), "alice"),
      ...readCloudTrailRecording("RecordedRoleSessionRefusals"),
    ]);
    const messages: Array<string> = events.map(
      (event: NormalizedSecurityEvent): string => {
        return event.message;
      },
    );

    expect(
      await OneUptimeAwsSessions.markSecurityEvents({
        projectId: RECORDED_PROJECT_ID,
        events,
      }),
    ).toBe(0);
    expect(
      events.map((event: NormalizedSecurityEvent): string => {
        return event.message;
      }),
    ).toEqual(messages);

    for (const event of events) {
      expect(event.attributes[ONEUPTIME_ACTOR_ATTRIBUTE]).toBeUndefined();
    }
  });

  test("a record that names itself OneUptime's is not taken at its word, in any format", async () => {
    installMemoryGlobalCache();

    const forged: JSONObject = {
      ...asIamUser(ownRecord(), "mallory"),
      oneuptime: { actor: "oneuptime" },
    };
    const events: Array<NormalizedSecurityEvent> = eventsOf([forged]);

    // The record's own fields are kept as attributes: the forged key arrives with them.
    expect(events[0]!.attributes[ONEUPTIME_ACTOR_ATTRIBUTE]).toBe("oneuptime");

    const other: NormalizedSecurityEvent = {
      ...events[0]!,
      attributes: {
        "oneuptime.log.format": "json",
        [ONEUPTIME_ACTOR_ATTRIBUTE]: "oneuptime",
        [ONEUPTIME_ACTOR_CONNECTION_ATTRIBUTE]: RECORDED_CONNECTION_ID,
      },
    };

    await OneUptimeAwsSessions.markSecurityEvents({
      projectId: RECORDED_PROJECT_ID,
      events: [...events, other],
    });

    expect(events[0]!.attributes[ONEUPTIME_ACTOR_ATTRIBUTE]).toBeUndefined();
    expect(other.attributes[ONEUPTIME_ACTOR_ATTRIBUTE]).toBeUndefined();
    expect(
      other.attributes[ONEUPTIME_ACTOR_CONNECTION_ATTRIBUTE],
    ).toBeUndefined();
  });

  test("a cache that cannot be reached marks nothing: a person is told, as before", async () => {
    const cache: MemoryGlobalCache = installMemoryGlobalCache();
    await rememberOwnKey();
    cache.failing = true;

    const events: Array<NormalizedSecurityEvent> = eventsOf(
      readCloudTrailRecording("DataSecurityRefusedReads"),
    );

    expect(
      await OneUptimeAwsSessions.markSecurityEvents({
        projectId: RECORDED_PROJECT_ID,
        events,
      }),
    ).toBe(0);
  });

  test("another project's OneUptime session in this account is not this project's own", async () => {
    installMemoryGlobalCache();
    await rememberOwnKey(OTHER_PROJECT_ID);

    const events: Array<NormalizedSecurityEvent> = eventsOf([ownRecord()]);

    expect(
      await OneUptimeAwsSessions.markSecurityEvents({
        projectId: RECORDED_PROJECT_ID,
        events,
      }),
    ).toBe(0);
  });

  test("the cache is asked only about calls that could be OneUptime's", async () => {
    installMemoryGlobalCache();
    const getStrings: SpyInstance<typeof GlobalCache.getStrings> = jest.spyOn(
      GlobalCache,
      "getStrings",
    );

    await OneUptimeAwsSessions.markSecurityEvents({
      projectId: RECORDED_PROJECT_ID,
      events: eventsOf([asIamUser(ownRecord(), "alice")]),
    });

    expect(getStrings).not.toHaveBeenCalled();
  });

  test("a record CloudTrailLogParser parses alone is marked the same", async () => {
    installMemoryGlobalCache();
    await rememberOwnKey();

    const events: Array<NormalizedSecurityEvent> = CloudTrailLogParser.parse({
      body: JSON.stringify(ownRecord()),
      attributes: {},
      time: new Date("2026-11-20T10:05:00Z"),
    });

    expect(
      await OneUptimeAwsSessions.markSecurityEvents({
        projectId: RECORDED_PROJECT_ID,
        events,
      }),
    ).toBe(1);
  });
});

describe("findOwnChanges", () => {
  function changeOf(record: JSONObject): CloudChange {
    return {
      kind: "change",
      provider: CloudProvider.AWS,
      accountId: RECORDED_ACCOUNT_ID,
      region: "us-east-1",
      time: CALLED_AT,
      eventId: String(record["eventID"]),
      operation: "rds:ModifyDBSnapshotAttribute",
      actor: RECORDED_SESSION_NAME,
      actorIdentity: callerOf(record).arn,
      actorSession: callerOf(record),
      resources: [],
      failed: false,
    };
  }

  test("a change timed after its session ended is not OneUptime's own, though signed with its key", async () => {
    installMemoryGlobalCache();
    await rememberOwnKey();

    const late: CloudChange = {
      ...changeOf(ownRecord()),
      time: new Date(RECORDED_SESSION_EXPIRES_MS + HOUR_MS),
    };

    expect(
      (
        await OneUptimeAwsSessions.findOwnChanges({
          projectId: RECORDED_PROJECT_ID,
          changes: [late],
        })
      ).size,
    ).toBe(0);
  });

  test("finds the changes made in OneUptime's own session, with the connection and role", async () => {
    installMemoryGlobalCache();
    await rememberOwnKey();

    const own: CloudChange = changeOf(ownRecord());
    const another: CloudChange = changeOf(
      asSession(ownRecord(), {
        sessionName: "temp-admin",
        accessKeyId: "ASIA2ANOTHERSESSION1",
      }),
    );
    const impersonated: CloudChange = changeOf(
      asSession(ownRecord(), { accessKeyId: "ASIA2NOTONEUPTIMES01" }),
    );
    const unsaid: CloudChange = { ...changeOf(ownRecord()) };
    delete unsaid.actorSession;

    const found: Map<CloudChange, OneUptimeAwsSessionKey> =
      await OneUptimeAwsSessions.findOwnChanges({
        projectId: RECORDED_PROJECT_ID,
        changes: [own, another, impersonated, unsaid],
      });

    expect(Array.from(found.entries())).toEqual([[own, REMEMBERED]]);
  });

  test("a health event, or a batch with nothing that could be OneUptime's, asks nothing", async () => {
    installMemoryGlobalCache();
    const getStrings: SpyInstance<typeof GlobalCache.getStrings> = jest.spyOn(
      GlobalCache,
      "getStrings",
    );
    const health: CloudChange = { ...changeOf(ownRecord()), kind: "health" };

    expect(
      (
        await OneUptimeAwsSessions.findOwnChanges({
          projectId: RECORDED_PROJECT_ID,
          changes: [health],
        })
      ).size,
    ).toBe(0);
    expect(getStrings).not.toHaveBeenCalled();
  });
});
