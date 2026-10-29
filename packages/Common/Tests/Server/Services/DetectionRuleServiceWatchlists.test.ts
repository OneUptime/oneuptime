import DetectionRuleService from "../../../Server/Services/DetectionRuleService";
import SecurityWatchlists from "../../../Server/Utils/SecurityEvent/Watchlists/SecurityWatchlists";
import DetectionRule from "../../../Models/DatabaseModels/DetectionRule";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import { SigmaWatchlist } from "../../../Types/SecurityEvent/SecurityWatchlist";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * A RULE THAT READS WATCHLISTS, AS IT IS SAVED: compiled with the project's
 * lists, so a list the project does not have is refused by name - at the
 * save, not as the rule's error at its first run - and a rule whose lists
 * one read of the events could not carry is refused with what to do. Every
 * project an update writes to must hold the lists.
 */

type Spy = ReturnType<typeof getJestSpyOn>;

type HookCaller = {
  onBeforeCreate: (
    createBy: CreateBy<DetectionRule>,
  ) => Promise<OnCreate<DetectionRule>>;
  onBeforeUpdate: (
    updateBy: UpdateBy<DetectionRule>,
  ) => Promise<OnUpdate<DetectionRule>>;
};

const service: HookCaller = DetectionRuleService as unknown as HookCaller;

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111112",
);

const VIP_RULE: string = `title: VIP sign-in
detection:
  selection:
    principalUser|expand: '%vip_users%'
  condition: selection
`;

const VIP_LIST: SigmaWatchlist = {
  name: "vip_users",
  entityType: SecurityEntityType.User,
  exactValues: ["alice"],
  patterns: [],
  ranges: [],
};

let loadLists: Spy;

beforeEach(() => {
  loadLists = getJestSpyOn(SecurityWatchlists, "load").mockResolvedValue(
    new Map([["vip_users", VIP_LIST]]) as never,
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

function rule(yaml: string, projectId?: ObjectID): DetectionRule {
  const model: DetectionRule = new DetectionRule();

  if (projectId) {
    model.projectId = projectId;
  }

  model.sigmaRuleYaml = yaml;
  return model;
}

describe("saving a rule that reads a watchlist", () => {
  test("a list the project has: the rule saves, its name from the title", async () => {
    const data: DetectionRule = rule(VIP_RULE, PROJECT_ID);

    await service.onBeforeCreate({ data, props: { isRoot: true } });

    expect(data.name).toBe("VIP sign-in");
    expect(loadLists).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      names: ["vip_users"],
    });
  });

  test("the project a create names, or the one it is made in", async () => {
    await service.onBeforeCreate({
      data: rule(VIP_RULE),
      props: { isRoot: true, tenantId: OTHER_PROJECT_ID },
    });

    expect(loadLists).toHaveBeenCalledWith({
      projectId: OTHER_PROJECT_ID,
      names: ["vip_users"],
    });
  });

  test("a list the project does not have is refused at the save, by name", async () => {
    loadLists.mockResolvedValue(new Map() as never);

    await expect(
      service.onBeforeCreate({
        data: rule(VIP_RULE, PROJECT_ID),
        props: { isRoot: true },
      }),
    ).rejects.toThrow(
      "There is no watchlist named vip_users in this project. Create it under Security Events > Detections > Watchlists, or fix its name in the rule.",
    );
  });

  test("a rule that reads lists needs its project", async () => {
    await expect(
      service.onBeforeCreate({
        data: rule(VIP_RULE),
        props: { isRoot: true },
      }),
    ).rejects.toThrow(
      "A rule that reads watchlists needs the project it belongs to.",
    );
    expect(loadLists).not.toHaveBeenCalled();
  });

  test("a rule whose lists one read could not carry is refused with what to do", async () => {
    const values: Array<string> = [];

    for (let index: number = 0; index < 5000; index++) {
      values.push(`${"u".repeat(240)}${index}`);
    }

    loadLists.mockResolvedValue(
      new Map([["vip_users", { ...VIP_LIST, exactValues: values }]]) as never,
    );

    await expect(
      service.onBeforeCreate({
        data: rule(VIP_RULE, PROJECT_ID),
        props: { isRoot: true },
      }),
    ).rejects.toThrow(
      "This rule reads more watchlist values than one read can send to the database",
    );
  });

  test("a rule that reads no list asks for none", async () => {
    await service.onBeforeCreate({
      data: rule(
        "title: Plain\ndetection:\n  s:\n    statusName: Failure\n  condition: s\n",
        PROJECT_ID,
      ),
      props: { isRoot: true },
    });

    expect(loadLists).not.toHaveBeenCalled();
  });

  test("an update is checked against the lists of every project it writes to", async () => {
    const first: DetectionRule = rule(VIP_RULE, PROJECT_ID);
    first._id = "22222222-2222-4222-8222-222222222221";
    const second: DetectionRule = rule(VIP_RULE, OTHER_PROJECT_ID);
    second._id = "22222222-2222-4222-8222-222222222222";

    getJestSpyOn(
      DetectionRuleService,
      "findRowsAndHoldUpdateToThem",
    ).mockResolvedValue([first, second] as never);

    loadLists.mockImplementation(((data: { projectId: ObjectID }) => {
      return Promise.resolve(
        data.projectId.toString() === PROJECT_ID.toString()
          ? new Map([["vip_users", VIP_LIST]])
          : new Map(),
      );
    }) as never);

    await expect(
      service.onBeforeUpdate({
        query: {},
        data: { sigmaRuleYaml: VIP_RULE },
        props: { isRoot: true },
        limit: 2,
        skip: 0,
      }),
    ).rejects.toThrow(BadDataException);
    expect(loadLists).toHaveBeenCalledTimes(2);
  });

  test("an update that leaves the YAML alone reads no list", async () => {
    await service.onBeforeUpdate({
      query: {},
      data: { name: "Renamed" },
      props: { isRoot: true },
      limit: 1,
      skip: 0,
    });

    expect(loadLists).not.toHaveBeenCalled();
  });
});
