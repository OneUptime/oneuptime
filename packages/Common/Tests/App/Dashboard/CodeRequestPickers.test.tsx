import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import "@testing-library/jest-dom";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { createInstance, i18n } from "i18next";
import React, { ReactElement, useState } from "react";
import { I18nextProvider, initReactI18next } from "react-i18next";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import englishLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/en.json";
import germanLocale from "../../../../App/FeatureSet/Dashboard/src/Locales/de.json";
import getJestMockFunction, { MockFunction } from "../../MockType";

/*
 * The pickers in Code's request box, rendered for real: the small picker
 * they are built on (CodePicker), the repository a request goes to
 * (CodeRepositoryPicker) and the branch it starts from (CodeBranchPicker),
 * the way coding agents pick both beside their prompt.
 *
 * What a person relies on: a quiet button that says what is picked (and
 * reads out "Branch: main"), a list with a search box that the keys drive -
 * arrows, Enter, Escape giving the button its focus back - and a click
 * anywhere else closing it; on a phone the list stays on the screen. A
 * repository's branches are read the first time the picker opens, its main
 * branch first and marked Default; picking the main branch is picking
 * nothing; a repository with more branches than one read holds is searched
 * on the server as the person types, and an answer to an older search never
 * replaces a newer one; a read that fails says so, with Try again.
 */

const getBranchesMock: MockFunction = getJestMockFunction();

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeApi",
  () => {
    return {
      __esModule: true,
      CODE_TASK_API_PATH: "/code-task",
      default: {
        getBranches: (...args: Array<unknown>) => {
          return getBranchesMock(...args);
        },
      },
    };
  },
);

