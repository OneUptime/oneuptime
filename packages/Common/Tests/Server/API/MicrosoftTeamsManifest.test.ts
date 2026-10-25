import { describe, expect, test, afterEach } from "@jest/globals";
import fs from "fs";
import path from "path";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import MicrosoftTeamsAPI from "../../../Server/API/MicrosoftTeamsAPI";
import Markdown, { MarkdownContentType } from "../../../Server/Types/Markdown";
import { escapeRegExp } from "../../../Utils/RegExpEscape";
import MicrosoftTeamsCommands from "../../../Server/Utils/Workspace/MicrosoftTeams/MicrosoftTeamsCommands";
import WorkspaceCommands, {
  WorkspaceCommandName,
} from "../../../Server/Utils/Workspace/WorkspaceCommands";
import ProductBrandingText from "../../../Server/Utils/ProductBrandingText";

const MOCK_TEAMS_CLIENT_ID: string = "11111111-2222-3333-4444-555555555555";

interface MockEnvironmentState {
  // null: whatever EnvironmentConfig itself says.
  appVersion: string | null;
}

/*
 * AppVersion decides the manifest's version and has to differ per test, so
 * it is exposed as a getter over mutable state rather than a frozen value.
 */
const mockEnvironmentState: MockEnvironmentState = {
  appVersion: null,
};

jest.mock("../../../Server/EnvironmentConfig", () => {
  const actualConfig: Record<string, unknown> = jest.requireActual(
    "../../../Server/EnvironmentConfig",
  ) as Record<string, unknown>;

  const mockedConfig: Record<string, unknown> = {
    ...actualConfig,
    MicrosoftTeamsAppClientId: "11111111-2222-3333-4444-555555555555",
  };

  /*
   * defineProperty rather than a `get` in the object literal: TypeScript
   * downlevels a spread-plus-getter literal into Object.assign, which reads the
   * getter once and freezes its value — the accessor has to be attached after
   * the spread to stay live.
   */
  Object.defineProperty(mockedConfig, "AppVersion", {
    configurable: true,
    enumerable: true,
    get: (): unknown => {
      return mockEnvironmentState.appVersion === null
        ? actualConfig["AppVersion"]
        : mockEnvironmentState.appVersion;
    },
  });

  return mockedConfig;
});

const PACKAGES_ROOT: string = path.resolve(__dirname, "../../../..");

const DASHBOARD_DOCUMENTATION_PATH: string = path.resolve(
  PACKAGES_ROOT,
  "App/FeatureSet/Dashboard/src/Components/MicrosoftTeams/MicrosoftTeamsIntegrationDocumentation.tsx",
);

const SELF_HOSTED_DOCS_PATH: string = path.resolve(
  PACKAGES_ROOT,
  "App/FeatureSet/Docs/Content/en/self-hosted/microsoft-teams-integration.md",
);

// The line each doc introduces its list of the manifest's RSC permissions with.
const RSC_LIST_INTRO: string =
  "Resource-Specific Consent (RSC) permissions defined in the Teams app manifest";

const BULLET_NAME_PATTERN: RegExp = /^\s*-\s+\*\*([^*]+)\*\*/;

type ReadDocFunction = (filePath: string) => string;

const readDoc: ReadDocFunction = (filePath: string): string => {
  return fs.readFileSync(filePath, "utf8");
};

/*
 * The **Name** of every bullet in the list that follows the first line
 * containing `intro` — blank lines before the list are skipped, and the list
 * ends at the first line that is not a bullet. null when there is no such line.
 */
type GetBulletNamesAfterFunction = (
  text: string,
  intro: string,
) => Array<string> | null;

