import "@testing-library/jest-dom";
import { afterEach, beforeEach, describe, expect, test } from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import React, { FunctionComponent, ReactElement, useState } from "react";
import Dropdown, {
  DropdownOption,
} from "../../../../UI/Components/Dropdown/Dropdown";
import FiltersForm from "../../../../UI/Components/Filters/FiltersForm";
import Filter from "../../../../UI/Components/Filters/Types/Filter";
import FilterData from "../../../../UI/Components/Filters/Types/FilterData";
import BasicForm from "../../../../UI/Components/Forms/BasicForm";
import Fields from "../../../../UI/Components/Forms/Types/Fields";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import FormValues from "../../../../UI/Components/Forms/Types/FormValues";
import SearchBox from "../../../../UI/Components/Header/SearchBox";
import Input from "../../../../UI/Components/Input/Input";
import FieldType from "../../../../UI/Components/Types/FieldType";
import UnsavedChanges, {
  UNSAVED_CHANGES_IGNORE_ATTRIBUTE,
  isSearchOrFilterField,
} from "../../../../UI/Utils/NewVersion/UnsavedChanges";
import GenericObject from "../../../../Types/GenericObject";
import { JSONObject } from "../../../../Types/JSON";

/*
 * "Search and filter boxes count as unsaved text when a new version wants to
 * reload the page (only type=search is skipped): opt them out with
 * data-unsaved-changes-ignore, product-wide." - the maintainer.
 *
 * A new version deployed under an open page loads on the reader's next
 * page, and the notice's Reload goes straight ahead, unless the page holds
 * work the reader has not saved (Utils/NewVersion/UnsavedChanges). What is
 * typed into a search or a filter is a query: losing it costs nothing, so
 * it never holds the new version back - in a form or out of one. These
 * drive the real shared boxes: Common's Input, the header's search, a
 * dropdown's own search, a table's filters, and a form whose dropdown is
 * searched and then picked from. (Every other search and filter box in the
 * product is held to the same by Common/Tests/UI/
 * SearchBoxesNeverUnsavedGuard.)
 */

const settle: () => Promise<void> = async (): Promise<void> => {
  await act(async (): Promise<void> => {
    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
  });
};

beforeEach(() => {
  UnsavedChanges.reset();
  UnsavedChanges.install();
});

afterEach(() => {
  cleanup();
  UnsavedChanges.reset();
});

describe("isSearchOrFilterField", () => {
  const make: (html: string) => Element = (html: string): Element => {
    const holder: HTMLDivElement = document.createElement("div");
    holder.innerHTML = html;
    document.body.appendChild(holder);
    return holder.querySelector("[data-testid='box']")!;
  };

  afterEach(() => {
    document.body.innerHTML = "";
  });

  test.each<[string, string]>([
    [
      "a box that says so itself",
      `<input data-testid="box" ${UNSAVED_CHANGES_IGNORE_ATTRIBUTE} />`,
    ],
    [
      "a box under a part that says so (a table's filters)",
      `<div ${UNSAVED_CHANGES_IGNORE_ATTRIBUTE}><label>Name <input data-testid="box" /></label></div>`,
    ],
    ["an input of type search", `<input data-testid="box" type="search" />`],
    ["an input of type SEARCH", `<input data-testid="box" type="SEARCH" />`],
    ["a searchbox", `<input data-testid="box" role="searchbox" />`],
  ])("%s is a search or filter box", (_label: string, html: string) => {
    expect(isSearchOrFilterField(make(html))).toBe(true);
  });

  test.each<[string, string]>([
    ["a text field", `<input data-testid="box" />`],
    ["an email field", `<input data-testid="box" type="email" />`],
    ["a textarea", `<textarea data-testid="box"></textarea>`],
    [
      "a combobox that does not say so (a value written with suggestions)",
      `<input data-testid="box" role="combobox" />`,
    ],
    ["an editor", `<div data-testid="box" contenteditable="true">Draft</div>`],
  ])("%s is not", (_label: string, html: string) => {
    expect(isSearchOrFilterField(make(html))).toBe(false);
  });
});

describe("Common's Input", () => {
  test("isSearchOrFilter writes the attribute, and what is typed never counts", async () => {
    render(
      <Input
        isSearchOrFilter={true}
        dataTestId="search"
        placeholder="Search monitors"
      />,
    );

    const box: HTMLElement = screen.getByTestId("search");

    expect(box).toHaveAttribute(UNSAVED_CHANGES_IGNORE_ATTRIBUTE);

    await userEvent.type(box, "checkout");

    expect(UnsavedChanges.hasUnsavedChanges()).toBe(false);
  });

  test("an Input without it is a field like any other: typed text counts", async () => {
    render(<Input dataTestId="name" placeholder="Name" />);

    const box: HTMLElement = screen.getByTestId("name");

    expect(box).not.toHaveAttribute(UNSAVED_CHANGES_IGNORE_ATTRIBUTE);

    await userEvent.type(box, "Checkout API");

    expect(UnsavedChanges.hasUnsavedChanges()).toBe(true);
  });

  test("isSearchOrFilter={false} writes nothing", () => {
    render(<Input isSearchOrFilter={false} dataTestId="name" />);

    expect(screen.getByTestId("name")).not.toHaveAttribute(
      UNSAVED_CHANGES_IGNORE_ATTRIBUTE,
    );
  });
});

