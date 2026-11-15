import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, render, screen } from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { FunctionComponent } from "react";
import { I18nextProvider } from "react-i18next";
import { Node, NodeProps } from "reactflow";
import EntityRelationshipType from "../../../Types/Telemetry/EntityRelationshipType";
import EntitySource from "../../../Types/Telemetry/EntitySource";
import EntityType from "../../../Types/Telemetry/EntityType";
import {
  createTranslator,
  getInlineSeparator,
  Translator,
} from "../../../Types/Translator";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * The canvas: each card drawn by the map's own node component, so a card
 * draws its status line as the map handed it over. React Flow's layout and
 * its viewport are the only things replaced.
 */
jest.mock("reactflow", () => {
  return {
    __esModule: true,
    default: (props: {
      nodes: Array<Node>;
      nodeTypes: Record<string, FunctionComponent<NodeProps>>;
    }): React.ReactElement => {
      return (
        <div data-testid="infrastructure-canvas">
          {props.nodes.map((node: Node): React.ReactElement | null => {
            const Card: FunctionComponent<NodeProps> | undefined =
              props.nodeTypes[node.type || ""];

            return Card ? (
              <div key={node.id} data-testid={`canvas-node-${node.id}`}>
                {React.createElement(Card, {
                  id: node.id,
                  data: node.data,
                  type: node.type || "",
                  selected: false,
                  zIndex: 0,
                  isConnectable: false,
                  xPos: 0,
                  yPos: 0,
                  dragging: false,
                } as NodeProps)}
              </div>
            ) : null;
          })}
        </div>
      );
    },
    Background: (): null => {
      return null;
    },
    Controls: (): null => {
      return null;
    },
    Handle: (): null => {
      return null;
    },
    BaseEdge: (): null => {
      return null;
    },
    BackgroundVariant: { Dots: "dots" },
    MarkerType: { ArrowClosed: "arrowclosed" },
    Position: { Left: "left", Right: "right", Top: "top", Bottom: "bottom" },
  };
});

