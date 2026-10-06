import Project from "Common/Models/DatabaseModels/Project";
import Permission from "Common/Types/Permission";
import {
  PROJECT_NOTIFICATION_CHANNEL_COLUMNS,
  PROJECT_NOTIFICATION_CHANNEL_UPDATE_PERMISSIONS,
  ProjectNotificationChannel,
} from "Common/Utils/Project/NotificationChannels";
import ProjectNotificationChannelsCopy from "../../../FeatureSet/Dashboard/src/Components/NotificationMethods/ProjectNotificationChannelsCopy";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The docs say who may turn on a project's SMS, phone calls, WhatsApp and
 * Telegram the way the product does: a project owner or someone with Manage
 * Billing (the four columns' own update permissions) - not a project admin.
 * Held to the model here, so the docs cannot keep naming the people after the
 * permissions change, or the reverse.
 */

const CONTENT: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "FeatureSet",
  "Docs",
  "Content",
  "en",
);

// Line breaks read as one space, so a claim may wrap anywhere.
function readPage(relative: string): string {
  return fs
    .readFileSync(path.join(CONTENT, relative), "utf8")
    .replace(/\s*\n\s*/g, " ");
}

const CARD: string = `**${ProjectNotificationChannelsCopy.cardTitle}**`;
const PAGE: string = "**Project Settings > Notifications > Notification Settings**";

describe("the people the docs name", () => {
  test("are the people the columns let in", () => {
    const project: Project = new Project();

    for (const channel of Object.values(ProjectNotificationChannel)) {
      const column: string = PROJECT_NOTIFICATION_CHANNEL_COLUMNS[channel];

      expect([column, project.getColumnAccessControlFor(column)?.update]).toEqual(
        [column, [Permission.ProjectOwner, Permission.ManageProjectBilling]],
      );
    }

    expect([...PROJECT_NOTIFICATION_CHANNEL_UPDATE_PERMISSIONS]).toEqual([
      Permission.ProjectOwner,
      Permission.ManageProjectBilling,
    ]);
  });
});

describe("Users, Teams & Permissions", () => {
  const page: string = readPage("permissions/index.md");

  test("says turning a channel on counts as billing: ProjectOwner and ManageProjectBilling, not ProjectAdmin", () => {
    expect(page).toContain(
      "Turning SMS, phone calls, WhatsApp or Telegram on or off for the project counts as billing, because every message costs money.",
    );
    expect(page).toContain(
      "Only `ProjectOwner` and the `ManageProjectBilling` permission (**Manage Billing**) can change those switches, on **Project Settings > Notifications > Notification Settings** — not `ProjectAdmin`.",
    );
  });
});

describe("Escalation Rules", () => {
  const page: string = readPage("on-call/escalation-rules.md");

  test("says the four channels start off, who can turn them on, and where", () => {
    expect(page).toContain(
      "SMS, phone calls, WhatsApp and Telegram start off in a new project",
    );
    expect(page).toContain(
      "Until a channel is on, nobody in the project can add a method on it.",
    );
    expect(page).toContain(
      `Only a project owner or someone with the **Manage Billing** permission can turn one on, in the ${CARD} card on ${PAGE} — a project admin cannot.`,
    );
    expect(page).toContain(
      "Everyone else is told exactly who can, wherever a channel is off",
    );
  });
});

describe("Status page subscribers", () => {
  const page: string = readPage("status-pages/subscribers.md");

  test("the SMS line names the project switch and who can turn it on", () => {
    expect(page).toContain(
      `Turning it on also needs **SMS** switched on for the project, in the ${CARD} card on ${PAGE}, which a project owner or someone with **Manage Billing** can do.`,
    );
  });
});

describe("Incoming Call Policy", () => {
  const page: string = readPage("on-call/incoming-call-policy.md");

  test("says incoming call numbers need SMS on, and who can turn it on", () => {
    expect(page).toContain(
      `Incoming call numbers are verified by SMS, so **SMS** has to be on for the project first. A project owner or someone with **Manage Billing** turns it on in the ${CARD} card on ${PAGE}.`,
    );
  });
});

describe("no docs page sends a reader to a project admin for a channel", () => {
  test.each([
    "permissions/index.md",
    "on-call/escalation-rules.md",
    "status-pages/subscribers.md",
    "on-call/incoming-call-policy.md",
  ])("%s", (relative: string) => {
    expect(readPage(relative)).not.toMatch(
      /(ask|needs?) a project admin[^.]*(SMS|call|WhatsApp|Telegram|channel)/i,
    );
  });
});
