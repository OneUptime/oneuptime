import Incident from "../../../Models/DatabaseModels/Incident";
import IncidentCustomField from "../../../Models/DatabaseModels/IncidentCustomField";
import IncidentSeverity from "../../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../../Models/DatabaseModels/Label";
import Monitor from "../../../Models/DatabaseModels/Monitor";
import StatusPage from "../../../Models/DatabaseModels/StatusPage";
import Hostname from "../../../Types/API/Hostname";
import Protocol from "../../../Types/API/Protocol";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { CustomFieldDefinition } from "../../../Types/CustomField/CustomFieldDefinition";
import {
  formatCustomFieldValueValidationErrors,
  validateCustomFieldValues,
} from "../../../Types/CustomField/CustomFieldValueValidator";
import { LIMIT_PER_PROJECT } from "../../../Types/Database/LimitMax";
import BadDataException from "../../../Types/Exception/BadDataException";
import NotFoundException from "../../../Types/Exception/NotFoundException";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import IncidentScopeAddedPagesNotification from "../../../Types/StatusPage/IncidentScopeAddedPagesNotification";
import IncidentSubscriberAudience, {
  IncidentSubscriberAudienceCounts,
  IncidentSubscriberAudienceResult,
  IncidentSubscriberAudienceStatusPage,
} from "../../../Types/StatusPage/IncidentSubscriberAudience";
import SubscriberNotificationPreview, {
  SubscriberEmailTemplateChoice,
  SubscriberNotificationPreviewEvent,
  SubscriberNotificationPreviewIncidentDraft,
  SubscriberNotificationPreviewNothingSentReason,
  SubscriberNotificationPreviewRequest,
  SubscriberNotificationSendTestRequest,
} from "../../../Types/StatusPage/SubscriberNotificationPreview";
import DatabaseConfig from "../../DatabaseConfig";
import CustomFieldMappingService from "../../Services/CustomFieldMappingService";
import IncidentCustomFieldService from "../../Services/IncidentCustomFieldService";
import IncidentService from "../../Services/IncidentService";
import IncidentSeverityService from "../../Services/IncidentSeverityService";
import LabelService from "../../Services/LabelService";
import StatusPageService from "../../Services/StatusPageService";
import QueryHelper from "../../Types/Database/QueryHelper";
import {
  IncidentStatusPageTemplateVariables,
  IncidentTemplateVariables,
} from "./IncidentTemplateVariableBuilder";
import IncidentSubscriberAudienceBuilder, {
  IncidentSubscriberAudienceRequest,
  IncidentSubscriberAudienceWithStatusPages,
} from "./IncidentSubscriberAudienceBuilder";
import SubscriberIncidentEmailBuilder, {
  SubscriberIncidentEmail,
  SubscriberIncidentEmailEvent,
  SubscriberIncidentStatusPageEmail,
} from "./SubscriberIncidentEmailBuilder";

/*
 * What "Preview notification" and "Send test to me" show and send: for each
 * status page an incident's email would go to, the email its subscribers
 * would get (see Common/Types/StatusPage/SubscriberNotificationPreview).
 *
 * The emails come from SubscriberIncidentEmailBuilder, the one code path the
 * 'incident created' and public note jobs send through, fed the way those
 * jobs feed it; the router renders them with the mailer's own
 * MailService.render. So what is previewed is what is sent.
 *
 * What the caller learns is bounded exactly as the "Will notify" audience
 * bounds it (IncidentSubscriberAudienceBuilder, which this builds on):
 *
 *   - the caller must hold one of the roles that may see the audience;
 *   - an incident that exists is read with the caller's own permissions,
 *     inside the caller's project, so another project's incident and a
 *     private one the caller may not read are "not found";
 *   - the monitors, status pages, labels and severity named for an incident
 *     being declared must all be the caller's project's;
 *   - only the pages the caller may read are previewed or named - in the
 *     preview, {{affectedStatusPages}} names only those pages too - and the
 *     others are one number (audience.hiddenStatusPageCount);
 *   - subscribers are counted, never read: no address leaves the server.
 *
 * Building a preview has no side effects: nothing is sent, and nothing about
 * the incident - its custom fields' images among them - is changed.
 */

