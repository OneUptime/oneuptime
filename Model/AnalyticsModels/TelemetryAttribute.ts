import AnalyticsBaseModel from "Common/AnalyticsModels/BaseModel";
import Route from "Common/Types/API/Route";
import AnalyticsTableEngine from "Common/Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "Common/Types/AnalyticsDatabase/TableColumnType";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";

export default class TelemetryAttribute extends AnalyticsBaseModel {
  public constructor() {
    super({
      tableName: "TelemetryAttribute",
      tableEngine: AnalyticsTableEngine.MergeTree,
      singularName: "Telemetry Attribute",
      pluralName: "Telemetry Attributes",
      crudApiPath: new Route("/telemetry-attribute"),
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.ReadTelemetryServiceLog,
          Permission.ReadTelemetryServiceTraces,
          Permission.ReadTelemetryService,
          Permission.ReadTelemetryServiceMetrics,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateTelemetryServiceLog,
          Permission.CreateTelemetryServiceLog,
          Permission.CreateTelemetryServiceTraces,
          Permission.CreateTelemetryService,
          Permission.CreateTelemetryServiceMetrics,
        ],
        update: [],
        delete: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.DeleteTelemetryAttributes,
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
              Permission.ReadTelemetryServiceLog,
              Permission.ReadTelemetryServiceTraces,
              Permission.ReadTelemetryService,
              Permission.ReadTelemetryServiceMetrics,
            ],
            create: [
              Permission.ProjectOwner,
              Permission.ProjectAdmin,
              Permission.ProjectMember,
              Permission.CreateTelemetryServiceLog,
              Permission.CreateTelemetryServiceLog,
              Permission.CreateTelemetryServiceTraces,
              Permission.CreateTelemetryService,
              Permission.CreateTelemetryServiceMetrics,
            ],
            update: [],
          },
        }),

        new AnalyticsTableColumn({
          key: "name",
          title: "Attribute Name",
          description: "Attribute Name",
          required: true,
          type: TableColumnType.Text,
          isTenantId: false,
          accessControl: {
            read: [
              Permission.ProjectOwner,
              Permission.ProjectAdmin,
              Permission.ProjectMember,
              Permission.ReadTelemetryServiceLog,
              Permission.ReadTelemetryServiceTraces,
              Permission.ReadTelemetryService,
              Permission.ReadTelemetryServiceMetrics,
            ],
            create: [
              Permission.ProjectOwner,
              Permission.ProjectAdmin,
              Permission.ProjectMember,
              Permission.CreateTelemetryServiceLog,
              Permission.CreateTelemetryServiceLog,
              Permission.CreateTelemetryServiceTraces,
              Permission.CreateTelemetryService,
              Permission.CreateTelemetryServiceMetrics,
            ],
            update: [],
          },
        }),
      ],
      primaryKeys: ["projectId", "name"],
    });
  }

  public get projectId(): ObjectID | undefined {
    return this.getColumnValue("projectId") as ObjectID | undefined;
  }

  public set projectId(v: ObjectID | undefined) {
    this.setColumnValue("projectId", v);
  }
}
