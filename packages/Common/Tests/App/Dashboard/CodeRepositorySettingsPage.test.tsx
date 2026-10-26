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
import userEvent from "@testing-library/user-event";
import { UserEvent } from "@testing-library/user-event/dist/types/setup/setup";
import React, { ReactElement } from "react";
import { PAGE_ANCHOR_LANDED_ATTRIBUTE } from "../../../UI/Utils/PageAnchor";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * A code repository's Settings in Code (Pages/Code/Repository/Settings):
 * as little to configure as possible, drawn as every settings page in
 * OneUptime is.
 *
 *   - On top, Repository Details alone. Every other setting is folded under
 *     More settings, in the order the page had them: the GitHub Commands
 *     switch, the Production Review switch, Runner, then Pull Requests,
 *     GitHub Trigger Label and Production Review Comment - and, only where
 *     an operator set them, Build and Test Commands. The maintainer, of the
 *     page that kept GitHub Commands and Runner above the fold: "GitHub
 *     commands and runner should be inside of more settings as well."
 *     Production Review, a switch whose default works for most
 *     repositories, went with them.
 *   - Folded, More settings names what it holds, four names and how many
 *     more, and says what is set to something else: "GitHub Commands:
 *     Off", "Production Review: Off", "Runner: prod-eu-west-1", a limit, a
 *     label of its own, commands.
 *   - A link that names a setting after the page's "#" lands on it with More
 *     settings open: "Pick a Runner" opens ".../settings#runner". The
 *     setting landed on is the one marked among the others, and holds the
 *     keyboard's focus, so Tab goes on to its own controls.
 *   - Cards, not a stepped dialog: the Edit Settings dialog walked four
 *     steps - Pull Requests, GitHub Commands, Runner, Build & Test - and
 *     Build & Test is gone: the code agent reads how to build and test from
 *     the repository's AGENTS.md.
 *   - "Respond to GitHub Commands" is one switch that saves the moment it is
 *     flipped, and is on for a repository that never set it - as the server
 *     reads it. The dialog drew that repository's switch off, and saving
 *     the dialog untouched wrote false.
 *   - Build and test commands an operator set before are shown read-only
 *     under More settings, with Remove Commands, which asks first; a
 *     repository with none shows nothing of them.
 *   - "Review Pull Requests Against Production" is one switch that saves the
 *     moment it is flipped, and is OFF for a repository that never set it -
 *     every repository connected before it existed - as the server reads
 *     it. What a review posts on a pull request is one choice under More
 *     settings, on the default (the review, or a link on a public
 *     repository) for a repository that never chose.
 *
 * CardModelDetail is a stand-in that records its props and draws an empty
 * box with the card's id, so where each card sits can be read (each card's
 * own suite draws it); the switch cards, More settings and the commands
 * card are the real ones, over a stand-in ModelAPI and Runner choices.
 */

const mockDetails: Array<Record<string, unknown>> = [];

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): ReactElement => {
      mockDetails.push(props);

      return React.createElement("div", {
        "data-testid": "card-model-detail-stand-in",
        "data-name": props["name"],
        id: (props["cardProps"] as { id?: string } | undefined)?.id,
      });
    },
  };
});

const getItemMock: MockFunction = getJestMockFunction();
const updateByIdMock: MockFunction = getJestMockFunction();

jest.mock("../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getItem: (...args: Array<unknown>): unknown => {
        return getItemMock(...args);
      },
      updateById: (...args: Array<unknown>): unknown => {
        return updateByIdMock(...args);
      },
      getList: async (): Promise<unknown> => {
        return { data: [], count: 0, skip: 0, limit: 10 };
      },
    },
  };
});