// One status page's email, before it is rendered.
export interface SubscriberNotificationPreviewPage {
  /*
   * The page as the jobs load it, mail settings included: for sending a
   * test through the page's own SMTP server. Never serialized.
   */
  statusPage: StatusPage;
  statusPageId: string;
  // The name the caller knows the page by.
  name: string;
  subscriberCounts: IncidentSubscriberAudienceCounts;
  templateChoice: SubscriberEmailTemplateChoice;
  email: SubscriberIncidentEmail;
}

export interface SubscriberNotificationPreviewBuild {
  event: SubscriberNotificationPreviewEvent;
  nothingSentReason: SubscriberNotificationPreviewNothingSentReason | null;
  audience: IncidentSubscriberAudienceResult;
  statusPages: Array<SubscriberNotificationPreviewPage>;
}

// An incident and what its email needs, once the request is resolved.
interface PreviewIncident {
  event: SubscriberIncidentEmailEvent;
  incident: Incident;
  note?:
    | {
        text: string;
        postedAt: Date | null;
      }
    | undefined;
  audienceRequest: IncidentSubscriberAudienceRequest;
  // Why nothing will be sent, whatever the audience, for a draft.
  draftNothingSentReason: SubscriberNotificationPreviewNothingSentReason | null;
}

export default class SubscriberNotificationPreviewBuilder {
  /**
   * The emails for a request. With onlyStatusPageId, only that page's email
   * is built (for "Send test to me"); the audience still covers every page.
   */
  public static async build(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    request: SubscriberNotificationPreviewRequest;
    onlyStatusPageId?: string | undefined;
  }): Promise<SubscriberNotificationPreviewBuild> {
    IncidentSubscriberAudienceBuilder.assertCallerMaySeeAudience(data.props);

    const previewIncident: PreviewIncident =
      data.request.event === SubscriberNotificationPreviewEvent.IncidentCreated
        ? await this.resolveDraft({
            projectId: data.projectId,
            props: data.props,
            draft: data.request.incident,
          })
        : await this.resolvePublicNote({
            projectId: data.projectId,
            props: data.props,
            incidentId: data.request.incidentId,
            note: data.request.note,
            postedAt: data.request.postedAt,
          });

    /*
     * Who is told, worked out as the "Will notify" summary works it out -
     * and, for an incident that exists, the read that proves the caller may
     * see it. Nothing about the incident is read before this.
     */
    const withStatusPages: IncidentSubscriberAudienceWithStatusPages =
      await IncidentSubscriberAudienceBuilder.buildWithStatusPages(
        previewIncident.audienceRequest,
      );
    const audience: IncidentSubscriberAudienceResult = withStatusPages.audience;

    const nothingSentReason: SubscriberNotificationPreviewNothingSentReason | null =
      this.getNothingSentReason({
        audience: audience,
        draftNothingSentReason: previewIncident.draftNothingSentReason,
      });

    const result: SubscriberNotificationPreviewBuild = {
      event: data.request.event,
      nothingSentReason: nothingSentReason,
      audience: audience,
      statusPages: [],
    };

    if (nothingSentReason) {
      return result;
    }

    // The incident's content, now that the caller is known to read it.
    const incident: Incident =
      "incidentId" in previewIncident.audienceRequest
        ? await this.readIncidentContent({
            projectId: data.projectId,
            incidentId: previewIncident.audienceRequest.incidentId,
          })
        : previewIncident.incident;

    // The pages that will be told that the caller can see, in name order.
    const readableStatusPages: Array<StatusPage> =
      withStatusPages.resolved.statusPages.filter(
        (statusPage: StatusPage): boolean => {
          return Boolean(this.findAudiencePage(audience, statusPage));
        },
      );

    const statusPagesToBuild: Array<StatusPage> = data.onlyStatusPageId
      ? readableStatusPages.filter((statusPage: StatusPage): boolean => {
          return (
            this.getId(statusPage) === data.onlyStatusPageId!.toLowerCase()
          );
        })
      : readableStatusPages;

    if (statusPagesToBuild.length === 0) {
      return result;
    }

    const incidentTemplateVariables: IncidentTemplateVariables =
      await SubscriberIncidentEmailBuilder.buildTemplateVariables({
        event: previewIncident.event,
        incident: incident,
        statusPages: readableStatusPages,
        note: previewIncident.note,
      });

    const host: Hostname = await DatabaseConfig.getHost();
    const httpProtocol: Protocol = await DatabaseConfig.getHttpProtocol();

    for (const statusPage of statusPagesToBuild) {
      const audiencePage: IncidentSubscriberAudienceStatusPage =
        this.findAudiencePage(audience, statusPage)!;

      const statusPageUrl: string = await StatusPageService.getStatusPageURL(
        statusPage.id!,
      );
      const detailsUrl: string = SubscriberIncidentEmailBuilder.getDetailsUrl({
        statusPageUrl: statusPageUrl,
        incidentId: incident.id,
      });

      const pageTemplateVariables: IncidentStatusPageTemplateVariables =
        incidentTemplateVariables.forStatusPage({
          statusPage: statusPage,
          statusPageUrl: statusPageUrl,
          detailsUrl: detailsUrl,
          resources:
            withStatusPages.resolved.statusPageToResources[statusPage._id!] ||
            [],
        });

      const pageEmail: SubscriberIncidentStatusPageEmail =
        await SubscriberIncidentEmailBuilder.forStatusPage({
          event: previewIncident.event,
          incident: incident,
          incidentTemplateVariables: incidentTemplateVariables,
          statusPage: statusPage,
          statusPageUrl: statusPageUrl,
          detailsUrl: detailsUrl,
          pageTemplateVariables: pageTemplateVariables,
          host: host,
          httpProtocol: httpProtocol,
        });

      result.statusPages.push({
        statusPage: statusPage,
        statusPageId: audiencePage.statusPageId,
        name: audiencePage.name,
        subscriberCounts: { ...audiencePage.subscriberCounts },
        templateChoice: pageEmail.templateChoice,
        /*
         * Every subscriber's link carries their own token; a preview has no
         * subscriber, so it carries a link that names none.
         */
        email: pageEmail.forSubscriber({
          unsubscribeUrl:
            SubscriberNotificationPreview.getPreviewUnsubscribeUrl(
              statusPageUrl,
            ),
        }),
      });
    }

    return result;
  }

  /*
   * Why nothing will be sent, in the order the jobs find it out: no monitor,
   * an incident hidden from status pages, a draft that will be private or
   * does not notify, and no page that will show it.
   */
  public static getNothingSentReason(data: {
    audience: IncidentSubscriberAudienceResult;
    draftNothingSentReason: SubscriberNotificationPreviewNothingSentReason | null;
  }): SubscriberNotificationPreviewNothingSentReason | null {
    if (!data.audience.hasMonitors) {
      return SubscriberNotificationPreviewNothingSentReason.NoMonitors;
    }

    if (data.audience.isHiddenFromStatusPages) {
      return SubscriberNotificationPreviewNothingSentReason.HiddenFromStatusPages;
    }

    if (data.draftNothingSentReason) {
      return data.draftNothingSentReason;
    }

    if (
      data.audience.statusPages.length === 0 &&
      data.audience.hiddenStatusPageCount === 0
    ) {
      return SubscriberNotificationPreviewNothingSentReason.NoStatusPages;
    }

    return null;
  }

  /*
   * The request body of POST /preview. Anything that is not a request is
   * refused with what is wrong, rather than previewed as something else.
   */
  public static parseRequest(
    body: unknown,
  ): SubscriberNotificationPreviewRequest {
    const json: JSONObject = this.asObject(body, "The request");

    if (json["event"] === SubscriberNotificationPreviewEvent.IncidentCreated) {
      const incident: JSONObject = this.asObject(json["incident"], "incident");

      const draft: SubscriberNotificationPreviewIncidentDraft = {
        title: this.parseText(
          incident["title"],
          "incident.title",
          SubscriberNotificationPreview.maxTitleLength,
        ),
        description: this.parseText(
          incident["description"],
          "incident.description",
          SubscriberNotificationPreview.maxTextLength,
        ),
        incidentSeverityId:
          incident["incidentSeverityId"] === undefined ||
          incident["incidentSeverityId"] === null ||
          incident["incidentSeverityId"] === ""
            ? null
            : this.parseId(
                incident["incidentSeverityId"],
                "incident.incidentSeverityId",
              ),
        monitorIds: this.parseIds(
          incident["monitorIds"],
          "incident.monitorIds",
        ),
        statusPageIds: this.parseIds(
          incident["statusPageIds"],
          "incident.statusPageIds",
        ),
        labelIds: this.parseIds(incident["labelIds"], "incident.labelIds"),
        customFields:
          incident["customFields"] === undefined ||
          incident["customFields"] === null
            ? {}
            : this.asObject(incident["customFields"], "incident.customFields"),
        isPrivate: incident["isPrivate"] === true,
        // On unless it is switched off, as it is on the form.
        shouldStatusPageSubscribersBeNotifiedOnIncidentCreated:
          incident["shouldStatusPageSubscribersBeNotifiedOnIncidentCreated"] !==
          false,
      };

      return {
        event: SubscriberNotificationPreviewEvent.IncidentCreated,
        incident: draft,
      };
    }

    if (
      json["event"] ===
      SubscriberNotificationPreviewEvent.IncidentPublicNoteCreated
    ) {
      return {
        event: SubscriberNotificationPreviewEvent.IncidentPublicNoteCreated,
        incidentId: this.parseId(json["incidentId"], "incidentId"),
        note: this.parseText(
          json["note"],
          "note",
          SubscriberNotificationPreview.maxTextLength,
        ),
        postedAt: this.parseDate(json["postedAt"], "postedAt"),
      };
    }

    throw new BadDataException(
      `event must be one of: ${Object.values(
        SubscriberNotificationPreviewEvent,
      ).join(", ")}.`,
    );
  }

  /*
   * The request body of POST /send-test: a preview request and the status
   * page whose email to send. It takes no address: the test goes to the
   * caller's own, and a toEmail in the body is not read.
   */
  public static parseSendTestRequest(
    body: unknown,
  ): SubscriberNotificationSendTestRequest {
    const request: SubscriberNotificationPreviewRequest =
      this.parseRequest(body);
    const json: JSONObject = this.asObject(body, "The request");

    return {
      ...request,
      statusPageId: this.parseId(json["statusPageId"], "statusPageId"),
    };
  }

  // An incident being declared, from the form's values.
  private static async resolveDraft(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    draft: SubscriberNotificationPreviewIncidentDraft;
  }): Promise<PreviewIncident> {
    const draft: SubscriberNotificationPreviewIncidentDraft = data.draft;

    const [severity, labels, customFieldDefinitions]: [
      IncidentSeverity | null,
      Array<Label>,
      Array<CustomFieldDefinition>,
    ] = await Promise.all([
      this.readSeverity({
        projectId: data.projectId,
        incidentSeverityId: draft.incidentSeverityId,
      }),
      this.readLabels({
        projectId: data.projectId,
        labelIds: draft.labelIds,
      }),
      this.readCustomFieldDefinitions(data.projectId),
    ]);

    /*
     * The values must fit their fields, as they must when the incident is
     * declared: a preview of an incident that cannot be declared says why.
     */
    const customFieldErrors: ReturnType<typeof validateCustomFieldValues> =
      validateCustomFieldValues({
        definitions: customFieldDefinitions,
        customFields: draft.customFields,
        storedCustomFields: {},
      });

    if (customFieldErrors.length > 0) {
      throw new BadDataException(
        formatCustomFieldValueValidationErrors(customFieldErrors),
      );
    }

    const incident: Incident = new Incident();
    incident.projectId = data.projectId;
    incident.title = draft.title;
    incident.description = draft.description;
    if (severity) {
      incident.incidentSeverity = severity;
    }
    incident.labels = labels;
    incident.customFields = { ...draft.customFields };
    incident.monitors = draft.monitorIds.map((id: string): Monitor => {
      const monitor: Monitor = new Monitor();
      monitor._id = id;
      return monitor;
    });

    /*
     * The values a custom field mapping copies from the monitors, as
     * declaring the incident adds them (IncidentService.onBeforeCreate).
     */
    await CustomFieldMappingService.applyMappingsToCreate({
      definitionModelType: IncidentCustomField,
      createBy: {
        data: incident,
        props: {
          tenantId: data.projectId,
          isRoot: true,
        },
      },
    });

    let draftNothingSentReason: SubscriberNotificationPreviewNothingSentReason | null =
      null;

    if (draft.isPrivate) {
      draftNothingSentReason =
        SubscriberNotificationPreviewNothingSentReason.PrivateIncident;
    } else if (!draft.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated) {
      draftNothingSentReason =
        SubscriberNotificationPreviewNothingSentReason.NotifyOff;
    }

    return {
      event: SubscriberIncidentEmailEvent.IncidentCreated,
      incident: incident,
      audienceRequest: {
        projectId: data.projectId,
        props: data.props,
        monitorIds: draft.monitorIds.map((id: string): ObjectID => {
          return new ObjectID(id);
        }),
        statusPageIds: draft.statusPageIds.map((id: string): ObjectID => {
          return new ObjectID(id);
        }),
      },
      draftNothingSentReason: draftNothingSentReason,
    };
  }

  /*
   * A public note being written on an incident that exists. The incident is
   * not read here: the audience reads it first, with the caller's own
   * permissions (see build).
   */
  private static async resolvePublicNote(data: {
    projectId: ObjectID;
    props: DatabaseCommonInteractionProps;
    incidentId: string;
    note: string;
    postedAt: Date | null;
  }): Promise<PreviewIncident> {
    return {
      event: SubscriberIncidentEmailEvent.IncidentPublicNoteCreated,
      incident: new Incident(),
      note: {
        text: data.note,
        postedAt: data.postedAt,
      },
      audienceRequest: {
        projectId: data.projectId,
        props: data.props,
        incidentId: new ObjectID(data.incidentId),
      },
      draftNothingSentReason: null,
    };
  }

  /*
   * What the public note job reads of the incident. Read as root: the caller
   * has been shown to read the incident (the audience read it with their
   * permissions), and these are its own title, severity, state, labels and
   * custom field values.
   */
  private static async readIncidentContent(data: {
    projectId: ObjectID;
    incidentId: ObjectID;
  }): Promise<Incident> {
    const incident: Incident | null = await IncidentService.findOneBy({
      query: {
        _id: data.incidentId,
        projectId: data.projectId,
      },
      select: {
        _id: true,
        title: true,
        description: true,
        projectId: true,
        monitors: {
          _id: true,
        },
        incidentSeverity: {
          name: true,
        },
        currentIncidentState: {
          name: true,
        },
        labels: {
          name: true,
        },
        customFields: true,
      },
      props: {
        isRoot: true,
      },
    });

    // Deleted since the caller's read.
    if (!incident) {
      throw new NotFoundException("Incident not found");
    }

    return incident;
  }

  private static async readSeverity(data: {
    projectId: ObjectID;
    incidentSeverityId: string | null;
  }): Promise<IncidentSeverity | null> {
    if (!data.incidentSeverityId) {
      return null;
    }

    const severity: IncidentSeverity | null =
      await IncidentSeverityService.findOneBy({
        query: {
          _id: data.incidentSeverityId,
          projectId: data.projectId,
        },
        select: {
          _id: true,
          name: true,
        },
        props: {
          isRoot: true,
        },
      });

    if (!severity) {
      throw new BadDataException(
        "This incident severity was not found in this project.",
      );
    }

    return severity;
  }

  private static async readLabels(data: {
    projectId: ObjectID;
    labelIds: Array<string>;
  }): Promise<Array<Label>> {
    if (data.labelIds.length === 0) {
      return [];
    }

    const labels: Array<Label> = await LabelService.findBy({
      query: {
        _id: QueryHelper.any(data.labelIds),
        projectId: data.projectId,
      },
      select: {
        _id: true,
        name: true,
      },
      limit: data.labelIds.length,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const found: Array<string> = labels.map((label: Label): string => {
      return this.getId(label);
    });

    const isEveryLabelFound: boolean = data.labelIds.every(
      (id: string): boolean => {
        return found.includes(id);
      },
    );

    if (!isEveryLabelFound) {
      throw new BadDataException(
        "One or more of these labels were not found in this project.",
      );
    }

    return labels;
  }

  // The project's incident custom fields, as the values are checked against.
  private static async readCustomFieldDefinitions(
    projectId: ObjectID,
  ): Promise<Array<CustomFieldDefinition>> {
    const fields: Array<IncidentCustomField> =
      await IncidentCustomFieldService.findBy({
        query: {
          projectId: projectId,
        },
        select: {
          name: true,
          customFieldType: true,
          dropdownOptions: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    const definitions: Array<CustomFieldDefinition> = [];

    for (const field of fields) {
      if (typeof field.name === "string") {
        definitions.push({
          name: field.name,
          customFieldType: field.customFieldType,
          dropdownOptions: field.dropdownOptions,
        });
      }
    }

    return definitions;
  }

  private static findAudiencePage(
    audience: IncidentSubscriberAudienceResult,
    statusPage: StatusPage,
  ): IncidentSubscriberAudienceStatusPage | undefined {
    const id: string = this.getId(statusPage);

    return audience.statusPages.find(
      (page: IncidentSubscriberAudienceStatusPage): boolean => {
        return page.statusPageId.toLowerCase() === id;
      },
    );
  }

  private static getId(model: StatusPage | Label): string {
    return (model._id || model.id?.toString() || "").toString().toLowerCase();
  }

  private static asObject(value: unknown, name: string): JSONObject {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      throw new BadDataException(`${name} must be an object.`);
    }

    return value as JSONObject;
  }

  private static parseText(
    value: unknown,
    name: string,
    maxLength: number,
  ): string {
    if (value === undefined || value === null) {
      return "";
    }

    if (typeof value !== "string") {
      throw new BadDataException(`${name} must be text.`);
    }

    if (value.length > maxLength) {
      throw new BadDataException(
        `${name} can be at most ${maxLength} characters long.`,
      );
    }

    return value;
  }

  // An id, lower-cased as the database returns ids.
  private static parseId(value: unknown, name: string): string {
    let id: string = "";

    if (typeof value === "string") {
      id = value;
    } else if (value instanceof ObjectID) {
      id = value.toString();
    } else if (value && typeof value === "object") {
      id = new ObjectID(value as JSONObject).toString();
    }

    id = id.trim();

    if (!id || !ObjectID.isValidUUID(id)) {
      throw new BadDataException(`${name} must be a valid ID.`);
    }

    return id.toLowerCase();
  }

  private static parseIds(value: unknown, name: string): Array<string> {
    if (value === undefined || value === null) {
      return [];
    }

    if (!Array.isArray(value)) {
      throw new BadDataException(`${name} must be a list of IDs.`);
    }

    if (value.length > IncidentSubscriberAudience.maxIdsPerRequest) {
      throw new BadDataException(
        `${name} can list at most ${IncidentSubscriberAudience.maxIdsPerRequest} IDs.`,
      );
    }

    return IncidentScopeAddedPagesNotification.normalizeStatusPageIds(
      value.map((item: unknown): string => {
        return this.parseId(item, name);
      }),
    );
  }

  private static parseDate(value: unknown, name: string): Date | null {
    if (value === undefined || value === null || value === "") {
      return null;
    }

    if (typeof value !== "string" && !(value instanceof Date)) {
      throw new BadDataException(`${name} must be a date.`);
    }

    // An ISO date as the dashboard sends it (Date.toISOString).
    const date: Date = value instanceof Date ? value : new Date(value);

    if (Number.isNaN(date.getTime())) {
      throw new BadDataException(`${name} must be a date.`);
    }

    return date;
  }
}
