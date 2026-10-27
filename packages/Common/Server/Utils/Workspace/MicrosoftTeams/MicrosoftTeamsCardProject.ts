import {
  Activity,
  ResourceResponse,
  SendActivitiesHandler,
  TurnContext,
  UpdateActivityHandler,
} from "./Botbuilder";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import { MICROSOFT_TEAMS_ADAPTIVE_CARD_CONTENT_TYPE } from "./MicrosoftTeamsReplies";

/*
 * THE PROJECT A CARD WAS SENT FOR, ON ITS BUTTONS.
 *
 * In a Microsoft 365 organization connected to more than one OneUptime
 * project, a press of a card's button is read in the project its own clues
 * tell (WorkspaceProjectResolution): the record the button is about, the
 * channel it is pressed in, the one project the person who pressed is in.
 * A form - incident, maintenance, page - and the Home's buttons name no
 * record, so somebody in two of the projects pressing one in a chat no one
 * project owns was asked which project again, or refused: a form cannot be
 * filled in again in another project, its fields were chosen in one.
 *
 * So every card the bot sends in a turn that was read in one project - in an
 * organization connected to several - carries that project on each of its
 * own Action.Submit buttons (DRAWN_FOR_PROJECT_ID_FIELD), and a press of one
 * is read there (WorkspaceProjectClues.drawnForProjectId), as Slack's forms
 * and Home carry their project. It decides only where the press is read:
 * what it does there, it does as the member who pressed, with their own
 * permissions, so a card forwarded to somebody of another project gives them
 * nothing of it - and a project the organization is no longer connected to
 * is no clue at all.
 *
 * The cards are not built with it: the turn's sends and updates are
 * (drawCardsFor), so no card can forget it.
 */

/*
 * The project a card was sent for, on its Action.Submit buttons' data - and
 * so on what Teams sends when one is pressed. No input of the bot's cards
 * has this id.
 */
export const DRAWN_FOR_PROJECT_ID_FIELD: string = "drawnForProjectId";

const ACTION_SUBMIT: string = "Action.Submit";

// What a turn keeps, so its sends are marked once (drawCardsFor).
const TURN_STATE_KEY: string = "oneuptime.drawnForProjectId";

// The parts of a TurnContext drawCardsFor uses; a test's stand-in may lack them.
interface MarkableTurnContext {
  onSendActivities?: ((handler: SendActivitiesHandler) => unknown) | undefined;
  onUpdateActivity?: ((handler: UpdateActivityHandler) => unknown) | undefined;
  turnState?:
    | {
        get: (key: unknown) => unknown;
        set: (key: unknown, value: unknown) => unknown;
      }
    | undefined;
}

export default class MicrosoftTeamsCardProject {
  /*
   * Every card the bot sends or draws again for the rest of this turn
   * carries `projectId` on its buttons. Once a turn; a turn context that
   * cannot be hooked into is left as it is.
   */
  public static drawCardsFor(data: {
    turnContext: TurnContext;
    projectId: ObjectID;
  }): void {
    const context: MarkableTurnContext =
      data.turnContext as unknown as MarkableTurnContext;
    const projectId: string = data.projectId.toString();

    if (context.turnState && typeof context.turnState.get === "function") {
      if (context.turnState.get(TURN_STATE_KEY)) {
        return;
      }

      context.turnState.set(TURN_STATE_KEY, projectId);
    }

    if (typeof context.onSendActivities === "function") {
      context.onSendActivities(
        async (
          _turnContext: TurnContext,
          activities: Array<Partial<Activity>>,
          next: () => Promise<Array<ResourceResponse>>,
        ): Promise<Array<ResourceResponse>> => {
          for (const activity of activities) {
            MicrosoftTeamsCardProject.markActivity(activity, projectId);
          }

          return await next();
        },
      );
    }

    if (typeof context.onUpdateActivity === "function") {
      context.onUpdateActivity(
        async (
          _turnContext: TurnContext,
          activity: Partial<Activity>,
          next: () => Promise<void>,
        ): Promise<void> => {
          MicrosoftTeamsCardProject.markActivity(activity, projectId);
          await next();
        },
      );
    }
  }

