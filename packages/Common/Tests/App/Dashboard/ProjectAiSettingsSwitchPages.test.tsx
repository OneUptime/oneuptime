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
  RenderResult,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React, { ReactElement } from "react";
import { MemoryRouter } from "react-router-dom";
import AIFeatures from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/AIFeatures";
import AlertAISettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Alerts/Settings/AlertAISettings";
import AIInsightsSettings from "../../../../App/FeatureSet/Dashboard/src/Pages/AIInsights/Settings";
import IncidentAISettings from "../../../../App/FeatureSet/Dashboard/src/Pages/Incidents/Settings/IncidentAISettings";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import {
  AI_INSIGHTS_SWITCHES,
  AI_INSIGHTS_SWITCHES_TEST_ID,
  AI_LANE_ADVANCED_SECTION_TEST_ID,
  AI_LANE_PAGE_COPY,
  AI_LANE_SWITCHES,
  AI_LANE_SWITCHES_TEST_ID,
  AiLane,
  ENABLE_AI_NOTICE_SWITCH_TEST_ID,
  ENABLE_AI_SWITCH_TEST_ID,
  EnableAiCopy,
  getProjectAiSwitchTestId,
  PROJECT_AI_NOTICE_CONTEXT_COPY,
  PROJECT_AI_OFF_NOTICE_TEST_ID,
  PROJECT_AI_OFF_SENTENCE_TEST_ID,
  PROJECT_AI_PROVIDER_NOTICE_TEST_ID,
  ProjectAiNoticeContext,
  ProjectAiNoticeCopy,
  ProjectAiSwitchDefinition,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/ProjectAiSettingsCopy";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import Project from "../../../Models/DatabaseModels/Project";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { ADVANCED_FORM_SECTION_TITLE } from "../../../UI/Components/Forms/Utils/AdvancedFormSection";
import { announceModelSwitchSaved } from "../../../UI/Components/ModelSwitch/ModelSwitchEvents";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import User from "../../../UI/Utils/User";
import { PROJECT_ID, goTo, routeFor } from "./SideMenuHarness";

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
 * The project's AI settings pages, rendered for real with the network and
 * the permission snapshot stubbed: Incidents → Settings → AI, Alerts →
 * Settings → AI, AI → Insights → Settings and Project Settings → AI
 * Features.
 *
 * Every AI behaviour on them is a switch that saves the moment it is
 * flipped - no Update button, no wizard - locked, with the permission it
 * needs, for anyone whose save the server would refuse. What narrows or
 * caps the work is folded under Advanced, whose folded line says what the
 * defaults do. Two notices say what is out of the ordinary, and only then:
 * Enable AI is off (with its switch), or there is no LLM provider OneUptime
 * AI can use.
 */

const WAIT_TIMEOUT: number = 20000;

const BASE_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.ProjectUser,
];

// The project as the server holds it: what getItem reads, updateById writes.
let stored: Record<string, unknown> = {};

// What POST /ai-chat/providers answers, or why it fails.
let providersAnswer: JSONObject | Error = {};

// A project read fails with this, when set.
let projectReadError: Error | null = null;

let updateByIdSpy: ReturnType<typeof jest.spyOn>;
let createOrUpdateSpy: ReturnType<typeof jest.spyOn>;
let providersSpy: ReturnType<typeof jest.spyOn>;

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

// A project that never touched a setting: AI on, the behaviours as given.
function projectWith(values: Record<string, unknown>): Record<string, unknown> {
  return {
    _id: PROJECT_ID,
    enableAi: true,
    enableAutomaticIncidentInvestigation: true,
    enableAutomaticPostmortemDraft: true,
    enableAutomaticIncidentCodeFixes: true,
    enableIncidentInstrumentationFixTasks: true,
    enableAutomaticAlertInvestigation: true,
    enableAutomaticAlertCodeFixes: true,
    enableAlertInstrumentationFixTasks: true,
    enableAiInsights: true,
    enableInsightFixTasks: true,
    autoArchiveNonActionableExceptions: true,
    ...values,
  };
}

const USABLE_PROVIDER: JSONObject = {
  isAIEnabledForProject: true,
  defaultProviderId: "9d9d9d9d-0000-4000-8000-000000000001",
  providers: [
    {
      id: "9d9d9d9d-0000-4000-8000-000000000001",
      name: "OneUptime AI",
      isGlobal: true,
      isDefault: false,
    },
  ],
};

const NO_PROVIDER: JSONObject = {
  isAIEnabledForProject: true,
  defaultProviderId: null,
  providers: [],
};

const NO_DEFAULT_PROVIDER: JSONObject = {
  isAIEnabledForProject: true,
  defaultProviderId: null,
  providers: [
    {
      id: "9d9d9d9d-0000-4000-8000-000000000002",
      name: "Our OpenAI",
      isGlobal: false,
      isDefault: false,
    },
  ],
};

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  PermissionGate.clearPermissionPropsCache();
  grant([...BASE_PERMISSIONS, Permission.ProjectOwner]);

  stored = projectWith({});
  providersAnswer = USABLE_PROVIDER;
  projectReadError = null;

  jest
    .spyOn(ModelAPI, "getItem")
    .mockImplementation(async (): Promise<Project> => {
      if (projectReadError) {
        throw projectReadError;
      }

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
  updateByIdSpy = jest
    .spyOn(ModelAPI, "updateById")
    .mockImplementation(async (data: unknown): Promise<never> => {
      Object.assign(stored, (data as { data: Record<string, unknown> }).data);
      return {} as never;
    });
  createOrUpdateSpy = jest
    .spyOn(ModelAPI, "createOrUpdate")
    .mockImplementation(async (): Promise<never> => {
      return { data: {} } as never;
    });
  providersSpy = jest
    .spyOn(API, "post")
    .mockImplementation(async (): Promise<never> => {
      if (providersAnswer instanceof Error) {
        throw providersAnswer;
      }

      return new HTTPResponse<JSONObject>(
        200,
        providersAnswer,
        {},
      ) as unknown as never;
    });
});

