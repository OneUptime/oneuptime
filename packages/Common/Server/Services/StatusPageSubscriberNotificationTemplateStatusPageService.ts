import DatabaseService from "./DatabaseService";
import StatusPageSubscriberNotificationTemplateService from "./StatusPageSubscriberNotificationTemplateService";
import Model from "../../Models/DatabaseModels/StatusPageSubscriberNotificationTemplateStatusPage";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import ObjectID from "../../Types/ObjectID";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import Query from "../Types/Database/Query";
import UpdateBy from "../Types/Database/UpdateBy";
import SubscriberTemplateIncidentRecordAccess from "../Utils/StatusPage/SubscriberTemplateIncidentRecordAccess";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

/*
 * Linking a custom subscriber notification template to a status page sends
 * that page's subscribers whatever the template places. A template may place
 * values from the team's incident records ({{incidentLabels}},
 * {{customFields.<key>}}), which only someone who may read them may put in a
 * template (SubscriberTemplateIncidentRecordAccess) - and the status page
 * roles that may link templates may also add a Slack, Teams or webhook
 * subscriber of their own to a page. So linking such a template, or moving a
 * link to another template or page, is checked as placing everything the
 * template holds. Root and master admin writes are not checked.
 */
export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    if (!createBy.props.isRoot && !createBy.props.isMasterAdmin) {
      const templateId: ObjectID | undefined =
        createBy.data.statusPageSubscriberNotificationTemplateId ||
        createBy.data.statusPageSubscriberNotificationTemplate?.id ||
        undefined;

      await this.assertCanLink({
        templateIds: templateId ? [templateId] : [],
        createBy: createBy,
      });
    }

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    if (updateBy.props.isRoot || updateBy.props.isMasterAdmin) {
      return { updateBy, carryForward: null };
    }

    const data: {
      statusPageSubscriberNotificationTemplateId?: unknown;
      statusPageId?: unknown;
    } = updateBy.data as unknown as {
      statusPageSubscriberNotificationTemplateId?: unknown;
      statusPageId?: unknown;
    };

    const writesTemplate: boolean =
      data.statusPageSubscriberNotificationTemplateId !== undefined &&
      data.statusPageSubscriberNotificationTemplateId !== null;
    const writesStatusPage: boolean = data.statusPageId !== undefined;

    if (!writesTemplate && !writesStatusPage) {
      return { updateBy, carryForward: null };
    }

    let templateIds: Array<ObjectID> = [];

    if (writesTemplate) {
      templateIds = [
        new ObjectID(String(data.statusPageSubscriberNotificationTemplateId)),
      ];
    } else {
      // Moved to another page: the templates the links already point at.
      const query: Query<Model> = updateBy.props.tenantId
        ? { ...updateBy.query, projectId: updateBy.props.tenantId }
        : updateBy.query;

      const links: Array<Model> = await this.findBy({
        query: query,
        select: {
          statusPageSubscriberNotificationTemplateId: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      templateIds = links
        .map((link: Model): ObjectID | undefined => {
          return link.statusPageSubscriberNotificationTemplateId;
        })
        .filter((id: ObjectID | undefined): id is ObjectID => {
          return Boolean(id);
        });
    }

    SubscriberTemplateIncidentRecordAccess.assertCanPlace({
      placeholders:
        await StatusPageSubscriberNotificationTemplateService.getIncidentRecordPlaceholdersHeld(
          {
            templateIds: templateIds,
            projectId: updateBy.props.tenantId as ObjectID | undefined,
          },
        ),
      props: updateBy.props,
    });

    return { updateBy, carryForward: null };
  }

  private async assertCanLink(data: {
    templateIds: Array<ObjectID>;
    createBy: CreateBy<Model>;
  }): Promise<void> {
    SubscriberTemplateIncidentRecordAccess.assertCanPlace({
      placeholders:
        await StatusPageSubscriberNotificationTemplateService.getIncidentRecordPlaceholdersHeld(
          {
            templateIds: data.templateIds,
            projectId:
              (data.createBy.props.tenantId as ObjectID | undefined) ||
              data.createBy.data.projectId,
          },
        ),
      props: data.createBy.props,
    });
  }
}

export default new Service();
