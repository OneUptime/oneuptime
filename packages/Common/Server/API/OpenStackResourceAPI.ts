import OpenStackResource from "../../Models/DatabaseModels/OpenStackResource";
import OpenStackCloud from "../../Models/DatabaseModels/OpenStackCloud";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import OpenStackResourceService, {
  OpenStackAttentionRows,
  OpenStackDomainSummary,
  OpenStackInventorySummary,
  OpenStackProjectOverview,
  OpenStackProjectSummary,
  OpenStackTopologyRead,
  Service as OpenStackResourceServiceType,
} from "../Services/OpenStackResourceService";
import OpenStackCloudService from "../Services/OpenStackCloudService";
import UserMiddleware from "../Middleware/UserAuthorization";
import Response from "../Utils/Response";
import BaseAPI from "./BaseAPI";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import CommonAPI from "./CommonAPI";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import NotFoundException from "../../Types/Exception/NotFoundException";
import { JSONObject } from "../../Types/JSON";
import { OpenStackBlastRadius } from "../../Types/OpenStack/OpenStackBlastRadius";
import {
  OpenStackRegionSummary,
  OpenStackTopConsumers,
} from "../../Types/OpenStack/OpenStackOverview";
import {
  OpenStackCountBy,
  OpenStackCountRow,
  isOpenStackCountable,
} from "../../Types/OpenStack/OpenStackCounts";
import { OpenStackResourceKind } from "../../Types/OpenStack/OpenStackResourceKind";

/*
 * ------------------------------------------------------------------
 * OpenStackResourceAPI
 *
 * Augments the auto-generated CRUD router with its custom endpoints:
 *
 *   POST /openstack-resource/inventory-summary/:cloudId   { regionName? }
 *     The cloud's or a region's counts for its layout and Overview pages, in one round
 *     trip, read from the same rows the lists read. Needs read access to the cloud.
 *
 *   POST /openstack-resource/needs-attention/:cloudId   { regionName? }
 *     The rows that may need someone, for the Overview's Needs attention and health
 *     pill (OpenStackHealth has the last word on each). One indexed read per kind, so
 *     a cloud of any size answers quickly. Needs read access to the cloud.
 *
 *   POST /openstack-resource/region-summaries/:cloudId
 *     What each region holds, for the Overview's Regions card.
 *
 *   POST /openstack-resource/top-consumers/:cloudId   { regionName? }
 *     The projects holding the most, for the Overview.
 *
 *   POST /openstack-resource/blast-radius/:cloudId   { kind, externalId }
 *     What a failed part takes with it, by count and by project. Needs read access to
 *     the cloud, and only ever reads that cloud's rows.
 *
 *   POST /openstack-resource/counts/:cloudId   { kind, by }
 *     How many of a kind there are by what they hold, on the server, from a closed list
 *     of what can be counted (OpenStackCounts). Needs read access to the cloud.
 *
 *   POST /openstack-resource/project-summaries/:cloudId   { projectIds }
 *     What each of a page of projects runs, and which of their parts may need someone.
 *
 *   POST /openstack-resource/project-overview/:cloudId   { projectId }
 *     One project's page: the same, the hosts down under it, and its labels.
 *
 *   POST /openstack-resource/domain-summaries/:cloudId
 *   POST /openstack-resource/domain-projects/:cloudId   { domainId }
 *     How many projects each domain holds, and the IDs a filter by domain narrows to.
 *
 *   POST /openstack-resource/topology/:cloudId
 *     What the cloud's map is drawn from, bounded however large the cloud is.
 *
 * The standard CRUD endpoints (list / get) are still registered by BaseAPI, and
 * the UI uses them through ModelAPI, with the filters on the indexed columns.
 * Write endpoints reject (@TableAccessControl create/update/delete = []): ingest
 * writes go through OpenStackResourceService as root.
 * ------------------------------------------------------------------
 */
export default class OpenStackResourceAPI extends BaseAPI<
  OpenStackResource,
  OpenStackResourceServiceType
