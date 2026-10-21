import Redis from "../../../Server/Infrastructure/Redis";
import BillingService from "../../../Server/Services/BillingService";
import GlobalConfigService from "../../../Server/Services/GlobalConfigService";
import GlobalOidcProjectService from "../../../Server/Services/GlobalOidcProjectService";
import GlobalOidcService from "../../../Server/Services/GlobalOidcService";
import GlobalSsoProjectService from "../../../Server/Services/GlobalSsoProjectService";
import GlobalSsoService from "../../../Server/Services/GlobalSsoService";
import ProjectOidcService from "../../../Server/Services/ProjectOidcService";
import ProjectService from "../../../Server/Services/ProjectService";
import ProjectSsoService from "../../../Server/Services/ProjectSsoService";
import BalanceRechargeGuard from "../../../Server/Utils/Billing/BalanceRechargeGuard";
import * as BillingFailureNoticeThrottle from "../../../Server/Utils/Billing/BillingFailureNoticeThrottle";
import logger from "../../../Server/Utils/Logger";
import ProjectSsoProviderChanges, {
  LAST_SSO_PROVIDER_MESSAGE,
  PROVIDER_CHANGE_IN_PROGRESS_MESSAGE,
  REQUIRED_SSO_PROVIDER_MESSAGE,
  SERVER_SIGN_IN_LOCK_KEY,
} from "../../../Server/Utils/ProjectSsoProviderChanges";
import RealtimeAccessChanges from "../../../Server/Utils/Realtime/RealtimeAccessChanges";
import ModelPermission from "../../../Server/Types/Database/Permissions/Index";
import SsoRequirementChanges, {
  NO_SSO_PROVIDER_TO_REQUIRE_MESSAGE,
  REQUIRED_PROVIDER_CANNOT_SIGN_IN_MESSAGE,
} from "../../../Server/Utils/SsoRequirementChanges";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { setTestBillingEnabled } from "../Enterprise/TestBillingFlag";
import InMemoryLocks, { InMemoryLock } from "../TestingUtils/InMemoryLocks";
import {
  SELECT_STATEMENT,
  cancelledByDatabase,
  clientTimeout,
  connectionLost,
} from "../TestingUtils/StatementFailures";
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
  const billingFlag: typeof import("../Enterprise/TestBillingFlag") =
    jest.requireActual(
      "../Enterprise/TestBillingFlag",
    ) as typeof import("../Enterprise/TestBillingFlag");

  return billingFlag.withLiveBillingFlag(
    jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >,
  );
});

/*
 * A CHANGE TO WHO CAN SIGN IN KEEPS WHAT ITS CHECK SAW UNTIL IT IS WRITTEN.
 *
 * Changes to who can sign in with SSO are checked under locks
 * (Server/Utils/ProjectSsoProviderChanges, SsoRequirementChanges), so that a
 * project that requires SSO always keeps a way in. These run the real update
 * and delete paths of ProjectService, GlobalConfigService and the SSO
 * provider services - DatabaseService and the services' hooks - over rows
 * held in memory (InMemoryRepository), with the locks held in memory as
 * Valkey holds them (InMemoryLocks): a change that wants a lock another
 * holds waits for it, so two changes can be run against each other, in a
 * set order. They check that:
 *
 *   - a save that writes Require SSO for Login on, or names the provider a
 *     project requires, is checked by what it asks for - when the project
 *     says the same already too - and keeps its locks until it is written:
 *     a provider it counts on cannot be turned off or deleted in between,
 *     even after another change turned the rule off for a moment; the same
 *     for the server's own Require SSO for Login;
 *   - a lock found gone right before the write - the auto recharge charge
 *     took longer than the lock is kept, or Valkey lost it - is taken again,
 *     and the change checked again under it: written when nothing came
 *     between, refused when something did, or when the lock is held by
 *     another change by then. A charge made already stays made, and the
 *     balance it bought stays the project's;
 *   - a write the database never answered - the client stopped waiting for
 *     the statement, or lost the connection while it ran - keeps its locks,
 *     as the database may still apply it; one the database answered with
 *     an error of its own gives them back at once.
 */

const id: (n: number) => string = (n: number): string => {
  return `7e000000-0000-4000-8000-${n.toString(16).padStart(12, "0")}`;
};

const ACME: string = id(1);
const BETA: string = id(2);
const OWN_SAML: string = id(11);
const OWN_OIDC: string = id(12);
const GLOBAL_SAML: string = id(21);
const UNKNOWN_PROVIDER: string = id(31);
const CONFIG_ID: string = ObjectID.getZeroObjectID().toString();

const SERVER: string = SERVER_SIGN_IN_LOCK_KEY;

