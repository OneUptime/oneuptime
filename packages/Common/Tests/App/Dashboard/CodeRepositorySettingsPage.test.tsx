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
import React, { ReactElement } from "react";
import getJestMockFunction, { MockFunction } from "../../MockType";
import { getJestSpyOn } from "../../Spy";

/*
 * A code repository's Settings in Code (Pages/Code/Repository/Settings):
 * as little to configure as possible, drawn as every settings page in
 * OneUptime is.
 *
 *   - Cards, not a stepped dialog: Repository Details, the GitHub Commands
 *     switch, Runner, and More settings, folded, holding Pull Requests and
 *     GitHub Trigger Label. The Edit Settings dialog walked four steps -
 *     Pull Requests, GitHub Commands, Runner, Build & Test - and Build &
 *     Test is gone: the code agent reads how to build and test from the
 *     repository's AGENTS.md.
 *   - "Respond to GitHub Commands" is one switch that saves the moment it is
 *     flipped, and is on for a repository that never set it - as the server
 *     reads it. The dialog drew that repository's switch off, and saving
 *     the dialog untouched wrote false.
 *   - Build and test commands an operator set before are shown read-only
 *     under More settings, with Remove Commands, which asks first; a
 *     repository with none shows nothing of them.
 *
 * CardModelDetail is a stand-in that records its props (each card's own
 * suite draws it); the switch card, More settings and the commands card are
 * the real ones, over a stand-in ModelAPI.
 */

const mockDetails: Array<Record<string, unknown>> = [];

