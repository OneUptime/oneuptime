import { describe, expect, test } from "@jest/globals";
import ObjectID from "../../../../../Types/ObjectID";
import type { ParsedChangeEventEntry } from "../../../../../Server/Utils/Telemetry/ChangeEventRow";
import {
  MAX_OWN_CHANGE_TEXT_LENGTH,
  RunbookChangeOutcome,
  buildAiCommandChangeEntry,
  buildRunbookChangeEntry,
  describeKubectlTarget,
  isRollbackCommand,
} from "../../../../../Server/Utils/Telemetry/ChangeDetection/OwnChangeEntries";

/*
 * What OneUptime records when it changes something itself: a fix command
 * OneUptime AI ran, and a runbook it ran. The next investigation reads
 * these, so a restart OneUptime AI made is never mistaken for a cause it
 * cannot see.
 */

const JOB_ID: ObjectID = new ObjectID("3d0b2c10-0000-4000-8000-000000000001");
const CLUSTER_ID: ObjectID = new ObjectID(
  "3d0b2c10-0000-4000-8000-000000000002",
);
const HOST_ID: ObjectID = new ObjectID("3d0b2c10-0000-4000-8000-000000000003");
const RUN_ID: ObjectID = new ObjectID("3d0b2c10-0000-4000-8000-000000000004");
const INCIDENT_ID: ObjectID = new ObjectID(
  "3d0b2c10-0000-4000-8000-000000000005",
);
const ALERT_ID: ObjectID = new ObjectID("3d0b2c10-0000-4000-8000-000000000006");
const EXECUTION_ID: ObjectID = new ObjectID(
  "3d0b2c10-0000-4000-8000-000000000007",
);
const RUNBOOK_ID: ObjectID = new ObjectID(
  "3d0b2c10-0000-4000-8000-000000000008",
);
const TIME: Date = new Date("2026-10-19T10:02:00.000Z");

describe("isRollbackCommand", () => {
  test("an undo is a rollback", () => {
    expect(
      isRollbackCommand("kubectl rollout undo deployment/api -n web"),
    ).toBe(true);
    expect(isRollbackCommand("docker service rollback web")).toBe(true);
    expect(isRollbackCommand("helm rollback api 3")).toBe(true);
  });

  test("anything else is not", () => {
    expect(
      isRollbackCommand("kubectl rollout restart deployment/api -n web"),
    ).toBe(false);
    expect(isRollbackCommand("systemctl restart nginx.service")).toBe(false);
    expect(
      isRollbackCommand("kubectl scale deployment/rollbacks --replicas=2"),
    ).toBe(false);
  });
});

describe("describeKubectlTarget", () => {
  test("reads the namespace and a kind/name object", () => {
    expect(
      describeKubectlTarget([
        "rollout",
        "restart",
        "deployment/api",
        "-n",
        "web",
      ]),
    ).toEqual({ namespace: "web", kind: "deployment", name: "api" });
  });

  test("reads --namespace in both forms", () => {
    expect(
      describeKubectlTarget(["scale", "deploy/api", "--namespace", "web"]),
    ).toEqual({ namespace: "web", kind: "deploy", name: "api" });
    expect(
      describeKubectlTarget(["delete", "pod/api-1", "--namespace=web"]),
    ).toEqual({ namespace: "web", kind: "pod", name: "api-1" });
  });

  test("the first object is the one it acts on", () => {
    expect(
      describeKubectlTarget(["label", "deployment/a", "deployment/b"]),
    ).toEqual({ kind: "deployment", name: "a" });
  });

  test("leaves out what the arguments do not name plainly", () => {
    expect(describeKubectlTarget(["get", "pods"])).toEqual({});
    expect(describeKubectlTarget(["-n"])).toEqual({});
    expect(describeKubectlTarget([42, null, "deployment/api"])).toEqual({
      kind: "deployment",
      name: "api",
    });
    expect(describeKubectlTarget(["--selector=app/web"])).toEqual({});
  });
});

