import DataAssetFeedService from "../../../../Server/Services/DataAssetFeedService";
import DataAssetOwnerRuleEngineService from "../../../../Server/Services/DataAssetOwnerRuleEngineService";
import DataAssetOwnerTeamService from "../../../../Server/Services/DataAssetOwnerTeamService";
import DataAssetOwnerUserService from "../../../../Server/Services/DataAssetOwnerUserService";
import DataAssetService from "../../../../Server/Services/DataAssetService";
import DataPipelineOwnerRuleEngineService from "../../../../Server/Services/DataPipelineOwnerRuleEngineService";
import DataPipelineOwnerTeamService from "../../../../Server/Services/DataPipelineOwnerTeamService";
import DataPipelineOwnerUserService from "../../../../Server/Services/DataPipelineOwnerUserService";
import DataPipelineService from "../../../../Server/Services/DataPipelineService";
import DataStoreFeedService from "../../../../Server/Services/DataStoreFeedService";
import DataStoreOwnerRuleEngineService from "../../../../Server/Services/DataStoreOwnerRuleEngineService";
import DataStoreOwnerTeamService from "../../../../Server/Services/DataStoreOwnerTeamService";
import DataStoreOwnerUserService from "../../../../Server/Services/DataStoreOwnerUserService";
import DataStoreService from "../../../../Server/Services/DataStoreService";
import DatabaseServerFeedService from "../../../../Server/Services/DatabaseServerFeedService";
import DatabaseServerOwnerRuleEngineService from "../../../../Server/Services/DatabaseServerOwnerRuleEngineService";
import DatabaseServerOwnerTeamService from "../../../../Server/Services/DatabaseServerOwnerTeamService";
import DatabaseServerOwnerUserService from "../../../../Server/Services/DatabaseServerOwnerUserService";
import DatabaseServerService from "../../../../Server/Services/DatabaseServerService";
import OpenStackCloudFeedService from "../../../../Server/Services/OpenStackCloudFeedService";
import OpenStackCloudOwnerRuleEngineService from "../../../../Server/Services/OpenStackCloudOwnerRuleEngineService";
import OpenStackCloudOwnerTeamService from "../../../../Server/Services/OpenStackCloudOwnerTeamService";
import OpenStackCloudOwnerUserService from "../../../../Server/Services/OpenStackCloudOwnerUserService";
import OpenStackCloudService from "../../../../Server/Services/OpenStackCloudService";
import StorageArrayFeedService from "../../../../Server/Services/StorageArrayFeedService";
import StorageArrayOwnerRuleEngineService from "../../../../Server/Services/StorageArrayOwnerRuleEngineService";
import StorageArrayOwnerTeamService from "../../../../Server/Services/StorageArrayOwnerTeamService";
import StorageArrayOwnerUserService from "../../../../Server/Services/StorageArrayOwnerUserService";
import StorageArrayService from "../../../../Server/Services/StorageArrayService";
import TeamMemberService from "../../../../Server/Services/TeamMemberService";
import { ProjectScopedReferenceException } from "../../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import logger from "../../../../Server/Utils/Logger";
import {
  RuleApplicationResult,
  RuleApplicationResultUtil,
  RuleRunEngine,
} from "../../../../Server/Utils/Rules/RuleRun/RuleApplication";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ObjectID from "../../../../Types/ObjectID";
import FeedMarkdown from "../../../../Utils/Markdown/FeedMarkdown";
import { stubProjectDirectory } from "../../TestingUtils/ProjectDirectory";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * #9933: A RESOURCE'S OWNER RULE IS CREDITED ONLY WITH THE OWNERS IT ADDED.
 *
 * The owner rules of data assets, data pipelines, data stores, database
 * servers, OpenStack clouds and storage arrays - the resource engines the
 * Run now suites of groups A and B do not cover - add owners one at a time,
 * and createOwner skips a user who has left the project and a team that is
 * not one of its teams. A run whose matched rules named only such owners
 * used to report "already applied" (the run's summary then said the
 * resource had the rules' owners), and the feed item - "Owners were added to
 * <resource> by 2 owner rules" - credited every matched rule that named an
 * owner. A run whose every owner was skipped is one it could not update now,
 * with the skipped logged by id, and the feed credits only the rules that
 * added someone. Every case runs against all six.
 */

// Services are spied on generically; their concrete types differ per engine.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SpiedService = any;

interface ResourceCase {
  name: string;
  engine: RuleRunEngine<BaseModel, BaseModel>;
  resourceService: SpiedService;
  ownerUserService: SpiedService;
  ownerTeamService: SpiedService;
  // The feed item crediting the rules, for the engines that write one.
  feed: { service: SpiedService; method: string; linkMethod: string } | null;
  // Anything else a run writes, stood in for.
  prepare: () => void;
}

function asEngine(engine: unknown): RuleRunEngine<BaseModel, BaseModel> {
  return engine as RuleRunEngine<BaseModel, BaseModel>;
}

function nothingElse(): void {
  // A run of this engine writes nothing beyond its owners and its feed.
}

const CASES: Array<ResourceCase> = [
  {
    name: "data asset",
    engine: asEngine(DataAssetOwnerRuleEngineService),
    resourceService: DataAssetService,
    ownerUserService: DataAssetOwnerUserService,
    ownerTeamService: DataAssetOwnerTeamService,
    feed: {
      service: DataAssetFeedService,
      method: "createDataAssetFeedItem",
      linkMethod: "getDataAssetMarkdownLink",
    },
    prepare: nothingElse,
  },
  {
    name: "data pipeline",
    engine: asEngine(DataPipelineOwnerRuleEngineService),
    resourceService: DataPipelineService,
    ownerUserService: DataPipelineOwnerUserService,
    ownerTeamService: DataPipelineOwnerTeamService,
    feed: null,
    prepare: nothingElse,
  },
  {
    name: "data store",
    engine: asEngine(DataStoreOwnerRuleEngineService),
    resourceService: DataStoreService,
    ownerUserService: DataStoreOwnerUserService,
    ownerTeamService: DataStoreOwnerTeamService,
    feed: {
      service: DataStoreFeedService,
      method: "createDataStoreFeedItem",
      linkMethod: "getDataStoreMarkdownLink",
    },
    prepare: nothingElse,
  },
  {
    name: "database server",
    engine: asEngine(DatabaseServerOwnerRuleEngineService),
    resourceService: DatabaseServerService,
    ownerUserService: DatabaseServerOwnerUserService,
    ownerTeamService: DatabaseServerOwnerTeamService,
    feed: {
      service: DatabaseServerFeedService,
      method: "createDatabaseServerFeedItem",
      linkMethod: "getDatabaseServerMarkdownLink",
    },
    prepare: (): void => {
      // The owners a rule adds are recorded as automatic, in raw SQL.
      jest
        .spyOn(DatabaseServerService, "recordAutomaticAssignments")
        .mockResolvedValue(undefined as never);
    },
  },
  {
    name: "OpenStack cloud",
    engine: asEngine(OpenStackCloudOwnerRuleEngineService),
    resourceService: OpenStackCloudService,
    ownerUserService: OpenStackCloudOwnerUserService,
    ownerTeamService: OpenStackCloudOwnerTeamService,
    feed: {
      service: OpenStackCloudFeedService,
      method: "createOpenStackCloudFeedItem",
      linkMethod: "getOpenStackCloudMarkdownLink",
    },
    prepare: nothingElse,
  },
  {
    name: "storage array",
    engine: asEngine(StorageArrayOwnerRuleEngineService),
    resourceService: StorageArrayService,
    ownerUserService: StorageArrayOwnerUserService,
    ownerTeamService: StorageArrayOwnerTeamService,
    feed: {
      service: StorageArrayFeedService,
      method: "createStorageArrayFeedItem",
      linkMethod: "getStorageArrayMarkdownLink",
    },
    prepare: nothingElse,
  },
];

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const RESOURCE_ID: ObjectID = new ObjectID(
  "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
);
const RULE_ID: ObjectID = new ObjectID("77777777-7777-4777-8777-777777777777");
const SECOND_RULE_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);
// A member of the project.
const MEMBER_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
// Someone who has left the project.
const DEPARTED_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const TEAM_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");
// A team of another project, still on a rule saved before lists were checked.
const FOREIGN_TEAM_ID: ObjectID = new ObjectID(
  "abababab-abab-4bab-8bab-abababababab",
);

