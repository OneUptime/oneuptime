import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import DatabaseService from "./DatabaseService";
import IncidentSeverityService from "./IncidentSeverityService";
import IncidentTemplateService from "./IncidentTemplateService";
import { validateCustomFieldCreateSettings } from "../../Types/CustomField/CustomFieldCreateSettings";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import QueryDeepPartialEntity from "../../Types/Database/PartialEntity";
import Dictionary from "../../Types/Dictionary";
import BadDataException from "../../Types/Exception/BadDataException";
import { isIncidentFormFieldSetting } from "../../Types/Incident/IncidentFormPublic";
import ObjectID from "../../Types/ObjectID";
import Model from "../../Models/DatabaseModels/IncidentForm";
import ProjectScopedReferenceValidator, {
  ProjectScopedReference,
  resolveReferenceId,
} from "../Utils/Database/ProjectScopedReferenceValidator";
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
 * The public routes themselves live in IncidentFormAPI.
 */

export const INCIDENT_FORM_SEVERITY_REQUIRED_MESSAGE: string =
  "An incident form needs a severity for the incidents it declares. Choose one of the project's incident severities.";

export const INCIDENT_FORM_DESCRIPTION_SETTING_MESSAGE: string =
  "Description Question must be Required, Optional or Hidden.";

export const INCIDENT_FORM_SHARE_KEY_MESSAGE: string =
  "Share Key must be a UUID, such as the one the dashboard's Reset Link generates.";

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
