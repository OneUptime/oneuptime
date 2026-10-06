import ProjectNotificationChannelOwnerNotice from "../../../Server/Utils/ProjectNotificationChannelOwnerNotice";
import Protocol from "../../../Types/API/Protocol";
import Route from "../../../Types/API/Route";
import URL from "../../../Types/API/URL";
import ObjectID from "../../../Types/ObjectID";
import SafeHtml from "../../../Types/SafeHtml";
import {
  getProjectNotificationChannelOffOwnerSentence,
  ProjectNotificationChannel,
} from "../../../Utils/Project/NotificationChannels";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";

/*
 * What a project's owners read when an SMS, a call or a Telegram message
 * was not sent because its channel is off (SmsService, CallService and
 * TelegramService email them once). The owners may turn the channel on, so
 * the notice tells them to, if it should be on, and links straight to the
 * page with the switch - the project's Notification Settings.
 */

interface DashboardAddress {
  url: URL | undefined;
}

const address: DashboardAddress = { url: undefined };

(
  globalThis as unknown as { __ownerNoticeAddress: DashboardAddress }
).__ownerNoticeAddress = address;

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
          __ownerNoticeAddress: DashboardAddress | undefined;
        }
      ).__ownerNoticeAddress?.url;
    },
  });

  return mocked;
});

jest.mock("../../../Server/Utils/Logger");

import logger from "../../../Server/Utils/Logger";

const PROJECT_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);

const DASHBOARD: string = "https://oneuptime.example.com/dashboard";

const LINK: string = `${DASHBOARD}/${PROJECT_ID.toString()}/settings/notification-settings`;

beforeEach(() => {
  address.url = URL.fromString(DASHBOARD);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the link to the switches", () => {
  test("is the project's Notification Settings page in the dashboard", () => {
    expect(
      ProjectNotificationChannelOwnerNotice.getSettingsLink(
        PROJECT_ID,
      )?.toString(),
    ).toBe(LINK);
  });

  test("there is none when the dashboard's address is not configured", () => {
    address.url = undefined;

    expect(
      ProjectNotificationChannelOwnerNotice.getSettingsLink(PROJECT_ID),
    ).toBeNull();
  });

  test("there is none when the address has no host (HOST is not set), and nothing is logged as an error", () => {
    address.url = new URL(Protocol.HTTP, "", new Route("/dashboard"));

    expect(
      ProjectNotificationChannelOwnerNotice.getSettingsLink(PROJECT_ID),
    ).toBeNull();

    // And the notice still says where the switch is.
    expect(
      ProjectNotificationChannelOwnerNotice.getHtml({
        channel: ProjectNotificationChannel.SMS,
        projectId: PROJECT_ID,
      }),
    ).toBe(
      "SMS is off in this project. If it should be on, turn it on in Project Settings &gt; Notification Settings.",
    );

    /*
     * A missing HOST is how the install is set up, not a failure of this
     * email: every refused message would otherwise log a stack trace.
     */
    expect(logger.error).not.toHaveBeenCalled();
  });
});

describe("the notice", () => {
  test.each([
    ProjectNotificationChannel.SMS,
    ProjectNotificationChannel.Call,
    ProjectNotificationChannel.Telegram,
  ])(
    "for %s: the owners' sentence, then the link on a line of its own",
    (channel: ProjectNotificationChannel) => {
      const html: string = ProjectNotificationChannelOwnerNotice.getHtml({
        channel: channel,
        projectId: PROJECT_ID,
      });

      expect(html).toBe(
        `${SafeHtml.escape(getProjectNotificationChannelOffOwnerSentence(channel))} <br/> <br/> <a href="${LINK}">${LINK}</a>`,
      );
      expect(html).toContain("If ");
      expect(html).toContain("Project Settings &gt; Notification Settings");
    },
  );

  test("is HTML: the sentence's own characters are escaped, and the one link is the switch's", () => {
    const html: string = ProjectNotificationChannelOwnerNotice.getHtml({
      channel: ProjectNotificationChannel.SMS,
      projectId: PROJECT_ID,
    });

    // "Project Settings > Notification Settings" goes into the email as text.
    expect(html).not.toContain("Project Settings > Notification Settings");
    expect(html.match(/<a href=/g)).toHaveLength(1);
  });

  test("without a link to give, the sentence alone - it still says where the switch is", () => {
    address.url = undefined;

    const html: string = ProjectNotificationChannelOwnerNotice.getHtml({
      channel: ProjectNotificationChannel.Call,
      projectId: PROJECT_ID,
    });

    expect(html).toBe(
      "Phone calls are off in this project. If they should be on, turn them on in Project Settings &gt; Notification Settings.",
    );
    expect(html).not.toContain("<a ");
  });
});
