import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  WORKSPACE_CONNECTIONS_PAGE_COPY,
  WORKSPACE_CONNECTION_COPY,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/WorkspaceConnectionCopy";
import { WORKSPACE_MENU_ENTRY_TITLES } from "../../../../App/FeatureSet/Dashboard/src/Components/Workspace/WorkspaceSideMenuSection";
import PageMap from "../../../../App/FeatureSet/Dashboard/src/Utils/PageMap";
import WorkspaceType from "../../../Types/Workspace/WorkspaceType";

/*
 * "Please do this everywhere else in the project." (the maintainer)
 *
 * Rules that must hold across the Dashboard, read from its source so that a
 * menu or page added later is held to them the day it is written:
 *
 *  1. No side menu links to a Slack or Microsoft Teams page by hand. Those
 *     links come from useWorkspaceSideMenuSection, which lists only the
 *     workspaces the project has connected. The one exception is Project
 *     Settings, where workspaces are connected: hiding the one that is not
 *     connected there would hide the only way to connect it.
 *  2. "Is Slack connected?" is asked of the shared store, which asks the
 *     server once per page load. Only the files that need the connection row
 *     itself read WorkspaceProjectAuthToken.
 *  3. Every sentence the new pages and menus say is in every Dashboard
 *     locale, translated.
 */

const DASHBOARD_SRC: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
);

function filesUnder(dir: string, extensions: Array<string>): Array<string> {
  const files: Array<string> = [];

  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules") {
      continue;
    }

    const entryPath: string = path.join(dir, entry.name);

    if (entry.isDirectory()) {
      files.push(...filesUnder(entryPath, extensions));
    } else if (
      extensions.some((extension: string): boolean => {
        return entry.name.endsWith(extension);
      })
    ) {
      files.push(entryPath);
    }
  }

  return files;
}

function relative(file: string): string {
  return path.relative(DASHBOARD_SRC, file).split(path.sep).join("/");
}

function stripComments(code: string): string {
  return code.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/\/\/.*$/gm, " ");
}

// The PageMap keys of every page that is about one chat workspace.
const PRODUCT_WORKSPACE_PAGE: RegExp =
  /_WORKSPACE_CONNECTION_(SLACK|MICROSOFT_TEAMS)$/;
const PRODUCT_CONNECT_PAGE: RegExp = /_WORKSPACE_CONNECTIONS$/;
const SETTINGS_WORKSPACE_PAGE: RegExp = /_(SLACK|MICROSOFT_TEAMS)_INTEGRATION$/;

const WORKSPACE_PAGE_KEYS: Array<string> = Object.keys(PageMap).filter(
  (key: string): boolean => {
    return (
      PRODUCT_WORKSPACE_PAGE.test(key) ||
      PRODUCT_CONNECT_PAGE.test(key) ||
      SETTINGS_WORKSPACE_PAGE.test(key)
    );
  },
);

const READS_CONNECTION_ROW: RegExp = /modelType:\s*WorkspaceProjectAuthToken\b/;
const PRODUCT_WORKSPACE_PAGE_FILE: RegExp =
  /Pages\/[^/]+\/WorkspaceConnection(Slack|MicrosoftTeams)\.tsx$/;

const HOOK_CALL: RegExp = /useWorkspaceSideMenuSection\(\{[\s\S]*?\}\)/g;

/*
 * Menus that list workspace pages by hand, and why. Everywhere else they
 * come from useWorkspaceSideMenuSection.
 */
const HAND_WRITTEN_WORKSPACE_MENUS: Readonly<Record<string, string>> = {
  "Pages/Settings/SideMenu.tsx":
    "Project Settings is where Slack and Microsoft Teams are connected, so both are always listed there.",
};

const SIDE_MENUS: Array<string> = filesUnder(DASHBOARD_SRC, [".tsx"]).filter(
  (file: string): boolean => {
    return path.basename(file).endsWith("SideMenu.tsx");
  },
);