afterEach(() => {
  cleanup();
  redrawPage = null;
  jest.restoreAllMocks();
});

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route("/dashboard"),
  currentProject: null,
  hasPaymentMethod: true,
};

// Draws the open page again, as it is: see runPendingEffects.
let redrawPage: (() => void) | null = null;

function openPage(element: ReactElement, path: string): void {
  goTo(path);

  const page: ReactElement = (
    <MemoryRouter initialEntries={[path]}>{element}</MemoryRouter>
  );
  const view: RenderResult = render(page);

  redrawPage = (): void => {
    view.rerender(page);
  };
}

/*
 * Runs the effects React still owes the page. A part drawn when a read
 * resolved (outside act) - the notice's switch, a card's rows - runs its
 * effects on React's own schedule, and findBy can find it before they have
 * run: a switch that has not yet subscribed to saves made elsewhere misses
 * one announced now. Drawing the page again inside act makes React run
 * every pending effect first, so a test that announces a save after this
 * is heard by every switch on the page.
 */
async function runPendingEffects(): Promise<void> {
  await act(async () => {
    redrawPage?.();
  });
}

function openIncidentPage(): void {
  openPage(
    <IncidentAISettings {...PAGE_PROPS} />,
    `/dashboard/${PROJECT_ID}/incidents/settings/ai`,
  );
}

function openAlertPage(): void {
  openPage(
    <AlertAISettings {...PAGE_PROPS} />,
    `/dashboard/${PROJECT_ID}/alerts/settings/ai`,
  );
}

function openInsightsPage(): void {
  openPage(
    <AIInsightsSettings {...PAGE_PROPS} />,
    `/dashboard/${PROJECT_ID}/ai/insights/settings`,
  );
}

function openAiFeaturesPage(): void {
  openPage(
    <AIFeatures {...PAGE_PROPS} />,
    `/dashboard/${PROJECT_ID}/settings/ai-features`,
  );
}

async function flush(): Promise<void> {
  await act(async () => {
    for (let i: number = 0; i < 10; i++) {
      await Promise.resolve();
    }
  });
}

async function findSwitch(testId: string): Promise<HTMLElement> {
  return await screen.findByTestId(testId, {}, { timeout: WAIT_TIMEOUT });
}

async function press(control: HTMLElement): Promise<void> {
  fireEvent.click(control);
  await flush();
}

// Every update the page sent, as the columns and values it wrote.
function updates(): Array<Record<string, unknown>> {
  return updateByIdSpy.mock.calls.map(
    (call: Array<unknown>): Record<string, unknown> => {
      return (call[0] as { data: Record<string, unknown> }).data;
    },
  );
}

function titlesOf(
  switches: Array<ProjectAiSwitchDefinition<string>>,
): Array<string> {
  return switches.map(
    (definition: ProjectAiSwitchDefinition<string>): string => {
      return definition.title;
    },
  );
}

// A switch's accessible name: the label it is labelled by.
function nameOf(control: HTMLElement): string {
  const labelId: string | null = control.getAttribute("aria-labelledby");

  return (labelId && document.getElementById(labelId)?.textContent) || "";
}

function switchesIn(testId: string): Array<HTMLElement> {
  return within(screen.getByTestId(testId)).getAllByRole("switch");
}

function advancedHeader(): HTMLElement {
  return screen.getByRole("button", { name: ADVANCED_FORM_SECTION_TITLE });
}

// The Advanced cards: their titles, once the section is open.
async function cardOf(title: string): Promise<HTMLElement> {
  return (
    await screen.findByText(title, {}, { timeout: WAIT_TIMEOUT })
  ).closest('[data-testid="card"]') as HTMLElement;
}

// A detail row's value, by its title, as ModelDetail renders it.
function detailValue(title: string): string {
  const row: HTMLElement | null =
    screen
      .getByText(title, { selector: "label > span" })
      .closest("div.space-y-1")?.parentElement || null;

  return (row?.textContent || "").replace(title, "").trim();
}

