import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import CloudConnection from "../../../../Models/DatabaseModels/CloudConnection";
import Service from "../../../../Models/DatabaseModels/Service";
import CloudConnectionService from "../../../../Server/Services/CloudConnectionService";
import PayAsYouGoBillingService from "../../../../Server/Services/PayAsYouGoBillingService";
import ProjectService from "../../../../Server/Services/ProjectService";
import CloudStreamAuthenticator, {
  CloudStreamAuthentication,
  CloudStreamSender,
  CloudStreamSenderVerdict,
  STREAM_TOKEN_KEYS_UNAVAILABLE_MESSAGE,
  WRONG_STREAM_TOKEN_MESSAGE,
} from "../../../../Server/Utils/CloudConnection/CloudStreamAuthentication";
import CloudStreamKeyedConnections from "../../../../Server/Utils/CloudConnection/CloudStreamKeyedConnections";
import CloudStreamKeys from "../../../../Server/Utils/CloudConnection/CloudStreamKeys";
import LlmConnectionPullRunner from "../../../../Server/Utils/LlmObservability/LlmConnectionPullRunner";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import {
  CloudStreamRefusalReason,
  buildCloudStreamKey,
} from "../../../../Types/CloudConnection/CloudStream";
import ObjectID from "../../../../Types/ObjectID";

/*
 * Who a stream's delivery is from, now that two clouds push: a key is
 * taken only at its own cloud's endpoint - an AWS key at Firehose's, a
 * Google Cloud key at Pub/Sub's - and a Google Cloud push only with a
 * token Google signed for the push service account the key was made for.
 * That check runs once the key is right and before anything else is said
 * of the connection; its trouble with Google's keys is said on no
 * connection. The keyed connections read are those of the clouds that push.
 * `jest` is the global one.
 */

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const AWS_CONNECTION: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");
const GCP_CONNECTION: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const NOW: Date = new Date("2026-11-06T10:00:00.000Z");
const PUSHER: string = "oneuptime-push-44444444@acme-prod-1.iam.gserviceaccount.com";

function key(connectionId: ObjectID, pair: string): string {
  return buildCloudStreamKey({
    connectionId: connectionId.toString(),
    secret: pair.repeat(32),
  });
}

const AWS_KEY: string = key(AWS_CONNECTION, "a1");
const GCP_KEY: string = key(GCP_CONNECTION, "c3");

let rows: Map<string, CloudConnection>;
let senderChecks: Array<CloudStreamSender>;

function row(data: {
  id: ObjectID;
  provider: CloudProvider;
  key: string;
  pusher?: string;
  isEnabled?: boolean;
}): CloudConnection {
  const connection: CloudConnection = new CloudConnection();
  connection.id = data.id;
  connection.projectId = PROJECT;
  connection.provider = data.provider;
  connection.isEnabled = data.isEnabled !== false;
  connection.serviceId = new ObjectID("22222222-2222-4222-8222-222222222222");
  const service: Service = new Service();
  service.name = "Cloud";
  connection.service = service;
  connection.streamKeyHashes = {
    current: { hash: CloudStreamKeys.hash(data.key), createdAt: NOW.toISOString() },
    ...(data.pusher ? { pushServiceAccount: data.pusher } : {}),
  };
  return connection;
}

function checker(
  verdict: CloudStreamSenderVerdict,
): (sender: CloudStreamSender) => Promise<CloudStreamSenderVerdict> {
  return async (sender: CloudStreamSender): Promise<CloudStreamSenderVerdict> => {
    senderChecks.push(sender);
    return verdict;
  };
}

beforeEach(() => {
  rows = new Map();
  senderChecks = [];
  rows.set(
    AWS_CONNECTION.toString(),
    row({ id: AWS_CONNECTION, provider: CloudProvider.AWS, key: AWS_KEY }),
  );
  rows.set(
    GCP_CONNECTION.toString(),
    row({
      id: GCP_CONNECTION,
      provider: CloudProvider.GCP,
      key: GCP_KEY,
      pusher: PUSHER,
    }),
  );

  CloudStreamAuthenticator.forget(AWS_CONNECTION);
  CloudStreamAuthenticator.forget(GCP_CONNECTION);
  CloudStreamKeyedConnections.reset();

  jest
    .spyOn(CloudConnectionService, "findOneById")
    .mockImplementation((async (data: { id: ObjectID }) => {
      return rows.get(data.id.toString()) || null;
    }) as never);
  jest
    .spyOn(CloudStreamKeyedConnections, "readIds")
    .mockImplementation(async (): Promise<Array<string>> => {
      return Array.from(rows.keys());
    });
  jest.spyOn(ProjectService, "isProjectBlocked").mockResolvedValue(false);
  jest.spyOn(PayAsYouGoBillingService, "requirePayAsYouGo").mockResolvedValue(undefined);
  jest.spyOn(LlmConnectionPullRunner, "isTelemetryAllowed").mockResolvedValue(true);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a key is taken only at its own cloud's endpoint", () => {
  test("an AWS key at Firehose's, and not at Pub/Sub's", async () => {
    expect(
      (await CloudStreamAuthenticator.authenticate({ accessKey: AWS_KEY, now: NOW }))
        .isAuthorized,
    ).toBe(true);

    const atPubSub: CloudStreamAuthentication = await CloudStreamAuthenticator.authenticate({
      accessKey: AWS_KEY,
      now: NOW,
      provider: CloudProvider.GCP,
      verifySender: checker("sender"),
    });

    expect(atPubSub.isAuthorized).toBe(false);
    expect(!atPubSub.isAuthorized && atPubSub.reason).toBe(CloudStreamRefusalReason.WrongKey);
    // A key that is not the endpoint's never reaches the sender check.
    expect(senderChecks).toEqual([]);
  });

  test("a Google Cloud key at Pub/Sub's, and not at Firehose's", async () => {
    const atFirehose: CloudStreamAuthentication = await CloudStreamAuthenticator.authenticate({
      accessKey: GCP_KEY,
      now: NOW,
    });
    expect(!atFirehose.isAuthorized && atFirehose.reason).toBe(
      CloudStreamRefusalReason.WrongKey,
    );

    const atPubSub: CloudStreamAuthentication = await CloudStreamAuthenticator.authenticate({
      accessKey: GCP_KEY,
      now: NOW,
      provider: CloudProvider.GCP,
      verifySender: checker("sender"),
    });

    expect(atPubSub).toMatchObject({
      isAuthorized: true,
      projectId: PROJECT,
      connectionId: GCP_CONNECTION,
      serviceName: "Cloud",
    });
    // The check is handed the push service account the key was made for.
    expect(senderChecks).toEqual([{ pushServiceAccount: PUSHER }]);
  });
});

