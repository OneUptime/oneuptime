import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import slugify from "Common/Server/Types/MarkdownSlugify";
import {
  GOOGLE_MEET_ACCESS_TYPE_OPTIONS,
  GOOGLE_MEET_SCOPE,
  MICROSOFT_TEAMS_LOBBY_BYPASS_OPTIONS,
  MICROSOFT_TEAMS_MEETING_PERMISSION,
  MICROSOFT_TEAMS_OAUTH_MEETING_PERMISSION,
  VideoCallConnectionField,
  VideoCallConnectionFieldOption,
  VideoCallProviderCatalog,
  VideoCallProviderDefinition,
  ZOOM_CLASSIC_MEETING_SCOPE,
  ZOOM_MEETING_SCOPE,
  ZOOM_OAUTH_MEETING_SCOPE,
  ZOOM_OAUTH_USER_SCOPE,
} from "Common/Types/VideoCall/VideoCallProviderCatalog";
import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";

/*
 * The Video Calls docs page against the catalog it describes.
 *
 * Markdown is not compiled, so nothing else notices when a provider gains
 * a field the guide never explains, a scope is renamed without the page
 * following, or a "Setup guide" link in the connection form points at an
 * anchor the page no longer has. Each test reads the catalog - the one
 * source of truth for the form, the server validator and the meeting
 * clients - and checks the page still tells the same story.
 */

