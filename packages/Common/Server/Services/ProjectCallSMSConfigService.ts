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
import TwilioConfigDefaults, {
  ProjectTwilioConfigDefaultRow,
  TwilioConfigDefaultChange,
  TwilioConfigDefaultColumn,
  TwilioConfigDefaultFlags,
} from "../../Types/CallAndSMS/TwilioConfigDefaults";
import { TwilioMessageKind } from "../../Utils/Project/TwilioAccount";
import Phone from "../../Types/Phone";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import ObjectID from "../../Types/ObjectID";
import QueryHelper from "../Types/Database/QueryHelper";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import IncomingCallPolicyService from "./IncomingCallPolicyService";
import IncomingCallPolicy from "../../Models/DatabaseModels/IncomingCallPolicy";
import releaseIncomingCallPhoneNumber from "../Utils/IncomingCallPhoneNumber";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger from "../Utils/Logger";
import Semaphore, { SemaphoreMutex } from "../Infrastructure/Semaphore";
import IncomingCallPolicyPhoneNumberService from "./IncomingCallPolicyPhoneNumberService";
import IncomingCallPolicyPhoneNumber from "../../Models/DatabaseModels/IncomingCallPolicyPhoneNumber";
import PositiveNumber from "../../Types/PositiveNumber";
import {
  PROJECT_DEFAULT_TWILIO_CONFIG_SELECT,
  PROJECT_TWILIO_CONFIG_USE_SELECT,
} from "../Utils/TwilioConfigSelect";

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

/*
 * What the project-default rule (Types/CallAndSMS/TwilioConfigDefaults)
 * reads of each of a project's configs.
 */
const PROJECT_DEFAULTS_RULE_SELECT: {
  _id: true;
  usedFor: true;
  isProjectDefault: true;
  isProjectDefaultForSms: true;
  isProjectDefaultForCalls: true;
} = {
  _id: true,
  usedFor: true,
  isProjectDefault: true,
  isProjectDefaultForSms: true,
  isProjectDefaultForCalls: true,
};

/*
 * The columns only the rule writes. A write that holds one is the rule's
 * own - nobody else may write them - and is not settled again.
 */
const RULE_COLUMNS: ReadonlyArray<string> = [
  "isProjectDefaultForSms",
  "isProjectDefaultForCalls",
];

/*
 * The columns whose change can move a project's defaults: the switch
 * itself, and what a config is used for - a default made "SMS only" stops
 * being the default for calls, and one made "Calls and SMS" takes the calls
 * when no config has them.
 */
const COLUMNS_THE_DEFAULTS_FOLLOW: ReadonlyArray<string> = [
  "isProjectDefault",
  "usedFor",
];

// What a delete carries to onDeleteSuccess: the projects that lose a default.
interface DeleteCarryForward {
  projectIdsLosingADefault: Array<ObjectID>;
}

