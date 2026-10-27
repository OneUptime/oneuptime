import Monitor from "../../../Models/DatabaseModels/Monitor";
import { DropdownOption } from "../../../UI/Components/Dropdown/Dropdown";
import EntityDropdown, {
  EntityDropdownProps,
} from "../../../UI/Components/EntityDropdown/EntityDropdown";
import {
  ENTITY_DROPDOWN_EMPTY_LIST_COPY,
  getEntityDropdownEmptyListText,
} from "../../../UI/Components/EntityDropdown/EntityDropdownEmptyList";
import FormField from "../../../UI/Components/Forms/Fields/FormField";
import Field from "../../../UI/Components/Forms/Types/Field";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../UI/Components/Forms/Types/FormValues";
import { JSONObject } from "../../../Types/JSON";
import getJestMockFunction, { MockFunction } from "../../../Tests/MockType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import fs from "fs";
import path from "path";
import React from "react";

/*
 * WHAT AN OPEN ENTITYDROPDOWN SAYS WHEN IT HAS NOTHING TO LIST
 * (EntityDropdownEmptyList).
 *
 * It said "No options." - for a project with no repository, no MCP server
 * or no runbook alike, and also when every entry was already picked, which
 * read as though there had never been any. It now says what it is: nothing
 * to pick yet (or what the field names as missing), all of them picked, or
 * no match for the search.
 */

const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
    },
  };
});

const DASHBOARD_LOCALES: string = path.join(
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

const TEAMS: Array<DropdownOption> = [
  { value: "members", label: "Members" },
  { value: "admins", label: "Admins" },
];

function monitors(count: number): Array<Monitor> {
  const list: Array<Monitor> = [];

  for (let index: number = 0; index < count; index++) {
    const monitor: Monitor = new Monitor();
    monitor._id = `bbbbbbbb-bbbb-4bbb-8bbb-${String(index).padStart(12, "0")}`;
    monitor.name = `Monitor ${index}`;
    list.push(monitor);
  }

  return list;
}

function emptyList(): HTMLElement {
  return screen.getByTestId("entity-dropdown-empty-list");
}

async function openList(): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(screen.getByRole("combobox", { name: "Team" }));
  });
}

function renderDropdown(props: Partial<EntityDropdownProps>): void {
  render(<EntityDropdown ariaLabel="Team" options={TEAMS} {...props} />);
}

beforeEach(() => {
  getListMock.mockReset();
  getListMock.mockImplementation(async () => {
    return { data: [], count: 0, skip: 0, limit: 50 };
  });
});

afterEach(() => {
  cleanup();
});

describe("what the empty list says", () => {
  test("a search that matches nothing says so - whatever else holds", () => {
    expect(
      getEntityDropdownEmptyListText({
        searchQuery: "payments",
        pickedHiddenCount: 2,
        mayHaveMore: true,
        emptyListText: "No connected repositories yet.",
      }),
    ).toBe("No matching entries.");
  });

  test("every entry picked: all of them are", () => {
    expect(
      getEntityDropdownEmptyListText({
        searchQuery: "",
        pickedHiddenCount: 2,
        mayHaveMore: false,
      }),
    ).toBe("All of them are picked.");
  });

  test("every entry of a full page picked: a search may find more", () => {
    expect(
      getEntityDropdownEmptyListText({
        searchQuery: "",
        pickedHiddenCount: 50,
        mayHaveMore: true,
      }),
    ).toBe("Search to find more.");
  });

  test("nothing at all: what the field says is missing, or nothing to pick yet", () => {
    expect(
      getEntityDropdownEmptyListText({
        searchQuery: "",
        pickedHiddenCount: 0,
        mayHaveMore: false,
        emptyListText: "No MCP servers yet.",
      }),
    ).toBe("No MCP servers yet.");
    expect(
      getEntityDropdownEmptyListText({
        searchQuery: "",
        pickedHiddenCount: 0,
        mayHaveMore: false,
      }),
    ).toBe("Nothing to pick yet.");
  });

  test("spaces alone are no search", () => {
    expect(
      getEntityDropdownEmptyListText({
        searchQuery: "   ",
        pickedHiddenCount: 0,
        mayHaveMore: false,
      }),
    ).toBe("Nothing to pick yet.");
  });

  test("never the old words", () => {
    expect(Object.values(ENTITY_DROPDOWN_EMPTY_LIST_COPY)).not.toContain(
      "No options.",
    );
  });
});

