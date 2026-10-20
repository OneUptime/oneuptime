import ObjectID from "../../../../Types/ObjectID";
import { JSONObject } from "../../../../Types/JSON";
import RunnerJobOrigin from "../../../../Types/Runbook/RunnerJobOrigin";
import {
  KubectlCommandTier,
  KubernetesClusterAiAccessStatus,
} from "../../../../Types/Kubernetes/KubernetesClusterAiAccess";
import {
  AiRemediationCommandGitOps,
  AiRemediationGitOpsOwner,
  AiRemediationRevertWatch,
} from "../../../../Types/AutoRemediation/AiRemediationGitOps";
import OneUptimeDate from "../../../../Types/Date";
import KubectlPolicy, {
  KubectlNamedObject,
  KubectlPolicyResult,
} from "../../../../Utils/AiRemediation/KubectlPolicy";
import {
  GitOpsChangeEffect,
  buildOwnershipReadCommand,
  classifyGitOpsChange,
  describeGitOpsChange,
  readControllerReference,
  readGitOpsOwner,
} from "../../../../Utils/AiRemediation/GitOpsOwnership";
import {
  buildRevertWatch,
  findPutBackFields,
} from "../../../../Utils/AiRemediation/KubectlRevertWatch";
import KubectlJobRunner, {
  KubectlJobOutcome,
  KubectlRunState,
} from "../ClusterAccess/KubectlJobRunner";
import KubernetesClusterAiAccessService from "../../../Services/KubernetesClusterAiAccessService";
import logger from "../../Logger";

/*
 * The cluster side of GitOps on a kubectl fix: reads, through the
 * cluster's own AI agent (or Runner), the object a fix changes — before
 * the fix, to say who declares it (GitOpsOwnership) and to have its
 * fields from before; after it, to record what the fix changed; and while
 * verification runs, to notice when what the fix changed is put back
 * (KubectlRevertWatch).
 *
 * Every read is `kubectl get <kind>/<name> -n <namespace> -o json
 * --show-managed-fields`: read-only, so it rides the investigation lane
 * (origin AiInvestigation, under the AI run that changes the object) and
 * its brake, never the remediation lane's command budget or breaker. A
 * read that fails says nothing: the fix is proposed or run exactly as it
 * would have been without it, only without the GitOps facts.
 */

// A get of one object: seconds, even on a busy API server.
const READ_TIMEOUT_MS: number = 30_000;

/*
 * Everything a Deployment with its managed fields can be; the agent caps
 * its own output at 1 MB.
 */
const MAX_READ_OUTPUT_CHARS: number = 1_000_000;

// kubectl's answer for an object that does not exist.
const NOT_FOUND_PATTERN: RegExp = /\(NotFound\)|not found/i;

const STDOUT_HEADER: string = "[stdout]\n";
const STDERR_SECTION: string = "\n[stderr]\n";

/*
 * The kinds a fix's object is read for: a pod is its workload's (and git
 * never declares one), a Secret is never read, and nodes and namespaces
 * are not something an application's manifests declare.
 */
const NEVER_READ_KINDS: Set<string> = new Set<string>([
  "pod",
  "secret",
  "event",
  "node",
  "namespace",
]);

// How far a pod's owners are followed: pod → ReplicaSet → Deployment.
const MAX_OWNER_HOPS: number = 3;

// The built-in kinds a namespaced object read here may be.
const NAMESPACED_BUILTIN_KINDS: Set<string> = new Set<string>([
  "pod",
  "deployment",
  "statefulset",
  "daemonset",
  "replicaset",
  "job",
  "cronjob",
]);

// The one object a kubectl write changes, where it lives.
export interface KubectlWatchTarget {
  target: KubectlNamedObject;
  namespace: string;
}

export type KubectlObjectRead =
  | { found: true; object: JSONObject }
  | { found: false; notFound: true }
  | { found: false; notFound: false; reason: string };

export interface GitOpsCommandInspection {
  watchTarget: KubectlWatchTarget;
  // The object as it was read before the change.
  before: KubectlObjectRead;
  // Who declares it and what that means for this change; absent: nobody.
  gitOps?: AiRemediationCommandGitOps | undefined;
}

