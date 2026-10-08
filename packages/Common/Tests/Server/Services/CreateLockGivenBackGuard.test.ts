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
 * DatabaseService.create now runs every step in one try and hands
 * onCreateError what onBeforeCreate handed back, so the rule is:
 *
 *   - every service that takes a lock in a create hook gives it back in
 *     onCreateSuccess AND in onCreateError (which takes the OnCreate);
 *   - no service holds a lock around create() itself (a try/finally of its
 *     own): the hooks own it, the same way for every service;
 *   - DatabaseService hands every failure of a create to onCreateError, with
 *     what onBeforeCreate handed back.
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
  /\b(Semaphore\.lock|StateChangeLock\.take|SsoRequirementChanges\.beforeProjectCreate|ProjectSsoProviderChanges\.lockSignInChange|GlobalSsoProviderChanges\.beforeAttachmentCreate)\s*\(/;

/*
 * Giving one back. A sign-in change's lock is handed back after a failed
 * create through the helpers that give it back - or, when the database may
 * still apply the INSERT, keep it until it would have cancelled it, and then
 * let it run out (SsoRequirementChanges.afterFailedProjectCreate,
 * GlobalSsoProviderChanges.afterFailedWrite; SsoFailedWriteLocksGuard holds
 * every error hook of a sign-in change to handing them what failed).
 */
const GIVES_IT_BACK: RegExp =
  /\b(Semaphore\.release|StateChangeLock\.giveBack|StateChangeLock\.giveBackFor|SsoRequirementChanges\.afterProjectCreate|SsoRequirementChanges\.afterFailedProjectCreate|ProjectSsoProviderChanges\.releaseSignInChange|GlobalSsoProviderChanges\.afterWrite|GlobalSsoProviderChanges\.afterFailedWrite)\s*\(/;

// onCreateError takes what onBeforeCreate handed back.
const ERROR_HOOK_TAKES_THE_CREATE: RegExp =
  /onCreateError\(\s*error: Exception,\s*onCreate\?: OnCreate<\w+> \| undefined,?\s*\)/;

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
  "ScheduledMaintenanceStateTimelineService.ts":
    "the scheduled maintenance event",
};

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

    test("once the create is refused or fails after the hook: in onCreateError, which takes what onBeforeCreate handed back", () => {
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

  test("create runs the create itself in one try, and hands what fails to onCreateError with what onBeforeCreate handed back", () => {
    expect(create).toMatch(
      /try\s*\{\s*return await this\._create\(createBy, handedBack\);\s*\}\s*catch \(error\)\s*\{\s*await this\.onCreateError\(error as Exception, handedBack\.onCreate\);\s*throw this\.getException\(error as Exception\);\s*\}/,
    );
  });

  test("what onBeforeCreate hands back is handed on as soon as it has run", () => {
    expect(createItself).toMatch(
      /:\s*await this\._onBeforeCreate\(createBy\);\s*handedBack\.onCreate = onCreate;/,
    );
  });

  test("the create itself calls no error hook of its own: every step is create's try", () => {
    expect(createItself).not.toMatch(/this\.onCreateError\s*\(/);
    expect(
      callArguments(classSource.source, /this\.onCreateError/).length,
    ).toBe(1);
  });

  test("the default onCreateError takes what onBeforeCreate handed back", () => {
    expect(methodText(classSource, "onCreateError")).toMatch(
      /onCreateError\(\s*error: Exception,\s*_onCreate\?: OnCreate<TBaseModel> \| undefined,?\s*\)/,
    );
  });
});
