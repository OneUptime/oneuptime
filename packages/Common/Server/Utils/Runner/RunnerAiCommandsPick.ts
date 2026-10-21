import Runner from "../../../Models/DatabaseModels/Runner";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import QueryHelper from "../../Types/Database/QueryHelper";
import RunnerService, {
  Service as RunnerServiceClass,
} from "../../Services/RunnerService";
import CaptureSpan from "../Telemetry/CaptureSpan";
import logger, { LogAttributes } from "../Logger";

/*
 * PICKING A RUNNER FOR ONEUPTIME AI'S COMMANDS IS WHAT LETS THEM RUN THERE.
 *
 * A Runner used to carry a "Runs AI Remediation Commands" switch, turned on
 * on its own page before anything could hand it OneUptime AI's commands. The
 * maintainer: "remove Run AI remediation commands as well, this should be in
 * Incident / Alert remediation settings on which runner to run from". So the
 * Runner is picked where the commands come from, and that pick is the
 * consent: an auto remediation rule picks it as its Runner
 * (AutoRemediationRule.runnerId), and OneUptime AI runs the rule's commands
 * there.
 *
 * The column the switch wrote (Runner.canRunAiCommands) stays as what every
 * check that serves, approves or runs such a command reads - the Runner's
 * claim, the approval of a plan, the run - and only OneUptime writes it now:
 * on here, for the Runners a pick names. Which Runners a rule's commands
 * target is read from the rule, never from the column
 * (AutoRemediationFix.getRuleCommandRunnerIds), so a Runner it is on for runs
 * commands only for what picked it.
 *
 * Never for a global Runner (it runs JavaScript steps in a sandbox every
 * project shares, and belongs to no project), nor for the in-cluster Runner
 * the Kubernetes agent chart installed, whose registration already decides
 * it, nor for another project's Runner: the write is held to the project's
 * own Runners that are neither.
 *
 * Who may pick is decided where the pick is saved (the rule's own
 * permissions). The pick asked one thing more while runbook credentials
 * existed - OneUptime AI picked among a Runner's SSH credentials for the SSH
 * commands it ran there - and asks nothing more now that they are gone:
 * OneUptime AI's commands on a Runner run on that Runner's own host.
 */
export default class RunnerAiCommandsPick {
  @CaptureSpan()
  public static async allowPickedRunners(data: {
    projectId: ObjectID | undefined | null;
    runnerIds: Array<ObjectID | string | null | undefined>;
    /*
     * Who picks them. Read for nothing any more: a pick asks no more than
     * the write that saves it. Kept so every caller says who it acts for.
     */
    props?: DatabaseCommonInteractionProps | undefined;
  }): Promise<void> {
    const ids: Array<ObjectID> = RunnerServiceClass.readRunnerIds(
      data.runnerIds.filter(
        (id: ObjectID | string | null | undefined): boolean => {
          return Boolean(id);
        },
      ),
    );

    if (!data.projectId || ids.length === 0) {
      return;
    }

    const projectId: ObjectID = data.projectId;

    const runners: Array<Runner> = await RunnerService.findBy({
      query: {
        _id: QueryHelper.any(ids),
        projectId: projectId,
        isGlobalRunner: false,
        canRunAiCommands: false,
      },
      select: {
        _id: true,
        name: true,
        hostInfo: true,
      },
      limit: ids.length,
      skip: 0,
      props: { isRoot: true },
    });

    const toAllow: Array<Runner> = runners.filter((runner: Runner): boolean => {
      return (
        Boolean(runner._id) &&
        !RunnerServiceClass.isKubernetesAgentRunnerRow(runner)
      );
    });

    for (const runner of toAllow) {
      await RunnerService.updateOneById({
        id: new ObjectID(runner._id!.toString()),
        data: {
          canRunAiCommands: true,
        },
        props: { isRoot: true },
      });

      logger.info(
        `RunnerAiCommandsPick: Runner ${runner._id!.toString()} was picked for OneUptime AI's commands, so it now runs them.`,
        { projectId: projectId.toString() } as LogAttributes,
      );
    }
  }
}
