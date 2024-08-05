import AnalyticsBaseModel from "../../AnalyticsModels/BaseModel";
import Route from "../../Types/API/Route";
import AnalyticsTableEngine from "../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableColumn from "../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import TelemetryType from "../../Types/Telemetry/TelemetryType";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";

export default class TelemetryAttribute extends AnalyticsBaseModel {
  public constructor() {
    super({
      tableName: "TelemetryAttribute",
      tableEngine: AnalyticsTableEngine.MergeTree,
      singularName: "Telemetry Attribute",
      pluralName: "Telemetry Attributes",
      crudApiPath: new Route("/telemetry-attributes"),
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.ReadTelemetryServiceTraces,
          Permission.ReadTelemetryServiceLog,
          Permission.ReadTelemetryServiceMetrics,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryServiceTraces,
          Permission.CreateTelemetryServiceLog,
          Permission.CreateTelemetryServiceMetrics,
        ],
        update: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.EditTelemetryServiceTraces,
          Permission.EditTelemetryServiceLog,
          Permission.EditTelemetryServiceMetrics,
        ],
        delete: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.DeleteTelemetryServiceTraces,
          Permission.DeleteTelemetryServiceLog,
          Permission.DeleteTelemetryServiceMetrics,
        ],
      },
      tableColumns: [
        new AnalyticsTableColumn({
          key: "projectId",
          title: "Project ID",
          description: "ID of project",
          required: true,
          type: TableColumnType.ObjectID,
          isTenantId: true,
          accessControl: {
            read: [
              Permission.ProjectOwner,
              Permission.ProjectAdmin,
              Permission.ProjectMember,
              Permission.ReadTelemetryServiceTraces,
              Permission.ReadTelemetryServiceLog,
              Permission.ReadTelemetryServiceMetrics,
            ],
            create: [
              Permission.ProjectOwner,
              Permission.ProjectAdmin,
              Permission.ProjectMember,
              Permission.EditTelemetryServiceTraces,
              Permission.EditTelemetryServiceLog,
              Permission.EditTelemetryServiceMetrics,
            ],
            update: [],
          },
        }),

        new AnalyticsTableColumn({
          key: "telemetryType",
          title: "Telemetry Type",
          description: "Type of telemetry",
          required: true,
          type: TableColumnType.Text,
          accessControl: {
            read: [
              Permission.ProjectOwner,
              Permission.ProjectAdmin,
              Permission.ProjectMember,
              Permission.ReadTelemetryServiceTraces,
              Permission.ReadTelemetryServiceLog,
              Permission.ReadTelemetryServiceMetrics,
            ],
            create: [
              Permission.ProjectOwner,
              Permission.ProjectAdmin,
              Permission.ProjectMember,
              Permission.EditTelemetryServiceTraces,
              Permission.EditTelemetryServiceLog,
              Permission.EditTelemetryServiceMetrics,
            ],
            update: [],
          },
        }),

        new AnalyticsTableColumn({
          key: "attribute",
          title: "Attribute",
          description: "Attribute",
          required: true,
          type: TableColumnType.Text,
          accessControl: {
            read: [
              Permission.ProjectOwner,
              Permission.ProjectAdmin,
              Permission.ProjectMember,
              Permission.ReadTelemetryServiceTraces,
              Permission.ReadTelemetryServiceLog,
              Permission.ReadTelemetryServiceMetrics,
            ],
            create: [
              Permission.ProjectOwner,
              Permission.ProjectAdmin,
              Permission.ProjectMember,
              Permission.EditTelemetryServiceTraces,
              Permission.EditTelemetryServiceLog,
              Permission.EditTelemetryServiceMetrics,
            ],
            update: [],
          },
        }),
      ],
      sortKeys: ["projectId", "telemetryType"],
      primaryKeys: ["projectId", "telemetryType"],
    });
  }

  public get projectId(): ObjectID | undefined {
    return this.getColumnValue("projectId") as ObjectID | undefined;
  }

  public set projectId(v: ObjectID | undefined) {
    this.setColumnValue("projectId", v);
  }

  public get telemetryType(): TelemetryType | undefined {
    return this.getColumnValue("telemetryType") as TelemetryType | undefined;
  }

  public set telemetryType(v: TelemetryType | undefined) {
    this.setColumnValue("telemetryType", v);
  }

  public get attribute(): string | undefined {
    return this.getColumnValue("attribute") as string | undefined;
  }

  public set attribute(v: string | undefined) {
    this.setColumnValue("attribute", v);
  }
}
