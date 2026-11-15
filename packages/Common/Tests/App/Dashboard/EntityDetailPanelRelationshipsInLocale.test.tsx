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
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * THE TOPOLOGY DRAWER'S RELATIONSHIPS, IN THE READER'S LANGUAGE (#7326).
 *
 * The details drawer of a map or the infrastructure explorer lists what a
 * resource is connected to as sentences naming both ends: "Checkout API
 * is hosted on vm-a", "kubelet is part of Checkout API". It used to glue
 * them together from English pieces - the name, the verb looked up on its
 * own, the other name - so every language read them in English word
 * order, and only "runs on" and "depends on" were keys at all: "member
 * of", "hosted on", "part of" and "instance of" read in English in every
 * language.
 *
 * Each type is a sentence of the locale now ("{{from}} is hosted on
 * {{to}}"), with the edge's source and target where the language puts
 * them. Rendered here with the shipped locale files behind the real
 * i18next and the real drawer, fed by a fake Topology API.
 */

const postMock: MockFunction = getJestMockFunction();
const getListMock: MockFunction = getJestMockFunction();

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
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getCommonHeaders: () => {
        return { tenantid: "project-1" };
      },
    },
  };
});
jest.mock("../../../UI/Components/SideOver/SideOver", () => {
  return {
    __esModule: true,
    SideOverSize: { Small: "small" },
    default: (props: {
      title: string;
      description: string;
      children: React.ReactNode;
    }) => {
      return <section aria-label={props.title}>{props.children}</section>;
    },
  };
});

import EntityDetailPanel from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/EntityDetailPanel";
import { EntityDetailTarget } from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/TopologyData";
import {
  RELATED_TO_RELATIONSHIP_SENTENCE,
  RELATIONSHIP_SENTENCES,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/TopologyMeta";
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
  TopologyEntityResponseJSON,
} from "../../../Types/Topology/TopologyApi";
import ProjectUtil from "../../../UI/Utils/Project";
import { readDashboardLocale } from "../../Helpers/DashboardLocales";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";

const PROJECT_ID: ObjectID = new ObjectID(
  "5b2f5b1c-0000-4000-8000-000000000001",
);
const RANGE_START: Date = new Date("2026-11-13T10:00:00.000Z");
const NAME: string = "Checkout API";

const LANGUAGES: ReadonlyArray<string> = ["de", "fr", "fa", "ja", "ar"];

const WORDS: Record<string, Record<string, string>> = {};
for (const language of ["en", ...LANGUAGES]) {
  WORDS[language] = readDashboardLocale(language);
}

interface Edge {
  relationshipType: string;
  direction: "in" | "out";
  name: string;
}

// Where Checkout API runs and what it is related to, both ways round.
const RUNS_ON_EDGES: Array<Edge> = [
  { relationshipType: "runs-on", direction: "out", name: "checkout-pod" },
];
const RELATED_EDGES: Array<Edge> = [
  { relationshipType: "hosted-on", direction: "out", name: "vm-a" },
  { relationshipType: "member-of", direction: "out", name: "pool-blue" },
  { relationshipType: "part-of", direction: "in", name: "kubelet" },
  { relationshipType: "instance-of", direction: "out", name: "m5-large" },
  { relationshipType: "depends-on", direction: "in", name: "web" },
  { relationshipType: "talks-to", direction: "out", name: "ledger" },
  { relationshipType: "", direction: "out", name: "orphan" },
];

function rowOf(edge: Edge): TopologyConnectionRowJSON {
  return {
    relationshipType: edge.relationshipType,
    direction: edge.direction,
    otherKey: `key-${edge.name}`,
    otherKnown: true,
    otherName: edge.name,
    otherType: null,
    callCount: null,
    errorCount: null,
    avgDurationMs: null,
    lastSeenAt: null,
  };
}

function sectionOf(edges: Array<Edge>): TopologyConnectionSectionJSON {
  return {
    total: edges.length,
    unknownTotal: 0,
    rows: edges.map(rowOf),
    nextOffset: null,
  };
}

