import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import fs from "fs";
import { createInstance, i18n } from "i18next";
import path from "path";
import React, { ReactElement, ReactNode } from "react";
import { I18nextProvider } from "react-i18next";

/*
 * A real BaseModelTable mounts a card, a header and a full table; give it
 * room when the whole Common suite competes for the box.
 */
configure({ asyncUtilTimeout: 15000 });

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
 * The custom field settings table, drawn for real: the shared two columns
 * (CustomFieldDefinitionTable) inside the BaseModelTable every settings page
 * renders, over a fake API that hands back only what the table asked for.
 *
 * The maintainer's ask was about what is on screen - "we just need to show
 * field name and field type here, and that's basically it" - so this checks
 * the screen: the header cells, the cells, what a German viewer reads, what
 * the table asks the API for and what its CSV says. The pages' wiring is
 * CustomFieldTablesTwoColumns.test.tsx.
 *
 * Permissions and the signed-in user are stubbed permissive; translation is
 * the real hook under an i18next instance, so the header and the type names
 * are looked up exactly as in the dashboard.
 */

jest.mock("../../../UI/Utils/Permission", () => {
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

jest.mock("../../../UI/Utils/User", () => {
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

import {
  CustomFieldDefinitionModel,
  getCustomFieldDefinitionColumns,
  getCustomFieldDefinitionFilters,
} from "../../../../App/FeatureSet/Dashboard/src/Components/CustomFields/CustomFieldDefinitionTable";
import IncidentCustomField from "../../../Models/DatabaseModels/IncidentCustomField";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import Query from "../../../Types/BaseDatabase/Query";
import CustomFieldType from "../../../Types/CustomField/CustomFieldType";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import { ButtonStyleType } from "../../../UI/Components/Button/Button";
import BaseModelTable, {
  BaseTableCallbacks,
  ComponentProps as BaseModelTableProps,
} from "../../../UI/Components/ModelTable/BaseModelTable";
import TableColumnsToCsv from "../../../UI/Utils/TableColumnsToCsv";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";

type DownloadedCsvFile = {
  csv: string;
  filename: string;
};

/*
 * Three incident custom fields with every setting the old table showed
 * filled in, so a column that came back would have something to show.
 */
const ROWS: Array<JSONObject> = [
  {
    _id: "field-1",
    name: "Impact",
    description: "How many customers are affected.",
    customFieldType: CustomFieldType.Dropdown,
    variableKey: "impact",
    showOnCreate: true,
    isRequiredOnCreate: true,
    includeInSubscriberNotifications: true,
    mapFromResourceType: "Monitor",
    mapFromCustomFieldName: "Customer Impact",
    sortOrder: 1,
  },
  {
    _id: "field-2",
    name: "Affected Systems",
    description: "Every system the incident touches.",
    customFieldType: CustomFieldType.MultiSelectDropdown,
    variableKey: "affected_systems",
    showOnCreate: false,
    includeInSubscriberNotifications: false,
    sortOrder: 2,
  },
  {
    _id: "field-3",
    name: "Workaround",
    description: "What customers can do meanwhile.",
    customFieldType: CustomFieldType.Markdown,
    variableKey: "workaround",
    sortOrder: 3,
  },
];

// Text that only the columns that were taken away could have put on screen.
const FORMER_COLUMN_TEXT: Array<string> = [
  "How many customers are affected.",
  "Every system the incident touches.",
  "{{incident.customFields.impact}}",
  "impact",
  "Customer Impact",
  "Monitor › Customer Impact",
  "Entered by hand",
  "MultiSelectDropdown",
];

const FORMER_HEADERS: Array<string> = [
  "Field Description",
  "Mapped From",
  "Order",
  "Show on Create",
  "Required on Create",
  "In Subscriber Notifications",
  "Template Variable",
];

const LOCALES_DIR: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

const readLocale: (locale: string) => Record<string, string> = (
  locale: string,
): Record<string, string> => {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${locale}.json`), "utf8"),
  ) as Record<string, string>;
};

/*
 * The API returns exactly the fields the request selected, so a column the
 * table stopped asking for cannot be drawn from a row that happened to have
 * it anyway.
 */
const projectRow: (row: JSONObject, select: JSONObject) => JSONObject = (
  row: JSONObject,
  select: JSONObject,
): JSONObject => {
  const projected: JSONObject = {};

  for (const key of Object.keys(select)) {
    const value: JSONValue | undefined = row[key];

    if (value !== undefined) {
      projected[key] = value;
    }
  }

  return projected;
};

const getHeaders: () => Array<string> = (): Array<string> => {
  return screen.getAllByRole("columnheader").map((header: HTMLElement) => {
    return (header.textContent || "").trim();
  });
};

describe("the custom field settings table, rendered", () => {
  let selects: Array<JSONObject> = [];
  let downloadedCsvFiles: Array<DownloadedCsvFile> = [];

  const english: i18n = createInstance();
  const german: i18n = createInstance();

  beforeAll(async () => {
    await english.init({
      lng: "en",
      fallbackLng: "en",
      resources: { en: { translation: readLocale("en") } },
      interpolation: { escapeValue: false },
    });

    await german.init({
      lng: "de",
      fallbackLng: "de",
      resources: { de: { translation: readLocale("de") } },
      interpolation: { escapeValue: false },
    });
  });

  const makeCallbacks: () => BaseTableCallbacks<CustomFieldDefinitionModel> =
    (): BaseTableCallbacks<CustomFieldDefinitionModel> => {
      return {
        deleteItem: async () => {
          return undefined;
        },
        getModelFromJSON: (item: JSONObject) => {
          return item as unknown as CustomFieldDefinitionModel;
        },
        getJSONFromModel: (item: CustomFieldDefinitionModel) => {
          return item as unknown as JSONObject;
        },
        addSlugToSelect: (select: unknown) => {
          return select;
        },
        getList: async (data: {
          query: Query<CustomFieldDefinitionModel>;
          limit: number;
          select: JSONObject;
        }): Promise<ListResult<CustomFieldDefinitionModel>> => {
          const select: JSONObject = (data.select ||
            {}) as unknown as JSONObject;

          selects.push(select);

          return {
            data: ROWS.map((row: JSONObject) => {
              return projectRow(row, select);
            }) as unknown as Array<CustomFieldDefinitionModel>,
            count: ROWS.length,
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
      } as unknown as BaseTableCallbacks<CustomFieldDefinitionModel>;
    };

  const renderTable: (data: {
    language: i18n;
    withBulkActions?: boolean;
  }) => void = (data: { language: i18n; withBulkActions?: boolean }): void => {
    const props: BaseModelTableProps<CustomFieldDefinitionModel> = {
      modelType: IncidentCustomField,
      id: "custom-fields-table",
      name: "Settings > Incident Custom Fields",
      userPreferencesKey: "custom-fields-table",
      cardProps: { title: "Incident Custom Fields" },
      columns: getCustomFieldDefinitionColumns(),
      filters: getCustomFieldDefinitionFilters(),
      isDeleteable: false,
      isCreateable: false,
      isViewable: false,
      isEditable: false,
      disableUrlState: true,
      callbacks: makeCallbacks(),
      ...(data.withBulkActions
        ? {
            bulkActions: {
              buttons: [
                {
                  title: "Archive",
                  buttonStyleType: ButtonStyleType.NORMAL,
                  onClick: async (): Promise<void> => {
                    return Promise.resolve();
                  },
                },
              ],
            },
          }
        : {}),
    } as unknown as BaseModelTableProps<CustomFieldDefinitionModel>;

    const Wrapper: (props: { children?: ReactNode }) => ReactElement = (props: {
      children?: ReactNode;
    }): ReactElement => {
      return (
        <I18nextProvider i18n={data.language}>{props.children}</I18nextProvider>
      );
    };

    render(<BaseModelTable<CustomFieldDefinitionModel> {...props} />, {
      wrapper: Wrapper,
    });
  };

  const waitForRows: () => Promise<void> = async (): Promise<void> => {
    await waitFor(() => {
      expect(selects.length).toBeGreaterThan(0);
    });

    await waitFor(() => {
      expect(screen.getByText("Affected Systems")).toBeInTheDocument();
    });
  };

  const click: (element: Element) => Promise<void> = async (
    element: Element,
  ): Promise<void> => {
    await act(async () => {
      fireEvent.click(element);
    });
  };

  beforeEach(() => {
    selects = [];
    downloadedCsvFiles = [];

    jest
      .spyOn(TableColumnsToCsv, "downloadCsv")
      .mockImplementation((data: DownloadedCsvFile): void => {
        downloadedCsvFiles.push(data);
      });

    window.history.replaceState(
      window.history.state,
      "",
      "/dashboard/project/incidents/settings/custom-fields",
    );
    TableFilterUrlState.resetClaimedKeys();
    window.localStorage.clear();
  });

  afterEach(() => {
    cleanup();
    jest.restoreAllMocks();
  });

  test("the header is Field Name and Field Type, and nothing else", async () => {
    renderTable({ language: english });
    await waitForRows();

    expect(getHeaders()).toEqual(["Field Name", "Field Type"]);

    for (const header of FORMER_HEADERS) {
      expect(
        screen.queryByRole("columnheader", { name: header }),
      ).not.toBeInTheDocument();
    }
  });

  test("each row reads as the field's name and the picker's name for its type", async () => {
    renderTable({ language: english });
    await waitForRows();

    expect(screen.getByText("Impact")).toBeInTheDocument();
    expect(screen.getByText("Dropdown (single select)")).toBeInTheDocument();
    expect(screen.getByText("Affected Systems")).toBeInTheDocument();
    expect(screen.getByText("Dropdown (multi-select)")).toBeInTheDocument();
    expect(screen.getByText("Workaround")).toBeInTheDocument();
    expect(screen.getByText("Rich text (Markdown)")).toBeInTheDocument();
  });

  test("nothing a removed column showed is on screen", async () => {
    renderTable({ language: english });
    await waitForRows();

    for (const text of FORMER_COLUMN_TEXT) {
      expect(screen.queryByText(text)).not.toBeInTheDocument();
    }
  });

  test("asks the API for the name and the type, not the settings the old columns showed", async () => {
    renderTable({ language: english });
    await waitForRows();

    const select: JSONObject = selects[selects.length - 1]!;

    expect(select["name"]).toBeTruthy();
    expect(select["customFieldType"]).toBeTruthy();

    for (const key of [
      "description",
      "variableKey",
      "showOnCreate",
      "isRequiredOnCreate",
      "includeInSubscriberNotifications",
      "mapFromResourceType",
      "mapFromCustomFieldName",
    ]) {
      expect({ key: key, selected: Boolean(select[key]) }).toEqual({
        key: key,
        selected: false,
      });
    }
  });

  test("a German viewer reads the header and the types in German", async () => {
    renderTable({ language: german });
    await waitForRows();

    expect(getHeaders()).toEqual(["Feldname", "Feldtyp"]);
    expect(screen.getByText("Dropdown (Einfachauswahl)")).toBeInTheDocument();
    expect(screen.getByText("Dropdown (Mehrfachauswahl)")).toBeInTheDocument();
    expect(
      screen.getByText("Formatierter Text (Markdown)"),
    ).toBeInTheDocument();
    expect(
      screen.queryByText("Dropdown (multi-select)"),
    ).not.toBeInTheDocument();
  });

  test("the CSV has the two columns, with each type as the picker names it", async () => {
    renderTable({ language: english, withBulkActions: true });

    const container: HTMLElement = document.body;

    await waitForRows();

    // The header checkbox selects every row and brings up the bulk bar.
    await waitFor(() => {
      expect(
        container.querySelectorAll('input[type="checkbox"]:not([disabled])')
          .length,
      ).toBeGreaterThan(0);
    });

    await click(container.querySelectorAll('input[type="checkbox"]')[0]!);
    await click(screen.getByText("Bulk Actions"));

    await waitFor(() => {
      expect(screen.queryByText("Export CSV")).not.toBeNull();
    });

    await click(screen.getByText("Export CSV"));

    await waitFor(() => {
      expect(downloadedCsvFiles.length).toBe(1);
    });

    const lines: Array<string> = (downloadedCsvFiles[0]?.csv || "").split(
      "\r\n",
    );

    expect(lines[0]).toBe("Field Name,Field Type");
    expect(lines).toContain("Impact,Dropdown (single select)");
    expect(lines).toContain("Affected Systems,Dropdown (multi-select)");
    expect(lines).toContain("Workaround,Rich text (Markdown)");
    expect(lines.join("\n")).not.toContain("MultiSelectDropdown");
  });
});
