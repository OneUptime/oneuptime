import BaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import LogDropFilter from "../../Models/DatabaseModels/LogDropFilter";
import TraceDropFilter from "../../Models/DatabaseModels/TraceDropFilter";
import WriteWarnings, {
  WRITE_WARNING_HEADER,
} from "../../Types/API/WriteWarnings";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import {
  describeDropFilterImpact,
  DropFilterImpact,
  DropFilterImpactRequest,
} from "../../Types/Telemetry/DropFilterImpact";
import { TelemetryFieldSignal } from "../../Types/Telemetry/TelemetryFieldReaders";
import UserType from "../../Types/UserType";
import DatabaseService from "../Services/DatabaseService";
import { ExpressRequest, ExpressResponse } from "../Utils/Express";
import logger from "../Utils/Logger";
import {
  findDropFilterImpact,
  readDropFilterImpactRequest,
} from "../Utils/Telemetry/DropFilterImpact";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";

/*
 * A DROP FILTER WRITTEN THROUGH THE API SAYS WHAT IT TAKES (#10436).
 *
 * The form says, before a filter is saved or turned on, what it would take
 * from Security Events, monitors, dashboards, recording rules and SLOs, and
 * asks to confirm when something reads it. A write through the API with an
 * API key - a script, Terraform, a pipeline - is not asked: nobody is there
 * to answer, a refusal would break them, and a caller would learn to send
 * "confirmed" and nothing more. It is told instead: when the filter it
 * leaves enabled takes something others read, the answer says so in an
 * X-OneUptime-Write-Warning header (WriteWarnings), which the Terraform
 * provider shows as a warning. The same answer, in full, is
 * POST /api/telemetry/{logs,traces}/drop-filter-impact, to ask before a
 * write.
 *
 * Only for an API key: the Dashboard's forms show the impact themselves.
 * Worked out before the write, from the filter as the write leaves it, and
 * taken off the answer if the write is refused. Never fails a write.
 */
export default class DropFilterAPI<
  TBaseModel extends LogDropFilter | TraceDropFilter,
  TBaseService extends DatabaseService<BaseModel>,
> extends BaseAPI<TBaseModel, TBaseService> {
  private signal: TelemetryFieldSignal;

  public constructor(
    type: { new (): TBaseModel },
    service: TBaseService,
    signal: TelemetryFieldSignal,
  ) {
    super(type, service);
    this.signal = signal;
  }

  public override async createItem(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    await this.warnOfImpact(req, res, async (): Promise<JSONObject | null> => {
      return this.readBodyData(req);
    });

    await this.writeKeepingWarningOnlyIfWritten(res, async () => {
      await super.createItem(req, res);
    });
  }

  public override async updateItem(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    await this.warnOfImpact(
      req,
      res,
      async (
        props: DatabaseCommonInteractionProps,
      ): Promise<JSONObject | null> => {
        return await this.readUpdatedRow(req, props);
      },
    );

    await this.writeKeepingWarningOnlyIfWritten(res, async () => {
      await super.updateItem(req, res);
    });
  }

  private async writeKeepingWarningOnlyIfWritten(
    res: ExpressResponse,
    write: () => Promise<void>,
  ): Promise<void> {
    try {
      await write();
    } catch (error) {
      if (!res.headersSent) {
        res.removeHeader(WRITE_WARNING_HEADER);
      }

      throw error;
    }
  }

  private readBodyData(req: ExpressRequest): JSONObject | null {
    const data: unknown = (req.body as JSONObject | undefined)?.["data"];

    return data && typeof data === "object" && !Array.isArray(data)
      ? (data as JSONObject)
      : null;
  }

  /*
   * The filter as an update leaves it: the stored row, as the caller may
   * read it, with the update's fields over it. Null when there is no such
   * row for them, or the update touches nothing that changes what it takes.
   */
  private async readUpdatedRow(
    req: ExpressRequest,
    props: DatabaseCommonInteractionProps,
  ): Promise<JSONObject | null> {
    const data: JSONObject | null = this.readBodyData(req);
    const id: unknown = req.params["id"];

    if (
      !data ||
      typeof id !== "string" ||
      !ObjectID.isValidUUID(id) ||
      !["filterQuery", "action", "samplePercentage", "isEnabled"].some(
        (key: string): boolean => {
          return data[key] !== undefined;
        },
      )
    ) {
      return null;
    }

    const stored: LogDropFilter | TraceDropFilter | null =
      (await this.service.findOneById({
        id: new ObjectID(id),
        select: {
          name: true,
          filterQuery: true,
          action: true,
          samplePercentage: true,
          isEnabled: true,
        } as never,
        props,
      })) as LogDropFilter | TraceDropFilter | null;

    if (!stored) {
      return null;
    }

    return {
      name: stored.name || "",
      filterQuery: (stored.filterQuery as string) || "",
      action: stored.action || "",
      samplePercentage: stored.samplePercentage ?? null,
      isEnabled: stored.isEnabled !== false,
      ...data,
    } as JSONObject;
  }

  private async warnOfImpact(
    req: ExpressRequest,
    res: ExpressResponse,
    readFilter: (
      props: DatabaseCommonInteractionProps,
    ) => Promise<JSONObject | null>,
  ): Promise<void> {
    try {
      const props: DatabaseCommonInteractionProps =
        await CommonAPI.getDatabaseCommonInteractionProps(req);

      if (props.userType !== UserType.API || !props.tenantId) {
        return;
      }

      const filter: JSONObject | null = await readFilter(props);

      // A filter left off takes nothing; turning it on later is a write too.
      if (!filter || filter["isEnabled"] === false) {
        return;
      }

      let request: DropFilterImpactRequest;

      try {
        request = readDropFilterImpactRequest(filter, this.signal);
      } catch {
        // The write is refused for it, in the save's own words.
        return;
      }

      const impact: DropFilterImpact = await findDropFilterImpact({
        projectId: props.tenantId,
        request,
        props,
      });
      const warning: string | null = describeDropFilterImpact(impact);

      if (warning) {
        res.setHeader(
          WRITE_WARNING_HEADER,
          WriteWarnings.toHeaderValue(warning),
        );
      }
    } catch (error) {
      logger.warn(
        `Drop filter API: could not say what a ${this.signal} drop filter written through the API takes:`,
      );
      logger.warn(error);
    }
  }
}
