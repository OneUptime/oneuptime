import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";

/*
 * A SAVED STATE CHANGE ALWAYS UPDATES ITS OWN EVENT.
 *
 * Moving an incident, an alert, an alert or incident episode, a scheduled
 * maintenance event or a monitor to another state is the creation of a row in
 * its state timeline. Once that row is saved, the timeline service writes
 * what follows from it onto the event itself: its current state, and the
 * stamps that go with it - an episode's resolvedAt, a maintenance event's
 * next reminder "before the event". The timeline is the source of truth;
 * those columns are derived from it.
 *
 * They used to be written with the props of whoever changed the state. A
 * custom role that may create the state change (Create Incident State
 * Timeline, Create Alert State Timeline, ...) but not edit the event (Edit
 * Incident, Edit Alert, ...) had the row saved and the event's own write
 * refused: the change was answered with an error, and the event kept its
 * old state while its timeline said otherwise.
 *
 * So they are OneUptime's writes, made once the caller's create of the
 * timeline row has passed every one of its checks - the table and column
 * permissions, the event it is made under (which they must be able to read),
 * the labels and owners their permission to create reaches, their team's
 * blocks: the permission to create the state change IS the permission to
 * change the event's state. Nothing else a state change writes is widened:
 * a note posted with it, and anything else the caller names, is still
 * written as the caller.
 *
 * The write is named for the person who changed the state - for the audit
 * trail only, as the request named them (userId, userType and the credential
 * they used); no permission check reads these on a root write - and carries
 * no project: it is OneUptime's own write, as a background job's is, so the
 * event's update hooks do not take it for a state change sent to the event
 * itself (they would record it in the timeline again).
 */
export default class StateChangeFollowOn {
  public static getEventWriteProps(
    changedBy: DatabaseCommonInteractionProps,
  ): DatabaseCommonInteractionProps {
    const props: DatabaseCommonInteractionProps = { isRoot: true };

    if (changedBy.userId) {
      props.userId = changedBy.userId;
    }

    if (changedBy.userType) {
      props.userType = changedBy.userType;
    }

    if (changedBy.apiKeyId) {
      props.apiKeyId = changedBy.apiKeyId;
    }

    if (changedBy.apiKeyName) {
      props.apiKeyName = changedBy.apiKeyName;
    }

    if (changedBy.mcpOAuthGrantId) {
      props.mcpOAuthGrantId = changedBy.mcpOAuthGrantId;
    }

    if (changedBy.mcpClientName) {
      props.mcpClientName = changedBy.mcpClientName;
    }

    if (changedBy.workflowId) {
      props.workflowId = changedBy.workflowId;
    }

    if (changedBy.workflowName) {
      props.workflowName = changedBy.workflowName;
    }

    return props;
  }
}
