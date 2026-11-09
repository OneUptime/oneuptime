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
import { MemoryRouter } from "react-router-dom";
import AIFeatures from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/AIFeatures";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import {
  ENABLE_AI_SWITCH_TEST_ID,
  getProjectAiRunLimitFieldError,
  getProjectAiRunLimitsFoldedItem,
  PROJECT_AI_ADVANCED_SECTION_TEST_ID,
  PROJECT_AI_RUN_LIMIT_FIELDS,
  PROJECT_AI_RUN_LIMITS_CARD_KEY,
  PROJECT_AI_RUN_LIMITS_FORM_STEPS,
  ProjectAiDailyLimitsCopy,
  ProjectAiRunLimitField,
  ProjectAiRunLimitsCopy,
  ProjectAiRunLimitsFormStep,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/ProjectAiSettingsCopy";
import { PROJECT_AI_DAILY_USAGE_ROUTE } from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/useProjectAiDailyLimits";
import Project from "../../../Models/DatabaseModels/Project";
import { DEFAULT_AI_RUN_TIME_LIMIT_IN_MINUTES } from "../../../Types/AI/AIAgentRunLimits";
import {
  PROJECT_AI_RUN_LIMIT_COLUMNS,
  PROJECT_AI_RUN_LIMIT_UPDATE_PERMISSIONS,
  ProjectAiRunLimitColumn,
} from "../../../Types/AI/ProjectAiRunLimits";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { escapeRegExp } from "../../../Utils/RegExpEscape";
import { MORE_SETTINGS_SECTION_TITLE } from "../../../UI/Components/FoldedSection/FoldedSectionTitles";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import { Translator } from "../../../UI/Utils/TranslateTemplate";
import User from "../../../UI/Utils/User";
import { PROJECT_ID, goTo } from "./SideMenuHarness";
import {
  listedNames,
  setChips,
} from "../../UI/Components/FoldedSection/FoldedSectionQueries";

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

/*
 * Project Settings → AI → AI Features → More settings → Limits per run, the
 * one place a project caps its AI runs (issue #6440: "Can we remove all of
 * the artificial limits by default, customers can add them if they need
 * it"), rendered for real with the network and the permission snapshot
 * stubbed.
 *
 * Nothing is set by default: the card says each cap is "No limit" and the
 * time limit is the default 120 minutes, and the folded header shows no
 * chip. A limit set is a chip. The card edits the four limits on one page,
 * writes their columns alone, refuses what the server would, and is locked,
 * saying who may change it, for everyone but a project owner or someone who
 * manages billing - who decide what a run may cost. Its place on the page
 * is where a run a limit stopped links to.
 */

const WAIT_TIMEOUT: number = 20000;

const BASE_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.ProjectUser,
];

const MODEL_CALLS_TITLE: string = "Model Calls per Run";
const TOOL_CALLS_TITLE: string = "Tool Calls per Run";
const TOKENS_TITLE: string = "Tokens per Run";
const TIME_TITLE: string = "Time Limit per Run (Minutes)";

// The project as the server holds it: what getItem reads, a save writes.
let stored: Record<string, unknown> = {};

let createOrUpdateSpy: ReturnType<typeof jest.spyOn>;

