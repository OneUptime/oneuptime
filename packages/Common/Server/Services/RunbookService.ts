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
import ModelPermission from "../Types/Database/Permissions/Index";
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
 *   - a create or an update names one only when its caller may read
 *     credentials, as every record that names a setting holding credentials
 *     is held to its caller's read of that setting's table
 *     (RelationListPermission.isHeldToTableRead): a caller who may not is
 *     answered as if the credential were not there. An update asks only
 *     about the credentials some runbook it writes does not name already,
 *     so an edit that keeps a credential keeps it. Asked before the project
 *     check below, as the records any write names are asked about before
 *     its hooks run: a caller who may not read credentials gets the same
 *     answer for every credential, the project's or not;
 *   - each must be one of the project's credentials, checked with every
 *     other reference the runbook names, in the same answer
 *     (getJsonReferenceColumns).
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
   * Whether `props` may name credentials in a runbook's steps: whether it
   * may read them (RelationListPermission.mayReadTable). OneUptime and
   * master admins may.
   */
  public static mayNameCredentials(
    props: DatabaseCommonInteractionProps,
  ): boolean {
    return RelationListPermission.mayReadTable(RunbookCredential, props);
  }

  /*
   * Refuses `ids` - the credentials a write by a caller who may not read
   * credentials names, that its runbooks do not name already - in the words
   * every reference check answers with. Nothing to refuse when there are
   * none.
   */
  public static refuseCredentialsNamed(ids: Array<string>): void {
    if (ids.length === 0) {
      return;
    }

    throw new UnreadableReferenceException(
      getReferenceRefusalMessage({
        subject: "runbook",
        described: ids.map((id: string): string => {
          return `Credential "${id}"`;
        }),
      }),
    );
  }

  @CaptureSpan()
  protected override async onBeforeCreate(
    createBy: CreateBy<Model>,
  ): Promise<OnCreate<Model>> {
    // Before the project check. See the top of this file.
    if (!Service.mayNameCredentials(createBy.props)) {
      Service.refuseCredentialsNamed(
        Service.getStepCredentialIds(createBy.data.steps),
      );
    }

    return await super.onBeforeCreate(createBy);
  }

  @CaptureSpan()
  protected override async onBeforeUpdate(
    updateBy: UpdateBy<Model>,
  ): Promise<OnUpdate<Model>> {
    const named: Array<string> = Service.getStepCredentialIds(
      (updateBy.data as unknown as Record<string, unknown>)["steps"],
    );

    // Before the project check. See the top of this file.
    if (named.length > 0 && !Service.mayNameCredentials(updateBy.props)) {
      Service.refuseCredentialsNamed(
        await this.findCredentialsNotHeld({ updateBy: updateBy, ids: named }),
      );
    }

    return await super.onBeforeUpdate(updateBy);
  }

  /*
   * Of `ids`, the ones some runbook an update writes does not name already
   * in its steps. The runbooks are read as OneUptime through the query the
   * caller may update with (ModelPermission.getUpdatableQuery - the same
   * narrowing the update itself gets, as DatabaseService reads the lists an
   * update holds), so a runbook the update cannot write says nothing, and
   * an update that writes no runbook names no credential.
   */
  private async findCredentialsNotHeld(data: {
    updateBy: UpdateBy<Model>;
    ids: Array<string>;
  }): Promise<Array<string>> {
    const query: Query<Model> = await ModelPermission.getUpdatableQuery(
      Model,
      data.updateBy.query,
      data.updateBy.props,
      data.updateBy.data,
    );

    const runbooks: Array<Model> = await this.findBy({
      query: query,
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
          Service.getStepCredentialIds(runbook.steps).map(normalizeReferenceId),
        );
      },
    );

    return data.ids.filter((id: string): boolean => {
      return held.some((ids: Set<string>): boolean => {
        return !ids.has(normalizeReferenceId(id));
      });
    });
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
