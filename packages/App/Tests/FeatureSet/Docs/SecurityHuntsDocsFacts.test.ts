import { SECURITY_CASES, SECURITY_EVENTS } from "./AiObservabilityDocsPages";
import { DocsHeading, readPage, scanMarkdown } from "./DocsContentSupport";
import { tables } from "./DocsPageShape";
import { SECURITY_CASE_EVIDENCE_COPY } from "../../../FeatureSet/Dashboard/src/Components/SecurityCase/Evidence/SecurityCaseEvidenceCopy";
import {
  ADD_TO_CASE,
  DELETE_HUNT,
  DISCARD_CHANGES,
  EDIT_HUNT,
  HUNTS_MENU_SAVE_AS_HUNT,
  HUNTS_TABLE_TITLE,
  HUNT_SINGULAR,
  SAVE_AS_HUNT,
  SAVE_CHANGES,
  SCHEDULE_LABELS,
  TELL_FIELD_TITLE,
  VIEW_EVENT,
} from "../../../FeatureSet/Dashboard/src/Components/SecurityEvents/Hunts/HuntsCopy";
import {
  SECURITY_EVENTS_MENU,
  SecurityEventsMenuItem,
  SecurityEventsMenuSection,
} from "../../../FeatureSet/Dashboard/src/Utils/SecurityEventsNavigation";
import SecurityCaseEvidence from "Common/Models/DatabaseModels/SecurityCaseEvidence";
import SecurityHunt from "Common/Models/DatabaseModels/SecurityHunt";
import OneUptimeDate from "Common/Types/Date";
import {
  ROLLUP_CATEGORY_BY_EVENT_TYPE,
  RollupCategory,
} from "Common/Types/NotificationSetting/NotificationEmailRollupCategory";
import { isRollupEligible } from "Common/Types/NotificationSetting/NotificationEmailRollupPolicy";
import NotificationSettingEventType from "Common/Types/NotificationSetting/NotificationSettingEventType";
import Permission from "Common/Types/Permission";
import { SECURITY_CASE_EVENT_EVIDENCE_MAX_PER_ADD } from "Common/Types/SecurityCase/SecurityCaseEventEvidence";
import {
  SECURITY_HUNTS_PER_PROJECT_MAX,
  SECURITY_HUNT_MAX_CATCH_UP_IN_MINUTES,
  SECURITY_HUNT_MESSAGES,
  SECURITY_HUNT_RECIPIENTS_MAX,
  SECURITY_HUNT_RETRY_AFTER_FAILURE_IN_MINUTES,
  SECURITY_HUNT_RUN_DELAY_IN_SECONDS,
  SECURITY_HUNT_RUN_ERRORS,
  SECURITY_HUNT_SCHEDULES,
  SecurityHuntRunWindow,
  SecurityHuntSchedule,
  getSecurityHuntIntervalInMinutes,
  getSecurityHuntRetryAt,
  getSecurityHuntRunWindow,
  isScheduledSecurityHunt,
} from "Common/Types/SecurityEvent/SecurityHunt";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * What the Security Events page says about hunts, held to the code that
 * does it: where the list is and what each button is called, who may save
 * one, the schedules and what a run reads, who is told and how, keeping
 * events on a case, and the API. Every bold name is the Dashboard's own word
 * (HuntsCopy and the menus), and every number is the rules' own constant, so
 * a renamed label or a changed limit fails here until the page follows. The
 * security cases page's Evidence line is held to the same words.
 *
 * Their other languages are held line for line to these pages by
 * AiToolingAndSecurityDocsTranslations.
 */

const REPO_DIR: string = path.resolve(__dirname, "..", "..", "..", "..");
const DASHBOARD: string = "App/FeatureSet/Dashboard/src";

const SOURCES: Record<string, string> = {
  notificationSettings: `${DASHBOARD}/Pages/UserSettings/NotificationSettings.tsx`,
  viewer: `${DASHBOARD}/Components/SecurityEvents/SecurityEventsViewer.tsx`,
  detailPanel: `${DASHBOARD}/Components/SecurityEvents/SecurityEventDetailPanel.tsx`,
  addEventsToCase: `${DASHBOARD}/Components/SecurityEvents/Hunts/useAddEventsToCase.tsx`,
  huntsList: `${DASHBOARD}/Pages/SecurityEvents/Hunts.tsx`,
  huntHeader: `${DASHBOARD}/Components/SecurityEvents/Hunts/HuntHeader.tsx`,
  notificationSettingService:
    "Common/Server/Services/UserNotificationSettingService.ts",
  evidenceApi: "Common/Server/API/SecurityCaseEvidenceAPI.ts",
  template: "App/FeatureSet/Notification/Templates/SecurityHuntFound.hbs",
};

