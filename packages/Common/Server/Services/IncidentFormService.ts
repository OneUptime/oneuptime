import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { IsBillingEnabled, getAllEnvVars } from "../EnvironmentConfig";
import DatabaseService from "./DatabaseService";
import IncidentCustomFieldService from "./IncidentCustomFieldService";
import IncidentFormSubmissionService from "./IncidentFormSubmissionService";
import IncidentInternalNoteService from "./IncidentInternalNoteService";
import IncidentService from "./IncidentService";
import IncidentSeverityService from "./IncidentSeverityService";
import IncidentTemplateOwnerTeamService from "./IncidentTemplateOwnerTeamService";
import IncidentTemplateOwnerUserService from "./IncidentTemplateOwnerUserService";
import IncidentTemplateService from "./IncidentTemplateService";
import ProjectService, { CurrentPlan } from "./ProjectService";
import SortOrder from "../../Types/BaseDatabase/SortOrder";
import SubscriptionPlan, {
  PlanType,
} from "../../Types/Billing/SubscriptionPlan";
import {
  CustomFieldCreateSettings,
  compactCustomFieldCreateSettings,
  getIncidentFormAskedDefinitions,
  validateCustomFieldCreateSettings,
} from "../../Types/CustomField/CustomFieldCreateSettings";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import QueryDeepPartialEntity from "../../Types/Database/PartialEntity";
import Dictionary from "../../Types/Dictionary";
import Email from "../../Types/Email";
import BadDataException from "../../Types/Exception/BadDataException";
import ForbiddenException from "../../Types/Exception/ForbiddenException";
import NotFoundException from "../../Types/Exception/NotFoundException";
import ServerException from "../../Types/Exception/ServerException";
import {
  IncidentFormSubmissionValidationResult,
  PublicIncidentForm,
  PublicIncidentFormSeverity,
  PublicIncidentFormSubmissionRequest,
  PublicIncidentFormSubmissionResult,
  ValidatedIncidentFormSubmission,
  formatIncidentFormSubmissionErrors,
  getPublicIncidentForm,
  isIncidentFormFieldSetting,
  validateIncidentFormSubmission,
} from "../../Types/Incident/IncidentFormPublic";
import IP from "../../Types/IP/IP";
import ObjectID from "../../Types/ObjectID";
import { escapeMarkdownInline } from "../../Utils/Markdown/MarkdownEscape";
import Incident from "../../Models/DatabaseModels/Incident";
import IncidentCustomField from "../../Models/DatabaseModels/IncidentCustomField";
import Model from "../../Models/DatabaseModels/IncidentForm";
import IncidentFormSubmission from "../../Models/DatabaseModels/IncidentFormSubmission";
import IncidentInternalNote from "../../Models/DatabaseModels/IncidentInternalNote";
import IncidentSeverity from "../../Models/DatabaseModels/IncidentSeverity";
import IncidentTemplate from "../../Models/DatabaseModels/IncidentTemplate";
import IncidentTemplateOwnerTeam from "../../Models/DatabaseModels/IncidentTemplateOwnerTeam";
import IncidentTemplateOwnerUser from "../../Models/DatabaseModels/IncidentTemplateOwnerUser";
import CaptchaUtil from "../Utils/Captcha";
import ProjectScopedReferenceValidator, {
  ProjectScopedReference,
  resolveReferenceId,
} from "../Utils/Database/ProjectScopedReferenceValidator";
import logger, { LogAttributes } from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

/*
 * What an incident form may hold. The public page that submits a form - and
 * the incident each submission declares - trust everything checked here, so
 * a form is refused at the write that would make it wrong rather than at a
 * stranger's submission:
 *
 *   - its link key is minted on create, never taken from the request, and
 *     only ever replaced by another UUID;
 *   - its custom field questions and description question are settings the
 *     public page and the submit route understand;
 *   - its severity and template belong to its own project, because every
 *     incident declared through it is created in that project with them;
 *   - it has a severity: a submission needs one, and "incidentSeverityId is
 *     required" says less than the message below.
 *
 * The public routes themselves live in IncidentFormAPI, and are thin: what a
 * visitor is told about a form and what a submission turns into are decided
 * here, in getPublicForm and submitPublicForm.
 */

