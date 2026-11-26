import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  Translator,
  createTranslator,
} from "../../../UI/Utils/TranslateTemplate";
import {
  XcpNgPoolConnection,
  getXcpNgPoolConnection,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/XcpNg/Utils/XcpNgPoolConnection";
import {
  RESOURCE_AGENT_HEARD_WINDOW_MS,
  ResourceConnectionState,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceConnection/ResourceConnectionState";

/*
 * Where an XCP-ng pool stands with the Xen Orchestra it is read from, as
 * its hero pill and the pools list say it. Connected while the pool is READ
 * (lastSeenAt, refreshed only from a batch that carried what Xen Orchestra
 * says about the pool); "Can't read API" while its agent still sends for it
 * (agentLastSeenAt is recent) but the pool is not read; "Waiting for data"
 * before its first read, as for a pool added ahead by its UUID; Disconnected
 * once nothing arrives; never connected when nothing ever did. Then the
 * wiring: the pools list reads it, with both clocks selected.
 */

const NOW: Date = new Date("2026-11-24T12:00:00.000Z");

function minutesAgo(minutes: number): Date {
  return new Date(NOW.getTime() - minutes * 60 * 1000);
}

const ENGLISH: Translator = createTranslator(undefined, "en");

const DASHBOARD_SRC: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src",
);

function readLocale(code: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(
      path.join(DASHBOARD_SRC, "Locales", `${code}.json`),
      "utf8",
    ),
  ) as Record<string, string>;
}

const GERMAN_WORDS: Record<string, string> = readLocale("de");
const GERMAN: Translator = createTranslator((text: string) => {
  return GERMAN_WORDS[text];
}, "de");

function connectionOf(
  pool: {
    otelCollectorStatus?: string | null;
    lastSeenAt?: Date | string | null;
    agentLastSeenAt?: Date | string | null;
  },
  translator: Translator = ENGLISH,
): XcpNgPoolConnection {
  return getXcpNgPoolConnection({ pool, translator, now: NOW });
}

