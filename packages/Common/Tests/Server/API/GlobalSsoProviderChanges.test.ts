import BaseAPI from "../../../Server/API/BaseAPI";
import Semaphore, {
  SemaphoreLockTimeoutError,
} from "../../../Server/Infrastructure/Semaphore";
import AuditLogService from "../../../Server/Services/AuditLogService";
import DatabaseService from "../../../Server/Services/DatabaseService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import GlobalOidcProjectService from "../../../Server/Services/GlobalOidcProjectService";
import GlobalOidcService from "../../../Server/Services/GlobalOidcService";
import GlobalSsoProjectService from "../../../Server/Services/GlobalSsoProjectService";
import GlobalSsoService from "../../../Server/Services/GlobalSsoService";
import ProjectOidcService from "../../../Server/Services/ProjectOidcService";
import ProjectService from "../../../Server/Services/ProjectService";
import ProjectSsoService from "../../../Server/Services/ProjectSsoService";
import {
  ExpressResponse,
  OneUptimeRequest,
} from "../../../Server/Utils/Express";
import { clearGlobalSsoAuthorizationCaches } from "../../../Server/Utils/GlobalSsoAuthorization";
import logger from "../../../Server/Utils/Logger";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import ProjectSsoProviderChanges, {
  SIGN_IN_CHANGE_IN_PROGRESS_MESSAGE,
} from "../../../Server/Utils/ProjectSsoProviderChanges";
import SsoRequirementChanges from "../../../Server/Utils/SsoRequirementChanges";
import SsoSignInWays, {
  GlobalProviderAttachmentRows,
} from "../../../Server/Utils/SsoSignInWays";
import RealtimeAccessChanges, {
  RealtimeAccessChange,
  RealtimeAccessChangeKind,
} from "../../../Server/Utils/Realtime/RealtimeAccessChanges";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import GlobalOidc from "../../../Models/DatabaseModels/GlobalOidc";
import GlobalOidcProject from "../../../Models/DatabaseModels/GlobalOidcProject";
import GlobalSso from "../../../Models/DatabaseModels/GlobalSso";
import GlobalSsoProject from "../../../Models/DatabaseModels/GlobalSsoProject";
import Project from "../../../Models/DatabaseModels/Project";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import BadDataException from "../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import UserType from "../../../Types/UserType";
import { mockRouter } from "./Helpers";
import { getJestSpyOn } from "../../Spy";
import { rowMatchesWhere } from "../TestingUtils/InMemoryRepository";
import {
  COMMIT_STATEMENT,
  INSERT_STATEMENT,
  clientTimeout,
} from "../TestingUtils/StatementFailures";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

jest.mock("../../../Server/Utils/Express", () => {
  return {
    getRouter: () => {
      return mockRouter;
    },
  };
});

jest.mock("../../../Server/Utils/Response", () => {
  return {
    sendEmptySuccessResponse: jest.fn(),
    sendEntityResponse: jest.fn(),
    sendEntityArrayResponse: jest.fn(),
    sendJsonObjectResponse: jest.fn(),
  };
});

/*
 * A GLOBAL SSO PROVIDER, OR ONE OF ITS ATTACHMENTS, CHANGED THROUGH THE ADMIN
 * API: WHAT ENDS, AND WHAT MUST STAY (Server/Utils/GlobalSsoProviderChanges).
 *
 * The master admin's own routes (BaseAPI: /global-sso, /global-oidc and
 * their attachments, /global-config) over the services' real update, delete
 * and create paths. Only the repositories underneath hold rows in memory;
 * the projects, their own providers and their rules are read through their
 * services, stubbed below. The suite checks:
 *
 *   - turning a global provider off writes when its sign-ins ended, in the
 *     same write; turning it on again keeps that time; changing anything
 *     else about it writes no time;
 *   - a project that requires SSO - itself, or because the whole server does
 *     - keeps a way in: turning a provider off, deleting it, restricting it
 *     to its attached projects, and adding the first attachment of a
 *     restricted provider, turning an attachment off, moving it or removing
 *     it are refused when they would leave one with no provider, and the
 *     refusal names the projects, or counts them;
 *   - turning the server's Require SSO for Login on needs a provider for
 *     every project that does not require SSO itself;
 *   - the check and the write hold the lock on the server's sign-in rules,
 *     taken once every other check has passed, kept while the check runs,
 *     and given back once the write is done, refused or fails; a write that
 *     only lets a provider sign more people in takes no lock and is never
 *     refused.
 */

const id: (n: number) => string = (n: number): string => {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
};

const ADMIN_ID: string = id(1);
const ACME: string = id(11);
const BETA: string = id(12);
const GAMMA: string = id(13);
const PROVIDER: string = id(21);
const OTHER_PROVIDER: string = id(22);
const ACME_SAML: string = id(31);
const CONFIG_ID: string = id(41);

const SERVER_LOCK: string = "server";

type Row = Record<string, unknown> & { _id: string };

interface Table {
  rows: Array<Row>;
  writes: Array<{ id: string; set: Record<string, unknown> }>;
  deleted: Array<string>;
  created: Array<Row>;
}

const emptyTable: () => Table = (): Table => {
  return { rows: [], writes: [], deleted: [], created: [] };
};

let globalSamlTable: Table;
let globalOidcTable: Table;
let samlAttachmentTable: Table;
let oidcAttachmentTable: Table;
let configTable: Table;

interface ProjectRow {
  id: string;
  name: string;
  requireSsoForLogin: boolean;
  requiredProviderId: string | null;
}

let projects: Array<ProjectRow> = [];
let ownSaml: Array<{ id: string; projectId: string; isEnabled: boolean }> = [];

let events: Array<string> = [];
let busyLock: string | null = null;
let locksFail: boolean = false;
let announced: Array<RealtimeAccessChange> = [];

// The locks kept while a check ran, and those found lost meanwhile.
let kept: Array<string> = [];
// By key: a lock taken again is lost too.
let lostLocks: Array<string> = [];
// As handed out: a lock taken again is not lost.
let lostLockObjects: Set<{ key: string }> = new Set<{ key: string }>();

// The database refuses every write of this kind it is asked for.
let failing: "update" | "delete" | "save" | null = null;

// What an INSERT fails with instead, as TypeORM hands it on.
let saveFailsWith: Error | null = null;

// The locks Semaphore.lock handed out, by key, the last of each.
let lockObjects: Map<string, { key: string }> = new Map<
  string,
  { key: string }
>();

// Runs as the database is asked to write, delete or insert rows, before it does.
let whileWriting: (() => void) | null = null;

// The values a repository `where` asks a column for, lower-cased.
const askedValues: (value: unknown) => Array<string> | null = (
  value: unknown,
): Array<string> | null => {
  if (value === undefined) {
    return null;
  }

  if (
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number" ||
    value instanceof ObjectID
  ) {
    return [value.toString().toLowerCase()];
  }

  const operator: { _objectLiteralParameters?: Record<string, unknown> } =
    value as { _objectLiteralParameters?: Record<string, unknown> };

  if (operator && operator._objectLiteralParameters) {
    return Object.values(operator._objectLiteralParameters)
      .flat()
      .map((parameter: unknown): string => {
        return String(parameter).toLowerCase();
      });
  }

  throw new Error(`This test cannot read the query value ${String(value)}`);
};

/*
 * Whether a row matches a repository `where`, as Postgres would decide it:
 * values and ids, and the operators the services write - ids among those
 * read, rows deleted before (deletedAt set), several conditions on one
 * column together (InMemoryRepository).
 */
const matches: (row: Row, where: Record<string, unknown>) => boolean = (
  row: Row,
  where: Record<string, unknown>,
): boolean => {
  return rowMatchesWhere(row, where);
};

const toStored: (value: unknown) => unknown = (value: unknown): unknown => {
  return value instanceof ObjectID ? value.toString() : value;
};

// The repository of a table held in memory.
const stubTable: (
  service: unknown,
  table: () => Table,
  createModel: () => BaseModel,
) => void = (
  service: unknown,
  table: () => Table,
  createModel: () => BaseModel,
): void => {
  const toModel: (row: Row) => BaseModel = (row: Row): BaseModel => {
    const model: BaseModel = createModel();
    Object.assign(model, row);
    return model;
  };

  getJestSpyOn(service, "getRepository").mockReturnValue({
    find: async (options: {
      where: Record<string, unknown>;
      skip?: number;
      take?: number;
      withDeleted?: boolean;
    }): Promise<Array<BaseModel>> => {
      // A row deleted already is found only when deleted rows are asked for, as TypeORM does.
      const found: Array<Row> = table().rows.filter((row: Row): boolean => {
        return (
          (options.withDeleted || !row["deletedAt"]) &&
          matches(row, options.where)
        );
      });
      const skip: number = options.skip || 0;
      const take: number = options.take || found.length;

      return found.slice(skip, skip + take).map(toModel);
    },
    count: async (options: {
      where: Record<string, unknown>;
    }): Promise<number> => {
      return table().rows.filter((row: Row): boolean => {
        return matches(row, options.where);
      }).length;
    },
    update: async (
      where: Record<string, unknown>,
      set: Record<string, unknown>,
    ): Promise<{ affected: number }> => {
      if (failing === "update") {
        throw new Error("The database could not write the row");
      }

      whileWriting?.();

      const written: Record<string, unknown> = {};

      for (const [column, value] of Object.entries(set)) {
        if (column !== "version") {
          written[column] = toStored(value);
        }
      }

      let affected: number = 0;

      for (const row of table().rows) {
        if (matches(row, where)) {
          Object.assign(row, written);
          table().writes.push({ id: row._id, set: written });
          events.push(`write:${row._id}`);
          affected++;
        }
      }

      return { affected };
    },
    delete: async (
      where: Record<string, unknown>,
    ): Promise<{ affected: number }> => {
      if (failing === "delete") {
        throw new Error("The database could not delete the row");
      }

      whileWriting?.();

      const gone: Array<Row> = table().rows.filter((row: Row): boolean => {
        return matches(row, where);
      });

      for (const row of gone) {
        table().deleted.push(row._id);
        events.push(`delete:${row._id}`);
      }

      table().rows = table().rows.filter((row: Row): boolean => {
        return !gone.includes(row);
      });

      return { affected: gone.length };
    },
    save: async (data: BaseModel): Promise<BaseModel> => {
      if (saveFailsWith) {
        throw saveFailsWith;
      }

      if (failing === "save") {
        throw new Error("The database could not insert the row");
      }

      whileWriting?.();

      const row: Row = { _id: data._id || ObjectID.generate().toString() };

      for (const [column, value] of Object.entries(data)) {
        if (value !== undefined && typeof value !== "function") {
          row[column] = toStored(value);
        }
      }

      row._id = String(row._id);
      table().rows.push(row);
      table().created.push(row);
      events.push(`create:${row._id}`);

      return toModel(row);
    },
  } as never);

  getJestSpyOn(service, "onTriggerWorkflow").mockResolvedValue(
    undefined as never,
  );
  getJestSpyOn(service, "onTriggerRealtime").mockResolvedValue(
    undefined as never,
  );
};

