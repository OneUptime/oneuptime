import DatabaseRequestType from "../../BaseDatabase/DatabaseRequestType";
import Query from "../Query";
import AccessControlUtil from "./AccessControlPermission";
import BasePermission, { CheckPermissionBaseInterface } from "./BasePermission";
import ColumnPermissions from "./ColumnPermission";
import CreatePermission, {
  CreateParent,
  ReadableParentIdsFinder,
  RecordIdsFinder,
} from "./CreatePermission";
import EditionPermissions from "./EditionPermission";
import TablePermission from "./TablePermission";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import QueryDeepPartialEntity from "../../../../Types/Database/PartialEntity";
import CaptureSpan from "../../../Utils/Telemetry/CaptureSpan";

export default class UpdatePermission {
  /*
   * `updateData`, when the caller has it, is what the update writes: below
   * the table's update plan an update that only switches the record off
   * still passes the plan check (BillingPermission). Without it, it does
   * not.
   */
  @CaptureSpan()
  public static async checkUpdatePermissionByModel<
    TBaseModel extends BaseModel,
  >(data: {
    fetchModelWithAccessControlIds: () => Promise<TBaseModel | null>;
    isRecordFound?: (query: Query<TBaseModel>) => Promise<boolean>;
    modelType: { new (): TBaseModel };
    props: DatabaseCommonInteractionProps;
    updateData?: unknown;
  }): Promise<void> {
    // The team's blocks, then the grants limited to labels, on one read.
    await AccessControlUtil.checkRecordByModel<TBaseModel>({
      ...data,
      type: DatabaseRequestType.Update,
    });
  }

