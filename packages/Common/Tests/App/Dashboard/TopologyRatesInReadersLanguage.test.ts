import { describe, expect, test } from "@jest/globals";
import EntityRelationshipType from "../../../Types/Telemetry/EntityRelationshipType";
import EntityType from "../../../Types/Telemetry/EntityType";
import {
  InfrastructureData,
  ServiceMapData,
  TopologyEntity,
  TopologyRelationship,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/TopologyData";
import {
  ResourceTopologyGraph,
  ResourceTopologyNode,
  ResourceTopologyRelation,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceTopology/ResourceTopologyModel";
import {
  HostTopologyInput,
  buildHostTopology,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceTopology/Builders/HostTopology";
import {
  MESSAGE_RATE_PER_SECOND,
  formatMessageQueueTopologyErrorRate,
  formatMessageQueueTopologyPercent,
  formatMessageQueueTopologyRate,
} from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/Topology/MessageQueueTopologyModel";
import { formatMessageQueueHeadlineShort } from "../../../../App/FeatureSet/Dashboard/src/Components/MessageQueue/Topology/MessageQueueTopologyPresentation";
import { Translator } from "../../../Types/Translator";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

/*
 * A HOST'S MAP AND THE QUEUE MAP, IN THE READER'S LANGUAGE (#8259).
 *
 * The service map wrote its call rates and error shares in the reader's
 * language (#7725), and two other maps went on writing "600/min", "1.0/s"
 * and "10.0%" in Latin digits with English units beside translated words:
 * a host's topology (its services' Requests and Errors, the reason a
 * service is red, an edge's rate) and the message queue topology (a
 * card's in, out and errors, an edge's label, the drawer's figures). Each
 * is written now in the reader's digits, decimal sign and percent sign,
 * the unit a sentence of the locale ("{{rate}}/min", "{{rate}}/s"); English
 * reads exactly as it always did.
 */

const NOW: Date = new Date("2026-10-21T12:00:00Z");
const RANGE_START: Date = new Date(NOW.getTime() - 24 * 60 * 60 * 1000);
const LATIN_DIGIT: RegExp = /[0-9]/;

function spaced(text: string): string {
  return withoutIsolateMarks(text).replace(/[\u00a0\u202f]/g, " ");
}

function entity(key: string, type: EntityType, name: string): TopologyEntity {
  return {
    entityKey: key,
    entityType: type,
    displayName: name,
    lastSeenAt: NOW,
  };
}

function edge(
  from: string,
  to: string,
  type: EntityRelationshipType,
  callCount?: number,
  errorCount?: number,
): TopologyRelationship {
  return {
    fromEntityKey: from,
    toEntityKey: to,
    relationshipType: type,
    callCount: callCount,
    errorCount: errorCount,
  };
}

const ENTITIES: Array<TopologyEntity> = [
  entity("host", EntityType.Host, "web-01"),
  entity("other-host", EntityType.Host, "web-02"),
  entity("checkout", EntityType.Service, "checkout"),
  entity("storefront", EntityType.Service, "storefront"),
  entity("payments", EntityType.Service, "payments"),
];

function input(translator?: Translator): HostTopologyInput {
  const infrastructure: InfrastructureData = {
    rangeStart: RANGE_START,
    loadedAt: NOW,
    entities: ENTITIES,
    relationships: [
      edge("checkout", "host", EntityRelationshipType.RunsOn),
      edge("storefront", "host", EntityRelationshipType.RunsOn),
      edge("payments", "other-host", EntityRelationshipType.RunsOn),
    ],
    collections: [],
    totals: {} as InfrastructureData["totals"],
    truncation: null,
    dependencyTruncation: null,
  };
  const serviceMap: ServiceMapData = {
    rangeStart: RANGE_START,
    loadedAt: NOW,
    entities: ENTITIES,
    relationships: [
      edge(
        "storefront",
        "checkout",
        EntityRelationshipType.DependsOn,
        9000,
        900,
      ),
      edge("checkout", "payments", EntityRelationshipType.DependsOn, 200, 14),
    ],
    runsOnCounts: {} as ServiceMapData["runsOnCounts"],
    truncations: [],
  };

  return {
    host: { id: "host-row", name: "web-01", lastSeenAt: NOW },
    hostEntityKey: "host",
    infrastructure: infrastructure,
    serviceMap: serviceMap,
    now: NOW,
    ...(translator ? { translator: translator } : {}),
  };
}

function node(graph: ResourceTopologyGraph, id: string): ResourceTopologyNode {
  const found: ResourceTopologyNode | undefined = graph.nodes.get(id);

  if (!found) {
    throw new Error(`no node ${id}`);
  }

  return found;
}

function facts(graph: ResourceTopologyGraph, id: string): Array<string> {
  return (node(graph, id).facts || []).map(
    (fact: { label: string; value: string }): string => {
      return spaced(fact.value);
    },
  );
}

function details(graph: ResourceTopologyGraph): Array<string> {
  return graph.relations
    .map((relation: ResourceTopologyRelation): string => {
      return spaced(relation.detail || "");
    })
    .filter(Boolean)
    .sort();
}

describe("a host's topology", () => {
  test("English reads exactly as it did, with a translator or none", () => {
    for (const graph of [
      buildHostTopology(input()),
      buildHostTopology(input(dashboardTranslator("en"))),
    ]) {
      expect(facts(graph, "service:checkout")).toEqual(["600/min", "10.0%"]);
      expect(details(graph)).toEqual(["13/min", "600/min"]);
      expect(
        node(graph, "service:checkout").reasons?.map(
          (reason: { values?: Record<string, string> }): string => {
            return reason.values?.["rate"] || "";
          },
        ),
      ).toEqual(["10.0%"]);
    }
  });

  test("German: its own unit and decimal comma", () => {
    const graph: ResourceTopologyGraph = buildHostTopology(
      input(dashboardTranslator("de")),
    );

    expect(facts(graph, "service:checkout")).toEqual(["600/Min.", "10,0 %"]);
    expect(details(graph)).toEqual(["13/Min.", "600/Min."]);
  });

  test("Persian: no Latin digit on a service's facts, its reasons or an edge", () => {
    const graph: ResourceTopologyGraph = buildHostTopology(
      input(dashboardTranslator("fa")),
    );

    for (const text of [
      ...facts(graph, "service:checkout"),
      ...details(graph),
      ...(node(graph, "service:checkout").reasons || []).map(
        (reason: { values?: Record<string, string> }): string => {
          return reason.values?.["rate"] || "";
        },
      ),
    ]) {
      expect(text).not.toMatch(LATIN_DIGIT);
    }

    expect(facts(graph, "service:checkout")).toEqual(["۶۰۰/دقیقه", "۱۰٫۰٪"]);
  });

  test("Arabic: Latin digits, its own unit", () => {
    const graph: ResourceTopologyGraph = buildHostTopology(
      input(dashboardTranslator("ar")),
    );

    expect(facts(graph, "service:checkout")[0]).toBe("600/دقيقة");
  });
});

describe("the message queue topology's rates and shares", () => {
  const en: Translator = dashboardTranslator("en");
  const de: Translator = dashboardTranslator("de");
  const fa: Translator = dashboardTranslator("fa");
  const ar: Translator = dashboardTranslator("ar");

  test("English reads exactly as it did, with a translator or none", () => {
    const cases: Array<[number, number, string]> = [
      [3600, 3600, "1.0/s"],
      [36000, 3600, "10/s"],
      [3_600_000, 3600, "1.0k/s"],
      [3_600_000_000, 3600, "1.0M/s"],
      [600, 3600, "10/min"],
      [6, 3600, "0.1/min"],
      [1, 3600, "<0.1/min"],
      [0, 3600, "—"],
      [10, 0, "—"],
    ];

    for (const [messages, seconds, english] of cases) {
      expect(formatMessageQueueTopologyRate(messages, seconds)).toBe(english);
      expect(
        spaced(formatMessageQueueTopologyRate(messages, seconds, en)),
      ).toBe(english);
    }

    for (const [percent, english] of [
      [0, "0%"],
      [0.04, "<0.1%"],
      [2.5, "2.5%"],
      [140, "100.0%"],
      [null, "—"],
      [-1, "—"],
    ] as Array<[number | null, string]>) {
      expect(formatMessageQueueTopologyPercent(percent)).toBe(english);
      expect(formatMessageQueueTopologyPercent(percent, en)).toBe(english);
    }

    expect(formatMessageQueueTopologyErrorRate(200, 5)).toBe("2.5%");
    expect(formatMessageQueueTopologyErrorRate(0, 5)).toBe("—");
  });

  test("German: a decimal comma and its own units", () => {
    expect(spaced(formatMessageQueueTopologyRate(3600, 3600, de))).toBe(
      "1,0/s",
    );
    expect(spaced(formatMessageQueueTopologyRate(600, 3600, de))).toBe(
      "10/Min.",
    );
    expect(spaced(formatMessageQueueTopologyRate(1, 3600, de))).toBe(
      "<0,1/Min.",
    );
    expect(spaced(formatMessageQueueTopologyRate(3_600_000, 3600, de))).toBe(
      "1,0k/s",
    );
    expect(spaced(formatMessageQueueTopologyPercent(2.5, de))).toBe("2,5 %");
    expect(spaced(formatMessageQueueTopologyErrorRate(200, 5, de))).toBe(
      "2,5 %",
    );
  });

  test("Persian: Persian digits, units and percent sign, no Latin digit", () => {
    for (const text of [
      formatMessageQueueTopologyRate(3600, 3600, fa),
      formatMessageQueueTopologyRate(600, 3600, fa),
      formatMessageQueueTopologyRate(1, 3600, fa),
      formatMessageQueueTopologyRate(3_600_000, 3600, fa),
      formatMessageQueueTopologyPercent(2.5, fa),
      formatMessageQueueTopologyPercent(0.04, fa),
      formatMessageQueueTopologyErrorRate(200, 5, fa),
    ]) {
      expect(text).not.toMatch(LATIN_DIGIT);
    }

    expect(spaced(formatMessageQueueTopologyRate(600, 3600, fa))).toBe(
      "۱۰/دقیقه",
    );
    expect(spaced(formatMessageQueueTopologyRate(3600, 3600, fa))).toBe(
      "۱٫۰/ثانیه",
    );
    expect(formatMessageQueueTopologyPercent(2.5, fa)).toBe("۲٫۵٪");
  });

  test("Arabic: Latin digits, its own units", () => {
    expect(spaced(formatMessageQueueTopologyRate(3600, 3600, ar))).toBe(
      "1.0/ث",
    );
  });

  test("a headline's short figure, in the reader's digits", () => {
    const headline: Parameters<typeof formatMessageQueueHeadlineShort>[0] = {
      value: 2500,
      descriptor: { kind: "counter" },
    } as Parameters<typeof formatMessageQueueHeadlineShort>[0];

    expect(formatMessageQueueHeadlineShort(headline)).toBe("2.5k/s");
    expect(formatMessageQueueHeadlineShort(headline, fa)).toBe("۲٫۵k/s");
  });

  test("the per-second rate is worded in every language the Dashboard ships", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      const locale: Record<string, string> = readDashboardLocale(language);
      const wording: string | undefined = locale[MESSAGE_RATE_PER_SECOND];

      expect({ language, worded: typeof wording === "string" }).toEqual({
        language,
        worded: true,
      });
      expect(wording).toContain("{{rate}}");
    }

    expect(readDashboardLocale("fa")[MESSAGE_RATE_PER_SECOND]).toBe(
      "{{rate}}/ثانیه",
    );
  });
});
