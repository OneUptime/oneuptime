import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import CloudConnection from "../../../../Models/DatabaseModels/CloudConnection";
import Service from "../../../../Models/DatabaseModels/Service";
import CloudConnectionService from "../../../../Server/Services/CloudConnectionService";
import PayAsYouGoBillingService, {
  PAY_AS_YOU_GO_PAYMENT_REQUIRED_MESSAGE,
} from "../../../../Server/Services/PayAsYouGoBillingService";
import ProjectService from "../../../../Server/Services/ProjectService";
import CloudStreamAuthenticator, {
  CloudStreamAuthentication,
  STREAM_CONNECTION_OFF_MESSAGE,
  STREAM_NOT_ALLOWED_MESSAGE,
  STREAM_PROJECT_BLOCKED_MESSAGE,
  WRONG_STREAM_KEY_MESSAGE,
} from "../../../../Server/Utils/CloudConnection/CloudStreamAuthentication";
import CloudStreamKeyedConnections from "../../../../Server/Utils/CloudConnection/CloudStreamKeyedConnections";
import CloudStreamKeys from "../../../../Server/Utils/CloudConnection/CloudStreamKeys";
import LlmConnectionPullRunner from "../../../../Server/Utils/LlmObservability/LlmConnectionPullRunner";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import {
  CLOUD_STREAM_KEYED_CONNECTIONS_MISS_REFRESH_MS,
  CLOUD_STREAM_KEYED_CONNECTIONS_REFRESH_MS,
  CLOUD_STREAM_MAX_KEYED_CONNECTIONS,
  CLOUD_STREAM_PREVIOUS_KEY_GRACE_MS,
  CloudStreamRefusalReason,
  buildCloudStreamKey,
} from "../../../../Types/CloudConnection/CloudStream";
import PaymentRequiredException from "../../../../Types/Exception/PaymentRequiredException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";

/*
 * Who a Firehose delivery is from: the connection its stream key names, in
 * that connection's project - never one the delivery says. A key is taken
 * when it is the connection's current key, or the one that key replaced
 * within a day; the connection must be an AWS connection that is on, in a
 * project that takes telemetry, is not blocked and may be billed. What a
 * connection holds is read once a minute, and at once after its key
 * changes. A key naming a connection that holds no stream key costs no
 * read at all (CloudStreamKeyedConnections, whose one read of every keyed
 * connection is modelled from the same rows), and a wrong key is noted on
 * its connection only while the connection holds a key. `jest` is the
 * global one.
 */

const PROJECT_A: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const PROJECT_B: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const CONNECTION_A: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const CONNECTION_B: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const NOW: Date = new Date("2026-11-04T10:00:00.000Z");

let rows: Map<string, CloudConnection>;
let reads: number;
// Reads of every connection that holds a stream key (CloudStreamKeyedConnections).
let keyedReads: number;
let keyedReadFails: boolean;
let blocked: boolean;
let telemetryAllowed: boolean;
let paymentRequired: boolean;

function row(data: {
  id: ObjectID;
  projectId: ObjectID;
  hashes: JSONObject | null;
  provider?: CloudProvider;
  isEnabled?: boolean;
  serviceName?: string | null;
}): CloudConnection {
  const connection: CloudConnection = new CloudConnection();
  connection.id = data.id;
  connection.projectId = data.projectId;
  connection.provider = data.provider || CloudProvider.AWS;
  connection.isEnabled = data.isEnabled !== false;
  if (data.hashes) {
    connection.streamKeyHashes = data.hashes;
  }

  if (data.serviceName !== null) {
    const service: Service = new Service();
    service.name = data.serviceName || "Production AWS";
    connection.service = service;
    connection.serviceId = new ObjectID("22222222-2222-4222-8222-222222222222");
  }

  return connection;
}

function key(connectionId: ObjectID, secret: string): string {
  return buildCloudStreamKey({
    connectionId: connectionId.toString(),
    secret: secret.repeat(64 / secret.length),
  });
}

