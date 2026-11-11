import ProjectReferencesService from "./ProjectReferencesService";
import MonitorService from "./MonitorService";
import Model from "../../Models/DatabaseModels/DataBiConnection";
import CreateBy from "../Types/Database/CreateBy";
import DeleteBy from "../Types/Database/DeleteBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnDelete, OnUpdate } from "../Types/Database/Hooks";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger from "../Utils/Logger";
import ObjectID from "../../Types/ObjectID";
import {
  isDataBiTool,
  needsBaseUrl,
} from "../../Types/DataObservability/DataBiTool";
import BadDataException from "../../Types/Exception/BadDataException";

/*
 * The BI tools Data Observability reads dashboards from. A tool is checked
 * as it is saved: a tool OneUptime reads, an address for every tool but
 * Power BI, and credentials that are JSON. Its dashboards are read by
 * DataBiSync, and go with it when it is deleted - and so does the monitor
 * that alerts on its failed refreshes (DataBiRefreshAlerts).
 */

interface DeletedTools {
  tools: Array<Model>;
}

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    const tool: unknown = createBy.data.tool;

    if (!isDataBiTool(tool)) {
      throw new BadDataException(
        "Pick the BI tool: Metabase, Superset, Tableau, Looker or Power BI.",
      );
    }

    if (needsBaseUrl(tool) && !Service.readBaseUrl(createBy.data.baseUrl)) {
      throw new BadDataException(
        `${tool} needs its address, such as https://bi.acme.com.`,
      );
    }

    const baseUrl: string | null = Service.readBaseUrl(createBy.data.baseUrl);

    if (baseUrl) {
      createBy.data.baseUrl = baseUrl;
    }
    Service.checkCredentials(createBy.data.credentials);

    return { createBy, carryForward: undefined };
  }

  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    const data: { baseUrl?: unknown; credentials?: unknown } =
      updateBy.data as unknown as { baseUrl?: unknown; credentials?: unknown };

    if (data.baseUrl !== undefined && data.baseUrl !== null) {
      const baseUrl: string | null = Service.readBaseUrl(data.baseUrl);

      if (!baseUrl) {
        throw new BadDataException(
          "The address must be an https:// or http:// URL.",
        );
      }

      data.baseUrl = baseUrl;
    }

    if (data.credentials !== undefined && data.credentials !== null) {
      Service.checkCredentials(data.credentials);
    }

    return { updateBy, carryForward: undefined };
  }

  protected override async onBeforeDelete(
    deleteBy: DeleteBy<Model>,
  ): Promise<OnDelete<Model>> {
    const tools: Array<Model> = await this.findRowsAndHoldDeleteToThem(
      deleteBy,
      { _id: true, projectId: true, refreshMonitorId: true },
    );
    const carryForward: DeletedTools = { tools };

    return { deleteBy, carryForward };
  }

  // A deleted tool's monitor on failed refreshes goes with it: nobody's is left over.
  @CaptureSpan()
  protected override async onDeleteSuccess(
    onDelete: OnDelete<Model>,
    deletedIds: Array<ObjectID>,
  ): Promise<OnDelete<Model>> {
    const carried: DeletedTools | undefined = onDelete.carryForward as
      | DeletedTools
      | undefined;

    if (!carried) {
      return onDelete;
    }

    for (const tool of Service.getRowsDeleted<Model>({
      rows: carried.tools,
      deletedIds,
    })) {
      if (!tool.refreshMonitorId) {
        continue;
      }

      try {
        await MonitorService.deleteBy({
          query: { _id: tool.refreshMonitorId, projectId: tool.projectId! },
          limit: 1,
          skip: 0,
          props: { isRoot: true },
        });
      } catch (error) {
        logger.error(
          `Data Observability: could not delete the monitor on failed refreshes of BI tool ${tool.id?.toString()}`,
        );
        logger.error(error);
      }
    }

    return onDelete;
  }

  // An address as the connectors call it: http(s), with no trailing slash.
  public static readBaseUrl(value: unknown): string | null {
    if (typeof value !== "string" || !value.trim()) {
      return null;
    }

    try {
      const url: URL = new URL(value.trim());

      if (url.protocol !== "https:" && url.protocol !== "http:") {
        return null;
      }

      return `${url.origin}${url.pathname.replace(/\/+$/, "")}`;
    } catch {
      return null;
    }
  }

  public static checkCredentials(value: unknown): void {
    if (value === undefined || value === null || value === "") {
      return;
    }

    let parsed: unknown = null;

    try {
      parsed = typeof value === "string" ? JSON.parse(value) : value;
    } catch {
      parsed = null;
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new BadDataException(
        'The credentials must be a JSON object, such as { "apiKey": "..." }.',
      );
    }
  }
}

export default new Service();
