import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/StatusPageSubscriberNotificationTemplate";
import StatusPageSubscriberNotificationTemplateStatusPage from "../../Models/DatabaseModels/StatusPageSubscriberNotificationTemplateStatusPage";
import ObjectID from "../../Types/ObjectID";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import QueryHelper from "../Types/Database/QueryHelper";
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
   *
   * Workers call this as root, so nothing but the query below keeps one
   * project's page from reading another project's templates. The template
   * query is therefore narrowed to the ids this page links to AND to the
   * page's own project. It used to ask for every template of this event type
   * and channel across all projects, 100 at a time, and look for the linked
   * id in memory: once more than 100 such templates existed on a shared
   * server, the linked one could fall outside those 100 and the page's
   * subscribers silently got the default template instead of the branded one.
   */
  public async getTemplateForStatusPage(data: {
    statusPageId: ObjectID;
    eventType: StatusPageSubscriberNotificationEventType;
    notificationMethod: StatusPageSubscriberNotificationMethod;
  }): Promise<Model | null> {
    const { statusPageId, eventType, notificationMethod } = data;

    /*
     * First find the template links for this status page. There is one per
     * linked template, so a page has only a handful, but nothing enforces a
     * cap - so read them all rather than risk the same truncation as above.
     */
    const templateLinks: Array<StatusPageSubscriberNotificationTemplateStatusPage> =
      await StatusPageSubscriberNotificationTemplateStatusPageService.findBy({
        query: {
          statusPageId: statusPageId,
        },
        select: {
          statusPageSubscriberNotificationTemplateId: true,
          projectId: true,
          statusPage: {
            projectId: true,
          },
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

    if (templateLinks.length === 0) {
      return null;
    }

    const statusPageProjectId: ObjectID | undefined =
      templateLinks.find(
        (link: StatusPageSubscriberNotificationTemplateStatusPage) => {
          return Boolean(link.statusPage?.projectId);
        },
      )?.statusPage?.projectId || undefined;

    if (!statusPageProjectId) {
      return null;
    }

    /*
     * Only links the page's own project made count: a link row stamped with
     * another project cannot pull that project's template onto this page.
     */
    const templateIds: Array<ObjectID> = templateLinks
      .filter((link: StatusPageSubscriberNotificationTemplateStatusPage) => {
        return link.projectId?.toString() === statusPageProjectId.toString();
      })
      .map((link: StatusPageSubscriberNotificationTemplateStatusPage) => {
        return link.statusPageSubscriberNotificationTemplateId;
      })
      .filter((id: ObjectID | undefined): id is ObjectID => {
        return id !== undefined && id !== null;
      });

    if (templateIds.length === 0) {
      return null;
    }

    /*
     * Find the linked template for this event type and notification method.
     * Several linked templates can match (nothing stops a page linking two
     * for the same event and channel); the default sort returns the newest
     * first, which is the one this method has always picked.
     */
    const templates: Array<Model> = await this.findBy({
      query: {
        _id: QueryHelper.any(templateIds),
        projectId: statusPageProjectId,
        eventType: eventType,
        notificationMethod: notificationMethod,
      },
      select: {
        _id: true,
        projectId: true,
        templateName: true,
        templateBody: true,
        emailSubject: true,
        eventType: true,
        notificationMethod: true,
      },
      skip: 0,
      limit: 1,
      props: {
        isRoot: true,
      },
    });

    return templates[0] || null;
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
