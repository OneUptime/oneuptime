import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  Translator,
  createTranslator,
} from "../../../UI/Utils/TranslateTemplate";
import {
  ProxmoxClusterConnection,
  getProxmoxClusterConnection,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Proxmox/Utils/ProxmoxClusterConnection";
import { ResourceConnectionState } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceConnection/ResourceConnectionState";

/*
 * Issue #7439: where a Proxmox cluster stands with its agent, as its hero
 * pill and the clusters list say it. Connected while the cluster is READ;
 * "Can't read API" while its agent runs (agentLastSeenAt is recent) but the
 * cluster is not read - the node it reads is down, no node answers, the
 * token was revoked; "Waiting for data" before the first read; Disconnected
 * once nothing arrives. Then the wiring: the overview's hero and card and
 * the clusters list read it, with the agent's clock selected.
 */

const NOW: Date = new Date("2026-11-13T12:00:00.000Z");

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
  cluster: {
    otelCollectorStatus?: string | null;
    lastSeenAt?: Date | string | null;
    agentLastSeenAt?: Date | string | null;
  },
  translator: Translator = ENGLISH,
): ProxmoxClusterConnection {
  return getProxmoxClusterConnection({ cluster, translator, now: NOW });
}

describe("getProxmoxClusterConnection", () => {
  test("a cluster read in the last minutes is Connected, in green", () => {
    const connection: ProxmoxClusterConnection = connectionOf({
      otelCollectorStatus: "connected",
      lastSeenAt: minutesAgo(1),
      agentLastSeenAt: minutesAgo(4),
    });

    expect(connection.state).toBe(ResourceConnectionState.Connected);
    expect(connection.isConnected).toBe(true);
    expect(connection.label).toBe("Connected");
    expect(connection.badgeClassName).toContain("emerald");
    expect(connection.listDotClassName).toBe("bg-emerald-500");
  });

  test("its agent running, the cluster not read for 25 minutes: Can't read API, in amber - not Connected, not Disconnected", () => {
    const connection: ProxmoxClusterConnection = connectionOf({
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

  test("its agent running, the cluster never read: Waiting for data, in indigo", () => {
    const connection: ProxmoxClusterConnection = connectionOf({
      otelCollectorStatus: "disconnected",
      lastSeenAt: null,
      agentLastSeenAt: minutesAgo(1),
    });

    expect(connection.state).toBe(ResourceConnectionState.NotReadYet);
    expect(connection.isConnected).toBe(false);
    expect(connection.label).toBe("Waiting for data");
    expect(connection.badgeClassName).toContain("indigo");
    expect(connection.listDotClassName).toBe("bg-indigo-500");
  });

  test("nothing from the agent for over 15 minutes: Disconnected, drawn as each page always drew it", () => {
    const connection: ProxmoxClusterConnection = connectionOf({
      otelCollectorStatus: "disconnected",
      lastSeenAt: minutesAgo(60),
      agentLastSeenAt: minutesAgo(20),
    });

    expect(connection.state).toBe(ResourceConnectionState.Disconnected);
    expect(connection.label).toBe("Disconnected");
    // The hero drew Disconnected in amber, the list in red.
    expect(connection.badgeClassName).toContain("amber");
    expect(connection.listDotClassName).toBe("bg-red-500");
    expect(connection.listTextClassName).toBe("text-red-700");
  });

  test("a cluster added before the agent's clock existed (no agentLastSeenAt) reads as it did", () => {
    expect(
      connectionOf({ otelCollectorStatus: "disconnected", lastSeenAt: null })
        .state,
    ).toBe(ResourceConnectionState.NeverConnected);
    expect(
      connectionOf({
        otelCollectorStatus: "disconnected",
        lastSeenAt: minutesAgo(30),
      }).label,
    ).toBe("Disconnected");
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
  });
});

describe("the pages read it", () => {
  const overview: string = fs.readFileSync(
    path.join(DASHBOARD_SRC, "Pages/Proxmox/View/Index.tsx"),
    "utf8",
  );
  const clusters: string = fs.readFileSync(
    path.join(DASHBOARD_SRC, "Pages/Proxmox/Clusters.tsx"),
    "utf8",
  );

  test("the overview loads the agent's clock with the cluster", () => {
    expect(overview).toMatch(/lastSeenAt: true,\s*agentLastSeenAt: true,/);
  });

  test("the overview's hero pill and the card under it both read it", () => {
    expect(overview).toContain("getProxmoxClusterConnection({");
    expect(overview).toContain("connectionState: connection.state,");
    expect(overview).toContain("agentLastSeenAt={cluster.agentLastSeenAt}");
  });

  test("the clusters list's status reads it too, with both clocks selected", () => {
    expect(clusters).toContain("getProxmoxClusterConnection({");
    expect(clusters).toMatch(
      /selectMoreFields=\{\{\s*lastSeenAt: true,\s*agentLastSeenAt: true,\s*\}\}/,
    );
    // No status of its own any more: "connected" or red Disconnected.
    expect(clusters).not.toContain('item.otelCollectorStatus === "connected"');
  });
});
