import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * What a card draws inside itself, drawn as a section of another card
 * (CardSections) - the cards of a page's More settings:
 *
 *   - a detail card's fields follow its header with no rule across the card
 *     (a rule across the card is the divider between two sections, so one
 *     there read as the start of a section without a title);
 *   - a table's grey footer and a list's grey end are square, the
 *     section's corners: the divider under them runs straight;
 *   - a switch card's row follows its header with no rule either, and still
 *     runs from edge to edge.
 *
 * On a page every one of them is drawn exactly as before.
 */

const getItemMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return ["ProjectOwner"];
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

jest.mock("../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      updateById: (...args: Array<unknown>): unknown => {
        return updateByIdMock(...args);
      },
    },
  };
});

import CardSections from "../../../UI/Components/Card/CardSections";
import {
  CARD_RULED_BODY_CLASS_NAME,
  CARD_SECTION_RULED_BODY_CLASS_NAME,
} from "../../../UI/Components/Card/CardSurface";
import CardModelDetail, {
  CARD_MODEL_DETAIL_BODY_CLASS_NAME,
  CARD_MODEL_DETAIL_SECTION_BODY_CLASS_NAME,
} from "../../../UI/Components/ModelDetail/CardModelDetail";
import List from "../../../UI/Components/List/List";
import ModelSwitchCard from "../../../UI/Components/ModelSwitch/ModelSwitchCard";
import Table from "../../../UI/Components/Table/Table";
import Columns from "../../../UI/Components/Table/Types/Columns";
import FieldType from "../../../UI/Components/Types/FieldType";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../Types/ObjectID";

const MONITOR_ID: string = "11111111-1111-4111-8111-111111111111";
const STATUS_PAGE_ID: string = "6b6b6b6b-0000-4000-8000-0000000000aa";

