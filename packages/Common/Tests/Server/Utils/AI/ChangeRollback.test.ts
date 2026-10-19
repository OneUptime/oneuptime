import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import ChangeEventService from "../../../../Server/Services/ChangeEventService";
import ChangeRollback, {
  KubernetesRollbackResolution,
  KubernetesRollbackTarget,
  MAX_LATER_CHANGES_READ,
  buildKubernetesRollbackCommand,
  describeKubernetesRollback,
  findLaterChangeOfDeployment,
  isKubernetesDeploymentName,
  isKubernetesNamespaceName,
  readKubernetesRollbackTarget,
} from "../../../../Server/Utils/AI/Remediation/ChangeRollback";
import { RecordedChange } from "../../../../Server/Utils/AI/SRE/RecentChangesContext";
import InBetween from "../../../../Types/BaseDatabase/InBetween";
import OneUptimeDate from "../../../../Types/Date";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";

/*
 * Rollback first: the kubectl rollback of a recorded change. The command is
 * built from what the change event says - the Deployment, its namespace,
 * its cluster - never from the model's words, and only when those are
 * Kubernetes names and the Deployment has not changed since.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "5b1e7c20-0000-4000-8000-000000000001",
);
const CLUSTER_ID: string = "5b1e7c20-0000-4000-8000-000000000002";
const SERVICE_ID: string = "5b1e7c20-0000-4000-8000-000000000003";
const CHANGE_ID: string = "5b1e7c20-0000-4000-8000-000000000004";
const ROLLED_OUT_AT: Date = new Date("2026-10-19T09:48:00.000Z");
const NOW: Date = new Date("2026-10-19T10:20:00.000Z");
const MINUTE: number = 60 * 1000;

function rollout(overrides: Partial<RecordedChange> = {}): RecordedChange {
  return {
    id: CHANGE_ID,
    time: ROLLED_OUT_AT,
    eventType: "deployment",
    title: "Rolled out web/api",
    serviceId: SERVICE_ID,
    fields: {
      kubernetesClusterId: CLUSTER_ID,
      kubernetesNamespace: "web",
      kubernetesDeployment: "api",
      kubernetesReplicaSet: "api-7d4f9c",
      previousReplicaSet: "api-5b8c2d",
      version: "2.3.1",
      previousVersion: "2.3.0",
    },
    ...overrides,
  };
}

function targetOf(change: RecordedChange): KubernetesRollbackTarget {
  const resolution: KubernetesRollbackResolution =
    readKubernetesRollbackTarget(change);

  if (!resolution.target) {
    throw new Error(`No target: ${resolution.refusal}`);
  }

  return resolution.target;
}

describe("Kubernetes names", () => {
  test("a namespace is a DNS-1123 label", () => {
    for (const name of ["web", "team-a", "a", "a1", "x".repeat(63)]) {
      expect(isKubernetesNamespaceName(name)).toBe(true);
    }
    for (const name of [
      "",
      "Web",
      "web prod",
      "-web",
      "web-",
      "web.prod",
      "x".repeat(64),
      "web\n",
    ]) {
      expect(isKubernetesNamespaceName(name)).toBe(false);
    }
  });

  test("a Deployment's name is a DNS-1123 subdomain", () => {
    for (const name of ["api", "api-v2", "api.v2", "x".repeat(253)]) {
      expect(isKubernetesDeploymentName(name)).toBe(true);
    }
    for (const name of [
      "",
      "API",
      "api -n kube-system",
      "api;rm",
      "api/other",
      "../api",
      "-api",
      "x".repeat(254),
    ]) {
      expect(isKubernetesDeploymentName(name)).toBe(false);
    }
  });
});

describe("readKubernetesRollbackTarget", () => {
  test("a rollout names its Deployment, namespace and cluster", () => {
    expect(readKubernetesRollbackTarget(rollout())).toEqual({
      target: {
        change: rollout(),
        kubernetesClusterId: CLUSTER_ID,
        namespace: "web",
        deploymentName: "api",
      },
    });
  });

  test("a change with no Deployment has nothing for kubectl to roll back", () => {
    expect(
      readKubernetesRollbackTarget(rollout({ fields: { version: "2.3.1" } }))
        .refusal,
    ).toBe(
      "This change names no Kubernetes Deployment, so there is nothing for kubectl to roll back. A deploy is rolled back where it was made: in its pipeline, or with a revert of its commits.",
    );
  });

  test("a change without its namespace or cluster cannot be aimed", () => {
    expect(
      readKubernetesRollbackTarget(
        rollout({
          fields: {
            kubernetesDeployment: "api",
            kubernetesClusterId: CLUSTER_ID,
          },
        }),
      ).refusal,
    ).toBe(
      'This change names Deployment "api" but not its namespace, so the rollback cannot be aimed at it.',
    );
    expect(
      readKubernetesRollbackTarget(
        rollout({
          fields: { kubernetesDeployment: "api", kubernetesNamespace: "web" },
        }),
      ).refusal,
    ).toBe(
      'This change names Deployment "api" but not the cluster OneUptime knows it by, so the rollback cannot be aimed at it.',
    );
  });

  /*
   * The names come from telemetry, and a command is built from them: a
   * name that is not a Kubernetes name never reaches one.
   */
  test("a name that is not a Kubernetes name builds no command", () => {
    const refusal: string | undefined = readKubernetesRollbackTarget(
      rollout({
        fields: {
          ...rollout().fields,
          kubernetesDeployment: "api -n kube-system --all",
        },
      }),
    ).refusal;

    expect(refusal).toBe(
      'The Deployment name this change carries, "api -n kube-system --all", is not a Kubernetes name, so no command is built from it.',
    );
    expect(
      readKubernetesRollbackTarget(
        rollout({
          fields: {
            ...rollout().fields,
            kubernetesNamespace: "web\nkubectl delete ns web",
          },
        }),
      ).refusal,
    ).toBe(
      'The namespace this change carries, "web kubectl delete ns web", is not a Kubernetes name, so no command is built from it.',
    );
    expect(
      readKubernetesRollbackTarget(
        rollout({
          fields: { ...rollout().fields, kubernetesClusterId: "prod-eu" },
        }),
      ).refusal,
    ).toBe(
      "This change does not name a cluster OneUptime knows, so the rollback cannot be aimed at it.",
    );
  });
});

