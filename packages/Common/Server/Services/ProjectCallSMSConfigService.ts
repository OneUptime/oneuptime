import DatabaseService from "./DatabaseService";
import TwilioConfig from "../../Types/CallAndSMS/TwilioConfig";
import BadDataException from "../../Types/Exception/BadDataException";
import Model from "../../Models/DatabaseModels/ProjectCallSMSConfig";
import Phone from "../../Types/Phone";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import ObjectID from "../../Types/ObjectID";
import QueryHelper from "../Types/Database/QueryHelper";
import IncomingCallPolicyService from "./IncomingCallPolicyService";
import IncomingCallPolicy from "../../Models/DatabaseModels/IncomingCallPolicy";
import releaseIncomingCallPhoneNumber from "../Utils/IncomingCallPhoneNumber";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import IncomingCallPolicyPhoneNumberService from "./IncomingCallPolicyPhoneNumberService";
import IncomingCallPolicyPhoneNumber from "../../Models/DatabaseModels/IncomingCallPolicyPhoneNumber";
import PositiveNumber from "../../Types/PositiveNumber";
import ProjectDefaultRow from "../Utils/Database/ProjectDefaultRow";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    const projectId: ObjectID | undefined = createBy.data.projectId;

    /*
     * A project's first Twilio config becomes its default, so SMS and calls
     * to the project's members go through it as soon as it is saved: adding
     * your own Twilio account is asking for exactly that, and a config that
     * nothing uses until someone finds a switch is a trap. Only when the
     * caller leaves the choice out - an explicit false (the dashboard's
     * switch turned off, an API call, Terraform, which always sends one) is
     * kept. A project that already has a config keeps the one it uses.
     */
    if (
      projectId &&
      !this.isProjectDefaultChoiceGiven(createBy.data.isProjectDefault)
    ) {
      if (await this.isFirstConfigOfProject(projectId)) {
        createBy.data.isProjectDefault = true;
      }
    }

    return { createBy, carryForward: [] };
  }

  /*
   * A config saved as the project default takes the default from the
   * project's other configs - only now that it exists, so a create that is
   * refused or fails leaves the project's default where it was.
   */
  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    await ProjectDefaultRow.afterCreate({
      service: this,
      defaultColumn: "isProjectDefault",
      createdItem: createdItem,
    });

    return createdItem;
  }

  /*
   * Whether a create says whether the config is the project default. Null
   * says nothing either: DatabaseService stores the column default for it.
   */
  private isProjectDefaultChoiceGiven(
    isProjectDefault: boolean | null | undefined,
  ): boolean {
    return isProjectDefault !== undefined && isProjectDefault !== null;
  }

  // Whether the project has no Twilio config yet, so this one is its first.
  private async isFirstConfigOfProject(projectId: ObjectID): Promise<boolean> {
    const configCount: PositiveNumber = await this.countBy({
      query: {
        projectId: projectId,
      },
      props: {
        isRoot: true,
      },
    });

    return configCount.toNumber() === 0;
  }

  /*
   * Making a config the default takes it from the others in its project, once
   * the update has made it (so after every permission check), and only for
   * the configs the update actually wrote.
   */
  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    await ProjectDefaultRow.afterUpdate({
      service: this,
      defaultColumn: "isProjectDefault",
      updatedData: onUpdate.updateBy.data,
      updatedItemIds: updatedItemIds,
    });

    return onUpdate;
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    /*
     * When a Call/SMS config is deleted, release any incoming-call numbers
     * provisioned through it (so they don't keep billing on the provider) and
     * clear the now-dangling number fields on those policies. The config still
     * exists at this point, so the provider can be built to release the numbers.
     *
     * Only the configs the delete removes - the ones the caller may delete, in
     * the delete's own window - are read, and the delete is held to exactly
     * them before any provider call, so a window that shifts while the
     * provider answers cannot change which rows go.
     */
    const configs: Array<Model> = await this.findRowsAndHoldDeleteToThem(
      deleteBy,
      {
        _id: true,
      },
    );

    for (const config of configs) {
      if (!config.id) {
        continue;
      }

      const phoneNumbers: Array<IncomingCallPolicyPhoneNumber> =
        await IncomingCallPolicyPhoneNumberService.findAllBy({
          query: {
            projectCallSMSConfigId: config.id,
          },
          select: {
            _id: true,
            callProviderPhoneNumberId: true,
            projectCallSMSConfigId: true,
          },
          props: {
            isRoot: true,
          },
        });

      /*
       * Snapshot scalar-only attachments before deleting child rows. The child
       * delete hook updates the compatibility mirror and can otherwise erase
       * an unmatched legacy SID before it is released from the provider.
       */
      const policies: Array<IncomingCallPolicy> =
        await IncomingCallPolicyService.findAllBy({
          query: {
            projectCallSMSConfigId: config.id,
          },
          select: {
            _id: true,
            callProviderPhoneNumberId: true,
            projectCallSMSConfigId: true,
          },
          props: {
            isRoot: true,
          },
        });

      const releasedProviderPhoneNumberIds: Set<string> = new Set();

      for (const phoneNumber of phoneNumbers) {
        if (
          !phoneNumber.callProviderPhoneNumberId ||
          !phoneNumber.projectCallSMSConfigId
        ) {
          continue;
        }

        if (
          releasedProviderPhoneNumberIds.has(
            phoneNumber.callProviderPhoneNumberId,
          )
        ) {
          continue;
        }

        await releaseIncomingCallPhoneNumber({
          projectCallSMSConfigId: phoneNumber.projectCallSMSConfigId,
          callProviderPhoneNumberId: phoneNumber.callProviderPhoneNumberId,
        });

        releasedProviderPhoneNumberIds.add(
          phoneNumber.callProviderPhoneNumberId,
        );
      }

      for (const policy of policies) {
        if (
          !policy.callProviderPhoneNumberId ||
          !policy.projectCallSMSConfigId ||
          releasedProviderPhoneNumberIds.has(policy.callProviderPhoneNumberId)
        ) {
          continue;
        }

        await releaseIncomingCallPhoneNumber({
          projectCallSMSConfigId: policy.projectCallSMSConfigId,
          callProviderPhoneNumberId: policy.callProviderPhoneNumberId,
        });

        releasedProviderPhoneNumberIds.add(policy.callProviderPhoneNumberId);
      }

      /*
       * Delete through the child service before the config itself is removed.
       * Its hooks re-select the oldest remaining number for each affected
       * policy and update the legacy compatibility fields accordingly.
       */
      const phoneNumberIds: Array<ObjectID> = phoneNumbers
        .map((phoneNumber: IncomingCallPolicyPhoneNumber): ObjectID | null => {
          return phoneNumber.id;
        })
        .filter((phoneNumberId: ObjectID | null): phoneNumberId is ObjectID => {
          return Boolean(phoneNumberId);
        });

      /*
       * deleteBy is intentionally bounded, so delete the exact snapshotted
       * child ids in batches. This covers configs with more than LIMIT_MAX
       * attached numbers and keeps the explicit cleanup bound to the rows
       * whose provider resources were released above.
       */
      for (
        let offset: number = 0;
        offset < phoneNumberIds.length;
        offset += LIMIT_MAX
      ) {
        const phoneNumberIdBatch: Array<ObjectID> = phoneNumberIds.slice(
          offset,
          offset + LIMIT_MAX,
        );

        await IncomingCallPolicyPhoneNumberService.deleteBy({
          query: {
            _id: QueryHelper.any(phoneNumberIdBatch),
          },
          limit: phoneNumberIdBatch.length,
          skip: 0,
          props: {
            isRoot: true,
          },
        });
      }

      for (const policy of policies) {
        if (!policy.id) {
          continue;
        }

        const remainingPhoneNumber: IncomingCallPolicyPhoneNumber | null =
          await IncomingCallPolicyPhoneNumberService.findOneBy({
            query: {
              incomingCallPolicyId: policy.id,
            },
            select: {
              _id: true,
            },
            props: {
              isRoot: true,
            },
          });

        if (remainingPhoneNumber) {
          await IncomingCallPolicyPhoneNumberService.syncPrimaryPhoneNumberToPolicy(
            policy.id,
          );
          continue;
        }

        await IncomingCallPolicyService.updateOneById({
          id: policy.id,
          data: {
            routingPhoneNumber: null,
            callProviderPhoneNumberId: null,
            phoneNumberCountryCode: null,
            phoneNumberAreaCode: null,
            phoneNumberPurchasedAt: null,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
          } as any,
          props: {
            isRoot: true,
          },
        });
      }
    }

    return { deleteBy, carryForward: null };
  }

  @CaptureSpan()
  public async getProjectDefaultTwilioConfig(
    projectId: ObjectID | undefined,
  ): Promise<TwilioConfig | undefined> {
    if (!projectId) {
      return undefined;
    }

    const config: Model | null = await this.findOneBy({
      query: {
        projectId: projectId,
        isProjectDefault: true,
      },
      select: {
        _id: true,
        twilioAccountSID: true,
        twilioAuthToken: true,
        twilioPrimaryPhoneNumber: true,
        twilioSecondaryPhoneNumbers: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!config) {
      return undefined;
    }

    try {
      return this.toTwilioConfig(config);
    } catch {
      // If the default config is incomplete, fall back to global by returning undefined.
      return undefined;
    }
  }

  public toTwilioConfig(
    projectCallSmsConfig: Model | undefined,
  ): TwilioConfig | undefined {
    if (!projectCallSmsConfig) {
      return undefined;
    }

    if (!projectCallSmsConfig.id) {
      throw new BadDataException("Project Call and SMS Config id is not set");
    }

    if (!projectCallSmsConfig.twilioAccountSID) {
      throw new BadDataException(
        "Project Call and SMS Config twilio account SID is not set",
      );
    }

    if (!projectCallSmsConfig.twilioPrimaryPhoneNumber) {
      throw new BadDataException(
        "Project Call and SMS Config twilio phone number is not set",
      );
    }

    if (!projectCallSmsConfig.twilioAuthToken) {
      throw new BadDataException(
        "Project Call and SMS Config twilio auth token is not set",
      );
    }

    return {
      accountSid: projectCallSmsConfig.twilioAccountSID.toString(),
      authToken: projectCallSmsConfig.twilioAuthToken.toString(),
      primaryPhoneNumber: projectCallSmsConfig.twilioPrimaryPhoneNumber,
      secondaryPhoneNumbers:
        projectCallSmsConfig.twilioSecondaryPhoneNumbers &&
        projectCallSmsConfig.twilioSecondaryPhoneNumbers.length > 0
          ? projectCallSmsConfig.twilioSecondaryPhoneNumbers
              .split(",")
              .map((phone: string) => {
                return new Phone(phone);
              })
          : [],
    };
  }
}
export default new Service();
