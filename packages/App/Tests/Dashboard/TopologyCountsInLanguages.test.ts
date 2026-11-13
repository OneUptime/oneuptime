import { afterEach, describe, expect, test } from "@jest/globals";
import {
  DASHBOARD_LANGUAGES,
  dashboardTranslator,
  isWordedInDashboardLocale,
  placeholdersOf,
  readDashboardLocale,
} from "Common/Tests/Helpers/DashboardLocales";
import { isolated } from "Common/Tests/Helpers/IsolateMarks";
import {
  ENGLISH_DATE_LANGUAGE,
  setDateDisplayLanguage,
} from "Common/Types/DateLanguage";
import EntityRelationshipType from "Common/Types/Telemetry/EntityRelationshipType";
import EntitySource from "Common/Types/Telemetry/EntitySource";
import EntityType from "Common/Types/Telemetry/EntityType";
import { PluralTemplate, Translator } from "Common/Types/Translator";
import {
  InfrastructureNode,
  InfrastructureTopologyModel,
  buildInfrastructureTopologyModel,
  describeInfrastructureNode,
  summarizeCounts,
} from "../../FeatureSet/Dashboard/src/Components/Topology/InfrastructureTopologyModel";
import { summarizeRunsOn } from "../../FeatureSet/Dashboard/src/Components/Topology/ServiceMapViewModel";
import {
  countOfType,
  getCountTemplate,
} from "../../FeatureSet/Dashboard/src/Components/Topology/TopologyCounts";
import {
  TopologyEntity,
  TopologyRelationship,
} from "../../FeatureSet/Dashboard/src/Components/Topology/TopologyData";

/*
 * TOPOLOGY'S COUNT LINES IN THE READER'S LANGUAGE (#7658).
 *
 * Where a service runs ("12 pods · 3 Docker hosts"), what a category or a
 * group of replicas holds ("3 hosts") and how big a collection is ("4,200
 * IoT devices") were a figure and an English noun - or a type's label with
 * an English "s" ("ceph clusters") - in every language, with Latin digits
 * in Persian. Each entity type now has a count sentence of the locale's
 * (TopologyCounts), worded where the language puts its count, in the form
 * the count takes and in the reader's digits; on a page read from the
 * right each count of a line is set apart, so a noun left in Latin letters
 * keeps its count beside it.
 *
 * Read here from the Dashboard's shipped locale files, in English, Spanish,
 * Japanese, Persian and Arabic, for one and for many.
 */

const ALL_TYPES: ReadonlyArray<string> = Object.values(EntityType);

const LATIN_DIGIT: RegExp = /[0-9]/;
const PERSIAN_DIGIT: RegExp = /[۰-۹]/;

const NOW: Date = new Date("2026-09-07T10:00:00Z");
const RANGE_START: Date = new Date("2026-09-06T10:00:00Z");

function translatorFor(language: string): Translator {
  return dashboardTranslator(language);
}

function entity(
  key: string,
  type: EntityType,
  name: string = key,
): TopologyEntity {
  return {
    entityKey: key,
    displayName: name,
    entityType: type,
    lastSeenAt: NOW,
    source: EntitySource.Discovered,
  };
}

function hostedOn(from: string, to: string): TopologyRelationship {
  return {
    fromEntityKey: from,
    toEntityKey: to,
    relationshipType: EntityRelationshipType.HostedOn,
  };
}

/*
 * Three replicas of one workload (a group of hosts), a switch, and 4,200
 * IoT devices reporting of 5,000 (a collection) beside it in one category.
 */
const MODEL: InfrastructureTopologyModel = buildInfrastructureTopologyModel(
  [
    entity("api", EntityType.Service),
    entity("h1", EntityType.Host, "oneuptime-app-685856b7d7-48xkt"),
    entity("h2", EntityType.Host, "oneuptime-app-685856b7d7-4vnkt"),
    entity("h3", EntityType.Host, "oneuptime-app-7bf488c9d5-5jgp4"),
    entity("switch", EntityType.NetworkDevice, "core-switch"),
  ],
  [hostedOn("api", "h1"), hostedOn("api", "h2"), hostedOn("api", "h3")],
  {
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
  },
);

function node(id: string): InfrastructureNode {
  const found: InfrastructureNode | undefined = MODEL.nodes.get(id);

  if (!found) {
    throw new Error(`missing node ${id}`);
  }

  return found;
}

const REPLICAS: InfrastructureNode = node(
  node("category:compute").childIds[0] as string,
);
const IOT: InfrastructureNode = node("collection:iot.device");
const NETWORK: InfrastructureNode = node("category:network");

interface Lines {
  // 12 nodes and 1 Docker host, then 3 Docker hosts and 1 node.
  runsOn: [string, string];
  // The group of 3 replica hosts.
  replicas: string;
  // The 4,200 IoT devices reporting.
  collection: string;
  // What the category holds: the collection and the switch.
  category: string;
  // A type this version does not know, 3 of it.
  unknown: string;
}

/*
 * Each language's lines, as its locale words them: the count where the
 * language puts it, its plural form, its digits, and - read from the right
 * - each count of a line set apart (FSI ... PDI).
 */
