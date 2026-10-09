import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { IsBillingEnabled, getAllEnvVars } from "../EnvironmentConfig";
import DatabaseService from "./DatabaseService";
import FileService, { FileFacts } from "./FileService";
import FormSubmissionService from "./FormSubmissionService";
import ProjectService, { CurrentPlan } from "./ProjectService";
import SubscriptionPlan, {
  PlanType,
} from "../../Types/Billing/SubscriptionPlan";
import Dictionary from "../../Types/Dictionary";
import Email from "../../Types/Email";
import BadDataException from "../../Types/Exception/BadDataException";
import {
  FORM_BRANDING_IMAGES,
  FormBrandingImageDefinition,
  getFormBrandingImageProblem,
} from "../../Types/Form/FormBranding";
import ForbiddenException from "../../Types/Exception/ForbiddenException";
import NotFoundException from "../../Types/Exception/NotFoundException";
import ServerException from "../../Types/Exception/ServerException";
import {
  FormField,
  FormFieldSource,
  getDefaultFormFields,
  readFormFields,
  validateFormFields,
} from "../../Types/Form/FormField";
import {
  getFormIpAllowlistEntries,
  getIpv4OfMappedAddress,
  validateFormIpAllowlist,
} from "../../Types/Form/FormIpAllowlist";
import {
  BuiltPublicForm,
  buildPublicForm,
  FormCustomFieldDefinition,
  FormFieldBinding,
  FormRecordOption,
  FormSubmissionValidationResult,
  formatFormSubmissionErrors,
  getFormSubmissionTemplate,
  getFormTemplateAnswers,
  PublicForm,
  PublicFormField,
  PublicFormFieldType,
  PublicFormSubmissionRequest,
  PublicFormSubmissionResult,
  readFormSubmissionTemplateId,
  validateFormSubmission,
  validateFormTemplateAnswers,
  ValidatedFormAnswers,
} from "../../Types/Form/FormPublic";
import {
  FormSubmissionAnswer,
  getFormSubmissionAnswers,
} from "../../Types/Form/FormSubmissionAnswer";
import {
  FormTargetFieldDefinition,
  FormTargetOptionsSource,
  getFormTargetField,
} from "../../Types/Form/FormTargetCatalog";
import { validateFormTargetSettings } from "../../Types/Form/FormTargetSettings";
import {
  FormTemplate,
  readFormTemplates,
  validateFormTemplates,
} from "../../Types/Form/FormTemplate";
import FormTargetType, {
  isFormTargetType,
  readFormTargetType,
} from "../../Types/Form/FormTargetType";
import IP from "../../Types/IP/IP";
import { JSONArray, JSONObject, JSONValue } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import IpCanonicalUtil from "../../Utils/IpCanonicalUtil";
import File from "../../Models/DatabaseModels/File";
import Model from "../../Models/DatabaseModels/Form";
import FormSubmission from "../../Models/DatabaseModels/FormSubmission";
import FormRateLimit from "../Middleware/FormRateLimit";
import CaptchaUtil from "../Utils/Captcha";
import RelationIdUtil from "../Utils/Database/RelationIdUtil";
import FileOwnership from "../Utils/File/FileOwnership";
import FormRecordOptions from "../Utils/Form/FormRecordOptions";
import { getFormSubmissionNote } from "../Utils/Form/FormSubmissionNote";
import {
  FormSubmissionContext,
  FormSubmissionCreated,
  FormTargetHelpers,
  SortedFormAnswers,
} from "../Utils/Form/FormTargetHandler";
import {
  AnyFormTargetHandler,
  getFormTargetHandler,
} from "../Utils/Form/FormTargets";
import logger, { LogAttributes } from "../Utils/Logger";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";

import FeedMarkdown from "../../Utils/Markdown/FeedMarkdown";
/*
 * What a form may hold, and what its public page does. The public page that
 * submits a form - and whatever each submission creates - trust everything
 * checked here, so a form is refused at the write that would make it wrong
 * rather than at a stranger's submission:
 *
 *   - its link key is minted on create, never taken from the request, and
 *     only ever replaced by another UUID;
 *   - it creates one of the targets there are (FormTargetType);
 *   - its questions are ones the public page and the submit route
 *     understand, for that target (validateFormFields): every question
 *     linked to a field the target has, every field the target cannot do
 *     without asked;
 *   - its settings are that target's settings (validateFormTargetSettings);
 *   - its templates are well formed (validateFormTemplates), and every
 *     answer one holds suits the question it answers, as a submission's
 *     answer to it would (validateFormTemplateAnswers);
 *   - its IP allowlist holds only entries the public routes can match;
 *   - its logo and favicon, when it has them, are files uploaded in its own
 *     project, of a type the public page draws and small (FormBranding);
 *   - every record its settings and questions name - a severity, monitors
 *     offered to choose from, a custom field, an owner - belongs to its own
 *     project, because every submission is created in that project with them.
 *
 * The public routes themselves live in FormAPI, and are thin: what a visitor
 * is told about a form and what a submission turns into are decided here,
 * in getPublicForm and submitPublicForm, and by the form's target handler
 * (Utils/Form/FormTargets).
 */

export const FORM_SHARE_KEY_MESSAGE: string =
  "Share Key must be a UUID, such as the one the dashboard's Reset Link generates.";

