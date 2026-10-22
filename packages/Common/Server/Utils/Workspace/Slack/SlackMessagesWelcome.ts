import crypto from "crypto";
import WorkspaceProjectAuthToken from "../../../../Models/DatabaseModels/WorkspaceProjectAuthToken";
import WorkspaceUserAuthToken from "../../../../Models/DatabaseModels/WorkspaceUserAuthToken";
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
import GlobalCache from "../../../Infrastructure/GlobalCache";
import WorkspaceProjectResolver, {
  WorkspaceProjectResolution,
} from "../WorkspaceProjectResolution";
import WorkspaceUserAuthTokenService from "../../../Services/WorkspaceUserAuthTokenService";
import logger from "../../Logger";
import ProductBrandingText from "../../ProductBrandingText";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import WorkspaceCommands from "../WorkspaceCommands";
import WorkspaceHome, { WORKSPACE_HOME_TEXT } from "../WorkspaceHome";
import SlackUtil from "./Slack";
import SlackHome from "./SlackHome";

/*
 * A WELCOME IN THE APP'S MESSAGES TAB, THE FIRST TIME SOMEBODY OPENS IT.
 *
 * Somebody who opens the OneUptime app's Messages tab for the first time
 * finds an empty conversation: nothing about what the app does, nor how to
 * start. Slack tells the app (app_home_opened, its tab "messages"), and
 * OneUptime says it there, once:
 *
 *   👋 Hi, I'm OneUptime. I post your incidents, alerts and scheduled
 *   maintenance in Slack, page whoever is on call, and let you
 *   acknowledge, resolve and add notes without leaving Slack.
 *   Here's how to start:
 *   • Type /oneuptime help to see the commands: declare an incident,
 *     page someone or see who is on call.
 *   • Open the Home tab for your on-call shifts and the open incidents
 *     and alerts.
 *   • Send me a message here to ask OneUptime AI about your incidents,
 *     monitors, logs and traces.
 *   🔗 Connect your Slack account first, so OneUptime can act as you, ...
 *   [Connect Slack account]
 *
 * The last part only for somebody whose Slack account is not connected
 * yet: its button is the Home's own, a link to their Slack settings in
 * OneUptime that never expires (SlackHome.getConnectUrl).
 *
 * Once a person - a Slack user of a Slack team - however often they open
 * the tab, and however often Slack tells of it. Who was welcomed is kept in
 * the cache, as the hello in a channel is (SlackWelcome), never read back
 * from the conversation: conversations.history allows an app outside the
 * Slack Marketplace one request a minute. A welcome that reached nobody
 * does not count, so the next open says it. A cache that cannot be read
 * welcomes nobody: a welcome on every open would be worse than none.
 *
 * Posted with chat.postMessage to the person's id, which Slack delivers to
 * the app's direct messages with them: chat:write is all it takes.
 */

// Somebody opening the app's Messages tab.
export interface SlackMessagesTabOpen {
  teamId: string;
  slackUserId: string;
}

// The welcome, and its notification.
export interface SlackMessagesWelcomeMessage {
  blocks: Array<WorkspaceMessageBlock>;
  text: string;
}

// A person's welcome, claimed (see the header).
interface SlackMessagesWelcomeClaim {
  // Gives it back: a welcome that reached nobody does not count.
  release: () => Promise<void>;
}

const WELCOMED_NAMESPACE: string = "slack-messages-tab-welcome";

export default class SlackMessagesWelcome {
  /*
   * How long a welcome is remembered: for good, as far as anybody opening
   * the tab can tell. The cache is what remembers it, so a cache that is
   * emptied - one kept only in memory, restarted - forgets, and a person is
   * welcomed once more.
   */
  public static readonly WELCOMED_FOR_SECONDS: number = 10 * 365 * 24 * 60 * 60;

  /*
   * app_home_opened, for the Messages tab: welcomes the person, the first
   * time (see the header). Whether they were welcomed now. Never throws:
   * Slack has its 200 already.
   */
  @CaptureSpan()
  public static async handleMessagesTabOpened(
    open: SlackMessagesTabOpen,
  ): Promise<boolean> {
    if (!open.teamId || !open.slackUserId) {
      return false;
    }

    const claim: SlackMessagesWelcomeClaim | null =
      await SlackMessagesWelcome.claim(open);

    if (!claim) {
      logger.debug("Slack Messages tab welcomed already; not welcomed again.");
      return false;
    }

    try {
      /*
       * The project the person is in - a workspace can be connected to more
       * than one (WorkspaceProjectResolution) - or, connected in none of
       * several, where to connect rather than one project's button.
       */
      const resolution: WorkspaceProjectResolution =
        await WorkspaceProjectResolver.resolve({
          workspaceType: WorkspaceType.Slack,
          workspaceId: open.teamId,
          clues: {
            workspaceUserId: open.slackUserId,
          },
        });

      const personProject: WorkspaceProjectAuthToken | null =
        WorkspaceProjectResolver.getPersonProject(resolution);

      const projectAuth: WorkspaceProjectAuthToken | null =
        personProject || resolution.connections[0] || null;

      // No project to welcome them to, nor a token to say it with: later.
      if (!projectAuth?.projectId || !projectAuth.authToken) {
        logger.debug(
          "Slack Messages tab opened in a workspace connected to no project; nobody welcomed.",
        );
        await claim.release();
        return false;
      }

      const isConnected: boolean = await SlackMessagesWelcome.isConnected({
        projectId: projectAuth.projectId,
        slackUserId: open.slackUserId,
      });

      const welcome: SlackMessagesWelcomeMessage =
        SlackMessagesWelcome.getWelcome({
          isConnected: isConnected,
          connectUrl:
            isConnected || !personProject
              ? null
              : await SlackHome.getConnectUrl(projectAuth.projectId),
        });

      await SlackUtil.sendDirectMessageToUser({
        authToken: projectAuth.authToken,
        workspaceUserId: open.slackUserId,
        messageBlocks: welcome.blocks,
        text: welcome.text,
      });

      return true;
    } catch (err) {
      await claim.release();
      logger.error(
        "Could not welcome somebody to the Slack app's Messages tab.",
      );
      logger.error(err);
      return false;
    }
  }