  /*
   * The rows an update may change, as a query: the caller's query narrowed
   * exactly as checkUpdatePermissions narrows it (the project, the user, the
   * labels and the owned scope), and refused for the same table-level
   * reasons. What the update writes is left out: the edition and column
   * checks need the data a service's hooks have not finished with yet, and
   * checkUpdatePermissions asks them once they have. So this refuses nothing
   * that check would let through.
   *
   * `updateData`, when the caller already has it, is what the update
   * writes: the plan check needs it to let an update that only switches
   * records off through below the table's update plan (BillingPermission).
   * Without it, an update below the plan is refused here.
   */
  @CaptureSpan()
  public static async getUpdatableQuery<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    props: DatabaseCommonInteractionProps,
    updateData?: unknown,
  ): Promise<Query<TBaseModel>> {
    if (props.isRoot || props.isMasterAdmin) {
      return query;
    }

    TablePermission.checkTableLevelPermissions(
      modelType,
      props,
      DatabaseRequestType.Update,
      updateData,
    );

    const checkBasePermission: CheckPermissionBaseInterface<TBaseModel> =
      await BasePermission.checkPermissions(
        modelType,
        query,
        null,
        props,
        DatabaseRequestType.Update,
        updateData,
      );

    return checkBasePermission.query;
  }

  /*
   * A RECORD MOVED TO ANOTHER PARENT GOES ONLY TO ONE ITS EDITOR MAY READ.
   *
   * The parent a record is read through (@CanAccessIfCanReadOn) is the
   * parent it is created under (CreatePermission.checkParentPermission), and
   * an update that changes it is held to the same rule: every parent the
   * update names that a record it writes does not have yet - a changed
   * parent, an entry added to a list of them (an announcement's status
   * pages), under either of the parent's names - must be one the caller may
   * read, in the project, by the read rule of the parent's own table
   * (CreatePermission.checkParentIds). One they may not read is answered
   * like one that does not exist, and nothing is written. The parents a
   * record has already are not asked about again: an announcement on a page
   * its editor may read and on one they may not keeps both through an edit
   * that leaves them. An update that leaves a record with no parent at all
   * makes it a record of the whole project, which needs a read of the
   * parents that reaches the whole project (CreatePermission
   * .checkParentlessWrite), as a create that names none does.
   *
   * `heldParentIds` is, for each record the update writes, the parents it
   * has now; none means it writes nothing, so nothing is asked. Root and
   * master admin callers are left alone. Returns the parents the update
   * names, as checkedParentIds for an ask after the hooks.
   */
  @CaptureSpan()
  public static async checkParentPermission<
    TBaseModel extends BaseModel,
  >(data: {
    modelType: { new (): TBaseModel };
    // What the update writes.
    data: unknown;
    props: DatabaseCommonInteractionProps;
    heldParentIds: Array<Array<string>>;
    findReadableParentIds: ReadableParentIdsFinder;
    findParentIdsInProject: RecordIdsFinder;
    referencesCheckedInProject: boolean;
    // What an ask before the hooks returned: only other parents are asked.
    checkedParentIds?: Array<string> | undefined;
  }): Promise<Array<string>> {
    if (data.props.isRoot || data.props.isMasterAdmin) {
      return [];
    }

    const parent: CreateParent | null = CreatePermission.getCreateParent(
      data.modelType,
    );

    if (
      !parent ||
      !UpdatePermission.namesParent(parent, data.data) ||
      data.heldParentIds.length === 0
    ) {
      return [];
    }

    const namedIds: Array<string> = CreatePermission.getNamedParentIds(
      parent,
      data.data as BaseModel,
    );

    const alreadyChecked: Set<string> = new Set<string>(
      (data.checkedParentIds || []).map(UpdatePermission.normalizeId),
    );

    const newIds: Array<string> = namedIds.filter((id: string): boolean => {
      const normalized: string = UpdatePermission.normalizeId(id);

      return (
        !alreadyChecked.has(normalized) &&
        data.heldParentIds.some((held: Array<string>): boolean => {
          return !held.map(UpdatePermission.normalizeId).includes(normalized);
        })
      );
    });

    const leavesARecordWithoutParent: boolean =
      namedIds.length === 0 &&
      data.heldParentIds.some((held: Array<string>): boolean => {
        return held.length > 0;
      });

    if (newIds.length === 0 && !leavesARecordWithoutParent) {
      return namedIds;
    }

    if (leavesARecordWithoutParent) {
      if (
        CreatePermission.checkParentReadHeld(
          data.modelType,
          parent,
          data.props,
          DatabaseRequestType.Update,
        )
      ) {
        CreatePermission.checkParentlessWrite(
          data.modelType,
          parent,
          data.props,
          DatabaseRequestType.Update,
        );
      }

      return namedIds;
    }

    await CreatePermission.checkParentIds({
      modelType: data.modelType,
      parent: parent,
      ids: newIds,
      props: data.props,
      type: DatabaseRequestType.Update,
      findReadableParentIds: data.findReadableParentIds,
      findParentIdsInProject: data.findParentIdsInProject,
      referencesCheckedInProject: data.referencesCheckedInProject,
    });

    return namedIds;
  }

  /*
   * Whether an update's data names the parent at all - its relation or its
   * ID column, set to anything, null included. An update that leaves both
   * out keeps the parents the records have.
   */
  public static namesParent(parent: CreateParent, data: unknown): boolean {
    if (!data || typeof data !== "object") {
      return false;
    }

    const record: Record<string, unknown> = data as Record<string, unknown>;

    return (
      record[parent.relation] !== undefined ||
      Boolean(parent.idColumn && record[parent.idColumn] !== undefined)
    );
  }

  // Postgres renders a uuid lower-cased, whatever case the payload used.
  private static normalizeId(id: string): string {
    return id.trim().toLowerCase();
  }

  @CaptureSpan()
  public static async checkUpdatePermissions<TBaseModel extends BaseModel>(
    modelType: { new (): TBaseModel },
    query: Query<TBaseModel>,
    data: QueryDeepPartialEntity<TBaseModel>,
    props: DatabaseCommonInteractionProps,
  ): Promise<Query<TBaseModel>> {
    /*
     * The edition check for updates runs here, the one permission entry
     * point that sees what the update writes: an update that only tightens
     * security (rotating a SCIM token) needs no license, anything else does
     * (see EditionPermission). TablePermission leaves updates to this method
     * for that reason.
     *
     * Master admins skip every table-level check below, but not the edition
     * check: changing enterprise configuration (a master admin can edit any
     * project's SCIM configuration and team compliance settings) needs the
     * license for them too. Everyone else gets it right after the
     * table-level check.
     */
    if (props.isMasterAdmin && !props.isRoot) {
      EditionPermissions.checkEditionPermissions(
        modelType,
        props,
        DatabaseRequestType.Update,
        data,
      );
      EditionPermissions.checkEnterpriseColumnPermissions(
        modelType,
        props,
        DatabaseRequestType.Update,
        data,
      );
    }

    if (props.isRoot || props.isMasterAdmin) {
      // If system is making this query then let the query run!
      return query;
    }

    TablePermission.checkTableLevelPermissions(
      modelType,
      props,
      DatabaseRequestType.Update,
      data,
    );

    EditionPermissions.checkEditionPermissions(
      modelType,
      props,
      DatabaseRequestType.Update,
      data,
    );

    EditionPermissions.checkEnterpriseColumnPermissions(
      modelType,
      props,
      DatabaseRequestType.Update,
      data,
    );

    const checkBasePermission: CheckPermissionBaseInterface<TBaseModel> =
      await BasePermission.checkPermissions(
        modelType,
        query,
        null,
        props,
        DatabaseRequestType.Update,
        data,
      );

    query = checkBasePermission.query;

    ColumnPermissions.checkDataColumnPermissions(
      modelType,
      data as any,
      props,
      DatabaseRequestType.Update,
    );

    return query;
  }
}
