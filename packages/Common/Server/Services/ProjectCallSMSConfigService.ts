import DatabaseService from "./DatabaseService";
import TwilioConfig from "../../Types/CallAndSMS/TwilioConfig";
import BadDataException from "../../Types/Exception/BadDataException";
import Model from "../../Models/DatabaseModels/ProjectCallSMSConfig";
import Phone from "../../Types/Phone";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
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
import ModelPermission from "../Types/Database/Permissions/Index";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (createBy.data.isProjectDefault && createBy.data.projectId) {
      await this.updateBy({
        query: {
          projectId: createBy.data.projectId,
          isProjectDefault: true,
        },
        data: {
          isProjectDefault: false,
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
      });
    }

    return { createBy, carryForward: [] };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    if (updateBy.data.isProjectDefault === true) {
      const itemsToUpdate: Array<Model> = await this.findBy({
        query: updateBy.query,
        select: {
          _id: true,
          projectId: true,
        },
        props: {
          isRoot: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
      });

      const projectIds: Set<string> = new Set();
      const itemIds: Set<string> = new Set();
      for (const item of itemsToUpdate) {
        if (item.projectId) {
          projectIds.add(item.projectId.toString());
        }
        if (item._id) {
          itemIds.add(item._id);
        }
      }

      for (const projectIdStr of projectIds) {
        const projectId: ObjectID = new ObjectID(projectIdStr);
        await this.updateBy({
          query: {
            projectId: projectId,
            isProjectDefault: true,
            _id: QueryHelper.notInOrNull(Array.from(itemIds)),
          },
          data: {
            isProjectDefault: false,
          },
          props: {
            isRoot: true,
          },
          limit: LIMIT_MAX,
          skip: 0,
        });
      }
    }

    return { updateBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    /*
     * This hook releases provider resources before DatabaseService reaches its
     * usual delete permission check. Scope the query first so a denied config
     * delete cannot release or clear another tenant's phone numbers.
     */
    deleteBy.query = await ModelPermission.checkDeleteQueryPermission(
      Model,
      deleteBy.query,
      deleteBy.props,
    );

    /*
     * When a Call/SMS config is deleted, release any incoming-call numbers
     * provisioned through it (so they don't keep billing on the provider) and
     * clear the now-dangling number fields on those policies. The config still
     * exists at this point, so the provider can be built to release the numbers.
     */
    const configs: Array<Model> = await this.findBy({
      query: deleteBy.query,
      select: {
        _id: true,
      },
      limit: deleteBy.limit,
      skip: deleteBy.skip,
      props: {
        isRoot: true,
      },
    });

    const configIds: Array<ObjectID> = configs
      .map((config: Model): ObjectID | null => {
        return config.id;
      })
      .filter((configId: ObjectID | null): configId is ObjectID => {
        return Boolean(configId);
      });

    /*
     * Freeze the caller's offset/limit window before provider side effects.
     * The original window could otherwise select different rows when
     * DatabaseService evaluates it again after the releases complete.
     */
    deleteBy.query = {
      _id: QueryHelper.any(configIds),
    };
    deleteBy.skip = 0;
    deleteBy.limit = configIds.length;

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
