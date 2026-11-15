import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import IncomingRequestSecretService from "../../../../Server/Services/IncomingRequestSecretService";
import ProjectService from "../../../../Server/Services/ProjectService";
import IncomingRequestSecretPolicy, {
  INCOMING_REQUEST_SECRET_MISSING_MESSAGE,
  INCOMING_REQUEST_SECRET_NOT_RECOGNIZED_MESSAGE,
  IncomingRequestSecretDecision,
  IncomingRequestSecretPolicyValue,
  IncomingRequestSecretVerdict,
} from "../../../../Server/Utils/Monitor/IncomingRequestSecretPolicy";
import IncomingRequestSecretRequest from "../../../../Server/Utils/Monitor/IncomingRequestSecretRequest";
import IncomingRequestSecret from "../../../../Models/DatabaseModels/IncomingRequestSecret";
import Project from "../../../../Models/DatabaseModels/Project";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A project's incoming request secret policy (issue #7526): whether its
 * Incoming Request monitors require a secret, which secrets those are, and
 * what one request gets.
 *
 * What matters:
 *   - a project that does not require a secret is never refused anything;
 *   - one that does refuses a request with no secret, or with one that is not
 *     its own, and names which secret a request was accepted with;
 *   - the policy is read from Redis when it is kept there, from Postgres
 *     otherwise, and kept as hashes - never a secret;
 *   - a Redis that fails is a miss, never an error;
 *   - lastUsedAt is stamped at most once a window.
 *
 * Redis is a map that can be made to fail; the two services are stubs.
 */

jest.mock("../../../../Server/Utils/Logger");

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-00000000000a",
);
const SECRET_ID: string = "5ec2e700-0000-4000-8000-000000000001";
const OTHER_SECRET_ID: string = "5ec2e700-0000-4000-8000-000000000002";
const SECRET: string = "4f1c2a9be0d34c6f8a7b5e3d2c1b0a99";
const OTHER_SECRET: string = "0123456789abcdef0123456789abcdef";

const hash: (value: string) => string = (value: string): string => {
  return IncomingRequestSecretRequest.hashSecret(value);
};

const REQUIRED: IncomingRequestSecretPolicyValue = {
  isRequired: true,
  secrets: [
    { secretId: SECRET_ID, secretHash: hash(SECRET) },
    { secretId: OTHER_SECRET_ID, secretHash: hash(OTHER_SECRET) },
  ],
};

let redis: Map<string, string>;
let redisFails: boolean;
let expiries: Array<number | undefined>;
let requireSecret: boolean;
let storedSecrets: Array<{ id: string; secretValue: string }>;

let projectFindOneById: jest.SpiedFunction<typeof ProjectService.findOneById>;
let secretFindBy: jest.SpiedFunction<
  typeof IncomingRequestSecretService.findBy
>;
let secretUpdateOneById: jest.SpiedFunction<
  typeof IncomingRequestSecretService.updateColumnsByIdWithoutHooks
>;

