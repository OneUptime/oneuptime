import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Name resolution settles over a few promise hops after the first render;
 * generous bounds keep these from flaking on a loaded CI machine without
 * slowing a healthy run (waitFor returns as soon as the assertion holds).
 */
const SETTLE: { timeout: number } = { timeout: 30000 };
jest.setTimeout(300000);

/*
 * The reported bug, end to end through the shared logs viewer: on a RUM
 * application the logs' primaryEntityId is the RumApplication id, but the
 * viewer only preloads Services / hosts / clusters, so the locked chip read
 * "Service: 22222222-…", the Service column printed the UUID and the
 * details header did too.
 *
 * ModelAPI is faked per table so the preload (query `{}`) and the generic
 * resolver (query `_id IN (…)`) both hit realistic data; the chip, table
 * column, details header, sidebar and search-bar suggestion paths are
 * exercised through the real components.
 */

const getListMock: MockFunction = getJestMockFunction();
const postMock: MockFunction = getJestMockFunction();

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

jest.mock("../../../UI/Utils/API/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<any>) => {
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

const PROJECT_ID_STRING: string = "9e1b6b0e-0000-4000-8000-000000000001";

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        const ObjectIDActual: any = (
          jest.requireActual("../../../Types/ObjectID") as any
        ).default;
        return new ObjectIDActual("9e1b6b0e-0000-4000-8000-000000000001");
      },
    },
  };
});

import LogsViewer from "../../../UI/Components/LogsViewer/LogsViewer";
import { ActiveFilter } from "../../../UI/Components/LogsViewer/types";
import TelemetryEntityNameResolver from "../../../UI/Utils/Telemetry/TelemetryEntityNames";
import Log from "../../../Models/AnalyticsModels/Log";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Host from "../../../Models/DatabaseModels/Host";
import RumApplication from "../../../Models/DatabaseModels/RumApplication";
import ServerlessFunction from "../../../Models/DatabaseModels/ServerlessFunction";
import Service from "../../../Models/DatabaseModels/Service";
import Includes from "../../../Types/BaseDatabase/Includes";
import LogSeverity from "../../../Types/Log/LogSeverity";
import ObjectID from "../../../Types/ObjectID";
import ServiceType from "../../../Types/Telemetry/ServiceType";

const SERVICE_ID: string = "11111111-0000-4000-8000-000000000001";
const RUM_ID: string = "22222222-0000-4000-8000-000000000001";
const FUNCTION_ID: string = "77777777-0000-4000-8000-000000000001";
const HOST_ID: string = "33333333-0000-4000-8000-000000000001";
// A RUM application that shares the preloaded Service's name.
const RUM_ID_SAME_NAME: string = "22222222-0000-4000-8000-000000000002";

type ModelType = { new (): BaseModel };

interface GetListArgs {
  modelType: ModelType;
  query: Record<string, unknown>;
}

const makeService: () => Service = (): Service => {
  const service: Service = new Service();
  service.id = new ObjectID(SERVICE_ID);
  service.name = "checkout-api";
  return service;
};

const makeRumApplication: () => RumApplication = (): RumApplication => {
  const app: RumApplication = new RumApplication();
  app.id = new ObjectID(RUM_ID);
  app.name = "checkout-web";
  return app;
};

const makeRumApplicationNamedLikeService: () => RumApplication =
  (): RumApplication => {
    const app: RumApplication = new RumApplication();
    app.id = new ObjectID(RUM_ID_SAME_NAME);
    app.name = "checkout-api";
    return app;
  };

const makeHost: () => Host = (): Host => {
  const host: Host = new Host();
  host.id = new ObjectID(HOST_ID);
  host.name = "web-1";
  host.hostIdentifier = "ip-10-0-0-1";
  return host;
};

const makeFunction: () => ServerlessFunction = (): ServerlessFunction => {
  const fn: ServerlessFunction = new ServerlessFunction();
  fn.id = new ObjectID(FUNCTION_ID);
  fn.name = "resize-images";
  return fn;
};

const rowsByModel: () => Map<ModelType, Array<BaseModel>> = (): Map<
  ModelType,
  Array<BaseModel>
