import { NO_BREAK_SPACE } from "../../../Types/NoBreakSpaces";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import CodeRepository from "../../../Models/DatabaseModels/CodeRepository";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import {
  CloudSavingsActionKind,
  CloudSavingsActionPlan,
} from "../../../Types/Cloud/CloudSavingsAction";
import {
  CloudSavingsDeclaredCode,
  CloudSavingsFixInCodeResult,
} from "../../../Types/Cloud/CloudSavingsApiTypes";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import CodeTaskAccess from "../AI/CodeTask/CodeTaskAccess";
import CodeTaskGate from "../AI/CodeTask/CodeTaskGate";
import CodeTaskRuns from "../AI/CodeTask/CodeTaskRuns";
import { getRepositoryFullName } from "../AI/Remediation/DeclaredCodeOwner";
import CloudSavingsActions, { CloudSavingContext } from "./CloudSavingsActions";
import CloudSavingsOwners from "./CloudSavingsOwners";

/*
 * OR FIX IT IN CODE (#11010): a saving on a resource declared in
 * infrastructure code - Terraform, CloudFormation, Pulumi, Bicep, as its
 * tags say (CloudAiTargets.getManagedAsCode) - is better made in that
 * code, or the next deploy puts the resource back as it was: a disk
 * deleted in the console comes back, a resized instance is resized again.
 *
 * So its dialog offers a pull request first: a Code task in the
 * repository that declares it (DeclaredCodeOwner picks it from the
 * resource's tags and the repositories' files), asking OneUptime AI to
 * make the saving's change there. The task is the person's own - started
 * as them, gated as asking in Code is - and reviewed and merged by them;
 * OneUptime changes nothing in the cloud for it.
 */

// The request a Code task is asked: the change, in the code that declares the resource.
export function getCloudSavingsCodeFixRequest(data: {
  plan: CloudSavingsActionPlan;
  resourceName: string;
  resourceId: string;
  managedAs: string;
  monthlySavings: string;
}): string {
  const what: string = `${data.resourceName} (${data.resourceId})`;
  const change: Record<CloudSavingsActionKind, string> = {
    [CloudSavingsActionKind.StopInstance]: `Stop the instance ${what} where the code allows it (an instance count of 0, a desired state of stopped), or remove it if nothing needs it.`,
    [CloudSavingsActionKind.StopDatabase]: `Stop or remove the database ${what}, which is idle.`,
    [CloudSavingsActionKind.ChangeVolumeType]: `Change the volume ${what} from ${data.plan.from || "its type"} to ${data.plan.to || "gp3"}, keeping its size, with at least the IOPS and throughput it has now.`,
    [CloudSavingsActionKind.DeleteVolume]: `Remove the unattached disk ${what}. Keep a final snapshot of it if the code can take one (a final snapshot or a snapshot resource).`,
    [CloudSavingsActionKind.DeleteSnapshot]: `Remove the old snapshot ${what}.`,
    [CloudSavingsActionKind.DeleteImage]: `Remove the old image ${what}.`,
    [CloudSavingsActionKind.ReleaseAddress]: `Remove the public address ${what}, which nothing uses.`,
    [CloudSavingsActionKind.ResizeInstance]: `Resize the instance ${what} from ${data.plan.from || "its size"} to ${data.plan.to}.`,
    [CloudSavingsActionKind.ResizeDatabase]: `Resize the database ${what} from ${data.plan.from || "its class"} to ${data.plan.to}.`,
  };

  return [
    `Make this cloud cost saving in the infrastructure code that declares the resource (${data.managedAs}), so the next deploy keeps it: ${change[data.plan.kind]}`,
    `It saves about ${data.monthlySavings} a month. Change only what this needs, and leave the resource's name and everything else as it is.`,
  ].join("\n\n");
}

export default class CloudSavingsCodeFix {
  public static async start(data: {
    props: DatabaseCommonInteractionProps;
    projectId: ObjectID;
    cloudCostRecommendationId: ObjectID;
    // The repository the person picked; the one OneUptime found otherwise.
    codeRepositoryId?: unknown;
  }): Promise<CloudSavingsFixInCodeResult> {
    if (!data.props.userId) {
      throw new BadDataException("Sign in to open a pull request.");
    }

    if (
      !CloudSavingsOwners.canRequest({
        props: data.props,
        projectId: data.projectId,
      })
    ) {
      throw new BadDataException(
        "You may not act on this project's savings: it takes permission to edit its cloud resources.",
      );
    }

    const saving: CloudSavingContext = await CloudSavingsActions.readSaving({
      projectId: data.projectId,
      cloudCostRecommendationId: data.cloudCostRecommendationId,
    });
    const plan: CloudSavingsActionPlan | undefined = saving.planResult.plan;

    if (!plan) {
      throw new BadDataException(
        "This saving is not a change OneUptime can describe for code. Make it in your cloud's console.",
      );
    }

    const declared: CloudSavingsDeclaredCode | undefined =
      await CloudSavingsActions.getDeclaredInCode({
        projectId: data.projectId,
        resource: saving.resource,
      });

    if (!declared) {
      throw new BadDataException(
        "Nothing says this resource is declared in code, so there is no code to change. Apply it in the cloud instead.",
      );
    }

    const picked: string =
      typeof data.codeRepositoryId === "string" &&
      ObjectID.isValidUUID(data.codeRepositoryId)
        ? data.codeRepositoryId
        : declared.codeRepositoryId || "";

    if (!picked) {
      throw new BadDataException(
        "OneUptime found no repository that declares this resource. Choose the repository the pull request goes to.",
      );
    }

    const repositoryId: ObjectID = new ObjectID(picked);
    const repository: CodeRepository =
      await CodeTaskAccess.getReadableRepository({
        props: data.props,
        projectId: data.projectId,
        repositoryId,
      });

    // As asking in Code: the person's permission, then everything AI needs.
    await CodeTaskGate.assertCanStart({
      props: data.props,
      projectId: data.projectId,
      repository,
      canAsk: await CodeTaskAccess.canAskInRepository({
        props: data.props,
        projectId: data.projectId,
        repositoryId,
      }),
    });

    const amount: number =
      Math.round((Number(saving.recommendation.monthlySavings) || 0) * 100) /
      100;
    const run: AIRun = await CodeTaskRuns.start({
      projectId: data.projectId,
      userId: data.props.userId,
      repository,
      message: getCloudSavingsCodeFixRequest({
        plan,
        resourceName:
          saving.resource?.name ||
          saving.recommendation.resourceName ||
          plan.target.id,
        resourceId: saving.recommendation.resourceId || plan.target.id,
        managedAs: declared.managedAs,
        monthlySavings: `${amount.toFixed(2)}${NO_BREAK_SPACE}${(
          saving.recommendation.currency || "USD"
        ).toUpperCase()}`,
      }),
      context: [],
    });

    return {
      aiRunId: run.id!.toString(),
      codeRepositoryName: getRepositoryFullName({
        name: repository.name || "",
        organizationName: repository.organizationName || "",
        repositoryName: repository.repositoryName || "",
      }),
    };
  }
}
