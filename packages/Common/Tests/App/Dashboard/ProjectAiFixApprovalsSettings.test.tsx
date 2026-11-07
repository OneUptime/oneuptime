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
  FIX_APPROVALS_CARD_KEY,
  FIX_APPROVALS_SWITCH_TEST_ID,
  FixApprovalsCopy,
  getFixApprovalsFoldedItem,
  TWO_APPROVALS_COLUMN,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/FixApprovalsCopy";
import {
  PROJECT_AI_ADVANCED_SECTION_TEST_ID,
  ProjectAiDailyLimitsCopy,
} from "../../../../App/FeatureSet/Dashboard/src/Components/AISettings/ProjectAiSettingsCopy";
import Project from "../../../Models/DatabaseModels/Project";
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
 * FIX APPROVALS, under More settings on Project Settings → AI → AI Features
 * (#6148's follow-up), rendered for real with the network and the
 * permission snapshot stubbed.
 *
 * One switch, off by default: "Two people approve riskier fixes".
 * Folded, More settings names the card beside Daily limits, and draws it as
 * a chip - "Fix approvals: Two people" - while it is on, so folding never
 * hides it. A project owner or admin flips it, and it saves that column
 * alone, at once, with no question asked (turning it on or off runs
 * nothing); everyone else sees it locked, saying who may change it.
 */

const WAIT_TIMEOUT: number = 20000;

const BASE_PERMISSIONS: Array<Permission> = [
  Permission.Public,
  Permission.User,
  Permission.CurrentUser,
  Permission.ProjectUser,
];

// The project as the server holds it: what getItem reads, a save writes.
let stored: Record<string, unknown> = {};
let updateSpy: ReturnType<typeof jest.spyOn>;

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
  updateSpy = jest
    .spyOn(ModelAPI, "updateById")
    .mockImplementation(async (data: unknown): Promise<never> => {
      Object.assign(stored, (data as { data: Record<string, unknown> }).data);
      return {} as never;
    });
  jest.spyOn(API, "post").mockImplementation(async (): Promise<never> => {
    return new HTTPResponse<JSONObject>(
      200,
      {
        usedTokensToday: 0,
        spentTodayInUSDCents: 0,
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

function openAiFeaturesPage(hash: string = ""): void {
  const path: string = `/dashboard/${PROJECT_ID}/settings/ai-features`;
  goTo(path);

  if (hash) {
    window.history.replaceState({}, "", `${path}${hash}`);
  }

  const page: ReactElement = (
    <MemoryRouter initialEntries={[path]}>
      <AIFeatures {...PAGE_PROPS} />
    </MemoryRouter>
  );

  render(page);
}

function moreSettingsHeader(): HTMLElement {
  return screen.getByRole("button", { name: MORE_SETTINGS_SECTION_TITLE });
}

function section(): HTMLElement {
  return screen.getByTestId(PROJECT_AI_ADVANCED_SECTION_TEST_ID);
}

async function fixApprovalsSwitch(): Promise<HTMLElement> {
  return await screen.findByRole(
    "switch",
    { name: FixApprovalsCopy.switchTitle },
    { timeout: WAIT_TIMEOUT },
  );
}

describe("Fix approvals, folded under More settings", () => {
  test("the folded header names it beside Daily limits, and nothing is set by default", async () => {
    openAiFeaturesPage();

    await waitFor(
      () => {
        expect(listedNames(moreSettingsHeader())).toEqual([
          "Daily limits",
          "Fix approvals",
        ]);
      },
      { timeout: WAIT_TIMEOUT },
    );

    // Off for every project until a team turns it on.
    const control: HTMLElement = await fixApprovalsSwitch();
    expect(control).toHaveAttribute("aria-checked", "false");
    expect(setChips(moreSettingsHeader())).toEqual([]);
    // It is folded: Enable AI comes first, the fold after it.
    expect(
      within(section()).getByRole("switch", {
        hidden: true,
        name: FixApprovalsCopy.switchTitle,
      }),
    ).toBeTruthy();
  });

  test("on, the folded header draws it as a chip that says two people approve", async () => {
    stored[TWO_APPROVALS_COLUMN] = true;

    openAiFeaturesPage();

    await waitFor(
      () => {
        expect(setChips(moreSettingsHeader())).toEqual([
          "Fix approvals: Two people",
        ]);
      },
      { timeout: WAIT_TIMEOUT },
    );
  });

  test("the More settings line says what the section is for: the daily limits and who approves riskier fixes", async () => {
    openAiFeaturesPage();
    fireEvent.click(moreSettingsHeader());

    await waitFor(
      () => {
        expect(section()).toHaveTextContent(
          ProjectAiDailyLimitsCopy.sectionDescription,
        );
      },
      { timeout: WAIT_TIMEOUT },
    );
    expect(ProjectAiDailyLimitsCopy.sectionDescription).toBe(
      "Limits on how much OneUptime AI uses across the whole project each day, and how many people approve its riskier fixes.",
    );
  });
});

describe("the switch", () => {
  test("its card and words say what it does", async () => {
    openAiFeaturesPage();
    fireEvent.click(moreSettingsHeader());

    const control: HTMLElement = await fixApprovalsSwitch();
    const card: HTMLElement = control.closest(
      '[data-testid="card"]',
    ) as HTMLElement;

    expect(card).toHaveTextContent(FixApprovalsCopy.cardTitle);
    expect(card).toHaveTextContent(FixApprovalsCopy.cardDescription);
    expect(card).toHaveTextContent(FixApprovalsCopy.switchDescription);
    expect(control).toBeEnabled();

    // A section of More settings' one card, after Daily limits.
    expect(card).toHaveAttribute("data-card-surface", "section");
    const sections: Array<string> = Array.from(
      section().querySelectorAll<HTMLElement>(
        '[data-testid="card"][data-card-surface="section"]',
      ),
    ).map((element: HTMLElement): string => {
      return element === card ? FixApprovalsCopy.cardTitle : "other";
    });
    expect(sections).toEqual(["other", FixApprovalsCopy.cardTitle]);
  });

  test("a project owner turns it on: it saves that column alone, at once, and the folded header follows", async () => {
    openAiFeaturesPage();
    fireEvent.click(moreSettingsHeader());

    const control: HTMLElement = await fixApprovalsSwitch();

    await act(async (): Promise<void> => {
      fireEvent.click(control);
    });

    await waitFor(
      () => {
        expect(updateSpy).toHaveBeenCalledTimes(1);
      },
      { timeout: WAIT_TIMEOUT },
    );

    const write: { id: ObjectID; data: JSONObject } = updateSpy.mock
      .calls[0]![0] as { id: ObjectID; data: JSONObject };
    expect(write.id.toString()).toBe(PROJECT_ID);
    expect(write.data).toEqual({ [TWO_APPROVALS_COLUMN]: true });
    // Nothing runs when it is flipped, so it asks nothing first.
    expect(screen.queryByRole("dialog")).toBeNull();

    // Folded again, the header draws what is set.
    fireEvent.click(moreSettingsHeader());

    await waitFor(
      () => {
        expect(setChips(moreSettingsHeader())).toEqual([
          "Fix approvals: Two people",
        ]);
      },
      { timeout: WAIT_TIMEOUT },
    );
  });

  test("a project admin may change it too", async () => {
    PermissionGate.clearPermissionPropsCache();
    grant([...BASE_PERMISSIONS, Permission.ProjectAdmin]);

    openAiFeaturesPage();
    fireEvent.click(moreSettingsHeader());

    expect(await fixApprovalsSwitch()).toBeEnabled();
  });

  test.each([Permission.ProjectMember, Permission.EditProject])(
    "%s sees it locked, saying who may change it, and saves nothing",
    async (permission: Permission) => {
      PermissionGate.clearPermissionPropsCache();
      grant([...BASE_PERMISSIONS, permission]);

      openAiFeaturesPage();
      fireEvent.click(moreSettingsHeader());

      const control: HTMLElement = await fixApprovalsSwitch();
      const card: HTMLElement = screen.getByTestId(
        `${FIX_APPROVALS_SWITCH_TEST_ID}-card`,
      );

      expect(control).toHaveAttribute("aria-disabled", "true");
      expect(card).toHaveTextContent("Project Owner");

      await act(async (): Promise<void> => {
        fireEvent.click(control);
      });

      expect(updateSpy).not.toHaveBeenCalled();
    },
  );
});

describe("its place on the page", () => {
  test("a link to it opens More settings at the card", async () => {
    openAiFeaturesPage(`#${FIX_APPROVALS_CARD_KEY}`);

    await waitFor(
      () => {
        expect(moreSettingsHeader()).toHaveAttribute("aria-expanded", "true");
      },
      { timeout: WAIT_TIMEOUT },
    );
    expect(document.getElementById(FIX_APPROVALS_CARD_KEY)).not.toBeNull();
  });

  test("the folded item: by name while off or unread, a chip saying two people while on", () => {
    expect(getFixApprovalsFoldedItem(null)).toEqual({
      key: FIX_APPROVALS_CARD_KEY,
      title: "Fix approvals",
      isSet: false,
    });
    expect(getFixApprovalsFoldedItem(false)).toEqual({
      key: FIX_APPROVALS_CARD_KEY,
      title: "Fix approvals",
      isSet: false,
    });
    expect(getFixApprovalsFoldedItem(true)).toEqual({
      key: FIX_APPROVALS_CARD_KEY,
      title: "Fix approvals",
      isSet: true,
      value: "Two people",
      translateValue: true,
    });
  });
});
