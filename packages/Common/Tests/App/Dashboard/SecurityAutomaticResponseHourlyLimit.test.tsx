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
  configure,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import React from "react";
import { MemoryRouter } from "react-router-dom";

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

jest.mock(
  "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/AutomaticResponse/AutomaticResponseApi",
  () => {
    return {
      __esModule: true,
      readAutomaticResponseOverview: jest.fn(),
      setAutomaticResponseMode: jest.fn(),
      createOwnPolicy: jest.fn(),
      updateOwnPolicy: jest.fn(),
      deleteOwnPolicy: jest.fn(),
      readDetectionRuleChoices: jest.fn(),
    };
  },
);

import SecurityAutomaticResponsePage from "../../../../App/FeatureSet/Dashboard/src/Pages/SecurityEvents/AutomaticResponse";
import PageComponentProps from "../../../../App/FeatureSet/Dashboard/src/Pages/PageComponentProps";
import * as AutomaticResponseApi from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/AutomaticResponse/AutomaticResponseApi";
import {
  HOURLY_LIMIT_CARD_KEY,
  HOURLY_LIMIT_COLUMN,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/AutomaticResponse/AutomaticResponseHourlyLimitCard";
import {
  AUTOMATIC_RESPONSE_TEST_IDS,
  CHANGE_LIMIT,
  HOURLY_LIMIT_DESCRIPTION,
  HOURLY_LIMIT_FIELD_DESCRIPTION,
  HOURLY_LIMIT_FIELD_TITLE,
  HOURLY_LIMIT_TITLE,
  LIMIT_REACHED,
  LIMIT_REACHED_NOT_PAGED,
  MORE_SETTINGS_DESCRIPTION,
} from "../../../../App/FeatureSet/Dashboard/src/Components/SecurityEvents/AutomaticResponse/AutomaticResponseCopy";
import { getProjectColumnsUpdatePermissions } from "../../../../App/FeatureSet/Dashboard/src/Pages/Settings/ProjectColumnEditGate";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Project from "../../../Models/DatabaseModels/Project";
import HTTPResponse from "../../../Types/API/HTTPResponse";
import Route from "../../../Types/API/Route";
import ListResult from "../../../Types/BaseDatabase/ListResult";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import {
  SecurityAutomaticResponseOverviewData,
  SecurityAutomaticResponseOverviewPolicy,
} from "../../../Types/SecurityAutomaticResponse/SecurityAutomaticResponseOverview";
import {
  SECURITY_AUTOMATIC_RESPONSE_MAX_BLOCKS_PER_HOUR,
  SECURITY_AUTOMATIC_RESPONSE_MAX_BLOCKS_PER_HOUR_MAX,
  SECURITY_AUTOMATIC_RESPONSE_MAX_BLOCKS_PER_HOUR_MIN,
  SECURITY_AUTOMATIC_RESPONSE_MESSAGES,
  SecurityAutomaticResponseMode,
  SecurityAutomaticResponsePolicyKind,
  SecurityAutomaticResponseTrialState,
} from "../../../Types/SecurityAutomaticResponse/SecurityAutomaticResponsePolicy";
import {
  SecurityBlockAction,
  SecurityBlockDuration,
} from "../../../Types/SecurityBlocklist/SecurityBlock";
import API from "../../../UI/Utils/API/API";
import ModelAPI from "../../../UI/Utils/ModelAPI/ModelAPI";
import PermissionUtil from "../../../UI/Utils/Permission";
import PermissionGate from "../../../UI/Utils/PermissionGate";
import { getGlobalTranslator } from "../../../UI/Utils/TranslateTemplate";
import User from "../../../UI/Utils/User";
import { PROJECT_ID, goTo } from "./SideMenuHarness";
import {
  listedNames,
  setChips,
} from "../../UI/Components/FoldedSection/FoldedSectionQueries";

/*
 * THE HOURLY LIMIT OF AUTOMATIC BLOCKS, ON THE AUTOMATIC RESPONSE PAGE
 * (#10746). Rendered for real - the page, its More settings fold, the
 * Hourly Limit card and its form - with the page's read and the network
 * stubbed, and the reader's permissions as the server would hand them:
 *
 *   - More settings comes last, folded, naming Hourly Limit, with a chip of
 *     the project's own limit only while it is not the default;
 *   - a link that names the card after the page's "#" opens it there, and
 *     the notice's Change Limit is such a link (MoreSettingsFoldsGuard);
 *   - a Security Admin, a Project Owner or a Project Admin changes it, the
 *     form refusing what the server would - out of its range, or not a
 *     whole number - and the page reads itself again once it is saved;
 *     anyone else sees Edit locked;
 *   - the notice and the guardrails read the project's own limit, and the
 *     notice says the security owners were paged only once they were.
 */

configure({ asyncUtilTimeout: 15000 });

type MockedFn = ReturnType<typeof jest.fn>;

const api: { readAutomaticResponseOverview: MockedFn } =
  AutomaticResponseApi as unknown as { readAutomaticResponseOverview: MockedFn };

const PAGE_PATH: string = `/dashboard/${PROJECT_ID}/security-events/automatic-response`;

const PAGE_PROPS: PageComponentProps = {
  pageRoute: new Route(PAGE_PATH),
  currentProject: null,
  hasPaymentMethod: true,
};

const BASE_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.ProjectUser,
];

