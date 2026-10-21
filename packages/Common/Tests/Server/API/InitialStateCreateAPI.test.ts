import { mockRouter } from "./Helpers";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * POST /alert, POST /alert-episode and POST /incident-episode with the
 * state the record starts in: the dashboard's create forms send their
 * Initial State as the relation (`currentAlertState: { _id }`), and the
 * API reference, Terraform (`current_alert_state_id`) and workflows send
 * the ID column. Either way the record is saved in that state; a state of
 * another project, or one that does not exist, is refused before anything
 * is written; and a create that names no state is saved in the project's
 * created state, as before.
 *
 * The server's own permission layer, the generic project check and the
 * services' own hooks run here; only the database is a stand-in: the
 * repository the create saves through, the project's states and which
 * records the project has (stubProjectDirectory). What the save is handed
 * is then turned into the INSERT TypeORM would run, to read the state that
 * would be stored.
 */

jest.mock("../../../Server/Utils/Express", () => {
  return {
    __esModule: true,
    default: {
      getRouter: () => {
        return mockRouter;
      },
    },
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    __esModule: true,
    default: {
      sendEmptySuccessResponse: jest.fn(),
      sendJsonObjectResponse: jest.fn(),
      sendEntityResponse: jest.fn(),
      sendEntityArrayResponse: jest.fn(),
      sendErrorResponse: jest.fn(),
    },
  };
});

// Every refusal below is deliberate; @CaptureSpan logs each one's stack.
jest.mock("../../../Server/Utils/Logger");

import BaseAPI from "../../../Server/API/BaseAPI";
import CommonAPI from "../../../Server/API/CommonAPI";
import AlertEpisodeService from "../../../Server/Services/AlertEpisodeService";
import AlertService from "../../../Server/Services/AlertService";
import AlertStateService from "../../../Server/Services/AlertStateService";
import AuditLogService from "../../../Server/Services/AuditLogService";
import CustomFieldMappingService from "../../../Server/Services/CustomFieldMappingService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import IncidentEpisodeService from "../../../Server/Services/IncidentEpisodeService";
import IncidentStateService from "../../../Server/Services/IncidentStateService";
import ProjectService from "../../../Server/Services/ProjectService";
import UserService from "../../../Server/Services/UserService";
import { ExpressRequest, ExpressResponse } from "../../../Server/Utils/Express";
import Response from "../../../Server/Utils/Response";
import Entities from "../../../Models/DatabaseModels/Index";
import Alert from "../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../Models/DatabaseModels/AlertEpisode";
import AlertState from "../../../Models/DatabaseModels/AlertState";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import IncidentEpisode from "../../../Models/DatabaseModels/IncidentEpisode";
import IncidentState from "../../../Models/DatabaseModels/IncidentState";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission, { UserPermission } from "../../../Types/Permission";
import UserType from "../../../Types/UserType";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { DataSource } from "typeorm";
import { QueryDeepPartialEntity } from "typeorm/query-builder/QueryPartialEntity";

import FeedMarkdown from "../../../Utils/Markdown/FeedMarkdown";
const PROJECT_ID: ObjectID = new ObjectID(
  "0193c0de-a91c-4aaa-8bbb-000000000001",
);
const USER_ID: ObjectID = new ObjectID("0193c0de-a91c-4aaa-8bbb-000000000002");

// The project's states: where new records start, then later ones.
const CREATED_STATE: string = "0193c0de-a91c-4aaa-8bbb-0000000000a1";
const ACKNOWLEDGED_STATE: string = "0193c0de-a91c-4aaa-8bbb-0000000000a2";
const RESOLVED_STATE: string = "0193c0de-a91c-4aaa-8bbb-0000000000a3";

// A state of another project, and an id no state has.
const FOREIGN_STATE: string = "0193c0de-a91c-4aaa-8bbb-0000000000f1";
const MISSING_STATE: string = "0193c0de-a91c-4aaa-8bbb-0000000000e9";

// An alert cannot exist without a severity.
const ALERT_SEVERITY: string = "0193c0de-a91c-4aaa-8bbb-0000000000b1";

type Role = [string, Array<Permission>];

type StateModel = AlertState | IncidentState;