export const INCIDENT_FORM_SEVERITY_REQUIRED_MESSAGE: string =
  "An incident form needs a severity for the incidents it declares. Choose one of the project's incident severities.";

export const INCIDENT_FORM_DESCRIPTION_SETTING_MESSAGE: string =
  "Description Question must be Required, Optional or Hidden.";

export const INCIDENT_FORM_SHARE_KEY_MESSAGE: string =
  "Share Key must be a UUID, such as the one the dashboard's Reset Link generates.";

/*
 * The one answer a public request gets for every form it may not use: a
 * link that is malformed or names no form, a form that is turned off, and a
 * form whose project's plan does not include forms. They all read the same,
 * word for word and status for status, so trying links tells a stranger
 * nothing about which forms exist or why one is unavailable.
 */
export const INCIDENT_FORM_NOT_AVAILABLE_MESSAGE: string =
  "This form is not available. It may have been turned off, or the link may be out of date.";

/*
 * The form's IP allowlist refused the visitor. Only reached for a form that
 * exists and is on, so it can say what is wrong: the visitor can do
 * something about their network, and nothing about a form that is gone.
 */
export const INCIDENT_FORM_NETWORK_NOT_ALLOWED_MESSAGE: string =
  "This form can only be opened from an allowed network.";

/*
 * Neither the reporter, the form nor its template has a severity - the
 * form's own was deleted (the column is cleared with it) and the template
 * sets none. The reporter cannot fix that, so the message asks them to tell
 * the people who can.
 */
export const INCIDENT_FORM_NO_SEVERITY_MESSAGE: string =
  "This form cannot declare an incident because it has no severity. Please let the team that shared it know.";

/*
 * Declaring the incident itself failed. Why is logged with the form and the
 * project; the reporter, who can only try again, is not handed internal
 * messages or ids.
 */
export const INCIDENT_FORM_SUBMIT_FAILED_MESSAGE: string =
  "Your report could not be submitted. Please try again in a few minutes.";

export type GetIncidentFormReporterNoteFunction = (data: {
  formName?: string | null | undefined;
  reporterName?: string | null | undefined;
  reporterEmail?: string | null | undefined;
}) => string;

/**
 * The private note a submission leaves on the incident it declared: which
 * form it came through, and who sent it as far as they said. Private, so the
 * reporter's name and address never reach a status page the way the
 * incident's description can.
 *
 * Every value is escaped where it is placed, as every feed sentence the
 * server writes escapes the names in it. The note is posted as it is - no
 * person reads it over first - so a name such as "[x](javascript:...)" must
 * reach the responders as those characters, not as a link, and "**bold**"
 * as asterisks rather than as emphasis. The form's name is escaped too: an
 * admin chose it, but it sits inside the note's own bold.
 */
export const getIncidentFormReporterNote: GetIncidentFormReporterNoteFunction =
  (data: {
    formName?: string | null | undefined;
    reporterName?: string | null | undefined;
    reporterEmail?: string | null | undefined;
  }): string => {
    const formName: string = escapeMarkdownInline(data.formName).trim();
    const form: string = formName
      ? `the incident form **${formName}**`
      : "an incident form";

    const reporterName: string = escapeMarkdownInline(data.reporterName).trim();
    const reporterEmail: string = escapeMarkdownInline(
      data.reporterEmail,
    ).trim();

    if (reporterName && reporterEmail) {
      return `Reported through ${form} by ${reporterName} (${reporterEmail}).`;
    }

    if (reporterName || reporterEmail) {
      return `Reported through ${form} by ${reporterName || reporterEmail}.`;
    }

    return `Reported anonymously through ${form}.`;
  };