import CodeRepositorySettings, {
  CODE_REPOSITORY_GITHUB_COMMANDS_TEST_ID,
  CODE_REPOSITORY_MORE_SETTINGS_TEST_ID,
  CODE_REPOSITORY_PRODUCTION_REVIEW_TEST_ID,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Code/Repository/Settings";
import {
  PRODUCTION_REVIEW_CONTENT_ANSWERS,
  PRODUCTION_REVIEW_CONTENT_COPY,
  PRODUCTION_REVIEW_CONTENT_FIELD_KEY,
  PRODUCTION_REVIEW_SETTINGS_COPY,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeProductionReviewCopy";
import { ProductionReviewPullRequestContent } from "../../../Types/CodeRepository/ProductionReview";
import {
  CodeRepositoryRunnerCopy,
  CodeRepositoryRunnerPicker,
  CodeRepositoryRunnerValueView,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeRepositoryRunner";
import { CODE_REPOSITORY_COMMANDS_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeRepositoryCommandsCard";
import CodeApi, {
  CodeRepositoryResponse,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeApi";
import RepositoryConnectionStatus from "../../../../App/FeatureSet/Dashboard/src/Components/CodeRepository/RepositoryConnectionStatus";
import {
  CODE_REPOSITORY_SETTINGS_COPY,
  CODE_REPOSITORY_SETTINGS_IN_ORDER,
  CodeRepositorySetting,
  DEFAULT_GITHUB_TRIGGER_LABEL,
  getGitHubTriggerLabel,
  getPullRequestsCardCopy,
  getRepositoryMoreSettingsDescription,
  getRepositoryMoreSettingsItems,
  hasRepositoryCommands,
  isMergeRequestHost,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeRepositorySettingsCopy";
import {
  FIX_PULL_REQUEST_LIMIT_FIELD_KEY,
  FixPullRequestLimitCopy,
  getFixPullRequestLimitCopy,
} from "../../../../App/FeatureSet/Dashboard/src/Components/CodeRepository/FixPullRequestLimit";
import CodeRepositoryType from "../../../Types/CodeRepository/CodeRepositoryType";
import { CodeHost } from "../../../Types/CodeRepository/CodeHost";
import RunnerChoicesLoader, {
  RunnerChoices,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Runner/RunnerChoices";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import ObjectID from "../../../Types/ObjectID";
import RunnerLiveStatus from "../../../Types/Runner/RunnerLiveStatus";
import { FoldedSectionItem } from "../../../UI/Components/FoldedSection/FoldedSectionItem";
import { ModelField } from "../../../UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "../../../UI/Components/Forms/Types/FormFieldSchemaType";
import Navigation from "../../../UI/Utils/Navigation";
import PermissionGate, {
  PermissionGateResult,
} from "../../../UI/Utils/PermissionGate";
import ProjectUtil from "../../../UI/Utils/Project";
import {
  createTranslator,
  Translator,
} from "../../../UI/Utils/TranslateTemplate";

const PROJECT_ID: string = "dddddddd-0000-4000-8000-0000000000c7";
const REPOSITORY_ID: string = "eeeeeeee-0000-4000-8000-0000000000c7";

// The project's own Runners a repository may pick.
const PROD_RUNNER_ID: string = "aaaaaaaa-0000-4000-8000-0000000000c7";
const OFFICE_RUNNER_ID: string = "aaaaaaaa-0000-4000-8000-0000000000c8";
// One the reader is not shown.
const HIDDEN_RUNNER_ID: string = "aaaaaaaa-0000-4000-8000-0000000000c9";

const COMMAND_COLUMNS: Array<string> = [
  "setupCommand",
  "buildCommand",
  "testCommand",
];

// Every card under More settings, by its place on the page, in its order.
const FOLDED_CARDS: Array<string> = [
  "github-commands",
  "production-review",
  "runner",
  "pull-requests",
  "trigger-label",
  "production-review-comment",
];

type FormField = ModelField<CodeRepository>;

interface DetailField {
  field?: Record<string, unknown>;
  title?: string;
  description?: string;
  placeholder?: string;
  getElement?: ((item: CodeRepository) => ReactElement) | undefined;
}

// What the repository holds, as the stand-in ModelAPI reads it.
let stored: Record<string, unknown> = {};

/*
 * Whether the project's GitHub App reaches the repository, as Code's
 * repository read answers it - or a read that fails.
 */
let reachable: boolean | Error = true;
let getRepositoryCalls: Array<string> = [];

// The Runners a repository may pick, as the page reads them.
let runnerChoices: RunnerChoices = choicesWith();
let runnerChoiceReads: number = 0;

const english: Translator = createTranslator(undefined, "en");

// What scrollIntoView was asked of, in order (jsdom has none of its own).
const scrolled: Array<Element> = [];
const originalScrollIntoView: unknown = (
  Element.prototype as unknown as Record<string, unknown>
)["scrollIntoView"];

function choicesWith(overrides: Partial<RunnerChoices> = {}): RunnerChoices {
  return {
    projectRunners: [
      {
        id: PROD_RUNNER_ID,
        name: "prod-eu-west-1",
        liveStatus: RunnerLiveStatus.Connected,
      },
      {
        id: OFFICE_RUNNER_ID,
        name: "office-runner",
        liveStatus: RunnerLiveStatus.Disconnected,
      },
    ],
    globalRunners: [
      {
        id: "",
        name: "Global Runner",
        description: "",
        liveStatus: RunnerLiveStatus.Connected,
        runsRunbooks: false,
      },
    ],
    projectUsesGlobalRunners: true,
    ...overrides,
  };
}

beforeEach(() => {
  mockDetails.length = 0;
  stored = {};
  scrolled.length = 0;

  getItemMock.mockReset();
  getItemMock.mockImplementation(async (): Promise<unknown> => {
    const item: CodeRepository = new CodeRepository();
    item._id = REPOSITORY_ID;
    Object.assign(item, stored);
    return item;
  });

  updateByIdMock.mockReset();
  updateByIdMock.mockImplementation(async (): Promise<unknown> => {
    return {};
  });

  reachable = true;
  getRepositoryCalls = [];
  getJestSpyOn(CodeApi, "getRepository").mockImplementation(
    async (repositoryId: string): Promise<CodeRepositoryResponse> => {
      getRepositoryCalls.push(repositoryId);

      if (reachable instanceof Error) {
        throw reachable;
      }

      return {
        repository: {
          id: repositoryId,
          name: "checkout-api",
          isConnected: reachable,
        },
        stats: {
          working: 0,
          waitingForYou: 0,
          openPullRequests: 0,
          taskCount: 0,
        },
        canAsk: true,
        blocker: null,
      };
    },
  );

  runnerChoices = choicesWith();
  runnerChoiceReads = 0;
  getJestSpyOn(RunnerChoicesLoader, "loadForCodeRepository").mockImplementation(
    async (): Promise<RunnerChoices> => {
      runnerChoiceReads++;
      return runnerChoices;
    },
  );

  getJestSpyOn(PermissionGate, "checkColumnUpdate").mockImplementation(
    (): PermissionGateResult => {
      return { isAllowed: true };
    },
  );
  jest
    .spyOn(Navigation, "getLastParamAsObjectID")
    .mockReturnValue(new ObjectID(REPOSITORY_ID));
  jest
    .spyOn(ProjectUtil, "getCurrentProjectId")
    .mockReturnValue(new ObjectID(PROJECT_ID));

  (Element.prototype as unknown as Record<string, unknown>)["scrollIntoView"] =
    function (this: Element): void {
      scrolled.push(this);
    };
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
  // The page is opened at no setting again.
  window.history.replaceState(null, "", window.location.pathname);

  if (originalScrollIntoView === undefined) {
    delete (Element.prototype as unknown as Record<string, unknown>)[
      "scrollIntoView"
    ];
  } else {
    (Element.prototype as unknown as Record<string, unknown>)[
      "scrollIntoView"
    ] = originalScrollIntoView;
  }
});

function draw(): void {
  render(<CodeRepositorySettings {...({} as unknown as PageComponentProps)} />);
}

// The page, opened at a setting: ".../settings#<setting>".
function drawAt(setting: string): void {
  window.history.replaceState(null, "", `#${setting}`);
  draw();
}

// The card the page drew with this name, as it was last drawn.
function card(name: string): Record<string, unknown> {
  const drawn: Array<Record<string, unknown>> = mockDetails.filter(
    (props: Record<string, unknown>): boolean => {
      return props["name"] === name;
    },
  );

  expect(drawn.length).toBeGreaterThan(0);

  return drawn[drawn.length - 1]!;
}

function columnsOf(field: FormField | DetailField): Array<string> {
  return Object.keys(
    ((field as { field?: Record<string, unknown> }).field ||
      (field as { overrideField?: Record<string, unknown> }).overrideField ||
      {}) as Record<string, unknown>,
  );
}

function folded(): HTMLElement {
  return screen.getByTestId(CODE_REPOSITORY_MORE_SETTINGS_TEST_ID);
}

function foldHeader(): HTMLElement {
  return within(folded()).getByRole("button", { name: "More settings" });
}

// Opens More settings from its header, as a person does.
function openMoreSettings(): void {
  fireEvent.click(foldHeader());
  expect(foldHeader()).toHaveAttribute("aria-expanded", "true");
}

// What the folded header names, in order: every name, set or not.
function foldedNames(): Array<string> {
  return within(folded())
    .queryAllByTestId("folded-section-item")
    .map((chip: HTMLElement): string => {
      return chip.textContent || "";
    });
}

// The set ones: a name and what it is set to.
function setChips(): Array<string> {
  return within(folded())
    .queryAllByTestId("folded-section-item")
    .filter((chip: HTMLElement): boolean => {
      return chip.getAttribute("data-item-set") === "true";
    })
    .map((chip: HTMLElement): string => {
      return chip.textContent || "";
    });
}

// Tells the page what a detail card read, as CardModelDetail does.
async function cardReads(
  name: string,
  data: Record<string, unknown>,
): Promise<void> {
  const item: CodeRepository = new CodeRepository();
  item._id = REPOSITORY_ID;
  Object.assign(item, data);

  await act(async () => {
    (
      card(name)["modelDetailProps"] as {
        onItemLoaded: (item: CodeRepository) => void;
      }
    ).onItemLoaded(item);
  });
}

// Tells the page what the Pull Requests card read, as CardModelDetail does.
async function pullRequestsCardReads(
  data: Record<string, unknown>,
): Promise<void> {
  await cardReads("Repository > Pull Requests", data);
}

// Tells the page what the Runner card read, as CardModelDetail does.
async function runnerCardReads(runnerId: string | undefined): Promise<void> {
  await cardReads(
    "Repository > Runner",
    runnerId ? { runnerId: new ObjectID(runnerId) } : {},
  );
}

/*
 * The page has the Runner choices it read: the Runner card's value is drawn
 * from them (and More settings' folded Runner is worked out from them).
 */
async function runnerChoicesRead(): Promise<void> {
  await waitFor(() => {
    const element: ReactElement = (
      card("Repository > Runner")["modelDetailProps"] as {
        fields: Array<DetailField>;
      }
    ).fields[0]!.getElement!(new CodeRepository());

    expect(element.props.choices).toBe(runnerChoices);
  });
}

// Both switch cards have read the repository.
async function switchesRead(): Promise<void> {
  await screen.findByRole("switch", { name: "Respond to GitHub Commands" });
  await screen.findByRole("switch", {
    name: "Review Pull Requests Against Production",
  });
}

describe("a repository's settings are cards, not a stepped dialog", () => {
  test("Repository Details, Runner, then Pull Requests, GitHub Trigger Label and Production Review Comment - and no card walks steps", () => {
    draw();

    const names: Array<unknown> = mockDetails.map(
      (props: Record<string, unknown>): unknown => {
        return props["name"];
      },
    );

    expect(Array.from(new Set(names))).toEqual([
      "Repository > Repository Details",
      "Repository > Runner",
      "Repository > Pull Requests",
      "Repository > GitHub Trigger Label",
      "Repository > Production Review Comment",
    ]);

    for (const props of mockDetails) {
      expect(props["formSteps"]).toBeUndefined();

      for (const field of (props["formFields"] || []) as Array<FormField>) {
        expect(field.stepId).toBeUndefined();
      }
    }

    expect(folded()).toBeInTheDocument();
  });

  test("Build & Test is gone: no form asks for a setup, build or test command", () => {
    draw();

    for (const props of mockDetails) {
      for (const field of (props["formFields"] || []) as Array<FormField>) {
        for (const column of columnsOf(field)) {
          expect(COMMAND_COLUMNS).not.toContain(column);
        }
      }
    }
  });

  test("each card's Edit opens a dialog named for what it edits", () => {
    draw();

    expect(
      [
        "Repository > Repository Details",
        "Repository > Runner",
        "Repository > Pull Requests",
        "Repository > GitHub Trigger Label",
        "Repository > Production Review Comment",
      ].map((name: string): Array<unknown> => {
        const props: Record<string, unknown> = card(name);

        return [
          (props["cardProps"] as { title: string }).title,
          props["editButtonText"],
          props["editModalTitle"],
        ];
      }),
    ).toEqual([
      ["Repository Details", "Edit Details", "Repository Details"],
      ["Runner", "Edit", "Runner"],
      ["Pull Requests", "Edit", "Pull Requests"],
      ["GitHub Trigger Label", "Edit", "GitHub Trigger Label"],
      ["Production Review Comment", "Edit", "Production Review Comment"],
    ]);
  });
});

/*
 * "GitHub commands and runner should be inside of more settings as well."
 * (the maintainer, of the page that kept GitHub Commands and Runner above
 * More settings).
 */
describe("on top, the repository itself; every other setting under More settings", () => {
  test("Repository Details is the only card above More settings", () => {
    draw();

    const details: HTMLElement = screen
      .getAllByTestId("card-model-detail-stand-in")
      .find((box: HTMLElement): boolean => {
        return (
          box.getAttribute("data-name") === "Repository > Repository Details"
        );
      })!;

    expect(folded()).not.toContainElement(details);
    // It comes first, then the fold - and nothing else is drawn outside it.
    expect(
      details.compareDocumentPosition(folded()) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    for (const box of screen.getAllByTestId("card-model-detail-stand-in")) {
      if (box === details) {
        continue;
      }

      expect(folded()).toContainElement(box);
    }
  });

  test("both switches and the Runner are inside it, first, in the order the page had them - then what was folded before", async () => {
    draw();
    await switchesRead();

    const places: Array<string> = FOLDED_CARDS.map((place: string): string => {
      const element: HTMLElement | null = document.getElementById(place);

      expect(element).not.toBeNull();
      expect(folded()).toContainElement(element);

      return place;
    });

    // Each one after the one before it.
    for (let index: number = 1; index < places.length; index++) {
      const before: HTMLElement = document.getElementById(places[index - 1]!)!;
      const after: HTMLElement = document.getElementById(places[index]!)!;

      expect(
        before.compareDocumentPosition(after) &
          Node.DOCUMENT_POSITION_FOLLOWING,
      ).toBeTruthy();
    }

    // The switches themselves are in their cards, in the fold.
    expect(document.getElementById("github-commands")).toContainElement(
      screen.getByRole("switch", { name: "Respond to GitHub Commands" }),
    );
    expect(document.getElementById("production-review")).toContainElement(
      screen.getByRole("switch", {
        name: "Review Pull Requests Against Production",
      }),
    );
  });

  test("it starts folded, everything in it out of sight and reach until its header opens it", async () => {
    draw();
    await switchesRead();

    expect(foldHeader()).toHaveAttribute("aria-expanded", "false");
    const body: HTMLElement = document.getElementById(
      foldHeader().getAttribute("aria-controls")!,
    )!;
    expect(body).toHaveClass("invisible");
    expect(body).toContainElement(
      screen.getByRole("switch", { name: "Respond to GitHub Commands" }),
    );

    openMoreSettings();
    expect(body).not.toHaveClass("invisible");
    // Open, it says what it holds, in the order it holds it.
    expect(folded()).toHaveTextContent(
      "GitHub commands, production reviews, where AI works, and where its pull requests open.",
    );
  });

  test("folded, it names the first four - the switches and the Runner first - and counts the rest", async () => {
    stored = { isProductionReviewEnabled: true };
    draw();
    await switchesRead();
    await runnerCardReads(undefined);

    expect(foldedNames()).toEqual([
      "GitHub Commands",
      "Production Review",
      "Runner",
      "Pull Requests",
    ]);
    expect(
      within(folded()).getByTestId("folded-section-more"),
    ).toHaveTextContent("2 more");
    // Nothing is set to anything but its default.
    expect(setChips()).toEqual([]);
  });

  test("the cards' places are the keys More settings lists them by, in the same order", async () => {
    draw();
    await switchesRead();
    await pullRequestsCardReads({ setupCommand: "npm ci" });

    const keys: Array<string> = getRepositoryMoreSettingsItems(
      { setupCommand: "npm ci" },
      english,
    ).map((item: FoldedSectionItem): string => {
      return item.key;
    });

    expect(keys).toEqual([...FOLDED_CARDS, "commands"]);
    expect(keys).toEqual([...CODE_REPOSITORY_SETTINGS_IN_ORDER]);
    /*
     * Every place but Branches, a Git repository's Pull Requests: a GitHub
     * repository - this one - never has it.
     */
    expect(Object.values(CodeRepositorySetting)).toEqual([
      ...keys,
      CodeRepositorySetting.Branches,
    ]);

    // Every one is a card with that id, in the fold: a link can land on it.
    for (const key of keys) {
      expect(folded()).toContainElement(document.getElementById(key));
    }
  });
});

describe("a link to a setting opens More settings there", () => {
  test("opened at #runner: More settings is open from the first paint, and the Runner card is brought into view", async () => {
    drawAt(CodeRepositorySetting.Runner);

    // Never drawn folded first.
    expect(foldHeader()).toHaveAttribute("aria-expanded", "true");

    await waitFor(() => {
      expect(scrolled).toContain(document.getElementById("runner"));
    });
    expect(
      scrolled.every((element: Element): boolean => {
        return element === document.getElementById("runner");
      }),
    ).toBe(true);
  });

  test("opened at #production-review, the switch Production Reviews' Settings link names: its card is brought into view", async () => {
    drawAt(CodeRepositorySetting.ProductionReview);
    await switchesRead();

    expect(foldHeader()).toHaveAttribute("aria-expanded", "true");
    await waitFor(() => {
      expect(scrolled).toContain(document.getElementById("production-review"));
    });
    expect(document.getElementById("production-review")).toContainElement(
      screen.getByRole("switch", {
        name: "Review Pull Requests Against Production",
      }),
    );
  });

  test("the setting a link lands on is the one marked among them, and holds the focus: Tab goes on to its switch", async () => {
    stored = { isGitHubCommandsEnabled: true };
    drawAt(CodeRepositorySetting.GitHubCommands);

    const toggle: HTMLElement = await screen.findByRole("switch", {
      name: "Respond to GitHub Commands",
    });
    const commands: HTMLElement = document.getElementById(
      CodeRepositorySetting.GitHubCommands,
    )!;

    expect(commands).toHaveAttribute(PAGE_ANCHOR_LANDED_ATTRIBUTE, "true");
    expect(
      Array.from(
        document.querySelectorAll(`[${PAGE_ANCHOR_LANDED_ATTRIBUTE}]`),
      ).map((element: Element): string => {
        return element.id;
      }),
    ).toEqual([CodeRepositorySetting.GitHubCommands]);
    expect(document.activeElement).toBe(commands);

    const user: UserEvent = userEvent.setup({ delay: null });
    await user.tab();
    expect(document.activeElement).toBe(toggle);
  });

  test("opened at #runner, as Pick a Runner opens it: the Runner card is the one marked, and holds the focus", async () => {
    drawAt(CodeRepositorySetting.Runner);

    const runner: HTMLElement = document.getElementById(
      CodeRepositorySetting.Runner,
    )!;

    expect(runner).toHaveAttribute(PAGE_ANCHOR_LANDED_ATTRIBUTE, "true");
    expect(document.activeElement).toBe(runner);
    expect(
      document.getElementById(CodeRepositorySetting.GitHubCommands),
    ).not.toHaveAttribute(PAGE_ANCHOR_LANDED_ATTRIBUTE);
  });

  test("opened at #github-commands: the switch is in sight and flips as it does anywhere", async () => {
    stored = { isGitHubCommandsEnabled: true };
    drawAt(CodeRepositorySetting.GitHubCommands);

    expect(foldHeader()).toHaveAttribute("aria-expanded", "true");

    fireEvent.click(
      await screen.findByRole("switch", { name: "Respond to GitHub Commands" }),
    );

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });
    expect(updateByIdMock.mock.calls[0]![0]).toMatchObject({
      data: { isGitHubCommandsEnabled: false },
    });
  });

  test("opened at the commands card, which comes once the repository is read: it opens then", async () => {
    drawAt(CodeRepositorySetting.Commands);

    // No commands read yet: nothing in the fold is called that.
    expect(foldHeader()).toHaveAttribute("aria-expanded", "false");

    await pullRequestsCardReads({ buildCommand: "make" });

    await waitFor(() => {
      expect(foldHeader()).toHaveAttribute("aria-expanded", "true");
    });
    await waitFor(() => {
      expect(scrolled).toContain(document.getElementById("commands"));
    });
  });

  test("an address that names nothing in it leaves it folded, and scrolls nothing", async () => {
    drawAt("reply");
    await switchesRead();

    expect(foldHeader()).toHaveAttribute("aria-expanded", "false");
    // A frame for anything that would have been brought into view.
    await act(async () => {
      await new Promise((resolve: (value: unknown) => void) => {
        setTimeout(resolve, 50);
      });
    });
    expect(scrolled).toEqual([]);
  });

  test("folded again by hand, it stays folded as the page draws again", async () => {
    drawAt(CodeRepositorySetting.Runner);
    await switchesRead();

    fireEvent.click(foldHeader());
    expect(foldHeader()).toHaveAttribute("aria-expanded", "false");

    // The page draws again as what its cards read arrives.
    await pullRequestsCardReads({ maxOpenFixPullRequests: 2 });
    await runnerCardReads(PROD_RUNNER_ID);

    expect(foldHeader()).toHaveAttribute("aria-expanded", "false");
  });
});

describe("Repository Details' Connection: what Code's Repositories says of it", () => {
  /*
   * The Connection field's element as the details card last drew it, for
   * this record. Checked by its props while waiting - drawing it inside a
   * waitFor would change the DOM waitFor watches, and wait forever.
   */
  function connectionOf(record: Record<string, unknown>): ReactElement {
    const fields: Array<DetailField> = (
      card("Repository > Repository Details")["modelDetailProps"] as {
        fields: Array<DetailField>;
      }
    ).fields;
    const connection: DetailField = fields.find(
      (field: DetailField): boolean => {
        return field.title === "Connection";
      },
    )!;
    const item: CodeRepository = new CodeRepository();
    Object.assign(item, record);

    const element: ReactElement = connection.getElement!(item);
    expect(element.type).toBe(RepositoryConnectionStatus);

    return element;
  }

  // What that element draws.
  function drawnText(element: ReactElement): string {
    const drawn: HTMLElement = render(element).container;

    return drawn.textContent || "";
  }

  test("it reads, once, whether the project's GitHub App reaches the repository", async () => {
    draw();

    await waitFor(() => {
      expect(getRepositoryCalls).toEqual([REPOSITORY_ID]);
    });
  });

  test("one GitHub reaches: GitHub App, as before", async () => {
    draw();

    await waitFor(() => {
      expect(
        connectionOf({ gitHubAppInstallationId: "12345" }).props.isReachable,
      ).toBe(true);
    });

    const text: string = drawnText(
      connectionOf({ gitHubAppInstallationId: "12345" }),
    );
    expect(text).toContain("GitHub App");
    expect(text).not.toContain("Not connected");
  });

  test("one GitHub no longer reaches: Not connected - where Repositories folds it - not GitHub App", async () => {
    reachable = false;
    draw();

    await waitFor(() => {
      expect(
        connectionOf({ gitHubAppInstallationId: "12345" }).props.isReachable,
      ).toBe(false);
    });

    const text: string = drawnText(
      connectionOf({ gitHubAppInstallationId: "12345" }),
    );
    expect(text).toContain("Not connected");
    expect(text).not.toContain("GitHub App");
    // One never connected through the app is no repository AI works in either.
    expect(drawnText(connectionOf({}))).toContain("Not connected");
  });

  test("a read that fails leaves the field as it always was", async () => {
    reachable = new Error("The repository cannot be read right now.");
    draw();

    await waitFor(() => {
      expect(getRepositoryCalls).toHaveLength(1);
    });
    // Let the failed read settle: nothing changes for it.
    await act(async () => {
      await Promise.resolve();
    });

    expect(
      connectionOf({ gitHubAppInstallationId: "12345" }).props.isReachable,
    ).toBeNull();
    expect(
      drawnText(connectionOf({ gitHubAppInstallationId: "12345" })),
    ).toContain("GitHub App");
    expect(drawnText(connectionOf({}))).toContain("Access Token");
  });

  test("the field itself: unknown says how it connects; false says Not connected, whatever the connection", () => {
    const cases: Array<{
      installation: string | undefined;
      isReachable: boolean | null | undefined;
      shows: string;
      kind: string;
    }> = [
      {
        installation: "1",
        isReachable: undefined,
        shows: "GitHub App",
        kind: "github-app",
      },
      {
        installation: "1",
        isReachable: null,
        shows: "GitHub App",
        kind: "github-app",
      },
      {
        installation: "1",
        isReachable: true,
        shows: "GitHub App",
        kind: "github-app",
      },
      {
        installation: "1",
        isReachable: false,
        shows: "Not connected",
        kind: "not-connected",
      },
      {
        installation: undefined,
        isReachable: undefined,
        shows: "Access Token",
        kind: "access-token",
      },
      {
        installation: undefined,
        isReachable: false,
        shows: "Not connected",
        kind: "not-connected",
      },
    ];

    for (const each of cases) {
      cleanup();
      render(
        <RepositoryConnectionStatus
          gitHubAppInstallationId={each.installation}
          isReachable={each.isReachable}
        />,
      );

      const status: HTMLElement = screen.getByTestId(
        "repository-connection-status",
      );
      expect(status).toHaveTextContent(each.shows);
      expect(status).toHaveAttribute("data-connection", each.kind);
    }
  });
});

describe("Respond to GitHub Commands: one switch, on by default, under More settings", () => {
  // The switch itself carries the card's test id (ModelSwitchRow).
  async function commandsSwitch(): Promise<HTMLElement> {
    const toggle: HTMLElement = await screen.findByRole("switch", {
      name: "Respond to GitHub Commands",
    });

    expect(toggle).toHaveAttribute(
      "data-testid",
      CODE_REPOSITORY_GITHUB_COMMANDS_TEST_ID,
    );

    return toggle;
  }

  test("a repository that never set it reads as on, as the server reads it", async () => {
    stored = {};
    draw();

    expect(await commandsSwitch()).toHaveAttribute("aria-checked", "true");
    // Read through the switch card, by its one column.
    expect(
      (getItemMock.mock.calls[0]![0] as { select: Record<string, unknown> })
        .select,
    ).toMatchObject({ isGitHubCommandsEnabled: true });
  });

  test("a stored null reads as on too, and a stored false as off", async () => {
    stored = { isGitHubCommandsEnabled: null };
    draw();
    expect(await commandsSwitch()).toHaveAttribute("aria-checked", "true");

    cleanup();
    stored = { isGitHubCommandsEnabled: false };
    draw();
    expect(await commandsSwitch()).toHaveAttribute("aria-checked", "false");
  });

  test("opened from More settings, flipping it saves at once - off, then on again - with nothing else", async () => {
    stored = { isGitHubCommandsEnabled: true };
    draw();

    await commandsSwitch();
    openMoreSettings();
    fireEvent.click(await commandsSwitch());

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });
    expect(updateByIdMock.mock.calls[0]![0]).toMatchObject({
      modelType: CodeRepository,
      data: { isGitHubCommandsEnabled: false },
    });
    expect(
      Object.keys(
        (updateByIdMock.mock.calls[0]![0] as { data: Record<string, unknown> })
          .data,
      ),
    ).toEqual(["isGitHubCommandsEnabled"]);

    // Saved, and off: the next flip is a save of its own.
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(await commandsSwitch()).toHaveAttribute("aria-checked", "false");

    fireEvent.click(await commandsSwitch());

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(2);
    });
    expect(updateByIdMock.mock.calls[1]![0]).toMatchObject({
      data: { isGitHubCommandsEnabled: true },
    });
    // More settings stays open through both saves.
    expect(foldHeader()).toHaveAttribute("aria-expanded", "true");
  });

  test("it says what commands do, in the words the dialog used, under its card's title", async () => {
    draw();

    await commandsSwitch();

    const commandsCard: HTMLElement = document.getElementById(
      CodeRepositorySetting.GitHubCommands,
    )!;

    expect(
      within(commandsCard).getByText(
        CODE_REPOSITORY_SETTINGS_COPY.gitHubCommandsSwitchDescription,
      ),
    ).toBeInTheDocument();
    expect(
      within(commandsCard).getByTestId("card-details-heading"),
    ).toHaveTextContent("GitHub Commands");
    expect(CODE_REPOSITORY_SETTINGS_COPY.gitHubCommandsSwitchDescription).toBe(
      "Let people with write access mention the OneUptime GitHub App, or add the trigger label, to give it work. It never merges anything.",
    );
  });

  test("off, folded More settings says so - and on again, it no longer does", async () => {
    stored = {
      isGitHubCommandsEnabled: false,
      isProductionReviewEnabled: true,
    };
    draw();
    await switchesRead();

    await waitFor(() => {
      expect(setChips()).toEqual(["GitHub Commands: Off"]);
    });

    openMoreSettings();
    fireEvent.click(await commandsSwitch());
    fireEvent.click(foldHeader());

    await waitFor(() => {
      expect(setChips()).toEqual([]);
    });
    expect(foldedNames()[0]).toBe("GitHub Commands");
  });
});

describe("the Runner card, under More settings", () => {
  test("its Edit asks one thing - the Runner picker - on one page", () => {
    draw();

    const props: Record<string, unknown> = card("Repository > Runner");
    const fields: Array<FormField> = props["formFields"] as Array<FormField>;
    // What the form draws: the picker alone; its two columns are not drawn.
    const drawn: Array<FormField> = fields.filter((field: FormField) => {
      return !field.showIf || field.showIf({});
    });

    expect(drawn).toHaveLength(1);
    expect(columnsOf(drawn[0]!)).toEqual(["runnerId"]);
    expect(drawn[0]!.formOnly).toBe(true);
    expect(drawn[0]!.title).toBe(CodeRepositoryRunnerCopy.fieldTitle);
    expect(drawn[0]!.fieldType).toBe(FormFieldSchemaType.CustomComponent);
    expect(drawn[0]!.hideOptionalLabel).toBe(true);
    expect(props["isEditable"]).toBe(true);

    // The columns the one choice writes, read and sent but never drawn.
    expect(
      fields
        .filter((field: FormField) => {
          return field !== drawn[0];
        })
        .map(columnsOf),
    ).toEqual([["runnerId"], ["isGlobalRunnerPicked"]]);

    const element: ReactElement = drawn[0]!.getCustomElement!(
      {},
      { onChange: (): void => {} },
    ) as ReactElement;

    expect(element.type).toBe(CodeRepositoryRunnerPicker);
  });

  test("its place on the page is 'runner', inside More settings", () => {
    draw();

    expect(
      (card("Repository > Runner")["cardProps"] as { id: string }).id,
    ).toBe(CodeRepositorySetting.Runner);
    expect(folded()).toContainElement(document.getElementById("runner"));
  });

  test("the card says what the repository runs on, from the choices the page read once, with no second 'Runner' over its value", async () => {
    draw();

    await runnerChoicesRead();

    const fields: Array<DetailField> = (
      card("Repository > Runner")["modelDetailProps"] as {
        fields: Array<DetailField>;
      }
    ).fields;

    expect(fields).toHaveLength(1);
    expect(fields[0]!.title).toBeUndefined();

    const item: CodeRepository = new CodeRepository();
    item.runnerId = new ObjectID(PROD_RUNNER_ID);

    const element: ReactElement = fields[0]!.getElement!(item);

    expect(element.type).toBe(CodeRepositoryRunnerValueView);
    expect(String(element.props.runnerId)).toBe(PROD_RUNNER_ID);
    expect(element.props.choices).toBe(runnerChoices);
    // Nothing about commands: the value says what the Runner does.
    expect(element.props.hasCommands).toBeUndefined();
    // The page read the choices once: the card does not read them again.
    expect(runnerChoiceReads).toBe(1);
  });

  test("what the Runner card reads, folded More settings says: the Runner, by name", async () => {
    draw();
    await runnerChoicesRead();

    await runnerCardReads(PROD_RUNNER_ID);

    await waitFor(() => {
      expect(setChips()).toContain("Runner: prod-eu-west-1");
    });
  });
});

describe("what folded More settings says of the Runner", () => {
  async function runnerChip(runnerId: string | undefined): Promise<string> {
    draw();
    await runnerChoicesRead();
    await runnerCardReads(runnerId);

    const chip: HTMLElement | undefined = within(folded())
      .queryAllByTestId("folded-section-item")
      .find((each: HTMLElement): boolean => {
        return each.getAttribute("data-item-key") === "runner";
      });

    expect(chip).toBeDefined();

    return chip!.getAttribute("data-item-set") === "true"
      ? chip!.textContent || ""
      : `(unset) ${chip!.textContent || ""}`;
  }

  test("on a global Runner - the default - its name alone", async () => {
    expect(await runnerChip(undefined)).toBe("(unset) Runner");
  });

  test("one of the project's own, connected: its name", async () => {
    expect(await runnerChip(PROD_RUNNER_ID)).toBe("Runner: prod-eu-west-1");
  });

  test("one that is not connected: its name, and how it is doing", async () => {
    expect(await runnerChip(OFFICE_RUNNER_ID)).toBe(
      "Runner: office-runner · Disconnected",
    );
  });

  test("one the reader is not shown: says so, never its id", async () => {
    const chip: string = await runnerChip(HIDDEN_RUNNER_ID);

    expect(chip).toBe("Runner: A Runner you do not have access to");
    expect(chip).not.toContain("aaaaaaaa-");
  });

  test("none, in a project that turned global Runners off: None", async () => {
    runnerChoices = choicesWith({ projectUsesGlobalRunners: false });

    expect(await runnerChip(undefined)).toBe("Runner: None");
  });

  test("none, on a server that runs no global Runner: None", async () => {
    runnerChoices = choicesWith({ globalRunners: [] });

    expect(await runnerChip(undefined)).toBe("Runner: None");
  });
});

describe("More settings", () => {
  test("starts folded, naming its cards, and nothing of commands a repository does not have", () => {
    draw();

    expect(foldHeader()).toHaveAttribute("aria-expanded", "false");
    expect(folded()).toHaveTextContent("GitHub Commands");
    expect(folded()).toHaveTextContent("Production Review");
    expect(folded()).toHaveTextContent("Runner");
    expect(folded()).toHaveTextContent("Pull Requests");
    // No commands, nothing about them.
    expect(foldedNames()).not.toContain("Build and Test Commands");
    expect(
      getRepositoryMoreSettingsItems({}, english).map(
        (item: FoldedSectionItem): string => {
          return item.title;
        },
      ),
    ).toEqual([
      "GitHub Commands",
      "Production Review",
      "Runner",
      "Pull Requests",
      "GitHub Trigger Label",
      "Production Review Comment",
    ]);
  });

  test("what is set shows on its folded header: the switches off, a limit, a label of its own, commands", async () => {
    stored = { isGitHubCommandsEnabled: false };
    draw();
    await switchesRead();

    await pullRequestsCardReads({
      maxOpenFixPullRequests: 3,
      gitHubTriggerLabel: "ai-fix",
      setupCommand: "npm ci",
    });

    await waitFor(() => {
      expect(setChips()).toEqual([
        "GitHub Commands: Off",
        "Production Review: Off",
        "Pull Requests: Up to 3 open at once",
        "GitHub Trigger Label: ai-fix",
        "Build and Test Commands: Configured",
      ]);
    });
  });

  test("the trigger label card asks for it on its own, and shows 'oneuptime' while it is empty", () => {
    draw();

    const props: Record<string, unknown> = card(
      "Repository > GitHub Trigger Label",
    );
    const fields: Array<FormField> = props["formFields"] as Array<FormField>;

    expect(fields.map(columnsOf)).toEqual([["gitHubTriggerLabel"]]);
    expect(fields[0]!.placeholder).toBe(DEFAULT_GITHUB_TRIGGER_LABEL);
    // Asked whatever the switch says: it no longer hides behind it.
    expect(fields[0]!.showIf).toBeUndefined();
    // The form says what empty means; the card only what the label does.
    expect(fields[0]!.description).toBe(
      "Adding this label to an issue hands it to the app, like a mention. Leave empty for 'oneuptime'.",
    );
    expect((props["cardProps"] as { description: string }).description).toBe(
      "Adding this label to a GitHub issue hands the issue to the app, as a mention does.",
    );

    const shown: Array<DetailField> = (
      props["modelDetailProps"] as { fields: Array<DetailField> }
    ).fields;

    /*
     * Named, as the Pull Requests card's values are: a value with no name
     * under the card's words read as one more line of them.
     */
    expect(shown).toHaveLength(1);
    expect(shown[0]!.title).toBe("Label");
    expect(shown[0]!.placeholder).toBe("oneuptime");
  });

  test("the Pull Requests card asks the main branch and the limit, three rows at most", () => {
    draw();

    const fields: Array<FormField> = card("Repository > Pull Requests")[
      "formFields"
    ] as Array<FormField>;

    expect(fields.map(columnsOf)).toEqual([
      ["mainBranchName"],
      ["maxOpenFixPullRequests"],
      ["maxOpenFixPullRequests"],
    ]);
  });

  test("each detail card in it has its place on the page", () => {
    draw();

    expect(
      [
        "Repository > Runner",
        "Repository > Pull Requests",
        "Repository > GitHub Trigger Label",
        "Repository > Production Review Comment",
      ].map((name: string): unknown => {
        return (card(name)["cardProps"] as { id?: string }).id;
      }),
    ).toEqual([
      "runner",
      "pull-requests",
      "trigger-label",
      "production-review-comment",
    ]);
    // The repository itself is no setting a link lands on.
    expect(
      (card("Repository > Repository Details")["cardProps"] as { id?: string })
        .id,
    ).toBeUndefined();
  });
});

describe("a member who may only read", () => {
  beforeEach(() => {
    getJestSpyOn(PermissionGate, "checkColumnUpdate").mockImplementation(
      (): PermissionGateResult => {
        return {
          isAllowed: false,
          disabledReason:
            "You need Edit Code Repository permission to update this.",
        };
      },
    );
  });

  test("sees More settings as everyone does, and both switches in it locked, saying nothing", async () => {
    stored = { isGitHubCommandsEnabled: true, isProductionReviewEnabled: true };
    draw();
    await switchesRead();

    expect(foldedNames()).toEqual([
      "GitHub Commands",
      "Production Review",
      "Runner",
      "Pull Requests",
    ]);

    openMoreSettings();

    for (const name of [
      "Respond to GitHub Commands",
      "Review Pull Requests Against Production",
    ]) {
      const toggle: HTMLElement = screen.getByRole("switch", { name });

      expect(toggle).toHaveAttribute("aria-disabled", "true");
      fireEvent.click(toggle);
    }

    expect(updateByIdMock).not.toHaveBeenCalled();
  });

  test("opened at #runner, More settings opens for them too", () => {
    drawAt(CodeRepositorySetting.Runner);

    expect(foldHeader()).toHaveAttribute("aria-expanded", "true");
  });
});

describe("build and test commands an operator set", () => {
  test("a repository with none shows nothing of them", async () => {
    draw();

    await pullRequestsCardReads({});

    expect(screen.queryByTestId(CODE_REPOSITORY_COMMANDS_TEST_ID)).toBeNull();
    expect(foldedNames()).not.toContain("Build and Test Commands");
  });

  test("set ones are shown read-only, only those set, with what they do now", async () => {
    draw();

    await pullRequestsCardReads({
      setupCommand: "npm ci",
      testCommand: "npm test -- --runInBand",
    });

    const commands: HTMLElement = screen.getByTestId(
      CODE_REPOSITORY_COMMANDS_TEST_ID,
    );

    expect(commands).toHaveTextContent("Setup Command");
    expect(commands).toHaveTextContent("npm ci");
    expect(commands).toHaveTextContent("Test Command");
    expect(commands).toHaveTextContent("npm test -- --runInBand");
    expect(commands).not.toHaveTextContent("Build Command");
    // Read-only: no field to type a command into.
    expect(within(commands).queryByRole("textbox")).toBeNull();
    // In More settings, at a place of its own.
    expect(document.getElementById("commands")).toContainElement(commands);
    expect(folded()).toContainElement(commands);

    expect(
      screen.getByText(CODE_REPOSITORY_SETTINGS_COPY.commandsCardDescription),
    ).toBeInTheDocument();
    // What they do now, why they are no longer needed, and that they may go.
    expect(CODE_REPOSITORY_SETTINGS_COPY.commandsCardDescription).toBe(
      "A Runner of your own runs these after AI changes the code. AI now learns how to build and test from the repository's AGENTS.md, so you can remove them.",
    );
  });

  test("Remove Commands asks first: Cancel saves nothing, confirming clears all three", async () => {
    draw();

    await pullRequestsCardReads({
      setupCommand: "npm ci",
      buildCommand: "npm run build",
      testCommand: "npm test",
    });

    openMoreSettings();
    fireEvent.click(screen.getByRole("button", { name: "Remove Commands" }));

    expect(
      await screen.findByText("Remove these commands?"),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        "AI then builds and tests its changes the way the repository's AGENTS.md says. You can set commands again through the API or Terraform.",
      ),
    ).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    await waitFor(() => {
      expect(screen.queryByText("Remove these commands?")).toBeNull();
    });
    expect(updateByIdMock).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: "Remove Commands" }));

    const dialog: HTMLElement = await screen.findByRole("dialog");

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Remove Commands" }),
    );

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });
    expect(updateByIdMock.mock.calls[0]![0]).toMatchObject({
      modelType: CodeRepository,
      data: { setupCommand: null, buildCommand: null, testCommand: null },
    });
    expect(
      String(
        (updateByIdMock.mock.calls[0]![0] as { id: ObjectID }).id.toString(),
      ),
    ).toBe(REPOSITORY_ID);

    // Gone from the page, and from More settings' folded header.
    await waitFor(() => {
      expect(screen.queryByTestId(CODE_REPOSITORY_COMMANDS_TEST_ID)).toBeNull();
    });
    fireEvent.click(foldHeader());
    expect(foldedNames()).not.toContain("Build and Test Commands");
    expect(setChips()).not.toContain("Build and Test Commands: Configured");
  });

  test("a refused removal says why in the dialog and keeps the commands", async () => {
    updateByIdMock.mockImplementation(async (): Promise<unknown> => {
      throw new Error("You do not have permission to edit this repository.");
    });
    draw();

    await pullRequestsCardReads({ buildCommand: "make" });

    fireEvent.click(screen.getByRole("button", { name: "Remove Commands" }));

    const dialog: HTMLElement = await screen.findByRole("dialog");

    fireEvent.click(
      within(dialog).getByRole("button", { name: "Remove Commands" }),
    );

    expect(
      await within(dialog).findByText(
        "You do not have permission to edit this repository.",
      ),
    ).toBeInTheDocument();
    expect(screen.getByTestId(CODE_REPOSITORY_COMMANDS_TEST_ID)).toBeTruthy();
  });

  test("someone who may not edit the repository sees Remove Commands locked, with why", async () => {
    getJestSpyOn(PermissionGate, "checkColumnUpdate").mockImplementation(
      (): PermissionGateResult => {
        return {
          isAllowed: false,
          disabledReason:
            "You need Edit Code Repository permission to update this.",
        };
      },
    );
    draw();

    await pullRequestsCardReads({ buildCommand: "make" });

    const remove: HTMLElement = screen.getByRole("button", {
      name: "Remove Commands",
    });

    expect(remove).toBeDisabled();
  });
});

