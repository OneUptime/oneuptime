import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it, and DatabaseService imports it.
 */
jest.mock("../../../Server/Utils/PasswordHash", () => {
  return {
    __esModule: true,
    default: {
      hash: jest.fn(),
      verify: jest.fn(),
      generateSalt: jest.fn(),
      needsUpgrade: jest.fn(),
      applyPepper: jest.fn(),
    },
  };
});

import KubernetesClusterService from "../../../Server/Services/KubernetesClusterService";
import KubernetesClusterFeedService from "../../../Server/Services/KubernetesClusterFeedService";
import UserService from "../../../Server/Services/UserService";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import { KubernetesClusterFeedEventType } from "../../../Models/DatabaseModels/KubernetesClusterFeed";
import ObjectID from "../../../Types/ObjectID";

/*
 * The two questions this whole feature exists to answer, pinned on the one
 * family that exercises both paths hardest:
 *
 *   "who created this cluster?"  and  "was it created automatically?"
 *
 * A Kubernetes cluster appears in a project one of two ways - somebody adds it
 * from the dashboard, or the collector reports telemetry for a cluster that is
 * not there yet and ingest registers it. Nothing on the overview page
 * distinguishes those, and the difference is exactly what somebody looking at
 * an unfamiliar cluster wants to know.
 *
 * The signal is whether an acting user is attached to the create: ingest
 * creates with root props and no user. That is a subtle thing to get right and
 * a very easy thing to break, because both branches produce a perfectly
 * plausible-looking feed item.
 *
 * The update half is pinned here too, and it matters just as much: these rows
 * take a liveness write roughly once a minute per resource, forever. A feed
 * that recorded those would bury the handful of real events under thousands of
 * "was updated" entries within a day.
 */

const CLUSTER_ID: ObjectID = ObjectID.generate();
const PROJECT_ID: ObjectID = ObjectID.generate();
const ACTING_USER_ID: ObjectID = ObjectID.generate();

interface FeedCall {
  kubernetesClusterId: ObjectID;
  projectId: ObjectID;
  kubernetesClusterFeedEventType: KubernetesClusterFeedEventType;
  feedInfoInMarkdown: string;
  moreInformationInMarkdown?: string | undefined;
  userId?: ObjectID | undefined;
}

let feedCalls: Array<FeedCall> = [];

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const service: any = KubernetesClusterService as any;

function cluster(overrides: Partial<KubernetesCluster>): KubernetesCluster {
  const model: KubernetesCluster = new KubernetesCluster(CLUSTER_ID);
  model.projectId = PROJECT_ID;
  model.name = "prod-us-east";
  Object.assign(model, overrides);
  return model;
}

beforeEach(() => {
  feedCalls = [];

  jest
    .spyOn(KubernetesClusterFeedService, "createKubernetesClusterFeedItem")
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    .mockImplementation((data: any): Promise<void> => {
      feedCalls.push(data as FeedCall);
      return Promise.resolve();
    });

  jest
    .spyOn(KubernetesClusterService, "getKubernetesClusterMarkdownLink")
    .mockImplementation((): Promise<string> => {
      return Promise.resolve(
        "[Kubernetes Cluster prod-us-east](https://example.com/cluster)",
      );
    });

  jest
    .spyOn(UserService, "getUserMarkdownString")
    .mockImplementation((): Promise<string> => {
      return Promise.resolve("Jane Doe (jane@example.com)");
    });
});

describe("KubernetesCluster creation feed", () => {
  test("attributes a dashboard create to the user who made it", async () => {
    await service.writeKubernetesClusterCreatedFeed(
      cluster({ clusterIdentifier: "prod-us-east" }),
      { createBy: { props: { userId: ACTING_USER_ID } } },
    );

    expect(feedCalls.length).toBe(1);
    expect(feedCalls[0]!.kubernetesClusterFeedEventType).toBe(
      KubernetesClusterFeedEventType.KubernetesClusterCreated,
    );
    expect(feedCalls[0]!.feedInfoInMarkdown).toContain("Jane Doe");
    expect(feedCalls[0]!.moreInformationInMarkdown).toContain(
      "**Automatically created from telemetry**: No.",
    );
    expect(feedCalls[0]!.userId).toBe(ACTING_USER_ID);
  });

  test("says telemetry discovered it when ingest created it", async () => {
    await service.writeKubernetesClusterCreatedFeed(
      cluster({ clusterIdentifier: "prod-us-east" }),
      { createBy: { props: { isRoot: true } } },
    );

    expect(feedCalls.length).toBe(1);
    expect(feedCalls[0]!.moreInformationInMarkdown).toContain(
      "**Automatically created from telemetry**: Yes.",
    );
    // Nobody to attribute it to, so nobody is named.
    expect(feedCalls[0]!.userId).toBeUndefined();
    expect(feedCalls[0]!.moreInformationInMarkdown).toContain("`prod-us-east`");
  });

  test("prefers the row's own createdByUserId over the request's", async () => {
    const rowUserId: ObjectID = ObjectID.generate();

    await service.writeKubernetesClusterCreatedFeed(
      cluster({ createdByUserId: rowUserId }),
      { createBy: { props: { userId: ACTING_USER_ID } } },
    );

    expect(feedCalls[0]!.userId).toBe(rowUserId);
  });

  test("writes nothing for a row with no project", async () => {
    const model: KubernetesCluster = new KubernetesCluster(CLUSTER_ID);

    await service.writeKubernetesClusterCreatedFeed(model, {
      createBy: { props: {} },
    });

    expect(feedCalls.length).toBe(0);
  });

  test("onCreateSuccess writes the feed without being able to fail the create", async () => {
    jest
      .spyOn(service, "writeKubernetesClusterCreatedFeed")
      .mockImplementation((): Promise<void> => {
        return Promise.reject(new Error("feed write blew up"));
      });

    const createdItem: KubernetesCluster = cluster({});

    await expect(
      service.onCreateSuccess({ createBy: { props: {} } }, createdItem),
    ).resolves.toBe(createdItem);

    expect(service.writeKubernetesClusterCreatedFeed).toHaveBeenCalled();
  });
});