export class Service extends DatabaseService<Model> {
  public constructor() {
    super(Model);
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    /*
     * Always a fresh key, whatever the request carried: a key the caller
     * chose could be one somebody else already knows. The column is computed,
     * so a key in the request is not refused - it is replaced.
     */
    createBy.data.shareKey = ObjectID.generate();

    if (
      !resolveReferenceId(createBy.data.incidentSeverityId) &&
      !resolveReferenceId(createBy.data.incidentSeverity)
    ) {
      throw new BadDataException(INCIDENT_FORM_SEVERITY_REQUIRED_MESSAGE);
    }

    this.assertValidCustomFieldSettings(createBy.data.customFieldSettings);

    /*
     * Null is the column's default on create (DatabaseService drops a null
     * sent for a default-value column), so only a value is checked here.
     */
    if (
      createBy.data.descriptionSetting !== undefined &&
      createBy.data.descriptionSetting !== null
    ) {
      this.assertValidDescriptionSetting(createBy.data.descriptionSetting);
    }

    await ProjectScopedReferenceValidator.validateReferencesBelongToProject({
      projectId: createBy.props.tenantId || createBy.data.projectId,
      subject: "incident form",
      references: this.getProjectScopedReferences(createBy.data),
    });

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    const data: Dictionary<unknown> = updateBy.data as Dictionary<unknown>;

    /*
     * The severity column is nullable only so that deleting a severity
     * leaves its forms behind; clearing it by hand would leave a form that
     * refuses every submission.
     */
    for (const column of ["incidentSeverityId", "incidentSeverity"]) {
      if (
        Object.prototype.hasOwnProperty.call(data, column) &&
        data[column] !== undefined &&
        !resolveReferenceId(data[column])
      ) {
        throw new BadDataException(INCIDENT_FORM_SEVERITY_REQUIRED_MESSAGE);
      }
    }

    if (data["customFieldSettings"] !== undefined) {
      this.assertValidCustomFieldSettings(data["customFieldSettings"]);
    }

    // NOT NULL in the database, so null is refused here rather than there.
    if (data["descriptionSetting"] !== undefined) {
      this.assertValidDescriptionSetting(data["descriptionSetting"]);
    }

    if (data["shareKey"] !== undefined) {
      this.assertValidShareKey(data["shareKey"]);
    }

    const references: Array<ProjectScopedReference> =
      this.getProjectScopedReferences(updateBy.data);

    if (
      references.every((reference: ProjectScopedReference) => {
        return !reference.id;
      })
    ) {
      return { updateBy, carryForward: null };
    }

    /*
     * Root/API updates do not always carry a tenantId, so fall back to the
     * project of each form the query actually matches.
     */
    const projectIds: Array<ObjectID> = updateBy.props.tenantId
      ? [updateBy.props.tenantId]
      : await this.getProjectIdsForUpdateQuery(updateBy);

    for (const projectId of projectIds) {
      await ProjectScopedReferenceValidator.validateReferencesBelongToProject({
        projectId: projectId,
        subject: "incident form",
        references: references,
      });
    }

    return { updateBy, carryForward: null };
  }

  /**
   * What the public page shows for the form a link names: its questions, in
   * the safe subset getPublicIncidentForm builds field by field - never the
   * form's id, project, template, link key or allowlist, never a custom
   * field the form does not ask, and the project's severities only when the
   * reporter may choose one.
   *
   * clientIp is the trusted client address (resolveClientIp), or undefined
   * when there is none; a form with an IP allowlist refuses the latter.
   */
  @CaptureSpan()
  public async getPublicForm(data: {
    shareKey: string | undefined;
    clientIp: string | undefined;
  }): Promise<PublicIncidentForm> {
    const form: Model = await this.getFormForPublicRequest(data);

    const [askedDefinitions, severities]: [
      Array<IncidentCustomField>,
      Array<PublicIncidentFormSeverity>,
    ] = await Promise.all([
      this.getAskedCustomFields(form),
      this.getSeveritiesForReporter(form),
    ]);

    return getPublicIncidentForm({
      form: form,
      askedDefinitions: askedDefinitions,
      severities: severities,
      isCaptchaRequired: CaptchaUtil.isCaptchaEnabled(),
    });
  }

