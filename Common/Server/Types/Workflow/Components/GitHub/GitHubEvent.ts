import Workflow from "../../../../../Models/DatabaseModels/Workflow";
import WorkflowLog from "../../../../../Models/DatabaseModels/WorkflowLog";
import WorkflowVariable from "../../../../../Models/DatabaseModels/WorkflowVariable";
import {
  GitHubEventEnvelope,
  GitHubEventMatch,
} from "../../../../../Types/CodeRepository/GitHubEvent";
import LIMIT_MAX from "../../../../../Types/Database/LimitMax";
import BadDataException from "../../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import ComponentMetadata from "../../../../../Types/Workflow/Component";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import GitHubComponents from "../../../../../Types/Workflow/Components/GitHub";
import WorkflowStatus from "../../../../../Types/Workflow/WorkflowStatus";
import GitHubEventUtil from "../../../../../Utils/CodeRepository/GitHubEventUtil";
import WorkflowLogService from "../../../../Services/WorkflowLogService";
import WorkflowService from "../../../../Services/WorkflowService";
import WorkflowVariableService from "../../../../Services/WorkflowVariableService";
import GitHubInstallationBinding from "../../../../Utils/CodeRepository/GitHub/GitHubInstallationBinding";
import GitHubWorkflowClient from "../../../../Utils/CodeRepository/GitHub/GitHubWorkflowClient";
import logger from "../../../../Utils/Logger";
import CaptureSpan from "../../../../Utils/Telemetry/CaptureSpan";
import VMAPI from "../../../../Utils/VM/VMAPI";
import QueryHelper from "../../../Database/QueryHelper";
import { RunOptions, RunReturnType } from "../../ComponentCode";
import TriggerCode, { ExecuteWorkflowType } from "../../TriggerCode";

export default class GitHubEventTrigger extends TriggerCode {
  public constructor() {
    super();
    const metadata: ComponentMetadata | undefined = GitHubComponents.find(
      (component: ComponentMetadata): boolean => {
        return component.id === ComponentID.GitHubEvent;
      },
    );
    if (!metadata) {
      throw new BadDataException("GitHub event trigger not found.");
    }
    this.setMetadata(metadata);
  }

  public override async run(
    args: JSONObject,
    options: RunOptions,
  ): Promise<RunReturnType> {
    const values: JSONObject = { ...args };
    /*
     * The authenticated manual-run form sends sample JSON as editor text.
     * Verified deliveries already have these fields normalized into objects.
     */
    for (const field of ["labels", "payload"]) {
      const value: unknown = values[field];
      if (typeof value === "string" && value.trim()) {
        let parsed: unknown;
        try {
          parsed = JSON.parse(value);
        } catch {
          throw options.onError(
            new BadDataException(`Sample GitHub ${field} must be valid JSON.`),
          );
        }
        const valid: boolean =
          field === "labels"
            ? Array.isArray(parsed) &&
              parsed.every((label: unknown): boolean => {
                return typeof label === "string";
              })
            : Boolean(parsed) &&
              typeof parsed === "object" &&
              !Array.isArray(parsed);
        if (!valid) {
          throw options.onError(
            new BadDataException(
              `Sample GitHub ${field} must be ${field === "labels" ? "a JSON array of label names" : "a JSON object"}.`,
            ),
          );
        }
        values[field] = parsed as JSONObject;
      }
    }
    if (
      typeof values["issueNumber"] === "string" &&
      values["issueNumber"].trim()
    ) {
      const issueNumber: number = Number(values["issueNumber"]);
      if (!Number.isSafeInteger(issueNumber) || issueNumber <= 0) {
        throw options.onError(
          new BadDataException(
            "Sample GitHub issue number must be a positive integer.",
          ),
        );
      }
      values["issueNumber"] = issueNumber;
    }
    for (const field of ["isBot", "isPullRequest"]) {
      if (values[field] === "true" || values[field] === "false") {
        values[field] = values[field] === "true";
      }
    }
    return super.run(values, options);
  }