function grant(permissions: Array<Permission>): void {
  jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
  jest.spyOn(PermissionUtil, "getAllPermissions").mockReturnValue(permissions);
  jest.spyOn(PermissionUtil, "getGlobalPermissions").mockReturnValue(null);
  jest.spyOn(PermissionUtil, "getProjectPermissions").mockReturnValue({
    projectId: new ObjectID(PROJECT_ID),
    userId: ObjectID.generate(),
    permissions: permissions.map((permission: Permission) => {
      return {
        permission: permission,
        labelIds: [],
        _type: "UserPermission",
      };
    }),
    _type: "UserTenantAccessPermission",
  } as unknown as ReturnType<typeof PermissionUtil.getProjectPermissions>);
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  PermissionGate.clearPermissionPropsCache();
  grant([...BASE_PERMISSIONS, Permission.ProjectOwner]);

  stored = { _id: PROJECT_ID, enableAi: true };

  jest
    .spyOn(ModelAPI, "getItem")
    .mockImplementation(async (): Promise<Project> => {
      return Object.assign(new Project(), stored);
    });
  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation(async (): Promise<ListResult<Project>> => {
      return { data: [], count: 0, skip: 0, limit: 10 };
    });
  jest
    .spyOn(ModelAPI, "count")
    .mockImplementation(async (): Promise<number> => {
      return 0;
    });
  jest
    .spyOn(ModelAPI, "updateById")
    .mockImplementation(async (data: unknown): Promise<never> => {
      Object.assign(stored, (data as { data: Record<string, unknown> }).data);
      return {} as never;
    });
  createOrUpdateSpy = jest
    .spyOn(ModelAPI, "createOrUpdate")
    .mockImplementation(async (data: unknown): Promise<never> => {
      const posted: Record<string, unknown> = (data as { model: Project })
        .model as unknown as Record<string, unknown>;

      for (const column of PROJECT_AI_RUN_LIMIT_COLUMNS) {
        if (column in posted) {
          stored[column] = posted[column] === "" ? null : posted[column];
        }
      }

      return { data: {} } as never;
    });
  // The provider notice and the daily usage line both ask over POST.
  jest
    .spyOn(API, "post")
    .mockImplementation(async (request: unknown): Promise<never> => {
      const url: string = String((request as { url: unknown }).url);

      if (url.endsWith(PROJECT_AI_DAILY_USAGE_ROUTE)) {
        return new HTTPErrorResponse(
          403,
          { message: "Not for this test." },
          {},
        ) as unknown as never;
      }

      return new HTTPResponse<JSONObject>(
        200,
        {
          isAIEnabledForProject: true,
          defaultProviderId: "9d9d9d9d-0000-4000-8000-000000000001",
          providers: [],
        },
        {},
      ) as unknown as never;
    });
});

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard"),
  currentProject: null,
  hasPaymentMethod: true,
};

function openAiFeaturesPage(): void {
  const path: string = `/dashboard/${PROJECT_ID}/settings/ai-features`;
  goTo(path);

  const page: ReactElement = (
    <MemoryRouter initialEntries={[path]}>
      <AIFeatures {...PAGE_PROPS} />
    </MemoryRouter>
  );

  render(page);
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
}

function moreSettingsHeader(): HTMLElement {
  return screen.getByRole("button", { name: MORE_SETTINGS_SECTION_TITLE });
}

function section(): HTMLElement {
  return screen.getByTestId(PROJECT_AI_ADVANCED_SECTION_TEST_ID);
}

async function openRunLimitsCard(): Promise<HTMLElement> {
  fireEvent.click(moreSettingsHeader());

  return (
    await screen.findByText(
      ProjectAiRunLimitsCopy.cardTitle,
      { selector: "h2, h3, h4, span, div" },
      { timeout: WAIT_TIMEOUT },
    )
  ).closest('[data-testid="card"]') as HTMLElement;
}

// A detail row's value, by its title, as ModelDetail renders it.
function detailValue(card: HTMLElement, title: string): string {
  const row: HTMLElement | null =
    within(card)
      .getByText(title, { selector: "label > span" })
      .closest("div.space-y-1")?.parentElement || null;

  return (row?.textContent || "").replace(title, "").trim();
}

// The edit dialog's two steps, as the step list draws them.
const CALLS_STEP_TITLE: string = "Calls and Tokens";
const TIME_STEP_TITLE: string = "Time Limit";

async function openEditDialog(card: HTMLElement): Promise<HTMLElement> {
  fireEvent.click(within(card).getByText("Edit"));

  const dialog: HTMLElement = await screen.findByRole(
    "dialog",
    {},
    { timeout: WAIT_TIMEOUT },
  );

  await waitFor(
    () => {
      expect(dialog.querySelectorAll("input").length).toBeGreaterThan(0);
    },
    { timeout: WAIT_TIMEOUT },
  );

  /*
   * BasicForm opens its first step in an effect: until then it draws every
   * field and no step list. Wait for the list, then for its first step.
   */
  await within(dialog).findByRole(
    "navigation",
    { name: "Progress" },
    { timeout: WAIT_TIMEOUT },
  );
  await waitFor(
    () => {
      expect(activeStep(dialog)).toBe(CALLS_STEP_TITLE);
    },
    { timeout: WAIT_TIMEOUT },
  );

  return dialog;
}

