import { describe, expect, test } from "@jest/globals";
import {
  CHANGE_EVENT_FIELD_KEYS,
  ChangeEventAttribute,
  ChangeEventFields,
  ChangeEventSource,
  ChangeEventStatus,
  ChangeEventType,
  RESERVED_CHANGE_ATTRIBUTE_PREFIX,
  describeChangeEventFields,
  describeChangeEventSource,
  readChangeEventFields,
  shortCommitSha,
} from "../../../Utils/Telemetry/ChangeEventFields";

/*
 * One vocabulary for what a change event says. Events come from CI
 * pipelines (in whatever keys they already send), from OneUptime's own
 * detectors and from its AI fixes, and the AI tools, the investigation
 * context and the chart markers all read them through readChangeEventFields.
 */

describe("change event wire values", () => {
  test("event types are the strings stored in ChangeEvent.eventType", () => {
    expect(Object.values(ChangeEventType)).toEqual([
      "deployment",
      "config-change",
      "scaling",
      "rollback",
      "feature-flag",
      "remediation",
      "runbook",
      "provider-event",
      "custom",
    ]);
  });

  test("sources are the strings stored in oneuptime.change.source", () => {
    expect(Object.values(ChangeEventSource)).toEqual([
      "api",
      "service-version",
      "kubernetes",
      "oneuptime-ai",
      "runbook",
      "cloud",
      "cloud-health",
    ]);
    expect(Object.values(ChangeEventStatus)).toEqual([
      "succeeded",
      "failed",
      "cancelled",
    ]);
  });

  test("OpenTelemetry semantic convention names are used where one exists", () => {
    expect(ChangeEventAttribute.ServiceVersion).toBe("service.version");
    expect(ChangeEventAttribute.Environment).toBe(
      "deployment.environment.name",
    );
    expect(ChangeEventAttribute.CommitSha).toBe("vcs.ref.head.revision");
    expect(ChangeEventAttribute.Branch).toBe("vcs.ref.head.name");
    expect(ChangeEventAttribute.RepositoryUrl).toBe("vcs.repository.url.full");
    expect(ChangeEventAttribute.PullRequest).toBe("vcs.change.id");
    expect(ChangeEventAttribute.KubernetesDeployment).toBe(
      "k8s.deployment.name",
    );
    expect(ChangeEventAttribute.KubernetesReplicaSet).toBe(
      "k8s.replicaset.name",
    );
    expect(ChangeEventAttribute.CloudProvider).toBe("cloud.provider");
    expect(ChangeEventAttribute.CloudAccountId).toBe("cloud.account.id");
    expect(ChangeEventAttribute.CloudRegion).toBe("cloud.region");
    expect(ChangeEventAttribute.CloudResourceId).toBe("cloud.resource_id");
  });

  test("every key OneUptime alone writes sits under the reserved prefix", () => {
    const ownKeys: Array<string> = [
      ChangeEventAttribute.Source,
      ChangeEventAttribute.Status,
      ChangeEventAttribute.PreviousVersion,
      ChangeEventAttribute.PreviousReplicaSet,
      ChangeEventAttribute.KubernetesClusterId,
      ChangeEventAttribute.ResourceType,
      ChangeEventAttribute.ResourceId,
      ChangeEventAttribute.Command,
      ChangeEventAttribute.AiRunId,
      ChangeEventAttribute.IncidentId,
      ChangeEventAttribute.AlertId,
      ChangeEventAttribute.RunbookId,
      ChangeEventAttribute.RunbookExecutionId,
      ChangeEventAttribute.CloudOperation,
      ChangeEventAttribute.CloudActor,
      ChangeEventAttribute.CloudEventId,
      ChangeEventAttribute.CloudAccountRecordId,
    ];

    for (const key of ownKeys) {
      expect(key.startsWith(RESERVED_CHANGE_ATTRIBUTE_PREFIX)).toBe(true);
    }
  });

  test("the first key of every field is the name OneUptime writes", () => {
    expect(CHANGE_EVENT_FIELD_KEYS.version[0]).toBe(
      ChangeEventAttribute.ServiceVersion,
    );
    expect(CHANGE_EVENT_FIELD_KEYS.previousVersion[0]).toBe(
      ChangeEventAttribute.PreviousVersion,
    );
    expect(CHANGE_EVENT_FIELD_KEYS.environment[0]).toBe(
      ChangeEventAttribute.Environment,
    );
    expect(CHANGE_EVENT_FIELD_KEYS.commitSha[0]).toBe(
      ChangeEventAttribute.CommitSha,
    );
    expect(CHANGE_EVENT_FIELD_KEYS.branch[0]).toBe(ChangeEventAttribute.Branch);
    expect(CHANGE_EVENT_FIELD_KEYS.repositoryUrl[0]).toBe(
      ChangeEventAttribute.RepositoryUrl,
    );
    expect(CHANGE_EVENT_FIELD_KEYS.pullRequest[0]).toBe(
      ChangeEventAttribute.PullRequest,
    );
  });
});

