import DatabaseService from "../../../Server/Services/DatabaseService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import FindBy from "../../../Server/Types/Database/FindBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import { ProjectScopedReferenceException } from "../../../Server/Utils/Database/ProjectScopedReferenceValidator";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentInternalNote from "../../../Models/DatabaseModels/IncidentInternalNote";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import PermissionScope from "../../../Types/Database/AccessControl/PermissionScope";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import { getJestSpyOn } from "../../Spy";
import { ON_HIGHEST_PLAN } from "../TestingUtils/RequestPlan";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { FindOperator } from "typeorm";

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

/*
 * DatabaseService.create holds a record read through another one to a parent
 * its creator may read (CreatePermission.checkParentPermission), with a read
 * of the parent's table as the caller:
 *
 *   - one read, through a plain service of the parent's model - the
 *     permission layer's read rule, no service's hooks - selecting the ids
 *     alone, pinned to the project the request is made in;
 *   - before any of the create's hooks, and again before anything is saved
 *     when a hook named another parent.
 *
 * No database is touched: the parent read and the save are stubbed, and
 * whatever reaches them is recorded.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-cccc-4aaa-8bbb-000000000001",
);
const LABEL_ID: ObjectID = new ObjectID("0193c0de-cccc-4aaa-8bbb-0000000000a1");
const INCIDENT_ID: string = "0193c0de-cccc-4aaa-8bbb-00000000e001";
const OTHER_INCIDENT_ID: string = "0193c0de-cccc-4aaa-8bbb-00000000e002";

class SavedSentinel extends Error {}

interface ParentRead {
  reader: DatabaseService<BaseModel>;
  findBy: FindBy<BaseModel>;
}

// A member who may write notes and read the incidents carrying one label.
const noteWriterOnOneLabel: () => DatabaseCommonInteractionProps =
  (): DatabaseCommonInteractionProps => {
    const rows: Array<UserPermission> = [
      {
        _type: "UserPermission",
        permission: Permission.CreateIncidentInternalNote,
        labelIds: [],
        isBlockPermission: false,
        scope: PermissionScope.All,
      },
      {
        _type: "UserPermission",
        permission: Permission.ReadIncidentInternalNote,
        labelIds: [],
        isBlockPermission: false,
        scope: PermissionScope.All,
      },
      {
        _type: "UserPermission",
        permission: Permission.ReadProjectIncident,
        labelIds: [LABEL_ID],
        isBlockPermission: false,
        scope: PermissionScope.Labels,
      },
    ];

    return {
      userId: ObjectID.generate(),
      userType: UserType.User,
      tenantId: PROJECT_ID,
      ...ON_HIGHEST_PLAN,
      userGlobalAccessPermission: {
        _type: "UserGlobalAccessPermission",
        projectIds: [PROJECT_ID],
        globalPermissions: [Permission.Public, Permission.User],
      },
      userTenantAccessPermission: {
        [PROJECT_ID.toString()]: {
          _type: "UserTenantAccessPermission",
          projectId: PROJECT_ID,
          permissions: rows,
        },
      },
    };
  };

const noteOn: (incidentId: string) => IncidentInternalNote = (
  incidentId: string,
): IncidentInternalNote => {
  const note: IncidentInternalNote = new IncidentInternalNote();
  note.incidentId = new ObjectID(incidentId);
  note.note = "Synthetic note";
  return note;
};

// The values a condition binds, an AND of conditions included.
const valuesOf: (condition: unknown) => Array<string> = (
  condition: unknown,
): Array<string> => {
  const operator: FindOperator<unknown> = condition as FindOperator<unknown>;

  if (operator.type === "and") {
    return (operator.value as unknown as Array<unknown>).flatMap(valuesOf);
  }

  return Object.values(
    (
      operator as unknown as {
        objectLiteralParameters?: Record<string, unknown>;
      }
    ).objectLiteralParameters || {},
  )
    .flat()
    .map(String);
};

/*
 * A note service whose create hook may name another incident, as a hook that
 * derives a record's parent would.
 */
class NoteService extends DatabaseService<IncidentInternalNote> {
  public parentNamedByHook: string | null = null;
  public hookCalls: number = 0;

  public constructor() {
    super(IncidentInternalNote);
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<IncidentInternalNote>,
  ): Promise<OnCreate<IncidentInternalNote>> {
    this.hookCalls++;

    if (this.parentNamedByHook) {
      createBy.data.incidentId = new ObjectID(this.parentNamedByHook);
    }

    return { createBy: createBy, carryForward: null };
  }
}

let parentReads: Array<ParentRead>;
let readableIncidentIds: Array<string>;
let service: NoteService;

