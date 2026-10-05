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
  PROJECT_AI_ADVANCED_SECTION_TEST_ID,
  ProjectAiDailyLimitsCopy,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/ProjectAiSettingsCopy";
import { PROJECT_AI_DAILY_USAGE_ROUTE } from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/useProjectAiDailyLimits";
import Project from "../../../Models/DatabaseModels/Project";
import HTTPErrorResponse from "../../../Types/API/HTTPErrorResponse";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { MORE_SETTINGS_SECTION_TITLE } from "../../../UI/Components/FoldedSection/FoldedSectionTitles";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
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
 * Whether this install bills AI, pinned by the suite rather than read from
 * the environment (CI's test-setup writes BILLING_ENABLED=true; a bare jest
 * run leaves it unset). A getter, so each test chooses.
 */
let billingEnabledForTest: boolean = false;

jest.mock("../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../UI/Config",
  ) as Record<string, unknown>;

  const mocked: Record<string, unknown> = { ...actual };

  Object.defineProperty(mocked, "BILLING_ENABLED", {
    get: (): boolean => {
      return billingEnabledForTest;
    },
  });

  return mocked;
});

/*
 * Project Settings → AI Features → More settings, rendered for real with
 * the network and the permission snapshot stubbed: "Just like we have more
 * settings for the incident AI page ... daily token limit or daily spend
 * limit (if it is SaaS)."
 *
 * Folded, More settings names its one card, Daily limits - a chip once a
 * limit is set - and says in a sentence what applies and what AI used
 * today, or that a limit is reached and AI is paused until midnight UTC.
 * Open, the Daily limits card edits on one page: the token limit
 * everywhere, the spend limit only where AI is billed. It writes the limit
 * columns alone, refuses what the server would, and is locked, saying who
 * may change it, for everyone but a project owner or someone who manages
 * billing.
 */

const WAIT_TIMEOUT: number = 20000;

const BASE_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.ProjectUser,
];

const TOKEN_TITLE: string = "Daily AI Token Limit";
const SPEND_TITLE: string = "Daily AI Spend Limit (USD)";

const NOTHING_LIMITS: string =
  "Nothing limits how much OneUptime AI uses each day.";
const REACHED: string =
  "Today's limit is reached, so OneUptime AI is paused until midnight UTC.";

// The project as the server holds it: what getItem reads, a save writes.
let stored: Record<string, unknown> = {};

// What POST /ai/daily-usage answers, or why it fails.
let usageAnswer: JSONObject | Error = {};

let createOrUpdateSpy: ReturnType<typeof jest.spyOn>;
let postSpy: ReturnType<typeof jest.spyOn>;

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

