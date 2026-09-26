import {
  afterAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import ScanTargetUtil from "Common/Utils/NetworkDiscovery/ScanTargetUtil";
import {
  DEFAULT_REVERSE_DNS_CONCURRENCY,
  DEFAULT_REVERSE_DNS_TIMEOUT_IN_MS,
  DEFAULT_REVERSE_DNS_TOTAL_BUDGET_IN_MS,
  MAX_AUTOMATIC_REVERSE_DNS_TOTAL_BUDGET_IN_MS,
  MAX_REVERSE_DNS_RETRY_LOOKUP_IN_MS,
  MAX_REVERSE_DNS_TOTAL_BUDGET_OVERRIDE_IN_MS,
  getReverseDnsTotalBudgetInMs,
} from "../Utils/Discovery/ReverseDnsResolver";
import {
  DEFAULT_NETBIOS_MAX_HOSTS,
  DEFAULT_NETBIOS_PER_HOST_TIMEOUT_IN_MS,
  DEFAULT_NETBIOS_TOTAL_BUDGET_IN_MS,
  MAX_AUTOMATIC_NETBIOS_TOTAL_BUDGET_IN_MS,
  MAX_NETBIOS_MAX_HOSTS_OVERRIDE,
  getNetbiosTotalBudgetInMs,
} from "../Utils/Discovery/NetbiosNameResolver";

interface DiscoveryNamingBudgetConfig {
  PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS: number;
  PROBE_DISCOVERY_NETBIOS_MAX_HOSTS: number;
  PROBE_DISCOVERY_SCAN_TIMEOUT_IN_MS: number;
  PROBE_DISCOVERY_SCAN_CONCURRENCY: number;
  PROBE_API_REQUEST_TIMEOUT_IN_MS: number;
}

/*
 * Mirror of STALE_IN_PROGRESS_HOURS in
 * App/FeatureSet/Workers/Jobs/NetworkDeviceDiscovery/RequeueRecurringScans.ts.
 * The Probe cannot import App, so the number is copied here; if the server's
 * reaper is ever tightened, this copy must follow it, or the arithmetic below
 * keeps passing against a window the server no longer honours.
 */
const SERVER_STALE_IN_PROGRESS_HOURS: number = 2;
const SERVER_STALE_IN_PROGRESS_IN_MS: number =
  SERVER_STALE_IN_PROGRESS_HOURS * 60 * 60 * 1000;

/*
 * The longest a reverse-DNS pass can run past its deadline: the one wave
 * already in flight when the deadline is checked. That used to be a single
 * first-pass lookup, DEFAULT_REVERSE_DNS_TIMEOUT_IN_MS. Since OneUptime issue
 * #3916 the pass ends by retrying the lookups that failed, a wave at a time
 * under the SAME deadline, and one retry wave can run to
 * MAX_REVERSE_DNS_RETRY_LOOKUP_IN_MS (every configured server asked in turn at
 * the longer retry timeout). A wave of either kind is only STARTED before the
 * deadline, so the overrun is the longer of the two, not their sum. The
 * breaker rescue's three canaries do not change that: they are asked side by
 * side, so they cost one retry lookup, and the deadline is read again before
 * anything is started after them. Nor does the hosts file, read from disk
 * once per pass with no query sent.
 */
const REVERSE_DNS_WAVE_IN_FLIGHT_IN_MS: number = Math.max(
  DEFAULT_REVERSE_DNS_TIMEOUT_IN_MS,
  MAX_REVERSE_DNS_RETRY_LOOKUP_IN_MS,
);

describe("discovery host naming budget configuration", () => {
  const environmentKeys: Array<string> = [
    "ONEUPTIME_URL",
    "PROBE_KEY",
    "PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS",
    "PROBE_DISCOVERY_NETBIOS_MAX_HOSTS",
    "PROBE_DISCOVERY_SCAN_TIMEOUT_IN_MS",
    "PROBE_DISCOVERY_SCAN_CONCURRENCY",
    "PROBE_API_REQUEST_TIMEOUT_IN_MS",
  ];
  const originalEnvironment: Record<string, string | undefined> =
    Object.fromEntries(
      environmentKeys.map((key: string): [string, string | undefined] => {
        return [key, process.env[key]];
      }),
    );

  beforeEach(() => {
    process.env["ONEUPTIME_URL"] = "http://oneuptime.test";
    process.env["PROBE_KEY"] = "test-probe-key";
    delete process.env["PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS"];
    delete process.env["PROBE_DISCOVERY_NETBIOS_MAX_HOSTS"];
    delete process.env["PROBE_DISCOVERY_SCAN_TIMEOUT_IN_MS"];
    delete process.env["PROBE_DISCOVERY_SCAN_CONCURRENCY"];
    delete process.env["PROBE_API_REQUEST_TIMEOUT_IN_MS"];
  });

  afterAll(() => {
    for (const key of environmentKeys) {
      const value: string | undefined = originalEnvironment[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  });

  describe("PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS", () => {
    /*
     * 0 is the "automatic" sentinel FetchScans turns into `undefined` for the
     * resolver. If the unset default ever became a real number, every probe
     * would silently lose per-pass sizing and go back to a flat budget that
     * leaves the tail of a large sweep named by IP address.
     */
    test("defaults to 0, which means the resolver sizes the budget itself", () => {
      expect(loadConfig().PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS).toBe(0);
    });

    test.each([
      ["the minimum of one second", "1000", 1000],
      ["the old flat sixty seconds", "60000", 60000],
      ["five minutes", "300000", 300000],
      ["the automatic ceiling of ten minutes", "600000", 600000],
      ["the maximum of twenty minutes", "1200000", 1200000],
      ["surrounding whitespace", " 90000 ", 90000],
      /*
       * parseInt truncates: an operator who writes a fraction gets the whole
       * milliseconds, not automatic sizing.
       */
      ["a fractional value, truncated", "90000.7", 90000],
    ])("accepts %s", (_name: string, configured: string, expected: number) => {
      process.env["PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS"] = configured;
      expect(loadConfig().PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS).toBe(
        expected,
      );
    });

    /*
     * Every rejected value must land on automatic sizing, never on a tiny or
     * unbounded fixed budget. A sub-second budget would name nothing on every
     * scan; one past twenty minutes could hold a finished scan silent long
     * enough for the server to reap it.
     */
    test.each([
      ["an empty value", ""],
      ["whitespace", " "],
      ["zero, the explicit automatic sentinel", "0"],
      ["one millisecond below the minimum", "999"],
      ["one millisecond above the maximum", "1200001"],
      ["a negative number", "-60000"],
      ["text", "abc"],
      ["NaN", "NaN"],
      ["Infinity", "Infinity"],
      /*
       * parseInt stops at the "e", reading 1ms, which is below the minimum.
       * Scientific notation therefore falls back to automatic rather than
       * becoming a one-millisecond budget.
       */
      ["scientific notation", "1e6"],
    ])(
      "falls back to automatic sizing for %s",
      (_name: string, configured: string) => {
        process.env["PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS"] = configured;
        expect(loadConfig().PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS).toBe(0);
      },
    );

    /*
     * The naming budget sits next to the NetBIOS host cap, the sweep deadline
     * and per-host concurrency in Config.ts. Setting it must not shift any of
     * their defaults — the reaper arithmetic below depends on the sweep
     * deadline being exactly what it was, and the NetBIOS cap must stay on its
     * "let the resolver decide" sentinel.
     */
    test("setting it leaves the NetBIOS host cap, the sweep deadline and per-host concurrency at their defaults", () => {
      const defaults: DiscoveryNamingBudgetConfig = loadConfig();
      process.env["PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS"] = "300000";
      const configured: DiscoveryNamingBudgetConfig = loadConfig();

      expect(configured).toEqual({
        PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS: 300000,
        PROBE_DISCOVERY_NETBIOS_MAX_HOSTS: 0,
        PROBE_DISCOVERY_SCAN_TIMEOUT_IN_MS: 90 * 60 * 1000,
        PROBE_DISCOVERY_SCAN_CONCURRENCY: 0,
        PROBE_API_REQUEST_TIMEOUT_IN_MS: 45000,
      });
      expect(configured.PROBE_DISCOVERY_NETBIOS_MAX_HOSTS).toBe(
        defaults.PROBE_DISCOVERY_NETBIOS_MAX_HOSTS,
      );
      expect(configured.PROBE_DISCOVERY_SCAN_TIMEOUT_IN_MS).toBe(
        defaults.PROBE_DISCOVERY_SCAN_TIMEOUT_IN_MS,
      );
      expect(configured.PROBE_DISCOVERY_SCAN_CONCURRENCY).toBe(
        defaults.PROBE_DISCOVERY_SCAN_CONCURRENCY,
      );
    });

    test("setting the sweep deadline and concurrency does not invent a naming budget", () => {
      process.env["PROBE_DISCOVERY_SCAN_TIMEOUT_IN_MS"] = "3600000";
      process.env["PROBE_DISCOVERY_SCAN_CONCURRENCY"] = "64";
      const configured: DiscoveryNamingBudgetConfig = loadConfig();

      expect(configured.PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS).toBe(0);
      expect(configured.PROBE_DISCOVERY_SCAN_TIMEOUT_IN_MS).toBe(3600000);
      expect(configured.PROBE_DISCOVERY_SCAN_CONCURRENCY).toBe(64);
    });
  });

  describe("PROBE_DISCOVERY_NETBIOS_MAX_HOSTS", () => {
    /*
     * 0 is the "use the resolver's own cap" sentinel: FetchScans passes
     * `PROBE_DISCOVERY_NETBIOS_MAX_HOSTS || undefined` to attachNetbiosNames,
     * and an undefined maxHosts leaves NetbiosNameResolver on
     * DEFAULT_NETBIOS_MAX_HOSTS. If the unset default were ever a real number,
     * every probe would quietly start sending that many NBSTAT datagrams —
     * the one thing this lookup is opt-in about.
     */
    test("defaults to 0, which means the resolver keeps its own 2,000-host cap", () => {
      expect(loadConfig().PROBE_DISCOVERY_NETBIOS_MAX_HOSTS).toBe(0);
      expect(DEFAULT_NETBIOS_MAX_HOSTS).toBe(2000);
    });

    test.each([
      ["the smallest cap that asks anybody", "1", 1],
      ["the resolver's own default, spelled out", "2000", 2000],
      ["a modestly raised cap", "2500", 2500],
      ["surrounding whitespace", " 3000 ", 3000],
      ["the maximum of four thousand", "4000", 4000],
      /*
       * parseInt truncates: an operator who writes a fraction gets whole
       * hosts, not the built-in cap. 2500 hosts is still a raised cap.
       */
      ["a fractional value, truncated", "2500.7", 2500],
    ])("accepts %s", (_name: string, configured: string, expected: number) => {
      process.env["PROBE_DISCOVERY_NETBIOS_MAX_HOSTS"] = configured;
      expect(loadConfig().PROBE_DISCOVERY_NETBIOS_MAX_HOSTS).toBe(expected);
    });

    /*
     * Every rejected value must land on the sentinel, never on a cap of its
     * own. A cap of 0 or a negative one would ask nobody and silently turn the
     * lookup off; one past the ceiling would size a budget the automatic clock
     * then truncates, which is exactly the silent failure this knob exists to
     * remove.
     */
    test.each([
      ["an empty value", ""],
      ["whitespace", " "],
      ["zero, the explicit sentinel", "0"],
      ["a negative number", "-1"],
      ["text", "abc"],
      ["NaN", "NaN"],
      ["Infinity", "Infinity"],
      ["one host above the maximum", "4001"],
    ])(
      "falls back to the resolver's own cap for %s",
      (_name: string, configured: string) => {
        process.env["PROBE_DISCOVERY_NETBIOS_MAX_HOSTS"] = configured;
        expect(loadConfig().PROBE_DISCOVERY_NETBIOS_MAX_HOSTS).toBe(0);
      },
    );

    /*
     * The cap is read next to the reverse-DNS budget, the sweep deadline and
     * the per-host concurrency. Raising how many hosts NetBIOS may ask must
     * not move any of them: the reaper arithmetic below is built on those
     * defaults.
     */
    test("setting it leaves every other discovery setting at its default", () => {
      const defaults: DiscoveryNamingBudgetConfig = loadConfig();
      process.env["PROBE_DISCOVERY_NETBIOS_MAX_HOSTS"] = "3000";
      const configured: DiscoveryNamingBudgetConfig = loadConfig();

      expect(configured).toEqual({
        PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS: 0,
        PROBE_DISCOVERY_NETBIOS_MAX_HOSTS: 3000,
        PROBE_DISCOVERY_SCAN_TIMEOUT_IN_MS: 90 * 60 * 1000,
        PROBE_DISCOVERY_SCAN_CONCURRENCY: 0,
        PROBE_API_REQUEST_TIMEOUT_IN_MS: 45000,
      });
      expect({
        ...configured,
        PROBE_DISCOVERY_NETBIOS_MAX_HOSTS: 0,
      }).toEqual(defaults);
    });

    test("setting the naming budget, the sweep deadline and concurrency does not invent a host cap", () => {
      process.env["PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS"] = "300000";
      process.env["PROBE_DISCOVERY_SCAN_TIMEOUT_IN_MS"] = "3600000";
      process.env["PROBE_DISCOVERY_SCAN_CONCURRENCY"] = "64";
      const configured: DiscoveryNamingBudgetConfig = loadConfig();

      expect(configured.PROBE_DISCOVERY_NETBIOS_MAX_HOSTS).toBe(0);
      expect(configured.PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS).toBe(300000);
      expect(configured.PROBE_DISCOVERY_SCAN_TIMEOUT_IN_MS).toBe(3600000);
      expect(configured.PROBE_DISCOVERY_SCAN_CONCURRENCY).toBe(64);
    });
  });

  describe("naming budgets against the server's stale-scan reaper", () => {
    /*
     * Config.ts no longer spells the maximum out: it reads
     * MAX_REVERSE_DNS_TOTAL_BUDGET_OVERRIDE_IN_MS from ReverseDnsResolver,
     * which the scan status also reads to decide whether advising "raise
     * PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS" can help. The two must be the
     * same number, and "the same" is proven against the PARSER — the export
     * accepted verbatim, one millisecond more rejected back to automatic —
     * not by reading Config.ts's source. If Config.ts ever went back to its
     * own literal and the two drifted, the status would advise raising a
     * variable the parser then ignores, or stay silent when raising would
     * help.
     */
    test("Config.ts accepts exactly the exported override maximum and rejects one millisecond more", () => {
      process.env["PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS"] = String(
        MAX_REVERSE_DNS_TOTAL_BUDGET_OVERRIDE_IN_MS,
      );
      expect(loadConfig().PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS).toBe(
        MAX_REVERSE_DNS_TOTAL_BUDGET_OVERRIDE_IN_MS,
      );

      process.env["PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS"] = String(
        MAX_REVERSE_DNS_TOTAL_BUDGET_OVERRIDE_IN_MS + 1,
      );
      expect(loadConfig().PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS).toBe(0);
    });

    /*
     * The export is a promise to the server's reaper, so its VALUE is pinned
     * here too, not only its agreement with the parser: raising the constant
     * moves Config.ts with it, and without a literal nothing but the sum
     * below would notice — and only once the sum finally crossed two hours.
     */
    test("the override maximum is exactly twenty minutes, twice the automatic ceiling", () => {
      expect(MAX_REVERSE_DNS_TOTAL_BUDGET_OVERRIDE_IN_MS).toBe(20 * 60 * 1000);
      expect(getReverseDnsOverrideMaximumInMs()).toBe(1200000);
      expect(MAX_REVERSE_DNS_TOTAL_BUDGET_OVERRIDE_IN_MS).toBe(
        2 * MAX_AUTOMATIC_REVERSE_DNS_TOTAL_BUDGET_IN_MS,
      );
    });

    /*
     * The probe uploads nothing between the sweep's last progress report and
     * its final result, and an older server reaps on startedAt alone. So the
     * worst case that must finish inside the reaper's window is: a sweep that
     * uses its whole default deadline, then a reverse-DNS pass at the largest
     * budget an operator can configure plus the one wave already in flight
     * when the deadline is checked (a retry wave, the longer kind, since
     * #3916), then a NetBIOS lookup at its automatic ceiling plus the
     * listening window it finishes, then the upload running to its request
     * timeout. If this sum reaches two hours, a sweep that already succeeded
     * gets marked Failed for the sake of its hostnames.
     */
    test("the default sweep deadline plus the longest naming passes and the upload end inside two hours", () => {
      const defaults: DiscoveryNamingBudgetConfig = loadConfig();
      const overrideMaximumInMs: number = getReverseDnsOverrideMaximumInMs();

      expect(overrideMaximumInMs).toBe(
        MAX_REVERSE_DNS_TOTAL_BUDGET_OVERRIDE_IN_MS,
      );

      const worstCaseSilenceInMs: number =
        defaults.PROBE_DISCOVERY_SCAN_TIMEOUT_IN_MS +
        overrideMaximumInMs +
        REVERSE_DNS_WAVE_IN_FLIGHT_IN_MS +
        MAX_AUTOMATIC_NETBIOS_TOTAL_BUDGET_IN_MS +
        DEFAULT_NETBIOS_PER_HOST_TIMEOUT_IN_MS +
        defaults.PROBE_API_REQUEST_TIMEOUT_IN_MS;

      expect(worstCaseSilenceInMs).toBeLessThan(SERVER_STALE_IN_PROGRESS_IN_MS);
    });

    /*
     * The automatic ceiling is what every probe runs with by default. It
     * must never exceed what an operator is allowed to configure by hand,
     * or the reaper arithmetic above (which uses the override maximum) would
     * no longer bound the default case.
     */
    test("the automatic reverse-DNS ceiling is within the configurable maximum", () => {
      expect(MAX_AUTOMATIC_REVERSE_DNS_TOTAL_BUDGET_IN_MS).toBeLessThanOrEqual(
        getReverseDnsOverrideMaximumInMs(),
      );
    });

    /*
     * A ceiling at or below its floor would make the "automatic" budget a
     * flat one again, and the sizing function would be dead code.
     */
    test("each automatic ceiling is above its floor", () => {
      expect(MAX_AUTOMATIC_REVERSE_DNS_TOTAL_BUDGET_IN_MS).toBeGreaterThan(
        DEFAULT_REVERSE_DNS_TOTAL_BUDGET_IN_MS,
      );
      expect(MAX_AUTOMATIC_NETBIOS_TOTAL_BUDGET_IN_MS).toBeGreaterThan(
        DEFAULT_NETBIOS_TOTAL_BUDGET_IN_MS,
      );
    });

    /*
     * The same agreement as the reverse-DNS one above, for the NetBIOS host
     * cap: Config.ts reads MAX_NETBIOS_MAX_HOSTS_OVERRIDE, and FetchScans
     * reads it AGAIN to decide whether to end the cap sentence with "raise
     * PROBE_DISCOVERY_NETBIOS_MAX_HOSTS on the probe to ask more". Proven
     * against the parser rather than by reading Config.ts's source: if the two
     * ever drifted, the status would advise raising a variable the parser then
     * ignores, or stay silent on exactly the scans where raising it would
     * help.
     */
    test("Config.ts accepts exactly the exported host-cap maximum and rejects one host more", () => {
      process.env["PROBE_DISCOVERY_NETBIOS_MAX_HOSTS"] = String(
        MAX_NETBIOS_MAX_HOSTS_OVERRIDE,
      );
      expect(loadConfig().PROBE_DISCOVERY_NETBIOS_MAX_HOSTS).toBe(
        MAX_NETBIOS_MAX_HOSTS_OVERRIDE,
      );

      process.env["PROBE_DISCOVERY_NETBIOS_MAX_HOSTS"] = String(
        MAX_NETBIOS_MAX_HOSTS_OVERRIDE + 1,
      );
      expect(loadConfig().PROBE_DISCOVERY_NETBIOS_MAX_HOSTS).toBe(0);
    });

    /*
     * The export's VALUE is pinned too, for the same reason the reverse-DNS
     * one is: it is a promise about how much work the operator may ask for,
     * and the arithmetic below is what makes 4,000 the right number rather
     * than any other.
     */
    test("the host-cap maximum is four thousand, twice the resolver's own cap", () => {
      expect(MAX_NETBIOS_MAX_HOSTS_OVERRIDE).toBe(4000);
      expect(getNetbiosMaxHostsOverride()).toBe(4000);
      expect(MAX_NETBIOS_MAX_HOSTS_OVERRIDE).toBe(
        2 * DEFAULT_NETBIOS_MAX_HOSTS,
      );
    });

    /*
     * THE REASON THE CAP HAS A CEILING AT ALL.
     *
     * Raising the cap raises the lookup's wall-clock budget with it, because
     * the budget is sized from the hosts it will ask. That only helps while
     * the sized budget still fits under MAX_AUTOMATIC_NETBIOS_TOTAL_BUDGET_IN_MS
     * — past that the budget is clamped, and the extra hosts the operator paid
     * for are truncated by the clock instead of by the cap. Same silent
     * failure, new cause.
     *
     * So the highest cap Config.ts accepts must size a budget strictly BELOW
     * the ceiling, and it is checked at the maximum the PARSER enforces, not
     * at a literal.
     */
    test("a lookup at the highest configurable host cap is bounded by its own cap, never by the clock", () => {
      const maxHosts: number = getNetbiosMaxHostsOverride();

      const budgetInMs: number = getNetbiosTotalBudgetInMs({
        targetCount: maxHosts,
      });

      // Two passes of 3,999 paced sends at 10ms plus a 1.5s window, x1.25.
      expect(budgetInMs).toBe(103725);
      expect(budgetInMs).toBeLessThan(MAX_AUTOMATIC_NETBIOS_TOTAL_BUDGET_IN_MS);

      /*
       * And it is not scraping the ceiling: the sizing only clamps past 4,650
       * hosts, so the cap leaves room for the pacing drift the headroom is
       * there to absorb.
       */
      expect(
        getNetbiosTotalBudgetInMs({ targetCount: maxHosts }),
      ).toBeGreaterThan(
        getNetbiosTotalBudgetInMs({ targetCount: maxHosts - 1 }),
      );
    });

    /*
     * The reaper sum above uses MAX_AUTOMATIC_NETBIOS_TOTAL_BUDGET_IN_MS for
     * the NetBIOS leg, so a raised cap must not be able to exceed it. It
     * cannot — the sizing clamps there — but the point is that no cap an
     * operator may configure ADDS to the worst-case silence the sum bounds, so
     * raising PROBE_DISCOVERY_NETBIOS_MAX_HOSTS can never get a finished scan
     * reaped as Failed for the sake of its hostnames.
     */
    test("no configurable host cap can push the NetBIOS leg past the ceiling the reaper sum uses", () => {
      const defaults: DiscoveryNamingBudgetConfig = loadConfig();
      /*
       * Probed once and reused: each probe reloads Probe/Config in a fresh
       * module registry, which is not free, and the answer cannot change
       * within one test.
       */
      const maxHosts: number = getNetbiosMaxHostsOverride();
      const reverseDnsMaximumInMs: number = getReverseDnsOverrideMaximumInMs();
      const overCeilingHostCounts: Array<number> = [
        DEFAULT_NETBIOS_MAX_HOSTS,
        maxHosts,
        // Beyond anything Config.ts would accept, for the clamp itself.
        100000,
      ];

      for (const targetCount of overCeilingHostCounts) {
        expect(
          getNetbiosTotalBudgetInMs({ targetCount: targetCount }),
        ).toBeLessThanOrEqual(MAX_AUTOMATIC_NETBIOS_TOTAL_BUDGET_IN_MS);
      }

      const worstCaseSilenceInMs: number =
        defaults.PROBE_DISCOVERY_SCAN_TIMEOUT_IN_MS +
        reverseDnsMaximumInMs +
        REVERSE_DNS_WAVE_IN_FLIGHT_IN_MS +
        getNetbiosTotalBudgetInMs({ targetCount: maxHosts }) +
        DEFAULT_NETBIOS_PER_HOST_TIMEOUT_IN_MS +
        defaults.PROBE_API_REQUEST_TIMEOUT_IN_MS;

      expect(worstCaseSilenceInMs).toBeLessThan(SERVER_STALE_IN_PROGRESS_IN_MS);
    });
  });

  describe("automatic budget sizing at the scan limits", () => {
    /*
     * The largest sweep a scan can hold needs far more than ten minutes if
     * every lookup times out, so its automatic budget must be the ceiling —
     * not an unclamped figure of over half an hour of silence.
     */
    test("a sweep at MAX_SCAN_HOSTS gets exactly the automatic reverse-DNS ceiling", () => {
      expect(ScanTargetUtil.MAX_SCAN_HOSTS).toBe(32768);
      expect(
        getReverseDnsTotalBudgetInMs({
          addressCount: ScanTargetUtil.MAX_SCAN_HOSTS,
        }),
      ).toBe(MAX_AUTOMATIC_REVERSE_DNS_TOTAL_BUDGET_IN_MS);
    });

    /*
     * The NetBIOS ceiling was raised precisely so the retry pass over the
     * host cap is not cut short. If the cap's worst-case workload no longer
     * fits below the ceiling, every large scan would report a NetBIOS lookup
     * stopped by its time limit for a budget sized below its own work.
     */
    test("a NetBIOS lookup at the host cap fits entirely below its automatic ceiling", () => {
      const budgetInMs: number = getNetbiosTotalBudgetInMs({
        targetCount: DEFAULT_NETBIOS_MAX_HOSTS,
      });

      // Two passes of 1,999 paced sends at 10ms plus a 1.5s window, x1.25.
      expect(budgetInMs).toBe(53725);
      expect(budgetInMs).toBeGreaterThan(DEFAULT_NETBIOS_TOTAL_BUDGET_IN_MS);
      expect(budgetInMs).toBeLessThan(MAX_AUTOMATIC_NETBIOS_TOTAL_BUDGET_IN_MS);
    });

    /*
     * The reason the automatic sizing exists. With every lookup running to
     * its timeout, a budget buys floor(budget / timeout) waves of
     * DEFAULT_REVERSE_DNS_CONCURRENCY addresses. The old flat sixty seconds
     * bought 30 waves (960 addresses); the ceiling must buy at least ten
     * times that, or a large sweep behind a slow resolver is back to keeping
     * IP-address names past its first thousand hosts.
     */
    test("the old flat budget covered 960 worst-case addresses and the ceiling covers at least 9,600", () => {
      const worstCaseAddressesCoveredBy: (budgetInMs: number) => number = (
        budgetInMs: number,
      ): number => {
        return (
          Math.floor(budgetInMs / DEFAULT_REVERSE_DNS_TIMEOUT_IN_MS) *
          DEFAULT_REVERSE_DNS_CONCURRENCY
        );
      };

      expect(
        worstCaseAddressesCoveredBy(DEFAULT_REVERSE_DNS_TOTAL_BUDGET_IN_MS),
      ).toBe(960);
      expect(
        worstCaseAddressesCoveredBy(
          MAX_AUTOMATIC_REVERSE_DNS_TOTAL_BUDGET_IN_MS,
        ),
      ).toBeGreaterThanOrEqual(9600);
    });

    /*
     * A small sweep must keep exactly the budget it always had: the floors
     * are the flat budgets every scan ran under before sizing existed, so
     * sizing must only ever ADD time for large sweeps, never take it from a
     * /24.
     */
    test("small sweeps keep the sixty-second floor", () => {
      expect(getReverseDnsTotalBudgetInMs({ addressCount: 0 })).toBe(
        DEFAULT_REVERSE_DNS_TOTAL_BUDGET_IN_MS,
      );
      expect(getReverseDnsTotalBudgetInMs({ addressCount: 254 })).toBe(
        DEFAULT_REVERSE_DNS_TOTAL_BUDGET_IN_MS,
      );
      expect(getNetbiosTotalBudgetInMs({ targetCount: 254 })).toBe(
        DEFAULT_NETBIOS_TOTAL_BUDGET_IN_MS,
      );
    });
  });

  /*
   * The upper bound the parser actually enforces, for the reaper arithmetic.
   * Probed rather than taken from the export on trust: the exported
   * MAX_REVERSE_DNS_TOTAL_BUDGET_OVERRIDE_IN_MS must be accepted verbatim and
   * one millisecond more rejected back to automatic (0), or this throws — so
   * the sum above can never check a number Config.ts does not enforce.
   */
  function getReverseDnsOverrideMaximumInMs(): number {
    const maximum: number = MAX_REVERSE_DNS_TOTAL_BUDGET_OVERRIDE_IN_MS;

    process.env["PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS"] =
      maximum.toString();
    const accepted: number =
      loadConfig().PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS;

    process.env["PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS"] = (
      maximum + 1
    ).toString();
    const rejected: number =
      loadConfig().PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS;

    delete process.env["PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS"];

    if (accepted !== maximum || rejected !== 0) {
      throw new Error(
        `PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS no longer tops out at ${maximum}ms (accepted ${accepted}, one more gave ${rejected})`,
      );
    }
    return accepted;
  }

  /*
   * The same probe for the NetBIOS host cap, and for the same reason: the
   * budget arithmetic above must only ever be checked against a number
   * Config.ts actually lets an operator configure. The exported
   * MAX_NETBIOS_MAX_HOSTS_OVERRIDE must be accepted verbatim and one host more
   * rejected back to the sentinel (0), or this throws.
   */
  function getNetbiosMaxHostsOverride(): number {
    const maximum: number = MAX_NETBIOS_MAX_HOSTS_OVERRIDE;

    process.env["PROBE_DISCOVERY_NETBIOS_MAX_HOSTS"] = maximum.toString();
    const accepted: number = loadConfig().PROBE_DISCOVERY_NETBIOS_MAX_HOSTS;

    process.env["PROBE_DISCOVERY_NETBIOS_MAX_HOSTS"] = (maximum + 1).toString();
    const rejected: number = loadConfig().PROBE_DISCOVERY_NETBIOS_MAX_HOSTS;

    delete process.env["PROBE_DISCOVERY_NETBIOS_MAX_HOSTS"];

    if (accepted !== maximum || rejected !== 0) {
      throw new Error(
        `PROBE_DISCOVERY_NETBIOS_MAX_HOSTS no longer tops out at ${maximum} host(s) (accepted ${accepted}, one more gave ${rejected})`,
      );
    }
    return accepted;
  }

  function loadConfig(): DiscoveryNamingBudgetConfig {
    let result: DiscoveryNamingBudgetConfig | undefined;
    jest.isolateModules(() => {
      /* eslint-disable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
      const config: DiscoveryNamingBudgetConfig =
        require("../Config") as DiscoveryNamingBudgetConfig;
      /* eslint-enable @typescript-eslint/no-require-imports, @typescript-eslint/no-var-requires */
      result = {
        PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS:
          config.PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS,
        PROBE_DISCOVERY_NETBIOS_MAX_HOSTS:
          config.PROBE_DISCOVERY_NETBIOS_MAX_HOSTS,
        PROBE_DISCOVERY_SCAN_TIMEOUT_IN_MS:
          config.PROBE_DISCOVERY_SCAN_TIMEOUT_IN_MS,
        PROBE_DISCOVERY_SCAN_CONCURRENCY:
          config.PROBE_DISCOVERY_SCAN_CONCURRENCY,
        PROBE_API_REQUEST_TIMEOUT_IN_MS: config.PROBE_API_REQUEST_TIMEOUT_IN_MS,
      };
    });

    if (!result) {
      throw new Error("Probe configuration did not load");
    }
    return result;
  }
});