const KEY_A: string = key(CONNECTION_A, "a1");
const KEY_A_OLD: string = key(CONNECTION_A, "a0");
const KEY_B: string = key(CONNECTION_B, "b1");

async function authenticate(
  accessKey: unknown,
  now: Date = NOW,
): Promise<CloudStreamAuthentication> {
  return await CloudStreamAuthenticator.authenticate({ accessKey, now });
}

beforeEach(() => {
  rows = new Map();
  reads = 0;
  keyedReads = 0;
  keyedReadFails = false;
  blocked = false;
  telemetryAllowed = true;
  paymentRequired = false;

  rows.set(
    CONNECTION_A.toString(),
    row({
      id: CONNECTION_A,
      projectId: PROJECT_A,
      hashes: {
        current: {
          hash: CloudStreamKeys.hash(KEY_A),
          createdAt: NOW.toISOString(),
        },
        previous: [
          {
            hash: CloudStreamKeys.hash(KEY_A_OLD),
            expiresAt: new Date(
              NOW.getTime() + CLOUD_STREAM_PREVIOUS_KEY_GRACE_MS,
            ).toISOString(),
          },
        ],
      },
    }),
  );
  rows.set(
    CONNECTION_B.toString(),
    row({
      id: CONNECTION_B,
      projectId: PROJECT_B,
      hashes: {
        current: {
          hash: CloudStreamKeys.hash(KEY_B),
          createdAt: NOW.toISOString(),
        },
      },
      serviceName: "Staging AWS",
    }),
  );

  jest
    .spyOn(CloudConnectionService, "findOneById")
    .mockImplementation((async (data: { id: ObjectID }) => {
      reads++;
      return rows.get(data.id.toString()) || null;
    }) as never);
  // The one read of every connection that holds a key: the rows with hashes.
  CloudStreamKeyedConnections.reset();
  jest
    .spyOn(CloudStreamKeyedConnections, "readIds")
    .mockImplementation(async (): Promise<Array<string>> => {
      keyedReads++;

      if (keyedReadFails) {
        throw new Error("Postgres is away");
      }

      return Array.from(rows.values())
        .filter((connection: CloudConnection): boolean => {
          return Boolean(connection.streamKeyHashes);
        })
        .map((connection: CloudConnection): string => {
          return connection.id!.toString();
        });
    });
  jest
    .spyOn(ProjectService, "isProjectBlocked")
    .mockImplementation(async () => {
      return blocked;
    });
  jest
    .spyOn(PayAsYouGoBillingService, "requirePayAsYouGo")
    .mockImplementation(async () => {
      if (paymentRequired) {
        throw new PaymentRequiredException(
          PAY_AS_YOU_GO_PAYMENT_REQUIRED_MESSAGE,
        );
      }
    });
  jest
    .spyOn(LlmConnectionPullRunner, "isTelemetryAllowed")
    .mockImplementation(async () => {
      return telemetryAllowed;
    });

  CloudStreamAuthenticator.forget(CONNECTION_A);
  CloudStreamAuthenticator.forget(CONNECTION_B);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a delivery with a connection's key", () => {
  test("is the connection's, in its own project, under its telemetry service", async () => {
    expect(await authenticate(KEY_A)).toEqual({
      isAuthorized: true,
      projectId: PROJECT_A,
      connectionId: CONNECTION_A,
      serviceName: "Production AWS",
    });
  });

  test("of another project is that project's alone: one key never writes into another's", async () => {
    const a: CloudStreamAuthentication = await authenticate(KEY_A);
    const b: CloudStreamAuthentication = await authenticate(KEY_B);

    expect(a.isAuthorized && a.projectId.toString()).toBe(PROJECT_A.toString());
    expect(b.isAuthorized && b.projectId.toString()).toBe(PROJECT_B.toString());
    expect(b.isAuthorized && b.serviceName).toBe("Staging AWS");
  });

  test("with the key it replaced works for a day, then no more", async () => {
    expect((await authenticate(KEY_A_OLD)).isAuthorized).toBe(true);

    CloudStreamAuthenticator.forget(CONNECTION_A);

    const after: CloudStreamAuthentication = await authenticate(
      KEY_A_OLD,
      new Date(NOW.getTime() + CLOUD_STREAM_PREVIOUS_KEY_GRACE_MS + 1000),
    );

    expect(after.isAuthorized).toBe(false);
    expect(!after.isAuthorized && after.reason).toBe(
      CloudStreamRefusalReason.WrongKey,
    );
  });

  test("is read from Postgres once a minute, and at once after its key changes", async () => {
    await authenticate(KEY_A);
    await authenticate(KEY_A);
    await authenticate(KEY_A);

    expect(reads).toBe(1);

    CloudStreamAuthenticator.forget(CONNECTION_A);
    await authenticate(KEY_A);

    expect(reads).toBe(2);
  });
});