beforeEach(() => {
  PermissionGate.clearPermissionPropsCache();

  getItemMock.mockReset();
  getItemMock.mockImplementation(
    async (data: unknown): Promise<Monitor | StatusPage> => {
      const modelType: unknown = (data as { modelType: unknown }).modelType;

      if (modelType === StatusPage) {
        const statusPage: StatusPage = new StatusPage();
        statusPage._id = STATUS_PAGE_ID;
        statusPage.enableSearchEngineIndexing = true;
        return statusPage;
      }

      const monitor: Monitor = new Monitor();
      monitor._id = MONITOR_ID;
      monitor.name = "Checkout API";
      return monitor;
    },
  );

  updateByIdMock.mockReset();
  updateByIdMock.mockImplementation(async (): Promise<unknown> => {
    return {};
  });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function inSections(element: ReactElement): ReactElement {
  return <CardSections>{element}</CardSections>;
}

function classTokens(element: Element): Array<string> {
  return (element.getAttribute("class") || "")
    .split(/\s+/)
    .filter((token: string): boolean => {
      return token.length > 0;
    });
}

/*
 * ---------------------------------------------------------------------------
 * A detail card
 * ---------------------------------------------------------------------------
 */

function monitorCard(): ReactElement {
  return (
    <CardModelDetail<Monitor>
      name="Monitor Details"
      cardProps={{
        title: "Monitor Details",
        description: "What this monitor is.",
      }}
      isEditable={true}
      editButtonText="Edit"
      formFields={[
        {
          field: { name: true },
          title: "Name",
          fieldType: FormFieldSchemaType.Text,
          required: true,
        },
      ]}
      modelDetailProps={{
        modelType: Monitor,
        id: "monitor-detail",
        modelId: new ObjectID(MONITOR_ID),
        fields: [
          {
            field: { name: true },
            title: "Name",
            fieldType: FieldType.Text,
          },
        ],
      }}
    />
  );
}

describe("a detail card's fields", () => {
  test("on a page they sit under a rule across the card, as they always did", async () => {
    render(monitorCard());

    await screen.findByText("Checkout API");

    const body: HTMLElement = screen.getByTestId("card-model-detail-body");

    expect(CARD_MODEL_DETAIL_BODY_CLASS_NAME).toBe(
      "border-t border-gray-200 px-4 py-5 sm:px-6 -m-6 -mt-2",
    );
    expect(classTokens(body)).toEqual(
      CARD_MODEL_DETAIL_BODY_CLASS_NAME.split(" "),
    );
  });

  test("in a section they follow the header: no rule across the card, no box of their own", async () => {
    render(inSections(monitorCard()));

    await screen.findByText("Checkout API");

    const body: HTMLElement = screen.getByTestId("card-model-detail-body");

    expect(classTokens(body)).toEqual(
      CARD_MODEL_DETAIL_SECTION_BODY_CLASS_NAME.split(" "),
    );
    expect(classTokens(body)).not.toContain("border-t");
    expect(
      classTokens(body).some((token: string): boolean => {
        return token.startsWith("-m");
      }),
    ).toBe(false);
    expect(screen.getByTestId("card")).toHaveAttribute(
      "data-card-surface",
      "section",
    );
  });

  test("in a section it keeps its fields and its Edit, which opens the edit dialog as a card of its own", async () => {
    render(inSections(monitorCard()));

    await screen.findByText("Checkout API");

    const section: HTMLElement = screen.getByTestId("card");
    const edit: HTMLElement = within(section).getByRole("button", {
      name: "Edit",
    });

    expect(within(section).getByText("Checkout API")).toBeInTheDocument();

    fireEvent.click(edit);

    const dialog: HTMLElement = await screen.findByRole("dialog");

    expect(
      await within(dialog).findByText("Name", {}, { timeout: 5000 }),
    ).toBeInTheDocument();
    // The dialog is not drawn inside the section it was opened from.
    expect(dialog.closest("[data-card-surface='section']")).toBeNull();
  });
});

/*
 * ---------------------------------------------------------------------------
 * A table's footer, a list's grey end
 * ---------------------------------------------------------------------------
 */

interface Row {
  _id?: string | undefined;
  name?: string | undefined;
}

const columns: Columns<Row> = [{ title: "Name", type: FieldType.Text, key: "name" }];

function rulesTable(data: Array<Row>): ReactElement {
  return (
    <Table<Row>
      id="rules-table"
      data={data}
      columns={columns}
      currentPageNumber={1}
      totalItemsCount={data.length}
      itemsOnPage={10}
      error=""
      isLoading={false}
      singularLabel="Rule"
      pluralLabel="Rules"
      sortOrder={SortOrder.Ascending}
      sortBy={null}
      onSortChanged={(): void => {}}
      onNavigateToPage={(): void => {}}
    />
  );
}

const ROWS: Array<Row> = [
  { _id: "1", name: "Production incidents" },
  { _id: "2", name: "Payments" },
];

describe("a table's footer", () => {
  test("on a page it is rounded with the card's bottom corners", () => {
    render(rulesTable(ROWS));

    const footer: HTMLElement = screen.getByTestId("table-footer");

    expect(footer).toHaveClass(
      "bg-gray-50",
      "md:-mx-6",
      "-mb-6",
      "overflow-hidden",
      "rounded-b-xl",
    );
  });

  test("in a section it is square, so the divider under it runs straight", () => {
    render(inSections(rulesTable(ROWS)));

    const footer: HTMLElement = screen.getByTestId("table-footer");

    expect(footer).not.toHaveClass("rounded-b-xl");
    // Still flush with the section's edges and its bottom.
    expect(footer).toHaveClass("bg-gray-50", "md:-mx-6", "-mb-6");
  });

  test("in a section the table still pages and counts its rows", () => {
    render(inSections(rulesTable(ROWS)));

    expect(screen.getByText("Production incidents")).toBeInTheDocument();
    expect(screen.getByText("Payments")).toBeInTheDocument();
    expect(screen.getByTestId("table-footer")).toHaveTextContent("2");
  });
});

describe("a list's grey end", () => {
  function emptyList(): ReactElement {
    return (
      <List<{ id: string; name: string }>
        id="rules-list"
        data={[]}
        fields={[
          {
            title: "Name",
            key: "name",
            fieldType: FieldType.Text,
            colSpan: 1,
          },
        ]}
        onNavigateToPage={(): void => {}}
        currentPageNumber={1}
        totalItemsCount={0}
        itemsOnPage={10}
        error=""
        isLoading={false}
        singularLabel="Rule"
        pluralLabel="Rules"
      />
    );
  }

  test("on a page it is rounded with the card's bottom corners", () => {
    render(emptyList());

    expect(screen.getByTestId("list-footer")).toHaveClass(
      "-mb-6",
      "h-6",
      "bg-gray-50",
      "rounded-b-xl",
    );
  });

  test("in a section it is square", () => {
    render(inSections(emptyList()));

    const end: HTMLElement = screen.getByTestId("list-footer");

    expect(end).toHaveClass("-mb-6", "h-6", "bg-gray-50");
    expect(end).not.toHaveClass("rounded-b-xl");
  });
});

/*
 * ---------------------------------------------------------------------------
 * A switch card
 * ---------------------------------------------------------------------------
 */

const SWITCH_TEST_ID: string = "search-indexing-switch";

function searchIndexingCard(): ReactElement {
  return (
    <ModelSwitchCard<StatusPage>
      modelType={StatusPage}
      modelId={new ObjectID(STATUS_PAGE_ID)}
      column="enableSearchEngineIndexing"
      cardTitle="Search Engine Indexing"
      cardDescription="Whether search engines may list this status page."
      title="Allow Search Engines to Index this Status Page"
      dataTestId={SWITCH_TEST_ID}
    />
  );
}

describe("a switch card's row", () => {
  beforeEach(() => {
    getJestSpyOn(PermissionGate, "checkColumnUpdate").mockImplementation(
      (): PermissionGateResult => {
        return { isAllowed: true };
      },
    );
  });

  async function ruledBody(): Promise<HTMLElement> {
    await screen.findByTestId(SWITCH_TEST_ID);

    return screen.getByTestId(`${SWITCH_TEST_ID}-card`)
      .firstElementChild as HTMLElement;
  }

  test("on a page it sits under a rule across the card, edge to edge", async () => {
    render(searchIndexingCard());

    expect(classTokens(await ruledBody())).toEqual(
      CARD_RULED_BODY_CLASS_NAME.split(" "),
    );
  });

  test("in a section it follows the header with no rule, still edge to edge", async () => {
    render(inSections(searchIndexingCard()));

    const body: HTMLElement = await ruledBody();

    expect(classTokens(body)).toEqual(
      CARD_SECTION_RULED_BODY_CLASS_NAME.split(" "),
    );
    expect(body).not.toHaveClass("border-t");
    expect(body).toHaveClass("-mx-5", "md:-mx-6");
  });

  test("in a section the switch still saves when it is flipped", async () => {
    render(inSections(searchIndexingCard()));

    const control: HTMLElement = await screen.findByTestId(SWITCH_TEST_ID);

    expect(control).toHaveAttribute("aria-checked", "true");

    fireEvent.click(control);

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });
  });
});
