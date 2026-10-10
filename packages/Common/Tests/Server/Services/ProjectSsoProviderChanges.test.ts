import UserMiddleware from "../../../Server/Middleware/UserAuthorization";
import Semaphore, {
  SemaphoreLockTimeoutError,
} from "../../../Server/Infrastructure/Semaphore";
import AuditLogService from "../../../Server/Services/AuditLogService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import GlobalOidcProjectService from "../../../Server/Services/GlobalOidcProjectService";
import GlobalOidcService from "../../../Server/Services/GlobalOidcService";
import GlobalSsoProjectService from "../../../Server/Services/GlobalSsoProjectService";
import GlobalSsoService from "../../../Server/Services/GlobalSsoService";
import ProjectOidcService from "../../../Server/Services/ProjectOidcService";
import ProjectService from "../../../Server/Services/ProjectService";
import ProjectSsoService from "../../../Server/Services/ProjectSsoService";
import QueryHelper from "../../../Server/Types/Database/QueryHelper";
import CookieUtil from "../../../Server/Utils/Cookie";
import { ExpressRequest } from "../../../Server/Utils/Express";
import logger from "../../../Server/Utils/Logger";
import ProjectSsoProviderChanges, {
  LAST_SSO_PROVIDER_MESSAGE,
  PROVIDER_CHANGE_IN_PROGRESS_MESSAGE,
  REQUIRED_SSO_PROVIDER_MESSAGE,
  SERVER_LAST_SSO_PROVIDER_MESSAGE,
  SERVER_SIGN_IN_LOCK_KEY,
  SIGN_IN_CHANGE_IN_PROGRESS_MESSAGE,
} from "../../../Server/Utils/ProjectSsoProviderChanges";
import ProjectSsoProviderStanding from "../../../Server/Utils/ProjectSsoProviderStanding";
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
import ProjectOidc from "../../../Models/DatabaseModels/ProjectOidc";
import ProjectSso from "../../../Models/DatabaseModels/ProjectSso";
import User from "../../../Models/DatabaseModels/User";
import Includes from "../../../Types/BaseDatabase/Includes";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import OneUptimeDate from "../../../Types/Date";
import Email from "../../../Types/Email";
import BadDataException from "../../../Types/Exception/BadDataException";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import SsoProviderType from "../../../Types/SSO/SsoProviderType";
import { getJestSpyOn } from "../../Spy";
import { rowMatchesWhere } from "../TestingUtils/InMemoryRepository";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

type SpyInstance = ReturnType<typeof getJestSpyOn>;

/*
 * TURNING A PROJECT'S SSO PROVIDER OFF, OR DELETING IT, ENDS THE SIGN-INS IT
 * GAVE; CHANGING ANYTHING ELSE ABOUT IT DOES NOT.
 *
 * These run the real update and delete paths of ProjectSsoService and
 * ProjectOidcService - DatabaseService and the services' hooks
 * (Utils/ProjectSsoProviderChanges) - over providers held in memory below:
 * only the repository underneath is replaced. They check:
 *
 *   - turning a provider off writes when its sign-ins ended, in the same
 *     write, and tells every server (RealtimeAccessChanges,
 *     SignInRulesChanged for its project), which forgets what it knew about
 *     the project's providers and asks its open live updates again;
 *   - deleting one that is on tells every server too;
 *   - turning one on is told, so no server keeps answering "off";
 *   - a new certificate or client secret, new addresses or a new name write
 *     nothing more and tell nobody: the sign-ins it gave stay;
 *   - a project that requires SSO - itself, or because the whole server
 *     does - keeps a way in: its last provider, or the one it requires,
 *     cannot be turned off or deleted;
 *   - the check and the write hold a lock on the project (Semaphore, held
 *     in memory here), given back once the write is done, refused or fails;
 *     one that leaves the project none of its own providers on, or takes
 *     the one it requires, holds the lock on the server's sign-in rules
 *     too, kept while the check runs;
 *   - and the API's check (UserMiddleware) agrees, run on the same rows.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const USER_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

const SAML_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const SECOND_SAML_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const OIDC_ID: ObjectID = new ObjectID("66666666-6666-4666-8666-666666666666");
const SECOND_OIDC_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const OTHER_PROJECT_SAML_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);
const GLOBAL_SSO_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const GLOBAL_OIDC_ID: ObjectID = new ObjectID(
  "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
);

// A provider row as the database holds it: every column, by name.
type Row = Record<string, unknown> & {
  _id: string;
  projectId: ObjectID;
  isEnabled: boolean;
};

let samlRows: Array<Row> = [];
let oidcRows: Array<Row> = [];

// What the repository was asked to write, per table.
interface Write {
  id: string;
  set: Record<string, unknown>;
}

let samlWrites: Array<Write> = [];
let oidcWrites: Array<Write> = [];
let deleted: Array<string> = [];

// Whether the project requires SSO, and which provider, if one.
let project: {
  requireSsoForLogin: boolean;
  requireSsoWithSsoProviderId: ObjectID | null;
} = { requireSsoForLogin: false, requireSsoWithSsoProviderId: null };

// The instance's global providers that are on.
interface GlobalProvider {
  id: ObjectID;
  restrictToAttachedProjects: boolean;
  attachedTo: Array<ObjectID>;
}

let globalSsoProviders: Array<GlobalProvider> = [];
let globalOidcProviders: Array<GlobalProvider> = [];

let announced: Array<RealtimeAccessChange> = [];

// Whether the whole server requires SSO (GlobalConfig), and how often it was read.
let serverRequiresSso: boolean = false;
let serverRuleReads: number = 0;

/*
 * The locks taken and given back - a project's, or the one on the server's
 * sign-in rules ("server") - and the rows written, in order:
 * "lock:<project>", "lock:server", "write:<provider>", "delete:<provider>",
 * "release:<project>", "release:server".
 */
let events: Array<string> = [];

const SERVER_LOCK: string = SERVER_SIGN_IN_LOCK_KEY;

interface LockCall {
  key: string;
  namespace: string;
  lockTimeout?: number | undefined;
  acquireTimeout?: number | undefined;
  refreshInterval?: number | undefined;
}

let lockCalls: Array<LockCall> = [];
let locksFail: boolean = false;
let releasesFail: boolean = false;

// The locks kept while a check ran (Semaphore.keepLock), in order, and those found lost.
let kept: Array<string> = [];
let lostLocks: Array<string> = [];

/*
 * From this keep on (counted from 1), every lock is found lost: a lock that
 * ran out, or that Valkey lost, after the check that kept it.
 */
let locksLostFromKeep: number | null = null;

/*
 * At these keeps only (counted from 1), the lock is found lost: one that ran
 * out, or that Valkey lost, once - a lock taken again after it is held.
 */
let locksLostAtKeeps: Array<number> = [];

// The locks Semaphore.lock handed out, by key, the last of each.
let lockObjects: Map<string, { key: string }> = new Map<
  string,
  { key: string }
>();

// Runs as the database is asked to write or delete rows, before it does.
let whileWriting: (() => void) | null = null;

// The database refuses every update, or every delete, it is asked for.
let writesFail: boolean = false;
let deletesFail: boolean = false;

// A project whose lock another change holds for longer than a write waits.
let busyProjectId: string | null = null;

// What lands while a write waits for its lock, as another server's write would.
let whileWaitingForLock: (() => void) | null = null;

/*
 * The values a repository `where` asks a column for, lower-cased, or null
 * when it does not ask about the column: a plain value, an ObjectID, or a
 * raw FindOperator (QueryHelper) carrying them as parameters.
 */
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

  const operator: {
    _objectLiteralParameters?: Record<string, unknown>;
  } = value as { _objectLiteralParameters?: Record<string, unknown> };

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

// The repository of a provider table, over the rows above.
const stubRepository: (
  service: unknown,
  rows: () => Array<Row>,
  setRows: (rows: Array<Row>) => void,
  writes: () => Array<Write>,
  createModel: () => BaseModel,
) => void = (
  service: unknown,
  rows: () => Array<Row>,
  setRows: (rows: Array<Row>) => void,
  writes: () => Array<Write>,
  createModel: () => BaseModel,
): void => {
  getJestSpyOn(service, "getRepository").mockReturnValue({
    find: async (options: {
      where: Record<string, unknown>;
      skip?: number;
      take?: number;
      withDeleted?: boolean;
    }): Promise<Array<BaseModel>> => {
      // A row deleted before is found only by a read that asks for those (a hard delete's).
      const found: Array<Row> = rows().filter((row: Row): boolean => {
        return (
          (options.withDeleted || !row["deletedAt"]) &&
          matches(row, options.where)
        );
      });

      const skip: number = options.skip || 0;
      const take: number = options.take || found.length;

      return found.slice(skip, skip + take).map((row: Row): BaseModel => {
        const model: BaseModel = createModel();
        Object.assign(model, row);
        return model;
      });
    },
    count: async (options: {
      where: Record<string, unknown>;
    }): Promise<number> => {
      return rows().filter((row: Row): boolean => {
        return matches(row, options.where);
      }).length;
    },
    update: async (
      where: Record<string, unknown>,
      set: Record<string, unknown>,
    ): Promise<{ affected: number }> => {
      if (writesFail) {
        throw new Error("The database could not write the row");
      }

      whileWriting?.();

      const written: Record<string, unknown> = { ...set };
      delete written["version"];

      let affected: number = 0;

      for (const row of rows()) {
        if (matches(row, where)) {
          Object.assign(row, written);
          writes().push({ id: row._id, set: written });
          events.push(`write:${row._id}`);
          affected++;
        }
      }

      return { affected };
    },
    delete: async (
      where: Record<string, unknown>,
    ): Promise<{ affected: number }> => {
      if (deletesFail) {
        throw new Error("The database could not delete the row");
      }

      whileWriting?.();

      const gone: Array<Row> = rows().filter((row: Row): boolean => {
        return matches(row, where);
      });

      deleted.push(
        ...gone.map((row: Row): string => {
          return row._id;
        }),
      );
      events.push(
        ...gone.map((row: Row): string => {
          return `delete:${row._id}`;
        }),
      );

      setRows(
        rows().filter((row: Row): boolean => {
          return !gone.includes(row);
        }),
      );

      return { affected: gone.length };
    },
  } as never);

  getJestSpyOn(service, "onTriggerWorkflow").mockResolvedValue(
    undefined as never,
  );
  getJestSpyOn(service, "onTriggerRealtime").mockResolvedValue(
    undefined as never,
  );
};

const row: (data: {
  id: ObjectID;
  projectId?: ObjectID;
  isEnabled?: boolean;
  columns?: Record<string, unknown>;
}) => Row = (data: {
  id: ObjectID;
  projectId?: ObjectID;
  isEnabled?: boolean;
  columns?: Record<string, unknown>;
}): Row => {
  return {
    _id: data.id.toString(),
    projectId: data.projectId || PROJECT_ID,
    isEnabled: data.isEnabled === undefined ? true : data.isEnabled,
    ...(data.columns || {}),
  };
};

interface ProviderKind {
  label: string;
  type: SsoProviderType;
  service: typeof ProjectSsoService | typeof ProjectOidcService;
  id: ObjectID;
  // Another provider of the same kind, in the same project.
  secondId: ObjectID;
  rows: () => Array<Row>;
  writes: () => Array<Write>;
  // What signs people in to the provider: a new one keeps every sign-in.
  credential: Record<string, unknown>;
}

