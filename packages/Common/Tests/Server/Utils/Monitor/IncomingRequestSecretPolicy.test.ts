import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import IncomingRequestSecretService from "../../../../Server/Services/IncomingRequestSecretService";
import ProjectService from "../../../../Server/Services/ProjectService";
import IncomingRequestSecretPolicy, {
  INCOMING_REQUEST_SECRET_MISSING_MESSAGE,
  INCOMING_REQUEST_SECRET_NOT_RECOGNIZED_MESSAGE,
  INCOMING_REQUEST_SIGNATURE_EXPIRED_MESSAGE,
  INCOMING_REQUEST_SIGNATURE_REPLAYED_MESSAGE,
  IncomingRequestSecretDecision,
  IncomingRequestSecretMonitor,
  IncomingRequestSecretOfPolicy,
  IncomingRequestSecretPolicyValue,
  IncomingRequestSecretVerdict,
} from "../../../../Server/Utils/Monitor/IncomingRequestSecretPolicy";
import IncomingRequestSecretRequest from "../../../../Server/Utils/Monitor/IncomingRequestSecretRequest";
import IncomingRequestSecret from "../../../../Models/DatabaseModels/IncomingRequestSecret";
import Label from "../../../../Models/DatabaseModels/Label";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import Project from "../../../../Models/DatabaseModels/Project";
import { JSONObject } from "../../../../Types/JSON";
import { IncomingRequestSecretProblem } from "../../../../Types/Monitor/IncomingMonitor/IncomingRequestSecret";
import MonitorSecretAccess from "../../../../Types/Monitor/MonitorSecretAccess";
import ObjectID from "../../../../Types/ObjectID";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { SpyInstance } from "jest-mock";

