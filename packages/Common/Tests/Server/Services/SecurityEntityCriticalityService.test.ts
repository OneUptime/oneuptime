import Queue from "../../../Server/Infrastructure/Queue";
import SecurityEntityCriticalityService from "../../../Server/Services/SecurityEntityCriticalityService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import {
  OnCreate,
  OnDelete,
  OnUpdate,
} from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import ProjectReferenceCheck from "../../../Server/Utils/Database/ProjectReferenceCheck";
import { SECURITY_ENTITY_RISK_RECOMPUTE_JOB } from "../../../Server/Utils/SecurityEvent/EntityRisk/SecurityEntityRiskJobs";
import logger from "../../../Server/Utils/Logger";
import SecurityEntityCriticality from "../../../Models/DatabaseModels/SecurityEntityCriticality";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { SecurityEntityType } from "../../../Types/SecurityCase/SecurityEntity";
import { SecurityEntityCriticality as Criticality } from "../../../Types/SecurityCase/SecurityEntityRisk";
import { SecurityEntityCriticalityRule } from "../../../Utils/SecurityCase/SecurityEntityRiskScore";
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
 * The project's Entity Criticality list: what an entry may hold (a value or
 * a pattern, for one kind of entity or any, with Low, High or Extreme), that
 * one value for one kind is listed once, who keeps the list, the list as
 * the risk score reads it, and that every change weighs the project's
 * entity risk again in the background.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const ROW_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

type Spy = ReturnType<typeof getJestSpyOn>;

type HookCaller = {
  onBeforeCreate: (
    createBy: CreateBy<SecurityEntityCriticality>,
  ) => Promise<OnCreate<SecurityEntityCriticality>>;
  onCreateSuccess: (
    onCreate: OnCreate<SecurityEntityCriticality>,
    created: SecurityEntityCriticality,
  ) => Promise<SecurityEntityCriticality>;
  onBeforeUpdate: (
    updateBy: UpdateBy<SecurityEntityCriticality>,
  ) => Promise<OnUpdate<SecurityEntityCriticality>>;
  onUpdateSuccess: (
    onUpdate: OnUpdate<SecurityEntityCriticality>,
    ids: Array<ObjectID>,
  ) => Promise<OnUpdate<SecurityEntityCriticality>>;
  onBeforeDelete: (
    deleteBy: DeleteBy<SecurityEntityCriticality>,
  ) => Promise<OnDelete<SecurityEntityCriticality>>;
  onDeleteSuccess: (
    onDelete: OnDelete<SecurityEntityCriticality>,
    ids: Array<ObjectID>,
  ) => Promise<OnDelete<SecurityEntityCriticality>>;
};

const service: HookCaller =
  SecurityEntityCriticalityService as unknown as HookCaller;

function row(
  value: string,
  entityType: SecurityEntityType | undefined,
  criticality: Criticality,
  id: ObjectID = ObjectID.generate(),
): SecurityEntityCriticality {
  const model: SecurityEntityCriticality = new SecurityEntityCriticality();
  model._id = id.toString();
  model.projectId = PROJECT_ID;
  model.value = value;

  if (entityType) {
    model.entityType = entityType;
  }

  model.criticality = criticality;
  return model;
}

function entry(data: {
  value: unknown;
  entityType?: unknown;
  criticality?: unknown;
}): SecurityEntityCriticality {
  const model: SecurityEntityCriticality = new SecurityEntityCriticality();
  model.projectId = PROJECT_ID;
  model.value = data.value as string;

  if (data.entityType !== undefined) {
    model.entityType = data.entityType as SecurityEntityType;
  }

  model.criticality = (data.criticality ?? Criticality.High) as Criticality;
  return model;
}

let addJob: Spy;
let findBy: Spy;

