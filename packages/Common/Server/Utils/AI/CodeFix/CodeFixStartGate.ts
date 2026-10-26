import ProjectService, { CurrentPlan } from "../../../Services/ProjectService";
import CaptureSpan from "../../Telemetry/CaptureSpan";
import CodeTaskGate from "../CodeTask/CodeTaskGate";
import CodeFixRunRepository from "./CodeFixRunRepository";
import CodeRepository from "../../../../Models/DatabaseModels/CodeRepository";
import CodeFixTaskContext from "../../../../Types/AI/CodeFixTaskContext";
import CodeFixTaskType from "../../../../Types/AI/CodeFixTaskType";
import { CodeTaskBlocker } from "../../../../Types/AI/CodeTask";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../../Types/ObjectID";

/*
 * WHETHER A CODE-FIX RUN A PERSON ASKS FOR OUTSIDE CODE COULD DO ITS WORK
 * NOW, AND IF NOT, WHY.
 *
 * A trace's "Fix performance with AI" and a service's "Improve logging /
 * tracing with AI" queue a code-fix run (SubjectCodeFixRun) that finds its
 * repository from the facts it carries (CodeFixRunRepository) and is taken
 * by the Runner that repository picks. Those buttons used to ask only for a
 * connected repository, so a project on a plan without AI in Code, out of
 * AI credits, past its daily AI limit or with no Runner online queued runs
 * that failed at their first model call, or waited for a Runner that never
 * came.
 *
 * Now they ask what Code's own request box asks (CodeTaskGate): about the
 * repository the run will be queued on, or - when none resolves yet -
 * about everything that does not depend on one. The plan and the bill are
 * the project's, read for it (nobody's request carries them here), and the
 * person's own permission to edit the repository is not asked: these runs
 * are OneUptime's, started by anyone who may read the trace or the service.
 *
 * The suggestion routes ask this before they offer the button, and the
 * create routes ask it again and refuse in the same words, so the page
 * never offers a fix the server then refuses - and a SetUp offer says
 * what is missing in Code's words, with the step that clears it.
 */
export interface CodeFixStart {
  // The repository the run will be queued on, or null when none resolves.
  codeRepositoryId: ObjectID | null;
  // What stops the run doing its work now, in Code's words, or null.
  blocker: CodeTaskBlocker | null;
}

export default class CodeFixStartGate {
  /*
   * `billingEnabled` overrides the IsBillingEnabled flag, for tests (as
   * CodeTaskGate's own).
   */
  @CaptureSpan()
  public static async check(data: {
    projectId: ObjectID;
    taskType: CodeFixTaskType;
    taskContext: CodeFixTaskContext;
    billingEnabled?: boolean | undefined;
  }): Promise<CodeFixStart> {
    const [codeRepositoryId, plan]: [ObjectID | null, CurrentPlan] =
      await Promise.all([
        CodeFixRunRepository.resolveForNewRun({
          projectId: data.projectId,
          taskType: data.taskType,
          taskContext: data.taskContext,
        }),
        ProjectService.getCurrentPlan(data.projectId),
      ]);

    let repository: CodeRepository | null = null;

    if (codeRepositoryId) {
      repository = new CodeRepository();
      repository.id = codeRepositoryId;
    }

    const props: DatabaseCommonInteractionProps = {
      isRoot: true,
      ...(plan.plan ? { currentPlan: plan.plan } : {}),
      isSubscriptionUnpaid: plan.isSubscriptionUnpaid,
    };

    const blocker: CodeTaskBlocker | null = await CodeTaskGate.getBlocker({
      props,
      projectId: data.projectId,
      repository,
      canAsk: true,
      billingEnabled: data.billingEnabled,
    });

    return { codeRepositoryId, blocker };
  }
}
