import { describe, expect, test } from "@jest/globals";
import {
  HOST_NAME_ATTR,
  MIN_OTELCOL_CONTRIB_VERSION,
  SYSTEMD_ACTIVE_STATES,
  SYSTEMD_PLOT_RANK_MAX,
  SYSTEMD_UNIT_ACTIVE_STATE_ATTR,
  SYSTEMD_UNIT_NAME_ATTR,
  SYSTEMD_UNIT_STATE_METRIC_NAME,
  SystemdAvailability,
  SystemdMetricDatapoint,
  SystemdStateMeta,
  SystemdStateTransition,
  SystemdUnitRollup,
  SystemdUnitRow,
  SystemdUnitSample,
  activeStateMeta,
  buildSystemdUnitRows,
  buildSystemdUnitSamples,
  computeSystemdAvailability,
  decodeUnitNameFromUrl,
  detectSystemdStateTransitions,
  encodeUnitNameForUrl,
  hasSingleSampleTimestamp,
  systemdPlotRankLabel,
  systemdStatePlotRank,
  unitTypeLabel,
  unitTypeOf,
} from "../../FeatureSet/Dashboard/src/Pages/Host/Utils/SystemdUnits";

/*
 * The Systemd Units tab reads one metric, `systemd.unit.state`, and that
 * metric is a *state set*: every scrape emits one datapoint per possible
 * state for every unit, valued 1 on the state the unit is in and 0 on the
 * seven others. So the current state lives in an attribute, never in the
 * value — the exact inverse of the Windows Services tab next door, where the
 * value *is* the service state code.
 *
 * Every way of getting that wrong is silent. Read the value instead of the
 * attribute and every unit reports "Status 1". Take the first row per unit on
 * a newest-first sort and you get whichever of the eight datapoints ClickHouse
 * happened to return first — a coin toss that is right one time in eight.
 * Forget that the unit name is a RESOURCE attribute (so ingest stores it as
 * `resource.systemd.unit.name`, unlike the bare `systemd.unit.active_state`
 * that rides the datapoint) and the query matches nothing at all.
 *
 * None of those produce an error. They produce a tab that looks like it is
 * working and is quietly lying about whether a service is up, which is the one
 * thing this page exists to answer. So the shaping rules live in a pure module
 * and are pinned here against the exact datapoint shapes the receiver emits.
 */

const HOST: string = "prod-01";

/*
 * The wire shape after `resourcedetection` has stamped the host onto the
 * receiver's per-unit resource, as ingest stores it.
 */
function stateSetScrape(
  unitName: string,
  activeState: string,
  time: string,
): Array<SystemdMetricDatapoint> {
  return SYSTEMD_ACTIVE_STATES.map((state: string): SystemdMetricDatapoint => {
    return {
      time: time,
      value: state === activeState ? 1 : 0,
      attributes: {
        [SYSTEMD_UNIT_NAME_ATTR]: unitName,
        [SYSTEMD_UNIT_ACTIVE_STATE_ATTR]: state,
        [HOST_NAME_ATTR]: HOST,
      },
    };
  });
}

/*
 * What actually comes back from the pages' query, which drops the zeros
 * server-side with `value > 0` — one row per unit per scrape.
 */
function assertedScrape(
  unitName: string,
  activeState: string,
  time: string,
): SystemdMetricDatapoint {
  return {
    time: time,
    value: 1,
    attributes: {
      [SYSTEMD_UNIT_NAME_ATTR]: unitName,
      [SYSTEMD_UNIT_ACTIVE_STATE_ATTR]: activeState,
      [HOST_NAME_ATTR]: HOST,
    },
  };
}

function rowFor(
  rollup: SystemdUnitRollup,
  unitName: string,
): SystemdUnitRow | undefined {
  return rollup.rows.find((row: SystemdUnitRow) => {
    return row.name === unitName;
  });
}

