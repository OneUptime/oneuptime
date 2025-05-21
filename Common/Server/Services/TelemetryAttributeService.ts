import TelemetryType from "../../Types/Telemetry/TelemetryType";
import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import AnalyticsDatabaseService from "./AnalyticsDatabaseService";
import TelemetryAttribute from "../../Models/AnalyticsModels/TelemetryAttribute";
import ObjectID from "../../Types/ObjectID";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class TelemetryAttributeService extends AnalyticsDatabaseService<TelemetryAttribute> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({ modelType: TelemetryAttribute, database: clickhouseDatabase });
  }

  @CaptureSpan()
  public async fetchAttributes(data: {
    projectId: ObjectID;
    telemetryType: TelemetryType;
  }): Promise<string[]> {
    const telemetryAttribute: TelemetryAttribute | null = await this.findOneBy({
      query: {
        projectId: data.projectId,
        telemetryType: data.telemetryType,
      },
      select: {
        attributes: true,
      },
      props: {
        isRoot: true,
      },
    });

    return telemetryAttribute &&
      telemetryAttribute.attributes &&
      telemetryAttribute
      ? telemetryAttribute.attributes
      : [];
  }

  @CaptureSpan()
  public async refreshAttributes(data: {
    projectId: ObjectID;
    telemetryType: TelemetryType;
    attributes: string[];
  }): Promise<void> {
    const { projectId, telemetryType, attributes } = data;

    // delete existing attributes
    await this.deleteBy({
      query: {
        projectId,
        telemetryType,
      },
      props: {
        isRoot: true,
      },
    });

    const telemetryAttribute: TelemetryAttribute = new TelemetryAttribute();

    telemetryAttribute.projectId = projectId;
    telemetryAttribute.telemetryType = telemetryType;
    telemetryAttribute.attributes = attributes;

    await this.create({
      data: telemetryAttribute,
      props: {
        isRoot: true,
      },
    });
  }
}

export default new TelemetryAttributeService();
