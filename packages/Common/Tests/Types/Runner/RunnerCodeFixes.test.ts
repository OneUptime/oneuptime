import {
  GLOBAL_RUNNER_CODE_FIXES_SINCE_VERSION,
  GlobalRunnerCodeFixAvailability,
  RunnerCodeFixFacts,
  RunnerCodeFixRefusal,
  doesRunnerTakeCodeFixes,
  getGlobalRunnerCodeFixAvailability,
  getRunnerCodeFixRefusal,
} from "../../../Types/Runner/RunnerCodeFixes";
import OneUptimeDate from "../../../Types/Date";
import Version from "../../../Types/Version";
import { describe, expect, test } from "@jest/globals";

/*
 * WHETHER A RUNNER TAKES ONEUPTIME AI'S CODE FIXES.
 *
 * The server grants every global Runner the code-fix capability, and a
 * project's Runner while a repository works on it, but a Runner can refuse
 * it on its own side: its host turned code fixes off
 * (ONEUPTIME_RUNNER_ENABLE_CODE_FIXES=false), or it is a global Runner of a
 * release from before global Runners took them. Counted all the same, a
 * repository on it looked ready while its fixes sat queued forever. The
 * Runner now says on every heartbeat whether it takes them; this is how a
 * row is read, by the server and the dashboard alike - including a Runner
 * of a release that says nothing.
 */

const JUST_NOW: Date = OneUptimeDate.getCurrentDate();

function globalRunner(facts: Partial<RunnerCodeFixFacts>): RunnerCodeFixFacts {
  return { isGlobalRunner: true, lastAlive: JUST_NOW, ...facts };
}

function projectRunner(facts: Partial<RunnerCodeFixFacts>): RunnerCodeFixFacts {
  return { isGlobalRunner: false, lastAlive: JUST_NOW, ...facts };
}

describe("a Runner that says whether it takes code fixes", () => {
  test("that it does: it takes them, global or a project's, whatever its release", () => {
    for (const runner of [
      globalRunner({ takesCodeFixes: true, agentVersion: "14.0.102" }),
      // An explicit yes wins over a release that would read as older.
      globalRunner({ takesCodeFixes: true, agentVersion: "1.0.0" }),
      projectRunner({ takesCodeFixes: true, agentVersion: "14.0.10" }),
    ]) {
      expect(getRunnerCodeFixRefusal(runner)).toBeNull();
      expect(doesRunnerTakeCodeFixes(runner)).toBe(true);
    }
  });

  test("that it does not: its host turned them off, global or a project's, whatever its release", () => {
    for (const runner of [
      globalRunner({ takesCodeFixes: false, agentVersion: "14.0.102" }),
      globalRunner({ takesCodeFixes: false, agentVersion: "15.2.0" }),
      projectRunner({ takesCodeFixes: false, agentVersion: "14.0.102" }),
      // Its no is its last word even before a heartbeat stamped lastAlive.
      projectRunner({ takesCodeFixes: false, lastAlive: null }),
    ]) {
      expect(getRunnerCodeFixRefusal(runner)).toBe(
        RunnerCodeFixRefusal.TurnedOffOnHost,
      );
      expect(doesRunnerTakeCodeFixes(runner)).toBe(false);
    }
  });
});

