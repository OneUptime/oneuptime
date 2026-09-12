import DatabaseService from "./DatabaseService";
import IncomingCallPolicyPhoneNumber from "../../Models/DatabaseModels/IncomingCallPolicyPhoneNumber";
import IncomingCallPolicy from "../../Models/DatabaseModels/IncomingCallPolicy";
import { OnCreate, OnDelete } from "../Types/Database/Hooks";
import DeleteBy from "../Types/Database/DeleteBy";
import ObjectID from "../../Types/ObjectID";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import logger from "../Utils/Logger";

const incomingCallPolicyDatabaseService: DatabaseService<IncomingCallPolicy> =
  new DatabaseService<IncomingCallPolicy>(IncomingCallPolicy);

const compatibilityPolicyDatabaseService: {
  updateOneById: (data: {
    id: ObjectID;
    data: Partial<IncomingCallPolicy>;
    props: { isRoot: boolean };
  }) => Promise<unknown>;
} = incomingCallPolicyDatabaseService as unknown as {
  updateOneById: (data: {
    id: ObjectID;
    data: Partial<IncomingCallPolicy>;
    props: { isRoot: boolean };
  }) => Promise<unknown>;
};

export class Service extends DatabaseService<IncomingCallPolicyPhoneNumber> {
  public constructor() {
    super(IncomingCallPolicyPhoneNumber);
  }

  /**
   * The child rows are the source of truth, but older dashboard clients still
   * read the scalar phone-number fields on IncomingCallPolicy. Mirror the
   * oldest attached number there until those clients have all migrated.
   */
  public async syncPrimaryPhoneNumberToPolicy(
    incomingCallPolicyId: ObjectID,
  ): Promise<void> {
    const primaryPhoneNumber: IncomingCallPolicyPhoneNumber | null =
      await this.findOneBy({
        query: {
          incomingCallPolicyId,
        },
        select: {
          phoneNumber: true,
          callProviderPhoneNumberId: true,
          projectCallSMSConfigId: true,
          countryCode: true,
          areaCode: true,
          phoneNumberPurchasedAt: true,
        },
        sort: {
          createdAt: SortOrder.Ascending,
          _id: SortOrder.Ascending,
        },
        props: {
          isRoot: true,
        },
      });

    const compatibilityData: Partial<IncomingCallPolicy> = {
      routingPhoneNumber: primaryPhoneNumber?.phoneNumber ?? null,
      callProviderPhoneNumberId:
        primaryPhoneNumber?.callProviderPhoneNumberId ?? null,
      phoneNumberCountryCode: primaryPhoneNumber?.countryCode ?? null,
      phoneNumberAreaCode: primaryPhoneNumber?.areaCode ?? null,
      phoneNumberPurchasedAt:
        primaryPhoneNumber?.phoneNumberPurchasedAt ?? null,
      /*
       * Database columns are nullable even though PartialEntity does not
       * currently model null separately from undefined.
       */
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
    } as any;

    /*
     * All attached numbers normally share a config. Promoting the primary
     * child's config also repairs older mixed-config data after one config is
     * deleted. Do not clear the config when the final number is removed: the
     * policy needs that selection in order to add its next number.
     */
    if (primaryPhoneNumber?.projectCallSMSConfigId) {
      compatibilityData.projectCallSMSConfigId =
        primaryPhoneNumber.projectCallSMSConfigId;
    }

    await compatibilityPolicyDatabaseService.updateOneById({
      id: incomingCallPolicyId,
      data: compatibilityData,
      props: {
        isRoot: true,
      },
    });
  }

  private async syncPrimaryPhoneNumberToPolicyBestEffort(
    incomingCallPolicyId: ObjectID,
  ): Promise<void> {
    try {
      await this.syncPrimaryPhoneNumberToPolicy(incomingCallPolicyId);
    } catch (error) {
      /*
       * The child row has already been committed/deleted when success hooks
       * run. Do not turn a compatibility-mirror failure into a false provider
       * rollback or a failed release response; the child table remains the
       * authoritative state and a later mutation will repair the mirror.
       */
      logger.error(
        `Failed to mirror incoming call phone numbers to policy ${incomingCallPolicyId.toString()}`,
      );
      logger.error(error);
    }
  }

  protected override async onCreateSuccess(
    _onCreate: OnCreate<IncomingCallPolicyPhoneNumber>,
    createdItem: IncomingCallPolicyPhoneNumber,
  ): Promise<IncomingCallPolicyPhoneNumber> {
    if (createdItem.incomingCallPolicyId) {
      await this.syncPrimaryPhoneNumberToPolicyBestEffort(
        createdItem.incomingCallPolicyId,
      );
    }

    return createdItem;
  }

  protected override async onBeforeDelete(
    deleteBy: DeleteBy<IncomingCallPolicyPhoneNumber>,
  ): Promise<OnDelete<IncomingCallPolicyPhoneNumber>> {
    const phoneNumbers: Array<IncomingCallPolicyPhoneNumber> =
      await this.findBy({
        query: deleteBy.query,
        select: {
          incomingCallPolicyId: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    const incomingCallPolicyIdMap: Map<string, ObjectID> = new Map();
    for (const phoneNumber of phoneNumbers) {
      if (phoneNumber.incomingCallPolicyId) {
        incomingCallPolicyIdMap.set(
          phoneNumber.incomingCallPolicyId.toString(),
          phoneNumber.incomingCallPolicyId,
        );
      }
    }

    const incomingCallPolicyIds: Array<ObjectID> = Array.from(
      incomingCallPolicyIdMap.values(),
    );

    return {
      deleteBy,
      carryForward: incomingCallPolicyIds,
    };
  }

  protected override async onDeleteSuccess(
    onDelete: OnDelete<IncomingCallPolicyPhoneNumber>,
    _itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<IncomingCallPolicyPhoneNumber>> {
    const incomingCallPolicyIds: Array<ObjectID> =
      (onDelete.carryForward as Array<ObjectID>) || [];

    for (const incomingCallPolicyId of incomingCallPolicyIds) {
      await this.syncPrimaryPhoneNumberToPolicyBestEffort(incomingCallPolicyId);
    }

    return {
      deleteBy: onDelete.deleteBy,
      carryForward: null,
    };
  }
}

export default new Service();