const DOCS_ROOT: string = path.resolve(__dirname, "../../../FeatureSet/Docs");
const PAGE_URL: string = "/docs/workspace-connections/video-calls";
const PAGE_FILE: string = path.join(
  DOCS_ROOT,
  "Content/en/workspace-connections/video-calls.md",
);
const NAV_GROUP_TITLE: string = "Workspace Connections";
const NAV_LINK_TITLE: string = "Video Calls";
const SETTINGS_SIDE_MENU: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Dashboard/src/Pages/Settings/SideMenu.tsx",
);
const DASHBOARD_VIDEO_CALL_API: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Dashboard/src/Components/VideoCall/VideoCallApi.ts",
);
const ENVIRONMENT_CONFIG: string = path.resolve(
  __dirname,
  "../../../../Common/Server/EnvironmentConfig.ts",
);
const HEADING_LINE: RegExp = /^(#{1,6})\s+(.+?)\s*$/;
const FENCE_LINE: RegExp = /^\s*```/;
const NUMBERED_STEP_LINE: RegExp = /^\d+\.\s/;
const ONE_CLICK_DOCS_PATH: RegExp =
  /VIDEO_CALL_ONE_CLICK_DOCS_PATH: string =\s*"([^"]+)"/;

const DEFINITION_CASES: Array<[string, VideoCallProviderDefinition]> =
  VideoCallProviderCatalog.map(
    (
      definition: VideoCallProviderDefinition,
    ): [string, VideoCallProviderDefinition] => {
      return [definition.title, definition];
    },
  );

function readPage(): string {
  return fs.readFileSync(PAGE_FILE, "utf8");
}

interface Heading {
  level: number;
  text: string;
  line: number;
}

// Headings outside code fences, in page order.
function headingsOf(markdown: string): Array<Heading> {
  const headings: Array<Heading> = [];
  let inFence: boolean = false;

  markdown.split("\n").forEach((line: string, index: number): void => {
    if (FENCE_LINE.test(line)) {
      inFence = !inFence;
      return;
    }

    const match: RegExpExecArray | null = inFence
      ? null
      : HEADING_LINE.exec(line);

    if (match) {
      headings.push({
        level: match[1]!.length,
        text: match[2]!,
        line: index,
      });
    }
  });

  return headings;
}

// A section's text: its heading up to the next heading of the same or a higher level.
function sectionOf(markdown: string, anchor: string): string {
  const lines: Array<string> = markdown.split("\n");
  const headings: Array<Heading> = headingsOf(markdown);
  const index: number = headings.findIndex((heading: Heading): boolean => {
    return slugify(heading.text) === anchor;
  });

  expect({ anchor, found: index >= 0 }).toEqual({ anchor, found: true });

  const start: Heading = headings[index]!;
  const end: Heading | undefined = headings
    .slice(index + 1)
    .find((heading: Heading): boolean => {
      return heading.level <= start.level;
    });

  return lines.slice(start.line, end ? end.line : lines.length).join("\n");
}

function escapeForRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/*
 * A field is "named" when its exact title appears in bold or as a table
 * cell - the two ways the page presents the connection form - so a passing
 * mention in prose does not count.
 */
function namesField(markdown: string, title: string): boolean {
  const escaped: string = escapeForRegExp(title);

  return (
    new RegExp(`\\*\\*${escaped}\\*\\*`).test(markdown) ||
    new RegExp(`\\|\\s*${escaped}\\s*\\|`).test(markdown)
  );
}

function anchorOf(docsPath: string): string {
  const [, anchor] = docsPath.split("#");
  return anchor || "";
}

function workspaceConnectionsGroup(): NavGroup {
  const group: NavGroup | undefined = DocsNav.find(
    (candidate: NavGroup): boolean => {
      return candidate.title === NAV_GROUP_TITLE;
    },
  );

  expect(group).toBeDefined();

  return group!;
}

describe("Video Calls docs - the page", () => {
  test("exists in English", () => {
    expect(fs.existsSync(PAGE_FILE)).toBe(true);
    expect(readPage()).toMatch(/^# Video Calls\n/);
  });

  test("is listed under Workspace Connections, after Slack and Microsoft Teams", () => {
    const links: Array<NavLink> = workspaceConnectionsGroup().links;
    const titles: Array<string> = links.map((link: NavLink): string => {
      return link.title;
    });

    expect(titles).toEqual(["Slack", "Microsoft Teams", NAV_LINK_TITLE]);
    expect(
      links.find((link: NavLink): boolean => {
        return link.title === NAV_LINK_TITLE;
      })?.url,
    ).toBe(PAGE_URL);
  });

  test.each(
    SUPPORTED_DOCS_LANGUAGE_CODES.map((code: string) => {
      return [code];
    }),
  )("the %s docs locale titles the nav link", (code: string) => {
    const locale: { navLinks: Record<string, string> } = JSON.parse(
      fs.readFileSync(path.join(DOCS_ROOT, `Locales/${code}.json`), "utf8"),
    );
    const title: string | undefined = locale.navLinks[NAV_LINK_TITLE];

    expect({ code, title: (title || "").trim().length > 0 }).toEqual({
      code,
      title: true,
    });
  });

  test("links the Slack and Microsoft Teams pages it builds on", () => {
    const page: string = readPage();

    // Each link points at a page that is shipped.
    for (const linked of [
      "/docs/workspace-connections/slack",
      "/docs/workspace-connections/microsoft-teams",
    ]) {
      expect(
        fs.existsSync(
          path.join(DOCS_ROOT, `Content/en${linked.replace(/^\/docs/, "")}.md`),
        ),
      ).toBe(true);
    }

    expect(page).toContain("Slack");
    expect(page).toContain("Microsoft Teams");
  });

  test("calls the settings page what the Dashboard's side menu calls it", () => {
    const sideMenu: string = fs.readFileSync(SETTINGS_SIDE_MENU, "utf8");

    expect(sideMenu).toContain('title: "Video Calls"');
    expect(readPage()).toContain(
      "**Project Settings** > **Workspace** > **Video Calls**",
    );
  });

  test("says a slow provider never holds up the incident", () => {
    expect(readPage()).toMatch(/never delays the incident/);
  });

  test("says a private incident's title stays out of its meeting", () => {
    expect(readPage()).toMatch(/private incident the title is left out/);
  });

  test("never prints anything that looks like a real credential", () => {
    const page: string = readPage();

    expect(page).not.toMatch(/eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{20,}/);
    expect(page).not.toMatch(/-----BEGIN [A-Z ]*PRIVATE KEY-----/);
  });
});

describe.each(DEFINITION_CASES)(
  "Video Calls docs - %s",
  (_title: string, definition: VideoCallProviderDefinition) => {
    test("the connection form's Setup guide link opens a section of this page", () => {
      const [docsPage] = definition.docsPath.split("#");

      expect(docsPage).toBe(PAGE_URL);
      expect(anchorOf(definition.docsPath)).not.toBe("");

      const anchors: Array<string> = headingsOf(readPage()).map(
        (heading: Heading): string => {
          return slugify(heading.text);
        },
      );

      expect(anchors).toContain(anchorOf(definition.docsPath));
    });

    test("the section is titled after the provider", () => {
      const section: string = sectionOf(
        readPage(),
        anchorOf(definition.docsPath),
      );

      expect(section.split("\n")[0]).toBe(`### ${definition.title}`);
    });

    test("the section names every field of the connection form", () => {
      const section: string = sectionOf(
        readPage(),
        anchorOf(definition.docsPath),
      );
      const missing: Array<string> = [
        ...definition.configFields,
        ...definition.secretFields,
      ]
        .filter((field: VideoCallConnectionField): boolean => {
          return !namesField(section, field.title);
        })
        .map((field: VideoCallConnectionField): string => {
          return field.title;
        });

      expect(missing).toEqual([]);
    });

    test("the section names every choice of a dropdown field", () => {
      const section: string = sectionOf(
        readPage(),
        anchorOf(definition.docsPath),
      );
      const missing: Array<string> = definition.configFields
        .flatMap((field: VideoCallConnectionField) => {
          return field.options || [];
        })
        .filter((option: VideoCallConnectionFieldOption): boolean => {
          return !namesField(section, option.label);
        })
        .map((option: VideoCallConnectionFieldOption): string => {
          return option.label;
        });

      expect(missing).toEqual([]);
    });

    test("the section has as many steps as the in-app setup guide", () => {
      const section: string = sectionOf(
        readPage(),
        anchorOf(definition.docsPath),
      );
      const steps: Array<string> = section
        .split("\n")
        .filter((line: string): boolean => {
          return NUMBERED_STEP_LINE.test(line);
        });

      /*
       * The page may split or add a step, never drop one: everything the
       * dialog asks an administrator to do has to be on the page too.
       */
      expect(steps.length).toBeGreaterThanOrEqual(definition.setupSteps.length);
    });
  },
);

