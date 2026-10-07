import ProjectReferencesService from "./ProjectReferencesService";
import StatusPageSubscriberNotificationTemplateService from "./StatusPageSubscriberNotificationTemplateService";
import Model from "../../Models/DatabaseModels/StatusPageSubscriberNotificationTemplateStatusPage";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import ObjectID from "../../Types/ObjectID";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import Query from "../Types/Database/Query";
import UpdateBy from "../Types/Database/UpdateBy";
import SubscriberTemplateIncidentRecordAccess from "../Utils/StatusPage/SubscriberTemplateIncidentRecordAccess";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

// The two names of each reference this service checks, ID column first.
const TEMPLATE_KEYS: Array<string> = [
  "statusPageSubscriberNotificationTemplateId",
  "statusPageSubscriberNotificationTemplate",
];
const STATUS_PAGE_KEYS: Array<string> = ["statusPageId", "statusPage"];

/*
 * Linking a custom subscriber notification template to a status page sends
 * that page's subscribers whatever the template places. A template may place
 * values from the team's incident records ({{incidentLabels}},
 * {{incident.customFields.<key>}}), which only someone who may read them may
 * put in a template (SubscriberTemplateIncidentRecordAccess) - and the
 * status page roles that may link templates may also add a Slack, Teams or
 * webhook subscriber of their own to a page. So linking such a template, or
 * moving a link to another template or page, is checked as placing
 * everything the template holds. Root and master admin writes are not
 * checked.
 */
export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    if (!createBy.props.isRoot && !createBy.props.isMasterAdmin) {
      // The template, under either of its names (the two must agree).
      const templateId: ObjectID | null = RelationIdUtil.readConsistent(
        createBy.data as unknown as Record<string, unknown>,
        TEMPLATE_KEYS,
        "Status Page Subscriber Notification Template",
      );

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
    await super.onBeforeUpdate(updateBy);

    if (updateBy.props.isRoot || updateBy.props.isMasterAdmin) {
      return { updateBy, carryForward: null };
    }

    const data: Record<string, unknown> = updateBy.data as unknown as Record<
      string,
      unknown
    >;

    // The template and the page, each under either of its names.
    const writtenTemplateId: ObjectID | null = RelationIdUtil.readConsistent(
      data,
      TEMPLATE_KEYS,
      "Status Page Subscriber Notification Template",
    );
    const writesStatusPage: boolean = RelationIdUtil.isPresent(
      data,
      STATUS_PAGE_KEYS,
    );

    if (!writtenTemplateId && !writesStatusPage) {
      return { updateBy, carryForward: null };
    }

    let templateIds: Array<ObjectID> = [];

    if (writtenTemplateId) {
      templateIds = [writtenTemplateId];
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
