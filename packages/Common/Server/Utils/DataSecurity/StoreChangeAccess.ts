import DataStore from "../../../Models/DatabaseModels/DataStore";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotAuthorizedException from "../../../Types/Exception/NotAuthorizedException";
import PaymentRequiredException from "../../../Types/Exception/PaymentRequiredException";
import ObjectID from "../../../Types/ObjectID";
import DataStoreService from "../../Services/DataStoreService";
import ModelPermission from "../../Types/Database/Permissions/Index";
import Query from "../../Types/Database/Query";

/*
 * WHETHER A PERSON MAY CHANGE ONE DATA STORE'S PAPERWORK (#10375).
 *
 * A store's record of processing, its OneUptime AI drafts and its impact
 * assessment are columns of the store, written as OneUptime once a route
 * has decided the caller may. That decision is about this store: whether
 * the caller may update it, by its own row - its labels, its owners, the
 * blocks on them - as an update of it through the API would decide
 * (DataStoreService.findOneUpdatableById). Holding a store-editing
 * permission somewhere in the project is not enough: a grant limited to the
 * "staging" label does not reach a store labelled "production"
 * (TableHalfWriteGuard).
 */
export const STORE_RECORD_CHANGE_REFUSED_MESSAGE: string =
  "You may read this store's record of processing, but not change it. Ask a Project Owner or Project Admin for a role that may edit this data store.";

export default class StoreChangeAccess {
  public static async mayChange(data: {
    dataStoreId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<boolean> {
    if (data.props.isRoot === true) {
      return true;
    }

    try {
      return Boolean(
        await DataStoreService.findOneUpdatableById({
          id: data.dataStoreId,
          select: { _id: true },
          props: data.props,
        }),
      );
    } catch (error) {
      // A caller who may not update data stores at all, or this one by its labels.
      if (StoreChangeAccess.isRefusal(error)) {
        return false;
      }

      throw error;
    }
  }

  // The same, refused with `message` when the caller may not.
  public static async assertMayChange(data: {
    dataStoreId: ObjectID;
    props: DatabaseCommonInteractionProps;
    message: string;
  }): Promise<void> {
    if (!(await StoreChangeAccess.mayChange(data))) {
      throw new NotAuthorizedException(data.message);
    }
  }

  /*
   * Whether the caller may change any of the project's stores: whether a
   * list of them offers changes at all (Review Drafts). Decided by rows, as
   * an update through the API narrows them (ModelPermission
   * .getUpdatableQuery: the project, the caller's labels and Owned scope) -
   * and each change is still decided by its own store when it is made.
   */
  public static async mayChangeAny(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
  }): Promise<boolean> {
    if (data.props.isRoot === true) {
      return true;
    }

    let updatable: Query<DataStore>;

    try {
      updatable = await ModelPermission.getUpdatableQuery(
        DataStore,
        { projectId: data.projectId } as Query<DataStore>,
        data.props,
      );
    } catch (error) {
      if (StoreChangeAccess.isRefusal(error)) {
        return false;
      }

      throw error;
    }

    return Boolean(
      await DataStoreService.findOneBy({
        query: updatable,
        select: { _id: true },
        props: { isRoot: true },
      }),
    );
  }

  // What an update of a store would be refused with: the table, the labels, a read-only key, the plan.
  private static isRefusal(error: unknown): boolean {
    return (
      error instanceof NotAuthorizedException ||
      error instanceof PaymentRequiredException
    );
  }
}
