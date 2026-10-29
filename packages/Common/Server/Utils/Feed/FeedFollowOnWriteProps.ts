import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import FeedApiKeyActorUtil from "./FeedApiKeyActor";

/*
 * THE PROPS OF A WRITE ONEUPTIME MAKES ITSELF BECAUSE OF SOMEBODY'S CHANGE,
 * NAMING WHO MADE THAT CHANGE.
 *
 * A role given on an incident episode is copied to each of the episode's
 * incidents, and taken off them with it. Those writes are OneUptime's own -
 * root, so nothing of the person's is asked again and an incident need not
 * be theirs to reach - and each writes the incident's feed entry and its
 * Slack and Teams message. Made as plain root, they named nobody: the
 * entry read "Added Deane Looi as Responder" with no one in front of it,
 * and the message used to open with Deane.
 *
 * So the props name who made the change, as OneUptime's other writes for a
 * person do (an owner picked in a create form, a note posted from Slack):
 * the person (userId), else the project API key (FeedApiKeyActor), else the
 * workflow whose step made it. The write stays OneUptime's: root, with no
 * tenant (DatabaseService reads that as a write OneUptime makes itself), and
 * nobody's permissions.
 */
export default class FeedFollowOnWriteProps {
  public static get(data: {
    // The props of the change the write follows from.
    props: DatabaseCommonInteractionProps;
    /*
     * Who made it, when the change's record says so better than its props
     * (the creator saved on the row, the person a delete names).
     */
    userId?: ObjectID | null | undefined;
  }): DatabaseCommonInteractionProps {
    const userId: ObjectID | null | undefined =
      data.userId || data.props.userId;

    if (userId) {
      return { isRoot: true, userId: userId };
    }

    const apiKeyProps: Pick<
      DatabaseCommonInteractionProps,
      "apiKeyId" | "apiKeyName"
    > = FeedApiKeyActorUtil.toProps(FeedApiKeyActorUtil.fromProps(data.props));

    if (apiKeyProps.apiKeyId) {
      return { isRoot: true, ...apiKeyProps };
    }

    const workflowName: string = (data.props.workflowName || "").trim();

    if (workflowName) {
      return {
        isRoot: true,
        workflowId: data.props.workflowId,
        workflowName: workflowName,
      };
    }

    return { isRoot: true };
  }
}