let locks: InMemoryLocks;
let projects: InMemoryTable;
let samlProviders: InMemoryTable;
let oidcProviders: InMemoryTable;
let globalSamlProviders: InMemoryTable;
let config: InMemoryTable;

// What runs, once, in the step between the check and the write: the auto recharge charge.
let whileCharging: (() => Promise<void>) | null;

// What runs, once, while the payment provider charges the card for auto recharge.
let whileCardCharged: (() => Promise<void>) | null;

// What the repository answers the next project write with, instead of writing it.
let nextProjectWriteFails: Error | null;

let charges: Array<{ customerId: string; amountInUsd: number }>;

const projectRow: (
  projectId: string,
  name: string,
  rule?: {
    requireSsoForLogin?: boolean;
    requiredProviderId?: string | null;
  },
) => StoredRow = (
  projectId: string,
  name: string,
  rule?: {
    requireSsoForLogin?: boolean;
    requiredProviderId?: string | null;
  },
): StoredRow => {
  return {
    _id: projectId,
    name: name,
    slug: `${name.toLowerCase()}-${projectId}`,
    requireSsoForLogin: rule?.requireSsoForLogin === true,
    requireSsoWithSsoProviderId: rule?.requiredProviderId
      ? new ObjectID(rule.requiredProviderId)
      : null,
    paymentProviderCustomerId: "cus_acme",
    smsOrCallCurrentBalanceInUSDCents: 0,
    enableAutoRechargeSmsOrCallBalance: false,
    autoRechargeSmsOrCallByBalanceInUSD: 20,
    autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD: 10,
  };
};

const providerRow: (
  providerId: string,
  projectId: string,
  isEnabled?: boolean,
) => StoredRow = (
  providerId: string,
  projectId: string,
  isEnabled: boolean = true,
): StoredRow => {
  return {
    _id: providerId,
    projectId: new ObjectID(projectId),
    isEnabled: isEnabled,
    name: "Okta",
    signInsEndedAt: null,
  };
};

// What a change answers: "done", or the refusal's message.
const outcomeOf: (change: Promise<unknown>) => Promise<string> = async (
  change: Promise<unknown>,
): Promise<string> => {
  try {
    await change;
    return "done";
  } catch (err) {
    if (err instanceof BadDataException) {
      return err.message;
    }

    throw err;
  }
};

const saveProject: (
  data: Record<string, unknown>,
  projectId?: string,
) => Promise<string> = (
  data: Record<string, unknown>,
  projectId?: string,
): Promise<string> => {
  return outcomeOf(
    ProjectService.updateOneById({
      id: new ObjectID(projectId || ACME),
      data: data as never,
      props: { isRoot: true },
    }),
  );
};

const deleteSamlProvider: (providerId?: string) => Promise<string> = (
  providerId?: string,
): Promise<string> => {
  return outcomeOf(
    ProjectSsoService.deleteOneById({
      id: new ObjectID(providerId || OWN_SAML),
      props: { isRoot: true },
    }),
  );
};

const saveServerRule: (requireSsoForLogin: boolean) => Promise<string> = (
  requireSsoForLogin: boolean,
): Promise<string> => {
  return outcomeOf(
    GlobalConfigService.updateOneById({
      id: new ObjectID(CONFIG_ID),
      data: { requireSsoForLogin } as never,
      props: { isRoot: true },
    }),
  );
};

const turnOffGlobalProvider: () => Promise<string> = (): Promise<string> => {
  return outcomeOf(
    GlobalSsoService.updateOneById({
      id: new ObjectID(GLOBAL_SAML),
      data: { isEnabled: false } as never,
      props: { isRoot: true },
    }),
  );
};

/*
 * Starts a change, and lets it run until it is done or waits for a lock
 * another change holds: whether it waited, and what it ends with.
 */
const startUntilDoneOrWaiting: (
  run: () => Promise<string>,
) => Promise<{ outcome: Promise<string>; waited: boolean }> = async (
  run: () => Promise<string>,
): Promise<{ outcome: Promise<string>; waited: boolean }> => {
  let markWaiting: () => void = (): void => {
    return undefined;
  };

  const waiting: Promise<string> = new Promise<string>(
    (resolve: (state: string) => void): void => {
      markWaiting = (): void => {
        resolve("waiting");
      };
    },
  );

  locks.onWait = (): void => {
    markWaiting();
  };

  const outcome: Promise<string> = run();

  const state: string = await Promise.race([
    outcome.then((): string => {
      return "done";
    }),
    waiting,
  ]);

  locks.onWait = null;

  return { outcome, waited: state === "waiting" };
};

