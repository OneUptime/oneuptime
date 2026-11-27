import ExternalMcpServer from "../../../../Models/DatabaseModels/ExternalMcpServer";
import AIChatPermissionMode from "../../../../Types/AI/AIChatPermissionMode";
import { EVERY_EXTERNAL_MCP_SERVER } from "../../../../Types/AI/ExternalMcpServer/ExternalMcpServerAllowance";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import LIMIT_MAX from "../../../../Types/Database/LimitMax";
import ObjectID from "../../../../Types/ObjectID";
import ExternalMcpServerService from "../../../Services/ExternalMcpServerService";
import logger from "../../Logger";
import CallerPermission from "../../Permission/CallerPermission";
import McpRunToolkit, { McpRunChatApp } from "../Mcp/McpRunToolkit";
import { ChatExtraTool } from "./ChatAgentRunner";
import ToolOutputPager from "./ToolOutputPager";

/*
 * THE PROJECT'S EXTERNAL MCP SERVERS IN ONE CHAT TURN - Ask AI in the
 * Dashboard, or an incident's or alert's conversation - for the person
 * asking (issue #10879).
 *
 * A project connected its MCP servers under Project Settings → AI →
 * External MCP Servers - Test connection worked and found their tools - and
 * asked Ask AI, and an incident's investigation box, to use them. Both said
 * they could not see them: the servers' tools were only ever handed to
 * OneUptime AI's own runs (an investigation, a fix), never to a chat turn,
 * and a turn's prompt never named a server.
 *
 * Now a turn has them, built from current data every turn (and again for a
 * turn resumed after an approval, since tools are never persisted):
 *
 *   - every server of the project that is on (Let OneUptime AI use this
 *     server). AI rules name the servers OneUptime AI's own investigations
 *     and fixes may use for what they match; a person asking picks the
 *     server themselves, as their code tools read every repository they
 *     may read;
 *   - only for a person who may read the project's External MCP Servers:
 *     anyone else is offered none, and the prompt says so without naming
 *     one;
 *   - their tools that only read, at once (call_mcp_tool), and any other -
 *     one its server marks as a change, or does not mark read-only - only
 *     once the person approves the call on a card, in every permission mode
 *     but Read-only, which never offers it (call_mcp_tool_with_approval). A
 *     change takes what starting a runbook takes (McpRunToolkit);
 *   - Enable AI is read again before every connection and every call: with
 *     it off, nothing is sent (McpRunToolkit, AiCommandKillSwitch).
 *
 * Servers that are off are named in the prompt, so a question about one is
 * answered with why it cannot be used. Nothing here throws: a lookup that
 * fails leaves the turn answering from OneUptime's own data.
 *
 * OneUptime AI's answers in Slack and Microsoft Teams have them too (issue
 * #11082, buildForChatAppAnswer), for the person who asked there - the
 * OneUptime account their chat account is linked to, as every answer there
 * is read: someone whose account is not linked is asked to link it and gets
 * no answer at all - and only the tools that read: a chat app shows no card,
 * so nothing that may change something is offered, and the answer says
 * where it can be.
 */

// The heading every turn's section about the servers starts with.
export const EXTERNAL_MCP_SERVERS_SECTION_HEADING: string =
  "# External MCP servers";

/*
 * Told to the model when the project has servers but the person asking may
 * not use them: it names none of them, and lets the answer say why.
 */
export const EXTERNAL_MCP_SERVERS_OUT_OF_REACH_SECTION: string = [
  EXTERNAL_MCP_SERVERS_SECTION_HEADING,
  "This project has MCP servers connected for OneUptime AI, but the person asking may not use them: their role does not let them read the project's External MCP Servers. If they ask about one, or for one of its tools, say so, and that a Project Admin can give their role that permission.",
].join("\n");

// What one turn may use of the project's servers, for the person asking.
export interface ChatMcpServers {
  extraTools: Array<ChatExtraTool>;
  instructions: string;
  // Ends the sessions the turn opened on the servers. Never throws.
  close: () => Promise<void>;
}

export default class ChatMcpAccess {
  /*
   * Whether the person may use the project's servers at all: what reading
   * its External MCP Servers takes - a Viewer may, as everyone who reads
   * the project's settings may see them. Root and master-admin props are
   * a run of OneUptime's own, never a person asking in a chat.
   */
  public static mayUseServers(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): boolean {
    return CallerPermission.holdsModelPermission(
      data.props,
      { model: new ExternalMcpServer(), operation: "read" },
      { projectId: data.projectId },
    );
  }