describe("the settings' words and rules, as plain functions", () => {
  test("a command is set when it is something other than blank", () => {
    expect(hasRepositoryCommands(null)).toBe(false);
    expect(hasRepositoryCommands({})).toBe(false);
    expect(
      hasRepositoryCommands({
        setupCommand: "  ",
        buildCommand: "",
        testCommand: null,
      }),
    ).toBe(false);

    for (const column of COMMAND_COLUMNS) {
      expect(hasRepositoryCommands({ [column]: "npm test" })).toBe(true);
    }
  });

  test("the trigger label is the one set, else 'oneuptime'", () => {
    expect(getGitHubTriggerLabel(null)).toBe("oneuptime");
    expect(getGitHubTriggerLabel({ gitHubTriggerLabel: "  " })).toBe(
      "oneuptime",
    );
    expect(getGitHubTriggerLabel({ gitHubTriggerLabel: " ai-fix " })).toBe(
      "ai-fix",
    );
  });

  test("More settings lists its cards in their order; a default is not 'set'", () => {
    const items: Array<FoldedSectionItem> = getRepositoryMoreSettingsItems(
      {
        maxOpenFixPullRequests: null,
        gitHubTriggerLabel: "OneUptime",
        isGitHubCommandsEnabled: true,
        isProductionReviewEnabled: true,
        runnerId: "",
      },
      english,
      choicesWith(),
    );

    expect(
      items.map((item: FoldedSectionItem) => {
        return [item.key, item.isSet, item.value];
      }),
    ).toEqual([
      ["github-commands", false, undefined],
      ["production-review", false, undefined],
      // A global Runner: the default.
      ["runner", false, undefined],
      ["pull-requests", false, undefined],
      // The default label in another case is still the default.
      ["trigger-label", false, undefined],
      // Never chosen: the default, the review or a link on a public one.
      ["production-review-comment", false, undefined],
    ]);
  });

  test("a switch is set only once it is known to be off; unknown or on, its name alone", () => {
    for (const [isOn, isSet] of [
      [undefined, false],
      [true, false],
      [false, true],
    ] as Array<[boolean | undefined, boolean]>) {
      const items: Array<FoldedSectionItem> = getRepositoryMoreSettingsItems(
        {
          ...(isOn === undefined
            ? {}
            : {
                isGitHubCommandsEnabled: isOn,
                isProductionReviewEnabled: isOn,
              }),
        },
        english,
      );

      for (const item of items.slice(0, 2)) {
        expect({ key: item.key, isSet: item.isSet, value: item.value }).toEqual(
          {
            key: item.key,
            isSet: isSet,
            value: isSet ? "Off" : undefined,
          },
        );

        if (isSet) {
          // "Off" is looked up in the reader's language.
          expect(item.translateValue).toBe(true);
        }
      }
    }
  });

  test("the Runner is named only once both the card's read and the choices are in", () => {
    const runnerItem: (
      runnerId: string | undefined,
      choices: RunnerChoices | null | undefined,
    ) => FoldedSectionItem = (
      runnerId: string | undefined,
      choices: RunnerChoices | null | undefined,
    ): FoldedSectionItem => {
      return getRepositoryMoreSettingsItems(
        runnerId === undefined ? {} : { runnerId },
        english,
        choices,
      )[2]!;
    };

    // Not read yet, either way: its name alone, never a guess.
    expect(runnerItem(undefined, choicesWith())).toMatchObject({
      key: "runner",
      isSet: false,
    });
    expect(runnerItem(PROD_RUNNER_ID, null)).toMatchObject({ isSet: false });
    expect(runnerItem(PROD_RUNNER_ID, undefined)).toMatchObject({
      isSet: false,
    });
    // Both in: what it works on.
    expect(runnerItem(PROD_RUNNER_ID, choicesWith())).toMatchObject({
      isSet: true,
      value: "prod-eu-west-1",
    });
    // A Runner's own name is shown as written, never looked up.
    expect(runnerItem(PROD_RUNNER_ID, choicesWith()).translateValue).toBe(
      undefined,
    );
  });

  /*
   * A repository that picks none follows the project's default Runner: the
   * default state, so its name alone - as on a global Runner. One that
   * picked the Global Runner itself beside a default says so.
   */
  test("the Runner, beside a project default: none is the default, the Global Runner's own pick is said", () => {
    const withDefault: RunnerChoices = choicesWith({
      projectRunners: [
        {
          id: PROD_RUNNER_ID,
          name: "prod-eu-west-1",
          liveStatus: RunnerLiveStatus.Connected,
          isProjectDefault: true,
        },
        {
          id: OFFICE_RUNNER_ID,
          name: "office-runner",
          liveStatus: RunnerLiveStatus.Disconnected,
        },
      ],
    });
    const runnerItem: (
      values: Record<string, unknown>,
      choices?: RunnerChoices,
    ) => FoldedSectionItem = (
      values: Record<string, unknown>,
      choices: RunnerChoices = withDefault,
    ): FoldedSectionItem => {
      return getRepositoryMoreSettingsItems(values, english, choices).find(
        (item: FoldedSectionItem): boolean => {
          return item.key === "runner";
        },
      )!;
    };

    // Follows the default: the default.
    expect(runnerItem({ runnerId: "" })).toMatchObject({ isSet: false });
    expect(
      runnerItem({ runnerId: "", isGlobalRunnerPicked: false }),
    ).toMatchObject({ isSet: false });

    // Picked the Global Runner itself: said, in the reader's language.
    expect(
      runnerItem({ runnerId: "", isGlobalRunnerPicked: true }),
    ).toMatchObject({
      isSet: true,
      value: "Global Runner",
      translateValue: true,
    });

    // With no default, the Global Runner is the default: its name alone.
    expect(
      runnerItem({ runnerId: "", isGlobalRunnerPicked: true }, choicesWith()),
    ).toMatchObject({ isSet: false });

    // A pick of another Runner of the project's own: its name.
    expect(runnerItem({ runnerId: OFFICE_RUNNER_ID })).toMatchObject({
      isSet: true,
      value: "office-runner · Disconnected",
    });
  });

  test("a blocked limit reads as None; commands as Configured", () => {
    const items: Array<FoldedSectionItem> = getRepositoryMoreSettingsItems(
      { maxOpenFixPullRequests: 0, testCommand: "go test ./..." },
      english,
    );

    expect(items[3]).toMatchObject({
      key: "pull-requests",
      isSet: true,
      value: "None: AI opens no fix pull requests here",
      translateValue: true,
    });
    expect(items[6]).toMatchObject({
      key: "commands",
      title: "Build and Test Commands",
      isSet: true,
      value: "Configured",
    });
  });

  test("a production review comment other than the default shows what it is, in the form's words", () => {
    const stored: Array<[unknown, boolean, string | undefined]> = [
      [undefined, false, undefined],
      [null, false, undefined],
      ["Review", false, undefined],
      // An answer this Dashboard does not know reads as the default.
      ["SomethingNew", false, undefined],
      ["Link", true, "Only a link to the review"],
      ["ReviewEvenIfPublic", true, "The review, even on a public repository"],
    ];

    for (const [content, isSet, value] of stored) {
      const item: FoldedSectionItem | undefined =
        getRepositoryMoreSettingsItems(
          {
            productionReviewPullRequestContent: content as string | undefined,
          },
          english,
        ).find((each: FoldedSectionItem): boolean => {
          return each.key === "production-review-comment";
        });

      expect({ content, isSet: item?.isSet, value: item?.value }).toEqual({
        content,
        isSet,
        value,
      });
      expect(item?.title).toBe("Production Review Comment");
    }
  });

  test("More settings' description says what it holds, in the order it holds it, in two short lines at most", () => {
    expect(CODE_REPOSITORY_SETTINGS_COPY.moreSettingsDescription).toBe(
      "GitHub commands, production reviews, where AI works, and where its pull requests open.",
    );
    expect(
      CODE_REPOSITORY_SETTINGS_COPY.moreSettingsDescription.length,
    ).toBeLessThanOrEqual(150);
    /*
     * In the words its cards use - "Where AI works in this repository." -
     * never "the Runner AI works on", which read as one name.
     */
    expect(CODE_REPOSITORY_SETTINGS_COPY.moreSettingsDescription).toContain(
      "where AI works",
    );
    expect(CODE_REPOSITORY_SETTINGS_COPY.moreSettingsDescription).not.toContain(
      "Runner AI",
    );
  });
});