// What a read goes through: the cluster's access target as it stands.
export interface GitOpsReadCluster {
  clusterId: string;
  runnerId: string;
  credentialId?: string | undefined;
}

export default class GitOpsInspector {
  public static toReadCluster(
    cluster: KubernetesClusterAiAccessStatus,
  ): GitOpsReadCluster | null {
    if (!cluster.runner?.id) {
      return null;
    }

    return {
      clusterId: cluster.clusterId,
      runnerId: cluster.runner.id,
      credentialId: cluster.credentialId,
    };
  }

  /*
   * The read access of a cluster as its AI page stands NOW — for the reads
   * around an approved command and while verification watches one, which
   * happen long after the run that composed it. Null when the cluster is
   * gone or has no access target.
   */
  public static async getReadClusterNow(data: {
    projectId: ObjectID;
    kubernetesClusterId: string | undefined;
  }): Promise<GitOpsReadCluster | null> {
    if (
      !data.kubernetesClusterId ||
      !ObjectID.isValidUUID(data.kubernetesClusterId)
    ) {
      return null;
    }

    const status: KubernetesClusterAiAccessStatus | null =
      await KubernetesClusterAiAccessService.getStatusForCluster({
        clusterId: new ObjectID(data.kubernetesClusterId),
        projectId: data.projectId,
      });

    return status ? GitOpsInspector.toReadCluster(status) : null;
  }

  /*
   * The one object a kubectl WRITE names, when it is one this check reads:
   * a named object of a namespaced kind, in the namespace the command
   * gives with -n. A read, a selector, several objects, a pod, a Secret, a
   * node or a namespace, or a write with no -n, has none.
   */
  public static getWatchTarget(command: string): KubectlWatchTarget | null {
    const policy: KubectlPolicyResult = KubectlPolicy.evaluateCommand(command);

    if (
      policy.tier === KubectlCommandTier.Denied ||
      policy.tier === KubectlCommandTier.Read ||
      !policy.namespace
    ) {
      return null;
    }

    const target: KubectlNamedObject | null = KubectlPolicy.getNamedObject(
      policy.args,
    );

    if (!target || NEVER_READ_KINDS.has(target.kind)) {
      return null;
    }

    // A built-in kind the tiers know that is not namespaced: cluster-scoped.
    if (
      target.builtinKind !== undefined &&
      !NAMESPACED_BUILTIN_KINDS.has(target.builtinKind)
    ) {
      return null;
    }

    return { target, namespace: policy.namespace };
  }

  /*
   * The JSON object a `kubectl get -o json` printed, from a job's output
   * ("[stdout]" then "[stderr]"), or null when it is not one.
   */
  public static parseObjectOutput(output: string): JSONObject | null {
    let text: string = output || "";

    if (text.startsWith(STDOUT_HEADER)) {
      text = text.slice(STDOUT_HEADER.length);
    }

    const stderrAt: number = text.lastIndexOf(STDERR_SECTION);

    if (stderrAt >= 0) {
      text = text.slice(0, stderrAt);
    }

    try {
      const parsed: unknown = JSON.parse(text.trim());

      return parsed && typeof parsed === "object" && !Array.isArray(parsed)
        ? (parsed as JSONObject)
        : null;
    } catch {
      return null;
    }
  }

  // One object, read through the cluster's access target.
  public static async readObject(data: {
    projectId: ObjectID;
    aiRunId: ObjectID;
    cluster: GitOpsReadCluster;
    kind: string;
    name: string;
    namespace: string;
    stepId: string;
  }): Promise<KubectlObjectRead> {
    let outcome: KubectlJobOutcome;

    try {
      outcome = await KubectlJobRunner.run({
        projectId: data.projectId,
        aiRunId: data.aiRunId,
        origin: RunnerJobOrigin.AiInvestigation,
        kubernetesClusterId: new ObjectID(data.cluster.clusterId),
        targetRunnerId: new ObjectID(data.cluster.runnerId),
        credentialId: data.cluster.credentialId,
        command: buildOwnershipReadCommand({
          kind: data.kind,
          name: data.name,
          namespace: data.namespace,
        }),
        stepId: data.stepId,
        timeoutInMs: READ_TIMEOUT_MS,
        maxOutputChars: MAX_READ_OUTPUT_CHARS,
      });
    } catch (error) {
      return {
        found: false,
        notFound: false,
        reason: error instanceof Error ? error.message : String(error),
      };
    }

    if (outcome.succeeded) {
      const object: JSONObject | null = GitOpsInspector.parseObjectOutput(
        outcome.output,
      );

      return object
        ? { found: true, object }
        : {
            found: false,
            notFound: false,
            reason: "kubectl did not print the object as JSON",
          };
    }

    if (
      outcome.runState === KubectlRunState.Ran &&
      NOT_FOUND_PATTERN.test(`${outcome.output}\n${outcome.errorMessage || ""}`)
    ) {
      return { found: false, notFound: true };
    }

    return {
      found: false,
      notFound: false,
      reason: outcome.errorMessage || "the read did not succeed",
    };
  }

