import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import { i18n } from "i18next";
import * as React from "react";
import { I18nextProvider } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * ---------------------------------------------------------------------------
 * The words Traces shares with the rest of the Dashboard, in every language
 * ---------------------------------------------------------------------------
 *
 * Three words were English on every screen that shows them, and were left
 * alone by the trace view's translation because translating them there alone
 * would have made it disagree with those screens:
 *
 * - the "Unknown Service" stand-in for telemetry that names no service;
 * - the "Unknown" fallback for a resource nothing names;
 * - the span kinds' names, from SpanUtil.
 *
 * They change everywhere at once. A person's own names never do: a service
 * called "Server" stays "Server", and only OneUptime's stand-in is looked up.
 * The stand-in stays English on the synthetic Service and is looked up where
 * it is drawn, so a reader who switches language sees it follow, without a
 * read of the data.
 *
 * The REAL components are mounted under an i18next instance per language,
 * built from the Dashboard's own locale files.
 */

const getListMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrappers are load bearing: jest.mock is hoisted above the
 * compiled requires, so the mock variables above are still unassigned when
 * the factories run.
 */
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        const { default: ObjectIDInFactory } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDInFactory("10000000-0000-4000-8000-000000000001");
      },
      getCurrentProject: () => {
        return null;
      },
    },
  };
});

/*
 * The service map's canvas, as a probe: each node drawn by its node type.
 * React Flow lays nothing out in jsdom.
 */
jest.mock("reactflow", () => {
  const ReactInFactory: typeof React = jest.requireActual(
    "react",
  ) as typeof React;

  const nothing: () => null = (): null => {
    return null;
  };

  return {
    __esModule: true,
    default: (props: any) => {
      return ReactInFactory.createElement(
        "div",
        { "data-testid": "react-flow" },
        ...(props.nodes || []).map((node: any) => {
          return ReactInFactory.createElement(props.nodeTypes[node.type], {
            key: node.id,
            id: node.id,
            data: node.data,
          });
        }),
      );
    },
    Background: nothing,
    Controls: nothing,
    Handle: nothing,
    BackgroundVariant: { Dots: "dots" },
    MarkerType: { ArrowClosed: "arrowclosed" },
    Position: { Top: "top", Bottom: "bottom" },
  };
});

// A tooltip is only in the page while it shows: drawn as a title here.
jest.mock("../../../UI/Components/Tooltip/Tooltip", () => {
  const ReactInFactory: typeof React = jest.requireActual(
    "react",
  ) as typeof React;

  return {
    __esModule: true,
    default: (props: { text?: string; children: React.ReactElement }) => {
      return ReactInFactory.createElement(
        "span",
        { title: props.text },
        props.children,
      );
    },
  };
});