const ruleOf: (projectId?: string) => {
  requireSsoForLogin: unknown;
  requiredProviderId: string | null;
} = (
  projectId?: string,
): { requireSsoForLogin: unknown; requiredProviderId: string | null } => {
  const row: StoredRow = projects.get(projectId || ACME)!;
  const required: unknown = row["requireSsoWithSsoProviderId"];

  return {
    requireSsoForLogin: row["requireSsoForLogin"],
    requiredProviderId: required ? String(required).toLowerCase() : null,
  };
};

const keptForWrite: (key: string) => boolean = (key: string): boolean => {
  const holder: InMemoryLock | undefined = locks.holderOf(key);

  return Boolean(
    holder && ProjectSsoProviderChanges.isKeptForWrite(holder as never),
  );
};

beforeEach(() => {
  setTestBillingEnabled(false);

  whileCharging = null;
  whileCardCharged = null;
  nextProjectWriteFails = null;
  charges = [];

  for (const silenced of ["debug", "info", "warn", "error"]) {
    getJestSpyOn(logger, silenced).mockImplementation((): void => {
      return undefined;
    });
  }

  locks = new InMemoryLocks();
  locks.install();

  // Acme requires SSO, and its own SAML provider is its one way in.
  projects = useInMemoryTable(ProjectService, [
    projectRow(ACME, "Acme", { requireSsoForLogin: true }),
    projectRow(BETA, "Beta"),
  ]);
  samlProviders = useInMemoryTable(ProjectSsoService, [
    providerRow(OWN_SAML, ACME),
  ]);
  oidcProviders = useInMemoryTable(ProjectOidcService, []);
  globalSamlProviders = useInMemoryTable(GlobalSsoService, []);
  useInMemoryTable(GlobalOidcService, []);
  useInMemoryTable(GlobalSsoProjectService, []);
  useInMemoryTable(GlobalOidcProjectService, []);
  config = useInMemoryTable(GlobalConfigService, [
    { _id: CONFIG_ID, requireSsoForLogin: false },
  ]);

  // Every project write lands, unless the test says what the database answers instead.
  const write: (...args: Array<unknown>) => unknown =
    projects.repository.update.getMockImplementation()!;

  projects.repository.update.mockImplementation(
    async (...args: Array<unknown>): Promise<unknown> => {
      if (nextProjectWriteFails) {
        const failure: Error = nextProjectWriteFails;
        nextProjectWriteFails = null;
        throw failure;
      }

      return await write(...args);
    },
  );

  // The step between the check and the write, run once: the auto recharge charge.
  const charge: (...args: Array<unknown>) => Promise<void> = (
    ProjectService as unknown as {
      chargeAutoRechargeTurnedOn: (...args: Array<unknown>) => Promise<void>;
    }
  ).chargeAutoRechargeTurnedOn.bind(ProjectService);

  getJestSpyOn(ProjectService, "chargeAutoRechargeTurnedOn").mockImplementation(
    (async (...args: Array<unknown>): Promise<void> => {
      const landing: (() => Promise<void>) | null = whileCharging;
      whileCharging = null;

      await landing?.();
      await charge(...args);
    }) as never,
  );

  // The payment provider: a card on file, charged once per recharge.
  getJestSpyOn(BillingService, "hasPaymentMethods").mockResolvedValue(true);
  getJestSpyOn(
    BillingService,
    "generateInvoiceAndChargeCustomer",
  ).mockImplementation((async (
    customerId: string,
    _itemText: string,
    amountInUsd: number,
  ): Promise<void> => {
    const landing: (() => Promise<void>) | null = whileCardCharged;
    whileCardCharged = null;

    await landing?.();
    charges.push({ customerId, amountInUsd });
  }) as never);

  // The recharge's own lock and its memory of failures, in the shared cache.
  getJestSpyOn(Redis, "isConnected").mockReturnValue(true);
  getJestSpyOn(
    BalanceRechargeGuard.prototype,
    "forgetFailure",
  ).mockResolvedValue(undefined);
  getJestSpyOn(
    BalanceRechargeGuard.prototype,
    "rememberFailure",
  ).mockResolvedValue(undefined);

  // The balance is credited in one statement of its own, to whatever it is now.
  getJestSpyOn(
    ProjectService,
    "atomicAddToColumnsByIdAndGetValuesWithoutHooks",
  ).mockImplementation((async (input: {
    id: ObjectID;
    add: Record<string, number>;
    set?: Record<string, unknown>;
  }): Promise<Record<string, number> | null> => {
    const row: StoredRow | undefined = projects.get(input.id);

    if (!row) {
      return null;
    }

    const values: Record<string, number> = {};

    for (const [column, delta] of Object.entries(input.add)) {
      row[column] = Number(row[column] || 0) + delta;
      values[column] = row[column] as number;
    }

    Object.assign(row, input.set || {});

    return values;
  }) as never);

  getJestSpyOn(RealtimeAccessChanges, "announce").mockImplementation(
    (): void => {
      return undefined;
    },
  );

  const auditLogService: {
    recordUpdate: () => Promise<void>;
    recordDelete: () => Promise<void>;
  } =
    // eslint-disable-next-line @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires
    require("../../../Server/Services/AuditLogService").default;
  getJestSpyOn(auditLogService, "recordUpdate").mockResolvedValue(undefined);
  getJestSpyOn(auditLogService, "recordDelete").mockResolvedValue(undefined);
});