const SAML: ProviderKind = {
  label: "SAML",
  type: SsoProviderType.ProjectSSO,
  service: ProjectSsoService,
  id: SAML_ID,
  secondId: SECOND_SAML_ID,
  rows: (): Array<Row> => {
    return samlRows;
  },
  writes: (): Array<Write> => {
    return samlWrites;
  },
  credential: {
    publicCertificate:
      "-----BEGIN CERTIFICATE-----\nMIIrotated\n-----END CERTIFICATE-----",
  },
};

const OIDC: ProviderKind = {
  label: "OIDC",
  type: SsoProviderType.ProjectOIDC,
  service: ProjectOidcService,
  id: OIDC_ID,
  secondId: SECOND_OIDC_ID,
  rows: (): Array<Row> => {
    return oidcRows;
  },
  writes: (): Array<Write> => {
    return oidcWrites;
  },
  credential: { clientSecret: "a-rotated-client-secret" },
};

const KINDS: Array<[string, ProviderKind]> = [
  ["SAML", SAML],
  ["OIDC", OIDC],
];

const ROOT: { isRoot: true } = { isRoot: true };

const turnOff: (kind: ProviderKind, id?: ObjectID) => Promise<number> = (
  kind: ProviderKind,
  id?: ObjectID,
): Promise<number> => {
  return kind.service.updateOneById({
    id: id || kind.id,
    data: { isEnabled: false } as never,
    props: ROOT,
  });
};

const turnOn: (kind: ProviderKind, id?: ObjectID) => Promise<number> = (
  kind: ProviderKind,
  id?: ObjectID,
): Promise<number> => {
  return kind.service.updateOneById({
    id: id || kind.id,
    data: { isEnabled: true } as never,
    props: ROOT,
  });
};

const remove: (kind: ProviderKind, id?: ObjectID) => Promise<number> = (
  kind: ProviderKind,
  id?: ObjectID,
): Promise<number> => {
  return kind.service.deleteOneById({ id: id || kind.id, props: ROOT });
};

const rowOf: (kind: ProviderKind, id?: ObjectID) => Row | undefined = (
  kind: ProviderKind,
  id?: ObjectID,
): Row | undefined => {
  return kind.rows().find((candidate: Row): boolean => {
    return candidate._id === (id || kind.id).toString();
  });
};

const signInsEndedAtOf: (kind: ProviderKind, id?: ObjectID) => Date | null = (
  kind: ProviderKind,
  id?: ObjectID,
): Date | null => {
  const value: unknown = rowOf(kind, id)?.["signInsEndedAt"];
  return value ? new Date(value as Date) : null;
};

const projectAnnouncements: () => Array<string | undefined> = (): Array<
  string | undefined
> => {
  return announced
    .filter((change: RealtimeAccessChange): boolean => {
      return change.kind === RealtimeAccessChangeKind.SignInRulesChanged;
    })
    .map((change: RealtimeAccessChange): string | undefined => {
      return (change as { projectId?: string }).projectId?.toLowerCase();
    });
};

const wroteSignInsEndedAt: (kind: ProviderKind) => boolean = (
  kind: ProviderKind,
): boolean => {
  return kind.writes().some((write: Write): boolean => {
    return Object.prototype.hasOwnProperty.call(write.set, "signInsEndedAt");
  });
};

// Whether this server holds an answer about the project's providers.
const standingHeldFor: (kind: ProviderKind) => Promise<boolean> = async (
  kind: ProviderKind,
): Promise<boolean> => {
  const reads: SpyInstance = getJestSpyOn(kind.service, "findOneBy");
  await kind.service.getSignInStanding({
    providerId: kind.id,
    projectId: PROJECT_ID,
  });
  const held: boolean = reads.mock.calls.length === 0;
  reads.mockRestore();
  return held;
};

const refusalOf: (write: Promise<unknown>) => Promise<string> = async (
  write: Promise<unknown>,
): Promise<string> => {
  try {
    await write;
  } catch (err) {
    if (err instanceof BadDataException) {
      return err.message;
    }

    throw err;
  }

  return "done";
};

beforeEach(() => {
  ProjectSsoProviderStanding.forget();

  samlRows = [
    row({
      id: SAML_ID,
      columns: {
        name: "Okta",
        issuerURL: "http://www.okta.com/exk1",
        publicCertificate:
          "-----BEGIN CERTIFICATE-----\nMIIoriginal\n-----END CERTIFICATE-----",
      },
    }),
    row({ id: SECOND_SAML_ID, isEnabled: false, columns: { name: "Azure" } }),
    row({
      id: OTHER_PROJECT_SAML_ID,
      projectId: OTHER_PROJECT_ID,
      columns: { name: "Another project's Okta" },
    }),
  ];
  oidcRows = [
    row({
      id: OIDC_ID,
      /*
       * No client secret yet: the column is stored encrypted, so one held
       * here would have to be. The tests write a new one.
       */
      columns: {
        name: "Google",
        issuerURL: "https://accounts.google.com",
        clientId: "client-id",
      },
    }),
    row({ id: SECOND_OIDC_ID, isEnabled: false, columns: { name: "Auth0" } }),
  ];
  samlWrites = [];
  oidcWrites = [];
  deleted = [];
  announced = [];
  project = { requireSsoForLogin: false, requireSsoWithSsoProviderId: null };
  globalSsoProviders = [];
  globalOidcProviders = [];
  serverRequiresSso = false;
  serverRuleReads = 0;
  events = [];
  lockCalls = [];
  locksFail = false;
  releasesFail = false;
  kept = [];
  lostLocks = [];
  locksLostFromKeep = null;
  locksLostAtKeeps = [];
  lockObjects = new Map<string, { key: string }>();
  whileWriting = null;
  writesFail = false;
  deletesFail = false;
  busyProjectId = null;
  whileWaitingForLock = null;

  getJestSpyOn(logger, "error").mockImplementation((): void => {
    return undefined;
  });
  getJestSpyOn(logger, "warn").mockImplementation((): void => {
    return undefined;
  });

  // The whole server's Require SSO for Login, as the Admin Dashboard sets it.
  getJestSpyOn(GlobalConfigService, "findOneBy").mockImplementation(
    (async () => {
      serverRuleReads++;
      const config: GlobalConfig = new GlobalConfig();
      config.requireSsoForLogin = serverRequiresSso;
      return config;
    }) as never,
  );

  // A project lock held in memory: who took it, and when it came back.
  getJestSpyOn(Semaphore, "lock").mockImplementation((async (
    data: LockCall,
  ): Promise<unknown> => {
    lockCalls.push({ ...data });

    if (locksFail) {
      throw new Error("Redis client is not connected");
    }

    if (busyProjectId === data.key) {
      throw new SemaphoreLockTimeoutError(`Acquire mutex ${data.key} timeout`);
    }

    if (whileWaitingForLock) {
      const landing: () => void = whileWaitingForLock;
      whileWaitingForLock = null;
      landing();
    }

    events.push(`lock:${data.key}`);
    const lock: { key: string } = { key: data.key };
    lockObjects.set(data.key, lock);
    return lock;
  }) as never);
  getJestSpyOn(Semaphore, "release").mockImplementation((async (mutex: {
    key: string;
  }): Promise<void> => {
    if (releasesFail) {
      throw new Error("The lock could not be given back");
    }

    events.push(`release:${mutex.key}`);
  }) as never);
  // A lock kept for another while, unless it was lost meanwhile.
  getJestSpyOn(Semaphore, "keepLock").mockImplementation((async (mutex: {
    key: string;
  }): Promise<boolean> => {
    kept.push(mutex.key);

    if (locksLostFromKeep !== null && kept.length >= locksLostFromKeep) {
      return false;
    }

    if (locksLostAtKeeps.includes(kept.length)) {
      return false;
    }

    return !lostLocks.includes(mutex.key);
  }) as never);
  getJestSpyOn(logger, "debug").mockImplementation((): void => {
    return undefined;
  });

  stubRepository(
    ProjectSsoService,
    (): Array<Row> => {
      return samlRows;
    },
    (rows: Array<Row>): void => {
      samlRows = rows;
    },
    (): Array<Write> => {
      return samlWrites;
    },
    (): BaseModel => {
      return new ProjectSso();
    },
  );
  stubRepository(
    ProjectOidcService,
    (): Array<Row> => {
      return oidcRows;
    },
    (rows: Array<Row>): void => {
      oidcRows = rows;
    },
    (): Array<Write> => {
      return oidcWrites;
    },
    (): BaseModel => {
      return new ProjectOidc();
    },
  );

  // Every project the check reads has the rule above.
  const projectRead: (id: ObjectID) => Project = (id: ObjectID): Project => {
    const found: Project = new Project();
    found.id = id;
    found.requireSsoForLogin = project.requireSsoForLogin;

    if (project.requireSsoWithSsoProviderId) {
      found.requireSsoWithSsoProviderId = project.requireSsoWithSsoProviderId;
    }

    return found;
  };

  getJestSpyOn(ProjectService, "findOneById").mockImplementation((async (data: {
    id: ObjectID;
  }): Promise<Project> => {
    return projectRead(data.id);
  }) as never);
  // The projects a change names, read together by id.
  getJestSpyOn(ProjectService, "findBy").mockImplementation((async (data: {
    query: Record<string, unknown>;
  }): Promise<Array<Project>> => {
    return (askedValues(data.query["_id"]) || []).map((id: string): Project => {
      return projectRead(new ObjectID(id));
    });
  }) as never);

  // The instance's global providers that are on (the query asks for those).
  getJestSpyOn(GlobalSsoService, "findBy").mockImplementation((async () => {
    return globalSsoProviders.map((provider: GlobalProvider): GlobalSso => {
      const model: GlobalSso = new GlobalSso();
      model.id = provider.id;
      model.isEnabled = true;
      model.restrictToAttachedProjects = provider.restrictToAttachedProjects;
      return model;
    });
  }) as never);
  getJestSpyOn(GlobalOidcService, "findBy").mockImplementation((async () => {
    return globalOidcProviders.map((provider: GlobalProvider): GlobalOidc => {
      const model: GlobalOidc = new GlobalOidc();
      model.id = provider.id;
      model.isEnabled = true;
      model.restrictToAttachedProjects = provider.restrictToAttachedProjects;
      return model;
    });
  }) as never);

  /*
   * Their attachments, as the check reads them (SsoSignInWays): one row per
   * project a provider is attached to, each on.
   */
  const attachmentRows: (
    providers: Array<GlobalProvider>,
    providerColumn: "globalSsoId" | "globalOidcId",
    createModel: () => BaseModel,
  ) => Array<BaseModel> = (
    providers: Array<GlobalProvider>,
    providerColumn: "globalSsoId" | "globalOidcId",
    createModel: () => BaseModel,
  ): Array<BaseModel> => {
    return providers.flatMap((provider: GlobalProvider): Array<BaseModel> => {
      return provider.attachedTo.map((projectId: ObjectID): BaseModel => {
        const model: BaseModel = createModel();
        Object.assign(model, {
          _id: ObjectID.generate().toString(),
          [providerColumn]: provider.id,
          projectId: projectId,
          isEnabled: true,
        });
        return model;
      });
    });
  };

  getJestSpyOn(GlobalSsoProjectService, "findAllBy").mockImplementation(
    (async () => {
      return attachmentRows(globalSsoProviders, "globalSsoId", () => {
        return new GlobalSsoProject();
      });
    }) as never,
  );
  getJestSpyOn(GlobalOidcProjectService, "findAllBy").mockImplementation(
    (async () => {
      return attachmentRows(globalOidcProviders, "globalOidcId", () => {
        return new GlobalOidcProject();
      });
    }) as never,
  );

  const isAttached: (
    providers: Array<GlobalProvider>,
    providerId: ObjectID,
    projectId: ObjectID,
  ) => boolean = (
    providers: Array<GlobalProvider>,
    providerId: ObjectID,
    projectId: ObjectID,
  ): boolean => {
    return providers.some((provider: GlobalProvider): boolean => {
      return (
        provider.id.toString() === providerId.toString() &&
        provider.attachedTo.some((attached: ObjectID): boolean => {
          return attached.toString() === projectId.toString();
        })
      );
    });
  };

  getJestSpyOn(
    GlobalSsoProjectService,
    "doesProviderGovernProject",
  ).mockImplementation((async (data: {
    globalSsoId: ObjectID;
    projectId: ObjectID;
  }): Promise<boolean> => {
    return isAttached(globalSsoProviders, data.globalSsoId, data.projectId);
  }) as never);
  getJestSpyOn(
    GlobalOidcProjectService,
    "doesProviderGovernProject",
  ).mockImplementation((async (data: {
    globalOidcId: ObjectID;
    projectId: ObjectID;
  }): Promise<boolean> => {
    return isAttached(globalOidcProviders, data.globalOidcId, data.projectId);
  }) as never);

  // What every other server would hear; this server's own part runs here.
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
});

