import ProjectReferencesService from "./ProjectReferencesService";
import RunbookLabelRuleEngineService from "./RunbookLabelRuleEngineService";
import RunbookOwnerRuleEngineService from "./RunbookOwnerRuleEngineService";
import DatabaseBaseModel from "../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Model from "../../Models/DatabaseModels/Runbook";
import RunbookCredential from "../../Models/DatabaseModels/RunbookCredential";
import DatabaseCommonInteractionProps from "../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../Types/ObjectID";
import RunbookStepType from "../../Types/Runbook/RunbookStepType";
import CreateBy from "../Types/Database/CreateBy";
import { OnCreate } from "../Types/Database/Hooks";
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
import RunbookCredentialReaders from "../Utils/AutoRemediation/RunbookCredentialReaders";

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
   * may read them (RunbookCredentialReaders - the one rule for letting a
   * command use a credential). OneUptime and master admins may.
   */
  public static async mayNameCredentials(
    props: DatabaseCommonInteractionProps,
  ): Promise<boolean> {
    return await RunbookCredentialReaders.mayRead(props);
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

  // Before the project check (the base hooks run this first). See the top of this file.
  protected override async checkCreateBeforeReferences(
    createBy: CreateBy<Model>,
  ): Promise<void> {
    if (!(await Service.mayNameCredentials(createBy.props))) {
      Service.refuseCredentialsNamed(
        Service.getStepCredentialIds(createBy.data.steps),
      );
    }
  }

  // As checkCreateBeforeReferences: before the project check.
  protected override async checkUpdateBeforeReferences(
    updateBy: UpdateBy<Model>,
  ): Promise<void> {
    const named: Array<string> = Service.getStepCredentialIds(
      (updateBy.data as unknown as Record<string, unknown>)["steps"],
    );

    if (
      named.length > 0 &&
      !(await Service.mayNameCredentials(updateBy.props))
    ) {
      Service.refuseCredentialsNamed(
        await this.findCredentialsNotHeld({ updateBy: updateBy, ids: named }),
      );
    }
  }

  /*
   * Of `ids`, the ones some runbook an update writes does not name already
   * in its steps. The runbooks are the ones the update writes - those its
   * caller may write - and the update is held to them
   * (findRowsAndHoldUpdateToThem), so a runbook the update cannot write says
   * nothing, one this did not read is not written, and an update that
   * writes no runbook names no credential.
   */
  private async findCredentialsNotHeld(data: {
    updateBy: UpdateBy<Model>;
    ids: Array<string>;
  }): Promise<Array<string>> {
    const runbooks: Array<Model> = await this.findRowsAndHoldUpdateToThem(
      data.updateBy,
      {
        _id: true,
        steps: true,
      },
    );

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