> {
  public constructor() {
    super(OpenStackResource, OpenStackResourceService);

    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/inventory-summary/:cloudId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.getInventorySummary(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/needs-attention/:cloudId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.getNeedsAttention(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.post(
      `${new this.entityType()
        .getCrudApiPath()
        ?.toString()}/blast-radius/:cloudId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.getBlastRadius(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/counts/:cloudId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await this.getCounts(req, res);
        } catch (err) {
          next(err);
        }
      },
    );

    this.registerCloudRead(
      "region-summaries",
      (req: ExpressRequest, res: ExpressResponse) => {
        return this.getRegionSummaries(req, res);
      },
    );
    this.registerCloudRead(
      "top-consumers",
      (req: ExpressRequest, res: ExpressResponse) => {
        return this.getTopConsumers(req, res);
      },
    );
    this.registerCloudRead(
      "project-summaries",
      (req: ExpressRequest, res: ExpressResponse) => {
        return this.getProjectSummaries(req, res);
      },
    );
    this.registerCloudRead(
      "project-overview",
      (req: ExpressRequest, res: ExpressResponse) => {
        return this.getProjectOverview(req, res);
      },
    );
    this.registerCloudRead(
      "domain-summaries",
      (req: ExpressRequest, res: ExpressResponse) => {
        return this.getDomainSummaries(req, res);
      },
    );
    this.registerCloudRead(
      "domain-projects",
      (req: ExpressRequest, res: ExpressResponse) => {
        return this.getDomainProjects(req, res);
      },
    );
    this.registerCloudRead(
      "topology",
      (req: ExpressRequest, res: ExpressResponse) => {
        return this.getTopology(req, res);
      },
    );
  }

  private registerCloudRead(
    path: string,
    read: (req: ExpressRequest, res: ExpressResponse) => Promise<void>,
  ): void {
    this.router.post(
      `${new this.entityType().getCrudApiPath()?.toString()}/${path}/:cloudId`,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await read(req, res);
        } catch (err) {
          next(err);
        }
      },
    );
  }

  private readStringList(req: ExpressRequest, key: string): Array<string> {
    const value: unknown = ((req.body || {}) as JSONObject)[key];
    if (
      !Array.isArray(value) ||
      value.some((item: unknown): boolean => {
        return typeof item !== "string" || !item;
      })
    ) {
      throw new BadDataException(`${key} must be a list of IDs`);
    }
    return value as Array<string>;
  }

  private readString(req: ExpressRequest, key: string): string {
    const value: unknown = ((req.body || {}) as JSONObject)[key];
    if (typeof value !== "string" || !value) {
      throw new BadDataException(`${key} is required`);
    }
    return value;
  }

  // A region to read, when the body names one. Nothing named reads the whole cloud.
  private readRegionName(req: ExpressRequest): string | undefined {
    const value: unknown = ((req.body || {}) as JSONObject)["regionName"];
    if (value === undefined || value === null || value === "") {
      return undefined;
    }
    if (typeof value !== "string") {
      throw new BadDataException("regionName must be a string");
    }
    return value;
  }

  private async getRegionSummaries(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const { projectId, openStackCloudId } =
      await this.resolveCloudForRequest(req);

    const regions: Array<OpenStackRegionSummary> =
      await this.service.getRegionSummaries({ projectId, openStackCloudId });

    return Response.sendJsonObjectResponse(req, res, {
      regions,
    } as unknown as JSONObject);
  }

  private async getTopConsumers(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const { projectId, openStackCloudId } =
      await this.resolveCloudForRequest(req);

    const consumers: OpenStackTopConsumers = await this.service.getTopConsumers(
      {
        projectId,
        openStackCloudId,
        regionName: this.readRegionName(req),
      },
    );

    return Response.sendJsonObjectResponse(
      req,
      res,
      consumers as unknown as JSONObject,
    );
  }

  private async getProjectSummaries(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const { projectId, openStackCloudId } =
      await this.resolveCloudForRequest(req);
    const openStackProjectIds: Array<string> = this.readStringList(
      req,
      "projectIds",
    );

    const [summaries, attention]: [
      Array<OpenStackProjectSummary>,
      OpenStackAttentionRows,
    ] = await Promise.all([
      this.service.getProjectSummaries({
        projectId,
        openStackCloudId,
        openStackProjectIds,
      }),
      this.service.getAttentionRows({
        projectId,
        openStackCloudId,
        now: OneUptimeDate.getCurrentDate(),
        openStackProjectIds,
        rowsPerKind: 500,
      }),
    ]);

    return Response.sendJsonObjectResponse(req, res, {
      summaries,
      attention,
    } as unknown as JSONObject);
  }

  private async getProjectOverview(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const { projectId, openStackCloudId } =
      await this.resolveCloudForRequest(req);

    const overview: OpenStackProjectOverview =
      await this.service.getProjectOverview({
        projectId,
        openStackCloudId,
        openStackProjectId: this.readString(req, "projectId"),
        now: OneUptimeDate.getCurrentDate(),
      });

    return Response.sendJsonObjectResponse(
      req,
      res,
      overview as unknown as JSONObject,
    );
  }

  private async getDomainSummaries(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const { projectId, openStackCloudId } =
      await this.resolveCloudForRequest(req);

    const summaries: Array<OpenStackDomainSummary> =
      await this.service.getDomainSummaries({ projectId, openStackCloudId });

    return Response.sendJsonObjectResponse(req, res, {
      summaries,
    } as unknown as JSONObject);
  }

  private async getDomainProjects(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const { projectId, openStackCloudId } =
      await this.resolveCloudForRequest(req);

    return Response.sendJsonObjectResponse(
      req,
      res,
      (await this.service.getProjectIdsOfDomain({
        projectId,
        openStackCloudId,
        domainId: this.readString(req, "domainId"),
      })) as unknown as JSONObject,
    );
  }

  private async getTopology(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const { projectId, openStackCloudId } =
      await this.resolveCloudForRequest(req);

    const topology: OpenStackTopologyRead = await this.service.getTopologyRead({
      projectId,
      openStackCloudId,
      now: OneUptimeDate.getCurrentDate(),
    });

    return Response.sendJsonObjectResponse(
      req,
      res,
      topology as unknown as JSONObject,
    );
  }

  private async getCounts(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const { projectId, openStackCloudId } =
      await this.resolveCloudForRequest(req);

    const body: JSONObject = (req.body || {}) as JSONObject;
    const kind: unknown = body["kind"];
    const by: unknown = body["by"];
    if (!isOpenStackCountable(kind, by)) {
      throw new BadDataException("That kind can not be counted by that");
    }

    const rows: Array<OpenStackCountRow> = await this.service.getCounts({
      projectId,
      openStackCloudId,
      kind,
      by: by as OpenStackCountBy,
    });

    return Response.sendJsonObjectResponse(req, res, {
      rows: rows as unknown as JSONObject,
    });
  }

  private async getBlastRadius(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const { projectId, openStackCloudId } =
      await this.resolveCloudForRequest(req);

    const body: JSONObject = (req.body || {}) as JSONObject;
    const kind: unknown = body["kind"];
    const externalId: unknown = body["externalId"];
    if (
      typeof kind !== "string" ||
      !Object.values(OpenStackResourceKind).includes(
        kind as OpenStackResourceKind,
      ) ||
      typeof externalId !== "string" ||
      !externalId
    ) {
      throw new BadDataException("kind and externalId are required");
    }

    const part: OpenStackResource | null = await this.service.findOneBy({
      query: {
        projectId,
        openStackCloudId,
        kind,
        externalId,
      },
      select: {
        kind: true,
        name: true,
        regionName: true,
        hypervisorName: true,
        externalId: true,
        facts: true,
      },
      props: { isRoot: true },
    });
    if (!part) {
      throw new NotFoundException("That part is not in this cloud's inventory");
    }

    const result: OpenStackBlastRadius = await this.service.getBlastRadius({
      projectId,
      openStackCloudId,
      part: {
        kind: part.kind as OpenStackResourceKind,
        name: part.name,
        regionName: part.regionName,
        hypervisorName: part.hypervisorName,
        externalId: part.externalId,
        facts: part.facts,
      },
    });

    return Response.sendJsonObjectResponse(
      req,
      res,
      result as unknown as JSONObject,
    );
  }

  private async getNeedsAttention(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const { projectId, openStackCloudId } =
      await this.resolveCloudForRequest(req);

    const result: OpenStackAttentionRows = await this.service.getAttentionRows({
      projectId,
      openStackCloudId,
      now: OneUptimeDate.getCurrentDate(),
      regionName: this.readRegionName(req),
    });

    return Response.sendJsonObjectResponse(
      req,
      res,
      result as unknown as JSONObject,
    );
  }

  private readCloudIdParam(req: ExpressRequest): ObjectID {
    const cloudIdParam: string | undefined = req.params["cloudId"];
    if (!cloudIdParam) {
      throw new BadDataException("Cloud ID is required");
    }

    try {
      return new ObjectID(cloudIdParam);
    } catch {
      throw new BadDataException("Invalid Cloud ID");
    }
  }

  /*
   * Throws NotFound when the cloud is missing or the caller lacks read access,
   * indistinguishable on purpose.
   */
  private async resolveCloudForRequest(req: ExpressRequest): Promise<{
    projectId: ObjectID;
    openStackCloudId: ObjectID;
  }> {
    const openStackCloudId: ObjectID = this.readCloudIdParam(req);

    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    const cloud: OpenStackCloud | null =
      await OpenStackCloudService.findOneById({
        id: openStackCloudId,
        select: {
          _id: true,
          projectId: true,
        },
        props,
      });

    if (!cloud || !cloud.projectId) {
      throw new NotFoundException("OpenStack Cloud not found");
    }

    return {
      projectId: cloud.projectId,
      openStackCloudId,
    };
  }

  private async getInventorySummary(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const { projectId, openStackCloudId } =
      await this.resolveCloudForRequest(req);

    const summary: OpenStackInventorySummary =
      await this.service.getInventorySummary({
        projectId,
        openStackCloudId,
        regionName: this.readRegionName(req),
      });

    return Response.sendJsonObjectResponse(
      req,
      res,
      summary as unknown as JSONObject,
    );
  }
}