describe("1. menus list only the connected workspaces", () => {
  test("the sweep finds the workspace pages and the menus", () => {
    expect(WORKSPACE_PAGE_KEYS).toEqual(
      expect.arrayContaining([
        "INCIDENTS_WORKSPACE_CONNECTION_SLACK",
        "INCIDENTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS",
        "INCIDENTS_WORKSPACE_CONNECTIONS",
        "USER_SETTINGS_SLACK_INTEGRATION",
        "SETTINGS_MICROSOFT_TEAMS_INTEGRATION",
      ]),
    );
    expect(WORKSPACE_PAGE_KEYS.length).toBeGreaterThanOrEqual(19);
    expect(SIDE_MENUS.length).toBeGreaterThan(50);
  });

  test("no side menu links to a Slack or Microsoft Teams page except through useWorkspaceSideMenuSection", () => {
    const handWritten: Array<string> = [];

    for (const file of SIDE_MENUS) {
      const name: string = relative(file);

      if (HAND_WRITTEN_WORKSPACE_MENUS[name]) {
        continue;
      }

      const code: string = stripComments(fs.readFileSync(file, "utf8")).replace(
        HOOK_CALL,
        " ",
      );

      for (const key of WORKSPACE_PAGE_KEYS) {
        if (new RegExp(`PageMap\\s*\\.\\s*${key}\\b`).test(code)) {
          handWritten.push(`${name}: ${key}`);
        }
      }
    }

    /*
     * Each of these lists a workspace page by hand, whether or not the
     * project has connected that workspace. Build the menu's Workspace
     * section with useWorkspaceSideMenuSection instead.
     */
    expect(handWritten).toEqual([]);
  });

  test("the menus that do list workspaces are the five products and User Settings", () => {
    const withWorkspaceSection: Array<string> = SIDE_MENUS.filter(
      (file: string): boolean => {
        return fs
          .readFileSync(file, "utf8")
          .includes("useWorkspaceSideMenuSection(");
      },
    )
      .map(relative)
      .sort();

    expect(withWorkspaceSection).toEqual([
      "Pages/Alerts/SideMenu.tsx",
      "Pages/Incidents/SideMenu.tsx",
      "Pages/Monitor/SideMenu.tsx",
      "Pages/OnCallDuty/SideMenu.tsx",
      "Pages/ScheduledMaintenanceEvents/SideMenu.tsx",
      "Pages/UserSettings/SideMenu.tsx",
    ]);
  });

  test("each passes its own Slack and Microsoft Teams pages, and every product its own Workspace page", () => {
    const expected: Record<string, Array<string>> = {
      "Pages/Alerts/SideMenu.tsx": [
        "ALERTS_WORKSPACE_CONNECTION_SLACK",
        "ALERTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS",
        "ALERTS_WORKSPACE_CONNECTIONS",
      ],
      "Pages/Incidents/SideMenu.tsx": [
        "INCIDENTS_WORKSPACE_CONNECTION_SLACK",
        "INCIDENTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS",
        "INCIDENTS_WORKSPACE_CONNECTIONS",
      ],
      "Pages/Monitor/SideMenu.tsx": [
        "MONITORS_WORKSPACE_CONNECTION_SLACK",
        "MONITORS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS",
        "MONITORS_WORKSPACE_CONNECTIONS",
      ],
      "Pages/OnCallDuty/SideMenu.tsx": [
        "ON_CALL_DUTY_WORKSPACE_CONNECTION_SLACK",
        "ON_CALL_DUTY_WORKSPACE_CONNECTION_MICROSOFT_TEAMS",
        "ON_CALL_DUTY_WORKSPACE_CONNECTIONS",
      ],
      "Pages/ScheduledMaintenanceEvents/SideMenu.tsx": [
        "SCHEDULED_MAINTENANCE_EVENTS_WORKSPACE_CONNECTION_SLACK",
        "SCHEDULED_MAINTENANCE_EVENTS_WORKSPACE_CONNECTION_MICROSOFT_TEAMS",
        "SCHEDULED_MAINTENANCE_EVENTS_WORKSPACE_CONNECTIONS",
      ],
      // Linking your own account: no page to send a project with nothing connected to.
      "Pages/UserSettings/SideMenu.tsx": [
        "USER_SETTINGS_SLACK_INTEGRATION",
        "USER_SETTINGS_MICROSOFT_TEAMS_INTEGRATION",
      ],
    };

    for (const [name, keys] of Object.entries(expected)) {
      const call: string =
        fs
          .readFileSync(path.join(DASHBOARD_SRC, name), "utf8")
          .match(HOOK_CALL)?.[0] || "";

      expect({
        name,
        keys: Array.from(call.matchAll(/PageMap\.([A-Z_]+)/g)).map(
          (match: RegExpMatchArray): string => {
            return match[1] as string;
          },
        ),
      }).toEqual({ name, keys });
    }
  });

  test("every menu exception says why", () => {
    for (const [name, reason] of Object.entries(HAND_WRITTEN_WORKSPACE_MENUS)) {
      expect(fs.existsSync(path.join(DASHBOARD_SRC, name))).toBe(true);
      expect(reason.length).toBeGreaterThan(30);
    }
  });
});

/*
 * Files allowed to read the connection rows themselves, and why. Anything
 * that only needs to know whether a workspace is connected asks the store
 * (Utils/Workspace/ConnectedWorkspaces.ts), so a page asks once.
 */
const READS_CONNECTION_ROWS: Readonly<Record<string, string>> = {
  "Utils/Workspace/ConnectedWorkspaces.ts":
    "the store itself: the one place a page learns which workspaces are connected",
  "Components/Slack/SlackIntegration.tsx":
    "the Slack connect page: shows the workspace's name and deletes the row to disconnect",
  "Components/MicrosoftTeams/MicrosoftTeamsIntegration.tsx":
    "the Microsoft Teams connect page: reads admin consent and deletes the row to disconnect",
  "Components/UserSettings/SetupChecklist/useSetupChecklist.ts":
    "the setup checklist probes the project and the person's own account link together, with its own unknown state",
};