import InfrastructureGraph, {
  ACTIVE_SEEN_LINE,
  INACTIVE_SEEN_LINE,
  InfrastructureMapLayout,
  MAX_MAP_CARDS,
  cardForNode,
  layoutInfrastructureMap,
  statusLineForNode,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/InfrastructureGraph";
import {
  InfrastructureNode,
  InfrastructureTopologyModel,
  buildInfrastructureTopologyModel,
  summarizeCounts,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/InfrastructureTopologyModel";
import { formatLastSeenInLanguage } from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/TopologyActivity";
import {
  TopologyEntity,
  TopologyRelationship,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/TopologyData";

/*
 * #8418: THE INFRASTRUCTURE MAP'S STATUS LINES, IN THE READER'S LANGUAGE.
 *
 * A machine's card said "Active · seen 12 min ago" to every reader: the
 * line was glued together in English in cardForNode, and its time was
 * formatLastSeen, the English-only reading. The card then looked the
 * glued line up, which no locale holds. It is one sentence of the locale
 * now - "Active · seen {{time}}" and "Inactive · seen {{time}}" - with the
 * time in the sentence's language and digits, shortened as the language
 * shortens it (formatLastSeenInLanguage, style "short"), and the card
 * draws it as the layout worded it. A workload's and a collection's line
 * sets its state beside its counts as the language sets off facts; a
 * service card counts "Runs on {{count}} of these" in the language's
 * plural. Each is read here from the real locale files.
 */

const NOW: Date = new Date("2026-09-07T10:00:00Z");
const TWELVE_MINUTES_AGO: Date = new Date("2026-09-07T09:48:00Z");
const FIVE_HOURS_AGO: Date = new Date("2026-09-07T05:00:00Z");
const THREE_DAYS_AGO: Date = new Date("2026-09-04T10:00:00Z");
const JUST_NOW: Date = new Date("2026-09-07T09:59:40Z");
const RANGE_START: Date = new Date("2026-09-06T10:00:00Z");

const LANGUAGES: Array<string> = ["en", ...DASHBOARD_LANGUAGES];

// The English a line must never show in another language.
const ENGLISH_WORDS: RegExp = /\b(?:Active|Inactive|seen|ago|Runs on)\b/;

/*
 * Where the line's state agrees with the machine it is about, which the
 * state alone ("Активно", the list's column) does not: Russian's "Активен"
 * beside "замечен".
 */
const STATES_IN_THE_LINE: Record<string, [string, string]> = {
  ru: ["Активен", "Неактивен"],
};

// Spaces as a reader sees them: a no-break space is a space.
function asRead(text: string): string {
  return withoutIsolateMarks(text).replace(/[\u00A0\u202F]/g, " ");
}

function entity(
  key: string,
  type: EntityType,
  name: string = key,
  lastSeenAt: Date = NOW,
  source: EntitySource = EntitySource.Discovered,
): TopologyEntity {
  return {
    entityKey: key,
    displayName: name,
    entityType: type,
    lastSeenAt,
    source,
  };
}

function edge(
  from: string,
  to: string,
  type: EntityRelationshipType,
): TopologyRelationship {
  return { fromEntityKey: from, toEntityKey: to, relationshipType: type };
}

// One host, last seen at `lastSeenAt`, active or not.
function hostModel(
  lastSeenAt: Date,
  source: EntitySource = EntitySource.Discovered,
): InfrastructureTopologyModel {
  return buildInfrastructureTopologyModel(
    [entity("web", EntityType.Host, "web", lastSeenAt, source)],
    [],
    { rangeStart: RANGE_START, includeInactive: true },
  );
}

function machineLine(
  lastSeenAt: Date,
  translator?: Translator,
  source: EntitySource = EntitySource.Discovered,
): string {
  const model: InfrastructureTopologyModel = hostModel(lastSeenAt, source);

  return statusLineForNode(model.nodes.get("web")!, NOW, translator);
}

// A deployment of two pods, and a service running on both.
function workloadModel(): InfrastructureTopologyModel {
  return buildInfrastructureTopologyModel(
    [
      entity("api", EntityType.Service),
      entity("checkout", EntityType.KubernetesDeployment, "checkout"),
      entity("pod-1", EntityType.KubernetesPod, "checkout-6d4f8b9c7d-x2k9p"),
      entity("pod-2", EntityType.KubernetesPod, "checkout-6d4f8b9c7d-q8zwm"),
      entity("node-a", EntityType.KubernetesNode, "node-a"),
      entity("node-b", EntityType.KubernetesNode, "node-b"),
    ],
    [
      edge("pod-1", "checkout", EntityRelationshipType.PartOf),
      edge("pod-2", "checkout", EntityRelationshipType.PartOf),
      edge("api", "pod-1", EntityRelationshipType.RunsOn),
      edge("api", "pod-2", EntityRelationshipType.RunsOn),
      edge("api", "node-a", EntityRelationshipType.RunsOn),
      edge("api", "node-b", EntityRelationshipType.RunsOn),
    ],
    { rangeStart: RANGE_START },
  );
}

// A collection of thousands of devices: one card with its count.
function collectionModel(): InfrastructureTopologyModel {
  return buildInfrastructureTopologyModel([], [], {
    rangeStart: RANGE_START,
    collections: [
      {
        entityType: EntityType.IoTDevice,
        total: 5000,
        active: 4200,
        lastSeenAt: NOW,
        activeLastSeenAt: NOW,
      },
    ],
  });
}

// More hosts than the map draws: the last card is the overflow card.
function crowdedModel(): {
  model: InfrastructureTopologyModel;
  ids: Array<string>;
} {
  const hosts: Array<TopologyEntity> = Array.from(
    { length: MAX_MAP_CARDS + 10 },
    (_value: unknown, index: number) => {
      return entity(`h${index}`, EntityType.Host, `server-${index}x`);
    },
  );

  return {
    model: buildInfrastructureTopologyModel(hosts, []),
    ids: hosts.map((host: TopologyEntity): string => {
      return host.entityKey!;
    }),
  };
}

function statusOfCard(layout: InfrastructureMapLayout, id: string): string {
  const card: Node | undefined = layout.nodes.find((node: Node): boolean => {
    return node.id === id;
  });

  expect(card).toBeDefined();

  return (card!.data as { statusLabel: string }).statusLabel;
}

afterEach(() => {
  cleanup();
});

describe("a machine's status line, one sentence of the locale", () => {
  test.each([
    ["de", "Aktiv · zuletzt gesehen vor 12 Min."],
    ["es", "Activo · visto hace 12 min"],
    ["fr", "Actif · vu il y a 12 min"],
    ["nl", "Actief · laatst gezien 12 min. geleden"],
    ["ar", "نشط · آخر ظهور قبل 12 دقيقة"],
    // Persian digits, and the bullet a language whose zero is a dot takes.
    ["fa", "فعال • ۱۲ دقیقه پیش دیده شد"],
  ])(
    "in %s, a machine seen 12 minutes ago: %s",
    (language: string, line: string) => {
      expect(
        asRead(machineLine(TWELVE_MINUTES_AGO, dashboardTranslator(language))),
      ).toBe(line);
    },
  );

  test.each([
    ["de", "Inaktiv · zuletzt gesehen vor 3 Tagen"],
    ["es", "Inactivo · visto hace 3 d"],
    ["nl", "Inactief · laatst gezien 3 dgn geleden"],
    ["ar", "غير نشط · آخر ظهور قبل 3 أيام"],
    ["fa", "غیرفعال • ۳ روز پیش دیده شد"],
  ])(
    "in %s, a machine gone quiet 3 days ago: %s",
    (language: string, line: string) => {
      expect(
        asRead(machineLine(THREE_DAYS_AGO, dashboardTranslator(language))),
      ).toBe(line);
    },
  );

  test.each([
    ["de", "Aktiv · zuletzt gesehen jetzt"],
    ["es", "Activo · visto ahora"],
    ["ar", "نشط · آخر ظهور الآن"],
    ["fa", "فعال • اکنون دیده شد"],
  ])(
    "in %s, a machine that just reported: %s",
    (language: string, line: string) => {
      expect(asRead(machineLine(JUST_NOW, dashboardTranslator(language)))).toBe(
        line,
      );
    },
  );

  test("in German, hours are shortened as German shortens them", () => {
    expect(asRead(machineLine(FIVE_HOURS_AGO, dashboardTranslator("de")))).toBe(
      "Aktiv · zuletzt gesehen vor 5 Std.",
    );
  });

  test("English reads exactly as it did, each figure held to its unit", () => {
    const english: Translator = dashboardTranslator("en");

    expect(machineLine(TWELVE_MINUTES_AGO, english)).toBe(
      "Active · seen 12\u00A0min ago",
    );
    expect(machineLine(FIVE_HOURS_AGO, english)).toBe(
      "Active · seen 5\u00A0h ago",
    );
    expect(machineLine(THREE_DAYS_AGO, english)).toBe(
      "Inactive · seen 3 days ago",
    );
    expect(machineLine(JUST_NOW, english)).toBe("Active · seen just now");
    // And without a translator, as a test or another caller gets it.
    expect(machineLine(THREE_DAYS_AGO)).toBe("Inactive · seen 3 days ago");
  });

  test.each(LANGUAGES)(
    "in %s, the sentence is the locale's own, its time in its language and none of it English",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);
      const line: string = machineLine(TWELVE_MINUTES_AGO, translator);
      const time: string = formatLastSeenInLanguage(
        TWELVE_MINUTES_AGO,
        NOW,
        language,
        { style: "short" },
      );

      expect(asRead(line)).toContain(asRead(time));

      if (language === "en") {
        return;
      }

      expect(isWordedInDashboardLocale(ACTIVE_SEEN_LINE, language)).toBe(true);
      expect(isWordedInDashboardLocale(INACTIVE_SEEN_LINE, language)).toBe(
        true,
      );
      expect(line).not.toMatch(ENGLISH_WORDS);
      expect(line).not.toContain("min ago");
      // The sentence's separator is the language's: " • " in Persian.
      expect(line).toContain(getInlineSeparator(language).trim());
    },
  );

  test.each(LANGUAGES)(
    "in %s, an active and an inactive machine read apart, each with its state",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);
      const active: string = asRead(
        machineLine(TWELVE_MINUTES_AGO, translator),
      );
      const inactive: string = asRead(machineLine(THREE_DAYS_AGO, translator));

      const states: [string, string] = STATES_IN_THE_LINE[language] || [
        asRead(translator.translateText("Active") || "Active"),
        asRead(translator.translateText("Inactive") || "Inactive"),
      ];

      expect(active).not.toBe(inactive);
      expect(active).toContain(states[0]);
      expect(inactive).toContain(states[1]);
    },
  );

  test('a machine with no time to tell reads its state alone, never "seen —"', () => {
    // A manual resource keeps the time it was made with, and counts as active.
    for (const language of ["en", "de", "fa"]) {
      const translator: Translator = dashboardTranslator(language);
      const state: string = translator.translateText("Active") || "Active";

      expect(
        statusLineForNode(
          {
            ...hostModel(NOW).nodes.get("web")!,
            lastSeenAt: null,
          } as InfrastructureNode,
          NOW,
          translator,
        ),
      ).toBe(state);
    }

    expect(
      statusLineForNode(
        {
          ...hostModel(NOW).nodes.get("web")!,
          lastSeenAt: new Date("not a date"),
        } as InfrastructureNode,
        NOW,
      ),
    ).toBe("Active");
  });

  test("a locale that has not worded the sentence reads it whole in English, its time English too", () => {
    const german: Record<string, string> = readDashboardLocale("de");
    const lookup: (text: string) => string | undefined = (
      text: string,
    ): string | undefined => {
      return text === ACTIVE_SEEN_LINE ? undefined : german[text];
    };
    const halfGerman: Translator = createTranslator(lookup, "de");

    expect(machineLine(TWELVE_MINUTES_AGO, halfGerman)).toBe(
      "Active · seen 12\u00A0min ago",
    );
  });
});

