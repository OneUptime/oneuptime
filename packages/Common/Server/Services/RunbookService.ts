import ProjectReferencesService from "./ProjectReferencesService";
import RunbookLabelRuleEngineService from "./RunbookLabelRuleEngineService";
import RunbookOwnerRuleEngineService from "./RunbookOwnerRuleEngineService";
import DatabaseBaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Model from "../../Models/DatabaseModels/Runbook";
import RunbookCredential from "../../Models/DatabaseModels/RunbookCredential";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import LIMIT_MAX from "../../Types/Database/LimitMax";
import ObjectID from "../../Types/ObjectID";
import RunbookStepType from "../../Types/Runbook/RunbookStepType";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate, OnUpdate } from "../Types/Database/Hooks";
import Query from "../Types/Database/Query";
import RelationListPermission from "../Types/Database/Permissions/RelationListPermission";
import UpdateBy from "../Types/Database/UpdateBy";
import { JsonReferenceColumn } from "../Utils/Database/ProjectReferenceCheck";
import {
  getReferenceRefusalMessage,
  normalizeReferenceId,
  UnreadableReferenceException,
} from "../Utils/Database/ProjectScopedReferenceRefusal";
import ProjectScopedReferenceValidator, {
  ProjectScopedReference,
} from "../Utils/Database/ProjectScopedReferenceValidator";
import DatabaseService from "./DatabaseService";
import CaptureSpan from "../Utils/Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Utils/Logger";

// The steps that run with a credential: SSH and Kubernetes.
const CREDENTIAL_STEP_TYPES: Array<string> = [
  RunbookStepType.SSH,
  RunbookStepType.Kubernetes,
];

/*
 * THE CREDENTIALS A RUNBOOK RUNS WITH ARE ONES ITS AUTHOR MAY READ.
 *
 * A runbook's SSH and Kubernetes steps name the credential they run with
 * (RunbookCredential: an SSH key, a service account token) in its steps, a
 * JSON column no metadata describes:
 *
 *   - each must be one of the project's credentials, checked with every
 *     other reference the runbook names, in the same answer
 *     (getJsonReferenceColumns);
 *   - a create or an update names one only when its caller may read
 *     credentials, as every record that names a setting holding credentials
 *     is held to its caller's read of that setting's table
 *     (RelationListPermission.isHeldToTableRead): a caller who may not is
 *     answered as if the credential were not there. An update asks only
 *     about the credentials the runbook's steps do not name already, so an
 *     edit that keeps a credential keeps it.
 *
 * The Runner still checks, every time the step runs, that the credential is
 * the project's and assigned to it.
 */
export class Service extends ProjectReferencesService<Model> {
  public constructor() {
    super(Model);
  }

  protected override getJsonReferenceColumns(): Array<JsonReferenceColumn> {
    return [
      {
        column: "steps",
        getReferences: Service.getStepCredentialReferences,
      },
    ];
  }

  /*
   * The credentials `steps` name - the credentialId of each SSH and
   * Kubernetes step - each once, as written. A step that names none yet (a
   * new step's empty picker) names nothing.
   */
  public static getStepCredentialIds(steps: unknown): Array<string> {
    const ids: Array<string> = [];
    const seen: Set<string> = new Set<string>();

    for (const step of Array.isArray(steps) ? steps : []) {
      if (!step || typeof step !== "object") {
        continue;
      }

      const type: unknown = (step as Record<string, unknown>)["type"];
      const config: unknown = (step as Record<string, unknown>)["config"];

      if (
        typeof type !== "string" ||
        !CREDENTIAL_STEP_TYPES.includes(type) ||
        !config ||
        typeof config !== "object"
      ) {
        continue;
      }

      const value: unknown = (config as Record<string, unknown>)[
        "credentialId"
      ];

      const id: string =
        (typeof value === "string" || value instanceof ObjectID
          ? value.toString()
          : ""
        ).trim() || "";

      if (!id || seen.has(normalizeReferenceId(id))) {
        continue;
      }

      seen.add(normalizeReferenceId(id));
      ids.push(id);
    }

    return ids;
  }

