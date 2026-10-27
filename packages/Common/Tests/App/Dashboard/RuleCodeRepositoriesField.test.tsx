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
  getRuleCodeRepositoryChoices,
  getRuleCodeRepositoryIds,
  hasRuleCodeRepositories,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/RuleCodeRepositoriesCopy";
import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import ListResult from "../../../Types/BaseDatabase/ListResult";
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
 *     rule being edited stays; the list is read again when the window
 *     takes the focus back, so a repository connected there can be picked.
 */

const PROJECT_ID: string = "dddddddd-0000-4000-8000-000000000001";
const CHECKOUT_ID: string = "c1111111-1111-4111-8111-111111111111";
const BILLING_ID: string = "c2222222-2222-4222-8222-222222222222";
const HIDDEN_ID: string = "c3333333-3333-4333-8333-333333333333";

function repository(data: {
  id: string;
  name: string;
  organizationName?: string;
  repositoryName?: string;
}): CodeRepository {
  const row: CodeRepository = new CodeRepository();
  row._id = data.id;
  row.name = data.name;

  if (data.organizationName) {
    row.organizationName = data.organizationName;
  }

  if (data.repositoryName) {
    row.repositoryName = data.repositoryName;
  }

  return row;
}

function listed(): ListResult<CodeRepository> {
  return {
    data: [
      repository({
        id: BILLING_ID,
        name: "billing",
        organizationName: "acme",
        repositoryName: "billing-service",
      }),
      repository({
        id: CHECKOUT_ID,
        name: "checkout",
        organizationName: "acme",
        repositoryName: "checkout",
      }),
    ],
    count: 2,
    skip: 0,
    limit: 100,
  };
}

let changes: Array<Array<string>> = [];
let listSpy: ReturnType<typeof jest.spyOn>;

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

