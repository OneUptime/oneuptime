import Project from "../../../../../Models/DatabaseModels/Project";
import ProjectService from "../../../../../Server/Services/ProjectService";
import DataSecurityAiCall from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityAiCall";
import DataSecurityIssueGroupNaming, {
  MAX_GROUP_NAMES_PER_RUN,
} from "../../../../../Server/Utils/AI/DataSecurity/DataSecurityIssueGroupNaming";
import DataSecurityIssueGrouper from "../../../../../Server/Utils/DataSecurity/DataSecurityIssueGrouper";
import ProjectLanguage from "../../../../../Server/Utils/Notification/ProjectLanguage";
import { DataSecurityAiFeature } from "../../../../../Types/DataSecurity/DataSecurityAiFeatures";
import {
  getIssueGroupNameFactsHash,
  readDataSecurityIssueGroupFacts,
} from "../../../../../Types/DataSecurity/DataSecurityIssueGroup";
import ObjectID from "../../../../../Types/ObjectID";
import { installGroupFixStubs } from "../../DataSecurity/IssueGroupFixStubs";
import IssueGroupsWorld, {
  WorldGroup,
} from "../../DataSecurity/IssueGroupsWorld";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ONEUPTIME AI NAMES EACH GROUP OF ISSUES FROM ITS FACTS ALONE (#10370):
 * only while the project's AI works on its issues, never told a store's
 * name, once per facts, and a name that says what the facts do not is
 * dropped.
 */

interface Asked {
  feature: string;
  text: string;
  protectRequestParameters?: boolean | undefined;
}

let world: IssueGroupsWorld;
let asked: Array<Asked>;
let answer: string;
let project: { enableAi: boolean; enableAutomaticDataSecurityAi: boolean };

async function group(): Promise<void> {
  await DataSecurityIssueGrouper.groupProject({
    projectId: new ObjectID(world.projectId),
  });
}

async function nameAll(): Promise<number> {
  return await DataSecurityIssueGroupNaming.nameGroups({
    projectId: new ObjectID(world.projectId),
    groupIds: world.groups.map((row: WorldGroup): ObjectID => {
      return new ObjectID(row.id);
    }),
  });
}

function moduleBuckets(count: number, module: string = "static-site"): void {
  for (let index: number = 1; index <= count; index++) {
    world.addStoreWithIssue({
      name: `${module}-${index}-assets`,
      cloudTags: { module, "managed-by": "terraform" },
    });
  }
}

beforeEach(() => {
  world = new IssueGroupsWorld();
  world.install();
  installGroupFixStubs();
  // The grouping's own naming is the real one in this file.
  (
    DataSecurityIssueGroupNaming.nameGroups as unknown as {
      mockRestore: () => void;
    }
  ).mockRestore();
  jest
    .spyOn(DataSecurityIssueGroupNaming, "nameGroups")
    .mockResolvedValueOnce(0 as never);
  asked = [];
  answer = JSON.stringify({
    name: "the static-site module turns off access logs",
    facts: ["F1", "F2"],
  });
  project = { enableAi: true, enableAutomaticDataSecurityAi: true };

  jest.spyOn(ProjectService, "findOneById").mockImplementation((async () => {
    const row: Project = new Project();

    row.enableAi = project.enableAi;
    row.enableAutomaticDataSecurityAi = project.enableAutomaticDataSecurityAi;

    return row;
  }) as never);
  jest.spyOn(ProjectLanguage, "getLanguage").mockResolvedValue("en" as never);
  jest.spyOn(DataSecurityAiCall, "ask").mockImplementation((async (request: {
    prompt: {
      feature: string;
      messages: Array<{ content: string }>;
    };
    protectRequestParameters?: boolean;
  }) => {
    asked.push({
      feature: request.prompt.feature,
      text: request.prompt.messages
        .map((message: { content: string }): string => {
          return message.content;
        })
        .join("\n"),
      protectRequestParameters: request.protectRequestParameters,
    });

    return { content: answer };
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("naming a group", () => {
  test("asks once, from the group's facts, never a store's name, and keeps the name with what it was written from", async () => {
    moduleBuckets(5);
    await group();

    expect(await nameAll()).toBe(1);
    expect(asked).toHaveLength(1);
    expect(asked[0]!.feature).toBe(DataSecurityAiFeature.NameIssueGroup);
    expect(asked[0]!.protectRequestParameters).toBe(true);
    expect(asked[0]!.text).toContain("static-site");
    expect(asked[0]!.text).not.toContain("static-site-1-assets");

    const named: WorldGroup = world.groups[0]!;

    expect(named.name).toBe("the static-site module turns off access logs");
    expect(named.nameLanguage).toBe("en");
    expect(named.nameFactsHash).toBe(
      getIssueGroupNameFactsHash(
        readDataSecurityIssueGroupFacts(named.facts)!,
        "en",
      ),
    );

    // Nothing it rests on changed: it is not asked again.
    expect(await nameAll()).toBe(0);
    expect(asked).toHaveLength(1);
  });

  test("a name that says what the facts do not - a store's name - is dropped, and the group goes by its cause", async () => {
    moduleBuckets(3);
    await group();
    answer = JSON.stringify({
      name: "static-site-2-assets and friends are public",
      facts: ["F1"],
    });

    await nameAll();

    expect(world.groups[0]!.name).toBeNull();
    // Written all the same, so the same facts are not asked about again.
    expect(world.groups[0]!.nameFactsHash).toBeTruthy();
  });

  test("an answer that names no fact it rests on is dropped", async () => {
    moduleBuckets(3);
    await group();
    answer = JSON.stringify({ name: "the static-site module", facts: [] });

    await nameAll();

    expect(world.groups[0]!.name).toBeNull();
  });

  test("a call that fails keeps nothing, and is asked again the next run", async () => {
    moduleBuckets(3);
    await group();
    jest
      .spyOn(DataSecurityAiCall, "ask")
      .mockRejectedValueOnce(new Error("The provider is down.") as never);

    expect(await nameAll()).toBe(1);
    expect(world.groups[0]!.nameFactsHash).toBeNull();
    expect(await nameAll()).toBe(1);
    expect(world.groups[0]!.name).toBe(
      "the static-site module turns off access logs",
    );
  });

  test(`asks about at most ${MAX_GROUP_NAMES_PER_RUN} groups a run`, async () => {
    for (let index: number = 0; index < MAX_GROUP_NAMES_PER_RUN + 2; index++) {
      moduleBuckets(2, `module-${index}`);
    }

    await group();

    expect(world.groups).toHaveLength(MAX_GROUP_NAMES_PER_RUN + 2);
    expect(await nameAll()).toBe(MAX_GROUP_NAMES_PER_RUN);
  });
});

describe("with the project's AI off", () => {
  test("nothing is asked, with either switch off", async () => {
    moduleBuckets(3);
    await group();
    project = { enableAi: false, enableAutomaticDataSecurityAi: true };

    expect(await nameAll()).toBe(0);

    project = { enableAi: true, enableAutomaticDataSecurityAi: false };

    expect(await nameAll()).toBe(0);
    expect(asked).toHaveLength(0);
  });
});
