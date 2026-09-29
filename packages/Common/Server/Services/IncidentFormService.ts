import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import CreateBy from "../Types/Database/CreateBy";
import Select from "../Types/Database/Select";
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
import {
  CustomFieldMappingSourceInfo,
  getCustomFieldInheritanceSource,
  getCustomFieldMappingRelationSelect,
  isCustomFieldInheritedByRecord,
} from "../../Types/CustomField/CustomFieldMappingCatalog";
import CustomFieldType from "../../Types/CustomField/CustomFieldType";
import LIMIT_MAX, { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import QueryDeepPartialEntity from "../../Types/Database/PartialEntity";
import Dictionary from "../../Types/Dictionary";
import Email from "../../Types/Email";
import BadDataException from "../../Types/Exception/BadDataException";
import ForbiddenException from "../../Types/Exception/ForbiddenException";
import NotFoundException from "../../Types/Exception/NotFoundException";
import ServerException from "../../Types/Exception/ServerException";
import {
  INCIDENT_FORM_QUESTION_LABELS,
  INCIDENT_FORM_TITLE_MAX_LENGTH,
  IncidentFormSubmissionValidationResult,
  PublicIncidentForm,
  PublicIncidentFormSeverity,
  PublicIncidentFormSubmissionRequest,
  PublicIncidentFormSubmissionResult,
  ValidatedIncidentFormSubmission,
  WHOLE_EMAIL_ADDRESS,
  formatIncidentFormSubmissionErrors,
  getPublicIncidentForm,
  isIncidentFormFieldSetting,
  validateIncidentFormSubmission,
} from "../../Types/Incident/IncidentFormPublic";
import {
  getIncidentFormIpAllowlistEntries,
  validateIncidentFormIpAllowlist,
} from "../../Types/Incident/IncidentFormIpAllowlist";
import IP from "../../Types/IP/IP";
import { JSONObject } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import IpCanonicalUtil from "../../Utils/IpCanonicalUtil";
import { escapeMarkdownInline } from "../../Utils/Markdown/MarkdownEscape";
import {
  neutralizeChatControlSequences,
  neutralizeUntrustedMarkdown,
} from "../../Utils/Markdown/UntrustedMarkdown";
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
import { EntityMetadata, Repository } from "typeorm";

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
 *   - its IP allowlist holds only entries the public routes can match;
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
 * form whose project's plan does not include forms or whose subscription is
 * unpaid (see isProjectOnPlan). They all read the same, word for word and
 * status for status, so trying links tells a stranger nothing about which
 * forms exist or why one is unavailable.
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

/*
 * An address an autolink would not carry whole: one that starts with "!"
 * (or "#"), whose autolink would open like a Slack control sequence ("<!",
 * "<#" - an address cannot start with "@"), and one holding "#", "?" or
 * "%", which a mail client reads in a mailto: link as a fragment, headers or
 * an escape - so <a#b@example.com> writes to "a", and <a%41@example.com> to
 * aA@example.com.
 */
const EXPLICIT_LINK_ADDRESS_PATTERN: RegExp = /^!|[#?%]/;

// The characters of an address a mailto: link would read as URL syntax.
const MAILTO_SYNTAX_CHARACTER_PATTERN: RegExp = /[#?%]/g;

type GetMailtoLinkFunction = (email: string) => string;

// A mailto: link that writes to exactly this address.
const getMailtoLink: GetMailtoLinkFunction = (email: string): string => {
  return `mailto:${email.replace(
    MAILTO_SYNTAX_CHARACTER_PATTERN,
    (character: string): string => {
      return `%${character.charCodeAt(0).toString(16).toUpperCase()}`;
    },
  )}`;
};

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
 *
 * The note is posted to the incident's Slack and Teams channels as well, so
 * a name such as "<!channel>" must not reach Slack as a mention either: the
 * names go through neutralizeChatControlSequences before they are escaped.
 *
 * The address is the exception: it is written as an autolink,
 * <jane@example.com>, so every renderer links the whole of it. It has
 * already passed WHOLE_EMAIL_ADDRESS - one dot-atom address, with no space,
 * bracket, angle bracket or backslash that could end the autolink early.
 * Backslash-escaping it instead broke the link where it matters: marked,
 * which renders the owners' "note posted" email, restarts its bare-address
 * link after every escape, so mary\-jane.watson@corp.example linked
 * mailto:jane.watson@corp.example - somebody else's mailbox. An address an
 * autolink would not carry whole (see EXPLICIT_LINK_ADDRESS_PATTERN: one
 * starting with "!" or "#", which would open like a Slack control sequence,
 * or holding "#", "?" or "%", which a mail client reads as URL syntax) is
 * written as a plain link instead, with those characters escaped in its
 * address. A value that is not one whole address (the function is
 * exported, and could be handed anything) is escaped like the name.
 */
export const getIncidentFormReporterNote: GetIncidentFormReporterNoteFunction =
  (data: {
    formName?: string | null | undefined;
    reporterName?: string | null | undefined;
    reporterEmail?: string | null | undefined;
  }): string => {
    const formName: string = escapeMarkdownInline(
      neutralizeChatControlSequences(data.formName),
    ).trim();
    const form: string = formName
      ? `the incident form **${formName}**`
      : "an incident form";

    const reporterName: string = escapeMarkdownInline(
      neutralizeChatControlSequences(data.reporterName),
    ).trim();

    const email: string = String(data.reporterEmail ?? "").trim();
    let reporterEmail: string = escapeMarkdownInline(
      neutralizeChatControlSequences(email),
    ).trim();

    if (email && WHOLE_EMAIL_ADDRESS.test(email)) {
      reporterEmail = EXPLICIT_LINK_ADDRESS_PATTERN.test(email)
        ? `[${escapeMarkdownInline(email)}](${getMailtoLink(email)})`
        : `<${email}>`;
    }

    if (reporterName && reporterEmail) {
      return `Reported through ${form} by ${reporterName} (${reporterEmail}).`;
    }

    if (reporterName || reporterEmail) {
      return `Reported through ${form} by ${reporterName || reporterEmail}.`;
    }

    return `Reported anonymously through ${form}.`;
  };

/*
 * Incident.title is a varchar(500), and breaking a chat sequence in the
 * title adds an invisible character (see neutralizeIncidentFormReport), so
 * a title of nearly 500 characters full of "<!" can outgrow it. Worded as
 * the validator's own length refusal.
 */
export const INCIDENT_FORM_TITLE_TOO_LONG_MESSAGE: string = `${INCIDENT_FORM_QUESTION_LABELS.title} cannot be more than ${INCIDENT_FORM_TITLE_MAX_LENGTH} characters.`;

const KNOWN_CUSTOM_FIELD_TYPES: ReadonlyArray<string> =
  Object.values(CustomFieldType);

export type NeutralizeIncidentFormReportFunction = (data: {
  answers: ValidatedIncidentFormSubmission;
  // The fields the form asks, as validated against: their types decide.
  askedDefinitions: Array<{
    name?: string | null | undefined;
    customFieldType?: string | null | undefined;
  }>;
}) => ValidatedIncidentFormSubmission;

/**
 * The validated answers as the incident stores them, with nothing left in
 * them that acts on its own when shown (see UntrustedMarkdown): a
 * stranger's report is posted to the project's Slack and Teams channels and
 * rendered for every responder and in owners' emails, and nobody reads it
 * over first.
 *
 * - The title and every Text or Long Text answer (and an answer to a field
 *   of a type this version does not know, which the form asks as text):
 *   chat control sequences such as <!channel> are broken, invisibly.
 * - The description and every Markdown answer: the same, and images become
 *   links and mermaid diagrams code, so nothing is fetched or run.
 * - Everything else - a dropdown option, a number, a date, a yes/no - was
 *   checked against its field and is left as it is.
 *
 * The reporter's name and address are left as validated: the submission
 * record shows them as plain text, and the private note neutralises them
 * where it places them (getIncidentFormReporterNote).
 */
export const neutralizeIncidentFormReport: NeutralizeIncidentFormReportFunction =
  (data: {
    answers: ValidatedIncidentFormSubmission;
    askedDefinitions: Array<{
      name?: string | null | undefined;
      customFieldType?: string | null | undefined;
    }>;
  }): ValidatedIncidentFormSubmission => {
    /*
     * The answers are copied key by key, defined rather than assigned, as
     * the validator stores them: a field may be named "__proto__", and
     * assigning that name (which a spread compiles to) would set the
     * object's prototype instead of copying the answer.
     */
    const customFields: JSONObject = {};

    for (const [name, value] of Object.entries(data.answers.customFields)) {
      Object.defineProperty(customFields, name, {
        value: value,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }

    const report: ValidatedIncidentFormSubmission = {
      ...data.answers,
      title: neutralizeChatControlSequences(data.answers.title),
      customFields: customFields,
    };

    if (data.answers.description) {
      report.description = neutralizeUntrustedMarkdown(
        data.answers.description,
      );
    }

    for (const definition of data.askedDefinitions) {
      const name: unknown = definition.name;

      if (
        typeof name !== "string" ||
        !Object.prototype.hasOwnProperty.call(report.customFields, name)
      ) {
        continue;
      }

      const value: unknown = report.customFields[name];

      if (typeof value !== "string") {
        continue;
      }

      const type: string = definition.customFieldType || "";
      let neutralized: string = value;

      if (type === CustomFieldType.Markdown) {
        neutralized = neutralizeUntrustedMarkdown(value);
      } else if (
        type === CustomFieldType.Text ||
        type === CustomFieldType.LongText ||
        !KNOWN_CUSTOM_FIELD_TYPES.includes(type)
      ) {
        neutralized = neutralizeChatControlSequences(value);
      }

      Object.defineProperty(report.customFields, name, {
        value: neutralized,
        enumerable: true,
        writable: true,
        configurable: true,
      });
    }

    return report;
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
    this.assertValidIpAllowlist(createBy.data.ipWhitelist);

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

    if (data["ipWhitelist"] !== undefined) {
      this.assertValidIpAllowlist(data["ipWhitelist"]);
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
   * is the incident created, as root, from the validated answers - with
   * nothing left in them that acts on its own when shown
   * (neutralizeIncidentFormReport) - and the form's own settings. Nothing
   * else in the request reaches it, least of all a project id: the incident
   * goes to the form's project.
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

    const report: ValidatedIncidentFormSubmission =
      neutralizeIncidentFormReport({
        answers: answers,
        askedDefinitions: askedDefinitions,
      });

    if (report.title.length > INCIDENT_FORM_TITLE_MAX_LENGTH) {
      throw new BadDataException(INCIDENT_FORM_TITLE_TOO_LONG_MESSAGE);
    }

    const incidentSeverityId: ObjectID | undefined =
      await this.getSubmissionSeverityId({ form, answers });

    const incident: Incident = await this.declareIncident({
      form,
      answers: report,
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
   * carries a plan, so none of the model's billing gate runs for them. This
   * stands in for all of it (BillingPermission.checkBillingPermissions), not
   * only @TableBillingAccessControl: a project whose subscription is unpaid
   * is off plan too. The dashboard refuses every IncidentForm request of
   * such a project - its admins cannot even turn a form off - so its link
   * must not keep declaring incidents and paging on-call meanwhile.
   *
   * Fails closed: a project whose plan cannot be read (deleted mid-request,
   * still onboarding) is treated as below plan - that costs one "not
   * available" page, where failing open would let anyone with a link page
   * on-call on a plan that does not include forms.
   */
  @CaptureSpan()
  public async isProjectOnPlan(projectId: ObjectID): Promise<boolean> {
    if (!IsBillingEnabled) {
      return true;
    }

    try {
      const current: CurrentPlan =
        await ProjectService.getCurrentPlan(projectId);

      if (!current.plan || current.isSubscriptionUnpaid) {
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
   *
   * An address is compared in its canonical spelling on both sides
   * (IpCanonicalUtil): IP.isInWhitelist matches an IPv6 entry letter for
   * letter, and "2001:DB8::1" or "2001:db8:0:0:0:0:0:1" written in the list
   * is the very address the proxy reports as "2001:db8::1". Nothing is
   * rewritten in the stored list, and ranges are left to the matcher.
   */
  public isClientIpAllowed(data: {
    ipWhitelist: string | null | undefined;
    clientIp: string | undefined;
  }): boolean {
    const entries: Array<string> = getIncidentFormIpAllowlistEntries(
      data.ipWhitelist,
    ).map((entry: string): string => {
      return IP.isIP(entry) ? IpCanonicalUtil.canonicalize(entry) : entry;
    });

    if (entries.length === 0) {
      return true;
    }

    if (!data.clientIp) {
      return false;
    }

    try {
      return IP.isInWhitelist({
        ip: IP.isIP(data.clientIp)
          ? IpCanonicalUtil.canonicalize(data.clientIp)
          : data.clientIp,
        whitelist: entries,
      });
    } catch {
      return false;
    }
  }

  /**
   * Takes a deleted incident custom field off every form of its project:
   * its key is removed from each form's questions (customFieldSettings).
   * Returns how many forms asked it.
   *
   * Forms ask fields by template key, and a field created later with the
   * same name gets the same key back (generateCustomFieldVariableKey) - as
   * does any field whose name gives the same key. Left behind, the key
   * would put that new field, with its own description and dropdown
   * options, straight onto every public form that asked the deleted one,
   * and no admin could clear it from the Questions card meanwhile: the card
   * lists only fields that exist. A public form must never show a field an
   * admin did not choose for it. Templates keep their settings on purpose -
   * a field created again gets its template setting back - so only forms
   * are touched here.
   *
   * One raw statement, as CustomFieldRename moves values: removing a
   * reference to a deleted field changes no form an admin configured, so it
   * must not start every form's "On Update" workflow, bump its version or
   * move its updatedAt. The table and column names come from the entity
   * metadata and every value is a bound parameter.
   */
  public async removeCustomFieldFromQuestions(data: {
    projectId: ObjectID;
    variableKey: string;
  }): Promise<number> {
    const repository: Repository<Model> = this.getRepository();
    const metadata: EntityMetadata = repository.metadata;

    const settingsColumn: string | undefined =
      metadata.findColumnWithPropertyName("customFieldSettings")?.databaseName;
    const projectIdColumn: string | undefined =
      metadata.findColumnWithPropertyName("projectId")?.databaseName;

    if (!settingsColumn || !projectIdColumn) {
      throw new ServerException(
        `Cannot remove a custom field from ${metadata.tableName}: it has no customFieldSettings or projectId column.`,
      );
    }

    /*
     * In a CTE so the statement answers with the rows it wrote. jsonb_typeof
     * guards the operators: on a jsonb array "-" and jsonb_exists act on its
     * string elements, and settings that are not an object hold no keys.
     */
    const result: unknown = await repository.manager.query(
      `WITH "updated" AS (
        UPDATE "${metadata.tableName}"
        SET "${settingsColumn}" = "${settingsColumn}" - $2::text
        WHERE "${projectIdColumn}" = $1
          AND jsonb_typeof("${settingsColumn}") = 'object'
          AND jsonb_exists("${settingsColumn}", $2::text)
        RETURNING 1
      ) SELECT COUNT(*)::int AS "count" FROM "updated"`,
      [data.projectId.toString(), data.variableKey],
    );

    const row: JSONObject | undefined = Array.isArray(result)
      ? (result[0] as JSONObject | undefined)
      : undefined;

    return Number(row?.["count"]) || 0;
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
   *
   * Less the fields the incident will copy from a monitor instead (see
   * leaveOutInheritedFields).
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
          mapFromResourceType: true,
          mapFromCustomFieldName: true,
        },
        limit: LIMIT_PER_PROJECT,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

    return await this.leaveOutInheritedFields({
      form: form,
      askedDefinitions: getIncidentFormAskedDefinitions(
        definitions,
        form.customFieldSettings,
      ),
    });
  }

  /*
   * A field mapped from a monitor field takes the monitor's value when the
   * incident has a monitor: IncidentService applies the mapping last on
   * create, over whatever the reporter answered. So such a field is not
   * asked once the incident will have a monitor - the rule the dashboard's
   * Declare Incident form follows (isCustomFieldInheritedByRecord) - and an
   * answer sent anyway is dropped as one to a question the form does not
   * ask, rather than being required and then silently thrown away.
   *
   * A form's incident only gets monitors from the form's template, so the
   * template is what decides, read per request (its monitors can change
   * after the form's questions are set), and only when the form has one and
   * asks a mapped field.
   */
  private async leaveOutInheritedFields(data: {
    form: Model;
    askedDefinitions: Array<IncidentCustomField>;
  }): Promise<Array<IncidentCustomField>> {
    const definitionTableName: string | undefined =
      new IncidentCustomField().tableName || undefined;

    const sources: Array<CustomFieldMappingSourceInfo> = [];

    for (const definition of data.askedDefinitions) {
      const source: CustomFieldMappingSourceInfo | undefined =
        getCustomFieldInheritanceSource({
          definitionTableName: definitionTableName,
          definition: definition,
        });

      if (source && !sources.includes(source)) {
        sources.push(source);
      }
    }

    if (sources.length === 0 || !data.form.incidentTemplateId) {
      return data.askedDefinitions;
    }

    /*
     * The template's own relations stand for the incident's: the template
     * branch copies them onto it. A relation the template does not have
     * cannot reach the incident.
     */
    const template: IncidentTemplate = new IncidentTemplate();
    const select: Record<string, unknown> = {};

    for (const source of sources) {
      if (template.hasColumn(source.targetRelationProperty)) {
        Object.assign(select, getCustomFieldMappingRelationSelect(source));
      }
    }

    if (Object.keys(select).length === 0) {
      return data.askedDefinitions;
    }

    const stored: IncidentTemplate | null =
      await IncidentTemplateService.findOneBy({
        query: {
          _id: data.form.incidentTemplateId.toString(),
          projectId: data.form.projectId!,
        },
        select: select as Select<IncidentTemplate>,
        props: {
          isRoot: true,
        },
      });

    if (!stored) {
      return data.askedDefinitions;
    }

    return data.askedDefinitions.filter(
      (definition: IncidentCustomField): boolean => {
        return !isCustomFieldInheritedByRecord({
          definitionTableName: definitionTableName,
          definition: definition,
          record: stored as unknown as Record<string, unknown>,
        });
      },
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

  /*
   * Every line an entry the public routes can match (see
   * IncidentFormIpAllowlist): an entry that can never match would lock every
   * reporter on that network out, silently. Refused, never rewritten.
   */
  private assertValidIpAllowlist(value: unknown): void {
    const problem: string | null = validateIncidentFormIpAllowlist(value);

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