afterEach(() => {
  ProjectSsoProviderStanding.forget();
  jest.restoreAllMocks();
});

describe.each(KINDS)(
  "a project's %s provider",
  (_label: string, kind: ProviderKind) => {
    test("turning it off writes when its sign-ins ended, in the same write, and tells every server", async () => {
      const before: number = Date.now();

      await expect(turnOff(kind)).resolves.toBe(1);

      const after: number = Date.now();

      expect(kind.writes()).toHaveLength(1);
      expect(kind.writes()[0]!.set["isEnabled"]).toBe(false);

      const endedAt: Date | null = signInsEndedAtOf(kind);
      expect(endedAt).not.toBeNull();
      expect(endedAt!.getTime()).toBeGreaterThanOrEqual(before);
      expect(endedAt!.getTime()).toBeLessThanOrEqual(after);

      expect(projectAnnouncements()).toEqual([PROJECT_ID.toString()]);
    });

    test("turning it off forgets this server's answers about the project's providers at once", async () => {
      await kind.service.getSignInStanding({
        providerId: kind.id,
        projectId: PROJECT_ID,
      });
      await expect(standingHeldFor(kind)).resolves.toBe(true);

      await turnOff(kind);

      await expect(standingHeldFor(kind)).resolves.toBe(false);
      await expect(
        kind.service.getSignInStanding({
          providerId: kind.id,
          projectId: PROJECT_ID,
        }),
      ).resolves.toEqual({
        isOn: false,
        signInsEndedAtMs: signInsEndedAtOf(kind)!.getTime(),
      });
    });

    test("turning it on tells every server, and writes no time", async () => {
      await expect(turnOn(kind, kind.secondId)).resolves.toBe(1);

      expect(kind.writes()).toEqual([
        { id: kind.secondId.toString(), set: { isEnabled: true } },
      ]);
      expect(projectAnnouncements()).toEqual([PROJECT_ID.toString()]);
    });

    test("turned off, then on: it keeps the time its sign-ins ended", async () => {
      await turnOff(kind);
      const endedAt: Date | null = signInsEndedAtOf(kind);

      await turnOn(kind);

      expect(rowOf(kind)!.isEnabled).toBe(true);
      expect(signInsEndedAtOf(kind)).toEqual(endedAt);
      expect(projectAnnouncements()).toEqual([
        PROJECT_ID.toString(),
        PROJECT_ID.toString(),
      ]);
    });

    test("turning off a provider that is off already keeps the time it has and tells nobody", async () => {
      const earlier: Date = new Date(Date.now() - 24 * 60 * 60 * 1000);
      rowOf(kind, kind.secondId)!["signInsEndedAt"] = earlier;

      await turnOff(kind, kind.secondId);

      expect(wroteSignInsEndedAt(kind)).toBe(false);
      expect(signInsEndedAtOf(kind, kind.secondId)).toEqual(earlier);
      expect(projectAnnouncements()).toEqual([]);
    });

    test("turning on a provider that is on already tells nobody", async () => {
      await turnOn(kind);

      expect(projectAnnouncements()).toEqual([]);
    });

    test("a new certificate or client secret, new addresses or a new name keep every sign-in it gave: nothing more is written, nobody is told", async () => {
      await kind.service.getSignInStanding({
        providerId: kind.id,
        projectId: PROJECT_ID,
      });

      await expect(
        kind.service.updateOneById({
          id: kind.id,
          data: {
            ...kind.credential,
            issuerURL: "https://idp.example.com/rotated",
            name: "Renamed",
          } as never,
          props: ROOT,
        }),
      ).resolves.toBe(1);

      expect(kind.writes()).toHaveLength(1);
      expect(wroteSignInsEndedAt(kind)).toBe(false);
      expect(Object.keys(kind.writes()[0]!.set)).not.toContain("isEnabled");
      expect(rowOf(kind)!.isEnabled).toBe(true);
      expect(projectAnnouncements()).toEqual([]);
      // This server still holds its answer: nothing about any sign-in changed.
      await expect(standingHeldFor(kind)).resolves.toBe(true);
    });

    test("deleting it while it is on tells every server", async () => {
      await expect(remove(kind)).resolves.toBe(1);

      expect(deleted).toEqual([kind.id.toString()]);
      expect(projectAnnouncements()).toEqual([PROJECT_ID.toString()]);
      await expect(
        kind.service.getSignInStanding({
          providerId: kind.id,
          projectId: PROJECT_ID,
        }),
      ).resolves.toEqual({ isOn: false, signInsEndedAtMs: null });
    });

    test("deleting one that is off tells nobody: it gave no sign-in that still counts", async () => {
      await expect(remove(kind, kind.secondId)).resolves.toBe(1);

      expect(projectAnnouncements()).toEqual([]);
    });

    describe("a project that requires SSO keeps a way in", () => {
      beforeEach(() => {
        project = {
          requireSsoForLogin: true,
          requireSsoWithSsoProviderId: null,
        };

        // Only this provider is on: the project's others are off.
        const other: ProviderKind = kind === SAML ? OIDC : SAML;
        rowOf(other)!.isEnabled = false;
      });

      test("its last provider that is on cannot be turned off", async () => {
        await expect(refusalOf(turnOff(kind))).resolves.toBe(
          LAST_SSO_PROVIDER_MESSAGE,
        );

        expect(kind.writes()).toEqual([]);
        expect(rowOf(kind)!.isEnabled).toBe(true);
        expect(projectAnnouncements()).toEqual([]);
      });

      test("nor deleted", async () => {
        await expect(refusalOf(remove(kind))).resolves.toBe(
          LAST_SSO_PROVIDER_MESSAGE,
        );

        expect(deleted).toEqual([]);
        expect(rowOf(kind)).toBeDefined();
        expect(projectAnnouncements()).toEqual([]);
      });

      test("another of its providers of the same kind that is on lets it go", async () => {
        rowOf(kind, kind.secondId)!.isEnabled = true;

        await expect(refusalOf(turnOff(kind))).resolves.toBe("done");
        expect(rowOf(kind)!.isEnabled).toBe(false);
      });

      test("a provider of the other kind that is on lets it go", async () => {
        const other: ProviderKind = kind === SAML ? OIDC : SAML;
        rowOf(other, other.secondId)!.isEnabled = true;

        await expect(refusalOf(remove(kind))).resolves.toBe("done");
        expect(rowOf(kind)).toBeUndefined();
      });

      test("a global SSO provider that signs people in to every project lets it go", async () => {
        globalSsoProviders = [
          {
            id: GLOBAL_SSO_ID,
            restrictToAttachedProjects: false,
            attachedTo: [],
          },
        ];

        await expect(refusalOf(turnOff(kind))).resolves.toBe("done");
      });

      test("a global OIDC provider restricted to its attached projects lets it go only when this project is attached", async () => {
        globalOidcProviders = [
          {
            id: GLOBAL_OIDC_ID,
            restrictToAttachedProjects: true,
            attachedTo: [OTHER_PROJECT_ID],
          },
        ];

        await expect(refusalOf(turnOff(kind))).resolves.toBe(
          LAST_SSO_PROVIDER_MESSAGE,
        );

        globalOidcProviders[0]!.attachedTo.push(PROJECT_ID);

        await expect(refusalOf(turnOff(kind))).resolves.toBe("done");
      });

      test("another project's provider that is on does not count", async () => {
        expect(rowOf(SAML, OTHER_PROJECT_SAML_ID)!.isEnabled).toBe(true);

        await expect(refusalOf(turnOff(kind))).resolves.toBe(
          LAST_SSO_PROVIDER_MESSAGE,
        );
      });

      test("turning it on, and changing anything else about it, are never refused", async () => {
        await expect(
          refusalOf(
            kind.service.updateOneById({
              id: kind.id,
              data: { ...kind.credential, name: "Renamed" } as never,
              props: ROOT,
            }),
          ),
        ).resolves.toBe("done");
        await expect(refusalOf(turnOn(kind, kind.secondId))).resolves.toBe(
          "done",
        );
      });

      test("a project that requires this provider refuses to let it go, even with others on", async () => {
        project.requireSsoWithSsoProviderId = kind.id;
        globalSsoProviders = [
          {
            id: GLOBAL_SSO_ID,
            restrictToAttachedProjects: false,
            attachedTo: [],
          },
        ];
        rowOf(kind, kind.secondId)!.isEnabled = true;

        await expect(refusalOf(turnOff(kind))).resolves.toBe(
          REQUIRED_SSO_PROVIDER_MESSAGE,
        );
        await expect(refusalOf(remove(kind))).resolves.toBe(
          REQUIRED_SSO_PROVIDER_MESSAGE,
        );

        // Its certificate or secret can still be changed.
        await expect(
          refusalOf(
            kind.service.updateOneById({
              id: kind.id,
              data: { ...kind.credential } as never,
              props: ROOT,
            }),
          ),
        ).resolves.toBe("done");
      });

      test("a project that requires another provider lets this one go: it never let anyone in", async () => {
        project.requireSsoWithSsoProviderId = kind.secondId;

        await expect(refusalOf(turnOff(kind))).resolves.toBe("done");
      });

      test("once the project no longer requires SSO, its last provider can go", async () => {
        project.requireSsoForLogin = false;

        await expect(refusalOf(remove(kind))).resolves.toBe("done");
        expect(projectAnnouncements()).toEqual([PROJECT_ID.toString()]);
      });
    });
  },
);