  // The credentials `steps` name, as references the project check looks up.
  public static getStepCredentialReferences(
    steps: unknown,
  ): Array<ProjectScopedReference> {
    return Service.getStepCredentialIds(steps).map(
      (id: string): ProjectScopedReference => {
        return {
          modelName: "Credential",
          id: id,
          service: ProjectScopedReferenceValidator.getLookupService(
            RunbookCredential,
          ) as unknown as DatabaseService<DatabaseBaseModel>,
        };
      },
    );
  }

  /*
   * Refuses `ids` - credentials a write names that its runbook does not -
   * when its caller may not read credentials, in the words every reference
   * check answers with.
   */
  public static checkCredentialsNamed(data: {
    ids: Array<string>;
    props: DatabaseCommonInteractionProps;
  }): void {
    if (
      data.ids.length === 0 ||
      RelationListPermission.mayReadTable(RunbookCredential, data.props)
    ) {
      return;
    }

    throw new UnreadableReferenceException(
      getReferenceRefusalMessage({
        subject: "runbook",
        described: data.ids.map((id: string): string => {
          return `Credential "${id}"`;
        }),
      }),
    );
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    await super.onBeforeCreate(createBy);

    Service.checkCredentialsNamed({
      ids: Service.getStepCredentialIds(createBy.data.steps),
      props: createBy.props,
    });

    return { createBy: createBy, carryForward: undefined };
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    await super.onBeforeUpdate(updateBy);

    const named: Array<string> = Service.getStepCredentialIds(
      (updateBy.data as unknown as Record<string, unknown>)["steps"],
    );

    if (
      named.length > 0 &&
      !RelationListPermission.mayReadTable(RunbookCredential, updateBy.props)
    ) {
      /*
       * Only the credentials some runbook the update writes does not name
       * already. Hooks run before the caller's project and scope narrow the
       * query, so it is pinned to the caller's project here; any other row
       * it still matches is one more runbook that must hold the credential,
       * never one fewer.
       */
      const runbooks: Array<Model> = await this.findBy({
        query: {
          ...(updateBy.query as Record<string, unknown>),
          ...(updateBy.props.tenantId
            ? { projectId: updateBy.props.tenantId }
            : {}),
        } as Query<Model>,
        select: {
          _id: true,
          steps: true,
        },
        limit: LIMIT_MAX,
        skip: 0,
        props: {
          isRoot: true,
        },
      });

      const held: Array<Set<string>> = runbooks.map(
        (runbook: Model): Set<string> => {
          return new Set<string>(
            Service.getStepCredentialIds(runbook.steps).map(
              normalizeReferenceId,
            ),
          );
        },
      );

      Service.checkCredentialsNamed({
        ids: named.filter((id: string): boolean => {
          return held.some((ids: Set<string>): boolean => {
            return !ids.has(normalizeReferenceId(id));
          });
        }),
        props: updateBy.props,
      });
    }

    return { updateBy: updateBy, carryForward: null };
  }

  @CaptureSpan()
  protected override async onCreateSuccess(
    _onCreate: OnCreate<Model>,
    createdItem: Model,
  ): Promise<Model> {
    if (createdItem.projectId && createdItem.id) {
      /*
       * Run label rule first so rule-added labels are persisted before
       * owner rules run. Owner rules re-fetch labels, so this lets owner
       * rules key on rule-added labels.
       */
      Promise.resolve()
        .then(async () => {
          await RunbookLabelRuleEngineService.applyRulesToRunbook(createdItem);
        })
        .then(async () => {
          await RunbookOwnerRuleEngineService.applyRulesToRunbook(createdItem);
        })
        .catch((error: Error) => {
          logger.error(
            `Error applying runbook rules in RunbookService.onCreateSuccess: ${error}`,
            {
              projectId: createdItem.projectId?.toString(),
              runbookId: createdItem.id?.toString(),
            } as LogAttributes,
          );
        });
    }
    return createdItem;
  }
}

export default new Service();
