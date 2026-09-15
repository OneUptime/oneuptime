import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import * as React from "react";
import InventoryItem from "../../../Models/DatabaseModels/InventoryItem";
import InventoryItemRelationship from "../../../Models/DatabaseModels/InventoryItemRelationship";
import EntityType from "../../../Types/Telemetry/EntityType";
import EntityRelationshipType from "../../../Types/Telemetry/EntityRelationshipType";
import EntityDetailPanel from "../../../../App/FeatureSet/Dashboard/src/Components/Topology/EntityDetailPanel";
import getJestMockFunction, { MockFunction } from "../../MockType";

jest.mock("../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string) => {
          return value;
        },
        translateValue: (value: React.ReactNode) => {
          return value;
        },
      };
    },
  };
});
jest.mock("../../../UI/Components/SideOver/SideOver", () => {
  return {
    __esModule: true,
    SideOverSize: { Small: "small" },
    default: (props: { title: string; children: React.ReactNode }) => {
      return <section aria-label={props.title}>{props.children}</section>;
    },
  };
});

function entity(key: string, label: string): InventoryItem {
  return {
    entityKey: key,
    displayName: label,
    entityType: EntityType.Container,
  } as InventoryItem;
}
const API: InventoryItem = entity("api", "Checkout API");
const DATABASE: InventoryItem = entity("db", "Orders database");
const WEB: InventoryItem = entity("web", "Web frontend");
const RELATIONSHIPS: Array<InventoryItemRelationship> = [
  {
    fromEntityKey: "api",
    toEntityKey: "db",
    relationshipType: EntityRelationshipType.DependsOn,
    callCount: 100,
    errorCount: 2,
    avgDurationMs: 30,
  },
  {
    fromEntityKey: "web",
    toEntityKey: "api",
    relationshipType: EntityRelationshipType.DependsOn,
  },
  {
    fromEntityKey: "api",
    toEntityKey: "missing",
    relationshipType: EntityRelationshipType.DependsOn,
  },
] as Array<InventoryItemRelationship>;

function renderPanel(
  options: {
    onSelectEntity?: (key: string) => void;
    onFocus?: (key: string) => void;
    focusButtonLabel?: string;
  } = {},
): void {
  render(
    <EntityDetailPanel
      entity={API}
      relationships={RELATIONSHIPS}
      entityByKey={
        new Map<string, InventoryItem>([
          ["api", API],
          ["db", DATABASE],
          ["web", WEB],
        ])
      }
      metricsWindowSeconds={60}
      onClose={() => {
        return undefined;
      }}
      onFocus={
        options.onFocus ||
        (() => {
          return undefined;
        })
      }
      onSelectEntity={options.onSelectEntity}
      focusButtonLabel={options.focusButtonLabel}
    />,
  );
}

afterEach(() => {
  cleanup();
});

describe("topology connection details", () => {
  test("offers a clear explore-connections action for the selected resource", () => {
    const onFocus: MockFunction = getJestMockFunction();
    renderPanel({ onFocus });
    fireEvent.click(
      screen.getByRole("button", { name: "Explore connections" }),
    );
    expect(onFocus).toHaveBeenCalledWith("api");
    expect(screen.queryByText("Focus on this node")).not.toBeInTheDocument();
  });

  test("infrastructure can describe its resource exploration action", () => {
    renderPanel({ focusButtonLabel: "Explore this resource" });
    expect(
      screen.getByRole("button", { name: "Explore this resource" }),
    ).toBeInTheDocument();
  });

  test("known dependencies and callers can be explored without closing the drawer", () => {
    const onSelectEntity: MockFunction = getJestMockFunction();
    renderPanel({ onSelectEntity });
    fireEvent.click(
      screen.getByRole("button", { name: "View details for Orders database" }),
    );
    expect(onSelectEntity).toHaveBeenLastCalledWith("db");
    fireEvent.click(
      screen.getByRole("button", { name: "View details for Web frontend" }),
    );
    expect(onSelectEntity).toHaveBeenLastCalledWith("web");
    expect(screen.getByText(/100\/min/)).toHaveTextContent("2.0% errors");
  });

  test("unresolved connections are explained and never presented as broken actions", () => {
    renderPanel({
      onSelectEntity: () => {
        return undefined;
      },
    });
    expect(
      screen.getByText("Checkout API depends on Undiscovered resource"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: /View details for Undiscovered/ }),
    ).not.toBeInTheDocument();
  });

  test("callers without navigation support retain readable static connections", () => {
    renderPanel();
    expect(
      screen.getByText("Checkout API depends on Orders database"),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole("button", {
        name: "View details for Orders database",
      }),
    ).not.toBeInTheDocument();
  });
});

