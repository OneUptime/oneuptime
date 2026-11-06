import ProjectReferencesService from "./ProjectReferencesService";
import Model from "../../Models/DatabaseModels/DataBiConnection";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import {
  isDataBiTool,
  needsBaseUrl,
} from "../../Types/DataObservability/DataBiTool";
import BadDataException from "../../Types/Exception/BadDataException";

/*
 * The BI tools Data Observability reads dashboards from. A tool is checked
 * as it is saved: a tool OneUptime reads, an address for every tool but
 * Power BI, and credentials that are JSON. Its dashboards are read by
 * DataBiSync, and go with it when it is deleted.
 */
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
