import DatabaseService from "./DatabaseService";
import TwilioConfig from "../../Types/CallAndSMS/TwilioConfig";
import BadDataException from "../../Types/Exception/BadDataException";
import Model from "../../Models/DatabaseModels/ProjectCallSMSConfig";
import TwilioPhoneNumbers from "../../Types/CallAndSMS/TwilioPhoneNumbers";
import TwilioConfigUses, {
  SMS_PHONE_NUMBERS_TITLE,
  TwilioConfigUse,
} from "../../Types/CallAndSMS/TwilioConfigUse";
import TwilioConfigWrite, {
  TwilioUseAndNumbers,
} from "../../Types/CallAndSMS/TwilioConfigWrite";
import { TwilioMessageKind } from "../../Utils/Project/TwilioAccount";
import Phone from "../../Types/Phone";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import UpdateBy from "../Types/Database/UpdateBy";
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
import { PROJECT_TWILIO_CONFIG_SELECT } from "../Utils/TwilioConfigSelect";

/*
 * The list of SMS numbers a config stores is checked, by the name the forms
 * give it (SMS_PHONE_NUMBERS_TITLE), when it is written, so a number that
 * could never send is refused as it is typed rather than when an alert goes
 * out. The older list of secondary numbers is read as tolerantly as ever and
 * is not refused here: the API and Terraform keep accepting what they always
 * did.
 */

// The columns of a config - stored, or a write's - that what it is used for reads.
interface UseAndNumberColumns {
  usedFor?: unknown;
  twilioPrimaryPhoneNumber?: unknown;
  twilioSmsPhoneNumbers?: unknown;
}