const SCANNERS_ID: string = "72222222-2222-4222-8222-222222222222";

// The project's hourly limit as the server holds it, and what was saved.
let stored: number;
let updates: Array<JSONObject>;

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

function scanners(
  values: Partial<SecurityAutomaticResponseOverviewPolicy> = {},
): SecurityAutomaticResponseOverviewPolicy {
  return {
    id: SCANNERS_ID,
    kind: SecurityAutomaticResponsePolicyKind.Scanners,
    name: "Scanners",
    description: "",
    mode: SecurityAutomaticResponseMode.On,
    blockAction: SecurityBlockAction.Challenge,
    duration: SecurityBlockDuration.OneHour,
    match: {
      mitreTechniques: ["T1595", "T1190"],
      detectionRuleIds: [],
      requiresThreatIntel: false,
      requiresEveryRequestTurnedAway: true,
    },
    trialStartedAt: null,
    trialEndsAt: null,
    trialFinishedAt: null,
    trialSkippedAt: null,
    turnedOnAt: null,
    turnedOnBy: null,
    trialState: SecurityAutomaticResponseTrialState.Skipped,
    trialDaysLeft: 0,
    trialSummary: null,
    timeToBlock: { count: 0, p50InSeconds: null, p95InSeconds: null, days: [] },
    lastWeek: { acted: 0, spared: 0 },
    rules: [],
    ...values,
  };
}

// The page's read: the hour's blocks of the project's own limit, as the server answers it.
function overview(
  values: Partial<SecurityAutomaticResponseOverviewData> = {},
): SecurityAutomaticResponseOverviewData {
  return {
    policies: [scanners()],
    destinations: [
      { name: "Cloudflare", provider: "Cloudflare", canChallenge: true },
    ],
    destinationsCannotTell: false,
    blocksThisHour: 0,
    maxBlocksPerHour: stored,
    pagedThisHour: false,
    ...values,
  };
}

function projectOf(): Project {
  const project: Project = new Project();
  project._id = PROJECT_ID;
  project.securityAutomaticResponseMaxBlocksPerHour = stored;
  return project;
}

beforeEach(() => {
  window.localStorage.clear();
  window.sessionStorage.clear();
  PermissionGate.clearPermissionPropsCache();
  grant([...BASE_PERMISSIONS, Permission.SecurityAdmin]);
  stored = SECURITY_AUTOMATIC_RESPONSE_MAX_BLOCKS_PER_HOUR;
  updates = [];

  api.readAutomaticResponseOverview.mockReset();
  api.readAutomaticResponseOverview.mockImplementation(async () => {
    return overview();
  });

  jest
    .spyOn(ModelAPI, "getItem")
    .mockImplementation(async (): Promise<BaseModel | null> => {
      return projectOf();
    });

  jest
    .spyOn(ModelAPI, "getList")
    .mockImplementation(async (): Promise<ListResult<BaseModel>> => {
      return { data: [], count: 0, skip: 0, limit: 10 };
    });

  // The edit form saves through createOrUpdate, handing it the project as edited.
  jest.spyOn(ModelAPI, "createOrUpdate").mockImplementation((async (args: {
    model: Project;
  }): Promise<never> => {
    const limit: unknown = (args.model as unknown as Record<string, unknown>)[
      HOURLY_LIMIT_COLUMN
    ];

    updates.push({ [HOURLY_LIMIT_COLUMN]: limit as number });

    if (typeof limit === "number") {
      stored = limit;
    }

    return { data: args.model } as never;
  }) as never);

  jest.spyOn(API, "get").mockImplementation(async (): Promise<never> => {
    return new HTTPResponse<JSONObject>(200, {}, {}) as unknown as never;
  });
  jest.spyOn(API, "post").mockImplementation(async (): Promise<never> => {
    return new HTTPResponse<JSONObject>(200, {}, {}) as unknown as never;
  });
});

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "#");
  jest.restoreAllMocks();
});