function progress(dialog: HTMLElement): HTMLElement {
  return within(dialog).getByRole("navigation", { name: "Progress" });
}

function stepTitles(dialog: HTMLElement): Array<string> {
  return within(progress(dialog))
    .getAllByRole("listitem")
    .map((item: HTMLElement): string => {
      return item.textContent || "";
    });
}

function activeStep(dialog: HTMLElement): string {
  return (
    progress(dialog).querySelector('[aria-current="step"]')?.textContent || ""
  );
}

// The plain Next: it checks the step on screen, then walks on.
async function next(dialog: HTMLElement): Promise<void> {
  await act(async (): Promise<void> => {
    fireEvent.click(within(dialog).getByTestId("modal-footer-next-button"));
  });
}

// Walks on to the time limit, the last step, where Save Changes is.
async function goToTimeStep(dialog: HTMLElement): Promise<void> {
  await next(dialog);
  await waitFor(
    () => {
      expect(activeStep(dialog)).toBe(TIME_STEP_TITLE);
    },
    { timeout: WAIT_TIMEOUT },
  );
}

function inputFor(dialog: HTMLElement, title: string): HTMLInputElement {
  return within(dialog).getByLabelText(
    new RegExp(escapeRegExp(title)),
  ) as HTMLInputElement;
}

function queryInputFor(
  dialog: HTMLElement,
  title: string,
): HTMLInputElement | null {
  return within(dialog).queryByLabelText(
    new RegExp(escapeRegExp(title)),
  ) as HTMLInputElement | null;
}

function postedColumns(): Array<string> {
  const posted: Record<string, unknown> = (
    createOrUpdateSpy.mock.calls[0]![0] as { model: Project }
  ).model as unknown as Record<string, unknown>;
  const model: Project = new Project();

  return Object.keys(posted).filter((key: string): boolean => {
    return (
      key !== "_id" && model.isTableColumn(key) && posted[key] !== undefined
    );
  });
}

function posted(column: string): unknown {
  return (
    (createOrUpdateSpy.mock.calls[0]![0] as { model: Project })
      .model as unknown as Record<string, unknown>
  )[column];
}

describe("Limits per run in More settings", () => {
  test("is named in the folded header between Daily limits and Fix approvals", async () => {
    openAiFeaturesPage();

    await screen.findByTestId(
      ENABLE_AI_SWITCH_TEST_ID,
      {},
      { timeout: WAIT_TIMEOUT },
    );

    expect(moreSettingsHeader()).toHaveAttribute("aria-expanded", "false");
    expect(listedNames(moreSettingsHeader())).toEqual([
      "Daily limits",
      "Limits per run",
      "Fix approvals",
    ]);

    // Opened, its line says the section holds limits per run too.
    fireEvent.click(moreSettingsHeader());
    await waitFor(
      () => {
        expect(section()).toHaveTextContent(
          ProjectAiDailyLimitsCopy.sectionDescription,
        );
      },
      { timeout: WAIT_TIMEOUT },
    );
    expect(ProjectAiDailyLimitsCopy.sectionDescription).toContain(
      "each day and in each run",
    );
  });

  test("with nothing set - every project, since none was stored before - it is no chip", async () => {
    openAiFeaturesPage();

    await openRunLimitsCard();
    fireEvent.click(moreSettingsHeader());
    await flush();

    expect(setChips(moreSettingsHeader())).toEqual([]);
  });

  test.each(
    PROJECT_AI_RUN_LIMIT_COLUMNS.map((column: string): Array<string> => {
      return [column];
    }),
  )("%s set is a chip", async (column: string) => {
    stored = { ...stored, [column]: column === "aiRunMaxTokens" ? 5000 : 30 };

    openAiFeaturesPage();
    await openRunLimitsCard();
    fireEvent.click(moreSettingsHeader());

    await waitFor(
      () => {
        expect(setChips(moreSettingsHeader())).toEqual(["Limits per run"]);
      },
      { timeout: WAIT_TIMEOUT },
    );
  });
});

