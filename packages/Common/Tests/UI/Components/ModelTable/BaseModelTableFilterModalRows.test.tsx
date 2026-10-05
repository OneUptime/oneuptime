import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import i18next from "i18next";
import { initReactI18next } from "react-i18next";
import React, { ReactElement } from "react";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * Permissions and the signed-in user are stubbed to their permissive form.
 * Translation is not: the filter form is rendered with i18next set up the way
 * the Dashboard sets it up, because the crash this guards against only shows
 * with translations on (see Filters/FilterRowsChangeFilter.test.tsx).
 */
jest.mock("../../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: () => {
        return [];
      },
      getProjectPermissions: () => {
        return [];
      },
      getGlobalPermissions: () => {
        return [];
      },
    },
  };
});

jest.mock("../../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: () => {
        return true;
      },
      getUserId: () => {
        return null;
      },
    },
  };
});

import BaseModelTable, {
  BaseTableCallbacks,
  ComponentProps as BaseModelTableProps,
} from "../../../../UI/Components/ModelTable/BaseModelTable";
import TableFilterUrlState from "../../../../UI/Utils/TableFilterUrlState";
import Filter from "../../../../UI/Components/ModelFilter/Filter";
import FieldType from "../../../../UI/Components/Types/FieldType";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import Label from "../../../../Models/DatabaseModels/Label";
import ListResult from "../../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../../Types/JSON";

/*
 * The filter modal of a real table. BaseModelTable fetches every entity
 * filter's options when the modal opens and only then hands the form its
 * list of filters, each with its options. When the page's filters change
 * while the modal is open, the table fetches again and the form is handed
 * the new list in place of the old one. The form's rows are keyed by
 * position, so a row can now hold a filter of another type: here the date
 * filter put in front moves the text and entity filters down a row.
 *
 * Every filter component used to call the translation hook above its "not
 * my filter" return and its own state below it, so that change made React
 * throw "Rendered more hooks than during the previous render" and unmount
 * the whole table.
 */

const GERMAN: Record<string, string> = {
  "Filter by {{field}}": "Nach {{field}} filtern",
};

const NAME_FILTER: Filter<Monitor> = {
  title: "Name",
  type: FieldType.Text,
  field: { name: true },
} as unknown as Filter<Monitor>;

const LABELS_FILTER: Filter<Monitor> = {
  title: "Labels",
  type: FieldType.EntityArray,
  field: { labels: { name: true, color: true } },
  filterEntityType: Label,
  filterQuery: {},
  filterDropdownField: { label: "name", value: "_id" },
} as unknown as Filter<Monitor>;

const CREATED_FILTER: Filter<Monitor> = {
  title: "Created",
  type: FieldType.Date,
  field: { createdAt: true },
} as unknown as Filter<Monitor>;

const FORM_ID: string = "monitors-filter-modal-table-filter-form";

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "de",
    fallbackLng: false,
    resources: { de: { translation: GERMAN } },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

describe("BaseModelTable filter modal", () => {
  /*
   * The labels request waits for the test to answer it, so each step can
   * check what the modal shows before and after the options arrive.
   */
  let answerLabelsRequest: (() => void) | null = null;

  type MakePropsFunction = (
    filters: Array<Filter<Monitor>>,
  ) => BaseModelTableProps<Monitor>;

  const makeProps: MakePropsFunction = (
    filters: Array<Filter<Monitor>>,
  ): BaseModelTableProps<Monitor> => {
    const callbacks: BaseTableCallbacks<Monitor> = {
      deleteItem: async () => {
        return undefined;
      },
      getModelFromJSON: (item: JSONObject) => {
        return item as unknown as Monitor;
      },
      getJSONFromModel: (item: Monitor) => {
        return item as unknown as JSONObject;
      },
      addSlugToSelect: (select: unknown) => {
        return select;
      },
      getList: async (data: {
        modelType: unknown;
        limit: number;
      }): Promise<ListResult<Monitor>> => {
        if (data.modelType !== Label) {
          return { data: [], count: 0, skip: 0, limit: data.limit };
        }

        await new Promise<void>((resolve: () => void) => {
          answerLabelsRequest = resolve;
        });

        const production: Label = new Label();
        production._id = "0192f2ce-1b1a-7000-8000-0000000000aa";
        production.name = "Production";

        return {
          data: [production as unknown as Monitor],
          count: 1,
          skip: 0,
          limit: data.limit,
        };
      },
      toJSONArray: () => {
        return [];
      },
      updateById: async () => {
        return undefined;
      },
      showCreateEditModal: () => {
        return <></>;
      },
    } as unknown as BaseTableCallbacks<Monitor>;

    return {
      modelType: Monitor,
      id: "monitors-filter-modal-table",
      name: "Monitors",
      singularName: "Monitor",
      pluralName: "Monitors",
      userPreferencesKey: "monitors-filter-modal-table",
      columns: [{ field: { name: true }, title: "Name", type: FieldType.Text }],
      filters: filters,
      cardProps: { title: "Monitors", description: "All monitors" },
      isDeleteable: false,
      isCreateable: false,
      isViewable: false,
      isEditable: false,
      callbacks: callbacks,
    } as unknown as BaseModelTableProps<Monitor>;
  };

  function table(filters: Array<Filter<Monitor>>): ReactElement {
    return <BaseModelTable<Monitor> {...makeProps(filters)} />;
  }

  // The label of each row of the filter form, top to bottom.
  function formRows(): Array<string> {
    const form: HTMLElement | null = document.getElementById(FORM_ID);

    if (!form) {
      return [];
    }

    return Array.from(form.querySelectorAll("label")).map(
      (label: HTMLLabelElement): string => {
        return label.textContent || "";
      },
    );
  }

  async function answerTheLabelsRequest(): Promise<void> {
    await waitFor(() => {
      expect(answerLabelsRequest).not.toBeNull();
    });

    const answer: () => void = answerLabelsRequest!;
    answerLabelsRequest = null;

    await act(async () => {
      answer();
    });
  }

  beforeEach(() => {
    answerLabelsRequest = null;
    window.history.replaceState(
      window.history.state,
      "",
      "/dashboard/monitors",
    );
    TableFilterUrlState.resetClaimedKeys();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
  });

  test("the form keeps drawing when the table's filters change while it is open", async () => {
    const view: ReturnType<typeof render> = render(
      table([NAME_FILTER, LABELS_FILTER]),
    );

    fireEvent.click(
      await screen.findByRole("button", { name: "More options" }),
    );
    fireEvent.click(screen.getByRole("menuitem", { name: "Filter" }));

    await answerTheLabelsRequest();

    await waitFor(() => {
      expect(formRows()).toEqual(["Name", "Labels"]);
    });
    expect(
      screen.getByPlaceholderText("Nach Name filtern"),
    ).toBeInTheDocument();
    expect(screen.getByText("Nach Labels filtern")).toBeInTheDocument();

    view.rerender(table([CREATED_FILTER, NAME_FILTER, LABELS_FILTER]));

    await answerTheLabelsRequest();

    await waitFor(() => {
      expect(formRows()).toEqual(["Created", "Name", "Labels"]);
    });
    expect(
      screen.getByPlaceholderText("Nach Created filtern"),
    ).toBeInTheDocument();
    expect(
      screen.getByPlaceholderText("Nach Name filtern"),
    ).toBeInTheDocument();
    expect(screen.getByText("Nach Labels filtern")).toBeInTheDocument();
  });
});