afterEach(async () => {
  // Nothing a test left kept alive outlives it.
  for (const key of [ACME, BETA, SERVER]) {
    const holder: InMemoryLock | undefined = locks.holderOf(key);

    if (holder) {
      await ProjectSsoProviderChanges.releaseSignInChange([holder as never]);
    }
  }

  setTestBillingEnabled(false);
  jest.restoreAllMocks();
});

describe("a save that writes Require SSO for Login on is checked and held until it is written, when the project requires SSO already too", () => {
  test("its last provider cannot be deleted while it is saved: a change that turns the rule off meanwhile takes no lock, and the delete waits for the save, then is refused", async () => {
    let deletion: { outcome: Promise<string>; waited: boolean } | null = null;

    whileCharging = async (): Promise<void> => {
      // Another admin turns Require SSO for Login off: it asks for less, and takes no lock.
      await expect(saveProject({ requireSsoForLogin: false })).resolves.toBe(
        "done",
      );
      expect(ruleOf().requireSsoForLogin).toBe(false);

      // ...and deletes the project's last provider, which nothing requires now.
      deletion = await startUntilDoneOrWaiting(() => {
        return deleteSamlProvider();
      });
    };

    await expect(saveProject({ requireSsoForLogin: true })).resolves.toBe(
      "done",
    );

    // The delete waited for the save, and was checked against what it wrote.
    expect(deletion!.waited).toBe(true);
    await expect(deletion!.outcome).resolves.toBe(LAST_SSO_PROVIDER_MESSAGE);

    // The project requires SSO, and keeps the provider people sign in with.
    expect(ruleOf().requireSsoForLogin).toBe(true);
    expect(samlProviders.get(OWN_SAML)).toBeDefined();
    expect(samlProviders.deletes).toEqual([]);
  });

  test("the save holds the project's lock from its check until it is written, and gives it back once", async () => {
    let heldWhileCharging: boolean = false;

    whileCharging = async (): Promise<void> => {
      heldWhileCharging = locks.isHeld(ACME) && keptForWrite(ACME);
    };

    await expect(saveProject({ requireSsoForLogin: true })).resolves.toBe(
      "done",
    );

    expect(heldWhileCharging).toBe(true);
    // Its own provider is on: the project's lock is enough, the server's rules are not locked.
    expect(locks.eventsOf("lock")).toEqual([`lock:${ACME}`]);
    expect(locks.eventsOf("release")).toEqual([`release:${ACME}`]);
    expect(locks.isHeld(ACME)).toBe(false);
  });

  test("saved again while its only provider is off, it is refused, as turning it on is", async () => {
    samlProviders.get(OWN_SAML)!["isEnabled"] = false;

    await expect(saveProject({ requireSsoForLogin: true })).resolves.toBe(
      NO_SSO_PROVIDER_TO_REQUIRE_MESSAGE,
    );

    // Checked under the project's lock and the server's, both given back; nothing written.
    expect(locks.eventsOf("lock")).toEqual([`lock:${ACME}`, `lock:${SERVER}`]);
    expect(locks.eventsOf("release")).toEqual([
      `release:${ACME}`,
      `release:${SERVER}`,
    ]);
    expect(
      projects.updates.filter((update: { set: StoredRow }): boolean => {
        return update.set["requireSsoForLogin"] !== undefined;
      }),
    ).toEqual([]);
  });

  test("saved together with other settings, it is checked the same way", async () => {
    samlProviders.get(OWN_SAML)!["isEnabled"] = false;

    await expect(
      saveProject({ name: "Acme Renamed", requireSsoForLogin: true }),
    ).resolves.toBe(NO_SSO_PROVIDER_TO_REQUIRE_MESSAGE);

    expect(projects.get(ACME)!["name"]).toBe("Acme");
  });

  test("a save that leaves Require SSO for Login alone takes no lock", async () => {
    await expect(saveProject({ name: "Acme Renamed" })).resolves.toBe("done");

    expect(locks.events).toEqual([]);
  });

  test("turning it off is never refused and takes no lock, with no provider left at all", async () => {
    samlProviders.rows = [];

    await expect(saveProject({ requireSsoForLogin: false })).resolves.toBe(
      "done",
    );

    expect(locks.events).toEqual([]);
  });
});