describe("Review Pull Requests Against Production: one switch, off until turned on, under More settings", () => {
  // The switch itself carries the card's test id (ModelSwitchRow).
  async function reviewSwitch(): Promise<HTMLElement> {
    const toggle: HTMLElement = await screen.findByRole("switch", {
      name: "Review Pull Requests Against Production",
    });

    expect(toggle).toHaveAttribute(
      "data-testid",
      CODE_REPOSITORY_PRODUCTION_REVIEW_TEST_ID,
    );

    return toggle;
  }

  test("a repository that never set it - connected before it existed - reads as off, as the server reads it", async () => {
    stored = {};
    draw();

    expect(await reviewSwitch()).toHaveAttribute("aria-checked", "false");
    // Read through its own card, by its one column.
    expect(
      getItemMock.mock.calls.some((call: Array<unknown>): boolean => {
        const select: Record<string, unknown> = (
          call[0] as { select: Record<string, unknown> }
        ).select;

        return (
          select["isProductionReviewEnabled"] === true &&
          Object.keys(select).length === 1
        );
      }),
    ).toBe(true);
    // Folded, More settings says it is off.
    await waitFor(() => {
      expect(setChips()).toContain("Production Review: Off");
    });
  });

  test("a stored null reads as off, and a stored true as on", async () => {
    stored = { isProductionReviewEnabled: null };
    draw();
    expect(await reviewSwitch()).toHaveAttribute("aria-checked", "false");

    cleanup();
    stored = { isProductionReviewEnabled: true };
    draw();
    expect(await reviewSwitch()).toHaveAttribute("aria-checked", "true");
  });

  test("opened from More settings, flipping it saves at once - on, then off again - with nothing else", async () => {
    stored = { isProductionReviewEnabled: false };
    draw();

    await reviewSwitch();
    openMoreSettings();
    fireEvent.click(await reviewSwitch());

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(1);
    });
    expect(updateByIdMock.mock.calls[0]![0]).toMatchObject({
      modelType: CodeRepository,
      data: { isProductionReviewEnabled: true },
    });
    expect(
      Object.keys(
        (updateByIdMock.mock.calls[0]![0] as { data: Record<string, unknown> })
          .data,
      ),
    ).toEqual(["isProductionReviewEnabled"]);
    expect(
      String(
        (updateByIdMock.mock.calls[0]![0] as { id: ObjectID }).id.toString(),
      ),
    ).toBe(REPOSITORY_ID);

    // Saved, and on: the next flip is a save of its own.
    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(await reviewSwitch()).toHaveAttribute("aria-checked", "true");

    fireEvent.click(await reviewSwitch());

    await waitFor(() => {
      expect(updateByIdMock).toHaveBeenCalledTimes(2);
    });
    expect(updateByIdMock.mock.calls[1]![0]).toMatchObject({
      data: { isProductionReviewEnabled: false },
    });
  });

  test("its card sits right under GitHub Commands, and says what on does in one short line", async () => {
    draw();

    const toggle: HTMLElement = await reviewSwitch();
    const commands: HTMLElement = await screen.findByRole("switch", {
      name: "Respond to GitHub Commands",
    });

    // GitHub Commands first, then Production Review: both are how the app acts on GitHub.
    expect(
      commands.compareDocumentPosition(toggle) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    expect(
      within(document.getElementById("production-review")!).getByTestId(
        "card-details-heading",
      ),
    ).toHaveTextContent("Production Review");
    expect(
      screen.getByText(PRODUCTION_REVIEW_SETTINGS_COPY.switchDescription),
    ).toBeInTheDocument();
    expect(PRODUCTION_REVIEW_SETTINGS_COPY.switchDescription).toBe(
      "When someone with write access opens or updates a pull request, OneUptime comments with what production shows of the code it changes.",
    );
    // Two short lines at most (ShortDescriptionsGuard).
    expect(
      PRODUCTION_REVIEW_SETTINGS_COPY.switchDescription.length,
    ).toBeLessThanOrEqual(150);
  });
});