describe("a Runner of a release that says nothing", () => {
  test("a project's Runner takes them, as every release did while a repository worked on it", () => {
    for (const agentVersion of ["1.0.0", "12.0.0", "14.0.50", "14.0.101"]) {
      for (const takesCodeFixes of [null, undefined]) {
        const runner: RunnerCodeFixFacts = projectRunner({
          agentVersion,
          takesCodeFixes,
        });

        expect(getRunnerCodeFixRefusal(runner)).toBeNull();
        expect(doesRunnerTakeCodeFixes(runner)).toBe(true);
      }
    }

    // A row that does not say whether it is global is a project's.
    expect(
      doesRunnerTakeCodeFixes({ agentVersion: "1.0.0", lastAlive: JUST_NOW }),
    ).toBe(true);
  });

  test("a global Runner from the first release that takes them on, takes them", () => {
    for (const agentVersion of [
      GLOBAL_RUNNER_CODE_FIXES_SINCE_VERSION,
      "14.0.95",
      "14.0.101",
      "14.1.0",
      "15.0.0",
      new Version("14.0.100"),
    ]) {
      const runner: RunnerCodeFixFacts = globalRunner({
        agentVersion,
        takesCodeFixes: null,
      });

      expect(getRunnerCodeFixRefusal(runner)).toBeNull();
      expect(doesRunnerTakeCodeFixes(runner)).toBe(true);
    }
  });

  test("a global Runner of an older release does not: it turns them off itself", () => {
    for (const agentVersion of [
      "14.0.93",
      "14.0.80",
      "13.9.99",
      "12.0.0",
      new Version("14.0.93"),
      // A prerelease comes before its release.
      "14.0.94-rc.1",
      // A Runner image built without APP_VERSION reports 1.0.0.
      "1.0.0",
    ]) {
      const runner: RunnerCodeFixFacts = globalRunner({
        agentVersion,
        takesCodeFixes: undefined,
      });

      expect(getRunnerCodeFixRefusal(runner)).toBe(
        RunnerCodeFixRefusal.OlderRelease,
      );
      expect(doesRunnerTakeCodeFixes(runner)).toBe(false);
    }
  });

  test("a global Runner whose release cannot be read is not counted as taking them", () => {
    for (const agentVersion of [null, undefined, "", "unknown", "v"]) {
      expect(getRunnerCodeFixRefusal(globalRunner({ agentVersion }))).toBe(
        RunnerCodeFixRefusal.OlderRelease,
      );
    }
  });

  test("a global Runner that never heartbeated is not known to refuse them: its 1.0.0 is the new row's placeholder", () => {
    for (const lastAlive of [null, undefined]) {
      const runner: RunnerCodeFixFacts = globalRunner({
        agentVersion: "1.0.0",
        takesCodeFixes: null,
        lastAlive,
      });

      expect(getRunnerCodeFixRefusal(runner)).toBeNull();
      expect(doesRunnerTakeCodeFixes(runner)).toBe(true);
    }
  });

  test("lastAlive is read as the dashboard gets it too, an ISO string", () => {
    expect(
      getRunnerCodeFixRefusal(
        globalRunner({
          agentVersion: "14.0.90",
          lastAlive: JUST_NOW.toISOString(),
        }),
      ),
    ).toBe(RunnerCodeFixRefusal.OlderRelease);
  });
});

describe("the first release in which a global Runner takes code fixes", () => {
  /*
   * #5302 (merged as b3d507e55c on 2026-10-26) made global Runners take
   * code fixes; tag 14.0.93 does not contain it, 14.0.94 does. A global
   * Runner of 14.0.93 or older forces the capability off itself
   * (packages/Runner RunnerCapabilities, as it was then).
   */
  test("is 14.0.94", () => {
    expect(GLOBAL_RUNNER_CODE_FIXES_SINCE_VERSION).toBe("14.0.94");
  });
});

describe("whether a global Runner that takes code fixes is online", () => {
  test("none online: offline", () => {
    expect(getGlobalRunnerCodeFixAvailability([])).toBe(
      GlobalRunnerCodeFixAvailability.Offline,
    );
  });

  test("one online that takes them, alone or beside ones that do not: online", () => {
    expect(
      getGlobalRunnerCodeFixAvailability([
        globalRunner({ takesCodeFixes: true }),
      ]),
    ).toBe(GlobalRunnerCodeFixAvailability.Online);

    expect(
      getGlobalRunnerCodeFixAvailability([
        globalRunner({ takesCodeFixes: false }),
        globalRunner({ agentVersion: "14.0.80" }),
        globalRunner({ agentVersion: "14.0.99" }),
      ]),
    ).toBe(GlobalRunnerCodeFixAvailability.Online);
  });

  test("only ones that take none - turned off on their host, or an older release: online, but none takes them", () => {
    expect(
      getGlobalRunnerCodeFixAvailability([
        globalRunner({ takesCodeFixes: false, agentVersion: "14.0.102" }),
        globalRunner({ takesCodeFixes: null, agentVersion: "14.0.93" }),
      ]),
    ).toBe(GlobalRunnerCodeFixAvailability.OnlineButNoneTakesCodeFixes);
  });

  test("the rows are read as global Runners, whether or not they say so", () => {
    // An older release: as a project's Runner it would take them.
    expect(
      getGlobalRunnerCodeFixAvailability([
        { agentVersion: "14.0.80", lastAlive: JUST_NOW },
      ]),
    ).toBe(GlobalRunnerCodeFixAvailability.OnlineButNoneTakesCodeFixes);

    expect(
      getGlobalRunnerCodeFixAvailability([
        {
          isGlobalRunner: false,
          agentVersion: "14.0.80",
          lastAlive: JUST_NOW,
        },
      ]),
    ).toBe(GlobalRunnerCodeFixAvailability.OnlineButNoneTakesCodeFixes);
  });
});