const EXPECTED: Record<string, Lines> = {
  en: {
    runsOn: ["12 nodes · 1 Docker host", "3 Docker hosts · 1 node"],
    replicas: "3 hosts",
    collection: "4,200 IoT devices",
    category: "4,200 IoT devices · 1 device",
    unknown: "Other: 3",
  },
  es: {
    runsOn: ["12 nodos · 1 host de Docker", "3 hosts de Docker · 1 nodo"],
    // Spanish says "hosts" too.
    replicas: "3 hosts",
    // Spanish groups a number from five digits on.
    collection: "4200 dispositivos IoT",
    category: "4200 dispositivos IoT · 1 dispositivo",
    unknown: "Otro: 3",
  },
  ja: {
    runsOn: [
      "ノード 12 個 · Docker ホスト 1 台",
      "Docker ホスト 3 台 · ノード 1 個",
    ],
    replicas: "ホスト 3 台",
    collection: "IoT デバイス 4,200 台",
    category: "IoT デバイス 4,200 台 · デバイス 1 台",
    unknown: "その他: 3",
  },
  fa: {
    runsOn: [
      `${isolated("۱۲ گره")} • ${isolated("۱ میزبان Docker")}`,
      `${isolated("۳ میزبان Docker")} • ${isolated("۱ گره")}`,
    ],
    replicas: "۳ میزبان",
    collection: "۴٬۲۰۰ دستگاه IoT",
    category: `${isolated("۴٬۲۰۰ دستگاه IoT")} • ${isolated("۱ دستگاه")}`,
    unknown: "سایر: ۳",
  },
  ar: {
    runsOn: [
      `${isolated("العقد: 12")} · ${isolated("1 مضيف Docker")}`,
      `${isolated("مضيفو Docker: 3")} · ${isolated("1 عقدة")}`,
    ],
    replicas: "المضيفون: 3",
    collection: "أجهزة IoT: 4,200",
    category: `${isolated("أجهزة IoT: 4,200")} · ${isolated("1 جهاز")}`,
    unknown: "أخرى: 3",
  },
};

function lines(translator: Translator): Lines {
  return {
    runsOn: [
      summarizeRunsOn(
        [
          { entityType: EntityType.DockerHost, count: 1 },
          { entityType: EntityType.KubernetesNode, count: 12 },
        ],
        translator,
      ) as string,
      summarizeRunsOn(
        [
          { entityType: EntityType.KubernetesNode, count: 1 },
          { entityType: EntityType.DockerHost, count: 3 },
        ],
        translator,
      ) as string,
    ],
    replicas: describeInfrastructureNode(REPLICAS, translator),
    collection: describeInfrastructureNode(IOT, translator),
    category: summarizeCounts(NETWORK.countsByType, undefined, translator),
    unknown: countOfType("something.new", 3, translator),
  };
}

describe("the estate the lines are read from", () => {
  test("holds a group of three hosts, a collection and a category of two types", () => {
    expect(REPLICAS.kind).toBe("group");
    expect(REPLICAS.entityType).toBe(EntityType.Host);
    expect(REPLICAS.childIds).toHaveLength(3);
    expect(IOT.kind).toBe("collection");
    expect(IOT.resourceCount).toBe(4200);
    expect(NETWORK.countsByType).toEqual(
      new Map<string, number>([
        [EntityType.IoTDevice, 4200],
        [EntityType.NetworkDevice, 1],
      ]),
    );
    // A category describes itself by what it holds.
    expect(describeInfrastructureNode(NETWORK)).toBe(
      summarizeCounts(NETWORK.countsByType),
    );
  });
});

describe.each(Object.keys(EXPECTED))(
  "count lines in %s",
  (language: string) => {
    const translator: Translator = translatorFor(language);
    const expected: Lines = EXPECTED[language] as Lines;

    test("where a service runs, one and many, most first", () => {
      expect(lines(translator).runsOn).toEqual(expected.runsOn);
    });

    test("a group of replicas, a collection and a category", () => {
      const read: Lines = lines(translator);

      expect({
        replicas: read.replicas,
        collection: read.collection,
        category: read.category,
      }).toEqual({
        replicas: expected.replicas,
        collection: expected.collection,
        category: expected.category,
      });
    });

    test("a type this version does not know: its label and its count", () => {
      expect(lines(translator).unknown).toBe(expected.unknown);
    });

    test("the digits are the reader's", () => {
      const read: Lines = lines(translator);
      const all: string = [
        ...read.runsOn,
        read.replicas,
        read.collection,
        read.category,
        read.unknown,
      ].join("\n");

      if (language === "fa") {
        expect(all).not.toMatch(LATIN_DIGIT);
        expect(all).toMatch(PERSIAN_DIGIT);
      } else {
        expect(all).not.toMatch(PERSIAN_DIGIT);
        expect(all).toMatch(LATIN_DIGIT);
      }
    });
  },
);

