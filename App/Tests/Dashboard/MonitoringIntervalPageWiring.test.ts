import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Sub-minute monitoring intervals are self-hosted only, and which of them a
 * given monitor may use depends on its type. Those rules live in one place
 * (Common/Utils/Monitor/MonitoringIntervalUtil, tested exhaustively there) so
 * that the server validates against exactly the list the dashboard renders.
 *
 * What is pinned here is that all four interval pickers actually go through
 * that one place. Before this change three of them carried their own copy of
 * the "which intervals are allowed" filter and the fourth carried none at
 * all - which is how the monitor edit page ended up offering Every Minute to
 * synthetic monitors that the create page refused it for.
 *
 * These are JSX props, not extractable logic, and the App suite runs in a
 * plain Node environment with no renderer - so the sources are read and the
 * exact expressions asserted, the same way MonitorProbeSelectionPages.test.ts
 * does. Whitespace is squashed first so prettier re-wrapping a line cannot
 * turn a real regression check into a red herring.
 */

const APP_ROOT: string = path.join(__dirname, "..", "..");

const DASHBOARD_SRC: string = path.join(
  APP_ROOT,
  "FeatureSet",
  "Dashboard",
  "src",
);

function squash(text: string): string {
  return text.replace(/\s+/g, " ");
}

function readDashboardSource(...relativeParts: Array<string>): string {
  return squash(
    fs.readFileSync(path.join(DASHBOARD_SRC, ...relativeParts), "utf8"),
  );
}

const INTERVAL_PICKER_SOURCES: Array<[string, Array<string>]> = [
  ["Monitor create", ["Pages", "Monitor", "Create.tsx"]],
  ["Monitor interval settings", ["Pages", "Monitor", "View", "Interval.tsx"]],
  [
    "Monitor template create",
    ["Pages", "Monitor", "Settings", "MonitorTemplates.tsx"],
  ],
  [
    "Monitor template view",
    ["Pages", "Monitor", "Settings", "MonitorTemplatesView.tsx"],
  ],
];

describe("every monitoring-interval picker shares one implementation", () => {
  test.each(INTERVAL_PICKER_SOURCES)(
    "%s builds its options with getMonitoringIntervalOptions",
    (_name: string, relativeParts: Array<string>) => {
      const source: string = readDashboardSource(...relativeParts);

      expect(source).toContain("getMonitoringIntervalOptions(");
    },
  );

  test.each(INTERVAL_PICKER_SOURCES)(
    "%s no longer carries its own copy of the interval filter",
    (_name: string, relativeParts: Array<string>) => {
      const source: string = readDashboardSource(...relativeParts);

      expect(source).not.toContain(squash('option.value !== "* * * * *"'));
      expect(source).not.toContain(squash('option.value !== "*/2 * * * *"'));
    },
  );

  test("the interval settings page fetches its options instead of hardcoding them", () => {
    const source: string = readDashboardSource(
      "Pages",
      "Monitor",
      "View",
      "Interval.tsx",
    );

    /*
     * This page used a static dropdownOptions list, so it could not react to
     * the monitor's type at all.
     */
    expect(source).toContain("fetchDropdownOptions:");
    expect(source).not.toContain("dropdownOptions: MonitoringInterval");
  });

  test("the default interval for a new monitor stays at five minutes", () => {
    const source: string = readDashboardSource(
      "Pages",
      "Monitor",
      "Create.tsx",
    );

    // Sub-minute is opt-in per monitor; nothing gets faster by default.
    expect(source).toContain(squash('monitoringInterval: "*/5 * * * *"'));
  });

  test("the create page still has its Probes & Interval step", () => {
    const source: string = readDashboardSource(
      "Pages",
      "Monitor",
      "Create.tsx",
    );

    expect(source).toContain(squash('stepId: "monitoring-interval",'));
  });
});

describe("the self-hosted gate lives in exactly one file", () => {
  test("the options helper is the only dashboard file that reads BILLING_ENABLED for intervals", () => {
    const source: string = readDashboardSource(
      "Utils",
      "MonitorIntervalDropdownOptions.ts",
    );

    expect(source).toContain("BILLING_ENABLED");
    expect(source).toContain(
      "isSubMinuteAllowed: isSubMinuteMonitoringAllowed()",
    );
  });

  test.each(INTERVAL_PICKER_SOURCES)(
    "%s does not gate on BILLING_ENABLED itself",
    (_name: string, relativeParts: Array<string>) => {
      const source: string = readDashboardSource(...relativeParts);

      expect(source).not.toContain("BILLING_ENABLED");
    },
  );
});

describe("a stored interval always renders, even one this instance cannot offer", () => {
  test("the label element looks values up across every interval, not the gated subset", () => {
    const source: string = readDashboardSource(
      "Components",
      "Monitor",
      "MonitoringIntervalElement.tsx",
    );

    /*
     * A monitor whose interval was set on a self-hosted instance, or through
     * the API, used to render an empty div here because the lookup missed.
     */
    expect(source).toContain("MonitoringIntervalUtil.getLabel(");
    expect(source).not.toContain("getMonitoringIntervalOptions");
    expect(source).toContain("label || props.monitoringInterval");
  });
});

describe("the probe ingest endpoint bounds how much a probe can claim", () => {
  test("the monitor list limit is clamped", () => {
    /*
     * The probe now asks for work every ten seconds rather than once a
     * minute, so an unbounded limit is a much larger claim transaction many
     * times more often.
     */
    const source: string = squash(
      fs.readFileSync(
        path.join(
          APP_ROOT,
          "FeatureSet",
          "Telemetry",
          "API",
          "ProbeIngest",
          "Monitor.ts",
        ),
        "utf8",
      ),
    );

    expect(source).toContain("MAX_MONITOR_FETCH_LIMIT");
    expect(source).toContain(
      squash(
        'const limit: number = Math.min( (data["limit"] as number) || 100, MAX_MONITOR_FETCH_LIMIT, );',
      ),
    );
  });
});
