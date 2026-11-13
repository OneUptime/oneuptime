import "@testing-library/jest-dom";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import React, { ReactElement, ReactNode } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * AN ITEM'S CONNECTIONS, IN THE READER'S LANGUAGE (#7326).
 *
 * Each row of an inventory item's Connections card says one thing about
 * this item, with the item at the other end in it: "runs checkout-pod" on
 * a node, "is part of prod" on a namespace. The row used to draw a bare
 * phrase looked up on its own and the other item's link after it. "runs"
 * and "hosts" read alone as nouns, and "hosts" is the host lists' noun too,
 * so German said "Hosts checkout-pod" and French "exécutions checkout-pod"
 * on a node that runs the pod - and nothing said which way the edge went.
 *
 * Each reading is a sentence now, worded by each language with the other
 * item where its grammar puts it: after the verb in German and French,
 * before it in Persian and Japanese. Rendered here with the shipped locale
 * files behind the real i18next and the real card, fed by a fake API.
 */

const postMock: MockFunction = getJestMockFunction();

// The arrow wrappers are load bearing: jest.mock is hoisted above the mocks.
jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
        return postMock(...args);
      },
    },
  };
});
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getCommonHeaders: () => {
        return { tenantid: "project-1" };
      },
    },
  };
});
jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/AppLink/AppLink",
  () => {
    return {
      __esModule: true,
      default: (props: {
        to?: { toString: () => string };
        children: ReactNode;
        className?: string;
      }): ReactElement => {
        return React.createElement(
          "a",
          { href: props.to?.toString(), className: props.className },
          props.children,
        );
      },
    };
  },
);

import InventoryRelationships from "../../../../App/FeatureSet/Dashboard/src/Components/Inventory/InventoryRelationships";
import {
  RELATED_TO_SENTENCE,
  RELATIONSHIP_PHRASINGS,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Inventory/InventoryRelationshipLabels";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import EntityRelationshipType from "../../../Types/Telemetry/EntityRelationshipType";
import EntityType from "../../../Types/Telemetry/EntityType";
import {
  TOPOLOGY_API_FORMAT_VERSION,
  TopologyConnectionRowJSON,
  TopologyConnectionSection,
  TopologyConnectionSectionJSON,
  TopologyEntityAllTimeResponseJSON,
} from "../../../Types/Topology/TopologyApi";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  DASHBOARD_LANGUAGES,
  isWordedInDashboardLocale,
  readDashboardLocale,
} from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

const PROJECT_ID: ObjectID = new ObjectID(
  "5b2f5b1c-0000-4000-8000-000000000001",
);

const LANGUAGES: ReadonlyArray<string> = ["de", "fr", "es", "fa", "ja", "ar"];

const WORDS: Record<string, Record<string, string>> = {};
for (const language of ["en", ...LANGUAGES]) {
  WORDS[language] = readDashboardLocale(language);
}

function idOf(index: number): string {
  return `2b2b0000-0000-4000-8000-${String(index).padStart(12, "0")}`;
}

interface Edge {
  relationshipType: string;
  direction: "in" | "out";
  name: string;
  // An end no longer in inventory: shown by its key, unlinked.
  gone?: boolean;
}

/*
 * A Kubernetes node: checkout-pod runs on it, vm-a is hosted on it, it is
 * a member of the pool and part of the prod cluster, and a newer server's
 * type and an untyped edge besides.
 */
const RUNS_ON_EDGES: Array<Edge> = [
  { relationshipType: "runs-on", direction: "in", name: "checkout-pod" },
  { relationshipType: "runs-on", direction: "out", name: "rack-7" },
];
const RELATED_EDGES: Array<Edge> = [
  { relationshipType: "hosted-on", direction: "in", name: "vm-a" },
  { relationshipType: "hosted-on", direction: "out", name: "hypervisor-2" },
  { relationshipType: "member-of", direction: "in", name: "web-1" },
  { relationshipType: "member-of", direction: "out", name: "pool-blue" },
  { relationshipType: "part-of", direction: "in", name: "kubelet" },
  { relationshipType: "part-of", direction: "out", name: "prod" },
  { relationshipType: "instance-of", direction: "in", name: "node-a-1" },
  { relationshipType: "instance-of", direction: "out", name: "m5-large" },
  { relationshipType: "depends-on", direction: "in", name: "billing" },
  { relationshipType: "depends-on", direction: "out", name: "etcd" },
  { relationshipType: "talks-to", direction: "out", name: "ledger" },
  { relationshipType: "", direction: "in", name: "orphan" },
  // A name longer than a phone's line: it breaks after its own dots.
  {
    relationshipType: "hosted-on",
    direction: "out",
    name: "ip-10-0-12-34.eu-west-1.compute.internal",
  },
  {
    relationshipType: "runs-on",
    direction: "in",
    name: "0123456789abcdef0123",
    gone: true,
  },
];

