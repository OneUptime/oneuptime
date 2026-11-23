import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import * as React from "react";
import {
  MemoryRouter,
  Outlet,
  Route as RouterRoute,
  Routes,
} from "react-router-dom";
import TableOverviewPage from "../../../../App/FeatureSet/Dashboard/src/Pages/DataObservability/TableView/Overview";
import { TableViewOutletContext } from "../../../../App/FeatureSet/Dashboard/src/Pages/DataObservability/TableView/TableViewContext";
import StoreOverviewPage from "../../../../App/FeatureSet/Dashboard/src/Pages/DataObservability/View/Overview";
import { StoreViewOutletContext } from "../../../../App/FeatureSet/Dashboard/src/Pages/DataObservability/View/StoreViewContext";
import PipelineOverviewPage from "../../../../App/FeatureSet/Dashboard/src/Pages/DataPipeline/View/Overview";
import DataProductOverviewPage from "../../../../App/FeatureSet/Dashboard/src/Pages/DataProduct/View/Overview";
import InventoryItemOverview from "../../../../App/FeatureSet/Dashboard/src/Pages/Inventory/View/Index";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import DataAsset from "../../../Models/DatabaseModels/DataAsset";
import DataPipeline from "../../../Models/DatabaseModels/DataPipeline";
import DataProduct from "../../../Models/DatabaseModels/DataProduct";
import DataStore from "../../../Models/DatabaseModels/DataStore";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import InventoryItem from "../../../Models/DatabaseModels/InventoryItem";
import User from "../../../Models/DatabaseModels/User";
import Route from "../../../Types/API/Route";
import RecordActorType from "../../../Types/Database/RecordActor";
import {
  DataObservabilityCollector,
  DataObservabilityStoreSummary,
} from "../../../Types/DataObservability/DataObservabilityApiTypes";
import Email from "../../../Types/Email";
import Name from "../../../Types/Name";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import { getJestSpyOn } from "../../Spy";