  /*
   * Reads the object a kubectl write changes and says who declares it:
   * the object itself, or — for an object a controller made, like a
   * ReplicaSet — the workload that owns it. Null when the command names no
   * object this check reads.
   */
  public static async inspectCommand(data: {
    projectId: ObjectID;
    aiRunId: ObjectID;
    cluster: GitOpsReadCluster;
    command: string;
    stepIdPrefix: string;
  }): Promise<GitOpsCommandInspection | null> {
    const watchTarget: KubectlWatchTarget | null =
      GitOpsInspector.getWatchTarget(data.command);

    if (!watchTarget) {
      return null;
    }

    const before: KubectlObjectRead = await GitOpsInspector.readObject({
      projectId: data.projectId,
      aiRunId: data.aiRunId,
      cluster: data.cluster,
      kind: watchTarget.target.rawKind,
      name: watchTarget.target.name,
      namespace: watchTarget.namespace,
      stepId: `${data.stepIdPrefix}-before`,
    });

    if (!before.found) {
      return { watchTarget, before };
    }

    let ownerObject: JSONObject = before.object;
    let ownerKind: string = watchTarget.target.kind;
    let ownerName: string = watchTarget.target.name;
    let owner: AiRemediationGitOpsOwner | null = readGitOpsOwner(ownerObject);

    /*
     * Nothing declares the object itself: what controls it might be (a
     * ReplicaSet's Deployment). Followed a few hops, never past a failed
     * read.
     */
    for (let hop: number = 0; !owner && hop < MAX_OWNER_HOPS; hop++) {
      const reference: { kind: string; name: string } | null =
        readControllerReference(ownerObject);

      if (!reference || NEVER_READ_KINDS.has(reference.kind)) {
        break;
      }

      const read: KubectlObjectRead = await GitOpsInspector.readObject({
        projectId: data.projectId,
        aiRunId: data.aiRunId,
        cluster: data.cluster,
        kind: reference.kind,
        name: reference.name,
        namespace: watchTarget.namespace,
        stepId: `${data.stepIdPrefix}-owner-${hop + 1}`,
      });

      if (!read.found) {
        break;
      }

      ownerObject = read.object;
      ownerKind = reference.kind;
      ownerName = reference.name;
      owner = readGitOpsOwner(ownerObject);
    }

    if (!owner) {
      return { watchTarget, before };
    }

    const effect: GitOpsChangeEffect = classifyGitOpsChange({
      target: watchTarget.target,
      object: ownerObject,
      owner,
    });

    return {
      watchTarget,
      before,
      gitOps: describeGitOpsChange({
        owner,
        effect,
        objectKind: ownerKind,
        objectName: ownerName,
        objectNamespace: watchTarget.namespace,
      }),
    };
  }