  /**
   * Declares the incident a public submission reports, and tells the
   * reporter its number.
   *
   * In order, each step refusing before the next one costs anything: the
   * same checks as getPublicForm (link, form on, plan, network), then the
   * instance captcha when it is on, then the answers against the form's
   * questions (validateIncidentFormSubmission), then the severity. Only then
   * is the incident created, as root, from the validated answers and the
   * form's own settings - nothing else in the request reaches it, least of
   * all a project id: the incident goes to the form's project.
   *
   * Once the incident exists the reporter is told it was declared whatever
   * happens next. The template's owners, the submission record and the
   * private note are each attempted, and a failure is logged rather than
   * turned into an error that would invite the reporter to send - and page
   * on-call with - the same report again.
   */
  @CaptureSpan()
  public async submitPublicForm(data: {
    shareKey: string | undefined;
    request: PublicIncidentFormSubmissionRequest;
    clientIp: string | undefined;
    // The address hCaptcha is told the token was solved from.
    captchaRemoteIp?: string | undefined;
  }): Promise<PublicIncidentFormSubmissionResult> {
    const form: Model = await this.getFormForPublicRequest({
      shareKey: data.shareKey,
      clientIp: data.clientIp,
    });

    if (CaptchaUtil.isCaptchaEnabled()) {
      await CaptchaUtil.verifyCaptcha({
        token: data.request?.captchaToken,
        remoteIp: data.captchaRemoteIp || null,
      });
    }

    const [askedDefinitions, severities]: [
      Array<IncidentCustomField>,
      Array<PublicIncidentFormSeverity>,
    ] = await Promise.all([
      this.getAskedCustomFields(form),
      this.getSeveritiesForReporter(form),
    ]);

    const validation: IncidentFormSubmissionValidationResult =
      validateIncidentFormSubmission({
        form: form,
        askedDefinitions: askedDefinitions,
        severities: severities,
        data: data.request?.data,
      });

    if (!validation.isValid) {
      throw new BadDataException(
        formatIncidentFormSubmissionErrors(validation.errors),
      );
    }

    const answers: ValidatedIncidentFormSubmission = validation.value;

    const incidentSeverityId: ObjectID | undefined =
      await this.getSubmissionSeverityId({ form, answers });

    const incident: Incident = await this.declareIncident({
      form,
      answers,
      incidentSeverityId,
    });

    if (incident.id) {
      await this.addTemplateOwners({ form, incidentId: incident.id });
      await this.recordSubmission({ form, incidentId: incident.id, answers });
      await this.addReporterNote({ form, incidentId: incident.id, answers });
    } else {
      logger.error(
        `IncidentFormService: incident form ${form.id?.toString()} declared an incident that came back without an id; its owners, submission and note were not added.`,
        this.getLogAttributes(form),
      );
    }

    const result: PublicIncidentFormSubmissionResult = {};

    const incidentNumber: string | undefined =
      incident.incidentNumberWithPrefix ||
      (typeof incident.incidentNumber === "number"
        ? `#${incident.incidentNumber}`
        : undefined);

    if (incidentNumber) {
      result.incidentNumber = incidentNumber;
    }

    if (form.successMessage && form.successMessage.trim().length > 0) {
      result.successMessage = form.successMessage;
    }

    return result;
  }

  /*
   * Whether the form's project is on a plan that includes incident forms.
   *
   * Checked by hand because the public routes read as root, and root never
   * carries a plan, so the model's @TableBillingAccessControl never runs for
   * them. Fails closed: a project whose plan cannot be read (deleted
   * mid-request, still onboarding) is treated as below plan - that costs one
   * "not available" page, where failing open would let anyone with a link
   * page on-call on a plan that does not include forms.
   */
  @CaptureSpan()
  public async isProjectOnPlan(projectId: ObjectID): Promise<boolean> {
    if (!IsBillingEnabled) {
      return true;
    }

    try {
      const current: CurrentPlan =
        await ProjectService.getCurrentPlan(projectId);

      if (!current.plan) {
        return false;
      }

      return SubscriptionPlan.isFeatureAccessibleOnCurrentPlan(
        PlanType.Growth,
        current.plan,
        getAllEnvVars(),
      );
    } catch (err) {
      logger.warn(
        `IncidentFormService: could not read the plan of project ${projectId.toString()}; treating it as below plan.`,
      );
      logger.warn(err);
      return false;
    }
  }

