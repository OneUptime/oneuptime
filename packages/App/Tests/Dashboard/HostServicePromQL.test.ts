import { beforeAll, describe, expect, test } from "@jest/globals";
import type { HostServiceKind as HostServiceKindType } from "../../FeatureSet/Dashboard/src/Utils/HostServiceMonitorPrefill";
import type {
  HostServicePromQLSubject,
  HostServicePromQLWatch,
} from "../../FeatureSet/Dashboard/src/Utils/HostServicePromQL";

/*
 * WHETHER A PROMQL EXPRESSION WATCHES A SERVICE ON A HOST (#10452).
 *
 * A Metrics monitor written in PromQL is listed on a Windows service's or a
 * systemd unit's page when its expression reads the service's state on the
 * host, as the engine selects series: a selector of the state metric whose
 * service label is the service, a pattern that takes it in, or absent, and
 * whose host label names this host or is absent. These pin which
 * expressions those are, which it must not claim, and where it says it
 * cannot tell: a label the page does not know the service's series by, or a
 * part of the expression that may leave the service out.
 */

type PromQLModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/HostServicePromQL");
type PrefillModule =
  typeof import("../../FeatureSet/Dashboard/src/Utils/HostServiceMonitorPrefill");

let PromQL: PromQLModule;
let WINDOWS: HostServiceKindType;
let SYSTEMD: HostServiceKindType;

// Common/UI/Config reads `window` as it loads (HostServiceMonitorPrefill.test).
beforeAll(async () => {
  (globalThis as Record<string, unknown>)["window"] = {
    location: { pathname: "/", search: "", hash: "" },
    history: {
      state: null,
      replaceState: (): void => {
        // no-op; these tests never navigate.
      },
    },
  };

  PromQL = await import(
    "../../FeatureSet/Dashboard/src/Utils/HostServicePromQL"
  );

  const Prefill: PrefillModule = await import(
    "../../FeatureSet/Dashboard/src/Utils/HostServiceMonitorPrefill"
  );

  WINDOWS = Prefill.HostServiceKind.WindowsService;
  SYSTEMD = Prefill.HostServiceKind.SystemdUnit;
});

function spooler(): HostServicePromQLSubject {
  return { kind: WINDOWS, serviceName: "Spooler", hostIdentifier: "web-01" };
}

function nginx(): HostServicePromQLSubject {
  return {
    kind: SYSTEMD,
    serviceName: "nginx.service",
    hostIdentifier: "web-01",
  };
}

function watchOf(
  expression: string,
  subject: HostServicePromQLSubject = spooler(),
): HostServicePromQLWatch | null {
  return PromQL.readHostServicePromQLWatch({
    expression: expression,
    subject: subject,
  });
}

// Watched surely, naming this service.
const NAMED: HostServicePromQLWatch = {
  isForThisService: true,
  isCertain: true,
  uncertainLabels: [],
};

// Watched surely, among other services.
const AMONG_OTHERS: HostServicePromQLWatch = {
  isForThisService: false,
  isCertain: true,
  uncertainLabels: [],
};