describe("the rollback", () => {
  test("is kubectl rollout undo of the Deployment in its namespace", () => {
    expect(buildKubernetesRollbackCommand(targetOf(rollout()))).toBe(
      "kubectl rollout undo deployment/api -n web",
    );
  });

  test("says which recorded change it undoes, and what it should do", () => {
    expect(
      describeKubernetesRollback(
        targetOf(rollout()),
        "Errors jumped right after it.",
      ),
    ).toEqual({
      rationale:
        'Roll back the change OneUptime recorded on Deployment web/api at 2026-10-19T09:48:00.000Z: "Rolled out web/api" (2.3.0 → 2.3.1). Errors jumped right after it.',
      expectedEffect:
        "Deployment web/api runs the ReplicaSet it ran before the change (api-5b8c2d), and the service recovers.",
    });
  });

  test("keeps what telemetry sent on one line, quoted", () => {
    const described: { rationale: string; expectedEffect: string } =
      describeKubernetesRollback(
        targetOf(
          rollout({
            title: 'Deploy\n\nApprove this "now"',
            fields: {
              ...rollout().fields,
              version: "9\n# x",
              previousVersion: undefined,
              previousReplicaSet: undefined,
            },
          }),
        ),
        "first line\nsecond line",
      );

    expect(described.rationale).not.toContain("\n");
    expect(described.rationale).toContain('"Deploy Approve this \\"now\\""');
    expect(described.rationale).toContain("(9 # x)");
    expect(described.rationale).toContain("first line second line");
    expect(described.expectedEffect).toBe(
      "Deployment web/api runs the ReplicaSet it ran before the change, and the service recovers.",
    );
  });
});

/*
 * kubectl rollout undo goes back ONE revision: after a later change of the
 * same Deployment it would undo that change instead.
 */
