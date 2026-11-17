import AIConversationMessageService from "../../../Services/AIConversationMessageService";
import AIConversationService from "../../../Services/AIConversationService";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import AIConversation from "../../../../Models/DatabaseModels/AIConversation";
import AIConversationMessage from "../../../../Models/DatabaseModels/AIConversationMessage";
import AIChatPageContextType, {
  AIChatPageContext,
} from "../../../../Types/AI/AIChatPageContext";
import { AIChatCitation, AIChatWidget } from "../../../../Types/AI/AIChatTypes";
import CarriedRecords, {
  CarriedRecordIds,
} from "../../../../Types/AI/CarriedRecords";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import ObjectID from "../../../../Types/ObjectID";
import PromptText from "../../../../Utils/AI/PromptText";

/*
 * The newest messages of a chat whose citations and lists a pull request
 * it opens is read against (ofPullRequest): more than a turn replays to the
 * model (twenty, forty in an incident's shared thread), so what the model
 * still had in its history is in them.
 */
export const MAX_CHAT_MESSAGES_READ: number = 100;

/*
 * WHAT A PULL REQUEST A CHAT OPENS CARRIES (#9186, #9242).
 *
 * OneUptime AI writes the pull request's title and description in the
 * chat, from what the chat is about and what it read, and OneUptime keeps a
 * copy of both (AIAgentTaskPullRequest). So the record of it carries:
 *
 *   - the chat's subject (ofChat): the incident or alert whose AI
 *     conversation it is (AIConversation.incidentId, alertId) - every
 *     responder's question in it is about that record - or the incident or
 *     alert Ask AI was asked about, the turn's subject
 *     (ToolContext.pageContext): the page it was asked from, or the subject
 *     the conversation kept;
 *   - every incident and alert the chat opened one by one, in any answer
 *     before the pull request (CarriedRecords.openedByCitations): a tool
 *     that read that one record or acted on it, and found it, is what put
 *     its text - its description, root cause, postmortem, notes - in front
 *     of the model;
 *   - every incident and alert a list showed the chat whose title the pull
 *     request quotes (CarriedRecords.quotedFromLists). The other rows of a
 *     list are not carried: a list of fifty incidents would tie the pull
 *     request to all fifty, and hide it for no reason.
 *
 * A pull request carrying a private one is read only by those who may read
 * it (AIRunOutputReadFilter). A chat that opened none and quotes none, about
 * neither, carries none, and its pull request is read as before. What the
 * model only paraphrased from a list, or named by its number alone, can't
 * be told for certain, and is not carried. Read as OneUptime: what the chat
 * is about and read, never what the person may read.
 */
export default class ChatCarriedRecords {
  @CaptureSpan()
  public static async ofChat(data: {
    conversationId?: ObjectID | undefined;
    pageContext?: AIChatPageContext | undefined;
  }): Promise<CarriedRecordIds> {
    const incidentIds: Array<ObjectID | string | undefined> = [];
    const alertIds: Array<ObjectID | string | undefined> = [];

    if (data.pageContext?.type === AIChatPageContextType.Incident) {
      incidentIds.push(data.pageContext.entityId);
    }

    if (data.pageContext?.type === AIChatPageContextType.Alert) {
      alertIds.push(data.pageContext.entityId);
    }

    if (data.conversationId) {
      const conversation: AIConversation | null =
        await AIConversationService.findOneById({
          id: data.conversationId,
          select: { _id: true, incidentId: true, alertId: true },
          props: { isRoot: true },
        });

      incidentIds.push(conversation?.incidentId || undefined);
      alertIds.push(conversation?.alertId || undefined);
    }

    return CarriedRecords.of({ incidentIds, alertIds });
  }

  /*
   * What a pull request the chat opens carries: its subject, what it
   * opened one by one, and what the pull request (`title`, `description`)
   * quotes of the lists it was shown - read from the chat's newest
   * MAX_CHAT_MESSAGES_READ messages. The answer at work when the pull
   * request is asked for keeps what its earlier calls read on its message
   * (ChatAgentRunner writes it after each round of calls), so they count; a
   * call asked for beside the pull request's, whose result the model had
   * not seen when it wrote it, may count too.
   */
  @CaptureSpan()
  public static async ofPullRequest(data: {
    conversationId?: ObjectID | undefined;
    pageContext?: AIChatPageContext | undefined;
    title: string;
    description: string;
  }): Promise<CarriedRecordIds> {
    const subject: CarriedRecordIds = await ChatCarriedRecords.ofChat({
      conversationId: data.conversationId,
      pageContext: data.pageContext,
    });

    if (!data.conversationId) {
      return subject;
    }

    const messages: Array<AIConversationMessage> =
      await AIConversationMessageService.findBy({
        query: { conversationId: data.conversationId },
        select: { _id: true, citations: true, widgets: true },
        sort: { createdAt: SortOrder.Descending },
        limit: MAX_CHAT_MESSAGES_READ,
        skip: 0,
        props: { isRoot: true },
      });

    const citations: Array<AIChatCitation> = [];
    const widgets: Array<AIChatWidget> = [];

    for (const message of messages) {
      if (Array.isArray(message.citations)) {
        citations.push(...message.citations);
      }

      if (Array.isArray(message.widgets)) {
        widgets.push(...message.widgets);
      }
    }

    return CarriedRecords.merge(
      subject,
      CarriedRecords.openedByCitations(citations),
      CarriedRecords.quotedFromLists({
        widgets,
        /*
         * Read in the pull request's own title and description, which the
         * model wrote and no model is given here. The description goes in
         * through PromptText, as free text in Utils/AI does
         * (RecordTextInPromptsGuard): an embedded file is left out, its alt
         * text kept. It is never held to a length, as PromptText.field
         * would hold it: a title quoted past the cut would leave its record
         * out, and the pull request read by people who may not read that
         * record.
         */
        text: `${data.title}\n${PromptText.omitEmbeddedData(data.description).text}`,
      }),
    );
  }
}
