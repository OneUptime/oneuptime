import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/StatusPageSubscriberNotificationTemplate";
import StatusPageSubscriberNotificationTemplateStatusPage from "../../Models/DatabaseModels/StatusPageSubscriberNotificationTemplateStatusPage";
import ObjectID from "../../Types/ObjectID";
import StatusPageSubscriberNotificationEventType from "../../Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "../../Types/StatusPage/StatusPageSubscriberNotificationMethod";
import StatusPageSubscriberNotificationTemplateStatusPageService from "./StatusPageSubscriberNotificationTemplateStatusPageService";
import SubscriberNotificationTemplateVariables, {
  SubscriberNotificationTemplateVariable,
} from "../../Types/StatusPage/SubscriberNotificationTemplateVariables";

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
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
   * The list lives in SubscriberNotificationTemplateVariables, which has no
   * database dependencies, so workers' tests and the dashboard can read it.
   */
  public static getAvailableVariablesForEventType(
    eventType: StatusPageSubscriberNotificationEventType,
  ): Array<SubscriberNotificationTemplateVariable> {
    return SubscriberNotificationTemplateVariables.getAvailableVariablesForEventType(
      eventType,
    );
  }

  /**
   * Compile a template with the given variables.
   * Replaces {{variableName}} with the actual values.
   *
   * One pass over the template, with a replacer function:
   * - A replacement string would give "$&", "$$", "$`" and "$'" special
   *   meaning, so a note mentioning "$$5" or a resource named "Store $&" was
   *   rewritten on its way to subscribers.
   * - Replacing one variable at a time also expanded placeholders that
   *   appeared inside an earlier value, so a note containing
   *   "{{unsubscribeUrl}}" came out as a link.
   * A placeholder with no variable is left as written.
   */
  public static compileTemplate(
    template: string,
    variables: Record<string, string>,
  ): string {
    return template.replace(
      /{{\s*([\w.]+)\s*}}/g,
      (placeholder: string, name: string): string => {
        if (!Object.prototype.hasOwnProperty.call(variables, name)) {
          return placeholder;
        }

        return variables[name] || "";
      },
    );
  }
}

export default new Service();