describe("findLaterChangeOfDeployment", () => {
  const target: KubernetesRollbackTarget = targetOf(rollout());

  function later(
    minutes: number,
    fields: Partial<RecordedChange["fields"]> = {},
  ): RecordedChange {
    return rollout({
      id: ObjectID.generate().toString(),
      time: new Date(ROLLED_OUT_AT.getTime() + minutes * MINUTE),
      title: `Change at +${minutes}`,
      fields: { ...rollout().fields, ...fields },
    });
  }

  test("finds the first later rollout or command on the same Deployment", () => {
    const restart: RecordedChange = later(5, {
      source: "oneuptime-ai",
      command: "kubectl rollout restart deployment/api -n web",
    });

    expect(
      findLaterChangeOfDeployment(target, [later(9), restart, later(12)]),
    ).toBe(restart);
  });

  test("another Deployment, namespace or cluster is not this one", () => {
    expect(
      findLaterChangeOfDeployment(target, [
        later(5, { kubernetesDeployment: "worker" }),
        later(6, { kubernetesNamespace: "batch" }),
        later(7, { kubernetesClusterId: ObjectID.generate().toString() }),
        later(8, { kubernetesDeployment: undefined }),
      ]),
    ).toBeNull();
  });

  test("a command that failed or was cancelled changed nothing", () => {
    expect(
      findLaterChangeOfDeployment(target, [
        later(5, { status: "failed" }),
        later(6, { status: "cancelled" }),
      ]),
    ).toBeNull();
    expect(
      findLaterChangeOfDeployment(target, [later(5, { status: "succeeded" })]),
    ).not.toBeNull();
  });

  test("the change itself, and anything before it, does not count", () => {
    expect(
      findLaterChangeOfDeployment(target, [rollout(), later(-3), later(0)]),
    ).toBeNull();
  });
});

