import crypto from "crypto";
import WorkspaceProjectAuthToken, {
  SlackMiscData,
} from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import URL from "../../../../Types/API/URL";
import ObjectID from "../../../../Types/ObjectID";
import {
  WorkspaceMessageBlock,
  WorkspacePayloadButtons,
  WorkspacePayloadMarkdown,
} from "../../../../Types/Workspace/WorkspaceMessagePayload";
import WorkspaceType from "../../../../Types/Workspace/WorkspaceType";
import FeedMarkdown, {
  MarkdownText,
  mdText,
} from "../../../../Utils/Markdown/FeedMarkdown";
import DatabaseConfig from "../../../DatabaseConfig";
import GlobalCache from "../../../Infrastructure/GlobalCache";
import WorkspaceProjectAuthTokenService from "../../../Services/WorkspaceProjectAuthTokenService";
import logger from "../../Logger";
import ProductBrandingText from "../../ProductBrandingText";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import WorkspaceCommands from "../WorkspaceCommands";
import SlackUtil from "./Slack";
import SlackActionType from "./Actions/ActionTypes";

/*
 * A SHORT HELLO WHEN SOMEBODY ADDS ONEUPTIME TO A SLACK CHANNEL.
 *
 * Somebody who invites the OneUptime app into a channel learns nothing from
 * Slack's "OneUptime joined #ops": not what it does there, nor that nothing
 * will be posted until a notification rule names the channel. So OneUptime
 * says it, once, in the channel:
 *
 *   👋 Hi, I'm OneUptime. @mention me with a question about your
 *   incidents, monitors, logs and traces, or type /oneuptime help to
 *   declare an incident, page someone or see who is on call.
 *   To post incidents, alerts or scheduled maintenance here, add a
 *   notification rule in OneUptime under Incidents → Workspace → Slack.
 *   [Set up notifications]
 *
 * Only when a PERSON added it (Slack's member_joined_channel names who
 * invited the app): the channels OneUptime creates for an incident, and the
 * public channels it joins by itself to post in, get no hello - they open on
 * what happened, as the quiet-channels work keeps them. Said once a channel
 * in a day, however often Slack tells of it.
 *
 * Microsoft Teams says the same in the card it sends when the app is added
 * to a team (MicrosoftTeams.ts, the welcome card).
 */

const WELCOMED_NAMESPACE: string = "slack-channel-welcome";

// A channel is welcomed at most once in this long.
const WELCOMED_FOR_SECONDS: number = 24 * 60 * 60;

export interface SlackChannelJoin {
  teamId: string;
  // Who joined: the app's bot, for a welcome.
  joinedUserId: string;
  channelId: string;
  // Who added them; none when the app joined by itself.
  inviterUserId?: string | undefined;
}

