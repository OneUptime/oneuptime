import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * Reported as: "In real user monitoring, when I click on metrics / logs, why
 * does it show service id as locked filters? Why not show service name
 * instead?"
 *
 * This renders the real chip component with chips built exactly the way
 * DashboardLogsViewer builds them — the generic entity-name hook, the scope
 * chip builder, the user-chip relabeller and the attribute chip builder —
 * against a mocked ModelAPI, so what is asserted is the text a person sees.
 * The wiring of these calls inside the viewer is pinned separately by
 * App/Tests/Dashboard/LogsEntityNamesWiring.test.ts.
 */

const getListMock: MockFunction = getJestMockFunction();

/*
 * The arrow wrapper is load bearing: jest.mock is hoisted above the
 * compiled requires, so getListMock is still unassigned when the factory
 * runs.
 */
jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<any>) => {
        return getListMock(...args);
      },
    },
  };
});

import {
  applyLogsEntityChipDisplay,
  buildLogsEntityTypeHints,
  buildLogsScopeEntityChips,
  collectLogsEntityIds,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsEntityChipDisplay";
import { buildAttributeFilterChips } from "../../../../App/FeatureSet/Dashboard/src/Components/Logs/LogsAttributeFilterChips";
import ActiveFilterChips from "../../../UI/Components/LogsViewer/components/ActiveFilterChips";
import { ActiveFilter } from "../../../UI/Components/LogsViewer/types";
import useTelemetryEntityNames from "../../../UI/Utils/Telemetry/UseTelemetryEntityNames";
import TelemetryEntityNameResolver, {
  TelemetryEntityNameMap,
} from "../../../UI/Utils/Telemetry/TelemetryEntityNames";
import Dictionary from "../../../Types/Dictionary";
import { DictionaryEntryValue } from "../../../UI/Components/Dictionary/DictionaryFilterOperator";
import ObjectID from "../../../Types/ObjectID";
import ServiceType from "../../../Types/Telemetry/ServiceType";
import ProjectUtil from "../../../UI/Utils/Project";

const PROJECT_ID: string = "9e1b6b0e-0000-4000-8000-000000000021";
const RUM_APP_ID: string = "84858d6c-0000-4000-8000-000000000001";
const SERVICE_ID: string = "11111111-0000-4000-8000-000000000001";
const HOST_ID: string = "33333333-0000-4000-8000-000000000001";

interface GetListArgs {
  modelType: { name: string };
  query: { _id: { values?: Array<string>; _values?: Array<string> } };
}

/*
 * One row per table the resolver may consult; any other table answers with
 * nothing, the way an id that is not there would.
 */
const ROWS_BY_MODEL: Record<string, Array<{ id: string; name: string }>> = {
  RumApplication: [{ id: RUM_APP_ID, name: "checkout-web" }],
  Service: [{ id: SERVICE_ID, name: "payments-api" }],
  Host: [{ id: HOST_ID, name: "web-01" }],
};

const queriedModels: () => Array<string> = (): Array<string> => {
  return getListMock.mock.calls.map((call: Array<unknown>): string => {
    return (call[0] as GetListArgs).modelType.name;
  });
};

interface HarnessProps {
  serviceIds?: Array<ObjectID> | undefined;
  scopeEntityType?: ServiceType | undefined;
  appliedFacetFilters?: Map<string, Set<string>> | undefined;
  attributes?: Dictionary<DictionaryEntryValue> | undefined;
  attributeFilterDisplayKeys?: Record<string, string> | undefined;
  attributeFilterDisplayValues?: Record<string, string> | undefined;
  onRemove?: ((facetKey: string, value: string) => void) | undefined;
}

const Harness: React.FunctionComponent<HarnessProps> = (
  props: HarnessProps,
): React.ReactElement => {
  const ids: Array<string> = React.useMemo(() => {
    return collectLogsEntityIds({
      scopeIds: props.serviceIds,
      appliedFacetFilters: props.appliedFacetFilters,
    });
  }, [props.serviceIds, props.appliedFacetFilters]);

  const typeHints: Record<string, ServiceType> | undefined =
    React.useMemo(() => {
      return buildLogsEntityTypeHints(props.serviceIds, props.scopeEntityType);
    }, [props.serviceIds, props.scopeEntityType]);

  const nameMap: TelemetryEntityNameMap = useTelemetryEntityNames(ids, {
    typeHints,
  });

  const baseChips: Array<ActiveFilter> = [
    ...buildLogsScopeEntityChips({
      scopeIds: props.serviceIds,
      nameMap,
      scopeEntityType: props.scopeEntityType,
    }),
    ...buildAttributeFilterChips(props.attributes, {
      displayKeys: props.attributeFilterDisplayKeys,
      displayValues: props.attributeFilterDisplayValues,
    }),
  ];

  const userChips: Array<ActiveFilter> = [];
  for (const [facetKey, values] of (
    props.appliedFacetFilters || new Map<string, Set<string>>()
  ).entries()) {
    for (const value of values) {
      userChips.push({
        facetKey,
        value,
        displayKey: "Service",
        displayValue: value,
      });
    }
  }

  return (
    <ActiveFilterChips
      filters={[
        ...baseChips,
        ...applyLogsEntityChipDisplay(userChips, {
          nameMap,
          scopeIds: props.serviceIds,
          scopeEntityType: props.scopeEntityType,
        }),
      ]}
      onRemove={(facetKey: string, value: string) => {
        props.onRemove?.(facetKey, value);
      }}
      onClearAll={() => {}}
    />
  );
};

const chipText: () => string = (): string => {
  return document.body.textContent || "";
};

beforeEach(() => {
  TelemetryEntityNameResolver.clearCache();
  getListMock.mockReset();
  getListMock.mockImplementation((args: GetListArgs) => {
    return Promise.resolve({
      data: (ROWS_BY_MODEL[args.modelType.name] || []).map(
        (row: { id: string; name: string }) => {
          return { id: new ObjectID(row.id), name: row.name };
        },
      ),
      count: 0,
    });
  });
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("logs viewer entity chips (rendered)", () => {
  test("RUM logs tab: the locked chip reads 'RUM Application: checkout-web', never the id", async () => {
    render(
      <Harness
        serviceIds={[new ObjectID(RUM_APP_ID)]}
        scopeEntityType={ServiceType.RealUserMonitor}
      />,
    );

    // The type is known up front, so the key is right before the name lands.
    expect(screen.getByText("RUM Application:")).toBeInTheDocument();

    await waitFor(() => {
      expect(screen.getByText("checkout-web")).toBeInTheDocument();
    });

    expect(chipText()).not.toContain(RUM_APP_ID);
    expect(chipText()).not.toContain("Service:");
  });

  test("a hinted scope goes straight to its own table in one request", async () => {
    render(
      <Harness
        serviceIds={[new ObjectID(RUM_APP_ID)]}
        scopeEntityType={ServiceType.RealUserMonitor}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("checkout-web")).toBeInTheDocument();
    });

    expect(queriedModels()).toEqual(["RumApplication"]);
  });

  test("an unhinted RUM id is still found and labelled by its real type", async () => {
    render(<Harness serviceIds={[new ObjectID(RUM_APP_ID)]} />);

    await waitFor(() => {
      expect(screen.getByText("checkout-web")).toBeInTheDocument();
    });

    expect(screen.getByText("RUM Application:")).toBeInTheDocument();
    expect(chipText()).not.toContain(RUM_APP_ID);
  });

  test("a Service page is unchanged: 'Service: payments-api'", async () => {
    render(<Harness serviceIds={[new ObjectID(SERVICE_ID)]} />);

    await waitFor(() => {
      expect(screen.getByText("payments-api")).toBeInTheDocument();
    });

    expect(screen.getByText("Service:")).toBeInTheDocument();
    expect(queriedModels()).toEqual(["Service"]);
  });

  test("user / URL / saved-view entity chips are named too, in the same lookup", async () => {
    const removed: Array<[string, string]> = [];

    render(
      <Harness
        serviceIds={[new ObjectID(RUM_APP_ID)]}
        scopeEntityType={ServiceType.RealUserMonitor}
        appliedFacetFilters={
          new Map<string, Set<string>>([
            ["primaryEntityId", new Set([HOST_ID])],
            ["serviceId", new Set([SERVICE_ID])],
          ])
        }
        onRemove={(facetKey: string, value: string) => {
          removed.push([facetKey, value]);
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByText("web-01")).toBeInTheDocument();
    });

    expect(screen.getByText("checkout-web")).toBeInTheDocument();
    expect(screen.getByText("payments-api")).toBeInTheDocument();
    expect(screen.getByText("Host:")).toBeInTheDocument();
    expect(screen.getByText("RUM Application:")).toBeInTheDocument();
    expect(chipText()).not.toContain(HOST_ID);
    expect(chipText()).not.toContain(SERVICE_ID);

    // Removing a chip still hands the viewer the id, not the name.
    fireEvent.click(screen.getByTitle("Remove Host: web-01"));
    expect(removed).toEqual([["primaryEntityId", HOST_ID]]);
  });

  test("resource page attribute chips show the friendly key and the page's name", () => {
    render(
      <Harness
        attributes={{ "networkDevice.id": RUM_APP_ID }}
        attributeFilterDisplayValues={{ "networkDevice.id": "core-switch-1" }}
      />,
    );

    expect(screen.getByText("Network Device:")).toBeInTheDocument();
    expect(screen.getByText("core-switch-1")).toBeInTheDocument();
    expect(chipText()).not.toContain(RUM_APP_ID);
    expect(chipText()).not.toContain("networkDevice.id");
    // Attribute chips never trigger an entity lookup.
    expect(getListMock).not.toHaveBeenCalled();
  });

  test("an id nobody can name falls back to 'Service: <id>' without erroring", async () => {
    const unknownId: string = "44444444-0000-4000-8000-000000000001";

    render(<Harness serviceIds={[new ObjectID(unknownId)]} />);

    await waitFor(() => {
      expect(getListMock).toHaveBeenCalled();
    });

    expect(screen.getByText("Service:")).toBeInTheDocument();
    expect(screen.getByText(unknownId)).toBeInTheDocument();
  });
});
