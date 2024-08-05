import AnalyticsBaseModel from "../BaseModels/AnalyticsBaseModel/BaseModel";
import Route from "../../Types/API/Route";
import AnalyticsTableEngine from "../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableColumn from "../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import BrowserType from "../../Types/BrowserType";
import { JSONObject } from "../../Types/JSON";
import { CheckOn } from "../../Types/Monitor/CriteriaFilter";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";
import ScreenSizeType from "../../Types/ScreenSizeType";

export interface MonitorMetricsMiscData {
  diskPath?: string;
  probeId?: string;
  browserType?: BrowserType;
  screenSizeType?: ScreenSizeType;
}

export default class MonitorMetricsByMinute extends AnalyticsBaseModel {
  public constructor() {
    super({
      tableName: "MonitorMetrics",
      tableEngine: AnalyticsTableEngine.MergeTree,
      singularName: "Monitor Metric",
      pluralName: "Monitor Metrics",
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
      crudApiPath: new Route("/monitor-metrics"),
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
      sortKeys: ["projectId", "monitorId", "createdAt"],
      primaryKeys: ["projectId", "monitorId"],
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