describe("2. whether a workspace is connected is asked in one place", () => {
  const SOURCES: Array<string> = filesUnder(DASHBOARD_SRC, [".ts", ".tsx"]);

  test("only the files that need the connection rows read them", () => {
    const readers: Array<string> = SOURCES.filter((file: string): boolean => {
      return READS_CONNECTION_ROW.test(
        stripComments(fs.readFileSync(file, "utf8")),
      );
    })
      .map(relative)
      .sort();

    expect(readers).toEqual(Object.keys(READS_CONNECTION_ROWS).sort());
  });

  test("the old per-page lookup is gone, and nothing calls it", () => {
    expect(
      fs.existsSync(
        path.join(DASHBOARD_SRC, "Utils", "Workspace", "Workspace.ts"),
      ),
    ).toBe(false);
    expect(
      SOURCES.filter((file: string): boolean => {
        return fs
          .readFileSync(file, "utf8")
          .includes("WorkspaceUtil.isWorkspaceConnected(");
      }).map(relative),
    ).toEqual([]);
  });

  test("the product Slack and Microsoft Teams pages all go through the gate", () => {
    const pages: Array<string> = SOURCES.filter((file: string): boolean => {
      return PRODUCT_WORKSPACE_PAGE_FILE.test(relative(file));
    });

    expect(pages).toHaveLength(10);

    for (const file of pages) {
      const code: string = fs.readFileSync(file, "utf8");
      const workspaceType: string = file.endsWith("Slack.tsx")
        ? "Slack"
        : "MicrosoftTeams";

      expect({
        page: relative(file),
        gated: code.includes(
          `<WorkspaceConnectionGate workspaceType={WorkspaceType.${workspaceType}}>`,
        ),
        retypedPath: code.includes("Please go to Project Settings"),
      }).toEqual({ page: relative(file), gated: true, retypedPath: false });
    }
  });

  test("every reader of the rows says why", () => {
    for (const reason of Object.values(READS_CONNECTION_ROWS)) {
      expect(reason.length).toBeGreaterThan(30);
    }
  });
});

describe("3. every new sentence is in every locale, translated", () => {
  const LOCALES_DIR: string = path.join(DASHBOARD_SRC, "Locales");
  const LOCALE_FILES: Array<string> = fs
    .readdirSync(LOCALES_DIR)
    .filter((name: string): boolean => {
      return name.endsWith(".json");
    })
    .sort();

  const STRINGS: Array<string> = [
    WORKSPACE_MENU_ENTRY_TITLES.Connect,
    WORKSPACE_CONNECTIONS_PAGE_COPY.title,
    WORKSPACE_CONNECTIONS_PAGE_COPY.description,
    WORKSPACE_CONNECTIONS_PAGE_COPY.connected,
    WORKSPACE_CONNECTIONS_PAGE_COPY.notConnected,
    WORKSPACE_CONNECTIONS_PAGE_COPY.setUpNotifications,
    ...[WorkspaceType.Slack, WorkspaceType.MicrosoftTeams].flatMap(
      (workspaceType: WorkspaceType): Array<string> => {
        const copy: (typeof WORKSPACE_CONNECTION_COPY)[WorkspaceType] =
          WORKSPACE_CONNECTION_COPY[workspaceType];

        return [
          copy.name,
          copy.description,
          copy.connectTitle,
          copy.notConnectedTitle,
          copy.notConnectedDescription,
        ];
      },
    ),
  ];

  test("there are seventeen locales", () => {
    expect(LOCALE_FILES).toHaveLength(17);
  });

  test.each(LOCALE_FILES)("%s has every string", (file: string) => {
    const locale: Record<string, string> = JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
    );

    expect(
      STRINGS.filter((text: string): boolean => {
        return typeof locale[text] !== "string" || locale[text]!.length === 0;
      }),
    ).toEqual([]);
  });

  test.each(
    LOCALE_FILES.filter((file: string): boolean => {
      return file !== "en.json";
    }),
  )("%s translates every sentence", (file: string) => {
    const locale: Record<string, string> = JSON.parse(
      fs.readFileSync(path.join(LOCALES_DIR, file), "utf8"),
    );

    // Product names stay as they are; a sentence is translated.
    const sentences: Array<string> = STRINGS.filter((text: string): boolean => {
      return text.split(" ").length >= 4;
    });

    expect(sentences.length).toBeGreaterThanOrEqual(8);
    expect(
      sentences.filter((text: string): boolean => {
        return locale[text] === text;
      }),
    ).toEqual([]);
  });

  test("the sentences that told people to retype a settings path are gone from every locale", () => {
    for (const file of LOCALE_FILES) {
      const keys: Array<string> = Object.keys(
        JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, file), "utf8")),
      );

      expect({
        file,
        stale: keys.filter((key: string): boolean => {
          return key.includes(
            "Please go to Project Settings > Workspace Connections",
          );
        }),
      }).toEqual({ file, stale: [] });
    }
  });
});