describe("Production Review Comment: what a review posts on a pull request", () => {
  function fields(): Array<FormField> {
    return card("Repository > Production Review Comment")[
      "formFields"
    ] as Array<FormField>;
  }

  test("its Edit asks one question - three answers, each with a line of its own - and carries the column it writes", () => {
    draw();

    const [choice, column] = fields();

    expect(fields()).toHaveLength(2);
    expect(choice!.fieldType).toBe(FormFieldSchemaType.RadioButton);
    expect(choice!.formOnly).toBe(true);
    expect(choice!.overrideFieldKey).toBe(PRODUCTION_REVIEW_CONTENT_FIELD_KEY);
    expect(columnsOf(choice!)).toEqual(["productionReviewPullRequestContent"]);
    expect(choice!.title).toBe("What the Comment Shows");
    expect(choice!.required).toBe(true);
    // The answers say it all: no API description under the question.
    expect(choice!.hideColumnDescription).toBe(true);
    expect(choice!.description).toBeUndefined();
    expect(
      (choice!.radioButtonOptions || []).map(
        (option: {
          value: unknown;
          title: string;
          description?: string | undefined;
        }) => {
          return [option.value, option.title, option.description];
        },
      ),
    ).toEqual([
      [
        "Review",
        "The review, or a link on a public repository",
        "Private repositories show the review. Public ones only link to it in OneUptime, since anyone on the internet can read them.",
      ],
      [
        "Link",
        "Only a link to the review",
        "Every pull request links to its review in OneUptime, which only members of this project can open. Nothing from production is posted.",
      ],
      [
        "ReviewEvenIfPublic",
        "The review, even on a public repository",
        "Anyone who can read the repository sees its exception counts, slow operations and incident numbers. Never a message or a log line.",
      ],
    ]);

    // The column itself is never drawn, only read and sent.
    expect(columnsOf(column!)).toEqual(["productionReviewPullRequestContent"]);
    expect(column!.formOnly).toBeUndefined();
    expect((column!.showIf as () => boolean)()).toBe(false);
  });

  test("a repository that never chose opens on the default; one that chose opens on its choice", () => {
    draw();

    const getDefaultValue: (values: Record<string, unknown>) => unknown =
      fields()[0]!.getDefaultValue as unknown as (
        values: Record<string, unknown>,
      ) => unknown;

    expect(getDefaultValue({})).toBe("Review");
    expect(getDefaultValue({ productionReviewPullRequestContent: null })).toBe(
      "Review",
    );
    expect(
      getDefaultValue({ productionReviewPullRequestContent: "Link" }),
    ).toBe("Link");
    expect(
      getDefaultValue({
        productionReviewPullRequestContent: "Link",
        [PRODUCTION_REVIEW_CONTENT_FIELD_KEY]: "ReviewEvenIfPublic",
      }),
    ).toBe("ReviewEvenIfPublic");
  });

  test("a pick writes the column it stands for; anything else changes nothing", () => {
    draw();

    const onChange: (
      value: unknown,
      current: Record<string, unknown>,
      set: (values: Record<string, unknown>) => void,
    ) => void = fields()[0]!.onChange as unknown as (
      value: unknown,
      current: Record<string, unknown>,
      set: (values: Record<string, unknown>) => void,
    ) => void;

    const written: Array<Record<string, unknown>> = [];

    const keep: (values: Record<string, unknown>) => void = (
      values: Record<string, unknown>,
    ): void => {
      written.push(values);
    };

    for (const content of PRODUCTION_REVIEW_CONTENT_ANSWERS) {
      onChange(content, { name: "checkout-api" }, keep);
    }

    onChange("Everything", { name: "checkout-api" }, keep);

    expect(written).toEqual(
      PRODUCTION_REVIEW_CONTENT_ANSWERS.map(
        (content: ProductionReviewPullRequestContent) => {
          return {
            name: "checkout-api",
            [PRODUCTION_REVIEW_CONTENT_FIELD_KEY]: content,
            productionReviewPullRequestContent: content,
          };
        },
      ),
    );
  });

  test("the card shows the answer picked, in the form's words, named as the form's choice", () => {
    draw();

    const props: Record<string, unknown> = card(
      "Repository > Production Review Comment",
    );
    const shown: Array<DetailField> = (
      props["modelDetailProps"] as { fields: Array<DetailField> }
    ).fields;

    expect(shown).toHaveLength(1);
    // Named as the other cards under More settings name their values.
    expect(shown[0]!.title).toBe("What the Comment Shows");
    expect(shown[0]!.title).toBe(fields()[0]!.title);
    expect((props["cardProps"] as { description: string }).description).toBe(
      "What a production review posts on a pull request.",
    );

    for (const [content, title] of [
      [undefined, "The review, or a link on a public repository"],
      ["Review", "The review, or a link on a public repository"],
      ["Link", "Only a link to the review"],
      ["ReviewEvenIfPublic", "The review, even on a public repository"],
    ] as Array<[string | undefined, string]>) {
      const item: CodeRepository = new CodeRepository();

      if (content) {
        item.productionReviewPullRequestContent =
          content as ProductionReviewPullRequestContent;
      }

      cleanup();
      render(shown[0]!.getElement!(item));
      expect(
        screen.getByTestId("production-review-content-value"),
      ).toHaveTextContent(title);
      expect(PRODUCTION_REVIEW_CONTENT_COPY).toBeDefined();
    }
  });

  test("what the card read shows on More settings' folded header", async () => {
    stored = { isProductionReviewEnabled: true };
    draw();
    await switchesRead();

    await cardReads("Repository > Production Review Comment", {
      productionReviewPullRequestContent:
        ProductionReviewPullRequestContent.Link,
    });

    await waitFor(() => {
      expect(setChips()).toEqual([
        "Production Review Comment: Only a link to the review",
      ]);
    });
  });
});

