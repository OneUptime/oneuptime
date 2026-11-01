import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { i18n } from "i18next";
import React from "react";
import { I18nextProvider } from "react-i18next";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * ---------------------------------------------------------------------------
 * Logs that name no service, in every language
 * ---------------------------------------------------------------------------
 *
 * The logs viewer reads names off one map in many places: the rows, the details
 * panel, the sidebar and the search box's suggestions. It keeps two copies of
 * that map on purpose:
 *
 * - the one it loaded says "Unknown Service" in English, whatever the language,
 *   because a typed `service:` search and a language switch both depend on it;
 * - the one it draws from has the stand-in in the reader's language.
 *
 * Mixing the two up fails quietly: a German reader sees English, or a typed
 * search stops finding what it found yesterday. Both are held here through the
 * real LogsViewer, with the network faked per table.
 */

const SETTLE: { timeout: number } = { timeout: 30000 };
jest.setTimeout(300000);

const getListMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
      getCommonHeaders: () => {
        return {};
      },
    },
  };
});

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return postMock(...args);
      },
      getFriendlyErrorMessage: (error: Error) => {
        return error.message;
      },
      getFriendlyMessage: (error: Error) => {
        return error.message;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        const ObjectIDActual: new (id: string) => unknown = (
          jest.requireActual("../../../Types/ObjectID") as {
            default: new (id: string) => unknown;
          }
        ).default;

        return new ObjectIDActual("9e1b6b0e-0000-4000-8000-000000000001");
      },
    },
  };
});

import LogsViewer from "../../../UI/Components/LogsViewer/LogsViewer";
import TelemetryEntityNameResolver from "../../../UI/Utils/Telemetry/TelemetryEntityNames";
import Log from "../../../Models/AnalyticsModels/Log";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Service from "../../../Models/DatabaseModels/Service";
import Color from "../../../Types/Color";
import LogSeverity from "../../../Types/Log/LogSeverity";
import ObjectID from "../../../Types/ObjectID";
import {
  LANGUAGES,
  OTHER_LANGUAGES,
  PSEUDO_LANGUAGE,
  createLanguageInstances,
  inLanguage,
  instanceOf,
  word,
} from "./TracesLanguageHarness";

const PROJECT_ID: string = "9e1b6b0e-0000-4000-8000-000000000001";
const SERVICE_ID: string = "11111111-0000-4000-8000-000000000001";
const NAMED_ROW_ID: string = "11111111-0000-4000-8000-000000000002";

const STAND_IN: string = "Unknown Service";

const ROW_COLOR: Color = new Color("#7c3aed");

// How jsdom reads the row color back from an inline style.
const ROW_COLOR_RGB: string = "rgb(124, 58, 237)";

type ModelType = { new (): BaseModel };

interface GetListArgs {
  modelType: ModelType;
}

const makeService: (id: string, name: string, color?: Color) => Service = (
  id: string,
  name: string,
  color?: Color,
): Service => {
  const service: Service = new Service();
  service.id = new ObjectID(id);
  service.name = name;

  if (color) {
    service.serviceColor = color;
  }

  return service;
};

const makeLog: (id: string, primaryEntityId: string, body: string) => Log = (
  id: string,
  primaryEntityId: string,
  body: string,
): Log => {
  const log: Log = new Log();
  log.setColumnValue("_id", id);
  log.primaryEntityId = new ObjectID(primaryEntityId);
  log.body = body;
  log.time = new Date("2026-08-10T10:15:00.000Z");
  log.severityText = LogSeverity.Information;
  return log;
};

// What the project holds: a Service row of the stand-in's name is opted into.
let projectServices: Array<Service> = [];

const servicesRead: () => number = (): number => {
  return getListMock.mock.calls.filter((call: Array<unknown>): boolean => {
    return (call[0] as GetListArgs).modelType === Service;
  }).length;
};

// The Service column of the row that holds this log's body.
const serviceCellOf: (body: string) => HTMLElement = (
  body: string,
): HTMLElement => {
  const row: HTMLElement | null = screen.getByText(body).closest("tr");

  expect(row).not.toBeNull();

  const dot: HTMLElement | null = (row as HTMLElement).querySelector(
    'span[aria-hidden="true"][style*="background-color"]',
  );

  expect(dot).not.toBeNull();

  return (dot as HTMLElement).parentElement as HTMLElement;
};