  /*
   * The servers' tools and the prompt's section about them, for one turn.
   * Null when the project has no server at all - nothing to say - or when
   * they cannot be read.
   */
  public static async buildForTurn(data: {
    projectId: ObjectID;
    aiRunId: ObjectID;
    props: DatabaseCommonInteractionProps;
    permissionMode: AIChatPermissionMode;
    // The turn's pager: the servers' long answers page with it.
    outputPager: ToolOutputPager;
    // Whether the turn offers read_tool_output already (its command tools).
    hasReadToolOutput: boolean;
  }): Promise<ChatMcpServers | null> {
    try {
      const [onServers, offServers]: [
        Array<ExternalMcpServer>,
        Array<ExternalMcpServer>,
      ] = await Promise.all([
        ExternalMcpServerService.findServersForRun({
          projectId: data.projectId,
          allowance: EVERY_EXTERNAL_MCP_SERVER,
        }),
        ExternalMcpServerService.findBy({
          query: { projectId: data.projectId, isEnabled: false },
          select: { _id: true, name: true, projectId: true },
          limit: LIMIT_MAX,
          skip: 0,
          props: { isRoot: true },
        }),
      ]);

      if (onServers.length === 0 && offServers.length === 0) {
        return null;
      }

      if (
        !this.mayUseServers({ projectId: data.projectId, props: data.props })
      ) {
        return {
          extraTools: [],
          instructions: EXTERNAL_MCP_SERVERS_OUT_OF_REACH_SECTION,
          close: async (): Promise<void> => {},
        };
      }

      const offLine: string = this.buildTurnedOffLine(offServers);

      const toolkit: McpRunToolkit = new McpRunToolkit({
        projectId: data.projectId,
        aiRunId: data.aiRunId,
        servers: onServers,
        purpose: "chat",
        props: data.props,
        canAskToChange: data.permissionMode !== AIChatPermissionMode.ReadOnly,
        outputPager: data.outputPager,
      });

      if (!toolkit.hasServers()) {
        return {
          extraTools: [],
          instructions: [
            EXTERNAL_MCP_SERVERS_SECTION_HEADING,
            offLine,
            "You cannot use them: when the person asks about one, or for one of its tools, say that it is turned off for OneUptime AI, and that a Project Admin can turn it on on the server's page.",
          ].join("\n"),
          close: async (): Promise<void> => {},
        };
      }

      const extraTools: Array<ChatExtraTool> = toolkit.buildChatTools();

      // Long answers are paged: read on with read_tool_output, offered once.
      if (!data.hasReadToolOutput) {
        extraTools.push(data.outputPager.buildReadTool());
      }

      return {
        extraTools,
        instructions: [toolkit.buildPersonaAddendum(), offLine]
          .filter((section: string): boolean => {
            return section.length > 0;
          })
          .join("\n"),
        close: async (): Promise<void> => {
          await toolkit.close();
        },
      };
    } catch (error) {
      logger.error(
        `AI: could not offer the project's external MCP servers in a chat turn; it answers from OneUptime's data only: ${error}`,
      );

      return null;
    }
  }

  /*
   * The servers' tools and the prompt's section about them, for one answer
   * OneUptime AI posts to Slack or Microsoft Teams (issue #11082), for the
   * person who asked there: their linked OneUptime account, held to what
   * reading the project's External MCP Servers takes, as Ask AI holds them
   * (mayUseServers). Only the tools that read - by their server's word, or
   * a Project Admin's mark that holds - are offered and called: a chat app
   * shows no card to approve anything else on, so the answer never has
   * call_mcp_tool_with_approval, and says that Ask AI in the Dashboard can
   * use the others. Enable AI and the answer's limits hold as in every run
   * (McpRunToolkit). Null when the project has no server, or they cannot be
   * read.
   */
  public static async buildForChatAppAnswer(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    chatApp: McpRunChatApp;
    // The answer's pager: the servers' long answers page with it.
    outputPager: ToolOutputPager;
  }): Promise<ChatMcpServers | null> {
    try {
      const [onServers, offServers]: [
        Array<ExternalMcpServer>,
        Array<ExternalMcpServer>,
      ] = await Promise.all([
        ExternalMcpServerService.findServersForRun({
          projectId: data.projectId,
          allowance: EVERY_EXTERNAL_MCP_SERVER,
        }),
        ExternalMcpServerService.findBy({
          query: { projectId: data.projectId, isEnabled: false },
          select: { _id: true, name: true, projectId: true },
          limit: LIMIT_MAX,
          skip: 0,
          props: { isRoot: true },
        }),
      ]);

      if (onServers.length === 0 && offServers.length === 0) {
        return null;
      }

      if (
        !this.mayUseServers({ projectId: data.projectId, props: data.props })
      ) {
        return {
          extraTools: [],
          instructions: EXTERNAL_MCP_SERVERS_OUT_OF_REACH_SECTION,
          close: async (): Promise<void> => {},
        };
      }

      const offLine: string = this.buildTurnedOffLine(offServers);

      const toolkit: McpRunToolkit = new McpRunToolkit({
        projectId: data.projectId,
        servers: onServers,
        purpose: "chatApp",
        chatApp: data.chatApp,
        props: data.props,
        outputPager: data.outputPager,
      });

      if (!toolkit.hasServers()) {
        return {
          extraTools: [],
          instructions: [
            EXTERNAL_MCP_SERVERS_SECTION_HEADING,
            offLine,
            "You cannot use them: when the person asks about one, or for one of its tools, say that it is turned off for OneUptime AI, and that a Project Admin can turn it on on the server's page.",
          ].join("\n"),
          close: async (): Promise<void> => {},
        };
      }

      return {
        // Long answers are paged: read on with read_tool_output.
        extraTools: [
          ...toolkit.buildTools(),
          data.outputPager.buildReadTool(),
        ] as Array<ChatExtraTool>,
        instructions: [toolkit.buildPersonaAddendum(), offLine]
          .filter((section: string): boolean => {
            return section.length > 0;
          })
          .join("\n"),
        close: async (): Promise<void> => {
          await toolkit.close();
        },
      };
    } catch (error) {
      logger.error(
        `AI: could not offer the project's external MCP servers in a ${data.chatApp.name} answer; it answers from OneUptime's data only: ${error}`,
      );

      return null;
    }
  }

  /*
   * The servers that are off for OneUptime AI, by name, or "" when none
   * is: a question about one is answered with why it cannot be used.
   */
  private static buildTurnedOffLine(servers: Array<ExternalMcpServer>): string {
    const names: Array<string> = servers
      .map((server: ExternalMcpServer): string => {
        return (server.name || "").replace(/\s+/g, " ").trim();
      })
      .filter((name: string): boolean => {
        return name.length > 0;
      });

    if (names.length === 0) {
      return "";
    }

    return `Turned off for OneUptime AI (Let OneUptime AI use this server is off on its page): ${names.join(", ")}.`;
  }
}