describe("a save that names the provider a project requires is checked and held until it is written, when the project requires it already too", () => {
  beforeEach(() => {
    // Acme requires SSO with its SAML provider; its OIDC provider is on too.
    projects.get(ACME)!["requireSsoWithSsoProviderId"] = new ObjectID(OWN_SAML);
    oidcProviders.rows = [providerRow(OWN_OIDC, ACME)];
  });

  test("the provider it requires cannot be deleted while it is saved: a change that clears it meanwhile takes no lock, and the delete waits for the save, then is refused", async () => {
    let deletion: { outcome: Promise<string>; waited: boolean } | null = null;

    whileCharging = async (): Promise<void> => {
      // Another admin clears the provider the project requires: it asks for less, and takes no lock.
      await expect(
        saveProject({ requireSsoWithSsoProviderId: null }),
      ).resolves.toBe("done");

      // ...and deletes that provider, which nothing requires now.
      deletion = await startUntilDoneOrWaiting(() => {
        return deleteSamlProvider();
      });
    };

    await expect(
      saveProject({ requireSsoWithSsoProviderId: new ObjectID(OWN_SAML) }),
    ).resolves.toBe("done");

    expect(deletion!.waited).toBe(true);
    await expect(deletion!.outcome).resolves.toBe(
      REQUIRED_SSO_PROVIDER_MESSAGE,
    );

    // The project requires its SAML provider, and the provider is there.
    expect(ruleOf().requiredProviderId).toBe(OWN_SAML);
    expect(samlProviders.get(OWN_SAML)).toBeDefined();
  });

  test("naming a provider that cannot sign anyone in to it is refused, when the project names it already too", async () => {
    projects.get(ACME)!["requireSsoWithSsoProviderId"] = new ObjectID(
      UNKNOWN_PROVIDER,
    );

    await expect(
      saveProject({
        requireSsoForLogin: true,
        requireSsoWithSsoProviderId: new ObjectID(UNKNOWN_PROVIDER),
      }),
    ).resolves.toBe(REQUIRED_PROVIDER_CANNOT_SIGN_IN_MESSAGE);

    expect(locks.isHeld(ACME)).toBe(false);
    expect(locks.isHeld(SERVER)).toBe(false);
  });

  test("clearing it is never refused and takes no lock", async () => {
    await expect(
      saveProject({ requireSsoWithSsoProviderId: null }),
    ).resolves.toBe("done");

    expect(locks.events).toEqual([]);
    expect(ruleOf().requiredProviderId).toBeNull();
  });
});

describe("the server's Require SSO for Login saved on again", () => {
  beforeEach(() => {
    config.get(CONFIG_ID)!["requireSsoForLogin"] = true;
  });

  test("is checked as turning it on is: refused while a project has no way in, naming it", async () => {
    // Beta has no provider of its own, and no global provider reaches it.
    await expect(saveServerRule(true)).resolves.toBe(
      'The project "Beta" has no SSO provider people can sign in with, so requiring SSO for everyone would lock its members out. Turn on a global SSO provider, or an SSO provider in that project, first.',
    );

    expect(locks.eventsOf("lock")).toEqual([`lock:${SERVER}`]);
    expect(locks.eventsOf("release")).toEqual([`release:${SERVER}`]);
    expect(config.updates).toEqual([]);
  });

  test("holds the lock on the server's sign-in rules until it is written: a global provider turned off meanwhile waits, and is then checked against the rule that landed", async () => {
    // A global provider that signs people in to every project: Beta's only way in.
    globalSamlProviders.rows = [
      {
        _id: GLOBAL_SAML,
        isEnabled: true,
        restrictToAttachedProjects: false,
        name: "Company IdP",
        signInsEndedAt: null,
      },
    ];

    let turningOff: { outcome: Promise<string>; waited: boolean } | null = null;

    // The step between the server's check and its write.
    const rememberServerRuleBefore: (...args: Array<unknown>) => Promise<void> =
      SsoRequirementChanges.rememberServerRuleBefore.bind(
        SsoRequirementChanges,
      ) as unknown as (...args: Array<unknown>) => Promise<void>;
    let hasLanded: boolean = false;

    getJestSpyOn(
      SsoRequirementChanges,
      "rememberServerRuleBefore",
    ).mockImplementation((async (...args: Array<unknown>): Promise<void> => {
      await rememberServerRuleBefore(...args);

      if (hasLanded) {
        return;
      }

      hasLanded = true;

      // Another admin turns the server's rule off: it asks for less, and takes no lock.
      await expect(saveServerRule(false)).resolves.toBe("done");

      // ...and turns off the global provider, which nothing seems to need now.
      turningOff = await startUntilDoneOrWaiting(() => {
        return turnOffGlobalProvider();
      });
    }) as never);

    await expect(saveServerRule(true)).resolves.toBe("done");

    expect(turningOff!.waited).toBe(true);
    await expect(turningOff!.outcome).resolves.toBe(
      'This server requires SSO for everyone, and this change would leave the project "Beta" with no SSO provider people can sign in with. Turn on another SSO provider for it first.',
    );

    expect(config.get(CONFIG_ID)!["requireSsoForLogin"]).toBe(true);
    expect(globalSamlProviders.get(GLOBAL_SAML)!["isEnabled"]).toBe(true);
  });

  test("turning it off is never refused and takes no lock", async () => {
    await expect(saveServerRule(false)).resolves.toBe("done");

    expect(locks.events).toEqual([]);
  });
});