interface Kind {
  name: string;
  // How the generic project check names the record: "alert episode".
  subject: string;
  modelType: { new (): BaseModel };
  service: DatabaseService<BaseModel>;
  stateService: unknown;
  stateModel: new () => StateModel;
  idColumn: string;
  relation: string;
  // The title of the state relation, as the generic check names it.
  stateRelationTitle: string;
  counter:
    | "incrementAndGetAlertCounter"
    | "incrementAndGetAlertEpisodeCounter"
    | "incrementAndGetIncidentEpisodeCounter";
  newRecord: () => JSONObject;
  creators: Array<Role>;
  notCreators: Array<Role>;
}

const KINDS: Array<Kind> = [
  {
    name: "alert",
    subject: "alert",
    modelType: Alert,
    service: AlertService as unknown as DatabaseService<BaseModel>,
    stateService: AlertStateService,
    stateModel: AlertState,
    idColumn: "currentAlertStateId",
    relation: "currentAlertState",
    stateRelationTitle: "Current Alert State",
    counter: "incrementAndGetAlertCounter",
    newRecord: () => {
      return { title: "Disk is full", alertSeverityId: ALERT_SEVERITY };
    },
    creators: [
      ["Project Owner", [Permission.ProjectOwner]],
      ["Project Admin", [Permission.ProjectAdmin]],
      ["Project Member", [Permission.ProjectMember]],
      ["Alert Admin", [Permission.AlertAdmin]],
      ["Alert Member", [Permission.AlertMember]],
      ["a role that may create alerts", [Permission.CreateAlert]],
    ],
    notCreators: [
      ["Viewer", [Permission.Viewer]],
      ["Alert Viewer", [Permission.AlertViewer]],
      ["Read Alert", [Permission.ReadAlert]],
    ],
  },
  {
    name: "alert episode",
    subject: "alert episode",
    modelType: AlertEpisode,
    service: AlertEpisodeService as unknown as DatabaseService<BaseModel>,
    stateService: AlertStateService,
    stateModel: AlertState,
    idColumn: "currentAlertStateId",
    relation: "currentAlertState",
    stateRelationTitle: "Current Alert State",
    counter: "incrementAndGetAlertEpisodeCounter",
    newRecord: () => {
      return { title: "Disk alerts" };
    },
    creators: [
      ["Project Owner", [Permission.ProjectOwner]],
      ["Project Member", [Permission.ProjectMember]],
      ["Alert Member", [Permission.AlertMember]],
      [
        "a role that may create alert episodes",
        [Permission.CreateAlertEpisode],
      ],
    ],
    notCreators: [
      ["Viewer", [Permission.Viewer]],
      ["Read Alert Episode", [Permission.ReadAlertEpisode]],
    ],
  },
  {
    name: "incident episode",
    subject: "incident episode",
    modelType: IncidentEpisode,
    service: IncidentEpisodeService as unknown as DatabaseService<BaseModel>,
    stateService: IncidentStateService,
    stateModel: IncidentState,
    idColumn: "currentIncidentStateId",
    relation: "currentIncidentState",
    stateRelationTitle: "Current Incident State",
    counter: "incrementAndGetIncidentEpisodeCounter",
    newRecord: () => {
      return { title: "Checkout errors" };
    },
    creators: [
      ["Project Owner", [Permission.ProjectOwner]],
      ["Project Member", [Permission.ProjectMember]],
      ["Incident Member", [Permission.IncidentMember]],
      [
        "a role that may create incident episodes",
        [Permission.CreateIncidentEpisode],
      ],
    ],
    notCreators: [
      ["Viewer", [Permission.Viewer]],
      ["Read Incident Episode", [Permission.ReadIncidentEpisode]],
    ],
  },
];

/*
 * A signed-in person holding exactly `permissions` in the project. Fresh
 * per call: the permission layer adds Public and Current User to the props
 * it is handed.
 */
function personWith(
  permissions: Array<Permission>,
): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    userType: UserType.User,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: PROJECT_ID,
        permissions: permissions.map(
          (permission: Permission): UserPermission => {
            return {
              _type: "UserPermission",
              permission: permission,
              labelIds: [],
              isBlockPermission: false,
            };
          },
        ),
      },
    },
  };
}

// The members of a service these tests stub that its type keeps private.
interface StubbableService {
  getRepository: () => unknown;
  onCreateSuccess: (...args: Array<unknown>) => Promise<unknown>;
  onTriggerWorkflow: (...args: Array<unknown>) => Promise<unknown>;
  onTriggerRealtime: (...args: Array<unknown>) => Promise<unknown>;
  autoOwnerOnCreate: (...args: Array<unknown>) => Promise<unknown>;
}