function ref(id: ObjectID): BaseModel {
  return { id: id, _id: id.toString() } as unknown as BaseModel;
}

function rule(data: {
  id?: ObjectID | undefined;
  name?: string | undefined;
  users?: Array<ObjectID> | undefined;
  teams?: Array<ObjectID> | undefined;
}): BaseModel {
  const id: ObjectID = data.id || RULE_ID;

  // No criteria: a rule that sets none matches every resource.
  return {
    id: id,
    _id: id.toString(),
    projectId: PROJECT_ID,
    name: data.name || "Production owners",
    notifyOwners: true,
    ownerUsers: (data.users || []).map(ref),
    ownerTeams: (data.teams || []).map(ref),
  } as unknown as BaseModel;
}

// An owner row as OwnerRuleAssignment reads it back: only the id column.
function existingOwnerRow(column: string, id: ObjectID): BaseModel {
  return {
    getColumnValue: (key: string): unknown => {
      return key === column ? id : undefined;
    },
  } as unknown as BaseModel;
}

interface Run {
  result: RuleApplicationResult;
  userWrites: Array<string>;
  teamWrites: Array<string>;
  feed: jest.SpyInstance | null;
  warned: jest.SpyInstance;
}

async function runRules(
  c: ResourceCase,
  rules: Array<BaseModel>,
  data: {
    existingUserIds?: Array<ObjectID> | undefined;
    existingTeamIds?: Array<ObjectID> | undefined;
  } = {},
): Promise<Run> {
  jest.spyOn(c.resourceService, "findOneById").mockResolvedValue({
    id: RESOURCE_ID,
    _id: RESOURCE_ID.toString(),
    projectId: PROJECT_ID,
    name: "prod-core-01",
    description: "Primary production core",
    labels: [],
  });

  jest.spyOn(c.ownerUserService, "findBy").mockResolvedValue(
    (data.existingUserIds || []).map((id: ObjectID): BaseModel => {
      return existingOwnerRow("userId", id);
    }),
  );
  jest.spyOn(c.ownerTeamService, "findBy").mockResolvedValue(
    (data.existingTeamIds || []).map((id: ObjectID): BaseModel => {
      return existingOwnerRow("teamId", id);
    }),
  );

  const userWrites: Array<string> = [];
  const teamWrites: Array<string> = [];

  jest
    .spyOn(c.ownerUserService, "create")
    .mockImplementation(async (...args: Array<unknown>): Promise<BaseModel> => {
      const createBy: { data: BaseModel } = args[0] as { data: BaseModel };

      userWrites.push(String(createBy.data.getColumnValue("userId")));
      return createBy.data;
    });

  // The owner service refuses another project's team, as its reference check does.
  jest
    .spyOn(c.ownerTeamService, "create")
    .mockImplementation(async (...args: Array<unknown>): Promise<BaseModel> => {
      const createBy: { data: BaseModel } = args[0] as { data: BaseModel };
      const teamId: string = String(createBy.data.getColumnValue("teamId"));

      if (teamId === FOREIGN_TEAM_ID.toString()) {
        throw new ProjectScopedReferenceException(
          `This owner team references records that are not in this project: Team "${teamId}". Please pick values from this project and try again.`,
        );
      }

      teamWrites.push(teamId);
      return createBy.data;
    });

  let feed: jest.SpyInstance | null = null;

  if (c.feed) {
    jest
      .spyOn(c.resourceService, c.feed.linkMethod)
      .mockResolvedValue(FeedMarkdown.asMarkdown("[prod-core-01](/resource)"));
    feed = jest
      .spyOn(c.feed.service, c.feed.method)
      .mockResolvedValue(undefined as never);
  }

  // The member is one; the one who left is not.
  jest
    .spyOn(TeamMemberService, "isUserMemberOfProject")
    .mockImplementation(async (asked: { userId: ObjectID }) => {
      return asked.userId.toString() === MEMBER_ID.toString();
    });

  const warned: jest.SpyInstance = jest
    .spyOn(logger, "warn")
    .mockImplementation(() => {});

  c.prepare();

  const result: RuleApplicationResult =
    await c.engine.applyRulesToExistingResource({
      resource: {
        id: RESOURCE_ID,
        _id: RESOURCE_ID.toString(),
        projectId: PROJECT_ID,
      } as unknown as BaseModel,
      rules: rules,
      allowOwnerNotification: true,
    });

  return { result, userWrites, teamWrites, feed, warned };
}