// The menu, opened as a person does: the search box takes the focus.
function openMenu(): Array<HTMLElement> {
  fireEvent.focus(searchBox());

  return screen.queryAllByRole("option");
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

beforeEach(() => {
  changes = [];
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));
  listSpy = jest
    .spyOn(ModelAPI, "getList")
    .mockResolvedValue(listed() as never);
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a rule's code repositories", () => {
  test("waits for the repositories at the menu's own height, read by name", async () => {
    let resolve: (value: ListResult<CodeRepository>) => void = (): void => {
      return undefined;
    };
    listSpy.mockReturnValue(
      new Promise<ListResult<CodeRepository>>(
        (done: (value: ListResult<CodeRepository>) => void) => {
          resolve = done;
        },
      ) as never,
    );

    render(<PickerHarness initialValue={undefined} />);

    expect(
      screen.getByTestId(RULE_CODE_REPOSITORIES_LOADING_TEST_ID),
    ).toBeInTheDocument();

    const request: {
      modelType: unknown;
      select: Record<string, unknown>;
      sort: Record<string, unknown>;
    } = listSpy.mock.calls[0]![0] as never;

    expect(request.modelType).toBe(CodeRepository);
    expect(request.select).toEqual({
      _id: true,
      name: true,
      organizationName: true,
      repositoryName: true,
    });
    expect(request.sort).toEqual({ name: SortOrder.Ascending });

    await act(async () => {
      resolve(listed());
    });

    expect(
      screen.queryByTestId(RULE_CODE_REPOSITORIES_LOADING_TEST_ID),
    ).toBeNull();
    expect(placeholder()).toBe("All connected repositories");
  });

  test("while it reads them, it holds the box's own place and height", () => {
    listSpy.mockReturnValue(new Promise<never>(() => {}) as never);

    render(<PickerHarness initialValue={undefined} />);

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
  });

  test("is drawn as the Runbooks and MCP Servers pickers are: a search box, no chevron", async () => {
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
    await renderPicker(undefined);

    expect(placeholder()).toBe(RULE_CODE_REPOSITORIES_FIELD_COPY.placeholder);
    expect(picked()).toEqual([]);
    expect(picker()).not.toHaveTextContent("Optional");
  });

  test("lists the project's repositories by name, with GitHub's full name where it says more", async () => {
    await renderPicker(undefined);

    const options: Array<HTMLElement> = openMenu();

    expect(options).toHaveLength(2);
    expect(options[0]).toHaveTextContent("billing");
    expect(options[0]).toHaveTextContent("acme/billing-service");
    expect(options[1]).toHaveTextContent("checkout");
    expect(options[1]).toHaveTextContent("acme/checkout");
  });

  test("picking repositories stores them by id; taking them all out is all of them again", async () => {
    await renderPicker(undefined);

    fireEvent.click(openMenu()[1]!);
    expect(changes[changes.length - 1]).toEqual([CHECKOUT_ID]);

    // A picked one leaves the menu: billing is the one left to pick.
    const left: Array<HTMLElement> = openMenu();
    expect(left).toHaveLength(1);
    expect(left[0]).toHaveTextContent("billing");
    fireEvent.click(left[0]!);
    expect([...changes[changes.length - 1]!].sort()).toEqual(
      [BILLING_ID, CHECKOUT_ID].sort(),
    );
    // Drawn in the list's order, by name.
    expect(picked()).toEqual(["billing", "checkout"]);

    removeChip("billing");
    removeChip("checkout");

    expect(changes[changes.length - 1]).toEqual([]);
    expect(picked()).toEqual([]);
    expect(placeholder()).toBe("All connected repositories");
  });

  test("a saved rule's repositories, as the form holds them, are shown picked", async () => {
    await renderPicker([
      repository({ id: CHECKOUT_ID.toUpperCase(), name: "checkout" }),
    ]);

    expect(picked()).toEqual(["checkout"]);
  });

  test("one the reader may not read is kept, named as one they cannot access", async () => {
    await renderPicker([{ _id: CHECKOUT_ID }, { _id: HIDDEN_ID }]);

    expect(picked()).toEqual(["checkout", "A repository you cannot access"]);
    expect(picker()).not.toHaveTextContent(HIDDEN_ID);

    // Picking another keeps it: an edit never drops a repository.
    fireEvent.click(openMenu()[0]!);
    expect(changes[changes.length - 1]).toEqual(
      expect.arrayContaining([CHECKOUT_ID, HIDDEN_ID, BILLING_ID]),
    );
  });

  test("a project whose plan cannot read repositories still gets the field, with nothing to pick", async () => {
    listSpy.mockRejectedValue(new Error("Payment required") as never);

    await renderPicker(undefined);

    expect(placeholder()).toBe("All connected repositories");
    expect(openMenu()).toEqual([]);
    expect(screen.getByTestId("entity-dropdown-menu")).toHaveTextContent(
      "No connected repositories yet.",
    );
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

  test("reads the repositories again when the window takes the focus back: one connected in another tab can be picked", async () => {
    await renderPicker(undefined);
    expect(openMenu()).toHaveLength(2);

    listSpy.mockResolvedValue({
      ...listed(),
      data: [
        ...listed().data,
        repository({
          id: "c4444444-4444-4444-8444-444444444444",
          name: "search",
          organizationName: "acme",
          repositoryName: "search",
        }),
      ],
      count: 3,
    } as never);

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(listSpy).toHaveBeenCalledTimes(2);
    const options: Array<HTMLElement> = openMenu();
    expect(options).toHaveLength(3);
    expect(options[2]).toHaveTextContent("search");
  });

  test("a read again that fails keeps the repositories it has", async () => {
    await renderPicker(undefined);
    expect(openMenu()).toHaveLength(2);

    listSpy.mockRejectedValue(new Error("Network error") as never);

    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });

    expect(listSpy).toHaveBeenCalledTimes(2);
    expect(openMenu()).toHaveLength(2);
  });

  test("an older read that answers late never replaces a newer one", async () => {
    let answerFirst: (value: ListResult<CodeRepository>) => void = (): void => {
      return undefined;
    };
    listSpy.mockReturnValueOnce(
      new Promise<ListResult<CodeRepository>>(
        (done: (value: ListResult<CodeRepository>) => void) => {
          answerFirst = done;
        },
      ) as never,
    );
    listSpy.mockResolvedValueOnce({
      ...listed(),
      data: listed().data.slice(1),
      count: 1,
    } as never);

    render(<PickerHarness initialValue={undefined} />);

    // Focus comes back before the first read answers: a newer read.
    await act(async () => {
      window.dispatchEvent(new Event("focus"));
    });
    expect(openMenu()).toHaveLength(1);

    await act(async () => {
      answerFirst(listed());
    });

    // The first read's answer is older than what is drawn: dropped.
    expect(openMenu()).toHaveLength(1);
  });

  test("stops reading on focus once it is gone", async () => {
    const view: { unmount: () => void } = render(
      <PickerHarness initialValue={undefined} />,
    );
    await screen.findByTestId(RULE_CODE_REPOSITORIES_PICKER_TEST_ID);
    expect(listSpy).toHaveBeenCalledTimes(1);

    view.unmount();
    window.dispatchEvent(new Event("focus"));

    expect(listSpy).toHaveBeenCalledTimes(1);
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

  test("its choices: the project's, then each named one the reader was not shown", () => {
    expect(
      getRuleCodeRepositoryChoices({
        repositories: [{ id: CHECKOUT_ID, name: "checkout" }],
        pickedIds: [CHECKOUT_ID, HIDDEN_ID],
        hiddenLabel: RULE_CODE_REPOSITORIES_FIELD_COPY.hiddenRepository,
      }),
    ).toEqual([
      { id: CHECKOUT_ID, name: "checkout" },
      {
        id: HIDDEN_ID,
        name: "A repository you cannot access",
        isHidden: true,
      },
    ]);
  });
});
