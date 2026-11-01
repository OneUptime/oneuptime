import { beforeAll, describe, expect, test } from "@jest/globals";
import {
  SpanQueryScope,
  buildSpanQueryScope,
  describeNotCarriedFilter,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/SpanQueryScope";
import {
  TelemetryFilterTuple,
  describeUnappliedScopeFilters,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/TelemetryTabScope";
import {
  TracesPivotInput,
  buildTracesPivotScope,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/TraceCorrelatedSignals";
import { JSONObject } from "../../../Types/JSON";
import { TraceSpanType } from "../../../Types/Telemetry/TraceSpanType";
import { Translator, formatList } from "../../../UI/Utils/TranslateTemplate";
import { generatedTexts } from "../../Helpers/GeneratedTexts";
import {
  ENGLISH,
  LANGUAGES,
  OTHER_LANGUAGES,
  createLanguageInstances,
  hasOwnWording,
  translatorFor,
  word,
} from "./TracesLanguageHarness";

/*
 * ---------------------------------------------------------------------------
 * The sentences that say what a view left behind, in every language
 * ---------------------------------------------------------------------------
 *
 * Three places name filters in a sentence: an Insights tab's "Also filtered in
 * the Viewer" hint, a pivot's "Not carried" tooltip and the note above a stored
 * scope's chart. A label is a word of ours, in a language's own sentence, or a
 * name out of a person's telemetry (an attribute's key), which stays as written
 * inside the sentence. Each label below is produced the way the views produce
 * it, so a new one nobody translated fails here, not in front of a reader.
 */

const FACET_LABELS: Array<[string, string]> = [
  ["severityText", "Severity"],
  ["body", "message text"],
  ["traceId", "trace id"],
  ["spanId", "span id"],
  ["hostId", "host"],
  ["dockerHostId", "Docker host"],
  ["podmanHostId", "Podman host"],
  ["kubernetesClusterId", "Kubernetes cluster"],
  ["dockerSwarmClusterId", "Docker Swarm cluster"],
  ["proxmoxClusterId", "Proxmox cluster"],
  ["vmwareVCenterId", "vCenter"],
  ["cephClusterId", "Ceph cluster"],
  ["storageArrayId", "storage array"],
  ["serverlessFunctionId", "serverless function"],
  ["cloudResourceId", "cloud resource"],
  ["rumApplicationId", "RUM application"],
  ["iotFleetId", "IoT fleet"],
  ["databaseServerId", "database"],
];

// Keys out of a person's telemetry, and what they could do to a sentence.
const ATTRIBUTE_KEY_PIECES: ReadonlyArray<string> = [
  "http",
  "method",
  ".",
  "_",
  "-",
  " ",
  ":",
  "{{count}}",
  "{{key}}",
  "$&",
  "$1",
  "<b>",
  "ключ",
  "キー",
  "‏",
];

const HINT_TEMPLATE: string =
  "Also filtered in the Viewer, not applied here: {{filters}}";

// A facet's filter: which values it holds is no part of the hint.
const filterOn: (facetKey: string) => TelemetryFilterTuple = (
  facetKey: string,
): TelemetryFilterTuple => {
  return [facetKey, ["value"]];
};

const hintFor: (language: string, filters: Array<string>) => string = (
  language: string,
  filters: Array<string>,
): string => {
  const translator: Translator = translatorFor(language);

  return translator.translateTemplate(HINT_TEMPLATE, {
    filters: formatList(filters, translator),
  });
};

const pivotInput: (overrides: Partial<TracesPivotInput>) => TracesPivotInput = (
  overrides: Partial<TracesPivotInput>,
): TracesPivotInput => {
  return {
    activeFilters: [],
    fieldFilters: {},
    searchAttributes: {},
    searchAttributeSearches: {},
    freeText: "",
    rootOnly: false,
    hasEntityScope: false,
    startTime: new Date("2026-10-01T10:00:00.000Z"),
    endTime: new Date("2026-10-01T11:00:00.000Z"),
    ...overrides,
  };
};

// Every label a pivot can leave behind, produced by the pivot itself.
const everyPivotLabel: () => Array<string> = (): Array<string> => {
  return buildTracesPivotScope(
    pivotInput({
      activeFilters: [
        { facetKey: "attributeSearches.http.route", value: "/pay" },
      ],
      fieldFilters: {
        statusCode: ["2"],
        kind: ["SPAN_KIND_SERVER"],
        hasException: ["true"],
        statusMessage: ["timeout"],
        name: ["GET /"],
        durationUnixNano: ["1000"],
      },
      freeText: "checkout",
      rootOnly: true,
      hasEntityScope: true,
    }),
  ).notCarried;
};

const storedScopeWithEverything: () => SpanQueryScope = (): SpanQueryScope => {
  return buildSpanQueryScope({
    durationUnixNano: { _type: "GreaterThan", value: 5 },
    endTime: { _type: "GreaterThan", value: "2026-10-01T10:00:00.000Z" },
    parentSpanId: "span-1",
    sessionId: "session-1",
    attributeKeys: ["http.route"],
    attributes: {
      "http.route": { _type: "Search", value: "/pay" },
      "plain.key": "scalar",
    },
  } as unknown as JSONObject);
};

beforeAll(async () => {
  await createLanguageInstances();
});

describe("the labels, in the Dashboard's locales", () => {
  test("a pivot's labels are keys of the Dashboard's English", () => {
    const labels: Array<string> = everyPivotLabel();

    expect(labels.length).toBeGreaterThanOrEqual(8);

    for (const label of labels) {
      expect(ENGLISH[label]).toBe(label);
    }
  });

  test("a hint's labels are keys of the Dashboard's English", () => {
    for (const [, label] of FACET_LABELS) {
      expect(ENGLISH[label]).toBe(label);
    }

    for (const label of [
      "search text",
      "root spans only",
      "attribute {{name}}",
    ]) {
      expect(ENGLISH[label]).toBe(label);
    }
  });

  test("a stored scope's labels are keys of the Dashboard's English", () => {
    const labels: Array<string> = storedScopeWithEverything().notCarried;

    expect(labels.length).toBeGreaterThanOrEqual(4);

    for (const label of labels) {
      if (!label.startsWith("attribute filter on ")) {
        expect(ENGLISH[label]).toBe(label);
      }
    }

    expect(ENGLISH["attribute filter on {{key}}"]).toBeDefined();
    expect(ENGLISH["attribute filter"]).toBeDefined();
  });

  test.each(OTHER_LANGUAGES)(
    "%s has wording for everything a sentence can name",
    (language: string) => {
      const labels: Array<string> = [
        ...everyPivotLabel(),
        ...FACET_LABELS.map((entry: [string, string]): string => {
          return entry[1];
        }),
        ...storedScopeWithEverything().notCarried.filter(
          (label: string): boolean => {
            return !label.startsWith("attribute filter on ");
          },
        ),
        "attribute filter",
        "attribute filter on {{key}}",
        "attribute {{name}}",
        "search text",
        "root spans only",
        HINT_TEMPLATE,
      ];

      expect(
        labels.filter((label: string): boolean => {
          return !hasOwnWording(language, label);
        }),
      ).toEqual([]);
    },
  );
});

describe.each(LANGUAGES)(
  "a filter's name in a sentence in %s",
  (language: string) => {
    const translator: () => Translator = (): Translator => {
      return translatorFor(language);
    };

    test("an attribute's filter names the attribute as written", () => {
      expect(
        describeNotCarriedFilter(
          "attribute filter on http.route",
          translator(),
        ),
      ).toBe(
        translator().translateTemplate("attribute filter on {{key}}", {
          key: "http.route",
        }),
      );
      expect(
        describeNotCarriedFilter(
          "attribute filter on http.route",
          translator(),
        ),
      ).toContain("http.route");
    });

    test("an attribute's key nothing can do to the sentence stays whole", () => {
      for (const key of generatedTexts(800, 5473, ATTRIBUTE_KEY_PIECES, 5)) {
        const drawn: string = describeNotCarriedFilter(
          `attribute filter on ${key}`,
          translator(),
        );

        if (!drawn.includes(key)) {
          throw new Error(`${JSON.stringify(key)} drew ${drawn}`);
        }
      }
    });

    test("a word of ours is cased as the sentence cases it", () => {
      expect(describeNotCarriedFilter("session filter", translator())).toBe(
        translator().translateTerm("session filter", { inSentence: true }),
      );
    });

    test("a key nothing names (a new column) stays as written", () => {
      expect(describeNotCarriedFilter("newColumn", translator())).toBe(
        "newColumn",
      );
    });

    test("the prefix alone reads as a filter on nothing, and does not break", () => {
      expect(
        describeNotCarriedFilter("attribute filter on ", translator()).length,
      ).toBeGreaterThan(0);
    });

    test.each(FACET_LABELS)(
      "%s is named in the hint as %s is in the language",
      (facetKey: string, label: string) => {
        expect(
          describeUnappliedScopeFilters(
            [filterOn(facetKey)],
            undefined,
            translator(),
          ),
        ).toBe(
          hintFor(language, [
            translator().translateTerm(label, { inSentence: true }),
          ]),
        );
      },
    );

    test("an attribute's hint names the attribute as written", () => {
      expect(
        describeUnappliedScopeFilters(
          [filterOn("attributes.http.route")],
          undefined,
          translator(),
        ),
      ).toBe(
        hintFor(language, [
          translator().translateTemplate("attribute {{name}}", {
            name: "http.route",
          }),
        ]),
      );
    });

    test("a facet nothing names stays as written", () => {
      expect(
        describeUnappliedScopeFilters(
          [filterOn("someNewFacet")],
          undefined,
          translator(),
        ),
      ).toBe(hintFor(language, ["someNewFacet"]));
    });

    test("several filters are listed the language's way, in the order they came", () => {
      const hint: string = describeUnappliedScopeFilters(
        [
          filterOn("body"),
          filterOn("attributes.http.route"),
          filterOn("hostId"),
        ],
        { search: "checkout", spanType: TraceSpanType.Root },
        translator(),
      );

      expect(hint).toBe(
        hintFor(language, [
          translator().translateTerm("message text", { inSentence: true }),
          translator().translateTemplate("attribute {{name}}", {
            name: "http.route",
          }),
          translator().translateTerm("host", { inSentence: true }),
          translator().translateTerm("search text", { inSentence: true }),
          translator().translateTerm("root spans only", { inSentence: true }),
        ]),
      );
    });

    test("a filter named twice is listed once", () => {
      expect(
        describeUnappliedScopeFilters(
          [
            filterOn("hostId"),
            filterOn("hostId"),
            filterOn("attributes.k"),
            filterOn("attributes.k"),
          ],
          undefined,
          translator(),
        ),
      ).toBe(
        hintFor(language, [
          translator().translateTerm("host", { inSentence: true }),
          translator().translateTemplate("attribute {{name}}", { name: "k" }),
        ]),
      );
    });

    test("with nothing to say there is no sentence, so no chip", () => {
      expect(describeUnappliedScopeFilters([], undefined, translator())).toBe(
        "",
      );
      expect(
        describeUnappliedScopeFilters(
          [],
          { search: "   ", rootOnly: false, spanType: TraceSpanType.Entry },
          translator(),
        ),
      ).toBe("");
      expect(
        describeUnappliedScopeFilters(
          [],
          { search: null, rootOnly: null, spanType: TraceSpanType.All },
          translator(),
        ),
      ).toBe("");
    });

    test("only a narrowing the reader chose earns a mention", () => {
      const rootOnly: string = hintFor(language, [
        translator().translateTerm("root spans only", { inSentence: true }),
      ]);

      expect(
        describeUnappliedScopeFilters([], { rootOnly: true }, translator()),
      ).toBe(rootOnly);
      expect(
        describeUnappliedScopeFilters(
          [],
          { spanType: TraceSpanType.Root },
          translator(),
        ),
      ).toBe(rootOnly);
    });

    test("the sentence never shows a placeholder or a piece of English markup", () => {
      const hint: string = describeUnappliedScopeFilters(
        FACET_LABELS.map((entry: [string, string]): TelemetryFilterTuple => {
          return filterOn(entry[0]);
        }),
        { search: "x", rootOnly: true },
        translator(),
      );

      expect(hint).not.toContain("{{");
      expect(hint).not.toContain("}}");
    });
  },
);

describe("in a language with a list separator of its own", () => {
  test.each([
    ["fa", "، "],
    ["ja", "、"],
    ["zh-CN", "、"],
    ["zh-TW", "、"],
  ])("%s lists a hint's filters with %s", (language: string, comma: string) => {
    const hint: string = describeUnappliedScopeFilters(
      [filterOn("hostId"), filterOn("body")],
      undefined,
      translatorFor(language),
    );

    expect(hint).toContain(comma);
    expect(hint).not.toContain(", ");
  });
});

describe("with no translator, the hints read as they always did", () => {
  test("in English, with the labels in order", () => {
    expect(
      describeUnappliedScopeFilters([
        filterOn("severityText"),
        filterOn("attributes.http.route"),
      ]),
    ).toBe(
      "Also filtered in the Viewer, not applied here: severity, attribute http.route",
    );
  });

  test("and say nothing when there is nothing to say", () => {
    expect(describeUnappliedScopeFilters([])).toBe("");
  });
});

describe("what a pivot leaves behind", () => {
  test("names each kind of filter once, however many of them there are", () => {
    const { notCarried } = buildTracesPivotScope(
      pivotInput({
        activeFilters: [
          { facetKey: "attributeSearches.a", value: "1" },
          { facetKey: "attributeSearches.b", value: "2" },
        ],
        searchAttributeSearches: { c: "3" },
      }),
    );

    expect(notCarried).toEqual(["attribute contains-filters"]);
  });

  test("an entity scope the attribute carries is not left behind", () => {
    expect(
      buildTracesPivotScope(
        pivotInput({
          hasEntityScope: true,
          entityScope: { attributeKey: "host.name", attributeValue: "web-1" },
          scopeAttributeFilters: { "host.name": "web-1" },
        }),
      ).notCarried,
    ).toEqual([]);
  });

  test("a stored name for the same filter is the same word as the search box's", () => {
    expect(
      buildTracesPivotScope(
        pivotInput({ freeText: "checkout", fieldFilters: { name: ["GET /"] } }),
      ).notCarried,
    ).toEqual(["span name"]);
  });

  test("nothing to leave behind names nothing", () => {
    expect(buildTracesPivotScope(pivotInput({})).notCarried).toEqual([]);
  });
});

describe("the words the two hints share read the same in each", () => {
  test.each(OTHER_LANGUAGES)("%s", (language: string) => {
    expect(word(language, "root spans only")).toBe(
      word(language, "root-spans-only"),
    );
  });
});