const isWritten: (data: Record<string, unknown>, column: string) => boolean = (
  data: Record<string, unknown>,
  column: string,
): boolean => {
  return data[column] !== undefined;
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

    /*
     * What the config is the default for - its SMS, its calls - is the
     * rule's to say once the config is saved (onCreateSuccess), never the
     * create's: the columns are computed, which a create's column check
     * lets through, so a value a create gives is dropped here.
     */
    createBy.data.isProjectDefaultForSms = false;
    createBy.data.isProjectDefaultForCalls = false;

    return { createBy, carryForward: [] };
  }

  /*
   * A config saved as the project default becomes the default for
   * everything it is used for, taking that from the project's other
   * configs - only now that it exists, so a create that is refused or fails
   * leaves the project's defaults where they were. The config handed back
   * says what it became the default for.
   */
  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    const id: ObjectID | null = createdItem.id;
    const projectId: ObjectID | undefined = createdItem.projectId;

    if (createdItem.isProjectDefault !== true || !id || !projectId) {
      return createdItem;
    }

    const defaults: Map<string, TwilioConfigDefaultFlags> =
      await this.settleProjectDefaults({
        projectId: projectId,
        madeDefaultIds: [id],
      });

    const flags: TwilioConfigDefaultFlags | undefined = defaults.get(
      id.toString(),
    );

    if (flags) {
      createdItem.isProjectDefault = flags.isProjectDefault;
      createdItem.isProjectDefaultForSms = flags.isProjectDefaultForSms;
      createdItem.isProjectDefaultForCalls = flags.isProjectDefaultForCalls;
    }

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
      PROJECT_TWILIO_CONFIG_USE_SELECT,
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
   * Once an update that sets whether configs are the project default, or
   * what they are used for, has been saved (so after every permission
   * check), the projects of the configs it actually wrote are settled by
   * the rule: Set as Project Default makes them the default for everything
   * they are used for; Stop Using as Project Default leaves what they were
   * the default for to another default used for it, or to nobody; a default
   * made "SMS only" stops being the default for calls. The rule's own
   * writes - the only ones that write what a config is the default for -
   * are not settled again.
   */
  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    const data: Record<string, unknown> = onUpdate.updateBy.data as Record<
      string,
      unknown
    >;

    if (
      updatedItemIds.length === 0 ||
      RULE_COLUMNS.some((column: string): boolean => {
        return isWritten(data, column);
      }) ||
      !COLUMNS_THE_DEFAULTS_FOLLOW.some((column: string): boolean => {
        return isWritten(data, column);
      })
    ) {
      return onUpdate;
    }

    const updatedConfigs: Array<Model> = await this.findBy({
      query: {
        _id: QueryHelper.any(updatedItemIds),
      },
      select: {
        _id: true,
        projectId: true,
      },
      limit: updatedItemIds.length,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    // The configs the update wrote, by their project.
    const idsByProject: Map<string, Array<ObjectID>> = new Map();

    for (const config of updatedConfigs) {
      if (!config.id || !config.projectId) {
        continue;
      }

      const projectKey: string = config.projectId.toString();
      const ids: Array<ObjectID> = idsByProject.get(projectKey) || [];
      ids.push(config.id);
      idsByProject.set(projectKey, ids);
    }

    for (const [projectKey, ids] of idsByProject) {
      await this.settleProjectDefaults({
        projectId: new ObjectID(projectKey),
        madeDefaultIds: data["isProjectDefault"] === true ? ids : [],
      });
    }

    return onUpdate;
  }

  /*
   * Settles one project's defaults by the rule (Types/CallAndSMS/
   * TwilioConfigDefaults): reads every config of the project as it stands
   * now that a write has been saved, and writes the flags the rule changes,
   * the configs that give something up first. Written as root - the caller
   * may not be able to read every config - and through the normal update
   * path, so each config's workflows, live updates and audit log run as for
   * any other change.
   *
   * Held to the project's lock while it reads and writes, so two writes
   * settled at once do not both read the configs before either has written
   * them and leave two configs the default for SMS. Without Valkey it
   * settles unlocked, as a project's default always was.
   *
   * Returns what each of the project's configs is the default for, once
   * settled.
   */
  private async settleProjectDefaults(data: {
    projectId: ObjectID;
    madeDefaultIds: Array<ObjectID>;
  }): Promise<Map<string, TwilioConfigDefaultFlags>> {
    let mutex: SemaphoreMutex | null = null;

    try {
      mutex = await Semaphore.lock({
        key: data.projectId.toString(),
        namespace: "ProjectCallSMSConfigService.settleProjectDefaults",
        lockTimeout: 15000,
        acquireTimeout: 15000,
        retryInterval: 100,
      });
    } catch (err) {
      logger.debug(
        "Settling the project's default Twilio configs without the project's lock (could not take it) for projectId: " +
          data.projectId.toString(),
      );
      logger.debug(err);
    }

    try {
      const configs: Array<Model> = await this.findBy({
        query: {
          projectId: data.projectId,
        },
        select: PROJECT_DEFAULTS_RULE_SELECT,
        sort: {
          createdAt: SortOrder.Ascending,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      const rows: Array<ProjectTwilioConfigDefaultRow> = [];

      for (const config of configs) {
        if (!config.id) {
          continue;
        }

        rows.push({
          id: config.id.toString(),
          use: config.usedFor,
          isProjectDefault: config.isProjectDefault,
          isProjectDefaultForSms: config.isProjectDefaultForSms,
          isProjectDefaultForCalls: config.isProjectDefaultForCalls,
        });
      }

      const madeDefaultIds: Array<string> = data.madeDefaultIds.map(
        (id: ObjectID): string => {
          return id.toString();
        },
      );

      const changes: Array<TwilioConfigDefaultChange> =
        TwilioConfigDefaults.getProjectDefaultChanges({
          configs: rows,
          madeDefaultIds: madeDefaultIds,
        });

      for (const change of changes) {
        await this.updateOneById({
          id: new ObjectID(change.id),
          data: {
            isProjectDefault: change.flags.isProjectDefault,
            isProjectDefaultForSms: change.flags.isProjectDefaultForSms,
            isProjectDefaultForCalls: change.flags.isProjectDefaultForCalls,
          },
          props: {
            isRoot: true,
          },
        });
      }

      return TwilioConfigDefaults.getProjectDefaults({
        configs: rows,
        madeDefaultIds: madeDefaultIds,
      });
    } finally {
      if (mutex) {
        try {
          await Semaphore.release(mutex);
        } catch (err) {
          logger.error(err);
        }
      }
    }
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
        projectId: true,
        isProjectDefault: true,
      },
    );

    /*
     * The projects that lose a default with these configs: once they are
     * gone, what they were the default for goes to another default used for
     * it, or to nobody (onDeleteSuccess).
     */
    const carryForward: DeleteCarryForward = {
      projectIdsLosingADefault: [],
    };

    for (const config of configs) {
      if (config.isProjectDefault !== true || !config.projectId) {
        continue;
      }

      const projectId: ObjectID = config.projectId;

      if (
        !carryForward.projectIdsLosingADefault.some(
          (losing: ObjectID): boolean => {
            return losing.toString() === projectId.toString();
          },
        )
      ) {
        carryForward.projectIdsLosingADefault.push(projectId);
      }
    }

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

    return { deleteBy, carryForward: carryForward };
  }

  /*
   * Once a project's default is deleted, what it was the default for goes
   * to another of the project's defaults that is used for it - the config
   * that is the default for calls takes the SMS back, when it is used for
   * calls and SMS - or to nobody.
   */
  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    _itemIdsBeforeDelete: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    const carryForward: DeleteCarryForward | null | undefined =
      onDelete.carryForward as DeleteCarryForward | null | undefined;

    for (const projectId of carryForward?.projectIdsLosingADefault || []) {
      await this.settleProjectDefaults({
        projectId: projectId,
        madeDefaultIds: [],
      });
    }

    return onDelete;
  }

  /*
   * The project's default Twilio config for one kind of message, as the
   * senders take it: the config that is the project default for SMS, for
   * an SMS - and for calls, for a call (Types/CallAndSMS/
   * TwilioConfigDefaults).
   *
   * When no config is the default for that kind but one is the default for
   * the other, that one: it is not used for this kind (a default used for
   * it would be its default too), so it cannot send it
   * (TwilioPhoneNumbers.canSend), and the message goes as a project
   * without a config sends it - through the OneUptime server's own account,
   * paid for from the project's balance - with a note that says what the
   * project's config is used for (getNoTwilioAccountMessage).
   *
   * Undefined when the project has no default, or its default lacks its
   * account or numbers: the message goes through the server's own account.
   */
  @CaptureSpan()
  public async getProjectDefaultTwilioConfig(
    projectId: ObjectID | undefined,
    kind: TwilioMessageKind,
  ): Promise<TwilioConfig | undefined> {
    if (!projectId) {
      return undefined;
    }

    const config: Model | null =
      (await this.findProjectDefault({
        projectId: projectId,
        defaultColumn: TwilioConfigDefaults.getDefaultColumn(kind),
      })) ||
      (await this.findProjectDefault({
        projectId: projectId,
        defaultColumn: "isProjectDefault",
      }));

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

  // The project's first config (by when it was made) that is a default of this kind.
  private async findProjectDefault(data: {
    projectId: ObjectID;
    defaultColumn: "isProjectDefault" | TwilioConfigDefaultColumn;
  }): Promise<Model | null> {
    return await this.findOneBy({
      query: {
        projectId: data.projectId,
        [data.defaultColumn]: true,
      },
      select: PROJECT_DEFAULT_TWILIO_CONFIG_SELECT,
      sort: {
        createdAt: SortOrder.Ascending,
      },
      props: {
        isRoot: true,
      },
    });
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
