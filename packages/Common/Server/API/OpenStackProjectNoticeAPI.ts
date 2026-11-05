import OpenStackProjectNotice from "../../Models/DatabaseModels/OpenStackProjectNotice";
import OpenStackCloud from "../../Models/DatabaseModels/OpenStackCloud";
import OpenStackResource from "../../Models/DatabaseModels/OpenStackResource";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import OneUptimeDate from "../../Types/Date";
import BadDataException from "../../Types/Exception/BadDataException";
import NotFoundException from "../../Types/Exception/NotFoundException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import {
  OpenStackBlastRadius,
  OpenStackBlastRadiusProject,
  describeOpenStackBlastRadius,
} from "../../Types/OpenStack/OpenStackBlastRadius";
import {
  OpenStackMaintenancePart,
  readOpenStackMaintenanceParts,
} from "../../Types/OpenStack/OpenStackMaintenancePart";
import {
  OpenStackProjectNoticeDecision,
  OpenStackProjectNoticeEvent,
  OpenStackProjectTold,
  countOpenStackProjectsNotTold,
  getOpenStackNoticeChannel,
  getOpenStackNoticeRecipient,
} from "../../Types/OpenStack/OpenStackProjectNotice";
import { OpenStackResourceKind } from "../../Types/OpenStack/OpenStackResourceKind";
import {
  OpenStackProjectNoticeMessage,
  writeOpenStackProjectNotice,
} from "../../Utils/OpenStack/OpenStackProjectNoticeText";
import UserMiddleware from "../Middleware/UserAuthorization";
import OpenStackCloudService from "../Services/OpenStackCloudService";
import OpenStackProjectNoticeService, {
  Service as OpenStackProjectNoticeServiceType,
} from "../Services/OpenStackProjectNoticeService";
import OpenStackResourceService from "../Services/OpenStackResourceService";
import ModelPermission from "../Types/Database/Permissions/Index";
import {
  ExpressRequest,
  ExpressResponse,
  NextFunction,
} from "../Utils/Express";
import OpenStackMaintenanceReach from "../Utils/OpenStack/OpenStackMaintenanceReach";
import OpenStackProjectNotices from "../Utils/OpenStack/OpenStackProjectNotices";
import Response from "../Utils/Response";
import SSRFProtection from "../Utils/SSRFProtection";
import BaseAPI from "./BaseAPI";
import CommonAPI from "./CommonAPI";

/*
 * ------------------------------------------------------------------
 * OpenStackProjectNoticeAPI
 *
 * Augments the auto-generated CRUD router. Whether a notice is on isn't a column anyone can write: it
 * only changes here, and on takes the token its preview gave, so nothing is sent to anyone until someone
 * who may change the cloud has been shown who it tells.
 *
 *   POST /openstack-project-notice/preview/:noticeId
 *     Who this tells, what the project holds, the words it would send, and the token to turn it on.
 *
 *   POST /openstack-project-notice/turn-on/:noticeId   { previewToken }
 *   POST /openstack-project-notice/turn-off/:noticeId
 *
 *   POST /openstack-project-notice/who-would-be-told/:cloudId   { kind, externalId } or { parts }
 *     Who would be told were this part to fail now or a maintenance event to be put on these parts, by
 *     the answer that really sends, and why the rest would not. Needs read access to the cloud.
 * ------------------------------------------------------------------
 */
export default class OpenStackProjectNoticeAPI extends BaseAPI<
  OpenStackProjectNotice,
  OpenStackProjectNoticeServiceType