describe("Incidents → Settings → AI", () => {
  test("every AI behaviour is a switch, in order, with what the project has", async () => {
    stored = projectWith({
      enableAutomaticPostmortemDraft: false,
      enableIncidentInstrumentationFixTasks: false,
    });

    openIncidentPage();
    await findSwitch(
      getProjectAiSwitchTestId("enableAutomaticIncidentInvestigation"),
    );

    const switches: Array<HTMLElement> = switchesIn(
      AI_LANE_SWITCHES_TEST_ID[AiLane.Incident],
    );

    expect(
      switches.map((control: HTMLElement): string => {
        return nameOf(control);
      }),
    ).toEqual(titlesOf(AI_LANE_SWITCHES[AiLane.Incident]));
    expect(titlesOf(AI_LANE_SWITCHES[AiLane.Incident])).toEqual([
      "Investigate new incidents",
      "Draft a postmortem when an incident resolves",
      "Open a fix pull request when an investigation finds a code change",
      "Open a pull request that adds missing telemetry",
    ]);
    expect(
      switches.map((control: HTMLElement): string | null => {
        return control.getAttribute("aria-checked");
      }),
    ).toEqual(["true", "false", "true", "false"]);

    expect(
      screen.getByText(AI_LANE_PAGE_COPY[AiLane.Incident].switchesCardTitle),
    ).toBeInTheDocument();
    // No Update button, no wizard: the switches are the settings.
    expect(screen.queryByText("Update")).toBeNull();
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("flipping a switch saves that column alone, at once, and says Saved", async () => {
    openIncidentPage();

    const postmortem: HTMLElement = await findSwitch(
      getProjectAiSwitchTestId("enableAutomaticPostmortemDraft"),
    );
    await press(postmortem);

    expect(updates()).toEqual([{ enableAutomaticPostmortemDraft: false }]);
    expect(
      (updateByIdSpy.mock.calls[0]![0] as { modelType: unknown }).modelType,
    ).toBe(Project);
    expect(
      String((updateByIdSpy.mock.calls[0]![0] as { id: unknown }).id),
    ).toBe(PROJECT_ID);
    expect(postmortem).toHaveAttribute("aria-checked", "false");
    expect(
      screen.getByTestId(
        `${getProjectAiSwitchTestId("enableAutomaticPostmortemDraft")}-status`,
      ),
    ).toHaveTextContent("Saved");
    expect(screen.queryByRole("dialog")).toBeNull();
  });

  test("a save the server refuses moves the switch back, with why", async () => {
    updateByIdSpy.mockImplementation(async (): Promise<never> => {
      throw new Error("You do not have permission to update this Project.");
    });

    openIncidentPage();

    const investigate: HTMLElement = await findSwitch(
      getProjectAiSwitchTestId("enableAutomaticIncidentInvestigation"),
    );
    await press(investigate);

    expect(investigate).toHaveAttribute("aria-checked", "true");
    expect(
      screen.getByTestId(
        `${getProjectAiSwitchTestId("enableAutomaticIncidentInvestigation")}-row`,
      ),
    ).toHaveTextContent("You do not have permission to update this Project.");
  });

  test("the fix pull request switches say what they need", async () => {
    openIncidentPage();
    await findSwitch(
      getProjectAiSwitchTestId("enableAutomaticIncidentCodeFixes"),
    );

    expect(
      screen.getByTestId(
        `${getProjectAiSwitchTestId("enableAutomaticIncidentCodeFixes")}-row`,
      ),
    ).toHaveTextContent(
      "Needs a repository connected through the GitHub App and a Runner that can fix code.",
    );
    expect(
      screen.getByTestId(
        `${getProjectAiSwitchTestId("enableIncidentInstrumentationFixTasks")}-row`,
      ),
    ).toHaveTextContent("Needs a repository connected through the GitHub App.");
  });

  test("with a provider to use, nothing says one is required", async () => {
    openIncidentPage();
    await findSwitch(
      getProjectAiSwitchTestId("enableAutomaticIncidentInvestigation"),
    );
    await flush();

    expect(document.body).not.toHaveTextContent(/Requires an LLM provider/);
    expect(screen.queryByTestId(PROJECT_AI_PROVIDER_NOTICE_TEST_ID)).toBeNull();
    expect(screen.queryByTestId(PROJECT_AI_OFF_NOTICE_TEST_ID)).toBeNull();
  });

  test("Advanced is folded, and once its cards have read, says what the defaults do", async () => {
    openIncidentPage();

    const section: HTMLElement = screen.getByTestId(
      AI_LANE_ADVANCED_SECTION_TEST_ID[AiLane.Incident],
    );

    expect(advancedHeader()).toHaveAttribute("aria-expanded", "false");

    await waitFor(
      () => {
        expect(
          within(section).getByTestId("collapsible-section-summary"),
        ).toHaveTextContent(
          "Every incident is investigated, whatever its severity, and nothing limits how much OneUptime AI does.",
        );
      },
      { timeout: WAIT_TIMEOUT },
    );
    expect(advancedHeader()).not.toHaveTextContent("Configured");
  });

  test.each([
    [
      "a minimum severity",
      {
        incidentInvestigationMinimumSeverity: {
          name: "Critical",
          color: "#ff0000",
        },
      },
    ],
    ["a cooldown", { incidentInvestigationDedupeWindowMinutes: 30 }],
    ["a concurrency cap", { incidentAiMaxConcurrentInvestigations: 3 }],
    ["a time limit", { incidentAiInvestigationTimeLimitInMinutes: 15 }],
    ["a daily token limit of 0", { incidentAiDailyAutonomousTokenLimit: 0 }],
    ["a daily fix limit", { incidentAiDailyFixTaskLimit: 12 }],
  ])(
    "with %s set, folded Advanced says Configured and what is in it",
    async (_name: string, values: Record<string, unknown>) => {
      stored = projectWith(values);

      openIncidentPage();

      await waitFor(
        () => {
          expect(advancedHeader()).toHaveTextContent("Configured");
        },
        { timeout: WAIT_TIMEOUT },
      );
      expect(
        screen.getByTestId("collapsible-section-summary"),
      ).toHaveTextContent(
        AI_LANE_PAGE_COPY[AiLane.Incident].advancedDescription,
      );
      expect(advancedHeader()).not.toHaveTextContent(
        "nothing limits how much OneUptime AI does",
      );
    },
  );

  test("an alert limit does not make the incident page say Configured", async () => {
    stored = projectWith({
      alertAiDailyAutonomousTokenLimit: 0,
      alertInvestigationDedupeWindowMinutes: 30,
    });

    openIncidentPage();

    await waitFor(
      () => {
        expect(
          screen.getByTestId("collapsible-section-summary"),
        ).toHaveTextContent(
          AI_LANE_PAGE_COPY[AiLane.Incident].advancedDefaultsSummary,
        );
      },
      { timeout: WAIT_TIMEOUT },
    );
    expect(advancedHeader()).not.toHaveTextContent("Configured");
  });

  test("Advanced holds three cards, each with its own Edit, showing no limit when none is set", async () => {
    openIncidentPage();
    fireEvent.click(advancedHeader());

    for (const title of [
      "Which incidents are investigated",
      "Investigation limits",
      "Daily limits",
    ]) {
      const card: HTMLElement = await cardOf(title);

      expect([title, within(card).getAllByText("Edit").length]).toEqual([
        title,
        1,
      ]);
    }

    await waitFor(
      () => {
        expect(detailValue("Minimum Severity To Investigate")).toBe(
          "Every severity",
        );
      },
      { timeout: WAIT_TIMEOUT },
    );
    expect(detailValue("Re-investigation Cooldown (Minutes)")).toBe(
      "No cooldown",
    );
    expect(detailValue("Max Concurrent Incident Investigations")).toBe(
      "No limit",
    );
    expect(detailValue("Incident Investigation Time Limit (Minutes)")).toBe(
      "No time limit",
    );
    expect(detailValue("Daily Incident AI Token Limit")).toBe("No limit");
    expect(detailValue("Daily Incident AI Fix Task Limit")).toBe("No limit");

    // The old wording of the built-in defaults never comes back.
    expect(document.body).not.toHaveTextContent(/Default \(/);
    expect(document.body).not.toHaveTextContent(/top two severity tiers/i);
  });

  test.each([
    [
      "Which incidents are investigated",
      [
        "incidentInvestigationMinimumSeverity",
        "incidentInvestigationDedupeWindowMinutes",
      ],
    ],
    [
      "Investigation limits",
      [
        "incidentAiMaxConcurrentInvestigations",
        "incidentAiInvestigationTimeLimitInMinutes",
      ],
    ],
    [
      "Daily limits",
      ["incidentAiDailyAutonomousTokenLimit", "incidentAiDailyFixTaskLimit"],
    ],
  ])(
    "%s edits on one page, with no steps, and saves its own columns and no limit",
    async (title: string, columns: Array<string>) => {
      openIncidentPage();
      fireEvent.click(advancedHeader());

      const card: HTMLElement = await cardOf(title);
      fireEvent.click(within(card).getByText("Edit"));

      const dialog: HTMLElement = await screen.findByRole(
        "dialog",
        {},
        { timeout: WAIT_TIMEOUT },
      );
      expect(dialog).toHaveTextContent(title);
      expect(
        within(dialog).queryByTestId("modal-footer-next-button"),
      ).toBeNull();

      // The form has read the project: its fields are drawn.
      await waitFor(
        () => {
          expect(dialog.querySelectorAll("input").length).toBeGreaterThan(0);
        },
        { timeout: WAIT_TIMEOUT },
      );
      fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));

      await waitFor(
        () => {
          expect(createOrUpdateSpy).toHaveBeenCalledTimes(1);
        },
        { timeout: WAIT_TIMEOUT },
      );

      const posted: Record<string, unknown> = (
        createOrUpdateSpy.mock.calls[0]![0] as { model: Project }
      ).model as unknown as Record<string, unknown>;
      const model: Project = new Project();
      const written: Array<string> = Object.keys(posted).filter(
        (key: string): boolean => {
          return (
            key !== "_id" &&
            model.isTableColumn(key) &&
            posted[key] !== undefined
          );
        },
      );

      for (const column of written) {
        expect([title, column, columns.includes(column)]).toEqual([
          title,
          column,
          true,
        ]);
      }

      // A save that touched no limit writes none.
      for (const column of columns) {
        expect([column, typeof posted[column] === "number"]).toEqual([
          column,
          false,
        ]);
      }

      // No AI switch rides along with a limit.
      for (const definition of AI_LANE_SWITCHES[AiLane.Incident]) {
        expect(posted[definition.column]).toBeUndefined();
      }
    },
  );

  test("a Project Admin may flip every switch and edit every limit", async () => {
    grant([...BASE_PERMISSIONS, Permission.ProjectAdmin]);

    openIncidentPage();
    await findSwitch(
      getProjectAiSwitchTestId("enableAutomaticIncidentInvestigation"),
    );

    for (const control of switchesIn(
      AI_LANE_SWITCHES_TEST_ID[AiLane.Incident],
    )) {
      expect(control).not.toHaveAttribute("aria-disabled");
    }

    fireEvent.click(advancedHeader());

    for (const title of [
      "Which incidents are investigated",
      "Investigation limits",
      "Daily limits",
    ]) {
      const card: HTMLElement = await cardOf(title);
      await waitFor(
        () => {
          expect(
            within(card).getByText("Edit").closest("button"),
          ).not.toBeDisabled();
        },
        { timeout: WAIT_TIMEOUT },
      );
    }
  });

  /*
   * The Project table lets Edit Project and Manage Billing update a project,
   * but none of these columns does: the switches and the Edit buttons are
   * locked, and say which permissions they need.
   */
  test.each([[Permission.EditProject], [Permission.ManageProjectBilling]])(
    "%s sees every switch locked, and every Edit locked, with why",
    async (permission: Permission) => {
      grant([...BASE_PERMISSIONS, permission]);

      openIncidentPage();
      await findSwitch(
        getProjectAiSwitchTestId("enableAutomaticIncidentInvestigation"),
      );

      for (const control of switchesIn(
        AI_LANE_SWITCHES_TEST_ID[AiLane.Incident],
      )) {
        expect(control).toHaveAttribute("aria-disabled", "true");
      }

      const row: HTMLElement = screen.getByTestId(
        `${getProjectAiSwitchTestId("enableAutomaticIncidentInvestigation")}-row`,
      );
      expect(row).toHaveTextContent("Project Owner");
      expect(row).toHaveTextContent("Project Admin");

      await press(
        screen.getByTestId(
          getProjectAiSwitchTestId("enableAutomaticIncidentInvestigation"),
        ),
      );
      expect(updateByIdSpy).not.toHaveBeenCalled();

      fireEvent.click(advancedHeader());
      const card: HTMLElement = await cardOf("Daily limits");
      const edit: HTMLElement = (
        await within(card).findByText("Edit", {}, { timeout: WAIT_TIMEOUT })
      ).closest("button") as HTMLElement;

      expect(edit).toBeDisabled();
      fireEvent.click(edit);
      expect(screen.queryByRole("dialog")).toBeNull();
    },
  );

  test("a Viewer reads every switch, locked", async () => {
    grant([...BASE_PERMISSIONS, Permission.Viewer]);
    stored = projectWith({ enableAutomaticPostmortemDraft: false });

    openIncidentPage();
    await findSwitch(
      getProjectAiSwitchTestId("enableAutomaticPostmortemDraft"),
    );

    const postmortem: HTMLElement = screen.getByTestId(
      getProjectAiSwitchTestId("enableAutomaticPostmortemDraft"),
    );
    expect(postmortem).toHaveAttribute("aria-checked", "false");
    expect(postmortem).toHaveAttribute("aria-disabled", "true");
  });
});

describe("Alerts → Settings → AI", () => {
  test("its switches are the alert behaviours, with no postmortem", async () => {
    stored = projectWith({ enableAutomaticAlertCodeFixes: false });

    openAlertPage();
    await findSwitch(
      getProjectAiSwitchTestId("enableAutomaticAlertInvestigation"),
    );

    const switches: Array<HTMLElement> = switchesIn(
      AI_LANE_SWITCHES_TEST_ID[AiLane.Alert],
    );

    expect(
      switches.map((control: HTMLElement): string => {
        return nameOf(control);
      }),
    ).toEqual([
      "Investigate new alerts",
      "Open a fix pull request when an investigation finds a code change",
      "Open a pull request that adds missing telemetry",
    ]);
    expect(
      switches.map((control: HTMLElement): string | null => {
        return control.getAttribute("aria-checked");
      }),
    ).toEqual(["true", "false", "true"]);
    expect(document.body).not.toHaveTextContent(/postmortem/i);
  });

  test("flipping a switch saves the alert column alone", async () => {
    openAlertPage();

    await press(
      await findSwitch(
        getProjectAiSwitchTestId("enableAutomaticAlertInvestigation"),
      ),
    );

    expect(updates()).toEqual([{ enableAutomaticAlertInvestigation: false }]);
  });

  test("its Advanced says what the alert defaults do", async () => {
    openAlertPage();

    await waitFor(
      () => {
        expect(
          within(
            screen.getByTestId(AI_LANE_ADVANCED_SECTION_TEST_ID[AiLane.Alert]),
          ).getByTestId("collapsible-section-summary"),
        ).toHaveTextContent(
          "Every alert is investigated, whatever its severity, and nothing limits how much OneUptime AI does.",
        );
      },
      { timeout: WAIT_TIMEOUT },
    );
  });

  test("an alert limit makes it say Configured", async () => {
    stored = projectWith({ alertAiMaxConcurrentInvestigations: 2 });

    openAlertPage();

    await waitFor(
      () => {
        expect(advancedHeader()).toHaveTextContent("Configured");
      },
      { timeout: WAIT_TIMEOUT },
    );
  });

  test("its Advanced cards show the alert limits", async () => {
    openAlertPage();
    fireEvent.click(advancedHeader());

    await cardOf("Which alerts are investigated");
    await waitFor(
      () => {
        expect(detailValue("Max Concurrent Alert Investigations")).toBe(
          "No limit",
        );
      },
      { timeout: WAIT_TIMEOUT },
    );
    expect(detailValue("Alert Investigation Time Limit (Minutes)")).toBe(
      "No time limit",
    );
    expect(detailValue("Daily Alert AI Token Limit")).toBe("No limit");
    expect(detailValue("Daily Alert AI Fix Task Limit")).toBe("No limit");
  });
});

describe("AI → Insights → Settings", () => {
  test("its three switches save on flip", async () => {
    stored = projectWith({ autoArchiveNonActionableExceptions: false });

    openInsightsPage();
    await findSwitch(getProjectAiSwitchTestId("enableAiInsights"));

    const switches: Array<HTMLElement> = switchesIn(
      AI_INSIGHTS_SWITCHES_TEST_ID,
    );

    expect(
      switches.map((control: HTMLElement): string => {
        return nameOf(control);
      }),
    ).toEqual(titlesOf(AI_INSIGHTS_SWITCHES));
    expect(
      switches.map((control: HTMLElement): string | null => {
        return control.getAttribute("aria-checked");
      }),
    ).toEqual(["true", "true", "false"]);

    await press(
      screen.getByTestId(
        getProjectAiSwitchTestId("autoArchiveNonActionableExceptions"),
      ),
    );

    expect(updates()).toEqual([{ autoArchiveNonActionableExceptions: true }]);
    expect(screen.queryByText("Update")).toBeNull();
  });

  test("it speaks plainly", async () => {
    openInsightsPage();
    await findSwitch(getProjectAiSwitchTestId("enableAiInsights"));

    for (const jargon of [
      /deterministic/i,
      /statistical sensors/i,
      /quiet insights/i,
      /proactive telemetry watch/i,
    ]) {
      expect([
        String(jargon),
        jargon.test(document.body.textContent || ""),
      ]).toEqual([String(jargon), false]);
    }
  });
});

describe("Project Settings → AI Features", () => {
  test("Enable AI is the switch itself, with the project's value", async () => {
    openAiFeaturesPage();

    const enableAi: HTMLElement = await findSwitch(ENABLE_AI_SWITCH_TEST_ID);

    expect(enableAi).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("switch", { name: "Enable AI" })).toBe(enableAi);
    expect(screen.getByText(EnableAiCopy.cardTitle)).toBeInTheDocument();
    expect(screen.getByText(EnableAiCopy.cardDescription)).toBeInTheDocument();
    expect(
      screen.getByTestId(`${ENABLE_AI_SWITCH_TEST_ID}-row`),
    ).toHaveTextContent(EnableAiCopy.switchDescription);
    expect(screen.queryByText("Edit AI Features")).toBeNull();
  });

  test("turning AI off asks first, as a danger, and cancelling saves nothing", async () => {
    openAiFeaturesPage();

    const enableAi: HTMLElement = await findSwitch(ENABLE_AI_SWITCH_TEST_ID);
    await press(enableAi);

    const dialog: HTMLElement = screen.getByRole("dialog");
    expect(dialog).toHaveTextContent(EnableAiCopy.turnOffConfirmTitle);
    expect(dialog).toHaveTextContent(EnableAiCopy.turnOffConfirmDescription);
    expect(updateByIdSpy).not.toHaveBeenCalled();

    fireEvent.click(within(dialog).getByRole("button", { name: "Cancel" }));
    await flush();

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(enableAi).toHaveAttribute("aria-checked", "true");
    expect(updateByIdSpy).not.toHaveBeenCalled();
  });

  test("confirmed, it saves Enable AI off and nothing else", async () => {
    openAiFeaturesPage();

    await press(await findSwitch(ENABLE_AI_SWITCH_TEST_ID));
    fireEvent.click(
      within(screen.getByRole("dialog")).getByRole("button", {
        name: EnableAiCopy.turnOffConfirmButton,
      }),
    );
    await flush();

    expect(updates()).toEqual([{ enableAi: false }]);
    expect(screen.getByTestId(ENABLE_AI_SWITCH_TEST_ID)).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  test("turning AI on saves at once", async () => {
    stored = projectWith({ enableAi: false });

    openAiFeaturesPage();

    await press(await findSwitch(ENABLE_AI_SWITCH_TEST_ID));

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(updates()).toEqual([{ enableAi: true }]);
  });

  /*
   * Enable AI takes Project Owner or Manage Billing. The Project table
   * lets a Project Admin and Edit Project in too, and the server refuses
   * their save.
   */
  test.each([
    [Permission.ProjectAdmin],
    [Permission.EditProject],
    [Permission.Viewer],
  ])(
    "%s sees it locked, naming who may change it",
    async (permission: Permission) => {
      grant([...BASE_PERMISSIONS, permission]);

      openAiFeaturesPage();

      const enableAi: HTMLElement = await findSwitch(ENABLE_AI_SWITCH_TEST_ID);
      expect(enableAi).toHaveAttribute("aria-disabled", "true");

      const row: HTMLElement = screen.getByTestId(
        `${ENABLE_AI_SWITCH_TEST_ID}-row`,
      );
      expect(row).toHaveTextContent("Project Owner");
      expect(row).toHaveTextContent("Manage Billing");

      await press(enableAi);
      expect(screen.queryByRole("dialog")).toBeNull();
      expect(updateByIdSpy).not.toHaveBeenCalled();
    },
  );

  test("someone who manages billing may turn it off", async () => {
    grant([...BASE_PERMISSIONS, Permission.ManageProjectBilling]);

    openAiFeaturesPage();

    const enableAi: HTMLElement = await findSwitch(ENABLE_AI_SWITCH_TEST_ID);
    expect(enableAi).not.toHaveAttribute("aria-disabled");

    await press(enableAi);
    expect(screen.getByRole("dialog")).toBeInTheDocument();
  });

  test("it never says AI is off: the switch is right there", async () => {
    stored = projectWith({ enableAi: false });

    openAiFeaturesPage();
    await findSwitch(ENABLE_AI_SWITCH_TEST_ID);
    await flush();

    expect(screen.queryByTestId(PROJECT_AI_OFF_NOTICE_TEST_ID)).toBeNull();
  });

  test("with AI on and no provider to use, it says so under the switch", async () => {
    providersAnswer = NO_PROVIDER;

    openAiFeaturesPage();

    const notice: HTMLElement = await screen.findByTestId(
      PROJECT_AI_PROVIDER_NOTICE_TEST_ID,
      {},
      { timeout: WAIT_TIMEOUT },
    );
    expect(notice).toHaveTextContent(ProjectAiNoticeCopy.providerMissing);
    expect(notice).toHaveTextContent(
      PROJECT_AI_NOTICE_CONTEXT_COPY[ProjectAiNoticeContext.AiFeatures]
        .providerConsequence,
    );

    // Under the card, so turning AI on never moves the switch.
    const enableAi: HTMLElement = screen.getByTestId(ENABLE_AI_SWITCH_TEST_ID);
    expect(
      enableAi.compareDocumentPosition(notice) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});

describe("the notice when Enable AI is off", () => {
  test("a project owner gets Enable AI's own switch, and saying why nothing runs", async () => {
    stored = projectWith({ enableAi: false });

    openIncidentPage();

    const notice: HTMLElement = await screen.findByTestId(
      PROJECT_AI_OFF_NOTICE_TEST_ID,
      {},
      { timeout: WAIT_TIMEOUT },
    );
    const enableAi: HTMLElement = within(notice).getByTestId(
      ENABLE_AI_NOTICE_SWITCH_TEST_ID,
    );

    expect(enableAi).toHaveAttribute("aria-checked", "false");
    expect(notice).toHaveTextContent(
      "OneUptime AI is off for this project, so nothing on this page runs.",
    );
    expect(within(notice).getByRole("switch", { name: "Enable AI" })).toBe(
      enableAi,
    );

    // The page's own switches still say what they are set to.
    expect(
      await findSwitch(
        getProjectAiSwitchTestId("enableAutomaticIncidentInvestigation"),
      ),
    ).toHaveAttribute("aria-checked", "true");
  });

  test("turning AI on from it saves at once, and it stays, saying AI is on", async () => {
    stored = projectWith({ enableAi: false });

    openIncidentPage();

    const enableAi: HTMLElement = await findSwitch(
      ENABLE_AI_NOTICE_SWITCH_TEST_ID,
    );
    await press(enableAi);

    expect(screen.queryByRole("dialog")).toBeNull();
    expect(updates()).toEqual([{ enableAi: true }]);

    const notice: HTMLElement = screen.getByTestId(
      PROJECT_AI_OFF_NOTICE_TEST_ID,
    );
    expect(notice).toHaveTextContent(ProjectAiNoticeCopy.aiOnDescription);
    expect(
      screen.getByTestId(`${ENABLE_AI_NOTICE_SWITCH_TEST_ID}-status`),
    ).toHaveTextContent("Saved");
  });

  test("turning it off again from there asks first", async () => {
    stored = projectWith({ enableAi: false });

    openIncidentPage();

    const enableAi: HTMLElement = await findSwitch(
      ENABLE_AI_NOTICE_SWITCH_TEST_ID,
    );
    await press(enableAi);
    await press(enableAi);

    expect(screen.getByRole("dialog")).toHaveTextContent(
      EnableAiCopy.turnOffConfirmTitle,
    );
    expect(updates()).toEqual([{ enableAi: true }]);
  });

  test("someone who may not change it reads one sentence: what is off, and who can", async () => {
    grant([...BASE_PERMISSIONS, Permission.ProjectAdmin]);
    stored = projectWith({ enableAi: false });

    openIncidentPage();

    const sentence: HTMLElement = await screen.findByTestId(
      PROJECT_AI_OFF_SENTENCE_TEST_ID,
      {},
      { timeout: WAIT_TIMEOUT },
    );

    expect(sentence).toHaveTextContent(
      "OneUptime AI is off for this project, so nothing on this page runs.",
    );
    expect(sentence).toHaveTextContent(EnableAiCopy.whoCanTurnOn);
    expect(screen.queryByTestId(ENABLE_AI_NOTICE_SWITCH_TEST_ID)).toBeNull();
  });

  test("AI Insights says what still happens with AI off", async () => {
    stored = projectWith({ enableAi: false });

    openInsightsPage();

    expect(
      await screen.findByTestId(
        PROJECT_AI_OFF_NOTICE_TEST_ID,
        {},
        { timeout: WAIT_TIMEOUT },
      ),
    ).toHaveTextContent(
      "Insights are still found, but none are triaged and no fix pull requests are opened.",
    );
  });

  test("the alerts page has it too", async () => {
    stored = projectWith({ enableAi: false });

    openAlertPage();

    expect(
      await screen.findByTestId(
        ENABLE_AI_NOTICE_SWITCH_TEST_ID,
        {},
        { timeout: WAIT_TIMEOUT },
      ),
    ).toHaveAttribute("aria-checked", "false");
  });

  test("with AI on there is no notice at all", async () => {
    openIncidentPage();
    await findSwitch(
      getProjectAiSwitchTestId("enableAutomaticIncidentInvestigation"),
    );
    await flush();

    expect(screen.queryByTestId(PROJECT_AI_OFF_NOTICE_TEST_ID)).toBeNull();
    expect(screen.queryByTestId(ENABLE_AI_NOTICE_SWITCH_TEST_ID)).toBeNull();
  });

  /*
   * Once its switch has moved, for whatever reason, the notice stays until
   * the page is left: it never disappears from under the reader, and it
   * always says what Enable AI is now.
   */
  test("AI turned on elsewhere on the screen moves its switch, and it says AI is on", async () => {
    stored = projectWith({ enableAi: false });

    openIncidentPage();
    const enableAi: HTMLElement = await findSwitch(
      ENABLE_AI_NOTICE_SWITCH_TEST_ID,
    );
    // The switch listens from an effect, which runs after it is drawn.
    await runPendingEffects();

    act(() => {
      announceModelSwitchSaved({
        modelType: Project,
        modelId: new ObjectID(PROJECT_ID),
        column: "enableAi",
        value: true,
        source: "somewhere-else",
      });
    });

    expect(enableAi).toHaveAttribute("aria-checked", "true");
    expect(screen.getByTestId(PROJECT_AI_OFF_NOTICE_TEST_ID)).toHaveTextContent(
      ProjectAiNoticeCopy.aiOnDescription,
    );
    expect(updateByIdSpy).not.toHaveBeenCalled();
  });

  test("AI turned off elsewhere on the screen brings the notice up", async () => {
    openIncidentPage();
    await findSwitch(
      getProjectAiSwitchTestId("enableAutomaticIncidentInvestigation"),
    );
    await runPendingEffects();
    expect(screen.queryByTestId(PROJECT_AI_OFF_NOTICE_TEST_ID)).toBeNull();

    act(() => {
      announceModelSwitchSaved({
        modelType: Project,
        modelId: new ObjectID(PROJECT_ID),
        column: "enableAi",
        value: false,
        source: "somewhere-else",
      });
    });

    expect(screen.getByTestId(ENABLE_AI_NOTICE_SWITCH_TEST_ID)).toHaveAttribute(
      "aria-checked",
      "false",
    );
  });

  test("a project that cannot be read says nothing", async () => {
    projectReadError = new Error("Network error");

    openIncidentPage();
    await flush();

    expect(screen.queryByTestId(PROJECT_AI_OFF_NOTICE_TEST_ID)).toBeNull();
  });
});

describe("the notice when there is no LLM provider to use", () => {
  test("none at all: it says so, what that stops, and links to the providers", async () => {
    providersAnswer = NO_PROVIDER;

    openIncidentPage();

    const notice: HTMLElement = await screen.findByTestId(
      PROJECT_AI_PROVIDER_NOTICE_TEST_ID,
      {},
      { timeout: WAIT_TIMEOUT },
    );

    expect(notice).toHaveTextContent(
      "This project has no LLM provider for OneUptime AI to use.",
    );
    expect(notice).toHaveTextContent(
      "Until it has one, incidents are not investigated and no postmortems are drafted.",
    );

    const link: HTMLElement = within(notice)
      .getByText(ProjectAiNoticeCopy.addProviderLink)
      .closest("a") as HTMLElement;
    expect(link).toHaveAttribute(
      "href",
      routeFor(PageMap.SETTINGS_AI_LLM_PROVIDERS),
    );
  });

  test("providers but none the default: it says that, and links to choosing one", async () => {
    providersAnswer = NO_DEFAULT_PROVIDER;

    openAlertPage();

    const notice: HTMLElement = await screen.findByTestId(
      PROJECT_AI_PROVIDER_NOTICE_TEST_ID,
      {},
      { timeout: WAIT_TIMEOUT },
    );

    expect(notice).toHaveTextContent(ProjectAiNoticeCopy.providerNoDefault);
    expect(notice).toHaveTextContent(
      "Until it has one, alerts are not investigated.",
    );
    expect(
      within(notice).getByText(ProjectAiNoticeCopy.chooseDefaultProviderLink),
    ).toBeInTheDocument();
  });

  test("on AI Insights it says what still happens without one", async () => {
    providersAnswer = NO_PROVIDER;

    openInsightsPage();

    expect(
      await screen.findByTestId(
        PROJECT_AI_PROVIDER_NOTICE_TEST_ID,
        {},
        { timeout: WAIT_TIMEOUT },
      ),
    ).toHaveTextContent(
      "Until it has one, insights are still found, but none are triaged.",
    );
  });

  test("with AI off, only the AI notice shows; turned on, the provider one follows", async () => {
    stored = projectWith({ enableAi: false });
    providersAnswer = NO_PROVIDER;

    openIncidentPage();

    const enableAi: HTMLElement = await findSwitch(
      ENABLE_AI_NOTICE_SWITCH_TEST_ID,
    );
    await flush();
    expect(screen.queryByTestId(PROJECT_AI_PROVIDER_NOTICE_TEST_ID)).toBeNull();

    await press(enableAi);

    expect(
      screen.getByTestId(PROJECT_AI_PROVIDER_NOTICE_TEST_ID),
    ).toBeInTheDocument();
    // The switch that was pressed stays where it was, above it.
    expect(
      enableAi.compareDocumentPosition(
        screen.getByTestId(PROJECT_AI_PROVIDER_NOTICE_TEST_ID),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });

  test("a global provider counts: nothing is said on OneUptime Cloud", async () => {
    providersAnswer = USABLE_PROVIDER;

    openIncidentPage();
    await findSwitch(
      getProjectAiSwitchTestId("enableAutomaticIncidentInvestigation"),
    );
    await flush();

    expect(providersSpy).toHaveBeenCalled();
    expect(screen.queryByTestId(PROJECT_AI_PROVIDER_NOTICE_TEST_ID)).toBeNull();
  });

  test("an answer that cannot be read says nothing", async () => {
    providersAnswer = new Error("Forbidden");

    openIncidentPage();
    await findSwitch(
      getProjectAiSwitchTestId("enableAutomaticIncidentInvestigation"),
    );
    await flush();

    expect(screen.queryByTestId(PROJECT_AI_PROVIDER_NOTICE_TEST_ID)).toBeNull();
  });

  test("it asks the providers endpoint the chat uses", async () => {
    openIncidentPage();
    await flush();

    expect(
      String((providersSpy.mock.calls[0]![0] as { url: unknown }).url),
    ).toMatch(/\/ai-chat\/providers$/);
  });
});