describe("the Limits per run card", () => {
  test("says what a run is held to with nothing set: no cap, and the default time limit", async () => {
    openAiFeaturesPage();

    const card: HTMLElement = await openRunLimitsCard();

    expect(card).toHaveTextContent(ProjectAiRunLimitsCopy.cardDescription);
    expect(card).toHaveAttribute("id", PROJECT_AI_RUN_LIMITS_CARD_KEY);

    await waitFor(
      () => {
        expect(detailValue(card, MODEL_CALLS_TITLE)).toBe("No limit");
      },
      { timeout: WAIT_TIMEOUT },
    );
    expect(detailValue(card, TOOL_CALLS_TITLE)).toBe("No limit");
    expect(detailValue(card, TOKENS_TITLE)).toBe("No limit");
    expect(detailValue(card, TIME_TITLE)).toBe("120 minutes (the default)");
    expect(card).not.toHaveTextContent(/budget/i);
  });

  test("shows the limits a project set", async () => {
    stored = {
      ...stored,
      aiRunMaxModelCalls: 60,
      aiRunMaxToolCalls: 250,
      aiRunTimeLimitInMinutes: 45,
    };

    openAiFeaturesPage();
    const card: HTMLElement = await openRunLimitsCard();

    await waitFor(
      () => {
        expect(detailValue(card, MODEL_CALLS_TITLE)).toBe("60");
      },
      { timeout: WAIT_TIMEOUT },
    );
    expect(detailValue(card, TOOL_CALLS_TITLE)).toBe("250");
    expect(detailValue(card, TOKENS_TITLE)).toBe("No limit");
    expect(detailValue(card, TIME_TITLE)).toBe("45");
  });

  /*
   * Four fields walk steps, as every form of more than three does
   * (LongFormStepsGuard): what a run may use, then how long it may take.
   * Save Changes is on the last step only, after a plain Next.
   */
  test("edits the four limits in two steps, calls and tokens then the time limit, each saying what empty means", async () => {
    openAiFeaturesPage();

    const dialog: HTMLElement = await openEditDialog(await openRunLimitsCard());

    expect(dialog).toHaveTextContent("Limits per run");
    expect(stepTitles(dialog)).toEqual([CALLS_STEP_TITLE, TIME_STEP_TITLE]);

    // The first step: the three caps, none set, and no Save yet.
    for (const title of [MODEL_CALLS_TITLE, TOOL_CALLS_TITLE, TOKENS_TITLE]) {
      expect(inputFor(dialog, title)).toHaveAttribute(
        "placeholder",
        "No limit",
      );
    }
    expect(queryInputFor(dialog, TIME_TITLE)).toBeNull();
    expect(dialog).toHaveTextContent(
      "The most tool calls one run may make: each query, command or lookup is one. Leave empty for no limit.",
    );
    expect(
      within(dialog).queryByTestId("modal-footer-submit-button"),
    ).toBeNull();
    expect(
      within(dialog).getByTestId("modal-footer-next-button"),
    ).toHaveTextContent("Next");

    // The last step: the time limit alone, its default named, and Save.
    await goToTimeStep(dialog);

    expect(inputFor(dialog, TIME_TITLE)).toHaveAttribute(
      "placeholder",
      "120 minutes (the default)",
    );
    for (const title of [MODEL_CALLS_TITLE, TOOL_CALLS_TITLE, TOKENS_TITLE]) {
      expect(queryInputFor(dialog, title)).toBeNull();
    }
    expect(dialog).toHaveTextContent(
      "Leave empty for the default, 120 minutes. An incident or alert investigation time limit, where one is set, comes first.",
    );
    expect(
      within(dialog).getByTestId("modal-footer-submit-button"),
    ).toBeInTheDocument();
    expect(within(dialog).queryByTestId("modal-footer-next-button")).toBeNull();
  });

  test("the steps are the copy's, and every field is on one of them, in the card's order", () => {
    expect(
      PROJECT_AI_RUN_LIMITS_FORM_STEPS.map(
        (step: ProjectAiRunLimitsFormStep): string => {
          return step.title;
        },
      ),
    ).toEqual([CALLS_STEP_TITLE, TIME_STEP_TITLE]);

    const stepIds: Array<string> = PROJECT_AI_RUN_LIMITS_FORM_STEPS.map(
      (step: ProjectAiRunLimitsFormStep): string => {
        return step.id;
      },
    );

    expect(
      PROJECT_AI_RUN_LIMIT_FIELDS.map(
        (field: ProjectAiRunLimitField): [string, string] => {
          return [field.title, field.stepId];
        },
      ),
    ).toEqual([
      [MODEL_CALLS_TITLE, stepIds[0]],
      [TOOL_CALLS_TITLE, stepIds[0]],
      [TOKENS_TITLE, stepIds[0]],
      [TIME_TITLE, stepIds[1]],
    ]);
  });

  test("saving a tool-call cap writes that column alone, and the header shows it", async () => {
    openAiFeaturesPage();

    const dialog: HTMLElement = await openEditDialog(await openRunLimitsCard());

    fireEvent.change(inputFor(dialog, TOOL_CALLS_TITLE), {
      target: { value: "300" },
    });
    await goToTimeStep(dialog);
    fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));

    await waitFor(
      () => {
        expect(createOrUpdateSpy).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_TIMEOUT },
    );

    expect(postedColumns()).toEqual(["aiRunMaxToolCalls"]);
    expect(posted("aiRunMaxToolCalls")).toBe(300);
    // Nothing else rides along: not Enable AI, not a daily limit.
    expect(posted("enableAi")).toBeUndefined();
    expect(posted("aiDailyTokenLimit")).toBeUndefined();

    fireEvent.click(moreSettingsHeader());
    await waitFor(
      () => {
        expect(setChips(moreSettingsHeader())).toEqual(["Limits per run"]);
      },
      { timeout: WAIT_TIMEOUT },
    );
  });

  test("saving the time limit and a token cap together writes both", async () => {
    openAiFeaturesPage();

    const dialog: HTMLElement = await openEditDialog(await openRunLimitsCard());

    fireEvent.change(inputFor(dialog, TOKENS_TITLE), {
      target: { value: "500000" },
    });
    await goToTimeStep(dialog);
    fireEvent.change(inputFor(dialog, TIME_TITLE), {
      target: { value: "30" },
    });
    fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));

    await waitFor(
      () => {
        expect(createOrUpdateSpy).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_TIMEOUT },
    );

    expect([...postedColumns()].sort()).toEqual([
      "aiRunMaxTokens",
      "aiRunTimeLimitInMinutes",
    ]);
    expect(posted("aiRunTimeLimitInMinutes")).toBe(30);
    expect(posted("aiRunMaxTokens")).toBe(500000);
  });

  test.each([
    [
      TOOL_CALLS_TITLE,
      "0",
      "Tool Calls per Run must be a whole number from 1 to 100,000. Leave it empty for no limit.",
    ],
    [
      TOOL_CALLS_TITLE,
      "2.5",
      "Tool Calls per Run must be a whole number from 1 to 100,000. Leave it empty for no limit.",
    ],
    [
      MODEL_CALLS_TITLE,
      "100001",
      "Model Calls per Run must be a whole number from 1 to 100,000. Leave it empty for no limit.",
    ],
    [
      TOKENS_TITLE,
      "999",
      "Tokens per Run must be a whole number from 1,000 to 2,000,000,000. Leave it empty for no limit.",
    ],
    [
      TIME_TITLE,
      "0",
      "Time Limit per Run (Minutes) must be a whole number from 1 to 1,440. Leave it empty for the default.",
    ],
    [
      TIME_TITLE,
      "1441",
      "Time Limit per Run (Minutes) must be a whole number from 1 to 1,440. Leave it empty for the default.",
    ],
  ])(
    "%s refuses %s before anything is sent",
    async (title: string, value: string, message: string) => {
      openAiFeaturesPage();

      const dialog: HTMLElement = await openEditDialog(
        await openRunLimitsCard(),
      );

      if (title === TIME_TITLE) {
        // The time limit is on the last step, checked by Save Changes.
        await goToTimeStep(dialog);
        fireEvent.change(inputFor(dialog, title), { target: { value } });
        fireEvent.click(
          within(dialog).getByTestId("modal-footer-submit-button"),
        );
      } else {
        // A cap is on the first step, checked by Next before it walks on.
        fireEvent.change(inputFor(dialog, title), { target: { value } });
        await next(dialog);
      }

      expect(
        await within(dialog).findByText(message, {}, { timeout: WAIT_TIMEOUT }),
      ).toBeInTheDocument();
      expect(activeStep(dialog)).toBe(
        title === TIME_TITLE ? TIME_STEP_TITLE : CALLS_STEP_TITLE,
      );
      await flush();
      expect(createOrUpdateSpy).not.toHaveBeenCalled();
    },
  );

  /*
   * The step list opens the last step without Next, as every edit dialog's
   * does: Save Changes still checks the first step, and opens it on the
   * cap that is wrong.
   */
  test("Save Changes checks the first step too, and opens it on a wrong cap", async () => {
    openAiFeaturesPage();

    const dialog: HTMLElement = await openEditDialog(await openRunLimitsCard());

    fireEvent.change(inputFor(dialog, MODEL_CALLS_TITLE), {
      target: { value: "0" },
    });

    const timeStep: HTMLElement = within(progress(dialog))
      .getAllByRole("listitem")
      .find((item: HTMLElement): boolean => {
        return item.textContent === TIME_STEP_TITLE;
      })!;

    await act(async (): Promise<void> => {
      fireEvent.click(timeStep);
    });
    await waitFor(
      () => {
        expect(activeStep(dialog)).toBe(TIME_STEP_TITLE);
      },
      { timeout: WAIT_TIMEOUT },
    );

    fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));

    expect(
      await within(dialog).findByText(
        "Model Calls per Run must be a whole number from 1 to 100,000. Leave it empty for no limit.",
        {},
        { timeout: WAIT_TIMEOUT },
      ),
    ).toBeInTheDocument();
    expect(activeStep(dialog)).toBe(CALLS_STEP_TITLE);
    await flush();
    expect(createOrUpdateSpy).not.toHaveBeenCalled();
  });
});