describe("systemd metric contract", () => {
  test("reads the metric the receiver actually emits", () => {
    expect(SYSTEMD_UNIT_STATE_METRIC_NAME).toBe("systemd.unit.state");
  });

  test("the unit name is resource-prefixed, the state is not", () => {
    /*
     * systemdreceiver puts the unit name on the Resource and the state on the
     * datapoint; ingest prefixes only resource attributes. Swapping these is
     * the single most likely way to ship a permanently empty tab.
     */
    expect(SYSTEMD_UNIT_NAME_ATTR).toBe("resource.systemd.unit.name");
    expect(SYSTEMD_UNIT_ACTIVE_STATE_ATTR).toBe("systemd.unit.active_state");
    expect(SYSTEMD_UNIT_ACTIVE_STATE_ATTR.startsWith("resource.")).toBe(false);
  });

  test("hosts are matched on the canonicalized resource attribute", () => {
    expect(HOST_NAME_ATTR).toBe("resource.host.name");
  });

  test("quotes the first otelcol-contrib release that bundles the receiver", () => {
    /*
     * v0.142.0 is where it entered the contrib binary (older builds fail at
     * startup with 'receivers' unknown type: "systemd"), but v0.143.0 is the
     * first release without the two rough edges — the renamed CPU metric and
     * the cgroup probe that fired on non-.service units.
     */
    expect(MIN_OTELCOL_CONTRIB_VERSION).toBe("v0.143.0");
  });

  test("covers exactly the receiver's active_state enum", () => {
    expect([...SYSTEMD_ACTIVE_STATES].sort()).toEqual([
      "activating",
      "active",
      "deactivating",
      "failed",
      "inactive",
      "maintenance",
      "refreshing",
      "reloading",
    ]);
  });
});

