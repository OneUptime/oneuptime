import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import {
  SUPPORTED_DOCS_LANGUAGE_CODES,
  getLocalizedNav,
} from "../../../FeatureSet/Docs/Utils/I18n";
import OnCallDutyPolicySchedule from "Common/Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyScheduleLayer from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import EventInterval from "Common/Types/Events/EventInterval";
import {
  SCHEDULE_FIRST_LAYER_ROTATION_KEY,
  SCHEDULE_FIRST_LAYER_USERS_KEY,
} from "Common/Types/OnCallDutyPolicy/ScheduleFirstLayer";
import {
  DEFAULT_LAYER_ROTATION_INTERVAL_COUNT,
  DEFAULT_LAYER_ROTATION_INTERVAL_TYPE,
  getDefaultLayerRotation,
  getLayerName,
} from "Common/Types/OnCallDutyPolicy/ScheduleLayerDefaults";
import { MORE_FIELDS_SECTION_TITLE } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import { describe, expect, it } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The "On-Call Schedules" docs page against the form, the server and the API
 * it describes.
 *
 * Creating an on-call schedule asks who takes turns, and the people picked
 * become the schedule's first layer. Markdown is not compiled, so nothing
 * else notices when the form's titles, the turn lengths, the "Layer N" name,
 * the side menu entry, the misc data keys or the API routes change. These
 * tests read the sources of truth - the nav, the create form's module, the
 * schedules page, the side menus, the shared layer defaults, the server's
 * keys, the models' routes - and check every language's page still tells the
 * same story, with the words that language's dashboard shows.
 */

const REPO_ROOT: string = path.resolve(__dirname, "../../../..");

const CONTENT_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Content",
);

const DOCS_LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Docs/Locales",
);

const DASHBOARD_LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Dashboard/src/Locales",
);

const NAV_GROUP_TITLE: string = "On Call";
const PAGE_TITLE: string = "On-Call Schedules";
const PAGE_RELATIVE_PATH: string = "on-call/schedules";
const PAGE_URL: string = `/docs/${PAGE_RELATIVE_PATH}`;

const CREATE_FORM_FILE: string =
  "App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleCreateForm.ts";
const SCHEDULES_PAGE_FILE: string =
  "App/FeatureSet/Dashboard/src/Pages/OnCallDuty/OnCallDutySchedules.tsx";
const ON_CALL_SIDE_MENU_FILE: string =
  "App/FeatureSet/Dashboard/src/Pages/OnCallDuty/SideMenu.tsx";
const SCHEDULE_SIDE_MENU_FILE: string =
  "App/FeatureSet/Dashboard/src/Pages/OnCallDuty/OnCallDutySchedule/SideMenu.tsx";
const LAYERS_FILE: string =
  "App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/Layers.tsx";
const PERSON_COLORS_FILE: string =
  "App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayerUserColors.ts";
const TIMELINE_MODEL_FILE: string =
  "App/FeatureSet/Dashboard/src/Components/OnCallPolicy/ScheduleTimeline/TimelineModel.ts";
const TIMELINE_PAGE_TITLE: string = "Schedule Timeline";

const QUESTION: string = "Who takes turns?";
const TURN_LENGTH: string = "Each turn lasts";
const TURN_LENGTHS: Array<string> = ["1 day", "1 week", "2 weeks", "1 month"];

// What every language's first section names, by the dashboard's words.
const FORM_LABELS: Array<string> = [
  PAGE_TITLE,
  "Name",
  QUESTION,
  "Add user",
  "Layers",
  MORE_FIELDS_SECTION_TITLE,
  TURN_LENGTH,
  ...TURN_LENGTHS,
  "Timezone",
  "Description",
  "Labels",
];

const ROTATION_EXAMPLE: string =
  '`{"_type": "Recurring", "value": {"intervalType": "Week", "intervalCount": 1}}`';

function readRepoFile(relative: string): string {
  return fs.readFileSync(path.join(REPO_ROOT, relative), "utf8");
}

function readPage(lang: string): string {
  return fs.readFileSync(
    path.join(CONTENT_DIR, lang, `${PAGE_RELATIVE_PATH}.md`),
    "utf8",
  );
}

function readDocsLocale(lang: string): { navLinks: Record<string, string> } {
  return JSON.parse(
    fs.readFileSync(path.join(DOCS_LOCALES_DIR, `${lang}.json`), "utf8"),
  );
}

// The words a language's dashboard shows: English where it has none.
function readDashboardLocale(lang: string): Record<string, string> {
  const locale: Record<string, string> = JSON.parse(
    fs.readFileSync(path.join(DASHBOARD_LOCALES_DIR, `${lang}.json`), "utf8"),
  );

  return new Proxy(locale, {
    get: (target: Record<string, string>, key: string): string => {
      return target[key] || key;
    },
  });
}