describe("readChangeEventFields", () => {
  test("reads every field OneUptime writes", () => {
    expect(
      readChangeEventFields({
        "oneuptime.change.source": "kubernetes",
        "oneuptime.change.status": "succeeded",
        "service.version": "2.3.1",
        "oneuptime.change.previous_version": "2.3.0",
        "deployment.environment.name": "production",
        "vcs.ref.head.revision": "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b",
        "vcs.ref.head.name": "main",
        "vcs.repository.url.full": "https://github.com/acme/api",
        "vcs.change.id": "482",
        "k8s.cluster.name": "prod-eu",
        "oneuptime.kubernetes.cluster.id": "cluster-id",
        "k8s.namespace.name": "web",
        "k8s.deployment.name": "api",
        "k8s.replicaset.name": "api-7d4f9c",
        "oneuptime.change.previous_replicaset": "api-5b8c2d",
        "oneuptime.resource.type": "Host",
        "oneuptime.resource.id": "host-id",
        "oneuptime.command": "kubectl rollout restart deployment/api -n web",
        "oneuptime.ai_run.id": "run-id",
        "oneuptime.incident.id": "incident-id",
        "oneuptime.alert.id": "alert-id",
        "oneuptime.runbook.id": "runbook-id",
        "oneuptime.runbook_execution.id": "execution-id",
      }),
    ).toEqual({
      source: "kubernetes",
      status: "succeeded",
      version: "2.3.1",
      previousVersion: "2.3.0",
      environment: "production",
      commitSha: "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b",
      branch: "main",
      repositoryUrl: "https://github.com/acme/api",
      pullRequest: "482",
      kubernetesClusterName: "prod-eu",
      kubernetesClusterId: "cluster-id",
      kubernetesNamespace: "web",
      kubernetesDeployment: "api",
      kubernetesReplicaSet: "api-7d4f9c",
      previousReplicaSet: "api-5b8c2d",
      resourceType: "Host",
      resourceId: "host-id",
      command: "kubectl rollout restart deployment/api -n web",
      aiRunId: "run-id",
      incidentId: "incident-id",
      alertId: "alert-id",
      runbookId: "runbook-id",
      runbookExecutionId: "execution-id",
    });
  });

  test("reads the names pipelines already send", () => {
    expect(
      readChangeEventFields({
        version: "2.31.0",
        sha: "deadbeef",
        environment: "staging",
        branch: "release/2.31",
        repo: "acme/api",
        pr: "77",
      }),
    ).toEqual({
      version: "2.31.0",
      commitSha: "deadbeef",
      environment: "staging",
      branch: "release/2.31",
      repositoryUrl: "acme/api",
      pullRequest: "77",
    });
  });

  test("reads OpenTelemetry's older vcs and environment names", () => {
    expect(
      readChangeEventFields({
        "vcs.repository.ref.revision": "cafe1234",
        "vcs.repository.ref.name": "main",
        "vcs.repository.change.id": "12",
        "deployment.environment": "prod",
      }),
    ).toEqual({
      commitSha: "cafe1234",
      branch: "main",
      pullRequest: "12",
      environment: "prod",
    });
  });

  test("the name OneUptime writes wins over an alias", () => {
    const fields: ChangeEventFields = readChangeEventFields({
      sha: "alias-sha",
      "vcs.ref.head.revision": "standard-sha",
      version: "alias-version",
      "service.version": "standard-version",
      environment: "alias-env",
      "deployment.environment.name": "standard-env",
    });

    expect(fields.commitSha).toBe("standard-sha");
    expect(fields.version).toBe("standard-version");
    expect(fields.environment).toBe("standard-env");
  });

  test("a blank value does not hide the next key", () => {
    expect(
      readChangeEventFields({ "service.version": "  ", version: "1.0.0" })
        .version,
    ).toBe("1.0.0");
  });

  test("numbers are read as text; other types are not values", () => {
    expect(readChangeEventFields({ "vcs.change.id": 482 }).pullRequest).toBe(
      "482",
    );
    expect(
      readChangeEventFields({
        "service.version": { major: 2 },
        version: ["2"],
        release: true,
        "app.version": Number.NaN,
      }).version,
    ).toBeUndefined();
  });

  test("trims what it returns and leaves absent fields out", () => {
    expect(readChangeEventFields({ "service.version": " 2.0 " })).toEqual({
      version: "2.0",
    });
  });

  test("is empty for nothing to read", () => {
    expect(readChangeEventFields(undefined)).toEqual({});
    expect(readChangeEventFields(null)).toEqual({});
    expect(readChangeEventFields({})).toEqual({});
  });
});