const LINE_BREAK: RegExp = /\n/;
const WHITESPACE: RegExp = /\s+/g;
// A handlebars value of the template: {{huntName}}, or a partial's plainText=huntName.
const TEMPLATE_VALUE: RegExp = /(?:\{\{\s*|=)([a-zA-Z]+)(?=\s*\}\}|\s)/g;
// A value that would carry an event's own words: its message, eventName...
const EVENT_VALUE: RegExp = /message|event[A-Z]/;
const HEADING: string = "Hunts";
const MINUTE_IN_MILLISECONDS: number = 60 * 1000;

function source(name: string): string {
  return fs
    .readFileSync(path.join(REPO_DIR, SOURCES[name] as string), "utf8")
    .replace(WHITESPACE, " ");
}

function englishPage(page: string): string {
  return readPage("en", page);
}

// A section of the page, from its heading to the next heading of its level or above.
function section(markdown: string, heading: string): string {
  const headings: Array<DocsHeading> = scanMarkdown(markdown).headings;
  const index: number = headings.findIndex((entry: DocsHeading): boolean => {
    return entry.text === heading;
  });

  expect({ heading, found: index >= 0 }).toEqual({ heading, found: true });

  const start: DocsHeading = headings[index] as DocsHeading;
  const next: DocsHeading | undefined = headings
    .slice(index + 1)
    .find((entry: DocsHeading): boolean => {
      return entry.level <= start.level;
    });
  const lines: Array<string> = markdown.split(LINE_BREAK);

  return lines
    .slice(start.line, next ? next.line - 1 : lines.length)
    .join("\n");
}

// The Hunts section as one line of words, its subsections included.
function hunts(): string {
  return section(englishPage(SECURITY_EVENTS), HEADING).replace(
    WHITESPACE,
    " ",
  );
}

function hasPermission(
  permissions: Array<Permission>,
  permission: Permission,
): boolean {
  return permissions.includes(permission);
}