> => {
  return new Map<ModelType, Array<BaseModel>>([
    [Service, [makeService()]],
    [
      RumApplication,
      [makeRumApplication(), makeRumApplicationNamedLikeService()],
    ],
    [ServerlessFunction, [makeFunction()]],
    [Host, [makeHost()]],
  ]);
};

const resolverCalls: () => Array<GetListArgs> = (): Array<GetListArgs> => {
  return getListMock.mock.calls
    .map((call: Array<unknown>): GetListArgs => {
      return call[0] as GetListArgs;
    })
    .filter((args: GetListArgs): boolean => {
      return args.query["_id"] instanceof Includes;
    });
};

const makeLog: (
  id: string,
  primaryEntityId: string,
  body: string,
  primaryEntityType?: ServiceType,
) => Log = (
  id: string,
  primaryEntityId: string,
  body: string,
  primaryEntityType?: ServiceType,
): Log => {
  const log: Log = new Log();
  log.setColumnValue("_id", id);
  log.primaryEntityId = new ObjectID(primaryEntityId);
  if (primaryEntityType) {
    log.primaryEntityType = primaryEntityType;
  }
  log.body = body;
  log.time = new Date("2026-08-10T10:15:00.000Z");
  log.severityText = LogSeverity.Information;
  return log;
};

beforeEach(() => {
  TelemetryEntityNameResolver.clearCache();
  getListMock.mockReset();
  postMock.mockReset();

  getListMock.mockImplementation((...args: Array<unknown>) => {
    const request: GetListArgs = args[0] as GetListArgs;
    const rows: Array<BaseModel> = rowsByModel().get(request.modelType) || [];
    const includes: unknown = request.query["_id"];
    const data: Array<BaseModel> =
      includes instanceof Includes
        ? rows.filter((row: BaseModel): boolean => {
            return (includes.values as Array<string>)
              .map((value: string): string => {
                return value.toString();
              })
              .includes(row.id!.toString());
          })
        : rows;
    return Promise.resolve({
      data,
      count: data.length,
      skip: 0,
      limit: 100,
    });
  });

  postMock.mockImplementation(() => {
    return Promise.resolve({ data: {} });
  });
});

afterEach(() => {
  cleanup();
});

/*
 * The viewer shows a page loader until its preload resolves; the logs table
 * only mounts after. A DOM probe rather than a role query — role queries
 * over the whole viewer are slow enough to eat waitFor's budget on their own.
 */
const waitForViewer: () => Promise<void> = async (): Promise<void> => {
  await waitFor(() => {
    expect(document.querySelector("table")).not.toBeNull();
  }, SETTLE);
};

