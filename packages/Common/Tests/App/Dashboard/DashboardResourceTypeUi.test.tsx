import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import * as React from "react";
import {
  getShownDropdownPlaceholder,
  getShownDropdownValue,
  listDropdownOptions,
  pickDropdownOption,
} from "../../DropdownPicks";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * A DASHBOARD VARIABLE'S RESOURCE TYPE, AS PEOPLE MEET IT (issue #11258).
 *
 *   - The Variables dialog: a Telemetry Attribute variable's Resource Type,
 *     "Any resource type" until one is picked, what each choice does in one
 *     line under it, and a type picked for a variable with no key filling
 *     in the attribute its resources are named by.
 *   - The toolbar, signed in and public: a variable of a type reads "All
 *     hosts", never a bare "All" that reads as the whole project, and asks
 *     only for that type's values.
 *   - The board: while the project has nothing of the type, it says so
 *     above its widgets, with the way to set one up - and says nothing when
 *     it has some, when the count cannot be read, or for a variable of no
 *     type.
 */

const getTelemetryAttributeValuesMock: MockFunction = getJestMockFunction();
const publicPostMock: MockFunction = getJestMockFunction();
const countMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Metrics/Utils/Metrics",
  () => {
    return {
      __esModule: true,
      default: {
        getTelemetryAttributeValues: (...args: Array<unknown>) => {
          return getTelemetryAttributeValuesMock(...args);
        },
      },
    };
  },
);

jest.mock("../../../../App/FeatureSet/PublicDashboard/src/Utils/API", () => {
  return {
    __esModule: true,
    default: {
      post: (...args: Array<unknown>) => {
        return publicPostMock(...args);
      },
    },
  };
});

jest.mock("../../../../App/FeatureSet/PublicDashboard/src/Utils/Config", () => {
  return {
    __esModule: true,
    PUBLIC_DASHBOARD_API_URL: {
      toString: () => {
        return "https://localhost/api/public-dashboard";
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      count: (...args: Array<unknown>) => {
        return countMock(...args);
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: () => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("11258111-1111-4111-8111-111111111111");
      },
    },
  };
});

jest.mock("../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../../App/FeatureSet/Dashboard/src/Utils/RouteMap",
  ) as Record<string, unknown>;

  // The module's own __esModule flag is not enumerable: a spread drops it.
  return {
    __esModule: true,
    ...actual,
    RouteUtil: {
      populateRouteParams: (route: { toString: () => string }) => {
        return route;
      },
    },
  };
});

import DashboardVariablesModal from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Toolbar/DashboardVariablesModal";
import DashboardVariableSelector from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/Toolbar/DashboardVariableSelector";
import PublicDashboardVariableSelector from "../../../../App/FeatureSet/PublicDashboard/src/Pages/DashboardView/DashboardVariableSelector";
import DashboardResourceScopeNotice from "../../../../App/FeatureSet/Dashboard/src/Components/Dashboard/DashboardResourceScopeNotice";
import Host from "../../../Models/DatabaseModels/Host";
import DockerSwarmCluster from "../../../Models/DatabaseModels/DockerSwarmCluster";
import { DashboardResourceScope } from "../../../Types/Dashboard/DashboardResourceScope";
import DashboardVariable, {
  DashboardVariableType,
} from "../../../Types/Dashboard/DashboardVariable";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";

function hostVariable(
  overrides?: Partial<DashboardVariable>,
): DashboardVariable {
  return {
    id: "var-host",
    name: "host",
    label: "Host",
    type: DashboardVariableType.TelemetryAttribute,
    attributeKey: "resource.host.name",
    isMultiSelect: false,
    resourceScope: DashboardResourceScope.Host,
    ...overrides,
  } as DashboardVariable;
}

afterEach(() => {
  cleanup();
  getTelemetryAttributeValuesMock.mockReset();
  publicPostMock.mockReset();
  countMock.mockReset();
});

