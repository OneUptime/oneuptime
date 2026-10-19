import ChangeEvent from "../../../../Models/AnalyticsModels/ChangeEvent";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import SortOrder from "../../../../Types/BaseDatabase/SortOrder";
import OneUptimeDate from "../../../../Types/Date";
import ObjectID from "../../../../Types/ObjectID";
import { ChangeEventStatus } from "../../../../Utils/Telemetry/ChangeEventFields";
import ChangeEventService from "../../../Services/ChangeEventService";
import {
  CHANGE_GROUP_WINDOW_MINUTES,
  RecordedChange,
  toRecordedChange,
} from "../SRE/RecentChangesContext";
import { quotedUntrustedLine, untrustedLine } from "../SRE/UntrustedText";

/*
 * Rollback first: the kubectl rollback of a change OneUptime recorded.
 *
 * When a deploy is what broke a service, rolling it back is usually the
 * fastest safe fix. The remediation round's roll_back_change tool builds
 * that rollback from the RECORDED change - the Deployment, its namespace
 * and its cluster as the change event says them - never from words the
 * model writes, and hands it to the same policy, modes and approvals as
 * every other kubectl command.
 *
 * It refuses rather than guess:
 *   - a change that names no Deployment, namespace or cluster;
 *   - a name that is not a Kubernetes name: the names come from telemetry,
 *     and a command is built from them;
 *   - a Deployment that changed again after the change (another rollout,
 *     or a command OneUptime ran on it): `kubectl rollout undo` goes back
 *     ONE revision, which would then undo the later change, not this one.
 */

// A namespace is a DNS-1123 label.
const NAMESPACE_NAME: RegExp = /^[a-z0-9](?:[-a-z0-9]{0,61}[a-z0-9])?$/;

// A Deployment's name is a DNS-1123 subdomain.
const DEPLOYMENT_NAME: RegExp = /^[a-z0-9](?:[-a-z0-9.]{0,251}[a-z0-9])?$/;

// The most later changes read to find one of the same Deployment.
export const MAX_LATER_CHANGES_READ: number = 500;

// The longest text from a change a rollback's description quotes.
const MAX_QUOTED_TEXT_LENGTH: number = 200;

export interface KubernetesRollbackTarget {
  // The recorded change the rollback undoes: the Deployment's rollout.
  change: RecordedChange;
  kubernetesClusterId: string;
  namespace: string;
  deploymentName: string;
}

export type KubernetesRollbackResolution =
  | { target: KubernetesRollbackTarget; refusal?: undefined }
  | { refusal: string; target?: undefined };

export function isKubernetesNamespaceName(value: string): boolean {
  return NAMESPACE_NAME.test(value);
}

export function isKubernetesDeploymentName(value: string): boolean {
  return value.length <= 253 && DEPLOYMENT_NAME.test(value);
}

// The Deployment a recorded change rolled out, or why it names none.
export function readKubernetesRollbackTarget(
  change: RecordedChange,
): KubernetesRollbackResolution {
  const deploymentName: string = change.fields.kubernetesDeployment || "";
  const namespace: string = change.fields.kubernetesNamespace || "";
  const kubernetesClusterId: string = change.fields.kubernetesClusterId || "";

  if (!deploymentName) {
    return {
      refusal:
        "This change names no Kubernetes Deployment, so there is nothing for kubectl to roll back. A deploy is rolled back where it was made: in its pipeline, or with a revert of its commits.",
    };
  }

  if (!namespace || !kubernetesClusterId) {
    return {
      refusal: `This change names Deployment ${quotedUntrustedLine(
        deploymentName,
        MAX_QUOTED_TEXT_LENGTH,
      )} but not ${
        namespace ? "the cluster OneUptime knows it by" : "its namespace"
      }, so the rollback cannot be aimed at it.`,
    };
  }

  if (!isKubernetesDeploymentName(deploymentName)) {
    return {
      refusal: `The Deployment name this change carries, ${quotedUntrustedLine(
        deploymentName,
        MAX_QUOTED_TEXT_LENGTH,
      )}, is not a Kubernetes name, so no command is built from it.`,
    };
  }

  if (!isKubernetesNamespaceName(namespace)) {
    return {
      refusal: `The namespace this change carries, ${quotedUntrustedLine(
        namespace,
        MAX_QUOTED_TEXT_LENGTH,
      )}, is not a Kubernetes name, so no command is built from it.`,
    };
  }

  if (!ObjectID.isValidUUID(kubernetesClusterId)) {
    return {
      refusal:
        "This change does not name a cluster OneUptime knows, so the rollback cannot be aimed at it.",
    };
  }

  return {
    target: { change, kubernetesClusterId, namespace, deploymentName },
  };
}

