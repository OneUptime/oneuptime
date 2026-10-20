import {
  AiRemediationRevertWatch,
  MAX_WATCHED_FIELDS,
  MAX_WATCHED_VALUE_CHARS,
} from "../../../Types/AutoRemediation/AiRemediationGitOps";
import { JSONObject } from "../../../Types/JSON";
import KubectlPolicy, {
  KubectlNamedObject,
} from "../../../Utils/AiRemediation/KubectlPolicy";
import {
  buildRevertWatch,
  describePutBackFields,
  findPutBackFields,
  flattenObjectFields,
  toWatchedValue,
} from "../../../Utils/AiRemediation/KubectlRevertWatch";
import { describe, expect, it } from "@jest/globals";

/*
 * What a kubectl fix changed on its object, read before and after it ran,
 * and whether a later read finds it put back: by Argo CD applying git, by
 * Flux, by a Helm upgrade, by an autoscaler — whoever.
 */

const CAPTURED_AT: string = "2026-10-20T10:00:00.000Z";

function target(command: string): KubectlNamedObject {
  const named: KubectlNamedObject | null = KubectlPolicy.getNamedObject(
    KubectlPolicy.evaluateCommand(command).args,
  );
  expect(named).not.toBeNull();
  return named!;
}

// A Deployment as `kubectl get -o json` prints it, before any fix.
function web(
  data: {
    replicas?: number | undefined;
    image?: string;
    env?: Array<JSONObject>;
    templateAnnotations?: Record<string, string>;
    annotations?: Record<string, string>;
    memoryLimit?: string;
    status?: JSONObject;
    revision?: string;
  } = {},
): JSONObject {
  return {
    apiVersion: "apps/v1",
    kind: "Deployment",
    metadata: {
      name: "web",
      namespace: "shop",
      generation: 4,
      resourceVersion: "123",
      labels: { app: "web" },
      annotations: {
        "deployment.kubernetes.io/revision": data.revision || "2",
        ...(data.annotations || {}),
      },
    },
    spec: {
      ...(data.replicas === undefined ? {} : { replicas: data.replicas }),
      selector: { matchLabels: { app: "web" } },
      template: {
        metadata: {
          labels: { app: "web" },
          ...(data.templateAnnotations
            ? { annotations: data.templateAnnotations }
            : {}),
        },
        spec: {
          containers: [
            {
              name: "app",
              image: data.image || "web:1",
              env: data.env || [{ name: "MODE", value: "a" }],
              resources: { limits: { memory: data.memoryLimit || "32Mi" } },
            },
            { name: "sidecar", image: "proxy:1" },
          ],
        },
      },
    },
    status: data.status || { readyReplicas: 1 },
  } as JSONObject;
}

function watchOf(
  command: string,
  before: JSONObject | null,
  after: JSONObject | null,
): AiRemediationRevertWatch | null {
  return buildRevertWatch({
    target: target(command),
    namespace: "shop",
    before,
    after,
    capturedAt: CAPTURED_AT,
  });
}

describe("flattenObjectFields", () => {
  it("reads a named list by name, and leaves out status and the object's own bookkeeping", () => {
    const fields: Map<string, string> = flattenObjectFields(web());

    expect(fields.get("spec.template.spec.containers[app].image")).toBe(
      '"web:1"',
    );
    expect(
      fields.get("spec.template.spec.containers[app].env[MODE].value"),
    ).toBe('"a"');
    expect(fields.get("spec.replicas")).toBeUndefined();
    expect(fields.get("metadata.labels.app")).toBe('"web"');
    expect(
      Array.from(fields.keys()).some((path: string): boolean => {
        return (
          path.startsWith("status") ||
          path.includes("resourceVersion") ||
          path.includes("generation") ||
          path.includes("deployment.kubernetes.io/revision")
        );
      }),
    ).toBe(false);
  });

  it("keeps a list of unnamed items as one value", () => {
    const fields: Map<string, string> = flattenObjectFields({
      spec: { tolerations: [{ key: "a" }, { key: "b" }] },
    } as JSONObject);

    expect(fields.get("spec.tolerations")).toBe('[{"key":"a"},{"key":"b"}]');
  });
});

describe("toWatchedValue", () => {
  it("keeps a long value as its head and a hash, so two long values still compare", () => {
    const long: string = "x".repeat(MAX_WATCHED_VALUE_CHARS * 3);
    const other: string = `${long}y`;

    expect(toWatchedValue(long).length).toBeLessThanOrEqual(
      MAX_WATCHED_VALUE_CHARS,
    );
    expect(toWatchedValue(long)).toBe(toWatchedValue(long));
    expect(toWatchedValue(long)).not.toBe(toWatchedValue(other));
  });
});