describe("the open list", () => {
  test("with nothing to pick, it says nothing to pick yet", async () => {
    renderDropdown({ options: [] });
    await openList();

    expect(emptyList()).toHaveTextContent("Nothing to pick yet.");
    expect(screen.queryByRole("option")).toBeNull();
  });

  test("with nothing to pick, it says what the field names as missing", async () => {
    renderDropdown({
      options: [],
      emptyListText: "No connected repositories yet.",
    });
    await openList();

    expect(emptyList()).toHaveTextContent("No connected repositories yet.");
  });

  test("a multi-select with every entry picked says all of them are, not that there are none", async () => {
    renderDropdown({
      isMultiSelect: true,
      value: ["members", "admins"],
      emptyListText: "No teams yet.",
    });
    await openList();

    expect(emptyList()).toHaveTextContent("All of them are picked.");
    expect(emptyList()).not.toHaveTextContent("No teams yet.");
  });

  test("a multi-select with one left lists it, and says nothing of the kind", async () => {
    renderDropdown({ isMultiSelect: true, value: ["members"] });
    await openList();

    expect(screen.getByRole("option", { name: /Admins/ })).toBeInTheDocument();
    expect(screen.queryByTestId("entity-dropdown-empty-list")).toBeNull();
  });

  test("a single pick stays listed: the list is never empty for it", async () => {
    renderDropdown({ value: "members" });
    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByRole("button", { name: /^Members/ }));
    });

    expect(screen.getByRole("option", { name: /Members/ })).toBeInTheDocument();
    expect(screen.queryByTestId("entity-dropdown-empty-list")).toBeNull();
  });

  test("a search that matches nothing says so", async () => {
    renderDropdown({ isMultiSelect: true });
    await openList();

    await act(async (): Promise<void> => {
      fireEvent.change(screen.getByRole("combobox", { name: "Team" }), {
        target: { value: "owners" },
      });
    });

    expect(emptyList()).toHaveTextContent("No matching entries.");
  });

  test("a list the server fills, every entry of it picked: all of them are", async () => {
    const three: Array<Monitor> = monitors(3);
    getListMock.mockImplementation(async () => {
      return { data: three, count: 3, skip: 0, limit: 50 };
    });

    renderDropdown({
      options: [],
      isMultiSelect: true,
      modelType: Monitor,
      labelField: "name",
      valueField: "_id",
      enableLabelsTab: false,
      value: three.map((monitor: Monitor): string => {
        return monitor._id!.toString();
      }),
    });
    await openList();

    expect(
      await screen.findByText("All of them are picked.", {}, { timeout: 5000 }),
    ).toBeInTheDocument();
  });

  test("a full page from the server, every entry of it picked: a search may find more", async () => {
    const page: Array<Monitor> = monitors(50);
    getListMock.mockImplementation(async () => {
      return { data: page, count: 120, skip: 0, limit: 50 };
    });

    renderDropdown({
      options: [],
      isMultiSelect: true,
      modelType: Monitor,
      labelField: "name",
      valueField: "_id",
      enableLabelsTab: false,
      value: page.map((monitor: Monitor): string => {
        return monitor._id!.toString();
      }),
    });
    await openList();

    expect(
      await screen.findByText("Search to find more.", {}, { timeout: 5000 }),
    ).toBeInTheDocument();
  });
});

describe("a form's entity dropdown field", () => {
  interface TestEntity extends JSONObject {
    monitors?: Array<string>;
  }

  test("hands its list the words its dropdownModal names", async () => {
    const field: Field<TestEntity> = {
      title: "Monitors",
      field: { monitors: true },
      fieldType: FormFieldSchemaType.MultiSelectDropdown,
      dropdownModal: {
        type: Monitor,
        labelField: "name",
        valueField: "_id",
        emptyListText: "No monitors yet.",
      },
      required: false,
      placeholder: "Every monitor",
    } as Field<TestEntity>;

    render(
      <FormField<TestEntity>
        field={field}
        fieldName="monitors"
        index={0}
        isDisabled={false}
        error=""
        touched={false}
        currentValues={{} as FormValues<TestEntity>}
        setFieldTouched={() => {}}
        setFieldValue={() => {}}
      />,
    );

    await act(async (): Promise<void> => {
      fireEvent.click(screen.getByRole("combobox"));
    });

    expect(
      await screen.findByText("No monitors yet.", {}, { timeout: 5000 }),
    ).toBeInTheDocument();
  });
});

describe("the words", () => {
  const KEYS: Array<string> = [
    ENTITY_DROPDOWN_EMPTY_LIST_COPY.nothingToPick,
    ENTITY_DROPDOWN_EMPTY_LIST_COPY.allPicked,
    ENTITY_DROPDOWN_EMPTY_LIST_COPY.searchForMore,
    ENTITY_DROPDOWN_EMPTY_LIST_COPY.noMatch,
  ];

  const locales: Array<[string, Record<string, string>]> = fs
    .readdirSync(DASHBOARD_LOCALES)
    .filter((file: string): boolean => {
      return file.endsWith(".json");
    })
    .map((file: string): [string, Record<string, string>] => {
      return [
        file,
        JSON.parse(fs.readFileSync(path.join(DASHBOARD_LOCALES, file), "utf8")),
      ];
    });

  test("every Dashboard language has them, translated", () => {
    expect(locales).toHaveLength(17);

    for (const [file, locale] of locales) {
      for (const key of KEYS) {
        expect([file, key, typeof locale[key]]).toEqual([file, key, "string"]);

        if (file === "en.json") {
          expect(locale[key]).toBe(key);
        } else {
          expect([file, key, locale[key] === key]).toEqual([file, key, false]);
        }
      }
    }
  });

  test("the old words are gone, from the list and from every language", () => {
    const source: string = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "UI",
        "Components",
        "EntityDropdown",
        "EntityDropdown.tsx",
      ),
      "utf8",
    );

    expect(source).not.toContain('"No options."');

    for (const [file, locale] of locales) {
      expect([file, "No options." in locale]).toEqual([file, false]);
    }
  });
});
