import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import { JSONObject } from "../../../Types/JSON";
import StatusPageSubscriberNotificationStatus from "../../../Types/StatusPage/StatusPageSubscriberNotificationStatus";
import SubscriberNotificationResend from "../../../Types/StatusPage/SubscriberNotificationResend";
import DatabaseService from "../../Services/DatabaseService";
import DatabaseRequestType from "../../Types/BaseDatabase/DatabaseRequestType";
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
 * The same goes for telling subscribers about an edit (the note's 'updated'
 * notification): an editor can change the text first, so with the edit
 * permission alone it would be a way to message every subscriber.
 *
 * When: never while the notification is being sent. The send settles its
 * own status when it finishes, so a Pending written over a running send
 * either lets a second run send it at the same time - the same subscribers
 * messaged twice, each run then overwriting the other's status - or is
 * overwritten and lost without a word. That holds for every notification a
 * user can send again (assertNotQueuedWhileBeingSent).
 *
 * These checks run in the services' onBeforeUpdate, before the update's own
 * check (DatabaseService runs that after the hooks), so each one checks
 * permissions before it reads anything: a caller who may not send a
 * notification again is told only that, never what state the notification
 * is in. Rows are then read only among the rows the caller may write
 * (DatabaseService.findRowsAndHoldUpdateToThem) - the rows their update
 * permission reaches, which are rows they may read - so nothing they cannot
 * read decides the answer either, and the update is held to the rows the
 * answer was given for.
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

  /*
   * The columns of a public note that telling subscribers about an edit
   * writes.
   */
  private static readonly PUBLIC_NOTE_UPDATE_NOTIFICATION_COLUMNS: JSONObject =
    {
      subscriberNotificationStatusOnNoteUpdated:
        StatusPageSubscriberNotificationStatus.Pending,
      subscriberNotificationStatusMessageOnNoteUpdated: "",
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

    const notes: Array<TNote> = await data.service.findRowsAndHoldUpdateToThem(
      updateBy,
      {
        _id: true,
        subscriberNotificationStatusOnNoteCreated: true,
        shouldStatusPageSubscribersBeNotifiedOnNoteCreated: true,
      } as unknown as Select<TNote>,
    );

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
   * A user's or an API key's request to tell subscribers about an edit to a
   * public note: the edit carries the notify-on-edit misc data prop
   * (SubscriberUpdateNotification, which the service has turned into a
   * Pending by now), or writes Pending into
   * subscriberNotificationStatusOnNoteUpdated itself, as the dashboard's
   * Retry of a failed update does. Shared by the incident, incident episode
   * and scheduled maintenance public notes.
   *
   * - The caller must be able to write the update notification's status and
   *   to post a note that notifies subscribers (see the header).
   * - It is refused while the update notification is being sent
   *   (assertNotQueuedWhileBeingSent): the edit can be saved without it.
   *
   * An update that does not ask for it is not looked at.
   */
  public static async assertPublicNoteUpdateNotificationAllowed<
    TNote extends BaseModel,
  >(data: {
    modelType: { new (): TNote };
    service: DatabaseService<TNote>;
    updateBy: UpdateBy<TNote>;
  }): Promise<void> {
    const updateBy: UpdateBy<TNote> = data.updateBy;

    if (
      updateBy.props.isRoot ||
      (updateBy.data as JSONObject)[
        "subscriberNotificationStatusOnNoteUpdated"
      ] !== StatusPageSubscriberNotificationStatus.Pending
    ) {
      return;
    }

    this.assertCallerMayUpdateColumns({
      modelType: data.modelType,
      columns: this.PUBLIC_NOTE_UPDATE_NOTIFICATION_COLUMNS,
      props: updateBy.props,
      refusal:
        SubscriberNotificationResend.noPermissionToNotifyAboutEditMessage,
    });

    this.assertCallerMayPostNotifyingNote({
      modelType: data.modelType,
      props: updateBy.props,
      refusal:
        SubscriberNotificationResend.noPermissionToNotifyAboutEditMessage,
    });

    await this.assertNotQueuedWhileBeingSent({
      modelType: data.modelType,
      service: data.service,
      updateBy: updateBy,
      statusColumns: ["subscriberNotificationStatusOnNoteUpdated"],
      refusal: SubscriberNotificationResend.updateBeingSentMessage,
    });
  }

  /*
   * A user's or an API key's update writing Pending into a notification's
   * status column - Retry, Resend, or the API route of sending it again -
   * while that notification is being sent (InProgress). Refused with
   * `refusal` (SubscriberNotificationResend.beingSentMessage by default):
   * see the header for why.
   *
   * Only the columns the update writes Pending into are looked at, so an
   * edit that leaves the notification alone is never refused, and Pending
   * written over Pending (queued already) changes nothing and is let
   * through.
   *
   * Permission first: a caller who may not write those columns is left to
   * the update's own check, which refuses them anyway, and never learns the
   * notification's state from this one. The rows are then read only among
   * the rows the caller may write, which are rows they may read (see the
   * header), so nothing they cannot read decides the answer. Root callers -
   * the workers - are never checked.
   */
  public static async assertNotQueuedWhileBeingSent<
    TBaseModel extends BaseModel,
  >(data: {
    modelType: { new (): TBaseModel };
    service: DatabaseService<TBaseModel>;
    updateBy: UpdateBy<TBaseModel>;
    statusColumns: Array<string>;
    refusal?: string | undefined;
  }): Promise<void> {
    const updateBy: UpdateBy<TBaseModel> = data.updateBy;

    if (updateBy.props.isRoot) {
      return;
    }

    const written: JSONObject = (updateBy.data || {}) as JSONObject;

    const queuedColumns: Array<string> = data.statusColumns.filter(
      (column: string): boolean => {
        return (
          written[column] === StatusPageSubscriberNotificationStatus.Pending
        );
      },
    );

    if (queuedColumns.length === 0) {
      return;
    }

    const pendingColumns: JSONObject = {};
    const select: JSONObject = { _id: true };

    for (const column of queuedColumns) {
      pendingColumns[column] = StatusPageSubscriberNotificationStatus.Pending;
      select[column] = true;
    }

    try {
      this.assertCallerMayUpdateColumns({
        modelType: data.modelType,
        columns: pendingColumns,
        props: updateBy.props,
        refusal: "",
      });
    } catch (err) {
      if (err instanceof NotAuthorizedException) {
        return;
      }

      throw err;
    }

    const rows: Array<TBaseModel> =
      await data.service.findRowsAndHoldUpdateToThem(
        updateBy,
        select as unknown as Select<TBaseModel>,
      );

    for (const row of rows) {
      const record: JSONObject = row as unknown as JSONObject;

      for (const column of queuedColumns) {
        if (
          record[column] === StatusPageSubscriberNotificationStatus.InProgress
        ) {
          throw new BadDataException(
            data.refusal || SubscriberNotificationResend.beingSentMessage,
          );
        }
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