/*
 * A project's incoming request secret policy (issue #7526): whether its
 * Incoming Request monitors require a secret, which secrets those are, and
 * what one request gets.
 *
 * What matters:
 *   - a project that does not require a secret is never refused anything;
 *   - one that does refuses a request with no secret, or with one that is not
 *     its own, and names which secret a request was accepted with;
 *   - either way, while the project has a secret, the decision says whether
 *     the request sent one of them and, if not, why - so a monitor's senders
 *     that do not send one yet are known before the requirement is on
 *     (issue #8498) - and the policy carries the secrets to check that;
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

// A secret as the policy keeps it: every monitor's, unless limited.
const ofPolicy: (
  secretId: string,
  value: string,
  access?: Partial<IncomingRequestSecretOfPolicy>,
) => IncomingRequestSecretOfPolicy = (
  secretId: string,
  value: string,
  access?: Partial<IncomingRequestSecretOfPolicy>,
): IncomingRequestSecretOfPolicy => {
  return {
    secretId,
    secretHash: hash(value),
    monitorAccess: MonitorSecretAccess.AllMonitors,
    monitorIds: [],
    labelIds: [],
    ...(access || {}),
  };
};

const REQUIRED: IncomingRequestSecretPolicyValue = {
  isRequired: true,
  secrets: [
    ofPolicy(SECRET_ID, SECRET),
    ofPolicy(OTHER_SECRET_ID, OTHER_SECRET),
  ],
};

let redis: Map<string, string>;
let redisFails: boolean;
let expiries: Array<number | undefined>;
let requireSecret: boolean;
let storedSecrets: Array<{ id: string; secretValue: string }>;

let projectFindOneById: SpyInstance<typeof ProjectService.findOneById>;
let secretFindBy: SpyInstance<typeof IncomingRequestSecretService.findBy>;
let secretUpdateOneById: SpyInstance<
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
      sentValidSecret: true,
      wrongSecretHashes: [],
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
      sentValidSecret: true,
      // A right one among them: nothing is counted as a guess.
      wrongSecretHashes: [],
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

describe("decide, for a monitor's record of requests with and without a secret", () => {
  const NOT_REQUIRED: IncomingRequestSecretPolicyValue = {
    isRequired: false,
    secrets: REQUIRED.secrets,
  };

  test("before the project requires a secret, a request without one is accepted, and said to have none", () => {
    for (const presented of [[], undefined]) {
      const decision: IncomingRequestSecretDecision =
        IncomingRequestSecretPolicy.decide({
          policy: NOT_REQUIRED,
          presentedSecretHashes: presented,
        });

      expect(decision).toEqual({
        verdict: IncomingRequestSecretVerdict.NotRequired,
        sentValidSecret: false,
        problem: IncomingRequestSecretProblem.NoSecret,
        wrongSecretHashes: [],
      });
      expect(IncomingRequestSecretPolicy.isRefused(decision.verdict)).toBe(
        false,
      );
    }
  });

  test("before the project requires a secret, a wrong one is accepted, and said to be wrong", () => {
    const decision: IncomingRequestSecretDecision =
      IncomingRequestSecretPolicy.decide({
        policy: NOT_REQUIRED,
        presentedSecretHashes: [hash("an-old-secret-of-the-sender")],
      });

    expect(decision).toEqual({
      verdict: IncomingRequestSecretVerdict.NotRequired,
      sentValidSecret: false,
      problem: IncomingRequestSecretProblem.WrongSecret,
      // Nothing is refused, so nothing is counted as a guess.
      wrongSecretHashes: [],
    });
    expect(decision.matchedSecretId).toBeUndefined();
  });

  test("before the project requires a secret, one of its secrets is named, so its Last Used moves and a Bearer token is masked", () => {
    const decision: IncomingRequestSecretDecision =
      IncomingRequestSecretPolicy.decide({
        policy: NOT_REQUIRED,
        presentedSecretHashes: [hash(OTHER_SECRET)],
      });

    expect(decision).toEqual({
      verdict: IncomingRequestSecretVerdict.NotRequired,
      matchedSecretId: OTHER_SECRET_ID,
      sentValidSecret: true,
      wrongSecretHashes: [],
    });
    expect(decision.problem).toBeUndefined();
  });

  test("a project with no secret says nothing either way: there is nothing to have sent", () => {
    for (const presented of [[], [hash(SECRET)]]) {
      const decision: IncomingRequestSecretDecision =
        IncomingRequestSecretPolicy.decide({
          policy: { isRequired: false, secrets: [] },
          presentedSecretHashes: presented,
        });

      expect(decision.sentValidSecret).toBeUndefined();
      expect(decision.problem).toBeUndefined();
      expect(decision.matchedSecretId).toBeUndefined();
    }
  });

  test("a refused request says why: none sent, or a wrong one", () => {
    expect(
      IncomingRequestSecretPolicy.decide({
        policy: REQUIRED,
        presentedSecretHashes: [],
      }),
    ).toEqual({
      verdict: IncomingRequestSecretVerdict.Missing,
      sentValidSecret: false,
      problem: IncomingRequestSecretProblem.NoSecret,
      wrongSecretHashes: [],
    });

    expect(
      IncomingRequestSecretPolicy.decide({
        policy: REQUIRED,
        presentedSecretHashes: [hash("not-one-of-the-project-secrets")],
      }),
    ).toEqual({
      verdict: IncomingRequestSecretVerdict.NotRecognized,
      sentValidSecret: false,
      problem: IncomingRequestSecretProblem.WrongSecret,
      // The wrong secret is what a guess counts as (issue #8499).
      wrongSecretHashes: [hash("not-one-of-the-project-secrets")],
    });
  });
});

/*
 * A secret limited to some monitors (issue #8501): accepted by the monitors
 * it covers, refused by every other as if it were wrong, and recorded as one
 * of the project's that the monitor does not accept.
 */