// `kubectl rollout undo deployment/<name> -n <namespace>`.
export function buildKubernetesRollbackCommand(
  target: KubernetesRollbackTarget,
): string {
  return `kubectl rollout undo deployment/${target.deploymentName} -n ${target.namespace}`;
}

/*
 * The first change of the same Deployment recorded after the target's: a
 * later rollout, or a command OneUptime ran on it. One that failed or was
 * cancelled changed nothing and does not count.
 */
export function findLaterChangeOfDeployment(
  target: KubernetesRollbackTarget,
  changes: Array<RecordedChange>,
): RecordedChange | null {
  const later: Array<RecordedChange> = changes
    .filter((change: RecordedChange): boolean => {
      return (
        change.id !== target.change.id &&
        change.time.getTime() > target.change.time.getTime() &&
        change.fields.kubernetesClusterId === target.kubernetesClusterId &&
        change.fields.kubernetesNamespace === target.namespace &&
        change.fields.kubernetesDeployment === target.deploymentName &&
        change.fields.status !== ChangeEventStatus.Failed &&
        change.fields.status !== ChangeEventStatus.Cancelled
      );
    })
    .sort((a: RecordedChange, b: RecordedChange): number => {
      return a.time.getTime() - b.time.getTime();
    });

  return later[0] || null;
}

/*
 * What a human reads on the approval card: which recorded change the
 * rollback undoes, and what it should do. Text from telemetry is quoted.
 */
export function describeKubernetesRollback(
  target: KubernetesRollbackTarget,
  reason?: string | undefined,
): { rationale: string; expectedEffect: string } {
  const { change } = target;
  const deployment: string = `${target.namespace}/${target.deploymentName}`;
  const versions: string =
    change.fields.previousVersion && change.fields.version
      ? ` (${untrustedLine(change.fields.previousVersion, MAX_QUOTED_TEXT_LENGTH)} → ${untrustedLine(change.fields.version, MAX_QUOTED_TEXT_LENGTH)})`
      : change.fields.version
        ? ` (${untrustedLine(change.fields.version, MAX_QUOTED_TEXT_LENGTH)})`
        : "";
  const why: string = reason ? untrustedLine(reason, 1000) : "";
  const previousReplicaSet: string = change.fields.previousReplicaSet
    ? untrustedLine(change.fields.previousReplicaSet, MAX_QUOTED_TEXT_LENGTH)
    : "";

  return {
    rationale: `Roll back the change OneUptime recorded on Deployment ${deployment} at ${change.time.toISOString()}: ${quotedUntrustedLine(
      change.title || "a rollout",
      MAX_QUOTED_TEXT_LENGTH,
    )}${versions}.${why ? ` ${why}` : ""}`,
    expectedEffect: `Deployment ${deployment} runs the ReplicaSet it ran before the change${
      previousReplicaSet ? ` (${previousReplicaSet})` : ""
    }, and the service recovers.`,
  };
}