const serviceNameOf: (body: string) => string = (body: string): string => {
  return serviceCellOf(body).textContent || "";
};

const serviceDotOf: (body: string) => HTMLElement = (
  body: string,
): HTMLElement => {
  return serviceCellOf(body).firstElementChild as HTMLElement;
};

/*
 * The viewer shows a page loader until its preload resolves; the logs table
 * only mounts after.
 */
const waitForViewer: () => Promise<void> = async (): Promise<void> => {
  await waitFor(() => {
    expect(document.querySelector("table")).not.toBeNull();
  }, SETTLE);
};

const renderViewer: (
  language: string,
  logs: Array<Log>,
  extra?: Partial<React.ComponentProps<typeof LogsViewer>>,
) => Promise<void> = async (
  language: string,
  logs: Array<Log>,
  extra: Partial<React.ComponentProps<typeof LogsViewer>> = {},
): Promise<void> => {
  render(
    inLanguage(
      language,
      <LogsViewer
        logs={logs}
        isLoading={false}
        filterData={{}}
        onFilterChanged={jest.fn()}
        {...extra}
      />,
    ),
  );

  await waitForViewer();
};

// What the search box does on Enter with what a person typed.
const typeAndSubmit: (query: string) => void = (query: string): void => {
  const input: HTMLElement = screen.getAllByRole("textbox")[0] as HTMLElement;

  fireEvent.change(input, { target: { value: query } });
  fireEvent.keyDown(input, { key: "Enter" });
};

beforeAll(async () => {
  await createLanguageInstances();
});

beforeEach(() => {
  TelemetryEntityNameResolver.clearCache();
  getListMock.mockReset();
  postMock.mockReset();
  projectServices = [makeService(SERVICE_ID, "checkout-api", ROW_COLOR)];

  getListMock.mockImplementation((...args: Array<unknown>) => {
    const request: GetListArgs = args[0] as GetListArgs;
    const data: Array<BaseModel> =
      request.modelType === Service ? projectServices : [];

    return Promise.resolve({ data, count: data.length, skip: 0, limit: 100 });
  });

  postMock.mockImplementation(() => {
    return Promise.resolve({ data: {} });
  });
});

afterEach(() => {
  cleanup();
});

describe.each(LANGUAGES)(
  "logs that name no service in %s",
  (language: string) => {
    test("a row names the stand-in in the language's words", async () => {
      await renderViewer(language, [
        makeLog("log-1", PROJECT_ID, "no service"),
      ]);

      await waitFor(() => {
        expect(serviceNameOf("no service")).toBe(word(language, STAND_IN));
      }, SETTLE);
    });

    test("a row's own service stays as written, in its own color", async () => {
      await renderViewer(language, [
        makeLog("log-1", SERVICE_ID, "from checkout"),
      ]);

      await waitFor(() => {
        expect(serviceNameOf("from checkout")).toBe("checkout-api");
      }, SETTLE);
      expect(serviceDotOf("from checkout").style.backgroundColor).toBe(
        ROW_COLOR_RGB,
      );
    });

    test("REGRESSION: a Service row of that name is named too, and keeps its color", async () => {
      projectServices.push(makeService(NAMED_ROW_ID, STAND_IN, ROW_COLOR));

      await renderViewer(language, [
        makeLog("log-1", NAMED_ROW_ID, "from the row"),
      ]);

      await waitFor(() => {
        expect(serviceNameOf("from the row")).toBe(word(language, STAND_IN));
      }, SETTLE);
      expect(serviceDotOf("from the row").style.backgroundColor).toBe(
        ROW_COLOR_RGB,
      );
    });

    test("the sidebar's Service facet names the stand-in in the language's words", async () => {
      await renderViewer(language, [], {
        showFilters: true,
        facetData: {
          primaryEntityId: [
            { value: PROJECT_ID, count: 4 },
            { value: SERVICE_ID, count: 2 },
          ],
        },
      });

      await waitFor(() => {
        expect(
          screen.getAllByText(word(language, STAND_IN)).length,
        ).toBeGreaterThan(0);
      }, SETTLE);
      expect(screen.getByText("checkout-api")).toBeInTheDocument();
    });

    /*
     * The search box splits on spaces, in English too: a reader types the name's
     * first word, and the one suggestion it leaves is what Enter takes.
     */
    test("a typed search finds the stand-in by the language's own word", async () => {
      const onFieldValueSelect: MockFunction = getJestMockFunction();

      await renderViewer(language, [], {
        showFilters: true,
        valueSuggestions: { primaryEntityId: [PROJECT_ID, SERVICE_ID] },
        onFieldValueSelect: onFieldValueSelect as never,
      });

      typeAndSubmit(`service:${word(language, STAND_IN).split(/\s+/)[0]}`);

      expect(onFieldValueSelect).toHaveBeenCalledWith("service", PROJECT_ID);
    });

    test("a typed search for a person's service still finds it", async () => {
      const onFieldValueSelect: MockFunction = getJestMockFunction();

      await renderViewer(language, [], {
        showFilters: true,
        valueSuggestions: { primaryEntityId: [PROJECT_ID, SERVICE_ID] },
        onFieldValueSelect: onFieldValueSelect as never,
      });

      typeAndSubmit("service:checkout-api");

      expect(onFieldValueSelect).toHaveBeenCalledWith("service", SERVICE_ID);
    });
  },
);