describe("decide, for a secret limited to some monitors", () => {
  const MONITOR_A: string = "a0000000-0000-4000-8000-00000000000a";
  const MONITOR_B: string = "b0000000-0000-4000-8000-00000000000b";
  const LABEL_TENANT_A: string = "1abe1000-0000-4000-8000-00000000000a";
  const LABEL_TENANT_B: string = "1abe1000-0000-4000-8000-00000000000b";
  const TENANT_A_SECRET: string = "tenant-a-secret-of-its-own-0001";
  const TENANT_B_SECRET: string = "tenant-b-secret-of-its-own-0002";
  const TENANT_A_ID: string = "5ec2e700-0000-4000-8000-0000000000aa";
  const TENANT_B_ID: string = "5ec2e700-0000-4000-8000-0000000000bb";

  const monitorA: IncomingRequestSecretMonitor = {
    monitorId: MONITOR_A,
    labelIds: [LABEL_TENANT_A],
  };

  const monitorB: IncomingRequestSecretMonitor = {
    monitorId: MONITOR_B,
    labelIds: [LABEL_TENANT_B],
  };

  const BY_MONITOR: IncomingRequestSecretPolicyValue = {
    isRequired: true,
    secrets: [
      ofPolicy(TENANT_A_ID, TENANT_A_SECRET, {
        monitorAccess: MonitorSecretAccess.SpecificMonitors,
        monitorIds: [MONITOR_A],
      }),
      ofPolicy(TENANT_B_ID, TENANT_B_SECRET, {
        monitorAccess: MonitorSecretAccess.SpecificMonitors,
        monitorIds: [MONITOR_B],
      }),
    ],
  };

  const BY_LABEL: IncomingRequestSecretPolicyValue = {
    isRequired: true,
    secrets: [
      ofPolicy(TENANT_A_ID, TENANT_A_SECRET, {
        monitorAccess: MonitorSecretAccess.MonitorsWithLabels,
        labelIds: [LABEL_TENANT_A],
      }),
      ofPolicy(TENANT_B_ID, TENANT_B_SECRET, {
        monitorAccess: MonitorSecretAccess.MonitorsWithLabels,
        labelIds: [LABEL_TENANT_B],
      }),
    ],
  };

  test.each([
    ["listed monitors", BY_MONITOR],
    ["labels", BY_LABEL],
  ])(
    "a secret limited by %s is accepted by the monitor it covers",
    (_name: string, policy: IncomingRequestSecretPolicyValue) => {
      expect(
        IncomingRequestSecretPolicy.decide({
          policy,
          presentedSecretHashes: [hash(TENANT_A_SECRET)],
          monitor: monitorA,
        }),
      ).toEqual({
        verdict: IncomingRequestSecretVerdict.Accepted,
        matchedSecretId: TENANT_A_ID,
        sentValidSecret: true,
        wrongSecretHashes: [],
      });
    },
  );

  test.each([
    ["listed monitors", BY_MONITOR],
    ["labels", BY_LABEL],
  ])(
    "tenant A's secret limited by %s is refused by tenant B's monitor, as a wrong one, and recorded as not for it",
    (_name: string, policy: IncomingRequestSecretPolicyValue) => {
      const decision: IncomingRequestSecretDecision =
        IncomingRequestSecretPolicy.decide({
          policy,
          presentedSecretHashes: [hash(TENANT_A_SECRET)],
          monitor: monitorB,
        });

      expect(decision).toEqual({
        verdict: IncomingRequestSecretVerdict.NotRecognized,
        sentValidSecret: false,
        problem: IncomingRequestSecretProblem.SecretNotForMonitor,
        wrongSecretHashes: [hash(TENANT_A_SECRET)],
      });
      expect(decision.matchedSecretId).toBeUndefined();

      // The sender is told it is not one the monitor accepts - not that it is the project's.
      expect(
        IncomingRequestSecretPolicy.getRefusalMessage(
          decision.verdict,
          decision.problem,
        ),
      ).toBe(INCOMING_REQUEST_SECRET_NOT_RECOGNIZED_MESSAGE);
    },
  );

  test("a secret for another monitor sent beside the right one is accepted with the right one", () => {
    expect(
      IncomingRequestSecretPolicy.decide({
        policy: BY_MONITOR,
        presentedSecretHashes: [hash(TENANT_A_SECRET), hash(TENANT_B_SECRET)],
        monitor: monitorB,
      }),
    ).toEqual({
      verdict: IncomingRequestSecretVerdict.Accepted,
      matchedSecretId: TENANT_B_ID,
      sentValidSecret: true,
      wrongSecretHashes: [],
    });
  });

  test("a secret for every monitor is accepted by both, beside the limited ones", () => {
    const policy: IncomingRequestSecretPolicyValue = {
      isRequired: true,
      secrets: [...BY_MONITOR.secrets, ofPolicy(SECRET_ID, SECRET)],
    };

    for (const monitor of [monitorA, monitorB]) {
      expect(
        IncomingRequestSecretPolicy.decide({
          policy,
          presentedSecretHashes: [hash(SECRET)],
          monitor,
        }).verdict,
      ).toBe(IncomingRequestSecretVerdict.Accepted);
    }
  });

  test("a limited secret's other list grants nothing: a label-scoped secret that lists monitors covers only by its labels", () => {
    const policy: IncomingRequestSecretPolicyValue = {
      isRequired: true,
      secrets: [
        ofPolicy(TENANT_A_ID, TENANT_A_SECRET, {
          monitorAccess: MonitorSecretAccess.MonitorsWithLabels,
          labelIds: [LABEL_TENANT_A],
          monitorIds: [MONITOR_B],
        }),
      ],
    };

    expect(
      IncomingRequestSecretPolicy.decide({
        policy,
        presentedSecretHashes: [hash(TENANT_A_SECRET)],
        monitor: monitorB,
      }).problem,
    ).toBe(IncomingRequestSecretProblem.SecretNotForMonitor);
  });

  test("before the project requires a secret, a secret for another monitor is accepted but recorded as not for this one", () => {
    expect(
      IncomingRequestSecretPolicy.decide({
        policy: { ...BY_MONITOR, isRequired: false },
        presentedSecretHashes: [hash(TENANT_A_SECRET)],
        monitor: monitorB,
      }),
    ).toEqual({
      verdict: IncomingRequestSecretVerdict.NotRequired,
      sentValidSecret: false,
      problem: IncomingRequestSecretProblem.SecretNotForMonitor,
      wrongSecretHashes: [],
    });
  });

  test("a request whose monitor is unknown is covered only by secrets for every monitor", () => {
    expect(
      IncomingRequestSecretPolicy.decide({
        policy: BY_MONITOR,
        presentedSecretHashes: [hash(TENANT_A_SECRET)],
      }).verdict,
    ).toBe(IncomingRequestSecretVerdict.NotRecognized);
  });

  test("a policy kept before #8501, with no access on its secrets, covers every monitor", () => {
    expect(
      IncomingRequestSecretPolicy.decide({
        policy: {
          isRequired: true,
          secrets: [{ secretId: SECRET_ID, secretHash: hash(SECRET) }],
        },
        presentedSecretHashes: [hash(SECRET)],
        monitor: monitorB,
      }).verdict,
    ).toBe(IncomingRequestSecretVerdict.Accepted);
  });

  test("knows when a monitor's labels are needed", () => {
    expect(IncomingRequestSecretPolicy.hasLabelScopedSecret(BY_LABEL)).toBe(
      true,
    );
    expect(IncomingRequestSecretPolicy.hasLabelScopedSecret(BY_MONITOR)).toBe(
      false,
    );
    expect(IncomingRequestSecretPolicy.hasLabelScopedSecret(REQUIRED)).toBe(
      false,
    );
  });
});