export const FORM_TARGET_TYPE_MESSAGE: string =
  "Creates must be Incident or ScheduledMaintenance.";

/*
 * The one answer a public request gets for every form it may not use: a
 * link that is malformed or names no form, a form that is turned off, and a
 * form whose project's plan does not include forms or whose subscription is
 * unpaid (see isProjectOnPlan). They all read the same, word for word and
 * status for status, so trying links tells a stranger nothing about which
 * forms exist or why one is unavailable.
 */
export const FORM_NOT_AVAILABLE_MESSAGE: string =
  "This form is not available. It may have been turned off, or the link may be out of date.";

/*
 * The form's IP allowlist refused the visitor. Only reached for a form that
 * exists and is on, so it can say what is wrong: the visitor can do
 * something about their network, and nothing about a form that is gone.
 */
export const FORM_NETWORK_NOT_ALLOWED_MESSAGE: string =
  "This form can only be opened from an allowed network.";

/*
 * A form a branding write is for, as the check needs it: the project its
 * images must come from, and the files it shows now.
 */
interface BrandingCheckForm {
  projectId: ObjectID | undefined;
  logoFileId?: ObjectID | null | undefined;
  faviconFileId?: ObjectID | null | undefined;
}

/*
 * Creating the submission's record itself failed. Why is logged with the
 * form and the project; the submitter, who can only try again, is not
 * handed internal messages or ids.
 */
export const FORM_SUBMIT_FAILED_MESSAGE: string =
  "Your response could not be submitted. Please try again in a few minutes.";

const TOO_LONG_MESSAGE: string =
  "{{field}} cannot be more than {{maxLength}} characters.";

export type NeutralizeFormAnswersFunction = (data: {
  answers: ValidatedFormAnswers;
  fields: Array<PublicFormField>;
  bindings: Record<string, FormFieldBinding>;
}) => ValidatedFormAnswers;

/**
 * The checked answers as they are stored, with nothing left in them that
 * acts on its own when shown (see UntrustedMarkdown): a stranger's answers
 * become an incident's title, its description and custom field values,
 * are posted to the project's Slack and Teams channels and rendered for
 * every responder and in owners' emails, and nobody reads them over first.
 *
 * - The title (a target's built-in title): stored as a reported value
 *   (FeedMarkdown.reportedValue) - chat control sequences such as <!channel>,
 *   image and link syntax, a "<" and mermaid fences are broken, invisibly,
 *   so wherever the title is placed into Markdown, nothing in it acts.
 * - Every other one-line or multi-line text answer: chat control sequences
 *   are broken, invisibly.
 * - Every Markdown answer: chat control sequences are broken, and images
 *   become links and mermaid diagrams code, so nothing is fetched or run.
 * - Everything else - a choice, a number, a date, a yes/no, the submitter's
 *   name and address - was checked against its question and is left as it
 *   is (the note neutralizes the name and address where it places them).
 */