async function settle(): Promise<void> {
  await act(async (): Promise<void> => {
    for (let i: number = 0; i < 6; i++) {
      await new Promise<void>((resolve: () => void) => {
        setTimeout(resolve, 0);
      });
    }
  });
}

// The page opened at its address, and `#hash` after it when given.
async function renderPage(hash?: string): Promise<HTMLElement> {
  goTo(PAGE_PATH);

  if (hash) {
    window.history.replaceState(null, "", `#${hash}`);
  }

  render(
    <MemoryRouter initialEntries={[`${PAGE_PATH}${hash ? `#${hash}` : ""}`]}>
      <SecurityAutomaticResponsePage {...PAGE_PROPS} />
    </MemoryRouter>,
  );

  const fold: HTMLElement = await screen.findByTestId(
    AUTOMATIC_RESPONSE_TEST_IDS.moreSettings,
  );

  await settle();

  return fold;
}

function header(fold: HTMLElement): HTMLElement {
  return within(fold).getByTestId("folded-section-header");
}

function open(fold: HTMLElement): void {
  if (header(fold).getAttribute("aria-expanded") !== "true") {
    fireEvent.click(header(fold));
  }
}

function card(): HTMLElement {
  return screen.getByTestId(AUTOMATIC_RESPONSE_TEST_IDS.hourlyLimit);
}

function editButton(): HTMLButtonElement {
  return within(card())
    .getByText("Edit")
    .closest("button") as HTMLButtonElement;
}

async function openDialog(fold: HTMLElement): Promise<HTMLElement> {
  open(fold);
  await within(card()).findByText("Edit");
  fireEvent.click(editButton());

  return await screen.findByRole("dialog");
}

// The form loads the project before it draws the field.
async function typeLimit(dialog: HTMLElement, value: string): Promise<void> {
  const input: HTMLElement = await within(dialog).findByRole("spinbutton");

  fireEvent.change(input, { target: { value } });
  fireEvent.blur(input);
}

function submit(dialog: HTMLElement): void {
  fireEvent.click(within(dialog).getByTestId("modal-footer-submit-button"));
}

function isBefore(first: HTMLElement, second: HTMLElement): boolean {
  return Boolean(
    first.compareDocumentPosition(second) & Node.DOCUMENT_POSITION_FOLLOWING,
  );
}

// Words as the reader reads them, with plain spaces.
function plain(text: string | null | undefined): string {
  return (text || "").replace(/ /g, " ");
}

describe("More settings, on the Automatic Response page", () => {
  test("comes last, after the policies, folded, naming Hourly Limit and what it is for", async () => {
    const fold: HTMLElement = await renderPage();

    const policy: HTMLElement = screen.getAllByTestId(
      AUTOMATIC_RESPONSE_TEST_IDS.card,
    )[0]!;

    expect(isBefore(policy, fold)).toBe(true);
    expect(header(fold)).toHaveAttribute("aria-expanded", "false");
    expect(listedNames(fold)).toEqual([HOURLY_LIMIT_TITLE]);
    // At the default, nothing is set to call out.
    expect(setChips(fold)).toEqual([]);

    open(fold);
    expect(header(fold)).toHaveAttribute("aria-expanded", "true");
    expect(fold).toHaveTextContent(MORE_SETTINGS_DESCRIPTION);
    expect(card()).toHaveTextContent(HOURLY_LIMIT_DESCRIPTION);
    expect(await within(card()).findByText("50")).toBeInTheDocument();
  });

  test("names the project's own limit on its folded header, once it is not the default", async () => {
    stored = 120;

    const fold: HTMLElement = await renderPage();

    await waitFor(() => {
      expect(setChips(fold)).toEqual([`${HOURLY_LIMIT_TITLE}: 120`]);
    });
    expect(header(fold)).toHaveAttribute("aria-expanded", "false");
  });

  test(`opened at #${HOURLY_LIMIT_CARD_KEY}, it opens there, at the card`, async () => {
    const fold: HTMLElement = await renderPage(HOURLY_LIMIT_CARD_KEY);

    expect(header(fold)).toHaveAttribute("aria-expanded", "true");

    const place: HTMLElement | null =
      document.getElementById(HOURLY_LIMIT_CARD_KEY);

    expect(Boolean(place && fold.contains(place))).toBe(true);
    expect(card()).toHaveTextContent(HOURLY_LIMIT_DESCRIPTION);
  });

  test("opened anywhere else, it stays folded", async () => {
    const fold: HTMLElement = await renderPage("time-to-block");

    expect(header(fold)).toHaveAttribute("aria-expanded", "false");
  });
});

describe("Hourly Limit", () => {
  test("a Security Admin raises it, and the page reads itself again", async () => {
    const fold: HTMLElement = await renderPage();
    const reads: number = api.readAutomaticResponseOverview.mock.calls.length;
    const dialog: HTMLElement = await openDialog(fold);

    expect(dialog).toHaveTextContent(HOURLY_LIMIT_FIELD_TITLE);
    expect(dialog).toHaveTextContent(HOURLY_LIMIT_FIELD_DESCRIPTION);

    await typeLimit(dialog, "120");
    submit(dialog);

    await waitFor(() => {
      expect(updates).toEqual([{ [HOURLY_LIMIT_COLUMN]: 120 }]);
    });
    await waitFor(() => {
      expect(
        api.readAutomaticResponseOverview.mock.calls.length,
      ).toBeGreaterThan(reads);
    });
    await waitFor(() => {
      expect(setChips(fold)).toEqual([`${HOURLY_LIMIT_TITLE}: 120`]);
    });
  });

  test.each([
    [String(SECURITY_AUTOMATIC_RESPONSE_MAX_BLOCKS_PER_HOUR_MIN), 1],
    [String(SECURITY_AUTOMATIC_RESPONSE_MAX_BLOCKS_PER_HOUR_MAX), 500],
  ])("takes %s, a bound of its range", async (typed: string, saved: number) => {
    const fold: HTMLElement = await renderPage();
    const dialog: HTMLElement = await openDialog(fold);

    await typeLimit(dialog, typed);
    submit(dialog);

    await waitFor(() => {
      expect(updates).toEqual([{ [HOURLY_LIMIT_COLUMN]: saved }]);
    });
  });

  test.each(["0", "501", "2.5", "-3"])(
    "refuses %s before it is sent, in the server's words",
    async (typed: string) => {
      const fold: HTMLElement = await renderPage();
      const dialog: HTMLElement = await openDialog(fold);

      await typeLimit(dialog, typed);
      submit(dialog);

      expect(
        await within(dialog).findByText(
          SECURITY_AUTOMATIC_RESPONSE_MESSAGES.hourlyLimitOutOfRange,
        ),
      ).toBeInTheDocument();

      await settle();
      expect(updates).toEqual([]);
    },
  );

  test.each([
    ["a Project Owner", Permission.ProjectOwner],
    ["a Project Admin", Permission.ProjectAdmin],
  ])("%s changes it too", async (_who: string, permission: Permission) => {
    grant([...BASE_PERMISSIONS, permission]);

    const fold: HTMLElement = await renderPage(HOURLY_LIMIT_CARD_KEY);

    await within(card()).findByText("Edit");
    expect(editButton()).not.toBeDisabled();
    expect(header(fold)).toHaveAttribute("aria-expanded", "true");
  });

  test.each([
    ["a Security Member", Permission.SecurityMember],
    ["a Security Viewer", Permission.SecurityViewer],
    ["a Project Member", Permission.ProjectMember],
  ])(
    "%s sees it, with Edit locked",
    async (_who: string, permission: Permission) => {
      grant([...BASE_PERMISSIONS, permission]);

      const fold: HTMLElement = await renderPage(HOURLY_LIMIT_CARD_KEY);

      expect(header(fold)).toHaveAttribute("aria-expanded", "true");
      await within(card()).findByText("Edit");
      expect(editButton()).toBeDisabled();
    },
  );

  test("whoever may change it is whoever may turn a policy on: a Security Admin, a Project Owner, a Project Admin", () => {
    expect(getProjectColumnsUpdatePermissions([HOURLY_LIMIT_COLUMN])).toEqual(
      [Permission.ProjectOwner, Permission.ProjectAdmin, Permission.SecurityAdmin],
    );
  });
});

describe("the notice and the guardrails read the project's own limit", () => {
  const english: ReturnType<typeof getGlobalTranslator> = getGlobalTranslator();

  test("at a lowered limit of 10, 10 blocks this hour stop the policies, and the notice says the limit", async () => {
    stored = 10;
    api.readAutomaticResponseOverview.mockImplementation(async () => {
      return overview({ blocksThisHour: 10, pagedThisHour: true });
    });

    await renderPage();

    const notice: HTMLElement = screen.getByTestId(
      AUTOMATIC_RESPONSE_TEST_IDS.limitNotice,
    );

    expect(plain(notice.textContent)).toContain(
      plain(english.translatePlural(LIMIT_REACHED, 10)),
    );
    expect(plain(notice.textContent)).toContain(
      "Your policies reached your limit of 10 automatic blocks an hour, so they stopped and paged your security owners.",
    );
  });

  test("at a raised limit of 100, 50 blocks this hour leave room: no notice", async () => {
    stored = 100;
    api.readAutomaticResponseOverview.mockImplementation(async () => {
      return overview({ blocksThisHour: 50, pagedThisHour: true });
    });

    await renderPage();

    expect(
      screen.queryByTestId(AUTOMATIC_RESPONSE_TEST_IDS.limitNotice),
    ).toBeNull();
    // Its guardrails say the limit they are held to.
    expect(
      plain(
        screen.getByTestId(AUTOMATIC_RESPONSE_TEST_IDS.guardrails).textContent,
      ),
    ).toContain(
      "Stops after 100 automatic blocks an hour across your policies, and pages your security owners.",
    );
  });

  test("a limit lowered below the hour's blocks: stopped, its owners not paged until the next stop, and the notice promises no page", async () => {
    stored = 5;
    api.readAutomaticResponseOverview.mockImplementation(async () => {
      return overview({ blocksThisHour: 30, pagedThisHour: false });
    });

    await renderPage();

    const text: string = plain(
      screen.getByTestId(AUTOMATIC_RESPONSE_TEST_IDS.limitNotice).textContent,
    );

    expect(text).toContain(
      plain(english.translatePlural(LIMIT_REACHED_NOT_PAGED, 5)),
    );
    expect(text).toContain(
      "Your policies reached your limit of 5 automatic blocks an hour, so they stopped.",
    );
    expect(text).not.toContain("paged");
  });

  test("a limit of one block an hour reads in the singular", async () => {
    stored = 1;
    api.readAutomaticResponseOverview.mockImplementation(async () => {
      return overview({ blocksThisHour: 1, pagedThisHour: true });
    });

    await renderPage();

    expect(
      plain(
        screen.getByTestId(AUTOMATIC_RESPONSE_TEST_IDS.limitNotice).textContent,
      ),
    ).toContain(
      "Your policies reached your limit of 1 automatic block an hour, so they stopped and paged your security owners.",
    );
  });

  test("Change Limit, after the notice, opens the limit under More settings for whoever may change it", async () => {
    stored = 10;
    api.readAutomaticResponseOverview.mockImplementation(async () => {
      return overview({ blocksThisHour: 10, pagedThisHour: true });
    });

    const fold: HTMLElement = await renderPage();
    const link: HTMLElement = screen.getByTestId(
      AUTOMATIC_RESPONSE_TEST_IDS.changeLimit,
    );

    expect(link).toHaveTextContent(CHANGE_LIMIT);
    expect(link.getAttribute("href") || "").toContain(
      `#${HOURLY_LIMIT_CARD_KEY}`,
    );
    expect(header(fold)).toHaveAttribute("aria-expanded", "false");

    // Opened at its card, the page's fold is open there.
    cleanup();
    const opened: HTMLElement = await renderPage(HOURLY_LIMIT_CARD_KEY);
    expect(header(opened)).toHaveAttribute("aria-expanded", "true");
  });

  test("a reader who may not change the limit is not offered Change Limit", async () => {
    grant([...BASE_PERMISSIONS, Permission.SecurityViewer]);
    stored = 10;
    api.readAutomaticResponseOverview.mockImplementation(async () => {
      return overview({ blocksThisHour: 12, pagedThisHour: true });
    });

    await renderPage();

    expect(
      screen.getByTestId(AUTOMATIC_RESPONSE_TEST_IDS.limitNotice),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(AUTOMATIC_RESPONSE_TEST_IDS.changeLimit),
    ).toBeNull();
  });
});
