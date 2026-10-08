import Semaphore from "../../../Server/Infrastructure/Semaphore";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import GlobalOidcProjectService from "../../../Server/Services/GlobalOidcProjectService";
import GlobalOidcService from "../../../Server/Services/GlobalOidcService";
import GlobalSsoProjectService from "../../../Server/Services/GlobalSsoProjectService";
import GlobalSsoService from "../../../Server/Services/GlobalSsoService";
import ProjectOidcService from "../../../Server/Services/ProjectOidcService";
import ProjectService from "../../../Server/Services/ProjectService";
import ProjectSsoService from "../../../Server/Services/ProjectSsoService";
import logger from "../../../Server/Utils/Logger";
import ProjectSsoProviderChanges, {
  SERVER_SIGN_IN_LOCK_KEY,
  SIGN_IN_CHANGE_IN_PROGRESS_MESSAGE,
} from "../../../Server/Utils/ProjectSsoProviderChanges";
import RealtimeAccessChanges, {
  RealtimeAccessChange,
} from "../../../Server/Utils/Realtime/RealtimeAccessChanges";
import { NO_SSO_PROVIDER_TO_REQUIRE_MESSAGE } from "../../../Server/Utils/SsoRequirementChanges";
import GlobalConfig from "../../../Models/DatabaseModels/GlobalConfig";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
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

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    IsBillingEnabled: false,
  };
});

/*
 * AN UPDATE THAT TURNS REQUIRE SSO FOR LOGIN ON FOR PROJECTS NAMED BY A
 * FILTER WRITES EXACTLY THE PROJECTS IT CHECKED (Server/Utils/
 * SsoRequirementChanges.beforeProjectUpdate).
 *
 * No API path writes the rule by a filter - the Dashboard and the API write
 * one project by its id - but OneUptime's own code may. These run the real
 * ProjectService update path - DatabaseService and the service's hooks - as
 * OneUptime itself, over projects and their SAML providers held in memory
 * (InMemoryRepository), with the locks held in memory too. They check that:
 *
 *   - the projects are read once to learn which to lock, and again under
 *     the locks; one that comes to match the filter in between - a project
 *     created a moment later - is never locked, so the write is refused, to
 *     be saved again, and nothing is written;
 *   - the write reaches exactly the projects read under the locks: one that
 *     comes to match the filter afterwards was never checked, and keeps the
 *     rule it has; a write that read none writes none;
 *   - the locks are kept once the check is done, again right before the
 *     write (after the auto recharge charge, the last step before it), and
 *     kept alive while the projects are written; one lost by then refuses
 *     the write.
 */