import CodePicker, {
  CodePickerOption,
  getPickerMenuShift,
  PICKER_MENU_WIDTH_PX,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodePicker";
import CodeBranchPicker, {
  BRANCH_SEARCH_DELAY_MS,
  filterBranches,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeBranchPicker";
import CodeRepositoryPicker, {
  getRepositoryOptions,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeRepositoryPicker";
import { CodeRepositoryListItem } from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeApi";
import { Translator } from "../../../UI/Utils/TranslateTemplate";

const REPOSITORY_ID: string = "6c7d8e9f-0a1b-4c2d-9e3f-4a5b6c7d8e9f";
const OTHER_REPOSITORY_ID: string = "5b6c7d8e-9f0a-4b1c-8d2e-3f4a5b6c7d8e";

const translation: i18n = createInstance();
const germanTranslation: i18n = createInstance();
const ORIGINAL_WIDTH: number = window.innerWidth;

beforeAll(async () => {
  Element.prototype.scrollIntoView = (): void => {};
  await translation.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: { en: { translation: englishLocale } },
    interpolation: { escapeValue: false },
  });
  await germanTranslation.use(initReactI18next).init({
    lng: "de",
    fallbackLng: "en",
    resources: {
      en: { translation: englishLocale },
      de: { translation: germanLocale },
    },
    interpolation: { escapeValue: false },
  });
});

beforeEach(() => {
  getBranchesMock.mockReset();
});

afterEach(() => {
  cleanup();
  Object.defineProperty(window, "innerWidth", {
    configurable: true,
    writable: true,
    value: ORIGINAL_WIDTH,
  });
});

function draw(element: ReactElement, language: i18n = translation): void {
  render(<I18nextProvider i18n={language}>{element}</I18nextProvider>);
}

const FRUIT: Array<CodePickerOption> = [
  { value: "apple", label: "apple", description: "red/round" },
  { value: "banana", label: "banana", badge: "Default" },
  { value: "cherry", label: "cherry", isMuted: true },
];

// A picker that keeps what is picked, as a page does.
function Fruit(props: {
  initial?: string | null;
  isDisabled?: boolean;
  onSearch?: (search: string) => void;
  isLoading?: boolean;
  error?: string | null;
  onRetry?: () => void;
  note?: string | null;
  onOpen?: () => void;
  options?: Array<CodePickerOption>;
}): ReactElement {
  const [value, setValue] = useState<string | null>(props.initial ?? "apple");

  return (
    <div>
      <button type="button" data-testid="elsewhere">
        Elsewhere
      </button>
      <CodePicker
        dataTestId="fruit"
        label="Fruit"
        valueText={value || "Pick a fruit"}
        icon={<span data-testid="fruit-icon" />}
        options={props.options || FRUIT}
        value={value}
        onChange={setValue}
        searchPlaceholder="Find a fruit"
        noMatchText="No fruit matches."
        onSearch={props.onSearch}
        isLoading={props.isLoading}
        loadingText="Picking fruit…"
        error={props.error}
        onRetry={props.onRetry}
        note={props.note}
        onOpen={props.onOpen}
        isDisabled={props.isDisabled}
      />
    </div>
  );
}

function button(testId: string = "fruit"): HTMLElement {
  return screen.getByTestId(`${testId}-button`);
}

function options(testId: string = "fruit"): Array<HTMLElement> {
  return screen.queryAllByTestId(`${testId}-option`);
}

function labels(testId: string = "fruit"): Array<string> {
  return options(testId).map((option: HTMLElement) => {
    return option.getAttribute("data-value") || "";
  });
}

describe("a picker in the request box", () => {
  test("a quiet button that says what is picked - and reads it out with what it picks", () => {
    draw(<Fruit />);

    expect(button()).toHaveTextContent("apple");
    expect(button()).toHaveAttribute("aria-label", "Fruit: apple");
    expect(button()).toHaveAttribute("aria-haspopup", "listbox");
    expect(button()).toHaveAttribute("aria-expanded", "false");
    expect(button()).toHaveAttribute("title", "apple");
    expect(screen.queryByTestId("fruit-menu")).toBeNull();
  });

  test("opens on a list with a search box that takes the focus; the picked one is checked", async () => {
    const onOpen: MockFunction = getJestMockFunction();
    draw(<Fruit onOpen={onOpen} />);

    await userEvent.click(button());

    expect(button()).toHaveAttribute("aria-expanded", "true");
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("fruit-search")).toHaveFocus();
    expect(screen.getByRole("listbox", { name: "Fruit" })).toBeInTheDocument();
    expect(labels()).toEqual(["apple", "banana", "cherry"]);
    expect(options()[0]).toHaveAttribute("aria-selected", "true");
    expect(options()[1]).toHaveAttribute("aria-selected", "false");
    // A second line, a badge, and a quieter name where an option has them.
    expect(options()[0]).toHaveTextContent("red/round");
    expect(options()[1]).toHaveTextContent("Default");
    expect(
      within(options()[2]!).getByText("cherry").className,
    ).toContain("text-gray-500");
  });

  test("typing filters by name or second line; nothing left says so", async () => {
    draw(<Fruit />);
    await userEvent.click(button());

    await userEvent.type(screen.getByTestId("fruit-search"), "AN");
    expect(labels()).toEqual(["banana"]);

    await userEvent.clear(screen.getByTestId("fruit-search"));
    await userEvent.type(screen.getByTestId("fruit-search"), "round");
    expect(labels()).toEqual(["apple"]);

    await userEvent.type(screen.getByTestId("fruit-search"), "xyz");
    expect(options()).toHaveLength(0);
    expect(screen.getByTestId("fruit-empty")).toHaveTextContent(
      "No fruit matches.",
    );
  });

  test("the keys drive it: arrows move, the screen reader follows, Enter picks and the button gets its focus back", async () => {
    draw(<Fruit />);
    await userEvent.click(button());
    const search: HTMLElement = screen.getByTestId("fruit-search");

    // It starts on the one picked.
    expect(options()[0]).toHaveAttribute("data-active", "true");
    await userEvent.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}");
    // Never past the end.
    expect(options()[2]).toHaveAttribute("data-active", "true");
    expect(search).toHaveAttribute(
      "aria-activedescendant",
      options()[2]!.getAttribute("id"),
    );
    await userEvent.keyboard("{ArrowUp}");
    expect(options()[1]).toHaveAttribute("data-active", "true");

    await userEvent.keyboard("{Enter}");
    expect(screen.queryByTestId("fruit-menu")).toBeNull();
    expect(button()).toHaveTextContent("banana");
    expect(button()).toHaveFocus();
  });

  test("Escape closes it and gives the button its focus back, picking nothing", async () => {
    draw(<Fruit />);
    await userEvent.click(button());
    await userEvent.keyboard("{ArrowDown}{Escape}");

    expect(screen.queryByTestId("fruit-menu")).toBeNull();
    expect(button()).toHaveTextContent("apple");
    expect(button()).toHaveFocus();
  });

  test("a click anywhere else closes it; a click on an option picks it", async () => {
    draw(<Fruit />);
    await userEvent.click(button());
    await userEvent.click(screen.getByTestId("elsewhere"));
    expect(screen.queryByTestId("fruit-menu")).toBeNull();

    await userEvent.click(button());
    await userEvent.click(options()[2]!);
    expect(button()).toHaveTextContent("cherry");
    expect(screen.queryByTestId("fruit-menu")).toBeNull();
  });

  test("Tab moves on and closes it", async () => {
    draw(<Fruit />);
    await userEvent.click(button());
    await userEvent.keyboard("{Tab}");

    expect(screen.queryByTestId("fruit-menu")).toBeNull();
  });

  test("the button opens and closes it", async () => {
    draw(<Fruit />);
    await userEvent.click(button());
    expect(screen.getByTestId("fruit-menu")).toBeInTheDocument();
    await userEvent.click(button());
    expect(screen.queryByTestId("fruit-menu")).toBeNull();
  });

  test("a picker that cannot be used does not open, and has no arrow", async () => {
    draw(<Fruit isDisabled={true} />);

    expect(button()).toBeDisabled();
    await userEvent.click(button());
    expect(screen.queryByTestId("fruit-menu")).toBeNull();
    // The value and its mark only: one svg would be the chevron.
    expect(button().querySelectorAll("svg")).toHaveLength(0);
  });

  test("loading, a failure with Try again, and a note under the list", async () => {
    const onRetry: MockFunction = getJestMockFunction();
    const { rerender } = render(
      <I18nextProvider i18n={translation}>
        <Fruit isLoading={true} />
      </I18nextProvider>,
    );
    await userEvent.click(button());
    expect(screen.getByTestId("fruit-loading")).toHaveTextContent(
      "Picking fruit…",
    );
    expect(screen.getByTestId("fruit-loading")).toHaveAttribute(
      "role",
      "status",
    );
    expect(options()).toHaveLength(0);

    rerender(
      <I18nextProvider i18n={translation}>
        <Fruit error="The fruit could not be read." onRetry={onRetry} />
      </I18nextProvider>,
    );
    const failure: HTMLElement = screen.getByTestId("fruit-error");
    expect(failure).toHaveAttribute("role", "alert");
    expect(failure).toHaveTextContent("The fruit could not be read.");
    await userEvent.click(within(failure).getByRole("button"));
    expect(onRetry).toHaveBeenCalledTimes(1);
    // Back in the search box, ready for the answer.
    expect(screen.getByTestId("fruit-search")).toHaveFocus();

    rerender(
      <I18nextProvider i18n={translation}>
        <Fruit note="Type to find more." />
      </I18nextProvider>,
    );
    expect(screen.getByTestId("fruit-note")).toHaveTextContent(
      "Type to find more.",
    );
  });

  test("a picker that finds its own options is told what is typed, and shows them as given", async () => {
    const onSearch: MockFunction = getJestMockFunction();
    draw(<Fruit onSearch={onSearch} />);

    await userEvent.click(button());
    // Opening starts a fresh search.
    expect(onSearch).toHaveBeenCalledWith("");
    await userEvent.type(screen.getByTestId("fruit-search"), "zz");

    expect(onSearch).toHaveBeenLastCalledWith("zz");
    // Nothing is filtered here: the page's options stand.
    expect(labels()).toEqual(["apple", "banana", "cherry"]);
  });

  test("on a phone, the list moves left as far as it must to stay on the screen", async () => {
    Object.defineProperty(window, "innerWidth", {
      configurable: true,
      writable: true,
      value: 390,
    });
    draw(<Fruit />);
    jest.spyOn(button(), "getBoundingClientRect").mockReturnValue({
      left: 200,
      right: 280,
      top: 0,
      bottom: 32,
      width: 80,
      height: 32,
      x: 200,
      y: 0,
      toJSON: () => {
        return {};
      },
    } as DOMRect);

    await userEvent.click(button());

    // 200 + 288 runs 110 px past the window's 378 px of room.
    expect(screen.getByTestId("fruit-menu").style.left).toBe("-110px");
  });

  test("where the list opens, as a pure rule", () => {
    // Fits: under its button.
    expect(
      getPickerMenuShift({
        buttonLeft: 100,
        windowWidth: 1280,
        menuWidth: PICKER_MENU_WIDTH_PX,
      }),
    ).toBe(0);
    // Runs past the right edge: moved left by the overflow.
    expect(
      getPickerMenuShift({
        buttonLeft: 1100,
        windowWidth: 1280,
        menuWidth: PICKER_MENU_WIDTH_PX,
      }),
    ).toBe(1100 + 288 - 1268);
    // A window narrower than the list: never past the left edge.
    expect(
      getPickerMenuShift({
        buttonLeft: 40,
        windowWidth: 300,
        menuWidth: PICKER_MENU_WIDTH_PX,
      }),
    ).toBe(28);
  });
});