describe("the other cards' status lines", () => {
  test.each(LANGUAGES)(
    "in %s, a workload's line sets its state beside its counts, as the language sets off facts",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);
      const model: InfrastructureTopologyModel = workloadModel();
      const workload: InfrastructureNode = model.nodes.get("checkout")!;
      const line: string = cardForNode(
        model,
        workload,
        NOW,
        translator,
      ).statusLabel;

      expect(line).toBe(
        [
          translator.translateText("Active") || "Active",
          summarizeCounts(workload.countsByType, 2, translator),
        ].join(getInlineSeparator(language)),
      );

      if (language !== "en") {
        expect(line).not.toMatch(ENGLISH_WORDS);
      }
    },
  );

  test("a workload's line in English, and in Persian digits", () => {
    const model: InfrastructureTopologyModel = workloadModel();
    const workload: InfrastructureNode = model.nodes.get("checkout")!;

    expect(cardForNode(model, workload, NOW).statusLabel).toBe(
      "Active · 2 pods",
    );

    const persian: string = asRead(
      cardForNode(model, workload, NOW, dashboardTranslator("fa")).statusLabel,
    );

    expect(persian.startsWith("فعال • ")).toBe(true);
    expect(persian).toContain("۲");
    expect(persian).not.toMatch(/[0-9]/);
  });

  test.each([
    ["en", "Active · 4,200 IoT devices"],
    ["de", "Aktiv · "],
    ["fa", "فعال • "],
  ])(
    "in %s, a collection's line carries its count: %s",
    (language: string, start: string) => {
      const model: InfrastructureTopologyModel = collectionModel();
      const line: string = asRead(
        cardForNode(
          model,
          model.nodes.get("collection:iot.device")!,
          NOW,
          dashboardTranslator(language),
        ).statusLabel,
      );

      expect(line.startsWith(start)).toBe(true);
      expect(line).toContain(
        asRead(dashboardTranslator(language).formatNumber(4200)),
      );
    },
  );

  test.each(LANGUAGES)(
    "in %s, a service card counts the cards it runs on in the language's plural",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);
      const model: InfrastructureTopologyModel = workloadModel();
      const layout: InfrastructureMapLayout = layoutInfrastructureMap({
        model,
        nodeIds: ["checkout", "node-a", "node-b"],
        now: NOW,
        translator,
      });
      const placements: number = layout.edges.filter(
        (item: { source: string }): boolean => {
          return item.source === "service:api";
        },
      ).length;

      expect(placements).toBe(3);
      expect(statusOfCard(layout, "service:api")).toBe(
        translator.translatePlural(
          {
            one: "Runs on {{count}} of these",
            other: "Runs on {{count}} of these",
          },
          placements,
        ),
      );

      if (language !== "en") {
        expect(
          isWordedInDashboardLocale("Runs on {{count}} of these", language),
        ).toBe(true);
        expect(statusOfCard(layout, "service:api")).not.toMatch(ENGLISH_WORDS);
        expect(statusOfCard(layout, "service:api")).toContain(
          translator.formatNumber(3),
        );
      }
    },
  );

  test("a service card's line in English, German and Persian", () => {
    const lines: Array<string> = ["en", "de", "fa"].map(
      (language: string): string => {
        return asRead(
          statusOfCard(
            layoutInfrastructureMap({
              model: workloadModel(),
              nodeIds: ["checkout", "node-a", "node-b"],
              now: NOW,
              translator: dashboardTranslator(language),
            }),
            "service:api",
          ),
        );
      },
    );

    expect(lines).toEqual([
      "Runs on 3 of these",
      "Läuft auf 3 davon",
      "روی ۳ مورد از این‌ها اجرا می‌شود",
    ]);
  });

  test.each(LANGUAGES)(
    "in %s, the overflow card says to open the list, in the reader's words",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);
      const { model, ids } = crowdedModel();
      const line: string = statusOfCard(
        layoutInfrastructureMap({ model, nodeIds: ids, now: NOW, translator }),
        "__more__",
      );

      expect(line).toBe(
        translator.translateText("Open the list to see everything"),
      );

      if (language !== "en") {
        expect(line).not.toBe("Open the list to see everything");
      }
    },
  );
});