describe("a delivery that is refused", () => {
  test("without a stream key, or with anything else, says nothing of which connections exist", async () => {
    for (const accessKey of [
      undefined,
      "",
      "6b4a1d5c-0c5e-4a8f-9a30-1f1f2b7d1e11",
      `Bearer ${KEY_A}`,
    ]) {
      expect(await authenticate(accessKey)).toEqual({
        isAuthorized: false,
        reason: CloudStreamRefusalReason.WrongKey,
        status: 401,
        message: WRONG_STREAM_KEY_MESSAGE,
        connectionId: undefined,
      });
    }

    expect(reads).toBe(0);
  });

  test("with a key of a connection that is not there is refused alike", async () => {
    const unknown: string = key(
      new ObjectID("99999999-9999-4999-8999-999999999999"),
      "c3",
    );

    expect(await authenticate(unknown)).toEqual(
      expect.objectContaining({
        isAuthorized: false,
        reason: CloudStreamRefusalReason.WrongKey,
        status: 401,
        connectionId: undefined,
      }),
    );
  });

  test("with a wrong secret for a real connection names it, so its summary says why", async () => {
    const wrong: CloudStreamAuthentication = await authenticate(
      key(CONNECTION_A, "ff"),
    );

    expect(wrong).toEqual({
      isAuthorized: false,
      reason: CloudStreamRefusalReason.WrongKey,
      status: 401,
      message: WRONG_STREAM_KEY_MESSAGE,
      connectionId: CONNECTION_A,
    });
  });

  test("with another connection's secret on this connection's id", async () => {
    const swapped: string = buildCloudStreamKey({
      connectionId: CONNECTION_A.toString(),
      secret: KEY_B.split("_")[2]!,
    });

    expect((await authenticate(swapped)).isAuthorized).toBe(false);
  });

  test("for a connection that streams nothing", async () => {
    rows.set(
      CONNECTION_A.toString(),
      row({ id: CONNECTION_A, projectId: PROJECT_A, hashes: null }),
    );

    expect((await authenticate(KEY_A)).isAuthorized).toBe(false);
  });

  test("for a connection that is not AWS's", async () => {
    rows.set(
      CONNECTION_A.toString(),
      row({
        id: CONNECTION_A,
        projectId: PROJECT_A,
        provider: CloudProvider.Azure,
        hashes: {
          current: {
            hash: CloudStreamKeys.hash(KEY_A),
            createdAt: NOW.toISOString(),
          },
        },
      }),
    );

    expect(await authenticate(KEY_A)).toEqual(
      expect.objectContaining({
        isAuthorized: false,
        reason: CloudStreamRefusalReason.WrongKey,
      }),
    );
  });

  test("for a connection that is turned off: 403, and why", async () => {
    rows.set(
      CONNECTION_A.toString(),
      row({
        id: CONNECTION_A,
        projectId: PROJECT_A,
        isEnabled: false,
        hashes: {
          current: {
            hash: CloudStreamKeys.hash(KEY_A),
            createdAt: NOW.toISOString(),
          },
        },
      }),
    );

    expect(await authenticate(KEY_A)).toEqual({
      isAuthorized: false,
      reason: CloudStreamRefusalReason.TurnedOff,
      status: 403,
      message: STREAM_CONNECTION_OFF_MESSAGE,
      connectionId: CONNECTION_A,
    });
  });

  test("for a project whose plan has no telemetry", async () => {
    telemetryAllowed = false;

    expect(await authenticate(KEY_A)).toEqual({
      isAuthorized: false,
      reason: CloudStreamRefusalReason.NotAllowed,
      status: 403,
      message: STREAM_NOT_ALLOWED_MESSAGE,
      connectionId: CONNECTION_A,
    });
  });

  test("for a project a master admin blocked, on every delivery", async () => {
    expect((await authenticate(KEY_A)).isAuthorized).toBe(true);

    blocked = true;

    expect(await authenticate(KEY_A)).toEqual({
      isAuthorized: false,
      reason: CloudStreamRefusalReason.NotAllowed,
      status: 403,
      message: STREAM_PROJECT_BLOCKED_MESSAGE,
      connectionId: CONNECTION_A,
    });
  });

  test("for a project that cannot be billed for telemetry: 402", async () => {
    paymentRequired = true;

    expect(await authenticate(KEY_A)).toEqual({
      isAuthorized: false,
      reason: CloudStreamRefusalReason.NotAllowed,
      status: 402,
      message: PAY_AS_YOU_GO_PAYMENT_REQUIRED_MESSAGE,
      connectionId: CONNECTION_A,
    });
  });
});

