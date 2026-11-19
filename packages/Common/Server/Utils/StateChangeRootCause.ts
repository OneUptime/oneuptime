import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../Types/Exception/NotAuthorizedException";
import QueryDeepPartialEntity from "../../Types/Database/PartialEntity";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import ModelPermission from "../Types/Database/Permissions/Index";
import Query from "../Types/Database/Query";
import logger, { LogAttributes } from "./Logger";

/*
 * THE ROOT CAUSE WRITTEN AS AN INCIDENT OR ALERT IS RESOLVED (#7765).
 *
 * Resolving an incident or an alert can carry its root cause: the folded
 * "Add the root cause" of the Resolve dialog, or `miscDataProps` on a state
 * timeline create over the API, under writtenRootCause. It is optional, and
 * leaving it out changes nothing about the resolve.
 *
 * It becomes the record's root cause, written as the person who resolved it
 * - an update of the record with their permissions, so the project's audit
 * log names who wrote it, as it does for any edit of the record - once the
 * state change is saved. OneUptime AI's investigation of the record is then graded
 * against it (InvestigationGrader): a root cause somebody wrote as they
 * resolved it is the people's words, never a monitor's.
 *
 * Writing a root cause is a permission of its own (Edit Alert, Edit
 * Incident...), apart from changing the state. As for a state change's note
 * (StateChangeNote), it is asked before the change is saved, with the very
 * check the record's update runs, and a change whose root cause its sender
 * may not write is refused whole, with one plain message. The Resolve dialog
 * offers the root cause only to someone who may write it.
 */

// Hoisted: wrap-regex and prettier disagree inline.
const ENDS_A_SENTENCE: RegExp = /[.!?]$/;

export default class StateChangeRootCause {
  // The misc data prop the root cause travels under (Dashboard StateChangeFormFields).
  public static readonly rootCauseKey: string = "writtenRootCause";

  /*
   * The root cause a state change carries, trimmed, or undefined: one with
   * no text in it - spaces and line breaks only - is none, and so is
   * anything that is not text.
   */
  public static getRootCause(
    miscDataProps: JSONObject | undefined | null,
  ): string | undefined {
    if (!miscDataProps || typeof miscDataProps !== "object") {
      return undefined;
    }

    const rootCause: unknown = miscDataProps[StateChangeRootCause.rootCauseKey];

    if (typeof rootCause !== "string" || rootCause.trim().length === 0) {
      return undefined;
    }

    return rootCause.trim();
  }

  /*
   * Refuses a state change whose root cause the person changing the state
   * may not write: the check the record's own update runs, for its root
   * cause alone, asked before anything of the change is written. A
   * permission refusal is reworded to say what it means for the change;
   * anything else is passed on as it is. OneUptime's own changes (root)
   * are not asked, as the record's update does not ask them.
   */
  public static async assertCallerMayWrite<TModel extends BaseModel>(data: {
    modelType: { new (): TModel };
    recordId: ObjectID;
    rootCause: string;
    props: DatabaseCommonInteractionProps;
  }): Promise<void> {
    if (data.props.isRoot) {
      return;
    }

    try {
      await ModelPermission.checkUpdateQueryPermissions(
        data.modelType,
        { _id: data.recordId.toString() } as Query<TModel>,
        // Both records the root cause is written on have a rootCause column.
        {
          rootCause: data.rootCause,
        } as unknown as QueryDeepPartialEntity<TModel>,
        data.props,
      );
    } catch (error) {
      if (error instanceof NotAuthorizedException) {
        throw new NotAuthorizedException(
          StateChangeRootCause.getRefusalMessage(error.message),
        );
      }

      throw error;
    }
  }

  /*
   * What a refused change says: that it was not saved, why (the record's own
   * refusal, which names the permissions that write it), and what to do.
   */
  public static getRefusalMessage(reason: string): string {
    const trimmedReason: string = reason.trim();
    const reasonSentence: string = ENDS_A_SENTENCE.test(trimmedReason)
      ? trimmedReason
      : `${trimmedReason}.`;

    return `The state was not changed: it comes with a root cause, which you may not write. ${reasonSentence} To change the state, leave the root cause out.`;
  }

  /*
   * Writes the root cause once the change is saved, with what the record's
   * service writes it. Never throws: the state change is saved, and a root
   * cause that could not be written must not answer it with an error. Says
   * whether it was written.
   */
  public static async save(data: {
    write: () => Promise<unknown>;
    logAttributes: LogAttributes;
  }): Promise<boolean> {
    try {
      await data.write();
      return true;
    } catch (error) {
      logger.error(
        `The root cause written with a state change could not be saved: ${error}`,
        data.logAttributes,
      );
      return false;
    }
  }
}