describe.each(OTHER_LANGUAGES)("in %s", (language: string) => {
  test("a search written in English still finds the stand-in: it worked before the language did", async () => {
    const onFilterChanged: MockFunction = getJestMockFunction();

    await renderViewer(language, [], {
      showFilters: true,
      onFilterChanged: onFilterChanged as never,
    });

    typeAndSubmit(`service:"${STAND_IN}"`);

    await waitFor(() => {
      expect(onFilterChanged).toHaveBeenCalled();
    }, SETTLE);

    const filter: Record<string, unknown> = onFilterChanged.mock.calls[
      onFilterChanged.mock.calls.length - 1
    ]?.[0] as Record<string, unknown>;

    expect(filter["primaryEntityId"]).toBe(PROJECT_ID);
  });
});

describe("a language switch while the logs are on screen", () => {
  test("the stand-in follows the reader with no new read of the services", async () => {
    const language: i18n = instanceOf("de");
    await language.changeLanguage("en");

    render(
      <I18nextProvider i18n={language}>
        <LogsViewer
          logs={[makeLog("log-1", PROJECT_ID, "no service")]}
          isLoading={false}
          filterData={{}}
          onFilterChanged={jest.fn()}
        />
      </I18nextProvider>,
    );

    await waitForViewer();

    await waitFor(() => {
      expect(serviceNameOf("no service")).toBe(STAND_IN);
    }, SETTLE);

    const reads: number = servicesRead();

    await act(async () => {
      await language.changeLanguage("de");
    });

    await waitFor(() => {
      expect(serviceNameOf("no service")).toBe(word("de", STAND_IN));
    }, SETTLE);

    await act(async () => {
      await language.changeLanguage("en");
    });

    await waitFor(() => {
      expect(serviceNameOf("no service")).toBe(STAND_IN);
    }, SETTLE);

    expect(servicesRead()).toBe(reads);

    // The instance is the German reader's for the suites after this one.
    await language.changeLanguage("de");
  });
});

describe("in a language that marks every key", () => {
  test("a row's stand-in went through the lookup, and a person's service did not", async () => {
    await renderViewer(PSEUDO_LANGUAGE, [
      makeLog("log-1", PROJECT_ID, "no service"),
      makeLog("log-2", SERVICE_ID, "from checkout"),
    ]);

    await waitFor(() => {
      expect(serviceNameOf("no service")).toMatch(/^⟦.+⟧$/u);
    }, SETTLE);
    expect(serviceNameOf("from checkout")).toBe("checkout-api");
  });
});

describe("REGRESSION: the logs drew the stand-in in English in every language", () => {
  test("English reads as it always did", async () => {
    await renderViewer("en", [makeLog("log-1", PROJECT_ID, "no service")]);

    await waitFor(() => {
      expect(serviceNameOf("no service")).toBe(STAND_IN);
    }, SETTLE);
  });

  test("German reads its own word", async () => {
    await renderViewer("de", [makeLog("log-1", PROJECT_ID, "no service")]);

    await waitFor(() => {
      expect(serviceNameOf("no service")).toBe(word("de", STAND_IN));
    }, SETTLE);
    expect(serviceNameOf("no service")).not.toBe(STAND_IN);
  });
});