function checkoutResponse(): JSONObject {
  const sections: Record<
    TopologyConnectionSection,
    TopologyConnectionSectionJSON
  > = {
    calls: sectionOf([]),
    calledBy: sectionOf([]),
    runsOn: sectionOf(RUNS_ON_EDGES),
    related: sectionOf(RELATED_EDGES),
  };
  const response: TopologyEntityResponseJSON = {
    formatVersion: TOPOLOGY_API_FORMAT_VERSION,
    rangeStart: RANGE_START.toISOString(),
    generatedAt: "2026-11-13T10:15:00.000Z",
    entity: {
      id: "1a1a0000-0000-4000-8000-000000000001",
      key: "svc",
      type: EntityType.Service,
      name: NAME,
      source: "telemetry",
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

// The sentence a row draws in `language`: the source first in the template.
function expectedSentence(language: string, edge: Edge): string {
  const template: string = !edge.relationshipType
    ? RELATED_TO_RELATIONSHIP_SENTENCE
    : RELATIONSHIP_SENTENCES[edge.relationshipType as EntityRelationshipType] ||
      `{{from}} ${edge.relationshipType.replace(/-/g, " ")} {{to}}`;
  const worded: string = WORDS[language]![template] || template;
  const from: string = edge.direction === "out" ? NAME : edge.name;
  const to: string = edge.direction === "out" ? edge.name : NAME;
  return worded.replace("{{from}}", from).replace("{{to}}", to);
}

// What each row of a section says: its first line, the sentence.
function sentencesIn(testId: string): Array<string> {
  return within(screen.getByTestId(testId))
    .getAllByRole("listitem")
    .map((row: HTMLElement): string => {
      return withoutIsolateMarks(row.firstElementChild?.textContent || "");
    });
}

// With onSelectEntity, each row of a known resource is a button that opens it.
async function renderDrawer(
  onSelectEntity?: ((target: EntityDetailTarget) => void) | undefined,
): Promise<void> {
  render(
    <EntityDetailPanel
      entity={{
        entityKey: "svc",
        entityType: EntityType.Service,
        displayName: NAME,
      }}
      rangeStart={RANGE_START}
      metricsWindowSeconds={60}
      onClose={() => {
        return undefined;
      }}
      onSelectEntity={onSelectEntity}
    />,
  );
  await waitFor(() => {
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
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
    return new HTTPResponse<JSONObject>(200, checkoutResponse(), {});
  });
  getListMock.mockReset();
  getListMock.mockImplementation(async () => {
    return { data: [], count: 0 };
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

  test("each row is one sentence, from the edge's source to its target", async () => {
    await renderDrawer();

    expect(sentencesIn("entity-detail-runs-on")).toEqual([
      "Checkout API runs on checkout-pod",
    ]);
    expect(sentencesIn("entity-detail-related")).toEqual([
      "Checkout API is hosted on vm-a",
      "Checkout API is a member of pool-blue",
      "kubelet is part of Checkout API",
      "Checkout API is an instance of m5-large",
      "web depends on Checkout API",
      "Checkout API talks to ledger",
      "Checkout API is related to orphan",
    ]);
  });
});

describe.each(LANGUAGES)("in %s", (language: string) => {
  beforeAll(async () => {
    await inLanguage(language);
  });

  test("each row is the language's own sentence, with both ends where it puts them", async () => {
    await renderDrawer();

    expect(sentencesIn("entity-detail-runs-on")).toEqual(
      RUNS_ON_EDGES.map((edge: Edge): string => {
        return expectedSentence(language, edge);
      }),
    );
    expect(sentencesIn("entity-detail-related")).toEqual(
      RELATED_EDGES.map((edge: Edge): string => {
        return expectedSentence(language, edge);
      }),
    );
  });

  test("no row of a known type reads in English", async () => {
    await renderDrawer();

    const english: Array<string> = [
      ...RUNS_ON_EDGES,
      ...RELATED_EDGES.slice(0, 5),
    ].map((edge: Edge): string => {
      return expectedSentence("en", edge);
    });
    const said: Array<string> = [
      ...sentencesIn("entity-detail-runs-on"),
      ...sentencesIn("entity-detail-related").slice(0, 5),
    ];

    for (let index: number = 0; index < said.length; index++) {
      expect(said[index]).not.toBe(english[index]);
    }
  });

  test("a type this Dashboard does not know reads as its words, in English", async () => {
    await renderDrawer();

    expect(sentencesIn("entity-detail-related")[5]).toBe(
      "Checkout API talks to ledger",
    );
  });
});

/*
 * HOW A ROW'S SENTENCE IS DRAWN.
 *
 * Each name is an isolate of its own inside the sentence, so a pod's
 * hyphens and a host's dots stay where they are written in an Arabic
 * sentence; the sentence reads the way its own words do (dir auto skips
 * the names), so a type this Dashboard does not know, worded in English,
 * keeps its English order on a Persian page; and the arrow that opens the
 * other end points on, the way the line reads.
 */
describe("how a row's sentence is drawn", () => {
  test.each(["fa", "ar", "de", "en"])(
    "in %s, each name is an isolate of its own, in a sentence that reads by its own words",
    async (language: string) => {
      await inLanguage(language);
      await renderDrawer();

      const sentences: Array<HTMLElement> = within(
        screen.getByTestId("entity-detail-related"),
      ).getAllByTestId("entity-connection-sentence");

      expect(sentences).toHaveLength(RELATED_EDGES.length);
      sentences.forEach((sentence: HTMLElement, index: number) => {
        const names: Array<string> = Array.from(
          sentence.querySelectorAll("bdi"),
        ).map((name: HTMLElement): string => {
          return name.textContent || "";
        });

        expect(sentence).toHaveAttribute("dir", "auto");
        expect(names.sort()).toEqual([NAME, RELATED_EDGES[index]!.name].sort());
      });
    },
  );

  test.each(["fa", "ar"])(
    "in %s, the arrow that opens the other end points on, the way the line reads",
    async (language: string) => {
      const selectEntity: MockFunction = getJestMockFunction();

      await inLanguage(language);
      await renderDrawer(selectEntity as (target: EntityDetailTarget) => void);

      const buttons: Array<HTMLElement> = within(
        screen.getByTestId("entity-detail-related"),
      ).getAllByRole("button");

      expect(buttons.length).toBe(RELATED_EDGES.length);
      for (const button of buttons) {
        // The shared DirectionArrow writes "←" in a line read from the right.
        const arrow: HTMLElement = within(button).getByText("←");

        expect(arrow).toHaveAttribute("aria-hidden", "true");
        expect(within(button).queryByText("→")).toBeNull();
        // Mirrored as well, "←" would point back again.
        expect(arrow).not.toHaveClass("rtl:-scale-x-100");
        expect(
          within(button).getByTestId("entity-connection-sentence"),
        ).toHaveAttribute("dir", "auto");
      }
    },
  );
});

describe("the sentences the issue was about", () => {
  test.each([
    ["de", "Checkout API wird auf vm-a gehostet"],
    ["fr", "Checkout API est hébergé sur vm-a"],
    ["fa", "Checkout API روی vm-a میزبانی می‌شود"],
    ["ja", "Checkout API は vm-a でホストされている"],
  ])("%s: %s", async (language: string, sentence: string) => {
    await inLanguage(language);
    await renderDrawer();

    expect(sentencesIn("entity-detail-related")[0]).toBe(sentence);
  });
});