function feedItem(run: Run): {
  feedInfoInMarkdown: string;
  moreInformationInMarkdown: string;
} {
  return run.feed!.mock.calls[0]![0] as {
    feedInfoInMarkdown: string;
    moreInformationInMarkdown: string;
  };
}

beforeEach(() => {
  jest.spyOn(logger, "error").mockImplementation(() => {});
  jest.spyOn(logger, "debug").mockImplementation(() => {});
  // The rules' teams and records are the project's but for FOREIGN_TEAM_ID.
  stubProjectDirectory({});
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(CASES)(
  "the $name owner rule engine credits only the rules that added someone",
  (c: ResourceCase) => {
    it("counts the rule that names a member, and not the one that names only someone who left", async () => {
      const run: Run = await runRules(c, [
        rule({ users: [MEMBER_ID] }),
        rule({ id: SECOND_RULE_ID, name: "Leavers", users: [DEPARTED_ID] }),
      ]);

      expect(run.result).toEqual(RuleApplicationResultUtil.updated(1));
      expect(run.userWrites).toEqual([MEMBER_ID.toString()]);

      if (run.feed) {
        expect(run.feed).toHaveBeenCalledTimes(1);
        expect(feedItem(run).feedInfoInMarkdown).toContain("by 1 owner rule.");
        expect(feedItem(run).moreInformationInMarkdown).toContain(
          "Production owners",
        );
        expect(feedItem(run).moreInformationInMarkdown).not.toContain(
          "Leavers",
        );
      }

      expect(run.warned).toHaveBeenCalledTimes(1);
      expect(String(run.warned.mock.calls[0]![0])).toContain(
        `user ${DEPARTED_ID.toString()} (NotProjectMember)`,
      );
    });

    it("does not credit the rule whose only owner was there already", async () => {
      const run: Run = await runRules(
        c,
        [
          rule({ users: [MEMBER_ID] }),
          rule({ id: SECOND_RULE_ID, name: "Already there", teams: [TEAM_ID] }),
        ],
        { existingTeamIds: [TEAM_ID] },
      );

      expect(run.result).toEqual(RuleApplicationResultUtil.updated(1));

      if (run.feed) {
        expect(feedItem(run).feedInfoInMarkdown).toContain("by 1 owner rule.");
        expect(feedItem(run).moreInformationInMarkdown).not.toContain(
          "Already there",
        );
      }

      expect(run.warned).not.toHaveBeenCalled();
    });

    it("credits every rule that names an owner it added", async () => {
      const run: Run = await runRules(c, [
        rule({ users: [MEMBER_ID] }),
        rule({ id: SECOND_RULE_ID, name: "Second rule", users: [MEMBER_ID] }),
      ]);

      // One owner, named by both.
      expect(run.result).toEqual(RuleApplicationResultUtil.updated(1));

      if (run.feed) {
        expect(feedItem(run).feedInfoInMarkdown).toContain("by 2 owner rules.");
        expect(feedItem(run).moreInformationInMarkdown).toContain(
          "Second rule",
        );
      }
    });

    it("is a resource it could not update - never already applied - when every owner was skipped", async () => {
      const run: Run = await runRules(c, [
        rule({ users: [DEPARTED_ID], teams: [FOREIGN_TEAM_ID] }),
      ]);

      expect(run.result).toEqual(RuleApplicationResultUtil.failed());
      expect(run.result).not.toEqual(
        RuleApplicationResultUtil.alreadyApplied(),
      );
      expect(run.userWrites).toEqual([]);
      expect(run.teamWrites).toEqual([]);

      if (run.feed) {
        expect(run.feed).not.toHaveBeenCalled();
      }

      expect(run.warned).toHaveBeenCalledTimes(1);
      const line: string = String(run.warned.mock.calls[0]![0]);
      expect(line).toContain(
        `user ${DEPARTED_ID.toString()} (NotProjectMember)`,
      );
      expect(line).toContain(
        `team ${FOREIGN_TEAM_ID.toString()} (NotProjectRecord)`,
      );
    });

    it("still says already applied, and warns of nothing, when every owner is there", async () => {
      const run: Run = await runRules(
        c,
        [rule({ users: [MEMBER_ID], teams: [TEAM_ID] })],
        { existingUserIds: [MEMBER_ID], existingTeamIds: [TEAM_ID] },
      );

      expect(run.result).toEqual(RuleApplicationResultUtil.alreadyApplied());
      expect(run.warned).not.toHaveBeenCalled();

      if (run.feed) {
        expect(run.feed).not.toHaveBeenCalled();
      }
    });
  },
);
