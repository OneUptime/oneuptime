import ProjectBalanceOwnerNotice from "../../../Server/Utils/ProjectBalanceOwnerNotice";
import Protocol from "../../../Types/API/Protocol";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import ObjectID from "../../../Types/ObjectID";
import SafeHtml from "../../../Types/SafeHtml";
import {
  getProjectBalanceOwnerSentence,
  ProjectBalanceType,
} from "../../../Utils/Project/ProjectBalance";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * What a project's owners read when an SMS, a call, a WhatsApp or a
 * Telegram message was not sent because the project's balance could not pay
 * for it (SmsService, CallService, WhatsAppService and TelegramService
 * email them once, until the balance is topped up). The owners may add
 * balance, so the notice tells them to - or to turn on Auto Recharge - and
 * links straight to the page with the Recharge button.
 */

interface DashboardAddress {
  url: URL | undefined;
}

const address: DashboardAddress = { url: undefined };

(
  globalThis as unknown as { __balanceNoticeAddress: DashboardAddress }
).__balanceNoticeAddress = address;

jest.mock("../../../Server/EnvironmentConfig", () => {
  const mocked: Record<string, unknown> = {
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
  };

  Object.defineProperty(mocked, "DashboardClientUrl", {
    get: (): URL | undefined => {
      return (
        globalThis as unknown as {
          __balanceNoticeAddress: DashboardAddress | undefined;
        }
      ).__balanceNoticeAddress?.url;
    },
  });

  return mocked;
});

const PROJECT_ID: ObjectID = new ObjectID(
  "7c000000-0000-4000-8000-000000000001",
);

const DASHBOARD: string = "https://oneuptime.example.com/dashboard";

const NOTIFICATION_SETTINGS_LINK: string = `${DASHBOARD}/${PROJECT_ID.toString()}/settings/notification-settings`;

const AI_CREDITS_LINK: string = `${DASHBOARD}/${PROJECT_ID.toString()}/settings/ai-credits`;

beforeEach(() => {
  address.url = URL.fromString(DASHBOARD);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the link to the page that holds the balance", () => {
  test("is Notification Settings for the balance SMS, calls, WhatsApp and Telegram are paid from", () => {
    expect(
      ProjectBalanceOwnerNotice.getSettingsLink({
        balance: ProjectBalanceType.SmsOrCall,
        projectId: PROJECT_ID,
      })?.toString(),
    ).toBe(NOTIFICATION_SETTINGS_LINK);
  });

  test("is AI Credits for AI credits", () => {
    expect(
      ProjectBalanceOwnerNotice.getSettingsLink({
        balance: ProjectBalanceType.AI,
        projectId: PROJECT_ID,
      })?.toString(),
    ).toBe(AI_CREDITS_LINK);
  });

  test("there is none when the dashboard's address is not configured", () => {
    address.url = undefined;

    expect(
      ProjectBalanceOwnerNotice.getSettingsLink({
        balance: ProjectBalanceType.SmsOrCall,
        projectId: PROJECT_ID,
      }),
    ).toBeNull();
  });

  test("there is none when the address has no host (HOST is not set)", () => {
    address.url = new URL(Protocol.HTTP, "", new Route("/dashboard"));

    expect(
      ProjectBalanceOwnerNotice.getSettingsLink({
        balance: ProjectBalanceType.AI,
        projectId: PROJECT_ID,
      }),
    ).toBeNull();
  });
});

describe("the notice", () => {
  test("for the notification balance: add balance or turn on Auto Recharge, then the link on a line of its own", () => {
    const html: string = ProjectBalanceOwnerNotice.getHtml({
      balance: ProjectBalanceType.SmsOrCall,
      projectId: PROJECT_ID,
    });

    expect(html).toBe(
      `${SafeHtml.escape(getProjectBalanceOwnerSentence(ProjectBalanceType.SmsOrCall))} <br/> <br/> <a href="${NOTIFICATION_SETTINGS_LINK}">${NOTIFICATION_SETTINGS_LINK}</a>`,
    );
    expect(html).toContain(
      "Add balance in Project Settings &gt; Notification Settings, or turn on Auto Recharge there so it does not run out.",
    );
  });

  test("for AI credits: add credits, and the AI Credits link", () => {
    const html: string = ProjectBalanceOwnerNotice.getHtml({
      balance: ProjectBalanceType.AI,
      projectId: PROJECT_ID,
    });

    expect(html).toBe(
      `${SafeHtml.escape(getProjectBalanceOwnerSentence(ProjectBalanceType.AI))} <br/> <br/> <a href="${AI_CREDITS_LINK}">${AI_CREDITS_LINK}</a>`,
    );
  });

  test("is HTML: the sentence's own characters are escaped, and the one link is the balance page's", () => {
    const html: string = ProjectBalanceOwnerNotice.getHtml({
      balance: ProjectBalanceType.SmsOrCall,
      projectId: PROJECT_ID,
    });

    expect(html).not.toContain("Project Settings > Notification Settings");
    expect(html.match(/<a href=/g)).toHaveLength(1);
  });

  test("tells the owners to act - they may - unlike the sentences everyone else reads", () => {
    for (const balance of [ProjectBalanceType.SmsOrCall, ProjectBalanceType.AI]) {
      const html: string = ProjectBalanceOwnerNotice.getHtml({
        balance: balance,
        projectId: PROJECT_ID,
      });

      expect(html).toMatch(/^Add /);
      expect(html).not.toContain("A project owner or someone with");
    }
  });

  test("without a link to give, the sentence alone - it still says where the page is", () => {
    address.url = undefined;

    expect(
      ProjectBalanceOwnerNotice.getHtml({
        balance: ProjectBalanceType.SmsOrCall,
        projectId: PROJECT_ID,
      }),
    ).toBe(
      "Add balance in Project Settings &gt; Notification Settings, or turn on Auto Recharge there so it does not run out.",
    );
  });
});
