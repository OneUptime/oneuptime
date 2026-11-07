import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import { act, cleanup, render, screen, within } from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import * as React from "react";
import { initReactI18next } from "react-i18next";
import { MemoryRouter } from "react-router-dom";
import AiActivityInsightsView from "../../../../App/FeatureSet/Dashboard/src/Components/AI/ActivityInsights/AiActivityInsightsView";
import {
  AiActivityInsight,
  AiActivityInsightKind,
  AiActivityInsights,
  AiActivityInsightTone,
} from "../../../Types/AI/AiActivityInsights";
import Route from "../../../Types/API/Route";
import HeldPermissionsUtil from "../../../Types/HeldPermissions";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserPermission,
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import PermissionUtil from "../../../UI/Utils/Permission";
import User from "../../../UI/Utils/User";
import { followLanguageForDates } from "../../../UI/Utils/DateDisplayLanguage";
import { withoutIsolateMarks } from "../../Helpers/IsolateMarks";
import { makeInsights, RECURRING_SUBJECT } from "./AiActivityInsightsFixtures";

/*
 * WHOSE APPROVAL A WAITING FIX NEEDS, ON AI INSIGHTS (#5715's follow-up,
 * from its UI review).
 *
 * The AI card says a waiting fix "Needs approval" - never "Needs your
 * approval" - to a reader the server would refuse (RemediationFixActGate:
 * permission to start runbook executions, as approving and dismissing ask
 * it). AI Insights told the same reader "A fix is waiting for your
 * approval". It now asks the same gate: someone it certainly refuses - a
 * Project Member whose team blocks Create Runbook Execution, the reader who
 * can read fixes and not approve them - reads that fixes wait for approval;
 * everyone else, and everyone while the permission snapshot is still on its
 * way, reads "your approval", as before.
 */

const PROJECT_ID: string = "11111111-0000-4000-8000-000000000001";

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

const LANGUAGES: Array<string> = ["en", "de", "fa"];