export default class SlackWelcome {
  /*
   * member_joined_channel: says hello when a person added the app (see the
   * header). Never throws: Slack has its 200 already.
   */
  @CaptureSpan()
  public static async handleMemberJoinedChannel(
    join: SlackChannelJoin,
  ): Promise<boolean> {
    try {
      if (!join.teamId || !join.channelId || !join.joinedUserId) {
        return false;
      }

      const projectAuth: WorkspaceProjectAuthToken | null =
        await WorkspaceProjectAuthTokenService.findOneBy({
          query: {
            workspaceProjectId: join.teamId,
            workspaceType: WorkspaceType.Slack,
          },
          select: {
            projectId: true,
            authToken: true,
            miscData: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (!projectAuth?.projectId || !projectAuth.authToken) {
        return false;
      }

      const botUserId: string | undefined = (
        projectAuth.miscData as SlackMiscData | undefined
      )?.botUserId;

      if (
        !SlackWelcome.isAddedByAPerson({
          join: join,
          botUserId: botUserId,
        })
      ) {
        return false;
      }

      if (!(await SlackWelcome.claimWelcome(join))) {
        logger.debug("Slack channel welcomed already; not welcomed again.");
        return false;
      }

      const welcome: { blocks: Array<WorkspaceMessageBlock>; text: string } =
        await SlackWelcome.getWelcome(projectAuth.projectId);

      await SlackUtil.sendPayloadBlocksToChannel({
        authToken: projectAuth.authToken,
        workspaceChannel: {
          id: join.channelId,
          name: "",
          workspaceType: WorkspaceType.Slack,
        },
        blocks: SlackUtil.getBlocksFromWorkspaceMessagePayload({
          messageBlocks: welcome.blocks,
        }),
        text: welcome.text,
      });

      return true;
    } catch (err) {
      logger.error("Could not welcome a Slack channel OneUptime was added to.");
      logger.error(err);
      return false;
    }
  }

  /*
   * The app's own bot joined, and a person - not the app itself - added
   * it. Without the bot's id, nothing is known to be the app's.
   */
  public static isAddedByAPerson(data: {
    join: SlackChannelJoin;
    botUserId: string | undefined;
  }): boolean {
    if (!data.botUserId || data.join.joinedUserId !== data.botUserId) {
      return false;
    }

    return Boolean(
      data.join.inviterUserId && data.join.inviterUserId !== data.botUserId,
    );
  }

  // What the welcome says, and its notification (see the header).
  public static async getWelcome(projectId: ObjectID): Promise<{
    blocks: Array<WorkspaceMessageBlock>;
    text: string;
  }> {
    const productName: string = ProductBrandingText.getProductName();
    const help: MarkdownText = FeedMarkdown.code(
      `${WorkspaceCommands.SLACK_COMMAND} help`,
    );

    const blocks: Array<WorkspaceMessageBlock> = [
      {
        _type: "WorkspacePayloadMarkdown",
        text: mdText`👋 **Hi, I'm ${productName}.** @mention me with a question about your incidents, monitors, logs and traces, or type ${help} to declare an incident, page someone or see who is on call.`.toString(),
      } as WorkspacePayloadMarkdown,
      {
        _type: "WorkspacePayloadMarkdown",
        text: mdText`To post incidents, alerts or scheduled maintenance here, add a notification rule in ${productName} under **Incidents → Workspace → Slack**.`.toString(),
      } as WorkspacePayloadMarkdown,
    ];

    const rulesLink: string | null = await SlackWelcome.getRulesLink(projectId);

    if (rulesLink) {
      blocks.push({
        _type: "WorkspacePayloadButtons",
        buttons: [
          {
            _type: "WorkspaceMessagePayloadButton",
            title: "Set up notifications",
            value: "",
            actionId: SlackActionType.OpenInOneUptime,
            url: URL.fromString(rulesLink),
          },
        ],
      } as WorkspacePayloadButtons);
    }

    return {
      blocks: blocks,
      text: `Hi, I'm ${productName}. Mention me with a question, or type ${WorkspaceCommands.SLACK_COMMAND} help.`,
    };
  }

  // The Slack notification rules of the project's incidents, in OneUptime.
  private static async getRulesLink(projectId: ObjectID): Promise<string | null> {
    try {
      const dashboardUrl: URL = await DatabaseConfig.getDashboardUrl();

      return URL.fromString(dashboardUrl.toString())
        .addRoute(
          `/${projectId.toString()}/incidents/workspace-connection-slack`,
        )
        .toString();
    } catch (err) {
      logger.debug("No dashboard address for the Slack welcome's link.");
      logger.debug(err);
      return null;
    }
  }

  // The first welcome of a channel in a day; a cache that cannot be read welcomes.
  private static async claimWelcome(join: SlackChannelJoin): Promise<boolean> {
    try {
      return await GlobalCache.setStringIfNotExists(
        WELCOMED_NAMESPACE,
        crypto
          .createHash("sha256")
          .update(JSON.stringify([join.teamId, join.channelId]))
          .digest("hex"),
        "1",
        { expiresInSeconds: WELCOMED_FOR_SECONDS },
      );
    } catch (err) {
      logger.debug("Could not check whether a Slack channel was welcomed.");
      logger.debug(err);
      return true;
    }
  }
}