jest.mock("../../../UI/Components/ModelDetail/CardModelDetail", () => {
  return {
    __esModule: true,
    default: (props: Record<string, unknown>): null => {
      mockDetails.push(props);
      return null;
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
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Code/Repository/Settings";
import {
  CodeRepositoryRunnerCopy,
  CodeRepositoryRunnerPicker,
  CodeRepositoryRunnerValue,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeRepositoryRunner";
import { CODE_REPOSITORY_COMMANDS_TEST_ID } from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeRepositoryCommandsCard";
import {
  CODE_REPOSITORY_SETTINGS_COPY,
  DEFAULT_GITHUB_TRIGGER_LABEL,
  getGitHubTriggerLabel,
  getRepositoryMoreSettingsItems,
  hasRepositoryCommands,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Code/CodeRepositorySettingsCopy";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import ObjectID from "../../../Types/ObjectID";
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

const COMMAND_COLUMNS: Array<string> = [
  "setupCommand",
  "buildCommand",
  "testCommand",
];

type FormField = ModelField<CodeRepository>;

interface DetailField {
  field?: Record<string, unknown>;
  title?: string;
  placeholder?: string;
  getElement?: ((item: CodeRepository) => ReactElement) | undefined;
}

// What the repository holds, as the stand-in ModelAPI reads it.
let stored: Record<string, unknown> = {};

const english: Translator = createTranslator(undefined, "en");

beforeEach(() => {
  mockDetails.length = 0;
  stored = {};

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
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

function draw(): void {
  render(<CodeRepositorySettings {...({} as unknown as PageComponentProps)} />);
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

// Tells the page what the Pull Requests card read, as CardModelDetail does.
async function pullRequestsCardReads(
  data: Record<string, unknown>,
): Promise<void> {
  const item: CodeRepository = new CodeRepository();
  item._id = REPOSITORY_ID;
  Object.assign(item, data);

  await act(async () => {
    (
      card("Repository > Pull Requests")["modelDetailProps"] as {
        onItemLoaded: (item: CodeRepository) => void;
      }
    ).onItemLoaded(item);
  });
}

describe("a repository's settings are cards, not a stepped dialog", () => {
  test("Repository Details, Runner, then Pull Requests and GitHub Trigger Label under More settings - and no card walks steps", () => {
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
    ]);

    for (const props of mockDetails) {
      expect(props["formSteps"]).toBeUndefined();

      for (const field of (props["formFields"] || []) as Array<FormField>) {
        expect(field.stepId).toBeUndefined();
      }
    }

    // Pull Requests and the trigger label are folded under More settings.
    expect(
      screen.getByTestId(CODE_REPOSITORY_MORE_SETTINGS_TEST_ID),
    ).toBeInTheDocument();
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
    ]);
  });
});

describe("Respond to GitHub Commands: one switch, on by default", () => {
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

  test("flipping it saves at once - off, then on again - with nothing else", async () => {
    stored = { isGitHubCommandsEnabled: true };
    draw();

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
  });

  test("it says what commands do, in the words the dialog used", async () => {
    draw();

    await commandsSwitch();

    expect(
      screen.getByText(
        CODE_REPOSITORY_SETTINGS_COPY.gitHubCommandsSwitchDescription,
      ),
    ).toBeInTheDocument();
    expect(screen.getByText("GitHub Commands")).toBeInTheDocument();
    expect(CODE_REPOSITORY_SETTINGS_COPY.gitHubCommandsSwitchDescription).toBe(
      "Let people with write access mention the OneUptime GitHub App, or add the trigger label, to give it work. It never merges anything.",
    );
  });
});

describe("the Runner card", () => {
  test("its Edit asks one thing - the Runner picker - on one page", () => {
    draw();

    const props: Record<string, unknown> = card("Repository > Runner");
    const fields: Array<FormField> = props["formFields"] as Array<FormField>;

    expect(fields).toHaveLength(1);
    expect(columnsOf(fields[0]!)).toEqual(["runnerId"]);
    expect(fields[0]!.title).toBe(CodeRepositoryRunnerCopy.fieldTitle);
    expect(fields[0]!.fieldType).toBe(FormFieldSchemaType.CustomComponent);
    expect(fields[0]!.hideOptionalLabel).toBe(true);

    const element: ReactElement = fields[0]!.getCustomElement!(
      {},
      { onChange: (): void => {} },
    ) as ReactElement;

    expect(element.type).toBe(CodeRepositoryRunnerPicker);
  });

  test("the card says what the repository runs on, with no second 'Runner' over its value", () => {
    draw();

    const fields: Array<DetailField> = (
      card("Repository > Runner")["modelDetailProps"] as {
        fields: Array<DetailField>;
      }
    ).fields;

    expect(fields).toHaveLength(1);
    expect(fields[0]!.title).toBeUndefined();

    const item: CodeRepository = new CodeRepository();
    item.runnerId = new ObjectID("aaaaaaaa-0000-4000-8000-0000000000c7");

    const element: ReactElement = fields[0]!.getElement!(item);

    expect(element.type).toBe(CodeRepositoryRunnerValue);
    expect(String(element.props.runnerId)).toBe(
      "aaaaaaaa-0000-4000-8000-0000000000c7",
    );
    // Nothing about commands: the value says what the Runner does.
    expect(element.props.hasCommands).toBeUndefined();
  });
});

describe("More settings", () => {
  function folded(): HTMLElement {
    return screen.getByTestId(CODE_REPOSITORY_MORE_SETTINGS_TEST_ID);
  }

  test("starts folded, naming its cards", () => {
    draw();

    const header: HTMLElement = within(folded()).getByRole("button", {
      name: "More settings",
    });

    expect(header).toHaveAttribute("aria-expanded", "false");
    expect(folded()).toHaveTextContent("Pull Requests");
    expect(folded()).toHaveTextContent("GitHub Trigger Label");
    // No commands, nothing about them.
    expect(folded()).not.toHaveTextContent("Build and Test Commands");
  });

  test("what is set shows on its folded header: a limit, a label of its own, commands", async () => {
    draw();

    await pullRequestsCardReads({
      maxOpenFixPullRequests: 3,
      gitHubTriggerLabel: "ai-fix",
      setupCommand: "npm ci",
    });

    const chips: Array<string> = within(folded())
      .getAllByTestId("folded-section-item")
      .filter((chip: HTMLElement): boolean => {
        return chip.getAttribute("data-item-set") === "true";
      })
      .map((chip: HTMLElement): string => {
        return chip.textContent || "";
      });

    expect(chips).toEqual([
      "Pull Requests: Up to 3 open at once",
      "GitHub Trigger Label: ai-fix",
      "Build and Test Commands: Configured",
    ]);
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

    const shown: Array<DetailField> = (
      props["modelDetailProps"] as { fields: Array<DetailField> }
    ).fields;

    expect(shown).toHaveLength(1);
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
});

describe("build and test commands an operator set", () => {
  test("a repository with none shows nothing of them", async () => {
    draw();

    await pullRequestsCardReads({});

    expect(screen.queryByTestId(CODE_REPOSITORY_COMMANDS_TEST_ID)).toBeNull();
    expect(screen.queryByText("Build and Test Commands")).toBeNull();
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

    expect(
      screen.getByText(CODE_REPOSITORY_SETTINGS_COPY.commandsCardDescription),
    ).toBeInTheDocument();
  });

  test("Remove Commands asks first: Cancel saves nothing, confirming clears all three", async () => {
    draw();

    await pullRequestsCardReads({
      setupCommand: "npm ci",
      buildCommand: "npm run build",
      testCommand: "npm test",
    });

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
    expect(
      screen.getByTestId(CODE_REPOSITORY_MORE_SETTINGS_TEST_ID),
    ).not.toHaveTextContent("Build and Test Commands");
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

  test("More settings lists its cards; a default is not 'set'", () => {
    const items: Array<FoldedSectionItem> = getRepositoryMoreSettingsItems(
      {
        maxOpenFixPullRequests: null,
        gitHubTriggerLabel: "OneUptime",
      },
      english,
    );

    expect(
      items.map((item: FoldedSectionItem) => {
        return [item.key, item.isSet, item.value];
      }),
    ).toEqual([
      ["pull-requests", false, undefined],
      // The default label in another case is still the default.
      ["trigger-label", false, undefined],
    ]);
  });

  test("a blocked limit reads as None; commands as Configured", () => {
    const items: Array<FoldedSectionItem> = getRepositoryMoreSettingsItems(
      { maxOpenFixPullRequests: 0, testCommand: "go test ./..." },
      english,
    );

    expect(items[0]).toMatchObject({
      key: "pull-requests",
      isSet: true,
      value: "None: AI opens no fix pull requests here",
      translateValue: true,
    });
    expect(items[2]).toMatchObject({
      key: "commands",
      title: "Build and Test Commands",
      isSet: true,
      value: "Configured",
    });
  });
});