const id: (n: number) => string = (n: number): string => {
  return `5e000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
};

const ACME_EU: string = id(1);
const ACME_US: string = id(2);
const OTHER: string = id(3);
const CREATED_LATER: string = id(4);

const SERVER_LOCK: string = SERVER_SIGN_IN_LOCK_KEY;

const GROUP: string = "Acme Group";

let projects: InMemoryTable;
let samlProviders: InMemoryTable;

// "lock:<key>", "keep:<key>", "write:<project>", "release:<key>", "charge", in order.
let events: Array<string>;
let announced: Array<RealtimeAccessChange>;

// The locks found lost from now on, by key: those taken again are lost too.
let lostLocks: Array<string>;

// The locks found lost, as they were handed out: those taken again are not.
let lostLockObjects: Set<{ key: string }>;

// The locks Semaphore.lock handed out, by key, the last of each.
let lockObjects: Map<string, { key: string }>;

// What lands while the write waits for its projects' locks, as another server's write would.
let whileWaitingForLock: (() => void) | null;

// What runs in the step between the check and the write: the auto recharge charge.
let whileCharging: (() => void) | null;

// What runs as each project is written, before it is.
let whileWriting: (() => void) | null;

const projectRow: (
  projectId: string,
  name: string,
  rule?: { requireSsoForLogin?: boolean },
) => StoredRow = (
  projectId: string,
  name: string,
  rule?: { requireSsoForLogin?: boolean },
): StoredRow => {
  return {
    _id: projectId,
    name: name,
    slug: `${name.toLowerCase().replace(/\s+/g, "-")}-${projectId}`,
    requireSsoForLogin: rule?.requireSsoForLogin === true,
    requireSsoWithSsoProviderId: null,
  };
};

// One of the project's own SAML providers, on: the project keeps a way in of its own.
const ownSamlOn: (projectId: string) => StoredRow = (
  projectId: string,
): StoredRow => {
  return {
    _id: ObjectID.generate().toString(),
    projectId: new ObjectID(projectId),
    isEnabled: true,
    name: "Okta",
  };
};

const requireSsoForGroup: (name?: string) => Promise<number | string> = async (
  name?: string,
): Promise<number | string> => {
  try {
    return await ProjectService.updateBy({
      query: { name: name || GROUP } as never,
      data: { requireSsoForLogin: true } as never,
      limit: LIMIT_MAX,
      skip: 0,
      props: { isRoot: true },
    });
  } catch (err) {
    if (err instanceof BadDataException) {
      return err.message;
    }

    throw err;
  }
};

const ruleOf: (projectId: string) => unknown = (projectId: string): unknown => {
  return projects.get(projectId)?.["requireSsoForLogin"];
};

const writtenProjects: () => Array<string> = (): Array<string> => {
  return projects.updates
    .filter((update: { id: string; set: StoredRow }): boolean => {
      return update.set["requireSsoForLogin"] !== undefined;
    })
    .map((update: { id: string; set: StoredRow }): string => {
      return update.id;
    });
};

const keptForWrite: () => Array<boolean> = (): Array<boolean> => {
  return Array.from(lockObjects.values()).map(
    (lock: { key: string }): boolean => {
      return ProjectSsoProviderChanges.isKeptForWrite(lock as never);
    },
  );
};

beforeEach(() => {
  events = [];
  announced = [];
  lostLocks = [];
  lostLockObjects = new Set<{ key: string }>();
  lockObjects = new Map<string, { key: string }>();
  whileWaitingForLock = null;
  whileCharging = null;
  whileWriting = null;

  for (const silenced of ["debug", "info", "warn", "error"]) {
    getJestSpyOn(logger, silenced).mockImplementation((): void => {
      return undefined;
    });
  }

  projects = useInMemoryTable(ProjectService, [
    projectRow(ACME_EU, GROUP),
    projectRow(ACME_US, GROUP),
    projectRow(OTHER, "Other"),
  ]);

  // Each project of the group keeps a way in of its own.
  samlProviders = useInMemoryTable(ProjectSsoService, [
    ownSamlOn(ACME_EU),
    ownSamlOn(ACME_US),
  ]);
  useInMemoryTable(ProjectOidcService, []);
  useInMemoryTable(GlobalSsoService, []);
  useInMemoryTable(GlobalOidcService, []);
  useInMemoryTable(GlobalSsoProjectService, []);
  useInMemoryTable(GlobalOidcProjectService, []);

  getJestSpyOn(GlobalConfigService, "findOneBy").mockImplementation(
    async (): Promise<GlobalConfig> => {
      const config: GlobalConfig = new GlobalConfig();
      config.requireSsoForLogin = false;
      return config;
    },
  );

  // Each project's write, recorded before it lands.
  const write: (...args: Array<unknown>) => unknown =
    projects.repository.update.getMockImplementation()!;

  projects.repository.update.mockImplementation(
    async (...args: Array<unknown>): Promise<unknown> => {
      const where: { _id?: unknown } = args[0] as { _id?: unknown };
      whileWriting?.();
      events.push(`write:${String(where._id)}`);
      return await write(...args);
    },
  );

  getJestSpyOn(ProjectService, "chargeAutoRechargeTurnedOn").mockImplementation(
    async (): Promise<void> => {
      events.push("charge");
      whileCharging?.();
    },
  );

  getJestSpyOn(Semaphore, "lock").mockImplementation((async (data: {
    key: string;
  }): Promise<unknown> => {
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
    events.push(`release:${mutex.key}`);
  }) as never);
  getJestSpyOn(Semaphore, "keepLock").mockImplementation((async (mutex: {
    key: string;
  }): Promise<boolean> => {
    events.push(`keep:${mutex.key}`);
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

  const auditLogService: { recordUpdate: () => Promise<void> } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    require("../../../Server/Services/AuditLogService").default;
  getJestSpyOn(auditLogService, "recordUpdate").mockResolvedValue(undefined);
});

afterEach(() => {
  jest.restoreAllMocks();
});

const LOCK_ORDER: Array<string> = [ACME_EU, ACME_US].sort();
const FIRST_LOCKED: string = LOCK_ORDER[0]!;
const SECOND_LOCKED: string = LOCK_ORDER[1]!;

describe("Require SSO for Login written to projects named by a filter", () => {
  test("reads them, locks them, reads them again under the locks, and writes exactly those", async () => {
    await expect(requireSsoForGroup()).resolves.toBe(2);

    expect(ruleOf(ACME_EU)).toBe(true);
    expect(ruleOf(ACME_US)).toBe(true);
    expect(ruleOf(OTHER)).toBe(false);
    expect(writtenProjects().sort()).toEqual([ACME_EU, ACME_US].sort());
    // Each project keeps a provider of its own: only their locks are taken.
    expect(
      events.filter((event: string): boolean => {
        return event.startsWith("lock:");
      }),
    ).toEqual([`lock:${FIRST_LOCKED}`, `lock:${SECOND_LOCKED}`]);
  });

  test("a project created between the first read and the read under the locks is refused, to be saved again, and nothing is written", async () => {
    whileWaitingForLock = (): void => {
      projects.rows.push(projectRow(CREATED_LATER, GROUP));
      samlProviders.rows.push(ownSamlOn(CREATED_LATER));
    };

    await expect(requireSsoForGroup()).resolves.toBe(
      SIGN_IN_CHANGE_IN_PROGRESS_MESSAGE,
    );

    expect(writtenProjects()).toEqual([]);
    expect(ruleOf(ACME_EU)).toBe(false);
    expect(ruleOf(CREATED_LATER)).toBe(false);
    expect(events).toEqual([
      `lock:${FIRST_LOCKED}`,
      `lock:${SECOND_LOCKED}`,
      `release:${FIRST_LOCKED}`,
      `release:${SECOND_LOCKED}`,
    ]);
    expect(announced).toEqual([]);
  });

  test("a project that comes to match the filter after the read under the locks is left alone: it was never checked", async () => {
    // Created in the last step before the write, once the check is done; with no way in of its own.
    whileCharging = (): void => {
      projects.rows.push(projectRow(CREATED_LATER, GROUP));
    };

    await expect(requireSsoForGroup()).resolves.toBe(2);

    expect(ruleOf(ACME_EU)).toBe(true);
    expect(ruleOf(ACME_US)).toBe(true);
    expect(ruleOf(CREATED_LATER)).toBe(false);
    expect(writtenProjects()).not.toContain(CREATED_LATER);
  });

  test("a write whose filter matched no project when it was read writes none of the projects that come to match it afterwards, and takes no lock", async () => {
    whileCharging = (): void => {
      projects.rows.push(projectRow(CREATED_LATER, "Created a moment later"));
    };

    await expect(requireSsoForGroup("Created a moment later")).resolves.toBe(0);

    expect(ruleOf(CREATED_LATER)).toBe(false);
    expect(writtenProjects()).toEqual([]);
    expect(lockObjects.size).toBe(0);
  });

  test("a write that saves back the rule the projects have - they require SSO already - is checked, held to them, and keeps their locks until they are written", async () => {
    projects.get(ACME_EU)!["requireSsoForLogin"] = true;
    projects.get(ACME_US)!["requireSsoForLogin"] = true;

    whileCharging = (): void => {
      projects.rows.push(projectRow(CREATED_LATER, GROUP));
    };

    await expect(requireSsoForGroup()).resolves.toBe(2);

    expect(ruleOf(CREATED_LATER)).toBe(false);
    expect(writtenProjects()).not.toContain(CREATED_LATER);
    // Held through the charge and the writes, and given back once they are done.
    const lastWrite: number = events.lastIndexOf(`write:${ACME_US}`);

    expect(events.indexOf(`release:${FIRST_LOCKED}`)).toBeGreaterThan(
      events.indexOf("charge"),
    );
    expect(events.indexOf(`release:${SECOND_LOCKED}`)).toBeGreaterThan(
      lastWrite,
    );
  });

  test("a write that saves back the rule the projects have is refused when one of them has no way in, and nothing is written", async () => {
    projects.get(ACME_EU)!["requireSsoForLogin"] = true;
    projects.get(ACME_US)!["requireSsoForLogin"] = true;
    samlProviders.rows = samlProviders.rows.filter(
      (row: StoredRow): boolean => {
        return String(row["projectId"]) !== ACME_US;
      },
    );

    await expect(requireSsoForGroup()).resolves.toBe(
      NO_SSO_PROVIDER_TO_REQUIRE_MESSAGE,
    );

    expect(writtenProjects()).toEqual([]);
  });

  test("a project of the filter that has no way in is still refused, and nothing is written", async () => {
    samlProviders.rows = samlProviders.rows.filter(
      (row: StoredRow): boolean => {
        return String(row["projectId"]) !== ACME_US;
      },
    );

    await expect(requireSsoForGroup()).resolves.toBe(
      NO_SSO_PROVIDER_TO_REQUIRE_MESSAGE,
    );

    expect(writtenProjects()).toEqual([]);
    // Checked under the projects' locks and the one on the server's sign-in rules, all given back.
    expect(
      events.filter((event: string): boolean => {
        return event.startsWith("release:");
      }),
    ).toEqual([
      `release:${FIRST_LOCKED}`,
      `release:${SECOND_LOCKED}`,
      `release:${SERVER_LOCK}`,
    ]);
  });
});

describe("the locks of a Require SSO for Login write are kept for it, until it is written", () => {
  test("kept once the check is done, and once more right before the write - after the auto recharge charge", async () => {
    await expect(requireSsoForGroup()).resolves.toBe(2);

    const firstWrite: number = events.findIndex((event: string): boolean => {
      return event.startsWith("write:");
    });

    expect(events.slice(0, firstWrite)).toEqual([
      `lock:${FIRST_LOCKED}`,
      `lock:${SECOND_LOCKED}`,
      // The check is done.
      `keep:${FIRST_LOCKED}`,
      `keep:${SECOND_LOCKED}`,
      "charge",
      // Right before the write.
      `keep:${FIRST_LOCKED}`,
      `keep:${SECOND_LOCKED}`,
    ]);
    expect(events.slice(-2)).toEqual([
      `release:${FIRST_LOCKED}`,
      `release:${SECOND_LOCKED}`,
    ]);
  });

  test("the locks are kept alive from the check on: while the auto recharge is charged too", async () => {
    let keptWhileCharging: Array<boolean> = [];
    whileCharging = (): void => {
      keptWhileCharging = keptForWrite();
    };

    await expect(requireSsoForGroup()).resolves.toBe(2);

    expect(keptWhileCharging).toEqual([true, true]);
    expect(keptForWrite()).toEqual([false, false]);
  });

  test("a lock lost while the auto recharge was charged is taken again, with the other, and the projects read and checked again under them: the write goes through", async () => {
    whileCharging = (): void => {
      lostLockObjects.add(lockObjects.get(SECOND_LOCKED)!);
    };

    await expect(requireSsoForGroup()).resolves.toBe(2);

    expect(ruleOf(ACME_EU)).toBe(true);
    expect(ruleOf(ACME_US)).toBe(true);
    expect(writtenProjects().sort()).toEqual([ACME_EU, ACME_US].sort());

    const charged: number = events.indexOf("charge");

    expect(events.slice(charged)).toEqual([
      "charge",
      // Right before the write: one is gone.
      `keep:${FIRST_LOCKED}`,
      `keep:${SECOND_LOCKED}`,
      // Both given back, taken again in order, the projects read again, and kept.
      `release:${FIRST_LOCKED}`,
      `release:${SECOND_LOCKED}`,
      `lock:${FIRST_LOCKED}`,
      `lock:${SECOND_LOCKED}`,
      `keep:${FIRST_LOCKED}`,
      `keep:${SECOND_LOCKED}`,
      `write:${ACME_EU}`,
      `write:${ACME_US}`,
      `release:${FIRST_LOCKED}`,
      `release:${SECOND_LOCKED}`,
    ]);
    expect(keptForWrite()).toEqual([false, false]);
  });

  test("a lock lost while the auto recharge was charged, and lost again once taken again, refuses the write: nothing is written, and nothing is held", async () => {
    whileCharging = (): void => {
      lostLocks = [SECOND_LOCKED];
    };

    await expect(requireSsoForGroup()).resolves.toBe(
      SIGN_IN_CHANGE_IN_PROGRESS_MESSAGE,
    );

    expect(writtenProjects()).toEqual([]);
    expect(ruleOf(ACME_EU)).toBe(false);
    expect(ruleOf(ACME_US)).toBe(false);
    expect(events.slice(-2)).toEqual([
      `release:${FIRST_LOCKED}`,
      `release:${SECOND_LOCKED}`,
    ]);
    expect(keptForWrite()).toEqual([false, false]);
    expect(announced).toEqual([]);
  });

  test("while the projects are written their locks are kept alive, and once written they are kept no more", async () => {
    const keptWhileWritten: Array<Array<boolean>> = [];

    whileWriting = (): void => {
      keptWhileWritten.push(keptForWrite());
    };

    await expect(requireSsoForGroup()).resolves.toBe(2);

    expect(keptWhileWritten).toEqual([
      [true, true],
      [true, true],
    ]);
    expect(keptForWrite()).toEqual([false, false]);
  });

  test("a write the database fails gives the locks back, and keeps them alive no more", async () => {
    projects.repository.update.mockImplementation(async (): Promise<never> => {
      throw new Error("The database could not write the project");
    });

    await expect(requireSsoForGroup()).rejects.toThrow(
      "The database could not write the project",
    );

    expect(keptForWrite()).toEqual([false, false]);
    expect(events.slice(-2)).toEqual([
      `release:${FIRST_LOCKED}`,
      `release:${SECOND_LOCKED}`,
    ]);
  });
});
