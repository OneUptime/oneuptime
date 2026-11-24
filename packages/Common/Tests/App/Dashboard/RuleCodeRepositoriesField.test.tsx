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
  waitFor,
  within,
} from "@testing-library/react";
import React, { ReactElement, useState } from "react";

jest.mock("react-i18next", () => {
  return {
    useTranslation: () => {
      return {
        t: (value: string): string => {
          return value;
        },
      };
    },
  };
});

import {
  RuleCodeRepositoriesFieldHint,
  RuleCodeRepositoriesPicker,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/RuleCodeRepositoriesField";
import {
  RULE_CODE_REPOSITORIES_FIELD_COPY,
  RULE_CODE_REPOSITORIES_HINT_TEST_ID,
  RULE_CODE_REPOSITORIES_LOADING_TEST_ID,
  RULE_CODE_REPOSITORIES_PICKER_TEST_ID,
  getRuleCodeRepositoriesFoldedValue,
  getRuleCodeRepositoryIds,
  hasRuleCodeRepositories,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/RuleCodeRepositoriesCopy";
import CappedListServer, {
  CappedListCall,
  namesSortingFirst,
} from "./CappedListServer";
import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import Includes from "../../../Types/BaseDatabase/Includes";
import MultiSearch from "../../../Types/BaseDatabase/MultiSearch";
import SortOrder from "../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../Types/ObjectID";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "../../../UI/Utils/Project";

/*
 * A RULE'S "CODE REPOSITORIES" FIELD, RENDERED - an auto remediation
 * rule's and an investigation rule's, under More fields.
 *
 * "There should be a dropdown here to select the code repo for remediation
 * and also investigation rules, if no code repo is selected - it should be
 * able to read and investigate all the repos that are connected" - the
 * maintainer. So:
 *
 *   - it is drawn as the Runbooks and MCP Servers pickers beside it are
 *     (EntityDropdown: chips over a search box, no chevron), so the fold
 *     reads as one set of fields;
 *   - nothing picked reads "All connected repositories", never "(Optional)";
 *   - it lists the project's repositories by name, GitHub's full name under
 *     each, and stores the ones picked by id;
 *   - a repository the rule names that the reader may not read is kept, as
 *     one they cannot access - never as an id, never dropped - in words
 *     short enough for its chip;
 *   - a project whose plan cannot read repositories still gets the field,
 *     with nothing to pick, and can save its rule;
 *   - under it, where repositories are connected, in a new tab so the
 *     rule being edited stays.
 *
 * However many repositories the project has (#10764): the field searched
 * the project's first 10,000 by name in the browser, so a repository past
 * them could not be picked and one a rule named past them read as one the
 * reader cannot access. It searches the server as the person types - by
 * name, organization or repository name - and names what the rule holds by
 * its ids. On a fake project of 10,050 repositories (CappedListServer), as
 * the list route answers.
 */

const PROJECT_ID: string = "dddddddd-0000-4000-8000-000000000001";
const CHECKOUT_ID: string = "c1111111-1111-4111-8111-111111111111";
const BILLING_ID: string = "c2222222-2222-4222-8222-222222222222";
const HIDDEN_ID: string = "c3333333-3333-4333-8333-333333333333";
// Past every one of the 10,050 by name.
const WAREHOUSE_ID: string = "c5555555-5555-4555-8555-555555555555";

let server: CappedListServer;
let changes: Array<Array<string>> = [];

function addRepository(data: {
  id: string;
  name: string;
  organizationName?: string;
  repositoryName?: string;
}): void {
  server.add(CodeRepository, [
    {
      _id: data.id,
      name: data.name,
      organizationName: data.organizationName || "acme",
      repositoryName: data.repositoryName || data.name,
    },
  ]);
}

// The project the field is used in: two repositories, unless a test adds more.
function project(): void {
  addRepository({
    id: BILLING_ID,
    name: "billing",
    organizationName: "acme",
    repositoryName: "billing-service",
  });
  addRepository({
    id: CHECKOUT_ID,
    name: "checkout",
    organizationName: "acme",
    repositoryName: "checkout",
  });
}

// 10,050 repositories named to sort before "warehouse-api", and it.
function projectPastTheCap(): void {
  server.add(
    CodeRepository,
    namesSortingFirst(10050, "ap").map(
      (name: string): Record<string, unknown> => {
        return {
          _id: ObjectID.generate().toString(),
          name,
          organizationName: "acme",
          repositoryName: name,
        };
      },
    ),
  );
  addRepository({
    id: WAREHOUSE_ID,
    name: "warehouse-api",
    organizationName: "harbour",
    repositoryName: "warehouse",
  });
}

// The form holds the rule's repositories and hands them back, as the field is used.
function PickerHarness(props: { initialValue: unknown }): ReactElement {
  const [value, setValue] = useState<unknown>(props.initialValue);

  return (
    <RuleCodeRepositoriesPicker
      value={value}
      onChange={(repositoryIds: Array<string>) => {
        changes.push(repositoryIds);
        setValue(repositoryIds);
      }}
    />
  );
}

async function renderPicker(initialValue: unknown): Promise<void> {
  render(<PickerHarness initialValue={initialValue} />);
  await screen.findByTestId(RULE_CODE_REPOSITORIES_PICKER_TEST_ID);
}

function picker(): HTMLElement {
  return screen.getByTestId(RULE_CODE_REPOSITORIES_PICKER_TEST_ID);
}

function searchBox(): HTMLInputElement {
  return within(picker()).getByRole("combobox") as HTMLInputElement;
}

/*
 * The menu, opened as a person does - the search box takes the focus - once
 * the server's answer is in.
 */
async function openMenu(expectedCount?: number): Promise<Array<HTMLElement>> {
  await act(async () => {
    fireEvent.focus(searchBox());
  });

  if (expectedCount !== undefined) {
    await waitFor(() => {
      expect(screen.queryAllByRole("option")).toHaveLength(expectedCount);
    });
  }

  return screen.queryAllByRole("option");
}

// Types into the open menu's search, and waits for the server's answer.
async function search(text: string): Promise<void> {
  await act(async () => {
    fireEvent.focus(searchBox());
    fireEvent.change(searchBox(), { target: { value: text } });
  });
}

// What the box says while nothing is typed in it.
function placeholder(): string {
  return searchBox().getAttribute("placeholder") || "";
}

// The chips of the repositories picked, in order (EntityDropdown's chip row).
function chips(): Array<Element> {
  return Array.from(
    picker().querySelectorAll('[data-testid="entity-dropdown-chip"]'),
  );
}

// A chip's name: the whole of it, as the chip shows it.
function chipName(chip: Element): string {
  return (
    chip.querySelector('[data-testid="entity-dropdown-chip-label"]')
      ?.textContent || ""
  ).trim();
}

function picked(): Array<string> {
  return chips().map((chip: Element): string => {
    return chipName(chip);
  });
}

// Takes a picked repository out with its chip's own button.
function removeChip(name: string): void {
  const chip: Element | undefined = chips().find((candidate: Element) => {
    return chipName(candidate) === name;
  });

  expect(chip).toBeDefined();
  fireEvent.click(chip!.querySelector("button") as Element);
}

// The searches the field sent: reads with no ids in them.
function searches(): Array<CappedListCall> {
  return server.callsFor(CodeRepository).filter((call: CappedListCall) => {
    return !(call.query["_id"] instanceof Includes);
  });
}

// The reads of what the rule holds, by their ids.
function heldReads(): Array<CappedListCall> {
  return server.callsFor(CodeRepository).filter((call: CappedListCall) => {
    return call.query["_id"] instanceof Includes;
  });
}

beforeEach(() => {
  changes = [];
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  server = new CappedListServer().install();
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a rule's code repositories", () => {
  test("while the repositories a rule names are read by their ids, it holds the box's own place and height - never their bare ids", async () => {
    project();

    let release: () => void = (): void => {
      return undefined;
    };
    const held: Promise<void> = new Promise<void>((done: () => void) => {
      release = done;
    });
    const list: CappedListServer["list"] = server.list.bind(server);

    jest.spyOn(ModelAPI, "getList").mockImplementation((async (
      options: Parameters<CappedListServer["list"]>[0],
    ) => {
      await held;
      return list(options);
    }) as never);

    render(<PickerHarness initialValue={[CHECKOUT_ID]} />);

    const loading: HTMLElement = screen.getByTestId(
      RULE_CODE_REPOSITORIES_LOADING_TEST_ID,
    );

    // EntityDropdown's margins and its 38px box, so nothing jumps.
    for (const className of [
      "mt-2",
      "mb-1",
      "h-[38px]",
      "w-full",
      "rounded-lg",
    ]) {
      expect(loading.classList.contains(className)).toBe(true);
    }
    expect(document.body).not.toHaveTextContent(CHECKOUT_ID);

    await act(async () => {
      release();
    });

    await waitFor(() => {
      expect(picked()).toEqual(["checkout"]);
    });
    expect(
      screen.queryByTestId(RULE_CODE_REPOSITORIES_LOADING_TEST_ID),
    ).toBeNull();
  });

  test("a rule naming none is drawn at once, reading nothing until the menu opens", async () => {
    project();

    await renderPicker(undefined);

    expect(
      screen.queryByTestId(RULE_CODE_REPOSITORIES_LOADING_TEST_ID),
    ).toBeNull();
    expect(server.callsFor(CodeRepository)).toHaveLength(0);
  });

  test("is drawn as the Runbooks and MCP Servers pickers are: a search box, no chevron", async () => {
    project();
    await renderPicker(undefined);

    expect(
      within(picker()).getByTestId(
        `${RULE_CODE_REPOSITORIES_PICKER_TEST_ID}-dropdown`,
      ),
    ).toBe(searchBox());
    // Not the react-select picker the Runner field uses.
    expect(picker().querySelector(".ou-select__control")).toBeNull();
    expect(picker().querySelector("svg")).toBeNull();
  });

  test("nothing picked reads All connected repositories", async () => {
    project();
    await renderPicker(undefined);

    expect(placeholder()).toBe(RULE_CODE_REPOSITORIES_FIELD_COPY.placeholder);
    expect(picked()).toEqual([]);
    expect(picker()).not.toHaveTextContent("Optional");
  });

  test("lists the project's repositories by name, with GitHub's full name where it says more - asked of the server", async () => {
    project();
    await renderPicker(undefined);

    const options: Array<HTMLElement> = await openMenu(2);

    expect(options[0]).toHaveTextContent("billing");
    expect(options[0]).toHaveTextContent("acme/billing-service");
    expect(options[1]).toHaveTextContent("checkout");
    expect(options[1]).toHaveTextContent("acme/checkout");

    // 50 by name, never the project's first 10,000.
    const read: CappedListCall = searches()[0]!;

    expect(read.sort).toEqual({ name: SortOrder.Ascending });
    expect(read.limit).toBe(50);
  });

  test("picking repositories stores them by id; taking them all out is all of them again", async () => {
    project();
    await renderPicker(undefined);

    fireEvent.click((await openMenu(2))[1]!);
    expect(changes[changes.length - 1]).toEqual([CHECKOUT_ID]);

    // A picked one leaves the menu: billing is the one left to pick.
    const left: Array<HTMLElement> = await openMenu(1);
    expect(left[0]).toHaveTextContent("billing");
    fireEvent.click(left[0]!);
    expect([...changes[changes.length - 1]!].sort()).toEqual(
      [BILLING_ID, CHECKOUT_ID].sort(),
    );
    expect(picked()).toEqual(["checkout", "billing"]);

    removeChip("billing");
    removeChip("checkout");

    expect(changes[changes.length - 1]).toEqual([]);
    expect(picked()).toEqual([]);
    expect(placeholder()).toBe("All connected repositories");
  });

  test("a saved rule's repositories, as the form holds them, are shown picked - named by their ids", async () => {
    project();
    await renderPicker([
      { _id: CHECKOUT_ID.toUpperCase(), name: "a name the form held" },
    ]);

    await waitFor(() => {
      expect(picked()).toEqual(["checkout"]);
    });
    expect(
      (heldReads()[0]!.query["_id"] as Includes).values.map(
        (value: unknown): string => {
          return String(value);
        },
      ),
    ).toEqual([CHECKOUT_ID]);
  });

  test("one the reader may not read is kept, named as one they cannot access", async () => {
    project();
    await renderPicker([{ _id: CHECKOUT_ID }, { _id: HIDDEN_ID }]);

    await waitFor(() => {
      expect(picked()).toEqual(["checkout", "A repository you cannot access"]);
    });
    expect(picker()).not.toHaveTextContent(HIDDEN_ID);

    // Picking another keeps it: an edit never drops a repository.
    fireEvent.click((await openMenu(1))[0]!);
    expect(changes[changes.length - 1]).toEqual(
      expect.arrayContaining([CHECKOUT_ID, HIDDEN_ID, BILLING_ID]),
    );
  });

  test("a project whose plan cannot read repositories still gets the field, with nothing to pick - and what a rule names reads as out of reach", async () => {
    jest
      .spyOn(ModelAPI, "getList")
      .mockRejectedValue(new Error("Payment required") as never);

    await renderPicker([CHECKOUT_ID]);

    await waitFor(() => {
      expect(picked()).toEqual(["A repository you cannot access"]);
    });

    await act(async () => {
      fireEvent.focus(searchBox());
    });

    await waitFor(() => {
      expect(screen.getByTestId("entity-dropdown-menu")).toHaveTextContent(
        "No connected repositories yet.",
      );
    });
    expect(screen.queryAllByRole("option")).toEqual([]);
  });

  test("under it: where repositories are connected, as a link", () => {
    render(<RuleCodeRepositoriesFieldHint />);

    const hint: HTMLElement = screen.getByTestId(
      RULE_CODE_REPOSITORIES_HINT_TEST_ID,
    );

    expect(hint).toHaveTextContent(
      "Connect and manage repositories on the Code › Repositories page.",
    );
    const link: HTMLElement = within(hint).getByTestId(
      "rule-code-repositories-link",
    );
    expect(link).toHaveTextContent("Code › Repositories");
    expect(link).toHaveAttribute(
      "href",
      `/dashboard/${PROJECT_ID}/code/repositories`,
    );
    // In a new tab, as the Runner field's link: the rule being edited stays.
    expect(link).toHaveAttribute("target", "_blank");
  });

  /*
   * A chip cuts its words at 14rem, about 32 of these letters: the old
   * "A repository you do not have access to" lost its last word there.
   */
  test("the words for one the reader cannot access fit its chip", () => {
    expect(RULE_CODE_REPOSITORIES_FIELD_COPY.hiddenRepository).toBe(
      "A repository you cannot access",
    );
    expect(
      RULE_CODE_REPOSITORIES_FIELD_COPY.hiddenRepository.length,
    ).toBeLessThanOrEqual(32);
  });

  test("it asks the server, not a list it read once: one connected in another tab since is found by the next search", async () => {
    project();
    await renderPicker(undefined);
    expect(await openMenu(2)).toHaveLength(2);

    addRepository({
      id: "c4444444-4444-4444-8444-444444444444",
      name: "search-service",
    });

    await search("search");

    const option: HTMLElement = await screen.findByRole("option", {
      name: /search-service/,
    });

    fireEvent.click(option);
    expect(changes[changes.length - 1]).toEqual([
      "c4444444-4444-4444-8444-444444444444",
    ]);
  });
});

describe("a rule's code repositories past the project's first 10,000", () => {
  test("a repository past them is found on the server by its name - or by its organization", async () => {
    projectPastTheCap();
    await renderPicker(undefined);

    await search("warehouse");

    await waitFor(() => {
      expect(screen.queryAllByRole("option")).toHaveLength(1);
    });
    expect(screen.getAllByRole("option")[0]).toHaveTextContent(
      "warehouse-api",
    );
    expect(screen.getAllByRole("option")[0]).toHaveTextContent(
      "harbour/warehouse",
    );

    // The search looks in the name, the organization and the repository's name.
    const searched: MultiSearch = searches()
      .map((call: CappedListCall): unknown => {
        return Object.values(call.query).find((value: unknown) => {
          return value instanceof MultiSearch;
        });
      })
      .find((value: unknown) => {
        return Boolean(value);
      }) as MultiSearch;

    expect(searched.fields).toEqual([
      "name",
      "organizationName",
      "repositoryName",
    ]);

    await search("harbour");

    await waitFor(() => {
      expect(screen.queryAllByRole("option")).toHaveLength(1);
    });
    expect(screen.getAllByRole("option")[0]).toHaveTextContent(
      "warehouse-api",
    );
  });

  test("one a rule holds past them keeps its name, read by its id - never called out of reach", async () => {
    projectPastTheCap();
    await renderPicker([WAREHOUSE_ID]);

    await waitFor(() => {
      expect(picked()).toEqual(["warehouse-api"]);
    });
    expect(picker()).not.toHaveTextContent("A repository you cannot access");
    // Read by its id alone: no search of the project's repositories for it.
    expect(searches()).toHaveLength(0);
  });

  test("one a rule holds past them survives an edit that picks another", async () => {
    projectPastTheCap();
    await renderPicker([WAREHOUSE_ID]);

    await waitFor(() => {
      expect(picked()).toEqual(["warehouse-api"]);
    });

    await search("ap000001");

    const option: HTMLElement = await screen.findByRole("option", {
      name: /ap000001/,
    });

    fireEvent.click(option);

    expect(changes[changes.length - 1]).toEqual(
      expect.arrayContaining([WAREHOUSE_ID]),
    );
    expect(changes[changes.length - 1]).toHaveLength(2);
    expect(picked()).toEqual(["warehouse-api", "ap000001"]);
  });

  test("one a rule holds that is out of reach is a chip saying so, kept until it is taken out", async () => {
    projectPastTheCap();
    await renderPicker([WAREHOUSE_ID, HIDDEN_ID]);

    await waitFor(() => {
      expect(picked()).toEqual([
        "warehouse-api",
        "A repository you cannot access",
      ]);
    });

    removeChip("A repository you cannot access");

    expect(changes[changes.length - 1]).toEqual([WAREHOUSE_ID]);
  });
});

describe("what the field reads and folds to", () => {
  test("the repositories a rule names: rows, ids or picks, each once, lower-cased", () => {
    expect(
      getRuleCodeRepositoryIds({
        codeRepositories: [
          { _id: CHECKOUT_ID.toUpperCase() },
          CHECKOUT_ID,
          { value: BILLING_ID },
        ],
      }),
    ).toEqual([CHECKOUT_ID, BILLING_ID]);
    expect(getRuleCodeRepositoryIds({})).toEqual([]);
    expect(getRuleCodeRepositoryIds(null)).toEqual([]);
    expect(hasRuleCodeRepositories({ codeRepositories: [] })).toBe(false);
    expect(hasRuleCodeRepositories({ codeRepositories: [CHECKOUT_ID] })).toBe(
      true,
    );
  });

  test("folded, it says how many - and nothing for all of them, the default", () => {
    expect(getRuleCodeRepositoriesFoldedValue({})).toBeNull();
    expect(
      getRuleCodeRepositoriesFoldedValue({
        codeRepositories: [CHECKOUT_ID, BILLING_ID],
      }),
    ).toBe("2");
  });
});
