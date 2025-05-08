import AnalyticsBaseModel from "./AnalyticsBaseModel/AnalyticsBaseModel";
import Route from "../../Types/API/Route";
import AnalyticsTableEngine from "../../Types/AnalyticsDatabase/AnalyticsTableEngine";
import AnalyticsTableColumn from "../../Types/AnalyticsDatabase/TableColumn";
import TableColumnType from "../../Types/AnalyticsDatabase/TableColumnType";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import Permission from "../../Types/Permission";

export default class MonitorLog extends AnalyticsBaseModel {
  public constructor() {
    super({
      tableName: "MonitorLog",
      tableEngine: AnalyticsTableEngine.MergeTree,
      singularName: "Monitor Log",
      accessControl: {
        read: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.ReadProjectMonitor,
        ],
        create: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.CreateProjectMonitor,
        ],
        update: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.EditProjectMonitor,
        ],
        delete: [
          Permission.ProjectOwner,
          Permission.ProjectAdmin,
          Permission.ProjectMember,
          Permission.DeleteProjectMonitor,
        ],
      },
      pluralName: "Monitor Logs",
      crudApiPath: new Route("/monitor-log"),
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
            create: [
              Permission.ProjectOwner,
              Permission.ProjectAdmin,
              Permission.ProjectMember,
              Permission.CreateProjectMonitor,
            ],
            update: [],
          },
        }),

        new AnalyticsTableColumn({
          key: "monitorId",
          title: "Monitor ID",
          description: "ID of the monitor which this logs belongs to",
          required: true,
          type: TableColumnType.ObjectID,
          accessControl: {
            read: [
              Permission.ProjectOwner,
              Permission.ProjectAdmin,
              Permission.ProjectMember,
              Permission.ReadProjectMonitor,
            ],
            create: [
              Permission.ProjectOwner,
              Permission.ProjectAdmin,
              Permission.ProjectMember,
              Permission.CreateProjectMonitor,
            ],
            update: [],
          },
        }),

        new AnalyticsTableColumn({
          key: "time",
          title: "Time",
          description: "When was the log created?",
          required: true,
          type: TableColumnType.Date,
          accessControl: {
            read: [
              Permission.ProjectOwner,
              Permission.ProjectAdmin,
              Permission.ProjectMember,
              Permission.ReadProjectMonitor,
            ],
            create: [
              Permission.ProjectOwner,
              Permission.ProjectAdmin,
              Permission.ProjectMember,
              Permission.CreateProjectMonitor,
            ],
            update: [],
          },
        }),

        new AnalyticsTableColumn({
          key: "logBody",
          title: "Log Body",
          description: "The body of the log",
          required: true,
          defaultValue: {},
          type: TableColumnType.JSON,
          accessControl: {
            read: [
              Permission.ProjectOwner,
              Permission.ProjectAdmin,
              Permission.ProjectMember,
              Permission.ReadProjectMonitor,
            ],
            create: [
              Permission.ProjectOwner,
              Permission.ProjectAdmin,
              Permission.ProjectMember,
              Permission.CreateProjectMonitor,
            ],
            update: [],
          },
        }),
      ],
      sortKeys: ["projectId", "time", "monitorId"],
      primaryKeys: ["projectId", "time", "monitorId"],
      partitionKey: "sipHash64(projectId) % 16",
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

  public get time(): Date | undefined {
    return this.getColumnValue("time") as Date | undefined;
  }
  public set time(v: Date | undefined) {
    this.setColumnValue("time", v);
  }
  public get logBody(): JSONObject | undefined {
    return this.getColumnValue("logBody") as JSONObject | undefined;
  }
  public set logBody(v: JSONObject | undefined) {
    this.setColumnValue("logBody", v);
  }
}