describe("activeStateMeta", () => {
  test("labels every state systemd can report", () => {
    for (const state of SYSTEMD_ACTIVE_STATES) {
      const meta: SystemdStateMeta = activeStateMeta(state);
      expect(meta.label).not.toBe("Unknown");
      expect(meta.label.length).toBeGreaterThan(0);
      expect(meta.dot.length).toBeGreaterThan(0);
      expect(meta.pill.length).toBeGreaterThan(0);
      expect(meta.hex).toMatch(/^#[0-9a-f]{6}$/);
    }
  });

  test("gives failed its own colour, not the muted one inactive gets", () => {
    /*
     * "failed" is the state the page exists to surface. Reusing the inactive
     * grey would bury it in a list of a hundred stopped one-shot units.
     */
    expect(activeStateMeta("failed").label).toBe("Failed");
    expect(activeStateMeta("failed").hex).toBe("#ef4444");
    expect(activeStateMeta("failed").hex).not.toBe(
      activeStateMeta("inactive").hex,
    );
    expect(activeStateMeta("failed").hex).not.toBe(
      activeStateMeta("active").hex,
    );
  });

  test("active is green and inactive is grey", () => {
    expect(activeStateMeta("active").label).toBe("Active");
    expect(activeStateMeta("active").hex).toBe("#22c55e");
    expect(activeStateMeta("inactive").label).toBe("Inactive");
  });

  test("a missing state reads as Unknown rather than blank", () => {
    expect(activeStateMeta(null).label).toBe("Unknown");
  });

  test("an unrecognised state is echoed, not swallowed", () => {
    /*
     * systemd can grow a state the receiver's enum does not have yet. Showing
     * the raw value beats showing "Unknown" for every unit on the host.
     */
    expect(activeStateMeta("hibernating").label).toBe("hibernating");
  });
});

describe("systemdStatePlotRank", () => {
  test("ranks every known state and nothing else", () => {
    for (const state of SYSTEMD_ACTIVE_STATES) {
      expect(systemdStatePlotRank(state)).not.toBeNull();
    }
    expect(systemdStatePlotRank(null)).toBeNull();
    expect(systemdStatePlotRank("hibernating")).toBeNull();
  });

  test("ranks are distinct and inside the chart's y-axis range", () => {
    const ranks: Array<number> = SYSTEMD_ACTIVE_STATES.map(
      (state: string): number => {
        return systemdStatePlotRank(state)!;
      },
    );
    expect(new Set(ranks).size).toBe(ranks.length);
    for (const rank of ranks) {
      expect(rank).toBeGreaterThanOrEqual(0);
      expect(rank).toBeLessThanOrEqual(SYSTEMD_PLOT_RANK_MAX);
    }
  });

  test("orders worst to best so Min-aggregation surfaces the worst state", () => {
    /*
     * The chart buckets points on wide ranges and aggregates with Min. That is
     * only meaningful if the scale is monotone in severity — otherwise a
     * bucket containing a 30-second outage renders as healthy.
     */
    expect(systemdStatePlotRank("failed")).toBe(0);
    expect(systemdStatePlotRank("active")).toBe(SYSTEMD_PLOT_RANK_MAX);
    expect(systemdStatePlotRank("failed")!).toBeLessThan(
      systemdStatePlotRank("inactive")!,
    );
    expect(systemdStatePlotRank("inactive")!).toBeLessThan(
      systemdStatePlotRank("activating")!,
    );
    expect(systemdStatePlotRank("activating")!).toBeLessThan(
      systemdStatePlotRank("active")!,
    );
    expect(systemdStatePlotRank("deactivating")!).toBeLessThan(
      systemdStatePlotRank("activating")!,
    );
  });

  test("every rank round-trips back to the label the pills use", () => {
    for (const state of SYSTEMD_ACTIVE_STATES) {
      const rank: number = systemdStatePlotRank(state)!;
      expect(systemdPlotRankLabel(rank)).toBe(activeStateMeta(state).label);
    }
  });

  test("the axis ticks the chart actually draws all carry a label", () => {
    /*
     * The line chart's default 5-tick layout over [0, max] lands on the even
     * integers. A rank scale that puts a state on an odd tick leaves the axis
     * reading "Failed / / Activating / / Active".
     */
    for (const tick of [0, 2, 4, 6, 8]) {
      expect(systemdPlotRankLabel(tick).length).toBeGreaterThan(0);
    }
  });

  test("ranks with no state, and fractional ticks, render blank", () => {
    expect(systemdPlotRankLabel(7)).toBe("");
    expect(systemdPlotRankLabel(2.5)).toBe("");
    expect(systemdPlotRankLabel(-1)).toBe("");
    expect(systemdPlotRankLabel(99)).toBe("");
  });
});

describe("unitTypeOf / unitTypeLabel", () => {
  test("reads the type off the suffix", () => {
    expect(unitTypeOf("nginx.service")).toBe("service");
    expect(unitTypeOf("sshd.socket")).toBe("socket");
    expect(unitTypeOf("logrotate.timer")).toBe("timer");
    expect(unitTypeOf("multi-user.target")).toBe("target");
    expect(unitTypeOf("var-lib-docker.mount")).toBe("mount");
  });

  test("handles templated and escaped unit names", () => {
    expect(unitTypeOf("getty@tty1.service")).toBe("service");
    expect(unitTypeOf("user@1000.service")).toBe("service");
    expect(unitTypeOf("dev-disk-by\\x2duuid-1234.device")).toBe("device");
  });

  test("takes the last dot, not the first", () => {
    expect(unitTypeOf("systemd-journald.dev-log.socket")).toBe("socket");
  });

  test("normalises case", () => {
    expect(unitTypeOf("NGINX.SERVICE")).toBe("service");
    expect(unitTypeLabel("NGINX.SERVICE")).toBe("Service");
  });

  test("falls back rather than rendering an empty column", () => {
    expect(unitTypeOf("weird-unit-name")).toBe("");
    expect(unitTypeOf("trailing.")).toBe("");
    expect(unitTypeOf("")).toBe("");
    expect(unitTypeLabel("weird-unit-name")).toBe("Unit");
    expect(unitTypeLabel("trailing.")).toBe("Unit");
    expect(unitTypeLabel("")).toBe("Unit");
  });

  test("title-cases the label", () => {
    expect(unitTypeLabel("nginx.service")).toBe("Service");
    expect(unitTypeLabel("logrotate.timer")).toBe("Timer");
  });
});

describe("unit name URL codec", () => {
  const NASTY_NAMES: Array<string> = [
    "nginx.service",
    "getty@tty1.service",
    "dev-disk-by\\x2duuid-1234.device",
    "systemd-fsck@dev-sda1.service",
    "a unit with spaces.service",
    "weird~tilde.service",
    "percent%25.service",
    "hash#and?query.service",
    "unicode-ünïtñame.service",
    "plus+and&amp.service",
  ];

  test("round-trips every unit name shape systemd produces", () => {
    for (const name of NASTY_NAMES) {
      expect(decodeUnitNameFromUrl(encodeUnitNameForUrl(name))).toBe(name);
    }
  });

  test("escapes the tilde encodeURIComponent leaves alone", () => {
    // `~` survives encodeURIComponent but Route's charset rejects it.
    expect(encodeUnitNameForUrl("weird~tilde.service")).not.toContain("~");
    expect(encodeUnitNameForUrl("weird~tilde.service")).toContain("%7E");
  });

  test("a malformed escape falls back to the raw segment", () => {
    // A hand-edited URL must not blow up the page.
    expect(decodeUnitNameFromUrl("%")).toBe("%");
    expect(decodeUnitNameFromUrl("%zz")).toBe("%zz");
  });
});

describe("buildSystemdUnitRows", () => {
  test("reads the state off the asserted datapoint's attribute", () => {
    const rollup: SystemdUnitRollup = buildSystemdUnitRows(
      stateSetScrape("nginx.service", "active", "2026-08-03T10:00:00.000Z"),
    );

    expect(rollup.rows).toHaveLength(1);
    expect(rollup.rows[0]!.name).toBe("nginx.service");
    expect(rollup.rows[0]!.activeState).toBe("active");
    expect(rollup.rows[0]!.stateLabel).toBe("Active");
    expect(rollup.rows[0]!.unitType).toBe("service");
    expect(rollup.rows[0]!.unitTypeLabel).toBe("Service");
  });

  test("one scrape of a failed unit does not read as active", () => {
    /*
     * The regression this whole module exists to prevent: seven of the eight
     * datapoints in this scrape say "active/reloading/... = 0", and only one
     * says "failed = 1".
     */
    const rollup: SystemdUnitRollup = buildSystemdUnitRows(
      stateSetScrape("postgresql.service", "failed", "2026-08-03T10:00:00Z"),
    );

    expect(rollup.rows[0]!.activeState).toBe("failed");
    expect(rollup.rows[0]!.stateLabel).toBe("Failed");
  });

  test("does not depend on the order rows come back in", () => {
    const scrape: Array<SystemdMetricDatapoint> = stateSetScrape(
      "postgresql.service",
      "failed",
      "2026-08-03T10:00:00Z",
    );

    expect(
      buildSystemdUnitRows([...scrape].reverse()).rows[0]!.activeState,
    ).toBe("failed");
    expect(buildSystemdUnitRows([...scrape].sort()).rows[0]!.activeState).toBe(
      "failed",
    );
  });

  test("keeps one row per unit across many units", () => {
    const rollup: SystemdUnitRollup = buildSystemdUnitRows([
      ...stateSetScrape("nginx.service", "active", "2026-08-03T10:00:00Z"),
      ...stateSetScrape("cron.service", "active", "2026-08-03T10:00:00Z"),
      ...stateSetScrape("ufw.service", "inactive", "2026-08-03T10:00:00Z"),
      ...stateSetScrape("backup.service", "failed", "2026-08-03T10:00:00Z"),
    ]);

    expect(rollup.rows).toHaveLength(4);
    expect(rowFor(rollup, "ufw.service")!.activeState).toBe("inactive");
    expect(rowFor(rollup, "backup.service")!.activeState).toBe("failed");
  });

  test("the newest scrape wins when a unit changed state", () => {
    const rollup: SystemdUnitRollup = buildSystemdUnitRows([
      // Newest first, the way the query sorts.
      ...stateSetScrape("nginx.service", "failed", "2026-08-03T10:01:00Z"),
      ...stateSetScrape("nginx.service", "active", "2026-08-03T10:00:30Z"),
      ...stateSetScrape("nginx.service", "active", "2026-08-03T10:00:00Z"),
    ]);

    expect(rollup.rows).toHaveLength(1);
    expect(rollup.rows[0]!.activeState).toBe("failed");
  });

  test("an older scrape arriving last does not overwrite the newest", () => {
    const rollup: SystemdUnitRollup = buildSystemdUnitRows([
      ...stateSetScrape("nginx.service", "active", "2026-08-03T10:00:00Z"),
      ...stateSetScrape("nginx.service", "failed", "2026-08-03T10:01:00Z"),
    ]);

    expect(rollup.rows[0]!.activeState).toBe("failed");
  });

  test("works on the zero-filtered rows the page actually queries", () => {
    const rollup: SystemdUnitRollup = buildSystemdUnitRows([
      assertedScrape("nginx.service", "active", "2026-08-03T10:01:00Z"),
      assertedScrape("cron.service", "inactive", "2026-08-03T10:01:00Z"),
      assertedScrape("nginx.service", "activating", "2026-08-03T10:00:30Z"),
    ]);

    expect(rollup.rows).toHaveLength(2);
    expect(rowFor(rollup, "nginx.service")!.activeState).toBe("active");
    expect(rowFor(rollup, "cron.service")!.activeState).toBe("inactive");
  });

  test("accepts Decimal values that arrive as strings", () => {
    // ClickHouse hands Decimal back as a string on some driver paths.
    const rollup: SystemdUnitRollup = buildSystemdUnitRows([
      {
        time: "2026-08-03T10:00:00Z",
        value: "1",
        attributes: {
          [SYSTEMD_UNIT_NAME_ATTR]: "nginx.service",
          [SYSTEMD_UNIT_ACTIVE_STATE_ATTR]: "active",
        },
      },
      {
        time: "2026-08-03T10:00:00Z",
        value: "0",
        attributes: {
          [SYSTEMD_UNIT_NAME_ATTR]: "nginx.service",
          [SYSTEMD_UNIT_ACTIVE_STATE_ATTR]: "failed",
        },
      },
    ]);

    expect(rollup.rows[0]!.activeState).toBe("active");
  });

  test("accepts Date objects as well as ISO strings", () => {
    const rollup: SystemdUnitRollup = buildSystemdUnitRows([
      {
        time: new Date("2026-08-03T10:00:00Z"),
        value: 1,
        attributes: {
          [SYSTEMD_UNIT_NAME_ATTR]: "nginx.service",
          [SYSTEMD_UNIT_ACTIVE_STATE_ATTR]: "active",
        },
      },
    ]);

    expect(rollup.rows[0]!.activeState).toBe("active");
    expect(rollup.latestSampleAt!.toISOString()).toBe(
      "2026-08-03T10:00:00.000Z",
    );
  });

  test("a unit whose scrape asserts nothing still gets a row", () => {
    /*
     * Only reachable if the value filter is dropped and systemd reports a
     * state outside the receiver's enum. Listing the unit as Unknown is
     * honest; dropping it silently shrinks the list.
     */
    const allZero: Array<SystemdMetricDatapoint> = stateSetScrape(
      "mystery.service",
      "no-such-state",
      "2026-08-03T10:00:00Z",
    );

    const rollup: SystemdUnitRollup = buildSystemdUnitRows(allZero);

    expect(rollup.rows).toHaveLength(1);
    expect(rollup.rows[0]!.activeState).toBeNull();
    expect(rollup.rows[0]!.stateLabel).toBe("Unknown");
  });

  test("a newer all-zero scrape keeps the last state we did observe", () => {
    const rollup: SystemdUnitRollup = buildSystemdUnitRows([
      ...stateSetScrape(
        "nginx.service",
        "no-such-state",
        "2026-08-03T10:01:00Z",
      ),
      ...stateSetScrape("nginx.service", "active", "2026-08-03T10:00:00Z"),
    ]);

    expect(rollup.rows[0]!.activeState).toBe("active");
  });

  test("two states asserted at the same instant resolve to the worse one", () => {
    /*
     * ClickHouse gives no ordering guarantee between rows sharing a
     * timestamp, so the tie has to break deterministically — and it has to
     * break toward failed, or a flapping unit renders healthy at random.
     */
    const rollup: SystemdUnitRollup = buildSystemdUnitRows([
      assertedScrape("nginx.service", "active", "2026-08-03T10:00:00Z"),
      assertedScrape("nginx.service", "failed", "2026-08-03T10:00:00Z"),
    ]);

    expect(rollup.rows[0]!.activeState).toBe("failed");

    const reversed: SystemdUnitRollup = buildSystemdUnitRows([
      assertedScrape("nginx.service", "failed", "2026-08-03T10:00:00Z"),
      assertedScrape("nginx.service", "active", "2026-08-03T10:00:00Z"),
    ]);

    expect(reversed.rows[0]!.activeState).toBe("failed");
  });

  test("skips datapoints with no unit name", () => {
    const rollup: SystemdUnitRollup = buildSystemdUnitRows([
      {
        time: "2026-08-03T10:00:00Z",
        value: 1,
        attributes: { [SYSTEMD_UNIT_ACTIVE_STATE_ATTR]: "active" },
      },
      {
        time: "2026-08-03T10:00:00Z",
        value: 1,
        attributes: {
          [SYSTEMD_UNIT_NAME_ATTR]: "   ",
          [SYSTEMD_UNIT_ACTIVE_STATE_ATTR]: "active",
        },
      },
      assertedScrape("nginx.service", "active", "2026-08-03T10:00:00Z"),
    ]);

    expect(rollup.rows).toHaveLength(1);
    expect(rollup.rows[0]!.name).toBe("nginx.service");
  });

  test("skips datapoints with a missing or unparseable timestamp", () => {
    const rollup: SystemdUnitRollup = buildSystemdUnitRows([
      {
        time: "not-a-date",
        value: 1,
        attributes: {
          [SYSTEMD_UNIT_NAME_ATTR]: "ghost.service",
          [SYSTEMD_UNIT_ACTIVE_STATE_ATTR]: "active",
        },
      },
      {
        value: 1,
        attributes: {
          [SYSTEMD_UNIT_NAME_ATTR]: "ghost2.service",
          [SYSTEMD_UNIT_ACTIVE_STATE_ATTR]: "active",
        },
      },
      assertedScrape("nginx.service", "active", "2026-08-03T10:00:00Z"),
    ]);

    expect(rollup.rows).toHaveLength(1);
    expect(rollup.rows[0]!.name).toBe("nginx.service");
  });

  test("reports the newest timestamp it saw", () => {
    const rollup: SystemdUnitRollup = buildSystemdUnitRows([
      assertedScrape("nginx.service", "active", "2026-08-03T10:00:30Z"),
      assertedScrape("cron.service", "active", "2026-08-03T10:01:00Z"),
      assertedScrape("ufw.service", "active", "2026-08-03T09:59:00Z"),
    ]);

    expect(rollup.latestSampleAt!.toISOString()).toBe(
      "2026-08-03T10:01:00.000Z",
    );
  });

  test("an empty result is empty, not a row of nulls", () => {
    const rollup: SystemdUnitRollup = buildSystemdUnitRows([]);

    expect(rollup.rows).toEqual([]);
    expect(rollup.latestSampleAt).toBeNull();
  });
});

describe("hasSingleSampleTimestamp", () => {
  /*
   * The list page pairs this with "the fetch returned its full limit" to tell
   * a capped-but-complete snapshot from one that was cut off inside the newest
   * scrape. Only the second case hides units, and only that case is worth
   * warning about.
   */
  test("one scrape's worth of rows shares a single timestamp", () => {
    expect(
      hasSingleSampleTimestamp([
        ...stateSetScrape("nginx.service", "active", "2026-08-03T10:00:00Z"),
        ...stateSetScrape("cron.service", "active", "2026-08-03T10:00:00Z"),
      ]),
    ).toBe(true);
  });

  test("a second timestamp proves the newest scrape came back whole", () => {
    expect(
      hasSingleSampleTimestamp([
        assertedScrape("nginx.service", "active", "2026-08-03T10:01:00Z"),
        assertedScrape("nginx.service", "active", "2026-08-03T10:00:30Z"),
      ]),
    ).toBe(false);
  });

  test("no parseable rows is not a truncated snapshot", () => {
    expect(hasSingleSampleTimestamp([])).toBe(false);
    expect(hasSingleSampleTimestamp([{ time: "nope", value: 1 }])).toBe(false);
  });

  test("ignores rows whose timestamp will not parse", () => {
    expect(
      hasSingleSampleTimestamp([
        { time: "nope", value: 1 },
        assertedScrape("nginx.service", "active", "2026-08-03T10:00:00Z"),
      ]),
    ).toBe(true);
  });
});

describe("buildSystemdUnitSamples", () => {
  test("returns the state per scrape, oldest first", () => {
    const samples: Array<SystemdUnitSample> = buildSystemdUnitSamples([
      // Newest first, the way the query sorts.
      assertedScrape("nginx.service", "active", "2026-08-03T10:02:00Z"),
      assertedScrape("nginx.service", "activating", "2026-08-03T10:01:00Z"),
      assertedScrape("nginx.service", "failed", "2026-08-03T10:00:00Z"),
    ]);

    expect(
      samples.map((sample: SystemdUnitSample): string => {
        return sample.state;
      }),
    ).toEqual(["failed", "activating", "active"]);
    expect(samples[0]!.time.toISOString()).toBe("2026-08-03T10:00:00.000Z");
  });

  test("collapses a full state set to one sample per scrape", () => {
    const samples: Array<SystemdUnitSample> = buildSystemdUnitSamples([
      ...stateSetScrape("nginx.service", "active", "2026-08-03T10:00:00Z"),
      ...stateSetScrape("nginx.service", "failed", "2026-08-03T10:00:30Z"),
    ]);

    expect(samples).toHaveLength(2);
    expect(samples[0]!.state).toBe("active");
    expect(samples[1]!.state).toBe("failed");
  });

  test("drops rows with no state attribute", () => {
    const samples: Array<SystemdUnitSample> = buildSystemdUnitSamples([
      {
        time: "2026-08-03T10:00:00Z",
        value: 1,
        attributes: { [SYSTEMD_UNIT_NAME_ATTR]: "nginx.service" },
      },
      assertedScrape("nginx.service", "active", "2026-08-03T10:00:30Z"),
    ]);

    expect(samples).toHaveLength(1);
    expect(samples[0]!.state).toBe("active");
  });

  test("a tie inside one scrape resolves to the worse state", () => {
    const samples: Array<SystemdUnitSample> = buildSystemdUnitSamples([
      assertedScrape("nginx.service", "active", "2026-08-03T10:00:00Z"),
      assertedScrape("nginx.service", "failed", "2026-08-03T10:00:00Z"),
    ]);

    expect(samples).toHaveLength(1);
    expect(samples[0]!.state).toBe("failed");
  });

  test("an empty range yields no samples", () => {
    expect(buildSystemdUnitSamples([])).toEqual([]);
  });
});

describe("detectSystemdStateTransitions", () => {
  function samplesOf(...states: Array<string>): Array<SystemdUnitSample> {
    return states.map((state: string, index: number): SystemdUnitSample => {
      return {
        time: new Date(Date.UTC(2026, 7, 3, 10, 0, index * 30)),
        state: state,
      };
    });
  }

  test("a steady unit has no transitions", () => {
    expect(
      detectSystemdStateTransitions(samplesOf("active", "active", "active")),
    ).toEqual([]);
  });

  test("records the change at the sample it was first observed on", () => {
    const transitions: Array<SystemdStateTransition> =
      detectSystemdStateTransitions(samplesOf("active", "active", "failed"));

    expect(transitions).toHaveLength(1);
    expect(transitions[0]!.fromState).toBe("active");
    expect(transitions[0]!.toState).toBe("failed");
    expect(transitions[0]!.time.toISOString()).toBe("2026-08-03T10:01:00.000Z");
  });

  test("follows a restart through its intermediate states", () => {
    const transitions: Array<SystemdStateTransition> =
      detectSystemdStateTransitions(
        samplesOf("active", "deactivating", "inactive", "activating", "active"),
      );

    expect(
      transitions.map((transition: SystemdStateTransition): string => {
        return `${transition.fromState}->${transition.toState}`;
      }),
    ).toEqual([
      "active->deactivating",
      "deactivating->inactive",
      "inactive->activating",
      "activating->active",
    ]);
  });

  test("counts each flap of a crash-looping unit", () => {
    const transitions: Array<SystemdStateTransition> =
      detectSystemdStateTransitions(
        samplesOf("active", "failed", "active", "failed"),
      );

    expect(transitions).toHaveLength(3);
  });

  test("a single sample cannot be a transition", () => {
    expect(detectSystemdStateTransitions(samplesOf("active"))).toEqual([]);
    expect(detectSystemdStateTransitions([])).toEqual([]);
  });
});

describe("computeSystemdAvailability", () => {
  function samplesOf(...states: Array<string>): Array<SystemdUnitSample> {
    return states.map((state: string, index: number): SystemdUnitSample => {
      return {
        time: new Date(Date.UTC(2026, 7, 3, 10, 0, index * 30)),
        state: state,
      };
    });
  }

  test("a unit that was always active is 100%", () => {
    const availability: SystemdAvailability = computeSystemdAvailability(
      samplesOf("active", "active", "active", "active"),
    );

    expect(availability.percent).toBe(100);
    expect(availability.activeSampleCount).toBe(4);
    expect(availability.totalSampleCount).toBe(4);
  });

  test("only 'active' counts — transitional states are not up", () => {
    const availability: SystemdAvailability = computeSystemdAvailability(
      samplesOf("active", "activating", "failed", "active"),
    );

    expect(availability.activeSampleCount).toBe(2);
    expect(availability.percent).toBe(50);
  });

  test("a unit that never came up is 0%, not null", () => {
    const availability: SystemdAvailability = computeSystemdAvailability(
      samplesOf("failed", "failed"),
    );

    expect(availability.percent).toBe(0);
    expect(availability.activeSampleCount).toBe(0);
  });

  test("no samples means no number to show, not 0%", () => {
    /*
     * "0% available" and "we have no data" are different answers, and the
     * tile renders an em dash for the second.
     */
    const availability: SystemdAvailability = computeSystemdAvailability([]);

    expect(availability.percent).toBeNull();
    expect(availability.totalSampleCount).toBe(0);
  });
});