describe("a lock found gone right before the write is taken again, and the change checked again under it", () => {
  test("lost while the auto recharge is charged, with no other change meanwhile: the project is read and checked again under the lock taken again, and written", async () => {
    whileCharging = async (): Promise<void> => {
      locks.lose(ACME);
    };

    await expect(saveProject({ requireSsoForLogin: true })).resolves.toBe(
      "done",
    );

    expect(ruleOf().requireSsoForLogin).toBe(true);
    expect(locks.events).toEqual([
      `lock:${ACME}`,
      // The check is done.
      `keep:${ACME}`,
      // During the charge.
      `lost:${ACME}`,
      // Right before the write: gone. Taken again, checked again, kept.
      `keep:${ACME}`,
      `release:${ACME}`,
      `lock:${ACME}`,
      `keep:${ACME}`,
      // Written, and given back.
      `release:${ACME}`,
    ]);
    expect(locks.isHeld(ACME)).toBe(false);
  });

  test("lost, and its last provider deleted meanwhile: the change is refused under the lock taken again, and nothing is written", async () => {
    projects.get(ACME)!["requireSsoForLogin"] = false;

    whileCharging = async (): Promise<void> => {
      locks.lose(ACME);

      // Nothing requires SSO yet, and the lock is free: the provider goes.
      await expect(deleteSamlProvider()).resolves.toBe("done");
    };

    await expect(saveProject({ requireSsoForLogin: true })).resolves.toBe(
      NO_SSO_PROVIDER_TO_REQUIRE_MESSAGE,
    );

    expect(ruleOf().requireSsoForLogin).toBe(false);
    expect(locks.isHeld(ACME)).toBe(false);
    expect(locks.isHeld(SERVER)).toBe(false);
  });

  test("lost, and held by another change for longer than a change waits by then: the change is refused, and nothing is written", async () => {
    projects.get(ACME)!["requireSsoForLogin"] = false;

    whileCharging = async (): Promise<void> => {
      locks.lose(ACME);
      locks.busy.add(ACME);
    };

    await expect(saveProject({ requireSsoForLogin: true })).resolves.toBe(
      PROVIDER_CHANGE_IN_PROGRESS_MESSAGE,
    );

    expect(ruleOf().requireSsoForLogin).toBe(false);
    expect(locks.isHeld(ACME)).toBe(false);
  });

  test("lost again by the time it is taken again and checked: the change is refused, and nothing is held", async () => {
    projects.get(ACME)!["requireSsoForLogin"] = false;

    whileCharging = async (): Promise<void> => {
      locks.lose(ACME);

      // Lost once more, the moment it has been taken again and the project read under it.
      const findRowsAndHoldUpdateToThem: (
        ...args: Array<unknown>
      ) => Promise<unknown> = ProjectService.findRowsAndHoldUpdateToThem.bind(
        ProjectService,
      ) as unknown as (...args: Array<unknown>) => Promise<unknown>;
      let reads: number = 0;

      getJestSpyOn(
        ProjectService,
        "findRowsAndHoldUpdateToThem",
      ).mockImplementation((async (
        ...args: Array<unknown>
      ): Promise<unknown> => {
        const answer: unknown = await findRowsAndHoldUpdateToThem(...args);
        reads++;

        // The read that picks the projects to lock, then the read under the lock.
        if (reads === 2) {
          locks.lose(ACME);
        }

        return answer;
      }) as never);
    };

    await expect(saveProject({ requireSsoForLogin: true })).resolves.toBe(
      "Another change to who can sign in with SSO is being saved. Try again in a moment.",
    );

    expect(ruleOf().requireSsoForLogin).toBe(false);
    expect(locks.isHeld(ACME)).toBe(false);
  });

  test("a provider turned off, whose lock is lost before it is written, is checked again and written", async () => {
    // A second SAML provider on: the project keeps a way in.
    samlProviders.rows.push(providerRow(id(13), ACME));

    const checkUpdateQueryPermissions: (
      ...args: Array<unknown>
    ) => Promise<unknown> = ModelPermission.checkUpdateQueryPermissions.bind(
      ModelPermission,
    ) as unknown as (...args: Array<unknown>) => Promise<unknown>;

    // Between the provider's check (onBeforeUpdate) and its write.
    getJestSpyOn(
      ModelPermission,
      "checkUpdateQueryPermissions",
    ).mockImplementation((async (...args: Array<unknown>): Promise<unknown> => {
      locks.lose(ACME);
      return await checkUpdateQueryPermissions(...args);
    }) as never);

    await expect(
      outcomeOf(
        ProjectSsoService.updateOneById({
          id: new ObjectID(OWN_SAML),
          data: { isEnabled: false } as never,
          props: { isRoot: true },
        }),
      ),
    ).resolves.toBe("done");

    expect(samlProviders.get(OWN_SAML)!["isEnabled"]).toBe(false);
    // Turned off in the same write that says when its sign-ins ended.
    expect(samlProviders.get(OWN_SAML)!["signInsEndedAt"]).toBeInstanceOf(Date);
    expect(
      locks.events.filter((event: string): boolean => {
        return event === `lock:${ACME}`;
      }),
    ).toHaveLength(2);
    expect(locks.isHeld(ACME)).toBe(false);
  });
});