describe("the Variables dialog's Resource Type", () => {
  function renderDialog(variables: Array<DashboardVariable>): {
    saved: Array<Array<DashboardVariable>>;
  } {
    const calls: { saved: Array<Array<DashboardVariable>> } = { saved: [] };

    render(
      <DashboardVariablesModal
        variables={variables}
        telemetryAttributeOptions={["resource.host.name"]}
        onSave={(saved: Array<DashboardVariable>) => {
          calls.saved.push(saved);
        }}
        onClose={() => {
          return undefined;
        }}
      />,
    );

    return calls;
  }

  function save(): void {
    const button: HTMLElement = screen.getByTestId("modal-footer-submit-button");
    fireEvent.mouseDown(button);
    fireEvent.click(button);
  }

  function resourceType(): HTMLElement {
    return screen.getByRole("combobox", { name: "Resource Type" });
  }

  test("a variable of no type reads Any resource type, and says what a type would do", () => {
    renderDialog([hostVariable({ resourceScope: undefined })]);

    expect(getShownDropdownValue(resourceType())).toBe("Any resource type");
    expect(
      screen.getByText(
        "Pick a resource type to show only its data on every widget, even before a value is picked.",
      ),
    ).toBeInTheDocument();
  });

  test("a variable of a type reads its type, and says what All and a pick show", () => {
    renderDialog([hostVariable()]);

    expect(getShownDropdownValue(resourceType())).toBe("Hosts");
    expect(
      screen.getByText(
        'Every widget shows only this resource type\'s data. "All" shows all of them, and picking values narrows it to those.',
      ),
    ).toBeInTheDocument();
  });

  test("offers Any resource type and every type, by the names people know them by", async () => {
    renderDialog([hostVariable({ resourceScope: undefined })]);

    expect(await listDropdownOptions(resourceType())).toEqual([
      "Any resource type",
      "Kubernetes clusters",
      "Hosts",
      "Docker Swarm clusters",
      "Proxmox clusters",
      "OpenStack clouds",
      "VMware vCenters",
      "XCP-ng pools",
      "Ceph clusters",
      "Storage arrays",
    ]);

    await pickDropdownOption(resourceType(), "Docker Swarm clusters");

    expect(getShownDropdownValue(resourceType())).toBe(
      "Docker Swarm clusters",
    );
  });

  test("a type picked for a variable with no key fills in the attribute its resources are named by, and is saved", async () => {
    const calls: { saved: Array<Array<DashboardVariable>> } = renderDialog([
      hostVariable({ resourceScope: undefined, attributeKey: "" }),
    ]);

    await pickDropdownOption(resourceType(), "Hosts");

    expect(screen.getByPlaceholderText("e.g. k8s.cluster.name")).toHaveValue(
      "resource.host.name",
    );

    save();

    expect(calls.saved).toHaveLength(1);
    expect(calls.saved[0]![0]).toMatchObject({
      attributeKey: "resource.host.name",
      resourceScope: DashboardResourceScope.Host,
    });
  });

  test("Any resource type takes the type off again, keeping the key", async () => {
    const calls: { saved: Array<Array<DashboardVariable>> } = renderDialog([
      hostVariable(),
    ]);

    await pickDropdownOption(resourceType(), "Any resource type");
    save();

    expect(calls.saved[0]![0]!.resourceScope).toBeUndefined();
    expect(calls.saved[0]![0]!.attributeKey).toBe("resource.host.name");
  });
});

