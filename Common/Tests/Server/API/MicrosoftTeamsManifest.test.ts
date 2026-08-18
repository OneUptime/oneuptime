import { describe, expect, test, afterEach } from "@jest/globals";
import { JSONArray, JSONObject } from "../../../Types/JSON";
import MicrosoftTeamsAPI from "../../../Server/API/MicrosoftTeamsAPI";

const MOCK_TEAMS_CLIENT_ID: string = "11111111-2222-3333-4444-555555555555";

jest.mock("../../../Server/EnvironmentConfig", () => {
  return {
    ...(jest.requireActual("../../../Server/EnvironmentConfig") as Record<
      string,
      unknown
    >),
    MicrosoftTeamsAppClientId: "11111111-2222-3333-4444-555555555555",
  };
});

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

    test("declares exactly the six expected resource-specific permissions", () => {
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
  });

  describe("manifest schema basics", () => {
    test("uses manifest schema version 1.23", () => {
      const manifest: JSONObject = getManifest();
      expect(manifest["manifestVersion"]).toBe("1.23");
      expect(manifest["$schema"]).toBe(
        "https://developer.microsoft.com/json-schemas/teams/v1.23/MicrosoftTeams.schema.json",
      );
    });

    test("declares color and outline icons", () => {
      const manifest: JSONObject = getManifest();
      const icons: JSONObject = manifest["icons"] as JSONObject;
      expect(icons["color"]).toBe("color.png");
      expect(icons["outline"]).toBe("outline.png");
    });
  });
});
