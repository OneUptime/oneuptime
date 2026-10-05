import DatabaseBaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import HostOwnerRule from "../../../../Models/DatabaseModels/HostOwnerRule";
import HostOwnerTeam from "../../../../Models/DatabaseModels/HostOwnerTeam";
import IncidentGroupingRule from "../../../../Models/DatabaseModels/IncidentGroupingRule";
import Label from "../../../../Models/DatabaseModels/Label";
import StatusPageMonitorRule from "../../../../Models/DatabaseModels/StatusPageMonitorRule";
import Team from "../../../../Models/DatabaseModels/Team";
import User from "../../../../Models/DatabaseModels/User";
import DatabaseService from "../../../../Server/Services/DatabaseService";
import HostOwnerRuleService from "../../../../Server/Services/HostOwnerRuleService";
import HostOwnerTeamService from "../../../../Server/Services/HostOwnerTeamService";
import CreateBy from "../../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../../Server/Types/Database/UpdateBy";
import ProjectReferenceCheck, {
  ProjectReferenceColumn,
} from "../../../../Server/Utils/Database/ProjectReferenceCheck";
import ProjectScopedReferenceValidator, {
  ProjectScopedReferenceException,
} from "../../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../Types/Exception/BadDataException";
import ObjectID from "../../../../Types/ObjectID";
import {
  ProjectDirectoryStub,
  stubProjectDirectory,
} from "../../TestingUtils/ProjectDirectory";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * ProjectReferenceCheck reads a record's references from its model's column
 * metadata - every many-to-many list and every single relation, but the
 * record's own project and who created or deleted it - and checks each
 * against the record's project through ProjectScopedReferenceValidator. Rule
 * and owner services run it from their create and update hooks
 * (ProjectReferencesService).
 *
 * The directory is stubbed (ProjectDirectory): which ids are records of a
 * project, and who is a member of it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "4af3a31b-58b0-4746-8025-f9cd4db1945e",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "3376855b-361c-427c-8982-bad7ada30414",
);
const RULE_ID: string = "0c1d2e3f-0000-4000-8000-0000000000a1";

const OWN_LABEL: string = "1abe1000-0000-4000-8000-000000000001";
const FOREIGN_LABEL: string = "1abe1000-0000-4000-8000-0000000000ff";
const OWN_TEAM: string = "7ea00000-0000-4000-8000-000000000001";
const FOREIGN_TEAM: string = "7ea00000-0000-4000-8000-0000000000ff";
const SECOND_FOREIGN_TEAM: string = "7ea00000-0000-4000-8000-0000000000fe";
const OWN_HOST: string = "0b5e0000-0000-4000-8000-000000000001";
const FOREIGN_HOST: string = "0b5e0000-0000-4000-8000-0000000000ff";
const MEMBER: string = "05e40000-0000-4000-8000-000000000001";
const STRANGER: string = "05e40000-0000-4000-8000-0000000000ff";

const USER_PROPS: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: new ObjectID(MEMBER),
};

function stub<T extends DatabaseBaseModel>(ctor: new () => T, id: string): T {
  const model: T = new ctor();
  model._id = id;
  return model;
}

function ownerRule(values: Record<string, unknown>): HostOwnerRule {
  const rule: HostOwnerRule = new HostOwnerRule();
  Object.assign(rule, values);
  return rule;
}

function createOf<T extends DatabaseBaseModel>(
  data: T,
  props: DatabaseCommonInteractionProps = USER_PROPS,
): CreateBy<T> {
  return { data: data, props: props } as CreateBy<T>;
}

function updateOf<T extends DatabaseBaseModel>(
  data: Record<string, unknown>,
  props: DatabaseCommonInteractionProps = USER_PROPS,
): UpdateBy<T> {
  return {
    query: { _id: RULE_ID },
    data: data,
    props: props,
    limit: 1,
    skip: 0,
  } as unknown as UpdateBy<T>;
}

async function refusalOf(promise: Promise<unknown>): Promise<string> {
  try {
    await promise;
  } catch (error) {
    expect(error).toBeInstanceOf(ProjectScopedReferenceException);
    expect(error).toBeInstanceOf(BadDataException);
    return (error as Error).message;
  }

  throw new Error("The write was not refused.");
}

function refusal(subject: string, described: Array<string>): string {
  return `This ${subject} references records that are not in this project: ${described.join(", ")}. Please pick values from this project and try again.`;
}

let directory: ProjectDirectoryStub;