  /*
   * Whether a form's IP allowlist lets this client address in: one IP
   * address or CIDR range per line, as the dashboard's public IP allowlist.
   * The same address resolution as the dashboard's too (resolveClientIp: the
   * trusted end of X-Forwarded-For), so a caller cannot name their own
   * address by sending the header.
   *
   * A list with no entries - empty, or only blank lines left behind by a
   * textarea - lets anyone in, as the column's description promises. Once
   * there is an entry, a request whose address cannot be established is
   * refused, and so is one IP.isInWhitelist cannot read: this is an access
   * decision, so every doubt is a no.
   */
  public isClientIpAllowed(data: {
    ipWhitelist: string | null | undefined;
    clientIp: string | undefined;
  }): boolean {
    const entries: Array<string> = (data.ipWhitelist || "")
      .split(/\r?\n/)
      .map((entry: string): string => {
        return entry.trim();
      })
      .filter((entry: string): boolean => {
        return entry.length > 0;
      });

    if (entries.length === 0) {
      return true;
    }

    if (!data.clientIp) {
      return false;
    }

    try {
      return IP.isInWhitelist({
        ip: data.clientIp,
        whitelist: entries,
      });
    } catch {
      return false;
    }
  }

  /*
   * The form a public request names, once the request has passed every
   * check that comes before learning anything about it. Checked in this
   * order, each needing the one before: the link has a share key's shape
   * (so junk never reaches Postgres), a form holds that key, the form is on,
   * its project's plan includes forms, and the visitor's network is allowed.
   */
  private async getFormForPublicRequest(data: {
    shareKey: string | undefined;
    clientIp: string | undefined;
  }): Promise<Model> {
    const shareKey: string =
      typeof data.shareKey === "string"
        ? data.shareKey.trim().toLowerCase()
        : "";

    if (!ObjectID.isValidUUID(shareKey)) {
      throw new NotFoundException(INCIDENT_FORM_NOT_AVAILABLE_MESSAGE);
    }

    const form: Model | null = await this.findOneBy({
      query: {
        shareKey: new ObjectID(shareKey),
      },
      select: {
        _id: true,
        projectId: true,
        name: true,
        description: true,
        isEnabled: true,
        incidentSeverityId: true,
        allowReporterToChooseSeverity: true,
        incidentTemplateId: true,
        descriptionSetting: true,
        customFieldSettings: true,
        isReporterDetailsRequired: true,
        successMessage: true,
        ipWhitelist: true,
      },
      props: {
        isRoot: true,
      },
    });

    // Only a form that is switched on. A missing or null switch is off.
    if (!form || !form.id || !form.projectId || form.isEnabled !== true) {
      throw new NotFoundException(INCIDENT_FORM_NOT_AVAILABLE_MESSAGE);
    }

    if (!(await this.isProjectOnPlan(form.projectId))) {
      throw new NotFoundException(INCIDENT_FORM_NOT_AVAILABLE_MESSAGE);
    }

    if (
      !this.isClientIpAllowed({
        ipWhitelist: form.ipWhitelist,
        clientIp: data.clientIp,
      })
    ) {
      if (!data.clientIp) {
        logger.error(
          `IncidentFormService: could not establish the client address of a request to incident form ${form.id.toString()}, which has an IP allowlist; refused.`,
          this.getLogAttributes(form),
        );
      }

      throw new ForbiddenException(INCIDENT_FORM_NETWORK_NOT_ALLOWED_MESSAGE);
    }

    return form;
  }