  /*
   * What the welcome says, and its notification (see the header). Somebody
   * not connected is asked to connect: with the button when there is a
   * `connectUrl`, else where in OneUptime to do it.
   */
  public static getWelcome(data: {
    isConnected: boolean;
    connectUrl: string | null;
  }): SlackMessagesWelcomeMessage {
    const productName: string = ProductBrandingText.getProductName();
    const help: MarkdownText = FeedMarkdown.code(
      `${WorkspaceCommands.SLACK_COMMAND} help`,
    );

    const blocks: Array<WorkspaceMessageBlock> = [
      SlackMessagesWelcome.markdown(
        mdText`👋 **Hi, I'm ${productName}.** I post your incidents, alerts and scheduled maintenance in Slack, page whoever is on call, and let you acknowledge, resolve and add notes without leaving Slack.`,
      ),
      SlackMessagesWelcome.markdown(
        mdText`Here's how to start:\n${FeedMarkdown.bulletList([
          mdText`Type ${help} to see the commands: declare an incident, page someone or see who is on call.`,
          mdText`Open the **Home** tab for your on-call shifts and the open incidents and alerts.`,
          mdText`Send me a message here to ask ${productName} AI about your incidents, monitors, logs and traces.`,
        ])}`,
      ),
    ];

    if (!data.isConnected) {
      blocks.push(
        SlackMessagesWelcome.markdown(
          mdText`🔗 **Connect your Slack account** first, so ${productName} can act as you, with your permissions in the project. It takes one click.`,
        ),
      );

      if (data.connectUrl) {
        blocks.push({
          _type: "WorkspacePayloadButtons",
          buttons: [
            {
              _type: "WorkspaceMessagePayloadButton",
              title: WORKSPACE_HOME_TEXT.connect[WorkspaceType.Slack],
              value: "",
              actionId: WorkspaceHome.CONNECT_ACTION_ID,
              url: URL.fromString(data.connectUrl),
              isPrimary: true,
            },
          ],
        } as WorkspacePayloadButtons);
      } else {
        blocks.push(
          SlackMessagesWelcome.markdown(
            mdText`In ${productName}, go to **User Settings → Workspace → Slack** and press **Connect my account with Slack**.`,
          ),
        );
      }
    }

    return {
      blocks: blocks,
      text: `Hi, I'm ${productName}. Type ${WorkspaceCommands.SLACK_COMMAND} help to see what I can do, or send me a question here.`,
    };
  }

  /*
   * The cache key: a digest of who, so a key is the same length whatever
   * the ids, and names nobody in a read of the cache.
   */
  public static getKey(open: SlackMessagesTabOpen): string {
    return crypto
      .createHash("sha256")
      .update(JSON.stringify([open.teamId, open.slackUserId]))
      .digest("hex");
  }

  /*
   * The person's welcome: a claim when they are to be welcomed, null when
   * they were welcomed already, or the cache cannot say (see the header).
   * Never throws.
   */
  private static async claim(
    open: SlackMessagesTabOpen,
  ): Promise<SlackMessagesWelcomeClaim | null> {
    const key: string = SlackMessagesWelcome.getKey(open);
    const holder: string = crypto.randomBytes(16).toString("hex");

    try {
      const isFirst: boolean = await GlobalCache.setStringIfNotExists(
        WELCOMED_NAMESPACE,
        key,
        holder,
        { expiresInSeconds: SlackMessagesWelcome.WELCOMED_FOR_SECONDS },
      );

      if (!isFirst) {
        return null;
      }
    } catch (err) {
      logger.debug(
        "Could not read whether this person was welcomed to the Slack app's Messages tab; not welcoming them.",
      );
      logger.debug(err);
      return null;
    }

    return {
      release: async (): Promise<void> => {
        try {
          // Only this claim's own: one taken since by a later open stays.
          await GlobalCache.deleteKeyIfValue(WELCOMED_NAMESPACE, key, holder);
        } catch (err) {
          logger.debug(
            "Could not give back the claim of a Slack welcome that reached nobody.",
          );
          logger.debug(err);
        }
      },
    };
  }

  // Whether the person's Slack account is connected to OneUptime in the project.
  private static async isConnected(data: {
    projectId: ObjectID;
    slackUserId: string;
  }): Promise<boolean> {
    const userAuth: WorkspaceUserAuthToken | null =
      await WorkspaceUserAuthTokenService.findOneBy({
        query: {
          workspaceUserId: data.slackUserId,
          projectId: data.projectId,
          workspaceType: WorkspaceType.Slack,
        },
        select: {
          userId: true,
        },
        props: {
          isRoot: true,
        },
      });

    return Boolean(userAuth?.userId);
  }

  private static markdown(text: MarkdownText): WorkspacePayloadMarkdown {
    return {
      _type: "WorkspacePayloadMarkdown",
      text: text.toString(),
    } as WorkspacePayloadMarkdown;
  }
}
