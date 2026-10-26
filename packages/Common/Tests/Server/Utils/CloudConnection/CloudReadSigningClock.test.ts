import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import AwsCloudConnector from "../../../../Server/Utils/CloudConnection/Aws/AwsCloudConnector";
import { AWS_INVENTORY_TYPES } from "../../../../Server/Utils/CloudConnection/Aws/AwsInventoryCatalog";
import CloudChangeRecorder from "../../../../Server/Utils/CloudConnection/CloudChangeRecorder";
import CloudConnectionLanes, {
  CloudChangesLaneOutcome,
  CloudInventoryLaneOutcome,
} from "../../../../Server/Utils/CloudConnection/CloudConnectionLanes";
import CloudConnectionResourceSync from "../../../../Server/Utils/CloudConnection/CloudConnectionResourceSync";
import {
  CloudConnectionPullState,
  CloudConnectionSettings,
  CloudConnectorTransport,
} from "../../../../Server/Utils/CloudConnection/CloudConnectorTypes";
import {
  DataSourceHttpRequest,
  DataSourceHttpResponse,
} from "../../../../Server/Utils/DataSource/HttpFetch";
import LlmProviderError from "../../../../Server/Utils/LlmObservability/LlmProviderError";
import { CloudProvider } from "../../../../Types/Cloud/CloudPlatform";
import { CloudConnectionAuthMethod } from "../../../../Types/CloudConnection/CloudConnectionCatalog";
import { CloudConnectionFailureKind } from "../../../../Types/CloudConnection/CloudConnectionTest";
import ObjectID from "../../../../Types/ObjectID";
import { FAKE_ACCOUNT_ID, FakeAws, createFakeAws } from "./FakeAwsApi";

/*
 * A read runs for minutes, and AWS refuses a request whose signature is
 * more than five minutes old - as an unknown signature, which reads as a
 * refused credential and would fail the whole read. So every request is
 * signed with the time it is sent at (the read's clock), while the read
 * keeps one time for its windows and cursors.
 *
 * These read a real AWS connector against a fake AWS that keeps its own
 * clock and refuses stale signatures, through a transport that takes a
 * while for each request - the slow account a read meets in production.
 */

const PROJECT: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const CONNECTION: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const START: Date = new Date("2026-10-21T12:07:00Z");
const MINUTE: number = 60 * 1000;