describe("getXcpNgPoolConnection", () => {
  test("a pool read in the last minutes is Connected, in green", () => {
    const connection: XcpNgPoolConnection = connectionOf({
      otelCollectorStatus: "connected",
      lastSeenAt: minutesAgo(1),
      agentLastSeenAt: minutesAgo(1),
    });

    expect(connection.state).toBe(ResourceConnectionState.Connected);
    expect(connection.isConnected).toBe(true);
    expect(connection.label).toBe("Connected");
    expect(connection.badgeClassName).toContain("emerald");
    expect(connection.dotClassName).toBe("bg-emerald-500");
    expect(connection.listDotClassName).toBe("bg-emerald-500");
    expect(connection.listTextClassName).toBe("text-emerald-700");
  });

  test("connected reads as connected whatever the clocks say: the server marks it", () => {
    // The server flips the status 15 minutes after the last read; the page trusts it.
    expect(
      connectionOf({
        otelCollectorStatus: "connected",
        lastSeenAt: minutesAgo(14),
        agentLastSeenAt: null,
      }).state,
    ).toBe(ResourceConnectionState.Connected);
    // "Connected" in any case, as every overview hero reads it.
    expect(connectionOf({ otelCollectorStatus: "Connected" }).isConnected).toBe(
      true,
    );
  });

  test("its agent still sending for it, the pool not read for 25 minutes: Can't read API, in amber - not Connected, not Disconnected", () => {
    const connection: XcpNgPoolConnection = connectionOf({
      otelCollectorStatus: "disconnected",
      lastSeenAt: minutesAgo(25),
      agentLastSeenAt: minutesAgo(3),
    });

    expect(connection.state).toBe(ResourceConnectionState.ReadingStopped);
    expect(connection.isConnected).toBe(false);
    expect(connection.label).toBe("Can't read API");
    expect(connection.badgeClassName).toContain("amber");
    expect(connection.listDotClassName).toBe("bg-amber-500");
    expect(connection.listTextClassName).toBe("text-amber-700");
  });

  test("its agent sending, the pool never read (added ahead by its UUID): Waiting for data, in indigo", () => {
    const connection: XcpNgPoolConnection = connectionOf({
      otelCollectorStatus: "disconnected",
      lastSeenAt: null,
      agentLastSeenAt: minutesAgo(1),
    });

    expect(connection.state).toBe(ResourceConnectionState.NotReadYet);
    expect(connection.isConnected).toBe(false);
    expect(connection.label).toBe("Waiting for data");
    expect(connection.badgeClassName).toContain("indigo");
    expect(connection.listDotClassName).toBe("bg-indigo-500");
    expect(connection.listTextClassName).toBe("text-indigo-700");
  });

  test("nothing from the agent for over 15 minutes: Disconnected, amber in the hero and red in the list", () => {
    const connection: XcpNgPoolConnection = connectionOf({
      otelCollectorStatus: "disconnected",
      lastSeenAt: minutesAgo(60),
      agentLastSeenAt: minutesAgo(20),
    });

    expect(connection.state).toBe(ResourceConnectionState.Disconnected);
    expect(connection.label).toBe("Disconnected");
    expect(connection.badgeClassName).toContain("amber");
    expect(connection.dotClassName).toBe("bg-amber-500");
    expect(connection.listDotClassName).toBe("bg-red-500");
    expect(connection.listTextClassName).toBe("text-red-700");
  });

  test("never read and its agent never heard: never connected, which reads Disconnected", () => {
    const connection: XcpNgPoolConnection = connectionOf({
      otelCollectorStatus: "disconnected",
      lastSeenAt: null,
      agentLastSeenAt: null,
    });

    expect(connection.state).toBe(ResourceConnectionState.NeverConnected);
    expect(connection.isConnected).toBe(false);
    expect(connection.label).toBe("Disconnected");
    expect(connection.listDotClassName).toBe("bg-red-500");
  });

  test("a pool whose status was never written (null) reads as never connected", () => {
    expect(connectionOf({}).state).toBe(ResourceConnectionState.NeverConnected);
    expect(connectionOf({}).label).toBe("Disconnected");
  });

  test("the agent's window is the server's 15 minutes, edge included", () => {
    const window: number = RESOURCE_AGENT_HEARD_WINDOW_MS / 60 / 1000;

    expect(window).toBe(15);
    expect(
      connectionOf({
        otelCollectorStatus: "disconnected",
        lastSeenAt: minutesAgo(30),
        agentLastSeenAt: minutesAgo(window),
      }).state,
    ).toBe(ResourceConnectionState.ReadingStopped);
    expect(
      connectionOf({
        otelCollectorStatus: "disconnected",
        lastSeenAt: minutesAgo(30),
        agentLastSeenAt: minutesAgo(window + 1),
      }).state,
    ).toBe(ResourceConnectionState.Disconnected);
  });

  test("an agent clock a little ahead of the reader's counts as heard", () => {
    expect(
      connectionOf({
        otelCollectorStatus: "disconnected",
        lastSeenAt: minutesAgo(30),
        agentLastSeenAt: new Date(NOW.getTime() + 60 * 1000),
      }).state,
    ).toBe(ResourceConnectionState.ReadingStopped);
  });

  test("clocks sent as the API's strings read as dates; a value that is no date reads as never", () => {
    expect(
      connectionOf({
        otelCollectorStatus: "disconnected",
        lastSeenAt: minutesAgo(30).toISOString(),
        agentLastSeenAt: minutesAgo(2).toISOString(),
      }).state,
    ).toBe(ResourceConnectionState.ReadingStopped);
    expect(
      connectionOf({
        otelCollectorStatus: "disconnected",
        lastSeenAt: "not a date",
        agentLastSeenAt: "not a date either",
      }).state,
    ).toBe(ResourceConnectionState.NeverConnected);
  });

  test("every state has its colours: no state draws an empty class", () => {
    const states: Array<{
      otelCollectorStatus?: string | null;
      lastSeenAt?: Date | null;
      agentLastSeenAt?: Date | null;
    }> = [
      { otelCollectorStatus: "connected" },
      {
        otelCollectorStatus: "disconnected",
        lastSeenAt: minutesAgo(25),
        agentLastSeenAt: minutesAgo(3),
      },
      {
        otelCollectorStatus: "disconnected",
        lastSeenAt: null,
        agentLastSeenAt: minutesAgo(3),
      },
      { otelCollectorStatus: "disconnected", lastSeenAt: minutesAgo(60) },
      { otelCollectorStatus: "disconnected" },
    ];

    const seen: Set<ResourceConnectionState> = new Set();
    for (const pool of states) {
      const connection: XcpNgPoolConnection = connectionOf(pool);
      seen.add(connection.state);
      expect(connection.badgeClassName).not.toBe("");
      expect(connection.dotClassName).not.toBe("");
      expect(connection.listDotClassName).not.toBe("");
      expect(connection.listTextClassName).not.toBe("");
      expect(connection.label).not.toBe("");
    }
    // One example of every state.
    expect(seen.size).toBe(Object.values(ResourceConnectionState).length);
  });

  test("in German, the reader's own words for every state", () => {
    expect(
      connectionOf(
        {
          otelCollectorStatus: "disconnected",
          lastSeenAt: minutesAgo(25),
          agentLastSeenAt: minutesAgo(3),
        },
        GERMAN,
      ).label,
    ).toBe(GERMAN_WORDS["Can't read API"]);
    expect(
      connectionOf(
        {
          otelCollectorStatus: "disconnected",
          lastSeenAt: null,
          agentLastSeenAt: minutesAgo(1),
        },
        GERMAN,
      ).label,
    ).toBe(GERMAN_WORDS["Waiting for data"]);
    expect(
      connectionOf({ otelCollectorStatus: "connected" }, GERMAN).label,
    ).toBe(GERMAN_WORDS["Connected"]);
    expect(
      connectionOf(
        { otelCollectorStatus: "disconnected", lastSeenAt: minutesAgo(60) },
        GERMAN,
      ).label,
    ).toBe(GERMAN_WORDS["Disconnected"]);
  });
});

describe("the pools list reads it", () => {
  const pools: string = fs.readFileSync(
    path.join(DASHBOARD_SRC, "Pages/XcpNg/Pools.tsx"),
    "utf8",
  );

  test("the status column reads the one connection reading, with both clocks selected", () => {
    expect(pools).toContain("getXcpNgPoolConnection({");
    expect(pools).toMatch(
      /selectMoreFields=\{\{\s*otelCollectorStatus: true,\s*lastSeenAt: true,\s*agentLastSeenAt: true,/,
    );
    expect(pools).toContain('data-testid="xcp-ng-pool-status"');
    expect(pools).toContain("data-state={connection.state}");
    // No reading of its own: "connected" or red Disconnected.
    expect(pools).not.toContain('item.otelCollectorStatus === "connected"');
  });

  test("the running counts go grey, not red, for a pool that is not read now", () => {
    const dense: string = pools.replace(/\s+/g, "");
    expect(dense).toContain("isConnected:getXcpNgPoolConnection({pool:item,");
    expect(dense.split("isConnected:getXcpNgPoolConnection(").length - 1).toBe(
      2,
    );
    expect(pools).toContain('"text-gray-500"');
  });
});