// A config's use and numbers, as TwilioConfigWrite reads them.
const useAndNumbersOf: (config: UseAndNumberColumns) => TwilioUseAndNumbers = (
  config: UseAndNumberColumns,
): TwilioUseAndNumbers => {
  return {
    use: config.usedFor,
    primaryPhoneNumber: config.twilioPrimaryPhoneNumber,
    smsPhoneNumbers: config.twilioSmsPhoneNumbers,
  };
};

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    TwilioPhoneNumbers.assertListIsValid({
      title: SMS_PHONE_NUMBERS_TITLE,
      text: createBy.data.twilioSmsPhoneNumbers,
    });

    /*
     * What the config is used for, and the numbers that takes: a config
     * used for calls - with SMS or alone - has a number to make them from,
     * and one used for SMS only lists numbers to send them from. A config
     * that could not do what it says is refused when it is made, as the
     * form refuses it, not when its first message goes nowhere.
     */
    Service.assertUseIsValid(createBy.data.usedFor);

    const missingNumberError: string | null =
      TwilioConfigWrite.getMissingNumberError(useAndNumbersOf(createBy.data));

    if (missingNumberError) {
      throw new BadDataException(missingNumberError);
    }

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

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    TwilioPhoneNumbers.assertListIsValid({
      title: SMS_PHONE_NUMBERS_TITLE,
      text: updateBy.data.twilioSmsPhoneNumbers,
    });

    Service.assertUseIsValid(updateBy.data.usedFor);

    await this.assertUpdateKeepsNumbersForUse(updateBy);

    return { updateBy, carryForward: null };
  }

  // A value for what a config is used for that is not one of the uses is refused.
  private static assertUseIsValid(value: unknown): void {
    const error: string | null = TwilioConfigUses.getUseError(value);

    if (error) {
      throw new BadDataException(error);
    }
  }

  /*
   * An update that changes what a config is used for, or its number or its
   * SMS numbers, must leave it with the numbers its use takes - checked on
   * every row it writes, as that row will be once written
   * (TwilioConfigWrite). An update that changes none of them is let through
   * as it always was, whatever the row holds: renaming a config, or making
   * it the default, never fails over numbers a row made before the rule
   * lacks, and an API or Terraform write that sends every field back
   * unchanged changes nothing.
   */
  private async assertUpdateKeepsNumbersForUse(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    const written: TwilioUseAndNumbers = useAndNumbersOf(updateBy.data);

    if (TwilioConfigWrite.getWrittenKeys(written).length === 0) {
      return;
    }

    const rows: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      {
        _id: true,
        usedFor: true,
        twilioPrimaryPhoneNumber: true,
        twilioSmsPhoneNumbers: true,
      },
    );

    for (const row of rows) {
      const error: string | null = TwilioConfigWrite.getUpdateError({
        stored: useAndNumbersOf(row),
        written: written,
      });

      if (error) {
        throw new BadDataException(error);
      }
    }
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

  /*
   * The project's default Twilio config, as the senders take it - or
   * undefined when it has none, or none that can send: the message then
   * goes through the OneUptime server's own account. Given a kind of
   * message, the default only when it is used for that kind (TwilioConfigUse):
   * a default used for SMS only is no config at all to a call, which goes
   * as a call of a project without a config goes - and is paid for as one.
   */
  @CaptureSpan()
  public async getProjectDefaultTwilioConfig(
    projectId: ObjectID | undefined,
    kind?: TwilioMessageKind | undefined,
  ): Promise<TwilioConfig | undefined> {
    if (!projectId) {
      return undefined;
    }

    const config: Model | null = await this.findOneBy({
      query: {
        projectId: projectId,
        isProjectDefault: true,
      },
      select: PROJECT_TWILIO_CONFIG_SELECT,
      props: {
        isRoot: true,
      },
    });

    if (!config) {
      return undefined;
    }

    try {
      return this.toTwilioConfig(config, kind);
    } catch {
      // If the default config is incomplete, fall back to global by returning undefined.
      return undefined;
    }
  }

  /*
   * A stored config as the senders take it. Refused when it lacks its
   * account, or the numbers what it is used for takes (a row written before
   * the forms and the server asked for them can): a project's default is
   * then passed over for the server's own account
   * (getProjectDefaultTwilioConfig), and a status page's message is not
   * sent. Given a kind of message, undefined when the config is not used
   * for that kind: such a message goes as it would without a config - a
   * status page's SMS through a config used for calls only goes through the
   * server's own account, as a page's without a config does.
   */
  public toTwilioConfig(
    projectCallSmsConfig: Model | undefined,
    kind?: TwilioMessageKind | undefined,
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

    // Read with the rest (PROJECT_TWILIO_CONFIG_SELECT): calls and SMS when unset.
    const use: TwilioConfigUse = TwilioConfigUses.getUse(
      projectCallSmsConfig.usedFor,
    );

    /*
     * A number to make calls from, unless the config is used for SMS only:
     * it then sends every SMS from its SMS numbers, and makes no calls.
     */
    if (
      !projectCallSmsConfig.twilioPrimaryPhoneNumber &&
      use !== TwilioConfigUse.SmsOnly
    ) {
      throw new BadDataException(
        "Project Call and SMS Config twilio phone number is not set",
      );
    }

    if (!projectCallSmsConfig.twilioAuthToken) {
      throw new BadDataException(
        "Project Call and SMS Config twilio auth token is not set",
      );
    }

    const twilioConfig: TwilioConfig = {
      accountSid: projectCallSmsConfig.twilioAccountSID.toString(),
      authToken: projectCallSmsConfig.twilioAuthToken.toString(),
      secondaryPhoneNumbers: TwilioPhoneNumbers.parseList(
        projectCallSmsConfig.twilioSecondaryPhoneNumbers,
      ),
    };

    // Left out for calls and SMS, as on every config before the choice.
    if (use !== TwilioConfigUse.CallsAndSms) {
      twilioConfig.use = use;
    }

    if (projectCallSmsConfig.twilioPrimaryPhoneNumber) {
      twilioConfig.primaryPhoneNumber =
        projectCallSmsConfig.twilioPrimaryPhoneNumber;
    }

    /*
     * The numbers every SMS goes out from, when the config lists them: read
     * with the rest (PROJECT_TWILIO_CONFIG_SELECT), and left out when it
     * lists none, so SMS go out from the numbers calls do.
     */
    const smsPhoneNumbers: Array<Phone> = TwilioPhoneNumbers.parseList(
      projectCallSmsConfig.twilioSmsPhoneNumbers,
    );

    if (smsPhoneNumbers.length > 0) {
      twilioConfig.smsPhoneNumbers = smsPhoneNumbers;
    }

    // Used for SMS only, it sends every SMS from these: it must list one.
    if (use === TwilioConfigUse.SmsOnly && smsPhoneNumbers.length === 0) {
      throw new BadDataException(
        "Project Call and SMS Config is used for SMS only and has no SMS phone numbers",
      );
    }

    if (kind && !TwilioPhoneNumbers.canSend(twilioConfig, kind)) {
      return undefined;
    }

    return twilioConfig;
  }
}
export default new Service();