/*
 * WHO CREATED AND WHO LAST MODIFIED A RECORD, ON THE OVERVIEWS THAT DRAW
 * THEIR LINE BY HAND (#10461).
 *
 * A details card drawn by ModelDetail reads who created the record and who
 * last modified it with the record. These overviews draw no such card - a
 * Data Observability table's Details are a page's own facts, a store's, a
 * pipeline's and a data product's first card is their row of figures, an
 * inventory item's is its header - so each draws RecordActivityLine at the
 * foot of its first card, which reads those columns of the record in one
 * small read of its own. Drawn here as the reader sees them: the record's
 * ID, "Created by", "Last modified by", in the card they end.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

// The runs of a pipeline and the tables of a data product: lists of their own.
jest.mock("../../../UI/Components/ModelTable/ModelTable", () => {
  return {
    __esModule: true,
    default: (): null => {
      return null;
    },
  };
});

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/DataObservability/PipelineLineageDiagram",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return React.createElement("div", { "data-testid": "lineage" });
      },
    };
  },
);

// An inventory item as its page reads it, and the cards under its header.
let mockInventoryItem: unknown = null;

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Inventory/useInventoryItem",
  () => {
    return {
      __esModule: true,
      default: (): unknown => {
        return {
          item: mockInventoryItem,
          isLoading: false,
          error: "",
          reload: (): void => {
            return;
          },
        };
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Inventory/InventoryAssetDetailsCard",
  () => {
    return {
      __esModule: true,
      default: (): React.ReactElement => {
        return React.createElement("div", {
          "data-testid": "inventory-asset-details",
        });
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityConnections/ResourceSecurityCard",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/CustomFields/OverviewCustomFields",
  () => {
    return {
      __esModule: true,
      default: (): null => {
        return null;
      },
    };
  },
);

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Inventory/ResolveTypedRowLink",
  () => {
    return {
      __esModule: true,
      resolveTypedRowLink: async (): Promise<null> => {
        return null;
      },
    };
  },
);

const PROJECT_ID: string = "10461000-0000-4000-8000-000000000001";
const RECORD_ID: string = "10461000-0000-4000-8000-0000000000a1";
const CREATED_AT: Date = new Date("2026-09-30T13:25:00.000Z");
const MODIFIED_AT: Date = new Date("2026-11-19T09:12:00.000Z");

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route(`/dashboard/${PROJECT_ID}/data-observability`),
  currentProject: null,
  hasPaymentMethod: true,
};

interface Read {
  modelType: unknown;
  id: string;
  select: Record<string, unknown>;
}

let reads: Array<Read> = [];
// What a page's own read of its record answers, by the record's kind.
let pageRecords: Map<unknown, BaseModel> = new Map<unknown, BaseModel>();

function person(name: string, email: string): User {
  const user: User = new User();
  user._id = ObjectID.generate().toString();
  user.name = new Name(name);
  user.email = new Email(email);
  return user;
}

// The record as the line's read finds it: who created it and who changed it.
function withActivity(model: BaseModel): BaseModel {
  model._id = RECORD_ID;
  Object.assign(model, {
    createdAt: CREATED_AT,
    createdByActorType: RecordActorType.User,
    createdByUser: person("Maya Chen", "maya@example.com"),
    lastModifiedAt: MODIFIED_AT,
    lastModifiedByActorType: RecordActorType.User,
    lastModifiedByUser: person("Sam Rivera", "sam@example.com"),
  });
  return model;
}

// The line's own read: those columns alone.
function isRecordLineRead(read: Read): boolean {
  return Boolean(read.select["createdByActorType"]);
}

beforeEach(() => {
  reads = [];
  pageRecords = new Map<unknown, BaseModel>();
  mockInventoryItem = null;

  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );
  getJestSpyOn(PermissionGate, "check").mockReturnValue({ isAllowed: true });
  // A reader who may read the columns, so the line asks for them.
  getJestSpyOn(PermissionGate, "canReadColumn").mockReturnValue(true);
  getJestSpyOn(Navigation, "navigate").mockImplementation((): void => {
    return;
  });
  getJestSpyOn(Navigation, "getLastParamAsObjectID").mockReturnValue(
    new ObjectID(RECORD_ID),
  );
  getJestSpyOn(ModelAPI, "getItem").mockImplementation((async (options: {
    modelType: { new (): BaseModel };
    id: ObjectID;
    select: Record<string, unknown>;
  }): Promise<BaseModel | null> => {
    const read: Read = {
      modelType: options.modelType,
      id: options.id.toString(),
      select: options.select || {},
    };

    reads.push(read);

    if (isRecordLineRead(read)) {
      return withActivity(new options.modelType());
    }

    return pageRecords.get(options.modelType) || null;
  }) as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

// The record's line, once it has read who made the record and who changed it.
async function findRecordLine(): Promise<HTMLElement> {
  const createdBy: HTMLElement = await screen.findByTestId("detail-created-by");

  return createdBy.closest('[data-testid="detail-record-line"]') as HTMLElement;
}

// What the line says, and that it read it in one read of its own, by the ID.
function expectTheLine(line: HTMLElement, modelType: unknown): void {
  expect(within(line).getByTestId("detail-id-line")).toBeInTheDocument();
  expect(within(line).getByTestId("detail-created-by")).toHaveTextContent(
    "Created by Maya Chen",
  );
  expect(within(line).getByTestId("detail-last-modified-by")).toHaveTextContent(
    "Last modified by Sam Rivera",
  );
  expect(screen.getAllByTestId("detail-record-line")).toHaveLength(1);

  const lineReads: Array<Read> = reads.filter(isRecordLineRead);

  expect(lineReads).toHaveLength(1);
  expect(lineReads[0]!.modelType).toBe(modelType);
  expect(lineReads[0]!.id).toBe(RECORD_ID);
  expect(lineReads[0]!.select).toEqual(
    expect.objectContaining({
      createdAt: true,
      createdByActorType: true,
      createdByUser: { name: true, email: true },
      lastModifiedAt: true,
      lastModifiedByActorType: true,
      lastModifiedByUser: { name: true, email: true },
    }),
  );
}

// Whether `first` comes before `second` in the page.
function isBefore(first: Node, second: Node): boolean {
  return Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

function storeSummary(): DataObservabilityStoreSummary {
  return {
    dataStoreId: RECORD_ID,
    name: "warehouse",
    kind: "PostgreSQL",
    isTableHealthEnabled: true,
    collector: DataObservabilityCollector.OneUptime,
    probeName: null,
    status: "Collected",
    message: null,
    collectedAt: MODIFIED_AT.toISOString(),
    attemptedAt: MODIFIED_AT.toISOString(),
    assetCount: 12,
    lateAssetCount: 0,
    alertMonitorCount: 1,
  };
}

describe("a Data Observability table's Overview", () => {
  function TableLayout(): React.ReactElement {
    const dataAsset: DataAsset = new DataAsset();
    dataAsset._id = RECORD_ID;
    dataAsset.name = "orders";
    dataAsset.dataStoreName = "warehouse";
    dataAsset.dataStoreKind = "PostgreSQL";
    dataAsset.schemaName = "public";

    const context: TableViewOutletContext = {
      dataAssetId: new ObjectID(RECORD_ID),
      dataAsset: dataAsset,
      refresh: (): void => {
        return;
      },
    };

    return <Outlet context={context} />;
  }

  test("ends its Details card with the table's line, under its facts and before its description", async () => {
    await act(async () => {
      render(
        <MemoryRouter initialEntries={["/table"]}>
          <Routes>
            <RouterRoute path="/table" element={<TableLayout />}>
              <RouterRoute
                index
                element={<TableOverviewPage {...PAGE_PROPS} />}
              />
            </RouterRoute>
          </Routes>
        </MemoryRouter>,
      );
    });

    const line: HTMLElement = await findRecordLine();

    expectTheLine(line, DataAsset);
    // Under the Details card's last fact, and before the next card.
    expect(isBefore(screen.getByText("Last Collected"), line)).toBe(true);
    expect(isBefore(line, screen.getByText("Description"))).toBe(true);
    // Ruled off the facts, as a details card's line is.
    expect(line).toHaveClass("mt-4", "border-t", "border-gray-100", "pt-3");
  });
});

describe("a Data Observability store's Overview", () => {
  function StoreLayout(): React.ReactElement {
    const context: StoreViewOutletContext = {
      dataStoreId: new ObjectID(RECORD_ID),
      store: storeSummary(),
      refresh: (): void => {
        return;
      },
    };

    return <Outlet context={context} />;
  }

  test("ends its first card, the database's figures, with the store's line", async () => {
    await act(async () => {
      render(
        <MemoryRouter initialEntries={["/store"]}>
          <Routes>
            <RouterRoute path="/store" element={<StoreLayout />}>
              <RouterRoute
                index
                element={<StoreOverviewPage {...PAGE_PROPS} />}
              />
            </RouterRoute>
          </Routes>
        </MemoryRouter>,
      );
    });

    const line: HTMLElement = await findRecordLine();
    const figures: HTMLElement = screen.getByRole("group", {
      name: "Database health",
    });

    expectTheLine(line, DataStore);
    expect(within(figures).getByTestId("event-stat-bar-footer")).toBe(
      figures.lastElementChild,
    );
    expect(figures.lastElementChild).toContainElement(line);
  });
});

describe("a pipeline's Overview", () => {
  test("ends its first card, the pipeline's figures, with its line", async () => {
    const pipeline: DataPipeline = new DataPipeline();
    pipeline._id = RECORD_ID;
    pipeline.runCount = 3;
    pageRecords.set(DataPipeline, pipeline);

    await act(async () => {
      render(
        <MemoryRouter initialEntries={[`/pipelines/${RECORD_ID}`]}>
          <Routes>
            <RouterRoute
              path="/pipelines/:id"
              element={<PipelineOverviewPage {...PAGE_PROPS} />}
            />
          </Routes>
        </MemoryRouter>,
      );
    });

    const line: HTMLElement = await findRecordLine();
    const figures: HTMLElement = screen.getByRole("group", {
      name: "Pipeline health",
    });

    expectTheLine(line, DataPipeline);
    expect(figures.lastElementChild).toContainElement(line);
    // Before the lineage, the page's next card.
    expect(isBefore(line, screen.getByTestId("lineage"))).toBe(true);
    // The page's own read of the pipeline is apart from the line's.
    expect(
      reads.filter((read: Read): boolean => {
        return read.modelType === DataPipeline && !isRecordLineRead(read);
      }),
    ).toHaveLength(1);
  });
});

describe("a data product's Overview", () => {
  test("ends its first card, the data product's figures, with its line", async () => {
    const product: DataProduct = new DataProduct();
    product._id = RECORD_ID;
    product.name = "Revenue";
    product.dataAssets = [];
    pageRecords.set(DataProduct, product);

    await act(async () => {
      render(
        <MemoryRouter initialEntries={[`/products/${RECORD_ID}`]}>
          <Routes>
            <RouterRoute
              path="/products/:id"
              element={<DataProductOverviewPage {...PAGE_PROPS} />}
            />
          </Routes>
        </MemoryRouter>,
      );
    });

    const line: HTMLElement = await findRecordLine();
    const figures: HTMLElement = screen.getByRole("group", {
      name: "Data product freshness",
    });

    expectTheLine(line, DataProduct);
    expect(figures.lastElementChild).toContainElement(line);
    expect(isBefore(line, screen.getByText("Status Page and SLO"))).toBe(true);
  });
});

describe("an inventory item's Overview", () => {
  test("ends its first card, the item's header, with its line, before its asset details", async () => {
    const item: InventoryItem = new InventoryItem();
    item._id = RECORD_ID;
    item.displayName = "edge-router-01";
    item.entityKey = "host:edge-router-01";
    item.labels = ["network"];
    mockInventoryItem = item;

    await act(async () => {
      render(
        <MemoryRouter>
          <InventoryItemOverview {...PAGE_PROPS} />
        </MemoryRouter>,
      );
    });

    const line: HTMLElement = await findRecordLine();

    expectTheLine(line, InventoryItem);
    // After what the header says - its labels last - and before the next card.
    expect(isBefore(screen.getByText("network"), line)).toBe(true);
    expect(isBefore(line, screen.getByTestId("inventory-asset-details"))).toBe(
      true,
    );
    expect(line).toHaveClass("border-t", "border-gray-100", "pt-3");
  });
});
