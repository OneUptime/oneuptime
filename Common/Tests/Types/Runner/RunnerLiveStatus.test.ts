import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import OneUptimeDate from "../../../Types/Date";
import RunnerLiveStatus, {
  RUNNER_ALIVE_WINDOW_IN_MINUTES,
  getRunnerLiveStatus,
  getRunnerLiveStatusLabel,
} from "../../../Types/Runner/RunnerLiveStatus";

/*
 * getRunnerLiveStatus is the whole reason the Runner UI stopped rendering the
 * connectionStatus column. That column is written exactly twice in a Runner's
 * life — Disconnected by RunnerService.onBeforeCreate, Connected by the first
 * heartbeat — and nothing ever writes it again, so it reports every Runner
 * that has ever connected as connected forever, and reports a Runner that was
 * created five seconds ago and never started as disconnected. Both readings
 * are wrong in the direction that costs an operator the most.
 *
 * These tests pin the replacement, and — the load-bearing half — pin that the
 * dashboard and the server are still deciding "is this Runner alive" from the
 * same constant.
 */

type MinutesAgoFunction = (minutes: number) => Date;

const minutesAgo: MinutesAgoFunction = (minutes: number): Date => {
  return OneUptimeDate.getSomeMinutesAgo(minutes);
};

describe("getRunnerLiveStatus", () => {
  describe("never connected", () => {
    test("undefined lastAlive is NeverConnected", () => {
      expect(getRunnerLiveStatus(undefined)).toBe(
        RunnerLiveStatus.NeverConnected,
      );
    });

    test("null lastAlive is NeverConnected", () => {
      expect(getRunnerLiveStatus(null)).toBe(RunnerLiveStatus.NeverConnected);
    });

    /*
     * A Runner selected without the lastAlive column arrives with the field
     * absent, which is the same shape as never having heartbeated. That is
     * why both call sites pass lastAlive through selectMoreFields.
     */
    test("empty string lastAlive is NeverConnected", () => {
      expect(getRunnerLiveStatus("")).toBe(RunnerLiveStatus.NeverConnected);
    });
  });

  describe("connected", () => {
    test("a heartbeat right now is Connected", () => {
      expect(getRunnerLiveStatus(OneUptimeDate.getCurrentDate())).toBe(
        RunnerLiveStatus.Connected,
      );
    });

    test("a heartbeat one minute ago is Connected", () => {
      expect(getRunnerLiveStatus(minutesAgo(1))).toBe(
        RunnerLiveStatus.Connected,
      );
    });

    /*
     * The Runner heartbeats every 60s, so anything inside the window is a
     * Runner that is polling for work right now.
     */
    test("a heartbeat just inside the window is Connected", () => {
      expect(
        getRunnerLiveStatus(minutesAgo(RUNNER_ALIVE_WINDOW_IN_MINUTES - 1)),
      ).toBe(RunnerLiveStatus.Connected);
    });

    /*
     * Clock skew between the Runner's host and the server can put lastAlive
     * slightly in the future. That is a live Runner, not a dead one.
     */
    test("a lastAlive in the future is Connected", () => {
      const tenMinutesFromNow: Date = new Date(Date.now() + 10 * 60 * 1000);

      expect(getRunnerLiveStatus(tenMinutesFromNow)).toBe(
        RunnerLiveStatus.Connected,
      );
    });
  });

  describe("disconnected", () => {
    test("a heartbeat past the window is Disconnected", () => {
      expect(
        getRunnerLiveStatus(minutesAgo(RUNNER_ALIVE_WINDOW_IN_MINUTES + 1)),
      ).toBe(RunnerLiveStatus.Disconnected);
    });

    test("a heartbeat an hour ago is Disconnected", () => {
      expect(getRunnerLiveStatus(minutesAgo(60))).toBe(
        RunnerLiveStatus.Disconnected,
      );
    });

    test("a heartbeat a year ago is Disconnected", () => {
      expect(getRunnerLiveStatus(minutesAgo(60 * 24 * 365))).toBe(
        RunnerLiveStatus.Disconnected,
      );
    });

    /*
     * The boundary itself. isAfter compares at second granularity, so a
     * timestamp exactly one window old is NOT after the window start and
     * falls out of Connected. Pinned because the alternative — treating the
     * boundary as alive — would disagree with the server, whose query is a
     * strict greaterThan against the same instant.
     */
    test("a heartbeat exactly one window old is Disconnected", () => {
      expect(
        getRunnerLiveStatus(minutesAgo(RUNNER_ALIVE_WINDOW_IN_MINUTES)),
      ).toBe(RunnerLiveStatus.Disconnected);
    });
  });

  describe("input shapes", () => {
    test("accepts a Date", () => {
      expect(getRunnerLiveStatus(new Date())).toBe(RunnerLiveStatus.Connected);
    });

    /*
     * The dashboard reads Runners out of a JSON API response, where dates
     * are ISO strings and not Date objects.
     */
    test("accepts an ISO string", () => {
      expect(getRunnerLiveStatus(new Date().toISOString())).toBe(
        RunnerLiveStatus.Connected,
      );
    });

    test("accepts a stale ISO string", () => {
      expect(getRunnerLiveStatus(minutesAgo(120).toISOString())).toBe(
        RunnerLiveStatus.Disconnected,
      );
    });

    /*
     * A value we cannot parse is not evidence of life. Reporting Connected
     * here would paint a green dot on a Runner nobody has heard from.
     */
    test("an unparseable string is Disconnected, never Connected", () => {
      expect(getRunnerLiveStatus("not-a-date")).toBe(
        RunnerLiveStatus.Disconnected,
      );
    });

    test("an Invalid Date is Disconnected, never Connected", () => {
      expect(getRunnerLiveStatus(new Date("nonsense"))).toBe(
        RunnerLiveStatus.Disconnected,
      );
    });
  });

  describe("the enum", () => {
    test("has exactly three states", () => {
      expect(Object.keys(RunnerLiveStatus).sort()).toEqual([
        "Connected",
        "Disconnected",
        "NeverConnected",
      ]);
    });

    /*
     * NeverConnected must not collide with the persisted
     * RunnerConnectionStatus wire values ("connected" / "disconnected"), so
     * that nothing can round-trip one into the other by accident.
     */
    test("NeverConnected has its own distinct value", () => {
      expect(RunnerLiveStatus.NeverConnected).toBe("never-connected");
      expect(RunnerLiveStatus.NeverConnected).not.toBe(
        RunnerLiveStatus.Disconnected,
      );
      expect(RunnerLiveStatus.NeverConnected).not.toBe(
        RunnerLiveStatus.Connected,
      );
    });
  });
});

