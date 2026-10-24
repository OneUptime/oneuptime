import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import DatabaseService from "./DatabaseService";
import SecurityCaseService from "./SecurityCaseService";
import ArchivableValueGuard from "../Utils/Database/ArchivableValueGuard";
import StateOrderGuard from "../Utils/Database/StateOrderGuard";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import Model from "../../Models/DatabaseModels/SecurityCaseStatus";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import {
  ARCHIVABLE_VALUES,
  ArchivableValueType,
} from "../../Utils/ArchivableValues";
import { STATE_LISTS, StateListType } from "../../Utils/StateOrder";

/*
 * A project's security case statuses (SecurityCaseStatus): where a case
 * stands. A drag-ordered list like the incident states
 * (Common/Utils/StateOrder): a new status with no place goes just above the
 * closed status, and the new, acknowledged, contained and closed statuses
 * keep that order and are never deleted or archived - OneUptime reads what
 * they mean and moves cases into them by itself
 * (Common/Utils/SecurityCase/SecurityCaseStatuses).
 *
 * A status cases are in is never deleted: the delete is refused with how
 * many, and the settings page offers Archive for it.
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await StateOrderGuard.beforeCreate({
      service: this,
      definition: STATE_LISTS[StateListType.SecurityCaseStatus],
      createBy: createBy,
    });

    // Never created archived if it is a built-in one. See ArchivableValueGuard.
    await ArchivableValueGuard.beforeCreate({
      service: this,
      definition: ARCHIVABLE_VALUES[ArchivableValueType.SecurityCaseStatus],
      createBy: createBy,
    });

    return {
      createBy: createBy,
      carryForward: null,
    };
  }

  /*
   * A status can be moved - dragged on the settings page, or given another
   * number through the API - as long as the four built-in statuses keep
   * their order.
   */
  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await StateOrderGuard.beforeUpdate({
      service: this,
      definition: STATE_LISTS[StateListType.SecurityCaseStatus],
      updateBy: updateBy,
    });

    // A built-in status is never archived. See ArchivableValueGuard.
    await ArchivableValueGuard.beforeUpdate({
      service: this,
      definition: ARCHIVABLE_VALUES[ArchivableValueType.SecurityCaseStatus],
      updateBy: updateBy,
    });

    return { updateBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    if (!deleteBy.query._id && !deleteBy.props.isRoot) {
      throw new BadDataException(
        "_id should be present when deleting security case statuses. Please try the delete with objectId",
      );
    }

    // A project always keeps a new, an acknowledged, a contained and a closed status.
    await StateOrderGuard.beforeDelete({
      service: this,
      definition: STATE_LISTS[StateListType.SecurityCaseStatus],
      deleteBy: deleteBy,
    });

    if (!deleteBy.props.isRoot) {
      const statuses: Array<Model> = await this.findRowsAndHoldDeleteToThem(
        deleteBy,
        {
          _id: true,
          name: true,
        },
      );

      for (const status of statuses) {
        const casesInIt: number = (
          await SecurityCaseService.countBy({
            query: {
              securityCaseStatusId: status.id!,
            },
            props: {
              isRoot: true,
            },
          })
        ).toNumber();

        if (casesInIt > 0) {
          throw new BadDataException(
            getStatusInUseMessage({
              name: status.name || "",
              cases: casesInIt,
            }),
          );
        }
      }
    }

    return {
      deleteBy,
      carryForward: null,
    };
  }

  /*
   * The project's statuses, top first, as OneUptime reads them: what decides
   * where a new case starts, which cases are open, and what a change of
   * status records (Common/Utils/SecurityCase/SecurityCaseStatuses).
   * Archived statuses are among them: a case in one keeps it, and what it
   * counts as still follows from where it sits.
   */
  @CaptureSpan()
  public async getProjectStatuses(projectId: ObjectID): Promise<Array<Model>> {
    return await this.findBy({
      query: {
        projectId: projectId,
      },
      skip: 0,
      limit: LIMIT_MAX,
      sort: {
        order: SortOrder.Ascending,
      },
      select: {
        _id: true,
        name: true,
        color: true,
        order: true,
        createdAt: true,
        isNewStatus: true,
        isAcknowledgedStatus: true,
        isContainedStatus: true,
        isClosedStatus: true,
        isArchived: true,
      },
      props: {
        isRoot: true,
      },
    });
  }
}

// Why a status cases are in is not deleted, and the two ways on.
export function getStatusInUseMessage(data: {
  name: string;
  cases: number;
}): string {
  const subject: string = data.name ? `"${data.name}"` : "This status";
  const cases: string =
    data.cases === 1 ? "1 case is" : `${data.cases.toString()} cases are`;

  return `${subject} can't be deleted: ${cases} in it. Move them to another status first, or archive it so nobody picks it again.`;
}

export default new Service();