function rowOf(edge: Edge, index: number): TopologyConnectionRowJSON {
  return {
    relationshipType: edge.relationshipType,
    direction: edge.direction,
    otherKey: edge.gone ? edge.name : `key-${edge.name}`,
    otherKnown: !edge.gone,
    otherId: edge.gone ? null : idOf(index),
    otherName: edge.gone ? null : edge.name,
    otherType: edge.gone ? null : EntityType.KubernetesPod,
    callCount: null,
    errorCount: null,
    avgDurationMs: null,
    lastSeenAt: null,
  };
}

function sectionOf(
  edges: Array<Edge>,
  firstIndex: number,
): TopologyConnectionSectionJSON {
  return {
    total: edges.length,
    unknownTotal: edges.filter((edge: Edge): boolean => {
      return Boolean(edge.gone);
    }).length,
    rows: edges.map((edge: Edge, index: number): TopologyConnectionRowJSON => {
      return rowOf(edge, firstIndex + index);
    }),
    nextOffset: null,
  };
}

function nodeResponse(): JSONObject {
  const sections: Record<
    TopologyConnectionSection,
    TopologyConnectionSectionJSON
  > = {
    calls: sectionOf([], 0),
    calledBy: sectionOf([], 0),
    runsOn: sectionOf(RUNS_ON_EDGES, 1),
    related: sectionOf(RELATED_EDGES, 100),
  };
  const response: TopologyEntityAllTimeResponseJSON = {
    formatVersion: TOPOLOGY_API_FORMAT_VERSION,
    generatedAt: "2026-11-13T10:15:00.000Z",
    entity: {
      id: "1a1a0000-0000-4000-8000-000000000001",
      key: "node-a",
      type: EntityType.KubernetesNode,
      name: "node-a",
      source: "discovered",
      lastSeenAt: null,
      firstSeenAt: null,
      resourceType: null,
      resourceId: null,
      identifyingAttributes: null,
      descriptiveAttributes: null,
    },
    sections: sections,
    isScanLimited: false,
  };
  return JSON.parse(JSON.stringify(response)) as JSONObject;
}

// The key a row's sentence is, as the card picks it.
function templateOf(edge: Edge): string {
  if (!edge.relationshipType) {
    return RELATED_TO_SENTENCE;
  }
  const phrasing: { outgoing: string; incoming: string } | undefined =
    RELATIONSHIP_PHRASINGS[edge.relationshipType as EntityRelationshipType];
  if (!phrasing) {
    // A type this Dashboard does not know: its words, in English.
    return `${edge.relationshipType.replace(/-/g, " ")} {{item}}`;
  }
  return edge.direction === "out" ? phrasing.outgoing : phrasing.incoming;
}

// What a row says in `language`: its locale's sentence with the other end in it.
function expectedSentence(language: string, edge: Edge): string {
  const template: string = templateOf(edge);
  const worded: string = WORDS[language]![template] || template;
  const shown: string = edge.gone ? edge.name.substring(0, 16) : edge.name;
  return worded.replace("{{item}}", shown);
}

function rowsOf(section: TopologyConnectionSection): Array<HTMLElement> {
  return within(
    screen.getByTestId(`inventory-connections-${section}`),
  ).getAllByRole("listitem");
}

function sentenceOf(row: HTMLElement): HTMLElement {
  return within(row).getByTestId("inventory-connection-sentence");
}

async function renderNode(): Promise<void> {
  render(
    <InventoryRelationships
      entityKey="node-a"
      entityType={EntityType.KubernetesNode}
    />,
  );
  await waitFor(() => {
    expect(screen.queryByTestId("component-loader")).not.toBeInTheDocument();
  });
}

async function inLanguage(language: string): Promise<void> {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage(language);
  });
}

