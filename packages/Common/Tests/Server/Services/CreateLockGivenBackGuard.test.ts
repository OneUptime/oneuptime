import {
  ClassSource,
  callArguments,
  hasMethod,
  methodText,
  readClassSource,
  reachableText,
} from "../TestingUtils/ClassSource";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * A CREATE THAT TAKES A LOCK GIVES IT BACK, HOWEVER IT ENDS.
 *
 * A service whose create hooks take a lock - a state timeline takes its
 * event's in onBeforeCreate, ProjectService and a global SSO provider's
 * attachments the server's sign-in rules in onCreatePermitted - gives it
 * back in onCreateSuccess once the record is
 * saved. A create refused or failed after the lock was taken never gets
 * there: a check DatabaseService.create runs after the hooks, the INSERT,
 * or a success hook that throws before it gives the lock back. Such a lock
 * was never given back, and redis-semaphore keeps refreshing a lock for as
 * long as the process lives: every later change to the same event waited
 * out the acquire timeout and then went ahead unlocked (or, for a monitor,
 * was refused).
 *
 * DatabaseService.create now runs every step in one try and keeps one
 * OnCreate for the whole create - the object onBeforeCreate hands back is the
 * very one onCreatePermitted, onCreateSuccess and onCreateError are handed -
 * so the rule is:
 *
 *   - every service that takes a lock in a create hook gives it back in
 *     onCreateSuccess AND in onCreateError (which takes the OnCreate);
 *   - it gives it back through that one object - by the OnCreate itself, or
 *     what it carries forward - never by the create the OnCreate holds, which
 *     onBeforeCreate may hand back anew: a lock looked up by the create
 *     onBeforeCreate returned was found only while that happened to be the
 *     create onCreatePermitted was handed;
 *   - no service holds a lock around create() itself (a try/finally of its
 *     own): the hooks own it, the same way for every service;
 *   - DatabaseService hands every failure of a create to onCreateError, with
 *     the create's one OnCreate - and which step of the create failed
 *     (WriteProgress: the INSERT itself, or a step around it), for a hook
 *     whose lock is kept while the create may still land.
 *
 * A service that starts taking a lock in a create hook must be added to the
 * list below - and give it back in both hooks.
 */

// packages/Common/Tests/Server/Services -> packages/Common
const COMMON_DIR: string = path.resolve(__dirname, "..", "..", "..");
const SERVICES_DIR: string = path.join(COMMON_DIR, "Server", "Services");

// The create hooks that run before the record is written.
const HOOKS_THAT_TAKE: Array<string> = ["onBeforeCreate", "onCreatePermitted"];

/*
 * Taking a lock, by hand or through the helpers that do. A global SSO
 * provider's attachment takes the one on the server's sign-in rules for its
 * check (GlobalSsoProviderChanges.beforeAttachmentCreate), and keeps it
 * alive while it is written (ProjectSsoProviderChanges.holdForWrite): one
 * nobody gave back would be kept alive for minutes.
 */