function usage(
  usedTokensToday: number,
  spentTodayInUSDCents: number | null = null,
): JSONObject {
  return {
    usedTokensToday,
    spentTodayInUSDCents,
    tokenLimit: null,
    spendLimitInUSD: null,
    reachedLimit: null,
    dayStartedAt: "2026-10-05T00:00:00.000Z",
    resetsAt: "2026-10-06T00:00:00.000Z",
  };
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  PermissionGate.clearPermissionPropsCache();
  grant([...BASE_PERMISSIONS, Permission.ProjectOwner]);
  billingEnabledForTest = false;

  stored = { _id: PROJECT_ID, enableAi: true };
  usageAnswer = usage(45210);

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

      for (const column of ["aiDailyTokenLimit", "aiDailySpendLimitInUSD"]) {
        if (column in posted) {
          stored[column] = posted[column] === "" ? null : posted[column];
        }
      }

      return { data: {} } as never;
    });
  // The provider notice and the usage line both ask over POST.
  postSpy = jest
    .spyOn(API, "post")
    .mockImplementation(async (request: unknown): Promise<never> => {
      const url: string = String((request as { url: unknown }).url);

      if (url.endsWith(PROJECT_AI_DAILY_USAGE_ROUTE)) {
        if (usageAnswer instanceof Error) {
          return new HTTPErrorResponse(
            403,
            { message: usageAnswer.message },
            {},
          ) as unknown as never;
        }

        return new HTTPResponse<JSONObject>(
          200,
          usageAnswer,
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
  billingEnabledForTest = false;
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

async function expectSummary(text: string): Promise<void> {
  await waitFor(
    () => {
      expect(
        within(section()).getByTestId("collapsible-section-summary"),
      ).toHaveTextContent(text);
    },
    { timeout: WAIT_TIMEOUT },
  );
}

function summaryText(): string {
  return (
    within(section()).queryByTestId("collapsible-section-summary")
      ?.textContent || ""
  );
}

async function openDailyLimitsCard(): Promise<HTMLElement> {
  fireEvent.click(moreSettingsHeader());

  return (
    await screen.findByText(
      ProjectAiDailyLimitsCopy.cardTitle,
      { selector: "h2, h3, h4, span, div" },
      { timeout: WAIT_TIMEOUT },
    )
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

  return dialog;
}

function inputFor(dialog: HTMLElement, title: string): HTMLInputElement {
  return within(dialog).getByLabelText(
    new RegExp(title.replace(/[()]/g, "\\$&")),
  ) as HTMLInputElement;
}

function usageRequests(): Array<{ url: string; headers: unknown }> {
  return postSpy.mock.calls
    .map((call: Array<unknown>): { url: string; headers: unknown } => {
      const request: { url: unknown; headers?: unknown } = call[0] as {
        url: unknown;
        headers?: unknown;
      };
      return { url: String(request.url), headers: request.headers };
    })
    .filter((request: { url: string }): boolean => {
      return request.url.endsWith(PROJECT_AI_DAILY_USAGE_ROUTE);
    });
}

describe("More settings on Project Settings → AI Features", () => {
  test("is folded under Enable AI, and names its one card, Daily limits", async () => {
    openAiFeaturesPage();

    await screen.findByTestId(ENABLE_AI_SWITCH_TEST_ID, {}, { timeout: WAIT_TIMEOUT });

    expect(moreSettingsHeader()).toHaveAttribute("aria-expanded", "false");
    expect(listedNames(moreSettingsHeader())).toEqual(["Daily limits"]);

    // Enable AI stays first, the fold after it.
    expect(
      screen.getByTestId(ENABLE_AI_SWITCH_TEST_ID).compareDocumentPosition(
        section(),
      ) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
    // Enable AI is never inside the fold.
    expect(
      within(section()).queryByTestId(ENABLE_AI_SWITCH_TEST_ID),
    ).toBeNull();
  });

  test("with no limit, says nothing limits AI, and what it used today", async () => {
    openAiFeaturesPage();

    await expectSummary(`${NOTHING_LIMITS} Used today: 45,210 tokens.`);
    expect(setChips(moreSettingsHeader())).toEqual([]);
  });

  test("where AI is billed, today's spend is said too", async () => {
    billingEnabledForTest = true;
    usageAnswer = usage(45210, 320);

    openAiFeaturesPage();

    await expectSummary(
      `${NOTHING_LIMITS} Used today: 45,210 tokens and $3.20 of AI credits.`,
    );
  });

  test("a token limit is a chip, and the sentence says it", async () => {
    stored = { ...stored, aiDailyTokenLimit: 200000 };

    openAiFeaturesPage();

    await expectSummary(
      "At most 200,000 tokens a day. Used today: 45,210 tokens.",
    );
    expect(setChips(moreSettingsHeader())).toEqual(["Daily limits"]);
  });

  test("a limit of one token reads in the singular", async () => {
    stored = { ...stored, aiDailyTokenLimit: 1 };
    usageAnswer = usage(0);

    openAiFeaturesPage();

    await expectSummary("At most 1 token a day. Used today: 0 tokens.");
  });

  test("where AI is billed, a spend limit is said in dollars", async () => {
    billingEnabledForTest = true;
    stored = { ...stored, aiDailySpendLimitInUSD: 25 };
    usageAnswer = usage(45210, 320);

    openAiFeaturesPage();

    await expectSummary(
      "At most $25 of AI credits a day. Used today: 45,210 tokens and $3.20 of AI credits.",
    );
    expect(setChips(moreSettingsHeader())).toEqual(["Daily limits"]);
  });

  test("both limits read as one sentence", async () => {
    billingEnabledForTest = true;
    stored = {
      ...stored,
      aiDailyTokenLimit: 200000,
      aiDailySpendLimitInUSD: 25,
    };
    usageAnswer = usage(1000, 5);

    openAiFeaturesPage();

    await expectSummary(
      "At most 200,000 tokens and $25 of AI credits a day. Used today: 1,000 tokens and $0.05 of AI credits.",
    );
  });

  /*
   * Where AI is not billed nothing is spent: a stored spend limit (one the
   * server would refuse to save now) is neither said nor shown as set.
   */
  test("where AI is not billed, a stored spend limit is not spoken of", async () => {
    stored = { ...stored, aiDailySpendLimitInUSD: 25 };

    openAiFeaturesPage();

    await expectSummary(`${NOTHING_LIMITS} Used today: 45,210 tokens.`);
    expect(summaryText()).not.toContain("$");
    expect(setChips(moreSettingsHeader())).toEqual([]);
  });

  test("once a limit is reached, it says AI is paused until midnight UTC", async () => {
    stored = { ...stored, aiDailyTokenLimit: 1000 };
    usageAnswer = usage(1200);

    openAiFeaturesPage();

    await expectSummary(`At most 1,000 tokens a day. ${REACHED}`);
    expect(summaryText()).not.toContain("Used today");
  });

  test("a spend limit reached pauses billed AI the same way", async () => {
    billingEnabledForTest = true;
    stored = { ...stored, aiDailySpendLimitInUSD: 3 };
    usageAnswer = usage(10, 300);

    openAiFeaturesPage();

    await expectSummary(`At most $3 of AI credits a day. ${REACHED}`);
  });

  test("when today's usage cannot be read, it says only what applies", async () => {
    stored = { ...stored, aiDailyTokenLimit: 200000 };
    usageAnswer = new Error("You do not have permission to read this project's AI usage.");

    openAiFeaturesPage();

    await expectSummary("At most 200,000 tokens a day.");
    await flush();
    expect(summaryText()).toBe("At most 200,000 tokens a day.");
  });

  test("asks for today's usage once, from POST /ai/daily-usage, for this project", async () => {
    openAiFeaturesPage();

    await expectSummary(NOTHING_LIMITS);
    await flush();

    const requests: Array<{ url: string; headers: unknown }> = usageRequests();
    expect(requests).toHaveLength(1);
    expect(requests[0]!.url).toMatch(/\/ai\/daily-usage$/);
    expect(requests[0]!.headers).toEqual(ModelAPI.getCommonHeaders());
  });
});

describe("the Daily limits card", () => {
  test("shows no limit until one is set; only the token limit where AI is not billed", async () => {
    openAiFeaturesPage();

    const card: HTMLElement = await openDailyLimitsCard();
    expect(card).toHaveTextContent("Each day starts at midnight UTC.");

    await waitFor(
      () => {
        expect(detailValue(TOKEN_TITLE)).toBe("No limit");
      },
      { timeout: WAIT_TIMEOUT },
    );
    expect(within(card).queryByText(SPEND_TITLE)).toBeNull();
    expect(within(card).getAllByText("Edit")).toHaveLength(1);
  });

  test("where AI is billed it shows the spend limit too", async () => {
    billingEnabledForTest = true;
    stored = { ...stored, aiDailySpendLimitInUSD: 25 };

    openAiFeaturesPage();
    await openDailyLimitsCard();

    await waitFor(
      () => {
        expect(detailValue(SPEND_TITLE)).toBe("25");
      },
      { timeout: WAIT_TIMEOUT },
    );
    expect(detailValue(TOKEN_TITLE)).toBe("No limit");
  });

  test("edits on one page: the token field only, where AI is not billed", async () => {
    openAiFeaturesPage();

    const dialog: HTMLElement = await openEditDialog(
      await openDailyLimitsCard(),
    );

    expect(dialog).toHaveTextContent("Daily limits");
    expect(within(dialog).queryByTestId("modal-footer-next-button")).toBeNull();
    expect(inputFor(dialog, TOKEN_TITLE)).toBeInTheDocument();
    expect(within(dialog).queryByLabelText(/Daily AI Spend Limit/)).toBeNull();
    expect(inputFor(dialog, TOKEN_TITLE)).toHaveAttribute(
      "placeholder",
      "No limit",
    );
  });

  test("edits both limits where AI is billed", async () => {
    billingEnabledForTest = true;

    openAiFeaturesPage();

    const dialog: HTMLElement = await openEditDialog(
      await openDailyLimitsCard(),
    );

    expect(inputFor(dialog, TOKEN_TITLE)).toBeInTheDocument();
    expect(inputFor(dialog, SPEND_TITLE)).toBeInTheDocument();
  });

  test("saving a token limit writes that column alone, and the sentence follows at once", async () => {
    openAiFeaturesPage();

    const dialog: HTMLElement = await openEditDialog(
      await openDailyLimitsCard(),
    );

    fireEvent.change(inputFor(dialog, TOKEN_TITLE), {
      target: { value: "200000" },
    });
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
          key !== "_id" && model.isTableColumn(key) && posted[key] !== undefined
        );
      },
    );

    expect(written).toEqual(["aiDailyTokenLimit"]);
    expect(posted["aiDailyTokenLimit"]).toBe(200000);
    // Enable AI never rides along with a limit.
    expect(posted["enableAi"]).toBeUndefined();

    fireEvent.click(moreSettingsHeader());
    await expectSummary("At most 200,000 tokens a day.");
  });

  test.each([
    ["0", "a limit of 0: Enable AI turns AI off"],
    ["-5", "a negative number"],
    ["2.5", "a fraction"],
    ["3000000000", "more than the column holds"],
  ])(
    "refuses %s (%s) before anything is sent",
    async (value: string, _why: string) => {
      openAiFeaturesPage();

      const dialog: HTMLElement = await openEditDialog(
        await openDailyLimitsCard(),
      );

      fireEvent.change(inputFor(dialog, TOKEN_TITLE), {
        target: { value },
      });
      fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));

      expect(
        await within(dialog).findByText(
          "Daily AI Token Limit must be a whole number from 1 to 2,000,000,000. Leave it empty for no limit.",
          {},
          { timeout: WAIT_TIMEOUT },
        ),
      ).toBeInTheDocument();
      await flush();
      expect(createOrUpdateSpy).not.toHaveBeenCalled();
    },
  );

  test("where AI is billed, the spend limit holds whole dollars from $1 to $1,000,000", async () => {
    billingEnabledForTest = true;

    openAiFeaturesPage();

    const dialog: HTMLElement = await openEditDialog(
      await openDailyLimitsCard(),
    );

    fireEvent.change(inputFor(dialog, SPEND_TITLE), {
      target: { value: "0" },
    });
    fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));

    expect(
      await within(dialog).findByText(
        "Daily AI Spend Limit (USD) must be a whole number from 1 to 1,000,000. Leave it empty for no limit.",
        {},
        { timeout: WAIT_TIMEOUT },
      ),
    ).toBeInTheDocument();
    expect(createOrUpdateSpy).not.toHaveBeenCalled();

    fireEvent.change(inputFor(dialog, SPEND_TITLE), {
      target: { value: "25" },
    });
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
    expect(posted["aiDailySpendLimitInUSD"]).toBe(25);
  });
});

