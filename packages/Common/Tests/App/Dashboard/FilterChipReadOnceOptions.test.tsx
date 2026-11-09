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
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import FilterChipDropdown from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipDropdown";
import { FilterChipDropdownOption } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/FilterChipDropdownTypes";
import useResourceOwners from "../../../../App/FeatureSet/Dashboard/src/Components/ResourceOwners/useResourceOwners";
import {
  CLOUD_ACCOUNT_FACET_LABEL,
  getResourcesCloudAccountFacet,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AppPlatforms/AppPlatformsAccountFacet";
import CloudResource from "../../../Models/DatabaseModels/CloudResource";
import IconProp from "../../../Types/Icon/IconProp";
import ObjectID from "../../../Types/ObjectID";
import { COULD_NOT_LOAD_THIS_LIST } from "../../../UI/Components/Table/EmptyTableMessage";
import ProjectUtil from "../../../UI/Utils/Project";
import TableFilterUrlState from "../../../UI/Utils/TableFilterUrlState";
import { getJestSpyOn } from "../../Spy";
import { PROJECT_ID } from "./SideMenuHarness";

/*
 * A CHIP WHOSE OPTIONS ARE READ ONCE SAYS SO WHILE THEY ARE READ, AND WHEN
 * THEY COULD NOT BE (the UI review of #6227).
 *
 * A chip whose options its list reads once when it opens (a facet's
 * fetchOptions, read by useResourceOwners) offered nothing until the read
 * came back: opened before then, it said "Nothing to show - No options
 * available", as though the list had no accounts; and a read that failed
 * left it saying that for good. Cloud's All Resources reads its Cloud
 * Account chip's accounts a few rows at a time, one read after another, so
 * on a big project that took a while. The chip says Loading... while they
 * are read now, and that they could not be read - with Try again, which
 * reads them once more - as a chip that reads its options as it is
 * searched always did.
 */

const ACCOUNTS: Array<FilterChipDropdownOption> = [
  {
    value: "123456789012",
    label: "Production",
    sublabel: "123456789012",
    group: "AWS",
  },
  { value: "acme-prod", label: "acme-prod", group: "Google Cloud" },
];

interface PendingRead {
  resolve: (options: Array<FilterChipDropdownOption>) => void;
  reject: (error: Error) => void;
}

let reads: Array<PendingRead> = [];

const fetchAccounts: () => Promise<
  Array<FilterChipDropdownOption>
> = (): Promise<Array<FilterChipDropdownOption>> => {
  return new Promise(
    (
      resolve: (options: Array<FilterChipDropdownOption>) => void,
      reject: (error: Error) => void,
    ) => {
      reads.push({ resolve, reject });
    },
  );
};

// A list with All Resources' Cloud Account chip over it, its accounts read once.
const ListWithAccountChip: () => ReactElement = (): ReactElement => {
  const { filterBar } = useResourceOwners<CloudResource>({
    persistKey: "read-once-options-test",
    showOwnerFacet: false,
    extraFacets: [getResourcesCloudAccountFacet(fetchAccounts)],
  });

  return <MemoryRouter>{filterBar}</MemoryRouter>;
};

async function openAccountChip(): Promise<HTMLElement> {
  await act(async () => {
    render(<ListWithAccountChip />);
  });

  await act(async () => {
    fireEvent.click(
      screen.getByRole("button", { name: CLOUD_ACCOUNT_FACET_LABEL }),
    );
  });

  return screen.getByRole("listbox");
}

beforeEach(() => {
  reads = [];
  TableFilterUrlState.resetClaimedKeys();
  getJestSpyOn(ProjectUtil, "getCurrentProjectId").mockReturnValue(
    new ObjectID(PROJECT_ID),
  );
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a list's chip whose options it reads once", () => {
  test("says Loading... while they are read - not that there is nothing - then offers them", async () => {
    const listbox: HTMLElement = await openAccountChip();

    expect(reads).toHaveLength(1);
    expect(within(listbox).getByText("Loading...")).toBeInTheDocument();
    expect(within(listbox).queryByText("Nothing to show")).toBeNull();
    expect(within(listbox).queryByText("No options available")).toBeNull();
    expect(within(listbox).queryAllByRole("option")).toHaveLength(0);

    await act(async () => {
      reads[0]!.resolve(ACCOUNTS);
    });

    const options: Array<HTMLElement> = within(
      screen.getByRole("listbox"),
    ).getAllByRole("option");
    expect(
      options.map((option: HTMLElement): string => {
        return (option.textContent || "").trim();
      }),
    ).toEqual(["Production123456789012", "acme-prod"]);
    expect(screen.queryByText("Loading...")).toBeNull();
  });

  test("a read that failed says the list could not be loaded, with Try again, which reads it once more", async () => {
    const listbox: HTMLElement = await openAccountChip();

    await act(async () => {
      reads[0]!.reject(new Error("502 Bad Gateway"));
    });

    expect(within(listbox).getByTestId("filter-chip-load-error")).toBeVisible();
    expect(within(listbox).getByText(COULD_NOT_LOAD_THIS_LIST)).toBeVisible();
    expect(within(listbox).queryByText("Nothing to show")).toBeNull();
    expect(within(listbox).queryByText("Loading...")).toBeNull();

    await act(async () => {
      fireEvent.click(
        within(listbox).getByRole("button", { name: "Try again" }),
      );
    });

    // Read once more: Loading... at once, the error gone.
    expect(reads).toHaveLength(2);
    expect(within(listbox).getByText("Loading...")).toBeInTheDocument();
    expect(within(listbox).queryByTestId("filter-chip-load-error")).toBeNull();

    await act(async () => {
      reads[1]!.resolve(ACCOUNTS);
    });

    expect(within(listbox).getAllByRole("option")).toHaveLength(2);
    expect(within(listbox).queryByTestId("filter-chip-load-error")).toBeNull();
  });

  test("a read that finds nothing still says there is nothing to show", async () => {
    const listbox: HTMLElement = await openAccountChip();

    await act(async () => {
      reads[0]!.resolve([]);
    });

    expect(within(listbox).getByText("Nothing to show")).toBeVisible();
    expect(within(listbox).queryByText("Loading...")).toBeNull();
    expect(within(listbox).queryByTestId("filter-chip-load-error")).toBeNull();
  });
});

describe("a chip handed a static list its owner reads", () => {
  function openChip(props: {
    isLoadingOptions?: boolean;
    hasOptionsLoadFailed?: boolean;
    onRetryLoadOptions?: () => void;
  }): HTMLElement {
    render(
      <FilterChipDropdown
        label="Cloud Account"
        emptyIcon={IconProp.Cloud}
        options={[]}
        isMultiSelect={true}
        value={[]}
        onChange={(): void => {}}
        {...props}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Cloud Account" }));

    return screen.getByRole("listbox");
  }

  test("still being read: Loading...", () => {
    const listbox: HTMLElement = openChip({ isLoadingOptions: true });

    expect(within(listbox).getByText("Loading...")).toBeInTheDocument();
    expect(within(listbox).queryByText("Nothing to show")).toBeNull();
  });

  test("not read: the list could not be loaded, and Try again asks its owner to read it", () => {
    let retries: number = 0;
    const listbox: HTMLElement = openChip({
      hasOptionsLoadFailed: true,
      onRetryLoadOptions: (): void => {
        retries++;
      },
    });

    expect(within(listbox).getByText(COULD_NOT_LOAD_THIS_LIST)).toBeVisible();
    fireEvent.click(within(listbox).getByRole("button", { name: "Try again" }));
    expect(retries).toBe(1);
  });

  test("not read, and no way to read it again: no Try again that would do nothing", () => {
    const listbox: HTMLElement = openChip({ hasOptionsLoadFailed: true });

    expect(within(listbox).getByText(COULD_NOT_LOAD_THIS_LIST)).toBeVisible();
    expect(
      within(listbox).queryByRole("button", { name: "Try again" }),
    ).toBeNull();
  });

  test("read, and empty: nothing to show, as before", () => {
    const listbox: HTMLElement = openChip({});

    expect(within(listbox).getByText("Nothing to show")).toBeVisible();
    expect(within(listbox).queryByText("Loading...")).toBeNull();
    expect(within(listbox).queryByTestId("filter-chip-load-error")).toBeNull();
  });
});
