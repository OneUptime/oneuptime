import AIAgentService from "../../../Server/Services/AIAgentService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import FileService from "../../../Server/Services/FileService";
import LlmProviderService from "../../../Server/Services/LlmProviderService";
import LogSavedViewService from "../../../Server/Services/LogSavedViewService";
import MetricSavedViewService from "../../../Server/Services/MetricSavedViewService";
import ProjectCallSMSConfigService from "../../../Server/Services/ProjectCallSMSConfigService";
import RunnerService from "../../../Server/Services/RunnerService";
import TraceSavedViewService from "../../../Server/Services/TraceSavedViewService";
import ExceptionSavedViewService from "../../../Server/Services/ExceptionSavedViewService";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { PlanType } from "../../../Types/Billing/SubscriptionPlan";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import ColumnWriteRefusedException from "../../../Server/Types/Database/Permissions/ColumnWriteRefusedException";
import LlmType from "../../../Types/LLM/LlmType";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import Phone from "../../../Types/Phone";
import UserType from "../../../Types/UserType";
import {
  InMemoryTable,
  StoredRow,
  useInMemoryTable,
} from "../TestingUtils/InMemoryRepository";
import { getJestSpyOn } from "../../Spy";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

/*
 * EXACTLY ONE DEFAULT PER PROJECT, AND ONLY AFTER THE WRITE SUCCEEDED.
 *
 * A project uses one LLM provider, one AI agent, one saved log, trace and
 * metric view, one Twilio config and one Runner by default. Making a row the default
 * takes the default from the project's other rows of that kind. That used to
 * happen in onBeforeCreate / onBeforeUpdate - before DatabaseService's
 * permission check, and before anything else could refuse the write - so a
 * create or update that was then refused, or that failed, had already taken
 * the default from the project's other rows.
 *
 * Now it happens once the row is saved (onCreateSuccess / onUpdateSuccess).
 * These drive the real create and updateOneById of each service, hooks and
 * permission checks included, over an in-memory table with a default in this
 * project and another in a second project:
 *
 *  - a permitted create or update leaves exactly one default in the project
 *    and the other project alone;
 *  - a refused create or update, and one whose write fails, leaves every row
 *    as it was.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "1b000000-0000-4000-8000-000000000001",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "1b000000-0000-4000-8000-000000000002",
);
const USER_ID: ObjectID = new ObjectID("1b000000-0000-4000-8000-000000000003");

const CURRENT_DEFAULT_ID: string = "1b000000-0000-4000-8000-0000000000a1";
const SECOND_ROW_ID: string = "1b000000-0000-4000-8000-0000000000a2";
const OTHER_PROJECT_DEFAULT_ID: string = "1b000000-0000-4000-8000-0000000000b1";

interface ServiceCase {
  label: string;
  service: DatabaseService<BaseModel>;
  defaultColumn: string;
  // The columns a create needs besides the project and the default flag.
  newRowData: () => StoredRow;
}

const SERVICE_CASES: Array<ServiceCase> = [
  {
    label: "LlmProviderService",
    service: LlmProviderService as unknown as DatabaseService<BaseModel>,
    defaultColumn: "isDefault",
    newRowData: (): StoredRow => {
      return { name: "Team OpenAI", llmType: LlmType.OpenAI };
    },
  },
  {
    label: "AIAgentService",
    service: AIAgentService as unknown as DatabaseService<BaseModel>,
    defaultColumn: "isDefault",
    newRowData: (): StoredRow => {
      return { name: "Team agent" };
    },
  },
  {
    label: "LogSavedViewService",
    service: LogSavedViewService as unknown as DatabaseService<BaseModel>,
    defaultColumn: "isDefault",
    newRowData: (): StoredRow => {
      return {
        name: "Errors only",
        query: {},
        columns: ["time", "body"],
        pageSize: 100,
      };
    },
  },
  {
    label: "MetricSavedViewService",
    service: MetricSavedViewService as unknown as DatabaseService<BaseModel>,
    defaultColumn: "isDefault",
    newRowData: (): StoredRow => {
      return { name: "Latency", query: {} };
    },
  },
  {
    label: "TraceSavedViewService",
    service: TraceSavedViewService as unknown as DatabaseService<BaseModel>,
    defaultColumn: "isDefault",
    newRowData: (): StoredRow => {
      return { name: "Slow spans", query: {} };
    },
  },
  {
    label: "ExceptionSavedViewService",
    service: ExceptionSavedViewService as unknown as DatabaseService<BaseModel>,
    defaultColumn: "isDefault",
    newRowData: (): StoredRow => {
      return { name: "Checkout errors", query: {} };
    },
  },
  {
    label: "ProjectCallSMSConfigService",
    service:
      ProjectCallSMSConfigService as unknown as DatabaseService<BaseModel>,
    defaultColumn: "isProjectDefault",
    newRowData: (): StoredRow => {
      return {
        name: "Backup Twilio",
        twilioAccountSID: "AC00000000000000000000000000000009",
        twilioAuthToken: "00000000000000000000000000000009",
        twilioPrimaryPhoneNumber: new Phone("+15551230009"),
      };
    },
  },
  /*
   * The project's default Runner: the steps that pick no Runner run on it.
   * Created and made the default by those who edit Runners.
   */
  {
    label: "RunnerService",
    service: RunnerService as unknown as DatabaseService<BaseModel>,
    defaultColumn: "isProjectDefault",
    newRowData: (): StoredRow => {
      return { name: "office-runner", canRunRunbooks: true };
    },
  },
];