describe("a connection whose telemetry service is gone", () => {
  test("gets one again, as its next read would give it", async () => {
    rows.set(
      CONNECTION_A.toString(),
      row({
        id: CONNECTION_A,
        projectId: PROJECT_A,
        serviceName: null,
        hashes: {
          current: {
            hash: CloudStreamKeys.hash(KEY_A),
            createdAt: NOW.toISOString(),
          },
        },
      }),
    );
    const ensure: jest.SpyInstance = jest
      .spyOn(CloudConnectionService, "ensureTelemetryService")
      .mockResolvedValue({
        serviceId: new ObjectID("66666666-6666-4666-8666-666666666666"),
        serviceName: "Amazon Web Services",
      });

    const result: CloudStreamAuthentication = await authenticate(KEY_A);

    expect(ensure).toHaveBeenCalledTimes(1);
    expect(result.isAuthorized && result.serviceName).toBe(
      "Amazon Web Services",
    );
  });
});

describe("refused deliveries cost nothing", () => {
  /*
   * An id nobody made, new on every call: a test never meets an id an
   * earlier test left in the per-connection cache.
   */
  let inventedSoFar: number = 0;

  function invented(): string {
    inventedSoFar++;
    const hex: string = inventedSoFar.toString(16).padStart(12, "0");

    return key(new ObjectID(`99999999-9999-4999-8999-${hex}`), "c3");
  }

  test("a key naming a connection that holds no stream key costs no read, however many ids are invented", async () => {
    for (let index: number = 0; index < 200; index++) {
      expect(await authenticate(invented())).toEqual({
        isAuthorized: false,
        reason: CloudStreamRefusalReason.WrongKey,
        status: 401,
        message: WRONG_STREAM_KEY_MESSAGE,
        connectionId: undefined,
      });
    }

    // One read of every keyed connection, and not one of a connection.
    expect(keyedReads).toBe(1);
    expect(reads).toBe(0);
  });

  test("a connection that streams nothing is refused without a read, and noted nowhere", async () => {
    rows.set(
      CONNECTION_A.toString(),
      row({ id: CONNECTION_A, projectId: PROJECT_A, hashes: null }),
    );

    expect(await authenticate(KEY_A)).toEqual(
      expect.objectContaining({
        isAuthorized: false,
        reason: CloudStreamRefusalReason.WrongKey,
        connectionId: undefined,
      }),
    );
    expect(reads).toBe(0);
  });

  test("invented ids never push a streaming connection out of the cache", async () => {
    expect((await authenticate(KEY_A)).isAuthorized).toBe(true);

    // More invented ids than the cache holds connections.
    for (let index: number = 0; index < 6000; index++) {
      await authenticate(invented());
    }

    expect((await authenticate(KEY_A)).isAuthorized).toBe(true);
    expect(reads).toBe(1);
  });

  test(`an id not held is looked for again at most every ${CLOUD_STREAM_KEYED_CONNECTIONS_MISS_REFRESH_MS / 1000} seconds: a key made on another server is known within seconds`, async () => {
    const connectionC: ObjectID = new ObjectID(
      "77777777-7777-4777-8777-777777777777",
    );
    const keyC: string = key(connectionC, "d4");

    expect((await authenticate(KEY_A)).isAuthorized).toBe(true);
    expect(keyedReads).toBe(1);

    // Another server makes the first key of connection C.
    rows.set(
      connectionC.toString(),
      row({
        id: connectionC,
        projectId: PROJECT_A,
        hashes: {
          current: {
            hash: CloudStreamKeys.hash(keyC),
            createdAt: NOW.toISOString(),
          },
        },
      }),
    );

    const soon: Date = new Date(
      NOW.getTime() + CLOUD_STREAM_KEYED_CONNECTIONS_MISS_REFRESH_MS - 1,
    );
    expect((await authenticate(keyC, soon)).isAuthorized).toBe(false);
    expect(keyedReads).toBe(1);

    const later: Date = new Date(
      NOW.getTime() + CLOUD_STREAM_KEYED_CONNECTIONS_MISS_REFRESH_MS,
    );
    expect(await authenticate(keyC, later)).toEqual(
      expect.objectContaining({
        isAuthorized: true,
        connectionId: connectionC,
      }),
    );
    expect(keyedReads).toBe(2);

    // And invented ids at that moment do not read again: one read a window.
    await authenticate(invented(), later);
    await authenticate(invented(), later);
    expect(keyedReads).toBe(2);
  });

  test(`every keyed connection is read again every ${CLOUD_STREAM_KEYED_CONNECTIONS_REFRESH_MS / 1000} seconds: a stream stopped on another server is refused here without a read`, async () => {
    expect((await authenticate(KEY_A)).isAuthorized).toBe(true);

    // Another server stops A's streams.
    rows.set(
      CONNECTION_A.toString(),
      row({ id: CONNECTION_A, projectId: PROJECT_A, hashes: null }),
    );
    CloudStreamAuthenticator.forget(CONNECTION_A);

    expect(
      (
        await authenticate(
          KEY_A,
          new Date(NOW.getTime() + CLOUD_STREAM_KEYED_CONNECTIONS_REFRESH_MS),
        )
      ).isAuthorized,
    ).toBe(false);
    expect(keyedReads).toBe(2);
    expect(reads).toBe(1);
  });

  test("a key made on this server is known here at once, and a stream stopped here is refused here at once", async () => {
    const connectionC: ObjectID = new ObjectID(
      "77777777-7777-4777-8777-777777777777",
    );

    expect(await CloudStreamKeyedConnections.mayHoldKey(connectionC, NOW)).toBe(
      false,
    );

    CloudStreamKeyedConnections.keyMade(connectionC);
    expect(await CloudStreamKeyedConnections.mayHoldKey(connectionC, NOW)).toBe(
      true,
    );

    CloudStreamKeyedConnections.keysStopped(CONNECTION_A);
    expect(
      await CloudStreamKeyedConnections.mayHoldKey(CONNECTION_A, NOW),
    ).toBe(false);
    expect(keyedReads).toBe(1);
  });

  test("however many deliveries ask at once, the keyed connections are read once", async () => {
    await Promise.all(
      [0, 1, 2, 3, 4, 5, 6, 7].map(() => {
        return authenticate(invented());
      }),
    );

    expect(keyedReads).toBe(1);
    expect(reads).toBe(0);
  });

  test("fails open: while the keyed connections cannot be read, each delivery's connection is read as before", async () => {
    keyedReadFails = true;

    expect((await authenticate(KEY_A)).isAuthorized).toBe(true);
    expect((await authenticate(invented())).isAuthorized).toBe(false);
    expect((await authenticate(invented())).isAuthorized).toBe(false);

    expect(reads).toBe(3);
    // A failing read is not tried again on every delivery.
    expect(keyedReads).toBe(1);
  });

  test("past the most kept, an id not among them is read as before", async () => {
    jest
      .spyOn(CloudStreamKeyedConnections, "readIds")
      .mockImplementation(async (limit: number): Promise<Array<string>> => {
        keyedReads++;
        expect(limit).toBe(CLOUD_STREAM_MAX_KEYED_CONNECTIONS + 1);
        return Array.from(
          { length: limit },
          (_value: unknown, index: number): string => {
            return `aaaaaaaa-aaaa-4aaa-8aaa-${index
              .toString(16)
              .padStart(12, "0")}`;
          },
        );
      });

    expect((await authenticate(KEY_A)).isAuthorized).toBe(true);
    expect((await authenticate(key(CONNECTION_B, "ee"))).isAuthorized).toBe(
      false,
    );
    expect(reads).toBe(2);
  });
});