beforeEach(() => {
  redis = new Map<string, string>();
  redisFails = false;
  expiries = [];
  requireSecret = true;
  storedSecrets = [
    { id: SECRET_ID, secretValue: SECRET },
    { id: OTHER_SECRET_ID, secretValue: OTHER_SECRET },
  ];

  jest
    .spyOn(GlobalCache, "getJSONObject")
    .mockImplementation(async (namespace: string, key: string) => {
      if (redisFails) {
        throw new Error("Redis is down");
      }

      const value: string | undefined = redis.get(`${namespace}-${key}`);
      return value ? (JSON.parse(value) as JSONObject) : null;
    });

  jest
    .spyOn(GlobalCache, "setJSON")
    .mockImplementation(
      async (
        namespace: string,
        key: string,
        value: JSONObject,
        options?: { expiresInSeconds?: number | undefined },
      ) => {
        if (redisFails) {
          throw new Error("Redis is down");
        }

        expiries.push(options?.expiresInSeconds);
        redis.set(`${namespace}-${key}`, JSON.stringify(value));
      },
    );

  jest
    .spyOn(GlobalCache, "deleteKey")
    .mockImplementation(async (namespace: string, key: string) => {
      if (redisFails) {
        throw new Error("Redis is down");
      }

      redis.delete(`${namespace}-${key}`);
    });

  jest
    .spyOn(GlobalCache, "setStringIfNotExists")
    .mockImplementation(
      async (namespace: string, key: string, value: string) => {
        if (redisFails) {
          throw new Error("Redis is down");
        }

        const name: string = `${namespace}-${key}`;

        if (redis.has(name)) {
          return false;
        }

        redis.set(name, value);
        return true;
      },
    );

  projectFindOneById = jest
    .spyOn(ProjectService, "findOneById")
    .mockImplementation(async () => {
      const project: Project = new Project();
      project.requireIncomingRequestSecret = requireSecret;
      return project;
    });

  secretFindBy = jest
    .spyOn(IncomingRequestSecretService, "findBy")
    .mockImplementation(async () => {
      return storedSecrets.map(
        (row: { id: string; secretValue: string }): IncomingRequestSecret => {
          const secret: IncomingRequestSecret = new IncomingRequestSecret();
          secret.id = new ObjectID(row.id);
          secret.secretValue = row.secretValue;
          return secret;
        },
      );
    });

  secretUpdateOneById = jest
    .spyOn(IncomingRequestSecretService, "updateColumnsByIdWithoutHooks")
    .mockResolvedValue(undefined as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("decide", () => {
  test("a project that does not require a secret refuses nothing", () => {
    const decision: IncomingRequestSecretDecision =
      IncomingRequestSecretPolicy.decide({
        policy: { isRequired: false, secrets: [] },
        presentedSecretHashes: [],
      });

    expect(decision.verdict).toBe(IncomingRequestSecretVerdict.NotRequired);
    expect(IncomingRequestSecretPolicy.isRefused(decision.verdict)).toBe(false);
  });

  test("a request with no secret is refused as missing", () => {
    for (const presented of [[], undefined]) {
      const decision: IncomingRequestSecretDecision =
        IncomingRequestSecretPolicy.decide({
          policy: REQUIRED,
          presentedSecretHashes: presented,
        });

      expect(decision.verdict).toBe(IncomingRequestSecretVerdict.Missing);
      expect(IncomingRequestSecretPolicy.isRefused(decision.verdict)).toBe(
        true,
      );
    }
  });

  test("a request with a secret that is not the project's is refused as not recognized", () => {
    const decision: IncomingRequestSecretDecision =
      IncomingRequestSecretPolicy.decide({
        policy: REQUIRED,
        presentedSecretHashes: [hash("not-one-of-the-project-secrets")],
      });

    expect(decision.verdict).toBe(IncomingRequestSecretVerdict.NotRecognized);
    expect(IncomingRequestSecretPolicy.isRefused(decision.verdict)).toBe(true);
  });

  test("any one of the project's secrets is accepted, and named", () => {
    const first: IncomingRequestSecretDecision =
      IncomingRequestSecretPolicy.decide({
        policy: REQUIRED,
        presentedSecretHashes: [hash(SECRET)],
      });

    expect(first).toEqual({
      verdict: IncomingRequestSecretVerdict.Accepted,
      matchedSecretId: SECRET_ID,
    });

    const second: IncomingRequestSecretDecision =
      IncomingRequestSecretPolicy.decide({
        policy: REQUIRED,
        presentedSecretHashes: [
          hash("wrong-but-sent-first"),
          hash(OTHER_SECRET),
        ],
      });

    expect(second).toEqual({
      verdict: IncomingRequestSecretVerdict.Accepted,
      matchedSecretId: OTHER_SECRET_ID,
    });
  });

  test("a project that requires a secret and has none refuses every request", () => {
    const decision: IncomingRequestSecretDecision =
      IncomingRequestSecretPolicy.decide({
        policy: { isRequired: true, secrets: [] },
        presentedSecretHashes: [hash(SECRET)],
      });

    expect(IncomingRequestSecretPolicy.isRefused(decision.verdict)).toBe(true);
  });
});

describe("getRefusalMessage", () => {
  test("tells a sender that sent nothing what to send, and where", () => {
    expect(
      IncomingRequestSecretPolicy.getRefusalMessage(
        IncomingRequestSecretVerdict.Missing,
      ),
    ).toBe(INCOMING_REQUEST_SECRET_MISSING_MESSAGE);
    expect(INCOMING_REQUEST_SECRET_MISSING_MESSAGE).toContain(
      "X-OneUptime-Secret",
    );
    expect(INCOMING_REQUEST_SECRET_MISSING_MESSAGE).toContain("Bearer");
  });

  test("tells a sender that sent the wrong secret to check it", () => {
    expect(
      IncomingRequestSecretPolicy.getRefusalMessage(
        IncomingRequestSecretVerdict.NotRecognized,
      ),
    ).toBe(INCOMING_REQUEST_SECRET_NOT_RECOGNIZED_MESSAGE);
  });

  test("both are sentences that never show a secret", () => {
    for (const message of [
      INCOMING_REQUEST_SECRET_MISSING_MESSAGE,
      INCOMING_REQUEST_SECRET_NOT_RECOGNIZED_MESSAGE,
    ]) {
      expect(message).toMatch(/^[A-Z]/);
      expect(message.endsWith(".")).toBe(true);
      expect(message).toContain(
        "Monitors > Settings > Incoming Request Secrets",
      );
    }
  });
});

describe("getPolicy", () => {
  test("reads the policy from Postgres once, and keeps it for a minute as hashes", async () => {
    const policy: IncomingRequestSecretPolicyValue =
      await IncomingRequestSecretPolicy.getPolicy(PROJECT_ID);

    expect(policy).toEqual(REQUIRED);
    expect(projectFindOneById).toHaveBeenCalledTimes(1);
    expect(secretFindBy).toHaveBeenCalledTimes(1);
    expect(expiries).toEqual([IncomingRequestSecretPolicy.EXPIRES_IN_SECONDS]);
    expect(IncomingRequestSecretPolicy.EXPIRES_IN_SECONDS).toBe(60);

    // Nothing kept in Redis is a secret.
    for (const value of redis.values()) {
      expect(value).not.toContain(SECRET);
      expect(value).not.toContain(OTHER_SECRET);
    }

    // The next request is answered from Redis.
    const again: IncomingRequestSecretPolicyValue =
      await IncomingRequestSecretPolicy.getPolicy(PROJECT_ID);

    expect(again).toEqual(REQUIRED);
    expect(projectFindOneById).toHaveBeenCalledTimes(1);
    expect(secretFindBy).toHaveBeenCalledTimes(1);
  });

  test("reads the secrets as OneUptime, never the caller", async () => {
    await IncomingRequestSecretPolicy.getPolicy(PROJECT_ID);

    expect(projectFindOneById.mock.calls[0]![0].props).toEqual({
      isRoot: true,
    });
    expect(secretFindBy.mock.calls[0]![0].props).toEqual({ isRoot: true });
    expect(secretFindBy.mock.calls[0]![0].query).toEqual({
      projectId: PROJECT_ID,
    });
  });

  test("a project that does not require a secret reads no secrets", async () => {
    requireSecret = false;

    const policy: IncomingRequestSecretPolicyValue =
      await IncomingRequestSecretPolicy.getPolicy(PROJECT_ID);

    expect(policy).toEqual({ isRequired: false, secrets: [] });
    expect(secretFindBy).not.toHaveBeenCalled();
  });

  test("a secret with no value is left out of the policy", async () => {
    storedSecrets = [
      { id: SECRET_ID, secretValue: SECRET },
      { id: OTHER_SECRET_ID, secretValue: "   " },
    ];

    const policy: IncomingRequestSecretPolicyValue =
      await IncomingRequestSecretPolicy.getPolicy(PROJECT_ID);

    expect(policy.secrets).toEqual([
      { secretId: SECRET_ID, secretHash: hash(SECRET) },
    ]);
  });

  test("a Redis that fails is a miss: the policy comes from Postgres", async () => {
    redisFails = true;

    const policy: IncomingRequestSecretPolicyValue =
      await IncomingRequestSecretPolicy.getPolicy(PROJECT_ID);

    expect(policy).toEqual(REQUIRED);
    expect(projectFindOneById).toHaveBeenCalledTimes(1);
  });

  test("something kept that is not a policy is read again from Postgres", async () => {
    redis.set(
      `${IncomingRequestSecretPolicy.NAMESPACE}-${PROJECT_ID.toString()}`,
      JSON.stringify({ isRequired: "yes", secrets: "all of them" }),
    );

    const policy: IncomingRequestSecretPolicyValue =
      await IncomingRequestSecretPolicy.getPolicy(PROJECT_ID);

    expect(policy).toEqual(REQUIRED);
    expect(projectFindOneById).toHaveBeenCalledTimes(1);
  });

  test("a failed read of Postgres fails the call, so the job is retried", async () => {
    projectFindOneById.mockRejectedValueOnce(new Error("Postgres is down"));

    await expect(
      IncomingRequestSecretPolicy.getPolicy(PROJECT_ID),
    ).rejects.toThrow("Postgres is down");
  });
});

describe("forget", () => {
  test("drops the kept policy, so the next request reads the change", async () => {
    await IncomingRequestSecretPolicy.getPolicy(PROJECT_ID);

    requireSecret = false;
    await IncomingRequestSecretPolicy.forget(PROJECT_ID);

    const policy: IncomingRequestSecretPolicyValue =
      await IncomingRequestSecretPolicy.getPolicy(PROJECT_ID);

    expect(policy.isRequired).toBe(false);
    expect(projectFindOneById).toHaveBeenCalledTimes(2);
  });

  test("never throws when Redis cannot be told", async () => {
    redisFails = true;

    await expect(
      IncomingRequestSecretPolicy.forget(PROJECT_ID.toString()),
    ).resolves.toBeUndefined();
  });
});

describe("recordUse", () => {
  test("stamps lastUsedAt the first time in a window, as OneUptime", async () => {
    await IncomingRequestSecretPolicy.recordUse(SECRET_ID);

    expect(secretUpdateOneById).toHaveBeenCalledTimes(1);

    const call: Parameters<
      typeof IncomingRequestSecretService.updateColumnsByIdWithoutHooks
    >[0] = secretUpdateOneById.mock.calls[0]![0];

    expect(call.id.toString()).toBe(SECRET_ID);
    expect(call.data.lastUsedAt).toBeInstanceOf(Date);
    // A stamp, not a change: updatedAt stays as the secret's owner left it.
    expect(call.skipUpdateDateColumn).toBe(true);
  });

  test("does not stamp it again within the window", async () => {
    await IncomingRequestSecretPolicy.recordUse(SECRET_ID);
    await IncomingRequestSecretPolicy.recordUse(SECRET_ID);
    await IncomingRequestSecretPolicy.recordUse(SECRET_ID);

    expect(secretUpdateOneById).toHaveBeenCalledTimes(1);

    // Another secret has a window of its own.
    await IncomingRequestSecretPolicy.recordUse(OTHER_SECRET_ID);
    expect(secretUpdateOneById).toHaveBeenCalledTimes(2);
  });

  test("ignores a missing or malformed id", async () => {
    await IncomingRequestSecretPolicy.recordUse(undefined);
    await IncomingRequestSecretPolicy.recordUse("not-an-id");

    expect(secretUpdateOneById).not.toHaveBeenCalled();
  });

  test("never throws: a failed stamp never fails an accepted request", async () => {
    secretUpdateOneById.mockRejectedValueOnce(new Error("Postgres is down"));

    await expect(
      IncomingRequestSecretPolicy.recordUse(SECRET_ID),
    ).resolves.toBeUndefined();

    redisFails = true;

    await expect(
      IncomingRequestSecretPolicy.recordUse(OTHER_SECRET_ID),
    ).resolves.toBeUndefined();
  });
});