const toProject: (row: ProjectRow) => Project = (row: ProjectRow): Project => {
  const model: Project = new Project();
  model.id = new ObjectID(row.id);
  model.name = row.name;
  model.requireSsoForLogin = row.requireSsoForLogin;

  if (row.requiredProviderId) {
    model.requireSsoWithSsoProviderId = new ObjectID(row.requiredProviderId);
  }

  return model;
};

const project: (
  projectId: string,
  name: string,
  rule?: { requireSsoForLogin?: boolean; requiredProviderId?: string },
) => ProjectRow = (
  projectId: string,
  name: string,
  rule?: { requireSsoForLogin?: boolean; requiredProviderId?: string },
): ProjectRow => {
  return {
    id: projectId,
    name,
    requireSsoForLogin: rule?.requireSsoForLogin !== false,
    requiredProviderId: rule?.requiredProviderId || null,
  };
};

interface ProviderKind {
  label: string;
  providerApi: BaseAPI<any, any>;
  attachmentApi: BaseAPI<any, any>;
  // The services underneath, for the writes no route makes (the retention job's hard delete).
  providerService: DatabaseService<any>;
  attachmentService: DatabaseService<any>;
  providerTable: () => Table;
  attachmentTable: () => Table;
  // The other kind's provider table, which the check reads too.
  otherProviderTable: () => Table;
  providerColumn: "globalSsoId" | "globalOidcId";
}

const SAML: ProviderKind = {
  label: "SAML",
  providerApi: new BaseAPI<any, any>(
    GlobalSso as never,
    GlobalSsoService as never,
  ),
  attachmentApi: new BaseAPI<any, any>(
    GlobalSsoProject as never,
    GlobalSsoProjectService as never,
  ),
  providerService: GlobalSsoService as unknown as DatabaseService<any>,
  attachmentService: GlobalSsoProjectService as unknown as DatabaseService<any>,
  providerTable: (): Table => {
    return globalSamlTable;
  },
  attachmentTable: (): Table => {
    return samlAttachmentTable;
  },
  otherProviderTable: (): Table => {
    return globalOidcTable;
  },
  providerColumn: "globalSsoId",
};

const OIDC: ProviderKind = {
  label: "OIDC",
  providerApi: new BaseAPI<any, any>(
    GlobalOidc as never,
    GlobalOidcService as never,
  ),
  attachmentApi: new BaseAPI<any, any>(
    GlobalOidcProject as never,
    GlobalOidcProjectService as never,
  ),
  providerService: GlobalOidcService as unknown as DatabaseService<any>,
  attachmentService:
    GlobalOidcProjectService as unknown as DatabaseService<any>,
  providerTable: (): Table => {
    return globalOidcTable;
  },
  attachmentTable: (): Table => {
    return oidcAttachmentTable;
  },
  otherProviderTable: (): Table => {
    return globalSamlTable;
  },
  providerColumn: "globalOidcId",
};

const CONFIG_API: BaseAPI<any, any> = new BaseAPI<any, any>(
  GlobalConfig as never,
  GlobalConfigService as never,
);

// A master admin, as the API's auth middleware leaves the request.
const request: (data: {
  id?: string;
  body?: JSONObject;
}) => OneUptimeRequest = (data: {
  id?: string;
  body?: JSONObject;
}): OneUptimeRequest => {
  return {
    params: { id: data.id || PROVIDER },
    body: data.body || {},
    headers: {},
    query: {},
    userType: UserType.MasterAdmin,
    userAuthorization: { userId: new ObjectID(ADMIN_ID) },
  } as unknown as OneUptimeRequest;
};

const response: () => ExpressResponse = (): ExpressResponse => {
  return {
    status: jest.fn().mockReturnThis(),
    json: jest.fn().mockReturnThis(),
    send: jest.fn().mockReturnThis(),
  } as unknown as ExpressResponse;
};

// What a route answers: "done", or the refusal's message.
const call: (run: () => Promise<void>) => Promise<string> = async (
  run: () => Promise<void>,
): Promise<string> => {
  try {
    await run();
    return "done";
  } catch (err) {
    if (err instanceof BadDataException) {
      return err.message;
    }

    throw err;
  }
};

const updateProvider: (
  kind: ProviderKind,
  data: JSONObject,
  providerId?: string,
) => Promise<string> = (
  kind: ProviderKind,
  data: JSONObject,
  providerId?: string,
): Promise<string> => {
  return call(async () => {
    await kind.providerApi.updateItem(
      request({ id: providerId || PROVIDER, body: { data } }),
      response(),
    );
  });
};

const deleteProvider: (kind: ProviderKind) => Promise<string> = (
  kind: ProviderKind,
): Promise<string> => {
  return call(async () => {
    await kind.providerApi.deleteItem(request({ id: PROVIDER }), response());
  });
};

const attach: (
  kind: ProviderKind,
  projectId: string,
  data?: JSONObject,
) => Promise<string> = (
  kind: ProviderKind,
  projectId: string,
  data?: JSONObject,
): Promise<string> => {
  return call(async () => {
    await kind.attachmentApi.createItem(
      request({
        body: {
          data: {
            [kind.providerColumn]: PROVIDER,
            projectId: projectId,
            ...(data || {}),
          },
        },
      }),
      response(),
    );
  });
};

const updateAttachment: (
  kind: ProviderKind,
  attachmentId: string,
  data: JSONObject,
) => Promise<string> = (
  kind: ProviderKind,
  attachmentId: string,
  data: JSONObject,
): Promise<string> => {
  return call(async () => {
    await kind.attachmentApi.updateItem(
      request({ id: attachmentId, body: { data } }),
      response(),
    );
  });
};

const detach: (kind: ProviderKind, attachmentId: string) => Promise<string> = (
  kind: ProviderKind,
  attachmentId: string,
): Promise<string> => {
  return call(async () => {
    await kind.attachmentApi.deleteItem(
      request({ id: attachmentId }),
      response(),
    );
  });
};

const updateServerRule: (requireSsoForLogin: boolean) => Promise<string> = (
  requireSsoForLogin: boolean,
): Promise<string> => {
  return call(async () => {
    await CONFIG_API.updateItem(
      request({ id: CONFIG_ID, body: { data: { requireSsoForLogin } } }),
      response(),
    );
  });
};

const providerRow: (
  kind: ProviderKind,
  providerId?: string,
) => Row | undefined = (
  kind: ProviderKind,
  providerId?: string,
): Row | undefined => {
  return kind.providerTable().rows.find((row: Row): boolean => {
    return row._id === (providerId || PROVIDER);
  });
};

const attachmentRow: (
  kind: ProviderKind,
  attachmentId: string,
  projectId: string,
  isEnabled?: boolean,
) => Row = (
  kind: ProviderKind,
  attachmentId: string,
  projectId: string,
  isEnabled?: boolean,
): Row => {
  return {
    _id: attachmentId,
    [kind.providerColumn]: PROVIDER,
    projectId: projectId,
    isEnabled: isEnabled !== false,
  };
};

const ATTACHED_TO_ACME: string = id(51);
const ATTACHED_TO_BETA: string = id(52);
const ATTACHED_LATER: string = id(53);
const DELETED_BEFORE: string = id(61);
const CREATED_LATER: string = id(62);

/*
 * Runs `landing` once, right after the first read through `service` that
 * selects `selected` - the hooks' own read of the rows a write names - as
 * another server's write landing then would.
 */
/*
 * Each read the hooks make of the rows a write names - holding the write to
 * them (DatabaseService.findRowsAndHoldUpdateToThem and
 * findRowsAndHoldDeleteToThem, which read with findBy, or findByWithDeleted
 * for a hard delete) - told by the column it selects and the deletion it
 * reads too: `answer` handles each, given the read and the read itself.
 */
const onHoldReads: (
  service: DatabaseService<any>,
  selected: string,
  answer: (read: () => Promise<unknown>) => Promise<unknown>,
) => void = (
  service: DatabaseService<any>,
  selected: string,
  answer: (read: () => Promise<unknown>) => Promise<unknown>,
): void => {
  for (const method of ["findBy", "findByWithDeleted"]) {
    const reads: Record<
      string,
      (...args: Array<unknown>) => Promise<unknown>
    > = service as unknown as Record<
      string,
      (...args: Array<unknown>) => Promise<unknown>
    >;
    const read: (...args: Array<unknown>) => Promise<unknown> =
      reads[method]!.bind(service);

    getJestSpyOn(service, method as never).mockImplementation((async (
      ...args: Array<unknown>
    ): Promise<unknown> => {
      const select: Record<string, unknown> =
        (args[0] as { select?: Record<string, unknown> }).select || {};

      if (!select[selected] || !select["deletedAt"]) {
        return await read(...args);
      }

      return await answer((): Promise<unknown> => {
        return read(...args);
      });
    }) as never);
  }
};

// Once the hooks first read the rows a write names, `landing` runs.
const afterRead: (
  service: DatabaseService<any>,
  selected: string,
  landing: () => void,
) => void = (
  service: DatabaseService<any>,
  selected: string,
  landing: () => void,
): void => {
  let hasLanded: boolean = false;

  onHoldReads(
    service,
    selected,
    async (read: () => Promise<unknown>): Promise<unknown> => {
      const rows: unknown = await read();

      if (!hasLanded) {
        hasLanded = true;
        landing();
      }

      return rows;
    },
  );
};

// The hooks' reads of the rows a write names fail.
const failHoldReads: (
  service: DatabaseService<any>,
  selected: string,
  error: Error,
) => void = (
  service: DatabaseService<any>,
  selected: string,
  error: Error,
): void => {
  onHoldReads(service, selected, async (): Promise<unknown> => {
    throw error;
  });
};

// Whether each lock Semaphore.lock handed out is kept alive for a write now.
const keptForWrite: () => Array<boolean> = (): Array<boolean> => {
  return Array.from(lockObjects.values()).map(
    (lock: { key: string }): boolean => {
      return ProjectSsoProviderChanges.isKeptForWrite(lock as never);
    },
  );
};