describe("a Windows service's state, read in PromQL: Spooler on web-01", () => {
  test("the expression the issue names watches Spooler on web-01", () => {
    expect(
      watchOf(
        'windows_service_status{name="Spooler", resource_host_name="web-01"} != 4',
      ),
    ).toEqual(NAMED);
  });

  test.each([
    // Every host's Spooler, this one among them.
    ['windows_service_status{name="Spooler"} != 4', NAMED],
    // Every service on every host.
    ["windows_service_status != 4", AMONG_OTHERS],
    // Every service on this host.
    ['windows_service_status{resource_host_name="web-01"} != 4', AMONG_OTHERS],
    // A pattern that takes the service and the host in.
    ['windows_service_status{name=~"Spool.*"} != 4', AMONG_OTHERS],
    ['windows_service_status{name=~"Spooler|W3SVC"} != 4', AMONG_OTHERS],
    ['windows_service_status{resource_host_name=~"web-.+"} != 4', AMONG_OTHERS],
    // Every service but another one.
    ['windows_service_status{name!="W3SVC"} != 4', AMONG_OTHERS],
    ['windows_service_status{name!~"W3.*"} != 4', AMONG_OTHERS],
    // Every host but another one.
    ['windows_service_status{resource_host_name!="web-02"} != 4', AMONG_OTHERS],
  ])("%s watches it", (expression: string, watch: HostServicePromQLWatch) => {
    expect(watchOf(expression)).toEqual(watch);
  });

  test.each([
    // Another service, another host, another metric.
    'windows_service_status{name="W3SVC"} != 4',
    'windows_service_status{name="Spooler", resource_host_name="web-02"} != 4',
    'windows_service_status{name!="Spooler"} != 4',
    'windows_service_status{resource_host_name!="web-01"} != 4',
    'windows_service_status{name=~"W3.*"} != 4',
    'windows_service_status{name!~"Spool.*"} != 4',
    'system_cpu_utilization{resource_host_name="web-01"} > 0.9',
    'windows_service_startup_mode{name="Spooler"}',
    // A pattern is matched whole, as in Prometheus: "Spool" is not "Spooler".
    'windows_service_status{name=~"Spool"} != 4',
    // A name is matched as the collector reports it, case and all.
    'windows_service_status{name="spooler"} != 4',
    // A label the series has, asked to be absent.
    'windows_service_status{name=""} != 4',
  ])("%s does not, and is not claimed", (expression: string) => {
    expect(watchOf(expression)).toBeNull();
  });

  test("a host is compared as ingest stores it: trimmed and in lower case", () => {
    // The page's host, written as a person typed it.
    expect(
      watchOf('windows_service_status{resource_host_name="web-01"}', {
        ...spooler(),
        hostIdentifier: " WEB-01 ",
      }),
    ).toEqual(AMONG_OTHERS);

    // A query that wrote the host in capitals reads nothing, as in the engine.
    expect(
      watchOf('windows_service_status{resource_host_name="WEB-01"}'),
    ).toBeNull();
  });

  test.each([
    // By name, quoted as Prometheus 3 quotes a name with dots.
    '{"windows.service.status", name="Spooler"} != 4',
    // By __name__.
    '{__name__="windows_service_status", name="Spooler"} != 4',
    // By a pattern of names.
    '{__name__=~"windows_service_.+", name="Spooler"} != 4',
  ])("%s names the state metric another way", (expression: string) => {
    expect(watchOf(expression)).toEqual(NAMED);
  });

  test("a selector that names no metric reads every metric of the service, its state among them", () => {
    expect(watchOf('{name="Spooler"} != 4')).toEqual(NAMED);
    expect(
      watchOf('{__name__=~"windows_service_start.+", name="Spooler"}'),
    ).toBeNull();
  });

  test.each([
    'max_over_time(windows_service_status{name="Spooler"}[5m]) != 4',
    'count(windows_service_status{name="Spooler"} != 4) > 0',
    'max by (resource_host_name) (windows_service_status{name="Spooler"}) != 4',
    'absent(windows_service_status{name="Spooler", resource_host_name="web-01"})',
    'absent_over_time(windows_service_status{name="Spooler"}[10m])',
    '(windows_service_status{name="Spooler"} != bool 4) * 100',
    'windows_service_status{name="Spooler"} != 4 or windows_service_status{name="W3SVC"} != 4',
    'windows_service_status{name="W3SVC"} != 4 or windows_service_status{name="Spooler"} != 4',
    // Silenced during maintenance: another metric, on no labels.
    'windows_service_status{name="Spooler"} != 4 and on() maintenance_mode == 0',
    'windows_service_status{name="Spooler"} != 4 unless on() maintenance_mode == 1',
    // Another service left out.
    'windows_service_status != 4 unless windows_service_status{name="W3SVC"}',
    'windows_service_status{name="Spooler"} != 4 and windows_service_status{name="Spooler"}',
  ])(
    "%s watches it, whatever else the expression does",
    (expression: string) => {
      expect(watchOf(expression)?.isCertain).toBe(true);
    },
  );

  describe("what the page cannot know, it says", () => {
    test("a label it does not know the service's series by: named, and the monitor is not counted as sure", () => {
      expect(
        watchOf(
          'windows_service_status{name="Spooler", startup_mode="auto_start"} != 4',
        ),
      ).toEqual({
        isForThisService: true,
        isCertain: false,
        uncertainLabels: ["startup_mode"],
      });

      expect(
        watchOf(
          'windows_service_status{job="windows", instance=~"web.*", job!="x"} != 4',
        ),
      ).toEqual({
        isForThisService: false,
        isCertain: false,
        uncertainLabels: ["job", "instance"],
      });
    });

    test("a label it does not know never saves a selector its known labels leave out", () => {
      expect(
        watchOf(
          'windows_service_status{name="W3SVC", startup_mode="auto_start"} != 4',
        ),
      ).toBeNull();
    });

    test.each([
      // Only some series are kept.
      "topk(5, windows_service_status != 4)",
      'bottomk(1, windows_service_status{name="Spooler"})',
      // This service may be left out by the other side.
      'windows_service_status != 4 unless windows_service_status{name="Spooler"}',
      'windows_service_status != 4 unless windows_service_status{name=~"Spool.*"}',
      'windows_service_status != 4 and windows_service_status{name="W3SVC"}',
      'windows_service_status != 4 and windows_service_status{startup_mode="auto_start"}',
    ])("%s may leave it out", (expression: string) => {
      const watch: HostServicePromQLWatch | null = watchOf(expression);

      expect(watch).not.toBeNull();
      expect(watch!.isCertain).toBe(false);
      expect(watch!.uncertainLabels).toEqual([]);
    });

    test("of two selectors, the one the page is sure of", () => {
      expect(
        watchOf(
          'windows_service_status{startup_mode="auto_start"} != 4 or windows_service_status{name="Spooler"} != 4',
        ),
      ).toEqual(NAMED);
      expect(
        watchOf(
          'windows_service_status != 4 or windows_service_status{name="Spooler"} != 4',
        ),
      ).toEqual(NAMED);
    });
  });

  test.each([
    "",
    "   ",
    'windows_service_status{name="Spooler"',
    "windows_service_status !=",
    "sum(",
  ])("%j does not parse: it watches nothing", (expression: string) => {
    expect(watchOf(expression)).toBeNull();
  });
});