/*
 * The status-to-wording mapping. Both the status bubble and the runbook step
 * editor's Runner picker label through this, so an inversion here would show
 * a live Runner as never connected in two different places at once.
 *
 * Asserted branch by branch rather than by grepping for the three literals:
 * a "the file contains all three words" check passes just as happily with the
 * mapping inverted, which is exactly what an earlier version of this suite did.
 */
describe("getRunnerLiveStatusLabel", () => {
  test("Connected maps to 'Connected'", () => {
    expect(getRunnerLiveStatusLabel(RunnerLiveStatus.Connected)).toBe(
      "Connected",
    );
  });

  test("Disconnected maps to 'Disconnected'", () => {
    expect(getRunnerLiveStatusLabel(RunnerLiveStatus.Disconnected)).toBe(
      "Disconnected",
    );
  });

  test("NeverConnected maps to 'Never connected'", () => {
    expect(getRunnerLiveStatusLabel(RunnerLiveStatus.NeverConnected)).toBe(
      "Never connected",
    );
  });

  test("the three labels are distinct", () => {
    const labels: Array<string> = [
      RunnerLiveStatus.Connected,
      RunnerLiveStatus.Disconnected,
      RunnerLiveStatus.NeverConnected,
    ].map((status: RunnerLiveStatus): string => {
      return getRunnerLiveStatusLabel(status);
    });

    expect(new Set(labels).size).toBe(3);
  });

  /*
   * "Connected" and "Disconnected" are pre-existing i18next keys, translated
   * in all sixteen locale files for the probe pages. Changing the casing or
   * wording here would silently drop fifteen translations back to English.
   */
  test("it reuses the exact pre-existing locale keys", () => {
    expect(getRunnerLiveStatusLabel(RunnerLiveStatus.Connected)).not.toBe(
      "connected",
    );
    expect(getRunnerLiveStatusLabel(RunnerLiveStatus.Disconnected)).not.toBe(
      "disconnected",
    );
  });

  test("composes end to end from a lastAlive", () => {
    expect(
      getRunnerLiveStatusLabel(
        getRunnerLiveStatus(OneUptimeDate.getCurrentDate()),
      ),
    ).toBe("Connected");

    expect(getRunnerLiveStatusLabel(getRunnerLiveStatus(null))).toBe(
      "Never connected",
    );

    expect(getRunnerLiveStatusLabel(getRunnerLiveStatus(minutesAgo(60)))).toBe(
      "Disconnected",
    );
  });
});

