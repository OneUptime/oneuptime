import Model from "../../Models/DatabaseModels/OpenStackProjectNotice";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import {
  OpenStackProjectNoticeChannel,
  getOpenStackNoticeChannel,
  getOpenStackNoticeRecipient,
} from "../../Types/OpenStack/OpenStackProjectNotice";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import UpdateBy from "../Types/Database/UpdateBy";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import SSRFProtection from "../Utils/SSRFProtection";
import ProjectReferencesService from "./ProjectReferencesService";

/*
 * Who is told about one OpenStack project (OpenStackProjectNotice). Guards it as it is written: one
 * recipient, the same one once per project, and a webhook this server may reach. Whether it is on is
 * not writable here at all: only OpenStackProjectNoticeAPI's route turns one on, holding the token its
 * preview gave. A recipient changed afterwards is no longer who the preview was of, so it sends nothing
 * from that moment (isOpenStackProjectNoticeArmed) and is turned off to say so.
 */
export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  private async assertWebhookCanBeReached(url: string): Promise<void> {
    // An operator wrote this one, so their own network is theirs to name (issue #3424).
    await SSRFProtection.validateWebhookTargetIsSafe(url, {
      allowPrivateNetworkTargets: true,
    });
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    const openStackProjectId: string = (
      createBy.data.openStackProjectId || ""
    ).trim();

    if (!openStackProjectId) {
      throw new BadDataException("Say which OpenStack project this is about.");
    }

    createBy.data.openStackProjectId = openStackProjectId;

    if (createBy.data.isEnabled) {
      throw new BadDataException(
        "A notice starts off. Turn it on after its preview.",
      );
    }

    const email: string | undefined = createBy.data.email?.toString();
    const webhookUrl: string | undefined = createBy.data.webhookUrl?.toString();
    const statusPageId: string | undefined =
      createBy.data.statusPageId?.toString();
    const channel: OpenStackProjectNoticeChannel | null =
      getOpenStackNoticeChannel({ email, webhookUrl, statusPageId });

    if (!channel) {
      throw new BadDataException(
        "A notice tells one email, one webhook or one status page.",
      );
    }

    if (channel === OpenStackProjectNoticeChannel.Webhook) {
      await this.assertWebhookCanBeReached(webhookUrl!);
    }

    const projectId: ObjectID | undefined =
      createBy.data.projectId || createBy.props.tenantId;

    if (projectId && createBy.data.openStackCloudId) {
      const existing: Array<Model> = await this.findBy({
        query: {
          projectId,
          openStackCloudId: createBy.data.openStackCloudId,
          openStackProjectId,
        },
        select: { email: true, webhookUrl: true, statusPageId: true },
        skip: 0,
        limit: 1000,
        props: { isRoot: true },
      });
      const recipient: string | null = getOpenStackNoticeRecipient({
        email,
        webhookUrl,
        statusPageId,
      });

      if (
        existing.some((notice: Model): boolean => {
          return (
            getOpenStackNoticeRecipient({
              email: notice.email?.toString(),
              webhookUrl: notice.webhookUrl?.toString(),
              statusPageId: notice.statusPageId?.toString(),
            }) === recipient
          );
        })
      ) {
        throw new BadDataException(
          "This project already tells that recipient.",
        );
      }
    }

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    const webhookUrl: unknown = (updateBy.data as unknown as JSONObject)[
      "webhookUrl"
    ];

    if (webhookUrl) {
      await this.assertWebhookCanBeReached(String(webhookUrl));
    }

    return { updateBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onUpdateSuccess(
    onUpdate: OnUpdate<Model>,
    updatedItemIds: Array<ObjectID>,
  ): Promise<OnUpdate<Model>> {
    const data: JSONObject = onUpdate.updateBy.data as unknown as JSONObject;

    if (data["email"] !== undefined || data["webhookUrl"] !== undefined) {
      for (const id of updatedItemIds) {
        await this.updateOneById({
          id,
          data: {
            isEnabled: false,
            previewSeenAt: null,
            previewSeenByUserId: null,
            previewedRecipient: null,
            previewToken: null,
          } as never,
          props: { isRoot: true },
        });
      }
    }

    return onUpdate;
  }
}

export default new Service();
