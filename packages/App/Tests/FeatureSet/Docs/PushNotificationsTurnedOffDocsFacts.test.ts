import {
  anchorsOf,
  hasPage,
  readPage,
  scanMarkdown,
} from "./DocsContentSupport";
import { readCommonSource, readDashboardSource } from "./DocsDashboardMenus";
import {
  PUSH_NOTIFICATION_NOT_SENT_TURNED_OFF_REASON,
  PUSH_NOTIFICATIONS_TURNED_OFF_MESSAGE,
} from "Common/Types/PushNotification/PushNotificationsTurnedOff";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * THE DOCS ON TURNING PUSH OFF, HELD TO THE CODE.
 *
 * Self-hosted > Push Notifications says how a master admin turns push off
 * for the whole server and what happens while it is off. Every name, path,
 * quote and number it gives is read here from where the product takes it:
 * the Admin Dashboard's page and side menu, the Dashboard's tab and notice,
 * the push sender's words on the on-call log, and how long a server keeps
 * the switch before it reads it again.
 */

const PUSH_PAGE: string = "self-hosted/push-notifications";
const SECTION_TITLE: string = "Turning Push Off for the Whole Server";
const SECTION_ANCHOR: string = "turning-push-off-for-the-whole-server";

const ADMIN_SRC: string = path.resolve(
  __dirname,
  "..",
  "..",
  "..",
  "FeatureSet",
  "AdminDashboard",
  "src",
);

function readAdminSource(relative: string): string {
  return fs.readFileSync(path.join(ADMIN_SRC, relative), "utf8");
}

// The English page's section, from its heading to the next one.
function section(markdown: string, title: string): string {
  const start: number = markdown.indexOf(`## ${title}\n`);

  expect([title, start > -1]).toEqual([title, true]);

  const end: number = markdown.indexOf("\n## ", start + 1);

  return markdown.slice(start, end === -1 ? undefined : end);
}

const PAGE: string = readPage("en", PUSH_PAGE);
const SECTION: string = section(PAGE, SECTION_TITLE);