  /** Called only by the verified GitHub delivery worker, never an unauthenticated route. */
  @CaptureSpan()
  public async dispatch(
    data: { projectId: ObjectID; envelope: JSONObject },
    executeWorkflow: (options: ExecuteWorkflowType) => Promise<void>,
  ): Promise<number> {
    const envelope: GitHubEventEnvelope | null = GitHubEventUtil.normalize({
      event: data.envelope["event"] as string,
      deliveryId: data.envelope["deliveryId"] as string,
      payload: data.envelope["payload"] as JSONObject,
      codeRepositoryId: data.envelope["codeRepositoryId"] as string,
    });
    if (!envelope) {
      return 0;
    }
    if (!ObjectID.isValidUUID(envelope.codeRepositoryId)) {
      throw new BadDataException(
        "GitHub event must belong to a connected repository.",
      );
    }
    await GitHubInstallationBinding.assertInstallationBoundToProject({
      projectId: data.projectId,
      installationId: envelope.installationId,
    });

    let scheduled: number = 0;
    let skip: number = 0;
    let writeAccess: Promise<boolean> | undefined;
    let firstFailure: unknown;
    while (true) {
      const workflows: Array<Workflow> = await WorkflowService.findBy({
        query: {
          projectId: data.projectId,
          triggerId: ComponentID.GitHubEvent,
          isEnabled: true,
        },
        select: { _id: true, triggerArguments: true },
        props: { isRoot: true },
        limit: LIMIT_MAX,
        skip: skip,
      });

      for (const workflow of workflows) {
        if (!workflow.id) {
          continue;
        }
        try {
          let match: GitHubEventMatch;
          try {
            const filters: JSONObject = await this.resolveFilters(
              data.projectId,
              workflow,
            );
            match = GitHubEventUtil.match(envelope, filters);
          } catch (error) {
            if (!(error instanceof BadDataException)) {
              throw error;
            }
            // A bad filter belongs to this workflow. Record it without blocking others.
            const log: WorkflowLog = new WorkflowLog();
            log.projectId = data.projectId;
            log.workflowId = workflow.id;
            log.workflowStatus = WorkflowStatus.Error;
            log.logs = `GitHub event ${envelope.deliveryId} could not match this workflow: ${error.message}`;
            await WorkflowLogService.create({
              data: log,
              props: { isRoot: true },
            });
            continue;
          }
          if (!match.matches) {
            continue;
          }
          if (match.requireWriteAccess) {
            writeAccess ??= GitHubWorkflowClient.hasWriteAccess({
              projectId: data.projectId,
              repository: envelope.codeRepositoryId,
              username: envelope.sender,
            });
            if (!(await writeAccess)) {
              continue;
            }
          }
          await executeWorkflow({
            workflowId: workflow.id,
            returnValues: {
              ...envelope,
              commandArguments: match.commandArguments,
            },
            idempotencyKey: `github:${envelope.installationId}:${envelope.deliveryId}:${workflow.id.toString()}`,
          });
          scheduled++;
        } catch (error) {
          firstFailure ??= error;
          logger.error(error, {
            projectId: data.projectId.toString(),
            workflowId: workflow.id.toString(),
          });
        }
      }
      if (workflows.length < LIMIT_MAX) {
        break;
      }
      skip += workflows.length;
    }
    /*
     * Successfully enqueued workflows carry per-delivery idempotency keys, so a retry can
     * finish failed workflows without repeating the ones already scheduled.
     */
    if (firstFailure) {
      throw firstFailure;
    }
    return scheduled;
  }

  private async resolveFilters(
    projectId: ObjectID,
    workflow: Workflow,
  ): Promise<JSONObject> {
    const filters: JSONObject = { ...(workflow.triggerArguments || {}) };
    if (
      !Object.values(filters).some((value: unknown): boolean => {
        return typeof value === "string" && value.includes("{{");
      })
    ) {
      return filters;
    }
    const localVariables: Array<WorkflowVariable> =
      await WorkflowVariableService.findBy({
        query: { projectId: projectId, workflowId: workflow.id! },
        select: { name: true, content: true },
        skip: 0,
        limit: LIMIT_MAX,
        props: { isRoot: true },
      });
    const globalVariables: Array<WorkflowVariable> =
      await WorkflowVariableService.findBy({
        query: { projectId: projectId, workflowId: QueryHelper.isNull() },
        select: { name: true, content: true },
        skip: 0,
        limit: LIMIT_MAX,
        props: { isRoot: true },
      });
    const local: JSONObject = {};
    const global: JSONObject = {};
    for (const variable of localVariables) {
      if (variable.name) {
        local[variable.name] = variable.content;
      }
    }
    for (const variable of globalVariables) {
      if (variable.name) {
        global[variable.name] = variable.content;
      }
    }
    for (const key of Object.keys(filters)) {
      const value: unknown = filters[key];
      if (typeof value === "string" && value.includes("{{")) {
        filters[key] = VMAPI.replaceValueInPlace(
          { local: { variables: local }, global: { variables: global } },
          value,
          false,
        );
        if (typeof filters[key] === "string" && !filters[key].trim()) {
          throw new BadDataException(
            `GitHub ${key} filter variable resolved to an empty value. Set the variable, or remove the filter explicitly.`,
          );
        }
      }
    }
    return filters;
  }
}