describe("an auto recharge charged while a change to who can sign in is saved", () => {
  beforeEach(() => {
    setTestBillingEnabled(true);
    projects.get(ACME)!["requireSsoForLogin"] = false;
  });

  const turnOnSsoAndAutoRecharge: () => Promise<string> =
    (): Promise<string> => {
      return saveProject({
        requireSsoForLogin: true,
        enableAutoRechargeSmsOrCallBalance: true,
        autoRechargeSmsOrCallByBalanceInUSD: 20,
        autoRechargeSmsOrCallWhenCurrentBalanceFallsInUSD: 10,
      });
    };

  test("a charge slow enough for the lock to be lost, with no other change meanwhile: the change is checked again and written, and the balance credited", async () => {
    whileCardCharged = async (): Promise<void> => {
      locks.lose(ACME);
    };

    await expect(turnOnSsoAndAutoRecharge()).resolves.toBe("done");

    expect(charges).toEqual([{ customerId: "cus_acme", amountInUsd: 20 }]);
    expect(projects.get(ACME)!["smsOrCallCurrentBalanceInUSDCents"]).toBe(2000);
    expect(ruleOf().requireSsoForLogin).toBe(true);
    expect(projects.get(ACME)!["enableAutoRechargeSmsOrCallBalance"]).toBe(
      true,
    );
  });

  test("a charge slow enough for the lock to be lost, and the last provider deleted meanwhile: the change is refused - and the balance the charge bought stays the project's", async () => {
    whileCardCharged = async (): Promise<void> => {
      locks.lose(ACME);

      // Nothing requires SSO yet, and the lock is free: the provider goes.
      await expect(deleteSamlProvider()).resolves.toBe("done");
    };

    await expect(turnOnSsoAndAutoRecharge()).resolves.toBe(
      NO_SSO_PROVIDER_TO_REQUIRE_MESSAGE,
    );

    // Charged once, and credited in a write of its own: refusing the change takes nothing back.
    expect(charges).toEqual([{ customerId: "cus_acme", amountInUsd: 20 }]);
    expect(projects.get(ACME)!["smsOrCallCurrentBalanceInUSDCents"]).toBe(2000);

    // The change itself was not written: Require SSO for Login and auto recharge stay off.
    expect(ruleOf().requireSsoForLogin).toBe(false);
    expect(projects.get(ACME)!["enableAutoRechargeSmsOrCallBalance"]).toBe(
      false,
    );
    expect(locks.isHeld(ACME)).toBe(false);
  });

  test("a charge that fails refuses the change and gives its locks back, as before", async () => {
    getJestSpyOn(
      BillingService,
      "generateInvoiceAndChargeCustomer",
    ).mockRejectedValue(new BadDataException("Your card was declined."));
    // The owners were told about the card today already.
    getJestSpyOn(
      BillingFailureNoticeThrottle,
      "shouldSendBillingFailureNotice",
    ).mockResolvedValue(false);

    await expect(turnOnSsoAndAutoRecharge()).resolves.toBe(
      "Your card was declined.",
    );

    expect(projects.get(ACME)!["smsOrCallCurrentBalanceInUSDCents"]).toBe(0);
    expect(ruleOf().requireSsoForLogin).toBe(false);
    expect(locks.isHeld(ACME)).toBe(false);
  });
});