/*
 * The limits take what Enable AI takes - a project owner, or someone who
 * manages billing - which is narrower than the Project table's update list.
 * Everyone else reads them, and gets a locked Edit saying who may.
 */
describe("who may change the daily limits", () => {
  test.each([[Permission.ProjectOwner], [Permission.ManageProjectBilling]])(
    "%s may",
    async (permission: Permission) => {
      grant([...BASE_PERMISSIONS, permission]);

      openAiFeaturesPage();
      const card: HTMLElement = await openDailyLimitsCard();

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
  ])(
    "%s sees the limits, with Edit locked and saying who may",
    async (permission: Permission) => {
      grant([...BASE_PERMISSIONS, permission]);
      stored = { ...stored, aiDailyTokenLimit: 200000 };

      openAiFeaturesPage();

      // The folded sentence reads the same for everyone.
      await expectSummary("At most 200,000 tokens a day.");

      const card: HTMLElement = await openDailyLimitsCard();
      const edit: HTMLElement = (
        await within(card).findByText("Edit", {}, { timeout: WAIT_TIMEOUT })
      ).closest("button") as HTMLElement;

      expect(edit).toBeDisabled();
      fireEvent.click(edit);
      expect(screen.queryByRole("dialog")).toBeNull();
    },
  );
});
