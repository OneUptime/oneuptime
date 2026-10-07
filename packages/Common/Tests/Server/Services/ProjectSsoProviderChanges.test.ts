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
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import Email from "../../../Types/Email";
import BadDataException from "../../../Types/Exception/BadDataException";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import SsoProviderType from "../../../Types/SSO/SsoProviderType";
import { getJestSpyOn } from "../../Spy";
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
 *     in memory here), given back once the write is done or refused;
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

const matches: (row: Row, where: Record<string, unknown>) => boolean = (
  row: Row,
  where: Record<string, unknown>,
): boolean => {
  for (const [column, value] of Object.entries(where || {})) {
    const asked: Array<string> | null = askedValues(value);

    if (asked === null) {
      continue;
    }

    const held: unknown = row[column];

    if (
      held === undefined ||
      held === null ||
      !asked.includes(String(held).toLowerCase())
    ) {
      return false;
    }
  }

  return true;
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
    }): Promise<Array<BaseModel>> => {
      const found: Array<Row> = rows().filter((row: Row): boolean => {
        return matches(row, options.where);
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
    return { key: data.key };
  }) as never);
  getJestSpyOn(Semaphore, "release").mockImplementation((async (mutex: {
    key: string;
  }): Promise<void> => {
    if (releasesFail) {
      throw new Error("The lock could not be given back");
    }

    events.push(`release:${mutex.key}`);
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

  getJestSpyOn(ProjectService, "findOneById").mockImplementation((async (data: {
    id: ObjectID;
  }): Promise<Project> => {
    const found: Project = new Project();
    found.id = data.id;
    found.requireSsoForLogin = project.requireSsoForLogin;

    if (project.requireSsoWithSsoProviderId) {
      found.requireSsoWithSsoProviderId = project.requireSsoWithSsoProviderId;
    }

    return found;
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
  test.each(KINDS)(
    "%s: turning a provider off locks its project, then the server's sign-in rules, before the check, and gives both back once written, waiting longer than a lock is held",
    async (_label: string, kind: ProviderKind) => {
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
    "%s: deleting one that is on holds them the same way",
    async (_label: string, kind: ProviderKind) => {
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
    "%s: while another change to who can sign in holds the server's rules too long, the write is refused and the project's lock given back",
    async (_label: string, kind: ProviderKind) => {
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

      // A write that may take a provider away locks the server's rules too, before it reads the rows.
      expect(
        lockCalls.map((call: LockCall): string => {
          return call.key;
        }),
      ).toEqual([
        PROJECT_ID.toString(),
        SERVER_LOCK,
        PROJECT_ID.toString(),
        PROJECT_ID.toString(),
        SERVER_LOCK,
      ]);
      expect(
        events.filter((event: string): boolean => {
          return event.startsWith("release:");
        }),
      ).toHaveLength(5);
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
      // Each write asked for its project's lock and the server's.
      expect(lockCalls).toHaveLength(4);
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

describe("the rows a write names are read under the lock", () => {
  test.each(KINDS)(
    "%s: turning a provider off reads its rows to learn the project, locks it, and reads them again before the check",
    async (_label: string, kind: ProviderKind) => {
      const service: {
        findAllBy: (...args: Array<unknown>) => Promise<unknown>;
      } = kind.service as unknown as {
        findAllBy: (...args: Array<unknown>) => Promise<unknown>;
      };
      const findAllBy: (...args: Array<unknown>) => Promise<unknown> =
        service.findAllBy.bind(kind.service);

      getJestSpyOn(kind.service, "findAllBy").mockImplementation(((
        ...args: Array<unknown>
      ): Promise<unknown> => {
        const select: Record<string, unknown> =
          (args[0] as { select?: Record<string, unknown> }).select || {};

        if (select["projectId"] && select["isEnabled"]) {
          events.push("read");
        }

        return findAllBy(...args);
      }) as never);

      await expect(turnOff(kind)).resolves.toBe(1);

      expect(events).toEqual([
        "read",
        `lock:${PROJECT_ID.toString()}`,
        `lock:${SERVER_LOCK}`,
        "read",
        `write:${kind.id.toString()}`,
        `release:${PROJECT_ID.toString()}`,
        `release:${SERVER_LOCK}`,
      ]);
      expect(wroteSignInsEndedAt(kind)).toBe(true);
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
    "%s: none, when a global provider that signs people in to every project settles it",
    async (_label: string, kind: ProviderKind) => {
      project.requireSsoForLogin = true;
      const other: ProviderKind = kind === SAML ? OIDC : SAML;
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

      expect(enabledReads(ownReads)).toHaveLength(0);
      expect(enabledReads(otherReads)).toHaveLength(0);
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
