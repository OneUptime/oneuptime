import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import GlobalOidc from "../../../Models/DatabaseModels/GlobalOidc";
import GlobalOidcProject from "../../../Models/DatabaseModels/GlobalOidcProject";
import GlobalSso from "../../../Models/DatabaseModels/GlobalSso";
import GlobalSsoProject from "../../../Models/DatabaseModels/GlobalSsoProject";
import Project from "../../../Models/DatabaseModels/Project";
import ProjectOidc from "../../../Models/DatabaseModels/ProjectOidc";
import ProjectSso from "../../../Models/DatabaseModels/ProjectSso";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import GlobalOidcProjectService from "../../../Server/Services/GlobalOidcProjectService";
import GlobalOidcService from "../../../Server/Services/GlobalOidcService";
import GlobalSsoProjectService from "../../../Server/Services/GlobalSsoProjectService";
import GlobalSsoService from "../../../Server/Services/GlobalSsoService";
import ProjectOidcService from "../../../Server/Services/ProjectOidcService";
import ProjectService from "../../../Server/Services/ProjectService";
import ProjectSsoService from "../../../Server/Services/ProjectSsoService";
import SsoSignInWays, {
  GlobalProviderReachChange,
  REACHES_EVERY_PROJECT,
  REACHES_NO_PROJECT,
  STRANDED_PROJECTS_NAMED,
  SignInReach,
  StrandReason,
  StrandedProjectList,
  StrandedProjects,
  decideStrandReason,
  describeStrandedProjects,
  getGlobalProviderReach,
  getLostReach,
  noStrandedProjects,
  wayKey,
} from "../../../Server/Utils/SsoSignInWays";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
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
 * WHO CAN STILL SIGN IN TO A PROJECT THAT REQUIRES SSO, ONCE A CHANGE LANDS
 * (Server/Utils/SsoSignInWays).
 *
 * The one check every change to who can sign in asks - a project's own
 * provider turned off or deleted, a global provider turned off, deleted or
 * restricted, an attachment added, turned off, moved or removed, Require SSO
 * for Login turned on for a project or the server. It answers with the
 * projects the change would leave with no provider to sign in with, and
 * why; and, for a change to projects alone, whether the answer can depend
 * on the server's sign-in rules at all (dependsOnServerRules). Here over
 * projects and providers held in memory: every database read the check
 * makes goes through the services stubbed below.
 */