const getBulletNamesAfter: GetBulletNamesAfterFunction = (
  text: string,
  intro: string,
): Array<string> | null => {
  const lines: Array<string> = text.split("\n");
  const introIndex: number = lines.findIndex((line: string) => {
    return line.includes(intro);
  });

  if (introIndex === -1) {
    return null;
  }

  const names: Array<string> = [];
  let index: number = introIndex + 1;

  while (index < lines.length && lines[index]!.trim() === "") {
    index++;
  }

  for (; index < lines.length; index++) {
    const match: RegExpMatchArray | null =
      lines[index]!.match(BULLET_NAME_PATTERN);
    if (!match) {
      break;
    }
    names.push(match[1]!);
  }

  return names;
};

type GetManifestFunction = () => JSONObject;

const getManifest: GetManifestFunction = (): JSONObject => {
  return (
    MicrosoftTeamsAPI as unknown as {
      getTeamsAppManifest: GetManifestFunction;
    }
  ).getTeamsAppManifest();
};

type GetBotFunction = (manifest: JSONObject) => JSONObject;

const getBot: GetBotFunction = (manifest: JSONObject): JSONObject => {
  const bots: JSONArray = manifest["bots"] as JSONArray;
  return bots[0] as JSONObject;
};

type GetResourceSpecificPermissionsFunction = (
  manifest: JSONObject,
) => Array<JSONObject>;

const getResourceSpecificPermissions: GetResourceSpecificPermissionsFunction = (
  manifest: JSONObject,
): Array<JSONObject> => {
  const authorization: JSONObject = manifest["authorization"] as JSONObject;
  const permissions: JSONObject = authorization["permissions"] as JSONObject;
  return permissions["resourceSpecific"] as Array<JSONObject>;
};

