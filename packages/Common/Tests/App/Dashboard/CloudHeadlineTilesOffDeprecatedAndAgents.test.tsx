import "@testing-library/jest-dom";
import { cleanup, render, screen, within } from "@testing-library/react";
import { afterEach, beforeAll, describe, expect, test } from "@jest/globals";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import {
  CloudResourceReadings,
  HEADLINE_INSTALL_OPS_AGENT,
  HEADLINE_NEEDS_OPS_AGENT,
  HEADLINE_NEEDS_OPS_AGENT_DESCRIPTION,
} from "../../../Types/Cloud/CloudResourceHealth";
import { GCP_OPS_AGENT_INSTALL_URL } from "../../../Types/Cloud/CloudKeyMetrics";
import {
  Translator,
  createTranslator,
} from "../../../UI/Utils/TranslateTemplate";
import {
  CloudHeadlineTile,
  NOT_REPORTED,
  PER_MINUTE,
  getCloudHeadlineTiles,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Cloud/CloudHeadlineTiles";
import { getCloudTopologyFacts } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceTopology/Builders/CloudAccountTopology";
import ResourceOverview, {
  RESOURCE_OVERVIEW_DETAILS_DESCRIPTION,
  ResourceOverviewTile,
} from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryResource/ResourceOverview";
import IconProp from "../../../Types/Icon/IconProp";
import { DASHBOARD_LANGUAGES } from "../../Helpers/TranslatedLanguages";

/*
 * WHAT A CLOUD RESOURCE'S TILES SAY OF THE METRICS THIS RELEASE READS.
 *
 *   - A Compute Engine VM's memory and fullest disk come from the Ops Agent
 *     on it (#9568). Where the agent runs, they are its tiles' numbers;
 *     where it does not, each tile says "Needs the Ops Agent", why in its
 *     (i), and links to Google's install instructions - in the reader's
 *     language, the link opening Google's page in a new tab.
 *   - A Cosmos DB account's latency is its direct-mode requests', else its
 *     gateway-mode ones' (#9565): ServerSideLatency, which Microsoft
 *     deprecates for these two, is no longer read for it.
 *   - A Pub/Sub topic's messages in are the count of its message sizes,
 *     each minute (#9565).
 */

const NOW: Date = new Date("2026-11-19T10:00:00.000Z");
const ENGLISH: Translator = createTranslator(undefined, "en");
const MEMORY: string = "agent.googleapis.com/memory/percent_used";
const DISK: string = "agent.googleapis.com/disk/percent_used";
const CPU: string = "compute.googleapis.com/instance/cpu/utilization";

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);
const LANGUAGES: ReadonlyArray<string> = ["en", ...DASHBOARD_LANGUAGES];
const locales: Record<string, Record<string, unknown>> = {};
const instances: Record<string, i18n> = {};

function readLocale(language: string): Record<string, unknown> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, unknown>;
}

function reading(value: number): { value: number; time: string } {
  return {
    value,
    time: new Date(NOW.getTime() - 5 * 60 * 1000).toISOString(),
  };
}

function tilesOf(
  provider: string,
  type: string,
  readings: CloudResourceReadings,
): Array<CloudHeadlineTile> {
  return getCloudHeadlineTiles({
    provider,
    type,
    readings,
    hasFreshReadings: true,
    translator: ENGLISH,
  });
}

function tileOf(
  tiles: Array<CloudHeadlineTile>,
  key: string,
): CloudHeadlineTile | undefined {
  return tiles.find((tile: CloudHeadlineTile): boolean => {
    return tile.key === key;
  });
}

// A headline tile as the resource's page hands it to its overview.
function asOverviewTile(tile: CloudHeadlineTile): ResourceOverviewTile {
  return {
    title: tile.title,
    value: tile.value,
    sublabel: tile.sublabel,
    valueNote: tile.valueNote,
    description: tile.description,
    link: tile.link,
    percent: tile.percent,
    icon: tile.icon,
    iconColor: tile.iconColor,
  };
}

function renderTiles(language: string, tiles: Array<CloudHeadlineTile>): void {
  render(
    <I18nextProvider i18n={instances[language]!}>
      <MemoryRouter initialEntries={["/dashboard/cloud/resources/1"]}>
        <ResourceOverview
          icon={IconProp.Cloud}
          title="web-1"
          identifier="Compute Engine VM Instance"
          identifierLabel="type"
          status="connected"
          lastSeenAt={undefined}
          chips={[]}
          tiles={tiles.map(asOverviewTile)}
          detailRows={[]}
          detailsDescription={RESOURCE_OVERVIEW_DETAILS_DESCRIPTION}
        />
      </MemoryRouter>
    </I18nextProvider>,
  );
}

