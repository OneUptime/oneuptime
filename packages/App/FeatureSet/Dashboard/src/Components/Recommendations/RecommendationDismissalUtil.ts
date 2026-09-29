import ListResult from "Common/Types/BaseDatabase/ListResult";
import ObjectID from "Common/Types/ObjectID";
import RecommendationType from "Common/Types/Recommendation/RecommendationType";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import RecommendationDismissal from "Common/Models/DatabaseModels/RecommendationDismissal";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";

/*
 * Read/write helpers for the dismissal table, kept out of the components so
 * the page and the side-menu badge issue the SAME query.
 *
 * They must: the badge shows "how many recommendations still need attention"
 * and the page shows which ones. A badge that counts dismissed cards and a
 * page that hides them disagree by exactly the number of times the user has
 * used the feature, which is the worst possible failure mode for a nag count.
 */
export default class RecommendationDismissalUtil {
  /*
   * Every dismissal recorded for one resource.
   *
   * Scoped by resourceId rather than by resource identifier string: a cluster
   * renamed after a dismissal keeps its dismissals, which is what a user who
   * dismissed something expects.
   */
  public static async getDismissals(data: {
    resourceType: string;
    resourceId: ObjectID;
    recommendationType?: RecommendationType | undefined;
  }): Promise<Array<RecommendationDismissal>> {
    const result: ListResult<RecommendationDismissal> =
      await ModelAPI.getList<RecommendationDismissal>({
        modelType: RecommendationDismissal,
        query: {
          recommendationType:
            data.recommendationType || RecommendationType.Monitor,
          resourceType: data.resourceType,
          resourceId: data.resourceId,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        select: {
          recommendationId: true,
          recommendationType: true,
          resourceType: true,
          resourceId: true,
          dismissalReason: true,
        },
        sort: {},
      });

    return result.data;
  }

  /*
   * Records the dismissal and returns nothing.
   *
   * The created row is deliberately not returned: `ModelAPI.create` resolves
   * to a raw HTTP response whose body shape varies, and the caller needs the
   * row's id in order to offer Restore. Re-reading the list is one small
   * request that gets the id from the same source the page already trusts,
   * instead of a second parsing path that only runs on the create branch.
   */
  public static async dismiss(data: {
    recommendationId: string;
    recommendationType: RecommendationType;
    resourceType: string;
    resourceId: ObjectID;
    dismissalReason?: string | undefined;
  }): Promise<void> {
    const dismissal: RecommendationDismissal = new RecommendationDismissal();

    dismissal.recommendationId = data.recommendationId;
    dismissal.recommendationType = data.recommendationType;
    dismissal.resourceType = data.resourceType;
    dismissal.resourceId = data.resourceId;

    /*
     * Only set when the user actually typed something. Writing "" would make
     * the dismissed card render an empty reason block, which reads as a
     * rendering bug rather than as "no reason given".
     */
    const trimmedReason: string = (data.dismissalReason || "").trim();

    if (trimmedReason) {
      dismissal.dismissalReason = trimmedReason;
    }

    await ModelAPI.create<RecommendationDismissal>({
      model: dismissal,
      modelType: RecommendationDismissal,
    });
  }

  /*
   * Restore a dismissed recommendation by deleting its row.
   *
   * A delete rather than a flag: deletes in this codebase are hard deletes, so
   * a restored recommendation can be dismissed again cleanly, and the table
   * never accumulates rows for recommendations nobody is hiding.
   */
  public static async restore(dismissalId: ObjectID): Promise<void> {
    await ModelAPI.deleteItem<RecommendationDismissal>({
      modelType: RecommendationDismissal,
      id: dismissalId,
    });
  }
}