describe("buildRevertWatch", () => {
  it("watches the replica count of a scale", () => {
    expect(
      watchOf(
        "kubectl scale deployment/web --replicas=3 -n shop",
        web({ replicas: 1 }),
        web({ replicas: 3 }),
      ),
    ).toEqual({
      kind: "deployment",
      name: "web",
      namespace: "shop",
      fields: [{ path: "spec.replicas", before: "1", after: "3" }],
      capturedAt: CAPTURED_AT,
    });
  });

  it("watches the image a set image or a rollout undo changed, by container name", () => {
    expect(
      watchOf(
        "kubectl rollout undo deployment/web -n shop",
        web({ image: "web:2", revision: "2" }),
        web({ image: "web:1", revision: "3" }),
      )?.fields,
    ).toEqual([
      {
        path: "spec.template.spec.containers[app].image",
        before: '"web:2"',
        after: '"web:1"',
      },
    ]);
  });

  it("watches an added variable as one field that did not exist before", () => {
    expect(
      watchOf(
        "kubectl set env deployment/web FIX_FLAG=1 -n shop",
        web(),
        web({
          env: [
            { name: "MODE", value: "a" },
            { name: "FIX_FLAG", value: "1" },
          ],
        }),
      )?.fields,
    ).toEqual([
      {
        path: "spec.template.spec.containers[app].env[FIX_FLAG].value",
        after: '"1"',
      },
    ]);
  });

  it("watches the restart annotation a rollout restart adds", () => {
    expect(
      watchOf(
        "kubectl rollout restart deployment/web -n shop",
        web(),
        web({
          templateAnnotations: {
            "kubectl.kubernetes.io/restartedAt": "2026-10-20T10:00:00Z",
          },
        }),
      )?.fields,
    ).toEqual([
      {
        path: "spec.template.metadata.annotations.kubectl.kubernetes.io/restartedAt",
        after: '"2026-10-20T10:00:00Z"',
      },
    ]);
  });

  it("watches a deleted object for coming back", () => {
    expect(
      watchOf("kubectl delete deployment/web -n shop", web(), null),
    ).toEqual({
      kind: "deployment",
      name: "web",
      namespace: "shop",
      deleted: true,
      fields: [],
      capturedAt: CAPTURED_AT,
    });
  });

  it("does not take an autoscaler's replica change between the two reads for the fix's", () => {
    expect(
      watchOf(
        "kubectl set image deployment/web app=web:2 -n shop",
        web({ replicas: 3 }),
        web({ replicas: 4, image: "web:2" }),
      )?.fields.map((field: { path: string }): string => {
        return field.path;
      }),
    ).toEqual(["spec.template.spec.containers[app].image"]);
  });

  it("watches nothing when the object was not there before, or did not change", () => {
    expect(
      watchOf(
        "kubectl scale deployment/web --replicas=3 -n shop",
        null,
        web({ replicas: 3 }),
      ),
    ).toBeNull();
    expect(
      watchOf(
        "kubectl scale deployment/web --replicas=1 -n shop",
        web({ replicas: 1 }),
        web({ replicas: 1 }),
      ),
    ).toBeNull();
  });

  it("keeps at most MAX_WATCHED_FIELDS fields and says there were more", () => {
    const before: JSONObject = { spec: {} } as JSONObject;
    const after: JSONObject = { spec: {} } as JSONObject;

    for (let i: number = 0; i < MAX_WATCHED_FIELDS + 5; i++) {
      (before["spec"] as JSONObject)[`f${String(i).padStart(2, "0")}`] = i;
      (after["spec"] as JSONObject)[`f${String(i).padStart(2, "0")}`] = i + 1;
    }

    const watch: AiRemediationRevertWatch | null = watchOf(
      `kubectl patch deployment/web -n shop -p '{"spec":{}}'`,
      before,
      after,
    );

    expect(watch?.fields).toHaveLength(MAX_WATCHED_FIELDS);
    expect(watch?.moreFields).toBe(true);
  });
});

describe("findPutBackFields", () => {
  const scale: AiRemediationRevertWatch = watchOf(
    "kubectl scale deployment/web --replicas=3 -n shop",
    web({ replicas: 1 }),
    web({ replicas: 3 }),
  )!;

  it("finds a field back at its value from before the fix", () => {
    expect(findPutBackFields(scale, web({ replicas: 1 }))).toEqual([
      "spec.replicas",
    ]);
  });

  it("finds nothing while the fix holds, or after someone changed it to something new", () => {
    expect(findPutBackFields(scale, web({ replicas: 3 }))).toEqual([]);
    expect(findPutBackFields(scale, web({ replicas: 5 }))).toEqual([]);
  });

  it("finds an added field gone again", () => {
    const watch: AiRemediationRevertWatch = watchOf(
      "kubectl set env deployment/web FIX_FLAG=1 -n shop",
      web(),
      web({
        env: [
          { name: "MODE", value: "a" },
          { name: "FIX_FLAG", value: "1" },
        ],
      }),
    )!;

    expect(findPutBackFields(watch, web())).toEqual([
      "spec.template.spec.containers[app].env[FIX_FLAG].value",
    ]);
  });

  it("finds a deleted object back, and nothing while it stays gone", () => {
    const watch: AiRemediationRevertWatch = watchOf(
      "kubectl delete deployment/web -n shop",
      web(),
      null,
    )!;

    expect(findPutBackFields(watch, web())).toEqual(["deployment/web"]);
    expect(findPutBackFields(watch, null)).toEqual([]);
  });

  it("finds nothing in an object that is gone: that tells nothing about the fix", () => {
    expect(findPutBackFields(scale, null)).toEqual([]);
  });
});

describe("describePutBackFields", () => {
  it("says what each field went from and back to", () => {
    const watch: AiRemediationRevertWatch = watchOf(
      "kubectl rollout undo deployment/web -n shop",
      web({ image: "web:2" }),
      web({ image: "web:1" }),
    )!;

    expect(
      describePutBackFields(watch, [
        "spec.template.spec.containers[app].image",
      ]),
    ).toBe(
      'spec.template.spec.containers[app].image ("web:1" → back to "web:2")',
    );
  });

  it("says a deleted object exists again", () => {
    const watch: AiRemediationRevertWatch = watchOf(
      "kubectl delete deployment/web -n shop",
      web(),
      null,
    )!;

    expect(describePutBackFields(watch, ["deployment/web"])).toBe(
      "deployment/web exists again",
    );
  });
});