beforeAll(async () => {
  locales["en"] = readLocale("en");

  for (const language of LANGUAGES) {
    const locale: Record<string, unknown> =
      locales[language] || readLocale(language);
    locales[language] = locale;

    const instance: i18n = createInstance();

    // The Dashboard's own configuration (Utils/i18n.ts).
    await instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        en: { translation: locales["en"] },
        [language]: { translation: locale },
      },
      interpolation: { escapeValue: false },
    });

    instances[language] = instance;
  }
});

afterEach(() => {
  cleanup();
});

describe("a Compute Engine VM's memory and disk tiles", () => {
  test("a VM that runs the Ops Agent leads with how full its memory and its fullest disk are", () => {
    const tiles: Array<CloudHeadlineTile> = tilesOf("gcp", "gce_instance", {
      [CPU]: reading(0.42),
      [MEMORY]: reading(41.5),
      [DISK]: reading(91.5),
    });

    expect(
      tiles.map((tile: CloudHeadlineTile) => {
        return [tile.title, tile.value, tile.percent];
      }),
    ).toEqual([
      ["CPU", "42%", 42],
      ["Memory", "42%", 41.5],
      ["Storage used", "92%", 91.5],
    ]);
    // Nothing to install where they are reported.
    expect(
      tiles.some((tile: CloudHeadlineTile): boolean => {
        return Boolean(tile.link || tile.valueNote);
      }),
    ).toBe(false);
  });

  test("a VM without the agent says each needs it, why, and where to get it, instead of leaving a gap", () => {
    const tiles: Array<CloudHeadlineTile> = tilesOf("gcp", "gce_instance", {
      [CPU]: reading(0.42),
    });

    for (const key of [MEMORY, DISK]) {
      const tile: CloudHeadlineTile = tileOf(tiles, key)!;

      expect(tile.value).toBe("");
      expect(tile.valueNote).toBe(HEADLINE_NEEDS_OPS_AGENT);
      expect(tile.description).toBe(HEADLINE_NEEDS_OPS_AGENT_DESCRIPTION);
      expect(tile.link).toEqual({
        url: GCP_OPS_AGENT_INSTALL_URL,
        label: HEADLINE_INSTALL_OPS_AGENT,
      });
      expect(tile.iconColor).toBe("slate");
      // Never "Not reported", never a bar.
      expect(tile.valueNote).not.toBe(NOT_REPORTED);
      expect(tile.percent).toBeUndefined();
    }

    expect(GCP_OPS_AGENT_INSTALL_URL).toBe(
      "https://docs.cloud.google.com/stackdriver/docs/solutions/agents/ops-agent/installation",
    );
  });

  /*
   * A stopped VM, or one the reads lost, reports nothing: that says nothing
   * of its agent, so its page draws no tiles at all rather than ask for
   * one it may run.
   */
  test("a VM whose readings are stale is not told it needs the agent", () => {
    expect(
      getCloudHeadlineTiles({
        provider: "gcp",
        type: "gce_instance",
        readings: { [CPU]: reading(0.42) },
        hasFreshReadings: false,
        translator: ENGLISH,
      }),
    ).toEqual([]);
  });

  test("the words are the Dashboard's own, in every language it ships", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      for (const english of [
        HEADLINE_NEEDS_OPS_AGENT,
        HEADLINE_NEEDS_OPS_AGENT_DESCRIPTION,
        HEADLINE_INSTALL_OPS_AGENT,
      ]) {
        const drawn: unknown = locales[language]![english];

        expect([language, english, typeof drawn]).toEqual([
          language,
          english,
          "string",
        ]);
        expect([language, drawn]).not.toEqual([language, english]);
        // The agent's name is Google's own: kept as written.
        expect(drawn as string).toContain("Ops Agent");
      }
    }
  });

  test.each(LANGUAGES)(
    "%s: the note and the link are drawn in the reader's language, the link opening Google's instructions in a new tab",
    (language: string) => {
      const tiles: Array<CloudHeadlineTile> = tilesOf("gcp", "gce_instance", {
        [CPU]: reading(0.42),
      });

      renderTiles(language, [tileOf(tiles, MEMORY)!]);

      const note: HTMLElement = screen.getByTestId(
        "resource-overview-tile-value-note",
      );
      const link: HTMLElement = screen.getByTestId(
        "resource-overview-tile-link",
      );
      const drawn: (english: string) => string = (english: string): string => {
        const value: unknown = locales[language]![english];
        return typeof value === "string" && value.length > 0 ? value : english;
      };

      expect(note).toHaveTextContent(drawn(HEADLINE_NEEDS_OPS_AGENT));
      expect(link).toHaveTextContent(drawn(HEADLINE_INSTALL_OPS_AGENT));
      expect(link.tagName).toBe("A");
      expect(link).toHaveAttribute("href", GCP_OPS_AGENT_INSTALL_URL);
      expect(link).toHaveAttribute("target", "_blank");
      expect(link).toHaveAttribute("rel", "noopener noreferrer");
      // No figure where there is none.
      expect(
        within(note.parentElement as HTMLElement).queryByText("—"),
      ).toBeNull();
    },
  );

  test("a tile with a number, or with a sublabel, draws no link", () => {
    renderTiles("en", [
      {
        key: "x",
        title: "Requests",
        value: "1,240",
        sublabel: PER_MINUTE,
        icon: IconProp.Activity,
        iconColor: "blue",
      },
    ]);

    expect(screen.queryByTestId("resource-overview-tile-link")).toBeNull();
    expect(screen.getByText("per minute")).toBeInTheDocument();
  });
});

