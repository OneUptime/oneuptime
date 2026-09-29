import DatabaseService from "./DatabaseService";
import Model from "../../Models/DatabaseModels/StatusPageSubscriberNotificationTemplate";
import StatusPageSubscriberNotificationTemplateStatusPage from "../../Models/DatabaseModels/StatusPageSubscriberNotificationTemplateStatusPage";
import ObjectID from "../../Types/ObjectID";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import Query from "../Types/Database/Query";
import QueryHelper from "../Types/Database/QueryHelper";
import UpdateBy from "../Types/Database/UpdateBy";
import SubscriberTemplateIncidentRecordAccess from "../Utils/StatusPage/SubscriberTemplateIncidentRecordAccess";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import StatusPageSubscriberNotificationEventType from "../../Types/StatusPage/StatusPageSubscriberNotificationEventType";
import StatusPageSubscriberNotificationMethod from "../../Types/StatusPage/StatusPageSubscriberNotificationMethod";
import StatusPageSubscriberNotificationTemplateStatusPageService from "./StatusPageSubscriberNotificationTemplateStatusPageService";
import SubscriberNotificationTemplateVariables, {
  SubscriberNotificationTemplateVariable,
} from "../../Types/StatusPage/SubscriberNotificationTemplateVariables";
import SubscriberNotificationTemplateCompiler, {
  SubscriberNotificationEmailBodyTemplateVariables,
  SubscriberNotificationTextTemplateVariables,
} from "../../Types/StatusPage/SubscriberNotificationTemplateCompiler";