/*
 * The map as a reader sees it: the cards draw the lines the layout worded,
 * never looking them up again. Each language's line is made a key of its
 * own here, reading "Rojo": a card that looked it up again would say so.
 */
describe("the map draws each card's line as the layout worded it", () => {
  const TWICE: string = "Rojo";

  function mapIn(
    language: string,
    probes: Array<string>,
  ): {
    instance: i18n;
  } {
    const instance: i18n = createInstance();
    const words: Record<string, string> = {};

    for (const probe of probes) {
      words[probe] = TWICE;
    }

    instance.init({
      lng: language,
      fallbackLng: "en",
      resources: {
        en: { translation: readDashboardLocale("en") },
        [language]: {
          translation: { ...readDashboardLocale(language), ...words },
        },
      },
      interpolation: { escapeValue: false },
      keySeparator: false,
      nsSeparator: false,
      initImmediate: false,
    });

    return { instance };
  }

  test.each(["es", "de", "nl", "ar", "fa"])(
    "in %s, a machine's card, a workload's and the service column read the layout's lines, never a second lookup of them",
    (language: string) => {
      const translator: Translator = dashboardTranslator(language);
      const model: InfrastructureTopologyModel =
        buildInfrastructureTopologyModel(
          [
            entity("api", EntityType.Service),
            entity("web", EntityType.Host, "web", TWELVE_MINUTES_AGO),
            entity("checkout", EntityType.KubernetesDeployment, "checkout"),
            entity("pod-1", EntityType.KubernetesPod, "checkout-6d4f8b9c7d-a"),
            entity("pod-2", EntityType.KubernetesPod, "checkout-6d4f8b9c7d-b"),
          ],
          [
            edge("pod-1", "checkout", EntityRelationshipType.PartOf),
            edge("pod-2", "checkout", EntityRelationshipType.PartOf),
            edge("api", "web", EntityRelationshipType.RunsOn),
          ],
          { rangeStart: RANGE_START },
        );
      const nodeIds: Array<string> = ["web", "checkout"];
      const expected: InfrastructureMapLayout = layoutInfrastructureMap({
        model,
        nodeIds,
        now: NOW,
        translator,
      });
      const lines: Array<string> = ["web", "checkout", "service:api"].map(
        (id: string): string => {
          return statusOfCard(expected, id);
        },
      );
      const { instance } = mapIn(language, lines);

      render(
        <I18nextProvider i18n={instance}>
          <InfrastructureGraph
            model={model}
            nodeIds={nodeIds}
            onOpenNode={(): void => {}}
            now={NOW}
          />
        </I18nextProvider>,
      );

      ["web", "checkout", "service:api"].forEach(
        (id: string, index: number): void => {
          const card: HTMLElement = screen.getByTestId(`canvas-node-${id}`);

          expect(asRead(card.textContent || "")).toContain(
            asRead(lines[index]!),
          );
          expect(card).not.toHaveTextContent(TWICE);
          expect(card.textContent || "").not.toMatch(ENGLISH_WORDS);
        },
      );
    },
  );

  test("in English, the cards read as they did", () => {
    const model: InfrastructureTopologyModel = hostModel(THREE_DAYS_AGO);

    render(
      <I18nextProvider i18n={mapIn("en", []).instance}>
        <InfrastructureGraph
          model={model}
          nodeIds={["web"]}
          onOpenNode={(): void => {}}
          now={NOW}
        />
      </I18nextProvider>,
    );

    expect(screen.getByTestId("canvas-node-web")).toHaveTextContent(
      "Inactive · seen 3 days ago",
    );
  });
});