  /*
   * An activity's Adaptive Cards, each replaced by a copy whose buttons
   * carry `projectId` (markCard). Any other attachment is left as it is.
   */
  public static markActivity(
    activity: Partial<Activity>,
    projectId: string,
  ): void {
    if (!Array.isArray(activity.attachments)) {
      return;
    }

    activity.attachments = activity.attachments.map(
      (attachment: NonNullable<Activity["attachments"]>[number]) => {
        const content: unknown = attachment?.content;

        if (
          attachment?.contentType !==
            MICROSOFT_TEAMS_ADAPTIVE_CARD_CONTENT_TYPE ||
          !content ||
          typeof content !== "object" ||
          Array.isArray(content)
        ) {
          return attachment;
        }

        return {
          ...attachment,
          content: MicrosoftTeamsCardProject.markCard(
            content as JSONObject,
            projectId,
          ),
        };
      },
    );
  }

  /*
   * A copy of the card in which each of the bot's own Action.Submit buttons
   * - its data names an action - carries `projectId`, wherever it is: the
   * card's actions, an action set in its body, a card a button shows, a
   * container's select action. A button that names a project already keeps
   * it; a link, or a submit of somebody else's, is left as it is.
   */
  public static markCard(card: JSONObject, projectId: string): JSONObject {
    return MicrosoftTeamsCardProject.markElement(card, projectId) as JSONObject;
  }

  /*
   * The project the card a press was made on was sent for, in each shape
   * Teams sends an Action.Submit in - its data merged into the value, under
   * "data", or under "action.data". Undefined for none, or for anything that
   * is not a project id.
   */
  public static readDrawnForProjectId(value: unknown): string | undefined {
    const submitted: JSONObject | undefined =
      MicrosoftTeamsCardProject.asObject(value);

    if (!submitted) {
      return undefined;
    }

    const candidates: Array<unknown> = [
      submitted[DRAWN_FOR_PROJECT_ID_FIELD],
      MicrosoftTeamsCardProject.asObject(submitted["data"])?.[
        DRAWN_FOR_PROJECT_ID_FIELD
      ],
      MicrosoftTeamsCardProject.asObject(
        MicrosoftTeamsCardProject.asObject(submitted["action"])?.["data"],
      )?.[DRAWN_FOR_PROJECT_ID_FIELD],
    ];

    for (const candidate of candidates) {
      if (typeof candidate === "string" && ObjectID.isValidUUID(candidate)) {
        return candidate;
      }
    }

    return undefined;
  }

  private static markElement(value: unknown, projectId: string): unknown {
    if (Array.isArray(value)) {
      return value.map((item: unknown): unknown => {
        return MicrosoftTeamsCardProject.markElement(item, projectId);
      });
    }

    const element: JSONObject | undefined =
      MicrosoftTeamsCardProject.asObject(value);

    if (!element) {
      return value;
    }

    const copy: JSONObject = {};

    for (const [key, child] of Object.entries(element)) {
      copy[key] = MicrosoftTeamsCardProject.markElement(
        child,
        projectId,
      ) as JSONObject;
    }

    const submitData: JSONObject | undefined =
      copy["type"] === ACTION_SUBMIT
        ? MicrosoftTeamsCardProject.asObject(copy["data"])
        : undefined;

    if (
      submitData &&
      typeof submitData["action"] === "string" &&
      submitData[DRAWN_FOR_PROJECT_ID_FIELD] === undefined
    ) {
      copy["data"] = {
        ...submitData,
        [DRAWN_FOR_PROJECT_ID_FIELD]: projectId,
      };
    }

    return copy;
  }

  private static asObject(value: unknown): JSONObject | undefined {
    return value && typeof value === "object" && !Array.isArray(value)
      ? (value as JSONObject)
      : undefined;
  }
}
