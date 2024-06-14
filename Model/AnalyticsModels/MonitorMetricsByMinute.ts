import AnalyticsBaseModel from "Common/AnalyticsModels/BaseModel";
import Route from "Common/Types/API/Route";
import AnalyticsTableEngine from "Common/Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableColumn from "Common/Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "Common/Types/AnalyticsDatabase/TableColumnType";
import BrowserType from "Common/Types/BrowserType";
import { JSONObject } from "Common/Types/JSON";
import { CheckOn } from "Common/Types/Monitor/CriteriaFilter";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import ScreenSizeType from "Common/Types/ScreenSizeType";

export interface MonitorMetricsMiscData {
  diskPath?: string;
  probeId?: string;
  browserType?: BrowserType;
  screenSizeType?: ScreenSizeType;
}

export default class MonitorMetricsByMinute extends AnalyticsBaseModel {
  public constructor() {
    super({
      tableName: "MonitorMetricsByMinute",
      tableEngine: AnalyticsTableEngine.MergeTree,
      singularName: "Monitor Metrics By Minute",
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.ReadProjectMonitor,
        ],
        create: [],
        update: [],
        delete: [],
      },
      pluralName: "Monitor Metrics By Minutes",
      crudApiPath: new Route("/monitor-metrics-by-minute"),
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
              Permission.ReadProjectMonitor,
            ],
            create: [],
            update: [],
          },
        }),

        new AnalyticsTableColumn({
          key: "monitorId",
          title: "Monitor ID",
          description: "ID of the Monitor which this metric belongs to",
          required: true,
          type: TableColumnType.ObjectID,
          accessControl: {
            read: [
              Permission.ProjectOwner,
              Permission.ProjectAdmin,
              Permission.ProjectMember,
              Permission.ReadProjectMonitor,
            ],
            create: [],
            update: [],
          },
        }),

        new AnalyticsTableColumn({
          key: "metricType",
          title: "Metric Type",
          description: "Type of metric",
          required: true,
          type: TableColumnType.Text,
          accessControl: {
            read: [
              Permission.ProjectOwner,
              Permission.ProjectAdmin,
              Permission.ProjectMember,
              Permission.ReadProjectMonitor,
            ],
            create: [],
            update: [],
          },
        }),

        new AnalyticsTableColumn({
          key: "metricValue",
          title: "Metric Value",
          description: "Value of the metric",
          required: true,
          type: TableColumnType.Number,
          accessControl: {
            read: [
              Permission.ProjectOwner,
              Permission.ProjectAdmin,
              Permission.ProjectMember,
              Permission.ReadProjectMonitor,
            ],
            create: [],
            update: [],
          },
        }),

        new AnalyticsTableColumn({
          key: "miscData",
          title: "Misc Data",
          description: "Misc data for the metric (if any)",
          required: false,
          type: TableColumnType.JSON,
          accessControl: {
            read: [
              Permission.ProjectOwner,
              Permission.ProjectAdmin,
              Permission.ProjectMember,
              Permission.ReadProjectMonitor,
            ],
            create: [],
            update: [],
          },
        }),
      ],
      primaryKeys: ["projectId", "monitorId", "createdAt"],
    });
  }

  public get projectId(): ObjectID | undefined {
    return this.getColumnValue("projectId") as ObjectID | undefined;
  }

  public set projectId(v: ObjectID | undefined) {
    this.setColumnValue("projectId", v);
  }

  public get monitorId(): ObjectID | undefined {
    return this.getColumnValue("monitorId") as ObjectID | undefined;
  }

  public set monitorId(v: ObjectID | undefined) {
    this.setColumnValue("monitorId", v);
  }

  public get metricType(): CheckOn | undefined {
    return this.getColumnValue("metricType") as CheckOn | undefined;
  }

  public set metricType(v: CheckOn | undefined) {
    this.setColumnValue("metricType", v);
  }

  public get metricValue(): number | undefined {
    return this.getColumnValue("metricValue") as number | undefined;
  }

  public set metricValue(v: number | undefined) {
    this.setColumnValue("metricValue", v);
  }

  public get miscData(): MonitorMetricsMiscData | undefined {
    return this.getColumnValue("miscData") as
      | MonitorMetricsMiscData
      | undefined;
  }

  public set miscData(v: MonitorMetricsMiscData | undefined) {
    this.setColumnValue("miscData", v as JSONObject);
  }
}