describe("the Security Events page on hunts", () => {
  it("lists Hunts under Events, right after it, where the menu draws it, and opens the section from a card", () => {
    const events: SecurityEventsMenuSection | undefined =
      SECURITY_EVENTS_MENU.find(
        (menuSection: SecurityEventsMenuSection): boolean => {
          return menuSection.title === "Events";
        },
      );
    const titles: Array<string> = (events?.items || []).map(
      (item: SecurityEventsMenuItem): string => {
        return item.title;
      },
    );

    expect(titles.slice(0, 2)).toEqual(["Events", HUNTS_TABLE_TITLE]);

    const page: string = englishPage(SECURITY_EVENTS);

    expect(page).toContain(
      `| **${HUNTS_TABLE_TITLE}** | Events | Searches saved from Events, opened again in one click or run on a schedule that tells people when they find something |`,
    );
    expect(page).toContain(
      "- [Hunts](#hunts): Saved searches that run on a schedule and tell people when they find something.",
    );
  });

  it("names the toolbar's list, its save, the list's create button and the hunt's buttons as the Dashboard draws them", () => {
    // The toolbar's list is titled Hunts, and saves the search with + Save as Hunt.
    expect(HUNTS_MENU_SAVE_AS_HUNT).toBe(`+ ${SAVE_AS_HUNT}`);
    expect(source("viewer")).toContain("toolbarLeadingActions={ <HuntsMenu");
    expect(source("huntsList")).toContain("singularName={HUNT_SINGULAR}");
    expect(source("huntsList")).toContain("isCreateable={true}");

    // The hunt's header draws its buttons from the same words.
    for (const drawn of [
      "title: SAVE_CHANGES,",
      "title: DISCARD_CHANGES,",
      "title: EDIT_HUNT,",
      "text={DELETE_HUNT}",
    ]) {
      expect(source("huntHeader")).toContain(drawn);
    }

    const text: string = hunts();

    expect(text).toContain(
      `then open **${HUNTS_TABLE_TITLE}** on the toolbar and choose **${SAVE_AS_HUNT}**.`,
    );
    expect(text).toContain(`**Events → ${HUNTS_TABLE_TITLE}** lists`);
    expect(text).toContain(`**Create ${HUNT_SINGULAR}** there takes`);
    expect(text).toContain(
      `the hunt's header offers **${SAVE_CHANGES}** and **${DISCARD_CHANGES}**.`,
    );
    expect(text).toContain(`**${EDIT_HUNT}** changes its name`);
    expect(text).toContain(`**${DELETE_HUNT}** is in its menu.`);
  });

  it("says how many hunts a project keeps, as the save refuses one more", () => {
    expect(SECURITY_HUNTS_PER_PROJECT_MAX).toBe(200);
    expect(SECURITY_HUNT_MESSAGES.tooManyHunts.message).toContain(
      `at most ${SECURITY_HUNTS_PER_PROJECT_MAX} hunts`,
    );
    expect(hunts()).toContain(
      `A project keeps up to ${SECURITY_HUNTS_PER_PROJECT_MAX} hunts.`,
    );
  });

  it("says a Security Member may save, change and delete hunts, and a Security Viewer only open them, as the model allows", () => {
    const hunt: SecurityHunt = new SecurityHunt();

    for (const permissions of [
      hunt.getCreatePermissions(),
      hunt.getUpdatePermissions(),
      hunt.getDeletePermissions(),
    ]) {
      expect(hasPermission(permissions, Permission.SecurityMember)).toBe(true);
      expect(hasPermission(permissions, Permission.SecurityViewer)).toBe(false);
    }

    expect(
      hasPermission(hunt.getReadPermissions(), Permission.SecurityViewer),
    ).toBe(true);
    expect(hunts()).toContain(
      "A Security Member or higher can save, change and delete hunts, and a Security Viewer can open them.",
    );
  });

  it("lists every schedule in the dropdown's order, the one that does not run first", () => {
    const notScheduled: SecurityHuntSchedule = SECURITY_HUNT_SCHEDULES[0]!;
    const scheduled: Array<SecurityHuntSchedule> =
      SECURITY_HUNT_SCHEDULES.slice(1);

    expect(notScheduled).toBe(SecurityHuntSchedule.NotScheduled);
    expect(isScheduledSecurityHunt(notScheduled)).toBe(false);
    expect(getSecurityHuntIntervalInMinutes(notScheduled)).toBeNull();

    // The others run on their own, each less often than the one before it.
    const intervals: Array<number | null> = scheduled.map(
      (schedule: SecurityHuntSchedule): number | null => {
        return getSecurityHuntIntervalInMinutes(schedule);
      },
    );

    expect(intervals).toEqual([60, 6 * 60, 24 * 60, 7 * 24 * 60]);

    const schedules: Array<Array<Array<string>>> = tables(
      section(englishPage(SECURITY_EVENTS), "Run a hunt on a schedule"),
    );

    expect(schedules).toHaveLength(1);
    expect(schedules[0]).toEqual([
      ["Schedule", "Runs"],
      [`**${SCHEDULE_LABELS[notScheduled]}**`, "Only when you open it"],
      [
        scheduled
          .map((schedule: SecurityHuntSchedule): string => {
            return `**${SCHEDULE_LABELS[schedule]}**`;
          })
          .join(", "),
        "On its own, that often",
      ],
    ]);
  });

  it("says who a scheduled hunt tells, under the form's own field, and how many it may tell", () => {
    expect(TELL_FIELD_TITLE).toBe("Notify");
    expect(SECURITY_HUNT_RECIPIENTS_MAX).toBe(50);
    expect(SECURITY_HUNT_MESSAGES.tooManyRecipients.message).toBe(
      `A hunt tells at most ${SECURITY_HUNT_RECIPIENTS_MAX} people and teams.`,
    );
    expect(SECURITY_HUNT_MESSAGES.chooseRecipients.message).toContain(
      "a person or a team",
    );
    expect(hunts()).toContain(
      `A scheduled hunt tells the people and teams you choose under **${TELL_FIELD_TITLE}**: at least one, and at most ${SECURITY_HUNT_RECIPIENTS_MAX} in all.`,
    );
  });

  it("says what a run reads: after the run before, up to two minutes ago, and a day more than its interval after an outage", () => {
    expect(SECURITY_HUNT_RUN_DELAY_IN_SECONDS).toBe(2 * 60);
    expect(SECURITY_HUNT_MAX_CATCH_UP_IN_MINUTES).toBe(24 * 60);

    const now: Date = new Date("2026-10-29T12:00:00.000Z");
    const twoMinutesAgo: Date = new Date("2026-10-29T11:58:00.000Z");

    // From where the run before stopped, to two minutes ago: no event twice.
    const next: SecurityHuntRunWindow | null = getSecurityHuntRunWindow({
      schedule: SecurityHuntSchedule.EveryHour,
      searchedUpTo: new Date("2026-10-29T10:58:00.000Z"),
      now,
    });

    expect(next?.startTime.toISOString()).toBe("2026-10-29T10:58:00.001Z");
    expect(next?.endTime.toISOString()).toBe(twoMinutesAgo.toISOString());

    // After three days without a run, an hourly hunt reads a day and an hour.
    const caughtUp: SecurityHuntRunWindow | null = getSecurityHuntRunWindow({
      schedule: SecurityHuntSchedule.EveryHour,
      searchedUpTo: OneUptimeDate.addRemoveDays(now, -3),
      now,
    });

    expect(
      ((caughtUp?.endTime.getTime() || 0) -
        (caughtUp?.startTime.getTime() || 0)) /
        MINUTE_IN_MILLISECONDS,
    ).toBe(60 + SECURITY_HUNT_MAX_CATCH_UP_IN_MINUTES);

    // A hunt that does not run on its own has nothing to read.
    expect(
      getSecurityHuntRunWindow({
        schedule: SecurityHuntSchedule.NotScheduled,
        searchedUpTo: null,
        now,
      }),
    ).toBeNull();

    const text: string = hunts();

    expect(text).toContain(
      "reads the events whose time falls after the run before, up to two minutes ago, so every event is searched once.",
    );
    expect(text).toContain(
      "after an outage a run catches up on at most a day more than its interval.",
    );
  });

  it("says a run that failed is tried again within the hour, however rarely it runs", () => {
    expect(SECURITY_HUNT_RETRY_AFTER_FAILURE_IN_MINUTES).toBe(60);

    const now: Date = new Date("2026-10-29T12:00:00.000Z");

    for (const schedule of [
      SecurityHuntSchedule.EveryHour,
      SecurityHuntSchedule.EverySixHours,
      SecurityHuntSchedule.EveryDay,
      SecurityHuntSchedule.EveryWeek,
    ]) {
      expect({
        schedule,
        retryAt: getSecurityHuntRetryAt({ schedule, now })?.toISOString(),
      }).toEqual({ schedule, retryAt: "2026-10-29T13:00:00.000Z" });
    }

    expect(hunts()).toContain(
      "says why on the hunt and is tried again within the hour, from where it stopped.",
    );
  });

  it("says a run opens no case and links the rules that do", () => {
    expect(hunts()).toContain(
      "A run opens no case and raises no alert: write what should open cases as a [detection rule](#detection-rules).",
    );
  });

  it("says who a hunt runs as, that an API key cannot set a schedule, and what to do when that person cannot read", () => {
    expect(SECURITY_HUNT_MESSAGES.scheduleNeedsPerson.message).toBe(
      "Only a person can set a hunt's schedule: its runs read what that person can read.",
    );
    expect(SECURITY_HUNT_RUN_ERRORS.schedulerCannotRead.message).toBe(
      "The person it runs as can no longer read security events in this project. Edit the hunt and save it to run it as you.",
    );

    const text: string = hunts();

    expect(text).toContain("An API key cannot set a schedule.");
    expect(text).toContain(
      `When that person leaves the project or can no longer read security events, the hunt says so: open **${EDIT_HUNT}** and save it to run it as you.`,
    );
  });

  it("names the notification as Notification Settings draws it, sent by email and push, and rolled up like other routine emails", () => {
    expect(source("notificationSettings")).toContain(
      '[NotificationSettingEventType.SEND_SECURITY_HUNT_FOUND_NOTIFICATION]: { label: "Hunt found security events",',
    );
    // Email is on for every setting; push is turned on for this one.
    expect(source("notificationSettingService")).toContain(
      "NotificationSettingEventType.SEND_SECURITY_HUNT_FOUND_NOTIFICATION, { alertByPush: true },",
    );
    expect(
      ROLLUP_CATEGORY_BY_EVENT_TYPE[
        NotificationSettingEventType.SEND_SECURITY_HUNT_FOUND_NOTIFICATION
      ],
    ).toBe(RollupCategory.SecurityHunts);
    expect(
      isRollupEligible(
        NotificationSettingEventType.SEND_SECURITY_HUNT_FOUND_NOTIFICATION,
      ),
    ).toBe(true);

    const text: string = hunts();

    expect(text).toContain(
      "The notification **Hunt found security events** names the hunt and its search,",
    );
    expect(text).toContain(
      "Everyone has it by email and push, and chooses its channels under **User Settings → Notification Settings**.",
    );
    expect(text).toContain(
      "it can be held back in an [email rollup](/docs/emails/notification-rollup).",
    );
  });

  it("says the email carries no event's own words: only the hunt, what its run found, and the way to it", () => {
    const values: Array<string> = Array.from(
      new Set(
        Array.from(source("template").matchAll(TEMPLATE_VALUE)).map(
          (match: RegExpMatchArray): string => {
            return match[1] as string;
          },
        ),
      ),
    ).sort();

    expect(values).toEqual(
      expect.arrayContaining([
        "foundText",
        "huntName",
        "huntSearch",
        "huntViewLink",
        "projectName",
        "windowText",
      ]),
    );

    for (const value of values) {
      expect({ value, aboutAnEvent: EVENT_VALUE.test(value) }).toEqual({
        value,
        aboutAnEvent: false,
      });
    }

    expect(hunts()).toContain(
      "and links to the hunt's page on those events; no event's own words are in it.",
    );
  });

  it("keeps events on a case from the list's Bulk Actions and from one event's panel, as many at a time as the server takes", () => {
    expect(SECURITY_CASE_EVENT_EVIDENCE_MAX_PER_ADD).toBe(100);
    expect(source("addEventsToCase")).toContain("title: ADD_TO_CASE,");
    expect(source("viewer")).toContain(
      "bulk={{ buttons: addToCase.bulkActions,",
    );
    expect(source("detailPanel")).toContain("<AddEventToCaseButton");

    const text: string = hunts();

    expect(text).toContain(
      `choose **Bulk Actions → ${ADD_TO_CASE}**, or open one event and choose **${ADD_TO_CASE}**.`,
    );
    expect(text).toContain(
      `Up to ${SECURITY_CASE_EVENT_EVIDENCE_MAX_PER_ADD} events go at a time.`,
    );
    expect(text).toContain(
      `keeps it on the case's **${SECURITY_CASE_EVIDENCE_COPY.title}** page as it was`,
    );
    expect(text).toContain(
      `An event found from a hunt names the hunt, and **${VIEW_EVENT}** opens it as it was kept.`,
    );
  });

  it("names the API's routes as the server serves them", () => {
    expect(new SecurityHunt().getCrudApiPath()?.toString()).toBe(
      "/security-hunt",
    );
    expect(new SecurityCaseEvidence().getCrudApiPath()?.toString()).toBe(
      "/security-case-evidence",
    );
    expect(source("evidenceApi")).toContain(
      "`${new this.entityType().getCrudApiPath()?.toString()}/add-events`",
    );
    expect(hunts()).toContain(
      "Hunts have the same REST API as the rest of OneUptime, under `/security-hunt`, and `POST /security-case-evidence/add-events` keeps events on a case.",
    );
  });
});

describe("the Security Cases page's Evidence", () => {
  it("names security events beside files and links, how they are kept, and links the hunts section", () => {
    const evidence: string | undefined = englishPage(SECURITY_CASES)
      .split(LINE_BREAK)
      .find((line: string): boolean => {
        return line.startsWith(`- **${SECURITY_CASE_EVIDENCE_COPY.title}**:`);
      });

    expect(evidence).toBeDefined();
    expect(evidence).toContain(
      "the files, links and security events kept on the case, each with who added it and when.",
    );
    expect(evidence).toContain(
      `A security event is kept here as it was, with **${ADD_TO_CASE}** on **Events** or on a [hunt's](/docs/telemetry/security-events#hunts) page, and **${VIEW_EVENT}** opens it.`,
    );
    // The link opens the section this suite holds.
    expect(
      scanMarkdown(englishPage(SECURITY_EVENTS)).headings.map(
        (heading: DocsHeading): string => {
          return heading.text;
        },
      ),
    ).toContain(HEADING);
  });
});
