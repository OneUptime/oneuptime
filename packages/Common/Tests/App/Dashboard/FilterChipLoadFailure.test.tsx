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
import { COULD_NOT_LOAD_THIS_LIST } from "../../../UI/Components/Table/EmptyTableMessage";
import IconProp from "../../../Types/Icon/IconProp";

/*
 * A CHIP WHOSE OPTIONS COULD NOT BE READ SAYS SO, AND OFFERS TO TRY AGAIN.
 *
 * A chip that reads its options from the server (the Owner chip's people
 * and teams, Labels) turned a failed read into an empty list: "Nothing to
 * show - No options available", as though the project had nobody in it
 * and no labels. It now says "Couldn't load this list." with Try again,
 * which reads them once more; a read that works brings the list back.
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

interface PendingRead {
  searchTerm: string;
  resolve: (options: Array<FilterChipDropdownOption>) => void;
  reject: (error: Error) => void;
}

let reads: Array<PendingRead> = [];

const loadOptions: (
  searchTerm: string,
) => Promise<Array<FilterChipDropdownOption>> = (
  searchTerm: string,
): Promise<Array<FilterChipDropdownOption>> => {
  return new Promise(
    (
      resolve: (options: Array<FilterChipDropdownOption>) => void,
      reject: (error: Error) => void,
    ) => {
      reads.push({ searchTerm, resolve, reject });
    },
  );
};

const openOwnerChip: () => void = (): void => {
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

  fireEvent.click(screen.getByRole("button", { name: /^Owner/ }));
};

// Lets the debounced read start.
const passDebounce: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    jest.advanceTimersByTime(250);
  });
};

const failLatestRead: () => Promise<void> = async (): Promise<void> => {
  await act(async () => {
    reads[reads.length - 1]!.reject(new Error("502 Bad Gateway"));
  });
};

beforeEach(() => {
  jest.useFakeTimers();
  reads = [];
});

afterEach(() => {
  cleanup();
  jest.useRealTimers();
});

describe("a chip whose options could not be read", () => {
  test("says the list could not be loaded - not that there is nothing", async () => {
    openOwnerChip();
    await passDebounce();
    await failLatestRead();

    expect(screen.getByTestId("filter-chip-load-error")).toBeVisible();
    expect(screen.getByText(COULD_NOT_LOAD_THIS_LIST)).toBeVisible();
    expect(screen.getByRole("button", { name: "Try again" })).toBeVisible();

    expect(screen.queryByText("Nothing to show")).toBeNull();
    expect(screen.queryByText("No options available")).toBeNull();
    expect(screen.queryByText("Loading...")).toBeNull();
  });

  test("Try again reads once more: Loading..., then the people and teams", async () => {
    openOwnerChip();
    await passDebounce();
    await failLatestRead();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));

    // Loading at once, with the error gone.
    expect(screen.getByText("Loading...")).toBeInTheDocument();
    expect(screen.queryByTestId("filter-chip-load-error")).toBeNull();

    await passDebounce();

    expect(reads).toHaveLength(2);
    expect(reads[1]!.searchTerm).toBe("");

    await act(async () => {
      reads[1]!.resolve(PEOPLE_AND_TEAMS);
    });

    expect(screen.queryByTestId("filter-chip-load-error")).toBeNull();
    expect(screen.getByText("Ada Lovelace")).toBeVisible();
    expect(screen.getByText("SRE")).toBeVisible();
  });

  test("Try again keeps what was typed, and reads it", async () => {
    openOwnerChip();
    await passDebounce();
    await act(async () => {
      reads[0]!.resolve(PEOPLE_AND_TEAMS);
    });

    fireEvent.change(
      screen.getByPlaceholderText("Search people and teams..."),
      { target: { value: "ad" } },
    );
    await passDebounce();
    await failLatestRead();

    expect(screen.getByTestId("filter-chip-load-error")).toBeVisible();

    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    await passDebounce();

    expect(reads[reads.length - 1]!.searchTerm).toBe("ad");
    expect(
      screen.getByPlaceholderText("Search people and teams..."),
    ).toHaveValue("ad");
  });

  test("a read that works after a failed one clears the error", async () => {
    openOwnerChip();
    await passDebounce();
    await failLatestRead();

    fireEvent.change(
      screen.getByPlaceholderText("Search people and teams..."),
      { target: { value: "s" } },
    );
    await passDebounce();
    await act(async () => {
      reads[reads.length - 1]!.resolve([PEOPLE_AND_TEAMS[1]!]);
    });

    expect(screen.queryByTestId("filter-chip-load-error")).toBeNull();
    expect(screen.getByText("SRE")).toBeVisible();
  });

  test("an empty answer is still nothing to show, not an error", async () => {
    openOwnerChip();
    await passDebounce();
    await act(async () => {
      reads[0]!.resolve([]);
    });

    expect(screen.queryByTestId("filter-chip-load-error")).toBeNull();
    expect(screen.getByText("Nothing to show")).toBeVisible();
  });
});
