import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import {
  SUPPORTED_DOCS_LANGUAGE_CODES,
  getLocalizedNav,
} from "../../../FeatureSet/Docs/Utils/I18n";
import OnCallDutyPolicySchedule from "Common/Models/DatabaseModels/OnCallDutyPolicySchedule";
import OnCallDutyPolicyScheduleLayer from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleLayer";
import OnCallDutyPolicyScheduleLayerUser from "Common/Models/DatabaseModels/OnCallDutyPolicyScheduleLayerUser";
import OnCallDutyPolicyUserOverride from "Common/Models/DatabaseModels/OnCallDutyPolicyUserOverride";
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

/*
 * "When someone is away": Skip until... on a person in a layer, the user
 * override form it opens, and what the layer card says when everyone in a
 * layer is away (task oncall-skip-user-until).
 */
const LAYER_USER_FILE: string =
  "App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayerUser.tsx";
const LAYER_CARD_FILE: string =
  "App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/LayerCard.tsx";
const SKIP_MODAL_FILE: string =
  "App/FeatureSet/Dashboard/src/Components/OnCallPolicy/OnCallScheduleLayer/SkipLayerUserModal.tsx";
const OVERRIDE_FORM_FILE: string =
  "App/FeatureSet/Dashboard/src/Components/OnCallPolicy/UserOverrides/UserOverrideForm.ts";

const SKIP_BUTTON: string = "Skip until…";
const ROTATION_COVERS: string = "Next person in the rotation";
const EVERYONE_AWAY: string = "Everyone in this layer is away right now";

// What every language's away section names, by the dashboard's words.
const AWAY_LABELS: Array<string> = [
  "Layers",
  SKIP_BUTTON,
  "Who is away?",
  ROTATION_COVERS,
  "Who covers?",
  "Starts",
  "Ends",
  EVERYONE_AWAY,
  "Schedule Timeline",
  "On-Call Duty",
  "User Overrides",
];

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
const USER_OVERRIDES_ROUTE: string = apiRoute(
  new OnCallDutyPolicyUserOverride().crudApiPath?.toString(),
);

// The API facts of the away section: a user override with nobody to cover.
const AWAY_API_FACTS: Array<string> = [
  USER_OVERRIDES_ROUTE,
  "`routeAlertsToUserId`",
  "`overrideUserId`",
  "`startsAt`",
  "`endsAt`",
];

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
    it("is linked from the On Call group, after the timeline and the escalation rules", () => {
      const links: Array<NavLink> = onCallGroup().links;

      // Both keep their places (their own pages pin them).
      expect(links[0]?.title).toBe("Schedule Timeline");
      expect(links[1]?.title).toBe("Escalation Rules");
      expect(links[2]).toEqual({ title: PAGE_TITLE, url: PAGE_URL });
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

    it("has its four sections and its next steps, in order", () => {
      expect(
        pageSections.map((section: { heading: string }): string => {
          return section.heading;
        }),
      ).toEqual([
        "Who takes turns",
        "Layers",
        "When someone is away",
        "Creating schedules with the API or Terraform",
        "Next steps",
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

    it("says how to skip someone who is away, with the button and the form the layer draws", () => {
      const away: string = pageSections[2]!.body;

      // The button on a person's row in a layer, and the dialog it opens.
      expect(readRepoFile(LAYER_USER_FILE)).toContain(
        `translateText("${SKIP_BUTTON}")`,
      );
      expect(readRepoFile(SKIP_MODAL_FILE)).toContain(
        "getUserOverrideFormFields",
      );
      expect(away).toContain(`click **${SKIP_BUTTON}** beside their name`);

      // The form's questions, with the rotation covering until someone is picked.
      const form: string = readRepoFile(OVERRIDE_FORM_FILE);
      for (const title of ["Who is away?", "Who covers?", "Starts", "Ends"]) {
        expect(form).toContain(`"${title}"`);
        expect(away).toContain(`**${title}**`);
      }
      // What the cover picker says while nobody is picked.
      expect(form).toContain(`"${ROTATION_COVERS}"`);
      expect(form).toContain("whenNobodyPicked");
      expect(away).toContain(
        `**${ROTATION_COVERS}** under **Who covers?** and **Starts** at now`,
      );

      // What the layer card says when nobody in a layer is left.
      expect(readRepoFile(LAYER_CARD_FILE)).toContain(`"${EVERYONE_AWAY}"`);
      expect(away).toContain(`**${EVERYONE_AWAY}**`);

      // The rotation does not move, and lower layers take over.
      expect(away).toContain("Nobody else's turns move");
      expect(away).toContain("the layers below it take over");

      // Where it is listed, and that it reaches every policy.
      expect(readRepoFile(ON_CALL_SIDE_MENU_FILE)).toContain(
        'title: "User Overrides"',
      );
      expect(away).toContain("**On-Call Duty** > **User Overrides**");
      expect(away).toContain("applies to every on-call policy");
    });

    it("gives the API of a skip: a user override created without anyone to cover", () => {
      const away: string = pageSections[2]!.body;

      for (const fact of AWAY_API_FACTS) {
        expect({ fact, found: away.includes(fact) }).toEqual({
          fact,
          found: true,
        });
      }

      // Nobody to cover is allowed: the column is optional.
      const column: { required?: boolean | undefined } =
        new OnCallDutyPolicyUserOverride().getTableColumnMetadata(
          "routeAlertsToUserId",
        );
      expect(column.required).toBe(false);
    });

    it("gives the API: the routes, the misc data keys the server reads and the rotation's shape", () => {
      const api: string = pageSections[3]!.body;

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
   * Each translation has the same four sections, names the form and the
   * away section's controls with the words that language's dashboard shows,
   * and gives the same API facts.
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

        expect(pageSections).toHaveLength(5);

        // One title, four sections and the next steps, nothing deeper.
        expect(page.match(/^# /gm)).toHaveLength(1);
        expect(page.match(/^### /gm)).toBeNull();

        const first: string = pageSections[0]!.body;
        const layers: string = pageSections[1]!.body;
        const away: string = pageSections[2]!.body;
        const api: string = pageSections[3]!.body;

        // When someone is away: Skip until..., the form, the layer card.
        for (const label of AWAY_LABELS) {
          expect({
            lang,
            label,
            found: away.includes(`**${dashboard[label]}**`),
          }).toEqual({
            lang,
            label,
            found: true,
          });
        }

        for (const fact of AWAY_API_FACTS) {
          expect({ lang, fact, found: away.includes(fact) }).toEqual({
            lang,
            fact,
            found: true,
          });
        }

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

        /*
         * Each person's one colour, on the timeline: named as the
         * dashboard's side menu names that page (the docs' own title for it
         * differs in Spanish).
         */
        expect({
          lang,
          found: layers.includes(`**${dashboard[TIMELINE_PAGE_TITLE]}**`),
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