describe("the toolbar's picker of a variable of a type", () => {
  test("signed in: reads All hosts, and asks only for the hosts' names", async () => {
    getTelemetryAttributeValuesMock.mockResolvedValue(["db-01"] as never);

    render(
      <DashboardVariableSelector
        variables={[hostVariable()]}
        onVariableValueChange={() => {
          return undefined;
        }}
      />,
    );

    // Its values loaded, it reads All hosts.
    await waitFor(() => {
      expect(getShownDropdownPlaceholder(screen.getByRole("combobox"))).toBe(
        "All hosts",
      );
    });

    expect(getTelemetryAttributeValuesMock.mock.calls[0]![0]).toMatchObject({
      attributeKey: "resource.host.name",
      resourceScope: DashboardResourceScope.Host,
    });
  });

  test("signed in, multi-select: its button reads All hosts", async () => {
    getTelemetryAttributeValuesMock.mockResolvedValue(["db-01"] as never);

    render(
      <DashboardVariableSelector
        variables={[hostVariable({ isMultiSelect: true })]}
        onVariableValueChange={() => {
          return undefined;
        }}
      />,
    );

    await waitFor(() => {
      expect(screen.getByTitle("Host")).toHaveTextContent("All hosts");
    });
  });

  test("a variable of no type still reads All", async () => {
    getTelemetryAttributeValuesMock.mockResolvedValue(["db-01"] as never);

    render(
      <DashboardVariableSelector
        variables={[hostVariable({ resourceScope: undefined })]}
        onVariableValueChange={() => {
          return undefined;
        }}
      />,
    );

    await waitFor(() => {
      expect(getShownDropdownPlaceholder(screen.getByRole("combobox"))).toBe(
        "All",
      );
    });

    expect(
      (getTelemetryAttributeValuesMock.mock.calls[0]![0] as JSONObject)[
        "resourceScope"
      ],
    ).toBeUndefined();
  });

  test("public: reads All hosts, and asks the public dashboard for the hosts' names only", async () => {
    publicPostMock.mockResolvedValue({ data: { values: ["db-01"] } } as never);

    render(
      <PublicDashboardVariableSelector
        variables={[hostVariable()]}
        dashboardId={new ObjectID("11258222-2222-4222-8222-222222222222")}
        onVariableValueChange={() => {
          return undefined;
        }}
      />,
    );

    await waitFor(() => {
      expect(getShownDropdownPlaceholder(screen.getByRole("combobox"))).toBe(
        "All hosts",
      );
    });

    expect(
      (publicPostMock.mock.calls[0]![0] as { data: unknown }).data,
    ).toEqual({
      attributeKey: "resource.host.name",
      resourceScope: DashboardResourceScope.Host,
    });
  });
});

describe("the board of a type the project has none of", () => {
  test("says so above its widgets, with the way to set one up", async () => {
    countMock.mockResolvedValue(0 as never);

    render(<DashboardResourceScopeNotice variables={[hostVariable()]} />);

    expect(await screen.findByText("No hosts yet")).toBeInTheDocument();
    expect(
      screen.getByText(
        "This dashboard shows only their data, so its widgets stay empty until the first one reports to OneUptime.",
        { exact: false },
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Add Host" })).toBeInTheDocument();

    // It counted the project's hosts, archived ones left out.
    expect(countMock.mock.calls[0]![0]).toMatchObject({
      modelType: Host,
      query: { isArchived: false },
    });
  });

  test("names each type it has none of, as a Docker Swarm board does", async () => {
    countMock.mockResolvedValue(0 as never);

    render(
      <DashboardResourceScopeNotice
        variables={[
          hostVariable({
            id: "var-cluster",
            name: "cluster",
            label: "Cluster",
            attributeKey: "resource.docker.swarm.cluster.name",
            resourceScope: DashboardResourceScope.DockerSwarmCluster,
          }),
        ]}
      />,
    );

    expect(
      await screen.findByText("No Docker Swarm clusters yet"),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: "Set Up Docker Swarm" }),
    ).toBeInTheDocument();
    expect(countMock.mock.calls[0]![0]).toMatchObject({
      modelType: DockerSwarmCluster,
    });
  });

  test("says nothing once the project has one", async () => {
    countMock.mockResolvedValue(3 as never);

    const { container } = render(
      <DashboardResourceScopeNotice variables={[hostVariable()]} />,
    );

    await waitFor(() => {
      expect(countMock).toHaveBeenCalled();
    });

    expect(screen.queryByText("No hosts yet")).toBeNull();
    expect(container).toBeEmptyDOMElement();
  });

  test("says nothing when the count cannot be read", async () => {
    countMock.mockRejectedValue(new Error("Forbidden") as never);

    const { container } = render(
      <DashboardResourceScopeNotice variables={[hostVariable()]} />,
    );

    await waitFor(() => {
      expect(countMock).toHaveBeenCalled();
    });

    expect(container).toBeEmptyDOMElement();
  });

  test("asks nothing for a variable of no type", () => {
    const { container } = render(
      <DashboardResourceScopeNotice
        variables={[hostVariable({ resourceScope: undefined })]}
      />,
    );

    expect(countMock).not.toHaveBeenCalled();
    expect(container).toBeEmptyDOMElement();
  });
});