describe("LogsViewer names polymorphic telemetry entities", () => {
  test("regression: the locked RUM application chip reads 'RUM Application: checkout-web', not the UUID", async () => {
    const baseActiveFilters: Array<ActiveFilter> = [
      {
        facetKey: "primaryEntityId",
        value: RUM_ID,
        displayKey: "Service",
        displayValue: RUM_ID,
        readOnly: true,
      },
    ];

    render(
      <LogsViewer
        logs={[]}
        isLoading={false}
        filterData={{}}
        onFilterChanged={jest.fn()}
        baseActiveFilters={baseActiveFilters}
      />,
    );

    await waitForViewer();

    await waitFor(() => {
      expect(screen.getByText("checkout-web")).toBeInTheDocument();
    }, SETTLE);
    expect(screen.getByText("RUM Application:")).toBeInTheDocument();
    expect(screen.queryByText(RUM_ID)).not.toBeInTheDocument();
    expect(screen.queryByText("Service:")).not.toBeInTheDocument();
  });

  test("a scope chip the parent typed but has not named yet is looked up in its own table only", async () => {
    render(
      <LogsViewer
        logs={[]}
        isLoading={false}
        filterData={{}}
        onFilterChanged={jest.fn()}
        baseActiveFilters={[
          {
            facetKey: "primaryEntityId",
            value: RUM_ID,
            displayKey: "RUM Application",
            displayValue: RUM_ID,
            readOnly: true,
          },
        ]}
      />,
    );

    await waitForViewer();

    await waitFor(() => {
      expect(screen.getByText("checkout-web")).toBeInTheDocument();
    }, SETTLE);
    expect(screen.getByText("RUM Application:")).toBeInTheDocument();

    /*
     * The key doubles as a type hint: one RumApplication query, no Service
     * probe and no fan-out over every other entity table.
     */
    const modelTypes: Array<ModelType> = resolverCalls().map(
      (args: GetListArgs): ModelType => {
        return args.modelType;
      },
    );
    expect(modelTypes).toEqual([RumApplication]);
  });

  test("a chip for a preloaded Service keeps 'Service' and is not sent to the resolver", async () => {
    render(
      <LogsViewer
        logs={[]}
        isLoading={false}
        filterData={{}}
        onFilterChanged={jest.fn()}
        activeFilters={[
          {
            facetKey: "primaryEntityId",
            value: SERVICE_ID,
            displayKey: "Service",
            displayValue: SERVICE_ID,
          },
        ]}
        onRemoveFilter={jest.fn()}
      />,
    );

    await waitForViewer();

    await waitFor(() => {
      expect(screen.getByText("checkout-api")).toBeInTheDocument();
    }, SETTLE);
    expect(screen.getByText("Service:")).toBeInTheDocument();
    expect(resolverCalls()).toHaveLength(0);
  });

  test("a chip the parent already named is left exactly as supplied", async () => {
    render(
      <LogsViewer
        logs={[]}
        isLoading={false}
        filterData={{}}
        onFilterChanged={jest.fn()}
        baseActiveFilters={[
          {
            facetKey: "primaryEntityId",
            value: RUM_ID,
            displayKey: "RUM Application",
            displayValue: "Checkout (parent label)",
            readOnly: true,
          },
        ]}
      />,
    );

    await waitForViewer();

    expect(screen.getByText("Checkout (parent label)")).toBeInTheDocument();
    expect(screen.getByText("RUM Application:")).toBeInTheDocument();
    expect(screen.queryByText("checkout-web")).not.toBeInTheDocument();
    expect(resolverCalls()).toHaveLength(0);
  });

  test("removing a named user chip still hands the id (not the name) back to the host", async () => {
    const onRemoveFilter: MockFunction = getJestMockFunction();

    render(
      <LogsViewer
        logs={[]}
        isLoading={false}
        filterData={{}}
        onFilterChanged={jest.fn()}
        activeFilters={[
          {
            facetKey: "primaryEntityId",
            value: RUM_ID,
            displayKey: "Service",
            displayValue: RUM_ID,
          },
        ]}
        onRemoveFilter={onRemoveFilter as any}
      />,
    );

    await waitForViewer();

    const removeButton: HTMLElement = await screen.findByTitle(
      "Remove RUM Application: checkout-web",
      {},
      SETTLE,
    );
    fireEvent.click(removeButton);
    expect(onRemoveFilter).toHaveBeenCalledWith("primaryEntityId", RUM_ID);
  });

  test("the Service column and details header name a RUM application's log", async () => {
    render(
      <LogsViewer
        logs={[
          makeLog("log-1", RUM_ID, "page loaded", ServiceType.RealUserMonitor),
          makeLog("log-2", SERVICE_ID, "order placed"),
        ]}
        isLoading={false}
        filterData={{}}
        onFilterChanged={jest.fn()}
        projectId={new ObjectID(PROJECT_ID_STRING)}
      />,
    );

    await waitForViewer();

    await waitFor(() => {
      expect(
        screen.getByTitle("RUM Application: checkout-web"),
      ).toBeInTheDocument();
    }, SETTLE);
    expect(screen.getByTitle("checkout-api")).toBeInTheDocument();
    expect(screen.queryByText(RUM_ID)).not.toBeInTheDocument();

    /*
     * The row's primaryEntityType travels as a hint, so the RUM id goes
     * straight to the RumApplication table instead of probing Services.
     */
    const calls: Array<GetListArgs> = resolverCalls();
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0]!.modelType).toBe(RumApplication);

    fireEvent.click(screen.getByText("page loaded"));

    const heading: HTMLElement = await screen.findByRole(
      "heading",
      { name: "checkout-web" },
      SETTLE,
    );
    expect(heading).toBeInTheDocument();
    expect(screen.getByTestId("log-details-entity-type")).toHaveTextContent(
      "RUM Application",
    );
  });

  test("an unhinted non-Service id is found by the resolver's fan-out", async () => {
    render(
      <LogsViewer
        logs={[makeLog("log-1", FUNCTION_ID, "cold start")]}
        isLoading={false}
        filterData={{}}
        onFilterChanged={jest.fn()}
      />,
    );

    await waitForViewer();

    await waitFor(() => {
      expect(
        screen.getByTitle("Serverless Function: resize-images"),
      ).toBeInTheDocument();
    }, SETTLE);
  });

  test("the sidebar names resource facet values the server did not name", async () => {
    render(
      <LogsViewer
        logs={[]}
        isLoading={false}
        filterData={{}}
        onFilterChanged={jest.fn()}
        facetData={{
          primaryEntityId: [
            { value: SERVICE_ID, count: 4 },
            { value: RUM_ID, count: 2 },
          ],
        }}
      />,
    );

    await waitForViewer();

    await waitFor(() => {
      expect(screen.getByText("checkout-web")).toBeInTheDocument();
    }, SETTLE);
    expect(screen.getByText("checkout-api")).toBeInTheDocument();
  });

  test("picking a RUM application from the service: suggestions filters by its id", async () => {
    const onFieldValueSelect: MockFunction = getJestMockFunction();

    render(
      <LogsViewer
        logs={[]}
        isLoading={false}
        filterData={{}}
        onFilterChanged={jest.fn()}
        showFilters={true}
        facetData={{
          primaryEntityId: [
            { value: SERVICE_ID, count: 4 },
            { value: RUM_ID, count: 2 },
          ],
        }}
        valueSuggestions={{ primaryEntityId: [SERVICE_ID, RUM_ID] }}
        onFieldValueSelect={onFieldValueSelect as any}
      />,
    );

    await waitForViewer();

    // Wait until the resolver has named the RUM application.
    await waitFor(() => {
      expect(screen.getByText("checkout-web")).toBeInTheDocument();
    }, SETTLE);

    const input: HTMLElement = screen.getAllByRole("textbox")[0]!;
    fireEvent.change(input, { target: { value: "service:checkout-web" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onFieldValueSelect).toHaveBeenCalledWith("service", RUM_ID);
  });

  test("a preloaded service name still resolves to its id from the search bar", async () => {
    const onFieldValueSelect: MockFunction = getJestMockFunction();

    render(
      <LogsViewer
        logs={[]}
        isLoading={false}
        filterData={{}}
        onFilterChanged={jest.fn()}
        showFilters={true}
        valueSuggestions={{ primaryEntityId: [SERVICE_ID] }}
        onFieldValueSelect={onFieldValueSelect as any}
      />,
    );

    await waitForViewer();

    const input: HTMLElement = screen.getAllByRole("textbox")[0]!;
    fireEvent.change(input, { target: { value: "service:checkout-api" } });
    fireEvent.keyDown(input, { key: "Enter" });

    expect(onFieldValueSelect).toHaveBeenCalledWith("service", SERVICE_ID);
  });

  test("the resolver is not consulted when every entity on screen is preloaded", async () => {
    render(
      <LogsViewer
        logs={[makeLog("log-1", SERVICE_ID, "order placed")]}
        isLoading={false}
        filterData={{}}
        onFilterChanged={jest.fn()}
        baseActiveFilters={[
          {
            facetKey: "primaryEntityId",
            value: SERVICE_ID,
            displayKey: "Service",
            displayValue: SERVICE_ID,
            readOnly: true,
          },
        ]}
      />,
    );

    await waitForViewer();

    const chips: Array<HTMLElement> = screen.getAllByTitle(
      "Service: checkout-api (applied filter)",
    );
    expect(chips).toHaveLength(1);
    expect(within(chips[0]!).getByText("checkout-api")).toBeInTheDocument();
    expect(resolverCalls()).toHaveLength(0);
  });
  test("regression: an unhinted log of a preloaded host is named from the host map without a resolver request", async () => {
    render(
      <LogsViewer
        logs={[makeLog("log-1", HOST_ID, "disk full")]}
        isLoading={false}
        filterData={{}}
        onFilterChanged={jest.fn()}
        activeFilters={[
          {
            facetKey: "primaryEntityId",
            value: HOST_ID,
            displayKey: "Service",
            displayValue: HOST_ID,
          },
        ]}
        onRemoveFilter={jest.fn()}
      />,
    );

    await waitForViewer();

    /*
     * Named in the very render the table mounts in — the host map is
     * already loaded, so nothing waits on (or asks) the resolver.
     */
    expect(screen.getByTitle("Host: web-1")).toBeInTheDocument();
    expect(screen.getByTitle("Remove Host: web-1")).toBeInTheDocument();
    expect(screen.queryByText(HOST_ID)).not.toBeInTheDocument();

    fireEvent.click(screen.getByText("disk full"));
    const heading: HTMLElement = await screen.findByRole(
      "heading",
      { name: "web-1" },
      SETTLE,
    );
    expect(heading).toBeInTheDocument();
    expect(screen.getByTestId("log-details-entity-type")).toHaveTextContent(
      "Host",
    );

    // Let any lookup effect run before asserting none was made.
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 50);
    });
    expect(resolverCalls()).toHaveLength(0);
  });

  test("regression: a RUM application named like a preloaded Service filters by its own id when picked", async () => {
    const onFieldValueSelect: MockFunction = getJestMockFunction();

    render(
      <LogsViewer
        logs={[]}
        isLoading={false}
        filterData={{}}
        onFilterChanged={jest.fn()}
        showFilters={true}
        valueSuggestions={{ primaryEntityId: [RUM_ID_SAME_NAME] }}
        onFieldValueSelect={onFieldValueSelect as any}
      />,
    );

    await waitForViewer();

    const input: HTMLElement = screen.getAllByRole("textbox")[0]!;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "service:checkout" } });

    // The dropdown shows the resolver's name once it lands.
    const option: HTMLElement = await screen.findByText(
      "checkout-api",
      {},
      SETTLE,
    );
    expect(option.closest("button")).not.toBeNull();

    fireEvent.change(input, { target: { value: "service:checkout-api" } });
    fireEvent.keyDown(input, { key: "Enter" });

    // Not the preloaded Service that happens to share the name.
    expect(onFieldValueSelect).toHaveBeenCalledWith(
      "service",
      RUM_ID_SAME_NAME,
    );
    expect(onFieldValueSelect).not.toHaveBeenCalledWith("service", SERVICE_ID);
  });

  test("regression: a Service and a RUM application with the same name are separate suggestions, each picking its own id", async () => {
    const onFieldValueSelect: MockFunction = getJestMockFunction();

    render(
      <LogsViewer
        logs={[]}
        isLoading={false}
        filterData={{}}
        onFilterChanged={jest.fn()}
        showFilters={true}
        valueSuggestions={{ primaryEntityId: [SERVICE_ID, RUM_ID_SAME_NAME] }}
        onFieldValueSelect={onFieldValueSelect as any}
      />,
    );

    await waitForViewer();

    const input: HTMLElement = screen.getAllByRole("textbox")[0]!;
    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "service:checkout" } });

    const rumOption: HTMLElement = await screen.findByText(
      "checkout-api (RUM Application)",
      {},
      SETTLE,
    );
    fireEvent.mouseDown(rumOption);
    expect(onFieldValueSelect).toHaveBeenLastCalledWith(
      "service",
      RUM_ID_SAME_NAME,
    );

    fireEvent.focus(input);
    fireEvent.change(input, { target: { value: "service:checkout" } });
    const serviceOption: HTMLElement = await screen.findByText(
      "checkout-api (Service)",
      {},
      SETTLE,
    );
    fireEvent.mouseDown(serviceOption);
    expect(onFieldValueSelect).toHaveBeenLastCalledWith("service", SERVICE_ID);
  });
});