const TAKES_A_LOCK: RegExp =
  /\b(Semaphore\.lock|StateChangeLock\.take|SsoRequirementChanges\.beforeProjectCreate|ProjectSsoProviderChanges\.lockSignInChange|GlobalSsoProviderChanges\.beforeAttachmentCreate|AiCommandCredentialReach\.take)\s*\(/;

/*
 * Giving one back. A sign-in change's lock is handed back after a failed
 * create through the helpers that give it back - or, when the database may
 * still apply the create (its COMMIT went unanswered), keep it until it
 * would have cancelled it, and then let it run out (SsoRequirementChanges.
 * afterFailedProjectCreate, GlobalSsoProviderChanges.afterFailedCreate;
 * SsoFailedWriteLocksGuard holds every error hook of a sign-in change to
 * handing them what failed).
 */
const GIVES_IT_BACK: RegExp =
  /\b(Semaphore\.release|StateChangeLock\.giveBack|StateChangeLock\.giveBackFor|SsoRequirementChanges\.afterProjectCreate|SsoRequirementChanges\.afterFailedProjectCreate|ProjectSsoProviderChanges\.releaseSignInChange|GlobalSsoProviderChanges\.afterWrite|GlobalSsoProviderChanges\.afterFailedWrite|GlobalSsoProviderChanges\.afterFailedCreate|AiCommandCredentialReach\.giveBack|AiCommandCredentialReach\.giveBackAfterCreate|AiCommandCredentialReach\.giveBackAfterFailedCreate)\s*\(/;

/*
 * onCreateError takes what onBeforeCreate handed back - and, where the hook
 * decides by it, which step of the create failed.
 */
const ERROR_HOOK_TAKES_THE_CREATE: RegExp =
  /onCreateError\(\s*error: Exception,\s*onCreate\?: OnCreate<\w+> \| undefined,?\s*(failedStatement\?: StatementContext \| undefined,?\s*)?\)/;

/*
 * Every service whose create hooks take a lock, and what it locks.
 */
const LOCKING_CREATES: Record<string, string> = {
  "AlertEpisodeStateTimelineService.ts": "the alert episode",
  "AlertStateTimelineService.ts": "the alert",
  "GlobalOidcProjectService.ts": "the server's sign-in rules",
  "GlobalSsoProjectService.ts": "the server's sign-in rules",
  "IncidentEpisodeStateTimelineService.ts": "the incident episode",
  "IncidentStateTimelineService.ts": "the incident",
  "MonitorStatusTimelineService.ts": "the monitor (failing closed)",
  "ProjectService.ts": "the server's sign-in rules",
  "RunbookCredentialService.ts":
    "the project's runbook credentials and AI Runners (failing closed)",
  "ScheduledMaintenanceStateTimelineService.ts":
    "the scheduled maintenance event",
};

// The create hooks that run once onBeforeCreate has handed back the create's one OnCreate.
const HOOKS_HANDED_THE_ONE_ONCREATE: Array<string> = [
  "onCreatePermitted",
  "onCreateSuccess",
  "onCreateError",
];

/*
 * The create a hook's OnCreate holds, handed as the key where a lock is taken
 * or given back: `onCreate.createBy`, `onCreate?.createBy`, cast or not - but
 * not a value read from it for the log (`onCreate?.createBy.data.projectId`).
 */
const KEYED_BY_THE_CREATE_IT_HOLDS: RegExp =
  /\bonCreate\s*\??\.\s*createBy\b(?!\s*\??\.)/;

// A call argument that is the OnCreate itself, as a whole argument or a property's value.
const NAMES_THE_ONCREATE: RegExp = /(^|[\s,(:])onCreate\s*(,|$|\))/;

// The arguments of every call in `text` that takes or gives back a lock.
function lockCallArguments(text: string): Array<string> {
  return [
    ...callArguments(
      text,
      new RegExp(TAKES_A_LOCK.source.replace(/\\s\*\\\($/, "")),
    ),
    ...callArguments(
      text,
      new RegExp(GIVES_IT_BACK.source.replace(/\\s\*\\\($/, "")),
    ),
  ];
}

// The state timelines that go ahead unlocked without Valkey (StateChangeLock).
const STATE_TIMELINES: Array<string> = [
  "AlertEpisodeStateTimelineService.ts",
  "AlertStateTimelineService.ts",
  "IncidentEpisodeStateTimelineService.ts",
  "IncidentStateTimelineService.ts",
  "ScheduledMaintenanceStateTimelineService.ts",
];

function serviceFiles(): Array<string> {
  return fs
    .readdirSync(SERVICES_DIR)
    .filter((file: string): boolean => {
      return file.endsWith(".ts");
    })
    .sort();
}

const SOURCES: Map<string, ClassSource> = new Map(
  serviceFiles().map((file: string): [string, ClassSource] => {
    return [file, readClassSource(path.join(SERVICES_DIR, file))];
  }),
);

function takesALockInACreateHook(classSource: ClassSource): boolean {
  return HOOKS_THAT_TAKE.some((hook: string): boolean => {
    return TAKES_A_LOCK.test(reachableText(classSource, hook));
  });
}

describe("every service that takes a lock in a create hook is listed here", () => {
  test("the services whose create hooks take a lock are exactly the listed ones", () => {
    const takers: Array<string> = Array.from(SOURCES.entries())
      .filter(([, classSource]: [string, ClassSource]): boolean => {
        return takesALockInACreateHook(classSource);
      })
      .map(([file]: [string, ClassSource]): string => {
        return file;
      })
      .sort();

    expect(takers).toEqual(Object.keys(LOCKING_CREATES).sort());
  });
});

describe.each(Object.keys(LOCKING_CREATES))(
  "%s gives its lock back however the create ends",
  (file: string) => {
    const classSource: ClassSource = SOURCES.get(file)!;

    test("once the record is saved: in onCreateSuccess", () => {
      expect(hasMethod(classSource, "onCreateSuccess")).toBe(true);
      expect(reachableText(classSource, "onCreateSuccess")).toMatch(
        GIVES_IT_BACK,
      );
    });

    test("once the create is refused or fails after the hook: in onCreateError, which takes the create's one OnCreate", () => {
      expect(hasMethod(classSource, "onCreateError")).toBe(true);
      expect(methodText(classSource, "onCreateError")).toMatch(
        ERROR_HOOK_TAKES_THE_CREATE,
      );
      expect(reachableText(classSource, "onCreateError")).toMatch(
        GIVES_IT_BACK,
      );
    });

    test("and holds no lock around create() itself", () => {
      const create: string = reachableText(classSource, "create");

      expect(create).not.toMatch(TAKES_A_LOCK);
      expect(create).not.toMatch(GIVES_IT_BACK);
      expect(methodText(classSource, "create")).not.toMatch(/\bfinally\b/);
    });
  },
);

describe.each(Object.keys(LOCKING_CREATES))(
  "%s gives its lock back through the create's one OnCreate, never through the create it holds",
  (file: string) => {
    const classSource: ClassSource = SOURCES.get(file)!;

    test.each(HOOKS_HANDED_THE_ONE_ONCREATE)(
      "%s takes and gives back its locks by the OnCreate or what it carries forward",
      (hook: string) => {
        const calls: Array<string> = lockCallArguments(
          reachableText(classSource, hook),
        );

        for (const call of calls) {
          // Never the create the OnCreate holds...
          expect([hook, call, KEYED_BY_THE_CREATE_IT_HOLDS.test(call)]).toEqual(
            [hook, call, false],
          );
        }
      },
    );

    test("every lock call of its success and error hooks names the OnCreate itself", () => {
      for (const hook of ["onCreateSuccess", "onCreateError"]) {
        const calls: Array<string> = lockCallArguments(
          methodText(classSource, hook),
        );

        expect([hook, calls.length > 0]).toEqual([hook, true]);

        for (const call of calls) {
          // ...but the OnCreate, as a whole argument.
          expect([hook, call, NAMES_THE_ONCREATE.test(call)]).toEqual([
            hook,
            call,
            true,
          ]);
        }
      }
    });
  },
);

describe("the helpers that hold a create's sign-in lock keep it by the create's one OnCreate", () => {
  const UTILS_DIR: string = path.join(COMMON_DIR, "Server", "Utils");
  const requirement: ClassSource = readClassSource(
    path.join(UTILS_DIR, "SsoRequirementChanges.ts"),
  );
  const globalProviders: ClassSource = readClassSource(
    path.join(UTILS_DIR, "GlobalSsoProviderChanges.ts"),
  );

  test("a project's create: SsoRequirementChanges is handed the OnCreate, and keeps the lock by it", () => {
    expect(methodText(requirement, "beforeProjectCreate")).toMatch(
      /create:\s*OnCreate<Project>;/,
    );
    expect(methodText(requirement, "beforeProjectCreate")).toMatch(
      /key:\s*data\.create as unknown as OnCreate<BaseModel>,/,
    );
    expect(methodText(requirement, "afterProjectCreate")).toMatch(
      /create:\s*OnCreate<Project> \| null \| undefined,/,
    );
    expect(methodText(requirement, "afterFailedProjectCreate")).toMatch(
      /create:\s*OnCreate<Project> \| null \| undefined,/,
    );
    expect(requirement.source).not.toMatch(/\bCreateBy\b/);
  });

  test("a global provider's attachment: GlobalSsoProviderChanges is handed the OnCreate, and keeps the lock by it", () => {
    expect(methodText(globalProviders, "beforeAttachmentCreate")).toMatch(
      /create:\s*OnCreate<BaseModel>;/,
    );
    expect(methodText(globalProviders, "beforeAttachmentCreate")).toMatch(
      /key:\s*keyOf\(data\.create\),/,
    );
    expect(methodText(globalProviders, "afterFailedCreate")).toMatch(
      /create:\s*OnCreate<TModel>,/,
    );
    expect(globalProviders.source).toMatch(
      /type WriteKey = UpdateBy<BaseModel> \| DeleteBy<BaseModel> \| OnCreate<BaseModel>;/,
    );
    expect(globalProviders.source).not.toMatch(/\bCreateBy\b/);
  });
});

describe.each(STATE_TIMELINES)(
  "%s takes its event's lock through StateChangeLock",
  (file: string) => {
    const classSource: ClassSource = SOURCES.get(file)!;
    const onBeforeCreate: string = reachableText(classSource, "onBeforeCreate");

    test("once, in onBeforeCreate, and never with Semaphore by hand", () => {
      expect(
        (onBeforeCreate.match(/StateChangeLock\.take\s*\(/g) || []).length,
      ).toBe(1);
      expect(classSource.source).not.toMatch(
        /\bSemaphore\.(lock|release)\s*\(/,
      );
    });

    test("and gives it back from onBeforeCreate when the hook itself refuses the change, once it is taken", () => {
      expect(onBeforeCreate).toMatch(/StateChangeLock\.giveBack\s*\(\s*mutex/);
    });

    test("and in onCreateError, the lock its create carried forward", () => {
      expect(methodText(classSource, "onCreateError")).toMatch(
        /StateChangeLock\.giveBackFor\s*\(\s*onCreate\s*,/,
      );
    });
  },
);

describe.each([...STATE_TIMELINES, "MonitorStatusTimelineService.ts"])(
  "%s gives its lock back once",
  (file: string) => {
    const classSource: ClassSource = SOURCES.get(file)!;

    /*
     * Through the create, which then carries no lock: a success hook that
     * gave it back and failed after (a note that could not be posted once
     * the change was saved) reaches onCreateError with the same create.
     */
    test("onCreateSuccess gives back the lock its create carried forward, not a copy of it", () => {
      const onCreateSuccess: string = methodText(
        classSource,
        "onCreateSuccess",
      );

      expect(onCreateSuccess).toMatch(
        /StateChangeLock\.giveBackFor\s*\(\s*onCreate\s*,/,
      );
      expect(onCreateSuccess).not.toMatch(/\bcarryForward\.mutex\b/);
      expect(onCreateSuccess).not.toMatch(/StateChangeLock\.giveBack\s*\(/);
    });
  },
);

describe("no service holds a lock around create() itself", () => {
  test("no create() override takes or gives back a lock", () => {
    const holders: Array<string> = [];

    for (const [file, classSource] of SOURCES.entries()) {
      if (file === "DatabaseService.ts" || !hasMethod(classSource, "create")) {
        continue;
      }

      const create: string = reachableText(classSource, "create");

      if (TAKES_A_LOCK.test(create) || GIVES_IT_BACK.test(create)) {
        holders.push(file);
      }
    }

    expect(holders).toEqual([]);
  });
});

describe("DatabaseService hands every failure of a create to onCreateError", () => {
  const classSource: ClassSource = SOURCES.get("DatabaseService.ts")!;
  const create: string = methodText(classSource, "create");
  const createItself: string = methodText(classSource, "_create");

  test("create runs the create itself in one try, and hands what fails to onCreateError with what onBeforeCreate handed back, and which step failed", () => {
    expect(create).toMatch(
      /try\s*\{\s*return await this\._create\(createBy, handedBack\);\s*\}\s*catch \(error\)\s*\{\s*await this\.onCreateError\(\s*error as Exception,\s*handedBack\.onCreate,\s*handedBack\.progress\.getFailedStatement\(\),?\s*\);\s*throw this\.getException\(error as Exception\);\s*\}/,
    );
    // One record of the create's steps, from its start.
    expect(create).toMatch(
      /handedBack: CreateHandedBack<TBaseModel> = \{\s*onCreate: undefined,\s*progress: new WriteProgress\(\),?\s*\}/,
    );
  });

  test("the INSERT is recorded as the create's write, in save()'s own transaction", () => {
    const writes: Array<string> = callArguments(
      createItself,
      /handedBack\.progress\.write/,
    );

    expect(writes).toHaveLength(1);
    expect(writes[0]!).toMatch(
      /^\s*true,\s*async \(\): Promise<TBaseModel> => \{\s*return await this\.getRepository\(\)\.save\(createBy\.data\);\s*\},?\s*$/,
    );
    // The one save() of the create is that one.
    expect(
      (createItself.match(/\.getRepository\(\)\s*\.\s*save\s*\(/g) || [])
        .length,
    ).toBe(1);
  });

  test("what onBeforeCreate hands back is handed on as soon as it has run", () => {
    expect(createItself).toMatch(
      /:\s*await this\._onBeforeCreate\(createBy\);\s*handedBack\.onCreate = onCreate;/,
    );
  });

  test("onCreatePermitted and onCreateSuccess are handed that very OnCreate - the one onCreateError is handed - never an object of their own", () => {
    expect(callArguments(createItself, /this\.onCreatePermitted/)).toEqual([
      "onCreate",
    ]);
    expect(
      callArguments(createItself, /this\.onCreateSuccess/).map(
        (call: string): string => {
          return call.replace(/\s+/g, " ").trim();
        },
      ),
    ).toEqual(["onCreate, createBy.data"]);
    expect(
      callArguments(classSource.source, /this\.onCreatePermitted/),
    ).toHaveLength(1);
    expect(
      callArguments(classSource.source, /this\.onCreateSuccess/),
    ).toHaveLength(1);
  });

  test("the create's OnCreate is one object: declared once and never replaced", () => {
    expect(
      (createItself.match(/const onCreate: OnCreate<TBaseModel> =/g) || [])
        .length,
    ).toBe(1);
    // No `onCreate = ...` after it: only what it holds changes.
    expect(createItself).not.toMatch(/(^|[^.\w])onCreate\s*=[^=]/m);
  });

  test("it holds the create as it is written before onCreatePermitted is handed it, and nothing points it elsewhere after", () => {
    const pointedAt: number = createItself.indexOf(
      "onCreate.createBy = createBy;",
    );
    const permittedAt: number = createItself.search(
      /this\.onCreatePermitted\(/,
    );

    expect(pointedAt).toBeGreaterThan(-1);
    expect(pointedAt).toBeLessThan(permittedAt);
    expect(
      (createItself.match(/onCreate\.createBy\s*=[^=]/g) || []).length,
    ).toBe(1);
    // The create it holds is the one written: not handed back anew after it.
    expect(createItself.slice(pointedAt)).not.toMatch(
      /(^|[^.\w])createBy\s*=[^=]/m,
    );
  });

  test("the create itself calls no error hook of its own: every step is create's try", () => {
    expect(createItself).not.toMatch(/this\.onCreateError\s*\(/);
    expect(
      callArguments(classSource.source, /this\.onCreateError/).length,
    ).toBe(1);
  });

  test("the default onCreateError takes what onBeforeCreate handed back, and which step failed", () => {
    expect(methodText(classSource, "onCreateError")).toMatch(
      /onCreateError\(\s*error: Exception,\s*_onCreate\?: OnCreate<TBaseModel> \| undefined,\s*_failedStatement\?: StatementContext \| undefined,?\s*\)/,
    );
  });
});