export default class ChangeRollback {
  /*
   * The Deployment to roll back for a recorded change of the project, or
   * why there is none. A deploy's service.version event and its rollout are
   * one change in the Recent changes section; given the version event, the
   * rollout recorded with it is used.
   */
  public static async resolveKubernetesTarget(data: {
    projectId: ObjectID;
    changeId: string;
  }): Promise<KubernetesRollbackResolution> {
    if (!ObjectID.isValidUUID(data.changeId)) {
      return {
        refusal:
          "changeId must be the id of a recorded change, as the Recent changes section lists it.",
      };
    }

    const change: RecordedChange | null = await ChangeRollback.readChange({
      projectId: data.projectId,
      changeId: new ObjectID(data.changeId),
    });

    if (!change) {
      return {
        refusal: `No change with id ${data.changeId} was recorded in this project.`,
      };
    }

    const rollout: RecordedChange =
      change.fields.kubernetesDeployment || !change.serviceId
        ? change
        : (await ChangeRollback.findRolloutRecordedWith({
            projectId: data.projectId,
            change,
          })) || change;

    const resolution: KubernetesRollbackResolution =
      readKubernetesRollbackTarget(rollout);

    if (!resolution.target) {
      return resolution;
    }

    const later: RecordedChange | null = findLaterChangeOfDeployment(
      resolution.target,
      await ChangeRollback.readChangesSince({
        projectId: data.projectId,
        since: rollout.time,
      }),
    );

    if (later) {
      return {
        refusal: `Deployment ${resolution.target.namespace}/${resolution.target.deploymentName} changed again after this change: ${quotedUntrustedLine(
          later.title || later.eventType,
          MAX_QUOTED_TEXT_LENGTH,
        )} at ${later.time.toISOString()}. kubectl rollout undo goes back one revision, so it would now undo that change, not this one. Read the rollout history with run_kubectl and, if a rollback is still the fix, propose the revision to go back to.`,
      };
    }

    return resolution;
  }

  private static async readChange(data: {
    projectId: ObjectID;
    changeId: ObjectID;
  }): Promise<RecordedChange | null> {
    const rows: Array<ChangeEvent> = await ChangeEventService.findBy({
      query: { projectId: data.projectId, _id: data.changeId } as never,
      select: ChangeRollback.select(),
      limit: 1,
      skip: 0,
      props: { isRoot: true },
    });

    return rows[0] ? toRecordedChange(rows[0]) : null;
  }

  // The rollout of the same service recorded with a version event.
  private static async findRolloutRecordedWith(data: {
    projectId: ObjectID;
    change: RecordedChange;
  }): Promise<RecordedChange | null> {
    const rows: Array<ChangeEvent> = await ChangeEventService.findBy({
      query: {
        projectId: data.projectId,
        primaryEntityId: new ObjectID(data.change.serviceId!),
        time: new InBetween(
          OneUptimeDate.addRemoveMinutes(
            data.change.time,
            -CHANGE_GROUP_WINDOW_MINUTES,
          ),
          OneUptimeDate.addRemoveMinutes(
            data.change.time,
            CHANGE_GROUP_WINDOW_MINUTES,
          ),
        ),
      } as never,
      select: ChangeRollback.select(),
      sort: { time: SortOrder.Ascending } as never,
      limit: 50,
      skip: 0,
      props: { isRoot: true },
    });

    const rollouts: Array<RecordedChange> = rows
      .map(toRecordedChange)
      .filter((row: RecordedChange | null): row is RecordedChange => {
        return Boolean(row && row.fields.kubernetesDeployment);
      })
      .sort((a: RecordedChange, b: RecordedChange): number => {
        return (
          Math.abs(a.time.getTime() - data.change.time.getTime()) -
          Math.abs(b.time.getTime() - data.change.time.getTime())
        );
      });

    return rollouts[0] || null;
  }

  private static async readChangesSince(data: {
    projectId: ObjectID;
    since: Date;
  }): Promise<Array<RecordedChange>> {
    const now: Date = OneUptimeDate.getCurrentDate();

    if (now.getTime() <= data.since.getTime()) {
      return [];
    }

    const rows: Array<ChangeEvent> = await ChangeEventService.findBy({
      query: {
        projectId: data.projectId,
        time: new InBetween(data.since, now),
      } as never,
      select: ChangeRollback.select(),
      sort: { time: SortOrder.Ascending } as never,
      limit: MAX_LATER_CHANGES_READ,
      skip: 0,
      props: { isRoot: true },
    });

    return rows
      .map(toRecordedChange)
      .filter((row: RecordedChange | null): row is RecordedChange => {
        return row !== null;
      });
  }

  private static select(): never {
    return {
      _id: true,
      time: true,
      eventType: true,
      title: true,
      primaryEntityId: true,
      attributes: true,
    } as never;
  }
}