describe("one write over several providers", () => {
  test("turning a project's providers off at once tells every server once, for that project", async () => {
    rowOf(SAML, SECOND_SAML_ID)!.isEnabled = true;

    await expect(
      ProjectSsoService.updateBy({
        query: { projectId: PROJECT_ID },
        data: { isEnabled: false } as never,
        limit: LIMIT_MAX,
        skip: 0,
        props: ROOT,
      }),
    ).resolves.toBe(2);

    expect(rowOf(SAML)!.isEnabled).toBe(false);
    expect(rowOf(SAML, SECOND_SAML_ID)!.isEnabled).toBe(false);
    expect(signInsEndedAtOf(SAML)).not.toBeNull();
    expect(signInsEndedAtOf(SAML, SECOND_SAML_ID)).not.toBeNull();
    // The other project's provider is not part of the write.
    expect(rowOf(SAML, OTHER_PROJECT_SAML_ID)!.isEnabled).toBe(true);

    expect(projectAnnouncements()).toEqual([PROJECT_ID.toString()]);
  });

  test("providers of two projects are told for each project", async () => {
    await expect(
      ProjectSsoService.updateBy({
        query: {},
        data: { isEnabled: false } as never,
        limit: LIMIT_MAX,
        skip: 0,
        props: ROOT,
      }),
    ).resolves.toBe(3);

    expect(projectAnnouncements().sort()).toEqual(
      [PROJECT_ID.toString(), OTHER_PROJECT_ID.toString()].sort(),
    );
  });
});

describe.each(KINDS)(
  "a server that requires SSO for everyone keeps a way in to each project too (%s)",
  (_label: string, kind: ProviderKind) => {
    beforeEach(() => {
      serverRequiresSso = true;

      // Only this provider is on: the project's others are off.
      const other: ProviderKind = kind === SAML ? OIDC : SAML;
      rowOf(other)!.isEnabled = false;
    });

    test("the last provider of a project that does not require SSO itself cannot be turned off or deleted", async () => {
      await expect(refusalOf(turnOff(kind))).resolves.toBe(
        SERVER_LAST_SSO_PROVIDER_MESSAGE,
      );
      await expect(refusalOf(remove(kind))).resolves.toBe(
        SERVER_LAST_SSO_PROVIDER_MESSAGE,
      );

      expect(kind.writes()).toEqual([]);
      expect(deleted).toEqual([]);
      expect(rowOf(kind)!.isEnabled).toBe(true);
      expect(projectAnnouncements()).toEqual([]);
    });

    test("another provider that signs people in to the project lets it go", async () => {
      globalSsoProviders = [
        {
          id: GLOBAL_SSO_ID,
          restrictToAttachedProjects: false,
          attachedTo: [],
        },
      ];

      await expect(refusalOf(turnOff(kind))).resolves.toBe("done");
      expect(rowOf(kind)!.isEnabled).toBe(false);
    });

    test("a project that requires SSO itself is refused in its own words, without reading the server's rule", async () => {
      project.requireSsoForLogin = true;

      await expect(refusalOf(turnOff(kind))).resolves.toBe(
        LAST_SSO_PROVIDER_MESSAGE,
      );
      expect(serverRuleReads).toBe(0);
    });

    test("turning it on, or changing anything else about it, reads nothing and is never refused", async () => {
      await expect(
        refusalOf(
          kind.service.updateOneById({
            id: kind.id,
            data: { ...kind.credential } as never,
            props: ROOT,
          }),
        ),
      ).resolves.toBe("done");
      await expect(refusalOf(turnOn(kind, kind.secondId))).resolves.toBe(
        "done",
      );
      expect(serverRuleReads).toBe(0);
    });
  },
);

describe("when neither the project nor the server requires SSO", () => {
  test.each(KINDS)(
    "%s: the last provider can go, once the server's rule is read",
    async (_label: string, kind: ProviderKind) => {
      const other: ProviderKind = kind === SAML ? OIDC : SAML;
      rowOf(other)!.isEnabled = false;

      await expect(refusalOf(turnOff(kind))).resolves.toBe("done");
      expect(serverRuleReads).toBe(1);
    },
  );
});