describe("the header's search", () => {
  test("never holds the page", async () => {
    render(<SearchBox onChange={(): void => {}} />);

    const box: HTMLElement = screen.getByPlaceholderText("Search");

    await userEvent.type(box, "payments");

    expect(box).toHaveAttribute(UNSAVED_CHANGES_IGNORE_ATTRIBUTE);
    expect(UnsavedChanges.hasUnsavedChanges()).toBe(false);
  });
});

const OPTIONS: Array<DropdownOption> = [
  { value: "critical", label: "Critical" },
  { value: "major", label: "Major" },
  { value: "minor", label: "Minor" },
];

describe("a dropdown's own search", () => {
  test("says so, and what is typed to find an option never counts", async () => {
    render(<Dropdown options={OPTIONS} onChange={(): void => {}} />);

    const search: HTMLElement = screen.getByRole("combobox");

    expect(search).toHaveAttribute(UNSAVED_CHANGES_IGNORE_ATTRIBUTE);

    await userEvent.type(search, "maj");

    expect((search as HTMLInputElement).value).toBe("maj");
    expect(UnsavedChanges.hasUnsavedChanges()).toBe(false);
  });
});

describe("a form whose dropdown is searched, then picked from", () => {
  const FIELDS: Fields<JSONObject> = [
    {
      field: { severity: true },
      title: "Severity",
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownOptions: OPTIONS,
    },
  ];

  const Host: FunctionComponent = (): ReactElement => {
    return (
      <BasicForm
        id="severity-form"
        fields={FIELDS}
        submitButtonText="Save"
        disableAutofocus={true}
        onSubmit={(_values: FormValues<JSONObject>): void => {}}
      />
    );
  };

  test("the search alone changes nothing in the form", async () => {
    render(<Host />);
    await settle();

    await userEvent.type(screen.getByRole("combobox"), "maj");

    expect(UnsavedChanges.hasUnsavedChanges()).toBe(false);
  });

  test("the pick is the change: the form counts from then on", async () => {
    render(<Host />);
    await settle();

    const search: HTMLElement = screen.getByRole("combobox");

    await userEvent.type(search, "maj");
    fireEvent.keyDown(search, { key: "Enter", code: "Enter" });
    await settle();

    expect(UnsavedChanges.hasUnsavedChanges()).toBe(true);
  });
});

describe("a table's filters", () => {
  type Row = GenericObject & {
    name?: string;
    count?: number;
    createdAt?: Date;
  };

  const FILTERS: Array<Filter<Row>> = [
    { key: "name", title: "Name", type: FieldType.Text },
    { key: "count", title: "Count", type: FieldType.Number },
  ];

  const Host: FunctionComponent = (): ReactElement => {
    const [filterData, setFilterData] = useState<FilterData<Row>>({});

    return (
      <FiltersForm<Row>
        id="monitors-filters"
        showFilter={true}
        filters={FILTERS}
        filterData={filterData}
        onFilterChanged={(data: FilterData<Row>): void => {
          setFilterData(data);
        }}
      />
    );
  };

  test("say so for every box under them", () => {
    render(<Host />);

    expect(document.getElementById("monitors-filters")).toHaveAttribute(
      UNSAVED_CHANGES_IGNORE_ATTRIBUTE,
    );
  });

  test("what is typed into them never holds the page", () => {
    render(
      <div>
        <Host />
        <input data-testid="note" />
      </div>,
    );

    const boxes: Array<HTMLElement> = Array.from(
      document.querySelectorAll<HTMLElement>(
        "#monitors-filters input:not([type='checkbox']):not([type='radio'])",
      ),
    );

    expect(boxes.length).toBeGreaterThanOrEqual(2);

    for (const box of boxes) {
      fireEvent.input(box, { target: { value: "4" } });
      fireEvent.change(box, { target: { value: "4" } });
    }

    expect(UnsavedChanges.hasUnsavedChanges()).toBe(false);

    // The same typing beside them, in a field of the page's own, does count.
    fireEvent.input(screen.getByTestId("note"), { target: { value: "4" } });

    expect(UnsavedChanges.hasUnsavedChanges()).toBe(true);
  });
});
