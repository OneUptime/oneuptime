import DatabaseService from "./DatabaseService";
import TwilioConfig from "../../Types/CallAndSMS/TwilioConfig";
import BadDataException from "../../Types/Exception/BadDataException";
import Model from "../../Models/DatabaseModels/ProjectCallSMSConfig";
import Phone from "../../Types/Phone";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import ObjectID from "../../Types/ObjectID";
import QueryHelper from "../Types/Database/QueryHelper";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

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