describe("shortCommitSha", () => {
  test("shortens a full hexadecimal SHA to seven characters", () => {
    expect(shortCommitSha("1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b")).toBe(
      "1a2b3c4",
    );
    expect(shortCommitSha("ABCDEF0123456789")).toBe("ABCDEF0");
  });

  test("keeps a short SHA, a tag or anything else as written", () => {
    expect(shortCommitSha("1a2b3c4")).toBe("1a2b3c4");
    expect(shortCommitSha("v2.3.1")).toBe("v2.3.1");
    expect(shortCommitSha(" release-2026-10-19 ")).toBe("release-2026-10-19");
  });
});

describe("describeChangeEventFields", () => {
  test("a deploy with every detail", () => {
    expect(
      describeChangeEventFields({
        version: "2.3.1",
        previousVersion: "2.3.0",
        commitSha: "1a2b3c4d5e6f7a8b9c0d1e2f3a4b5c6d7e8f9a0b",
        pullRequest: "482",
        branch: "main",
        environment: "production",
        source: ChangeEventSource.Api,
      }),
    ).toBe(
      "2.3.0 → 2.3.1, commit 1a2b3c4, PR 482, branch main, production, recorded from the change-events API",
    );
  });

  test("a version with no previous one", () => {
    expect(describeChangeEventFields({ version: "2.3.1" })).toBe(
      "version 2.3.1",
    );
  });

  test("a Kubernetes rollout", () => {
    expect(
      describeChangeEventFields({
        kubernetesNamespace: "web",
        kubernetesDeployment: "api",
        kubernetesReplicaSet: "api-7d4f9c",
        previousReplicaSet: "api-5b8c2d",
        source: ChangeEventSource.Kubernetes,
      }),
    ).toBe(
      "deployment web/api, ReplicaSet api-5b8c2d → api-7d4f9c, recorded from a new Kubernetes ReplicaSet",
    );
    expect(
      describeChangeEventFields({
        kubernetesDeployment: "api",
        kubernetesReplicaSet: "api-7d4f9c",
      }),
    ).toBe("deployment api, ReplicaSet api-7d4f9c");
  });

  test("a fix OneUptime AI ran", () => {
    expect(
      describeChangeEventFields({
        command: "kubectl rollout undo deployment/api -n web",
        status: ChangeEventStatus.Failed,
        source: ChangeEventSource.OneUptimeAi,
      }),
    ).toBe(
      "command: kubectl rollout undo deployment/api -n web, failed, recorded from a fix OneUptime AI ran",
    );
  });

  test("a change a cloud account's activity log recorded", () => {
    const fields: ChangeEventFields = readChangeEventFields({
      "cloud.provider": "aws",
      "cloud.account.id": "123456789012",
      "cloud.region": "eu-west-1",
      "cloud.resource_id": "resize",
      "oneuptime.cloud.operation": "lambda:UpdateFunctionCode20150331v2",
      "oneuptime.cloud.actor": "deploy-bot",
      "oneuptime.change.status": "succeeded",
      "oneuptime.change.source": "cloud",
    });

    expect(fields.cloudProvider).toBe("aws");
    expect(describeChangeEventFields(fields)).toBe(
      "lambda:UpdateFunctionCode20150331v2 by deploy-bot, on resize, account 123456789012, eu-west-1, succeeded, recorded from the cloud account's activity log",
    );
    expect(
      describeChangeEventFields({
        cloudOperation: "AWS_EC2_OPERATIONAL_ISSUE",
        cloudAccountId: "123456789012",
        source: ChangeEventSource.CloudHealth,
      }),
    ).toBe(
      "AWS_EC2_OPERATIONAL_ISSUE, account 123456789012, recorded from the cloud provider's health events",
    );
  });

  test("nothing known says nothing", () => {
    expect(describeChangeEventFields({})).toBe("");
  });
});

describe("describeChangeEventSource", () => {
  test("names every source OneUptime writes", () => {
    expect(describeChangeEventSource(ChangeEventSource.Api)).toBe(
      "the change-events API",
    );
    expect(describeChangeEventSource(ChangeEventSource.ServiceVersion)).toBe(
      "a new service.version in telemetry",
    );
    expect(describeChangeEventSource(ChangeEventSource.Kubernetes)).toBe(
      "a new Kubernetes ReplicaSet",
    );
    expect(describeChangeEventSource(ChangeEventSource.OneUptimeAi)).toBe(
      "a fix OneUptime AI ran",
    );
    expect(describeChangeEventSource(ChangeEventSource.Runbook)).toBe(
      "a runbook OneUptime ran",
    );
  });

  test("an unknown source is named as written", () => {
    expect(describeChangeEventSource("argo-cd")).toBe("argo-cd");
  });
});
