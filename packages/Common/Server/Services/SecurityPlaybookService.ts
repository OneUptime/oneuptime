import DatabaseService from "./DatabaseService";
import ProjectReferencesService from "./ProjectReferencesService";
import SecurityEventConnectionService from "./SecurityEventConnectionService";
import Model from "../../Models/DatabaseModels/SecurityPlaybook";
import DatabaseBaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import DetectionRule from "../../Models/DatabaseModels/DetectionRule";
import IncidentSeverity from "../../Models/DatabaseModels/IncidentSeverity";
import Label from "../../Models/DatabaseModels/Label";
import OnCallDutyPolicy from "../../Models/DatabaseModels/OnCallDutyPolicy";
import SecurityCasePriority from "../../Models/DatabaseModels/SecurityCasePriority";
import SecurityCaseStatus from "../../Models/DatabaseModels/SecurityCaseStatus";
import SecurityEventConnection from "../../Models/DatabaseModels/SecurityEventConnection";
import Team from "../../Models/DatabaseModels/Team";
import User from "../../Models/DatabaseModels/User";
import Workflow from "../../Models/DatabaseModels/Workflow";
import CreateBy from "../Types/Database/CreateBy";
import UpdateBy from "../Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import { JsonReferenceColumn } from "../Utils/Database/ProjectReferenceCheck";
import CallerPermission from "../Utils/Permission/CallerPermission";
import ProjectScopedReferenceValidator, {
  ProjectScopedReference,
} from "../Utils/Database/ProjectScopedReferenceValidator";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import Includes from "../../Types/BaseDatabase/Includes";
import OneUptimeDate from "../../Types/Date";
import { LIMIT_PER_PROJECT } from "../../Types/Database/LimitMax";
import BadDataException from "../../Types/Exception/BadDataException";
import { JSONArray, JSONObject, JSONValue } from "../../Types/JSON";
import ObjectID from "../../Types/ObjectID";
import { isSecurityDetectionSource } from "../../Types/SecurityCase/SecurityDetectionSource";
import {
  SecurityPlaybookActionDefinition,
  getSecurityPlaybookAction,
} from "../../Types/SecurityPlaybook/SecurityPlaybookAction";
import {
  SecurityPlaybookApprovalTurnedOff,
  SecurityPlaybookStep,
  TURN_OFF_CONTAINMENT_APPROVAL_PERMISSIONS,
  parseSecurityPlaybookSteps,
} from "../../Types/SecurityPlaybook/SecurityPlaybookStep";
import { isSecurityPlaybookTrigger } from "../../Types/SecurityPlaybook/SecurityPlaybookTrigger";
import { validateSecurityPlaybookStepValues } from "../../Utils/SecurityCase/SecurityPlaybookStepValues";
import SecurityCaseValues, {
  ProjectSecurityCaseValues,
} from "../Utils/SecurityCase/SecurityCaseValues";

/*
 * Every record a step's settings name, by the setting it is under. A step's
 * settings are JSON, which no column metadata describes, so the playbook
 * names them here and the project check holds each to the project: an
 * on-call policy, a label or a connection of another project is refused like
 * one that does not exist, when the playbook is saved rather than when it
 * first runs.
 */
const STEP_REFERENCE_SETTINGS: ReadonlyArray<{
  key: string;
  isList: boolean;
  modelName: string;
  modelType: { new (): DatabaseBaseModel };
}> = [
  { key: "userId", isList: false, modelName: "User", modelType: User },
  { key: "userIds", isList: true, modelName: "User", modelType: User },
  { key: "teamId", isList: false, modelName: "Team", modelType: Team },
  { key: "teamIds", isList: true, modelName: "Team", modelType: Team },
  { key: "labelIds", isList: true, modelName: "Label", modelType: Label },
  {
    key: "onCallPolicyId",
    isList: false,
    modelName: "On-Call Policy",
    modelType: OnCallDutyPolicy,
  },
  {
    key: "incidentSeverityId",
    isList: false,
    modelName: "Incident Severity",
    modelType: IncidentSeverity,
  },
  {
    key: "connectionId",
    isList: false,
    modelName: "Security Event Connection",
    modelType: SecurityEventConnection,
  },
  {
    key: "workflowId",
    isList: false,
    modelName: "Workflow",
    modelType: Workflow,
  },
  // Set priority, Check threat intel's raise and Set status: the project's own.
  {
    key: "priorityId",
    isList: false,
    modelName: "Security Case Priority",
    modelType: SecurityCasePriority,
  },
  {
    key: "raisePriorityToId",
    isList: false,
    modelName: "Security Case Priority",
    modelType: SecurityCasePriority,
  },
  {
    key: "statusId",
    isList: false,
    modelName: "Security Case Status",
    modelType: SecurityCaseStatus,
  },
];