let database: DataSource;
let repositorySave: MockFunction;
let caller: DatabaseCommonInteractionProps;
let numbersUsed: number = 0;

beforeAll(async () => {
  database = new DataSource({
    type: "postgres",
    entities: Entities,
    synchronize: false,
  });

  await (
    database as unknown as { buildMetadatas: () => Promise<void> }
  ).buildMetadatas();
});

/*
 * The project's states, answered the way the database would: pinned to the
 * project, by id or by the created-state flag.
 */
function stubStates(kind: Kind): void {
  jest
    .spyOn(
      kind.stateService as {
        findOneBy: (...args: Array<unknown>) => Promise<unknown>;
      },
      "findOneBy",
    )
    .mockImplementation((async (findBy: {
      query: Record<string, unknown>;
    }): Promise<StateModel | null> => {
      const query: Record<string, unknown> = findBy.query;

      if (
        String(query["projectId"]).toLowerCase() !==
        PROJECT_ID.toString().toLowerCase()
      ) {
        return null;
      }

      let id: string | null = null;

      if (query["isCreatedState"] === true) {
        id = CREATED_STATE;
      } else if (
        [CREATED_STATE, ACKNOWLEDGED_STATE, RESOLVED_STATE].includes(
          String(query["_id"]).toLowerCase(),
        )
      ) {
        id = String(query["_id"]).toLowerCase();
      }

      if (!id) {
        return null;
      }

      return stateRow(kind, id);
    }) as never);

  /*
   * The project's whole list, in its order, as where a record starts is
   * read from it (getStartingStage).
   */
  jest
    .spyOn(
      kind.stateService as {
        findBy: (...args: Array<unknown>) => Promise<unknown>;
      },
      "findBy",
    )
    .mockImplementation((async (findBy: {
      query: Record<string, unknown>;
    }): Promise<Array<StateModel>> => {
      if (
        String(findBy.query["projectId"]).toLowerCase() !==
        PROJECT_ID.toString().toLowerCase()
      ) {
        return [];
      }

      return [CREATED_STATE, ACKNOWLEDGED_STATE, RESOLVED_STATE].map(
        (id: string): StateModel => {
          return stateRow(kind, id);
        },
      );
    }) as never);
}

// One of the project's states, with its flags and its place in the list.
function stateRow(kind: Kind, id: string): StateModel {
  const state: StateModel = new kind.stateModel();
  state._id = id;
  state.isCreatedState = id === CREATED_STATE;
  state.isAcknowledgedState = id === ACKNOWLEDGED_STATE;
  state.isResolvedState = id === RESOLVED_STATE;
  state.order =
    [CREATED_STATE, ACKNOWLEDGED_STATE, RESOLVED_STATE].indexOf(id) + 1;
  return state;
}

// The database behind the service: the save hands the row back as stored.
function stubDatabase(kind: Kind): void {
  const service: StubbableService = kind.service as unknown as StubbableService;

  repositorySave = getJestMockFunction();
  repositorySave.mockImplementation((async (item: BaseModel) => {
    item._id = "0193c0de-a91c-4aaa-8bbb-0000000000d1";
    return item;
  }) as never);

  jest
    .spyOn(service, "getRepository")
    .mockReturnValue({ save: repositorySave } as never);

  // The success chain (the first timeline row) has suites of its own.
  jest.spyOn(service, "onCreateSuccess").mockImplementation((async (
    _onCreate: unknown,
    createdItem: BaseModel,
  ): Promise<BaseModel> => {
    return createdItem;
  }) as never);
  jest
    .spyOn(service, "onTriggerWorkflow")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(service, "onTriggerRealtime")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(service, "autoOwnerOnCreate")
    .mockResolvedValue(undefined as never);

  stubStates(kind);
}