describe("a systemd unit's state, read in PromQL: nginx.service on web-01", () => {
  test.each([
    // As Create Monitor makes it, in PromQL.
    [
      'systemd_unit_state{resource_systemd_unit_name="nginx.service", systemd_unit_active_state="active", resource_host_name="web-01"} != 1',
      NAMED,
    ],
    // The unit's failed state: the host's Systemd Unit Failed alert, in PromQL.
    [
      'systemd_unit_state{resource_systemd_unit_name="nginx.service", systemd_unit_active_state="failed"} == 1',
      NAMED,
    ],
    // Every unit that failed, on every host.
    [
      'systemd_unit_state{systemd_unit_active_state="failed"} == 1',
      AMONG_OTHERS,
    ],
    [
      'systemd_unit_state{systemd_unit_active_state=~"failed|inactive"} == 1',
      AMONG_OTHERS,
    ],
    // Its name with the unit Prometheus writes into a gauge's ("1": _ratio).
    [
      'systemd_unit_state_ratio{resource_systemd_unit_name="nginx.service"} == 0',
      NAMED,
    ],
  ])("%s watches it", (expression: string, watch: HostServicePromQLWatch) => {
    expect(watchOf(expression, nginx())).toEqual(watch);
  });

  test.each([
    'systemd_unit_state{resource_systemd_unit_name="cron.service"} != 1',
    // No such state: no series of the unit has it.
    'systemd_unit_state{systemd_unit_active_state="crashed"} == 1',
    'systemd_unit_state{resource_systemd_unit_name="nginx.service", resource_host_name="web-02"}',
    // A Windows service's state is not a unit's.
    'windows_service_status{name="nginx.service"} != 4',
  ])("%s does not, and is not claimed", (expression: string) => {
    expect(watchOf(expression, nginx())).toBeNull();
  });

  test("a Windows service's label on a unit's state is one the page does not know it by", () => {
    expect(
      watchOf('systemd_unit_state{name="nginx.service"} != 1', nginx()),
    ).toEqual({
      isForThisService: false,
      isCertain: false,
      uncertainLabels: ["name"],
    });
  });
});