function readLocale(language: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${language}.json`), "utf8"),
  ) as Record<string, string>;
}

function row(permission: Permission, isBlock: boolean = false): UserPermission {
  return {
    _type: "UserPermission",
    permission,
    labelIds: [],
    isBlockPermission: isBlock,
  };
}

// The reader's permission snapshot, as the API's response headers leave it.
function asReader(rows: Array<UserPermission>): void {
  jest.spyOn(PermissionUtil, "getProjectPermissions").mockReturnValue({
    _type: "UserTenantAccessPermission",
    projectId: new ObjectID(PROJECT_ID),
    permissions: rows,
    isBlockPermission: false,
  } as unknown as UserTenantAccessPermission);
  jest
    .spyOn(PermissionUtil, "getAllPermissions")
    .mockReturnValue(
      HeldPermissionsUtil.getUnblockedPermissions(
        HeldPermissionsUtil.fromRows({ rows, globalPermissions: [] }),
      ),
    );
}

// The member who reads fixes and may not approve them: a team blocks runs.
const BLOCKED_MEMBER: Array<UserPermission> = [
  row(Permission.ProjectMember),
  row(Permission.CreateRunbookExecution, true),
];

function awaitingApproval(count: number): AiActivityInsight {
  return {
    kind: AiActivityInsightKind.FixesAwaitingApproval,
    tone: AiActivityInsightTone.Warning,
    count,
    subject: RECURRING_SUBJECT,
    evidence: [RECURRING_SUBJECT],
    evidenceCount: 1,
  };
}

function renderInsights(insights: AiActivityInsights): void {
  render(
    <MemoryRouter>
      <AiActivityInsightsView
        insights={insights}
        noun="incident"
        logsRoute={new Route("/dashboard/incidents/ai/logs")}
        settingsRoute={new Route("/dashboard/incidents/settings/ai")}
      />
    </MemoryRouter>,
  );
}

// The waiting fixes' insight's heading, as drawn.
function waitingHeadline(): string {
  const item: HTMLElement | undefined = screen
    .getAllByTestId("ai-insights-insight")
    .find((element: HTMLElement): boolean => {
      return (
        element.getAttribute("data-kind") ===
        AiActivityInsightKind.FixesAwaitingApproval
      );
    });

  expect(item).toBeDefined();

  return withoutIsolateMarks(
    within(item!).getByTestId("ai-insights-insight-headline").textContent || "",
  );
}

async function inLanguage(language: string): Promise<void> {
  await act(async (): Promise<void> => {
    await i18next.changeLanguage(language);
  });
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: Object.fromEntries(
      LANGUAGES.map((language: string) => {
        return [language, { translation: readLocale(language) }];
      }),
    ),
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
  followLanguageForDates(i18next);
});

beforeEach(() => {
  jest.spyOn(User, "isMasterAdmin").mockReturnValue(false);
});

afterEach(async () => {
  cleanup();
  jest.restoreAllMocks();
  await inLanguage("en");
});

describe("AI Insights says whose approval a waiting fix needs", () => {
  test.each([
    [
      "a Project Member whose team blocks Create Runbook Execution",
      BLOCKED_MEMBER,
    ],
    [
      "a Project Member whose team blocks Project Member",
      [
        row(Permission.ProjectMember),
        row(Permission.ProjectMember, true),
        row(Permission.Viewer),
      ],
    ],
    ["a Viewer", [row(Permission.Viewer)]],
  ])(
    "%s, whom the server would refuse, reads that a fix is waiting for approval",
    (_who: string, rows: Array<UserPermission>) => {
      asReader(rows);
      renderInsights(makeInsights());

      expect(waitingHeadline()).toBe("A fix is waiting for approval");
    },
  );

  test.each([
    ["a Project Member", [row(Permission.ProjectMember)]],
    ["a Runbook Member", [row(Permission.RunbookMember)]],
    [
      "someone given Create Runbook Execution alone",
      [row(Permission.CreateRunbookExecution)],
    ],
  ])(
    "%s, who may approve it, reads that it waits for their approval",
    (_who: string, rows: Array<UserPermission>) => {
      asReader(rows);
      renderInsights(makeInsights());

      expect(waitingHeadline()).toBe("A fix is waiting for your approval");
    },
  );

  test("before the permission snapshot lands: their approval, as the card keeps its buttons", () => {
    jest.spyOn(PermissionUtil, "getProjectPermissions").mockReturnValue(null);
    jest.spyOn(PermissionUtil, "getAllPermissions").mockReturnValue([]);
    renderInsights(makeInsights());

    expect(waitingHeadline()).toBe("A fix is waiting for your approval");
  });

  test("a master admin, who may do everything, with no permission of their own: their approval", () => {
    asReader([]);
    jest.spyOn(User, "isMasterAdmin").mockReturnValue(true);
    renderInsights(makeInsights());

    expect(waitingHeadline()).toBe("A fix is waiting for your approval");
  });

  test("several fixes: counted, for approval - and for theirs to someone who may give it", () => {
    asReader(BLOCKED_MEMBER);
    renderInsights(makeInsights({ insights: [awaitingApproval(3)] }));

    expect(waitingHeadline()).toBe("3 fixes are waiting for approval");

    cleanup();
    asReader([row(Permission.ProjectMember)]);
    renderInsights(makeInsights({ insights: [awaitingApproval(3)] }));

    expect(waitingHeadline()).toBe("3 fixes are waiting for your approval");
  });

  test("its facts say the same either way: it runs as soon as someone approves it", () => {
    asReader(BLOCKED_MEMBER);
    renderInsights(makeInsights());

    const item: HTMLElement = screen
      .getAllByTestId("ai-insights-insight")
      .find((element: HTMLElement): boolean => {
        return (
          element.getAttribute("data-kind") ===
          AiActivityInsightKind.FixesAwaitingApproval
        );
      })!;

    expect(
      withoutIsolateMarks(
        within(item).getByTestId("ai-insights-insight-facts").textContent || "",
      ),
    ).toContain(
      "OneUptime AI has it ready: it runs as soon as someone approves it.",
    );
  });

  test.each([
    ["de", 1, "{{count}} fixes are waiting for approval_one"],
    ["de", 3, "{{count}} fixes are waiting for approval"],
    ["fa", 1, "{{count}} fixes are waiting for approval_one"],
    ["fa", 3, "{{count}} fixes are waiting for approval"],
  ])(
    "in %s, %p waiting: the language's own words, never its words for 'your approval'",
    async (language: string, count: number, key: string) => {
      const locale: Record<string, string> = readLocale(language);
      const english: Record<string, string> = readLocale("en");

      // Worded in the language, apart from what it says to an approver.
      expect(locale[key]).toBeDefined();
      expect(locale[key]).not.toBe(english[key]);
      expect(locale[key]).not.toBe(
        locale[key.replace("for approval", "for your approval")],
      );

      await inLanguage(language);
      asReader(BLOCKED_MEMBER);
      renderInsights(makeInsights({ insights: [awaitingApproval(count)] }));

      const digits: string = new Intl.NumberFormat(language).format(count);

      expect(waitingHeadline()).toBe(locale[key]!.replace("{{count}}", digits));
    },
  );
});
