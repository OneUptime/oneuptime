import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import IncomingRequestSecretService from "../../../../Server/Services/IncomingRequestSecretService";
import MonitorService from "../../../../Server/Services/MonitorService";
import IncomingRequestMonitorLabels from "../../../../Server/Utils/Monitor/IncomingRequestMonitorLabels";
import {
  IncomingRequestSecretOfPolicy,
  IncomingRequestSecretPolicyValue,
} from "../../../../Server/Utils/Monitor/IncomingRequestSecretPolicy";
import IncomingRequestSecretRequest from "../../../../Server/Utils/Monitor/IncomingRequestSecretRequest";
import IncomingRequestSecretValues from "../../../../Server/Utils/Monitor/IncomingRequestSecretValues";
import { SigningSecret } from "../../../../Server/Utils/Monitor/IncomingRequestSignature";
import IncomingRequestSecret from "../../../../Models/DatabaseModels/IncomingRequestSecret";
import Label from "../../../../Models/DatabaseModels/Label";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
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
 * What a signature is checked with (issue #8500): the values of the
 * project's incoming request secrets, read from Postgres and kept in this
 * process alone, for a minute at most, and answered only for the secrets the
 * policy lists, with the hash it has for them. And a monitor's labels, read
 * only for a label-scoped secret (issue #8501), kept a minute.
 */

jest.mock("../../../../Server/Utils/Logger");

const PROJECT_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-00000000000a",
);
const SECRET_ID: string = "5ec2e700-0000-4000-8000-000000000001";
const NEW_SECRET_ID: string = "5ec2e700-0000-4000-8000-000000000002";
const SECRET: string = "4f1c2a9be0d34c6f8a7b5e3d2c1b0a99";
const NEW_SECRET: string = "0123456789abcdef0123456789abcdef";

const ofPolicy: (id: string, value: string) => IncomingRequestSecretOfPolicy = (
  id: string,
  value: string,
): IncomingRequestSecretOfPolicy => {
  return {
    secretId: id,
    secretHash: IncomingRequestSecretRequest.hashSecret(value),
  };
};

describe("IncomingRequestSecretValues", () => {
  let stored: Array<{ id: string; value: string }>;
  let findBy: SpyInstance<typeof IncomingRequestSecretService.findBy>;
  let cacheWrites: Array<SpyInstance<() => Promise<void>>>;

  beforeEach(() => {
    IncomingRequestSecretValues.forgetAll();
    stored = [{ id: SECRET_ID, value: SECRET }];

    findBy = jest
      .spyOn(IncomingRequestSecretService, "findBy")
      .mockImplementation(async () => {
        return stored.map(
          (row: { id: string; value: string }): IncomingRequestSecret => {
            const secret: IncomingRequestSecret = new IncomingRequestSecret();
            secret.id = new ObjectID(row.id);
            secret.secretValue = row.value;
            return secret;
          },
        );
      });

    cacheWrites = [
      jest.spyOn(GlobalCache, "setString").mockResolvedValue(undefined),
      jest.spyOn(GlobalCache, "setJSON").mockResolvedValue(undefined),
    ] as unknown as Array<SpyInstance<() => Promise<void>>>;
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  const policyOf: (
    secrets: Array<IncomingRequestSecretOfPolicy>,
  ) => IncomingRequestSecretPolicyValue = (
    secrets: Array<IncomingRequestSecretOfPolicy>,
  ): IncomingRequestSecretPolicyValue => {
    return { isRequired: true, secrets };
  };

  test("reads the values once, as OneUptime, and keeps them in this process alone", async () => {
    const policy: IncomingRequestSecretPolicyValue = policyOf([
      ofPolicy(SECRET_ID, SECRET),
    ]);

    for (let index: number = 0; index < 5; index++) {
      expect(
        await IncomingRequestSecretValues.getSigningSecrets({
          projectId: PROJECT_ID,
          policy,
        }),
      ).toEqual([{ secretId: SECRET_ID, value: SECRET }]);
    }

    expect(findBy).toHaveBeenCalledTimes(1);
    expect(findBy.mock.calls[0]![0].props).toEqual({ isRoot: true });
    expect(findBy.mock.calls[0]![0].select).toEqual({
      _id: true,
      secretValue: true,
    });

    // Never in Redis.
    for (const write of cacheWrites) {
      expect(write).not.toHaveBeenCalled();
    }
  });

  test("a secret created since is read on the first request that needs it", async () => {
    await IncomingRequestSecretValues.getSigningSecrets({
      projectId: PROJECT_ID,
      policy: policyOf([ofPolicy(SECRET_ID, SECRET)]),
    });

    stored.push({ id: NEW_SECRET_ID, value: NEW_SECRET });

    const secrets: Array<SigningSecret> =
      await IncomingRequestSecretValues.getSigningSecrets({
        projectId: PROJECT_ID,
        policy: policyOf([
          ofPolicy(SECRET_ID, SECRET),
          ofPolicy(NEW_SECRET_ID, NEW_SECRET),
        ]),
      });

    expect(secrets).toEqual([
      { secretId: SECRET_ID, value: SECRET },
      { secretId: NEW_SECRET_ID, value: NEW_SECRET },
    ]);
    expect(findBy).toHaveBeenCalledTimes(2);
  });

  test("a secret deleted is gone the moment the policy no longer lists it", async () => {
    stored.push({ id: NEW_SECRET_ID, value: NEW_SECRET });

    await IncomingRequestSecretValues.getSigningSecrets({
      projectId: PROJECT_ID,
      policy: policyOf([
        ofPolicy(SECRET_ID, SECRET),
        ofPolicy(NEW_SECRET_ID, NEW_SECRET),
      ]),
    });

    expect(
      await IncomingRequestSecretValues.getSigningSecrets({
        projectId: PROJECT_ID,
        policy: policyOf([ofPolicy(NEW_SECRET_ID, NEW_SECRET)]),
      }),
    ).toEqual([{ secretId: NEW_SECRET_ID, value: NEW_SECRET }]);
  });

  test("a value whose hash is not the policy's is never answered", async () => {
    stored = [{ id: SECRET_ID, value: "a-value-the-policy-does-not-know" }];

    expect(
      await IncomingRequestSecretValues.getSigningSecrets({
        projectId: PROJECT_ID,
        policy: policyOf([ofPolicy(SECRET_ID, SECRET)]),
      }),
    ).toEqual([]);
  });

  test("is read again after a minute", async () => {
    const now: SpyInstance<() => number> = jest.spyOn(Date, "now");
    now.mockReturnValue(1_000_000);

    const policy: IncomingRequestSecretPolicyValue = policyOf([
      ofPolicy(SECRET_ID, SECRET),
    ]);

    await IncomingRequestSecretValues.getSigningSecrets({
      projectId: PROJECT_ID,
      policy,
    });

    now.mockReturnValue(
      1_000_000 + IncomingRequestSecretValues.KEEP_FOR_MS + 1,
    );

    await IncomingRequestSecretValues.getSigningSecrets({
      projectId: PROJECT_ID,
      policy,
    });

    expect(findBy).toHaveBeenCalledTimes(2);
  });

  test("a project with no secret reads nothing", async () => {
    expect(
      await IncomingRequestSecretValues.getSigningSecrets({
        projectId: PROJECT_ID,
        policy: policyOf([]),
      }),
    ).toEqual([]);
    expect(findBy).not.toHaveBeenCalled();
  });

  test("keeps a bounded number of projects", () => {
    expect(IncomingRequestSecretValues.MAX_PROJECTS).toBeGreaterThan(0);
    expect(IncomingRequestSecretValues.KEEP_FOR_MS).toBe(60 * 1000);
  });

  test("a failed read fails the check, for the worker to decide", async () => {
    findBy.mockRejectedValueOnce(new Error("Postgres is down"));

    await expect(
      IncomingRequestSecretValues.getSigningSecrets({
        projectId: PROJECT_ID,
        policy: policyOf([ofPolicy(SECRET_ID, SECRET)]),
      }),
    ).rejects.toThrow("Postgres is down");
  });
});

describe("IncomingRequestMonitorLabels", () => {
  const MONITOR_ID: string = "b0b0b0b0-0000-4000-8000-0000000000b0";
  const LABEL_ID: string = "1ABE1000-0000-4000-8000-00000000000A";

  let redis: Map<string, string>;
  let redisFails: boolean;
  let findOneById: SpyInstance<typeof MonitorService.findOneById>;

  beforeEach(() => {
    redis = new Map<string, string>();
    redisFails = false;

    jest
      .spyOn(GlobalCache, "getString")
      .mockImplementation(async (namespace: string, key: string) => {
        if (redisFails) {
          throw new Error("Redis is down");
        }

        return redis.get(`${namespace}-${key}`) ?? null;
      });

    jest
      .spyOn(GlobalCache, "setString")
      .mockImplementation(
        async (namespace: string, key: string, value: string) => {
          if (redisFails) {
            throw new Error("Redis is down");
          }

          redis.set(`${namespace}-${key}`, value);
        },
      );

    findOneById = jest
      .spyOn(MonitorService, "findOneById")
      .mockImplementation(async () => {
        const monitor: Monitor = new Monitor(new ObjectID(MONITOR_ID));
        monitor.labels = [new Label(new ObjectID(LABEL_ID))];
        return monitor;
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  test("reads a monitor's labels once a minute, as OneUptime, in one spelling", async () => {
    expect(await IncomingRequestMonitorLabels.getLabelIds(MONITOR_ID)).toEqual([
      LABEL_ID.toLowerCase(),
    ]);
    expect(await IncomingRequestMonitorLabels.getLabelIds(MONITOR_ID)).toEqual([
      LABEL_ID.toLowerCase(),
    ]);

    expect(findOneById).toHaveBeenCalledTimes(1);
    expect(findOneById.mock.calls[0]![0].props).toEqual({ isRoot: true });
    expect(IncomingRequestMonitorLabels.EXPIRES_IN_SECONDS).toBe(60);
  });

  test("a monitor with no labels is kept as having none", async () => {
    findOneById.mockResolvedValue(new Monitor(new ObjectID(MONITOR_ID)));

    expect(await IncomingRequestMonitorLabels.getLabelIds(MONITOR_ID)).toEqual(
      [],
    );
    expect(await IncomingRequestMonitorLabels.getLabelIds(MONITOR_ID)).toEqual(
      [],
    );
    expect(findOneById).toHaveBeenCalledTimes(1);
  });

  test("a Redis that fails is a miss", async () => {
    redisFails = true;

    expect(await IncomingRequestMonitorLabels.getLabelIds(MONITOR_ID)).toEqual([
      LABEL_ID.toLowerCase(),
    ]);
  });

  test("a Postgres that fails throws, so nothing is refused on a guess", async () => {
    findOneById.mockRejectedValueOnce(new Error("Postgres is down"));

    await expect(
      IncomingRequestMonitorLabels.getLabelIds(MONITOR_ID),
    ).rejects.toThrow("Postgres is down");
  });
});