describe("tiles off deprecated metrics", () => {
  const COSMOS: string = "Microsoft.DocumentDB/databaseAccounts";

  function latencyOf(readings: CloudResourceReadings): CloudHeadlineTile {
    return tilesOf("azure", COSMOS, readings).find(
      (tile: CloudHeadlineTile): boolean => {
        return tile.title === "Latency";
      },
    )!;
  }

  test("a Cosmos DB account's latency is its direct-mode requests', else its gateway-mode ones'", () => {
    expect(
      latencyOf({
        serversidelatencydirect: reading(4),
        serversidelatencygateway: reading(30),
      }).value,
    ).toBe("4 ms");
    // A MongoDB account connects through the gateway alone.
    expect(latencyOf({ serversidelatencygateway: reading(12) }).value).toBe(
      "12 ms",
    );
    // The tile keeps its own key whichever reading it shows.
    expect(latencyOf({ serversidelatencygateway: reading(12) }).key).toBe(
      "serversidelatencydirect",
    );
    // Neither: said plainly, as any level not brought is.
    expect(latencyOf({ totalrequests: reading(20) }).valueNote).toBe(
      NOT_REPORTED,
    );
    // The deprecated metric's old reading gives the tile nothing.
    expect(latencyOf({ serversidelatency: reading(7) }).valueNote).toBe(
      NOT_REPORTED,
    );
  });

  test("a Pub/Sub topic's messages in are the count of its message sizes, per minute", () => {
    const tiles: Array<CloudHeadlineTile> = tilesOf("gcp", "pubsub_topic", {
      "pubsub.googleapis.com/topic/message_sizes_count": reading(1240),
    });

    expect(
      tiles.map((tile: CloudHeadlineTile) => {
        return [tile.title, tile.value, tile.sublabel];
      }),
    ).toEqual([["Messages in", "1,240", PER_MINUTE]]);
    // The deprecated publish operations are no headline any more.
    expect(
      tilesOf("gcp", "pubsub_topic", {
        "pubsub.googleapis.com/topic/send_message_operation_count": reading(20),
      }),
    ).toEqual([]);
  });

  test("an account's topology card reads the same fallback", () => {
    expect(
      getCloudTopologyFacts({
        provider: "azure",
        type: COSMOS,
        readings: { serversidelatencygateway: reading(12) },
      }).map((fact: { label: string }): string => {
        return fact.label;
      }),
    ).toEqual(["Latency"]);
    expect(
      getCloudTopologyFacts({
        provider: "gcp",
        type: "gce_instance",
        readings: { [MEMORY]: reading(41.5), [DISK]: reading(91.5) },
      }).map((fact: { label: string }): string => {
        return fact.label;
      }),
    ).toEqual(["Memory", "Storage used"]);
  });
});