/*
 * A repository on GitLab, Forgejo, Gitea or a Git server: Repository
 * Details says how it connects - its server, account and token's last
 * characters, never the GitHub App - and More settings holds only what its
 * host has. GitHub commands, the trigger label and production reviews are
 * GitHub's; a Git repository, which gets a pushed branch and no pull
 * request, has Branches where the others have Pull Requests.
 */
describe("a repository off GitHub: only what its host has", () => {
  const CONNECTION_ID: string = "ffffffff-0000-4000-8000-0000000000c7";

  function hostedOn(provider: string): void {
    getJestSpyOn(CodeApi, "getRepository").mockImplementation(
      async (repositoryId: string): Promise<CodeRepositoryResponse> => {
        getRepositoryCalls.push(repositoryId);

        return {
          repository: {
            id: repositoryId,
            name: "checkout-api",
            isConnected: true,
            provider,
            connection: {
              id: CONNECTION_ID,
              hostUrl: "https://git.example.com",
              accountLogin: "alice",
              credentialHint: "ab12",
              isTokenRefused: false,
              isReachableFromServer: true,
            },
          },
          stats: {
            working: 0,
            waitingForYou: 0,
            openPullRequests: 0,
            taskCount: 0,
          },
          canAsk: true,
          blocker: null,
        };
      },
    );
  }

  // The page has read where the repository is hosted, and drawn for it.
  async function hostRead(): Promise<void> {
    await waitFor(() => {
      expect(document.getElementById("github-commands")).toBeNull();
    });
  }

  function connectionField(): DetailField {
    return (
      card("Repository > Repository Details")["modelDetailProps"] as {
        fields: Array<DetailField>;
      }
    ).fields.find((field: DetailField): boolean => {
      return field.title === "Connection";
    })!;
  }

  test("GitLab: the Runner and Merge Requests, and nothing of GitHub's", async () => {
    hostedOn("GitLab");
    draw();
    await hostRead();

    for (const gone of [
      "github-commands",
      "production-review",
      "trigger-label",
      "production-review-comment",
      "branches",
    ]) {
      expect(document.getElementById(gone)).toBeNull();
    }

    for (const kept of ["runner", "pull-requests"]) {
      expect(folded()).toContainElement(document.getElementById(kept));
    }

    expect(
      screen.queryByRole("switch", { name: "Respond to GitHub Commands" }),
    ).toBeNull();
    // In GitLab's word, as its tasks and the request box say it.
    expect(foldedNames()).toEqual(["Runner", "Merge Requests"]);

    openMoreSettings();
    expect(folded()).toHaveTextContent(
      "Where AI works, and where its merge requests open.",
    );
    expect(folded()).not.toHaveTextContent("pull request");
  });

  /*
   * GitLab calls a pull request a merge request (CodeHost's
   * pullRequestTerm): the card, its Edit form, its limit and what More
   * settings says of it while folded say merge request there - and pull
   * request on GitHub, Forgejo and Gitea.
   */
  test("GitLab: the card, its Edit form and its limit say merge request", async () => {
    hostedOn("GitLab");
    draw();
    await hostRead();

    const props: Record<string, unknown> = card("Repository > Pull Requests");
    const cardProps: { title: string; description: string; id: string } = props[
      "cardProps"
    ] as { title: string; description: string; id: string };

    expect(cardProps.title).toBe("Merge Requests");
    expect(cardProps.description).toBe(
      "Where AI's merge requests open, and how many may be open at once.",
    );
    // The same place on the page: links land on it as on any host.
    expect(cardProps.id).toBe("pull-requests");
    expect(props["editModalTitle"]).toBe("Merge Requests");

    const fields: Array<FormField> = props["formFields"] as Array<FormField>;
    const limit: FormField = fields.find((field: FormField) => {
      return field.overrideFieldKey === FIX_PULL_REQUEST_LIMIT_FIELD_KEY;
    })!;

    expect(limit.title).toBe("AI Fix Merge Requests");
    expect(
      (limit.radioButtonOptions || []).map(
        (option: { title: string; description?: string | undefined }) => {
          return [option.title, option.description];
        },
      ),
    ).toEqual([
      ["No limit", "AI opens as many fix merge requests as it needs."],
      [
        "A limit",
        "AI waits while this many of its fix merge requests are open.",
      ],
      ["None", "AI opens no fix merge requests in this repository."],
    ]);

    const max: FormField = fields.find((field: FormField) => {
      return (
        columnsOf(field).includes("maxOpenFixPullRequests") && !field.formOnly
      );
    })!;

    expect(max.title).toBe("Max Open Fix Merge Requests");

    const shown: DetailField = (
      props["modelDetailProps"] as { fields: Array<DetailField> }
    ).fields.find((field: DetailField): boolean => {
      return columnsOf(field).includes("maxOpenFixPullRequests");
    })!;

    expect(shown.title).toBe("AI Fix Merge Requests");
    expect(shown.description).toBe(
      "How many fix merge requests AI may have open at once in this repository.",
    );

    const blocked: CodeRepository = new CodeRepository();
    blocked.maxOpenFixPullRequests = 0;
    render(shown.getElement!(blocked));

    expect(
      screen.getByText("None: AI opens no fix merge requests here"),
    ).toBeInTheDocument();
  });

  test("GitLab: More settings, folded, says a blocked limit in GitLab's word", () => {
    const items: Array<FoldedSectionItem> = getRepositoryMoreSettingsItems(
      { maxOpenFixPullRequests: 0 },
      english,
      undefined,
      "GitLab",
    );

    expect(
      items.find((item: FoldedSectionItem): boolean => {
        return item.key === "pull-requests";
      }),
    ).toMatchObject({
      title: "Merge Requests",
      isSet: true,
      value: "None: AI opens no fix merge requests here",
      translateValue: true,
    });
  });

  test("every other host keeps pull request: GitHub, Forgejo and Gitea", () => {
    for (const provider of ["GitHub", "Forgejo", undefined]) {
      expect(getPullRequestsCardCopy(provider)).toEqual({
        title: "Pull Requests",
        description:
          "Where AI's pull requests open, and how many may be open at once.",
      });

      const copy: FixPullRequestLimitCopy =
        getFixPullRequestLimitCopy(provider);

      expect(copy.fieldTitle).toBe("AI Fix Pull Requests");
      expect(copy.maxFieldTitle).toBe("Max Open Fix Pull Requests");
      expect(copy.cardDescription).toBe(
        "How many fix pull requests AI may have open at once in this repository.",
      );
      expect(isMergeRequestHost(provider)).toBe(false);
    }

    expect(isMergeRequestHost("GitLab")).toBe(true);
    expect(getRepositoryMoreSettingsDescription("Forgejo")).toBe(
      "Where AI works, and where its pull requests open.",
    );
    expect(getRepositoryMoreSettingsDescription("GitLab")).toBe(
      "Where AI works, and where its merge requests open.",
    );
  });

  /*
   * The words are one table's: the host's own term for a pull request
   * (CodeHost's pullRequestTerm), so a new host that calls one a merge
   * request is drawn in its word with no change here.
   */
  test("the word follows the host table's term", () => {
    for (const type of Object.values(CodeRepositoryType)) {
      expect({
        type,
        mergeRequest: isMergeRequestHost(type),
      }).toEqual({
        type,
        mergeRequest:
          CodeHost.getFacts(type).pullRequestTerm === "merge request",
      });
    }
  });

  test("GitLab: Repository Details says its server, account and token's last characters", async () => {
    hostedOn("GitLab");
    draw();
    await hostRead();

    render(connectionField().getElement!(new CodeRepository()));

    const block: HTMLElement = screen.getByTestId("code-repository-connection");

    expect(block).toHaveAttribute("data-provider", "GitLab");
    expect(block).toHaveTextContent("git.example.com");
    expect(block).toHaveTextContent("Signed in as alice");
    expect(block).toHaveTextContent("Access token ending in …ab12");
    expect(block).not.toHaveTextContent("GitHub App");
  });

  test("a Git repository: Branches where the others have Pull Requests", async () => {
    hostedOn("Git");
    draw();
    await hostRead();

    expect(document.getElementById("pull-requests")).toBeNull();
    expect(folded()).toContainElement(document.getElementById("branches"));
    expect(foldedNames()).toEqual(["Runner", "Branches"]);

    // Its card asks only the branch AI starts from.
    expect(
      (card("Repository > Branches")["formFields"] as Array<FormField>).map(
        (field: FormField): Array<string> => {
          return columnsOf(field);
        },
      ),
    ).toEqual([["mainBranchName"]]);

    openMoreSettings();
    expect(folded()).toHaveTextContent(
      "Where AI works, and the branch it starts from.",
    );
  });

  test("Forgejo or Gitea: the same as GitLab - Pull Requests, no GitHub switches", async () => {
    hostedOn("Forgejo");
    draw();
    await hostRead();

    expect(document.getElementById("production-review")).toBeNull();
    expect(folded()).toContainElement(document.getElementById("pull-requests"));
    expect(foldedNames()).toEqual(["Runner", "Pull Requests"]);
  });
});
