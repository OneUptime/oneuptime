import { describe, expect, test } from "@jest/globals";
import fs from "fs";
import path from "path";
import {
  MCP_API_KEY_PLACEHOLDER,
  MCP_CLIENTS,
  MCP_CLIENT_CONFIG_FILES,
  MCP_SIGN_IN_ANSWERS,
  MCP_SIGN_IN_COPY,
  MCP_SIGN_IN_TITLE,
  McpClient,
  McpConnectSetupStep,
  McpSignIn,
  getMcpConnectSetup,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Mcp/McpConnectSetup";
import {
  MCP_API_KEY_NOTE,
  MCP_SERVER_CARD_DESCRIPTION,
  MCP_SIGNED_IN_NOTE,
} from "../../../../App/FeatureSet/Dashboard/src/Components/Mcp/McpServerCard";

/*
 * Project Settings > AI > MCP Server asks how a client signs in, then shows
 * one client's setup for that way (McpConnectSetup). Each setup's sentence
 * is a translation key whose {{slots}} the card draws - the /mcp command,
 * the client's file, Claude's menu - and each snippet is what the client
 * reads, with this instance's address in it.
 */

const MCP_URL: string = "https://oneuptime.example.com/mcp";

// The slots McpServerCard draws.
const DRAWN_SLOTS: ReadonlyArray<string> = [
  "command",
  "file",
  "connectorsMenu",
  "addConnector",
];

const LANGUAGES: ReadonlyArray<string> = [
  "de",
  "fr",
  "es",
  "it",
  "pt",
  "nl",
  "da",
  "no",
  "sv",
  "ru",
  "ja",
  "ko",
  "zh-CN",
  "zh-TW",
  "hi",
  "fa",
];

const LOCALES: string = path.join(
  __dirname,
  "..",
  "..",
  "..",
  "..",
  "App",
  "FeatureSet",
  "Dashboard",
  "src",
  "Locales",
);

function locale(code: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES, `${code}.json`), "utf8"),
  ) as Record<string, string>;
}

function slotsOf(sentence: string): Array<string> {
  return Array.from(sentence.matchAll(/\{\{(\w+)\}\}/g)).map(
    (match: RegExpMatchArray): string => {
      return match[1] as string;
    },
  );
}

type Case = [McpClient, McpSignIn];

const CASES: Array<Case> = MCP_CLIENTS.flatMap(
  (client: McpClient): Array<Case> => {
    return MCP_SIGN_IN_ANSWERS.map((signIn: McpSignIn): Case => {
      return [client, signIn];
    });
  },
);

function setupOf(client: McpClient, signIn: McpSignIn): McpConnectSetupStep {
  return getMcpConnectSetup({ client, signIn, mcpUrl: MCP_URL });
}

// Every sentence the card can show, and the ones that are not product names.
const SENTENCES: Array<string> = [
  MCP_SIGN_IN_TITLE,
  ...MCP_SIGN_IN_ANSWERS.flatMap((answer: McpSignIn): Array<string> => {
    return [
      MCP_SIGN_IN_COPY[answer].title,
      MCP_SIGN_IN_COPY[answer].description,
    ];
  }),
  ...CASES.map(([client, signIn]: Case): string => {
    return setupOf(client, signIn).instruction;
  }),
  MCP_SERVER_CARD_DESCRIPTION,
  MCP_SIGNED_IN_NOTE,
  MCP_API_KEY_NOTE,
  "Server URL",
  "Your client",
  "Project Settings → Advanced → API Keys",
  "Connected MCP Clients",
];

describe("signing in", () => {
  test("is asked first, with OneUptime the first answer and an API key the second", () => {
    expect(MCP_SIGN_IN_ANSWERS).toEqual([
      McpSignIn.OneUptime,
      McpSignIn.ApiKey,
    ]);
  });
});