describe("the sender check", () => {
  test("a push from anyone but the connection's push service account is refused, 401, and said on the connection", async () => {
    const refused: CloudStreamAuthentication = await CloudStreamAuthenticator.authenticate({
      accessKey: GCP_KEY,
      now: NOW,
      provider: CloudProvider.GCP,
      verifySender: checker("not-sender"),
    });

    expect(refused).toEqual({
      isAuthorized: false,
      reason: CloudStreamRefusalReason.WrongToken,
      status: 401,
      message: WRONG_STREAM_TOKEN_MESSAGE,
      connectionId: GCP_CONNECTION,
    });
  });

  test("Google's keys that cannot be read are said on no connection, and answered so the push is sent again", async () => {
    const refused: CloudStreamAuthentication = await CloudStreamAuthenticator.authenticate({
      accessKey: GCP_KEY,
      now: NOW,
      provider: CloudProvider.GCP,
      verifySender: checker("unavailable"),
    });

    expect(refused).toEqual({
      isAuthorized: false,
      reason: CloudStreamRefusalReason.WrongToken,
      status: 503,
      message: STREAM_TOKEN_KEYS_UNAVAILABLE_MESSAGE,
    });
  });

  test("it runs before anything else is said of the connection: a stranger with the key learns nothing of it", async () => {
    rows.get(GCP_CONNECTION.toString())!.isEnabled = false;
    CloudStreamAuthenticator.forget(GCP_CONNECTION);

    const stranger: CloudStreamAuthentication = await CloudStreamAuthenticator.authenticate({
      accessKey: GCP_KEY,
      now: NOW,
      provider: CloudProvider.GCP,
      verifySender: checker("not-sender"),
    });
    expect(!stranger.isAuthorized && stranger.reason).toBe(CloudStreamRefusalReason.WrongToken);

    const sender: CloudStreamAuthentication = await CloudStreamAuthenticator.authenticate({
      accessKey: GCP_KEY,
      now: NOW,
      provider: CloudProvider.GCP,
      verifySender: checker("sender"),
    });
    expect(!sender.isAuthorized && sender.reason).toBe(CloudStreamRefusalReason.TurnedOff);
  });

  test("a key made before the push service account was kept hands the check none", async () => {
    rows.set(
      GCP_CONNECTION.toString(),
      row({ id: GCP_CONNECTION, provider: CloudProvider.GCP, key: GCP_KEY }),
    );
    CloudStreamAuthenticator.forget(GCP_CONNECTION);

    await CloudStreamAuthenticator.authenticate({
      accessKey: GCP_KEY,
      now: NOW,
      provider: CloudProvider.GCP,
      verifySender: checker("not-sender"),
    });

    expect(senderChecks).toEqual([{ pushServiceAccount: null }]);
  });
});

describe("the connections that hold a stream key", () => {
  test("are those of the clouds that push with one: AWS's and Google Cloud's, never Azure's", async () => {
    jest.restoreAllMocks();

    const findAllBy: jest.SpyInstance = jest
      .spyOn(CloudConnectionService, "findAllBy")
      .mockResolvedValue([] as never);

    await CloudStreamKeyedConnections.readIds(10);

    expect(findAllBy).toHaveBeenCalledTimes(1);

    const query: Record<string, unknown> = (
      findAllBy.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;
    const providers: string = JSON.stringify(query["provider"]);

    expect(providers).toContain(CloudProvider.AWS);
    expect(providers).toContain(CloudProvider.GCP);
    expect(providers).not.toContain(CloudProvider.Azure);
    expect(query["streamKeyCreatedAt"]).toBeDefined();
  });
});