const id: (n: number) => string = (n: number): string => {
  return `00000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
};

const ACME: string = id(1);
const BETA: string = id(2);
const GAMMA: string = id(3);
const DELTA: string = id(4);

const GLOBAL_SAML: string = id(101);
const OTHER_GLOBAL_SAML: string = id(102);
const GLOBAL_OIDC: string = id(103);
const ACME_SAML: string = id(201);
const BETA_OIDC: string = id(202);

interface ProjectRow {
  id: string;
  name: string;
  requireSsoForLogin: boolean;
  requiredProviderId: string | null;
}

interface OwnProviderRow {
  id: string;
  projectId: string;
  isEnabled: boolean;
}

interface GlobalProviderRow {
  id: string;
  isEnabled: boolean;
  restrictToAttachedProjects: boolean;
}

interface AttachmentRow {
  id: string;
  providerId: string;
  projectId: string | null;
  isEnabled: boolean;
}

let projects: Array<ProjectRow> = [];
let ownSaml: Array<OwnProviderRow> = [];
let ownOidc: Array<OwnProviderRow> = [];
let globalSaml: Array<GlobalProviderRow> = [];
let globalOidc: Array<GlobalProviderRow> = [];
let samlAttachments: Array<AttachmentRow> = [];
let oidcAttachments: Array<AttachmentRow> = [];
let serverRequiresSso: boolean = false;

let projectPageReads: SpyInstance;
let ownSamlReads: SpyInstance;
let serverRuleReads: SpyInstance;

const project: (
  projectId: string,
  name: string,
  rule: { requireSsoForLogin: boolean; requiredProviderId?: string | null },
) => ProjectRow = (
  projectId: string,
  name: string,
  rule: { requireSsoForLogin: boolean; requiredProviderId?: string | null },
): ProjectRow => {
  return {
    id: projectId,
    name,
    requireSsoForLogin: rule.requireSsoForLogin,
    requiredProviderId: rule.requiredProviderId || null,
  };
};

// The values a query asks a column for: a plain value or QueryHelper.any's parameters.
const askedValues: (value: unknown) => Array<string> | null = (
  value: unknown,
): Array<string> | null => {
  if (value === undefined) {
    return null;
  }

  if (
    typeof value === "string" ||
    typeof value === "boolean" ||
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

// The value a query asks a column to be above (QueryHelper.greaterThan), or null.
const askedAfter: (value: unknown) => string | null = (
  value: unknown,
): string | null => {
  const operator: {
    _type?: unknown;
    _getSql?: unknown;
    _objectLiteralParameters?: Record<string, unknown>;
  } = (value || {}) as {
    _type?: unknown;
    _getSql?: unknown;
    _objectLiteralParameters?: Record<string, unknown>;
  };

  if (operator._type !== "raw" || typeof operator._getSql !== "function") {
    return null;
  }

  const sql: string = (operator._getSql as (alias: string) => string)("column");

  if (!sql.startsWith("(column >")) {
    return null;
  }

  return String(
    Object.values(operator._objectLiteralParameters || {})[0],
  ).toLowerCase();
};

const asks: (
  query: Record<string, unknown>,
  column: string,
  held: unknown,
) => boolean = (
  query: Record<string, unknown>,
  column: string,
  held: unknown,
): boolean => {
  const after: string | null = askedAfter(query[column]);

  if (after !== null) {
    return (
      held !== null && held !== undefined && String(held).toLowerCase() > after
    );
  }

  const asked: Array<string> | null = askedValues(query[column]);

  return (
    asked === null ||
    (held !== null &&
      held !== undefined &&
      asked.includes(String(held).toLowerCase()))
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

beforeEach(() => {
  projects = [];
  ownSaml = [];
  ownOidc = [];
  globalSaml = [];
  globalOidc = [];
  samlAttachments = [];
  oidcAttachments = [];
  serverRequiresSso = false;

  getJestSpyOn(ProjectService, "findOneById").mockImplementation((async (data: {
    id: ObjectID;
  }): Promise<Project | null> => {
    const found: ProjectRow | undefined = projects.find(
      (row: ProjectRow): boolean => {
        return row.id === data.id.toString().toLowerCase();
      },
    );

    return found ? toProject(found) : null;
  }) as never);

  projectPageReads = getJestSpyOn(ProjectService, "findBy").mockImplementation(
    (async (data: {
      query: Record<string, unknown>;
      skip: number;
      limit: number;
    }): Promise<Array<Project>> => {
      return projects
        .filter((row: ProjectRow): boolean => {
          return (
            asks(data.query, "_id", row.id) &&
            asks(data.query, "requireSsoForLogin", row.requireSsoForLogin)
          );
        })
        .sort((a: ProjectRow, b: ProjectRow): number => {
          return a.id.localeCompare(b.id);
        })
        .slice(data.skip, data.skip + data.limit)
        .map(toProject);
    }) as never,
  );

  const ownReads: (
    rows: () => Array<OwnProviderRow>,
    createModel: () => ProjectSso | ProjectOidc,
  ) => (data: { query: Record<string, unknown> }) => Promise<Array<unknown>> = (
    rows: () => Array<OwnProviderRow>,
    createModel: () => ProjectSso | ProjectOidc,
  ): ((data: {
    query: Record<string, unknown>;
  }) => Promise<Array<unknown>>) => {
    return async (data: {
      query: Record<string, unknown>;
    }): Promise<Array<unknown>> => {
      return rows()
        .filter((row: OwnProviderRow): boolean => {
          return (
            asks(data.query, "projectId", row.projectId) &&
            asks(data.query, "isEnabled", row.isEnabled)
          );
        })
        .map((row: OwnProviderRow): unknown => {
          const model: ProjectSso | ProjectOidc = createModel();
          model.id = new ObjectID(row.id);
          model.projectId = new ObjectID(row.projectId);
          model.isEnabled = row.isEnabled;
          return model;
        });
    };
  };

  ownSamlReads = getJestSpyOn(
    ProjectSsoService,
    "findAllBy",
  ).mockImplementation(
    ownReads(
      (): Array<OwnProviderRow> => {
        return ownSaml;
      },
      (): ProjectSso => {
        return new ProjectSso();
      },
    ) as never,
  );
  getJestSpyOn(ProjectOidcService, "findAllBy").mockImplementation(
    ownReads(
      (): Array<OwnProviderRow> => {
        return ownOidc;
      },
      (): ProjectOidc => {
        return new ProjectOidc();
      },
    ) as never,
  );

  const globalReads: (
    rows: () => Array<GlobalProviderRow>,
    createModel: () => GlobalSso | GlobalOidc,
  ) => (data: { query: Record<string, unknown> }) => Promise<Array<unknown>> = (
    rows: () => Array<GlobalProviderRow>,
    createModel: () => GlobalSso | GlobalOidc,
  ): ((data: {
    query: Record<string, unknown>;
  }) => Promise<Array<unknown>>) => {
    return async (data: {
      query: Record<string, unknown>;
    }): Promise<Array<unknown>> => {
      return rows()
        .filter((row: GlobalProviderRow): boolean => {
          return asks(data.query, "isEnabled", row.isEnabled);
        })
        .map((row: GlobalProviderRow): unknown => {
          const model: GlobalSso | GlobalOidc = createModel();
          model.id = new ObjectID(row.id);
          model.isEnabled = row.isEnabled;
          model.restrictToAttachedProjects = row.restrictToAttachedProjects;
          return model;
        });
    };
  };

  getJestSpyOn(GlobalSsoService, "findBy").mockImplementation(
    globalReads(
      (): Array<GlobalProviderRow> => {
        return globalSaml;
      },
      (): GlobalSso => {
        return new GlobalSso();
      },
    ) as never,
  );
  getJestSpyOn(GlobalOidcService, "findBy").mockImplementation(
    globalReads(
      (): Array<GlobalProviderRow> => {
        return globalOidc;
      },
      (): GlobalOidc => {
        return new GlobalOidc();
      },
    ) as never,
  );

  const attachmentReads: (
    rows: () => Array<AttachmentRow>,
    providerColumn: "globalSsoId" | "globalOidcId",
    createModel: () => GlobalSsoProject | GlobalOidcProject,
  ) => (data: { query: Record<string, unknown> }) => Promise<Array<unknown>> = (
    rows: () => Array<AttachmentRow>,
    providerColumn: "globalSsoId" | "globalOidcId",
    createModel: () => GlobalSsoProject | GlobalOidcProject,
  ): ((data: {
    query: Record<string, unknown>;
  }) => Promise<Array<unknown>>) => {
    return async (data: {
      query: Record<string, unknown>;
    }): Promise<Array<unknown>> => {
      return rows()
        .filter((row: AttachmentRow): boolean => {
          return asks(data.query, providerColumn, row.providerId);
        })
        .map((row: AttachmentRow): unknown => {
          const model: GlobalSsoProject | GlobalOidcProject = createModel();
          Object.assign(model, {
            _id: row.id,
            [providerColumn]: new ObjectID(row.providerId),
            projectId: row.projectId ? new ObjectID(row.projectId) : null,
            isEnabled: row.isEnabled,
          });
          return model;
        });
    };
  };

  getJestSpyOn(GlobalSsoProjectService, "findAllBy").mockImplementation(
    attachmentReads(
      (): Array<AttachmentRow> => {
        return samlAttachments;
      },
      "globalSsoId",
      (): GlobalSsoProject => {
        return new GlobalSsoProject();
      },
    ) as never,
  );
  getJestSpyOn(GlobalOidcProjectService, "findAllBy").mockImplementation(
    attachmentReads(
      (): Array<AttachmentRow> => {
        return oidcAttachments;
      },
      "globalOidcId",
      (): GlobalOidcProject => {
        return new GlobalOidcProject();
      },
    ) as never,
  );

  // Whether a provider has any attachment: the first one the query matches.
  const firstAttachment: (
    reads: (data: {
      query: Record<string, unknown>;
    }) => Promise<Array<unknown>>,
  ) => (data: { query: Record<string, unknown> }) => Promise<unknown> = (
    reads: (data: {
      query: Record<string, unknown>;
    }) => Promise<Array<unknown>>,
  ): ((data: { query: Record<string, unknown> }) => Promise<unknown>) => {
    return async (data: {
      query: Record<string, unknown>;
    }): Promise<unknown> => {
      return (await reads(data))[0] || null;
    };
  };

  getJestSpyOn(GlobalSsoProjectService, "findOneBy").mockImplementation(
    firstAttachment(
      attachmentReads(
        (): Array<AttachmentRow> => {
          return samlAttachments;
        },
        "globalSsoId",
        (): GlobalSsoProject => {
          return new GlobalSsoProject();
        },
      ),
    ) as never,
  );
  getJestSpyOn(GlobalOidcProjectService, "findOneBy").mockImplementation(
    firstAttachment(
      attachmentReads(
        (): Array<AttachmentRow> => {
          return oidcAttachments;
        },
        "globalOidcId",
        (): GlobalOidcProject => {
          return new GlobalOidcProject();
        },
      ),
    ) as never,
  );

  serverRuleReads = getJestSpyOn(
    GlobalConfigService,
    "findOneBy",
  ).mockImplementation((async (): Promise<GlobalConfig> => {
    const config: GlobalConfig = new GlobalConfig();
    config.requireSsoForLogin = serverRequiresSso;
    return config;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const turnedOff: (
  providerType: SsoProviderType.GlobalSSO | SsoProviderType.GlobalOIDC,
  providerId: string,
  before?: SignInReach,
) => GlobalProviderReachChange = (
  providerType: SsoProviderType.GlobalSSO | SsoProviderType.GlobalOIDC,
  providerId: string,
  before?: SignInReach,
): GlobalProviderReachChange => {
  return {
    providerType,
    providerId,
    before: before || REACHES_EVERY_PROJECT,
    after: REACHES_NO_PROJECT,
  };
};

const reachOf: (...projectIds: Array<string>) => SignInReach = (
  ...projectIds: Array<string>
): SignInReach => {
  return { everyProject: false, projectIds: new Set<string>(projectIds) };
};

const namesOf: (stranded: StrandedProjects) => Array<string> = (
  stranded: StrandedProjects,
): Array<string> => {
  return stranded.firstProjects.map(
    (strandedProject: { name: string }): string => {
      return strandedProject.name;
    },
  );
};

describe("where a global provider signs people in", () => {
  test("nowhere while it is off, whatever its attachments", () => {
    expect(
      getGlobalProviderReach({
        isEnabled: false,
        restrictToAttachedProjects: false,
        attachments: [],
      }),
    ).toEqual(REACHES_NO_PROJECT);
    expect(
      getGlobalProviderReach({
        isEnabled: false,
        restrictToAttachedProjects: true,
        attachments: [{ projectId: ACME, isEnabled: true }],
      }),
    ).toEqual(REACHES_NO_PROJECT);
  });

  test("every project when it is not restricted to its attached projects, attachments or not", () => {
    expect(
      getGlobalProviderReach({
        isEnabled: true,
        restrictToAttachedProjects: false,
        attachments: [{ projectId: ACME, isEnabled: true }],
      }),
    ).toEqual(REACHES_EVERY_PROJECT);
  });

  test("every project when it is restricted but has no attachment yet", () => {
    expect(
      getGlobalProviderReach({
        isEnabled: true,
        restrictToAttachedProjects: true,
        attachments: [],
      }),
    ).toEqual(REACHES_EVERY_PROJECT);
  });

  test("restricted with attachments: only the attached projects whose attachment is on", () => {
    expect(
      getGlobalProviderReach({
        isEnabled: true,
        restrictToAttachedProjects: true,
        attachments: [
          { projectId: ACME, isEnabled: true },
          { projectId: BETA, isEnabled: false },
          { projectId: null, isEnabled: true },
        ],
      }),
    ).toEqual(reachOf(ACME));
  });

  test("restricted with every attachment off: nowhere, not every project", () => {
    expect(
      getGlobalProviderReach({
        isEnabled: true,
        restrictToAttachedProjects: true,
        attachments: [{ projectId: ACME, isEnabled: false }],
      }),
    ).toEqual(reachOf());
  });
});

describe("the projects a provider stops reaching", () => {
  test("none when it still reaches every project, or reaches no fewer", () => {
    expect(getLostReach(REACHES_EVERY_PROJECT, REACHES_EVERY_PROJECT)).toEqual({
      kind: "none",
    });
    expect(getLostReach(reachOf(ACME), REACHES_EVERY_PROJECT)).toEqual({
      kind: "none",
    });
    expect(getLostReach(reachOf(ACME), reachOf(ACME, BETA))).toEqual({
      kind: "none",
    });
  });

  test("every project but the ones it keeps, when it reached every project", () => {
    expect(getLostReach(REACHES_EVERY_PROJECT, reachOf(ACME))).toEqual({
      kind: "allExcept",
      projectIds: new Set<string>([ACME]),
    });
    expect(getLostReach(REACHES_EVERY_PROJECT, REACHES_NO_PROJECT)).toEqual({
      kind: "allExcept",
      projectIds: new Set<string>(),
    });
  });

  test("the ones it leaves behind, when it reached some", () => {
    expect(getLostReach(reachOf(ACME, BETA), reachOf(ACME, GAMMA))).toEqual({
      kind: "only",
      projectIds: new Set<string>([BETA]),
    });
    expect(getLostReach(reachOf(ACME), REACHES_NO_PROJECT)).toEqual({
      kind: "only",
      projectIds: new Set<string>([ACME]),
    });
  });
});

describe("what a project's own rule decides", () => {
  const ACME_SAML_WAY: string = wayKey(SsoProviderType.ProjectSSO, ACME_SAML);
  const GLOBAL_WAY: string = wayKey(SsoProviderType.GlobalSSO, GLOBAL_SAML);

  test("a project that requires no SSO, on a server that requires none, is never stranded", () => {
    expect(
      decideStrandReason({
        rule: { requireSsoForLogin: false, requiredProviderId: null },
        serverRequiresSso: false,
        isTightened: false,
        takenAway: new Set<string>([GLOBAL_WAY]),
        waysAfter: (): Set<string> => {
          return new Set<string>();
        },
      }),
    ).toBeNull();
  });

  test("one that loses its last way in is stranded; one that keeps another is not", () => {
    const decide: (waysAfter: Set<string>) => StrandReason | null = (
      waysAfter: Set<string>,
    ): StrandReason | null => {
      return decideStrandReason({
        rule: { requireSsoForLogin: true, requiredProviderId: null },
        serverRequiresSso: false,
        isTightened: false,
        takenAway: new Set<string>([GLOBAL_WAY]),
        waysAfter: (): Set<string> => {
          return waysAfter;
        },
      });
    };

    expect(decide(new Set<string>())).toBe(StrandReason.NoProvider);
    expect(decide(new Set<string>([ACME_SAML_WAY]))).toBeNull();
  });

  test("the server's rule counts as the project's own", () => {
    expect(
      decideStrandReason({
        rule: { requireSsoForLogin: false, requiredProviderId: null },
        serverRequiresSso: true,
        isTightened: false,
        takenAway: new Set<string>([GLOBAL_WAY]),
        waysAfter: (): Set<string> => {
          return new Set<string>();
        },
      }),
    ).toBe(StrandReason.NoProvider);
  });

  test("one that requires a provider by id is stranded only when the change takes that very one away", () => {
    const decide: (takenAway: string) => StrandReason | null = (
      takenAway: string,
    ): StrandReason | null => {
      return decideStrandReason({
        rule: { requireSsoForLogin: true, requiredProviderId: GLOBAL_SAML },
        serverRequiresSso: false,
        isTightened: false,
        takenAway: new Set<string>([takenAway]),
        waysAfter: (): Set<string> => {
          return new Set<string>([ACME_SAML_WAY]);
        },
      });
    };

    expect(decide(GLOBAL_WAY)).toBe(StrandReason.RequiredProvider);
    expect(decide(ACME_SAML_WAY)).toBeNull();
  });

  test("a rule made stricter needs its required provider among the ways in once it lands", () => {
    const decide: (waysAfter: Set<string>) => StrandReason | null = (
      waysAfter: Set<string>,
    ): StrandReason | null => {
      return decideStrandReason({
        rule: { requireSsoForLogin: true, requiredProviderId: ACME_SAML },
        serverRequiresSso: false,
        isTightened: true,
        takenAway: new Set<string>(),
        waysAfter: (): Set<string> => {
          return waysAfter;
        },
      });
    };

    expect(decide(new Set<string>([GLOBAL_WAY]))).toBe(
      StrandReason.RequiredProvider,
    );
    expect(decide(new Set<string>([ACME_SAML_WAY]))).toBeNull();
  });

  test("a change that neither takes anything away nor asks for more decides nothing", () => {
    expect(
      decideStrandReason({
        rule: { requireSsoForLogin: true, requiredProviderId: null },
        serverRequiresSso: true,
        isTightened: false,
        takenAway: new Set<string>(),
        waysAfter: (): Set<string> => {
          throw new Error("No ways in are read for a change that changes none");
        },
      }),
    ).toBeNull();
  });
});

describe("how a refusal names the projects", () => {
  const strandedOf: (
    count: number,
    names: Array<string>,
  ) => StrandedProjectList = (
    count: number,
    names: Array<string>,
  ): StrandedProjectList => {
    return {
      count,
      firstProjects: names.map(
        (
          name: string,
          index: number,
        ): StrandedProjectList["firstProjects"][number] => {
          return {
            projectId: id(index + 1),
            name,
            reason: StrandReason.NoProvider,
            requiresSsoItself: true,
          };
        },
      ),
    };
  };

  test("one by name, a few by name, and many by count", () => {
    expect(describeStrandedProjects(strandedOf(1, ["Acme"]))).toBe(
      'the project "Acme"',
    );
    expect(describeStrandedProjects(strandedOf(2, ["Acme", "Beta"]))).toBe(
      'the projects "Acme" and "Beta"',
    );
    expect(
      describeStrandedProjects(strandedOf(3, ["Acme", "Beta", "Gamma"])),
    ).toBe('the projects "Acme", "Beta" and "Gamma"');
    expect(
      describeStrandedProjects(strandedOf(12, ["Acme", "Beta", "Gamma"])),
    ).toBe('12 projects ("Acme", "Beta", "Gamma" and 9 more)');
  });
});

describe("the projects a change would leave with no way in", () => {
  test("a change that takes nothing away and asks for nothing reads nothing", async () => {
    await expect(
      SsoSignInWays.findStrandedProjects({
        globalProviders: [
          {
            providerType: SsoProviderType.GlobalSSO,
            providerId: GLOBAL_SAML,
            before: REACHES_NO_PROJECT,
            after: REACHES_EVERY_PROJECT,
          },
        ],
      }),
    ).resolves.toEqual(noStrandedProjects());

    expect(projectPageReads).not.toHaveBeenCalled();
    expect(serverRuleReads).not.toHaveBeenCalled();
  });

  describe("a global provider that signs people in to every project, turned off", () => {
    beforeEach(() => {
      projects = [
        project(ACME, "Acme", { requireSsoForLogin: true }),
        project(BETA, "Beta", { requireSsoForLogin: true }),
        project(GAMMA, "Gamma", { requireSsoForLogin: false }),
      ];
      ownSaml = [{ id: ACME_SAML, projectId: ACME, isEnabled: true }];
      globalSaml = [
        {
          id: GLOBAL_SAML,
          isEnabled: true,
          restrictToAttachedProjects: false,
        },
      ];
    });

    test("strands the projects that require SSO and have no other provider; one with its own provider keeps it", async () => {
      const stranded: StrandedProjects =
        await SsoSignInWays.findStrandedProjects({
          globalProviders: [turnedOff(SsoProviderType.GlobalSSO, GLOBAL_SAML)],
        });

      expect(stranded.count).toBe(1);
      expect(stranded.firstProjects).toEqual([
        {
          projectId: BETA,
          name: "Beta",
          reason: StrandReason.NoProvider,
          requiresSsoItself: true,
        },
      ]);

      // Only the projects that require SSO themselves were read.
      expect(
        (projectPageReads.mock.calls[0]![0] as { query: unknown }).query,
      ).toEqual({ requireSsoForLogin: true });
    });

    test("a project's own provider that is off does not count", async () => {
      ownSaml[0]!.isEnabled = false;

      const stranded: StrandedProjects =
        await SsoSignInWays.findStrandedProjects({
          globalProviders: [turnedOff(SsoProviderType.GlobalSSO, GLOBAL_SAML)],
        });

      expect(namesOf(stranded)).toEqual(["Acme", "Beta"]);
      expect(stranded.count).toBe(2);
    });

    test("when the whole server requires SSO, every project counts, and the refusal says so", async () => {
      serverRequiresSso = true;

      const stranded: StrandedProjects =
        await SsoSignInWays.findStrandedProjects({
          globalProviders: [turnedOff(SsoProviderType.GlobalSSO, GLOBAL_SAML)],
        });

      expect(namesOf(stranded)).toEqual(["Beta", "Gamma"]);
      expect(
        stranded.firstProjects.map(
          (strandedProject: { requiresSsoItself: boolean }): boolean => {
            return strandedProject.requiresSsoItself;
          },
        ),
      ).toEqual([true, false]);
      expect(
        (projectPageReads.mock.calls[0]![0] as { query: unknown }).query,
      ).toEqual({});
    });

    test("another global provider that signs people in to every project keeps them all, without reading their own providers", async () => {
      globalOidc = [
        {
          id: GLOBAL_OIDC,
          isEnabled: true,
          restrictToAttachedProjects: false,
        },
      ];

      await expect(
        SsoSignInWays.findStrandedProjects({
          globalProviders: [turnedOff(SsoProviderType.GlobalSSO, GLOBAL_SAML)],
        }),
      ).resolves.toEqual(noStrandedProjects());

      expect(ownSamlReads).not.toHaveBeenCalled();
    });

    test("another global provider restricted to its attached projects keeps only those", async () => {
      globalOidc = [
        {
          id: GLOBAL_OIDC,
          isEnabled: true,
          restrictToAttachedProjects: true,
        },
      ];
      oidcAttachments = [
        {
          id: id(301),
          providerId: GLOBAL_OIDC,
          projectId: BETA,
          isEnabled: true,
        },
      ];

      await expect(
        SsoSignInWays.findStrandedProjects({
          globalProviders: [turnedOff(SsoProviderType.GlobalSSO, GLOBAL_SAML)],
        }),
      ).resolves.toEqual(noStrandedProjects());

      oidcAttachments[0]!.isEnabled = false;

      const stranded: StrandedProjects =
        await SsoSignInWays.findStrandedProjects({
          globalProviders: [turnedOff(SsoProviderType.GlobalSSO, GLOBAL_SAML)],
        });

      expect(namesOf(stranded)).toEqual(["Beta"]);
    });

    test("a project that requires this very provider is stranded even with other providers on", async () => {
      projects[0] = project(ACME, "Acme", {
        requireSsoForLogin: true,
        requiredProviderId: GLOBAL_SAML,
      });
      globalOidc = [
        {
          id: GLOBAL_OIDC,
          isEnabled: true,
          restrictToAttachedProjects: false,
        },
      ];

      const stranded: StrandedProjects =
        await SsoSignInWays.findStrandedProjects({
          globalProviders: [turnedOff(SsoProviderType.GlobalSSO, GLOBAL_SAML)],
        });

      expect(stranded.firstProjects).toEqual([
        {
          projectId: ACME,
          name: "Acme",
          reason: StrandReason.RequiredProvider,
          requiresSsoItself: true,
        },
      ]);
    });

    test("a project that requires another provider is not this change's doing", async () => {
      projects[1] = project(BETA, "Beta", {
        requireSsoForLogin: true,
        requiredProviderId: OTHER_GLOBAL_SAML,
      });

      await expect(
        SsoSignInWays.findStrandedProjects({
          globalProviders: [turnedOff(SsoProviderType.GlobalSSO, GLOBAL_SAML)],
        }),
      ).resolves.toEqual(noStrandedProjects());
    });
  });

  test("a provider restricted to its attached projects strands only the projects it stops reaching", async () => {
    projects = [
      project(ACME, "Acme", { requireSsoForLogin: true }),
      project(BETA, "Beta", { requireSsoForLogin: true }),
    ];

    const stranded: StrandedProjects = await SsoSignInWays.findStrandedProjects(
      {
        globalProviders: [
          {
            providerType: SsoProviderType.GlobalSSO,
            providerId: GLOBAL_SAML,
            before: reachOf(ACME, BETA),
            after: reachOf(ACME),
          },
        ],
      },
    );

    expect(namesOf(stranded)).toEqual(["Beta"]);
    // The projects it names are read by id, in one read; nothing is paged through.
    expect(projectPageReads).toHaveBeenCalledTimes(1);
    expect(
      Object.keys(
        (
          projectPageReads.mock.calls[0]![0] as {
            query: Record<string, unknown>;
          }
        ).query,
      ),
    ).toEqual(["_id"]);
  });

  test("the projects a change names are read together, a page at a time, not one by one", async () => {
    const named: Array<string> = [];

    for (let n: number = 1; n <= 501; n++) {
      named.push(id(5000 + n));
      projects.push(
        project(id(5000 + n), `Project ${n}`, { requireSsoForLogin: true }),
      );
    }

    const oneByOne: SpyInstance = getJestSpyOn(ProjectService, "findOneById");

    const stranded: StrandedProjects = await SsoSignInWays.findStrandedProjects(
      {
        globalProviders: [
          {
            providerType: SsoProviderType.GlobalSSO,
            providerId: GLOBAL_SAML,
            before: reachOf(...named),
            after: REACHES_NO_PROJECT,
          },
        ],
      },
    );

    expect(stranded.count).toBe(501);
    expect(oneByOne).not.toHaveBeenCalled();
    expect(
      projectPageReads.mock.calls.map((call: Array<unknown>): number => {
        return (call[0] as { limit: number }).limit;
      }),
    ).toEqual([500, 1]);
  });

  test("each reason is counted and named apart, for the refusal to say what to do about each", async () => {
    projects = [
      project(ACME, "Acme", {
        requireSsoForLogin: true,
        requiredProviderId: GLOBAL_SAML,
      }),
      project(BETA, "Beta", { requireSsoForLogin: true }),
      project(GAMMA, "Gamma", { requireSsoForLogin: true }),
    ];
    ownSaml = [{ id: ACME_SAML, projectId: ACME, isEnabled: true }];

    const stranded: StrandedProjects = await SsoSignInWays.findStrandedProjects(
      {
        globalProviders: [turnedOff(SsoProviderType.GlobalSSO, GLOBAL_SAML)],
      },
    );

    expect(stranded.count).toBe(3);
    expect(
      namesOf({
        ...stranded,
        ...stranded.byReason[StrandReason.RequiredProvider],
      }),
    ).toEqual(["Acme"]);
    expect(stranded.byReason[StrandReason.RequiredProvider].count).toBe(1);
    expect(
      namesOf({ ...stranded, ...stranded.byReason[StrandReason.NoProvider] }),
    ).toEqual(["Beta", "Gamma"]);
    expect(stranded.byReason[StrandReason.NoProvider].count).toBe(2);
  });

  test("a project it stops reaching that is gone is left out", async () => {
    const stranded: StrandedProjects = await SsoSignInWays.findStrandedProjects(
      {
        globalProviders: [
          turnedOff(SsoProviderType.GlobalSSO, GLOBAL_SAML, reachOf(DELTA)),
        ],
      },
    );

    expect(stranded).toEqual(noStrandedProjects());
  });

  test("a project's own provider taken away strands it when nothing else signs people in to it", async () => {
    projects = [project(ACME, "Acme", { requireSsoForLogin: true })];
    ownSaml = [{ id: ACME_SAML, projectId: ACME, isEnabled: true }];

    const takeAway: Map<
      string,
      Array<{
        providerType: SsoProviderType.ProjectSSO | SsoProviderType.ProjectOIDC;
        id: string;
      }>
    > = new Map([
      [ACME, [{ providerType: SsoProviderType.ProjectSSO, id: ACME_SAML }]],
    ]);

    const stranded: StrandedProjects = await SsoSignInWays.findStrandedProjects(
      { projectProvidersTakenAway: takeAway },
    );

    expect(stranded.firstProjects).toEqual([
      {
        projectId: ACME,
        name: "Acme",
        reason: StrandReason.NoProvider,
        requiresSsoItself: true,
      },
    ]);

    // Another project's provider does not count; one of the project's own does.
    ownOidc = [{ id: BETA_OIDC, projectId: BETA, isEnabled: true }];
    await expect(
      SsoSignInWays.findStrandedProjects({
        projectProvidersTakenAway: takeAway,
      }),
    ).resolves.toMatchObject({ count: 1 });

    ownOidc = [{ id: BETA_OIDC, projectId: ACME, isEnabled: true }];
    await expect(
      SsoSignInWays.findStrandedProjects({
        projectProvidersTakenAway: takeAway,
      }),
    ).resolves.toEqual(noStrandedProjects());
  });

  describe("Require SSO for Login turned on for a project", () => {
    const turnOn: (
      projectId: string,
      requiredProviderId?: string,
    ) => Promise<StrandedProjects> = (
      projectId: string,
      requiredProviderId?: string,
    ): Promise<StrandedProjects> => {
      return SsoSignInWays.findStrandedProjects({
        projectRules: new Map([
          [
            projectId,
            {
              requireSsoForLogin: true,
              requiredProviderId: requiredProviderId || null,
            },
          ],
        ]),
      });
    };

    beforeEach(() => {
      projects = [project(ACME, "Acme", { requireSsoForLogin: false })];
    });

    test("needs a provider that signs people in to it", async () => {
      await expect(turnOn(ACME)).resolves.toMatchObject({
        count: 1,
        firstProjects: [{ reason: StrandReason.NoProvider }],
      });

      ownSaml = [{ id: ACME_SAML, projectId: ACME, isEnabled: true }];
      await expect(turnOn(ACME)).resolves.toEqual(noStrandedProjects());
    });

    test("a global provider that reaches it counts", async () => {
      globalSaml = [
        {
          id: GLOBAL_SAML,
          isEnabled: true,
          restrictToAttachedProjects: true,
        },
      ];
      samlAttachments = [
        {
          id: id(301),
          providerId: GLOBAL_SAML,
          projectId: BETA,
          isEnabled: true,
        },
      ];

      await expect(turnOn(ACME)).resolves.toMatchObject({ count: 1 });

      samlAttachments.push({
        id: id(302),
        providerId: GLOBAL_SAML,
        projectId: ACME,
        isEnabled: true,
      });

      await expect(turnOn(ACME)).resolves.toMatchObject({ count: 0 });
    });

    test("the provider it requires must be one of those that sign people in to it", async () => {
      ownSaml = [{ id: ACME_SAML, projectId: ACME, isEnabled: true }];
      globalSaml = [
        {
          id: GLOBAL_SAML,
          isEnabled: true,
          restrictToAttachedProjects: false,
        },
      ];

      await expect(turnOn(ACME, ACME_SAML)).resolves.toMatchObject({
        count: 0,
      });
      await expect(turnOn(ACME, GLOBAL_SAML)).resolves.toMatchObject({
        count: 0,
      });

      // Off, gone or someone else's: it lets nobody in.
      await expect(turnOn(ACME, OTHER_GLOBAL_SAML)).resolves.toMatchObject({
        firstProjects: [{ reason: StrandReason.RequiredProvider }],
      });
      ownSaml[0]!.isEnabled = false;
      await expect(turnOn(ACME, ACME_SAML)).resolves.toMatchObject({
        firstProjects: [{ reason: StrandReason.RequiredProvider }],
      });
    });
  });

  describe("Require SSO for Login turned on for the whole server", () => {
    beforeEach(() => {
      projects = [
        project(ACME, "Acme", { requireSsoForLogin: false }),
        project(BETA, "Beta", { requireSsoForLogin: false }),
        project(GAMMA, "Gamma", { requireSsoForLogin: true }),
      ];
      ownSaml = [{ id: ACME_SAML, projectId: ACME, isEnabled: true }];
    });

    test("names the projects that do not require SSO themselves and have no provider", async () => {
      const stranded: StrandedProjects =
        await SsoSignInWays.findStrandedProjects({ turnsOnServerRule: true });

      expect(stranded.firstProjects).toEqual([
        {
          projectId: BETA,
          name: "Beta",
          reason: StrandReason.NoProvider,
          requiresSsoItself: false,
        },
      ]);
      // A project that requires SSO itself asks no more of anyone.
      expect(
        (projectPageReads.mock.calls[0]![0] as { query: unknown }).query,
      ).toEqual({ requireSsoForLogin: false });
      // The server's rule is not read: the change turns it on.
      expect(serverRuleReads).not.toHaveBeenCalled();
    });

    test("a global provider that signs people in to every project settles it", async () => {
      globalOidc = [
        {
          id: GLOBAL_OIDC,
          isEnabled: true,
          restrictToAttachedProjects: false,
        },
      ];

      await expect(
        SsoSignInWays.findStrandedProjects({ turnsOnServerRule: true }),
      ).resolves.toEqual(noStrandedProjects());
    });
  });

  test("the caller's locks are kept before each page the check reads", async () => {
    for (let n: number = 1; n <= 501; n++) {
      projects.push(
        project(id(1000 + n), `Project ${n}`, { requireSsoForLogin: false }),
      );
    }

    const steps: Array<string> = [];
    projectPageReads.mockImplementation((async (): Promise<Array<Project>> => {
      steps.push("read");
      return steps.filter((step: string): boolean => {
        return step === "read";
      }).length === 1
        ? projects.slice(0, 500).map(toProject)
        : projects.slice(500).map(toProject);
    }) as never);

    await SsoSignInWays.findStrandedProjects(
      { turnsOnServerRule: true },
      {
        keepLocks: async (): Promise<void> => {
          steps.push("keep");
        },
      },
    );

    expect(steps).toEqual(["keep", "read", "keep", "read"]);
  });

  test("a lock found lost while the check reads stops it there", async () => {
    for (let n: number = 1; n <= 501; n++) {
      projects.push(
        project(id(1000 + n), `Project ${n}`, { requireSsoForLogin: false }),
      );
    }

    let keeps: number = 0;

    await expect(
      SsoSignInWays.findStrandedProjects(
        { turnsOnServerRule: true },
        {
          keepLocks: async (): Promise<void> => {
            keeps++;

            if (keeps === 2) {
              throw new Error("The lock was lost");
            }
          },
        },
      ),
    ).rejects.toThrow("The lock was lost");

    // The first page only.
    expect(projectPageReads).toHaveBeenCalledTimes(1);
  });

  test("names the first few and counts them all, reading the projects a page at a time", async () => {
    for (let n: number = 1; n <= 1200; n++) {
      projects.push(
        project(id(1000 + n), `Project ${n}`, { requireSsoForLogin: true }),
      );
    }

    const stranded: StrandedProjects = await SsoSignInWays.findStrandedProjects(
      {
        globalProviders: [turnedOff(SsoProviderType.GlobalSSO, GLOBAL_SAML)],
      },
    );

    expect(stranded.count).toBe(1200);
    expect(stranded.firstProjects).toHaveLength(STRANDED_PROJECTS_NAMED);
    expect(namesOf(stranded)).toEqual(["Project 1", "Project 2", "Project 3"]);
    // Each page starts after the last project the one before it read.
    expect(
      projectPageReads.mock.calls.map((call: Array<unknown>): unknown => {
        const read: {
          query: Record<string, unknown>;
          skip: number;
          limit: number;
          sort: unknown;
        } = call[0] as {
          query: Record<string, unknown>;
          skip: number;
          limit: number;
          sort: unknown;
        };
        return [
          askedAfter(read.query["_id"]),
          read.skip,
          read.limit,
          read.sort,
        ];
      }),
    ).toEqual([
      [null, 0, 500, { _id: SortOrder.Ascending }],
      [id(1500), 0, 500, { _id: SortOrder.Ascending }],
      [id(2000), 0, 500, { _id: SortOrder.Ascending }],
    ]);
  });

  test("a project that leaves the projects being read while they are read passes none of the others over", async () => {
    for (let n: number = 1; n <= 600; n++) {
      projects.push(
        project(id(1000 + n), `Project ${n}`, { requireSsoForLogin: false }),
      );
    }

    const readPage: (data: unknown) => Promise<Array<Project>> =
      projectPageReads.getMockImplementation() as (
        data: unknown,
      ) => Promise<Array<Project>>;

    // The first project turns Require SSO for Login on, under its own lock, once the first page is read.
    projectPageReads.mockImplementation((async (
      data: unknown,
    ): Promise<Array<Project>> => {
      const page: Array<Project> = await readPage(data);

      projects[0]!.requireSsoForLogin = true;

      return page;
    }) as never);

    const stranded: StrandedProjects = await SsoSignInWays.findStrandedProjects(
      { turnsOnServerRule: true },
    );

    expect(stranded.count).toBe(600);
  });
});

describe("whether a change to projects alone depends on the server's sign-in rules", () => {
  type TakenAway = Map<
    string,
    Array<{
      providerType: SsoProviderType.ProjectSSO | SsoProviderType.ProjectOIDC;
      id: string;
    }>
  >;

  const takeAway: (projectId: string, providerId: string) => TakenAway = (
    projectId: string,
    providerId: string,
  ): TakenAway => {
    return new Map([
      [
        projectId,
        [{ providerType: SsoProviderType.ProjectSSO, id: providerId }],
      ],
    ]);
  };

  beforeEach(() => {
    projects = [project(ACME, "Acme", { requireSsoForLogin: true })];
    ownSaml = [{ id: ACME_SAML, projectId: ACME, isEnabled: true }];
    ownOidc = [{ id: BETA_OIDC, projectId: ACME, isEnabled: true }];
  });

  test("a provider taken away while the project keeps another of its own does not, and reads neither the server's rule nor the global providers", async () => {
    const globalReads: SpyInstance = getJestSpyOn(GlobalSsoService, "findBy");

    await expect(
      SsoSignInWays.dependsOnServerRules({
        projectProvidersTakenAway: takeAway(ACME, ACME_SAML),
      }),
    ).resolves.toBe(false);

    expect(serverRuleReads).not.toHaveBeenCalled();
    expect(globalReads).not.toHaveBeenCalled();
  });

  test("its last own provider taken away does: then only the global providers, or the server's rule, decide", async () => {
    ownOidc = [];

    await expect(
      SsoSignInWays.dependsOnServerRules({
        projectProvidersTakenAway: takeAway(ACME, ACME_SAML),
      }),
    ).resolves.toBe(true);

    // Whatever the project requires itself: the server may require it.
    projects = [project(ACME, "Acme", { requireSsoForLogin: false })];
    await expect(
      SsoSignInWays.dependsOnServerRules({
        projectProvidersTakenAway: takeAway(ACME, ACME_SAML),
      }),
    ).resolves.toBe(true);
  });

  test("taking away the provider it requires does, even with others of its own on", async () => {
    projects = [
      project(ACME, "Acme", {
        requireSsoForLogin: false,
        requiredProviderId: ACME_SAML,
      }),
    ];

    await expect(
      SsoSignInWays.dependsOnServerRules({
        projectProvidersTakenAway: takeAway(ACME, ACME_SAML),
      }),
    ).resolves.toBe(true);

    // Requiring another, it keeps that one whatever the server's rules are.
    projects = [
      project(ACME, "Acme", {
        requireSsoForLogin: true,
        requiredProviderId: GLOBAL_SAML,
      }),
    ];
    await expect(
      SsoSignInWays.dependsOnServerRules({
        projectProvidersTakenAway: takeAway(ACME, ACME_SAML),
      }),
    ).resolves.toBe(false);
  });

  test("Require SSO for Login turned on: not with one of its own providers on, and the provider it requires one of them", async () => {
    const turnOn: (requiredProviderId: string | null) => Promise<boolean> = (
      requiredProviderId: string | null,
    ): Promise<boolean> => {
      return SsoSignInWays.dependsOnServerRules({
        projectRules: new Map([
          [ACME, { requireSsoForLogin: true, requiredProviderId }],
        ]),
      });
    };

    await expect(turnOn(null)).resolves.toBe(false);
    await expect(turnOn(ACME_SAML)).resolves.toBe(false);

    // A global provider, or one that is off or gone: the server's providers decide.
    await expect(turnOn(GLOBAL_SAML)).resolves.toBe(true);
    ownSaml[0]!.isEnabled = false;
    await expect(turnOn(ACME_SAML)).resolves.toBe(true);

    // None of its own on.
    ownOidc = [];
    await expect(turnOn(null)).resolves.toBe(true);
  });

  test("a change to the global providers or to the server's rule always does, without reading", async () => {
    await expect(
      SsoSignInWays.dependsOnServerRules({
        globalProviders: [turnedOff(SsoProviderType.GlobalSSO, GLOBAL_SAML)],
      }),
    ).resolves.toBe(true);
    await expect(
      SsoSignInWays.dependsOnServerRules({ turnsOnServerRule: true }),
    ).resolves.toBe(true);

    expect(projectPageReads).not.toHaveBeenCalled();
    expect(ownSamlReads).not.toHaveBeenCalled();
  });

  test("a project that is gone is left out", async () => {
    await expect(
      SsoSignInWays.dependsOnServerRules({
        projectProvidersTakenAway: takeAway(DELTA, ACME_SAML),
      }),
    ).resolves.toBe(false);
  });

  test("the projects are read together, and their own providers once per kind", async () => {
    const changed: TakenAway = new Map();

    for (let n: number = 1; n <= 20; n++) {
      const projectId: string = id(7000 + n);
      projects.push(
        project(projectId, `Project ${n}`, { requireSsoForLogin: true }),
      );
      ownSaml.push({ id: id(8000 + n), projectId, isEnabled: true });
      ownOidc.push({ id: id(9000 + n), projectId, isEnabled: true });
      changed.set(projectId, [
        { providerType: SsoProviderType.ProjectSSO, id: id(8000 + n) },
      ]);
    }

    await expect(
      SsoSignInWays.dependsOnServerRules({
        projectProvidersTakenAway: changed,
      }),
    ).resolves.toBe(false);

    expect(projectPageReads).toHaveBeenCalledTimes(1);
    expect(ownSamlReads).toHaveBeenCalledTimes(1);
  });
});

describe("a project created now, which has no provider of its own yet", () => {
  const create: (data: {
    requireSsoForLogin?: boolean;
    requiredProviderId?: string;
  }) => Promise<StrandReason | null> = (data: {
    requireSsoForLogin?: boolean;
    requiredProviderId?: string;
  }): Promise<StrandReason | null> => {
    return SsoSignInWays.findNewProjectStrandReason({
      rule: {
        requireSsoForLogin: data.requireSsoForLogin === true,
        requiredProviderId: data.requiredProviderId || null,
      },
    });
  };

  const everyProject: (providerId: string) => GlobalProviderRow = (
    providerId: string,
  ): GlobalProviderRow => {
    return {
      id: providerId,
      isEnabled: true,
      restrictToAttachedProjects: false,
    };
  };

  test("that asks nothing of SSO, on a server that does not require it, needs no provider, and no provider is read", async () => {
    await expect(create({})).resolves.toBeNull();

    expect(serverRuleReads).toHaveBeenCalledTimes(1);
    expect(GlobalSsoService.findBy).not.toHaveBeenCalled();
  });

  test("on a server that requires SSO for everyone it needs a provider, though it does not require SSO itself", async () => {
    serverRequiresSso = true;

    await expect(create({})).resolves.toBe(StrandReason.NoProvider);

    globalSaml = [everyProject(GLOBAL_SAML)];
    await expect(create({})).resolves.toBeNull();
  });

  test("that requires SSO itself needs a global provider that signs people in to every project, and the server's rule is not read", async () => {
    await expect(create({ requireSsoForLogin: true })).resolves.toBe(
      StrandReason.NoProvider,
    );

    globalOidc = [everyProject(GLOBAL_OIDC)];

    await expect(create({ requireSsoForLogin: true })).resolves.toBeNull();
    expect(serverRuleReads).not.toHaveBeenCalled();
  });

  test("another project's providers, on, sign nobody in to it", async () => {
    ownSaml = [{ id: ACME_SAML, projectId: ACME, isEnabled: true }];
    ownOidc = [{ id: BETA_OIDC, projectId: BETA, isEnabled: true }];

    await expect(create({ requireSsoForLogin: true })).resolves.toBe(
      StrandReason.NoProvider,
    );
  });

  test("a global provider that is off does not count", async () => {
    globalSaml = [
      { id: GLOBAL_SAML, isEnabled: false, restrictToAttachedProjects: false },
    ];

    await expect(create({ requireSsoForLogin: true })).resolves.toBe(
      StrandReason.NoProvider,
    );
  });

  test("a provider restricted to its attached projects counts only while it has none: no project is attached to one created now", async () => {
    globalSaml = [
      { id: GLOBAL_SAML, isEnabled: true, restrictToAttachedProjects: true },
    ];

    await expect(create({ requireSsoForLogin: true })).resolves.toBeNull();

    samlAttachments = [
      {
        id: id(301),
        providerId: GLOBAL_SAML,
        projectId: ACME,
        isEnabled: true,
      },
    ];

    await expect(create({ requireSsoForLogin: true })).resolves.toBe(
      StrandReason.NoProvider,
    );
  });

  test("an attachment that is off still restricts its provider to the attached projects", async () => {
    globalSaml = [
      { id: GLOBAL_SAML, isEnabled: true, restrictToAttachedProjects: true },
    ];
    samlAttachments = [
      {
        id: id(301),
        providerId: GLOBAL_SAML,
        projectId: ACME,
        isEnabled: false,
      },
    ];

    await expect(create({ requireSsoForLogin: true })).resolves.toBe(
      StrandReason.NoProvider,
    );
  });

  test("the provider it requires must be a global provider that signs people in to every project", async () => {
    globalSaml = [
      everyProject(GLOBAL_SAML),
      {
        id: OTHER_GLOBAL_SAML,
        isEnabled: true,
        restrictToAttachedProjects: true,
      },
    ];
    samlAttachments = [
      {
        id: id(301),
        providerId: OTHER_GLOBAL_SAML,
        projectId: ACME,
        isEnabled: true,
      },
    ];
    ownSaml = [{ id: ACME_SAML, projectId: ACME, isEnabled: true }];

    await expect(
      create({ requireSsoForLogin: true, requiredProviderId: GLOBAL_SAML }),
    ).resolves.toBeNull();

    // Restricted to projects this one is not among, another project's own, or none at all.
    for (const requiredProviderId of [
      OTHER_GLOBAL_SAML,
      ACME_SAML,
      GLOBAL_OIDC,
    ]) {
      await expect(
        create({ requireSsoForLogin: true, requiredProviderId }),
      ).resolves.toBe(StrandReason.RequiredProvider);
    }
  });

  test("a provider it requires while it does not require SSO itself is held to the server's rule", async () => {
    serverRequiresSso = true;
    globalSaml = [everyProject(GLOBAL_SAML)];

    await expect(create({ requiredProviderId: GLOBAL_SAML })).resolves.toBe(
      null,
    );
    await expect(create({ requiredProviderId: GLOBAL_OIDC })).resolves.toBe(
      StrandReason.RequiredProvider,
    );

    serverRequiresSso = false;
    await expect(create({ requiredProviderId: GLOBAL_OIDC })).resolves.toBe(
      null,
    );
  });

  test("the global providers are read once for a check", async () => {
    serverRequiresSso = true;
    globalSaml = [everyProject(GLOBAL_SAML)];

    await expect(create({ requireSsoForLogin: true })).resolves.toBeNull();

    expect(GlobalSsoService.findBy).toHaveBeenCalledTimes(1);
    expect(GlobalOidcService.findBy).toHaveBeenCalledTimes(1);
  });
});
