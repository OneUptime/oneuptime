import fs from "fs";
import path from "path";
import { beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * PasswordHash carries a pre-existing TS5.9 diagnostic that fails any suite
 * whose runtime require graph reaches it, and DatabaseService - the base class
 * of every service below - imports it.
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

import KubernetesClusterFeedService from "../../../Server/Services/KubernetesClusterFeedService";
import KubernetesClusterFeed, {
  KubernetesClusterFeedEventType,
} from "../../../Models/DatabaseModels/KubernetesClusterFeed";
import { Blue500, Green500 } from "../../../Types/BrandColors";
import ObjectID from "../../../Types/ObjectID";

const SERVICES_DIRECTORY: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "Server",
  "Services",
);

const SERVICES_INDEX: string = fs.readFileSync(
  path.join(SERVICES_DIRECTORY, "Index.ts"),
  "utf8",
);

const BASE_API_INDEX: string = fs.readFileSync(
  path.join(
    __dirname,
    "..",
    "..",
    "..",
    "..",
    "App",
    "FeatureSet",
    "BaseAPI",
    "Index.ts",
  ),
  "utf8",
);

/*
 * The nine resources that gained an activity feed. Written out rather than
 * globbed so that adding a tenth is a deliberate edit here as well as a new
 * file - the wiring below is exactly what gets forgotten when a family is
 * added by copying another one.
 */
const FEED_SERVICE_NAMES: Array<string> = [
  "KubernetesClusterFeedService",
  "DockerHostFeedService",
  "DockerSwarmClusterFeedService",
  "CephClusterFeedService",
  "PodmanHostFeedService",
  "ProxmoxClusterFeedService",
  "HostFeedService",
  "CloudResourceFeedService",
  "ServiceFeedService",
];

function readService(serviceName: string): string {
  return fs.readFileSync(
    path.join(SERVICES_DIRECTORY, `${serviceName}.ts`),
    "utf8",
  );
}

describe("Resource feed service wiring", () => {
  test.each(FEED_SERVICE_NAMES)("%s exists on disk", (serviceName: string) => {
    expect(
      fs.existsSync(path.join(SERVICES_DIRECTORY, `${serviceName}.ts`)),
    ).toBe(true);
  });

  test.each(FEED_SERVICE_NAMES)(
    "%s is registered in Server/Services/Index.ts",
    (serviceName: string) => {
      /*
       * That array is what boot-time createTables() and the hard-delete job
       * iterate. An unregistered service has no table and its retention window
       * is dead configuration - see FeedRetentionConsistency.test.ts, written
       * after exactly that happened to OnCallDutyPolicyFeedService.
       */
      expect(SERVICES_INDEX).toContain(
        `import ${serviceName} from "./${serviceName}";`,
      );
      expect(SERVICES_INDEX).toMatch(
        new RegExp(`^\\s{2}${serviceName},$`, "m"),
      );
    },
  );

  test.each(FEED_SERVICE_NAMES)(
    "%s declares the common three year retention window",
    (serviceName: string) => {
      expect(readService(serviceName)).toContain(
        'this.hardDeleteItemsOlderThanInDays("createdAt", 3 * 365);',
      );
    },
  );

  test.each(FEED_SERVICE_NAMES)(
    "%s is served over the API",
    (serviceName: string) => {
      /*
       * The feed page reads through ModelAPI, so a model and service with no
       * BaseAPI router renders an empty feed and a 404 in the console rather
       * than failing anywhere a test would normally look.
       */
      const modelName: string = serviceName.replace(/Service$/, "");
      expect(BASE_API_INDEX).toContain(
        `import ${serviceName}, {\n  Service as ${serviceName}Type,\n} from "Common/Server/Services/${serviceName}";`,
      );
      expect(BASE_API_INDEX).toContain(
        `new BaseAPI<${modelName}, ${serviceName}Type>(`,
      );
    },
  );
});