beforeEach(() => {
  directory = stubProjectDirectory({
    projectId: PROJECT_ID,
    records: {
      Label: [OWN_LABEL],
      Team: [OWN_TEAM],
      Host: [OWN_HOST],
    },
    members: [MEMBER],
  });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("ProjectReferenceCheck.getReferenceColumns", () => {
  test("reads a rule's lists from its metadata: labels, owner users and owner teams", () => {
    const columns: Array<ProjectReferenceColumn> =
      ProjectReferenceCheck.getReferenceColumns(new HostOwnerRule());

    expect(
      columns.map((column: ProjectReferenceColumn) => {
        return [column.column, column.isList, column.modelName];
      }),
    ).toEqual([
      ["hostLabels", true, "Host Labels"],
      ["ownerUsers", true, "Owner Users"],
      ["ownerTeams", true, "Owner Teams"],
    ]);

    const services: Array<unknown> = columns.map(
      (column: ProjectReferenceColumn) => {
        return column.service;
      },
    );

    expect(services).toEqual([
      ProjectScopedReferenceValidator.getLookupService(Label),
      ProjectScopedReferenceValidator.getLookupService(User),
      ProjectScopedReferenceValidator.getLookupService(Team),
    ]);
  });

  test("reads an owner row's team and resource, with their id columns, and never its project or audit users", () => {
    const columns: Array<ProjectReferenceColumn> =
      ProjectReferenceCheck.getReferenceColumns(new HostOwnerTeam());

    expect(
      columns.map((column: ProjectReferenceColumn) => {
        return [column.column, column.idColumn, column.isList];
      }),
    ).toEqual([
      ["team", "teamId", false],
      ["host", "hostId", false],
    ]);
  });

  test("covers a rule's old single relations too", () => {
    const columns: Array<string> = ProjectReferenceCheck.getReferenceColumns(
      new IncidentGroupingRule(),
    ).map((column: ProjectReferenceColumn): string => {
      return column.column;
    });

    expect(columns).toEqual(
      expect.arrayContaining([
        "monitors",
        "onCallDutyPolicies",
        "episodeLabels",
        "episodeOwnerUsers",
        "episodeOwnerTeams",
        "episodeMemberRoles",
        "defaultAssignToUser",
        "defaultAssignToTeam",
      ]),
    );
    expect(columns).not.toContain("project");
    expect(columns).not.toContain("createdByUser");
    expect(columns).not.toContain("deletedByUser");
  });

  test("reads a model once", () => {
    expect(ProjectReferenceCheck.getReferenceColumns(new HostOwnerRule())).toBe(
      ProjectReferenceCheck.getReferenceColumns(new HostOwnerRule()),
    );
  });

  test("leaves out the relations a service checks itself, never a list", () => {
    const columns: Array<string> = ProjectReferenceCheck.getCheckedColumns(
      new StatusPageMonitorRule(),
      ["statusPage", "statusPageGroup", "monitorLabels"],
    ).map((column: ProjectReferenceColumn): string => {
      return column.column;
    });

    expect(columns).toEqual(["monitorLabels"]);
  });
});

describe("ProjectReferenceCheck.getWrittenIds", () => {
  test("reads a list in every shape it arrives in, each id once in any case", () => {
    const column: ProjectReferenceColumn =
      ProjectReferenceCheck.getReferenceColumns(new HostOwnerRule()).find(
        (entry: ProjectReferenceColumn): boolean => {
          return entry.column === "ownerTeams";
        },
      )!;

    expect(
      ProjectReferenceCheck.getWrittenIds(
        {
          ownerTeams: [
            stub(Team, OWN_TEAM),
            { _id: FOREIGN_TEAM },
            new ObjectID(SECOND_FOREIGN_TEAM),
            OWN_TEAM.toUpperCase(),
            "",
          ],
        },
        column,
      ),
    ).toEqual([OWN_TEAM, FOREIGN_TEAM, SECOND_FOREIGN_TEAM]);
  });

  test("reads a relation and its id column both, since the relation wins over the column", () => {
    const column: ProjectReferenceColumn =
      ProjectReferenceCheck.getReferenceColumns(new HostOwnerTeam()).find(
        (entry: ProjectReferenceColumn): boolean => {
          return entry.column === "team";
        },
      )!;

    expect(
      ProjectReferenceCheck.getWrittenIds(
        { team: { _id: FOREIGN_TEAM }, teamId: new ObjectID(OWN_TEAM) },
        column,
      ),
    ).toEqual([FOREIGN_TEAM, OWN_TEAM]);
  });
});

describe("ProjectReferenceCheck.validateCreate", () => {
  test("lets a rule through whose every reference is the project's", async () => {
    await expect(
      ProjectReferenceCheck.validateCreate({
        service: HostOwnerRuleService,
        createBy: createOf(
          ownerRule({
            hostLabels: [stub(Label, OWN_LABEL)],
            ownerUsers: [stub(User, MEMBER)],
            ownerTeams: [stub(Team, OWN_TEAM)],
          }),
        ),
      }),
    ).resolves.toBeUndefined();
  });

  test("refuses another project's team, a stranger and another project's label, in one answer that names fields and ids", async () => {
    const message: string = await refusalOf(
      ProjectReferenceCheck.validateCreate({
        service: HostOwnerRuleService,
        createBy: createOf(
          ownerRule({
            hostLabels: [stub(Label, FOREIGN_LABEL)],
            ownerUsers: [stub(User, MEMBER), stub(User, STRANGER)],
            ownerTeams: [stub(Team, FOREIGN_TEAM), stub(Team, OWN_TEAM)],
          }),
        ),
      }),
    );

    expect(message).toBe(
      refusal("host owner rule", [
        `Host Labels "${FOREIGN_LABEL}"`,
        `Owner Users "${STRANGER}"`,
        `Owner Teams "${FOREIGN_TEAM}"`,
      ]),
    );
  });

  test("checks against the caller's tenant, not the project the payload names", async () => {
    await refusalOf(
      ProjectReferenceCheck.validateCreate({
        service: HostOwnerRuleService,
        createBy: createOf(
          ownerRule({
            projectId: OTHER_PROJECT_ID,
            ownerTeams: [stub(Team, FOREIGN_TEAM)],
          }),
        ),
      }),
    );

    expect(directory.recordLookups[0]!.projectId).toBe(PROJECT_ID.toString());
  });

  test("a root or master admin write with no tenant is checked against the record's own project", async () => {
    for (const props of [
      { isRoot: true },
      { isMasterAdmin: true, userId: new ObjectID(MEMBER) },
    ] as Array<DatabaseCommonInteractionProps>) {
      await expect(
        ProjectReferenceCheck.validateCreate({
          service: HostOwnerRuleService,
          createBy: createOf(
            ownerRule({
              projectId: PROJECT_ID,
              ownerTeams: [stub(Team, OWN_TEAM)],
            }),
            props,
          ),
        }),
      ).resolves.toBeUndefined();

      // This project's team is not another project's.
      await refusalOf(
        ProjectReferenceCheck.validateCreate({
          service: HostOwnerRuleService,
          createBy: createOf(
            ownerRule({
              projectId: OTHER_PROJECT_ID,
              ownerTeams: [stub(Team, OWN_TEAM)],
            }),
            props,
          ),
        }),
      );
    }
  });

  test("a write with no project to compare against, or no references, asks nothing", async () => {
    await ProjectReferenceCheck.validateCreate({
      service: HostOwnerRuleService,
      createBy: createOf(
        ownerRule({ ownerTeams: [stub(Team, FOREIGN_TEAM)] }),
        { isRoot: true },
      ),
    });
    await ProjectReferenceCheck.validateCreate({
      service: HostOwnerRuleService,
      createBy: createOf(ownerRule({ name: "Platform owns prod hosts" })),
    });

    expect(directory.recordLookups).toEqual([]);
    expect(directory.memberLookups).toEqual([]);
  });

  test("refuses an owner row naming another project's team or resource, in either spelling", async () => {
    const row: (values: Record<string, unknown>) => HostOwnerTeam = (
      values: Record<string, unknown>,
    ): HostOwnerTeam => {
      const owner: HostOwnerTeam = new HostOwnerTeam();
      Object.assign(owner, values);
      return owner;
    };

    expect(
      await refusalOf(
        ProjectReferenceCheck.validateCreate({
          service: HostOwnerTeamService,
          createBy: createOf(
            row({
              teamId: new ObjectID(FOREIGN_TEAM),
              hostId: new ObjectID(OWN_HOST),
            }),
          ),
        }),
      ),
    ).toBe(refusal("host team owner", [`Team "${FOREIGN_TEAM}"`]));

    expect(
      await refusalOf(
        ProjectReferenceCheck.validateCreate({
          service: HostOwnerTeamService,
          createBy: createOf(
            row({
              teamId: new ObjectID(OWN_TEAM),
              hostId: new ObjectID(FOREIGN_HOST),
            }),
          ),
        }),
      ),
    ).toBe(refusal("host team owner", [`Host "${FOREIGN_HOST}"`]));

    // The relation object names another team than the id column does.
    expect(
      await refusalOf(
        ProjectReferenceCheck.validateCreate({
          service: HostOwnerTeamService,
          createBy: createOf(
            row({
              team: { _id: FOREIGN_TEAM },
              teamId: new ObjectID(OWN_TEAM),
              hostId: new ObjectID(OWN_HOST),
            }),
          ),
        }),
      ),
    ).toContain(`Team "${FOREIGN_TEAM}"`);
  });
});

describe("ProjectReferenceCheck.validateUpdate", () => {
  let storedRules: Array<HostOwnerRule>;
  let storedRead: ReturnType<typeof jest.spyOn>;

  function storedRule(
    projectId: ObjectID,
    teams: Array<string>,
    id: string = RULE_ID,
  ): HostOwnerRule {
    const rule: HostOwnerRule = new HostOwnerRule();
    rule._id = id;
    rule.projectId = projectId;
    rule.ownerTeams = teams.map((teamId: string): Team => {
      return stub(Team, teamId);
    });
    return rule;
  }

  beforeEach(() => {
    storedRules = [];
    storedRead = jest
      .spyOn(HostOwnerRuleService, "findBy")
      .mockImplementation((async (): Promise<Array<HostOwnerRule>> => {
        return storedRules;
      }) as never);
  });

  function update(
    data: Record<string, unknown>,
    props?: DatabaseCommonInteractionProps,
  ): Promise<void> {
    return ProjectReferenceCheck.validateUpdate({
      service: HostOwnerRuleService,
      updateBy: updateOf<HostOwnerRule>(data, props),
    });
  }

  test("an update naming only the project's records reads nothing the rule holds", async () => {
    await expect(
      update({ ownerTeams: [OWN_TEAM], ownerUsers: [{ _id: MEMBER }] }),
    ).resolves.toBeUndefined();

    expect(storedRead).not.toHaveBeenCalled();
  });

  test("an id the rule already holds can be saved back; one it does not hold is refused", async () => {
    storedRules = [storedRule(PROJECT_ID, [FOREIGN_TEAM])];

    await expect(
      update({ ownerTeams: [FOREIGN_TEAM, OWN_TEAM] }),
    ).resolves.toBeUndefined();

    expect(
      await refusalOf(
        update({ ownerTeams: [FOREIGN_TEAM, SECOND_FOREIGN_TEAM] }),
      ),
    ).toBe(
      refusal("host owner rule", [`Owner Teams "${SECOND_FOREIGN_TEAM}"`]),
    );
  });

  test("what a rule of another project holds exempts nothing in the caller's", async () => {
    storedRules = [storedRule(OTHER_PROJECT_ID, [FOREIGN_TEAM])];

    await refusalOf(update({ ownerTeams: [FOREIGN_TEAM] }));
  });

  test("a held id exempts only when every matched rule holds it", async () => {
    storedRules = [
      storedRule(PROJECT_ID, [FOREIGN_TEAM]),
      storedRule(PROJECT_ID, [], "0c1d2e3f-0000-4000-8000-0000000000a2"),
    ];

    await refusalOf(update({ ownerTeams: [FOREIGN_TEAM] }));
  });

  test("an update with no tenant is checked against each matched rule's own project", async () => {
    storedRules = [storedRule(OTHER_PROJECT_ID, [])];

    // This project's team on a rule of the other project.
    await refusalOf(update({ ownerTeams: [OWN_TEAM] }, { isRoot: true }));

    expect(directory.recordLookups[0]!.projectId).toBe(
      OTHER_PROJECT_ID.toString(),
    );
  });

  test("an empty list or a cleared relation only removes references and asks nothing", async () => {
    await update({ ownerTeams: [], ownerUsers: null, name: "Renamed" });

    expect(directory.recordLookups).toEqual([]);
    expect(directory.memberLookups).toEqual([]);
    expect(storedRead).not.toHaveBeenCalled();
  });
});

// The lookups the check makes go through plain services, never the hooks of the real ones.
describe("ProjectReferenceCheck lookups", () => {
  test("look up each referenced model through its own plain lookup service", () => {
    for (const column of ProjectReferenceCheck.getReferenceColumns(
      new HostOwnerRule(),
    )) {
      expect(column.service).toBeInstanceOf(DatabaseService);
      expect(column.service).not.toBe(HostOwnerRuleService);
    }
  });
});
