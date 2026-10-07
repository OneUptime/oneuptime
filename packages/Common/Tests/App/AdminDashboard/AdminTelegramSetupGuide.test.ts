import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import Permission, {
  PermissionHelper,
  PermissionProps,
} from "../../../Types/Permission";
import { PROJECT_NOTIFICATION_CHANNEL_UPDATE_PERMISSIONS } from "../../../Utils/Project/NotificationChannels";
import {
  buildTelegramSetupMarkdown,
  TELEGRAM_PROJECT_SWITCH_STEP,
} from "../../../../App/FeatureSet/AdminDashboard/src/Pages/Settings/Telegram/TelegramSetupGuide";

/*
 * Admin Dashboard > Settings > Telegram ends its setup guide by walking the
 * server admin through a first message. Telegram starts off in every
 * project, and until a project has it on nobody there can link a Telegram
 * account (UserTelegramService refuses the row) - so the guide used to send
 * users to link an account the server would refuse on every new project.
 *
 * It now says, before that step, that each project has to switch Telegram on
 * and exactly who can: a project owner, a Billing Admin or someone with
 * Manage Billing (the Project column's own update permissions) - not a
 * project admin, and not the server admin reading the guide, who is often
 * none of them.
 */

// A numbered step of a Markdown list: "1. ...".
const NUMBERED_STEP: RegExp = /^\d+\. /;

const WEBHOOK_URL: string =
  "https://oneuptime.example.com/api/notification/telegram/webhook";

const guide: string = buildTelegramSetupMarkdown(WEBHOOK_URL);

// The numbered steps under one "### " heading, in order.
const getSteps: (heading: string) => Array<string> = (
  heading: string,
): Array<string> => {
  const sections: Array<string> = guide.split("\n### ");
  const section: string | undefined = sections.find(
    (candidate: string): boolean => {
      return candidate.startsWith(heading);
    },
  );

  expect(section).toBeDefined();

  // The section's first line is its heading ("3. Test end-to-end").
  return (section || "")
    .split("\n")
    .slice(1)
    .filter((line: string): boolean => {
      return NUMBERED_STEP.test(line);
    });
};

const getPermissionTitle: (permission: Permission) => string = (
  permission: Permission,
): string => {
  return (
    PermissionHelper.getAllPermissionProps().find(
      (props: PermissionProps): boolean => {
        return props.permission === permission;
      },
    )?.title || ""
  );
};

describe("the Telegram setup guide's end-to-end test", () => {
  const steps: Array<string> = getSteps("3. Test end-to-end");

  test("is four steps, numbered in order", () => {
    expect(
      steps.map((step: string): string => {
        return step.split(".")[0]!;
      }),
    ).toEqual(["1", "2", "3", "4"]);
  });

  test("has the project switch on before anyone is asked to link an account", () => {
    const switchStep: number = steps.findIndex((step: string): boolean => {
      return step.includes(TELEGRAM_PROJECT_SWITCH_STEP);
    });
    const linkStep: number = steps.findIndex((step: string): boolean => {
      return step.includes("User Settings → Notification Methods → Telegram");
    });

    expect(switchStep).toBe(1);
    expect(linkStep).toBe(2);
    expect(switchStep).toBeLessThan(linkStep);
  });

  test("says exactly who can switch Telegram on, and where", () => {
    expect(TELEGRAM_PROJECT_SWITCH_STEP).toContain(
      "a project owner, a **Billing Admin** or someone with **Manage Billing** turns **Telegram** on in **Project Settings → Notification Settings**, in the **Notification Channels** card.",
    );
    expect(TELEGRAM_PROJECT_SWITCH_STEP).toContain(
      "It starts off in every project, and until it is on nobody in the project can link a Telegram account.",
    );
  });

  test("names the people the switch's update permissions let in, and no project admin", () => {
    // "a project owner, a Billing Admin or someone with Manage Billing"
    expect(
      PROJECT_NOTIFICATION_CHANNEL_UPDATE_PERMISSIONS.map(getPermissionTitle),
    ).toEqual(["Project Owner", "Billing Admin", "Manage Billing"]);

    expect(TELEGRAM_PROJECT_SWITCH_STEP).toContain("project owner");
    expect(TELEGRAM_PROJECT_SWITCH_STEP).toContain("**Billing Admin**");
    expect(TELEGRAM_PROJECT_SWITCH_STEP).toContain("**Manage Billing**");
    expect(TELEGRAM_PROJECT_SWITCH_STEP.toLowerCase()).not.toContain(
      "project admin",
    );
  });

  test("tells users where their own Telegram toggles are, not the project's page", () => {
    expect(steps[3]).toContain(
      "users can toggle Telegram in **User Settings → Notification Settings**",
    );
  });
});

describe("the rest of the guide", () => {
  test("carries this installation's webhook address, in the command and under its heading", () => {
    expect(guide).toContain(`    "url": "${WEBHOOK_URL}",`);
    expect(guide).toContain(`### Webhook endpoint\n- \`${WEBHOOK_URL}\``);
  });

  test("keeps its four sections in order", () => {
    const headings: Array<string> = guide
      .split("\n")
      .filter((line: string): boolean => {
        return line.startsWith("### ");
      });

    expect(headings).toEqual([
      "### What you'll need",
      "### 1. Create a bot and grab its token",
      "### 2. Register the webhook with Telegram",
      "### 3. Test end-to-end",
      "### Webhook endpoint",
    ]);
  });

  test("is what the settings page shows, with the webhook the API answers on", () => {
    const page: string = fs.readFileSync(
      path.join(
        __dirname,
        "..",
        "..",
        "..",
        "..",
        "App",
        "FeatureSet",
        "AdminDashboard",
        "src",
        "Pages",
        "Settings",
        "Telegram",
        "Index.tsx",
      ),
      "utf8",
    );

    expect(page).toContain(
      'import { buildTelegramSetupMarkdown } from "./TelegramSetupGuide";',
    );
    expect(page).toContain("/notification/telegram/webhook");
    expect(page).toContain("<MarkdownViewer text={telegramSetupMarkdown} />");
    // One guide: the page no longer keeps a copy of its own.
    expect(page).not.toContain("### 3. Test end-to-end");
  });
});