// The page's "## " sections, by heading, with their text.
function sections(markdown: string): Array<{ heading: string; body: string }> {
  const found: Array<{ heading: string; body: string }> = [];

  for (const part of markdown.split(/^## /m).slice(1)) {
    const newline: number = part.indexOf("\n");

    found.push({
      heading: part.slice(0, newline).trim(),
      body: part.slice(newline + 1),
    });
  }

  return found;
}

function apiRoute(path: string | undefined): string {
  return `\`/api${String(path)}\``;
}

const SCHEDULES_ROUTE: string = apiRoute(
  new OnCallDutyPolicySchedule().crudApiPath?.toString(),
);
const LAYERS_ROUTE: string = apiRoute(
  new OnCallDutyPolicyScheduleLayer().crudApiPath?.toString(),
);
const LAYER_USERS_ROUTE: string = apiRoute(
  new OnCallDutyPolicyScheduleLayerUser().crudApiPath?.toString(),
);

const ENGLISH: string = readPage("en");

function onCallGroup(): NavGroup {
  const group: NavGroup | undefined = DocsNav.find((candidate: NavGroup) => {
    return candidate.title === NAV_GROUP_TITLE;
  });

  if (!group) {
    throw new Error("No On Call nav group");
  }

  return group;
}

describe("the On-Call Schedules docs page", () => {
  describe("in the nav", () => {
    it("is linked from the On Call group, right after the escalation rules", () => {
      const links: Array<NavLink> = onCallGroup().links;

      // The overview, the policies and their escalation rules come first.
      expect(links[0]?.title).toBe("On-Call Overview");
      expect(links[1]?.title).toBe("On-Call Policies");
      expect(links[2]?.title).toBe("Escalation Rules");
      expect(links[3]).toEqual({ title: PAGE_TITLE, url: PAGE_URL });
      expect(
        links.filter((link: NavLink): boolean => {
          return link.url === PAGE_URL;
        }),
      ).toHaveLength(1);
    });

    it.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
      "is named in %s, and the page is titled as its link",
      (lang: string) => {
        const title: string | undefined =
          readDocsLocale(lang).navLinks[PAGE_TITLE];

        expect(typeof title).toBe("string");
        expect(title!.trim().length).toBeGreaterThan(0);

        if (lang !== "en") {
          expect(title).not.toBe(PAGE_TITLE);
        }

        // As the dashboard's side menu names the page in that language.
        expect(title).toBe(readDashboardLocale(lang)[PAGE_TITLE]);

        const localized: Array<string> = getLocalizedNav(lang).flatMap(
          (group: { links: Array<{ title: string; url: string }> }) => {
            return group.links
              .filter((link: { url: string }): boolean => {
                return link.url.endsWith(PAGE_RELATIVE_PATH);
              })
              .map((link: { title: string }): string => {
                return link.title;
              });
          },
        );

        expect(localized).toEqual([title]);
        expect(readPage(lang).split("\n")[0]).toBe(`# ${title}`);
      },
    );
  });

  describe("in English", () => {
    const pageSections: Array<{ heading: string; body: string }> =
      sections(ENGLISH);

    it("has its three sections, in order", () => {
      expect(
        pageSections.map((section: { heading: string }): string => {
          return section.heading;
        }),
      ).toEqual([
        "Who takes turns",
        "Layers",
        "Creating schedules with the API or Terraform",
      ]);
    });

    it("names the question and the fields the create form draws", () => {
      const form: string = readRepoFile(CREATE_FORM_FILE);
      const first: string = pageSections[0]!.body;

      for (const title of [
        "Name",
        QUESTION,
        TURN_LENGTH,
        "Timezone",
        "Description",
      ]) {
        expect(form).toContain(`title: "${title}"`);
        expect(first).toContain(`**${title}**`);
      }

      expect(form).toContain('translationKey("Add user")');
      expect(first).toContain("**Add user**");

      for (const length of TURN_LENGTHS) {
        expect(form).toContain(`translationKey("${length}")`);
        expect(first).toContain(`**${length}**`);
      }

      expect(first).toContain("**Labels**");
      expect(first).toContain(`**${MORE_FIELDS_SECTION_TITLE}**`);
    });

    it("sends readers to the side menu entries the dashboard really has", () => {
      expect(readRepoFile(ON_CALL_SIDE_MENU_FILE)).toContain(
        `title: "${PAGE_TITLE}"`,
      );
      expect(readRepoFile(SCHEDULE_SIDE_MENU_FILE)).toContain(
        'title: "Layers"',
      );
      expect(pageSections[0]!.body).toContain(`**${PAGE_TITLE}** page`);
      expect(pageSections[0]!.body).toContain("**Layers** page");
    });

    it("states the first layer the server makes: Layer 1, a week per person, around the clock", () => {
      const first: string = pageSections[0]!.body;

      expect(getLayerName(1)).toBe("Layer 1");
      expect(first).toContain(`**${getLayerName(1)}**`);
      expect(first).toContain("on call around the clock");

      expect(DEFAULT_LAYER_ROTATION_INTERVAL_TYPE).toBe(EventInterval.Week);
      expect(DEFAULT_LAYER_ROTATION_INTERVAL_COUNT).toBe(1);
      expect(first).toContain("**1 week** unless you change it");
      expect(first).toContain(
        "each person is on call for a week, then the next one takes over",
      );
    });

    it("says where a new schedule opens, as the schedules page sends it there", () => {
      expect(readRepoFile(SCHEDULES_PAGE_FILE)).toContain(
        "PageMap.ON_CALL_DUTY_SCHEDULE_VIEW_LAYERS",
      );
      expect(pageSections[0]!.body).toContain(
        "The new schedule then opens on its **Layers** page",
      );
    });

    it("says the question is optional, and what an empty one means", () => {
      const first: string = pageSections[0]!.body;

      expect(first).toContain(`**${QUESTION}** is optional`);
      expect(first).toContain("puts nobody on call until you add a layer");
    });

    it("says Add Layer starts a layer the same way", () => {
      expect(readRepoFile(LAYERS_FILE)).toContain('title="Add Layer"');
      expect(pageSections[1]!.body).toContain(
        "**Add Layer** adds a layer that starts the way the first one does: on call from now, each person for a week, around the clock.",
      );
    });

    it("says each person keeps one colour, as the layer cards and the timeline both draw it", () => {
      const layers: string = pageSections[1]!.body;

      expect(layers).toContain(
        "Each person keeps one colour everywhere, so you can follow them at a glance",
      );
      expect(layers).toContain(`**${TIMELINE_PAGE_TITLE}**`);

      // One colour rule, worked out from the person, that the timeline asks too.
      expect(readRepoFile(PERSON_COLORS_FILE)).toContain("pickColorForName(");
      expect(readRepoFile(TIMELINE_MODEL_FILE)).toContain(
        "OnCallScheduleLayer/LayerUserColors",
      );
    });

    it("gives the API: the routes, the misc data keys the server reads and the rotation's shape", () => {
      const api: string = pageSections[2]!.body;

      for (const fact of [
        SCHEDULES_ROUTE,
        LAYERS_ROUTE,
        LAYER_USERS_ROUTE,
        "`miscDataProps`",
        `\`${SCHEDULE_FIRST_LAYER_USERS_KEY}\``,
        `\`${SCHEDULE_FIRST_LAYER_ROTATION_KEY}\``,
        "`rotation`",
        ROTATION_EXAMPLE,
        "Terraform's schedule resource does not send them",
        "hands off daily",
      ]) {
        expect({ fact, found: api.includes(fact) }).toEqual({
          fact,
          found: true,
        });
      }

      // The example is the default rotation, as it is written down.
      expect(ROTATION_EXAMPLE).toContain(
        `"intervalType": "${getDefaultLayerRotation().intervalType}"`,
      );
      expect(ROTATION_EXAMPLE).toContain(
        `"intervalCount": ${getDefaultLayerRotation().intervalCount.toNumber()}`,
      );
    });
  });

  /*
   * Each translation has the same three sections, names the form with the
   * words that language's dashboard shows, and gives the same API facts.
   */
  describe("in every docs language", () => {
    it("is mirrored in every docs language", () => {
      for (const lang of SUPPORTED_DOCS_LANGUAGE_CODES) {
        expect({
          lang,
          exists: fs.existsSync(
            path.join(CONTENT_DIR, lang, `${PAGE_RELATIVE_PATH}.md`),
          ),
        }).toEqual({ lang, exists: true });
      }
    });

    it.each(SUPPORTED_DOCS_LANGUAGE_CODES)(
      "%s tells the same story",
      (lang: string) => {
        const page: string = readPage(lang);
        const dashboard: Record<string, string> = readDashboardLocale(lang);
        const pageSections: Array<{ heading: string; body: string }> =
          sections(page);

        expect(pageSections).toHaveLength(3);

        // One title, three sections, nothing deeper.
        expect(page.match(/^# /gm)).toHaveLength(1);
        expect(page.match(/^### /gm)).toBeNull();

        const first: string = pageSections[0]!.body;
        const layers: string = pageSections[1]!.body;
        const api: string = pageSections[2]!.body;

        for (const label of FORM_LABELS) {
          expect({
            lang,
            label,
            found: first.includes(`**${dashboard[label]}**`),
          }).toEqual({
            lang,
            label,
            found: true,
          });
        }

        expect({
          lang,
          found: first.includes(`**${getLayerName(1)}**`),
        }).toEqual({ lang, found: true });

        expect({
          lang,
          found: layers.includes(`**${dashboard["Add Layer"]}**`),
        }).toEqual({ lang, found: true });

        // Each person's one colour, named with the timeline's page title.
        expect({
          lang,
          found: layers.includes(
            `**${readDocsLocale(lang).navLinks[TIMELINE_PAGE_TITLE]}**`,
          ),
        }).toEqual({ lang, found: true });

        for (const fact of [
          SCHEDULES_ROUTE,
          LAYERS_ROUTE,
          LAYER_USERS_ROUTE,
          "`miscDataProps`",
          `\`${SCHEDULE_FIRST_LAYER_USERS_KEY}\``,
          `\`${SCHEDULE_FIRST_LAYER_ROTATION_KEY}\``,
          "`rotation`",
          ROTATION_EXAMPLE,
          `**${getLayerName(1)}**`,
        ]) {
          expect({ lang, fact, found: api.includes(fact) }).toEqual({
            lang,
            fact,
            found: true,
          });
        }
      },
    );
  });
});