> {
  public constructor() {
    super(OpenStackProjectNotice, OpenStackProjectNoticeService);

    const path: string =
      new this.entityType().getCrudApiPath()?.toString() || "";

    this.register(`${path}/preview/:noticeId`, (req, res) => {
      return this.preview(req, res);
    });
    this.register(`${path}/turn-on/:noticeId`, (req, res) => {
      return this.turnOn(req, res);
    });
    this.register(`${path}/turn-off/:noticeId`, (req, res) => {
      return this.turnOff(req, res);
    });
    this.register(`${path}/who-would-be-told/:cloudId`, (req, res) => {
      return this.whoWouldBeTold(req, res);
    });
  }

  private register(
    route: string,
    handler: (req: ExpressRequest, res: ExpressResponse) => Promise<void>,
  ): void {
    this.router.post(
      route,
      UserMiddleware.getUserMiddleware,
      async (req: ExpressRequest, res: ExpressResponse, next: NextFunction) => {
        try {
          await handler(req, res);
        } catch (err) {
          next(err);
        }
      },
    );
  }

  // The notice, for someone who may change it. Anyone else is told it isn't there.
  private async readNoticeToChange(
    req: ExpressRequest,
  ): Promise<OpenStackProjectNotice> {
    const noticeId: string = req.params["noticeId"] || "";

    if (!ObjectID.isValidUUID(noticeId)) {
      throw new BadDataException("That is not a notice.");
    }

    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    const visible: OpenStackProjectNotice | null =
      await this.service.findOneById({
        id: new ObjectID(noticeId),
        select: { _id: true, projectId: true },
        props,
      });

    if (!visible?.projectId) {
      throw new NotFoundException("That notice is not in this project.");
    }

    await ModelPermission.checkUpdateQueryPermissions(
      OpenStackProjectNotice,
      { _id: noticeId, projectId: visible.projectId } as never,
      {},
      props,
    );

    const notice: OpenStackProjectNotice | null =
      await this.service.findOneById({
        id: new ObjectID(noticeId),
        select: {
          _id: true,
          projectId: true,
          openStackCloudId: true,
          openStackProjectId: true,
          email: true,
          webhookUrl: true,
          isEnabled: true,
          previewToken: true,
        },
        props: { isRoot: true },
      });

    if (!notice) {
      throw new NotFoundException("That notice is not in this project.");
    }

    return notice;
  }

  private recipientOf(notice: OpenStackProjectNotice): {
    channel: string | null;
    address: string;
    recipient: string | null;
  } {
    const email: string | undefined = notice.email?.toString();
    const webhookUrl: string | undefined = notice.webhookUrl?.toString();

    return {
      channel: getOpenStackNoticeChannel({ email, webhookUrl }),
      address: email || webhookUrl || "",
      recipient: getOpenStackNoticeRecipient({ email, webhookUrl }),
    };
  }

  private async preview(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const notice: OpenStackProjectNotice = await this.readNoticeToChange(req);
    const previewToken: string = ObjectID.generate().toString();

    await this.service.updateOneById({
      id: notice.id!,
      data: { previewToken },
      props: { isRoot: true },
    });

    const projectRow: OpenStackResource | null =
      await OpenStackResourceService.findOneBy({
        query: {
          projectId: notice.projectId!,
          openStackCloudId: notice.openStackCloudId!,
          kind: OpenStackResourceKind.Project,
          externalId: notice.openStackProjectId!,
        },
        select: { name: true },
        props: { isRoot: true },
      });

    const instanceCount: number = (
      await OpenStackResourceService.countBy({
        query: {
          projectId: notice.projectId!,
          openStackCloudId: notice.openStackCloudId!,
          kind: OpenStackResourceKind.Instance,
          openStackProjectId: notice.openStackProjectId!,
        },
        props: { isRoot: true },
      })
    ).toNumber();

    // The words themselves, from what the project really holds. Only an example of which part fails.
    const example: OpenStackProjectNoticeMessage = writeOpenStackProjectNotice({
      event: OpenStackProjectNoticeEvent.IncidentOpened,
      projectId: notice.openStackProjectId!,
      projectName: projectRow?.name || null,
      partKind: OpenStackResourceKind.Hypervisor,
      partWords: "A compute host",
      regionName: null,
      holdings: { instanceCount: Math.max(instanceCount, 1) },
      occurredAt: OneUptimeDate.getCurrentDate().toISOString(),
    });

    return Response.sendJsonObjectResponse(req, res, {
      previewToken,
      channel: this.recipientOf(notice).channel,
      address: this.recipientOf(notice).address,
      projectId: notice.openStackProjectId!,
      projectName: projectRow?.name || null,
      isProjectInCloud: Boolean(projectRow),
      instanceCount,
      example: {
        subject: example.subject,
        markdown: example.markdown,
      },
    });
  }

  private async turnOn(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const notice: OpenStackProjectNotice = await this.readNoticeToChange(req);
    const previewToken: unknown = (req.body as JSONObject)?.["previewToken"];

    if (
      typeof previewToken !== "string" ||
      !previewToken ||
      previewToken !== notice.previewToken
    ) {
      throw new BadDataException(
        "See who this tells first: open its preview again, and turn it on from there.",
      );
    }

    const recipient: string | null = this.recipientOf(notice).recipient;

    if (!recipient) {
      throw new BadDataException("A notice tells one email or one webhook.");
    }

    const projects: Set<string> =
      await OpenStackProjectNotices.readExistingProjects({
        projectId: notice.projectId!,
        openStackCloudId: notice.openStackCloudId!,
        openStackProjectIds: [notice.openStackProjectId!],
      });

    if (!projects.has(notice.openStackProjectId!)) {
      throw new BadDataException(
        "OneUptime does not see this project in the cloud, so nothing would be sent. Check the project's ID.",
      );
    }

    if (notice.webhookUrl) {
      await SSRFProtection.validateWebhookTargetIsSafe(notice.webhookUrl, {
        allowPrivateNetworkTargets: true,
      });
    }

    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);

    await this.service.updateOneById({
      id: notice.id!,
      data: {
        isEnabled: true,
        previewSeenAt: OneUptimeDate.getCurrentDate(),
        previewSeenByUserId: props.userId || null,
        previewedRecipient: recipient,
        previewToken: null,
      } as never,
      props: { isRoot: true },
    });

    return Response.sendEmptySuccessResponse(req, res);
  }

  private async turnOff(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const notice: OpenStackProjectNotice = await this.readNoticeToChange(req);

    await this.service.updateOneById({
      id: notice.id!,
      data: {
        isEnabled: false,
        previewedRecipient: null,
        previewToken: null,
      } as never,
      props: { isRoot: true },
    });

    return Response.sendEmptySuccessResponse(req, res);
  }

  private async whoWouldBeTold(
    req: ExpressRequest,
    res: ExpressResponse,
  ): Promise<void> {
    const cloudId: string = req.params["cloudId"] || "";

    if (!ObjectID.isValidUUID(cloudId)) {
      throw new BadDataException("That is not a cloud.");
    }

    const props: DatabaseCommonInteractionProps =
      await CommonAPI.getDatabaseCommonInteractionProps(req);
    const openStackCloudId: ObjectID = new ObjectID(cloudId);

    const cloud: OpenStackCloud | null =
      await OpenStackCloudService.findOneById({
        id: openStackCloudId,
        select: { _id: true, projectId: true },
        props,
      });

    if (!cloud?.projectId) {
      throw new NotFoundException("OpenStack Cloud not found");
    }

    const projectId: ObjectID = cloud.projectId;
    const body: JSONObject = (req.body || {}) as JSONObject;
    let radius: OpenStackBlastRadius;
    let ownerProjectId: string | null = null;

    if (body["parts"] !== undefined) {
      const parts: Array<OpenStackMaintenancePart> =
        readOpenStackMaintenanceParts(body["parts"]).filter(
          (part: OpenStackMaintenancePart): boolean => {
            return part.openStackCloudId === cloudId.toLowerCase();
          },
        );

      if (parts.length === 0) {
        throw new BadDataException("Name a host or a zone of this cloud.");
      }

      radius = await OpenStackMaintenanceReach.read({
        projectId,
        openStackCloudId,
        parts,
      });
    } else {
      const kind: unknown = body["kind"];
      const externalId: unknown = body["externalId"];

      if (typeof kind !== "string" || typeof externalId !== "string") {
        throw new BadDataException("kind and externalId are required");
      }

      const part: OpenStackResource | null =
        await OpenStackResourceService.findOneBy({
          query: { projectId, openStackCloudId, kind, externalId },
          select: {
            kind: true,
            name: true,
            regionName: true,
            hypervisorName: true,
            externalId: true,
            openStackProjectId: true,
            facts: true,
          },
          props: { isRoot: true },
        });

      if (!part) {
        throw new NotFoundException(
          "That part is not in this cloud's inventory",
        );
      }

      ownerProjectId = part.openStackProjectId || null;
      radius = await OpenStackResourceService.getBlastRadius({
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
        includeEveryProject: true,
      });
    }

    const decision: OpenStackProjectNoticeDecision =
      await OpenStackProjectNotices.decide({
        projectId,
        openStackCloudId,
        radius,
        ownerProjectId,
      });

    return Response.sendJsonObjectResponse(req, res, {
      summary: describeOpenStackBlastRadius(radius),
      isReachKnown: decision.isReachKnown,
      ofNoProject: decision.ofNoProject as JSONObject,
      told: decision.told.map((told: OpenStackProjectTold): JSONObject => {
        const project: OpenStackBlastRadiusProject = told.project;
        return {
          projectId: project.projectId,
          name: project.name,
          channel: getOpenStackNoticeChannel(told.notice),
          address: told.notice.email || told.notice.webhookUrl || "",
          instanceCount: project.instanceCount,
          volumeCount: project.volumeCount,
          routerCount: project.routerCount,
          floatingIpCount: project.floatingIpCount,
        };
      }),
      // How many of each reason: a host with five hundred projects on it is one line each.
      notTold: countOpenStackProjectsNotTold(
        decision.notTold,
      ) as unknown as JSONObject,
    });
  }
}