describe("the section on turning push off", () => {
  test("is on the push page under its own heading, and the page's cards link to it", () => {
    expect(
      scanMarkdown(PAGE).headings.some(
        (heading: { level: number; text: string }): boolean => {
          return heading.level === 2 && heading.text === SECTION_TITLE;
        },
      ),
    ).toBe(true);
    expect(anchorsOf("en", PUSH_PAGE).has(SECTION_ANCHOR)).toBe(true);
    expect(PAGE).toContain(`](#${SECTION_ANCHOR})`);
  });

  test("names the Admin Dashboard page as its menu and route have it", () => {
    expect(SECTION).toContain(
      "**Admin Dashboard > Settings > Push Notifications**",
    );

    const locale: Record<string, Record<string, string>> = JSON.parse(
      readAdminSource("Locales/en.json"),
    ) as Record<string, Record<string, string>>;

    expect(locale["breadcrumbs"]!["adminDashboard"]).toBe("Admin Dashboard");
    expect(locale["breadcrumbs"]!["settings"]).toBe("Settings");

    // The settings side menu's entry, linking the page.
    const sideMenu: string = readAdminSource("Pages/Settings/SideMenu.tsx");
    const at: number = sideMenu.indexOf("PageMap.SETTINGS_PUSH_NOTIFICATIONS");
    const entry: string = sideMenu.slice(
      sideMenu.lastIndexOf("<SideMenuItem", at),
      at,
    );

    expect(entry).toContain('title: "Push Notifications"');

    expect(readAdminSource("Utils/RouteMap.ts")).toContain(
      "[PageMap.SETTINGS_PUSH_NOTIFICATIONS]: new Route(\n    `/admin/settings/push-notifications`,\n  ),",
    );
  });

  test("names the switch as the page draws it, and says turning it off asks first", () => {
    expect(SECTION).toContain(
      "turn **Send push notifications** off and confirm",
    );

    const page: string = readAdminSource(
      "Pages/Settings/PushNotifications/Index.tsx",
    );

    expect(page).toContain('title="Send push notifications"');
    expect(page).toContain('column="disablePushNotifications"');
    // On while the column is false: "off" in the docs is the column set.
    expect(page).toContain("isInverted={true}");
    // A master admin's page: it writes through the admin dashboard's API.
    expect(page).toContain("modelAPI={AdminModelAPI}");

    expect(
      readAdminSource(
        "Pages/Settings/PushNotifications/PushNotificationsCopy.ts",
      ),
    ).toContain("return isTurningOn ? undefined : TURN_OFF_PUSH_CONFIRMATION;");
  });

  test("quotes the on-call log in the push sender's own words", () => {
    const quoted: RegExpMatchArray | null = SECTION.match(
      /The person's on-call log says `([^`\n]+)`/,
    );

    expect(quoted).not.toBeNull();
    expect(
      PUSH_NOTIFICATION_NOT_SENT_TURNED_OFF_REASON.startsWith(quoted![1]!),
    ).toBe(true);
    // A whole sentence of it, not a word cut short.
    expect(quoted![1]!.endsWith(".")).toBe(true);
    expect(
      readCommonSource("Server/Services/PushNotificationService.ts"),
    ).toContain("reason: PUSH_NOTIFICATION_NOT_SENT_TURNED_OFF_REASON,");
  });

  test("names the Dashboard's tab where it is, which says push is off in the server's words", () => {
    expect(SECTION).toContain(
      "**Push Notifications** tab under **User Settings > Notification Methods** says that push is off",
    );

    const tabs: string = readDashboardSource(
      "Components/NotificationMethods/NotificationMethodTabs.tsx",
    );
    const pushTab: string = tabs.slice(
      tabs.indexOf("export function getPushNotificationsTab"),
    );

    expect(pushTab).toContain('name: translationKey("Push Notifications")');
    expect(pushTab).toContain(
      "children: isPushTurnedOff ? <PushNotificationsTurnedOff /> : <UserPush />,",
    );

    const notice: RegExpMatchArray | null = readDashboardSource(
      "Components/NotificationMethods/PushNotificationsTurnedOff.tsx",
    ).match(
      /PUSH_NOTIFICATIONS_TURNED_OFF_NOTICE: string = translationKey\(\s*"([^"]+)",?\s*\)/,
    );

    expect(notice?.[1]).toBe(PUSH_NOTIFICATIONS_TURNED_OFF_MESSAGE);
  });

  test("says on-call rules offer no push devices, as the rules table does", () => {
    expect(SECTION).toContain("on-call rules offer no push devices");

    const rulesTable: string = readDashboardSource(
      "Components/NotificationRule/OnCallRulesTable.tsx",
    );

    expect(rulesTable).toContain(
      "const offeredUserPush: Array<UserPush> = isPushTurnedOff ? [] : userPush;",
    );
    expect(rulesTable).toContain(
      'return !isPushTurnedOff || method.methodType !== "Push";',
    );
  });

  test("says no device can be registered: both device routes refuse in the shared words", () => {
    expect(SECTION).toContain("No device can be registered.");

    const routes: string = readCommonSource("Server/API/UserPushAPI.ts");

    expect(
      routes.split(
        "new BadDataException(PUSH_NOTIFICATIONS_TURNED_OFF_MESSAGE)",
      ).length - 1,
    ).toBe(2);
  });

  test("says readiness and the fallback leave push devices out", () => {
    expect(SECTION).toContain(
      "On-call readiness counts push devices as unusable, and the fallback skips them.",
    );

    for (const service of [
      "Server/Services/OnCallReadinessService.ts",
      "Server/Services/UserNotificationRuleService.ts",
    ]) {
      expect([
        service,
        readCommonSource(service).includes(
          "GlobalConfigService.getPushNotificationsTurnedOff()",
        ),
      ]).toEqual([service, true]);
    }
  });

  test("says how soon every server sees a change: within the time a server keeps the switch", () => {
    const keptFor: RegExpMatchArray | null = readCommonSource(
      "Server/Services/GlobalConfigService.ts",
    ).match(/PUSH_NOTIFICATIONS_TURNED_OFF_CACHE_TTL_MS: number = ([\d_]+);/);

    expect(keptFor).not.toBeNull();

    const seconds: number = Number(keptFor![1]!.replace(/_/g, "")) / 1000;

    expect(SECTION).toContain(
      `Each OneUptime server reads the switch again within ${seconds} seconds of a change.`,
    );
  });

  test("points at the custom channels page, which exists", () => {
    expect(SECTION).toContain(
      "[custom channel](/docs/self-hosted/custom-notification-channels)",
    );
    expect(hasPage("en", "self-hosted/custom-notification-channels")).toBe(
      true,
    );
  });
});