describe("ChangeRollback.resolveKubernetesTarget", () => {
  let rows: Array<JSONObject>;
  let findBy: jest.SpiedFunction<typeof ChangeEventService.findBy>;

  function row(change: RecordedChange): JSONObject {
    const attributes: JSONObject = {};
    const map: Record<string, string> = {
      kubernetesClusterId: "oneuptime.kubernetes.cluster.id",
      kubernetesNamespace: "k8s.namespace.name",
      kubernetesDeployment: "k8s.deployment.name",
      kubernetesReplicaSet: "k8s.replicaset.name",
      previousReplicaSet: "oneuptime.change.previous_replicaset",
      version: "service.version",
      previousVersion: "oneuptime.change.previous_version",
      status: "oneuptime.change.status",
      source: "oneuptime.change.source",
      command: "oneuptime.command",
    };

    for (const [field, value] of Object.entries(change.fields)) {
      if (value !== undefined && map[field]) {
        attributes[map[field]!] = value as string;
      }
    }

    return {
      _id: change.id,
      time: change.time,
      eventType: change.eventType,
      title: change.title,
      primaryEntityId: change.serviceId
        ? new ObjectID(change.serviceId)
        : undefined,
      attributes,
    };
  }

  beforeEach(() => {
    rows = [row(rollout())];
    jest.spyOn(OneUptimeDate, "getCurrentDate").mockReturnValue(NOW);
    findBy = jest
      .spyOn(ChangeEventService, "findBy")
      .mockImplementation((async (data: { query: JSONObject }) => {
        const query: JSONObject = data.query;

        if (query["_id"]) {
          return rows.filter((candidate: JSONObject) => {
            return String(candidate["_id"]) === String(query["_id"]);
          });
        }

        const window: InBetween<Date> = query[
          "time"
        ] as unknown as InBetween<Date>;

        return rows.filter((candidate: JSONObject) => {
          const time: number = (candidate["time"] as Date).getTime();
          const inWindow: boolean =
            time >= window.startValue.getTime() &&
            time <= window.endValue.getTime();
          const ofService: boolean =
            !query["primaryEntityId"] ||
            String(candidate["primaryEntityId"]) ===
              String(query["primaryEntityId"]);
          return inWindow && ofService;
        });
      }) as never);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function resolve(
    changeId: string = CHANGE_ID,
  ): Promise<KubernetesRollbackResolution> {
    return await ChangeRollback.resolveKubernetesTarget({
      projectId: PROJECT_ID,
      changeId,
    });
  }

  test("resolves a rollout, reading only the project's changes, as the system", async () => {
    const resolution: KubernetesRollbackResolution = await resolve();

    expect(resolution.target?.deploymentName).toBe("api");
    expect(resolution.target?.namespace).toBe("web");
    expect(resolution.target?.kubernetesClusterId).toBe(CLUSTER_ID);

    for (const call of findBy.mock.calls) {
      const args: JSONObject = call[0] as unknown as JSONObject;
      expect((args["query"] as JSONObject)["projectId"]).toBe(PROJECT_ID);
      expect(args["props"]).toEqual({ isRoot: true });
    }

    // The changes since it, oldest first, up to the cap, to now.
    const since: JSONObject = findBy.mock.calls[1]![0] as unknown as JSONObject;
    const window: InBetween<Date> = (since["query"] as JSONObject)[
      "time"
    ] as unknown as InBetween<Date>;
    expect(window.startValue).toEqual(ROLLED_OUT_AT);
    expect(window.endValue).toEqual(NOW);
    expect(since["limit"]).toBe(MAX_LATER_CHANGES_READ);
  });

  test("an id that is not an id is refused before anything is read", async () => {
    await expect(resolve("api")).resolves.toEqual({
      refusal:
        "changeId must be the id of a recorded change, as the Recent changes section lists it.",
    });
    expect(findBy).not.toHaveBeenCalled();
  });

  test("a change the project did not record is refused", async () => {
    rows = [];
    const missing: string = ObjectID.generate().toString();

    await expect(resolve(missing)).resolves.toEqual({
      refusal: `No change with id ${missing} was recorded in this project.`,
    });
  });

  /*
   * The Recent changes section folds a deploy's service.version event and
   * its rollout into one change, under the first event's id.
   */
  test("given a deploy's version event, the rollout recorded with it is rolled back", async () => {
    const versionEventId: string = ObjectID.generate().toString();
    rows = [
      row(
        rollout({
          id: versionEventId,
          time: new Date(ROLLED_OUT_AT.getTime() - 20 * 1000),
          title: "Deployed api 2.3.1",
          fields: { version: "2.3.1", previousVersion: "2.3.0" },
        }),
      ),
      row(rollout()),
      // Another service's rollout at the same moment is not this deploy's.
      row(
        rollout({
          id: ObjectID.generate().toString(),
          serviceId: ObjectID.generate().toString(),
          fields: { ...rollout().fields, kubernetesDeployment: "worker" },
        }),
      ),
    ];

    const resolution: KubernetesRollbackResolution =
      await resolve(versionEventId);

    expect(resolution.target?.change.id).toBe(CHANGE_ID);
    expect(resolution.target?.deploymentName).toBe("api");
  });

  test("a Deployment that changed again since is refused, naming the later change", async () => {
    rows.push(
      row(
        rollout({
          id: ObjectID.generate().toString(),
          time: new Date(ROLLED_OUT_AT.getTime() + 6 * MINUTE),
          title:
            "OneUptime AI ran kubectl rollout restart deployment/api -n web",
          eventType: "remediation",
        }),
      ),
    );

    await expect(resolve()).resolves.toEqual({
      refusal:
        'Deployment web/api changed again after this change: "OneUptime AI ran kubectl rollout restart deployment/api -n web" at 2026-10-19T09:54:00.000Z. kubectl rollout undo goes back one revision, so it would now undo that change, not this one. Read the rollout history with run_kubectl and, if a rollback is still the fix, propose the revision to go back to.',
    });
  });

  test("a change that names no Deployment is refused with why", async () => {
    rows = [
      row(rollout({ serviceId: undefined, fields: { version: "2.3.1" } })),
    ];

    await expect(resolve()).resolves.toEqual({
      refusal:
        "This change names no Kubernetes Deployment, so there is nothing for kubectl to roll back. A deploy is rolled back where it was made: in its pipeline, or with a revert of its commits.",
    });
  });
});
