import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/ThreatIntelFeed";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import BadDataException from "../../Types/Exception/BadDataException";
import {
  THREAT_INTEL_MINIMUM_CONFIDENCE_MAX,
  THREAT_INTEL_MINIMUM_CONFIDENCE_MIN,
} from "../../Types/SecurityEvent/ThreatIntelConstants";
import TaxiiClient from "../Utils/SecurityEvent/ThreatIntel/TaxiiClient";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * Validate at save time so a feed that stores is a feed the poller can
   * use — a malformed URL or collection id surfaces to the person
   * configuring it, not as a cron-side lastError later. (The
   * GoogleSecOpsConnectionService discipline.)
   */
  private validateFeed(data: {
    apiRootUrl?: string | undefined;
    collectionId?: string | undefined;
    pollIntervalInMinutes?: number | undefined;
    minimumConfidence?: number | undefined;
  }): void {
    if (data.apiRootUrl !== undefined) {
      TaxiiClient.validateApiRootUrl(data.apiRootUrl);
    }

    if (data.collectionId !== undefined) {
      TaxiiClient.validateCollectionId(data.collectionId);
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

    if (data.minimumConfidence !== undefined) {
      if (
        !Number.isInteger(data.minimumConfidence) ||
        data.minimumConfidence < THREAT_INTEL_MINIMUM_CONFIDENCE_MIN ||
        data.minimumConfidence > THREAT_INTEL_MINIMUM_CONFIDENCE_MAX
      ) {
        throw new BadDataException(
          `Minimum confidence must be a whole number between ${THREAT_INTEL_MINIMUM_CONFIDENCE_MIN} and ${THREAT_INTEL_MINIMUM_CONFIDENCE_MAX}.`,
        );
      }
    }
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (!createBy.data.apiRootUrl) {
      throw new BadDataException("TAXII API root URL is required.");
    }

    if (!createBy.data.collectionId) {
      throw new BadDataException("Collection ID is required.");
    }

    if (createBy.data.apiToken && createBy.data.basicAuthPassword) {
      throw new BadDataException(
        "Configure either an API token or basic-auth credentials, not both.",
      );
    }

    this.validateFeed({
      apiRootUrl: createBy.data.apiRootUrl,
      collectionId: createBy.data.collectionId,
      pollIntervalInMinutes: createBy.data.pollIntervalInMinutes,
      minimumConfidence: createBy.data.minimumConfidence,
    });

    return { createBy, carryForward: null };
  }

  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    this.validateFeed({
      apiRootUrl: updateBy.data.apiRootUrl as string | undefined,
      collectionId: updateBy.data.collectionId as string | undefined,
      pollIntervalInMinutes: updateBy.data.pollIntervalInMinutes as
        | number
        | undefined,
      minimumConfidence: updateBy.data.minimumConfidence as number | undefined,
    });

    return { updateBy, carryForward: null };
  }
}

export default new Service();