describe("a write the database never answered keeps its locks until the database would have cancelled it", () => {
  test("the client stopped waiting for the statement: the locks are not given back, and a provider delete waits for them", async () => {
    nextProjectWriteFails = clientTimeout();

    await expect(saveProject({ requireSsoForLogin: true })).rejects.toThrow(
      "Query read timeout",
    );

    // Not given back: kept, until the database would have cancelled the statement.
    expect(locks.eventsOf("release")).toEqual([]);
    expect(locks.isHeld(ACME)).toBe(true);
    expect(keptForWrite(ACME)).toBe(true);

    const deletion: { outcome: Promise<string>; waited: boolean } =
      await startUntilDoneOrWaiting(() => {
        return deleteSamlProvider();
      });

    expect(deletion.waited).toBe(true);

    // The statement can no longer land: the lock runs out, and the delete is checked.
    locks.lose(ACME);

    await expect(deletion.outcome).resolves.toBe(LAST_SSO_PROVIDER_MESSAGE);
  });

  test("the connection was lost while the statement ran: kept the same way", async () => {
    nextProjectWriteFails = connectionLost();

    await expect(saveProject({ requireSsoForLogin: true })).rejects.toThrow(
      "Connection terminated unexpectedly",
    );

    expect(locks.eventsOf("release")).toEqual([]);
    expect(keptForWrite(ACME)).toBe(true);
  });

  test("a read whose answer never came - one the write makes before its UPDATE - applied nothing: the locks are given back at once", async () => {
    nextProjectWriteFails = clientTimeout(SELECT_STATEMENT);

    await expect(saveProject({ requireSsoForLogin: true })).rejects.toThrow(
      "Query read timeout",
    );

    expect(locks.eventsOf("release")).toEqual([`release:${ACME}`]);
    expect(locks.isHeld(ACME)).toBe(false);

    await expect(deleteSamlProvider()).resolves.toBe(LAST_SSO_PROVIDER_MESSAGE);
  });

  test("the database answered with an error of its own - it cancelled the statement at its timeout: nothing was written, and the locks are given back at once", async () => {
    nextProjectWriteFails = cancelledByDatabase();

    await expect(saveProject({ requireSsoForLogin: true })).rejects.toThrow(
      "canceling statement due to statement timeout",
    );

    expect(locks.eventsOf("release")).toEqual([`release:${ACME}`]);
    expect(locks.isHeld(ACME)).toBe(false);

    // Another change goes on at once.
    await expect(deleteSamlProvider()).resolves.toBe(LAST_SSO_PROVIDER_MESSAGE);
  });

  test("a statement around the write that was never answered - one a step before the UPDATE sent - applied nothing of it: the locks are given back at once, whatever its first word", async () => {
    // The step between the check and the write, failed on a write of its own the client stopped waiting for.
    getJestSpyOn(
      ProjectService,
      "chargeAutoRechargeTurnedOn",
    ).mockRejectedValueOnce(
      clientTimeout(
        'UPDATE "Project" SET "smsOrCallCurrentBalanceInUSDCents" = $1 WHERE "_id" = $2',
      ) as never,
    );

    await expect(saveProject({ requireSsoForLogin: true })).rejects.toThrow(
      "Query read timeout",
    );

    // DatabaseService said it was around the write: the change itself was never sent.
    expect(locks.eventsOf("release")).toEqual([`release:${ACME}`]);
    expect(locks.isHeld(ACME)).toBe(false);
    expect(keptForWrite(ACME)).toBe(false);

    await expect(deleteSamlProvider()).resolves.toBe(LAST_SSO_PROVIDER_MESSAGE);
  });

  test("a project provider's write the client stopped waiting for keeps its project's lock too", async () => {
    samlProviders.rows.push(providerRow(id(13), ACME));

    samlProviders.repository.update.mockImplementationOnce(
      async (): Promise<never> => {
        throw clientTimeout();
      },
    );

    await expect(
      ProjectSsoService.updateOneById({
        id: new ObjectID(OWN_SAML),
        data: { isEnabled: false } as never,
        props: { isRoot: true },
      }),
    ).rejects.toThrow("Query read timeout");

    expect(locks.isHeld(ACME)).toBe(true);
    expect(keptForWrite(ACME)).toBe(true);
  });

  test("the server's rule, written on and never answered, keeps the lock on the server's sign-in rules", async () => {
    globalSamlProviders.rows = [
      {
        _id: GLOBAL_SAML,
        isEnabled: true,
        restrictToAttachedProjects: false,
        name: "Company IdP",
        signInsEndedAt: null,
      },
    ];

    config.repository.update.mockImplementationOnce(
      async (): Promise<never> => {
        throw clientTimeout();
      },
    );

    await expect(
      GlobalConfigService.updateOneById({
        id: new ObjectID(CONFIG_ID),
        data: { requireSsoForLogin: true } as never,
        props: { isRoot: true },
      }),
    ).rejects.toThrow("Query read timeout");

    expect(locks.isHeld(SERVER)).toBe(true);
    expect(keptForWrite(SERVER)).toBe(true);
  });
});