describe("KubernetesCluster update feed", () => {
  beforeEach(() => {
    jest
      .spyOn(KubernetesClusterService, "findOneById")
      .mockImplementation((): Promise<KubernetesCluster | null> => {
        return Promise.resolve(cluster({}));
      });
  });

  test("stays silent for a heartbeat", async () => {
    await service.writeKubernetesClusterUpdatedFeed(
      {
        updateBy: {
          data: {
            lastSeenAt: new Date(),
            otelCollectorStatus: "connected",
            agentVersion: "1.2.3",
            nodeCount: 9,
          },
          props: {},
        },
      },
      [CLUSTER_ID],
    );

    expect(feedCalls.length).toBe(0);
  });

  test("records a rename and names the field", async () => {
    await service.writeKubernetesClusterUpdatedFeed(
      {
        updateBy: {
          data: { name: "prod-eu-west", lastSeenAt: new Date() },
          props: { userId: ACTING_USER_ID },
        },
      },
      [CLUSTER_ID],
    );

    expect(feedCalls.length).toBe(1);
    expect(feedCalls[0]!.kubernetesClusterFeedEventType).toBe(
      KubernetesClusterFeedEventType.KubernetesClusterUpdated,
    );
    expect(feedCalls[0]!.moreInformationInMarkdown).toContain("`name`");
    expect(feedCalls[0]!.moreInformationInMarkdown).not.toContain(
      "`lastSeenAt`",
    );
    expect(feedCalls[0]!.userId).toBe(ACTING_USER_ID);
  });

  test("archiving and restoring get their own events", async () => {
    await service.writeKubernetesClusterUpdatedFeed(
      { updateBy: { data: { isArchived: true }, props: {} } },
      [CLUSTER_ID],
    );

    expect(
      feedCalls.map((call: FeedCall) => {
        return call.kubernetesClusterFeedEventType;
      }),
    ).toEqual([KubernetesClusterFeedEventType.KubernetesClusterArchived]);

    feedCalls = [];

    await service.writeKubernetesClusterUpdatedFeed(
      { updateBy: { data: { isArchived: false }, props: {} } },
      [CLUSTER_ID],
    );

    expect(
      feedCalls.map((call: FeedCall) => {
        return call.kubernetesClusterFeedEventType;
      }),
    ).toEqual([KubernetesClusterFeedEventType.KubernetesClusterRestored]);
  });

  test("an archive that also renames records both, and not as one muddled entry", async () => {
    await service.writeKubernetesClusterUpdatedFeed(
      {
        updateBy: {
          data: { isArchived: true, name: "retired-cluster" },
          props: {},
        },
      },
      [CLUSTER_ID],
    );

    expect(
      feedCalls.map((call: FeedCall) => {
        return call.kubernetesClusterFeedEventType;
      }),
    ).toEqual([
      KubernetesClusterFeedEventType.KubernetesClusterArchived,
      KubernetesClusterFeedEventType.KubernetesClusterUpdated,
    ]);

    /*
     * The "updated" item must not claim isArchived as one of the changed
     * fields - the archive item already says that, in plain words.
     */
    expect(feedCalls[1]!.moreInformationInMarkdown).toContain("`name`");
    expect(feedCalls[1]!.moreInformationInMarkdown).not.toContain(
      "`isArchived`",
    );
  });

  test("writes one item per updated row on a bulk update", async () => {
    const secondId: ObjectID = ObjectID.generate();

    await service.writeKubernetesClusterUpdatedFeed(
      { updateBy: { data: { isArchived: true }, props: {} } },
      [CLUSTER_ID, secondId],
    );

    expect(feedCalls.length).toBe(2);
  });

  test("skips a row it can no longer resolve a project for", async () => {
    jest
      .spyOn(KubernetesClusterService, "findOneById")
      .mockImplementation((): Promise<KubernetesCluster | null> => {
        return Promise.resolve(null);
      });

    await service.writeKubernetesClusterUpdatedFeed(
      { updateBy: { data: { name: "gone" }, props: {} } },
      [CLUSTER_ID],
    );

    expect(feedCalls.length).toBe(0);
  });
});