describe("MicrosoftTeamsAPI.getTeamsAppManifest", () => {
  afterEach(() => {
    mockEnvironmentState.appVersion = null;
    jest.restoreAllMocks();
  });

  describe("bot scopes (chat support)", () => {
    test("declares exactly one bot", () => {
      const manifest: JSONObject = getManifest();
      const bots: JSONArray = manifest["bots"] as JSONArray;
      expect(bots).toHaveLength(1);
    });

    test("bot scopes contain exactly team, personal and groupChat", () => {
      const bot: JSONObject = getBot(getManifest());
      const scopes: Array<string> = bot["scopes"] as Array<string>;
      expect([...scopes].sort()).toEqual(
        ["groupChat", "personal", "team"].sort(),
      );
    });

    test("bot scopes include groupChat so the bot can be added to group chats", () => {
      const bot: JSONObject = getBot(getManifest());
      expect(bot["scopes"] as Array<string>).toContain("groupChat");
    });

    test("bot scopes include personal so the bot can be added to 1:1 chats", () => {
      const bot: JSONObject = getBot(getManifest());
      expect(bot["scopes"] as Array<string>).toContain("personal");
    });

    test("bot is not notification-only (it must receive conversationUpdate events to capture chats)", () => {
      const bot: JSONObject = getBot(getManifest());
      expect(bot["isNotificationOnly"]).toBe(false);
    });
  });

  describe("identity", () => {
    test("bot id equals the Microsoft Teams app client id", () => {
      const bot: JSONObject = getBot(getManifest());
      expect(bot["botId"]).toBe(MOCK_TEAMS_CLIENT_ID);
    });

    test("manifest id equals the Microsoft Teams app client id", () => {
      const manifest: JSONObject = getManifest();
      expect(manifest["id"]).toBe(MOCK_TEAMS_CLIENT_ID);
    });

    test("webApplicationInfo id equals the Microsoft Teams app client id", () => {
      const manifest: JSONObject = getManifest();
      const webApplicationInfo: JSONObject = manifest[
        "webApplicationInfo"
      ] as JSONObject;
      expect(webApplicationInfo["id"]).toBe(MOCK_TEAMS_CLIENT_ID);
    });
  });

  describe("resource-specific consent permissions", () => {
    test.each([
      "ChannelMessage.Send.Group",
      "ChannelMessage.Read.Group",
      "Channel.Create.Group",
      "ChatMessage.Read.Chat",
      "ChatMember.Read.Chat",
    ])("includes the %s permission with type Application", (name: string) => {
      const permissions: Array<JSONObject> =
        getResourceSpecificPermissions(getManifest());
      const match: JSONObject | undefined = permissions.find(
        (permission: JSONObject) => {
          return permission["name"] === name;
        },
      );
      expect(match).toBeDefined();
      expect(match!["type"]).toBe("Application");
    });

    test("does NOT include a ChatMessage.Send.Chat permission (not part of Microsoft's RSC catalog - chat sends go through the bot)", () => {
      const permissions: Array<JSONObject> =
        getResourceSpecificPermissions(getManifest());
      const names: Array<string> = permissions.map((permission: JSONObject) => {
        return permission["name"] as string;
      });
      expect(names).not.toContain("ChatMessage.Send.Chat");
    });

    test("declares exactly the seven expected resource-specific permissions", () => {
      const permissions: Array<JSONObject> =
        getResourceSpecificPermissions(getManifest());
      const names: Array<string> = permissions.map((permission: JSONObject) => {
        return permission["name"] as string;
      });
      expect(names.sort()).toEqual(
        [
          "ChannelMessage.Send.Group",
          "ChannelMessage.Read.Group",
          "Channel.Create.Group",
          "ChatMessage.Read.Chat",
          "ChatMember.Read.Chat",
          // Lets OneUptime read a group chat's name (issue #4106).
          "ChatSettings.Read.Chat",
          /*
           * Lets OneUptime verify, per team, that the installed OneUptime app
           * is the package built from this deployment before telling an admin
           * their app is missing.
           */
          "TeamsAppInstallation.Read.Group",
        ].sort(),
      );
    });

    test("every resource-specific permission is of type Application", () => {
      const permissions: Array<JSONObject> =
        getResourceSpecificPermissions(getManifest());
      for (const permission of permissions) {
        expect(permission["type"]).toBe("Application");
      }
    });

    test("top-level permissions stay identity + messageTeamMembers", () => {
      const manifest: JSONObject = getManifest();
      expect(manifest["permissions"]).toEqual([
        "identity",
        "messageTeamMembers",
      ]);
    });
  });

  describe("command lists", () => {
    test("commandLists cover all three scopes (team, groupChat, personal)", () => {
      const bot: JSONObject = getBot(getManifest());
      const commandLists: Array<JSONObject> = bot[
        "commandLists"
      ] as Array<JSONObject>;
      const coveredScopes: Set<string> = new Set<string>();
      for (const commandList of commandLists) {
        for (const scope of commandList["scopes"] as Array<string>) {
          coveredScopes.add(scope);
        }
      }
      expect([...coveredScopes].sort()).toEqual(
        ["groupChat", "personal", "team"].sort(),
      );
    });

    test("every commandList scope is a declared bot scope", () => {
      const bot: JSONObject = getBot(getManifest());
      const botScopes: Array<string> = bot["scopes"] as Array<string>;
      const commandLists: Array<JSONObject> = bot[
        "commandLists"
      ] as Array<JSONObject>;
      for (const commandList of commandLists) {
        for (const scope of commandList["scopes"] as Array<string>) {
          expect(botScopes).toContain(scope);
        }
      }
    });

    test("commandLists include a help command", () => {
      const bot: JSONObject = getBot(getManifest());
      const commandLists: Array<JSONObject> = bot[
        "commandLists"
      ] as Array<JSONObject>;
      const commandTitles: Array<string> = commandLists.flatMap(
        (commandList: JSONObject) => {
          return (commandList["commands"] as Array<JSONObject>).map(
            (command: JSONObject) => {
              return command["title"] as string;
            },
          );
        },
      );
      expect(commandTitles).toContain("help");
    });

    // Every command of every list, as Teams reads them.
    function commandsOf(manifest: JSONObject): Array<JSONObject> {
      return (getBot(manifest)["commandLists"] as Array<JSONObject>).flatMap(
        (commandList: JSONObject): Array<JSONObject> => {
          return commandList["commands"] as Array<JSONObject>;
        },
      );
    }

    /*
     * Customer feedback #5: one namespace of commands. What Teams suggests
     * after "@OneUptime" are the words Slack's /oneuptime takes, then Teams'
     * own lists, then help - as the help lists them.
     */
    test("the commands are the words Slack's /oneuptime takes, then Teams' own lists, then help", () => {
      expect(
        commandsOf(getManifest()).map((command: JSONObject): unknown => {
          return command["title"];
        }),
      ).toEqual([
        "incident",
        "maintenance",
        "oncall",
        "page",
        "ask",
        "show active incidents",
        "show active alerts",
        "show scheduled maintenance",
        "show ongoing maintenance",
        "help",
      ]);
    });

    /*
     * A title is what Teams puts in the message when it is picked, so it is
     * the command alone: the description says what it does, and - for a
     * command that opens a form - that a title may follow it.
     */
    test("each says what it does, in a sentence of its own - and what may follow it", () => {
      expect(commandsOf(getManifest())).toEqual([
        {
          title: "incident",
          description:
            "Declare an incident, or act on one by its number. Type a title or an incident's number after it.",
        },
        {
          title: "maintenance",
          description: "Schedule maintenance. Type a title after it.",
        },
        {
          title: "oncall",
          description: "See who is on call right now.",
        },
        {
          title: "page",
          description:
            "Page a person, a team or whoever is on call. Mention who, then type a message.",
        },
        {
          title: "ask",
          description:
            "Ask OneUptime AI about your logs, traces, metrics, incidents and monitors.",
        },
        {
          title: "show active incidents",
          description: "List the incidents that are open right now.",
        },
        {
          title: "show active alerts",
          description: "List the alerts that are open right now.",
        },
        {
          title: "show scheduled maintenance",
          description: "List the scheduled maintenance events still to come.",
        },
        {
          title: "show ongoing maintenance",
          description: "List the maintenance events in progress.",
        },
        {
          title: "help",
          description: "List every command.",
        },
      ]);
    });

    test("a description never points at a list around it: Teams shows each alone, in its command menu", () => {
      for (const command of commandsOf(getManifest())) {
        expect(command["description"] as string).not.toContain("these");
      }
    });

    /*
     * Teams' manifest schema: at most 10 commands in a list, a title of 32
     * characters and a description of 128 at most.
     */
    test("within what Teams takes: ten commands a list, 32-character titles, 128-character descriptions", () => {
      for (const commandList of getBot(getManifest())[
        "commandLists"
      ] as Array<JSONObject>) {
        expect(
          (commandList["commands"] as Array<JSONObject>).length,
        ).toBeLessThanOrEqual(10);
      }

      for (const command of commandsOf(getManifest())) {
        expect((command["title"] as string).length).toBeLessThanOrEqual(32);
        expect((command["description"] as string).length).toBeLessThanOrEqual(
          128,
        );
      }
    });

    test("every command Teams suggests is one the bot answers - not a question for AI", () => {
      for (const command of commandsOf(getManifest())) {
        const title: string = command["title"] as string;

        expect({
          title,
          answered:
            MicrosoftTeamsCommands.getListCommand(title) !== null ||
            WorkspaceCommands.parse(title).command !== null,
        }).toEqual({ title, answered: true });
      }
    });

    test("'create incident' and 'create maintenance' are no longer suggested, and still work when typed", () => {
      const titles: Array<unknown> = commandsOf(getManifest()).map(
        (command: JSONObject): unknown => {
          return command["title"];
        },
      );

      expect(titles).not.toContain("create incident");
      expect(titles).not.toContain("create maintenance");
      expect(WorkspaceCommands.parse("create incident").command).toBe(
        WorkspaceCommandName.Incident,
      );
      expect(WorkspaceCommands.parse("create maintenance").command).toBe(
        WorkspaceCommandName.Maintenance,
      );
    });

    test("the product's name in a description is the one the installation goes by", () => {
      jest
        .spyOn(ProductBrandingText, "getProductName")
        .mockReturnValue("Acme Ops");

      expect(
        commandsOf(getManifest()).find((command: JSONObject): boolean => {
          return command["title"] === "ask";
        }),
      ).toEqual({
        title: "ask",
        description:
          "Ask Acme Ops AI about your logs, traces, metrics, incidents and monitors.",
      });
    });

    test("a product name long enough to push a description past Teams' 128 characters: the description is cut, so Teams still takes the package", () => {
      jest
        .spyOn(ProductBrandingText, "getProductName")
        .mockReturnValue("A".repeat(80));

      const ask: JSONObject | undefined = commandsOf(getManifest()).find(
        (command: JSONObject): boolean => {
          return command["title"] === "ask";
        },
      );
      const description: string = ask?.["description"] as string;

      expect(description).toHaveLength(128);
      expect(description.startsWith(`Ask ${"A".repeat(80)} AI about`)).toBe(
        true,
      );
      expect(description.endsWith("…")).toBe(true);

      for (const command of commandsOf(getManifest())) {
        expect((command["description"] as string).length).toBeLessThanOrEqual(
          128,
        );
      }
    });
  });

  describe("manifest schema basics", () => {
    test("uses manifest schema version 1.25", () => {
      const manifest: JSONObject = getManifest();
      expect(manifest["manifestVersion"]).toBe("1.25");
      expect(manifest["$schema"]).toBe(
        "https://developer.microsoft.com/json-schemas/teams/v1.25/MicrosoftTeams.schema.json",
      );
    });

    /*
     * Partner Center refuses a store package without it
     * (SubmissionContextMissingSupportsChannelFeatures), and Teams offers the
     * app in shared and private channels only with it.
     */
    test("declares support for shared and private channels (supportsChannelFeatures tier1)", () => {
      const manifest: JSONObject = getManifest();
      expect(manifest["supportsChannelFeatures"]).toBe("tier1");
    });

    // Manifest v1.25 replaced supportedChannelTypes; a package with both is refused.
    test("does not declare the retired supportedChannelTypes", () => {
      const manifest: JSONObject = getManifest();
      expect(manifest).not.toHaveProperty("supportedChannelTypes");
    });

    test("declares color and outline icons", () => {
      const manifest: JSONObject = getManifest();
      const icons: JSONObject = manifest["icons"] as JSONObject;
      expect(icons["color"]).toBe("color.png");
      expect(icons["outline"]).toBe("outline.png");
    });
  });

  /*
   * Teams only takes an uploaded package as an update of the installed app
   * when its version is higher. Release images set APP_VERSION; a build
   * without it falls back to a fixed version, raised to 1.6.0 when
   * ChatSettings.Read.Chat was added, to 1.7.0 when the commands became
   * the words Slack's /oneuptime takes, to 1.8.0 when "page" joined them,
   * to 1.9.0 when the app declared shared and private channels, and to
   * 1.10.0 when incident took an incident's number as well as a title.
   * Left behind, an admin re-uploading the manifest to pick up a change
   * would have the upload refused.
   */
  /*
   * What the store shows before anybody installs the app. Microsoft refused
   * 14.0.59 because the "ask" command named OneUptime AI and the description
   * said nothing of it (policy 1140.4.1.24): an app whose content AI writes
   * must say so here, how to report an answer that is wrong, harmful or
   * offensive - a mail address is one of the ways the store accepts - and
   * that the reports are acted on; and an app that needs an admin's setup
   * first must say that too.
   */
  describe("description", () => {
    function fullDescription(): string {
      return (getManifest()["description"] as JSONObject)["full"] as string;
    }

    test("the full description is within the 4,000 characters Teams takes, and the short one within 80", () => {
      const description: JSONObject = getManifest()[
        "description"
      ] as JSONObject;

      expect(fullDescription().length).toBeLessThanOrEqual(4000);
      expect((description["short"] as string).length).toBeLessThanOrEqual(80);
    });

    test("says that OneUptime AI answers the bot's questions, that it is generative AI, and what it reads - only reading", () => {
      const full: string = fullDescription();

      expect(full).toContain("<strong>OneUptime AI:</strong>");
      expect(full).toContain('"ask", and any other question you send the bot');
      expect(full).toContain("generative AI assistant");
      expect(full).toContain(
        "logs, traces, metrics, incidents and monitors with your own permissions",
      );
      expect(full).toContain("never changes anything");
    });

    test("asks the reader to check an answer, which is marked as AI generated", () => {
      expect(fullDescription()).toContain(
        "Answers are marked as AI generated and can be wrong, so check important details before you act on them.",
      );
    });

    test("says how to report an answer - the thumbs-down button, or a mail address - and that reports are acted on", () => {
      const full: string = fullDescription();

      expect(full).toContain(
        "To report an AI answer that is wrong, harmful or offensive, use the thumbs-down button under it, or email",
      );
      expect(full).toContain(
        '<a href="mailto:support@oneuptime.com">support@oneuptime.com</a>',
      );
      expect(full).toContain("reviews every report and acts on it promptly");
    });

    test("names the admin's one-time setup, and that each person connects their own account", () => {
      expect(fullDescription()).toContain(
        "A OneUptime project admin connects your Microsoft 365 organization once",
      );
      expect(fullDescription()).toContain(
        "everyone connects their own Microsoft Teams account the first time they use a command",
      );
    });

    test("names the bot's commands as they are typed", () => {
      const full: string = fullDescription();

      for (const command of [
        "incident",
        "maintenance",
        "oncall",
        "page",
        "help",
        "show active incidents",
        "show active alerts",
      ]) {
        expect(full).toContain(`"${command}"`);
      }
    });
  });

  describe("manifest version", () => {
    test("a build without APP_VERSION has AppVersion 'unknown' — which is what gets the fallback", () => {
      const savedAppVersion: string | undefined = process.env["APP_VERSION"];
      delete process.env["APP_VERSION"];

      let unsetAppVersion: unknown = undefined;
      try {
        // A fresh EnvironmentConfig, so it reads APP_VERSION as unset.
        jest.isolateModules(() => {
          unsetAppVersion = (
            jest.requireActual("../../../Server/EnvironmentConfig") as Record<
              string,
              unknown
            >
          )["AppVersion"];
        });
      } finally {
        if (savedAppVersion !== undefined) {
          process.env["APP_VERSION"] = savedAppVersion;
        }
      }

      expect(unsetAppVersion).toBe("unknown");

      mockEnvironmentState.appVersion = unsetAppVersion as string;
      expect(getManifest()["version"]).toBe("1.11.0");
    });

    // The check lowercases AppVersion first, so its case does not matter.
    test.each(["unknown", "Unknown", "UNKNOWN"])(
      "AppVersion %p gets the fallback version 1.11.0",
      (appVersion: string) => {
        mockEnvironmentState.appVersion = appVersion;

        expect(getManifest()["version"]).toBe("1.11.0");
      },
    );

    test.each(["10.0.42", "7.1.0-rc.3"])(
      "a release AppVersion (%p) is the manifest version, verbatim",
      (appVersion: string) => {
        mockEnvironmentState.appVersion = appVersion;

        expect(getManifest()["version"]).toBe(appVersion);
      },
    );
  });

  /*
   * An admin grants — and a tenant's preapproval policy allows — the
   * permissions the docs list. One the manifest declares but the docs leave
   * out is one nobody knows to allow, so both doc sources are checked against
   * the manifest this build actually generates.
   */
  describe("documentation lists the manifest's permissions", () => {
    const docSources: Array<[string, string]> = [
      ["the Dashboard setup guide", DASHBOARD_DOCUMENTATION_PATH],
      ["the self-hosted docs page", SELF_HOSTED_DOCS_PATH],
    ];

    type GetManifestPermissionNamesFunction = () => Array<string>;

    const getManifestPermissionNames: GetManifestPermissionNamesFunction =
      (): Array<string> => {
        return getResourceSpecificPermissions(getManifest()).map(
          (permission: JSONObject) => {
            return permission["name"] as string;
          },
        );
      };

    test.each(docSources)(
      "%s lists every resource-specific permission as a **Name** bullet",
      (_label: string, filePath: string) => {
        const text: string = readDoc(filePath);
        const names: Array<string> = getManifestPermissionNames();

        expect(names.length).toBeGreaterThan(0);

        const missing: Array<string> = names.filter((name: string) => {
          return !new RegExp(
            `^\\s*-\\s+\\*\\*${escapeRegExp(name)}\\*\\*`,
            "m",
          ).test(text);
        });

        expect(missing).toEqual([]);
      },
    );

    test.each(docSources)(
      "%s's RSC list holds exactly the manifest's resource-specific permissions",
      (_label: string, filePath: string) => {
        const listed: Array<string> | null = getBulletNamesAfter(
          readDoc(filePath),
          RSC_LIST_INTRO,
        );

        expect(listed).not.toBeNull();
        expect([...listed!].sort()).toEqual(
          getManifestPermissionNames().sort(),
        );
      },
    );

    test.each(docSources)(
      "%s lists Chat.ReadBasic.WhereInstalled as an application permission of the app registration",
      (_label: string, filePath: string) => {
        const text: string = readDoc(filePath);

        expect(text).toContain("Chat.ReadBasic.WhereInstalled");
        expect(
          getBulletNamesAfter(text, "**Add Application Permissions**"),
        ).toContain("Chat.ReadBasic.WhereInstalled");
        expect(
          getBulletNamesAfter(text, "**Add Delegated Permissions**"),
        ).not.toContain("Chat.ReadBasic.WhereInstalled");
        // It is granted in Entra, not by the manifest.
        expect(getManifestPermissionNames()).not.toContain(
          "Chat.ReadBasic.WhereInstalled",
        );
      },
    );
  });

  /*
   * The self-hosted page sends admins whose chats Refresh Chats marked to
   * the group-chat troubleshooting section. The link only lands if its
   * fragment is the id the docs renderer gives that heading.
   */
  describe("the self-hosted docs' link to the group chat section", () => {
    const HEADING: string = "A group chat is listed by its members' names";
    const ANCHOR: string = "a-group-chat-is-listed-by-its-members-names";

    test("the page has the heading", () => {
      expect(readDoc(SELF_HOSTED_DOCS_PATH)).toMatch(
        new RegExp(`^#{2,4} ${escapeRegExp(HEADING)}\\s*$`, "m"),
      );
    });

    test("the link's fragment is the slug the docs renderer makes of the heading", () => {
      expect(Markdown.slugify(HEADING)).toBe(ANCHOR);

      const link: RegExpMatchArray | null = readDoc(
        SELF_HOSTED_DOCS_PATH,
      ).match(new RegExp(`\\[${escapeRegExp(HEADING)}\\]\\(#([^)]+)\\)`));

      expect(link).not.toBeNull();
      expect(link![1]).toBe(ANCHOR);
    });

    test("the rendered page has the heading under that id, and the link pointing at it", async () => {
      // How the docs server renders a page (Docs/Utils/Render.ts).
      const html: string = await Markdown.convertToHTML(
        readDoc(SELF_HOSTED_DOCS_PATH),
        MarkdownContentType.Docs,
      );

      expect(html).toMatch(
        new RegExp(
          `<h[2-4] id="${ANCHOR}"[^>]*><span class="docs-heading__text">A group chat is listed by its members(?:'|&#39;) names</span>`,
        ),
      );
      expect(html).toMatch(
        new RegExp(
          `<a[^>]*href="#${ANCHOR}"[^>]*>A group chat is listed by its members(?:'|&#39;) names</a>`,
        ),
      );
    });
  });
});
