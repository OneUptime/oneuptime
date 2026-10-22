import "@testing-library/jest-dom";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import React from "react";
import FilterChipDropdown from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipDropdown";
import { FilterChipDropdownOption } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipDropdownTypes";
import IconProp from "../../../Types/Icon/IconProp";

/*
 * A chip whose options are read from the server (the Owner chip's people and
 * teams, Labels, states...) reads them a moment after it opens, and again a
 * moment after each keystroke (debounced). In between it used to say
 * "Nothing to show - No options available": an Owner chip just opened told
 * whoever opened it that the project had no people and no teams. It says
 * "Loading..." from the moment it opens until the answer comes.
 */

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (key: string, opts?: { defaultValue?: string }): string => {
          return opts?.defaultValue ?? key;
        },
      };
    },
  };
});

const PEOPLE_AND_TEAMS: Array<FilterChipDropdownOption> = [
  { value: "user:ada", label: "Ada Lovelace", group: "People" },
  { value: "team:sre", label: "SRE", group: "Teams" },
];

type Resolve = (options: Array<FilterChipDropdownOption>) => void;

let pending: Array<{ searchTerm: string; resolve: Resolve }> = [];

const loadOptions: (
  searchTerm: string,
) => Promise<Array<FilterChipDropdownOption>> = (
  searchTerm: string,
): Promise<Array<FilterChipDropdownOption>> => {
  return new Promise((resolve: Resolve) => {
    pending.push({ searchTerm, resolve });
  });
};

const renderOwnerChip: () => void = (): void => {
  render(
    <FilterChipDropdown
      label="Owner"
      emptyIcon={IconProp.User}
      loadOptions={loadOptions}
      isMultiSelect={true}
      value={[]}
      searchPlaceholder="Search people and teams..."
      onChange={(): void => {}}
    />,
  );
};

beforeEach(() => {
  jest.useFakeTimers();
  pending = [];
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("a chip that reads its options from the server", () => {
  test("says it is loading the moment it opens - never that there is nothing", async () => {
    renderOwnerChip();

    fireEvent.click(screen.getByRole("button", { name: /^Owner/ }));

    // Before the debounced read has even started.
    expect(pending).toHaveLength(0);
    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(screen.queryByText("Nothing to show")).toBeNull();
    expect(screen.queryByText("No options available")).toBeNull();

    // The read starts after the debounce; still loading until it answers.
    await act(async () => {
      jest.advanceTimersByTime(250);
    });

    expect(pending).toHaveLength(1);
    expect(pending[0]!.searchTerm).toBe("");
    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(screen.queryByText("Nothing to show")).toBeNull();

    await act(async () => {
      pending[0]!.resolve(PEOPLE_AND_TEAMS);
    });

    expect(screen.queryByText("Loading...")).toBeNull();
    expect(screen.getByText("Ada Lovelace")).toBeVisible();
    expect(screen.getByText("SRE")).toBeVisible();
  });

  test("a search says it is loading too, then shows what matched - or that nothing did", async () => {
    renderOwnerChip();

    fireEvent.click(screen.getByRole("button", { name: /^Owner/ }));

    await act(async () => {
      jest.advanceTimersByTime(250);
    });
    await act(async () => {
      pending[0]!.resolve(PEOPLE_AND_TEAMS);
    });

    fireEvent.change(
      screen.getByPlaceholderText("Search people and teams..."),
      { target: { value: "zz" } },
    );

    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(screen.queryByText("No matches")).toBeNull();

    await act(async () => {
      jest.advanceTimersByTime(250);
    });

    expect(pending[pending.length - 1]!.searchTerm).toBe("zz");

    await act(async () => {
      pending[pending.length - 1]!.resolve([]);
    });

    expect(screen.queryByText("Loading...")).toBeNull();
    expect(screen.getByText("No matches")).toBeVisible();
  });

  test("a chip with its options given (not read) never says it is loading", () => {
    render(
      <FilterChipDropdown
        label="Status"
        options={[{ value: "open", label: "Open" }]}
        value={null}
        onChange={(): void => {}}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /^Status/ }));

    expect(screen.queryByText("Loading...")).toBeNull();
    expect(screen.getByText("Open")).toBeVisible();
  });
});