describe("buildAiCommandChangeEntry", () => {
  test("a kubectl fix for an incident", () => {
    const entry: ParsedChangeEventEntry = buildAiCommandChangeEntry({
      jobId: JOB_ID,
      command: "kubectl rollout restart deployment/api -n web",
      succeeded: true,
      time: TIME,
      kubectlArgs: ["rollout", "restart", "deployment/api", "-n", "web"],
      kubernetesClusterId: CLUSTER_ID,
      aiRunId: RUN_ID,
      incidentId: INCIDENT_ID,
    });

    expect(entry).toEqual({
      time: TIME,
      eventType: "remediation",
      title: "OneUptime AI ran kubectl rollout restart deployment/api -n web",
      description:
        "OneUptime AI ran this command for an incident, and it succeeded.",
      attributes: {
        "oneuptime.change.source": "oneuptime-ai",
        "oneuptime.change.status": "succeeded",
        "oneuptime.command": "kubectl rollout restart deployment/api -n web",
        "oneuptime.kubernetes.cluster.id": CLUSTER_ID.toString(),
        "k8s.namespace.name": "web",
        "k8s.deployment.name": "api",
        "oneuptime.ai_run.id": RUN_ID.toString(),
        "oneuptime.incident.id": INCIDENT_ID.toString(),
      },
    });
  });

  test("an undo is recorded as a rollback", () => {
    expect(
      buildAiCommandChangeEntry({
        jobId: JOB_ID,
        command: "kubectl rollout undo deployment/api -n web",
        succeeded: true,
        time: TIME,
      }).eventType,
    ).toBe("rollback");
  });

  test("a failed command says it failed, and may still have changed something", () => {
    const entry: ParsedChangeEventEntry = buildAiCommandChangeEntry({
      jobId: JOB_ID,
      command: "systemctl restart nginx.service",
      succeeded: false,
      time: TIME,
      resourceType: "Host",
      resourceId: HOST_ID,
      alertId: ALERT_ID,
    });

    expect(entry.title).toBe(
      "OneUptime AI's command failed: systemctl restart nginx.service",
    );
    expect(entry.description).toBe(
      "OneUptime AI ran this command for an alert, and it failed - it may have changed something before it failed.",
    );
    expect(entry.attributes).toEqual({
      "oneuptime.change.source": "oneuptime-ai",
      "oneuptime.change.status": "failed",
      "oneuptime.command": "systemctl restart nginx.service",
      "oneuptime.resource.type": "Host",
      "oneuptime.resource.id": HOST_ID.toString(),
      "oneuptime.alert.id": ALERT_ID.toString(),
    });
  });

  test("only a deployment is named as one", () => {
    const entry: ParsedChangeEventEntry = buildAiCommandChangeEntry({
      jobId: JOB_ID,
      command: "kubectl delete pod/api-1 -n web",
      succeeded: true,
      time: TIME,
      kubectlArgs: ["delete", "pod/api-1", "-n", "web"],
    });

    expect(entry.attributes["k8s.namespace.name"]).toBe("web");
    expect(entry.attributes["k8s.deployment.name"]).toBeUndefined();
  });

  test("a long command is cut, and a missing one still says what happened", () => {
    const long: string = `kubectl annotate deployment/api ${"x".repeat(2000)}`;
    const entry: ParsedChangeEventEntry = buildAiCommandChangeEntry({
      jobId: JOB_ID,
      command: long,
      succeeded: true,
      time: TIME,
    });

    expect(entry.attributes["oneuptime.command"]).toHaveLength(
      MAX_OWN_CHANGE_TEXT_LENGTH,
    );
    expect(entry.attributes["oneuptime.command"]!.endsWith("…")).toBe(true);

    expect(
      buildAiCommandChangeEntry({
        jobId: JOB_ID,
        command: "  ",
        succeeded: true,
        time: TIME,
      }).title,
    ).toBe("OneUptime AI ran a command");
  });

  test("a resource with no id is not named", () => {
    expect(
      buildAiCommandChangeEntry({
        jobId: JOB_ID,
        command: "docker restart web",
        succeeded: true,
        time: TIME,
        resourceType: "DockerHost",
      }).attributes["oneuptime.resource.type"],
    ).toBeUndefined();
  });
});

describe("buildRunbookChangeEntry", () => {
  test("a runbook that completed", () => {
    expect(
      buildRunbookChangeEntry({
        executionId: EXECUTION_ID,
        runbookId: RUNBOOK_ID,
        runbookName: "Flush cache",
        outcome: RunbookChangeOutcome.Completed,
        time: TIME,
        failureReason: "ignored when it completed",
        incidentId: INCIDENT_ID,
      }),
    ).toEqual({
      time: TIME,
      eventType: "runbook",
      title: 'Runbook "Flush cache" ran',
      description:
        'OneUptime ran the runbook "Flush cache" for an incident, and it completed.',
      attributes: {
        "oneuptime.change.source": "runbook",
        "oneuptime.change.status": "succeeded",
        "oneuptime.runbook_execution.id": EXECUTION_ID.toString(),
        "oneuptime.runbook.id": RUNBOOK_ID.toString(),
        "oneuptime.incident.id": INCIDENT_ID.toString(),
      },
    });
  });

  test("a runbook that failed says why", () => {
    const entry: ParsedChangeEventEntry = buildRunbookChangeEntry({
      executionId: EXECUTION_ID,
      runbookName: "Rotate pods",
      outcome: RunbookChangeOutcome.Failed,
      time: TIME,
      failureReason: 'Step "Restart" failed: exit 1',
      alertId: ALERT_ID,
    });

    expect(entry.title).toBe('Runbook "Rotate pods" failed');
    expect(entry.description).toBe(
      'OneUptime ran the runbook "Rotate pods" for an alert, and it failed. Step "Restart" failed: exit 1',
    );
    expect(entry.attributes["oneuptime.change.status"]).toBe("failed");
    expect(entry.attributes["oneuptime.alert.id"]).toBe(ALERT_ID.toString());
  });

  test("a runbook that was cancelled", () => {
    const entry: ParsedChangeEventEntry = buildRunbookChangeEntry({
      executionId: EXECUTION_ID,
      runbookName: "Rotate pods",
      outcome: RunbookChangeOutcome.Cancelled,
      time: TIME,
    });

    expect(entry.title).toBe('Runbook "Rotate pods" was cancelled');
    expect(entry.description).toBe(
      'OneUptime ran the runbook "Rotate pods", and it was cancelled.',
    );
    expect(entry.attributes["oneuptime.change.status"]).toBe("cancelled");
  });

  test("a runbook with no name is still named, and its name is quoted", () => {
    expect(
      buildRunbookChangeEntry({
        executionId: EXECUTION_ID,
        runbookName: "",
        outcome: RunbookChangeOutcome.Completed,
        time: TIME,
      }).title,
    ).toBe('Runbook "Runbook" ran');
    expect(
      buildRunbookChangeEntry({
        executionId: EXECUTION_ID,
        runbookName: 'Say "hi"',
        outcome: RunbookChangeOutcome.Completed,
        time: TIME,
      }).title,
    ).toBe('Runbook "Say \\"hi\\"" ran');
  });
});
