import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/GoogleSecOpsConnection";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import BadDataException from "../../Types/Exception/BadDataException";
import GoogleSecOpsClient from "../Utils/SecurityEvent/GoogleSecOps/GoogleSecOpsClient";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Validate at save time so a connection that stores is a connection the
   * poller can use — a malformed region or credential surfaces to the
   * person configuring it, not as a cron-side lastError later.
   */
  private validateConnection(data: {
    region?: string | undefined;
    instanceResourceName?: string | undefined;
    serviceAccountJson?: string | undefined;
    pollIntervalInMinutes?: number | undefined;
  }): void {
    if (data.region !== undefined) {
      GoogleSecOpsClient.validateRegion(data.region);
    }

    if (data.instanceResourceName !== undefined) {
      GoogleSecOpsClient.validateInstanceResourceName(
        data.instanceResourceName,
      );
    }

    if (data.serviceAccountJson !== undefined) {
      GoogleSecOpsClient.parseServiceAccountJson(data.serviceAccountJson);
    }

    if (data.pollIntervalInMinutes !== undefined) {
      if (
        !Number.isInteger(data.pollIntervalInMinutes) ||
        data.pollIntervalInMinutes < 1 ||
        data.pollIntervalInMinutes > 1440
      ) {
        throw new BadDataException(
          "Poll interval must be a whole number of minutes between 1 and 1440.",
        );
      }
    }
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (!createBy.data.serviceAccountJson) {
      throw new BadDataException("Service account JSON is required.");
    }

    this.validateConnection({
      region: createBy.data.region,
      instanceResourceName: createBy.data.instanceResourceName,
      serviceAccountJson: createBy.data.serviceAccountJson,
      pollIntervalInMinutes: createBy.data.pollIntervalInMinutes,
    });

    return { createBy, carryForward: null };
  }

  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    this.validateConnection({
      region: updateBy.data.region as string | undefined,
      instanceResourceName: updateBy.data.instanceResourceName as
        | string
        | undefined,
      serviceAccountJson: updateBy.data.serviceAccountJson as
        | string
        | undefined,
      pollIntervalInMinutes: updateBy.data.pollIntervalInMinutes as
        | number
        | undefined,
    });

    return { updateBy, carryForward: null };
  }
}

export default new Service();