// Distinct well-formed ids from a stored or posted list.
export function readIdList(value: unknown): Array<string> {
  let raw: unknown = value;

  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(raw)) {
    return [];
  }

  const ids: Array<string> = [];

  for (const item of raw) {
    const id: string = typeof item === "string" ? item.trim() : "";

    if (id && ObjectID.isValidUUID(id) && !ids.includes(id)) {
      ids.push(id);
    }
  }

  return ids;
}

function readSteps(value: unknown): Array<JSONObject> {
  let raw: unknown = value;

  if (typeof raw === "string") {
    try {
      raw = JSON.parse(raw);
    } catch {
      return [];
    }
  }

  if (!Array.isArray(raw)) {
    return [];
  }

  return raw.filter((item: unknown): boolean => {
    return Boolean(item) && typeof item === "object" && !Array.isArray(item);
  }) as Array<JSONObject>;
}

export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  protected override getJsonReferenceColumns(): Array<JsonReferenceColumn> {
    return [
      {
        column: "steps",
        getReferences: Service.getStepReferences,
      },
      {
        column: "detectionRuleIds",
        getReferences: Service.getDetectionRuleReferences,
      },
    ];
  }

  // The rules a playbook is limited to, for the project check.
  public static getDetectionRuleReferences(
    value: unknown,
  ): Array<ProjectScopedReference> {
    return readIdList(value).map((id: string): ProjectScopedReference => {
      return {
        modelName: "Detection Rule",
        id: id,
        service: ProjectScopedReferenceValidator.getLookupService(
          DetectionRule,
        ) as unknown as DatabaseService<DatabaseBaseModel>,
      };
    });
  }

  // One reference per record a step names, for the project check.
  public static getStepReferences(
    value: unknown,
  ): Array<ProjectScopedReference> {
    const references: Array<ProjectScopedReference> = [];

    for (const step of readSteps(value)) {
      const config: JSONValue | undefined = step["config"];

      if (!config || typeof config !== "object" || Array.isArray(config)) {
        continue;
      }

      const settings: JSONObject = config as JSONObject;

      for (const setting of STEP_REFERENCE_SETTINGS) {
        const raw: JSONValue | undefined = settings[setting.key];
        const ids: Array<unknown> = setting.isList
          ? Array.isArray(raw)
            ? raw
            : []
          : [raw];

        for (const id of ids) {
          if (typeof id !== "string" || !ObjectID.isValidUUID(id.trim())) {
            continue;
          }

          references.push({
            modelName: setting.modelName,
            id: id.trim(),
            service: ProjectScopedReferenceValidator.getLookupService(
              setting.modelType,
            ) as unknown as DatabaseService<DatabaseBaseModel>,
          });
        }
      }
    }

    return references;
  }

  /*
   * The cleaning that needs no other record, first: steps read into their
   * clean shape (so the project check reads the ids a run will act on), and
   * the trigger and conditions held to their values.
   */
  protected override async checkCreateBeforeReferences(
    createBy: CreateBy<Model>,
  ): Promise<void> {
    this.normalizeWrite(createBy.data as unknown as JSONObject);
  }

  protected override async checkUpdateBeforeReferences(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    this.normalizeWrite(updateBy.data as unknown as JSONObject);
  }

  private normalizeWrite(data: JSONObject): void {
    if (data["name"] !== undefined && data["name"] !== null) {
      const name: string = String(data["name"]).trim();

      if (!name) {
        throw new BadDataException("A playbook needs a name.");
      }

      data["name"] = name;
    }

    if (data["steps"] !== undefined && data["steps"] !== null) {
      data["steps"] = parseSecurityPlaybookSteps(
        data["steps"],
      ) as unknown as JSONArray;
    }

    if (
      data["trigger"] !== undefined &&
      data["trigger"] !== null &&
      !isSecurityPlaybookTrigger(data["trigger"])
    ) {
      throw new BadDataException(
        "Trigger must be Case Opened, Detection Added or Manual.",
      );
    }

    /*
     * No minimum runs on every priority. One of another project's is the
     * project check's to refuse.
     */
    if (data["minimumSecurityCasePriorityId"] === "") {
      data["minimumSecurityCasePriorityId"] = null;
    }

    if (
      data["detectionRuleIds"] !== undefined &&
      data["detectionRuleIds"] !== null
    ) {
      data["detectionRuleIds"] = readIdList(data["detectionRuleIds"]);
    }

    if (data["detectionSource"] === "") {
      data["detectionSource"] = null;
    }

    if (
      data["detectionSource"] !== undefined &&
      data["detectionSource"] !== null &&
      !isSecurityDetectionSource(data["detectionSource"])
    ) {
      throw new BadDataException(
        "Detection source must be Detection Rule, Threat Intel, Connected Product or Manual.",
      );
    }
  }

  public static mayTurnOffContainmentApproval(
    props: DatabaseCommonInteractionProps,
  ): boolean {
    return (
      Boolean(props.isRoot || props.isMasterAdmin) ||
      CallerPermission.holdsAnyOf(
        props,
        TURN_OFF_CONTAINMENT_APPROVAL_PERMISSIONS,
      )
    );
  }

  /*
   * THE APPROVAL RULE: a containment step waits for a person's approval
   * unless a Security Admin (or a Project Owner or Admin) saved it with
   * Needs Approval off. Such a step is stamped with who did, and when
   * (approvalTurnedOff); a stamp a write sends is never taken as it is.
   * Anyone else may save a playbook whose containment step a Security Admin
   * let run without approval, as long as that step is as it was - the same
   * action through the same connection - and is refused when they turn
   * approval off themselves, or change a step that has it off.
   */
  public static applyContainmentApprovalRule(data: {
    steps: Array<SecurityPlaybookStep>;
    // The playbook's steps before the write: none for a new playbook.
    storedSteps: Array<SecurityPlaybookStep>;
    props: DatabaseCommonInteractionProps;
  }): Array<SecurityPlaybookStep> {
    const mayTurnOff: boolean = Service.mayTurnOffContainmentApproval(
      data.props,
    );
    const now: string = OneUptimeDate.getCurrentDate().toISOString();

    return data.steps.map(
      (step: SecurityPlaybookStep, index: number): SecurityPlaybookStep => {
        const definition: SecurityPlaybookActionDefinition | undefined =
          getSecurityPlaybookAction(step.action);
        const unstamped: SecurityPlaybookStep = { ...step };
        delete unstamped.approvalTurnedOff;

        if (!definition?.isDisruptive || step.requiresApproval) {
          return unstamped;
        }

        const stored: SecurityPlaybookStep | undefined = data.storedSteps.find(
          (candidate: SecurityPlaybookStep): boolean => {
            return candidate.id === step.id;
          },
        );

        if (
          stored &&
          stored.approvalTurnedOff &&
          !stored.requiresApproval &&
          stored.action === step.action &&
          JSON.stringify(stored.config) === JSON.stringify(step.config)
        ) {
          return { ...unstamped, approvalTurnedOff: stored.approvalTurnedOff };
        }

        if (!mayTurnOff) {
          throw new BadDataException(
            `Step ${index + 1} (${definition.title}): a containment step waits for approval. Only a Security Admin can let it run without one.`,
          );
        }

        const approvalTurnedOff: SecurityPlaybookApprovalTurnedOff = {
          ...(data.props.userId
            ? { byUserId: data.props.userId.toString() }
            : {}),
          at: now,
        };

        return { ...unstamped, approvalTurnedOff };
      },
    );
  }

  /*
   * A containment step acts through a connection of one product: a step
   * that suspends Okta users cannot be pointed at a CrowdStrike connection.
   * Read after the project check, which has already refused a connection of
   * another project.
   */
  private async assertConnectionsFitSteps(data: {
    projectId: ObjectID;
    steps: unknown;
  }): Promise<void> {
    const steps: Array<SecurityPlaybookStep> = parseSecurityPlaybookSteps(
      data.steps,
    );

    const connectionIds: Array<string> = [];

    for (const step of steps) {
      const connectionId: JSONValue | undefined = step.config["connectionId"];

      if (typeof connectionId === "string" && connectionId) {
        connectionIds.push(connectionId);
      }
    }

    if (connectionIds.length === 0) {
      return;
    }

    const connections: Array<SecurityEventConnection> =
      await SecurityEventConnectionService.findBy({
        query: {
          projectId: data.projectId,
          _id: new Includes(connectionIds),
        },
        select: {
          _id: true,
          name: true,
          provider: true,
        },
        skip: 0,
        limit: LIMIT_PER_PROJECT,
        props: {
          isRoot: true,
        },
      });

    steps.forEach((step: SecurityPlaybookStep, index: number): void => {
      const definition: SecurityPlaybookActionDefinition | undefined =
        getSecurityPlaybookAction(step.action);
      const connectionId: JSONValue | undefined = step.config["connectionId"];

      if (!definition?.connectionProvider || typeof connectionId !== "string") {
        return;
      }

      const connection: SecurityEventConnection | undefined = connections.find(
        (candidate: SecurityEventConnection): boolean => {
          return candidate.id?.toString() === connectionId;
        },
      );

      if (connection && connection.provider !== definition.connectionProvider) {
        throw new BadDataException(
          `Step ${index + 1} (${definition.title}): the connection "${connection.name || ""}" is not a connection to the product this step acts through. Choose another.`,
        );
      }
    });
  }

  /*
   * The steps, held to the project's case priorities and statuses
   * (validateSecurityPlaybookStepValues): each one the project's, Set status
   * never to where every case starts, a verdict for a status that closes.
   * Read only when a step names one.
   */
  private async checkStepValues(data: {
    projectId: ObjectID;
    steps: Array<SecurityPlaybookStep>;
  }): Promise<Array<SecurityPlaybookStep>> {
    const namesAValue: boolean = data.steps.some(
      (step: SecurityPlaybookStep): boolean => {
        return (
          step.config["priorityId"] !== undefined ||
          step.config["statusId"] !== undefined ||
          step.config["raisePriorityToId"] !== undefined
        );
      },
    );

    if (!namesAValue) {
      return data.steps;
    }

    const values: ProjectSecurityCaseValues =
      await SecurityCaseValues.getForProject(data.projectId);

    return validateSecurityPlaybookStepValues({
      steps: data.steps,
      priorities: values.priorities,
      statuses: values.statuses,
    });
  }

  // A row's stored steps; a snapshot that no longer reads counts as none.
  private static readStoredSteps(value: unknown): Array<SecurityPlaybookStep> {
    try {
      return parseSecurityPlaybookSteps(value);
    } catch {
      return [];
    }
  }

  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    if (!createBy.data.projectId) {
      throw new BadDataException("A playbook needs a project.");
    }

    await this.assertConnectionsFitSteps({
      projectId: createBy.data.projectId,
      steps: createBy.data.steps,
    });

    if (createBy.data.steps !== undefined && createBy.data.steps !== null) {
      createBy.data.steps = Service.applyContainmentApprovalRule({
        steps: await this.checkStepValues({
          projectId: createBy.data.projectId,
          steps: parseSecurityPlaybookSteps(createBy.data.steps),
        }),
        storedSteps: [],
        props: createBy.props,
      }) as unknown as JSONArray;
    }

    return { createBy: createBy, carryForward: undefined };
  }

  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    if (updateBy.data.steps !== undefined && updateBy.data.steps !== null) {
      const rows: Array<Model> = await this.findRowsAndHoldUpdateToThem(
        updateBy,
        {
          _id: true,
          projectId: true,
          steps: true,
        },
      );

      for (const row of rows) {
        if (row.projectId) {
          await this.assertConnectionsFitSteps({
            projectId: row.projectId,
            steps: updateBy.data.steps,
          });
        }
      }

      let steps: Array<SecurityPlaybookStep> = parseSecurityPlaybookSteps(
        updateBy.data.steps,
      );

      // Every row's project's priorities and statuses are asked.
      for (const row of rows) {
        if (row.projectId) {
          steps = await this.checkStepValues({
            projectId: row.projectId,
            steps,
          });
        }
      }

      // Every row is asked, against its own stored steps.
      const ruledByRow: Array<Array<SecurityPlaybookStep>> = (
        rows.length > 0 ? rows : [new Model()]
      ).map((row: Model): Array<SecurityPlaybookStep> => {
        return Service.applyContainmentApprovalRule({
          steps,
          storedSteps: Service.readStoredSteps(row.steps),
          props: updateBy.props,
        });
      });

      (updateBy.data as unknown as JSONObject)["steps"] =
        ruledByRow[0] as unknown as JSONArray;
    }

    return { updateBy: updateBy, carryForward: null };
  }
}

export default new Service();