describe("Video Calls docs - the permissions each provider needs", () => {
  test("Zoom: the granular and the classic meeting scope", () => {
    const section: string = sectionOf(readPage(), "zoom");

    expect(section).toContain(ZOOM_MEETING_SCOPE);
    expect(section).toContain(ZOOM_CLASSIC_MEETING_SCOPE);
    expect(section).toContain("Server-to-Server OAuth");
  });

  test("Google Meet: the domain-wide delegation scope", () => {
    const section: string = sectionOf(readPage(), "google-meet");

    expect(section).toContain(GOOGLE_MEET_SCOPE);
    expect(section).toContain("Manage Domain Wide Delegation");
    expect(section).toContain("Google Meet REST API");
  });

  test("Microsoft Teams: the Graph permission and the application access policy", () => {
    const section: string = sectionOf(readPage(), "microsoft-teams");
    const teams: VideoCallProviderDefinition | undefined =
      VideoCallProviderCatalog.find(
        (definition: VideoCallProviderDefinition): boolean => {
          return definition.title === "Microsoft Teams";
        },
      );

    expect(section).toContain(MICROSOFT_TEAMS_MEETING_PERMISSION);

    // The same PowerShell the in-app guide and the API error give.
    for (const cmdlet of [
      "New-CsApplicationAccessPolicy -Identity OneUptime-Meetings",
      "Grant-CsApplicationAccessPolicy -PolicyName OneUptime-Meetings",
    ]) {
      expect(section).toContain(cmdlet);
      expect(teams!.setupSteps.join("\n")).toContain(cmdlet);
    }
  });

  test("the dropdown labels the page quotes are the catalog's", () => {
    const page: string = readPage();

    for (const option of [
      ...GOOGLE_MEET_ACCESS_TYPE_OPTIONS,
      ...MICROSOFT_TEAMS_LOBBY_BYPASS_OPTIONS,
    ]) {
      expect(page).toContain(`**${option.label}**`);
    }
  });

  test("Slack huddles: only for Slack rules, held in the rule's channel", () => {
    const section: string = sectionOf(readPage(), "slack-huddles");

    expect(section).toMatch(/only for Slack rules/);
    expect(section).toMatch(
      /has to create a channel or post to an existing one/,
    );
  });
});

