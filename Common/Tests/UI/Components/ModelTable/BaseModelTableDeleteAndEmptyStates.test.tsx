import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
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

/*
 * Two sentences a table shows constantly, both of which used to say less than
 * they knew.
 *
 * The per-row delete confirmation said "Are you sure you want to delete this
 * monitor?" - equally true of the row that was clicked and of the twenty
 * either side of it, which is exactly the wrong moment to be vague. The table
 * has the row in hand when it renders that dialog.
 *
 * And an empty table said "No monitor" whether the project had nothing in it
 * or a search had simply missed, so a typo in the search box was
 * indistinguishable from an empty account.
 */

jest.mock("../../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return [];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return true;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../../UI/Utils/Translation", () => {
  return {
    __esModule: true,
    default: () => {
      return {
        translateString: (value: string | undefined): string | undefined => {
          return value;
        },
        translateValue: (value: unknown): unknown => {
          return value;
        },
      };
    },
  };
});

import BaseModelTable, {
  BaseTableCallbacks,
  ComponentProps as BaseModelTableProps,
} from "../../../../UI/Components/ModelTable/BaseModelTable";
import TableFilterUrlState from "../../../../UI/Utils/TableFilterUrlState";
import PermissionGate from "../../../../UI/Utils/PermissionGate";
import FieldType from "../../../../UI/Components/Types/FieldType";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import Incident from "../../../../Models/DatabaseModels/Incident";
import ListResult from "../../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../../Types/JSON";

const MONITOR_ROWS: Array<JSONObject> = [
  { _id: "monitor-1", name: "Checkout API", description: "Payments" },
  { _id: "monitor-2", name: "Billing Worker", description: "Invoices" },
];

// Incidents key on `title`, not `name` - the deriver has to know both.
const INCIDENT_ROWS: Array<JSONObject> = [
  { _id: "incident-1", title: "Checkout is down", description: "Sev1" },
];

// Neither `name` nor `title`, so the generic wording has to survive.
const UNNAMED_ROWS: Array<JSONObject> = [
  { _id: "monitor-9", description: "No name on this one" },
];

interface TableOptions {
  rows?: Array<JSONObject> | undefined;
  initialFilterData?: JSONObject | undefined;
  nameColumnTitle?: string | undefined;
  nameColumnField?: string | undefined;
  singularName?: string | undefined;
  pluralName?: string | undefined;
  noItemsMessage?: string | undefined;
}

type MakePropsFunction = (
  options: TableOptions,
) => BaseModelTableProps<Monitor>;

const makeProps: MakePropsFunction = (
  options: TableOptions,
): BaseModelTableProps<Monitor> => {
  const rows: Array<JSONObject> = options.rows ?? MONITOR_ROWS;

  const callbacks: BaseTableCallbacks<Monitor> = {
    deleteItem: async (): Promise<void> => {
      return undefined;
    },
    getModelFromJSON: (item: JSONObject): Monitor => {
      return item as unknown as Monitor;
    },
    getJSONFromModel: (item: Monitor): JSONObject => {
      return item as unknown as JSONObject;
    },
    addSlugToSelect: (select: unknown): unknown => {
      return select;
    },
    getList: async (data: {
      skip: number;
      limit: number;
    }): Promise<ListResult<Monitor>> => {
      return {
        data: rows as unknown as Array<Monitor>,
        count: rows.length,
        skip: data.skip,
        limit: data.limit,
      };
    },
    toJSONArray: (): Array<JSONObject> => {
      return [];
    },
    updateById: async (): Promise<void> => {
      return undefined;
    },
    showCreateEditModal: (): React.ReactElement => {
      return <div data-testid="create-edit-modal" />;
    },
  } as unknown as BaseTableCallbacks<Monitor>;

  return {
    modelType: options.nameColumnField === "title" ? Incident : Monitor,
    id: "monitors-table",
    name: "Monitors",
    singularName: options.singularName ?? "Monitor",
    pluralName: options.pluralName ?? "Monitors",
    userPreferencesKey: "monitors-delete-table",
    urlStateKey: "monitors-delete-table",
    columns: [
      {
        field: { [options.nameColumnField ?? "name"]: true },
        title: options.nameColumnTitle ?? "Name",
        type: FieldType.Text,
      },
      {
        field: { description: true },
        title: "Description",
        type: FieldType.LongText,
      },
    ],
    filters: [],
    cardProps: { title: "Monitors", description: "All monitors" },
    isCreateable: false,
    isEditable: false,
    isDeleteable: true,
    isViewable: false,
    noItemsMessage: options.noItemsMessage,
    initialFilterData: options.initialFilterData,
    callbacks: callbacks,
  } as unknown as BaseModelTableProps<Monitor>;
};