beforeEach(() => {
  clearGlobalSsoAuthorizationCaches();

  globalSamlTable = emptyTable();
  globalOidcTable = emptyTable();
  samlAttachmentTable = emptyTable();
  oidcAttachmentTable = emptyTable();
  configTable = emptyTable();
  configTable.rows = [{ _id: CONFIG_ID, requireSsoForLogin: false }];

  projects = [];
  ownSaml = [];
  events = [];
  busyLock = null;
  locksFail = false;
  announced = [];
  kept = [];
  lostLocks = [];
  lostLockObjects = new Set<{ key: string }>();
  failing = null;
  saveFailsWith = null;
  lockObjects = new Map<string, { key: string }>();
  whileWriting = null;

  for (const silenced of ["debug", "info", "warn", "error"]) {
    getJestSpyOn(logger, silenced).mockImplementation((): void => {
      return undefined;
    });
  }

  stubTable(
    GlobalSsoService,
    (): Table => {
      return globalSamlTable;
    },
    (): BaseModel => {
      return new GlobalSso();
    },
  );
  stubTable(
    GlobalOidcService,
    (): Table => {
      return globalOidcTable;
    },
    (): BaseModel => {
      return new GlobalOidc();
    },
  );
  stubTable(
    GlobalSsoProjectService,
    (): Table => {
      return samlAttachmentTable;
    },
    (): BaseModel => {
      return new GlobalSsoProject();
    },
  );
  stubTable(
    GlobalOidcProjectService,
    (): Table => {
      return oidcAttachmentTable;
    },
    (): BaseModel => {
      return new GlobalOidcProject();
    },
  );
  stubTable(
    GlobalConfigService,
    (): Table => {
      return configTable;
    },
    (): BaseModel => {
      return new GlobalConfig();
    },
  );

  // The projects and their own providers, read through their services.
  getJestSpyOn(ProjectService, "findOneById").mockImplementation((async (data: {
    id: ObjectID;
  }): Promise<Project | null> => {
    const found: ProjectRow | undefined = projects.find(
      (row: ProjectRow): boolean => {
        return row.id === data.id.toString();
      },
    );
    return found ? toProject(found) : null;
  }) as never);
  getJestSpyOn(ProjectService, "findBy").mockImplementation((async (data: {
    query: Record<string, unknown>;
    skip: number;
    limit: number;
  }): Promise<Array<Project>> => {
    const asked: Array<string> | null = askedValues(
      data.query["requireSsoForLogin"],
    );
    const askedIds: Array<string> | null = askedValues(data.query["_id"]);

    return projects
      .filter((row: ProjectRow): boolean => {
        return (
          (asked === null || asked.includes(String(row.requireSsoForLogin))) &&
          (askedIds === null || askedIds.includes(row.id))
        );
      })
      .slice(data.skip, data.skip + data.limit)
      .map(toProject);
  }) as never);
  getJestSpyOn(ProjectSsoService, "findAllBy").mockImplementation(
    (async (): Promise<Array<unknown>> => {
      return ownSaml
        .filter((row: { isEnabled: boolean }): boolean => {
          return row.isEnabled;
        })
        .map(
          (row: { id: string; projectId: string }): Record<string, unknown> => {
            return {
              id: new ObjectID(row.id),
              projectId: new ObjectID(row.projectId),
            };
          },
        );
    }) as never,
  );
  getJestSpyOn(ProjectOidcService, "findAllBy").mockResolvedValue([] as never);

  // The lock on the server's sign-in rules, held in memory.
  getJestSpyOn(Semaphore, "lock").mockImplementation((async (data: {
    key: string;
  }): Promise<unknown> => {
    if (locksFail) {
      throw new Error("Redis client is not connected");
    }

    if (busyLock === data.key) {
      throw new SemaphoreLockTimeoutError(`Acquire mutex ${data.key} timeout`);
    }

    events.push(`lock:${data.key}`);
    const lock: { key: string } = { key: data.key };
    lockObjects.set(data.key, lock);
    return lock;
  }) as never);
  getJestSpyOn(Semaphore, "release").mockImplementation((async (mutex: {
    key: string;
  }): Promise<void> => {
    events.push(`release:${mutex.key}`);
  }) as never);
  getJestSpyOn(Semaphore, "keepLock").mockImplementation((async (mutex: {
    key: string;
  }): Promise<boolean> => {
    kept.push(mutex.key);
    return (
      !lostLocks.includes(mutex.key) &&
      !lostLockObjects.has(mutex as { key: string })
    );
  }) as never);

  getJestSpyOn(RealtimeAccessChanges, "announce").mockImplementation(((
    change: RealtimeAccessChange,
  ): void => {
    announced.push(change);
  }) as never);

  getJestSpyOn(AuditLogService, "recordUpdate").mockResolvedValue(
    undefined as never,
  );
  getJestSpyOn(AuditLogService, "recordDelete").mockResolvedValue(
    undefined as never,
  );
  getJestSpyOn(AuditLogService, "recordCreate").mockResolvedValue(
    undefined as never,
  );
});

afterEach(() => {
  clearGlobalSsoAuthorizationCaches();
  jest.restoreAllMocks();
});

const NO_PROVIDER_FOR_ACME: string =
  'This change would leave the project "Acme" with no SSO provider people can sign in with, and it requires SSO. Turn on another SSO provider for it first, or turn off Require SSO for Login there.';