describe("a wrong key is noted on its connection only while the connection holds a key", () => {
  test("a connection that holds a key is named, so its summary says why its deliveries are refused", async () => {
    expect(await authenticate(key(CONNECTION_A, "ff"))).toEqual(
      expect.objectContaining({
        reason: CloudStreamRefusalReason.WrongKey,
        connectionId: CONNECTION_A,
      }),
    );
  });

  test("a connection whose keys were stopped on another server - not yet read again here - is named nowhere", async () => {
    // This server still holds A among the keyed connections: it reads A, which holds no key.
    expect((await authenticate(KEY_A)).isAuthorized).toBe(true);
    rows.set(
      CONNECTION_A.toString(),
      row({ id: CONNECTION_A, projectId: PROJECT_A, hashes: null }),
    );
    CloudStreamAuthenticator.forget(CONNECTION_A);

    expect(await authenticate(key(CONNECTION_A, "ff"))).toEqual(
      expect.objectContaining({
        isAuthorized: false,
        reason: CloudStreamRefusalReason.WrongKey,
        connectionId: undefined,
      }),
    );
    expect(reads).toBe(2);
  });

  test("a connection whose only keys are past their day is named nowhere", async () => {
    rows.set(
      CONNECTION_A.toString(),
      row({
        id: CONNECTION_A,
        projectId: PROJECT_A,
        hashes: {
          previous: [
            {
              hash: CloudStreamKeys.hash(KEY_A_OLD),
              expiresAt: new Date(NOW.getTime() - 1000).toISOString(),
            },
          ],
        },
      }),
    );

    expect(await authenticate(KEY_A_OLD)).toEqual(
      expect.objectContaining({
        isAuthorized: false,
        reason: CloudStreamRefusalReason.WrongKey,
        connectionId: undefined,
      }),
    );
  });

  test("the key's own refusals - turned off, the plan - need the right key, and are named as before", async () => {
    telemetryAllowed = false;

    expect(await authenticate(KEY_A)).toEqual(
      expect.objectContaining({
        reason: CloudStreamRefusalReason.NotAllowed,
        connectionId: CONNECTION_A,
      }),
    );
  });
});