  /*
   * After a kubectl change ran: reads its object again and returns what the
   * change did to it (KubectlRevertWatch), for verification to watch. Null
   * without a read from before the change, when the read after it fails,
   * or when the change changed nothing a later read could see.
   */
  public static async captureRevertWatch(data: {
    projectId: ObjectID;
    aiRunId: ObjectID;
    cluster: GitOpsReadCluster;
    inspection: GitOpsCommandInspection | null;
    stepId: string;
  }): Promise<AiRemediationRevertWatch | null> {
    const inspection: GitOpsCommandInspection | null = data.inspection;

    if (!inspection || !inspection.before.found) {
      return null;
    }

    const before: JSONObject = inspection.before.object;

    const after: KubectlObjectRead = await GitOpsInspector.readObject({
      projectId: data.projectId,
      aiRunId: data.aiRunId,
      cluster: data.cluster,
      kind: inspection.watchTarget.target.rawKind,
      name: inspection.watchTarget.target.name,
      namespace: inspection.watchTarget.namespace,
      stepId: data.stepId,
    });

    // A read that failed tells nothing about what the change did.
    if (!after.found && !after.notFound) {
      return null;
    }

    return buildRevertWatch({
      target: inspection.watchTarget.target,
      namespace: inspection.watchTarget.namespace,
      before,
      after: after.found ? after.object : null,
      capturedAt: OneUptimeDate.getCurrentDate().toISOString(),
    });
  }

  /*
   * Reads a watched object now: the watched fields that are back at their
   * values from before the fix (empty: the fix holds), or null when the
   * read failed and nothing can be said.
   */
  public static async checkRevertWatch(data: {
    projectId: ObjectID;
    aiRunId: ObjectID;
    cluster: GitOpsReadCluster;
    watch: AiRemediationRevertWatch;
    stepId: string;
  }): Promise<Array<string> | null> {
    const read: KubectlObjectRead = await GitOpsInspector.readObject({
      projectId: data.projectId,
      aiRunId: data.aiRunId,
      cluster: data.cluster,
      kind: data.watch.kind,
      name: data.watch.name,
      namespace: data.watch.namespace,
      stepId: data.stepId,
    });

    if (!read.found && !read.notFound) {
      return null;
    }

    return findPutBackFields(data.watch, read.found ? read.object : null);
  }

  /*
   * The same three steps for an approved command and for verification,
   * which run long after the AI run that composed the command: each reads
   * through the cluster's access target as its AI page stands NOW, and
   * gives up (null) when the cluster has none.
   */
  public static async inspectCommandOnCluster(data: {
    projectId: ObjectID;
    aiRunId: ObjectID;
    kubernetesClusterId: string | undefined;
    command: string;
    stepIdPrefix: string;
  }): Promise<GitOpsCommandInspection | null> {
    const cluster: GitOpsReadCluster | null =
      await GitOpsInspector.getReadClusterNow(data);

    return cluster
      ? GitOpsInspector.inspectCommand({
          projectId: data.projectId,
          aiRunId: data.aiRunId,
          cluster,
          command: data.command,
          stepIdPrefix: data.stepIdPrefix,
        })
      : null;
  }

  public static async captureRevertWatchOnCluster(data: {
    projectId: ObjectID;
    aiRunId: ObjectID;
    kubernetesClusterId: string | undefined;
    inspection: GitOpsCommandInspection | null;
    stepId: string;
  }): Promise<AiRemediationRevertWatch | null> {
    const cluster: GitOpsReadCluster | null =
      await GitOpsInspector.getReadClusterNow(data);

    return cluster
      ? GitOpsInspector.captureRevertWatch({
          projectId: data.projectId,
          aiRunId: data.aiRunId,
          cluster,
          inspection: data.inspection,
          stepId: data.stepId,
        })
      : null;
  }

  public static async checkRevertWatchOnCluster(data: {
    projectId: ObjectID;
    aiRunId: ObjectID;
    kubernetesClusterId: string | undefined;
    watch: AiRemediationRevertWatch;
    stepId: string;
  }): Promise<Array<string> | null> {
    const cluster: GitOpsReadCluster | null =
      await GitOpsInspector.getReadClusterNow(data);

    return cluster
      ? GitOpsInspector.checkRevertWatch({
          projectId: data.projectId,
          aiRunId: data.aiRunId,
          cluster,
          watch: data.watch,
          stepId: data.stepId,
        })
      : null;
  }

  // Logs and swallows: a GitOps read never fails what it accompanies.
  public static async safely<T>(
    what: string,
    work: () => Promise<T>,
  ): Promise<T | null> {
    try {
      return await work();
    } catch (error) {
      logger.error(`GitOpsInspector: ${what} failed: ${error}`);
      return null;
    }
  }
}
