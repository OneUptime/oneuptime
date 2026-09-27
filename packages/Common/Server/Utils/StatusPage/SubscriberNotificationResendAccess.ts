import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import LIMIT_MAX from "../../../Types/Database/LimitMax";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import StatusPageSubscriberNotificationStatus from "../../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import SubscriberNotificationResend from "../../../Types/StatusPage/SubscriberNotificationResend";
import DatabaseService from "../../Services/DatabaseService";
import DatabaseRequestType from "../../Types/BaseDatabase/DatabaseRequestType";
import Query from "../../Types/Database/Query";
import Select from "../../Types/Database/Select";
import UpdateBy from "../../Types/Database/UpdateBy";
import ColumnPermissions from "../../Types/Database/Permissions/ColumnPermission";
import ModelPermission from "../../Types/Database/Permissions/Index";
import TablePermission from "../../Types/Database/Permissions/TablePermission";

/*
 * Who may send a status page subscriber notification again, and when.
 *
 * Sending one again is a write: its status goes back to Pending, and the
 * job that sends it picks it up. So the update's own permission check - the
 * table's update access control and each written column's - already decides
 * who may. For a public note that is not enough: the note's edit permission
 * is granted on its own, and editing a note does not make someone its
 * poster. Sending a note's notification again tells every subscriber of the
 * incident's status pages what the note says, which is what posting it did,
 * so it also needs the permission to post a note that notifies subscribers.
 *
 * These checks run in the services' onBeforeUpdate, before the update's own
 * check (DatabaseService runs that after the hooks), so each one checks
 * permissions before it reads anything: a caller who may not send a
 * notification again is told only that, never what state the notification
 * is in. Rows are then read with the caller's own permissions, so nothing
 * they cannot read decides the answer either.
 *
 * Root callers - the workers and other internal writes - are trusted and
 * never checked. Master admins skip the permission checks, as they do
 * everywhere, but not the checks on the notification's state.
 */
export default class SubscriberNotificationResendAccess {
  /*
   * The columns of a public note that sending its 'posted' notification
   * again writes.
   */
  private static readonly PUBLIC_NOTE_RESEND_COLUMNS: JSONObject = {
    subscriberNotificationStatusOnNoteCreated:
      StatusPageSubscriberNotificationStatus.Pending,
    subscriberNotificationStatusMessage: "",
  };

  public static isPermissionChecked(
    props: DatabaseCommonInteractionProps,
  ): boolean {
    return !props.isRoot && !props.isMasterAdmin;
  }

  /*
   * Throws `refusal` unless the caller may write these columns of the model:
   * the table's update access control, then each column's. A request that
   * fails for any other reason - an expired session, an unpaid plan - keeps
   * its own error.
   */
  public static assertCallerMayUpdateColumns<
    TBaseModel extends BaseModel,
  >(data: {
    modelType: { new (): TBaseModel };
    columns: JSONObject;
    props: DatabaseCommonInteractionProps;
    refusal: string;
  }): void {
    if (!this.isPermissionChecked(data.props)) {
      return;
    }

    this.withRefusal(data.refusal, () => {
      TablePermission.checkTableLevelPermissions(
        data.modelType,
        data.props,
        DatabaseRequestType.Update,
      );

      ColumnPermissions.checkDataColumnPermissions(
        data.modelType,
        data.columns as unknown as TBaseModel,
        data.props,
        DatabaseRequestType.Update,
      );
    });
  }

  /*
   * Throws `refusal` unless the caller may post a new note of this type
   * that notifies subscribers: the create check a post with Notify Status
   * Page Subscribers ticked goes through, on a note carrying only that
   * choice.
   */
  public static assertCallerMayPostNotifyingNote<
    TNote extends BaseModel,
  >(data: {
    modelType: { new (): TNote };
    props: DatabaseCommonInteractionProps;
    refusal: string;
  }): void {
    if (!this.isPermissionChecked(data.props)) {
      return;
    }

    const probe: TNote = new data.modelType();
    (probe as unknown as JSONObject)[
      "shouldStatusPageSubscribersBeNotifiedOnNoteCreated"
    ] = true;

    this.withRefusal(data.refusal, () => {
      ModelPermission.checkCreatePermissions(data.modelType, probe, data.props);
    });
  }

  /*
   * A user's or an API key's request to send a public note's 'posted'
   * notification again - an update writing Pending into
   * subscriberNotificationStatusOnNoteCreated, which is what the dashboard's
   * Retry and Resend do. Shared by the incident, incident episode and
   * scheduled maintenance public notes.
   *
   * - The caller must be able to edit the note's notification status and to
   *   post a note that notifies subscribers (see the header).
   * - Every note the update matches must be one whose notification can be
   *   sent again (SubscriberNotificationResend.getPublicNoteResendRefusal):
   *   not a note posted without notifying subscribers, which the job never
   *   sends, and not one being sent right now, whose send would overwrite
   *   the request when it finishes.
   *
   * An update that does not ask for it is not looked at.
   */
  public static async assertPublicNoteResendAllowed<
    TNote extends BaseModel,
  >(data: {
    modelType: { new (): TNote };
    service: DatabaseService<TNote>;
    updateBy: UpdateBy<TNote>;
  }): Promise<void> {
    const updateBy: UpdateBy<TNote> = data.updateBy;

    if (
      updateBy.props.isRoot ||
      !SubscriberNotificationResend.isPublicNoteResendRequested(
        updateBy.data as {
          subscriberNotificationStatusOnNoteCreated?: unknown;
        },
      )
    ) {
      return;
    }

    this.assertCallerMayUpdateColumns({
      modelType: data.modelType,
      columns: this.PUBLIC_NOTE_RESEND_COLUMNS,
      props: updateBy.props,
      refusal: SubscriberNotificationResend.noPermissionToResendNoteMessage,
    });

    this.assertCallerMayPostNotifyingNote({
      modelType: data.modelType,
      props: updateBy.props,
      refusal: SubscriberNotificationResend.noPermissionToResendNoteMessage,
    });

    const notes: Array<TNote> = await data.service.findBy({
      query: updateBy.query as Query<TNote>,
      select: {
        _id: true,
        subscriberNotificationStatusOnNoteCreated: true,
        shouldStatusPageSubscribersBeNotifiedOnNoteCreated: true,
      } as unknown as Select<TNote>,
      limit: LIMIT_MAX,
      skip: 0,
      props: updateBy.props,
    });

    for (const note of notes) {
      const record: JSONObject = note as unknown as JSONObject;

      const refusal: string | null =
        SubscriberNotificationResend.getPublicNoteResendRefusal({
          status: record["subscriberNotificationStatusOnNoteCreated"] as
            | StatusPageSubscriberNotificationStatus
            | undefined,
          shouldStatusPageSubscribersBeNotifiedOnNoteCreated: record[
            "shouldStatusPageSubscribersBeNotifiedOnNoteCreated"
          ] as boolean | undefined,
        });

      if (refusal) {
        throw new BadDataException(refusal);
      }
    }
  }

  /*
   * Runs a permission check and turns its refusal into `refusal`, which says
   * what the caller was trying to do. A column refusal is a BadDataException
   * ("User is not allowed to update on ... column"), a table refusal a
   * NotAuthorizedException; both become a NotAuthorizedException. Anything
   * else - an anonymous caller, an unpaid plan - passes through as it is.
   */
  private static withRefusal(refusal: string, check: () => void): void {
    try {
      check();
    } catch (err) {
      if (
        err instanceof NotAuthorizedException ||
        err instanceof BadDataException
      ) {
        throw new NotAuthorizedException(refusal);
      }

      throw err;
    }
  }
}
