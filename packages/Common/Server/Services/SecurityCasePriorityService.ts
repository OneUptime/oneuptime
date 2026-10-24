import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import DatabaseService from "./DatabaseService";
import SecurityCaseService from "./SecurityCaseService";
import SecurityPlaybookService from "./SecurityPlaybookService";
import ArchivableValueGuard from "../Utils/Database/ArchivableValueGuard";
import StateOrderGuard from "../Utils/Database/StateOrderGuard";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import Model from "../../Models/DatabaseModels/SecurityCasePriority";
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
 * A project's security case priorities (SecurityCasePriority): how urgent a
 * case is, ranked most urgent first. A drag-ordered list
 * (Common/Utils/StateOrder): a new priority with no place goes to the end,
 * and the five built-in priorities - the ones Critical, High, Medium, Low
 * and Informational detections open their cases at - keep that order and
 * are never deleted or archived (Common/Utils/SecurityCase/
 * SecurityCasePriorities).
 *
 * A priority cases are at, or a playbook runs from, is never deleted: the
 * delete is refused with what uses it, and the settings page offers Archive.
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
      definition: STATE_LISTS[StateListType.SecurityCasePriority],
      createBy: createBy,
    });

    // Never created archived if it is a built-in one. See ArchivableValueGuard.
    await ArchivableValueGuard.beforeCreate({
      service: this,
      definition: ARCHIVABLE_VALUES[ArchivableValueType.SecurityCasePriority],
      createBy: createBy,
    });

    return {
      createBy: createBy,
      carryForward: null,
    };
  }

  /*
   * A priority can be moved - dragged on the settings page, or given another
   * number through the API - as long as the five built-in priorities keep
   * their order: a more severe detection never lands lower.
   */
  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await StateOrderGuard.beforeUpdate({
      service: this,
      definition: STATE_LISTS[StateListType.SecurityCasePriority],
      updateBy: updateBy,
    });

    // A built-in priority is never archived. See ArchivableValueGuard.
    await ArchivableValueGuard.beforeUpdate({
      service: this,
      definition: ARCHIVABLE_VALUES[ArchivableValueType.SecurityCasePriority],
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
        "_id should be present when deleting security case priorities. Please try the delete with objectId",
      );
    }

    // A project always keeps the priority of each detection severity.
    await StateOrderGuard.beforeDelete({
      service: this,
      definition: STATE_LISTS[StateListType.SecurityCasePriority],
      deleteBy: deleteBy,
    });

    if (!deleteBy.props.isRoot) {
      const priorities: Array<Model> = await this.findRowsAndHoldDeleteToThem(
        deleteBy,
        {
          _id: true,
          name: true,
        },
      );

      for (const priority of priorities) {
        const cases: number = (
          await SecurityCaseService.countBy({
            query: {
              securityCasePriorityId: priority.id!,
            },
            props: {
              isRoot: true,
            },
          })
        ).toNumber();

        const playbooks: number = (
          await SecurityPlaybookService.countBy({
            query: {
              minimumSecurityCasePriorityId: priority.id!,
            },
            props: {
              isRoot: true,
            },
          })
        ).toNumber();

        if (cases > 0 || playbooks > 0) {
          throw new BadDataException(
            getPriorityInUseMessage({
              name: priority.name || "",
              cases: cases,
              playbooks: playbooks,
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
   * The project's priorities, most urgent first, as OneUptime reads them:
   * what a detection opens a case at, and what every "at least" compares
   * (Common/Utils/SecurityCase/SecurityCasePriorities). Archived priorities
   * are among them: a case at one keeps it, and its rank still counts.
   */
  @CaptureSpan()
  public async getProjectPriorities(
    projectId: ObjectID,
  ): Promise<Array<Model>> {
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
        isCriticalPriority: true,
        isHighPriority: true,
        isMediumPriority: true,
        isLowPriority: true,
        isInformationalPriority: true,
        isArchived: true,
      },
      props: {
        isRoot: true,
      },
    });
  }
}

// Why a priority cases are at, or playbooks run from, is not deleted, and the two ways on.
export function getPriorityInUseMessage(data: {
  name: string;
  cases: number;
  playbooks: number;
}): string {
  const subject: string = data.name ? `"${data.name}"` : "This priority";
  const uses: Array<string> = [];

  if (data.cases > 0) {
    uses.push(
      data.cases === 1
        ? "1 case is at it"
        : `${data.cases.toString()} cases are at it`,
    );
  }

  if (data.playbooks > 0) {
    uses.push(
      data.playbooks === 1
        ? "1 playbook runs from it"
        : `${data.playbooks.toString()} playbooks run from it`,
    );
  }

  return `${subject} can't be deleted: ${uses.join(" and ")}. Change them to another priority first, or archive it so nobody picks it again.`;
}

export default new Service();