// A member of `memberOf`, asking in `tenant`, with these permissions.
function memberProps(
  permissions: Array<Permission>,
  memberOf: ObjectID = PROJECT_ID,
  tenant: ObjectID = memberOf,
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    projectId: memberOf,
    _type: "UserTenantAccessPermission",
    permissions: [
      Permission.CurrentUser,
      Permission.ProjectUser,
      ...permissions,
    ].map((permission: Permission): UserPermission => {
      return {
        _type: "UserPermission",
        permission,
        labelIds: [],
        isBlockPermission: false,
        scope: PermissionScope.All,
      };
    }),
  };

  return {
    userId: USER_ID,
    userType: UserType.User,
    tenantId: tenant,
    userTenantAccessPermission: {
      [memberOf.toString()]: tenantPermission,
    },
    currentPlan: PlanType.Enterprise,
    isSubscriptionUnpaid: false,
  };
}

const adminProps: () => DatabaseCommonInteractionProps =
  (): DatabaseCommonInteractionProps => {
    return memberProps([Permission.ProjectAdmin]);
  };

// May look, and change nothing.
const viewerProps: () => DatabaseCommonInteractionProps =
  (): DatabaseCommonInteractionProps => {
    return memberProps([Permission.Viewer]);
  };

// An owner of another project, asking in this one.
const strangerInThisProjectProps: () => DatabaseCommonInteractionProps =
  (): DatabaseCommonInteractionProps => {
    return memberProps([Permission.ProjectOwner], OTHER_PROJECT_ID, PROJECT_ID);
  };

// An owner of another project, asking in their own.
const strangerInOwnProjectProps: () => DatabaseCommonInteractionProps =
  (): DatabaseCommonInteractionProps => {
    return memberProps([Permission.ProjectOwner], OTHER_PROJECT_ID);
  };

function startingRows(defaultColumn: string): Array<StoredRow> {
  return [
    {
      _id: CURRENT_DEFAULT_ID,
      projectId: PROJECT_ID.toString(),
      name: "Current default",
      [defaultColumn]: true,
    },
    {
      _id: SECOND_ROW_ID,
      projectId: PROJECT_ID.toString(),
      name: "Second",
      [defaultColumn]: false,
    },
    {
      _id: OTHER_PROJECT_DEFAULT_ID,
      projectId: OTHER_PROJECT_ID.toString(),
      name: "Other project's default",
      [defaultColumn]: true,
    },
  ];
}