type RenderTableFunction = (
  options?: TableOptions | undefined,
) => ReturnType<typeof render>;

const renderTable: RenderTableFunction = (
  options?: TableOptions | undefined,
): ReturnType<typeof render> => {
  return render(<BaseModelTable<Monitor> {...makeProps(options || {})} />);
};

type FindButtonsFunction = (label: string) => Array<HTMLButtonElement>;

const findButtons: FindButtonsFunction = (
  label: string,
): Array<HTMLButtonElement> => {
  return Array.from(
    document.querySelectorAll<HTMLButtonElement>("button"),
  ).filter((button: HTMLButtonElement) => {
    return (button.textContent || "").trim().startsWith(label);
  });
};

beforeEach(() => {
  PermissionGate.clearPermissionPropsCache();
  window.history.replaceState(window.history.state, "", "/dashboard/monitors");
  TableFilterUrlState.resetClaimedKeys();
  window.localStorage.clear();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("per-row delete confirmation", () => {
  test("names the row that was clicked", async () => {
    renderTable();

    await waitFor(() => {
      expect(findButtons("Delete").length).toBeGreaterThan(0);
    });

    // Second row, to prove the dialog follows the click and not the first row.
    fireEvent.click(findButtons("Delete")[1]!);

    await waitFor(() => {
      expect(
        screen.getByTestId("confirm-modal-description"),
      ).toBeInTheDocument();
    });

    expect(screen.getByTestId("confirm-modal-description")).toHaveTextContent(
      'Are you sure you want to delete "Billing Worker"?',
    );
    expect(screen.getByTestId("confirm-modal-description")).toHaveTextContent(
      "This action cannot be undone",
    );
  });

  test("uses a title-keyed row's title", async () => {
    renderTable({
      rows: INCIDENT_ROWS,
      nameColumnField: "title",
      nameColumnTitle: "Title",
      singularName: "Incident",
      pluralName: "Incidents",
    });

    await waitFor(() => {
      expect(findButtons("Delete").length).toBeGreaterThan(0);
    });

    fireEvent.click(findButtons("Delete")[0]!);

    await waitFor(() => {
      expect(
        screen.getByTestId("confirm-modal-description"),
      ).toBeInTheDocument();
    });

    expect(screen.getByTestId("confirm-modal-description")).toHaveTextContent(
      'Are you sure you want to delete "Checkout is down"?',
    );
  });

  test("falls back to the generic wording when the row has no name to give", async () => {
    renderTable({ rows: UNNAMED_ROWS });

    await waitFor(() => {
      expect(findButtons("Delete").length).toBeGreaterThan(0);
    });

    fireEvent.click(findButtons("Delete")[0]!);

    await waitFor(() => {
      expect(
        screen.getByTestId("confirm-modal-description"),
      ).toBeInTheDocument();
    });

    expect(screen.getByTestId("confirm-modal-description")).toHaveTextContent(
      "Are you sure you want to delete this monitor?",
    );
  });
});

describe("empty table message", () => {
  test('says "yet", pluralised, when there is simply nothing here', async () => {
    renderTable({ rows: [] });

    await waitFor(() => {
      expect(screen.getByText("No monitors yet.")).toBeInTheDocument();
    });
  });

  test("still lets a caller supply its own empty-state copy", async () => {
    renderTable({ rows: [], noItemsMessage: "Connect your first monitor." });

    await waitFor(() => {
      expect(
        screen.getByText("Connect your first monitor."),
      ).toBeInTheDocument();
    });
  });

  /*
   * The other half of the same branch: an active filter means the emptiness is
   * the filter's doing, not the project's, and the caller's "create your first
   * one" copy would be the wrong thing to offer someone whose filter just
   * missed.
   */
  test("says the filter missed, when a filter is applied", async () => {
    renderTable({
      rows: [],
      initialFilterData: { name: "nothing-matches-this" },
      noItemsMessage: "Connect your first monitor.",
    });

    await waitFor(() => {
      expect(
        screen.getByText("No monitors match your search or filters."),
      ).toBeInTheDocument();
    });

    expect(
      screen.queryByText("Connect your first monitor."),
    ).not.toBeInTheDocument();
  });
});