beforeAll(async () => {
  const resources: Record<string, { translation: Record<string, string> }> = {};
  for (const language of LANGUAGES) {
    resources[language] = { translation: WORDS[language]! };
  }
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: resources,
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

beforeEach(() => {
  postMock.mockReset();
  postMock.mockImplementation(async () => {
    return new HTTPResponse<JSONObject>(200, nodeResponse(), {});
  });
  jest.spyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(PROJECT_ID);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

afterAll(async () => {
  await inLanguage("en");
});

describe("in English", () => {
  beforeAll(async () => {
    await inLanguage("en");
  });

  test("a node runs the pod scheduled on it, and runs on its rack", async () => {
    await renderNode();

    const [pod, rack] = rowsOf("runsOn");
    expect(withoutIsolateMarks(sentenceOf(pod!).textContent || "")).toBe(
      "runs checkout-pod",
    );
    expect(withoutIsolateMarks(sentenceOf(rack!).textContent || "")).toBe(
      "runs on rack-7",
    );
  });
});

describe.each(LANGUAGES)("in %s", (language: string) => {
  beforeAll(async () => {
    await inLanguage(language);
  });

  test("every row says its own sentence about this item, with the other end in it", async () => {
    await renderNode();

    const said: Array<string> = [...rowsOf("runsOn"), ...rowsOf("related")].map(
      (row: HTMLElement): string => {
        return withoutIsolateMarks(sentenceOf(row).textContent || "");
      },
    );

    expect(said).toEqual(
      [...RUNS_ON_EDGES, ...RELATED_EDGES].map((edge: Edge): string => {
        return expectedSentence(language, edge);
      }),
    );
  });

  test("the sentences are the language's own, not English", async () => {
    await renderNode();

    const [pod] = rowsOf("runsOn");
    const podSentence: string = withoutIsolateMarks(
      sentenceOf(pod!).textContent || "",
    );
    expect(podSentence).not.toBe("runs checkout-pod");
    expect(podSentence).toContain("checkout-pod");
    // Nor the host lists' noun in front of the pod.
    expect(podSentence.toLowerCase()).not.toBe(
      `${WORDS[language]!["hosts"]} checkout-pod`.toLowerCase(),
    );
  });

  test("the other end's link sits inside the sentence, and an end no longer in inventory is its key, unlinked", async () => {
    await renderNode();

    const [pod] = rowsOf("runsOn");
    const link: HTMLElement = within(sentenceOf(pod!)).getByRole("link", {
      name: "checkout-pod",
    });
    expect(link.getAttribute("href")).toBe(
      `/dashboard/${PROJECT_ID.toString()}/inventory/item/${idOf(1)}`,
    );

    const related: Array<HTMLElement> = rowsOf("related");
    const gone: HTMLElement = related[related.length - 1]!;
    expect(
      within(sentenceOf(gone)).queryByRole("link"),
    ).not.toBeInTheDocument();
    expect(
      within(sentenceOf(gone)).getByText("0123456789abcdef"),
    ).toBeInTheDocument();
  });

  test("a type this Dashboard does not know reads as its words, in English", async () => {
    await renderNode();

    const unknown: HTMLElement = rowsOf("related")[10]!;
    expect(withoutIsolateMarks(sentenceOf(unknown).textContent || "")).toBe(
      "talks to ledger",
    );
  });
});

/*
 * HOW A ROW IS LAID OUT.
 *
 * The arrow stays at the start of the sentence's first line: in a row
 * that wrapped as a whole, a long sentence on a phone left the arrow alone
 * on a line of its own above the words. The other item's name is an
 * isolate of its own inside the sentence, so a host name keeps its dots
 * and hyphens where they are in a Persian sentence, and a long one breaks
 * after its own dots. The sentence reads the way its own words do (dir
 * auto skips the name): a type this Dashboard does not know is worded in
 * English, and on a Persian page it kept its English order.
 */
describe("how a row is laid out", () => {
  test.each(["fa", "ar", "de", "en"])(
    "in %s, the arrow sits beside the sentence, never on a line of its own",
    async (language: string) => {
      await inLanguage(language);
      await renderNode();

      for (const row of [...rowsOf("runsOn"), ...rowsOf("related")]) {
        const [arrow, content] = Array.from(row.children) as Array<HTMLElement>;

        expect(row.children).toHaveLength(2);
        expect(row).toHaveClass("flex", "items-start");
        expect(row).not.toHaveClass("flex-wrap");
        expect(arrow).toHaveClass("shrink-0");
        expect(content).toHaveAttribute(
          "data-testid",
          "inventory-connection-content",
        );
        expect(content).toHaveClass("min-w-0", "flex-1", "flex-wrap");
        expect(content).toContainElement(sentenceOf(row));
      }
    },
  );

  test.each(["fa", "ar", "de", "en"])(
    "in %s, the other item's name is an isolate in a sentence that reads by its own words",
    async (language: string) => {
      await inLanguage(language);
      await renderNode();

      const edges: Array<Edge> = [...RUNS_ON_EDGES, ...RELATED_EDGES];
      const rows: Array<HTMLElement> = [
        ...rowsOf("runsOn"),
        ...rowsOf("related"),
      ];

      rows.forEach((row: HTMLElement, index: number) => {
        const edge: Edge = edges[index]!;
        const names: Array<string> = Array.from(
          sentenceOf(row).querySelectorAll("bdi"),
        ).map((name: HTMLElement): string => {
          return name.textContent || "";
        });

        expect(sentenceOf(row)).toHaveAttribute("dir", "auto");
        expect(names).toEqual([
          edge.gone ? edge.name.substring(0, 16) : edge.name,
        ]);
      });
    },
  );

  /*
   * A <wbr> adds no character: the link says the name as written (Chromium
   * names it "ip-10-0-12-34.eu-west-1.compute.internal"; jsdom's name
   * computation puts a space at each <wbr>, so the text is read here).
   */
  test("a long host name breaks after its own dots, and its link holds the name whole", async () => {
    await inLanguage("fa");
    await renderNode();

    const host: HTMLElement = rowsOf("related").find(
      (row: HTMLElement): boolean => {
        return (sentenceOf(row).textContent || "").includes(
          "ip-10-0-12-34.eu-west-1.compute.internal",
        );
      },
    )!;
    const link: HTMLElement = within(sentenceOf(host)).getByRole("link");

    expect(link.textContent).toBe("ip-10-0-12-34.eu-west-1.compute.internal");
    expect(link.querySelectorAll("wbr").length).toBeGreaterThanOrEqual(3);
    expect(link.querySelector("bdi")).toHaveAttribute("dir", "ltr");
  });

  test("on a Persian page, a type this Dashboard does not know keeps its English sentence", async () => {
    await inLanguage("fa");
    await renderNode();

    const unknown: HTMLElement = rowsOf("related")[10]!;

    expect(withoutIsolateMarks(sentenceOf(unknown).textContent || "")).toBe(
      "talks to ledger",
    );
    expect(sentenceOf(unknown)).toHaveAttribute("dir", "auto");
  });
});

/*
 * The line under a section's name that counts the ends no longer in
 * inventory read "1 no longer in inventory" in fifteen languages.
 */
describe("the count of ends no longer in inventory", () => {
  const COUNT_KEYS: Array<string> = [
    "{{count}} no longer in inventory",
    "{{count}} no longer in inventory_one",
  ];

  test.each(DASHBOARD_LANGUAGES)("%s words both forms", (language: string) => {
    expect(
      COUNT_KEYS.filter((key: string): boolean => {
        return !isWordedInDashboardLocale(key, language);
      }),
    ).toEqual([]);
  });

  test.each(LANGUAGES)(
    "in %s, the related section says it in the language",
    async (language: string) => {
      await inLanguage(language);
      await renderNode();

      const section: string =
        screen.getByTestId("inventory-connections-related").textContent || "";
      const said: Array<string> = COUNT_KEYS.map((key: string): string => {
        return withoutIsolateMarks(
          (WORDS[language]![key] || "").replace("{{count}}", ""),
        ).trim();
      });

      expect(section).not.toContain("no longer in inventory");
      expect(
        said.some((words: string): boolean => {
          return words.length > 0 && section.includes(words);
        }),
      ).toBe(true);
    },
  );
});

describe("where each language puts the other end", () => {
  test.each([
    ["de", "führt checkout-pod aus"],
    ["fr", "exécute checkout-pod"],
    ["fa", "checkout-pod را اجرا می‌کند"],
    ["ja", "checkout-pod を実行"],
  ])("%s: %s", async (language: string, sentence: string) => {
    await inLanguage(language);
    await renderNode();

    const [pod] = rowsOf("runsOn");
    expect(withoutIsolateMarks(sentenceOf(pod!).textContent || "")).toBe(
      sentence,
    );
  });
});