describe("KubernetesClusterFeedService.createKubernetesClusterFeedItem", () => {
  const CLUSTER_ID: ObjectID = ObjectID.generate();
  const PROJECT_ID: ObjectID = ObjectID.generate();
  const USER_ID: ObjectID = ObjectID.generate();

  let created: Array<KubernetesClusterFeed> = [];

  beforeEach(() => {
    created = [];
    jest
      .spyOn(KubernetesClusterFeedService, "create")
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .mockImplementation((data: any): Promise<KubernetesClusterFeed> => {
        created.push(data.data as KubernetesClusterFeed);
        return Promise.resolve(data.data as KubernetesClusterFeed);
      });
  });

  test("writes the item with the event, colour and acting user", async () => {
    await KubernetesClusterFeedService.createKubernetesClusterFeedItem({
      kubernetesClusterId: CLUSTER_ID,
      projectId: PROJECT_ID,
      kubernetesClusterFeedEventType:
        KubernetesClusterFeedEventType.KubernetesClusterCreated,
      displayColor: Green500,
      feedInfoInMarkdown: "cluster created",
      moreInformationInMarkdown: "more",
      userId: USER_ID,
    });

    expect(created.length).toBe(1);
    const item: KubernetesClusterFeed = created[0]!;
    expect(item.kubernetesClusterId).toBe(CLUSTER_ID);
    expect(item.projectId).toBe(PROJECT_ID);
    expect(item.kubernetesClusterFeedEventType).toBe(
      KubernetesClusterFeedEventType.KubernetesClusterCreated,
    );
    expect(item.feedInfoInMarkdown).toBe("cluster created");
    expect(item.moreInformationInMarkdown).toBe("more");
    expect(item.userId).toBe(USER_ID);
    expect(item.displayColor).toBe(Green500);
  });

  test("stamps postedAt so the feed can be ordered by it", async () => {
    /*
     * The feed page sorts on postedAt, and the detail-page index is
     * (clusterId, postedAt). A row with a null postedAt sorts unpredictably
     * and can vanish from the middle of the timeline.
     */
    await KubernetesClusterFeedService.createKubernetesClusterFeedItem({
      kubernetesClusterId: CLUSTER_ID,
      projectId: PROJECT_ID,
      kubernetesClusterFeedEventType:
        KubernetesClusterFeedEventType.OwnerUserAdded,
      feedInfoInMarkdown: "owner added",
    });

    expect(created[0]!.postedAt).toBeInstanceOf(Date);
  });

  test("honours an explicit postedAt", async () => {
    const postedAt: Date = new Date("2024-01-15T10:30:00.000Z");

    await KubernetesClusterFeedService.createKubernetesClusterFeedItem({
      kubernetesClusterId: CLUSTER_ID,
      projectId: PROJECT_ID,
      kubernetesClusterFeedEventType:
        KubernetesClusterFeedEventType.OwnerUserAdded,
      feedInfoInMarkdown: "owner added",
      postedAt: postedAt,
    });

    expect(created[0]!.postedAt).toBe(postedAt);
  });

  test("defaults the colour so the timeline never renders a colourless dot", async () => {
    await KubernetesClusterFeedService.createKubernetesClusterFeedItem({
      kubernetesClusterId: CLUSTER_ID,
      projectId: PROJECT_ID,
      kubernetesClusterFeedEventType:
        KubernetesClusterFeedEventType.OwnerUserAdded,
      feedInfoInMarkdown: "owner added",
    });

    expect(created[0]!.displayColor).toBe(Blue500);
  });

  test.each([
    ["kubernetesClusterId", { kubernetesClusterId: undefined }],
    ["projectId", { projectId: undefined }],
    ["feedInfoInMarkdown", { feedInfoInMarkdown: "" }],
  ])(
    "writes nothing, and does not throw, when %s is missing",
    async (_name: string, override: Record<string, unknown>) => {
      /*
       * Every caller is a side effect of a write that already succeeded - an
       * owner being added, a cluster being created. Throwing here would roll
       * back or fail the thing the feed is merely describing.
       */
      await expect(
        KubernetesClusterFeedService.createKubernetesClusterFeedItem({
          kubernetesClusterId: CLUSTER_ID,
          projectId: PROJECT_ID,
          kubernetesClusterFeedEventType:
            KubernetesClusterFeedEventType.OwnerUserAdded,
          feedInfoInMarkdown: "owner added",
          ...override,
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
        } as any),
      ).resolves.toBeUndefined();

      expect(created.length).toBe(0);
    },
  );

  test("swallows a failing write rather than failing its caller", async () => {
    jest
      .spyOn(KubernetesClusterFeedService, "create")
      .mockImplementation((): Promise<KubernetesClusterFeed> => {
        return Promise.reject(new Error("postgres is down"));
      });

    await expect(
      KubernetesClusterFeedService.createKubernetesClusterFeedItem({
        kubernetesClusterId: CLUSTER_ID,
        projectId: PROJECT_ID,
        kubernetesClusterFeedEventType:
          KubernetesClusterFeedEventType.OwnerUserAdded,
        feedInfoInMarkdown: "owner added",
      }),
    ).resolves.toBeUndefined();
  });
});
