import AIConversationService from "../../../Services/AIConversationService";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import AIConversation from "../../../../Models/DatabaseModels/AIConversation";
import AIChatPageContextType, {
  AIChatPageContext,
} from "../../../../Types/AI/AIChatPageContext";
import CarriedRecords, {
  CarriedRecordIds,
} from "../../../../Types/AI/CarriedRecords";
import ObjectID from "../../../../Types/ObjectID";

/*
 * WHAT A PULL REQUEST A CHAT OPENS CARRIES (#9186): the chat's subject.
 *
 * OneUptime AI writes the pull request's title and description in the
 * chat, from what the chat is about, and OneUptime keeps a copy of both
 * (AIAgentTaskPullRequest). So the record of it carries:
 *
 *   - the incident or alert whose AI conversation it is
 *     (AIConversation.incidentId, alertId): every responder's question in
 *     it is about that record;
 *   - the incident or alert Ask AI was asked about: the turn's subject
 *     (ToolContext.pageContext) - the page it was asked from, or the
 *     subject the conversation kept.
 *
 * A pull request carrying a private one is read only by those who may read
 * it (AIRunOutputReadFilter). A chat about neither carries none, and its
 * pull request is read as before. Read as OneUptime: what the chat is
 * about, never what the person may read.
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
}