export type {
  SubscriberNotificationEmailBodyTemplateVariables,
  SubscriberNotificationTextTemplateVariables,
};

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  /*
   * A template's body and subject may place values from the team's incident
   * records - {{incidentLabels}} and {{customFields.<key>}} - only when
   * whoever writes them may read those records: the status page roles that
   * may write templates may not (SubscriberTemplateIncidentRecordAccess).
   */
  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    SubscriberTemplateIncidentRecordAccess.assertCanPlace({
      placeholders:
        SubscriberNotificationTemplateVariables.getIncidentRecordPlaceholders([
          createBy.data.templateBody,
          createBy.data.emailSubject,
        ]),
      props: createBy.props,
    });

    return { createBy, carryForward: null };
  }

  /*
   * On an update, only what the write adds is checked: a placeholder the
   * template already holds was allowed when it was written, so someone
   * without incident access can still fix a typo, rename the template or
   * move a placeholder from the subject to the body - but not add one.
   *
   * Pointing a template somewhere else counts as placing everything it
   * holds: changing its channel or event type makes an admin's template
   * send its incident records to wherever the new channel goes, and a
   * status page role can add a Slack, Teams or webhook subscriber of its
   * own. (Linking it to another status page is checked by
   * StatusPageSubscriberNotificationTemplateStatusPageService.)
   */
  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    SubscriberTemplateIncidentRecordAccess.assertCanPlace({
      placeholders: await this.getIncidentRecordPlaceholdersToCheck(updateBy),
      props: updateBy.props,
    });

    return { updateBy, carryForward: null };
  }

  /*
   * The incident record placeholders this update must be allowed to place,
   * across every template it would change: those it writes into a body or
   * subject that the template did not hold before, and, when it changes
   * where the template is sent (its channel or event type), every one the
   * template will hold once written. The templates are read as root and
   * limited to the caller's project, like other update hooks: the update's
   * own permission check has not run yet, and only narrows the rows further.
   */
  private async getIncidentRecordPlaceholdersToCheck(
    updateBy: UpdateBy<Model>,
  ): Promise<Array<string>> {
    if (updateBy.props.isRoot || updateBy.props.isMasterAdmin) {
      return [];
    }

    const data: {
      templateBody?: unknown;
      emailSubject?: unknown;
      eventType?: unknown;
      notificationMethod?: unknown;
    } = updateBy.data as unknown as {
      templateBody?: unknown;
      emailSubject?: unknown;
      eventType?: unknown;
      notificationMethod?: unknown;
    };
    const writesBody: boolean = data.templateBody !== undefined;
    const writesSubject: boolean = data.emailSubject !== undefined;
    const writesTarget: boolean =
      data.eventType !== undefined || data.notificationMethod !== undefined;

    if (!writesBody && !writesSubject && !writesTarget) {
      return [];
    }

    // Anything but text places nothing: the column check refuses it anyway.
    const writtenBody: string | null =
      writesBody && typeof data.templateBody === "string"
        ? data.templateBody
        : null;
    const writtenSubject: string | null =
      writesSubject && typeof data.emailSubject === "string"
        ? data.emailSubject
        : null;

    const written: Array<string> =
      SubscriberNotificationTemplateVariables.getIncidentRecordPlaceholders([
        writtenBody,
        writtenSubject,
      ]);

    if (written.length === 0 && !writesTarget) {
      return [];
    }

    const query: Query<Model> = updateBy.props.tenantId
      ? { ...updateBy.query, projectId: updateBy.props.tenantId }
      : updateBy.query;

    const templates: Array<Model> = await this.findBy({
      query: query,
      select: {
        templateBody: true,
        emailSubject: true,
        eventType: true,
        notificationMethod: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const added: Set<string> = new Set<string>();

    for (const template of templates) {
      const held: Array<string> =
        SubscriberNotificationTemplateVariables.getIncidentRecordPlaceholders([
          template.templateBody,
          template.emailSubject,
        ]);

      /*
       * Only a real change: the edit form sends the channel and event type
       * back as they were, and a typo fix must still go through.
       */
      const changesTarget: boolean =
        writesTarget &&
        ((data.eventType !== undefined &&
          data.eventType !== template.eventType) ||
          (data.notificationMethod !== undefined &&
            data.notificationMethod !== template.notificationMethod));

      if (changesTarget) {
        // Everything the template will hold goes to the new target.
        for (const name of SubscriberNotificationTemplateVariables.getIncidentRecordPlaceholders(
          [
            writesBody ? writtenBody : template.templateBody,
            writesSubject ? writtenSubject : template.emailSubject,
          ],
        )) {
          added.add(name);
        }

        continue;
      }

      for (const name of written) {
        if (!held.includes(name)) {
          added.add(name);
        }
      }
    }

    return Array.from(added).sort();
  }

  /*
   * The incident record placeholders the given templates hold, in the
   * caller's project: what linking them to a status page places there
   * (StatusPageSubscriberNotificationTemplateStatusPageService). Read as
   * root, like the update hook above.
   */
  public async getIncidentRecordPlaceholdersHeld(data: {
    templateIds: Array<ObjectID>;
    projectId?: ObjectID | undefined;
  }): Promise<Array<string>> {
    if (data.templateIds.length === 0) {
      return [];
    }

    const templates: Array<Model> = await this.findBy({
      query: {
        _id: QueryHelper.any(data.templateIds),
        ...(data.projectId ? { projectId: data.projectId } : {}),
      },
      select: {
        templateBody: true,
        emailSubject: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const held: Set<string> = new Set<string>();

    for (const template of templates) {
      for (const name of SubscriberNotificationTemplateVariables.getIncidentRecordPlaceholders(
        [template.templateBody, template.emailSubject],
      )) {
        held.add(name);
      }
    }

    return Array.from(held).sort();
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
   * Compile a template for a channel that does not render HTML - an email
   * subject, SMS, Slack or Microsoft Teams - replacing {{variableName}} with
   * each value exactly as written.
   *
   * Never use it for the body of an email template, which is HTML: use
   * compileEmailBodyTemplate. See SubscriberNotificationTemplateCompiler.
   */
  public static compileTemplate(
    template: string,
    variables: SubscriberNotificationTextTemplateVariables,
  ): string {
    return SubscriberNotificationTemplateCompiler.compileTemplate(
      template,
      variables,
    );
  }

  /**
   * Compile the body of an EMAIL template, which is sent as HTML. Plain
   * values are HTML-escaped; only a SafeHtml value (rendered Markdown, the
   * date helper's HTML, the escaped resource list) is inserted as it is. See
   * SubscriberNotificationTemplateCompiler.
   */
  public static compileEmailBodyTemplate(
    template: string,
    variables: SubscriberNotificationEmailBodyTemplateVariables,
  ): string {
    return SubscriberNotificationTemplateCompiler.compileEmailBodyTemplate(
      template,
      variables,
    );
  }
}

export default new Service();