describe("decide, for a signature that was not accepted (issue #8500)", () => {
  test("an expired signature, and nothing else, is refused as expired", () => {
    const decision: IncomingRequestSecretDecision =
      IncomingRequestSecretPolicy.decide({
        policy: REQUIRED,
        presentedSecretHashes: [],
        signatureProblem: IncomingRequestSecretProblem.ExpiredSignature,
      });

    expect(decision).toEqual({
      verdict: IncomingRequestSecretVerdict.NotRecognized,
      sentValidSecret: false,
      problem: IncomingRequestSecretProblem.ExpiredSignature,
      // Nothing was checked, so nothing was guessed.
      wrongSecretHashes: [],
    });
    expect(
      IncomingRequestSecretPolicy.getRefusalMessage(
        decision.verdict,
        decision.problem,
      ),
    ).toBe(INCOMING_REQUEST_SIGNATURE_EXPIRED_MESSAGE);
  });

  test("an expired signature beside a right secret in a header is accepted on the header", () => {
    expect(
      IncomingRequestSecretPolicy.decide({
        policy: REQUIRED,
        presentedSecretHashes: [hash(SECRET)],
        signatureProblem: IncomingRequestSecretProblem.ExpiredSignature,
      }).verdict,
    ).toBe(IncomingRequestSecretVerdict.Accepted);
  });

  test("the expired and replayed refusals say what to do, and name no secret", () => {
    for (const message of [
      INCOMING_REQUEST_SIGNATURE_EXPIRED_MESSAGE,
      INCOMING_REQUEST_SIGNATURE_REPLAYED_MESSAGE,
    ]) {
      expect(message).toMatch(/^[A-Z]/);
      expect(message.endsWith(".")).toBe(true);
      expect(message).toContain("Sign each request");
    }

    expect(INCOMING_REQUEST_SIGNATURE_EXPIRED_MESSAGE).toContain("5 minutes");
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

  test("a project that does not require a secret yet still reads its secrets, to tell who sends one", async () => {
    requireSecret = false;

    const policy: IncomingRequestSecretPolicyValue =
      await IncomingRequestSecretPolicy.getPolicy(PROJECT_ID);

    expect(policy).toEqual({ isRequired: false, secrets: REQUIRED.secrets });
    expect(secretFindBy).toHaveBeenCalledTimes(1);
  });

  test("a project that is gone requires nothing and has no secrets", async () => {
    projectFindOneById.mockResolvedValueOnce(null);

    const policy: IncomingRequestSecretPolicyValue =
      await IncomingRequestSecretPolicy.getPolicy(PROJECT_ID);

    expect(policy).toEqual({ isRequired: false, secrets: [] });
    expect(secretFindBy).not.toHaveBeenCalled();
  });

  test("keeps the policy under a namespace of its own, not one a server from before #8501 wrote without the monitors each secret covers", () => {
    expect(IncomingRequestSecretPolicy.NAMESPACE).toBe(
      "incoming-request-secret-policy-v3",
    );
  });

  test("reads which monitors each secret covers, and keeps only the list its mode reads", async () => {
    const monitorId: string = "a0000000-0000-4000-8000-00000000000a";
    const labelId: string = "1abe1000-0000-4000-8000-00000000000a";

    secretFindBy.mockImplementationOnce(async () => {
      const bySpecific: IncomingRequestSecret = new IncomingRequestSecret();
      bySpecific.id = new ObjectID(SECRET_ID);
      bySpecific.secretValue = SECRET;
      bySpecific.monitorAccess = MonitorSecretAccess.SpecificMonitors;
      bySpecific.monitors = [new Monitor(new ObjectID(monitorId))];
      // A list its mode does not read: it must grant nothing.
      bySpecific.labels = [new Label(new ObjectID(labelId))];

      const byLabel: IncomingRequestSecret = new IncomingRequestSecret();
      byLabel.id = new ObjectID(OTHER_SECRET_ID);
      byLabel.secretValue = OTHER_SECRET;
      byLabel.monitorAccess = MonitorSecretAccess.MonitorsWithLabels;
      byLabel.labels = [new Label(new ObjectID(labelId))];

      return [bySpecific, byLabel];
    });

    const policy: IncomingRequestSecretPolicyValue =
      await IncomingRequestSecretPolicy.getPolicy(PROJECT_ID);

    expect(policy.secrets).toEqual([
      ofPolicy(SECRET_ID, SECRET, {
        monitorAccess: MonitorSecretAccess.SpecificMonitors,
        monitorIds: [monitorId],
        labelIds: [],
      }),
      ofPolicy(OTHER_SECRET_ID, OTHER_SECRET, {
        monitorAccess: MonitorSecretAccess.MonitorsWithLabels,
        monitorIds: [],
        labelIds: [labelId],
      }),
    ]);

    // The secrets' lists are read with them, as OneUptime.
    expect(secretFindBy.mock.calls[0]![0].select).toEqual(
      expect.objectContaining({
        monitorAccess: true,
        monitors: { _id: true },
        labels: { _id: true },
      }),
    );

    // Kept and read back from Redis the same.
    expect(await IncomingRequestSecretPolicy.getPolicy(PROJECT_ID)).toEqual(
      policy,
    );
    expect(secretFindBy).toHaveBeenCalledTimes(1);
  });

  test("a secret with no mode read covers every monitor", async () => {
    const policy: IncomingRequestSecretPolicyValue =
      await IncomingRequestSecretPolicy.getPolicy(PROJECT_ID);

    for (const secret of policy.secrets) {
      expect(secret.monitorAccess).toBe(MonitorSecretAccess.AllMonitors);
    }
  });

  test("a policy kept in the old shape, with no access on its secrets, is read again from Postgres", async () => {
    redis.set(
      `${IncomingRequestSecretPolicy.NAMESPACE}-${PROJECT_ID.toString()}`,
      JSON.stringify({
        isRequired: true,
        secrets: [{ secretId: SECRET_ID, secretHash: hash(SECRET) }],
      }),
    );

    const policy: IncomingRequestSecretPolicyValue =
      await IncomingRequestSecretPolicy.getPolicy(PROJECT_ID);

    expect(policy).toEqual(REQUIRED);
    expect(secretFindBy).toHaveBeenCalledTimes(1);
  });

  test("a secret with no value is left out of the policy", async () => {
    storedSecrets = [
      { id: SECRET_ID, secretValue: SECRET },
      { id: OTHER_SECRET_ID, secretValue: "   " },
    ];

    const policy: IncomingRequestSecretPolicyValue =
      await IncomingRequestSecretPolicy.getPolicy(PROJECT_ID);

    expect(policy.secrets).toEqual([ofPolicy(SECRET_ID, SECRET)]);
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