describe.each([
  ["SAML", SAML],
  ["OIDC", OIDC],
])("a global %s provider", (_label: string, kind: ProviderKind) => {
  beforeEach(() => {
    kind.providerTable().rows = [
      {
        _id: PROVIDER,
        name: "Okta",
        isEnabled: true,
        restrictToAttachedProjects: false,
      },
    ];
  });

  describe("turning it off ends the sign-ins it gave", () => {
    test("the time is written in the same write that turns it off, under the lock on the server's sign-in rules", async () => {
      const before: number = Date.now();

      await expect(updateProvider(kind, { isEnabled: false })).resolves.toBe(
        "done",
      );

      expect(kind.providerTable().writes).toHaveLength(1);
      const written: Record<string, unknown> =
        kind.providerTable().writes[0]!.set;
      expect(written["isEnabled"]).toBe(false);
      expect(written["signInsEndedAt"]).toBeInstanceOf(Date);
      expect(
        (written["signInsEndedAt"] as Date).getTime(),
      ).toBeGreaterThanOrEqual(before);

      expect(events).toEqual([
        `lock:${SERVER_LOCK}`,
        `write:${PROVIDER}`,
        `release:${SERVER_LOCK}`,
      ]);
    });

    test("turned on again, it keeps that time: turning on writes none and takes no lock", async () => {
      await updateProvider(kind, { isEnabled: false });
      const endedAt: unknown = providerRow(kind)!["signInsEndedAt"];
      events = [];

      await expect(updateProvider(kind, { isEnabled: true })).resolves.toBe(
        "done",
      );

      expect(providerRow(kind)!["isEnabled"]).toBe(true);
      expect(providerRow(kind)!["signInsEndedAt"]).toEqual(endedAt);
      expect(kind.providerTable().writes[1]!.set).toEqual({ isEnabled: true });
      expect(events).toEqual([`write:${PROVIDER}`]);
    });

    test("saving one that is on as on again - an edit form sends every switch it shows - takes no lock and tells nobody: it changed nothing", async () => {
      await expect(
        updateProvider(kind, { isEnabled: true, name: "Okta (renamed)" }),
      ).resolves.toBe("done");

      expect(events).toEqual([`write:${PROVIDER}`]);
      expect(announced).toEqual([]);
    });

    test("saving one that is open to every project as open again tells nobody either", async () => {
      await expect(
        updateProvider(kind, { restrictToAttachedProjects: false }),
      ).resolves.toBe("done");

      expect(events).toEqual([`write:${PROVIDER}`]);
      expect(announced).toEqual([]);
    });

    test("saving one as it is reads none of its attachments: it signs the same people in; turning it on reads them", async () => {
      const attachmentReads: jest.SpyInstance = getJestSpyOn(
        GlobalProviderAttachmentRows,
        "read",
      );

      await expect(
        updateProvider(kind, {
          isEnabled: true,
          restrictToAttachedProjects: false,
          name: "Okta (renamed)",
        }),
      ).resolves.toBe("done");

      expect(attachmentReads).not.toHaveBeenCalled();

      providerRow(kind)!["isEnabled"] = false;

      await expect(updateProvider(kind, { isEnabled: true })).resolves.toBe(
        "done",
      );

      expect(attachmentReads).toHaveBeenCalledTimes(1);
    });

    test("turning it off is told to every server even when it was read as off: one turned on in between - turning on takes no lock - is turned off by this write", async () => {
      providerRow(kind)!["isEnabled"] = false;

      const findStrandedProjects: typeof SsoSignInWays.findStrandedProjects =
        SsoSignInWays.findStrandedProjects.bind(SsoSignInWays);
      jest
        .spyOn(SsoSignInWays, "findStrandedProjects")
        .mockImplementation(
          async (
            ...args: Parameters<typeof SsoSignInWays.findStrandedProjects>
          ): ReturnType<typeof SsoSignInWays.findStrandedProjects> => {
            // Turned on by a write that takes no lock, after this one read it.
            providerRow(kind)!["isEnabled"] = true;
            return await findStrandedProjects(...args);
          },
        );

      await expect(updateProvider(kind, { isEnabled: false })).resolves.toBe(
        "done",
      );

      expect(providerRow(kind)!["isEnabled"]).toBe(false);
      expect(announced).toEqual([
        { kind: RealtimeAccessChangeKind.SignInRulesChanged },
      ]);
    });

    test("restricting one read as restricted already is told to every server all the same", async () => {
      providerRow(kind)!["restrictToAttachedProjects"] = true;
      kind.attachmentTable().rows = [
        attachmentRow(kind, ATTACHED_TO_ACME, ACME),
      ];
      projects = [project(ACME, "Acme")];

      await expect(
        updateProvider(kind, { restrictToAttachedProjects: true }),
      ).resolves.toBe("done");

      expect(announced).toEqual([
        { kind: RealtimeAccessChangeKind.SignInRulesChanged },
      ]);
    });

    test("turning it on is told to every server once, so none keeps refusing the people it signs in", async () => {
      providerRow(kind)!["isEnabled"] = false;

      await expect(updateProvider(kind, { isEnabled: true })).resolves.toBe(
        "done",
      );

      expect(events).toEqual([`write:${PROVIDER}`]);
      expect(announced).toEqual([
        { kind: RealtimeAccessChangeKind.SignInRulesChanged },
      ]);
    });

    test("lifting its restriction to its attached projects is told to every server once, and takes no lock", async () => {
      providerRow(kind)!["restrictToAttachedProjects"] = true;
      kind.attachmentTable().rows = [
        attachmentRow(kind, ATTACHED_TO_ACME, ACME),
      ];

      await expect(
        updateProvider(kind, { restrictToAttachedProjects: false }),
      ).resolves.toBe("done");

      expect(events).toEqual([`write:${PROVIDER}`]);
      expect(announced).toEqual([
        { kind: RealtimeAccessChangeKind.SignInRulesChanged },
      ]);
    });

    test("lifting the restriction of one attached to no project tells nobody: it signed people in to every project already", async () => {
      providerRow(kind)!["restrictToAttachedProjects"] = true;

      await expect(
        updateProvider(kind, { restrictToAttachedProjects: false }),
      ).resolves.toBe("done");

      expect(announced).toEqual([]);
    });

    test("turning it on when what it changes cannot be read is still written, and told to every server all the same", async () => {
      providerRow(kind)!["isEnabled"] = false;
      jest.spyOn(logger, "warn").mockImplementation((): void => {
        return undefined;
      });

      const findAllBy: (args: unknown) => Promise<unknown> =
        kind.providerService.findAllBy.bind(kind.providerService) as never;
      jest
        .spyOn(kind.providerService, "findAllBy")
        .mockImplementation((async (args: {
          select?: Record<string, unknown>;
        }): Promise<unknown> => {
          // The read of where the provider signs people in, before the write.
          if (args.select?.["restrictToAttachedProjects"]) {
            throw new Error("The database is not answering");
          }

          return await findAllBy(args);
        }) as never);

      await expect(updateProvider(kind, { isEnabled: true })).resolves.toBe(
        "done",
      );

      expect(providerRow(kind)!["isEnabled"]).toBe(true);
      expect(announced).toEqual([
        { kind: RealtimeAccessChangeKind.SignInRulesChanged },
      ]);
    });

    test("a new name alone is told to nobody", async () => {
      await expect(
        updateProvider(kind, { name: "Okta (renamed)" }),
      ).resolves.toBe("done");

      expect(announced).toEqual([]);
    });

    test("turning it on is never refused, even for a project that requires SSO and has no provider yet", async () => {
      providerRow(kind)!["isEnabled"] = false;
      projects = [project(ACME, "Acme")];

      await expect(updateProvider(kind, { isEnabled: true })).resolves.toBe(
        "done",
      );

      expect(providerRow(kind)!["isEnabled"]).toBe(true);
    });

    test("turning off one that is off already writes the time too, whatever was read before: it gave no sign-ins while off, and one turned on a moment before is stamped", async () => {
      providerRow(kind)!["isEnabled"] = false;
      providerRow(kind)!["signInsEndedAt"] = new Date(
        "2026-01-01T00:00:00.000Z",
      );
      const before: number = Date.now();

      await expect(updateProvider(kind, { isEnabled: false })).resolves.toBe(
        "done",
      );

      const written: Record<string, unknown> =
        kind.providerTable().writes[0]!.set;
      expect(written["isEnabled"]).toBe(false);
      expect(
        (written["signInsEndedAt"] as Date).getTime(),
      ).toBeGreaterThanOrEqual(before);
    });

    test("a new name or new credentials write no time and take no lock", async () => {
      await expect(
        updateProvider(kind, { name: "Okta (rotated)" }),
      ).resolves.toBe("done");

      expect(kind.providerTable().writes[0]!.set).toEqual({
        name: "Okta (rotated)",
      });
      expect(events).toEqual([`write:${PROVIDER}`]);
    });
  });

  describe("a project that requires SSO keeps a way in", () => {
    beforeEach(() => {
      projects = [project(ACME, "Acme")];
    });

    test("its last provider cannot be turned off, and the refusal names it", async () => {
      await expect(updateProvider(kind, { isEnabled: false })).resolves.toBe(
        NO_PROVIDER_FOR_ACME,
      );

      expect(kind.providerTable().writes).toEqual([]);
      expect(providerRow(kind)!["isEnabled"]).toBe(true);
      // The lock is given back at once.
      expect(events).toEqual([`lock:${SERVER_LOCK}`, `release:${SERVER_LOCK}`]);
    });

    test("nor deleted", async () => {
      await expect(deleteProvider(kind)).resolves.toBe(NO_PROVIDER_FOR_ACME);

      expect(kind.providerTable().deleted).toEqual([]);
      expect(providerRow(kind)).toBeDefined();
    });

    test("one of the project's own providers that is on lets it go", async () => {
      ownSaml = [{ id: ACME_SAML, projectId: ACME, isEnabled: true }];

      await expect(updateProvider(kind, { isEnabled: false })).resolves.toBe(
        "done",
      );
      await expect(deleteProvider(kind)).resolves.toBe("done");
      expect(kind.providerTable().deleted).toEqual([PROVIDER]);
    });

    test("another global provider that signs people in to every project lets it go", async () => {
      kind.otherProviderTable().rows = [
        {
          _id: OTHER_PROVIDER,
          isEnabled: true,
          restrictToAttachedProjects: false,
        },
      ];

      await expect(updateProvider(kind, { isEnabled: false })).resolves.toBe(
        "done",
      );
    });

    test("a project that requires this provider by id refuses it going, even with other ways in", async () => {
      projects = [project(ACME, "Acme", { requiredProviderId: PROVIDER })];
      ownSaml = [{ id: ACME_SAML, projectId: ACME, isEnabled: true }];

      await expect(updateProvider(kind, { isEnabled: false })).resolves.toBe(
        'The project "Acme" requires sign-in with this SSO provider. Require another provider there, or turn off Require SSO for Login, first, so people can still sign in.',
      );
    });

    test("projects stranded for each reason are named apart, each with what to do", async () => {
      projects = [
        project(ACME, "Acme", { requiredProviderId: PROVIDER }),
        project(BETA, "Beta"),
      ];

      await expect(updateProvider(kind, { isEnabled: false })).resolves.toBe(
        'The project "Acme" requires sign-in with this SSO provider. Require another provider there, or turn off Require SSO for Login, first, so people can still sign in. This change would leave the project "Beta" with no SSO provider people can sign in with, and it requires SSO. Turn on another SSO provider for it first, or turn off Require SSO for Login there.',
      );
    });

    test("a project that does not require SSO does not hold it", async () => {
      projects = [project(ACME, "Acme", { requireSsoForLogin: false })];

      await expect(updateProvider(kind, { isEnabled: false })).resolves.toBe(
        "done",
      );
    });

    test("when the whole server requires SSO, every project counts, and the refusal says so", async () => {
      projects = [project(GAMMA, "Gamma", { requireSsoForLogin: false })];
      configTable.rows[0]!["requireSsoForLogin"] = true;

      await expect(updateProvider(kind, { isEnabled: false })).resolves.toBe(
        'This server requires SSO for everyone, and this change would leave the project "Gamma" with no SSO provider people can sign in with. Turn on another SSO provider for it first.',
      );
    });

    test("many projects are named by the first few and counted", async () => {
      projects = [];

      for (let n: number = 1; n <= 12; n++) {
        projects.push(project(id(100 + n), `Project ${n}`));
      }

      await expect(updateProvider(kind, { isEnabled: false })).resolves.toBe(
        'This change would leave 12 projects ("Project 1", "Project 2", "Project 3" and 9 more) with no SSO provider people can sign in with, and they require SSO. Turn on another SSO provider for them first, or turn off Require SSO for Login there.',
      );
    });

    test("restricting it to its attached projects is refused for a project it would stop reaching; an attached one keeps it", async () => {
      kind.attachmentTable().rows = [
        attachmentRow(kind, ATTACHED_TO_BETA, BETA),
      ];

      await expect(
        updateProvider(kind, { restrictToAttachedProjects: true }),
      ).resolves.toBe(NO_PROVIDER_FOR_ACME);

      kind
        .attachmentTable()
        .rows.push(attachmentRow(kind, ATTACHED_TO_ACME, ACME));

      await expect(
        updateProvider(kind, { restrictToAttachedProjects: true }),
      ).resolves.toBe("done");
    });

    test("restricting one with no attachment yet changes nothing: it still signs people in to every project", async () => {
      await expect(
        updateProvider(kind, { restrictToAttachedProjects: true }),
      ).resolves.toBe("done");
    });

    test("the lock is kept while the check reads, and once more before the write", async () => {
      ownSaml = [{ id: ACME_SAML, projectId: ACME, isEnabled: true }];

      await expect(updateProvider(kind, { isEnabled: false })).resolves.toBe(
        "done",
      );

      // Before the page of projects the check reads, and once it is done.
      expect(kept).toEqual([SERVER_LOCK, SERVER_LOCK]);
    });

    test("a lock found lost while the check runs refuses the write, and nothing is written", async () => {
      ownSaml = [{ id: ACME_SAML, projectId: ACME, isEnabled: true }];
      lostLocks = [SERVER_LOCK];

      await expect(updateProvider(kind, { isEnabled: false })).resolves.toBe(
        SIGN_IN_CHANGE_IN_PROGRESS_MESSAGE,
      );
      await expect(deleteProvider(kind)).resolves.toBe(
        SIGN_IN_CHANGE_IN_PROGRESS_MESSAGE,
      );

      expect(kind.providerTable().writes).toEqual([]);
      expect(kind.providerTable().deleted).toEqual([]);
      expect(events).toEqual([
        `lock:${SERVER_LOCK}`,
        `release:${SERVER_LOCK}`,
        `lock:${SERVER_LOCK}`,
        `release:${SERVER_LOCK}`,
      ]);
    });

    test("a write the database fails gives the lock back at once", async () => {
      ownSaml = [{ id: ACME_SAML, projectId: ACME, isEnabled: true }];

      failing = "update";
      await expect(updateProvider(kind, { isEnabled: false })).rejects.toThrow(
        "The database could not write the row",
      );

      failing = "delete";
      await expect(deleteProvider(kind)).rejects.toThrow(
        "The database could not delete the row",
      );

      expect(providerRow(kind)!["isEnabled"]).toBe(true);
      expect(announced).toEqual([]);
      expect(events).toEqual([
        `lock:${SERVER_LOCK}`,
        `release:${SERVER_LOCK}`,
        `lock:${SERVER_LOCK}`,
        `release:${SERVER_LOCK}`,
      ]);
    });

    test("while another change to who can sign in holds the lock too long, the write is refused and nothing is written", async () => {
      busyLock = SERVER_LOCK;
      projects = [];

      await expect(updateProvider(kind, { isEnabled: false })).resolves.toBe(
        SIGN_IN_CHANGE_IN_PROGRESS_MESSAGE,
      );
      expect(kind.providerTable().writes).toEqual([]);
    });

    test("without Valkey the check still runs, unlocked", async () => {
      locksFail = true;

      await expect(updateProvider(kind, { isEnabled: false })).resolves.toBe(
        NO_PROVIDER_FOR_ACME,
      );

      ownSaml = [{ id: ACME_SAML, projectId: ACME, isEnabled: true }];

      await expect(updateProvider(kind, { isEnabled: false })).resolves.toBe(
        "done",
      );
    });
  });

  describe("a write that names no provider, and a hard delete, which runs no success hook", () => {
    beforeEach(() => {
      projects = [project(ACME, "Acme")];
      ownSaml = [{ id: ACME_SAML, projectId: ACME, isEnabled: true }];
    });

    test("an update or delete that names no provider changes nothing, and gives back the lock its check took", async () => {
      await expect(
        kind.providerService.updateBy({
          query: { name: "No such provider" },
          data: { isEnabled: false } as never,
          limit: 10,
          skip: 0,
          props: { isRoot: true },
        }),
      ).resolves.toBe(0);
      await expect(
        kind.providerService.deleteBy({
          query: { name: "No such provider" },
          limit: 10,
          skip: 0,
          props: { isRoot: true },
        }),
      ).resolves.toBe(0);

      expect(events).toEqual([
        `lock:${SERVER_LOCK}`,
        `release:${SERVER_LOCK}`,
        `lock:${SERVER_LOCK}`,
        `release:${SERVER_LOCK}`,
      ]);
      expect(providerRow(kind)!["isEnabled"]).toBe(true);
    });

    test("the retention job's hard delete of rows deleted long ago gives back the lock its check took, and tells no server anything", async () => {
      await expect(
        kind.providerService.hardDeleteBy({
          query: {
            deletedAt: QueryHelper.lessThan(OneUptimeDate.getSomeDaysAgo(30)),
          },
          limit: LIMIT_MAX,
          skip: 0,
          props: { isRoot: true },
        }),
      ).resolves.toBe(0);

      expect(events).toEqual([`lock:${SERVER_LOCK}`, `release:${SERVER_LOCK}`]);
      expect(announced).toEqual([]);
      expect(providerRow(kind)).toBeDefined();
    });

    test("a hard delete of a provider gives the lock back once it is done, and every server is told", async () => {
      await expect(
        kind.providerService.hardDeleteBy({
          query: { _id: PROVIDER },
          limit: 1,
          skip: 0,
          props: { isRoot: true },
        }),
      ).resolves.toBe(1);

      expect(providerRow(kind)).toBeUndefined();
      expect(events).toEqual([
        `lock:${SERVER_LOCK}`,
        `delete:${PROVIDER}`,
        `release:${SERVER_LOCK}`,
      ]);
      expect(announced).toHaveLength(1);
    });

    test("a hard delete of a provider deleted long ago gives the lock back and tells no server anything", async () => {
      providerRow(kind)!["deletedAt"] = OneUptimeDate.getSomeDaysAgo(40);

      await expect(
        kind.providerService.hardDeleteBy({
          query: { _id: PROVIDER },
          limit: 1,
          skip: 0,
          props: { isRoot: true },
        }),
      ).resolves.toBe(1);

      expect(providerRow(kind)).toBeUndefined();
      expect(events).toEqual([
        `lock:${SERVER_LOCK}`,
        `delete:${PROVIDER}`,
        `release:${SERVER_LOCK}`,
      ]);
      expect(announced).toEqual([]);
    });

    test("a hard delete that would strand a project is refused, and one the database fails gives the lock back", async () => {
      ownSaml = [];

      await expect(
        kind.providerService.hardDeleteBy({
          query: { _id: PROVIDER },
          limit: 1,
          skip: 0,
          props: { isRoot: true },
        }),
      ).rejects.toThrow(NO_PROVIDER_FOR_ACME);

      ownSaml = [{ id: ACME_SAML, projectId: ACME, isEnabled: true }];
      failing = "delete";

      await expect(
        kind.providerService.hardDeleteBy({
          query: { _id: PROVIDER },
          limit: 1,
          skip: 0,
          props: { isRoot: true },
        }),
      ).rejects.toThrow("The database could not delete the row");

      expect(providerRow(kind)).toBeDefined();
      expect(announced).toEqual([]);
      expect(events).toEqual([
        `lock:${SERVER_LOCK}`,
        `release:${SERVER_LOCK}`,
        `lock:${SERVER_LOCK}`,
        `release:${SERVER_LOCK}`,
      ]);
    });
  });

  describe("its attachments, when it is restricted to its attached projects", () => {
    beforeEach(() => {
      providerRow(kind)!["restrictToAttachedProjects"] = true;
      projects = [project(ACME, "Acme"), project(BETA, "Beta")];
    });

    test("a hard delete of an attachment gives the lock back once it is done", async () => {
      kind.attachmentTable().rows = [
        attachmentRow(kind, ATTACHED_TO_ACME, ACME),
        attachmentRow(kind, ATTACHED_TO_BETA, BETA),
      ];
      ownSaml = [{ id: ACME_SAML, projectId: ACME, isEnabled: true }];

      await expect(
        kind.attachmentService.hardDeleteBy({
          query: { _id: ATTACHED_TO_ACME },
          limit: 1,
          skip: 0,
          props: { isRoot: true },
        }),
      ).resolves.toBe(1);

      expect(kind.attachmentTable().deleted).toEqual([ATTACHED_TO_ACME]);
      expect(events).toEqual([
        `lock:${SERVER_LOCK}`,
        `delete:${ATTACHED_TO_ACME}`,
        `release:${SERVER_LOCK}`,
      ]);
      expect(announced).toHaveLength(1);
    });

    test("an update or delete that names no attachment changes nothing, and gives back the lock its check took", async () => {
      kind.attachmentTable().rows = [
        attachmentRow(kind, ATTACHED_TO_BETA, BETA),
      ];

      await expect(
        kind.attachmentService.updateBy({
          query: { _id: ATTACHED_TO_ACME },
          data: { isEnabled: false } as never,
          limit: 1,
          skip: 0,
          props: { isRoot: true },
        }),
      ).resolves.toBe(0);
      await expect(
        kind.attachmentService.deleteBy({
          query: { projectId: GAMMA },
          limit: 10,
          skip: 0,
          props: { isRoot: true },
        }),
      ).resolves.toBe(0);

      expect(events).toEqual([
        `lock:${SERVER_LOCK}`,
        `release:${SERVER_LOCK}`,
        `lock:${SERVER_LOCK}`,
        `release:${SERVER_LOCK}`,
      ]);
      expect(kind.attachmentTable().rows).toHaveLength(1);
    });

    test("the first attachment narrows it from every project to one: refused when that strands another project", async () => {
      await expect(attach(kind, BETA)).resolves.toBe(NO_PROVIDER_FOR_ACME);

      expect(kind.attachmentTable().created).toEqual([]);
      expect(events).toEqual([`lock:${SERVER_LOCK}`, `release:${SERVER_LOCK}`]);
    });

    test("an attachment refused before it is checked - it names no project - never takes the lock", async () => {
      await expect(
        call(async () => {
          await kind.attachmentApi.createItem(
            request({ body: { data: { [kind.providerColumn]: PROVIDER } } }),
            response(),
          );
        }),
      ).resolves.not.toBe("done");

      expect(kind.attachmentTable().created).toEqual([]);
      expect(events).toEqual([]);
    });

    test("an attachment the database fails to write gives the lock back", async () => {
      projects = [project(BETA, "Beta")];
      failing = "save";

      await expect(attach(kind, BETA)).rejects.toThrow(
        "The database could not insert the row",
      );

      expect(kind.attachmentTable().created).toEqual([]);
      expect(events).toEqual([`lock:${SERVER_LOCK}`, `release:${SERVER_LOCK}`]);
    });

    test("an attachment whose INSERT the client stopped waiting for is rolled back with its own transaction: the lock is given back at once", async () => {
      projects = [project(BETA, "Beta")];
      saveFailsWith = clientTimeout(INSERT_STATEMENT);

      await expect(attach(kind, BETA)).rejects.toThrow("Query read timeout");

      expect(events).toEqual([`lock:${SERVER_LOCK}`, `release:${SERVER_LOCK}`]);
    });

    test("an attachment whose COMMIT went unanswered may have landed: the lock is kept until the database would have cancelled it", async () => {
      projects = [project(BETA, "Beta")];
      saveFailsWith = clientTimeout(COMMIT_STATEMENT);

      await expect(attach(kind, BETA)).rejects.toThrow("Query read timeout");

      expect(events).toEqual([`lock:${SERVER_LOCK}`]);

      const serverLock: { key: string } = lockObjects.get(SERVER_LOCK)!;

      expect(
        ProjectSsoProviderChanges.isKeptForWrite(serverLock as never),
      ).toBe(true);

      // Stops keeping it, so nothing outlives the test.
      await ProjectSsoProviderChanges.releaseSignInChange([
        serverLock,
      ] as never);
    });

    test("turning an attachment off that the database fails to write gives the lock back", async () => {
      projects = [project(BETA, "Beta")];
      kind.attachmentTable().rows = [
        attachmentRow(kind, ATTACHED_TO_ACME, ACME),
        attachmentRow(kind, ATTACHED_TO_BETA, BETA),
      ];

      failing = "update";
      await expect(
        call(async () => {
          await kind.attachmentApi.updateItem(
            request({
              id: ATTACHED_TO_ACME,
              body: { data: { isEnabled: false } },
            }),
            response(),
          );
        }),
      ).rejects.toThrow("The database could not write the row");

      failing = "delete";
      await expect(detach(kind, ATTACHED_TO_ACME)).rejects.toThrow(
        "The database could not delete the row",
      );

      expect(events).toEqual([
        `lock:${SERVER_LOCK}`,
        `release:${SERVER_LOCK}`,
        `lock:${SERVER_LOCK}`,
        `release:${SERVER_LOCK}`,
      ]);
    });

    test("the lock is given back before the written attachment is announced, and what is announced was read under it", async () => {
      projects = [project(BETA, "Beta")];
      getJestSpyOn(RealtimeAccessChanges, "announce").mockImplementation(((
        change: RealtimeAccessChange,
      ): void => {
        events.push("announce");
        announced.push(change);
      }) as never);

      await expect(attach(kind, BETA)).resolves.toBe("done");

      expect(kind.attachmentTable().created).toHaveLength(1);
      expect(events).toEqual([
        `lock:${SERVER_LOCK}`,
        `create:${kind.attachmentTable().created[0]!._id}`,
        `release:${SERVER_LOCK}`,
        "announce",
      ]);
    });

    test("it goes through when no project needs it, and the lock is given back once it is written", async () => {
      projects = [project(BETA, "Beta")];

      await expect(attach(kind, BETA)).resolves.toBe("done");

      expect(kind.attachmentTable().created).toHaveLength(1);
      expect(events[0]).toBe(`lock:${SERVER_LOCK}`);
      expect(events[events.length - 1]).toBe(`release:${SERVER_LOCK}`);
      expect(
        events.filter((event: string): boolean => {
          return event.startsWith("lock:");
        }),
      ).toHaveLength(1);
    });

    test("a further attachment only widens it and is never refused", async () => {
      kind.attachmentTable().rows = [
        attachmentRow(kind, ATTACHED_TO_ACME, ACME),
      ];
      projects = [project(ACME, "Acme")];

      await expect(attach(kind, BETA)).resolves.toBe("done");
    });

    test("turning an attachment off strands the project it attached", async () => {
      kind.attachmentTable().rows = [
        attachmentRow(kind, ATTACHED_TO_ACME, ACME),
        attachmentRow(kind, ATTACHED_TO_BETA, BETA),
      ];

      await expect(
        updateAttachment(kind, ATTACHED_TO_ACME, { isEnabled: false }),
      ).resolves.toBe(NO_PROVIDER_FOR_ACME);
      expect(kind.attachmentTable().writes).toEqual([]);
    });

    test("moving an attachment to another project, where no project needs it, tells every server", async () => {
      kind.attachmentTable().rows = [
        attachmentRow(kind, ATTACHED_TO_ACME, ACME),
        attachmentRow(kind, ATTACHED_TO_BETA, BETA),
      ];
      projects = [project(ACME, "Acme")];

      await expect(
        updateAttachment(kind, ATTACHED_TO_BETA, { projectId: GAMMA }),
      ).resolves.toBe("done");

      expect(kind.attachmentTable().writes).toHaveLength(1);
      expect(announced).not.toEqual([]);
    });

    test("moving an attachment to another project strands the project it leaves", async () => {
      kind.attachmentTable().rows = [
        attachmentRow(kind, ATTACHED_TO_ACME, ACME),
        attachmentRow(kind, ATTACHED_TO_BETA, BETA),
      ];

      await expect(
        updateAttachment(kind, ATTACHED_TO_ACME, { projectId: GAMMA }),
      ).resolves.toBe(NO_PROVIDER_FOR_ACME);
    });

    test("removing an attachment strands the project it attached", async () => {
      kind.attachmentTable().rows = [
        attachmentRow(kind, ATTACHED_TO_ACME, ACME),
        attachmentRow(kind, ATTACHED_TO_BETA, BETA),
      ];

      await expect(detach(kind, ATTACHED_TO_ACME)).resolves.toBe(
        NO_PROVIDER_FOR_ACME,
      );
      expect(kind.attachmentTable().deleted).toEqual([]);
    });

    test("removing its last attachment widens it to every project again, and goes through", async () => {
      kind.attachmentTable().rows = [
        attachmentRow(kind, ATTACHED_TO_ACME, ACME),
      ];

      await expect(detach(kind, ATTACHED_TO_ACME)).resolves.toBe("done");
      expect(kind.attachmentTable().deleted).toEqual([ATTACHED_TO_ACME]);
    });

    test("turning an attachment on takes no lock, is never refused, and is told to every server once", async () => {
      kind.attachmentTable().rows = [
        attachmentRow(kind, ATTACHED_TO_ACME, ACME, false),
      ];

      await expect(
        updateAttachment(kind, ATTACHED_TO_ACME, { isEnabled: true }),
      ).resolves.toBe("done");
      expect(
        events.filter((event: string): boolean => {
          return event.startsWith("lock:");
        }),
      ).toEqual([]);
      expect(announced).toEqual([
        { kind: RealtimeAccessChangeKind.SignInRulesChanged },
      ]);
    });

    test("saving an attachment that is on as on again tells nobody, and reads nothing more for it", async () => {
      kind.attachmentTable().rows = [
        attachmentRow(kind, ATTACHED_TO_ACME, ACME),
      ];
      const attachmentReads: jest.SpyInstance = getJestSpyOn(
        GlobalProviderAttachmentRows,
        "read",
      );

      await expect(
        updateAttachment(kind, ATTACHED_TO_ACME, { isEnabled: true }),
      ).resolves.toBe("done");
      expect(announced).toEqual([]);
      expect(attachmentReads).not.toHaveBeenCalled();
    });

    test("turning an attachment off that was read as off already is told to every server all the same: one turned on in between takes no lock", async () => {
      kind.attachmentTable().rows = [
        attachmentRow(kind, ATTACHED_TO_ACME, ACME, false),
      ];

      await expect(
        updateAttachment(kind, ATTACHED_TO_ACME, { isEnabled: false }),
      ).resolves.toBe("done");
      expect(announced).toEqual([
        { kind: RealtimeAccessChangeKind.SignInRulesChanged },
      ]);
    });

    test("moving an attachment that was read as off is told to every server all the same: one turned on in between takes no lock", async () => {
      kind.attachmentTable().rows = [
        attachmentRow(kind, ATTACHED_TO_ACME, ACME, false),
        attachmentRow(kind, ATTACHED_TO_BETA, BETA),
      ];

      await expect(
        updateAttachment(kind, ATTACHED_TO_ACME, { projectId: GAMMA }),
      ).resolves.toBe("done");
      expect(kind.attachmentTable().rows[0]!["projectId"]).toBe(GAMMA);
      expect(announced).toEqual([
        { kind: RealtimeAccessChangeKind.SignInRulesChanged },
      ]);
    });

    test("moving an attachment that was read as off to a provider that signs people in to every project is told all the same: the provider it leaves is restricted", async () => {
      kind.providerTable().rows.push({
        _id: OTHER_PROVIDER,
        isEnabled: true,
        restrictToAttachedProjects: false,
      });
      kind.attachmentTable().rows = [
        attachmentRow(kind, ATTACHED_TO_ACME, ACME, false),
        attachmentRow(kind, ATTACHED_TO_BETA, BETA),
      ];

      await expect(
        kind.attachmentService.updateBy({
          query: { _id: ATTACHED_TO_ACME },
          data: { [kind.providerColumn]: OTHER_PROVIDER } as never,
          limit: 1,
          skip: 0,
          props: { isRoot: true },
        }),
      ).resolves.toBe(1);
      expect(kind.attachmentTable().rows[0]![kind.providerColumn]).toBe(
        OTHER_PROVIDER,
      );
      expect(announced).toEqual([
        { kind: RealtimeAccessChangeKind.SignInRulesChanged },
      ]);
    });
  });

  test("a hard delete of an attachment of a provider that signs people in to every project gives the lock back, and tells no server anything", async () => {
    projects = [project(ACME, "Acme")];
    kind.attachmentTable().rows = [attachmentRow(kind, ATTACHED_TO_ACME, ACME)];

    await expect(
      kind.attachmentService.hardDeleteBy({
        query: { _id: ATTACHED_TO_ACME },
        limit: 1,
        skip: 0,
        props: { isRoot: true },
      }),
    ).resolves.toBe(1);

    expect(kind.attachmentTable().deleted).toEqual([ATTACHED_TO_ACME]);
    expect(events).toEqual([
      `lock:${SERVER_LOCK}`,
      `delete:${ATTACHED_TO_ACME}`,
      `release:${SERVER_LOCK}`,
    ]);
    expect(announced).toEqual([]);
  });

  test("an attachment of a provider that signs people in to every project, turned off or moved while it was off, tells nobody", async () => {
    projects = [project(ACME, "Acme"), project(BETA, "Beta")];
    kind.attachmentTable().rows = [
      attachmentRow(kind, ATTACHED_TO_ACME, ACME, false),
    ];

    await expect(
      updateAttachment(kind, ATTACHED_TO_ACME, { isEnabled: false }),
    ).resolves.toBe("done");
    await expect(
      updateAttachment(kind, ATTACHED_TO_ACME, { projectId: BETA }),
    ).resolves.toBe("done");

    expect(announced).toEqual([]);
  });

  test("the attachments of a provider that signs people in to every project decide nothing", async () => {
    projects = [project(ACME, "Acme"), project(BETA, "Beta")];
    kind.attachmentTable().rows = [attachmentRow(kind, ATTACHED_TO_ACME, ACME)];

    await expect(
      updateAttachment(kind, ATTACHED_TO_ACME, { isEnabled: false }),
    ).resolves.toBe("done");
    await expect(detach(kind, ATTACHED_TO_ACME)).resolves.toBe("done");
    await expect(attach(kind, BETA)).resolves.toBe("done");
  });

  /*
   * A write that names its providers or attachments by a filter - no API
   * route does, but OneUptime's own code may - writes exactly the rows its
   * hooks read, under the lock or, for a write that only lets people in,
   * without it: a row that comes to match the filter a moment later was
   * never checked, nor worked out.
   */
  /*
   * The row that lands is put first in the table: a write held only to as
   * many rows as were read, rather than to the rows read, would reach it.
   */
  describe("a write that names its rows by a filter writes exactly the rows it read", () => {
    beforeEach(() => {
      projects = [project(ACME, "Acme")];
      // Acme keeps a way in of its own: no change here strands it.
      ownSaml = [{ id: ACME_SAML, projectId: ACME, isEnabled: true }];
    });

    const providerNamed: (
      providerId: string,
      name: string,
      isEnabled: boolean,
    ) => Row = (providerId: string, name: string, isEnabled: boolean): Row => {
      return {
        _id: providerId,
        name: name,
        isEnabled: isEnabled,
        restrictToAttachedProjects: false,
      };
    };

    test("turning providers off by a filter turns off the ones read under the lock: one that comes to match afterwards stays on", async () => {
      afterRead(kind.providerService, "restrictToAttachedProjects", () => {
        kind
          .providerTable()
          .rows.unshift(providerNamed(OTHER_PROVIDER, "Okta", true));
      });

      await expect(
        kind.providerService.updateBy({
          query: { name: "Okta" },
          data: { isEnabled: false } as never,
          limit: LIMIT_MAX,
          skip: 0,
          props: { isRoot: true },
        }),
      ).resolves.toBe(1);

      expect(providerRow(kind)!["isEnabled"]).toBe(false);
      expect(providerRow(kind, OTHER_PROVIDER)!["isEnabled"]).toBe(true);
      expect(providerRow(kind, OTHER_PROVIDER)!["signInsEndedAt"]).toBe(
        undefined,
      );
      expect(
        kind.providerTable().writes.map((write: { id: string }): string => {
          return write.id;
        }),
      ).toEqual([PROVIDER]);
    });

    test("turning providers on by a filter - which takes no lock - turns on only the ones it read", async () => {
      providerRow(kind)!["isEnabled"] = false;

      afterRead(kind.providerService, "restrictToAttachedProjects", () => {
        kind
          .providerTable()
          .rows.unshift(providerNamed(OTHER_PROVIDER, "Okta", false));
      });

      await expect(
        kind.providerService.updateBy({
          query: { name: "Okta" },
          data: { isEnabled: true } as never,
          limit: LIMIT_MAX,
          skip: 0,
          props: { isRoot: true },
        }),
      ).resolves.toBe(1);

      expect(providerRow(kind)!["isEnabled"]).toBe(true);
      expect(providerRow(kind, OTHER_PROVIDER)!["isEnabled"]).toBe(false);
      expect(lockObjects.size).toBe(0);
    });

    test("turning providers on by a filter whose providers cannot be read goes on with its own filter - nothing about it is checked - and every server is told", async () => {
      providerRow(kind)!["isEnabled"] = false;

      failHoldReads(
        kind.providerService,
        "restrictToAttachedProjects",
        new Error("The database could not read the providers"),
      );

      await expect(
        kind.providerService.updateBy({
          query: { name: "Okta" },
          data: { isEnabled: true } as never,
          limit: LIMIT_MAX,
          skip: 0,
          props: { isRoot: true },
        }),
      ).resolves.toBe(1);

      expect(providerRow(kind)!["isEnabled"]).toBe(true);
      expect(lockObjects.size).toBe(0);
      expect(announced).toEqual([
        { kind: RealtimeAccessChangeKind.SignInRulesChanged },
      ]);
    });

    test("turning attachments on by a filter whose attachments cannot be read goes on the same way, and every server is told", async () => {
      kind.attachmentTable().rows = [
        attachmentRow(kind, ATTACHED_TO_ACME, ACME, false),
      ];

      failHoldReads(
        kind.attachmentService,
        "projectId",
        new Error("The database could not read the attachments"),
      );

      await expect(
        kind.attachmentService.updateBy({
          query: { [kind.providerColumn]: PROVIDER },
          data: { isEnabled: true } as never,
          limit: LIMIT_MAX,
          skip: 0,
          props: { isRoot: true },
        }),
      ).resolves.toBe(1);

      expect(kind.attachmentTable().rows[0]!["isEnabled"]).toBe(true);
      expect(lockObjects.size).toBe(0);
      expect(announced).toEqual([
        { kind: RealtimeAccessChangeKind.SignInRulesChanged },
      ]);
    });

    test("a provider turned on whose attachments cannot be read once it is held to the providers read is written all the same - those only - and every server is told", async () => {
      providerRow(kind)!["isEnabled"] = false;

      afterRead(kind.providerService, "restrictToAttachedProjects", () => {
        kind
          .providerTable()
          .rows.unshift(providerNamed(OTHER_PROVIDER, "Okta", false));
      });
      getJestSpyOn(GlobalProviderAttachmentRows, "read").mockRejectedValue(
        new Error("The database could not read the attachments") as never,
      );

      await expect(
        kind.providerService.updateBy({
          query: { name: "Okta" },
          data: { isEnabled: true } as never,
          limit: LIMIT_MAX,
          skip: 0,
          props: { isRoot: true },
        }),
      ).resolves.toBe(1);

      expect(providerRow(kind)!["isEnabled"]).toBe(true);
      expect(providerRow(kind, OTHER_PROVIDER)!["isEnabled"]).toBe(false);
      expect(announced).toEqual([
        { kind: RealtimeAccessChangeKind.SignInRulesChanged },
      ]);
    });

    test("deleting providers by a filter deletes the ones read under the lock, and leaves one that comes to match afterwards", async () => {
      afterRead(kind.providerService, "restrictToAttachedProjects", () => {
        kind
          .providerTable()
          .rows.unshift(providerNamed(OTHER_PROVIDER, "Okta", true));
      });

      await expect(
        kind.providerService.deleteBy({
          query: { name: "Okta" },
          limit: LIMIT_MAX,
          skip: 0,
          props: { isRoot: true },
        }),
      ).resolves.toBe(1);

      expect(kind.providerTable().deleted).toEqual([PROVIDER]);
      expect(providerRow(kind, OTHER_PROVIDER)).toBeDefined();
    });

    test("a delete by a filter that read no provider deletes none that come to match it afterwards", async () => {
      afterRead(kind.providerService, "restrictToAttachedProjects", () => {
        kind
          .providerTable()
          .rows.unshift(
            providerNamed(OTHER_PROVIDER, "Created a moment later", true),
          );
      });

      await expect(
        kind.providerService.deleteBy({
          query: { name: "Created a moment later" },
          limit: LIMIT_MAX,
          skip: 0,
          props: { isRoot: true },
        }),
      ).resolves.toBe(0);

      expect(kind.providerTable().deleted).toEqual([]);
      expect(providerRow(kind, OTHER_PROVIDER)).toBeDefined();
    });

    test("a hard delete by a filter that read no provider that is there purges only the rows deleted before that it read, never one created a moment later", async () => {
      kind.providerTable().rows.push({
        ...providerNamed(DELETED_BEFORE, "Retired", true),
        deletedAt: OneUptimeDate.getSomeDaysAgo(40),
      });

      afterRead(kind.providerService, "restrictToAttachedProjects", () => {
        kind
          .providerTable()
          .rows.unshift(providerNamed(CREATED_LATER, "Retired", true));
      });

      await expect(
        kind.providerService.hardDeleteBy({
          query: { name: "Retired" },
          limit: LIMIT_MAX,
          skip: 0,
          props: { isRoot: true },
        }),
      ).resolves.toBe(1);

      expect(kind.providerTable().deleted).toEqual([DELETED_BEFORE]);
      expect(providerRow(kind, CREATED_LATER)).toBeDefined();
      expect(announced).toEqual([]);
    });

    test("the retention job's purge removes providers deleted more than a month ago, and never one that is there", async () => {
      kind.providerTable().rows.push(
        {
          ...providerNamed(DELETED_BEFORE, "Deleted long ago", true),
          deletedAt: OneUptimeDate.getSomeDaysAgo(40),
        },
        {
          ...providerNamed(CREATED_LATER, "Deleted last week", true),
          deletedAt: OneUptimeDate.getSomeDaysAgo(7),
        },
      );

      await expect(
        kind.providerService.hardDeleteBy({
          query: {
            deletedAt: QueryHelper.lessThan(OneUptimeDate.getSomeDaysAgo(30)),
          },
          limit: LIMIT_MAX,
          skip: 0,
          props: { isRoot: true },
        }),
      ).resolves.toBe(1);

      expect(kind.providerTable().deleted).toEqual([DELETED_BEFORE]);
      expect(providerRow(kind)).toBeDefined();
      expect(providerRow(kind, CREATED_LATER)).toBeDefined();
    });

    test("turning attachments off by a filter turns off the ones read under the lock: one attached afterwards stays on", async () => {
      kind.attachmentTable().rows = [
        attachmentRow(kind, ATTACHED_TO_ACME, ACME),
      ];

      afterRead(kind.attachmentService, "projectId", () => {
        kind
          .attachmentTable()
          .rows.unshift(attachmentRow(kind, ATTACHED_LATER, BETA));
      });

      await expect(
        kind.attachmentService.updateBy({
          query: { [kind.providerColumn]: PROVIDER },
          data: { isEnabled: false } as never,
          limit: LIMIT_MAX,
          skip: 0,
          props: { isRoot: true },
        }),
      ).resolves.toBe(1);

      const attachments: Array<Row> = kind.attachmentTable().rows;

      expect(
        attachments.find((row: Row): boolean => {
          return row._id === ATTACHED_TO_ACME;
        })!["isEnabled"],
      ).toBe(false);
      expect(
        attachments.find((row: Row): boolean => {
          return row._id === ATTACHED_LATER;
        })!["isEnabled"],
      ).toBe(true);
    });

    test("removing attachments by a filter removes the ones read under the lock, and none attached afterwards", async () => {
      kind.attachmentTable().rows = [
        attachmentRow(kind, ATTACHED_TO_ACME, ACME),
      ];

      afterRead(kind.attachmentService, "projectId", () => {
        kind
          .attachmentTable()
          .rows.unshift(attachmentRow(kind, ATTACHED_LATER, BETA));
      });

      await expect(
        kind.attachmentService.deleteBy({
          query: { [kind.providerColumn]: PROVIDER },
          limit: LIMIT_MAX,
          skip: 0,
          props: { isRoot: true },
        }),
      ).resolves.toBe(1);

      expect(kind.attachmentTable().deleted).toEqual([ATTACHED_TO_ACME]);
    });

    test("a hard delete of attachments by a filter that read none that is there purges only the rows deleted before that it read", async () => {
      kind.attachmentTable().rows = [
        {
          ...attachmentRow(kind, DELETED_BEFORE, ACME),
          deletedAt: OneUptimeDate.getSomeDaysAgo(40),
        },
      ];

      afterRead(kind.attachmentService, "projectId", () => {
        kind
          .attachmentTable()
          .rows.unshift(attachmentRow(kind, ATTACHED_LATER, BETA));
      });

      await expect(
        kind.attachmentService.hardDeleteBy({
          query: { [kind.providerColumn]: PROVIDER },
          limit: LIMIT_MAX,
          skip: 0,
          props: { isRoot: true },
        }),
      ).resolves.toBe(1);

      expect(kind.attachmentTable().deleted).toEqual([DELETED_BEFORE]);
    });
  });

  describe("the lock of a change is kept for its write, until it is done", () => {
    beforeEach(() => {
      projects = [project(ACME, "Acme")];
      ownSaml = [{ id: ACME_SAML, projectId: ACME, isEnabled: true }];
    });

    test("a provider turned off: its lock is kept alive while it is written, and no more once it is", async () => {
      let keptWhileWritten: Array<boolean> = [];
      whileWriting = (): void => {
        keptWhileWritten = keptForWrite();
      };

      await expect(updateProvider(kind, { isEnabled: false })).resolves.toBe(
        "done",
      );

      expect(keptWhileWritten).toEqual([true]);
      expect(keptForWrite()).toEqual([false]);
    });

    test("a provider deleted: kept alive while it is deleted, and no more once it is", async () => {
      let keptWhileDeleted: Array<boolean> = [];
      whileWriting = (): void => {
        keptWhileDeleted = keptForWrite();
      };

      await expect(deleteProvider(kind)).resolves.toBe("done");

      expect(keptWhileDeleted).toEqual([true]);
      expect(keptForWrite()).toEqual([false]);
    });

    test("an attachment added: kept alive while it is inserted, and no more once it is - or once the database fails it", async () => {
      providerRow(kind)!["restrictToAttachedProjects"] = true;
      kind.attachmentTable().rows = [
        attachmentRow(kind, ATTACHED_TO_ACME, ACME),
      ];
      projects = [project(ACME, "Acme"), project(BETA, "Beta")];

      let keptWhileInserted: Array<boolean> = [];
      whileWriting = (): void => {
        keptWhileInserted = keptForWrite();
      };

      await expect(attach(kind, BETA)).resolves.toBe("done");

      expect(keptWhileInserted).toEqual([true]);
      expect(keptForWrite()).toEqual([false]);

      failing = "save";

      await expect(attach(kind, GAMMA)).rejects.toThrow(
        "The database could not insert the row",
      );

      expect(keptForWrite()).toEqual([false]);
      expect(events.slice(-2)).toEqual([
        `lock:${SERVER_LOCK}`,
        `release:${SERVER_LOCK}`,
      ]);
    });

    // The providers an attachment's delete detaches are read under the lock: then the lock is lost.
    const loseLockAfterReadingProviders: (lose: () => void) => void = (
      lose: () => void,
    ): void => {
      const readProviderIds: (...args: Array<unknown>) => Promise<unknown> = (
        kind.attachmentService as unknown as {
          readProviderIds: (...args: Array<unknown>) => Promise<unknown>;
        }
      ).readProviderIds.bind(kind.attachmentService);

      getJestSpyOn(
        kind.attachmentService,
        "readProviderIds",
      ).mockImplementation((async (
        ...args: Array<unknown>
      ): Promise<unknown> => {
        const providerIds: unknown = await readProviderIds(...args);
        lose();
        return providerIds;
      }) as never);
    };

    test("an attachment removed keeps the lock once more after reading the providers it detaches, right before the delete; lost by then, it is taken again, the attachment read and checked again, and removed", async () => {
      kind.attachmentTable().rows = [
        attachmentRow(kind, ATTACHED_TO_ACME, ACME),
      ];

      loseLockAfterReadingProviders((): void => {
        lostLockObjects.add(lockObjects.get(SERVER_LOCK)!);
      });

      await expect(detach(kind, ATTACHED_TO_ACME)).resolves.toBe("done");

      expect(kind.attachmentTable().deleted).toEqual([ATTACHED_TO_ACME]);
      expect(events).toEqual([
        `lock:${SERVER_LOCK}`,
        // Gone right before the delete: given back, taken again, checked again.
        `release:${SERVER_LOCK}`,
        `lock:${SERVER_LOCK}`,
        `delete:${ATTACHED_TO_ACME}`,
        `release:${SERVER_LOCK}`,
      ]);
      expect(keptForWrite()).toEqual([false]);
    });

    test("an attachment removed whose lock is lost right before the delete, and lost again once taken again, is refused: nothing is removed, and nothing is held", async () => {
      kind.attachmentTable().rows = [
        attachmentRow(kind, ATTACHED_TO_ACME, ACME),
      ];

      loseLockAfterReadingProviders((): void => {
        lostLocks = [SERVER_LOCK];
      });

      await expect(detach(kind, ATTACHED_TO_ACME)).resolves.toBe(
        SIGN_IN_CHANGE_IN_PROGRESS_MESSAGE,
      );

      expect(kind.attachmentTable().deleted).toEqual([]);
      expect(events).toEqual([
        `lock:${SERVER_LOCK}`,
        `release:${SERVER_LOCK}`,
        `lock:${SERVER_LOCK}`,
        `release:${SERVER_LOCK}`,
      ]);
      expect(keptForWrite()).toEqual([false]);
      expect(announced).toEqual([]);
    });

    test("a lock lost once the check is done is taken again, the provider read and checked again under it, and the write goes through", async () => {
      // Kept before the page of projects the check reads; gone once it is done, once.
      getJestSpyOn(Semaphore, "keepLock").mockImplementation((async (mutex: {
        key: string;
      }): Promise<boolean> => {
        kept.push(mutex.key);
        return kept.length !== 2;
      }) as never);

      await expect(updateProvider(kind, { isEnabled: false })).resolves.toBe(
        "done",
      );

      expect(providerRow(kind)!["isEnabled"]).toBe(false);
      expect(events).toEqual([
        `lock:${SERVER_LOCK}`,
        `release:${SERVER_LOCK}`,
        `lock:${SERVER_LOCK}`,
        `write:${PROVIDER}`,
        `release:${SERVER_LOCK}`,
      ]);
      expect(keptForWrite()).toEqual([false]);
    });

    test("a lock lost once the check is done, and lost again once taken again, refuses the write: nothing is written, and nothing is held", async () => {
      // Kept before the page of projects the check reads; gone once it is done, and every time after.
      getJestSpyOn(Semaphore, "keepLock").mockImplementation((async (mutex: {
        key: string;
      }): Promise<boolean> => {
        kept.push(mutex.key);
        return kept.length < 2;
      }) as never);

      await expect(updateProvider(kind, { isEnabled: false })).resolves.toBe(
        SIGN_IN_CHANGE_IN_PROGRESS_MESSAGE,
      );

      expect(kind.providerTable().writes).toEqual([]);
      expect(providerRow(kind)!["isEnabled"]).toBe(true);
      expect(events).toEqual([
        `lock:${SERVER_LOCK}`,
        `release:${SERVER_LOCK}`,
        `lock:${SERVER_LOCK}`,
        `release:${SERVER_LOCK}`,
      ]);
      expect(keptForWrite()).toEqual([false]);
    });
  });
});