/*
 * The English-only reading stays for English: no page draws formatLastSeen
 * itself, and the graph builds no line of its own in English.
 */
describe("the English reading is drawn by no page", () => {
  const DASHBOARD: string = path.resolve(
    __dirname,
    "../../../../App/FeatureSet/Dashboard/src",
  );
  const GRAPH: string = path.join(
    DASHBOARD,
    "Components/Topology/InfrastructureGraph.tsx",
  );

  const SOURCE_FILE: RegExp = /\.tsx?$/;
  const FROM_TOPOLOGY_ACTIVITY: RegExp =
    /from\s+["'][^"']*TopologyActivity["']/;
  const NAMES_THE_ENGLISH_READING: RegExp = /\bformatLastSeen\b(?!InLanguage)/;

  function listFiles(folder: string): Array<string> {
    const files: Array<string> = [];

    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const full: string = path.join(folder, entry.name);

      if (entry.isDirectory()) {
        files.push(...listFiles(full));
      } else if (SOURCE_FILE.test(entry.name)) {
        files.push(full);
      }
    }

    return files;
  }

  test("only TopologyActivity names formatLastSeen from it; every page takes formatLastSeenInLanguage", () => {
    const importers: Array<string> = listFiles(DASHBOARD)
      .filter((file: string): boolean => {
        const text: string = fs.readFileSync(file, "utf8");

        return (
          FROM_TOPOLOGY_ACTIVITY.test(text) &&
          NAMES_THE_ENGLISH_READING.test(
            text.slice(0, text.indexOf("TopologyActivity")),
          )
        );
      })
      .map((file: string): string => {
        return path.relative(DASHBOARD, file);
      });

    expect(importers).toEqual([]);
  });

  test("the graph builds no status line in English by hand", () => {
    const text: string = fs.readFileSync(GRAPH, "utf8");

    expect(text).not.toMatch(/`[^`]*seen \$\{/);
    expect(text).not.toMatch(/`\$\{node\.isActive \? "Active"/);
    expect(text).not.toContain("`Runs on ${");
    // The card draws the line it is handed, never looks it up again.
    expect(text).not.toMatch(/translateString\(props\.data\.statusLabel\)/);
  });
});