async function post(kind: Kind, data: JSONObject): Promise<void> {
  const api: BaseAPI<BaseModel, DatabaseService<BaseModel>> = new BaseAPI<
    BaseModel,
    DatabaseService<BaseModel>
  >(kind.modelType, kind.service);

  const request: ExpressRequest = {
    params: {},
    body: { data: { ...kind.newRecord(), ...data } },
    headers: {},
  } as unknown as ExpressRequest;

  const response: ExpressResponse = {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;

  await api.createItem(request, response);
}

// The row the one save was handed.
function saved(): BaseModel {
  expect(repositorySave).toHaveBeenCalledTimes(1);
  return repositorySave.mock.calls[0]![0] as BaseModel;
}

// The parameter the INSERT TypeORM builds for this row binds to `column`.
function storedIn(kind: Kind, row: BaseModel, column: string): unknown {
  const [sql, parameters]: [string, Array<unknown>] = database
    .createQueryBuilder()
    .insert()
    .into(kind.modelType)
    .values(row as unknown as QueryDeepPartialEntity<BaseModel>)
    .getQueryAndParameters();

  const columns: Array<string> = (sql.match(/\(([^)]*)\) VALUES/) || [
    "",
    "",
  ])[1]!
    .split(",")
    .map((name: string): string => {
      return name.trim();
    });

  const values: Array<string> = (sql.match(
    /VALUES \((.*?)\)( RETURNING|$)/,
  ) || ["", ""])[1]!
    .split(",")
    .map((value: string): string => {
      return value.trim();
    });

  const placeholder: string = values[columns.indexOf(`"${column}"`)]!;

  if (!placeholder || !placeholder.startsWith("$")) {
    return placeholder;
  }

  return parameters[Number(placeholder.slice(1)) - 1];
}

function storedState(kind: Kind): string {
  return String(storedIn(kind, saved(), kind.idColumn)).toLowerCase();
}