describe("the server's Require SSO for Login", () => {
  beforeEach(() => {
    projects = [
      project(ACME, "Acme", { requireSsoForLogin: false }),
      project(BETA, "Beta", { requireSsoForLogin: false }),
    ];
    ownSaml = [{ id: ACME_SAML, projectId: ACME, isEnabled: true }];
  });

  test("turning it on is refused while a project has no provider, naming it", async () => {
    await expect(updateServerRule(true)).resolves.toBe(
      'The project "Beta" has no SSO provider people can sign in with, so requiring SSO for everyone would lock its members out. Turn on a global SSO provider, or an SSO provider in that project, first.',
    );

    expect(configTable.writes).toEqual([]);
    expect(events).toEqual([`lock:${SERVER_LOCK}`, `release:${SERVER_LOCK}`]);
  });

  test("a global provider that signs people in to every project lets it on", async () => {
    globalSamlTable.rows = [
      { _id: PROVIDER, isEnabled: true, restrictToAttachedProjects: false },
    ];

    await expect(updateServerRule(true)).resolves.toBe("done");
    expect(configTable.writes[0]!.set).toEqual({ requireSsoForLogin: true });
    expect(events[events.length - 1]).toBe(`release:${SERVER_LOCK}`);
  });

  test("a project that requires SSO itself is not asked again", async () => {
    projects[1] = project(BETA, "Beta", { requireSsoForLogin: true });

    await expect(updateServerRule(true)).resolves.toBe("done");
  });

  test("a project that requires a provider that cannot sign anyone in to it is named apart, with what to do", async () => {
    projects[0] = project(ACME, "Acme", {
      requireSsoForLogin: false,
      requiredProviderId: OTHER_PROVIDER,
    });

    await expect(updateServerRule(true)).resolves.toBe(
      'The project "Beta" has no SSO provider people can sign in with, so requiring SSO for everyone would lock its members out. Turn on a global SSO provider, or an SSO provider in that project, first. The project "Acme" requires sign-in with an SSO provider that cannot sign people in to it - it is off, it was deleted, or it does not sign people in there - so requiring SSO for everyone would lock its members out. Turn that provider on, or require another provider there, first.',
    );
    expect(configTable.writes).toEqual([]);
  });

  test("the lock is kept before each page of projects the check reads, once it is done, and once more right before the write", async () => {
    globalSamlTable.rows = [
      { _id: PROVIDER, isEnabled: true, restrictToAttachedProjects: false },
    ];

    await expect(updateServerRule(true)).resolves.toBe("done");

    expect(kept).toEqual([SERVER_LOCK, SERVER_LOCK, SERVER_LOCK]);
  });

  test.each([
    ["once its check is done", 2],
    ["right before the write", 3],
  ])(
    "a lock lost %s is taken again, every project read and checked again under it, and the rule turned on",
    async (_when: string, lostAtKeep: number) => {
      globalSamlTable.rows = [
        { _id: PROVIDER, isEnabled: true, restrictToAttachedProjects: false },
      ];

      getJestSpyOn(Semaphore, "keepLock").mockImplementation((async (mutex: {
        key: string;
      }): Promise<boolean> => {
        kept.push(mutex.key);
        return kept.length !== lostAtKeep;
      }) as never);

      await expect(updateServerRule(true)).resolves.toBe("done");

      expect(configTable.writes[0]!.set).toEqual({ requireSsoForLogin: true });
      expect(events).toEqual([
        `lock:${SERVER_LOCK}`,
        // Gone: given back, taken again, checked again, and kept for the write.
        `release:${SERVER_LOCK}`,
        `lock:${SERVER_LOCK}`,
        `write:${CONFIG_ID}`,
        `release:${SERVER_LOCK}`,
      ]);
      expect(keptForWrite()).toEqual([false]);
    },
  );

  test.each([
    ["once its check is done", 2],
    ["right before the write", 3],
  ])(
    "a lock lost %s, and taken again once a project has lost its way in, refuses turning it on: nothing is written",
    async (_when: string, lostAtKeep: number) => {
      globalSamlTable.rows = [
        { _id: PROVIDER, isEnabled: true, restrictToAttachedProjects: false },
      ];

      getJestSpyOn(Semaphore, "keepLock").mockImplementation((async (mutex: {
        key: string;
      }): Promise<boolean> => {
        kept.push(mutex.key);

        if (kept.length !== lostAtKeep) {
          return true;
        }

        // While the lock was gone, the provider every project signed in with went off.
        globalSamlTable.rows[0]!["isEnabled"] = false;
        return false;
      }) as never);

      await expect(updateServerRule(true)).resolves.toBe(
        'The project "Beta" has no SSO provider people can sign in with, so requiring SSO for everyone would lock its members out. Turn on a global SSO provider, or an SSO provider in that project, first.',
      );

      expect(configTable.writes).toEqual([]);
      expect(configTable.rows[0]!["requireSsoForLogin"]).toBe(false);
      expect(events).toEqual([
        `lock:${SERVER_LOCK}`,
        `release:${SERVER_LOCK}`,
        `lock:${SERVER_LOCK}`,
        `release:${SERVER_LOCK}`,
      ]);
      expect(keptForWrite()).toEqual([false]);
    },
  );

  test.each([
    ["once its check is done", 2],
    ["right before the write", 3],
  ])(
    "a lock lost %s, and lost again once taken again, refuses turning it on: nothing is written, and nothing is held",
    async (_when: string, lostAtKeep: number) => {
      globalSamlTable.rows = [
        { _id: PROVIDER, isEnabled: true, restrictToAttachedProjects: false },
      ];

      getJestSpyOn(Semaphore, "keepLock").mockImplementation((async (mutex: {
        key: string;
      }): Promise<boolean> => {
        kept.push(mutex.key);
        return kept.length < lostAtKeep;
      }) as never);

      await expect(updateServerRule(true)).resolves.toBe(
        SIGN_IN_CHANGE_IN_PROGRESS_MESSAGE,
      );

      expect(configTable.writes).toEqual([]);
      expect(configTable.rows[0]!["requireSsoForLogin"]).toBe(false);
      expect(events).toEqual([
        `lock:${SERVER_LOCK}`,
        `release:${SERVER_LOCK}`,
        `lock:${SERVER_LOCK}`,
        `release:${SERVER_LOCK}`,
      ]);
      expect(keptForWrite()).toEqual([false]);
    },
  );

  test("its lock is kept alive from the check on, before the write is started", async () => {
    globalSamlTable.rows = [
      { _id: PROVIDER, isEnabled: true, restrictToAttachedProjects: false },
    ];

    const rememberServerRuleBefore: (
      ...args: Array<unknown>
    ) => Promise<unknown> = SsoRequirementChanges.rememberServerRuleBefore.bind(
      SsoRequirementChanges,
    ) as unknown as (...args: Array<unknown>) => Promise<unknown>;

    // The step that follows the check, before the write: the lock is kept alive by then.
    let keptAfterCheck: Array<boolean> = [];
    getJestSpyOn(
      SsoRequirementChanges,
      "rememberServerRuleBefore",
    ).mockImplementation((async (...args: Array<unknown>): Promise<unknown> => {
      keptAfterCheck = keptForWrite();
      return await rememberServerRuleBefore(...args);
    }) as never);

    await expect(updateServerRule(true)).resolves.toBe("done");

    expect(keptAfterCheck).toEqual([true]);
    expect(keptForWrite()).toEqual([false]);
  });

  test("its lock is kept alive while it is written, and no more once it is", async () => {
    globalSamlTable.rows = [
      { _id: PROVIDER, isEnabled: true, restrictToAttachedProjects: false },
    ];

    let keptWhileWritten: Array<boolean> = [];
    whileWriting = (): void => {
      keptWhileWritten = keptForWrite();
    };

    await expect(updateServerRule(true)).resolves.toBe("done");

    expect(keptWhileWritten).toEqual([true]);
    expect(keptForWrite()).toEqual([false]);
  });

  test("a write the database fails gives the lock back, and keeps it alive no more", async () => {
    globalSamlTable.rows = [
      { _id: PROVIDER, isEnabled: true, restrictToAttachedProjects: false },
    ];
    failing = "update";

    await expect(updateServerRule(true)).rejects.toThrow(
      "The database could not write the row",
    );

    expect(events).toEqual([`lock:${SERVER_LOCK}`, `release:${SERVER_LOCK}`]);
    expect(keptForWrite()).toEqual([false]);
  });

  test("turning it off is never refused, and takes no lock", async () => {
    await expect(updateServerRule(false)).resolves.toBe("done");

    expect(events).toEqual([`write:${CONFIG_ID}`]);
  });

  test("saved on again while it is on, it is checked as turning it on is: refused while a project has no way in, naming it", async () => {
    configTable.rows[0]!["requireSsoForLogin"] = true;

    await expect(updateServerRule(true)).resolves.toBe(
      'The project "Beta" has no SSO provider people can sign in with, so requiring SSO for everyone would lock its members out. Turn on a global SSO provider, or an SSO provider in that project, first.',
    );

    expect(configTable.writes).toEqual([]);
    expect(events).toEqual([`lock:${SERVER_LOCK}`, `release:${SERVER_LOCK}`]);
  });

  test("saved on again while every project has a way in, it goes through, holding the lock until it is written", async () => {
    configTable.rows[0]!["requireSsoForLogin"] = true;
    globalSamlTable.rows = [
      { _id: PROVIDER, isEnabled: true, restrictToAttachedProjects: false },
    ];

    let keptWhileWritten: Array<boolean> = [];
    whileWriting = (): void => {
      keptWhileWritten = keptForWrite();
    };

    await expect(updateServerRule(true)).resolves.toBe("done");

    expect(keptWhileWritten).toEqual([true]);
    expect(events).toEqual([
      `lock:${SERVER_LOCK}`,
      `write:${CONFIG_ID}`,
      `release:${SERVER_LOCK}`,
    ]);
    expect(keptForWrite()).toEqual([false]);
  });
});