describe("the check and the write hold the project's lock", () => {
  // The provider this one is turned off next to: the project's only other own one that is on.
  const leaveItLast: (kind: ProviderKind) => void = (
    kind: ProviderKind,
  ): void => {
    rowOf(kind === SAML ? OIDC : SAML)!.isEnabled = false;
  };

  test.each(KINDS)(
    "%s: turning off a provider while the project keeps another of its own locks only the project: the server's rules are neither locked nor read",
    async (_label: string, kind: ProviderKind) => {
      await expect(turnOff(kind)).resolves.toBe(1);

      expect(events).toEqual([
        `lock:${PROJECT_ID.toString()}`,
        `write:${kind.id.toString()}`,
        `release:${PROJECT_ID.toString()}`,
      ]);
      expect(lockCalls).toEqual([
        {
          key: PROJECT_ID.toString(),
          namespace: "ProjectSsoProviderChanges.keepAWayIn",
          lockTimeout: 10_000,
          acquireTimeout: 15_000,
          refreshInterval: 0,
        },
      ]);
      expect(serverRuleReads).toBe(0);
      expect(wroteSignInsEndedAt(kind)).toBe(true);
    },
  );

  test.each(KINDS)(
    "%s: deleting one while another of the project's own is on locks only the project too",
    async (_label: string, kind: ProviderKind) => {
      await expect(remove(kind)).resolves.toBe(1);

      expect(events).toEqual([
        `lock:${PROJECT_ID.toString()}`,
        `delete:${kind.id.toString()}`,
        `release:${PROJECT_ID.toString()}`,
      ]);
      expect(serverRuleReads).toBe(0);
    },
  );

  test.each(KINDS)(
    "%s: turning off the project's last own provider locks the project, then the server's sign-in rules, and gives both back once written, waiting longer than a lock is held",
    async (_label: string, kind: ProviderKind) => {
      leaveItLast(kind);

      await expect(turnOff(kind)).resolves.toBe(1);

      expect(events).toEqual([
        `lock:${PROJECT_ID.toString()}`,
        `lock:${SERVER_LOCK}`,
        `write:${kind.id.toString()}`,
        `release:${PROJECT_ID.toString()}`,
        `release:${SERVER_LOCK}`,
      ]);
      expect(lockCalls).toEqual([
        {
          key: PROJECT_ID.toString(),
          namespace: "ProjectSsoProviderChanges.keepAWayIn",
          lockTimeout: 10_000,
          acquireTimeout: 15_000,
          refreshInterval: 0,
        },
        {
          key: SERVER_LOCK,
          namespace: "ProjectSsoProviderChanges.keepAWayIn",
          lockTimeout: 10_000,
          acquireTimeout: 15_000,
          refreshInterval: 0,
        },
      ]);
    },
  );

  test.each(KINDS)(
    "%s: a hard delete, which runs no onDeleteSuccess, gives the locks back once it is done, and tells every server, as a delete does",
    async (_label: string, kind: ProviderKind) => {
      leaveItLast(kind);

      await expect(
        kind.service.hardDeleteBy({
          query: { _id: kind.id } as never,
          limit: 1,
          skip: 0,
          props: ROOT,
        }),
      ).resolves.toBe(1);

      expect(events).toEqual([
        `lock:${PROJECT_ID.toString()}`,
        `lock:${SERVER_LOCK}`,
        `delete:${kind.id.toString()}`,
        `release:${PROJECT_ID.toString()}`,
        `release:${SERVER_LOCK}`,
      ]);
      expect(projectAnnouncements()).toEqual([PROJECT_ID.toString()]);
    },
  );

  test.each(KINDS)(
    "%s: deleting the project's last own provider holds them the same way",
    async (_label: string, kind: ProviderKind) => {
      leaveItLast(kind);

      await expect(remove(kind)).resolves.toBe(1);

      expect(events).toEqual([
        `lock:${PROJECT_ID.toString()}`,
        `lock:${SERVER_LOCK}`,
        `delete:${kind.id.toString()}`,
        `release:${PROJECT_ID.toString()}`,
        `release:${SERVER_LOCK}`,
      ]);
    },
  );

  test.each(KINDS)(
    "%s: turning a provider on locks only its project: it takes nothing away, so the server's rules are not read",
    async (_label: string, kind: ProviderKind) => {
      await expect(turnOn(kind, kind.secondId)).resolves.toBe(1);

      expect(events).toEqual([
        `lock:${PROJECT_ID.toString()}`,
        `write:${kind.secondId.toString()}`,
        `release:${PROJECT_ID.toString()}`,
      ]);
      expect(serverRuleReads).toBe(0);
    },
  );

  test.each(KINDS)(
    "%s: taking away the provider the project requires locks the server's sign-in rules too, even with others of its own on",
    async (_label: string, kind: ProviderKind) => {
      project.requireSsoWithSsoProviderId = kind.id;

      // Required only while SSO is: neither the project nor the server requires it.
      await expect(turnOff(kind)).resolves.toBe(1);

      expect(events).toEqual([
        `lock:${PROJECT_ID.toString()}`,
        `lock:${SERVER_LOCK}`,
        `write:${kind.id.toString()}`,
        `release:${PROJECT_ID.toString()}`,
        `release:${SERVER_LOCK}`,
      ]);
      expect(serverRuleReads).toBe(1);
    },
  );

  test.each(KINDS)(
    "%s: the locks are kept while the check runs, once it is done, and once more right before the write",
    async (_label: string, kind: ProviderKind) => {
      leaveItLast(kind);

      await expect(turnOff(kind)).resolves.toBe(1);

      /*
       * Before the page of projects the check reads, once it is done (the
       * update's onBeforeUpdate), and right before the write (its
       * onUpdatePermitted, the last step before it).
       */
      expect(kept).toEqual([
        PROJECT_ID.toString(),
        SERVER_LOCK,
        PROJECT_ID.toString(),
        SERVER_LOCK,
        PROJECT_ID.toString(),
        SERVER_LOCK,
      ]);
    },
  );

  test.each(KINDS)(
    "%s: a delete keeps its locks while the check runs and once more when it is done, the last step before the delete",
    async (_label: string, kind: ProviderKind) => {
      leaveItLast(kind);

      await expect(remove(kind)).resolves.toBe(1);

      expect(kept).toEqual([
        PROJECT_ID.toString(),
        SERVER_LOCK,
        PROJECT_ID.toString(),
        SERVER_LOCK,
      ]);
    },
  );

  test.each(KINDS)(
    "%s: a lock that cannot be kept for want of Valkey lets the check go on, as one that could not be taken does",
    async (_label: string, kind: ProviderKind) => {
      leaveItLast(kind);
      getJestSpyOn(Semaphore, "keepLock").mockRejectedValue(
        new Error("Redis client is not connected") as never,
      );

      await expect(turnOff(kind)).resolves.toBe(1);
      expect(logger.warn).toHaveBeenCalled();
      expect(rowOf(kind)!.isEnabled).toBe(false);
    },
  );

  test.each(KINDS)(
    "%s: a lock found lost while the check runs refuses the write, writes nothing and gives the others back",
    async (_label: string, kind: ProviderKind) => {
      leaveItLast(kind);
      lostLocks = [SERVER_LOCK];

      await expect(refusalOf(turnOff(kind))).resolves.toBe(
        SIGN_IN_CHANGE_IN_PROGRESS_MESSAGE,
      );
      await expect(refusalOf(remove(kind))).resolves.toBe(
        SIGN_IN_CHANGE_IN_PROGRESS_MESSAGE,
      );

      expect(kind.writes()).toEqual([]);
      expect(deleted).toEqual([]);
      expect(rowOf(kind)!.isEnabled).toBe(true);
      expect(projectAnnouncements()).toEqual([]);
      expect(events).toEqual([
        `lock:${PROJECT_ID.toString()}`,
        `lock:${SERVER_LOCK}`,
        `release:${PROJECT_ID.toString()}`,
        `release:${SERVER_LOCK}`,
        `lock:${PROJECT_ID.toString()}`,
        `lock:${SERVER_LOCK}`,
        `release:${PROJECT_ID.toString()}`,
        `release:${SERVER_LOCK}`,
      ]);
    },
  );

  test.each(KINDS)(
    "%s: a write the database fails once it holds its locks gives them back at once",
    async (_label: string, kind: ProviderKind) => {
      leaveItLast(kind);
      writesFail = true;
      deletesFail = true;

      await expect(turnOff(kind)).rejects.toThrow(
        "The database could not write the row",
      );
      await expect(remove(kind)).rejects.toThrow(
        "The database could not delete the row",
      );

      expect(rowOf(kind)!.isEnabled).toBe(true);
      expect(projectAnnouncements()).toEqual([]);
      expect(events).toEqual([
        `lock:${PROJECT_ID.toString()}`,
        `lock:${SERVER_LOCK}`,
        `release:${PROJECT_ID.toString()}`,
        `release:${SERVER_LOCK}`,
        `lock:${PROJECT_ID.toString()}`,
        `lock:${SERVER_LOCK}`,
        `release:${PROJECT_ID.toString()}`,
        `release:${SERVER_LOCK}`,
      ]);
    },
  );

  test.each(KINDS)(
    "%s: while another change to who can sign in holds the server's rules too long, the write is refused and the project's lock given back",
    async (_label: string, kind: ProviderKind) => {
      leaveItLast(kind);
      busyProjectId = SERVER_LOCK;

      await expect(refusalOf(turnOff(kind))).resolves.toBe(
        SIGN_IN_CHANGE_IN_PROGRESS_MESSAGE,
      );
      await expect(refusalOf(remove(kind))).resolves.toBe(
        SIGN_IN_CHANGE_IN_PROGRESS_MESSAGE,
      );

      expect(events).toEqual([
        `lock:${PROJECT_ID.toString()}`,
        `release:${PROJECT_ID.toString()}`,
        `lock:${PROJECT_ID.toString()}`,
        `release:${PROJECT_ID.toString()}`,
      ]);
      expect(kind.writes()).toEqual([]);
      expect(deleted).toEqual([]);
      expect(rowOf(kind)!.isEnabled).toBe(true);
    },
  );

  test.each(KINDS)(
    "%s: a refused write gives the lock back at once and writes nothing",
    async (_label: string, kind: ProviderKind) => {
      project.requireSsoForLogin = true;
      const other: ProviderKind = kind === SAML ? OIDC : SAML;
      rowOf(other)!.isEnabled = false;

      await expect(refusalOf(turnOff(kind))).resolves.toBe(
        LAST_SSO_PROVIDER_MESSAGE,
      );
      await expect(refusalOf(remove(kind))).resolves.toBe(
        LAST_SSO_PROVIDER_MESSAGE,
      );

      expect(events).toEqual([
        `lock:${PROJECT_ID.toString()}`,
        `lock:${SERVER_LOCK}`,
        `release:${PROJECT_ID.toString()}`,
        `release:${SERVER_LOCK}`,
        `lock:${PROJECT_ID.toString()}`,
        `lock:${SERVER_LOCK}`,
        `release:${PROJECT_ID.toString()}`,
        `release:${SERVER_LOCK}`,
      ]);
    },
  );

  test.each(KINDS)(
    "%s: changing anything but Enabled takes no lock",
    async (_label: string, kind: ProviderKind) => {
      await kind.service.updateOneById({
        id: kind.id,
        data: { ...kind.credential, name: "Renamed" } as never,
        props: ROOT,
      });

      expect(lockCalls).toEqual([]);
    },
  );

  test.each(KINDS)(
    "%s: turning one on, turning one off that is off, and deleting one that is off lock its project too, and change nothing more",
    async (_label: string, kind: ProviderKind) => {
      const other: ProviderKind = kind === SAML ? OIDC : SAML;

      await turnOff(kind, kind.secondId);
      await turnOn(kind, kind.secondId);
      await expect(remove(other, other.secondId)).resolves.toBe(1);

      // None takes a provider away that was on: the server's rules are not locked.
      expect(
        lockCalls.map((call: LockCall): string => {
          return call.key;
        }),
      ).toEqual([
        PROJECT_ID.toString(),
        PROJECT_ID.toString(),
        PROJECT_ID.toString(),
      ]);
      expect(
        events.filter((event: string): boolean => {
          return event.startsWith("release:");
        }),
      ).toHaveLength(3);
      expect(wroteSignInsEndedAt(kind)).toBe(false);
    },
  );

  test.each(KINDS)(
    "%s: a provider turned on while the write waited for the lock is turned off for real: its time is written and every server told",
    async (_label: string, kind: ProviderKind) => {
      // The write reads the provider as off, then waits; another turns it on.
      whileWaitingForLock = (): void => {
        rowOf(kind, kind.secondId)!.isEnabled = true;
      };

      await expect(turnOff(kind, kind.secondId)).resolves.toBe(1);

      expect(rowOf(kind, kind.secondId)!.isEnabled).toBe(false);
      expect(signInsEndedAtOf(kind, kind.secondId)).not.toBeNull();
      expect(projectAnnouncements()).toEqual([PROJECT_ID.toString()]);
    },
  );

  test.each(KINDS)(
    "%s: a provider turned on while the write waited is checked like any other: the last one stays",
    async (_label: string, kind: ProviderKind) => {
      project.requireSsoForLogin = true;
      const other: ProviderKind = kind === SAML ? OIDC : SAML;
      rowOf(kind)!.isEnabled = false;
      rowOf(other)!.isEnabled = false;

      whileWaitingForLock = (): void => {
        rowOf(kind, kind.secondId)!.isEnabled = true;
      };

      await expect(refusalOf(turnOff(kind, kind.secondId))).resolves.toBe(
        LAST_SSO_PROVIDER_MESSAGE,
      );
      expect(rowOf(kind, kind.secondId)!.isEnabled).toBe(true);
    },
  );

  test.each(KINDS)(
    "%s: a lock another change holds too long refuses the write rather than check it unlocked",
    async (_label: string, kind: ProviderKind) => {
      busyProjectId = PROJECT_ID.toString();

      await expect(refusalOf(turnOff(kind))).resolves.toBe(
        PROVIDER_CHANGE_IN_PROGRESS_MESSAGE,
      );
      await expect(refusalOf(remove(kind))).resolves.toBe(
        PROVIDER_CHANGE_IN_PROGRESS_MESSAGE,
      );

      expect(kind.writes()).toEqual([]);
      expect(deleted).toEqual([]);
      expect(rowOf(kind)!.isEnabled).toBe(true);
      expect(projectAnnouncements()).toEqual([]);
    },
  );

  test("a write over two projects whose second lock is busy gives the first back", async () => {
    const [first, second]: Array<string> = [
      PROJECT_ID.toString(),
      OTHER_PROJECT_ID.toString(),
    ].sort();
    busyProjectId = second!;

    await expect(
      refusalOf(
        ProjectSsoService.updateBy({
          query: {},
          data: { isEnabled: false } as never,
          limit: LIMIT_MAX,
          skip: 0,
          props: ROOT,
        }),
      ),
    ).resolves.toBe(PROVIDER_CHANGE_IN_PROGRESS_MESSAGE);

    expect(events).toEqual([`lock:${first}`, `release:${first}`]);
    expect(samlWrites).toEqual([]);
  });

  test("the projects of one write are locked one after another, in the same order every time", async () => {
    await expect(
      ProjectSsoService.updateBy({
        query: {},
        data: { isEnabled: false } as never,
        limit: LIMIT_MAX,
        skip: 0,
        props: ROOT,
      }),
    ).resolves.toBe(3);

    const [first, second]: Array<string> = [
      PROJECT_ID.toString(),
      OTHER_PROJECT_ID.toString(),
    ].sort();

    expect(
      lockCalls.map((call: LockCall): string => {
        return call.key;
      }),
    ).toEqual([first, second, SERVER_LOCK]);
    expect(events.slice(-3)).toEqual([
      `release:${first}`,
      `release:${second}`,
      `release:${SERVER_LOCK}`,
    ]);
  });

  test.each(KINDS)(
    "%s: without Valkey the check still runs, unlocked",
    async (_label: string, kind: ProviderKind) => {
      locksFail = true;
      project.requireSsoForLogin = true;
      const other: ProviderKind = kind === SAML ? OIDC : SAML;
      rowOf(other)!.isEnabled = false;

      await expect(refusalOf(turnOff(kind))).resolves.toBe(
        LAST_SSO_PROVIDER_MESSAGE,
      );

      rowOf(kind, kind.secondId)!.isEnabled = true;

      await expect(refusalOf(turnOff(kind))).resolves.toBe("done");
      expect(rowOf(kind)!.isEnabled).toBe(false);
      /*
       * The first asked for its project's lock and the server's; the second
       * left the project another of its own, and asked for the project's.
       */
      expect(lockCalls).toHaveLength(3);
      expect(logger.warn).toHaveBeenCalled();
    },
  );

  test.each(KINDS)(
    "%s: a lock that cannot be given back does not fail the write",
    async (_label: string, kind: ProviderKind) => {
      releasesFail = true;

      await expect(turnOff(kind)).resolves.toBe(1);
      expect(rowOf(kind)!.isEnabled).toBe(false);
      expect(projectAnnouncements()).toEqual([PROJECT_ID.toString()]);
    },
  );
});

/*
 * The hooks' reads of the providers a write names - each holding the write to
 * the rows it read (DatabaseService.findRowsAndHoldUpdateToThem and
 * findRowsAndHoldDeleteToThem, read with findBy, or findByWithDeleted for a
 * hard delete) - recorded as "read" next to the locks, in order; `after`
 * runs once the read with that number has been answered, as another
 * server's write landing then would. Answers the reads, as the hooks asked
 * them.
 */
const watchProviderReads: (
  kind: ProviderKind,
  after?: Record<number, () => void>,
) => Array<{ query: Record<string, unknown> }> = (
  kind: ProviderKind,
  after?: Record<number, () => void>,
): Array<{ query: Record<string, unknown> }> => {
  const asked: Array<{ query: Record<string, unknown> }> = [];
  let reads: number = 0;

  for (const method of ["findBy", "findByWithDeleted"]) {
    const service: Record<
      string,
      (...args: Array<unknown>) => Promise<unknown>
    > = kind.service as unknown as Record<
      string,
      (...args: Array<unknown>) => Promise<unknown>
    >;
    const read: (...args: Array<unknown>) => Promise<unknown> =
      service[method]!.bind(kind.service);

    getJestSpyOn(kind.service, method as never).mockImplementation((async (
      ...args: Array<unknown>
    ): Promise<unknown> => {
      const findBy: {
        query: Record<string, unknown>;
        select?: Record<string, unknown>;
      } = args[0] as {
        query: Record<string, unknown>;
        select?: Record<string, unknown>;
      };
      const select: Record<string, unknown> = findBy.select || {};
      const answer: unknown = await read(...args);

      // What the hooks read the providers by: their project, switch and deletion.
      if (select["projectId"] && select["isEnabled"] && select["deletedAt"]) {
        reads++;
        asked.push({ query: findBy.query });
        events.push("read");
        after?.[reads]?.();
      }

      return answer;
    }) as never);
  }

  return asked;
};