describe("service map details", () => {
  const SERVICE: InventoryItem = {
    entityKey: "svc",
    displayName: "api",
    entityType: EntityType.Service,
    descriptiveAttributes: { "telemetry.sdk.language": "nodejs" },
  } as unknown as InventoryItem;
  const POD: InventoryItem = {
    entityKey: "pod",
    displayName: "api-6d4f8b9c7d-x2k9p",
    entityType: EntityType.KubernetesPod,
  } as InventoryItem;
  const POSTGRES: InventoryItem = {
    entityKey: "pg",
    displayName: "orders",
    entityType: EntityType.Database,
    identifyingAttributes: { "db.system.name": "postgresql" },
  } as unknown as InventoryItem;
  const byKey: Map<string, InventoryItem> = new Map<string, InventoryItem>([
    ["svc", SERVICE],
    ["pod", POD],
    ["pg", POSTGRES],
  ]);
  const relationships: Array<InventoryItemRelationship> = [
    {
      fromEntityKey: "svc",
      toEntityKey: "pg",
      relationshipType: EntityRelationshipType.DependsOn,
      callCount: 60,
      errorCount: 0,
      avgDurationMs: 4,
    },
    {
      fromEntityKey: "svc",
      toEntityKey: "pod",
      relationshipType: EntityRelationshipType.RunsOn,
    },
  ] as Array<InventoryItemRelationship>;

  function renderService(
    options: {
      onOpenInfrastructure?: (key: string) => void;
      onSelectEntity?: (key: string) => void;
    } = {},
  ): void {
    render(
      <EntityDetailPanel
        entity={SERVICE}
        relationships={relationships}
        entityByKey={byKey}
        metricsWindowSeconds={60}
        traffic={{
          inbound: { calls: 0, errors: 0, avgDurationMs: null },
          outbound: { calls: 60, errors: 0, avgDurationMs: 4 },
          statusLabel: "Entry point",
          statusColor: "#6366f1",
          subtitle: "Service · Node.js",
        }}
        onClose={() => {
          return undefined;
        }}
        onFocus={() => {
          return undefined;
        }}
        onSelectEntity={options.onSelectEntity}
        onOpenInfrastructure={options.onOpenInfrastructure}
      />,
    );
  }

  test("leads with status and the traffic in both directions", () => {
    renderService();
    expect(screen.getByTestId("entity-detail-status")).toHaveTextContent(
      "Entry point",
    );
    expect(
      screen.getByText("Requests it answered").parentElement,
    ).toHaveTextContent("None observed");
    expect(screen.getByText("Calls it made").parentElement).toHaveTextContent(
      "60/min",
    );
    expect(screen.getByText("Calls it made").parentElement).toHaveTextContent(
      "4ms",
    );
  });

  test("separates what it calls from where it runs", () => {
    renderService();
    expect(screen.getByTestId("entity-detail-calls")).toHaveTextContent(
      "api depends on orders",
    );
    expect(screen.getByTestId("entity-detail-calls")).toHaveTextContent(
      "Database",
    );
    expect(screen.getByTestId("entity-detail-runs-on")).toHaveTextContent(
      "api runs on api-6d4f8b9c7d-x2k9p",
    );
    expect(
      screen.queryByTestId("entity-detail-called-by"),
    ).not.toBeInTheDocument();
  });

  test("placements open in the Infrastructure view, calls stay on the map", () => {
    const onOpenInfrastructure: MockFunction = getJestMockFunction();
    const onSelectEntity: MockFunction = getJestMockFunction();
    renderService({ onOpenInfrastructure, onSelectEntity });
    fireEvent.click(
      screen.getByRole("button", {
        name: "View details for api-6d4f8b9c7d-x2k9p",
      }),
    );
    expect(onOpenInfrastructure).toHaveBeenCalledWith("pod");
    fireEvent.click(
      screen.getByRole("button", { name: "View details for orders" }),
    );
    expect(onSelectEntity).toHaveBeenCalledWith("pg");
  });

  test("a resource lists the services running on it as related infrastructure", () => {
    render(
      <EntityDetailPanel
        entity={POD}
        relationships={relationships}
        entityByKey={byKey}
        metricsWindowSeconds={60}
        onClose={() => {
          return undefined;
        }}
        onFocus={() => {
          return undefined;
        }}
      />,
    );
    expect(screen.getByTestId("entity-detail-related")).toHaveTextContent(
      "api runs on api-6d4f8b9c7d-x2k9p",
    );
    expect(
      screen.queryByTestId("entity-detail-runs-on"),
    ).not.toBeInTheDocument();
  });

  test("shows the attributes that identify a dependency", () => {
    render(
      <EntityDetailPanel
        entity={POSTGRES}
        relationships={relationships}
        entityByKey={byKey}
        metricsWindowSeconds={60}
        onClose={() => {
          return undefined;
        }}
        onFocus={() => {
          return undefined;
        }}
      />,
    );
    expect(screen.getByText("Database engine").parentElement).toHaveTextContent(
      "postgresql",
    );
    expect(screen.getByTestId("entity-detail-called-by")).toHaveTextContent(
      "api depends on orders",
    );
  });
});
