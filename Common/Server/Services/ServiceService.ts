import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
import DatabaseService from "./DatabaseService";
import ProjectService from "./ProjectService";
import ArrayUtil from "../../Utils/Array";
import { BrightColors } from "../../Types/BrandColors";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import Model from "../../Models/DatabaseModels/Service";
import Project from "../../Models/DatabaseModels/Project";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

const DEFAULT_TELEMETRY_RETENTION_IN_DAYS: number = 15;

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    // select a random color.
    createBy.data.serviceColor = ArrayUtil.selectItemByRandom(BrightColors);

    return {
      carryForward: null,
      createBy: createBy,
    };
  }

  @CaptureSpan()
  public async getTelemetryDataRetentionInDays(
    serviceId: ObjectID,
  ): Promise<number> {
    const service: Model | null = await this.findOneById({
      id: serviceId,
      select: {
        projectId: true,
        retainTelemetryDataForDays: true,
      },
      props: {
        isRoot: true,
      },
    });

    if (!service) {
      throw new BadDataException("Service not found");
    }

    if (service.retainTelemetryDataForDays) {
      return service.retainTelemetryDataForDays;
    }

    // Fall back to project-level default.
    if (service.projectId) {
      const project: Project | null = await ProjectService.findOneById({
        id: service.projectId,
        select: {
          defaultTelemetryRetentionInDays: true,
        },
        props: {
          isRoot: true,
        },
      });

      if (project?.defaultTelemetryRetentionInDays) {
        return project.defaultTelemetryRetentionInDays;
      }
    }

    return DEFAULT_TELEMETRY_RETENTION_IN_DAYS;
  }
}

export default new Service();
