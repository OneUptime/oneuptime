import "@testing-library/jest-dom";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import { act, cleanup, render, screen } from "@testing-library/react";
import React from "react";
import getJestMockFunction, { MockFunction } from "../../../MockType";

const getListMock: MockFunction = getJestMockFunction();

jest.mock("../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: (...args: Array<unknown>) => {
        return getListMock(...args);
      },
    },
  };
});

import LazyEntityDropdown, {
  EntityDropdownPlaceholder,
  loadEntityDropdown,
} from "../../../../UI/Components/EntityDropdown/LazyEntityDropdown";
import {
  getFieldLoadControl,
  loadAllFormFieldControls,
} from "../../../../UI/Components/Forms/Fields/FormFieldControls";
import FormFieldSchemaType from "../../../../UI/Components/Forms/Types/FormFieldSchemaType";
import { LazyLibrary } from "../../../../UI/Utils/LazyLibrary";
import Monitor from "../../../../Models/DatabaseModels/Monitor";

/*
 * A FORM'S ENTITY DROPDOWN IS A FILE OF ITS OWN (LazyEntityDropdown).
 *
 * Every page with a form reaches FormField, and the public pages' forms -
 * the sign-in pages', a status page's, a public dashboard's - pick no
 * record, so the dropdown a field that picks records draws (one with a
 * dropdownModal) loads with the first form that has such a field, as the
 * form is drawn (FormFieldControls), and until it arrives the field draws
 * its box, the same size (EntityDropdownPlaceholder). FormEntityDropdown-
 * FirstLoadBuild.test.ts holds the build to it.
 *
 * The first case runs before anything has loaded the dropdown's file: once
 * it has arrived, every field draws the dropdown from its first frame.
 */

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a field that picks records", () => {
  test("draws its box, saying it is loading, until the dropdown's file arrives", () => {
    // Held: the file never arrives in this case.
    jest
      .spyOn(LazyLibrary.prototype, "load")
      .mockImplementation((): Promise<unknown> => {
        return new Promise<unknown>(() => {});
      });

    render(
      <LazyEntityDropdown
        modelType={Monitor}
        ariaLabel="Monitor"
        placeholder="Select Monitor"
      />,
    );

    const place: HTMLElement = screen.getByTestId(
      "entity-dropdown-placeholder",
    );

    expect(place).toHaveAttribute("data-load-state", "loading");
    expect(place).toHaveTextContent("Select Monitor");
    expect(screen.queryByRole("combobox")).toBeNull();
  });

  test("once the file has arrived, is the dropdown itself", async () => {
    await loadEntityDropdown();

    getListMock.mockImplementation(async () => {
      return { data: [], count: 0, skip: 0, limit: 50 };
    });

    await act(async () => {
      render(
        <LazyEntityDropdown
          modelType={Monitor}
          ariaLabel="Monitor"
          placeholder="Select Monitor"
        />,
      );
    });

    expect(screen.getByRole("combobox", { name: "Monitor" })).toHaveAttribute(
      "placeholder",
      "Select Monitor",
    );
    expect(screen.queryByTestId("entity-dropdown-placeholder")).toBeNull();
  });
});

describe("the box drawn until the dropdown arrives", () => {
  test("holds the placeholder's words, in the dropdown's margins and box", () => {
    render(
      <EntityDropdownPlaceholder
        loadError={null}
        modelType={Monitor}
        placeholder="Select Monitor"
      />,
    );

    const place: HTMLElement = screen.getByTestId(
      "entity-dropdown-placeholder",
    );

    expect(place).toHaveTextContent("Select Monitor");
    expect(place.querySelector(".mt-2.mb-1")).not.toBeNull();
    expect(place.querySelector(".min-h-\\[38px\\]")).not.toBeNull();
  });

  test("says Loading... where a pick will be named, and keeps the row the picks of a field of several take", () => {
    const { unmount } = render(
      <EntityDropdownPlaceholder
        loadError={null}
        modelType={Monitor}
        value="bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1"
      />,
    );

    expect(screen.getByTestId("entity-dropdown-placeholder")).toHaveTextContent(
      "Loading...",
    );
    expect(
      screen.queryByTestId("entity-dropdown-placeholder-picks"),
    ).toBeNull();

    unmount();

    render(
      <EntityDropdownPlaceholder
        loadError={null}
        modelType={Monitor}
        isMultiSelect={true}
        placeholder="Select Monitors"
        value={["bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbb1"]}
      />,
    );

    const picks: HTMLElement = screen.getByTestId(
      "entity-dropdown-placeholder-picks",
    );

    // A chip's row: its text-xs line, py-1 and border, under mb-2.
    expect(picks).toHaveClass("mb-2", "h-[26px]");
    expect(picks).toHaveAttribute("aria-hidden", "true");
    expect(screen.getByTestId("entity-dropdown-placeholder")).toHaveTextContent(
      "Select Monitors",
    );
  });

  test("shows the field's own error under it", () => {
    render(
      <EntityDropdownPlaceholder
        loadError={null}
        modelType={Monitor}
        error="Monitor is required"
      />,
    );

    expect(screen.getByTestId("entity-dropdown-placeholder")).toHaveTextContent(
      "Monitor is required",
    );
  });

  test("says so, the same size, when the file cannot be loaded", () => {
    render(
      <EntityDropdownPlaceholder
        loadError={new Error("The file could not be fetched")}
        modelType={Monitor}
        placeholder="Select Monitor"
      />,
    );

    expect(screen.getByTestId("entity-dropdown-placeholder")).toHaveAttribute(
      "data-load-state",
      "failed",
    );
  });
});

describe("what a form asks for as it is drawn", () => {
  test("the dropdown, for a field that picks records, one or several", () => {
    for (const fieldType of [
      FormFieldSchemaType.Dropdown,
      FormFieldSchemaType.MultiSelectDropdown,
    ]) {
      expect(
        getFieldLoadControl({
          fieldType: fieldType,
          dropdownModal: { type: Monitor },
        }),
      ).toBe(loadEntityDropdown);
    }
  });

  test("nothing for a dropdown from a fixed list, which draws with the first load's Dropdown", () => {
    for (const fieldType of [
      FormFieldSchemaType.Dropdown,
      FormFieldSchemaType.MultiSelectDropdown,
    ]) {
      expect(getFieldLoadControl({ fieldType: fieldType })).toBeNull();
    }
  });

  test("every control, for what must have them before it draws, the dropdown among them", async () => {
    const load: ReturnType<typeof jest.spyOn> = jest
      .spyOn(LazyLibrary.prototype, "load")
      .mockImplementation((): Promise<unknown> => {
        return Promise.resolve(null);
      });

    await loadEntityDropdown();

    const entityDropdownFile: unknown = load.mock.instances[0];

    load.mockClear();

    await loadAllFormFieldControls();

    expect(load.mock.instances).toContain(entityDropdownFile);
  });
});