/*
 * The one-click Connect: the Dashboard links straight into the section that
 * explains it, and a self-hosted administrator sets up its apps from the
 * page alone - the redirect URIs the server builds, the variables it reads
 * and the scopes its apps ask for.
 */
describe("Video Calls docs - connecting in one click", () => {
  test("the Dashboard's How it works link opens a section of this page", () => {
    const source: string = fs.readFileSync(DASHBOARD_VIDEO_CALL_API, "utf8");
    const match: RegExpExecArray | null = ONE_CLICK_DOCS_PATH.exec(source);

    expect(match).not.toBe(null);

    const [docsPage, anchor] = match![1]!.split("#");
    expect(docsPage).toBe(PAGE_URL);
    expect(sectionOf(readPage(), anchor!)).toMatch(/^## Connect in one click/);
  });

  test("says which account to sign in with, and that a shared one keeps calls starting", () => {
    const section: string = sectionOf(readPage(), "connect-in-one-click");

    expect(section).toContain("Sign in with a shared account");
    expect(section).toContain("**Reconnect**");
    expect(section).toContain("**Use your own Zoom app**");
  });

  test("names every permission the one-click apps ask for", () => {
    const section: string = sectionOf(readPage(), "connect-in-one-click");

    for (const scope of [
      ZOOM_OAUTH_MEETING_SCOPE,
      ZOOM_OAUTH_USER_SCOPE,
      "meetings.space.created",
      MICROSOFT_TEAMS_OAUTH_MEETING_PERMISSION,
      "offline_access",
    ]) {
      expect(section).toContain(scope);
    }
  });

  test("a self-hosted server: every redirect URI the server builds, every variable it reads", () => {
    const section: string = sectionOf(
      readPage(),
      "one-click-connect-on-a-self-hosted-server",
    );
    const environment: string = fs.readFileSync(ENVIRONMENT_CONFIG, "utf8");

    for (const definition of VideoCallProviderCatalog) {
      if (definition.oauth) {
        expect(section).toContain(
          `/api/video-call-oauth/${definition.oauth.slug}/callback`,
        );
      }
    }

    expect(section).toContain("/api/video-call-oauth/zoom/events");
    expect(section).toContain(GOOGLE_MEET_SCOPE);

    for (const variable of [
      "ZOOM_APP_CLIENT_ID",
      "ZOOM_APP_CLIENT_SECRET",
      "ZOOM_APP_WEBHOOK_SECRET_TOKEN",
      "GOOGLE_MEET_APP_CLIENT_ID",
      "GOOGLE_MEET_APP_CLIENT_SECRET",
      "MICROSOFT_TEAMS_MEETINGS_APP_CLIENT_ID",
      "MICROSOFT_TEAMS_MEETINGS_APP_CLIENT_SECRET",
    ]) {
      expect(section).toContain(variable);
      expect(environment).toContain(`process.env["${variable}"]`);
    }
  });
});