import { displayGroupValue } from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Components/TraceTableData";
import ExceptionResource from "../../../../App/FeatureSet/Dashboard/src/Components/Exceptions/ExceptionResource";
import ServiceElement from "../../../../App/FeatureSet/Dashboard/src/Components/Service/ServiceElement";
import SpanStatusElement from "../../../../App/FeatureSet/Dashboard/src/Components/Span/SpanStatusElement";
import TelemetryServiceElement from "../../../../App/FeatureSet/Dashboard/src/Components/TelemetryService/TelemetryServiceElement";
import FlameGraph from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/FlameGraph";
import TraceServiceMap from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TraceServiceMap";
import {
  SpanEntityDisplay,
  buildTraceAnalyticsValueLabels,
  formatTraceAnalyticsGroupValue,
  getSpanEntityDisplay,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Traces/TracesEntityDisplay";
import SpanUtil from "../../../../App/FeatureSet/Dashboard/src/Utils/SpanUtil";
import { getSpanStatusDisplayLabelMap } from "../../../../App/FeatureSet/Dashboard/src/Utils/SpanStatusPresentation";
import {
  TraceServiceInfo,
  buildServiceInfoMap,
  getServiceInfo,
  summarizeServices,
} from "../../../../App/FeatureSet/Dashboard/src/Utils/TraceDetailPresentation";
import { describeUnappliedScopeFilters } from "../../../../App/FeatureSet/Dashboard/src/Utils/TelemetryTabScope";
import Span, {
  SpanKind,
  SpanStatus,
} from "../../../Models/AnalyticsModels/Span";
import Service from "../../../Models/DatabaseModels/Service";
import Color from "../../../Types/Color";
import ObjectID from "../../../Types/ObjectID";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import TelemetryServiceUtil, {
  UNKNOWN_RESOURCE_LABEL,
  UNKNOWN_SERVICE_NAME,
} from "../../../UI/Utils/TelemetryService";
import TelemetryEntityNameResolver, {
  TelemetryEntityNameMap,
} from "../../../UI/Utils/Telemetry/TelemetryEntityNames";
import useTelemetryEntityNames from "../../../UI/Utils/Telemetry/UseTelemetryEntityNames";
import { Translator, formatList } from "../../../UI/Utils/TranslateTemplate";
import {
  ENGLISH,
  LANGUAGES,
  OTHER_LANGUAGES,
  createLanguageInstances,
  hasOwnWording,
  inLanguage,
  instanceOf,
  sentence,
  textOf,
  translatorFor,
  word,
} from "./TracesLanguageHarness";

jest.setTimeout(180000);

const PROJECT: ObjectID = new ObjectID("10000000-0000-4000-8000-000000000001");
const CHECKOUT: string = "60000000-0000-4000-8000-000000000003";

const KIND_WORDS: Array<string> = [
  "Server",
  "Client",
  "Producer",
  "Consumer",
  "Internal",
];

const STAND_INS: Array<string> = [
  "Unknown Service",
  "Unknown service",
  "unknown service",
  "Unknown",
];

const named: (name: string, id?: string) => Service = (
  name: string,
  id: string = CHECKOUT,
): Service => {
  return Object.assign(new Service(), {
    _id: id,
    name,
    serviceColor: new Color("#6366f1"),
  });
};

const makeSpan: (entityId: string, spanId: string) => Span = (
  entityId: string,
  spanId: string,
): Span => {
  return Object.assign(new Span(), {
    traceId: "4bf92f3577b34da6a3ce929d0e0e4736",
    spanId,
    parentSpanId: "",
    name: `operation-${spanId}`,
    kind: SpanKind.Server,
    statusCode: SpanStatus.Ok,
    primaryEntityId: new ObjectID(entityId),
    startTimeUnixNano: 1_000_000,
    endTimeUnixNano: 2_000_000,
    durationUnixNano: 1_000_000,
  });
};

beforeAll(async () => {
  await createLanguageInstances();
});

beforeEach(() => {
  TelemetryEntityNameResolver.clearCache();
  getListMock.mockImplementation(async () => {
    return { data: [], count: 0, skip: 0, limit: 10 };
  });
});

afterEach(() => {
  cleanup();
  getListMock.mockReset();
});

/*
 * ---------------------------------------------------------------------------
 * The words, in the Dashboard's locales
 * ---------------------------------------------------------------------------
 */

describe("the shared words, in the Dashboard's locales", () => {
  test("each is a key of the Dashboard's English, drawn as itself", () => {
    expect(
      [...KIND_WORDS, ...STAND_INS].filter((english: string): boolean => {
        return ENGLISH[english] !== english;
      }),
    ).toEqual([]);
    expect(UNKNOWN_SERVICE_NAME).toBe("Unknown Service");
    expect(UNKNOWN_RESOURCE_LABEL).toBe("Unknown");
  });

  test.each(OTHER_LANGUAGES)(
    "%s has its own wording for each, or says it as English does on record",
    (language: string) => {
      expect(
        [...KIND_WORDS, ...STAND_INS].filter((english: string): boolean => {
          return !hasOwnWording(language, english);
        }),
      ).toEqual([]);
    },
  );

  test.each(OTHER_LANGUAGES)(
    "%s words the stand-in the same way, however English capitalizes it",
    (language: string) => {
      const forms: Array<string> = [
        "Unknown Service",
        "Unknown service",
        "unknown service",
      ].map((english: string): string => {
        return word(language, english).toLocaleLowerCase(language);
      });

      expect(new Set(forms).size).toBe(1);
    },
  );

  test.each(LANGUAGES)("%s tells the kinds apart", (language: string) => {
    const words: Array<string> = KIND_WORDS.map((english: string): string => {
      return word(language, english).toLocaleLowerCase(language);
    });

    expect(new Set(words).size).toBe(KIND_WORDS.length);
  });
});

/*
 * ---------------------------------------------------------------------------
 * Each screen that shows them, in every language
 * ---------------------------------------------------------------------------
 */

describe.each(LANGUAGES)("the shared words in %s", (language: string) => {
  const translator: () => Translator = (): Translator => {
    return translatorFor(language);
  };

  test("the service elements name the stand-in in the language's words", () => {
    render(
      inLanguage(
        language,
        <MemoryRouter>
          <ServiceElement
            service={TelemetryServiceUtil.getUnknownService(PROJECT)}
          />
          <TelemetryServiceElement
            telemetryService={TelemetryServiceUtil.getUnknownService(PROJECT)}
          />
        </MemoryRouter>,
      ),
    );

    expect(
      screen.getAllByText(word(language, "Unknown Service")),
    ).toHaveLength(2);
    expect(
      screen.getAllByTitle(
        sentence(language, "{{name}} Service Color", {
          name: word(language, "Unknown Service"),
        }),
      ),
    ).toHaveLength(2);
  });

  test("a person's service stays as written, whatever it is called", () => {
    render(
      inLanguage(
        language,
        <MemoryRouter>
          <ServiceElement service={named("Server")} />
          <ServiceElement service={named("Error")} />
        </MemoryRouter>,
      ),
    );

    expect(screen.getByText("Server")).toBeVisible();
    expect(screen.getByText("Error")).toBeVisible();
  });

  test("a span status's tooltip reads in the language", () => {
    render(
      inLanguage(
        language,
        <MemoryRouter>
          <SpanStatusElement spanStatusCode={SpanStatus.Unset} />
        </MemoryRouter>,
      ),
    );

    expect(
      screen.getByRole("img", {
        name: sentence(language, "Span Status: {{status}}", {
          status: word(language, "Unset (no error)"),
        }),
      }),
    ).toBeInTheDocument();
  });

  test("the entity names a page resolves name the stand-in in the language's words", async () => {
    let names: TelemetryEntityNameMap = {};

    const Probe: React.FunctionComponent = (): React.ReactElement => {
      names = useTelemetryEntityNames([PROJECT.toString()]);
      return <></>;
    };

    await act(async () => {
      render(inLanguage(language, <Probe />));
    });

    expect(names[PROJECT.toString()]?.name).toBe(
      word(language, "Unknown Service"),
    );
    expect(names[PROJECT.toString()]?.entityType).toBe(ServiceType.Unknown);
  });

  test("the logs and other lists read names off a map with the stand-in named", () => {
    const person: Service = named("checkout");
    const services: Record<string, Service> = {
      [CHECKOUT]: person,
      [PROJECT.toString()]: TelemetryServiceUtil.getUnknownService(PROJECT),
    };

    const drawn: Record<string, Service> =
      TelemetryServiceUtil.withUnknownServiceNamed(services, translator());

    expect(drawn[PROJECT.toString()]?.name).toBe(
      word(language, "Unknown Service"),
    );
    expect(drawn[CHECKOUT]).toBe(person);
    // What a typed `service:` search reads keeps its English name.
    expect(services[PROJECT.toString()]?.name).toBe(UNKNOWN_SERVICE_NAME);
  });

  test("the trace page's services name a span no service claims, and the stand-in", () => {
    const map: Map<string, TraceServiceInfo> = buildServiceInfoMap(
      [
        named("checkout"),
        TelemetryServiceUtil.getUnknownService(PROJECT),
        named("", "60000000-0000-4000-8000-000000000009"),
      ],
      translator(),
    );

    expect(map.get(CHECKOUT)?.name).toBe("checkout");
    expect(map.get(PROJECT.toString())?.name).toBe(
      word(language, "Unknown Service"),
    );
    expect(map.get("60000000-0000-4000-8000-000000000009")?.name).toBe(
      word(language, "Unknown service"),
    );
    expect(getServiceInfo(map, "no-such-service", translator()).name).toBe(
      word(language, "Unknown service"),
    );
    expect(
      summarizeServices({
        spans: [
          {
            spanId: "a",
            parentSpanId: "",
            name: "a",
            serviceId: "no-such-service",
            startTimeUnixNano: 0,
            endTimeUnixNano: 1,
            durationUnixNano: 1,
            isError: false,
            kind: SpanKind.Internal,
          },
        ],
        selfTimes: new Map(),
        serviceInfoById: map,
        translator: translator(),
      })[0]?.name,
    ).toBe(word(language, "Unknown service"));
  });

  test("the flame graph says what it cannot name, and the stand-in", () => {
    render(
      inLanguage(
        language,
        <FlameGraph
          spans={[
            makeSpan("60000000-0000-4000-8000-00000000dead", "nobody"),
            makeSpan(PROJECT.toString(), "unattributed"),
            makeSpan(CHECKOUT, "person"),
          ]}
          telemetryServices={[
            named("checkout"),
            Object.assign(TelemetryServiceUtil.getUnknownService(PROJECT), {
              _id: PROJECT.toString(),
            }),
          ]}
          selectedSpanId={undefined}
        />,
      ),
    );

    expect(screen.getByTitle(/^operation-nobody/).getAttribute("title")).toContain(
      `(${word(language, "Unknown")})`,
    );
    expect(
      screen.getByTitle(/^operation-unattributed/).getAttribute("title"),
    ).toContain(`(${word(language, "Unknown Service")})`);
    expect(screen.getByTitle(/^operation-person/).getAttribute("title")).toContain(
      "(checkout)",
    );
  });

  test("the service map says what it cannot name", () => {
    render(
      inLanguage(
        language,
        <TraceServiceMap
          spans={[makeSpan("60000000-0000-4000-8000-00000000dead", "nobody")]}
          telemetryServices={[named("checkout")]}
        />,
      ),
    );

    expect(textOf(screen.getByTestId("react-flow"))).toContain(
      word(language, "Unknown"),
    );
  });

  test("an exception's resource says what kind of telemetry it is", () => {
    render(
      inLanguage(
        language,
        <MemoryRouter>
          <ExceptionResource
            primaryEntityId={new ObjectID(CHECKOUT)}
            primaryEntityType={ServiceType.Host}
            services={[]}
          />
        </MemoryRouter>,
      ),
    );

    expect(screen.getByTestId("exception-resource")).toHaveTextContent(
      word(language, "Host telemetry"),
    );
  });

  test("a span row's entity reads the stand-in and its type in the language's words", () => {
    const nothing: SpanEntityDisplay = getSpanEntityDisplay({
      translator: translator(),
    });

    expect(nothing.name).toBe(word(language, "unknown service"));
    expect(nothing.typeLabel).toBe(word(language, "Service"));

    expect(
      getSpanEntityDisplay({
        service: named("Server"),
        translator: translator(),
      }).name,
    ).toBe("Server");
    expect(
      getSpanEntityDisplay({
        service: TelemetryServiceUtil.getUnknownService(PROJECT),
        translator: translator(),
      }).name,
    ).toBe(word(language, "Unknown Service"));
  });

  test("every kind's name reads the same wherever it is drawn", () => {
    const names: Record<string, string> = SpanUtil.getSpanKindNameMap(
      translator(),
    );

    expect(names[SpanKind.Server]).toBe(word(language, "Server"));
    expect(names[SpanKind.Consumer]).toBe(word(language, "Consumer"));
    expect(
      SpanUtil.getSpanKindFriendlyName(SpanKind.Producer, translator()),
    ).toBe(word(language, "Producer"));
    // By default spans are always internal.
    expect(
      SpanUtil.getSpanKindFriendlyName(
        "SPAN_KIND_UNSPECIFIED" as SpanKind,
        translator(),
      ),
    ).toBe(word(language, "Internal"));

    // The analytics view's groups.
    expect(
      formatTraceAnalyticsGroupValue({
        key: "kind",
        raw: SpanKind.Client,
        serviceNameMap: {},
        translator: translator(),
      }),
    ).toBe(word(language, "Client"));
    expect(
      buildTraceAnalyticsValueLabels({
        key: "kind",
        values: [SpanKind.Internal],
        serviceNameMap: {},
        translator: translator(),
      }).get(SpanKind.Internal),
    ).toBe(word(language, "Internal"));

    // The dashboards' trace table, which reads OpenTelemetry's numbers.
    expect(displayGroupValue("kind", "2", translator())).toBe(
      word(language, "Server"),
    );
    expect(displayGroupValue("kind", "0", translator())).toBe(
      word(language, "Unspecified"),
    );
  });

  test("a status and an empty group read the same wherever they are drawn", () => {
    expect(getSpanStatusDisplayLabelMap(translator())["2"]).toBe(
      word(language, "Error"),
    );
    expect(displayGroupValue("statusCode", "0", translator())).toBe(
      word(language, "Unset (no error)"),
    );
    expect(displayGroupValue("name", "", translator())).toBe(
      word(language, "(empty)"),
    );
    expect(
      formatTraceAnalyticsGroupValue({
        key: "statusCode",
        raw: "1",
        serviceNameMap: {},
        translator: translator(),
      }),
    ).toBe(word(language, "Ok"));
    // A value of a person's own stays as written.
    expect(
      formatTraceAnalyticsGroupValue({
        key: "name",
        raw: "Server",
        serviceNameMap: {},
        translator: translator(),
      }),
    ).toBe("Server");
  });

  test("the hint on every Insights tab lists what it does not apply in the language's words", () => {
    expect(
      describeUnappliedScopeFilters(
        [
          ["severityText", ["Error"]],
          ["attributes.http.route", ["/orders"]],
        ],
        { search: "checkout", spanType: undefined },
        translator(),
      ),
    ).toBe(
      sentence(
        language,
        "Also filtered in the Viewer, not applied here: {{filters}}",
        {
          filters: formatList(
            [
              translator().translateTerm("severity", { inSentence: true }),
              translator().translateTemplate("attribute {{name}}", {
                name: "http.route",
              }),
              translator().translateTerm("search text", { inSentence: true }),
            ],
            translator(),
          ),
        },
      ),
    );
  });
});

describe("a language switch while the data is loaded", () => {
  test("the stand-in follows the reader with no new read", async () => {
    const service: Service = TelemetryServiceUtil.getUnknownService(PROJECT);
    let names: TelemetryEntityNameMap = {};

    const Page: React.FunctionComponent = (): React.ReactElement => {
      names = useTelemetryEntityNames([PROJECT.toString()]);

      return (
        <MemoryRouter>
          <ServiceElement service={service} />
        </MemoryRouter>
      );
    };

    // One reader, on one instance, who starts in English.
    const language: i18n = instanceOf("de");
    await language.changeLanguage("en");

    await act(async () => {
      render(
        <I18nextProvider i18n={language}>
          <Page />
        </I18nextProvider>,
      );
    });

    expect(screen.getByText("Unknown Service")).toBeVisible();
    expect(names[PROJECT.toString()]?.name).toBe("Unknown Service");

    await act(async () => {
      await language.changeLanguage("de");
    });

    expect(screen.getByText(word("de", "Unknown Service"))).toBeVisible();
    expect(screen.queryByText("Unknown Service")).toBeNull();
    expect(names[PROJECT.toString()]?.name).toBe(
      word("de", "Unknown Service"),
    );
    // The Service itself still says the English the lookups key on.
    expect(service.name).toBe(UNKNOWN_SERVICE_NAME);
  });
});

describe("REGRESSION: the shared words were English in every language", () => {
  test("German reads its own stand-ins, and English reads as it always did", () => {
    expect(word("de", "Unknown Service")).not.toBe("Unknown Service");
    expect(word("de", "Unknown")).not.toBe("Unknown");
    expect(word("de", "Internal")).not.toBe("Internal");

    expect(SpanUtil.getSpanKindFriendlyName(SpanKind.Server)).toBe("Server");
    expect(SpanUtil.getSpanKindFriendlyName(SpanKind.Client)).toBe("Client");
    expect(getSpanEntityDisplay({}).name).toBe("unknown service");
    expect(TelemetryServiceUtil.getUnknownService(PROJECT).name).toBe(
      "Unknown Service",
    );
  });

  test("a list reads each language's separator", () => {
    const list: Array<string> = ["a", "b", "c"];

    expect(formatList(list, translatorFor("en"))).toBe("a, b, c");
    expect(formatList(list, translatorFor("de"))).toBe("a, b, c");
    expect(formatList(list, translatorFor("ja"))).toBe("a、b、c");
    expect(formatList(list, translatorFor("zh-TW"))).toBe("a、b、c");
    expect(formatList(list, translatorFor("fa"))).toBe("a، b، c");
    expect(formatList(["a"], translatorFor("ja"))).toBe("a");
    expect(formatList([], translatorFor("en"))).toBe("");
  });

  test("a table's row of its own names a service by its element", () => {
    render(
      inLanguage(
        "de",
        <MemoryRouter>
          <div data-testid="row">
            <ServiceElement
              service={TelemetryServiceUtil.getUnknownService(PROJECT)}
            />
          </div>
        </MemoryRouter>,
      ),
    );

    // The stand-in has no page of its own: it is text, not a link.
    expect(within(screen.getByTestId("row")).queryByRole("link")).toBeNull();
  });
});
