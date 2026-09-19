import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import {
  DEFAULT_DOCS_LANGUAGE,
  SUPPORTED_DOCS_LANGUAGE_CODES,
} from "../../../FeatureSet/Docs/Utils/I18n";
import {
  TIMELINE_MAX_FUTURE_DAYS,
  TIMELINE_MAX_PAST_DAYS,
  TIMELINE_MAX_SCHEDULES,
} from "Common/Types/OnCallDutyPolicy/ScheduleTimeline";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * Registration and drift checks for the "Schedule Timeline" docs page. Like
 * every on-call page it ships in every docs language, is linked from the On
 * Call nav group, and repeats facts that live in code (the look-back and
 * look-ahead limits, the schedule cap, the dashboard's labels). These read
 * the code's own values so the page cannot quietly go stale.
 */

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Locales",
);

const DASHBOARD_SRC: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Dashboard/src",
);

const PAGE_RELATIVE_PATH: string = "on-call/schedule-timeline";
const PAGE_URL: string = `/docs/${PAGE_RELATIVE_PATH}`;
const PAGE_TITLE: string = "Schedule Timeline";

function readPage(lang: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, lang, `${PAGE_RELATIVE_PATH}.md`),
    "utf8",
  );
}

function headingOutline(markdown: string): Array<number> {
  return Array.from(markdown.matchAll(/^(#{1,6}) /gm)).map(
    (match: RegExpMatchArray): number => {
      return (match[1] || "").length;
    },
  );
}

function onCallGroup(): NavGroup {
  const group: NavGroup | undefined = DocsNav.find((item: NavGroup) => {
    return item.title === "On Call";
  });

  if (!group) {
    throw new Error("On Call nav group not found");
  }

  return group;
}

describe("Schedule Timeline docs page", () => {
  describe("navigation", () => {
    it("is linked from the On Call group, first", () => {
      const links: Array<NavLink> = onCallGroup().links;

      expect(links[0]).toEqual({ title: PAGE_TITLE, url: PAGE_URL });
    });

    it("has a nav title in every docs language", () => {
      for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
        const locale: { navLinks?: Record<string, string> } = JSON.parse(
          fs.readFileSync(path.join(LOCALES_DIR, `${lang}.json`), "utf8"),
        ) as { navLinks?: Record<string, string> };

        const title: string | undefined = locale.navLinks?.[PAGE_TITLE];

        expect({
          lang,
          ok: typeof title === "string" && title.length > 0,
        }).toEqual({
          lang,
          ok: true,
        });
      }
    });
  });

  describe("translations", () => {
    it("exists in every supported language", () => {
      for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
        expect({
          lang,
          exists: fs.existsSync(
            path.join(CONTENT_DIR, lang, `${PAGE_RELATIVE_PATH}.md`),
          ),
        }).toEqual({ lang, exists: true });
      }
    });

    it("keeps the English heading outline in every translation", () => {
      const english: Array<number> = headingOutline(
        readPage(DEFAULT_DOCS_LANGUAGE),
      );

      expect(english[0]).toBe(1);
      expect(english.length).toBeGreaterThan(4);

      for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
        expect({ lang, outline: headingOutline(readPage(lang)) }).toEqual({
          lang,
          outline: english,
        });
      }
    });
  });

  describe("facts that live in code", () => {
    it("quotes the look-back, look-ahead and schedule limits in every language", () => {
      for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
        const page: string = readPage(lang);

        for (const value of [
          TIMELINE_MAX_PAST_DAYS,
          TIMELINE_MAX_FUTURE_DAYS,
          TIMELINE_MAX_SCHEDULES,
        ]) {
          expect({ lang, value, found: page.includes(String(value)) }).toEqual({
            lang,
            value,
            found: true,
          });
        }
      }
    });

    it("names the dashboard's menu, button and team page as the code does", () => {
      const english: string = readPage(DEFAULT_DOCS_LANGUAGE);
      const onCallMenu: string = fs.readFileSync(
        path.join(DASHBOARD_SRC, "Pages", "OnCallDuty", "SideMenu.tsx"),
        "utf8",
      );
      const teamMenu: string = fs.readFileSync(
        path.join(DASHBOARD_SRC, "Pages", "Teams", "View", "SideMenu.tsx"),
        "utf8",
      );
      const schedulesPage: string = fs.readFileSync(
        path.join(
          DASHBOARD_SRC,
          "Pages",
          "OnCallDuty",
          "OnCallDutySchedules.tsx",
        ),
        "utf8",
      );

      expect(english).toContain("**On-Call Duty** > **Schedule Timeline**");
      expect(onCallMenu).toContain('title: "Schedule Timeline"');

      expect(english).toContain("**Timeline View**");
      expect(schedulesPage).toContain('title: "Timeline View"');

      expect(english).toContain("**Teams** > a team > **On-Call Schedules**");
      expect(teamMenu).toContain('title: "On-Call Schedules"');
    });

    it("uses the override marker the grid draws", () => {
      const presentation: string = fs.readFileSync(
        path.join(
          DASHBOARD_SRC,
          "Components",
          "OnCallPolicy",
          "OnCallScheduleLayer",
          "OverridePresentation.ts",
        ),
        "utf8",
      );

      expect(presentation).toContain('OVERRIDE_TITLE_MARKER: string = "⇄"');

      for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
        expect({ lang, ok: readPage(lang).includes("**⇄**") }).toEqual({
          lang,
          ok: true,
        });
      }
    });
  });
});