describe("the rows a write names are read under the lock", () => {
  test.each(KINDS)(
    "%s: turning a provider off reads its rows to learn the project, locks it, and reads them again before the check",
    async (_label: string, kind: ProviderKind) => {
      // Its last own provider: the check reads the server's rules, under their lock too.
      rowOf(kind === SAML ? OIDC : SAML)!.isEnabled = false;

      watchProviderReads(kind);

      await expect(turnOff(kind)).resolves.toBe(1);

      expect(events).toEqual([
        "read",
        `lock:${PROJECT_ID.toString()}`,
        "read",
        `lock:${SERVER_LOCK}`,
        `write:${kind.id.toString()}`,
        `release:${PROJECT_ID.toString()}`,
        `release:${SERVER_LOCK}`,
      ]);
      expect(wroteSignInsEndedAt(kind)).toBe(true);
    },
  );

  /*
   * The first read holds the write to the providers it read, so the read
   * under the lock is among them, in the project locked: a provider that
   * comes to match the filter in another project while the write waits for
   * the lock was never read, and is left alone - the write is not refused
   * for it.
   */
  test.each(KINDS)(
    "%s: a provider that comes to match the filter in another project while the write waits for its lock is left alone, and the write goes to the provider it read",
    async (_label: string, kind: ProviderKind) => {
      const name: string = String(rowOf(kind)!["name"]);
      const laterId: ObjectID = new ObjectID(
        "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      );

      // While the write waits for its project's lock, another project gets a provider of that name.
      whileWaitingForLock = (): void => {
        kind.rows().push(
          row({
            id: laterId,
            projectId: OTHER_PROJECT_ID,
            columns: { name: name },
          }),
        );
      };

      await expect(
        kind.service.updateBy({
          query: { name: name },
          data: { isEnabled: false } as never,
          limit: LIMIT_MAX,
          skip: 0,
          props: ROOT,
        }),
      ).resolves.toBe(1);

      expect(
        kind.writes().map((write: Write): string => {
          return write.id;
        }),
      ).toEqual([kind.id.toString()]);
      expect(rowOf(kind, laterId)!.isEnabled).toBe(true);
      // Only the project of the provider read is locked.
      expect(
        lockCalls.map((call: LockCall): string => {
          return call.key;
        }),
      ).toEqual([PROJECT_ID.toString()]);
      expect(projectAnnouncements()).toEqual([PROJECT_ID.toString()]);
    },
  );

  test.each(KINDS)(
    "%s: a write that names no row reads once and locks nothing",
    async (_label: string, kind: ProviderKind) => {
      await expect(
        kind.service.updateBy({
          query: { name: "No such provider" },
          data: { isEnabled: false } as never,
          limit: LIMIT_MAX,
          skip: 0,
          props: ROOT,
        }),
      ).resolves.toBe(0);

      expect(lockCalls).toEqual([]);
    },
  );

  test.each(KINDS)(
    "%s: a write the check did not see is read before its time is written",
    async (_label: string, kind: ProviderKind) => {
      const updateBy: Record<string, unknown> = {
        query: { _id: kind.id.toString() },
        data: { isEnabled: false },
        limit: LIMIT_MAX,
        skip: 0,
        props: ROOT,
      };

      await ProjectSsoProviderChanges.beforeWrite({
        service: kind.service as never,
        updateBy: updateBy as never,
      });

      expect(
        (updateBy["data"] as Record<string, unknown>)["signInsEndedAt"],
      ).toBeInstanceOf(Date);

      const offAlready: Record<string, unknown> = {
        ...updateBy,
        query: { _id: kind.secondId.toString() },
        data: { isEnabled: false },
      };

      await ProjectSsoProviderChanges.beforeWrite({
        service: kind.service as never,
        updateBy: offAlready as never,
      });

      expect(
        (offAlready["data"] as Record<string, unknown>)["signInsEndedAt"],
      ).toBeUndefined();
    },
  );
});

describe("a write by filter reads under its locks, and writes only the rows it read there", () => {
  const LATER_ID: ObjectID = new ObjectID(
    "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
  );

  // The hooks' reads of the providers (watchProviderReads).
  const watchReads: (
    kind: ProviderKind,
    after?: Record<number, () => void>,
  ) => void = (
    kind: ProviderKind,
    after?: Record<number, () => void>,
  ): void => {
    watchProviderReads(kind, after);
  };

  test.each(KINDS)(
    "%s: a write whose filter names its project reads once to learn it, locks it, and reads its rows again under the lock",
    async (_label: string, kind: ProviderKind) => {
      watchReads(kind);

      await expect(
        kind.service.updateBy({
          query: { projectId: PROJECT_ID, isEnabled: true } as never,
          data: { isEnabled: false } as never,
          limit: LIMIT_MAX,
          skip: 0,
          props: ROOT,
        }),
      ).resolves.toBe(1);

      expect(events.slice(0, 3)).toEqual([
        "read",
        `lock:${PROJECT_ID.toString()}`,
        "read",
      ]);
      expect(rowOf(kind)!.isEnabled).toBe(false);
    },
  );

  test.each(KINDS)(
    "%s: a write whose filter reaches no provider - a clean-up of a project that has none - takes no lock, and writes nothing",
    async (_label: string, kind: ProviderKind) => {
      watchReads(kind);

      await expect(
        kind.service.updateBy({
          query: {
            projectId: OTHER_PROJECT_ID,
            name: "No such provider",
          } as never,
          data: { isEnabled: false } as never,
          limit: LIMIT_MAX,
          skip: 0,
          props: ROOT,
        }),
      ).resolves.toBe(0);

      expect(events).toEqual(["read"]);
      expect(lockCalls).toEqual([]);
      expect(kind.writes()).toEqual([]);
    },
  );

  test.each(KINDS)(
    "%s: a filter that names two projects locks the one it found providers in; a provider that comes to match it in the other between the reads is left alone, unlocked and unwritten",
    async (_label: string, kind: ProviderKind) => {
      const name: string = String(rowOf(kind)!["name"]);

      // While the write waits for its project's lock, the other project gets a provider of that name.
      whileWaitingForLock = (): void => {
        kind.rows().push(
          row({
            id: LATER_ID,
            projectId: OTHER_PROJECT_ID,
            columns: { name: name },
          }),
        );
      };

      watchReads(kind);

      await expect(
        kind.service.updateBy({
          query: {
            projectId: new Includes([PROJECT_ID, OTHER_PROJECT_ID]),
            name: name,
          } as never,
          data: { isEnabled: false } as never,
          limit: LIMIT_MAX,
          skip: 0,
          props: ROOT,
        }),
      ).resolves.toBe(1);

      expect(
        kind.writes().map((write: Write): string => {
          return write.id;
        }),
      ).toEqual([kind.id.toString()]);
      expect(rowOf(kind, LATER_ID)!.isEnabled).toBe(true);
      expect(events).toEqual([
        "read",
        `lock:${PROJECT_ID.toString()}`,
        "read",
        `write:${kind.id.toString()}`,
        `release:${PROJECT_ID.toString()}`,
      ]);
    },
  );

  test.each(KINDS)(
    "%s: a write whose filter matched no row when it was read writes none of the providers that come to match it afterwards",
    async (_label: string, kind: ProviderKind) => {
      project.requireSsoForLogin = true;

      // Once the write has read its rows, a provider that matches its filter is created, on.
      watchReads(kind, {
        1: (): void => {
          kind.rows().push(
            row({
              id: LATER_ID,
              columns: { name: "Created a moment later" },
            }),
          );
        },
      });

      await expect(
        kind.service.updateBy({
          query: { name: "Created a moment later" } as never,
          data: { isEnabled: false } as never,
          limit: LIMIT_MAX,
          skip: 0,
          props: ROOT,
        }),
      ).resolves.toBe(0);

      expect(rowOf(kind, LATER_ID)!.isEnabled).toBe(true);
      expect(kind.writes()).toEqual([]);
      expect(lockCalls).toEqual([]);
      expect(projectAnnouncements()).toEqual([]);
    },
  );

  test.each(KINDS)(
    "%s: a delete whose filter matched no row when it was read deletes none of the providers that come to match it afterwards",
    async (_label: string, kind: ProviderKind) => {
      watchReads(kind, {
        1: (): void => {
          kind.rows().push(
            row({
              id: LATER_ID,
              columns: { name: "Created a moment later" },
            }),
          );
        },
      });

      await expect(
        kind.service.deleteBy({
          query: { name: "Created a moment later" } as never,
          limit: LIMIT_MAX,
          skip: 0,
          props: ROOT,
        }),
      ).resolves.toBe(0);

      expect(rowOf(kind, LATER_ID)).toBeDefined();
      expect(deleted).toEqual([]);
    },
  );

  test.each(KINDS)(
    "%s: a provider renamed to match the filter after the rows were read under the lock is left on: the project keeps a way in",
    async (_label: string, kind: ProviderKind) => {
      project.requireSsoForLogin = true;
      // The project's only providers that are on: this one, and one of its kind named otherwise.
      rowOf(kind === SAML ? OIDC : SAML)!.isEnabled = false;
      rowOf(kind, kind.secondId)!.isEnabled = true;
      const name: string = String(rowOf(kind)!["name"]);

      // Read under the lock, the write turns this one off and keeps the other: then the other is renamed.
      watchReads(kind, {
        2: (): void => {
          rowOf(kind, kind.secondId)!["name"] = name;
        },
      });

      await expect(
        kind.service.updateBy({
          query: { name: name } as never,
          data: { isEnabled: false } as never,
          limit: LIMIT_MAX,
          skip: 0,
          props: ROOT,
        }),
      ).resolves.toBe(1);

      expect(rowOf(kind)!.isEnabled).toBe(false);
      expect(rowOf(kind, kind.secondId)!.isEnabled).toBe(true);
      expect(
        kind.writes().map((write: Write): string => {
          return write.id;
        }),
      ).toEqual([kind.id.toString()]);
    },
  );

  test.each(KINDS)(
    "%s: a provider that stops matching the filter after the rows were read is left alone too: the write keeps its own filter",
    async (_label: string, kind: ProviderKind) => {
      const name: string = String(rowOf(kind)!["name"]);

      watchReads(kind, {
        2: (): void => {
          rowOf(kind)!["name"] = `${name} (renamed)`;
        },
      });

      await expect(
        kind.service.updateBy({
          query: { name: name } as never,
          data: { isEnabled: false } as never,
          limit: LIMIT_MAX,
          skip: 0,
          props: ROOT,
        }),
      ).resolves.toBe(0);

      expect(rowOf(kind)!.isEnabled).toBe(true);
      expect(kind.writes()).toEqual([]);
    },
  );

  test.each(KINDS)(
    "%s: a write's window is the rows it read under the lock: a skip it was sent with does not move it onto rows it did not read",
    async (_label: string, kind: ProviderKind) => {
      kind
        .rows()
        .push(
          row({ id: LATER_ID, columns: { name: "Another of this project's" } }),
        );

      await expect(
        kind.service.updateBy({
          query: { projectId: PROJECT_ID } as never,
          data: { isEnabled: false } as never,
          limit: 1,
          skip: 1,
          props: ROOT,
        }),
      ).resolves.toBe(1);

      // The second of the project's rows, as the read under the lock found it.
      expect(
        kind.writes().map((write: Write): string => {
          return write.id;
        }),
      ).toEqual([kind.secondId.toString()]);
    },
  );

  test.each(KINDS)(
    "%s: a hard delete of a provider deleted before still removes it: read with the rest, it signs nobody in, so nothing is locked, checked or told",
    async (_label: string, kind: ProviderKind) => {
      rowOf(kind)!["deletedAt"] = new Date("2026-08-01T00:00:00.000Z");

      await expect(
        kind.service.hardDeleteBy({
          query: { _id: kind.id.toString() } as never,
          limit: 1,
          skip: 0,
          props: ROOT,
        }),
      ).resolves.toBe(1);

      expect(deleted).toEqual([kind.id.toString()]);
      expect(lockCalls).toEqual([]);
      expect(projectAnnouncements()).toEqual([]);
    },
  );

  test.each(KINDS)(
    "%s: a delete that is not a hard delete reaches no row deleted before",
    async (_label: string, kind: ProviderKind) => {
      rowOf(kind)!["deletedAt"] = new Date("2026-08-01T00:00:00.000Z");

      await expect(remove(kind)).resolves.toBe(0);

      expect(deleted).toEqual([]);
    },
  );

  const DELETED_BEFORE_ID: ObjectID = new ObjectID(
    "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
  );

  // A provider row deleted before, as the retention job's purge finds it.
  const deletedBefore: (
    kind: ProviderKind,
    data: { name: string; deletedAt: Date },
  ) => Row = (
    kind: ProviderKind,
    data: { name: string; deletedAt: Date },
  ): Row => {
    const deletedRow: Row = row({
      id: DELETED_BEFORE_ID,
      columns: { name: data.name, deletedAt: data.deletedAt },
    });

    kind.rows().push(deletedRow);

    return deletedRow;
  };

  const hardDeleteNamed: (
    kind: ProviderKind,
    name: string,
  ) => Promise<number> = (
    kind: ProviderKind,
    name: string,
  ): Promise<number> => {
    return kind.service.hardDeleteBy({
      query: { name: name } as never,
      limit: LIMIT_MAX,
      skip: 0,
      props: ROOT,
    });
  };

  test.each(KINDS)(
    "%s: a hard delete by a filter that read no provider that is there purges the rows deleted before that it read, and leaves one created a moment later",
    async (_label: string, kind: ProviderKind) => {
      deletedBefore(kind, {
        name: "Retired",
        deletedAt: OneUptimeDate.getSomeDaysAgo(40),
      });

      // Once the delete has read its rows - none that are there - a provider of that name is created, on.
      watchReads(kind, {
        1: (): void => {
          kind.rows().push(row({ id: LATER_ID, columns: { name: "Retired" } }));
        },
      });

      await expect(hardDeleteNamed(kind, "Retired")).resolves.toBe(1);

      expect(deleted).toEqual([DELETED_BEFORE_ID.toString()]);
      expect(rowOf(kind, LATER_ID)).toBeDefined();
      expect(rowOf(kind, LATER_ID)!.isEnabled).toBe(true);
      // It read no provider that is there: nothing to lock, check or tell.
      expect(lockCalls).toEqual([]);
      expect(projectAnnouncements()).toEqual([]);
    },
  );

  test.each(KINDS)(
    "%s: a hard delete whose rows are gone once read under the lock purges only rows deleted before, and none created since",
    async (_label: string, kind: ProviderKind) => {
      rowOf(kind, kind.secondId)!["name"] = "Spare";
      deletedBefore(kind, {
        name: "Spare",
        deletedAt: OneUptimeDate.getSomeDaysAgo(40),
      });

      watchReads(kind, {
        // Read to learn its project, it is renamed before the read under the lock.
        1: (): void => {
          rowOf(kind, kind.secondId)!["name"] = "Renamed";
        },
        // Read again, under the lock, it is gone: then a provider of that name is created.
        2: (): void => {
          kind.rows().push(row({ id: LATER_ID, columns: { name: "Spare" } }));
        },
      });

      await expect(hardDeleteNamed(kind, "Spare")).resolves.toBe(1);

      expect(deleted).toEqual([DELETED_BEFORE_ID.toString()]);
      expect(rowOf(kind, LATER_ID)).toBeDefined();
      expect(rowOf(kind, kind.secondId)).toBeDefined();
      // The project's lock was taken for the read under it, and given back at once.
      expect(events).toEqual([
        "read",
        `lock:${PROJECT_ID.toString()}`,
        "read",
        `release:${PROJECT_ID.toString()}`,
        `delete:${DELETED_BEFORE_ID.toString()}`,
      ]);
    },
  );

  test.each(KINDS)(
    "%s: the retention job's purge removes rows deleted more than a month ago, and never a provider that is there",
    async (_label: string, kind: ProviderKind) => {
      deletedBefore(kind, {
        name: "Deleted long ago",
        deletedAt: OneUptimeDate.getSomeDaysAgo(40),
      });
      kind.rows().push(
        row({
          id: LATER_ID,
          columns: {
            name: "Deleted last week",
            deletedAt: OneUptimeDate.getSomeDaysAgo(7),
          },
        }),
      );

      await expect(
        kind.service.hardDeleteBy({
          query: {
            deletedAt: QueryHelper.lessThan(OneUptimeDate.getSomeDaysAgo(30)),
          } as never,
          limit: LIMIT_MAX,
          skip: 0,
          props: ROOT,
        }),
      ).resolves.toBe(1);

      expect(deleted).toEqual([DELETED_BEFORE_ID.toString()]);
      expect(rowOf(kind, LATER_ID)).toBeDefined();
      expect(rowOf(kind)).toBeDefined();
      expect(rowOf(kind, kind.secondId)).toBeDefined();
      expect(lockCalls).toEqual([]);
      expect(projectAnnouncements()).toEqual([]);
    },
  );

  test.each(KINDS)(
    "%s: a hard delete that read providers under its lock deletes exactly those, and the rows deleted before that it read with them - not one that comes to match afterwards",
    async (_label: string, kind: ProviderKind) => {
      const name: string = String(rowOf(kind)!["name"]);
      deletedBefore(kind, {
        name: name,
        deletedAt: OneUptimeDate.getSomeDaysAgo(40),
      });

      // Read under the lock, the delete takes this provider: then another of that name is created.
      watchReads(kind, {
        2: (): void => {
          kind.rows().push(row({ id: LATER_ID, columns: { name: name } }));
        },
      });

      await expect(hardDeleteNamed(kind, name)).resolves.toBe(2);

      expect([...deleted].sort()).toEqual(
        [kind.id.toString(), DELETED_BEFORE_ID.toString()].sort(),
      );
      expect(rowOf(kind, LATER_ID)).toBeDefined();
      // Only the provider that was on is told of: the row deleted before signed nobody in.
      expect(projectAnnouncements()).toEqual([PROJECT_ID.toString()]);
      expect(
        lockCalls.map((call: LockCall): string => {
          return call.key;
        }),
      ).toEqual([PROJECT_ID.toString()]);
    },
  );

  test.each(KINDS)(
    "%s: a delete that is not a hard delete, by a filter that read no provider, deletes nothing - not even a row deleted before",
    async (_label: string, kind: ProviderKind) => {
      deletedBefore(kind, {
        name: "Retired",
        deletedAt: OneUptimeDate.getSomeDaysAgo(40),
      });

      await expect(
        kind.service.deleteBy({
          query: { name: "Retired" } as never,
          limit: LIMIT_MAX,
          skip: 0,
          props: ROOT,
        }),
      ).resolves.toBe(0);

      expect(deleted).toEqual([]);
      expect(lockCalls).toEqual([]);
    },
  );
});

describe("the locks of a change are kept for its write, until it is done", () => {
  // Every keep, in the order of the locks, the writes and the gives back.
  const recordKeeps: () => void = (): void => {
    getJestSpyOn(Semaphore, "keepLock").mockImplementation((async (mutex: {
      key: string;
    }): Promise<boolean> => {
      kept.push(mutex.key);
      events.push(`keep:${mutex.key}`);

      if (locksLostAtKeeps.includes(kept.length)) {
        return false;
      }

      return !(locksLostFromKeep !== null && kept.length >= locksLostFromKeep);
    }) as never);
  };

  const keptForWrite: () => Array<boolean> = (): Array<boolean> => {
    return Array.from(lockObjects.values()).map(
      (lock: { key: string }): boolean => {
        return ProjectSsoProviderChanges.isKeptForWrite(lock as never);
      },
    );
  };

  test.each(KINDS)(
    "%s: an update keeps its project's lock once its check is done, and once more right before the row is written",
    async (_label: string, kind: ProviderKind) => {
      recordKeeps();

      await expect(turnOff(kind)).resolves.toBe(1);

      expect(events).toEqual([
        `lock:${PROJECT_ID.toString()}`,
        `keep:${PROJECT_ID.toString()}`,
        `keep:${PROJECT_ID.toString()}`,
        `write:${kind.id.toString()}`,
        `release:${PROJECT_ID.toString()}`,
      ]);
    },
  );

  test.each(KINDS)(
    "%s: a delete keeps its project's lock as the last step before the row is deleted",
    async (_label: string, kind: ProviderKind) => {
      recordKeeps();

      await expect(remove(kind)).resolves.toBe(1);

      expect(events).toEqual([
        `lock:${PROJECT_ID.toString()}`,
        `keep:${PROJECT_ID.toString()}`,
        `delete:${kind.id.toString()}`,
        `release:${PROJECT_ID.toString()}`,
      ]);
    },
  );

  test.each(KINDS)(
    "%s: a project's last provider keeps both locks before the write, the server's rules last",
    async (_label: string, kind: ProviderKind) => {
      rowOf(kind === SAML ? OIDC : SAML)!.isEnabled = false;
      recordKeeps();

      await expect(turnOff(kind)).resolves.toBe(1);

      const write: number = events.indexOf(`write:${kind.id.toString()}`);

      expect(events.slice(write - 2, write)).toEqual([
        `keep:${PROJECT_ID.toString()}`,
        `keep:${SERVER_LOCK}`,
      ]);
    },
  );

  test.each(KINDS)(
    "%s: a lock lost after the check, by the time the update is written, is taken again and the row read and checked again under it: the update is written",
    async (_label: string, kind: ProviderKind) => {
      recordKeeps();
      // Kept once its check is done; gone right before the write, once.
      locksLostAtKeeps = [2];

      await expect(turnOff(kind)).resolves.toBe(1);

      expect(rowOf(kind)!.isEnabled).toBe(false);
      // Turned off in the same write that says when its sign-ins ended.
      expect(signInsEndedAtOf(kind)).not.toBeNull();
      expect(events).toEqual([
        `lock:${PROJECT_ID.toString()}`,
        `keep:${PROJECT_ID.toString()}`,
        // Gone right before the write: given back, taken again, checked again, kept.
        `keep:${PROJECT_ID.toString()}`,
        `release:${PROJECT_ID.toString()}`,
        `lock:${PROJECT_ID.toString()}`,
        `keep:${PROJECT_ID.toString()}`,
        `write:${kind.id.toString()}`,
        `release:${PROJECT_ID.toString()}`,
      ]);
      expect(projectAnnouncements()).toEqual([PROJECT_ID.toString()]);
      expect(keptForWrite()).toEqual([false]);
    },
  );

  test.each(KINDS)(
    "%s: a lock lost after the check, and lost again once taken again, refuses the update: nothing is written, nobody is told, and nothing is held",
    async (_label: string, kind: ProviderKind) => {
      // Kept once its check is done; gone right before the write, and gone again once taken again.
      locksLostFromKeep = 2;

      await expect(refusalOf(turnOff(kind))).resolves.toBe(
        SIGN_IN_CHANGE_IN_PROGRESS_MESSAGE,
      );

      expect(kind.writes()).toEqual([]);
      expect(rowOf(kind)!.isEnabled).toBe(true);
      expect(signInsEndedAtOf(kind)).toBeNull();
      expect(projectAnnouncements()).toEqual([]);
      expect(events).toEqual([
        `lock:${PROJECT_ID.toString()}`,
        `release:${PROJECT_ID.toString()}`,
        `lock:${PROJECT_ID.toString()}`,
        `release:${PROJECT_ID.toString()}`,
      ]);
      expect(keptForWrite()).toEqual([false]);
    },
  );

  test.each(KINDS)(
    "%s: the last provider's write, whose lock on the server's rules is lost before it, is checked again under both locks taken again, and refused when the project now has no other way in",
    async (_label: string, kind: ProviderKind) => {
      rowOf(kind === SAML ? OIDC : SAML)!.isEnabled = false;
      // Kept before the page of projects and once the check is done; gone right before the write, once.
      locksLostAtKeeps = [6];
      // Meanwhile, while the lock was gone, the project came to require SSO.
      const keeps: SpyInstance = getJestSpyOn(Semaphore, "keepLock");
      const keepLock: (...args: Array<unknown>) => Promise<boolean> =
        keeps.getMockImplementation() as unknown as (
          ...args: Array<unknown>
        ) => Promise<boolean>;

      keeps.mockImplementation((async (
        ...args: Array<unknown>
      ): Promise<boolean> => {
        const isKept: boolean = await keepLock(...args);

        if (!isKept) {
          project.requireSsoForLogin = true;
        }

        return isKept;
      }) as never);

      await expect(refusalOf(turnOff(kind))).resolves.toBe(
        LAST_SSO_PROVIDER_MESSAGE,
      );

      expect(kind.writes()).toEqual([]);
      expect(events).toEqual([
        `lock:${PROJECT_ID.toString()}`,
        `lock:${SERVER_LOCK}`,
        // Gone right before the write: both given back, taken again in order, and checked again.
        `release:${PROJECT_ID.toString()}`,
        `release:${SERVER_LOCK}`,
        `lock:${PROJECT_ID.toString()}`,
        `lock:${SERVER_LOCK}`,
        `release:${PROJECT_ID.toString()}`,
        `release:${SERVER_LOCK}`,
      ]);
      expect(keptForWrite()).toEqual([false, false]);
    },
  );

  test.each(KINDS)(
    "%s: a delete whose lock is lost once its check is done is taken again, the row read and checked again, and deleted",
    async (_label: string, kind: ProviderKind) => {
      locksLostAtKeeps = [1];

      await expect(remove(kind)).resolves.toBe(1);

      expect(deleted).toEqual([kind.id.toString()]);
      expect(events).toEqual([
        `lock:${PROJECT_ID.toString()}`,
        // Gone once the check is done: given back, taken again, and checked again.
        `release:${PROJECT_ID.toString()}`,
        `lock:${PROJECT_ID.toString()}`,
        `delete:${kind.id.toString()}`,
        `release:${PROJECT_ID.toString()}`,
      ]);
    },
  );

  test.each(KINDS)(
    "%s: a delete whose lock is lost once its check is done, and lost again once taken again, is refused before anything is deleted",
    async (_label: string, kind: ProviderKind) => {
      locksLostFromKeep = 1;

      await expect(refusalOf(remove(kind))).resolves.toBe(
        SIGN_IN_CHANGE_IN_PROGRESS_MESSAGE,
      );

      expect(deleted).toEqual([]);
      expect(rowOf(kind)).toBeDefined();
      expect(events).toEqual([
        `lock:${PROJECT_ID.toString()}`,
        `release:${PROJECT_ID.toString()}`,
        `lock:${PROJECT_ID.toString()}`,
        `release:${PROJECT_ID.toString()}`,
      ]);
    },
  );

  test.each(KINDS)(
    "%s: while the row is written its locks are kept alive, and once it is written they are kept no more",
    async (_label: string, kind: ProviderKind) => {
      rowOf(kind === SAML ? OIDC : SAML)!.isEnabled = false;

      let keptWhileWritten: Array<boolean> = [];
      whileWriting = (): void => {
        keptWhileWritten = keptForWrite();
      };

      await expect(turnOff(kind)).resolves.toBe(1);

      expect(keptWhileWritten).toEqual([true, true]);
      expect(keptForWrite()).toEqual([false, false]);
    },
  );

  test.each(KINDS)(
    "%s: a delete's locks are kept alive while the row is deleted, and no more once it is",
    async (_label: string, kind: ProviderKind) => {
      let keptWhileDeleted: Array<boolean> = [];
      whileWriting = (): void => {
        keptWhileDeleted = keptForWrite();
      };

      await expect(remove(kind)).resolves.toBe(1);

      expect(keptWhileDeleted).toEqual([true]);
      expect(keptForWrite()).toEqual([false]);
    },
  );

  test.each(KINDS)(
    "%s: a write the database fails gives its locks back, and they are kept no more",
    async (_label: string, kind: ProviderKind) => {
      writesFail = true;

      await expect(turnOff(kind)).rejects.toThrow(
        "The database could not write the row",
      );

      expect(lockObjects.size).toBe(1);
      expect(keptForWrite()).toEqual([false]);
      expect(events).toEqual([
        `lock:${PROJECT_ID.toString()}`,
        `release:${PROJECT_ID.toString()}`,
      ]);
    },
  );

  test.each(KINDS)(
    "%s: a change refused by its check keeps nothing alive",
    async (_label: string, kind: ProviderKind) => {
      project.requireSsoForLogin = true;
      rowOf(kind === SAML ? OIDC : SAML)!.isEnabled = false;

      await expect(refusalOf(turnOff(kind))).resolves.toBe(
        LAST_SSO_PROVIDER_MESSAGE,
      );

      expect(keptForWrite()).toEqual([false, false]);
    },
  );
});

describe("the check reads the providers that are on once per kind", () => {
  const enabledReads: (spy: SpyInstance) => Array<Record<string, unknown>> = (
    spy: SpyInstance,
  ): Array<Record<string, unknown>> => {
    return spy.mock.calls
      .map((call: Array<unknown>): Record<string, unknown> => {
        return call[0] as Record<string, unknown>;
      })
      .filter((args: Record<string, unknown>): boolean => {
        const query: Record<string, unknown> =
          (args["query"] as Record<string, unknown>) || {};
        return query["isEnabled"] === true;
      });
  };

  test.each(KINDS)(
    "%s: one read of each kind for the project, whatever it finds",
    async (_label: string, kind: ProviderKind) => {
      project.requireSsoForLogin = true;
      const other: ProviderKind = kind === SAML ? OIDC : SAML;
      rowOf(kind, kind.secondId)!.isEnabled = true;

      const ownReads: SpyInstance = getJestSpyOn(kind.service, "findBy");
      const otherReads: SpyInstance = getJestSpyOn(other.service, "findBy");

      await expect(refusalOf(turnOff(kind))).resolves.toBe("done");

      expect(enabledReads(ownReads)).toHaveLength(1);
      expect(enabledReads(otherReads)).toHaveLength(1);
    },
  );

  test.each(KINDS)(
    "%s: no more, when a global provider that signs people in to every project settles it",
    async (_label: string, kind: ProviderKind) => {
      project.requireSsoForLogin = true;
      const other: ProviderKind = kind === SAML ? OIDC : SAML;
      // Its last own provider: the check runs, and the global provider settles it.
      rowOf(other)!.isEnabled = false;
      globalSsoProviders = [
        {
          id: GLOBAL_SSO_ID,
          restrictToAttachedProjects: false,
          attachedTo: [],
        },
      ];

      const ownReads: SpyInstance = getJestSpyOn(kind.service, "findBy");
      const otherReads: SpyInstance = getJestSpyOn(other.service, "findBy");

      await expect(refusalOf(turnOff(kind))).resolves.toBe("done");

      // The one read that found the project left none of its own: the check adds none.
      expect(enabledReads(ownReads)).toHaveLength(1);
      expect(enabledReads(otherReads)).toHaveLength(1);
    },
  );
});

describe("the API's check agrees with the provider, on the same rows", () => {
  const buildUser: () => User = (): User => {
    const user: User = new User();
    user.id = USER_ID;
    user.name = new Name("Project SSO User");
    user.email = new Email("project-sso@oneuptime.com");
    return user;
  };

  const signIn: (kind: ProviderKind) => string = (
    kind: ProviderKind,
  ): string => {
    return CookieUtil.getSSOToken({
      user: buildUser(),
      projectId: PROJECT_ID,
      ssoProviderId: kind.id,
      ssoProviderType: kind.type,
    });
  };

  const isSatisfied: (token: string) => Promise<boolean> = (
    token: string,
  ): Promise<boolean> => {
    return UserMiddleware.isSsoSatisfiedForProject({
      req: {
        cookies: { [CookieUtil.getUserSSOKey(PROJECT_ID)]: token },
        headers: {},
      } as unknown as ExpressRequest,
      projectId: PROJECT_ID,
      userId: USER_ID,
    });
  };

  test.each(KINDS)(
    "%s: a new certificate or secret keeps the sign-in; turning the provider off ends it; turning it on again does not bring it back",
    async (_label: string, kind: ProviderKind) => {
      const token: string = signIn(kind);

      await expect(isSatisfied(token)).resolves.toBe(true);

      await kind.service.updateOneById({
        id: kind.id,
        data: { ...kind.credential } as never,
        props: ROOT,
      });

      await expect(isSatisfied(token)).resolves.toBe(true);

      await turnOff(kind);

      await expect(isSatisfied(token)).resolves.toBe(false);

      await turnOn(kind);

      await expect(isSatisfied(token)).resolves.toBe(false);

      // Signing in again, after it was turned on, counts.
      const realNow: number = Date.now();
      const now: SpyInstance = getJestSpyOn(Date, "now").mockReturnValue(
        realNow + 2000,
      );
      const again: string = signIn(kind);
      now.mockRestore();

      await expect(isSatisfied(again)).resolves.toBe(true);
    },
  );

  test.each(KINDS)(
    "%s: deleting the provider ends the sign-in",
    async (_label: string, kind: ProviderKind) => {
      const token: string = signIn(kind);

      await expect(isSatisfied(token)).resolves.toBe(true);

      await remove(kind);

      await expect(isSatisfied(token)).resolves.toBe(false);
    },
  );
});