describe("the repository picker", () => {
  const REPOSITORIES: Array<CodeRepositoryListItem> = [
    {
      id: REPOSITORY_ID,
      name: "checkout-api",
      organizationName: "acme",
      repositoryName: "checkout-api",
      isConnected: true,
      stats: { working: 0, waitingForYou: 0, openPullRequests: 0, taskCount: 0 },
    },
    {
      id: OTHER_REPOSITORY_ID,
      name: "web",
      organizationName: "acme",
      repositoryName: "storefront-web",
      isConnected: false,
      stats: { working: 0, waitingForYou: 0, openPullRequests: 0, taskCount: 0 },
    },
  ];

  test("each repository by name, GitHub's name under it when it says more, and one AI cannot reach marked", () => {
    // English: every word as its key.
    const translator: Translator = {
      translateText: (text: string | undefined) => {
        return text;
      },
      translateTemplate: (text: string) => {
        return text;
      },
    } as unknown as Translator;

    expect(getRepositoryOptions(REPOSITORIES, translator)).toEqual([
      // Its own name says it all: no second line.
      { value: REPOSITORY_ID, label: "checkout-api", description: "acme/checkout-api" },
      {
        value: OTHER_REPOSITORY_ID,
        label: "web",
        description: "acme/storefront-web",
        badge: "Not connected",
        isMuted: true,
      },
    ]);
  });

  test("the GitHub mark and the name picked; Pick a repository before one is", async () => {
    const onChange: MockFunction = getJestMockFunction();
    draw(
      <CodeRepositoryPicker
        repositories={REPOSITORIES}
        value={null}
        onChange={onChange as unknown as (id: string) => void}
      />,
    );

    expect(button("code-repository-picker")).toHaveTextContent(
      "Pick a repository",
    );
    await userEvent.click(button("code-repository-picker"));
    expect(screen.getByTestId("code-repository-picker-search")).toHaveAttribute(
      "placeholder",
      "Find a repository",
    );
    await userEvent.type(
      screen.getByTestId("code-repository-picker-search"),
      "storefront",
    );
    expect(labels("code-repository-picker")).toEqual([OTHER_REPOSITORY_ID]);
    await userEvent.click(options("code-repository-picker")[0]!);
    expect(onChange).toHaveBeenCalledWith(OTHER_REPOSITORY_ID);
  });

  test("in German, the picker speaks German", async () => {
    draw(
      <CodeRepositoryPicker
        repositories={REPOSITORIES}
        value={REPOSITORY_ID}
        onChange={() => {}}
      />,
      germanTranslation,
    );

    expect(button("code-repository-picker")).toHaveAttribute(
      "aria-label",
      `${germanLocale["Repository"]}: checkout-api`,
    );
    await userEvent.click(button("code-repository-picker"));
    expect(options("code-repository-picker")[1]).toHaveTextContent(
      germanLocale["Not connected"],
    );
  });
});