/*
 * The limits take what the daily limits and Enable AI take - a project
 * owner, or someone who manages billing. Everyone else reads them, and gets
 * a locked Edit saying who may.
 */
describe("who may change the limits per run", () => {
  test("the columns take what the daily limits take", () => {
    expect([...PROJECT_AI_RUN_LIMIT_UPDATE_PERMISSIONS].sort()).toEqual(
      [Permission.ProjectOwner, Permission.ManageProjectBilling].sort(),
    );
  });

  test.each([[Permission.ProjectOwner], [Permission.ManageProjectBilling]])(
    "%s may",
    async (permission: Permission) => {
      grant([...BASE_PERMISSIONS, permission]);

      openAiFeaturesPage();
      const card: HTMLElement = await openRunLimitsCard();

      await waitFor(
        () => {
          expect(
            within(card).getByText("Edit").closest("button"),
          ).not.toBeDisabled();
        },
        { timeout: WAIT_TIMEOUT },
      );
    },
  );

  test.each([
    [Permission.ProjectAdmin],
    [Permission.EditProject],
    [Permission.Viewer],
  ])("%s sees the limits, with Edit locked", async (permission: Permission) => {
    grant([...BASE_PERMISSIONS, permission]);
    stored = { ...stored, aiRunMaxToolCalls: 250 };

    openAiFeaturesPage();
    const card: HTMLElement = await openRunLimitsCard();

    await waitFor(
      () => {
        expect(detailValue(card, TOOL_CALLS_TITLE)).toBe("250");
      },
      { timeout: WAIT_TIMEOUT },
    );

    const edit: HTMLElement = within(card)
      .getByText("Edit")
      .closest("button") as HTMLElement;

    expect(edit).toBeDisabled();
    fireEvent.click(edit);
    expect(screen.queryByRole("dialog")).toBeNull();
  });
});