describe("English, as before", () => {
  test("no translator reads English, with English's grouping", () => {
    expect(
      summarizeRunsOn([
        { entityType: EntityType.Container, count: 1234 },
        { entityType: EntityType.KubernetesPod, count: 1 },
      ]),
    ).toBe("1,234 containers · 1 pod");
    expect(countOfType(EntityType.CephCluster, 2)).toBe("2 Ceph clusters");
    expect(countOfType(EntityType.Process, 3)).toBe("3 processes");
    expect(countOfType(EntityType.VMwareVirtualMachine, 1)).toBe("1 VM");
  });

  test("a type with no count sentence is never made a plural of its label", () => {
    // What the old fallback drew: its label, lower case, and an "s".
    expect(countOfType("something.new", 2)).toBe("Other: 2");
    expect(countOfType("", 2)).toBe("Other: 2");
  });
});

/*
 * The infrastructure map's card line (until #6690 words it) and the
 * infrastructure search read the model's lines without a translator. Their
 * words stay English, but their counts are written the way the page writes
 * its numbers, as the model wrote them before: a Persian page's card read
 * "۳ hosts", never "3 hosts".
 */
describe("without a translator: English words, the page's digits", () => {
  afterEach(() => {
    setDateDisplayLanguage(ENGLISH_DATE_LANGUAGE);
  });

  test("a Persian page writes the counts in Persian digits", () => {
    setDateDisplayLanguage("fa");

    expect(describeInfrastructureNode(REPLICAS)).toBe("۳ hosts");
    expect(describeInfrastructureNode(IOT)).toBe("۴٬۲۰۰ IoT devices");
    expect(countOfType("something.new", 3)).toBe("Other: ۳");
  });

  test("a German page groups them its way", () => {
    setDateDisplayLanguage("de");

    expect(summarizeCounts(NETWORK.countsByType, 2)).toBe(
      "4.200 IoT devices · 1 device",
    );
  });
});

/*
 * Every entity type the server can count - what a service runs on is any
 * type of item - has a count sentence, the Dashboard's English file holds
 * it, and every language words both its forms with the count in them.
 */
describe("every entity type has a count sentence in every language", () => {
  test("each type has one, naming its count", () => {
    const missing: Array<string> = ALL_TYPES.filter(
      (entityType: string): boolean => {
        const template: PluralTemplate | undefined =
          getCountTemplate(entityType);

        return (
          !template ||
          !template.one.includes("{{count}}") ||
          !template.other.includes("{{count}}")
        );
      },
    );

    expect(missing).toEqual([]);
    expect(ALL_TYPES.length).toBeGreaterThan(40);
  });

  test("the English file holds each, both forms as the type writes them", () => {
    const english: Record<string, string> = readDashboardLocale("en");

    for (const entityType of ALL_TYPES) {
      const template: PluralTemplate = getCountTemplate(
        entityType,
      ) as PluralTemplate;

      expect({
        entityType,
        other: english[template.other],
        one: english[`${template.other}_one`],
      }).toEqual({ entityType, other: template.other, one: template.one });
    }
  });

  test.each(DASHBOARD_LANGUAGES)(
    "%s words each, both forms, keeping the count",
    (language: string) => {
      const words: Record<string, string> = readDashboardLocale(language);
      const unworded: Array<string> = [];

      for (const entityType of ALL_TYPES) {
        const template: PluralTemplate = getCountTemplate(
          entityType,
        ) as PluralTemplate;

        for (const key of [template.other, `${template.other}_one`]) {
          if (
            !isWordedInDashboardLocale(key, language) ||
            placeholdersOf(String(words[key])).join() !== "{{count}}"
          ) {
            unworded.push(`${entityType}: ${key} -> ${words[key]}`);
          }
        }
      }

      expect(unworded).toEqual([]);
    },
  );

  /*
   * A line of counts names each type apart: Russian, Chinese, Persian and
   * Arabic had worded "{{count}} appliances" as their "{{count}} devices",
   * so a category holding both read "3 devices · 2 devices".
   */
  test.each(["en", ...DASHBOARD_LANGUAGES])(
    "%s tells every type's count from every other's",
    (language: string) => {
      const translator: Translator = translatorFor(language);
      const alike: Array<string> = [];

      for (const count of [1, 2, 3, 5, 21, 100]) {
        const typesByLine: Map<string, Array<string>> = new Map<
          string,
          Array<string>
        >();

        for (const entityType of ALL_TYPES) {
          const line: string = countOfType(entityType, count, translator);

          typesByLine.set(line, [...(typesByLine.get(line) || []), entityType]);
        }

        for (const [line, types] of typesByLine) {
          if (types.length > 1) {
            alike.push(`${line}: ${types.join(", ")}`);
          }
        }
      }

      expect(alike).toEqual([]);
    },
  );

  test("the check sees a count sentence a language does not word (negative control)", () => {
    for (const language of DASHBOARD_LANGUAGES) {
      expect(isWordedInDashboardLocale("{{count}} gizmos", language)).toBe(
        false,
      );
    }
    expect(getCountTemplate("something.new")).toBeUndefined();
    expect(getCountTemplate("toString")).toBeUndefined();
  });
});
