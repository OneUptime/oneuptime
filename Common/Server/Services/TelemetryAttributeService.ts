import TelemetryType from "../../Types/Telemetry/TelemetryType";
import ClickhouseDatabase from "../Infrastructure/ClickhouseDatabase";
import AnalyticsDatabaseService from "./AnalyticsDatabaseService";
import TelemetryAttribute from "Common/Models/AnalyticsModels/TelemetryAttribute";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import ObjectID from "../../Types/ObjectID";

export class TelemetryAttributeService extends AnalyticsDatabaseService<TelemetryAttribute> {
  public constructor(clickhouseDatabase?: ClickhouseDatabase | undefined) {
    super({ modelType: TelemetryAttribute, database: clickhouseDatabase });
  }

  public async fetchAttributes(data: {
    projectId: ObjectID;
    telemetryType: TelemetryType;
  }): Promise<string[]> {
    const attributes: TelemetryAttribute[] = await this.findBy({
      query: {
        projectId: data.projectId,
        telemetryType: data.telemetryType,
      },
      select: {
        attribute: true,
      },
      limit: LIMIT_PER_PROJECT,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const dbAttributes: string[] = attributes
      .map((attribute: TelemetryAttribute) => {
        return attribute.attribute;
      })
      .filter((attribute: string | undefined) => {
        return Boolean(attribute);
      }) as string[];

    return dbAttributes.sort();
  }

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

    const telemetryAttributes: TelemetryAttribute[] = [];

    // insert new attributes
    for (const attribute of attributes) {
      const telemetryAttribute: TelemetryAttribute = new TelemetryAttribute();

      telemetryAttribute.projectId = projectId;
      telemetryAttribute.telemetryType = telemetryType;
      telemetryAttribute.attribute = attribute;

      telemetryAttributes.push(telemetryAttribute);
    }

    await this.createMany({
      items: telemetryAttributes,
      props: {
        isRoot: true,
      },
    });
  }
}

export default new TelemetryAttributeService();