beforeEach(() => {
  caller = personWith([Permission.ProjectAdmin]);
  numbersUsed = 0;

  jest
    .spyOn(CommonAPI, "getDatabaseCommonInteractionProps")
    .mockImplementation((async (): Promise<DatabaseCommonInteractionProps> => {
      return caller;
    }) as never);

  stubProjectDirectory({
    projectId: PROJECT_ID,
    records: {
      AlertState: [CREATED_STATE, ACKNOWLEDGED_STATE, RESOLVED_STATE],
      IncidentState: [CREATED_STATE, ACKNOWLEDGED_STATE, RESOLVED_STATE],
      AlertSeverity: [ALERT_SEVERITY],
    },
  });

  // Each number a create spends from the project's counter, counted.
  const useNumber: () => Promise<{
    counter: number;
    prefix: string | undefined;
  }> = async (): Promise<{ counter: number; prefix: string | undefined }> => {
    numbersUsed++;
    return { counter: 7, prefix: undefined };
  };

  jest
    .spyOn(ProjectService, "incrementAndGetAlertCounter")
    .mockImplementation(useNumber as never);
  jest
    .spyOn(ProjectService, "incrementAndGetAlertEpisodeCounter")
    .mockImplementation(useNumber as never);
  jest
    .spyOn(ProjectService, "incrementAndGetIncidentEpisodeCounter")
    .mockImplementation(useNumber as never);

  jest
    .spyOn(CustomFieldMappingService, "applyMappingsToCreate")
    .mockResolvedValue(undefined as never);
  jest
    .spyOn(UserService, "getUserMarkdownString")
    .mockResolvedValue(FeedMarkdown.asMarkdown("Ada") as never);
  jest
    .spyOn(AuditLogService, "recordCreate")
    .mockResolvedValue(undefined as never);

  (Response.sendEntityResponse as unknown as MockFunction).mockClear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe.each(KINDS)("POST a new $name with an Initial State", (kind: Kind) => {
  beforeEach(() => {
    stubDatabase(kind);
  });

  test.each(kind.creators)(
    "%s picks it by the relation, as the create form sends it: it is saved in that state",
    async (_role: string, permissions: Array<Permission>) => {
      caller = personWith(permissions);

      await post(kind, { [kind.relation]: { _id: ACKNOWLEDGED_STATE } });

      expect(Response.sendEntityResponse).toHaveBeenCalledTimes(1);
      expect(storedState(kind)).toBe(ACKNOWLEDGED_STATE);
      // Under the ID column alone: no relation left to be stored instead.
      expect(
        (saved() as unknown as Record<string, unknown>)[kind.relation],
      ).toBeUndefined();
    },
  );

  test.each(kind.creators)(
    "%s picks it by the ID column, as the API reference documents and Terraform writes it",
    async (_role: string, permissions: Array<Permission>) => {
      caller = personWith(permissions);

      await post(kind, { [kind.idColumn]: RESOLVED_STATE });

      expect(Response.sendEntityResponse).toHaveBeenCalledTimes(1);
      expect(storedState(kind)).toBe(RESOLVED_STATE);
    },
  );

  test("the record handed back is in the state it was created in", async () => {
    await post(kind, { [kind.relation]: { _id: RESOLVED_STATE } });

    const sendEntityResponse: MockFunction =
      Response.sendEntityResponse as unknown as MockFunction;
    const returned: BaseModel = sendEntityResponse.mock
      .calls[0]![2] as BaseModel;

    expect(
      String(
        (returned as unknown as Record<string, unknown>)[kind.idColumn],
      ).toLowerCase(),
    ).toBe(RESOLVED_STATE);
  });

  test("a create that names no state is saved in the project's created state", async () => {
    await post(kind, {});

    expect(storedState(kind)).toBe(CREATED_STATE);
    expect(numbersUsed).toBe(1);
  });

  test("a create whose state field is empty is saved in the project's created state", async () => {
    await post(kind, { [kind.relation]: null });

    expect(storedState(kind)).toBe(CREATED_STATE);
  });

  test("the same state under both names is saved in that state", async () => {
    await post(kind, {
      [kind.idColumn]: ACKNOWLEDGED_STATE,
      [kind.relation]: { _id: ACKNOWLEDGED_STATE.toUpperCase() },
    });

    expect(storedState(kind)).toBe(ACKNOWLEDGED_STATE);
  });

  test.each(kind.notCreators)(
    "%s may not create one, in any state, and nothing is written",
    async (_role: string, permissions: Array<Permission>) => {
      caller = personWith(permissions);

      await expect(
        post(kind, { [kind.relation]: { _id: ACKNOWLEDGED_STATE } }),
      ).rejects.toThrow();

      expect(repositorySave).not.toHaveBeenCalled();
      expect(numbersUsed).toBe(0);
    },
  );

  test.each([
    [
      "the relation",
      (id: string): JSONObject => {
        return { [kind.relation]: { _id: id } };
      },
    ],
    [
      "the ID column",
      (id: string): JSONObject => {
        return { [kind.idColumn]: id };
      },
    ],
  ] as Array<[string, (id: string) => JSONObject]>)(
    "a state of another project by %s is refused with the same words as one that does not exist, and nothing is written",
    async (_name: string, payload: (id: string) => JSONObject) => {
      let foreign: unknown = null;
      let missing: unknown = null;

      try {
        await post(kind, payload(FOREIGN_STATE));
      } catch (error) {
        foreign = error;
      }

      try {
        await post(kind, payload(MISSING_STATE));
      } catch (error) {
        missing = error;
      }

      expect(foreign).toBeInstanceOf(BadDataException);
      expect(missing).toBeInstanceOf(BadDataException);
      expect((foreign as Error).message).toBe(
        `This ${kind.subject} references records that are not in this project: ${kind.stateRelationTitle} "${FOREIGN_STATE}". Please pick values from this project and try again.`,
      );
      expect((missing as Error).message.split(MISSING_STATE).join("<id>")).toBe(
        (foreign as Error).message.split(FOREIGN_STATE).join("<id>"),
      );

      expect(repositorySave).not.toHaveBeenCalled();
      expect(numbersUsed).toBe(0);
    },
  );

  test("two different states under the two names are refused, naming both fields, and nothing is written", async () => {
    await expect(
      post(kind, {
        [kind.idColumn]: CREATED_STATE,
        [kind.relation]: { _id: RESOLVED_STATE },
      }),
    ).rejects.toThrow(
      `${kind.idColumn} and ${kind.relation} are names for the same field and must hold the same value`,
    );

    expect(repositorySave).not.toHaveBeenCalled();
    expect(numbersUsed).toBe(0);
  });
});

describe.each(
  KINDS.filter((kind: Kind): boolean => {
    return kind.name !== "alert";
  }),
)("POST a new $name in a resolved state", (kind: Kind) => {
  beforeEach(() => {
    stubDatabase(kind);
  });

  test("it is saved resolved, with the moment it was recorded as its resolvedAt", async () => {
    const before: number = Date.now();

    await post(kind, { [kind.relation]: { _id: RESOLVED_STATE } });

    const resolvedAt: unknown = (saved() as unknown as Record<string, unknown>)[
      "resolvedAt"
    ];

    expect(storedState(kind)).toBe(RESOLVED_STATE);
    expect(resolvedAt).toBeInstanceOf(Date);
    expect((resolvedAt as Date).getTime()).toBeGreaterThanOrEqual(
      before - 1000,
    );
  });

  test("one saved in a state before resolved has no resolvedAt", async () => {
    await post(kind, { [kind.relation]: { _id: ACKNOWLEDGED_STATE } });

    expect(
      (saved() as unknown as Record<string, unknown>)["resolvedAt"],
    ).toBeUndefined();
  });
});
