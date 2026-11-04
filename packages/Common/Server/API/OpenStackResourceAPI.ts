import OpenStackResource from "../../Models/DatabaseModels/OpenStackResource";
import OpenStackCloud from "../../Models/DatabaseModels/OpenStackCloud";
import BadDataException from "../../Types/Exception/BadDataException";
import ObjectID from "../../Types/ObjectID";
import OneUptimeDate from "../../Types/Date";
import OpenStackResourceService, {
  OpenStackAttentionRows,
  OpenStackInventorySummary,
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
import { OpenStackResourceKind } from "../../Types/OpenStack/OpenStackResourceKind";

/*
 * ------------------------------------------------------------------
 * OpenStackResourceAPI
 *
 * Augments the auto-generated CRUD router with three custom endpoints:
 *
 *   POST /openstack-resource/inventory-summary/:cloudId
 *     The cloud's counts for its layout and Overview pages, in one round trip,
 *     read from the same rows the lists read. Needs read access to the cloud.
 *
 *   POST /openstack-resource/needs-attention/:cloudId
 *     The rows that may need someone, for the Overview's Needs attention and health
 *     pill (OpenStackHealth has the last word on each). One indexed read per kind, so
 *     a cloud of any size answers quickly. Needs read access to the cloud.
 *
 *   POST /openstack-resource/blast-radius/:cloudId   { kind, externalId }
 *     What a failed part takes with it, by count and by project. Needs read access to
 *     the cloud, and only ever reads that cloud's rows.
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
      });

    return Response.sendJsonObjectResponse(
      req,
      res,
      summary as unknown as JSONObject,
    );
  }
}
