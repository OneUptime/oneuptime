import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/StatusPageSubscriberNotificationTemplate";
import StatusPageSubscriberNotificationTemplateStatusPage from "../../Models/DatabaseModels/StatusPageSubscriberNotificationTemplateStatusPage";
import ObjectID from "../../Types/ObjectID";
import StatusPageSubscriberNotificationEventType from "../../Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "../../Types/StatusPage/StatusPageSubscriberNotificationMethod";
import StatusPageSubscriberNotificationTemplateStatusPageService from "./StatusPageSubscriberNotificationTemplateStatusPageService";
import BadDataException from "../../Types/Exception/BadDataException";
import SubscriberNotificationTemplateVariables from "../../Types/StatusPage/SubscriberNotificationTemplateVariables";
import SubscriberNotificationTemplateChannels from "../../Types/StatusPage/SubscriberNotificationTemplateChannels";
import StatusPageSubscriberWebhookTemplate from "../Utils/StatusPageSubscriberWebhookTemplate";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    Service.validateTemplate({
      eventType: createBy.data.eventType,
      notificationMethod: createBy.data.notificationMethod,
      templateBody: createBy.data.templateBody,
    });

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    const data: Partial<
      Record<"eventType" | "notificationMethod" | "templateBody", unknown>
    > = updateBy.data;

    if (
      data.eventType === undefined &&
      data.notificationMethod === undefined &&
      data.templateBody === undefined
    ) {
      return { updateBy, carryForward: null };
    }

    // Validate what each matched template will look like after the update.
    const templates: Array<Model> = await this.findBy({
      query: updateBy.query,
      select: {
        eventType: true,
        notificationMethod: true,
        templateBody: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    for (const template of templates) {
      Service.validateTemplate({
        eventType: (data.eventType ??
          template.eventType) as StatusPageSubscriberNotificationEventType,
        notificationMethod: (data.notificationMethod ??
          template.notificationMethod) as StatusPageSubscriberNotificationMethod,
        templateBody: (data.templateBody ?? template.templateBody) as string,
      });
    }

    return { updateBy, carryForward: null };
  }

  /*
   * Refuses a template no sender would ever use (see
   * SubscriberNotificationTemplateChannels), and a Webhook template that is not
   * a JSON object, so neither is discovered by a subscriber who never hears
   * the custom message.
   */
  public static validateTemplate(data: {
    eventType?: StatusPageSubscriberNotificationEventType | undefined;
    notificationMethod?: StatusPageSubscriberNotificationMethod | undefined;
    templateBody?: string | undefined;
  }): void {
    if (
      data.eventType &&
      data.notificationMethod &&
      !SubscriberNotificationTemplateChannels.isSupported(
        data.eventType,
        data.notificationMethod,
      )
    ) {
      throw new BadDataException(
        `${data.notificationMethod} subscribers do not receive "${data.eventType}" notifications, so a ${data.notificationMethod} template for this event would never be used.`,
      );
    }

    if (
      data.notificationMethod ===
        StatusPageSubscriberNotificationMethod.Webhook &&
      data.templateBody
    ) {
      StatusPageSubscriberWebhookTemplate.validateTemplateBody(
        data.templateBody,
      );
    }
  }

  /**
   * Get template for a specific status page, event type, and notification method.
   * Returns null if no custom template is found (caller should use default template).
   */
  public async getTemplateForStatusPage(data: {
    statusPageId: ObjectID;
    eventType: StatusPageSubscriberNotificationEventType;
    notificationMethod: StatusPageSubscriberNotificationMethod;
  }): Promise<Model | null> {
    const { statusPageId, eventType, notificationMethod } = data;

    // First find the template link for this status page
    const templateLinks: Array<StatusPageSubscriberNotificationTemplateStatusPage> =
      await StatusPageSubscriberNotificationTemplateStatusPageService.findBy({
        query: {
          statusPageId: statusPageId,
        },
        select: {
          statusPageSubscriberNotificationTemplateId: true,
        },
        skip: 0,
        limit: 100,
        props: {
          isRoot: true,
        },
      });

    if (templateLinks.length === 0) {
      return null;
    }

    // Get the template IDs
    const templateIds: Array<ObjectID> = templateLinks
      .map((link: StatusPageSubscriberNotificationTemplateStatusPage) => {
        return link.statusPageSubscriberNotificationTemplateId;
      })
      .filter((id: ObjectID | undefined): id is ObjectID => {
        return id !== undefined;
      });

    if (templateIds.length === 0) {
      return null;
    }

    // Find the specific template matching the event type and notification method
    const templates: Array<Model> = await this.findBy({
      query: {
        eventType: eventType,
        notificationMethod: notificationMethod,
      },
      select: {
        _id: true,
        templateName: true,
        templateBody: true,
        emailSubject: true,
        eventType: true,
        notificationMethod: true,
      },
      skip: 0,
      limit: 100,
      props: {
        isRoot: true,
      },
    });

    // Find a template that matches one of the linked template IDs
    for (const template of templates) {
      if (
        templateIds.some((id: ObjectID) => {
          return id.toString() === template._id?.toString();
        })
      ) {
        return template;
      }
    }

    return null;
  }

  /**
   * Get available variables for a specific event type.
   * These variables can be used in templates with {{variableName}} syntax.
   */
  public static getAvailableVariablesForEventType(
    eventType: StatusPageSubscriberNotificationEventType,
  ): Array<{ name: string; description: string }> {
    if (
      !Object.values(StatusPageSubscriberNotificationEventType).includes(
        eventType,
      )
    ) {
      throw new BadDataException(`Unknown event type: ${eventType}`);
    }

    return SubscriberNotificationTemplateVariables.getVariables(eventType);
  }

  /**
   * Compile a template with the given variables.
   * Replaces {{variableName}} with the actual values.
   */
  public static compileTemplate(
    template: string,
    variables: Record<string, string>,
  ): string {
    let compiledTemplate: string = template;

    for (const [key, value] of Object.entries(variables)) {
      const regex: RegExp = new RegExp(`{{\\s*${key}\\s*}}`, "g");
      // A replacer function, so a "$&" in a value is not a replacement pattern.
      compiledTemplate = compiledTemplate.replace(regex, (): string => {
        return value || "";
      });
    }

    return compiledTemplate;
  }
}

export default new Service();