beforeEach(() => {
  stubProjectDirectory({});
  parentReads = [];
  readableIncidentIds = [INCIDENT_ID];
  service = new NoteService();

  /*
   * Every read a DatabaseService makes: the incidents the caller's read
   * finds, and nothing of any other table.
   */
  getJestSpyOn(DatabaseService.prototype, "findBy").mockImplementation(
    async function (
      this: DatabaseService<BaseModel>,
      findBy: FindBy<BaseModel>,
    ): Promise<Array<BaseModel>> {
      if (this.modelType !== (Incident as unknown)) {
        return [];
      }

      parentReads.push({ reader: this, findBy: findBy });

      return valuesOf(findBy.query._id)
        .filter((id: string): boolean => {
          return readableIncidentIds.includes(id);
        })
        .map((id: string): BaseModel => {
          const incident: Incident = new Incident();
          incident._id = id;
          return incident;
        });
    } as never,
  );

  getJestSpyOn(service, "getRepository").mockReturnValue({
    save: async (): Promise<never> => {
      throw new SavedSentinel();
    },
  } as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const refusalOf: (promise: Promise<unknown>) => Promise<unknown> = async (
  promise: Promise<unknown>,
): Promise<unknown> => {
  try {
    await promise;
  } catch (error) {
    return error;
  }

  return undefined;
};

describe("a create under a parent reads the parent as its creator would", () => {
  test("one read, of the parent's own table, selecting the ids alone, with the caller's props", async () => {
    const props: DatabaseCommonInteractionProps = noteWriterOnOneLabel();

    await refusalOf(service.create({ data: noteOn(INCIDENT_ID), props }));

    expect(parentReads).toHaveLength(1);

    const read: ParentRead = parentReads[0]!;

    expect(read.reader.modelType).toBe(Incident);
    // A plain service: no incident service's hooks run on the read.
    expect(read.reader.constructor).toBe(DatabaseService);
    expect(valuesOf(read.findBy.query._id)).toEqual([INCIDENT_ID]);
    expect(read.findBy.select).toEqual({ _id: true });
    expect(read.findBy.limit).toBe(1);
    expect(read.findBy.skip).toBe(0);
    expect(read.findBy.props.userId).toBe(props.userId);
    expect(read.findBy.props.tenantId).toBe(PROJECT_ID);
    expect(read.findBy.props.userTenantAccessPermission).toBe(
      props.userTenantAccessPermission,
    );
    expect(read.findBy.props.isRoot).toBeFalsy();
  });

  test("a request made across projects reads the parents of the request's project only", async () => {
    const props: DatabaseCommonInteractionProps = {
      ...noteWriterOnOneLabel(),
      isMultiTenantRequest: true,
    };

    await refusalOf(service.create({ data: noteOn(INCIDENT_ID), props }));

    expect(parentReads).toHaveLength(1);
    expect(parentReads[0]!.findBy.props.isMultiTenantRequest).toBe(false);
    expect(parentReads[0]!.findBy.props.tenantId).toBe(PROJECT_ID);
  });

  test("the same plain reader serves every create of the model", async () => {
    await refusalOf(
      service.create({
        data: noteOn(INCIDENT_ID),
        props: noteWriterOnOneLabel(),
      }),
    );
    await refusalOf(
      new NoteService().create({
        data: noteOn(INCIDENT_ID),
        props: noteWriterOnOneLabel(),
      }),
    );

    expect(parentReads).toHaveLength(2);
    expect(parentReads[0]!.reader).toBe(parentReads[1]!.reader);
  });
});

describe("before any hook, and again before the save when a hook names another parent", () => {
  test("a parent the read does not find is refused before the create hook runs", async () => {
    readableIncidentIds = [];

    const refusal: unknown = await refusalOf(
      service.create({
        data: noteOn(INCIDENT_ID),
        props: noteWriterOnOneLabel(),
      }),
    );

    expect(refusal).toBeInstanceOf(ProjectScopedReferenceException);
    expect(service.hookCalls).toBe(0);
  });

  test("a parent the read finds is asked about once, and the create reaches the save", async () => {
    const refusal: unknown = await refusalOf(
      service.create({
        data: noteOn(INCIDENT_ID),
        props: noteWriterOnOneLabel(),
      }),
    );

    expect(refusal).toBeInstanceOf(SavedSentinel);
    expect(service.hookCalls).toBe(1);
    expect(parentReads).toHaveLength(1);
  });

  test("a hook that names a parent the caller may not read is refused before the save", async () => {
    service.parentNamedByHook = OTHER_INCIDENT_ID;

    const refusal: unknown = await refusalOf(
      service.create({
        data: noteOn(INCIDENT_ID),
        props: noteWriterOnOneLabel(),
      }),
    );

    expect(refusal).toBeInstanceOf(ProjectScopedReferenceException);
    expect((refusal as Error).message).toContain(
      `Incident "${OTHER_INCIDENT_ID}"`,
    );
    expect(parentReads).toHaveLength(2);
    expect(valuesOf(parentReads[1]!.findBy.query._id)).toEqual([
      OTHER_INCIDENT_ID,
    ]);
  });

  test("a hook that names another parent the caller may read is let through", async () => {
    readableIncidentIds = [INCIDENT_ID, OTHER_INCIDENT_ID];
    service.parentNamedByHook = OTHER_INCIDENT_ID;

    const refusal: unknown = await refusalOf(
      service.create({
        data: noteOn(INCIDENT_ID),
        props: noteWriterOnOneLabel(),
      }),
    );

    expect(refusal).toBeInstanceOf(SavedSentinel);
    expect(parentReads).toHaveLength(2);
  });

  test("OneUptime's own create reads no parent", async () => {
    readableIncidentIds = [];

    const refusal: unknown = await refusalOf(
      service.create({
        data: noteOn(INCIDENT_ID),
        props: { isRoot: true, tenantId: PROJECT_ID },
      }),
    );

    expect(refusal).toBeInstanceOf(SavedSentinel);
    expect(parentReads).toEqual([]);
  });
});
