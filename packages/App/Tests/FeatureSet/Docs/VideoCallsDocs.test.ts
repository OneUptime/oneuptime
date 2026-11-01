import DocsNav, { NavGroup, NavLink } from "../../../FeatureSet/Docs/Utils/Nav";
import { SUPPORTED_DOCS_LANGUAGE_CODES } from "../../../FeatureSet/Docs/Utils/I18n";
import slugify from "Common/Server/Types/MarkdownSlugify";
import {
  GOOGLE_MEET_ACCESS_TYPE_OPTIONS,
  GOOGLE_MEET_SCOPE,
  MICROSOFT_TEAMS_CALENDAR_PERMISSION,
  MICROSOFT_TEAMS_LOBBY_BYPASS_OPTIONS,
  MICROSOFT_TEAMS_MEETING_PERMISSION,
  MICROSOFT_TEAMS_OAUTH_MEETING_PERMISSION,
  MICROSOFT_TEAMS_TRANSCRIPT_PERMISSION,
  VideoCallConnectionField,
  VideoCallConnectionFieldOption,
  VideoCallProviderCatalog,
  VideoCallProviderDefinition,
  ZOOM_CLASSIC_MEETING_SCOPE,
  ZOOM_CLASSIC_RECORDING_SCOPE,
  ZOOM_MEETING_SCOPE,
  ZOOM_MEETING_TRANSCRIPT_SCOPE,
  ZOOM_OAUTH_MEETING_SCOPE,
  ZOOM_OAUTH_MEETING_TRANSCRIPT_SCOPE,
  ZOOM_OAUTH_RECORDING_FILES_SCOPE,
  ZOOM_OAUTH_USER_SCOPE,
  ZOOM_RECORDING_FILES_SCOPE,
} from "Common/Types/VideoCall/VideoCallProviderCatalog";
import { VIDEO_CALL_TRANSCRIPT_FILE_EXTENSIONS } from "Common/Types/VideoCall/VideoCallTranscript";
import {
  CALL_TRANSCRIPT_FETCH_WINDOW_MS,
  POSTMORTEM_WAITS_FOR_PREPARING_TRANSCRIPT_MS,
  POSTMORTEM_WAITS_FOR_UNSEEN_TRANSCRIPT_MS,
} from "Common/Types/VideoCall/CallTranscriptAutoFetch";
import VideoCallProvider from "Common/Types/VideoCall/VideoCallProvider";
import { RECORDABLE_VIDEO_CALL_PROVIDERS } from "Common/Server/Utils/VideoCall/EventVideoCall";
import Project from "Common/Models/DatabaseModels/Project";
import CallRecordingSwitchCopy, {
  CALL_RECORDING_SWITCH_COLUMN,
} from "../../../FeatureSet/Dashboard/src/Components/VideoCall/CallRecordingSwitchCopy";
import { GOOGLE_MEET_ENTRY_RETENTION_IN_DAYS } from "Common/Server/Utils/VideoCall/Transcripts/GoogleMeetTranscriptClient";
import { MICROSOFT_TEAMS_MEETING_RETENTION_IN_DAYS } from "Common/Server/Utils/VideoCall/Transcripts/MicrosoftTeamsTranscriptClient";
import { MICROSOFT_TEAMS_MEETINGS_RECORDING_PERMISSIONS } from "Common/Server/Utils/VideoCall/OAuth/MicrosoftTeamsMeetingsOAuthApp";
import IncidentVideoCall from "Common/Models/DatabaseModels/IncidentVideoCall";
import Permission, { PermissionHelper } from "Common/Types/Permission";
import { escapeRegExp } from "./DocsTranslationChecks";
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
const DASHBOARD_VIDEO_CALL_COMPONENTS: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Dashboard/src/Components/VideoCall",
);
const DASHBOARD_CALL_SUMMARY_SECTION: string = path.resolve(
  __dirname,
  "../../../FeatureSet/Dashboard/src/Components/AI/CallSummary/CallSummarySection.tsx",
);
const CALL_TRANSCRIPTS_DOCS_PATH: RegExp =
  /CALL_TRANSCRIPTS_DOCS_PATH: string =\s*"([^"]+)"/;