describe("the branch picker", () => {
  // A page that keeps the branch picked, null for the main one.
  function Branches(props: {
    repositoryId?: string;
    defaultBranch?: string;
    isDisabled?: boolean;
    onChange?: (branch: string | null) => void;
  }): ReactElement {
    const [branch, setBranch] = useState<string | null>(null);

    return (
      <CodeBranchPicker
        repositoryId={props.repositoryId || REPOSITORY_ID}
        defaultBranch={props.defaultBranch ?? "main"}
        value={branch}
        onChange={(next: string | null) => {
          setBranch(next);
          props.onChange?.(next);
        }}
        isDisabled={props.isDisabled}
      />
    );
  }

  function listing(
    branches: Array<string>,
    isComplete: boolean = true,
  ): Record<string, unknown> {
    return { branches, defaultBranch: "main", isComplete };
  }

  test("says the main branch until another is picked, read out as a branch", () => {
    draw(<Branches />);

    expect(button("code-branch-picker")).toHaveTextContent("main");
    expect(button("code-branch-picker")).toHaveAttribute(
      "aria-label",
      "Branch: main",
    );
    // Branch names read as code.
    expect(
      within(button("code-branch-picker")).getByText("main").className,
    ).toContain("font-mono");
    expect(getBranchesMock).not.toHaveBeenCalled();
  });

  test("a main branch not known yet is the Default branch, in words", () => {
    draw(<Branches defaultBranch="" />);

    expect(button("code-branch-picker")).toHaveTextContent("Default branch");
    expect(
      within(button("code-branch-picker")).getByText("Default branch")
        .className,
    ).not.toContain("font-mono");
  });

  test("reads the branches the first time it opens - the main one first, marked Default - and never again", async () => {
    let answer: (value: unknown) => void = () => {};
    getBranchesMock.mockReturnValue(
      new Promise((resolve: (value: unknown) => void) => {
        answer = resolve;
      }) as never,
    );
    draw(<Branches />);

    await userEvent.click(button("code-branch-picker"));
    expect(screen.getByTestId("code-branch-picker-loading")).toHaveTextContent(
      "Loading branches…",
    );
    expect(getBranchesMock).toHaveBeenCalledWith({
      repositoryId: REPOSITORY_ID,
      search: undefined,
    });

    answer(listing(["main", "release/2026-10", "fix/timeout"]));
    await waitFor(() => {
      expect(labels("code-branch-picker")).toEqual([
        "main",
        "release/2026-10",
        "fix/timeout",
      ]);
    });
    expect(options("code-branch-picker")[0]).toHaveTextContent("Default");
    expect(options("code-branch-picker")[0]).toHaveAttribute(
      "aria-selected",
      "true",
    );
    expect(options("code-branch-picker")[1]).not.toHaveTextContent("Default");
    // Every branch is here: nothing to search for on the server.
    expect(screen.queryByTestId("code-branch-picker-note")).toBeNull();

    await userEvent.click(button("code-branch-picker"));
    await userEvent.click(button("code-branch-picker"));
    expect(getBranchesMock).toHaveBeenCalledTimes(1);
  });

  test("picking a branch says it on the button; picking the main one again is picking nothing", async () => {
    const onChange: MockFunction = getJestMockFunction();
    getBranchesMock.mockResolvedValue(
      listing(["main", "release/2026-10"]) as never,
    );
    draw(
      <Branches
        onChange={onChange as unknown as (branch: string | null) => void}
      />,
    );

    await userEvent.click(button("code-branch-picker"));
    await waitFor(() => {
      expect(options("code-branch-picker")).toHaveLength(2);
    });
    await userEvent.click(options("code-branch-picker")[1]!);
    expect(onChange).toHaveBeenLastCalledWith("release/2026-10");
    expect(button("code-branch-picker")).toHaveTextContent("release/2026-10");

    await userEvent.click(button("code-branch-picker"));
    expect(options("code-branch-picker")[1]).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await userEvent.click(options("code-branch-picker")[0]!);
    expect(onChange).toHaveBeenLastCalledWith(null);
    expect(button("code-branch-picker")).toHaveTextContent("main");
  });

  test("every branch held: typing filters them here, asking the server nothing", async () => {
    getBranchesMock.mockResolvedValue(
      listing(["main", "release/2026-10", "fix/timeout"]) as never,
    );
    draw(<Branches />);

    await userEvent.click(button("code-branch-picker"));
    await waitFor(() => {
      expect(options("code-branch-picker")).toHaveLength(3);
    });
    await userEvent.type(
      screen.getByTestId("code-branch-picker-search"),
      "TIME",
    );

    expect(labels("code-branch-picker")).toEqual(["fix/timeout"]);
    expect(getBranchesMock).toHaveBeenCalledTimes(1);

    await userEvent.clear(screen.getByTestId("code-branch-picker-search"));
    await userEvent.type(
      screen.getByTestId("code-branch-picker-search"),
      "nothing-like-it",
    );
    expect(screen.getByTestId("code-branch-picker-empty")).toHaveTextContent(
      "No branch matches your search.",
    );
  });

  test(`more branches than one read holds: says how to find the rest, and searches the server ${BRANCH_SEARCH_DELAY_MS} ms after typing rests`, async () => {
    getBranchesMock.mockImplementation(((data: { search?: string }) => {
      if (!data.search) {
        return Promise.resolve(
          listing(["main", "feature/a", "feature/b"], false),
        );
      }
      return Promise.resolve(
        listing(["hotfix/payments", "hotfix/payments-2"], true),
      );
    }) as never);
    draw(<Branches />);

    await userEvent.click(button("code-branch-picker"));
    await waitFor(() => {
      expect(options("code-branch-picker")).toHaveLength(3);
    });
    expect(screen.getByTestId("code-branch-picker-note")).toHaveTextContent(
      "Type a branch's name to find one that is not listed.",
    );

    await userEvent.type(
      screen.getByTestId("code-branch-picker-search"),
      "hotfix/",
    );
    // Until the answer comes, it is loading - never "no branch matches".
    expect(screen.queryByTestId("code-branch-picker-empty")).toBeNull();

    await waitFor(() => {
      expect(labels("code-branch-picker")).toEqual([
        "hotfix/payments",
        "hotfix/payments-2",
      ]);
    });
    // One read for the whole word, not one per letter.
    expect(getBranchesMock).toHaveBeenCalledTimes(2);
    expect(getBranchesMock).toHaveBeenLastCalledWith({
      repositoryId: REPOSITORY_ID,
      search: "hotfix/",
    });
    // A search's answer needs no note.
    expect(screen.queryByTestId("code-branch-picker-note")).toBeNull();
  });

  test("an answer to an older search never replaces a newer one", async () => {
    const answers: Map<string, (value: unknown) => void> = new Map();
    getBranchesMock.mockImplementation(((data: { search?: string }) => {
      if (!data.search) {
        return Promise.resolve(listing(["main", "a"], false));
      }
      return new Promise((resolve: (value: unknown) => void) => {
        answers.set(data.search!, resolve);
      });
    }) as never);
    draw(<Branches />);

    await userEvent.click(button("code-branch-picker"));
    await waitFor(() => {
      expect(options("code-branch-picker")).toHaveLength(2);
    });
    const search: HTMLElement = screen.getByTestId(
      "code-branch-picker-search",
    );

    fireEvent.change(search, { target: { value: "old" } });
    await waitFor(() => {
      expect(answers.has("old")).toBe(true);
    });
    fireEvent.change(search, { target: { value: "new" } });
    await waitFor(() => {
      expect(answers.has("new")).toBe(true);
    });

    answers.get("new")!(listing(["new-branch"], true));
    await waitFor(() => {
      expect(labels("code-branch-picker")).toEqual(["new-branch"]);
    });
    answers.get("old")!(listing(["old-branch"], true));
    await new Promise((resolve: (value: unknown) => void) => {
      setTimeout(resolve, 50);
    });
    expect(labels("code-branch-picker")).toEqual(["new-branch"]);
  });

  test("branches that cannot be read say so, and Try again reads them again", async () => {
    getBranchesMock
      .mockRejectedValueOnce(
        new HTTPErrorResponse(
          400,
          {
            message:
              "OneUptime could not read this repository's branches from GitHub. Try again in a moment.",
          },
          {},
        ) as never,
      )
      .mockResolvedValueOnce(listing(["main", "dev"]) as never);
    draw(<Branches />);

    await userEvent.click(button("code-branch-picker"));
    const failure: HTMLElement = await screen.findByTestId(
      "code-branch-picker-error",
    );
    expect(failure).toHaveTextContent(
      "OneUptime could not read this repository's branches from GitHub.",
    );

    await userEvent.click(screen.getByTestId("code-branch-picker-retry"));
    await waitFor(() => {
      expect(labels("code-branch-picker")).toEqual(["main", "dev"]);
    });
    expect(getBranchesMock).toHaveBeenCalledTimes(2);
  });

  test("another repository: its own branches, read afresh, and nothing of the last one's", async () => {
    getBranchesMock.mockImplementation(((data: { repositoryId: string }) => {
      return Promise.resolve(
        data.repositoryId === REPOSITORY_ID
          ? listing(["main", "release/2026-10"])
          : { branches: ["trunk"], defaultBranch: "trunk", isComplete: true },
      );
    }) as never);
    const { rerender } = render(
      <I18nextProvider i18n={translation}>
        <Branches repositoryId={REPOSITORY_ID} />
      </I18nextProvider>,
    );

    await userEvent.click(button("code-branch-picker"));
    await waitFor(() => {
      expect(options("code-branch-picker")).toHaveLength(2);
    });
    await userEvent.click(button("code-branch-picker"));

    rerender(
      <I18nextProvider i18n={translation}>
        <Branches repositoryId={OTHER_REPOSITORY_ID} defaultBranch="trunk" />
      </I18nextProvider>,
    );
    expect(button("code-branch-picker")).toHaveTextContent("trunk");

    await userEvent.click(button("code-branch-picker"));
    await waitFor(() => {
      expect(labels("code-branch-picker")).toEqual(["trunk"]);
    });
    expect(getBranchesMock).toHaveBeenLastCalledWith({
      repositoryId: OTHER_REPOSITORY_ID,
      search: undefined,
    });
  });

  test("a branch picker that cannot be used reads nothing", async () => {
    draw(<Branches isDisabled={true} />);

    expect(button("code-branch-picker")).toBeDisabled();
    await userEvent.click(button("code-branch-picker"));
    expect(getBranchesMock).not.toHaveBeenCalled();
  });

  test("in German, it speaks German", async () => {
    getBranchesMock.mockResolvedValue(listing(["main", "dev"]) as never);
    draw(<Branches />, germanTranslation);

    expect(button("code-branch-picker")).toHaveAttribute(
      "aria-label",
      `${germanLocale["Branch"]}: main`,
    );
    await userEvent.click(button("code-branch-picker"));
    expect(screen.getByTestId("code-branch-picker-search")).toHaveAttribute(
      "placeholder",
      germanLocale["Find a branch"],
    );
    await waitFor(() => {
      expect(options("code-branch-picker")[0]).toHaveTextContent(
        germanLocale["Default"],
      );
    });
  });

  test("which branches a picker holding every branch shows, as a pure rule", () => {
    const branches: Array<string> = ["main", "Release/1", "fix/release-notes"];

    expect(filterBranches(branches, "")).toBe(branches);
    expect(filterBranches(branches, "  release ")).toEqual([
      "Release/1",
      "fix/release-notes",
    ]);
    expect(filterBranches(branches, "nothing")).toEqual([]);
  });
});
