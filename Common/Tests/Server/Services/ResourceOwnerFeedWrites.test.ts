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

import KubernetesClusterOwnerUserService from "../../../Server/Services/KubernetesClusterOwnerUserService";
import KubernetesClusterOwnerTeamService from "../../../Server/Services/KubernetesClusterOwnerTeamService";
import KubernetesClusterFeedService from "../../../Server/Services/KubernetesClusterFeedService";
import KubernetesClusterService from "../../../Server/Services/KubernetesClusterService";
import UserService from "../../../Server/Services/UserService";
import TeamService from "../../../Server/Services/TeamService";
import KubernetesClusterOwnerUser from "../../../Models/DatabaseModels/KubernetesClusterOwnerUser";
import KubernetesClusterOwnerTeam from "../../../Models/DatabaseModels/KubernetesClusterOwnerTeam";
import { KubernetesClusterFeedEventType } from "../../../Models/DatabaseModels/KubernetesClusterFeed";
import Team from "../../../Models/DatabaseModels/Team";
import User from "../../../Models/DatabaseModels/User";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";

/*
 * Owners are the part of a resource's history people actually get paged about,
 * and until now nothing recorded when one changed: a Kubernetes cluster's
 * owner list showed who is on the hook today with no way to see who used to be
 * or who put them there. These four hooks are what write that history, and all
 * four are easy to lose - the delete pair in particular, because the rows are
 * already gone by the time onDeleteSuccess runs, so the ids have to be carried
 * forward from onBeforeDelete or the feed item silently never happens.
 */

const CLUSTER_ID: ObjectID = ObjectID.generate();
const PROJECT_ID: ObjectID = ObjectID.generate();
const USER_ID: ObjectID = ObjectID.generate();
const TEAM_ID: ObjectID = ObjectID.generate();
const ACTING_USER_ID: ObjectID = ObjectID.generate();

interface FeedCall {
  kubernetesClusterId: ObjectID;
  projectId: ObjectID;
  kubernetesClusterFeedEventType: KubernetesClusterFeedEventType;
  feedInfoInMarkdown: string;
  userId?: ObjectID | undefined;
}

let feedCalls: Array<FeedCall> = [];

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
        "[Kubernetes Cluster prod](https://example.com/cluster)",
      );
    });

  jest
    .spyOn(UserService, "getUserMarkdownString")
    .mockImplementation((): Promise<string> => {
      return Promise.resolve("Jane Doe (jane@example.com)");
    });
});