  /*
   * The custom fields the form asks, in the order to ask them, with each
   * one's Required taken from the form (getIncidentFormAskedDefinitions).
   * The same list serves the page and checks the answers, so a submission
   * can only answer what the page showed. A form that asks no field does
   * not read the project's fields at all.
   */
  private async getAskedCustomFields(
    form: Model,
  ): Promise<Array<IncidentCustomField>> {
    const askedSettings: CustomFieldCreateSettings =
      compactCustomFieldCreateSettings(form.customFieldSettings, {
        dropHidden: true,
      });

    if (Object.keys(askedSettings).length === 0) {
      return [];
    }

    const definitions: Array<IncidentCustomField> =
      await IncidentCustomFieldService.findBy({
        query: {
          projectId: form.projectId!,
        },
        select: {
          name: true,
          description: true,
          customFieldType: true,
          dropdownOptions: true,
          variableKey: true,
          sortOrder: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    return getIncidentFormAskedDefinitions(
      definitions,
      form.customFieldSettings,
    );
  }

  /*
   * The project's severities, in their own order, for a form that lets the
   * reporter choose one; none otherwise, since nothing would use them. Both
   * what the page lists and what a submission's choice is checked against.
   */
  private async getSeveritiesForReporter(
    form: Model,
  ): Promise<Array<PublicIncidentFormSeverity>> {
    if (form.allowReporterToChooseSeverity !== true) {
      return [];
    }

    const severities: Array<IncidentSeverity> =
      await IncidentSeverityService.findBy({
        query: {
          projectId: form.projectId!,
        },
        select: {
          _id: true,
          name: true,
          color: true,
          order: true,
        },
        sort: {
          order: SortOrder.Ascending,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    const listed: Array<PublicIncidentFormSeverity> = [];

    for (const severity of severities) {
      if (!severity.id) {
        continue;
      }

      const entry: PublicIncidentFormSeverity = {
        _id: severity.id.toString(),
        name: severity.name || "",
      };

      if (severity.color) {
        entry.color = severity.color.toString();
      }

      listed.push(entry);
    }

    return listed;
  }

  /*
   * The severity to declare the incident with: the reporter's choice when
   * the form offers one and they made it (validateIncidentFormSubmission has
   * already checked it is one of the project's), otherwise the form's own.
   *
   * A form's severity is required, but deleting that severity clears it, so
   * a form can be left without one. Then its template's severity applies -
   * returned as "none" so IncidentService's template branch fills it in -
   * and with no template severity either the submission is refused here,
   * with a message the reporter can pass on, rather than failing inside the
   * create as a missing required column.
   */
  private async getSubmissionSeverityId(data: {
    form: Model;
    answers: ValidatedIncidentFormSubmission;
  }): Promise<ObjectID | undefined> {
    if (data.answers.incidentSeverityId) {
      return new ObjectID(data.answers.incidentSeverityId);
    }

    if (data.form.incidentSeverityId) {
      return data.form.incidentSeverityId;
    }

    if (data.form.incidentTemplateId) {
      const template: IncidentTemplate | null =
        await IncidentTemplateService.findOneBy({
          query: {
            _id: data.form.incidentTemplateId.toString(),
            projectId: data.form.projectId!,
          },
          select: {
            incidentSeverityId: true,
          },
          props: {
            isRoot: true,
          },
        });

      if (template?.incidentSeverityId) {
        return undefined;
      }
    }

    throw new BadDataException(INCIDENT_FORM_NO_SEVERITY_MESSAGE);
  }

  /*
   * Creates the incident, as root, in the form's project.
   *
   * With a template, createdIncidentTemplateId hands the rest to
   * IncidentService's template branch: the initial state, the severity when
   * none is set here, the description when the reporter wrote none, the
   * monitors, services, labels, on-call policies and status pages, and the
   * template's custom field values under the reporter's answers. That branch
   * only runs when no state is given, so currentIncidentStateId is never set
   * here; and it only fills in what is undefined, so an unanswered
   * description is left out rather than sent empty.
   *
   * The incident starts off every status page and without notifying their
   * subscribers, whatever the template says: a stranger's report is for the
   * responders to triage before anything about it is published. It is not
   * private, and has no creating user - nobody signed in to send it.
   */
  private async declareIncident(data: {
    form: Model;
    answers: ValidatedIncidentFormSubmission;
    incidentSeverityId: ObjectID | undefined;
  }): Promise<Incident> {
    const incident: Incident = new Incident();
    incident.projectId = data.form.projectId!;
    incident.title = data.answers.title;

    if (data.answers.description) {
      incident.description = data.answers.description;
    }

    if (data.incidentSeverityId) {
      incident.incidentSeverityId = data.incidentSeverityId;
    }

    if (data.form.incidentTemplateId) {
      incident.createdIncidentTemplateId =
        data.form.incidentTemplateId.toString();
    }

    incident.customFields = data.answers.customFields;
    incident.isVisibleOnStatusPage = false;
    incident.shouldStatusPageSubscribersBeNotifiedOnIncidentCreated = false;

    try {
      return await IncidentService.create({
        data: incident,
        props: {
          isRoot: true,
        },
      });
    } catch (err) {
      logger.error(
        `IncidentFormService: incident form ${data.form.id?.toString()} could not declare an incident.`,
        this.getLogAttributes(data.form),
      );
      logger.error(err, this.getLogAttributes(data.form));

      throw new ServerException(INCIDENT_FORM_SUBMIT_FAILED_MESSAGE);
    }
  }

  /*
   * The template's owners become the incident's, and are notified - they
   * are the people a report through this form is meant to reach. Nothing is
   * added when the form has no template, or its template no owners.
   */
  private async addTemplateOwners(data: {
    form: Model;
    incidentId: ObjectID;
  }): Promise<void> {
    if (!data.form.incidentTemplateId) {
      return;
    }

    try {
      const query: {
        incidentTemplateId: ObjectID;
        projectId: ObjectID;
      } = {
        incidentTemplateId: data.form.incidentTemplateId,
        projectId: data.form.projectId!,
      };

      const [ownerUsers, ownerTeams]: [
        Array<IncidentTemplateOwnerUser>,
        Array<IncidentTemplateOwnerTeam>,
      ] = await Promise.all([
        IncidentTemplateOwnerUserService.findBy({
          query: query,
          select: {
            userId: true,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: {
            isRoot: true,
          },
        }),
        IncidentTemplateOwnerTeamService.findBy({
          query: query,
          select: {
            teamId: true,
          },
          limit: LIMIT_PER_PROJECT,
          skip: 0,
          props: {
            isRoot: true,
          },
        }),
      ]);

      const userIds: Array<ObjectID> = [];

      for (const owner of ownerUsers) {
        if (owner.userId) {
          userIds.push(owner.userId);
        }
      }

      const teamIds: Array<ObjectID> = [];

      for (const owner of ownerTeams) {
        if (owner.teamId) {
          teamIds.push(owner.teamId);
        }
      }

      if (userIds.length === 0 && teamIds.length === 0) {
        return;
      }

      await IncidentService.addOwners(
        data.form.projectId!,
        data.incidentId,
        userIds,
        teamIds,
        true, // notify the owners
        {
          isRoot: true,
        },
      );
    } catch (err) {
      this.logFailureAfterIncident({
        form: data.form,
        incidentId: data.incidentId,
        step: "add the template's owners to",
        error: err,
      });
    }
  }

  // The record the dashboard lists under the form's Submissions.
  private async recordSubmission(data: {
    form: Model;
    incidentId: ObjectID;
    answers: ValidatedIncidentFormSubmission;
  }): Promise<void> {
    try {
      const submission: IncidentFormSubmission = new IncidentFormSubmission();
      submission.projectId = data.form.projectId!;
      submission.incidentFormId = data.form.id!;
      submission.incidentId = data.incidentId;

      if (data.answers.reporterName) {
        submission.reporterName = data.answers.reporterName;
      }

      if (data.answers.reporterEmail) {
        submission.reporterEmail = new Email(data.answers.reporterEmail);
      }

      await IncidentFormSubmissionService.create({
        data: submission,
        props: {
          isRoot: true,
        },
      });
    } catch (err) {
      this.logFailureAfterIncident({
        form: data.form,
        incidentId: data.incidentId,
        step: "record the submission for",
        error: err,
      });
    }
  }

  // Who reported the incident, where only the responders can read it.
  private async addReporterNote(data: {
    form: Model;
    incidentId: ObjectID;
    answers: ValidatedIncidentFormSubmission;
  }): Promise<void> {
    try {
      const note: IncidentInternalNote = new IncidentInternalNote();
      note.projectId = data.form.projectId!;
      note.incidentId = data.incidentId;
      note.note = getIncidentFormReporterNote({
        formName: data.form.name,
        reporterName: data.answers.reporterName,
        reporterEmail: data.answers.reporterEmail,
      });

      await IncidentInternalNoteService.create({
        data: note,
        props: {
          isRoot: true,
        },
      });
    } catch (err) {
      this.logFailureAfterIncident({
        form: data.form,
        incidentId: data.incidentId,
        step: "add the reporter's private note to",
        error: err,
      });
    }
  }

  private logFailureAfterIncident(data: {
    form: Model;
    incidentId: ObjectID;
    step: string;
    error: unknown;
  }): void {
    const attributes: LogAttributes = {
      ...this.getLogAttributes(data.form),
      incidentId: data.incidentId.toString(),
    };

    logger.error(
      `IncidentFormService: could not ${data.step} incident ${data.incidentId.toString()}, declared through incident form ${data.form.id?.toString()}. The incident stands.`,
      attributes,
    );
    logger.error(data.error, attributes);
  }

  private getLogAttributes(form: Model): LogAttributes {
    return {
      projectId: form.projectId?.toString(),
      incidentFormId: form.id?.toString(),
    };
  }

  /*
   * The public page asks exactly the fields these settings name, and the
   * submit route checks the answers against them, so a value they would
   * read as "nothing asked" must not be stored by mistake. Stored exactly as
   * sent when valid (see validateCustomFieldCreateSettings).
   */
  private assertValidCustomFieldSettings(value: unknown): void {
    const problem: string | null = validateCustomFieldCreateSettings(value);

    if (problem) {
      throw new BadDataException(problem);
    }
  }

  private assertValidDescriptionSetting(value: unknown): void {
    if (!isIncidentFormFieldSetting(value)) {
      throw new BadDataException(INCIDENT_FORM_DESCRIPTION_SETTING_MESSAGE);
    }
  }

  /*
   * Form editors may replace the key - the dashboard's Reset Link sends a
   * freshly generated UUID - but the column is a uuid, so anything else
   * would fail inside Postgres, and null would leave a form with no link.
   */
  private assertValidShareKey(value: unknown): void {
    const key: string =
      value instanceof ObjectID || typeof value === "string"
        ? value.toString()
        : "";

    if (!ObjectID.isValidUUID(key)) {
      throw new BadDataException(INCIDENT_FORM_SHARE_KEY_MESSAGE);
    }
  }

  /*
   * Built per call rather than at module load: these services sit in an
   * import graph that loops back to this one, and a module-level table would
   * capture whichever of them had not finished loading yet as undefined.
   */
  private getProjectScopedReferences(
    data: Model | QueryDeepPartialEntity<Model>,
  ): Array<ProjectScopedReference> {
    return [
      {
        modelName: "Incident Severity",
        id:
          resolveReferenceId(data.incidentSeverityId) ||
          resolveReferenceId(data.incidentSeverity),
        service: IncidentSeverityService,
      },
      {
        modelName: "Incident Template",
        id:
          resolveReferenceId(data.incidentTemplateId) ||
          resolveReferenceId(data.incidentTemplate),
        service: IncidentTemplateService,
      },
    ];
  }

  private async getProjectIdsForUpdateQuery(
    updateBy: UpdateBy<Model>,
  ): Promise<Array<ObjectID>> {
    const forms: Array<Model> = await this.findBy({
      query: updateBy.query,
      select: {
        projectId: true,
      },
      limit: LIMIT_MAX,
      skip: 0,
      props: {
        isRoot: true,
      },
    });

    const projectIds: Dictionary<ObjectID> = {};

    for (const form of forms) {
      if (form.projectId) {
        projectIds[form.projectId.toString()] = form.projectId;
      }
    }

    return Object.values(projectIds);
  }
}

export default new Service();