function defaultsOf(
  table: InMemoryTable,
  projectId: ObjectID,
  defaultColumn: string,
): Array<string> {
  return table.rows
    .filter((row: StoredRow): boolean => {
      return (
        String(row["projectId"]).toLowerCase() ===
          projectId.toString().toLowerCase() && row[defaultColumn] === true
      );
    })
    .map((row: StoredRow): string => {
      return String(row["_id"]);
    });
}

function newRow(serviceCase: ServiceCase, isDefault: boolean): BaseModel {
  const model: BaseModel = new serviceCase.service.modelType();
  const record: StoredRow = model as unknown as StoredRow;

  for (const [column, value] of Object.entries(serviceCase.newRowData())) {
    record[column] = value;
  }

  record[serviceCase.defaultColumn] = isDefault;

  return model;
}

async function rejectionOf(promise: Promise<unknown>): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  return undefined;
}

beforeEach(() => {
  // An AI agent's icon is made public on save; there is none here.
  getJestSpyOn(FileService, "makeRecordFilePublic").mockResolvedValue(
    undefined,
  );
  getJestSpyOn(FileService, "makeStoredIconsPublic").mockResolvedValue(
    undefined,
  );
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(SERVICE_CASES)("$label", (serviceCase: ServiceCase) => {
  const column: string = serviceCase.defaultColumn;
  let table: InMemoryTable;

  beforeEach(() => {
    table = useInMemoryTable(serviceCase.service, startingRows(column));
  });

  describe("create", () => {
    test("a permitted create of the default leaves it the project's only default", async () => {
      const created: BaseModel = await serviceCase.service.create({
        data: newRow(serviceCase, true),
        props: adminProps(),
      });

      expect(defaultsOf(table, PROJECT_ID, column)).toEqual([
        created.id!.toString(),
      ]);
      // The other project keeps its own default.
      expect(defaultsOf(table, OTHER_PROJECT_ID, column)).toEqual([
        OTHER_PROJECT_DEFAULT_ID,
      ]);
    });

    test("a permitted create that is not the default leaves the default where it was", async () => {
      await serviceCase.service.create({
        data: newRow(serviceCase, false),
        props: adminProps(),
      });

      expect(defaultsOf(table, PROJECT_ID, column)).toEqual([
        CURRENT_DEFAULT_ID,
      ]);
      expect(table.updates).toEqual([]);
    });

    test.each([
      ["a member who may only look", viewerProps],
      ["an owner of another project", strangerInThisProjectProps],
    ] as Array<[string, () => DatabaseCommonInteractionProps]>)(
      "%s asking for the default is refused, and every row stays as it was",
      async (
        _label: string,
        buildProps: () => DatabaseCommonInteractionProps,
      ) => {
        const error: unknown = await rejectionOf(
          serviceCase.service.create({
            data: newRow(serviceCase, true),
            props: buildProps(),
          }),
        );

        expect(error).toBeInstanceOf(NotAuthorizedException);
        expect(table.inserts).toEqual([]);
        expect(table.updates).toEqual([]);
        expect(defaultsOf(table, PROJECT_ID, column)).toEqual([
          CURRENT_DEFAULT_ID,
        ]);
        expect(defaultsOf(table, OTHER_PROJECT_ID, column)).toEqual([
          OTHER_PROJECT_DEFAULT_ID,
        ]);
      },
    );

    test("a create whose save fails leaves the project's default where it was", async () => {
      table.repository.save.mockImplementationOnce(async () => {
        throw new Error("the save failed");
      });

      await expect(
        serviceCase.service.create({
          data: newRow(serviceCase, true),
          props: adminProps(),
        }),
      ).rejects.toThrow("the save failed");

      expect(table.updates).toEqual([]);
      expect(defaultsOf(table, PROJECT_ID, column)).toEqual([
        CURRENT_DEFAULT_ID,
      ]);
    });

    test("a root create of the default takes it from the project's others too", async () => {
      const row: BaseModel = newRow(serviceCase, true);
      (row as unknown as StoredRow)["projectId"] = PROJECT_ID;

      const created: BaseModel = await serviceCase.service.create({
        data: row,
        props: { isRoot: true },
      });

      expect(defaultsOf(table, PROJECT_ID, column)).toEqual([
        created.id!.toString(),
      ]);
      expect(defaultsOf(table, OTHER_PROJECT_ID, column)).toEqual([
        OTHER_PROJECT_DEFAULT_ID,
      ]);
    });
  });

  describe("update", () => {
    test("a permitted update that makes a row the default leaves it the project's only default", async () => {
      await serviceCase.service.updateOneById({
        id: new ObjectID(SECOND_ROW_ID),
        data: { [column]: true } as never,
        props: adminProps(),
      });

      expect(defaultsOf(table, PROJECT_ID, column)).toEqual([SECOND_ROW_ID]);
      expect(defaultsOf(table, OTHER_PROJECT_ID, column)).toEqual([
        OTHER_PROJECT_DEFAULT_ID,
      ]);
    });

    test("an update that does not make a row the default changes no other row", async () => {
      await serviceCase.service.updateOneById({
        id: new ObjectID(SECOND_ROW_ID),
        data: { name: "Renamed" } as never,
        props: adminProps(),
      });

      expect(
        table.updates.map((update: { id: string }): string => {
          return update.id;
        }),
      ).toEqual([SECOND_ROW_ID]);
      expect(defaultsOf(table, PROJECT_ID, column)).toEqual([
        CURRENT_DEFAULT_ID,
      ]);
    });

    test("a member who may only look is refused, and every row stays as it was", async () => {
      const error: unknown = await rejectionOf(
        serviceCase.service.updateOneById({
          id: new ObjectID(SECOND_ROW_ID),
          data: { [column]: true } as never,
          props: viewerProps(),
        }),
      );

      expect(error).toBeInstanceOf(NotAuthorizedException);
      expect(table.updates).toEqual([]);
      expect(defaultsOf(table, PROJECT_ID, column)).toEqual([
        CURRENT_DEFAULT_ID,
      ]);
    });

    test("an owner of another project naming this project's row changes nothing in either project", async () => {
      const updated: number = await serviceCase.service.updateOneById({
        id: new ObjectID(SECOND_ROW_ID),
        data: { [column]: true } as never,
        props: strangerInOwnProjectProps(),
      });

      expect(updated).toBe(0);
      expect(table.updates).toEqual([]);
      expect(defaultsOf(table, PROJECT_ID, column)).toEqual([
        CURRENT_DEFAULT_ID,
      ]);
      expect(defaultsOf(table, OTHER_PROJECT_ID, column)).toEqual([
        OTHER_PROJECT_DEFAULT_ID,
      ]);
    });

    test("an update whose write fails leaves the project's default where it was", async () => {
      table.repository.update.mockImplementationOnce(async () => {
        throw new Error("the write failed");
      });

      await expect(
        serviceCase.service.updateOneById({
          id: new ObjectID(SECOND_ROW_ID),
          data: { [column]: true } as never,
          props: adminProps(),
        }),
      ).rejects.toThrow("the write failed");

      expect(defaultsOf(table, PROJECT_ID, column)).toEqual([
        CURRENT_DEFAULT_ID,
      ]);
    });

    test("turning the default off leaves the project with no default and changes no other row", async () => {
      await serviceCase.service.updateOneById({
        id: new ObjectID(CURRENT_DEFAULT_ID),
        data: { [column]: false } as never,
        props: adminProps(),
      });

      expect(defaultsOf(table, PROJECT_ID, column)).toEqual([]);
      expect(defaultsOf(table, OTHER_PROJECT_ID, column)).toEqual([
        OTHER_PROJECT_DEFAULT_ID,
      ]);
    });
  });
});

/*
 * Who creates a Runner, and who creates one as the project's default
 * (Runner.isProjectDefault). Every creator of a Runner may give the column
 * a value: the Terraform provider sends what the API publishes, false,
 * with every create, and was refused the whole Runner for it unless it
 * could also edit Runners. Only someone who may make a Runner the default -
 * those who edit Runners - creates one AS the default
 * (RunnerService.assertMayCreateAsProjectDefault): Create Runner alone,
 * like a Project Member, never makes the Runner it creates the one every
 * runbook step that picks no Runner runs on.
 */
describe("RunnerService: who creates a Runner as the project's default", () => {
  const RUNNER_DEFAULT_COLUMN: string = "isProjectDefault";
  let table: InMemoryTable;

  function runnerCase(): ServiceCase {
    const found: ServiceCase | undefined = SERVICE_CASES.find(
      (serviceCase: ServiceCase): boolean => {
        return serviceCase.label === "RunnerService";
      },
    );

    if (!found) {
      throw new Error("RunnerService is one of the cases above.");
    }

    return found;
  }

  beforeEach(() => {
    table = useInMemoryTable(
      RunnerService as unknown as DatabaseService<BaseModel>,
      startingRows(RUNNER_DEFAULT_COLUMN),
    );
  });

  test.each([
    ["Project Owner", [Permission.ProjectOwner]],
    ["Project Admin", [Permission.ProjectAdmin]],
    ["Runbook Admin", [Permission.RunbookAdmin]],
    [
      "Create and Edit Runner",
      [Permission.CreateRunner, Permission.EditRunner],
    ],
  ] as Array<[string, Array<Permission>]>)(
    "%s creates one as the default",
    async (_label: string, permissions: Array<Permission>) => {
      const created: BaseModel = await RunnerService.create({
        data: newRow(runnerCase(), true) as never,
        props: memberProps(permissions),
      });

      expect(defaultsOf(table, PROJECT_ID, RUNNER_DEFAULT_COLUMN)).toEqual([
        created.id!.toString(),
      ]);
    },
  );

  test.each([
    ["Create Runner", [Permission.CreateRunner]],
    ["a Project Member", [Permission.ProjectMember]],
  ] as Array<[string, Array<Permission>]>)(
    "%s creates one with the default it is sent, false - what the Terraform provider sends",
    async (_label: string, permissions: Array<Permission>) => {
      const created: BaseModel = await RunnerService.create({
        data: newRow(runnerCase(), false) as never,
        props: memberProps(permissions),
      });

      expect(table.inserts).toHaveLength(1);
      expect(table.inserts[0]![RUNNER_DEFAULT_COLUMN]).toBe(false);
      expect(String(table.inserts[0]!["_id"])).toBe(created.id!.toString());
      // Not the default: the project's stays where it was.
      expect(defaultsOf(table, PROJECT_ID, RUNNER_DEFAULT_COLUMN)).toEqual([
        CURRENT_DEFAULT_ID,
      ]);
      expect(table.updates).toEqual([]);
    },
  );

  test.each([
    ["Create Runner", [Permission.CreateRunner]],
    ["a Project Member", [Permission.ProjectMember]],
  ] as Array<[string, Array<Permission>]>)(
    "%s does not create one as the default: refused in the column check's words, and the default stays",
    async (_label: string, permissions: Array<Permission>) => {
      const error: unknown = await rejectionOf(
        RunnerService.create({
          data: newRow(runnerCase(), true) as never,
          props: memberProps(permissions),
        }),
      );

      expect(error).toBeInstanceOf(ColumnWriteRefusedException);
      expect((error as Error).message).toBe(
        "User is not allowed to create on isProjectDefault column of Runner. You need one of these permissions: Project Owner, Project Admin, Runbook Admin, Edit Runbook Agent.",
      );
      expect(table.inserts).toEqual([]);
      expect(table.updates).toEqual([]);
      expect(defaultsOf(table, PROJECT_ID, RUNNER_DEFAULT_COLUMN)).toEqual([
        CURRENT_DEFAULT_ID,
      ]);
    },
  );

  test("OneUptime creates one as the default, whoever asked", async () => {
    const row: BaseModel = newRow(runnerCase(), true);
    (row as unknown as StoredRow)["projectId"] = PROJECT_ID;

    const created: BaseModel = await RunnerService.create({
      data: row as never,
      props: { isRoot: true },
    });

    expect(defaultsOf(table, PROJECT_ID, RUNNER_DEFAULT_COLUMN)).toEqual([
      created.id!.toString(),
    ]);
  });
});
