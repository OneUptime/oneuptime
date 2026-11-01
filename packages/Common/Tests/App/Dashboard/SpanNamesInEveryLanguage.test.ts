import { beforeAll, describe, expect, test } from "@jest/globals";
import { formatTraceSeriesLabel } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/TraceChartData";
import { displayGroupValue } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/TraceTableData";
import {
  TRACE_ANALYTICS_EMPTY_GROUP_LABEL,
  TRACE_ANALYTICS_KIND_LABEL,
  TRACE_ANALYTICS_STATUS_LABEL,
  formatTraceAnalyticsGroupValue,
  getTraceAnalyticsGroupTypeLabel,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TracesEntityDisplay";
import {
  SPAN_STATUS_PRESENTATIONS,
  SpanStatusPresentation,
  getSpanStatusDisplayLabelMap,
  getSpanStatusPresentation,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/SpanStatusPresentation";
import SpanUtil from "../../../../App/FeatureSet/Dashboard/src/Utils/SpanUtil";
import { SpanKind, SpanStatus } from "../../../Models/AnalyticsModels/Span";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import {
  TRACE_SPAN_TYPE_OPTIONS,
  TraceSpanType,
  TraceSpanTypeOption,
  getTraceSpanTypeEmptyMessage,
  getTraceSpanTypeLabel,
} from "../../../Types/Telemetry/TraceSpanType";
import { Translator } from "../../../UI/Utils/TranslateTemplate";
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
 * What a span's kind, status and type are called, wherever they are drawn
 * ---------------------------------------------------------------------------
 *
 * Every screen names a kind or a status from one of these helpers, so a
 * language words each once. They are held here on what a span can store and on
 * what it cannot: a value nothing names is shown as stored, a value a person's
 * telemetry wrote stays as written, and with no translator (what a test or a
 * URL builder asks for) the helpers read as they always did.
 */

const KIND_NAMES: Array<[SpanKind, string]> = [
  [SpanKind.Server, "Server"],
  [SpanKind.Client, "Client"],
  [SpanKind.Producer, "Producer"],
  [SpanKind.Consumer, "Consumer"],
  [SpanKind.Internal, "Internal"],
];

// The numbers a table widget groups a span's kind by.
const KIND_GROUP_VALUES: Array<[string, string]> = [
  ["0", "Unspecified"],
  ["1", "Internal"],
  ["2", "Server"],
  ["3", "Client"],
  ["4", "Producer"],
  ["5", "Consumer"],
];

const STATUS_NAMES: Array<[string, string]> = [
  [String(SpanStatus.Unset), "Unset (no error)"],
  [String(SpanStatus.Ok), "Ok"],
  [String(SpanStatus.Error), "Error"],
];

const VALUE_PIECES: ReadonlyArray<string> = [
  "Error",
  "Server",
  "Ok",
  "0",
  "1",
  " ",
  "/",
  "{{count}}",
  "$&",
  "<b>",
  "Fehler",
  "未知",
  "‏",
];

beforeAll(async () => {
  await createLanguageInstances();
});

describe("a span kind's name", () => {
  test("every kind a span can store has a name", () => {
    expect(
      KIND_NAMES.map((entry: [SpanKind, string]): SpanKind => {
        return entry[0];
      }).sort(),
    ).toEqual([...Object.values(SpanKind)].sort());
  });

  test.each(KIND_NAMES)(
    "%s is called %s with no translator",
    (kind: SpanKind, name: string) => {
      expect(SpanUtil.getSpanKindFriendlyName(kind)).toBe(name);
    },
  );

  test.each(KIND_NAMES)(
    "%s's name, %s, is a key of the Dashboard's English",
    (_kind: SpanKind, name: string) => {
      expect(ENGLISH[name]).toBe(name);
    },
  );

  test("a kind this version does not know reads as Internal, as it always did", () => {
    expect(SpanUtil.getSpanKindFriendlyName("SPAN_KIND_NEW" as SpanKind)).toBe(
      "Internal",
    );
  });

  test("the name map has each stored value and nothing else", () => {
    expect(Object.keys(SpanUtil.getSpanKindNameMap()).sort()).toEqual(
      [...Object.values(SpanKind)].sort(),
    );
  });

  test("the analytics view's labels are the same names", () => {
    expect(TRACE_ANALYTICS_KIND_LABEL).toEqual(SpanUtil.getSpanKindNameMap());
  });
});

describe("a span status's name", () => {
  test("is English with no translator, by the value a facet stores", () => {
    expect(getSpanStatusDisplayLabelMap()).toEqual(
      Object.fromEntries(STATUS_NAMES),
    );
  });

  test("the analytics view's labels are the same names", () => {
    expect(TRACE_ANALYTICS_STATUS_LABEL).toEqual(
      getSpanStatusDisplayLabelMap(),
    );
  });

  test.each([undefined, null, "", "nonsense", 99, -1])(
    "%j is read as Unset, in the map's words",
    (status: string | number | null | undefined) => {
      expect(getSpanStatusPresentation(status).displayLabel).toBe(
        getSpanStatusPresentation(SpanStatus.Unset).displayLabel,
      );
    },
  );

  test("every word a status draws is a key of the Dashboard's English", () => {
    for (const presentation of SPAN_STATUS_PRESENTATIONS) {
      for (const key of [
        presentation.label,
        presentation.displayLabel,
        presentation.description,
        presentation.dotTooltip,
        presentation.plainDotTooltip,
      ]) {
        expect(ENGLISH[key]).toBe(key);
      }
    }
  });

  test.each(OTHER_LANGUAGES)(
    "%s words each status's name, hover text and dot",
    (language: string) => {
      const missing: Array<string> = SPAN_STATUS_PRESENTATIONS.flatMap(
        (presentation: SpanStatusPresentation): Array<string> => {
          return [
            presentation.label,
            presentation.displayLabel,
            presentation.description,
            presentation.dotTooltip,
            presentation.plainDotTooltip,
          ];
        },
      ).filter((key: string): boolean => {
        return !hasOwnWording(language, key);
      });

      expect(missing).toEqual([]);
    },
  );

  test("only Unset's dot adds that it is no error: the other two have nothing to add", () => {
    const unset: SpanStatusPresentation = getSpanStatusPresentation(
      SpanStatus.Unset,
    );

    expect(unset.dotTooltip).toBe("Span Status: Unset (no error)");
    expect(unset.plainDotTooltip).toBe("Span Status: Unset");

    for (const status of [SpanStatus.Ok, SpanStatus.Error]) {
      const presentation: SpanStatusPresentation =
        getSpanStatusPresentation(status);

      expect(presentation.dotTooltip).toBe(presentation.plainDotTooltip);
    }
  });
});

describe("the Span Type choice", () => {
  test("an empty list of root spans says so, and of anything else says entry spans", () => {
    expect(getTraceSpanTypeEmptyMessage(TraceSpanType.Root)).toBe(
      "No root spans found",
    );
    expect(getTraceSpanTypeEmptyMessage(TraceSpanType.Entry)).toBe(
      "No entry spans found",
    );
  });

  test("the choices' names are not keys: they read as written in every language", () => {
    for (const option of TRACE_SPAN_TYPE_OPTIONS) {
      expect(getTraceSpanTypeLabel(option.value)).toBe(option.label);
      expect(ENGLISH[option.label]).toBeUndefined();
    }
  });

  test("what each choice is, is a key of the Dashboard's English", () => {
    TRACE_SPAN_TYPE_OPTIONS.forEach((option: TraceSpanTypeOption) => {
      expect(ENGLISH[option.description]).toBe(option.description);
    });
  });

  test.each(OTHER_LANGUAGES)(
    "%s quotes each choice's name as the sidebar draws it",
    (language: string) => {
      expect(
        word(language, getTraceSpanTypeEmptyMessage(TraceSpanType.Root)),
      ).toContain("Root spans");
      expect(
        word(language, getTraceSpanTypeEmptyMessage(TraceSpanType.Entry)),
      ).toContain("Entry spans");
    },
  );

  test.each(OTHER_LANGUAGES)(
    "%s words what each choice is",
    (language: string) => {
      for (const option of TRACE_SPAN_TYPE_OPTIONS) {
        expect(hasOwnWording(language, option.description)).toBe(true);
      }
    },
  );
});

describe.each(LANGUAGES)("span words in %s", (language: string) => {
  const translator: () => Translator = (): Translator => {
    return translatorFor(language);
  };

  test.each(KIND_NAMES)(
    "%s reads as the locale words %s",
    (kind: SpanKind, name: string) => {
      expect(SpanUtil.getSpanKindFriendlyName(kind, translator())).toBe(
        word(language, name),
      );
    },
  );

  test("a kind this version does not know reads as Internal does", () => {
    expect(
      SpanUtil.getSpanKindFriendlyName(
        "SPAN_KIND_NEW" as SpanKind,
        translator(),
      ),
    ).toBe(word(language, "Internal"));
  });

  test("the kind map and the kind's name agree, for every kind", () => {
    const names: Record<string, string> =
      SpanUtil.getSpanKindNameMap(translator());

    for (const kind of Object.values(SpanKind)) {
      expect(names[kind]).toBe(
        SpanUtil.getSpanKindFriendlyName(kind, translator()),
      );
    }
  });

  test("the status map and each status's own word agree", () => {
    expect(getSpanStatusDisplayLabelMap(translator())).toEqual(
      Object.fromEntries(
        SPAN_STATUS_PRESENTATIONS.map(
          (presentation: SpanStatusPresentation): [string, string] => {
            return [
              String(presentation.status),
              word(language, presentation.displayLabel),
            ];
          },
        ),
      ),
    );
  });

  describe("a table widget's group", () => {
    test.each(STATUS_NAMES)(
      "status %s reads as the locale words %s",
      (raw: string, name: string) => {
        expect(displayGroupValue("statusCode", raw, translator())).toBe(
          word(language, name),
        );
      },
    );

    test.each(KIND_GROUP_VALUES)(
      "kind %s reads as the locale words %s",
      (raw: string, name: string) => {
        expect(displayGroupValue("kind", raw, translator())).toBe(
          word(language, name),
        );
      },
    );

    test("an empty group says so in the language's words", () => {
      expect(displayGroupValue("statusCode", "", translator())).toBe(
        word(language, "(empty)"),
      );
      expect(displayGroupValue("http.route", "", translator())).toBe(
        word(language, "(empty)"),
      );
    });

    test("a status or kind nothing names is shown as stored", () => {
      expect(displayGroupValue("statusCode", "7", translator())).toBe("7");
      expect(displayGroupValue("kind", "9", translator())).toBe("9");
    });

    test("a value of a person's own attribute stays as written, whatever it spells", () => {
      for (const value of generatedTexts(1500, 5473, VALUE_PIECES, 4)) {
        const expected: string = value ? value : word(language, "(empty)");
        const drawn: string = displayGroupValue(
          "http.route",
          value,
          translator(),
        );

        if (drawn !== expected) {
          throw new Error(`${JSON.stringify(value)} drew ${drawn}`);
        }
      }
    });

    test("a span's name group is a person's own, even if it spells a status", () => {
      expect(displayGroupValue("name", "Error", translator())).toBe("Error");
      expect(displayGroupValue("name", "2", translator())).toBe("2");
    });
  });

  describe("a chart widget's series", () => {
    test.each(STATUS_NAMES)(
      "status %s, split by status, reads as the locale words %s",
      (raw: string, name: string) => {
        expect(formatTraceSeriesLabel(raw, "statusCode", translator())).toBe(
          word(language, name),
        );
      },
    );

    test("a split with spaces around it is still the status split", () => {
      expect(formatTraceSeriesLabel("2", " statusCode ", translator())).toBe(
        word(language, "Error"),
      );
    });

    test("a series split by anything else stays as written, even if it spells a status", () => {
      expect(formatTraceSeriesLabel("2", "http.status", translator())).toBe(
        "2",
      );
      expect(formatTraceSeriesLabel("Error", "name", translator())).toBe(
        "Error",
      );
      expect(formatTraceSeriesLabel("2", undefined, translator())).toBe("2");
    });

    test("a status split's other keys stay as written", () => {
      expect(formatTraceSeriesLabel("7", "statusCode", translator())).toBe("7");
    });
  });

  describe("an analytics group", () => {
    const group: (key: string, raw: string) => string = (
      key: string,
      raw: string,
    ): string => {
      return formatTraceAnalyticsGroupValue({
        key,
        raw,
        serviceNameMap: { "service-id": "checkout-api" },
        entityNames: {
          "entity-id": {
            id: "entity-id",
            name: "web-1",
            entityType: ServiceType.Host,
            typeLabel: "Host",
          },
        },
        translator: translator(),
      });
    };

    test.each(STATUS_NAMES)(
      "status %s reads as the locale words %s",
      (raw: string, name: string) => {
        expect(group("statusCode", raw)).toBe(word(language, name));
      },
    );

    test.each(KIND_NAMES)(
      "kind %s reads in the language's words",
      (kind: SpanKind, name: string) => {
        expect(group("kind", kind)).toBe(word(language, name));
      },
    );

    test("an empty group says so in the language's words", () => {
      expect(group("statusCode", "")).toBe(
        word(language, TRACE_ANALYTICS_EMPTY_GROUP_LABEL),
      );
      expect(group("http.route", "")).toBe(
        word(language, TRACE_ANALYTICS_EMPTY_GROUP_LABEL),
      );
    });

    test("a status or kind nothing names is shown as stored", () => {
      expect(group("statusCode", "7")).toBe("7");
      expect(group("kind", "SPAN_KIND_NEW")).toBe("SPAN_KIND_NEW");
    });

    test("a service's and an entity's names stay as written", () => {
      expect(group("primaryEntityId", "service-id")).toBe("checkout-api");
      expect(group("primaryEntityId", "entity-id")).toBe("web-1");
    });

    test("a person's own attribute stays as written", () => {
      expect(group("http.route", "Error")).toBe("Error");
    });

    test("the type beside an entity's name reads in the language's words", () => {
      const typeOf: (raw: string) => string | undefined = (
        raw: string,
      ): string | undefined => {
        return getTraceAnalyticsGroupTypeLabel({
          key: "primaryEntityId",
          raw,
          serviceNameMap: { "service-id": "checkout-api" },
          entityNames: {
            "10000000-0000-4000-8000-000000000001": {
              id: "10000000-0000-4000-8000-000000000001",
              name: "web-1",
              entityType: ServiceType.Host,
              typeLabel: "Host",
            },
          },
          translator: translator(),
        });
      };

      expect(typeOf("service-id")).toBe(word(language, "Service"));
      expect(typeOf("10000000-0000-4000-8000-000000000001")).toBe(
        word(language, "Host"),
      );
      // A name the server swapped in for an id: a Service's.
      expect(typeOf("checkout-api")).toBe(word(language, "Service"));
      // An id nothing resolves has no known type, and needs none.
      expect(typeOf("20000000-0000-4000-8000-000000000002")).toBeUndefined();
      expect(typeOf("")).toBeUndefined();
    });

    test("only an entity dimension has a type", () => {
      expect(
        getTraceAnalyticsGroupTypeLabel({
          key: "statusCode",
          raw: "2",
          serviceNameMap: {},
          translator: translator(),
        }),
      ).toBeUndefined();
    });
  });
});

describe("with no translator, the helpers read as they always did", () => {
  test("a table widget's groups", () => {
    expect(displayGroupValue("statusCode", "2")).toBe(
      getSpanStatusPresentation(SpanStatus.Error).displayLabel,
    );
    expect(displayGroupValue("kind", "2")).toBe("Server");
    expect(displayGroupValue("kind", "")).toBe("(empty)");
  });

  test("a chart widget's series", () => {
    expect(formatTraceSeriesLabel("2", "statusCode")).toBe(
      getSpanStatusPresentation(SpanStatus.Error).displayLabel,
    );
  });

  test("an analytics group", () => {
    expect(
      formatTraceAnalyticsGroupValue({
        key: "kind",
        raw: SpanKind.Server,
        serviceNameMap: {},
      }),
    ).toBe("Server");
    expect(
      formatTraceAnalyticsGroupValue({
        key: "statusCode",
        raw: "",
        serviceNameMap: {},
      }),
    ).toBe("(empty)");
    expect(
      getTraceAnalyticsGroupTypeLabel({
        key: "primaryEntityId",
        raw: "checkout-api",
        serviceNameMap: {},
      }),
    ).toBe("Service");
  });
});