describe("the alive window is shared with the server", () => {
  const RUNNER_SERVICE: string = path.join(
    __dirname,
    "..",
    "..",
    "..",
    "Server",
    "Services",
    "RunnerService.ts",
  );

  test("the window is five minutes", () => {
    expect(RUNNER_ALIVE_WINDOW_IN_MINUTES).toBe(5);
  });

  /*
   * The point of moving this constant into Types was that the dashboard and
   * the server answer "is this Runner alive" identically. A server that hands
   * work to a Runner the dashboard is drawing as Disconnected — or refuses
   * work to one drawn as Connected — is worse than either answer alone, and
   * that drift is invisible until someone is debugging a runbook that never
   * ran. So: RunnerService must IMPORT the constant, not redeclare it.
   */
  test("RunnerService imports the constant instead of declaring its own", () => {
    const source: string = fs.readFileSync(RUNNER_SERVICE, "utf8");

    expect(source).toContain('from "../../Types/Runner/RunnerLiveStatus"');
    expect(source).toContain("RUNNER_ALIVE_WINDOW_IN_MINUTES");

    // No local redeclaration may shadow the shared one.
    expect(source).not.toMatch(/const\s+RUNNER_ALIVE_WINDOW_IN_MINUTES\s*:/);
  });

  test("RunnerService still gates its queries on the shared window", () => {
    const source: string = fs.readFileSync(RUNNER_SERVICE, "utf8");

    const usages: number = (
      source.match(
        /OneUptimeDate\.getSomeMinutesAgo\(\s*RUNNER_ALIVE_WINDOW_IN_MINUTES,?\s*\)/g,
      ) || []
    ).length;

    // getOnlineAiCommandRunnersForProject and getOnlineCodeFixRunnerForProject.
    expect(usages).toBe(2);
  });

  /*
   * Guards the reason the UI stopped trusting the column at all: if someone
   * later adds a job that ages connectionStatus out, this test failing is the
   * prompt to revisit the derived status.
   */
  test("nothing in RunnerService writes connectionStatus back to Disconnected", () => {
    const source: string = fs.readFileSync(RUNNER_SERVICE, "utf8");

    const disconnectedWrites: number = (
      source.match(
        /connectionStatus\s*[:=]\s*RunnerConnectionStatus\.Disconnected/g,
      ) || []
    ).length;

    // Exactly one: the onBeforeCreate default. No ageing-out writer exists.
    expect(disconnectedWrites).toBe(1);
  });
});