describe("KubernetesClusterOwnerUserService feed writes", () => {
  test("records the owner and who added them", async () => {
    const createdItem: KubernetesClusterOwnerUser =
      new KubernetesClusterOwnerUser();
    createdItem.kubernetesClusterId = CLUSTER_ID;
    createdItem.projectId = PROJECT_ID;
    createdItem.userId = USER_ID;

    await KubernetesClusterOwnerUserService.onCreateSuccess(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { createBy: { props: { userId: ACTING_USER_ID } } } as any,
      createdItem,
    );

    expect(feedCalls.length).toBe(1);
    expect(feedCalls[0]!.kubernetesClusterFeedEventType).toBe(
      KubernetesClusterFeedEventType.OwnerUserAdded,
    );
    expect(feedCalls[0]!.kubernetesClusterId).toBe(CLUSTER_ID);
    expect(feedCalls[0]!.feedInfoInMarkdown).toContain("Jane Doe");
    expect(feedCalls[0]!.feedInfoInMarkdown).toContain(
      "[Kubernetes Cluster prod](https://example.com/cluster)",
    );
    // Who did the adding, not who was added.
    expect(feedCalls[0]!.userId).toBe(ACTING_USER_ID);
  });

  test("writes nothing when the row is missing its cluster or user", async () => {
    const createdItem: KubernetesClusterOwnerUser =
      new KubernetesClusterOwnerUser();
    createdItem.projectId = PROJECT_ID;

    await KubernetesClusterOwnerUserService.onCreateSuccess(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { createBy: { props: {} } } as any,
      createdItem,
    );

    expect(feedCalls.length).toBe(0);
  });

  test("carries the deleted row forward so the removal can be described", async () => {
    /*
     * onDeleteSuccess runs after the rows are gone. Reading them in
     * onBeforeDelete is the only chance to learn which cluster and which user
     * the removal was about.
     */
    const doomed: KubernetesClusterOwnerUser = new KubernetesClusterOwnerUser();
    doomed.kubernetesClusterId = CLUSTER_ID;
    doomed.projectId = PROJECT_ID;
    doomed.userId = USER_ID;

    jest
      .spyOn(KubernetesClusterOwnerUserService, "findBy")
      .mockImplementation((): Promise<Array<KubernetesClusterOwnerUser>> => {
        return Promise.resolve([doomed]);
      });

    const user: User = new User(USER_ID);
    user.name = new Name("Jane Doe");

    jest
      .spyOn(UserService, "findOneById")
      .mockImplementation((): Promise<User | null> => {
        return Promise.resolve(user);
      });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service: any = KubernetesClusterOwnerUserService as any;

    const onDelete: unknown = await service.onBeforeDelete({
      query: {},
      props: { userId: ACTING_USER_ID },
    });

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    expect((onDelete as any).carryForward.itemsToDelete).toEqual([doomed]);

    await service.onDeleteSuccess(
      {
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        deleteBy: (onDelete as any).deleteBy,
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        carryForward: (onDelete as any).carryForward,
      },
      [],
    );

    expect(feedCalls.length).toBe(1);
    expect(feedCalls[0]!.kubernetesClusterFeedEventType).toBe(
      KubernetesClusterFeedEventType.OwnerUserRemoved,
    );
    expect(feedCalls[0]!.feedInfoInMarkdown).toContain("Jane Doe");
    expect(feedCalls[0]!.userId).toBe(ACTING_USER_ID);
  });
});

describe("KubernetesClusterOwnerTeamService feed writes", () => {
  test("records the team that was added", async () => {
    const team: Team = new Team(TEAM_ID);
    team.name = "Platform";

    jest
      .spyOn(TeamService, "findOneById")
      .mockImplementation((): Promise<Team | null> => {
        return Promise.resolve(team);
      });

    const createdItem: KubernetesClusterOwnerTeam =
      new KubernetesClusterOwnerTeam();
    createdItem.kubernetesClusterId = CLUSTER_ID;
    createdItem.projectId = PROJECT_ID;
    createdItem.teamId = TEAM_ID;

    await KubernetesClusterOwnerTeamService.onCreateSuccess(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { createBy: { props: { userId: ACTING_USER_ID } } } as any,
      createdItem,
    );

    expect(feedCalls.length).toBe(1);
    expect(feedCalls[0]!.kubernetesClusterFeedEventType).toBe(
      KubernetesClusterFeedEventType.OwnerTeamAdded,
    );
    expect(feedCalls[0]!.feedInfoInMarkdown).toContain("Platform");
  });

  test("records the team that was removed", async () => {
    const team: Team = new Team(TEAM_ID);
    team.name = "Platform";

    jest
      .spyOn(TeamService, "findOneById")
      .mockImplementation((): Promise<Team | null> => {
        return Promise.resolve(team);
      });

    const doomed: KubernetesClusterOwnerTeam = new KubernetesClusterOwnerTeam();
    doomed.kubernetesClusterId = CLUSTER_ID;
    doomed.projectId = PROJECT_ID;
    doomed.teamId = TEAM_ID;

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const service: any = KubernetesClusterOwnerTeamService as any;

    await service.onDeleteSuccess(
      {
        deleteBy: { props: { userId: ACTING_USER_ID } },
        carryForward: { itemsToDelete: [doomed] },
      },
      [],
    );

    expect(feedCalls.length).toBe(1);
    expect(feedCalls[0]!.kubernetesClusterFeedEventType).toBe(
      KubernetesClusterFeedEventType.OwnerTeamRemoved,
    );
    expect(feedCalls[0]!.feedInfoInMarkdown).toContain("Platform");
  });
});
