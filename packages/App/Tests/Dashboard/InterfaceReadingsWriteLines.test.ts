import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  LINK_SATURATION_THRESHOLD_PERCENT,
  linkStateForEdge,
} from "../../FeatureSet/Dashboard/src/Components/Topology/NetworkTopologyMeta";
import {
  RankableInterface,
  rankInterfacesForAttention,
} from "../../FeatureSet/Dashboard/src/Components/NetworkDevice/InterfaceAttentionUtil";
import { NetworkTopologyEdge } from "Common/Types/Monitor/SnmpMonitor/NetworkTopology";
import InterfaceInventoryUtil, {
  INTERFACE_SATURATION_THRESHOLD_PERCENT,
  InterfaceExistingRowSnapshot,
  InterfaceUpdateRow,
} from "Common/Utils/Monitor/InterfaceInventoryUtil";

/*
 * THE LINES A WALK ALWAYS WRITES AN INTERFACE'S READINGS ACROSS ARE THE
 * LINES THE DASHBOARD DRAWS.
 *
 * A device walk writes an interface's stored readings (in / out rate,
 * utilization, errors per second) only when they move noticeably, and at
 * least every fifteen minutes (InterfaceInventoryUtil.ratesMoved). A small
 * move is not written - unless it crosses a line a reader draws, which is
 * always written:
 *
 *   - utilization reaching or leaving 80%: the map draws the link
 *     saturated (LINK_SATURATION_THRESHOLD_PERCENT), and the device's
 *     interface preview highlights the row;
 *   - errors starting or stopping: the preview ranks an erroring port above
 *     a busy one (InterfaceAttentionUtil).
 *
 * If one of those lines moved without the other, the map could show a link
 * as healthy for fifteen minutes after it saturated. These tests fail
 * first.
 */

const DASHBOARD: string = path.resolve(
  __dirname,
  "../../FeatureSet/Dashboard/src",
);

function row(overrides: Partial<InterfaceUpdateRow>): InterfaceUpdateRow {
  return {
    interfaceIndex: 1,
    name: "Te1/0/1",
    alias: null,
    macAddress: null,
    interfaceType: 6,
    isOperationallyUp: true,
    isAdministrativelyUp: true,
    speedInMbps: 10000,
    inRateMbps: 7950,
    outRateMbps: 1200,
    utilizationPercent: 79.5,
    errorsPerSecond: 0,
    lastSeenAt: new Date("2026-11-14T10:00:00.000Z"),
    ...overrides,
  };
}

function stored(update: InterfaceUpdateRow): InterfaceExistingRowSnapshot {
  return { ...update, isMonitored: true };
}

function edgeAt(utilizationPercent: number): NetworkTopologyEdge {
  return {
    id: "core-1:access-1",
    fromNodeId: "core-1",
    toNodeId: "access-1",
    protocols: ["lldp"],
    fromInterface: {
      interfaceIndex: 1,
      isOperationallyUp: true,
      utilizationPercent,
    },
  } as unknown as NetworkTopologyEdge;
}

describe("the readings a walk always writes", () => {
  test("the map saturates a link where the write rule draws its line", () => {
    expect(INTERFACE_SATURATION_THRESHOLD_PERCENT).toBe(
      LINK_SATURATION_THRESHOLD_PERCENT,
    );
  });

  test("a step across the line is written however small it is, and the map's link changes with it", () => {
    const before: InterfaceUpdateRow = row({ utilizationPercent: 79.9 });
    const after: InterfaceUpdateRow = row({ utilizationPercent: 80 });

    expect(
      InterfaceInventoryUtil.ratesMoved({
        stored: stored(before),
        update: after,
      }),
    ).toBe(true);
    expect(linkStateForEdge(edgeAt(79.9))).toBe("healthy");
    expect(linkStateForEdge(edgeAt(80))).toBe("saturated");

    // And back.
    expect(
      InterfaceInventoryUtil.ratesMoved({
        stored: stored(after),
        update: before,
      }),
    ).toBe(true);
  });

  test("a step that crosses no line, and is under a tenth, waits for the refresh: the map draws the same", () => {
    const before: InterfaceUpdateRow = row({ utilizationPercent: 40 });
    const after: InterfaceUpdateRow = row({ utilizationPercent: 42 });

    expect(
      InterfaceInventoryUtil.ratesMoved({
        stored: stored(before),
        update: after,
      }),
    ).toBe(false);
    expect(linkStateForEdge(edgeAt(40))).toBe(linkStateForEdge(edgeAt(42)));
  });

  test("the interface preview highlights a port at the same line", () => {
    const preview: string = fs.readFileSync(
      path.join(
        DASHBOARD,
        "Components/NetworkDevice/DeviceInterfacesPreview.tsx",
      ),
      "utf8",
    );

    expect(preview).toContain(
      `(row.utilizationPercent || 0) >= ${INTERFACE_SATURATION_THRESHOLD_PERCENT}`,
    );
  });

  test("errors starting or stopping are written, and move the port in the preview's order", () => {
    const quiet: InterfaceUpdateRow = row({ errorsPerSecond: 0 });
    const erroring: InterfaceUpdateRow = row({ errorsPerSecond: 0.01 });

    expect(
      InterfaceInventoryUtil.ratesMoved({
        stored: stored(quiet),
        update: erroring,
      }),
    ).toBe(true);
    expect(
      InterfaceInventoryUtil.ratesMoved({
        stored: stored(erroring),
        update: quiet,
      }),
    ).toBe(true);

    const busy: RankableInterface = {
      interfaceIndex: 1,
      isOperationallyUp: true,
      isAdministrativelyUp: true,
      utilizationPercent: 95,
      errorsPerSecond: 0,
    };
    const withErrors: RankableInterface = {
      interfaceIndex: 2,
      isOperationallyUp: true,
      isAdministrativelyUp: true,
      utilizationPercent: 1,
      errorsPerSecond: 0.01,
    };

    expect(rankInterfacesForAttention([busy, withErrors], 2)).toEqual([
      withErrors,
      busy,
    ]);
  });
});