beforeEach(() => {
  getJestSpyOn(ProjectReferenceCheck, "validateCreate").mockResolvedValue(
    undefined as never,
  );
  getJestSpyOn(ProjectReferenceCheck, "validateUpdate").mockResolvedValue(
    undefined as never,
  );
  // The project lists every domain controller as Extreme.
  findBy = getJestSpyOn(
    SecurityEntityCriticalityService,
    "findBy",
  ).mockResolvedValue([
    row("DC-*", SecurityEntityType.Host, Criticality.Extreme, ROW_ID),
    row("ceo@corp.example", undefined, Criticality.High),
  ] as never);
  addJob = getJestSpyOn(Queue, "addJob").mockResolvedValue({} as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("what an entry holds", () => {
  test("a value trimmed, its wildcards folded, for one kind or any", async () => {
    const created: SecurityEntityCriticality = entry({
      value: "  svc-**  ",
      entityType: SecurityEntityType.User,
      criticality: Criticality.Low,
    });

    await service.onBeforeCreate({ data: created, props: { isRoot: true } });

    expect(created.value).toBe("svc-*");
    expect(created.entityType).toBe(SecurityEntityType.User);
    expect(created.criticality).toBe(Criticality.Low);

    const anyKind: SecurityEntityCriticality = entry({
      value: "10.0.0.*",
      entityType: "",
    });

    await service.onBeforeCreate({ data: anyKind, props: { isRoot: true } });

    expect((anyKind as unknown as JSONObject)["entityType"]).toBeNull();
  });

  test("refuses another kind of entity, an unknown criticality, and an empty or over-long value", async () => {
    await expect(
      service.onBeforeCreate({
        data: entry({
          value: "evil.example",
          entityType: SecurityEntityType.Domain,
        }),
        props: { isRoot: true },
      }),
    ).rejects.toThrow(/a User, a Host or an IP Address/);

    await expect(
      service.onBeforeCreate({
        data: entry({ value: "alice", criticality: "Medium" }),
        props: { isRoot: true },
      }),
    ).rejects.toThrow(/Low, High or Extreme/);

    await expect(
      service.onBeforeCreate({
        data: entry({ value: "   " }),
        props: { isRoot: true },
      }),
    ).rejects.toThrow(
      /Enter the user's sign-in name, the host's name or the address/,
    );

    await expect(
      service.onBeforeCreate({
        data: entry({ value: "h".repeat(501) }),
        props: { isRoot: true },
      }),
    ).rejects.toThrow(/at most 500 characters/);
  });

  test("lists a value for a kind once, whatever its case", async () => {
    await expect(
      service.onBeforeCreate({
        data: entry({ value: "dc-*", entityType: SecurityEntityType.Host }),
        props: { isRoot: true },
      }),
    ).rejects.toThrow('"dc-*" is already in the list.');

    await expect(
      service.onBeforeCreate({
        data: entry({ value: "CEO@corp.example" }),
        props: { isRoot: true },
      }),
    ).rejects.toThrow(/already in the list/);

    // The same pattern for another kind is another entry.
    const forUsers: SecurityEntityCriticality = entry({
      value: "dc-*",
      entityType: SecurityEntityType.User,
    });

    await expect(
      service.onBeforeCreate({ data: forUsers, props: { isRoot: true } }),
    ).resolves.toBeDefined();
  });

  test("an update is held to the same rules, against every other entry", async () => {
    getJestSpyOn(
      SecurityEntityCriticalityService,
      "findRowsAndHoldUpdateToThem",
    ).mockResolvedValue([
      row("ceo@corp.example", undefined, Criticality.High),
    ] as never);

    await expect(
      service.onBeforeUpdate({
        query: { _id: ROW_ID },
        data: { value: "dc-*", entityType: SecurityEntityType.Host },
        props: { isRoot: true },
      } as unknown as UpdateBy<SecurityEntityCriticality>),
    ).rejects.toThrow(/already in the list/);

    await expect(
      service.onBeforeUpdate({
        query: { _id: ROW_ID },
        data: { criticality: "Huge" },
        props: { isRoot: true },
      } as unknown as UpdateBy<SecurityEntityCriticality>),
    ).rejects.toThrow(/Low, High or Extreme/);

    const fine: OnUpdate<SecurityEntityCriticality> =
      await service.onBeforeUpdate({
        query: { _id: ROW_ID },
        data: { criticality: Criticality.Low },
        props: { isRoot: true },
      } as unknown as UpdateBy<SecurityEntityCriticality>);

    expect(fine.carryForward).toEqual([PROJECT_ID]);
  });
});

describe("every change weighs the project's risk again, in the background", () => {
  function recomputesQueued(): Array<string> {
    return addJob.mock.calls
      .filter((call: Array<unknown>): boolean => {
        return call[2] === SECURITY_ENTITY_RISK_RECOMPUTE_JOB;
      })
      .map((call: Array<unknown>): string => {
        return String((call[3] as JSONObject)["projectId"]);
      });
  }

  test("an entry added", async () => {
    const created: SecurityEntityCriticality = entry({ value: "alice" });

    await service.onCreateSuccess(
      {
        createBy: { data: created, props: { isRoot: true } },
        carryForward: undefined,
      },
      created,
    );

    expect(recomputesQueued()).toEqual([PROJECT_ID.toString()]);

    const options: JSONObject = addJob.mock.calls[0]![4] as JSONObject;

    // One active and one waiting per project: a burst of edits is one recompute.
    expect(options["deduplication"]).toEqual({
      id: `security-entity-risk-recompute-${PROJECT_ID.toString()}`,
      keepLastIfActive: true,
    });
  });

  test("entries changed, once a project", async () => {
    await service.onUpdateSuccess(
      {
        updateBy: {
          query: {},
          data: {},
          props: { isRoot: true },
        } as UpdateBy<SecurityEntityCriticality>,
        carryForward: [PROJECT_ID, PROJECT_ID],
      },
      [ROW_ID],
    );

    expect(recomputesQueued()).toEqual([PROJECT_ID.toString()]);
  });

  test("entries removed: the projects they were in, read before they go", async () => {
    getJestSpyOn(
      SecurityEntityCriticalityService,
      "findRowsAndHoldDeleteToThem",
    ).mockResolvedValue([
      row("dc-*", SecurityEntityType.Host, Criticality.Extreme, ROW_ID),
    ] as never);

    const onDelete: OnDelete<SecurityEntityCriticality> =
      await service.onBeforeDelete({
        query: { _id: ROW_ID },
        props: { isRoot: true },
      } as unknown as DeleteBy<SecurityEntityCriticality>);

    await service.onDeleteSuccess(onDelete, [ROW_ID]);

    expect(recomputesQueued()).toEqual([PROJECT_ID.toString()]);
  });

  test("a queue that cannot be reached never fails the change", async () => {
    addJob.mockRejectedValue(new Error("Redis is down") as never);
    getJestSpyOn(logger, "error").mockImplementation((() => {
      return undefined;
    }) as never);

    const created: SecurityEntityCriticality = entry({ value: "alice" });

    await expect(
      service.onCreateSuccess(
        {
          createBy: { data: created, props: { isRoot: true } },
          carryForward: undefined,
        },
        created,
      ),
    ).resolves.toBe(created);
  });
});

describe("the list as the risk score reads it", () => {
  test("every entry with a value and a criticality it knows, typed or for any kind", async () => {
    findBy.mockResolvedValue([
      row("DC-*", SecurityEntityType.Host, Criticality.Extreme),
      row("ceo@corp.example", undefined, Criticality.High),
      row("", SecurityEntityType.User, Criticality.Low),
      row("test-*", SecurityEntityType.Domain, Criticality.Low),
      row("old", undefined, "Medium" as Criticality),
    ] as never);

    const rules: Array<SecurityEntityCriticalityRule> =
      await SecurityEntityCriticalityService.getRules(PROJECT_ID);

    expect(rules).toEqual([
      {
        value: "DC-*",
        entityType: SecurityEntityType.Host,
        criticality: Criticality.Extreme,
      },
      {
        value: "ceo@corp.example",
        entityType: null,
        criticality: Criticality.High,
      },
      // An entry for a kind that carries no risk names nobody, not everybody.
    ]);
  });
});

describe("who keeps the list", () => {
  test("whoever may write detection rules; every Security tier reads it", () => {
    const model: SecurityEntityCriticality = new SecurityEntityCriticality();

    expect(model.getCreatePermissions()).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.SecurityAdmin,
      Permission.SecurityMember,
      Permission.CreateProjectDetectionRule,
    ]);
    expect(model.getReadPermissions()).toEqual([
      Permission.ProjectOwner,
      Permission.ProjectAdmin,
      Permission.SecurityAdmin,
      Permission.SecurityMember,
      Permission.SecurityViewer,
      Permission.ReadProjectDetectionRule,
    ]);
    expect(model.getDeletePermissions()).toContain(
      Permission.DeleteProjectDetectionRule,
    );
    expect(model.getUpdatePermissions()).not.toContain(
      Permission.SecurityViewer,
    );
  });
});
