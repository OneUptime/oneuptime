import { translationKey } from "Common/UI/Utils/TranslateTemplate";

/*
 * HOW TO CONNECT AN MCP CLIENT: ONE CHOICE, THEN ONE CLIENT.
 *
 * Project Settings > AI > MCP Server explained both ways to sign in on an
 * Authentication card, then gave every client's setup twice - signing in
 * with OneUptime, then "Or connect with an API key instead" - on a card per
 * client. It asks how the client signs in now, then shows the setup of the
 * one client picked, for that way only.
 *
 * Each setup is the one the MCP Server docs give, word for word, with this
 * instance's address in it (AiDocsFacts holds them to each other). Cursor
 * has a tab of its own: it reads "mcpServers", not VS Code's "servers", so
 * the one "VS Code or Cursor" snippet the page had did not work in Cursor.
 *
 * React-free on purpose: App's tests read this without the page.
 */

export enum McpSignIn {
  OneUptime = "oneuptime",
  ApiKey = "api-key",
}

export enum McpClient {
  ClaudeCode = "claude-code",
  ClaudeDesktop = "claude-desktop",
  VsCode = "vscode",
  Cursor = "cursor",
}

// The question the choice answers.
export const MCP_SIGN_IN_TITLE: string = translationKey("Sign in with");

// Signing in first: nothing secret to copy, and the client acts as you.
export const MCP_SIGN_IN_ANSWERS: ReadonlyArray<McpSignIn> = [
  McpSignIn.OneUptime,
  McpSignIn.ApiKey,
];

export const MCP_SIGN_IN_COPY: Record<
  McpSignIn,
  { title: string; description: string }
> = {
  [McpSignIn.OneUptime]: {
    title: translationKey("OneUptime"),
    description: translationKey(
      "The client opens OneUptime for you to sign in, then acts as you, with your permissions and never more. You can limit it to read only.",
    ),
  },
  [McpSignIn.ApiKey]: {
    title: translationKey("API key"),
    description: translationKey(
      "For an agent that runs unattended, such as a scheduled job. It acts with the key's permissions, in the key's project.",
    ),
  },
};

export const MCP_CLIENTS: ReadonlyArray<McpClient> = [
  McpClient.ClaudeCode,
  McpClient.ClaudeDesktop,
  McpClient.VsCode,
  McpClient.Cursor,
];

// A client's tab: the product's name, the same in every language.
export const MCP_CLIENT_NAMES: Record<McpClient, string> = {
  [McpClient.ClaudeCode]: "Claude Code",
  [McpClient.ClaudeDesktop]: "Claude Desktop",
  [McpClient.VsCode]: "VS Code",
  [McpClient.Cursor]: "Cursor",
};

// The file a client's setup goes in, where it has one.
export const MCP_CLIENT_CONFIG_FILES: Record<McpClient, string> = {
  [McpClient.ClaudeCode]: "",
  [McpClient.ClaudeDesktop]: "claude_desktop_config.json",
  [McpClient.VsCode]: ".vscode/mcp.json",
  [McpClient.Cursor]: "~/.cursor/mcp.json",
};

// Stands for the key in a snippet; never a key itself.
export const MCP_API_KEY_PLACEHOLDER: string = "your-api-key-here";

export interface McpConnectSetupStep {
  /*
   * What to do, as a sentence template. Its slots are drawn by the page:
   * {{command}} the /mcp command, {{file}} the client's file, and
   * {{connectorsMenu}} and {{addConnector}} the menu Claude has.
   */
  instruction: string;
  // The snippet to copy, if this setup has one.
  code?: { language: "bash" | "json"; text: string } | undefined;
}

/**
 * The setup of one client, for one way of signing in.
 */
export function getMcpConnectSetup(data: {
  client: McpClient;
  signIn: McpSignIn;
  mcpUrl: string;
}): McpConnectSetupStep {
  const { client, signIn, mcpUrl } = data;
  const withKey: boolean = signIn === McpSignIn.ApiKey;

  switch (client) {
    case McpClient.ClaudeCode:
      return withKey
        ? {
            instruction: translationKey("Add the server with your API key:"),
            code: {
              language: "bash",
              text: `claude mcp add --transport http oneuptime ${mcpUrl} --header "x-api-key: ${MCP_API_KEY_PLACEHOLDER}"`,
            },
          }
        : {
            instruction: translationKey(
              "Add the server, then run {{command}} inside Claude Code and choose OneUptime to sign in:",
            ),
            code: {
              language: "bash",
              text: `claude mcp add --transport http oneuptime ${mcpUrl}`,
            },
          };

    case McpClient.ClaudeDesktop:
      return withKey
        ? {
            instruction: translationKey("Add this to {{file}}:"),
            code: {
              language: "json",
              text: `{
  "mcpServers": {
    "oneuptime": {
      "transport": "streamable-http",
      "url": "${mcpUrl}",
      "headers": {
        "x-api-key": "${MCP_API_KEY_PLACEHOLDER}"
      }
    }
  }
}`,
            },
          }
        : {
            instruction: translationKey(
              "In Claude, open {{connectorsMenu}}, choose {{addConnector}} and enter the server URL above. Claude asks you to sign in to OneUptime the first time it needs your data.",
            ),
          };

    case McpClient.VsCode:
      /*
       * With a key, VS Code asks for it when the server starts (an input
       * with "password": true), so it is never kept in the file.
       */
      return withKey
        ? {
            instruction: translationKey(
              "Add this to {{file}}. VS Code asks for your API key when you start the server:",
            ),
            code: {
              language: "json",
              text: `{
  "servers": {
    "oneuptime": {
      "type": "http",
      "url": "${mcpUrl}",
      "headers": {
        "x-api-key": "\${input:oneuptime-api-key}"
      }
    }
  },
  "inputs": [
    {
      "type": "promptString",
      "id": "oneuptime-api-key",
      "description": "OneUptime API Key",
      "password": true
    }
  ]
}`,
            },
          }
        : {
            instruction: translationKey(
              "Add this to {{file}}. VS Code opens OneUptime for you to sign in when you start the server:",
            ),
            code: {
              language: "json",
              text: `{
  "servers": {
    "oneuptime": {
      "type": "http",
      "url": "${mcpUrl}"
    }
  }
}`,
            },
          };

    case McpClient.Cursor:
      return withKey
        ? {
            instruction: translationKey("Add this to {{file}}:"),
            code: {
              language: "json",
              text: `{
  "mcpServers": {
    "oneuptime": {
      "url": "${mcpUrl}",
      "headers": {
        "x-api-key": "${MCP_API_KEY_PLACEHOLDER}"
      }
    }
  }
}`,
            },
          }
        : {
            instruction: translationKey(
              "Add this to {{file}}. Cursor opens OneUptime for you to sign in:",
            ),
            code: {
              language: "json",
              text: `{
  "mcpServers": {
    "oneuptime": {
      "url": "${mcpUrl}"
    }
  }
}`,
            },
          };
  }
}