const MAX_TRANSCRIPT_FILE_BYTES: RegExp =
  /MAX_TRANSCRIPT_FILE_BYTES: number = (\d+) \* 1024 \* 1024;/;

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

/*
 * A field is "named" when its exact title appears in bold or as a table
 * cell - the two ways the page presents the connection form - so a passing
 * mention in prose does not count.
 */
function namesField(markdown: string, title: string): boolean {
  const escaped: string = escapeRegExp(title);

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

  /*
   * Recording and transcribing Teams calls: the app registration's two more
   * application permissions, on the same API permissions step as the
   * in-app guide, the policy that already covers reading transcripts, and
   * how to keep the calendar permission to the organizer's calendar.
   */
  test("Microsoft Teams: the two permissions recording takes, and how to keep the calendar one to the organizer", () => {
    const section: string = sectionOf(readPage(), "microsoft-teams");
    const teams: VideoCallProviderDefinition | undefined =
      VideoCallProviderCatalog.find(
        (definition: VideoCallProviderDefinition): boolean => {
          return definition.title === "Microsoft Teams";
        },
      );
    const step: string | undefined = section
      .split("\n")
      .find((line: string): boolean => {
        return line.startsWith("2. Under **API permissions**");
      });

    for (const permission of [
      MICROSOFT_TEAMS_CALENDAR_PERMISSION,
      MICROSOFT_TEAMS_TRANSCRIPT_PERMISSION,
    ]) {
      expect(step).toContain(`**${permission}**`);
      expect(teams!.setupSteps[1]).toContain(`**${permission}**`);
    }

    expect(section).toContain(
      "The same policy lets the app read the transcripts of the organizer's meetings.",
    );
    expect(section).toContain(
      "[RBAC for Applications in Exchange Online](https://learn.microsoft.com/exchange/permissions-exo/application-rbac), scoped to the organizer",
    );
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

  test("asks a Teams sign-in for the recording permissions while the project records its calls, and says an older one reconnects", () => {
    const section: string = sectionOf(readPage(), "connect-in-one-click");

    expect(MICROSOFT_TEAMS_MEETINGS_RECORDING_PERMISSIONS).toEqual([
      MICROSOFT_TEAMS_CALENDAR_PERMISSION,
      MICROSOFT_TEAMS_TRANSCRIPT_PERMISSION,
    ]);

    for (const permission of MICROSOFT_TEAMS_MEETINGS_RECORDING_PERMISSIONS) {
      expect(section).toContain(`\`${permission}`);
    }

    expect(section).toContain(
      "A Microsoft Teams connection signed in while **Record and transcribe incident calls** was off starts calls as before, unrecorded.",
    );
    expect(section).toContain(
      "only an administrator can let an app read meeting transcripts.",
    );
  });

  test("asks a Zoom sign-in for the transcript permissions, and says an older one reconnects", () => {
    const section: string = sectionOf(readPage(), "connect-in-one-click");

    expect(section).toContain(ZOOM_OAUTH_RECORDING_FILES_SCOPE);
    expect(section).toContain(ZOOM_OAUTH_MEETING_TRANSCRIPT_SCOPE);
    expect(section).toContain(
      "A Zoom connection signed in before OneUptime read call transcripts starts calls as before",
    );
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
    // The scopes this server's Zoom app needs to read call transcripts.
    expect(section).toContain(ZOOM_OAUTH_RECORDING_FILES_SCOPE);
    expect(section).toContain(ZOOM_OAUTH_MEETING_TRANSCRIPT_SCOPE);
    // And the permissions its Microsoft app needs to record Teams calls.
    for (const permission of MICROSOFT_TEAMS_MEETINGS_RECORDING_PERMISSIONS) {
      expect(section).toContain(`\`${permission}\``);
    }

    for (const variable of [
      "ZOOM_APP_CLIENT_ID",
      "ZOOM_APP_CLIENT_SECRET",
      "ZOOM_APP_WEBHOOK_SECRET_TOKEN",
      "GOOGLE_MEET_APP_CLIENT_ID",
      "GOOGLE_MEET_APP_CLIENT_SECRET",
      "MICROSOFT_TEAMS_MEETINGS_APP_CLIENT_ID",
      "MICROSOFT_TEAMS_MEETINGS_APP_CLIENT_SECRET",
      "MICROSOFT_TEAMS_MEETINGS_APP_TENANT_ID",
    ]) {
      expect(section).toContain(variable);
      expect(environment).toContain(`process.env["${variable}"]`);
    }
  });

  test("a single-tenant Teams meetings app: its tenant setting, as the server, the chart and Compose read it", () => {
    const section: string = sectionOf(
      readPage(),
      "one-click-connect-on-a-self-hosted-server",
    );
    const sentence: string | undefined = section
      .split("\n")
      .find((line: string): boolean => {
        return line.includes("MICROSOFT_TEAMS_MEETINGS_APP_TENANT_ID");
      });

    expect(sentence).toContain(
      "If your organization allows no multitenant apps, register it for **Accounts in this organizational directory only** and set `MICROSOFT_TEAMS_MEETINGS_APP_TENANT_ID` (Helm `microsoftTeamsMeetingsApp.tenantId`) to its **Directory (tenant) ID**: sign-ins then go to your tenant, where only your organization's members and guests can sign in.",
    );

    const repositoryRoot: string = path.resolve(__dirname, "../../../../..");
    const read: (relative: string) => string = (relative: string): string => {
      return fs.readFileSync(path.join(repositoryRoot, relative), "utf8");
    };

    // The server reads it, and hands it to the Teams meetings app.
    expect(read("packages/Common/Server/EnvironmentConfig.ts")).toContain(
      'process.env["MICROSOFT_TEAMS_MEETINGS_APP_TENANT_ID"]',
    );
    expect(
      read(
        "packages/Common/Server/Utils/VideoCall/OAuth/VideoCallOAuthApps.ts",
      ),
    ).toContain("tenantId = MicrosoftTeamsMeetingsAppTenantId;");
    // The chart's value the page names, and the variable it sets from it.
    expect(read("HelmChart/Public/oneuptime/values.yaml")).toContain(
      "microsoftTeamsMeetingsApp:\n  clientId:\n  clientSecret:\n  tenantId:\n",
    );
    expect(read("HelmChart/Public/oneuptime/templates/_helpers.tpl")).toContain(
      'value: {{ default "" $.Values.microsoftTeamsMeetingsApp.tenantId | quote }}',
    );
    // And Docker Compose passes it from config.env.
    expect(read("docker-compose.base.yml")).toContain(
      "MICROSOFT_TEAMS_MEETINGS_APP_TENANT_ID: ${MICROSOFT_TEAMS_MEETINGS_APP_TENANT_ID:-}",
    );
    expect(read("config.example.env")).toContain(
      "\nMICROSOFT_TEAMS_MEETINGS_APP_TENANT_ID=\n",
    );
  });

  test("a Teams meetings app in a US Government cloud: MICROSOFT_TEAMS_CLOUD, which the meetings app's sign-ins, scopes and meetings follow", () => {
    const section: string = sectionOf(
      readPage(),
      "one-click-connect-on-a-self-hosted-server",
    );
    const bullet: string | undefined = section
      .split("\n")
      .find((line: string): boolean => {
        return line.startsWith("- **Microsoft Teams**:");
      });

    expect(bullet).toContain(
      "If your Microsoft 365 tenant is in a US Government cloud, register the app in that cloud's Microsoft Entra admin center and set `MICROSOFT_TEAMS_CLOUD`, as for the [Microsoft Teams bot](/docs/self-hosted/microsoft-teams-integration#us-government-clouds): its sign-ins and meetings then go to that cloud's hosts.",
    );

    const repositoryRoot: string = path.resolve(__dirname, "../../../../..");
    const read: (relative: string) => string = (relative: string): string => {
      return fs.readFileSync(path.join(repositoryRoot, relative), "utf8");
    };
    const videoCall: string = "packages/Common/Server/Utils/VideoCall";

    // The one-click app signs in, and asks for its scopes, on the cloud's hosts.
    const oneClick: string = read(
      `${videoCall}/OAuth/MicrosoftTeamsMeetingsOAuthApp.ts`,
    );
    expect(oneClick).toContain("MicrosoftTeamsHosts.getSignInOrigin()");
    expect(oneClick).toContain("MicrosoftTeamsHosts.getGraphScope(");
    // A project's own app, and the meetings and transcripts, on the cloud's Graph.
    const meetings: string = read(
      `${videoCall}/Providers/MicrosoftTeamsMeetingClient.ts`,
    );
    expect(meetings).toContain('MicrosoftTeamsHosts.getGraphUrl("")');
    expect(meetings).toContain("MicrosoftTeamsHosts.getGraphDefaultScope()");
    expect(
      read(`${videoCall}/Transcripts/MicrosoftTeamsTranscriptClient.ts`),
    ).toContain("getMicrosoftGraphBaseUrl()");
  });
});

/*
 * Call transcripts (issue #4875): the Video Call card's transcript and the
 * OneUptime AI card's reading of it, as the Dashboard draws them, the
 * scopes Zoom asks for, and the limits the server and the Dashboard keep.
 */
describe("Video Calls docs - call transcripts", () => {
  function readSource(file: string): string {
    return fs.readFileSync(file, "utf8");
  }

  const BLOCK: string = readSource(
    path.join(DASHBOARD_VIDEO_CALL_COMPONENTS, "CallTranscriptBlock.tsx"),
  );
  const ADD_DIALOG: string = readSource(
    path.join(DASHBOARD_VIDEO_CALL_COMPONENTS, "AddCallTranscriptModal.tsx"),
  );
  const API: string = readSource(
    path.join(DASHBOARD_VIDEO_CALL_COMPONENTS, "CallTranscriptApi.ts"),
  );
  const STATE: string = readSource(
    path.join(DASHBOARD_VIDEO_CALL_COMPONENTS, "CallTranscriptState.ts"),
  );
  const SECTION: string = readSource(DASHBOARD_CALL_SUMMARY_SECTION);

  test("the Video Call card's How to set it up link opens this section", () => {
    const match: RegExpExecArray | null = CALL_TRANSCRIPTS_DOCS_PATH.exec(API);

    expect(match).not.toBe(null);

    const [docsPage, anchor] = match![1]!.split("#");

    expect(docsPage).toBe(PAGE_URL);
    expect(sectionOf(readPage(), anchor!)).toMatch(/^## Call transcripts/);
  });

  test("names the buttons and marks as the cards draw them", () => {
    const section: string = sectionOf(readPage(), "call-transcripts");

    for (const [label, source] of [
      ["Get from {{provider}}", BLOCK],
      ["Add transcript", BLOCK],
      ["Suggested root cause", SECTION],
      ["Not confirmed", SECTION],
      ["Confirmed on the call", SECTION],
      ["Hypotheses", SECTION],
      ["Use as root cause", SECTION],
      ["Dismiss", SECTION],
      ["Undo", SECTION],
      ["Not enough was said on the call to suggest a root cause", SECTION],
    ] as Array<[string, string]>) {
      expect({ label, drawn: source.includes(`"${label}"`) }).toEqual({
        label,
        drawn: true,
      });
    }

    for (const label of [
      "Get from Zoom",
      "Get from Google Meet",
      "Get from Microsoft Teams",
      "Add transcript",
      "Suggested root cause",
      "Not confirmed",
      "Confirmed on the call",
      "Hypotheses",
      "Use as root cause",
      "Dismiss",
      "Undo",
      "Not enough was said on the call to suggest a root cause",
    ]) {
      expect({ label, named: section.includes(`**${label}**`) }).toEqual({
        label,
        named: true,
      });
    }

    // Try again, from Troubleshooting: the cards' own button.
    expect(BLOCK).toContain('translator.translateText("Try again")');
    expect(SECTION).toContain('translator.translateText("Try again")');
    expect(readPage()).toContain("**Try again** on the card reads it again.");
  });

  test("states the file types and the size Add transcript takes", () => {
    const megabytes: RegExpExecArray | null =
      MAX_TRANSCRIPT_FILE_BYTES.exec(STATE);

    expect(megabytes).not.toBe(null);
    expect(ADD_DIALOG).toContain("VIDEO_CALL_TRANSCRIPT_FILE_EXTENSIONS");

    const section: string = sectionOf(readPage(), "call-transcripts");

    expect(section).toContain(
      `(${VIDEO_CALL_TRANSCRIPT_FILE_EXTENSIONS.slice(0, -1)
        .map((extension: string): string => {
          return `\`${extension}\``;
        })
        .join(
          ", ",
        )} or \`${VIDEO_CALL_TRANSCRIPT_FILE_EXTENSIONS[VIDEO_CALL_TRANSCRIPT_FILE_EXTENSIONS.length - 1]}\`, up to ${megabytes![1]} MB)`,
    );
  });

  test("names the Zoom scopes a Server-to-Server OAuth app adds to read transcripts", () => {
    const zoom: string = sectionOf(readPage(), "zoom");

    for (const scope of [
      ZOOM_RECORDING_FILES_SCOPE,
      ZOOM_MEETING_TRANSCRIPT_SCOPE,
      ZOOM_CLASSIC_RECORDING_SCOPE,
    ]) {
      expect(zoom).toContain(`**${scope}**`);
    }

    // The same step the connection form's setup guide shows.
    const definition: VideoCallProviderDefinition | undefined =
      VideoCallProviderCatalog.find(
        (candidate: VideoCallProviderDefinition): boolean => {
          return candidate.title === "Zoom";
        },
      );

    expect(definition!.setupSteps.join("\n")).toContain(
      ZOOM_RECORDING_FILES_SCOPE,
    );
  });

  test("says how long Google keeps a transcript for apps, as the server reads it", () => {
    expect(sectionOf(readPage(), "what-each-provider-keeps")).toContain(
      `Google keeps a transcript for apps to read for ${GOOGLE_MEET_ENTRY_RETENTION_IN_DAYS} days.`,
    );
  });

  test("says which Teams calls OneUptime can read, and how long Microsoft keeps their meeting, as the server reads it", () => {
    const section: string = sectionOf(readPage(), "what-each-provider-keeps");
    const row: string =
      section.split("\n").find((line: string): boolean => {
        return line.startsWith("| Microsoft Teams |");
      }) || "";

    expect(row).toContain("| **Get from Microsoft Teams** |");
    expect(row).toContain(
      `Microsoft lets apps read the transcripts only of meetings on a calendar, and keeps a meeting for ${MICROSOFT_TEAMS_MEETING_RETENTION_IN_DAYS} days.`,
    );
    expect(row).toContain("**Add transcript**");
  });

  describe("Record and transcribe every call", () => {
    const HOUR: number = 60 * 60 * 1000;

    test("names the switch as the Video Calls page draws it, where it is", () => {
      const section: string = sectionOf(
        readPage(),
        "record-and-transcribe-every-call",
      );

      expect(section).toContain(
        `turn on **${CallRecordingSwitchCopy.switchTitle}** in **Project Settings** > **Workspace** > **Video Calls**.`,
      );
      expect(
        readSource(
          path.join(
            DASHBOARD_VIDEO_CALL_COMPONENTS,
            "..",
            "..",
            "Pages",
            "Settings",
            "VideoCalls.tsx",
          ),
        ),
      ).toContain("<CallRecordingSwitchCard");
      // Off by default, as the column is.
      expect(
        new Project().getTableColumnMetadata(CALL_RECORDING_SWITCH_COLUMN)
          ?.defaultValue,
      ).toBe(false);
      expect(section).toContain(
        "It is off by default, because it records people",
      );
    });

    test("names the providers OneUptime asks to record, and the calls it never records", () => {
      const section: string = sectionOf(
        readPage(),
        "record-and-transcribe-every-call",
      );

      expect(RECORDABLE_VIDEO_CALL_PROVIDERS).toEqual([
        VideoCallProvider.Zoom,
        VideoCallProvider.GoogleMeet,
        VideoCallProvider.MicrosoftTeams,
      ]);
      expect(section).toContain(
        "OneUptime asks Zoom to record each incident meeting it starts to the cloud, Google Meet to transcribe it, and Microsoft Teams to record and transcribe it automatically.",
      );
      expect(section).toContain(
        "Slack huddles and meeting links are not recorded, and neither are alert calls: add their transcripts by hand.",
      );
      expect(section).not.toContain("Microsoft Teams calls,");
    });

    test("says how a Teams call is recorded, what that needs, and what becomes of one that cannot be", () => {
      const section: string = sectionOf(
        readPage(),
        "record-and-transcribe-every-call",
      );

      expect(section).toContain(
        "Microsoft lets apps read the transcripts only of Teams meetings on a calendar, so OneUptime puts each incident meeting on its organizer's calendar",
      );
      expect(section).toContain(
        `two more Microsoft Graph permissions, \`${MICROSOFT_TEAMS_CALENDAR_PERMISSION}\` and \`${MICROSOFT_TEAMS_TRANSCRIPT_PERMISSION}\``,
      );
      expect(section).toContain("(see [Microsoft Teams](#microsoft-teams))");
      expect(section).toContain(
        "The organizer's Teams meeting policy must allow cloud recording, transcription and automatic recording",
      );
      expect(section).toContain(
        "A call OneUptime cannot put on the calendar starts all the same, unrecorded, and its **Video Call** card says why.",
      );
    });

    test("says how long the postmortem draft waits for the call, as the rule holds it", () => {
      const section: string = sectionOf(
        readPage(),
        "record-and-transcribe-every-call",
      );

      expect(POSTMORTEM_WAITS_FOR_PREPARING_TRANSCRIPT_MS).toBe(6 * HOUR);
      expect(POSTMORTEM_WAITS_FOR_UNSEEN_TRANSCRIPT_MS).toBe(HOUR);
      expect(section).toContain(
        "up to six hours while the provider prepares the transcript, and one hour when there is no sign of one yet.",
      );
    });

    test("says how long OneUptime keeps asking for a transcript, as the job holds it", () => {
      expect(CALL_TRANSCRIPT_FETCH_WINDOW_MS).toBe(72 * HOUR);
      expect(readPage()).toContain(
        "OneUptime asks Zoom, Google Meet or Microsoft Teams for it every few minutes once the call is over, less often as the call gets older, for three days after the call started.",
      );
    });

    test("troubleshoots a Teams call that was not recorded, with the two permissions to add", () => {
      const page: string = readPage();
      const start: number = page.indexOf(
        ":::details A Microsoft Teams call was not recorded",
      );

      expect(start).toBeGreaterThan(-1);

      const details: string = page.slice(start, page.indexOf("\n:::", start));

      expect(details).toContain(`\`${MICROSOFT_TEAMS_CALENDAR_PERMISSION}\``);
      expect(details).toContain(`\`${MICROSOFT_TEAMS_TRANSCRIPT_PERMISSION}\``);
      expect(details).toContain("**Reconnect**");
    });

    test("the steps of Call transcripts point to it", () => {
      const section: string = sectionOf(readPage(), "call-transcripts");

      expect(section).toContain(
        "With [every call recorded and transcribed](#record-and-transcribe-every-call), OneUptime gets it by itself once the call is over.",
      );
      expect(section).toContain(
        "What it read is posted to the incident's feed too, and from there to the incident's Slack and Microsoft Teams channels.",
      );
    });
  });

  test("names who may work on a call's transcript, as the model holds it", () => {
    const call: IncidentVideoCall = new IncidentVideoCall();
    const roles: Array<string> = call
      .getCreatePermissions()
      .filter((permission: Permission): boolean => {
        return permission !== Permission.CreateIncidentVideoCall;
      })
      .map((permission: Permission): string => {
        return PermissionHelper.getTitle(permission);
      });
    const section: string = sectionOf(readPage(), "who-can-do-what");
    const line: string =
      section.split("\n").find((candidate: string): boolean => {
        return candidate.startsWith("Getting, adding, replacing and removing");
      }) || "";
    const named: Array<string> = Array.from(
      line.matchAll(/\*\*([^*]+)\*\*/g),
    ).map((match: RegExpMatchArray): string => {
      return match[1]!;
    });

    expect(named).toEqual([
      ...roles,
      PermissionHelper.getTitle(Permission.CreateIncidentVideoCall),
      "Use as root cause",
    ]);
  });
});