describe("the card's copy", () => {
  const translator: Translator = {
    translateText: (text: string): string => {
      return text;
    },
    translateTemplate: (
      template: string,
      values: Record<string, unknown>,
    ): string => {
      return template.replace(/\{\{(\w+)\}\}/g, (_: string, key: string) => {
        const value: unknown = values[key];
        return typeof value === "object" && value !== null
          ? String((value as { term?: string; text?: string }).term ?? "")
          : String(value);
      });
    },
    formatNumber: (value: number): string => {
      return value.toLocaleString("en-US");
    },
  } as unknown as Translator;

  test("the fields are the four columns, in the card's order", () => {
    expect(
      PROJECT_AI_RUN_LIMIT_FIELDS.map((field: ProjectAiRunLimitField) => {
        return field.column;
      }),
    ).toEqual([...PROJECT_AI_RUN_LIMIT_COLUMNS]);
  });

  test("the default time limit it names is the one runs have", () => {
    expect(ProjectAiRunLimitsCopy.defaultTimeLimitPlaceholder).toBe(
      `${DEFAULT_AI_RUN_TIME_LIMIT_IN_MINUTES} minutes (the default)`,
    );
    const time: ProjectAiRunLimitField = PROJECT_AI_RUN_LIMIT_FIELDS[3]!;
    expect(time.description).toContain(
      `Leave empty for the default, ${DEFAULT_AI_RUN_TIME_LIMIT_IN_MINUTES} minutes.`,
    );
    expect(ProjectAiRunLimitsCopy.cardDescription).toContain(
      `With nothing set, a run makes as many calls as its work needs, for up to ${DEFAULT_AI_RUN_TIME_LIMIT_IN_MINUTES} minutes.`,
    );

    // No other number of minutes is named anywhere on the card.
    const minutes: Array<string> = [
      ProjectAiRunLimitsCopy.cardDescription,
      ProjectAiRunLimitsCopy.defaultTimeLimitPlaceholder,
      ...PROJECT_AI_RUN_LIMIT_FIELDS.map((field: ProjectAiRunLimitField) => {
        return field.description;
      }),
    ].flatMap((text: string): Array<string> => {
      return text.match(/\d+(?= minutes)/g) || [];
    });
    expect(minutes.length).toBe(3);
    expect(new Set(minutes)).toEqual(
      new Set([String(DEFAULT_AI_RUN_TIME_LIMIT_IN_MINUTES)]),
    );
  });

  test("no word of it speaks of a budget", () => {
    const words: Array<string> = [
      ProjectAiRunLimitsCopy.cardTitle,
      ProjectAiRunLimitsCopy.cardDescription,
      ProjectAiRunLimitsCopy.defaultTimeLimitPlaceholder,
      ProjectAiRunLimitsCopy.timeLimitFieldError,
      ProjectAiDailyLimitsCopy.sectionDescription,
      ...PROJECT_AI_RUN_LIMIT_FIELDS.flatMap(
        (field: ProjectAiRunLimitField): Array<string> => {
          return [field.title, field.description, field.placeholder];
        },
      ),
    ];

    for (const word of words) {
      expect(word).not.toMatch(/budget/i);
    }
  });

  test("empty is always allowed: no cap, or the default time", () => {
    for (const column of PROJECT_AI_RUN_LIMIT_COLUMNS) {
      for (const value of [null, undefined, "", "   "]) {
        expect(
          getProjectAiRunLimitFieldError({
            column,
            value,
            fieldTitle: "Limit",
            translator,
          }),
        ).toBeNull();
      }
    }
  });

  test("a whole number within the bounds, typed or not, is allowed", () => {
    const allowed: Record<ProjectAiRunLimitColumn, Array<unknown>> = {
      aiRunMaxModelCalls: [1, "40", 100_000],
      aiRunMaxToolCalls: [1, " 250 ", 100_000],
      aiRunMaxTokens: [1000, "2000000", 2_000_000_000],
      aiRunTimeLimitInMinutes: [1, "120", 1440],
    };

    for (const column of PROJECT_AI_RUN_LIMIT_COLUMNS) {
      for (const value of allowed[column]) {
        expect(
          getProjectAiRunLimitFieldError({
            column,
            value,
            fieldTitle: "Limit",
            translator,
          }),
        ).toBeNull();
      }
    }
  });

  test("the folded item is the card, set once any limit is", () => {
    expect(getProjectAiRunLimitsFoldedItem(null)).toEqual(
      expect.objectContaining({
        key: PROJECT_AI_RUN_LIMITS_CARD_KEY,
        title: "Limits per run",
        isSet: false,
      }),
    );
    expect(
      getProjectAiRunLimitsFoldedItem({
        maxModelCalls: null,
        maxToolCalls: null,
        maxTokens: null,
        timeLimitInMinutes: null,
      }).isSet,
    ).toBe(false);
    expect(
      getProjectAiRunLimitsFoldedItem({
        maxModelCalls: null,
        maxToolCalls: null,
        maxTokens: null,
        timeLimitInMinutes: 30,
      }).isSet,
    ).toBe(true);
  });
});