const SETTINGS: CloudConnectionSettings = {
  provider: CloudProvider.AWS,
  projectId: PROJECT.toString(),
  config: {
    authMethod: CloudConnectionAuthMethod.AwsAccessKey,
    accessKeyId: "AKIAIOSFODNN7EXAMPLE",
    regions: "eu-west-1",
  },
  secrets: { secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" },
};

let elapsedMs: number;

function clock(): Date {
  return new Date(START.getTime() + elapsedMs);
}

// The fake AWS, reached through a transport that takes `perRequestMs` each time.
function slowAws(perRequestMs: number): {
  fake: FakeAws;
  transport: CloudConnectorTransport;
} {
  const fake: FakeAws = createFakeAws({
    awsClock: clock,
    regions: {
      "eu-west-1": { metrics: [] },
      "us-east-1": { metrics: [] },
    },
  });

  return {
    fake,
    transport: async (
      request: DataSourceHttpRequest,
    ): Promise<DataSourceHttpResponse> => {
      // Signed as it was sent; answered by AWS a while later.
      elapsedMs += perRequestMs;
      return await fake.transport(request);
    },
  };
}

function lane(data: {
  transport: CloudConnectorTransport;
  state: CloudConnectionPullState;
  signedNow: boolean;
}): Parameters<typeof CloudConnectionLanes.runInventory>[0] & {
  provider: CloudProvider;
} {
  return {
    projectId: PROJECT,
    provider: CloudProvider.AWS,
    connectionId: CONNECTION,
    connector: new AwsCloudConnector(),
    settings: SETTINGS,
    state: data.state,
    transport: data.transport,
    now: START,
    clock: data.signedNow ? clock : undefined,
    deadlineMs: Date.now() + 8 * MINUTE,
    sleep: async () => {},
  };
}

beforeEach(() => {
  elapsedMs = 0;

  jest.spyOn(CloudConnectionResourceSync, "syncInventory").mockResolvedValue({
    resourceCount: 0,
    resourceTypes: [],
    regions: [],
    newResources: 0,
    archivedResources: 0,
    hasMore: false,
  });
  jest
    .spyOn(CloudChangeRecorder, "record")
    .mockResolvedValue({ recorded: 0, alreadyRecorded: 0, unwritten: [] });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a read that runs longer than AWS's five minutes", () => {
  test("lists every type of every Region, each request signed as it is sent", async () => {
    // Twenty seconds a request: the listing takes a quarter of an hour.
    const { fake, transport } = slowAws(20 * 1000);

    const outcome: CloudInventoryLaneOutcome =
      await CloudConnectionLanes.runInventory(
        lane({
          transport,
          state: { accounts: [FAKE_ACCOUNT_ID] },
          signedNow: true,
        }),
      );

    expect(elapsedMs).toBeGreaterThan(10 * MINUTE);
    expect(fake.expiredSignatures.count).toBe(0);
    expect(outcome.ran).toBe(true);
    expect(outcome.warnings).toEqual([]);
    // Every type in both Regions (the global ones in us-east-1 only) was asked.
    expect(fake.cloudControlCalls.length).toBeGreaterThanOrEqual(
      AWS_INVENTORY_TYPES.length,
    );
    // The read's own time is what it records, not the clock's.
    expect(outcome.listedInFull).toEqual([FAKE_ACCOUNT_ID]);
  });

  test("signed with the read's start, the same listing is refused part way - and fails the read as a refused credential", async () => {
    const { fake, transport } = slowAws(20 * 1000);

    await expect(
      CloudConnectionLanes.runInventory(
        lane({
          transport,
          state: { accounts: [FAKE_ACCOUNT_ID] },
          signedNow: false,
        }),
      ),
    ).rejects.toMatchObject({
      kind: CloudConnectionFailureKind.Authentication,
    });
    expect(fake.expiredSignatures.count).toBeGreaterThan(0);
  });

  test("reads what changed, each request signed as it is sent", async () => {
    // Two minutes a request: the third is past AWS's five minutes.
    const { fake, transport } = slowAws(2 * MINUTE);

    const outcome: CloudChangesLaneOutcome =
      await CloudConnectionLanes.runChanges(
        lane({
          transport,
          state: { accounts: [FAKE_ACCOUNT_ID] },
          signedNow: true,
        }),
      );

    expect(elapsedMs).toBeGreaterThan(5 * MINUTE);
    expect(fake.expiredSignatures.count).toBe(0);
    expect(outcome.ran).toBe(true);
    expect(outcome.warnings).toEqual([]);
  });

  test("signed with the read's start, the same read of changes fails as a refused credential", async () => {
    const { fake, transport } = slowAws(2 * MINUTE);

    await expect(
      CloudConnectionLanes.runChanges(
        lane({
          transport,
          state: { accounts: [FAKE_ACCOUNT_ID] },
          signedNow: false,
        }),
      ),
    ).rejects.toMatchObject({
      kind: CloudConnectionFailureKind.Authentication,
    });
    expect(fake.expiredSignatures.count).toBeGreaterThan(0);
  });

  test("the cursors a slow read moves are the read's start, not where the clock got to", async () => {
    const { transport } = slowAws(2 * MINUTE);
    const state: CloudConnectionPullState = { accounts: [FAKE_ACCOUNT_ID] };

    await CloudConnectionLanes.runChanges(
      lane({ transport, state, signedNow: true }),
    );

    const cursors: Array<string> = Object.values(state.changeCursors || {});
    expect(cursors.length).toBeGreaterThan(0);

    for (const cursor of cursors) {
      expect(cursor).toBe(START.toISOString());
    }
  });

  test("a refusal that is not a stale signature still fails the read", async () => {
    const fake: FakeAws = createFakeAws({
      awsClock: clock,
      regions: {
        "eu-west-1": { metrics: [] },
        "us-east-1": {
          metrics: [],
          trailError: {
            status: 400,
            body: JSON.stringify({
              __type: "com.amazonaws.coral#UnrecognizedClientException",
              message: "The security token included in the request is invalid.",
            }),
          },
        },
      },
    });

    await expect(
      CloudConnectionLanes.runChanges(
        lane({
          transport: fake.transport,
          state: { accounts: [FAKE_ACCOUNT_ID] },
          signedNow: true,
        }),
      ),
    ).rejects.toBeInstanceOf(LlmProviderError);
  });
});
