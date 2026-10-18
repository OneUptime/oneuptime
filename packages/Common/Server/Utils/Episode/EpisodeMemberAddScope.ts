import type { PendingRecord } from "../../Services/DatabaseService";
import CreateScopeException from "../../Types/Database/Permissions/CreateScopeException";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import { resolveReferenceIds } from "../Database/ProjectScopedReferenceRefusal";

/*
 * AN INCIDENT OR AN ALERT IS ADDED TO AN EPISODE ONLY AS ITS CALLER MAY ADD
 * IT, HOWEVER MANY ARE ADDED AT ONCE.
 *
 * Adding one is creating a member row: through the member's own route, the
 * row is held to what the caller's permission to create members reaches
 * (CreateScopePermission) - a permission limited to labels, a member
 * carrying one of them; one scoped to Owned, a member of an incident or an
 * alert the caller or their teams own (the row takes its owners from it,
 * @OwnedThrough); a block with labels, no member carrying one of them. The
 * routes that add several at once (EpisodeMembersAdd: the lists' Add to
 * Existing Episode and Add to New Episode, an episode's own Add Incidents
 * and Add Alerts) write each row as OneUptime once the caller's right to add
 * it is checked, so they ask the same here, row by row, before anything is
 * written. An episode's state changes move the incidents and alerts it
 * holds, as OneUptime's own writes: who may put one in an episode is who
 * may add it as a member of their own, however it is added.
 */

// The member service's own check of a row its caller adds (DatabaseService).
export interface MemberCreateScopeChecker<TMember extends BaseModel> {
  checkCreateScopeOf(data: {
    row: TMember;
    props: DatabaseCommonInteractionProps;
    pending?: PendingRecord | undefined;
  }): Promise<void>;
}

export default class EpisodeMemberAddScope {
  /*
   * Why the caller may not add `member` - a member row as the bulk add will
   * write it - or null when they may: the words of the refusal a create of
   * the row through its own route answers with. Root and master admin
   * callers add any. Any other failure is thrown.
   */
  public static async getRefusal<TMember extends BaseModel>(data: {
    memberService: MemberCreateScopeChecker<TMember>;
    member: TMember;
    props: DatabaseCommonInteractionProps;
    // The episode, when it is being created with them and is not saved yet.
    pendingEpisode?: PendingRecord | undefined;
  }): Promise<string | null> {
    if (data.props.isRoot || data.props.isMasterAdmin) {
      return null;
    }

    try {
      await data.memberService.checkCreateScopeOf({
        row: data.member,
        props: data.props,
        pending: data.pendingEpisode,
      });

      return null;
    } catch (error) {
      if (error instanceof CreateScopeException) {
        return error.message;
      }

      throw error;
    }
  }

  /*
   * An episode that is being created with what goes in it, while it is not
   * saved yet: its members name it by a placeholder id, and carry the labels
   * it is created with.
   */
  public static getPendingEpisode(data: {
    episodeModelType: { new (): BaseModel };
    labels: unknown;
  }): PendingRecord {
    return {
      modelType: data.episodeModelType,
      id: ObjectID.generate(),
      labelIds: resolveReferenceIds(data.labels).map(
        (labelId: ObjectID | string): string => {
          return labelId.toString();
        },
      ),
      /*
       * A member takes its owners from its incident or alert, never from
       * the episode: whether the episode will be its creator's does not
       * decide who may add to it.
       */
      ownedByCreator: false,
    };
  }
}