export const neutralizeFormAnswers: NeutralizeFormAnswersFunction = (data: {
  answers: ValidatedFormAnswers;
  fields: Array<PublicFormField>;
  bindings: Record<string, FormFieldBinding>;
}): ValidatedFormAnswers => {
  const neutralized: ValidatedFormAnswers = {};

  for (const field of data.fields) {
    if (!Object.prototype.hasOwnProperty.call(data.answers, field.id)) {
      continue;
    }

    const value: JSONValue = data.answers[field.id] as JSONValue;
    const binding: FormFieldBinding | undefined = data.bindings[field.id];
    let stored: JSONValue = value;

    if (
      typeof value === "string" &&
      binding &&
      binding.source !== FormFieldSource.Submitter
    ) {
      if (
        binding.source === FormFieldSource.TargetField &&
        binding.definition.key === "title"
      ) {
        stored = FeedMarkdown.reportedValue(value);
      } else if (field.type === PublicFormFieldType.Markdown) {
        stored = FeedMarkdown.writtenOutside(value).toString();
      } else if (
        field.type === PublicFormFieldType.Text ||
        field.type === PublicFormFieldType.LongText
      ) {
        stored = FeedMarkdown.withoutChatSequences(value);
      }
    }

    Object.defineProperty(neutralized, field.id, {
      value: stored,
      enumerable: true,
      writable: true,
      configurable: true,
    });
  }

  return neutralized;
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

    const targetType: FormTargetType = this.readTargetTypeForWrite(
      createBy.data.targetType,
    );
    createBy.data.targetType = targetType;

    /*
     * A form created without questions starts with the target's own - a
     * title, a description, every field the target cannot do without, and
     * who is submitting - so it works the moment it exists.
     */
    if (createBy.data.fields === undefined || createBy.data.fields === null) {
      createBy.data.fields = getDefaultFormFields(
        targetType,
      ) as unknown as JSONArray;
    }

    this.assertValidFields({ value: createBy.data.fields, targetType });
    this.assertValidTargetSettings({
      value: createBy.data.targetSettings,
      targetType,
    });
    this.assertValidTemplates(createBy.data.templates);
    this.assertValidIpAllowlist(createBy.data.ipWhitelist);
    await this.assertValidBrandingImages({
      values: createBy.data as unknown as Dictionary<unknown>,
      forms: [
        {
          projectId: createBy.props.tenantId || createBy.data.projectId,
        },
      ],
    });

    const projectId: ObjectID | undefined =
      createBy.props.tenantId || createBy.data.projectId;

    if (projectId) {
      await this.validateProjectReferences({
        projectId,
        targetType,
        fields: createBy.data.fields,
        settings: createBy.data.targetSettings,
        storedFields: undefined,
        checkFields: true,
        checkSettings: true,
      });

      await this.assertValidTemplateAnswers({
        projectId,
        targetType,
        fields: createBy.data.fields,
        templates: createBy.data.templates,
      });
    }

    return { createBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    const data: Dictionary<unknown> = updateBy.data as Dictionary<unknown>;

    const has: (column: string) => boolean = (column: string): boolean => {
      return (
        Object.prototype.hasOwnProperty.call(data, column) &&
        data[column] !== undefined
      );
    };

    if (has("ipWhitelist")) {
      this.assertValidIpAllowlist(data["ipWhitelist"]);
    }

    if (has("shareKey")) {
      this.assertValidShareKey(data["shareKey"]);
    }

    if (has("targetType") && !isFormTargetType(data["targetType"])) {
      throw new BadDataException(FORM_TARGET_TYPE_MESSAGE);
    }

    if (has("templates")) {
      this.assertValidTemplates(data["templates"]);
    }

    if (
      FORM_BRANDING_IMAGES.some(
        (image: FormBrandingImageDefinition): boolean => {
          return has(image.idColumn) || has(image.relationColumn);
        },
      )
    ) {
      const forms: Array<Model> = await this.findRowsAndHoldUpdateToThem(
        updateBy,
        {
          _id: true,
          projectId: true,
          logoFileId: true,
          faviconFileId: true,
        },
      );

      /*
       * The forms read are the ones the update writes. A teammate's are the
       * forms they may write; OneUptime's, or a master admin's, are whatever
       * the update's query names, which may be another project's than the
       * request's. The files must then come from the request's project, as
       * every other reference a form names does, and what such a form shows
       * now is not used: an update aimed at another project's form is
       * refused alike whichever file it names, and so tells nothing about
       * that project.
       */
      const tenantId: ObjectID | undefined = updateBy.props.tenantId;

      await this.assertValidBrandingImages({
        values: data,
        forms: forms.map((form: Model): BrandingCheckForm => {
          const isRequestsOwn: boolean =
            !tenantId ||
            Boolean(
              form.projectId &&
                form.projectId.toString() === tenantId.toString(),
            );

          return {
            projectId: tenantId || form.projectId,
            logoFileId: isRequestsOwn ? form.logoFileId : undefined,
            faviconFileId: isRequestsOwn ? form.faviconFileId : undefined,
          };
        }),
      });
    }

    const changesQuestions: boolean = has("fields");
    const changesTarget: boolean = has("targetType");
    const changesSettings: boolean = has("targetSettings");
    const changesTemplates: boolean = has("templates");

    if (
      !changesQuestions &&
      !changesTarget &&
      !changesSettings &&
      !changesTemplates
    ) {
      return { updateBy, carryForward: null };
    }

    /*
     * The questions, the target and the settings are checked together: a
     * question is linked to a field of one target, and settings belong to
     * one target. So every form the update matches is read, and what it
     * will hold once the update is applied is checked whole.
     *
     * Templates written are checked against the questions the form will
     * have. Questions changed without the templates leave the templates
     * as they are: an answer to a question since removed or changed is not
     * offered to anyone (getFormTemplateAnswers), and the Templates page
     * drops it the next time the template is saved - refusing would keep an
     * admin from editing the questions until every template was redone.
     */
    const forms: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      updateBy,
      {
        _id: true,
        projectId: true,
        targetType: true,
        fields: true,
        targetSettings: true,
      },
    );

    for (const form of forms) {
      const targetType: FormTargetType = changesTarget
        ? (data["targetType"] as FormTargetType)
        : readFormTargetType(form.targetType);

      const fields: unknown = changesQuestions
        ? data["fields"] === null
          ? []
          : data["fields"]
        : form.fields;

      const settings: unknown = changesSettings
        ? data["targetSettings"]
        : form.targetSettings;

      if (changesQuestions || changesTarget) {
        this.assertValidFields({ value: fields ?? [], targetType });
      }

      if (changesSettings || changesTarget) {
        this.assertValidTargetSettings({ value: settings, targetType });
      }

      const projectId: ObjectID | undefined =
        updateBy.props.tenantId || form.projectId;

      if (projectId) {
        await this.validateProjectReferences({
          projectId,
          targetType,
          fields: changesQuestions || changesTarget ? fields : undefined,
          settings: changesSettings || changesTarget ? settings : undefined,
          storedFields: changesTarget ? undefined : form.fields,
          checkFields: changesQuestions || changesTarget,
          checkSettings: changesSettings || changesTarget,
        });

        if (changesTemplates) {
          await this.assertValidTemplateAnswers({
            projectId,
            targetType,
            fields: fields,
            templates: data["templates"],
          });
        }
      }
    }

    return { updateBy, carryForward: null };
  }

  /**
   * What the public page shows for the form a link names: its questions, in
   * the safe subset buildPublicForm builds question by question - never the
   * form's id, project, target, settings, link key or allowlist, never a
   * custom field or record the form does not offer - and its branding: its
   * logo, the logo's alt text and its favicon, when it has them, the images
   * themselves inside the answer (FormBranding). This is the only way a
   * form's images reach anyone without an account: through this form, after
   * every check its questions are behind, and never by a file's id.
   *
   * clientIp is the trusted client address (resolveClientIp), or undefined
   * when there is none; a form with an IP allowlist refuses the latter.
   */
  @CaptureSpan()
  public async getPublicForm(data: {
    shareKey: string | undefined;
    clientIp: string | undefined;
  }): Promise<PublicForm> {
    const form: Model = await this.getFormForPublicRequest({
      shareKey: data.shareKey,
      clientIp: data.clientIp,
      includeBranding: true,
    });
    const built: BuiltPublicForm = await this.buildPublicFormFor(form);

    return built.form;
  }

  /**
   * Creates what a public submission is for, and tells the submitter its
   * number.
   *
   * The form's hidden questions are answered from the template the
   * submission names (getFormSubmissionTemplate), if any - never from the
   * request's answers, which are only read for the questions the page asks.
   *
   * In order, each step refusing before the next one costs anything: the
   * same checks as getPublicForm (link, form on, plan, network), then the
   * instance captcha when it is on, then the answers against the form's
   * questions (validateFormSubmission) and the length of the title as it
   * will be stored, then the target's own refusals (the target handler's
   * prepare: a form left with no severity, a window that ends before it
   * starts), and last the form's hourly ceiling
   * (FormRateLimit.reserveFormSubmission), which only a submission that
   * passed all of those may spend. Only then are the answers made safe to
   * show (neutralizeFormAnswers) - the one step whose cost grows with the
   * Markdown in them, and one that cannot refuse - and the record created,
   * as root, from them and the form's own settings. Nothing else in the
   * request reaches it, least of all a project id: the record goes to the
   * form's project.
   *
   * Once the record exists the submitter is told it was made whatever
   * happens next. The submission record and the private note are each
   * attempted, and a failure is logged rather than turned into an error
   * that would invite the submitter to send - and page on-call with - the
   * same submission again.
   */
  @CaptureSpan()
  public async submitPublicForm(data: {
    shareKey: string | undefined;
    request: PublicFormSubmissionRequest;
    clientIp: string | undefined;
    // The address hCaptcha is told the token was solved from.
    captchaRemoteIp?: string | undefined;
  }): Promise<PublicFormSubmissionResult> {
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

    const built: BuiltPublicForm = await this.buildPublicFormFor(form);

    const validation: FormSubmissionValidationResult = validateFormSubmission({
      fields: built.form.fields,
      data: data.request?.data,
    });

    if (!validation.isValid) {
      throw new BadDataException(formatFormSubmissionErrors(validation.errors));
    }

    const template: FormTemplate | undefined = getFormSubmissionTemplate({
      templates: form.templates,
      templateId: readFormSubmissionTemplateId(data.request?.data),
    });

    const answers: ValidatedFormAnswers = this.withHiddenAnswers({
      answers: validation.answers,
      hiddenAnswers: getFormTemplateAnswers({
        template: template,
        fields: built.hiddenFields,
      }),
    });

    this.assertStoredTitleFits({
      built,
      answers: answers,
    });

    const handler: AnyFormTargetHandler = getFormTargetHandler(
      readFormTargetType(form.targetType),
    );

    const context: FormSubmissionContext = {
      form: form,
      fields: built.allFields,
      bindings: built.bindings,
      answers: answers,
    };

    const prepared: unknown = await handler.prepare(context);

    /*
     * Everything that can refuse this submission has passed, so only now
     * does it count against the form's hourly ceiling - the bound on how
     * many records, and pages, its link can cause. Counted any earlier, a
     * request refused by the IP allowlist, the captcha or the answers would
     * use up the allowance everybody shares. Fails closed (503) when the
     * counter cannot be reached; over the ceiling it is a 429, which the
     * route answers with Retry-After.
     */
    await FormRateLimit.reserveFormSubmission({
      shareKey: data.shareKey,
    });

    /*
     * Only a submission about to be created - which the ceiling above
     * bounds - pays for reading its Markdown; one refused on the way here
     * never does.
     */
    const safeContext: FormSubmissionContext = {
      ...context,
      answers: neutralizeFormAnswers({
        answers: answers,
        fields: built.allFields,
        bindings: built.bindings,
      }),
    };

    let created: FormSubmissionCreated;

    try {
      created = await handler.create({
        context: safeContext,
        prepared: prepared,
      });
    } catch (err) {
      logger.error(
        `FormService: form ${form.id?.toString()} could not create what its submission is for.`,
        this.getLogAttributes(form),
      );
      logger.error(err, this.getLogAttributes(form));

      throw new ServerException(FORM_SUBMIT_FAILED_MESSAGE);
    }

    const sorted: SortedFormAnswers =
      FormTargetHelpers.sortAnswers(safeContext);

    await this.recordSubmission({
      form,
      created,
      context: safeContext,
      sorted,
    });

    await this.addSubmissionNote({
      form,
      created,
      handler,
      sorted,
      templateName: template?.name,
    });

    const result: PublicFormSubmissionResult = {};

    if (created.reference) {
      result.reference = created.reference;
    }

    if (form.successMessage && form.successMessage.trim().length > 0) {
      result.successMessage = form.successMessage;
    }

    return result;
  }

  /*
   * Whether the form's project is on a plan that includes forms.
   *
   * Checked by hand because the public routes read as root, and root never
   * carries a plan, so none of the model's billing gate runs for them. This
   * stands in for all of it (BillingPermission.checkBillingPermissions), not
   * only @TableBillingAccessControl: a project whose subscription is unpaid
   * is off plan too. The dashboard refuses every Form request of such a
   * project - its admins cannot even turn a form off - so its link must not
   * keep creating incidents and paging on-call meanwhile.
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
        `FormService: could not read the plan of project ${projectId.toString()}; treating it as below plan.`,
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
   *
   * An IPv4 visitor is compared as its IPv4 address, whichever way it was
   * reported, so the list's IPv4 entries and ranges match it:
   * resolveClientIp unwraps the dotted IPv6 spelling ("::ffff:203.0.113.7")
   * already, and one a proxy wrote in hex ("::ffff:cb00:7107") is read the
   * same way here. The list itself cannot hold that spelling: it is refused
   * when saved (validateFormIpAllowlist).
   */
  public isClientIpAllowed(data: {
    ipWhitelist: string | null | undefined;
    clientIp: string | undefined;
  }): boolean {
    const entries: Array<string> = getFormIpAllowlistEntries(
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

    const clientIp: string = IP.isIP(data.clientIp)
      ? getIpv4OfMappedAddress(data.clientIp) ||
        IpCanonicalUtil.canonicalize(data.clientIp)
      : data.clientIp;

    try {
      return IP.isInWhitelist({
        ip: clientIp,
        whitelist: entries,
      });
    } catch {
      return false;
    }
  }

  /*
   * The public form for a stored form, with where each answer goes: the
   * target's custom fields are read only when a question is linked to one,
   * and a choice's records only for the questions that offer them - the
   * chosen ones, or every severity when a severity question names none.
   */
  @CaptureSpan()
  public async buildPublicFormFor(form: Model): Promise<BuiltPublicForm> {
    const targetType: FormTargetType = readFormTargetType(form.targetType);
    const handler: AnyFormTargetHandler = getFormTargetHandler(targetType);
    const fields: Array<FormField> = readFormFields(form.fields);
    const projectId: ObjectID = form.projectId!;

    const asksCustomField: boolean = fields.some(
      (field: FormField): boolean => {
        return field.source === FormFieldSource.TargetCustomField;
      },
    );

    const customFields: Array<FormCustomFieldDefinition> = asksCustomField
      ? await handler.getCustomFieldDefinitions(projectId)
      : [];

    const recordOptions: Partial<
      Record<FormTargetOptionsSource, Array<FormRecordOption>>
    > = await this.loadRecordOptions({ projectId, targetType, fields });

    return buildPublicForm({
      form: {
        name: form.name,
        description: form.description,
        fields: form.fields,
        targetType: targetType,
        // Read for the public page only (getPublicForm); a submission has none.
        logoFile: this.getOwnBrandingFile(form, form.logoFile),
        logoAltText: form.logoAltText,
        faviconFile: this.getOwnBrandingFile(form, form.faviconFile),
        templates: form.templates,
      },
      customFields: customFields,
      recordOptions: recordOptions,
      defaultOptionValues: handler.getDefaultOptionValues(
        (form.targetSettings as JSONObject) || {},
      ),
      isCaptchaRequired: CaptchaUtil.isCaptchaEnabled(),
    });
  }

  /*
   * A logo or favicon the form's page may be handed: only a file of the
   * form's own project. Every write is checked for that already
   * (assertValidBrandingImages); this checks again as the page reads it,
   * whatever wrote the row, so not even a reference no write check saw can
   * hand the page a file of another project, or one uploaded with none.
   */
  private getOwnBrandingFile(
    form: Model,
    file: File | undefined,
  ): File | undefined {
    return FileOwnership.keepProjectFile(file, form.projectId);
  }

  private async loadRecordOptions(data: {
    projectId: ObjectID;
    targetType: FormTargetType;
    fields: Array<FormField>;
  }): Promise<
    Partial<Record<FormTargetOptionsSource, Array<FormRecordOption>>>
  > {
    // Per source: the ids to read, or null for all of them.
    const wanted: Map<FormTargetOptionsSource, Set<string> | null> = new Map();

    for (const field of data.fields) {
      if (field.source !== FormFieldSource.TargetField) {
        continue;
      }

      const definition: FormTargetFieldDefinition | undefined =
        getFormTargetField(data.targetType, field.targetField);

      if (!definition || !definition.optionsSource) {
        continue;
      }

      const allowed: Array<string> = field.allowedOptionIds || [];

      if (allowed.length === 0) {
        if (!definition.mustChooseOptions) {
          wanted.set(definition.optionsSource, null);
        }
        continue;
      }

      const current: Set<string> | null | undefined = wanted.get(
        definition.optionsSource,
      );

      if (current === null) {
        continue;
      }

      const ids: Set<string> = current || new Set<string>();

      for (const id of allowed) {
        ids.add(id);
      }

      wanted.set(definition.optionsSource, ids);
    }

    const options: Partial<
      Record<FormTargetOptionsSource, Array<FormRecordOption>>
    > = {};

    for (const [source, ids] of wanted) {
      options[source] = await FormRecordOptions.load({
        projectId: data.projectId,
        source: source,
        ids: ids ? Array.from(ids) : undefined,
      });
    }

    return options;
  }

  /*
   * The title as it will be stored must still fit the record's column:
   * breaking a chat sequence or image syntax in it adds an invisible
   * character (FeedMarkdown.reportedValue), so a title right at the limit
   * full of "<!" or "![" can outgrow it. Worded as the answer check's own
   * length refusal.
   */
  private assertStoredTitleFits(data: {
    built: BuiltPublicForm;
    answers: ValidatedFormAnswers;
  }): void {
    for (const field of data.built.allFields) {
      const binding: FormFieldBinding | undefined =
        data.built.bindings[field.id];
      const value: unknown = data.answers[field.id];

      if (
        !binding ||
        binding.source !== FormFieldSource.TargetField ||
        binding.definition.key !== "title" ||
        typeof value !== "string" ||
        !binding.definition.maxLength
      ) {
        continue;
      }

      if (
        FeedMarkdown.reportedValue(value).length > binding.definition.maxLength
      ) {
        throw new BadDataException(
          TOO_LONG_MESSAGE.replace("{{field}}", (): string => {
            return field.label;
          }).replace("{{maxLength}}", (): string => {
            return String(binding.definition.maxLength);
          }),
        );
      }
    }
  }

  /*
   * The form a public request names, once the request has passed every
   * check that comes before learning anything about it. Checked in this
   * order, each needing the one before: the link has a share key's shape
   * (so junk never reaches Postgres), a form holds that key, the form is on,
   * its project's plan includes forms, and the visitor's network is allowed.
   *
   * includeBranding reads the form's logo and favicon - the images
   * themselves and the project each was uploaded in, through the form's own
   * relations - with the form, in the same query: for the public page's
   * read. A submission never needs them, so it never pays for them.
   */
  private async getFormForPublicRequest(data: {
    shareKey: string | undefined;
    clientIp: string | undefined;
    includeBranding?: boolean | undefined;
  }): Promise<Model> {
    const shareKey: string =
      typeof data.shareKey === "string"
        ? data.shareKey.trim().toLowerCase()
        : "";

    if (!ObjectID.isValidUUID(shareKey)) {
      throw new NotFoundException(FORM_NOT_AVAILABLE_MESSAGE);
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
        targetType: true,
        fields: true,
        targetSettings: true,
        templates: true,
        successMessage: true,
        ipWhitelist: true,
        ...(data.includeBranding
          ? {
              logoAltText: true,
              logoFile: {
                file: true,
                fileType: true,
                projectId: true,
              },
              faviconFile: {
                file: true,
                fileType: true,
                projectId: true,
              },
            }
          : {}),
      },
      props: {
        isRoot: true,
      },
    });

    // Only a form that is switched on. A missing or null switch is off.
    if (!form || !form.id || !form.projectId || form.isEnabled !== true) {
      throw new NotFoundException(FORM_NOT_AVAILABLE_MESSAGE);
    }

    if (!(await this.isProjectOnPlan(form.projectId))) {
      throw new NotFoundException(FORM_NOT_AVAILABLE_MESSAGE);
    }

    if (
      !this.isClientIpAllowed({
        ipWhitelist: form.ipWhitelist,
        clientIp: data.clientIp,
      })
    ) {
      if (!data.clientIp) {
        logger.error(
          `FormService: could not establish the client address of a request to form ${form.id.toString()}, which has an IP allowlist; refused.`,
          this.getLogAttributes(form),
        );
      }

      throw new ForbiddenException(FORM_NETWORK_NOT_ALLOWED_MESSAGE);
    }

    return form;
  }

  // The record the dashboard lists under the form's Submissions.
  private async recordSubmission(data: {
    form: Model;
    created: FormSubmissionCreated;
    context: FormSubmissionContext;
    sorted: SortedFormAnswers;
  }): Promise<void> {
    try {
      const submission: FormSubmission = new FormSubmission();
      submission.projectId = data.form.projectId!;
      submission.formId = data.form.id!;
      submission.targetType = readFormTargetType(data.form.targetType);

      if (submission.targetType === FormTargetType.ScheduledMaintenance) {
        submission.scheduledMaintenanceId = data.created.id;
      } else {
        submission.incidentId = data.created.id;
      }

      const answers: Array<FormSubmissionAnswer> = getFormSubmissionAnswers({
        fields: data.context.fields,
        answers: data.context.answers,
      });

      submission.answers = answers as unknown as JSONArray;

      if (data.sorted.submitterName) {
        submission.submitterName = data.sorted.submitterName;
      }

      if (data.sorted.submitterEmail) {
        submission.submitterEmail = new Email(data.sorted.submitterEmail);
      }

      await FormSubmissionService.create({
        data: submission,
        props: {
          isRoot: true,
        },
      });
    } catch (err) {
      this.logFailureAfterCreate({
        form: data.form,
        created: data.created,
        step: "record the submission for",
        error: err,
      });
    }
  }

  /*
   * Who submitted, and their answers to the form's own questions, where only
   * the people who act on the record can read them.
   */
  private async addSubmissionNote(data: {
    form: Model;
    created: FormSubmissionCreated;
    handler: AnyFormTargetHandler;
    sorted: SortedFormAnswers;
    // The template the submission started from, if any.
    templateName?: string | undefined;
  }): Promise<void> {
    try {
      await data.handler.addNote({
        form: data.form,
        createdId: data.created.id,
        note: getFormSubmissionNote({
          formName: data.form.name,
          submitterName: data.sorted.submitterName,
          submitterEmail: data.sorted.submitterEmail,
          templateName: data.templateName,
          answers: data.sorted.questions,
        }),
      });
    } catch (err) {
      this.logFailureAfterCreate({
        form: data.form,
        created: data.created,
        step: "add the submission's private note to",
        error: err,
      });
    }
  }

  private logFailureAfterCreate(data: {
    form: Model;
    created: FormSubmissionCreated;
    step: string;
    error: unknown;
  }): void {
    const attributes: LogAttributes = {
      ...this.getLogAttributes(data.form),
      createdId: data.created.id.toString(),
    };

    logger.error(
      `FormService: could not ${data.step} ${data.created.id.toString()}, created through form ${data.form.id?.toString()}. It stands.`,
      attributes,
    );
    logger.error(data.error, attributes);
  }

  private getLogAttributes(form: Model): LogAttributes {
    return {
      projectId: form.projectId?.toString(),
      formId: form.id?.toString(),
    };
  }

  /*
   * Every record the questions and settings name belongs to the form's
   * project: the target's custom fields a question is linked to, the
   * records a choice question offers, and everything the settings name.
   *
   * A question's custom field, or a record it offers, that the form held
   * already is not checked again: it may have been deleted since, and the
   * public page simply leaves such a question or record out - refusing would
   * keep an admin from saving the rest of the form until they found it.
   */
  private async validateProjectReferences(data: {
    projectId: ObjectID;
    targetType: FormTargetType;
    fields: unknown;
    settings: unknown;
    storedFields: unknown;
    checkFields: boolean;
    checkSettings: boolean;
  }): Promise<void> {
    const handler: AnyFormTargetHandler = getFormTargetHandler(data.targetType);

    if (data.checkSettings && data.settings) {
      await handler.validateReferences({
        projectId: data.projectId,
        settings: data.settings as JSONObject,
      });
    }

    if (!data.checkFields) {
      return;
    }

    const fields: Array<FormField> = readFormFields(data.fields);
    const stored: Array<FormField> = readFormFields(data.storedFields);

    const heldCustomFieldIds: Set<string> = new Set<string>();
    const heldOptionIds: Set<string> = new Set<string>();

    for (const field of stored) {
      if (field.customFieldId) {
        heldCustomFieldIds.add(field.customFieldId);
      }

      for (const id of field.allowedOptionIds || []) {
        heldOptionIds.add(id);
      }
    }

    const newCustomFieldIds: Array<string> = fields
      .filter((field: FormField): boolean => {
        return Boolean(
          field.source === FormFieldSource.TargetCustomField &&
            field.customFieldId &&
            !heldCustomFieldIds.has(field.customFieldId),
        );
      })
      .map((field: FormField): string => {
        return field.customFieldId!;
      });

    if (newCustomFieldIds.length > 0) {
      const definitions: Array<FormCustomFieldDefinition> =
        await handler.getCustomFieldDefinitions(data.projectId);

      const known: Set<string> = new Set<string>(
        definitions.map((definition: FormCustomFieldDefinition): string => {
          return definition.id.toLowerCase();
        }),
      );

      for (const id of newCustomFieldIds) {
        if (!known.has(id)) {
          throw new BadDataException(
            `A question is linked to a custom field this project does not have (${id}).`,
          );
        }
      }
    }

    // Per source, the records offered that the form did not offer before.
    const newOptionIds: Map<FormTargetOptionsSource, Set<string>> = new Map();

    for (const field of fields) {
      if (field.source !== FormFieldSource.TargetField) {
        continue;
      }

      const definition: FormTargetFieldDefinition | undefined =
        getFormTargetField(data.targetType, field.targetField);

      if (!definition || !definition.optionsSource) {
        continue;
      }

      for (const id of field.allowedOptionIds || []) {
        if (heldOptionIds.has(id)) {
          continue;
        }

        const ids: Set<string> =
          newOptionIds.get(definition.optionsSource) || new Set<string>();
        ids.add(id);
        newOptionIds.set(definition.optionsSource, ids);
      }
    }

    for (const [source, ids] of newOptionIds) {
      const found: Array<FormRecordOption> = await FormRecordOptions.load({
        projectId: data.projectId,
        source: source,
        ids: Array.from(ids),
      });

      if (found.length !== ids.size) {
        throw new BadDataException(
          "A question offers a record that does not belong to this project. Choose from the project's own.",
        );
      }
    }
  }

  // A stored target, or the default; anything else is refused.
  private readTargetTypeForWrite(value: unknown): FormTargetType {
    if (value === undefined || value === null) {
      return readFormTargetType(undefined);
    }

    if (!isFormTargetType(value)) {
      throw new BadDataException(FORM_TARGET_TYPE_MESSAGE);
    }

    return value;
  }

  /*
   * The public page asks exactly the questions stored here, and the submit
   * route checks the answers against them, so a list it could not read must
   * not be stored by mistake. Stored exactly as sent when valid.
   */
  private assertValidFields(data: {
    value: unknown;
    targetType: FormTargetType;
  }): void {
    const problem: string | null = validateFormFields(data);

    if (problem) {
      throw new BadDataException(problem);
    }
  }

  /*
   * The submitter's answers, and the hidden questions' answers from the
   * template the submission started from. They never overlap - the request
   * is only read for the questions the page asks - but the submitter's
   * would win if they did.
   */
  private withHiddenAnswers(data: {
    answers: ValidatedFormAnswers;
    hiddenAnswers: ValidatedFormAnswers;
  }): ValidatedFormAnswers {
    const answers: ValidatedFormAnswers = {};

    for (const source of [data.hiddenAnswers, data.answers]) {
      for (const key of Object.keys(source)) {
        Object.defineProperty(answers, key, {
          value: source[key],
          enumerable: true,
          writable: true,
          configurable: true,
        });
      }
    }

    return answers;
  }

  /*
   * The templates' shape (validateFormTemplates): what the Templates page
   * and the public page read must be what was stored. Stored exactly as
   * sent when valid.
   */
  private assertValidTemplates(value: unknown): void {
    const problem: string | null = validateFormTemplates(value);

    if (problem) {
      throw new BadDataException(problem);
    }
  }

  /*
   * Every answer the templates hold suits the question it answers, as the
   * form will ask it once the write is applied - an option the question
   * offers, a record the form offers, text that fits - so a template never
   * fills in what a submission would be refused for, nor answers a hidden
   * question with what its record cannot hold. The questions are built as
   * the public page builds them (buildPublicFormFor), from the project's
   * own custom fields and records: a template cannot name another
   * project's.
   */
  private async assertValidTemplateAnswers(data: {
    projectId: ObjectID;
    targetType: FormTargetType;
    fields: unknown;
    templates: unknown;
  }): Promise<void> {
    if (readFormTemplates(data.templates).length === 0) {
      return;
    }

    const form: Model = new Model();
    form.projectId = data.projectId;
    form.targetType = data.targetType;
    form.fields = (data.fields ?? []) as JSONArray;

    const built: BuiltPublicForm = await this.buildPublicFormFor(form);

    const problem: string | null = validateFormTemplateAnswers({
      templates: data.templates,
      fields: built.allFields,
    });

    if (problem) {
      throw new BadDataException(problem);
    }
  }

  private assertValidTargetSettings(data: {
    value: unknown;
    targetType: FormTargetType;
  }): void {
    const problem: string | null = validateFormTargetSettings({
      targetType: data.targetType,
      value: data.value,
    });

    if (problem) {
      throw new BadDataException(problem);
    }
  }

  /*
   * A logo or favicon a write points a form at must be a File uploaded in
   * that form's own project (FileService stamps every upload with the
   * request's project), of a type the public page draws, and small
   * (getFormBrandingImageProblem): the page is handed it inside the form, to
   * anyone with the link, every time it opens. So a form can never be used
   * to show - or to learn about - a file of another project: such a file,
   * one uploaded with no project, a missing one and a reference that is not
   * an id are all the same "not found". The file itself is never made
   * public.
   *
   * Either spelling of the reference is read - the dashboard's forms write
   * the relation, server-side callers and the API the id - and two that
   * disagree are refused (RelationIdUtil). An empty one clears the image, as
   * null does, so it never reaches the uuid column. A file the form already
   * shows is not checked again: the dashboard's dialog sends the whole form
   * back, and nothing about a file can change once it is uploaded. The check
   * reads a file's type, size and project, never its bytes.
   */
  private async assertValidBrandingImages(data: {
    values: Dictionary<unknown>;
    // Every form the write is for: its project, and the files it shows now.
    forms: Array<BrandingCheckForm>;
  }): Promise<void> {
    for (const image of FORM_BRANDING_IMAGES) {
      for (const key of [image.idColumn, image.relationColumn]) {
        if (data.values[key] === "") {
          data.values[key] = null;
        }
      }

      const fileId: ObjectID | null = RelationIdUtil.readConsistent(
        data.values as Record<string, unknown>,
        [image.idColumn, image.relationColumn],
        image.name,
      );

      if (!fileId) {
        continue;
      }

      let facts: FileFacts | null | undefined = undefined;

      for (const form of data.forms) {
        const held: ObjectID | null | undefined = form[image.idColumn];

        if (held && held.toString() === fileId.toString()) {
          continue;
        }

        if (facts === undefined) {
          facts = await FileService.getFileFacts(fileId);
        }

        /*
         * Checked here, before its type and size, so a refusal never says
         * anything about a file of another project - DatabaseService holds
         * the file to the form's project again, as it does every File.
         */
        const isFormsOwn: boolean = FileOwnership.isFileOfProject(
          facts,
          form.projectId,
        );

        const problem: string | null = isFormsOwn
          ? getFormBrandingImageProblem({
              image: image,
              file: facts,
            })
          : image.notFoundMessage;

        if (problem) {
          throw new BadDataException(problem);
        }
      }
    }
  }

  /*
   * Every line an entry the public routes can match (see FormIpAllowlist):
   * an entry that can never match would lock everyone on that network out,
   * silently. Refused, never rewritten.
   */
  private assertValidIpAllowlist(value: unknown): void {
    const problem: string | null = validateFormIpAllowlist(value);

    if (problem) {
      throw new BadDataException(problem);
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
      throw new BadDataException(FORM_SHARE_KEY_MESSAGE);
    }
  }
}

export default new Service();