describe("a client's setup", () => {
  test.each(CASES)(
    "%s, %s: its sentence uses only the slots the card draws, and a file only where the client has one",
    (client: McpClient, signIn: McpSignIn) => {
      const slots: Array<string> = slotsOf(setupOf(client, signIn).instruction);

      for (const slot of slots) {
        expect(DRAWN_SLOTS).toContain(slot);
      }

      expect(slots.includes("file")).toBe(
        Boolean(MCP_CLIENT_CONFIG_FILES[client]) &&
          setupOf(client, signIn).code?.language === "json",
      );
      // The /mcp command is Claude Code's, and it signs in with it.
      expect(slots.includes("command")).toBe(
        client === McpClient.ClaudeCode && signIn === McpSignIn.OneUptime,
      );
    },
  );

  test.each(CASES)(
    "%s, %s: a JSON snippet is JSON, and every snippet names this instance's address",
    (client: McpClient, signIn: McpSignIn) => {
      const code: McpConnectSetupStep["code"] = setupOf(client, signIn).code;

      if (!code) {
        // Only Claude's connector menu has nothing to copy.
        expect([client, signIn]).toEqual([
          McpClient.ClaudeDesktop,
          McpSignIn.OneUptime,
        ]);
        return;
      }

      expect(code.text).toContain(MCP_URL);

      if (code.language === "json") {
        expect(() => {
          return JSON.parse(code.text);
        }).not.toThrow();
      }
    },
  );

  test.each(MCP_CLIENTS)(
    "%s: signing in carries no key; an API key is sent in x-api-key",
    (client: McpClient) => {
      const signedIn: string =
        setupOf(client, McpSignIn.OneUptime).code?.text || "";
      const withKey: string =
        setupOf(client, McpSignIn.ApiKey).code?.text || "";

      expect(signedIn).not.toMatch(/x-api-key|header/i);
      expect(withKey).toContain("x-api-key");
    },
  );

  test("VS Code asks for the key when the server starts, so the file never holds it", () => {
    const vsCode: Record<string, unknown> = JSON.parse(
      setupOf(McpClient.VsCode, McpSignIn.ApiKey).code!.text,
    ) as Record<string, unknown>;

    expect(JSON.stringify(vsCode)).not.toContain(MCP_API_KEY_PLACEHOLDER);
    expect(vsCode["inputs"]).toEqual([
      {
        type: "promptString",
        id: "oneuptime-api-key",
        description: "OneUptime API Key",
        password: true,
      },
    ]);
  });

  test("Cursor reads mcpServers, VS Code servers: each has its own setup", () => {
    for (const signIn of MCP_SIGN_IN_ANSWERS) {
      const cursor: Record<string, unknown> = JSON.parse(
        setupOf(McpClient.Cursor, signIn).code!.text,
      ) as Record<string, unknown>;
      const vsCode: Record<string, unknown> = JSON.parse(
        setupOf(McpClient.VsCode, signIn).code!.text,
      ) as Record<string, unknown>;

      expect(Object.keys(cursor)).toEqual(["mcpServers"]);
      expect(Object.keys(vsCode)[0]).toBe("servers");
    }
  });
});

describe("the card's words", () => {
  const english: Record<string, string> = locale("en");

  test.each(SENTENCES)("%s is a key", (sentence: string) => {
    expect(english[sentence]).toBe(sentence);
  });

  test.each(LANGUAGES)(
    "%s: every sentence is translated, with its slots kept",
    (language: string) => {
      const translated: Record<string, string> = locale(language);
      const untranslated: Array<string> = [];

      for (const sentence of SENTENCES) {
        const value: string | undefined = translated[sentence];

        expect({ sentence, has: typeof value }).toEqual({
          sentence,
          has: "string",
        });
        expect({ sentence, slots: slotsOf(value!).sort() }).toEqual({
          sentence,
          slots: slotsOf(sentence).sort(),
        });

        // A product's name reads the same in every language.
        if (value === sentence && sentence !== "OneUptime") {
          untranslated.push(sentence);
        }
      }

      expect(untranslated).toEqual([]);
    },
  );
});
