/**
 * @timezone UTC
 */
import "@testing-library/jest-dom";
import {
  afterEach,
  beforeAll,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import fs from "fs";
import i18next from "i18next";
import path from "path";
import * as React from "react";
import { initReactI18next } from "react-i18next";

/*
 * THE KUBERNETES PAGES THAT SAY WHY THEY FAILED (#9595).
 *
 * A Job's "3 pods failed" and its Failed count could not be pressed, a
 * CronJob said nothing of the runs that failed, a namespace counted nothing
 * of what in it is broken, and a container's page said its name. Each now
 * opens exactly what it counts, and why, through the shared pieces
 * (ResourceAttentionPill, ResourceAttentionDialog): these pin what each
 * count lists, each row's words, facts, since and links, and the heroes
 * that draw them - rendered for real.
 */

jest.mock("../../../UI/Utils/Navigation", () => {
  return {
    __esModule: true,
    default: {
      navigate: (): void => {},
      isOnThisPage: (): boolean => {
        return false;
      },
      getQueryStringByName: (): null => {
        return null;
      },
      getFirstParam: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../UI/Utils/Project", () => {
  return {
    __esModule: true,
    default: {
      getCurrentProjectId: (): unknown => {
        const { default: ObjectIDType } = jest.requireActual(
          "../../../Types/ObjectID",
        ) as { default: new (id: string) => unknown };
        return new ObjectIDType("10000000-0000-4000-8000-000000000001");
      },
    },
  };
});

import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import {
  KubernetesHealthRow,
  assessKubernetesContainer,
} from "../../../Types/Kubernetes/KubernetesHealth";
import {
  ResourceAttentionItem,
  ResourceAttentionSeverity,
  ResourceAttentionText,
} from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceAttention";
import { ResourceAttentionDialogRead } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourceAttentionDialog";
import KubernetesPartHero from "../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/Part/KubernetesPartHero";
import KubernetesContainerHero from "../../../../App/FeatureSet/Dashboard/src/Components/Kubernetes/Part/KubernetesContainerHero";
import {
  KubernetesNamespaceAttention,
  KubernetesPartRead,
  KubernetesPartRow,
  getKubernetesNamespaceAttention,
  getKubernetesPartAttentionItems,
  parseKubernetesPartRead,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesPartFacts";
import {
  KubernetesNamespaceCountChip,
  getKubernetesCronJobFailedRunsChip,
  getKubernetesJobFailedPods,
  getKubernetesJobFailedPodsAttention,
  getKubernetesNamespaceCountChips,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesPartCounts";
import {
  getKubernetesContainerAttentionItems,
  getKubernetesContainerKey,
  getKubernetesContainerRowStatus,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesContainerFacts";
import {
  KubernetesProblemKind,
  buildKubernetesProblemItems,
  selectKubernetesProblemPods,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesProblemItems";
import {
  KUBERNETES_POD_QUERY_PARAM,
  KubernetesPartRoutes,
  getKubernetesContainerRoute,
  getKubernetesPartRoutes,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesPartRoutes";
import { Translator, createTranslator } from "../../../Types/Translator";
import {
  KubernetesProblemRowsLoader,
  getKubernetesProblemRowsLoader,
} from "../../../../App/FeatureSet/Dashboard/src/Pages/Kubernetes/Utils/KubernetesProblemLoader";
import { ResourcePartChipAttention } from "../../../../App/FeatureSet/Dashboard/src/Components/ResourcePart/ResourcePartTypes";

const LOCALES_DIR: string = path.resolve(
  __dirname,
  "../../../../App/FeatureSet/Dashboard/src/Locales",
);

function readLocale(code: string): Record<string, string> {
  return JSON.parse(
    fs.readFileSync(path.join(LOCALES_DIR, `${code}.json`), "utf8"),
  ) as Record<string, string>;
}

beforeAll(async () => {
  await i18next.use(initReactI18next).init({
    lng: "en",
    fallbackLng: "en",
    resources: {
      de: { translation: readLocale("de") },
    },
    interpolation: { escapeValue: false },
    keySeparator: false,
    nsSeparator: false,
  });
});

afterEach(async () => {
  cleanup();
  await act(async (): Promise<void> => {
    await i18next.changeLanguage("en");
  });
});

const CLUSTER_ID: ObjectID = new ObjectID(
  "aaaaaaaa-0000-4000-8000-0000000000c1",
);
const ROUTES: KubernetesPartRoutes = getKubernetesPartRoutes(CLUSTER_ID);
const SEEN: string = new Date(Date.now() - 60 * 1000).toISOString();
const ENGLISH: Translator = createTranslator(() => {
  return undefined;
}, "en");

function ago(minutes: number): string {
  return new Date(new Date(SEEN).getTime() - minutes * 60 * 1000).toISOString();
}

function condition(
  type: string,
  status: string,
  fields: { reason?: string; message?: string; at?: string } = {},
): JSONObject {
  return {
    type: type,
    status: status,
    reason: fields.reason ?? "",
    message: fields.message ?? "",
    lastTransitionTime: fields.at ?? ago(600),
  } as unknown as JSONObject;
}

function container(fields: Record<string, unknown> = {}): JSONObject {
  return {
    name: "app",
    ready: true,
    restartCount: 0,
    state: "running",
    reason: "",
    image: "registry.example.com/app:1.4.2",
    ...fields,
  } as unknown as JSONObject;
}

function pod(fields: {
  name: string;
  owner: [string, string];
  phase?: string;
  containers?: Array<JSONObject>;
  ready?: { status: string; at: string };
  node?: string;
}): KubernetesPartRow {
  const phase: string = fields.phase ?? "Running";
  return {
    _id: `pod-${fields.name}`,
    kind: "Pod",
    namespaceKey: "shop",
    name: fields.name,
    phase: phase,
    ownerReferences: {
      items: [{ kind: fields.owner[0], name: fields.owner[1], uid: "u" }],
    } as unknown as JSONObject,
    labels: { "pod-template-hash": "7d9f8b6c5" } as unknown as JSONObject,
    spec: { nodeName: fields.node ?? "node-b" } as unknown as JSONObject,
    status: {
      phase: phase,
      conditions: [
        condition("Ready", fields.ready?.status ?? "True", {
          at: fields.ready?.at ?? ago(600),
        }),
      ],
      containerStatuses: fields.containers ?? [container()],
      initContainerStatuses: [],
    } as unknown as JSONObject,
    lastSeenAt: SEEN,
    resourceCreationTimestamp: ago(600),
  };
}

function failedJobPod(
  name: string,
  job: string,
  code: number,
): KubernetesPartRow {
  return pod({
    name: name,
    owner: ["Job", job],
    phase: "Failed",
    ready: { status: "False", at: ago(30) },
    containers: [
      container({
        ready: false,
        state: "terminated",
        reason: "Error",
        exitCode: code,
        message: "panic: report store unreachable",
      }),
    ],
  });
}

function job(fields: {
  name: string;
  failed?: boolean;
  failedCount?: number;
  cronJob?: string;
  createdMinutesAgo?: number;
  failedMinutesAgo?: number;
}): KubernetesPartRow {
  return {
    _id: `job-${fields.name}`,
    kind: "Job",
    namespaceKey: "shop",
    name: fields.name,
    ownerReferences: fields.cronJob
      ? ({
          items: [{ kind: "CronJob", name: fields.cronJob, uid: "c" }],
        } as unknown as JSONObject)
      : null,
    spec: { backoffLimit: 2 } as unknown as JSONObject,
    status: {
      active: fields.failed ? 0 : 1,
      failed: fields.failedCount ?? (fields.failed ? 3 : 0),
      succeeded: 0,
      conditions: fields.failed
        ? [
            condition("Failed", "True", {
              reason: "BackoffLimitExceeded",
              message: "Job has reached the specified backoff limit",
              at: ago(fields.failedMinutesAgo ?? 20),
            }),
          ]
        : [],
    } as unknown as JSONObject,
    lastSeenAt: SEEN,
    resourceCreationTimestamp: ago(fields.createdMinutesAgo ?? 90),
  };
}

const CRASH_LOOPING: Array<JSONObject> = [
  container({
    ready: false,
    restartCount: 9,
    state: "waiting",
    reason: "CrashLoopBackOff",
    lastTerminationReason: "Error",
    lastTerminationExitCode: 2,
    lastTerminatedAt: ago(2),
  }),
];

function textsOf(item: ResourceAttentionItem): Array<string> {
  return item.reasons.map((reason: ResourceAttentionText): string => {
    return ENGLISH.translateTemplate(reason.text, reason.values || {});
  });
}

/*
 * ---------------------------------------------------------------------------
 * A Job's page
 * ---------------------------------------------------------------------------
 */

describe("a failed Job says why: its failed pods, each with how it ended", () => {
  const read: KubernetesPartRead = {
    part: job({ name: "report-28h7k", failed: true }),
    pods: [
      failedJobPod("report-28h7k-a", "report-28h7k", 1),
      failedJobPod("report-28h7k-b", "report-28h7k", 1),
      pod({
        name: "report-28h7k-c",
        owner: ["Job", "report-28h7k"],
        phase: "Succeeded",
      }),
    ],
    jobs: [],
    isPodsTruncated: false,
  };

  test("its Needs attention: the Job and why it gave up, then each failed pod - never one that succeeded", () => {
    const items: Array<ResourceAttentionItem> = getKubernetesPartAttentionItems(
      {
        read: read,
        routeFor: ROUTES.getPartRoute,
      },
    );

    expect(
      items.map((item: ResourceAttentionItem): string => {
        return item.key;
      }),
    ).toEqual([
      "Job:shop/report-28h7k",
      "Pod:shop/report-28h7k-a",
      "Pod:shop/report-28h7k-b",
    ]);
    // The backoff limit, in Kubernetes' word, and its message.
    expect(textsOf(items[0]!)).toEqual(["Failed", "BackoffLimitExceeded"]);
    expect(items[0]!.message).toBe(
      "Job has reached the specified backoff limit",
    );
    // Each pod: why it ended, since when, a step from its page.
    expect(textsOf(items[1]!)).toEqual(["Failed", "Error, exit code 1"]);
    expect(items[1]!.severity).toBe(ResourceAttentionSeverity.Warning);
    expect(items[1]!.message).toBe("panic: report store unreachable");
    expect(items[1]!.since?.template).toBe("Failed {{time}}");
    expect(items[1]!.route?.toString()).toContain(
      "/pods/report-28h7k-a?namespace=shop",
    );
    // All in the Job's namespace, which its hero names.
    expect(items[1]!.detail).toBeUndefined();
  });

  test("a Job still retrying lists no failed pod as its problem: its count does", () => {
    const retrying: KubernetesPartRead = {
      ...read,
      part: job({ name: "report-28h7k", failedCount: 2 }),
    };
    expect(
      getKubernetesPartAttentionItems({
        read: retrying,
        routeFor: ROUTES.getPartRoute,
      }),
    ).toEqual([]);
    expect(
      getKubernetesJobFailedPods(retrying).map((row: KubernetesPartRow) => {
        return row.name;
      }),
    ).toEqual(["report-28h7k-a", "report-28h7k-b"]);
  });

  test("its failed pods' count opens those pods: red once the Job gave up, amber while it retries", () => {
    const given: ResourcePartChipAttention | undefined =
      getKubernetesJobFailedPodsAttention({
        read: read,
        translator: ENGLISH,
        routeFor: ROUTES.getPartRoute,
      });
    expect(given?.tone).toBe("danger");
    expect(given?.hint).toBe("Show which pods and why");
    expect(given?.dialog.title).toBe("2 failed pods");
    expect(given?.dialog.showKind).toBe(false);
    const items: Array<ResourceAttentionItem> = given?.dialog.items || [];
    expect(
      items.map((item: ResourceAttentionItem): string => {
        return item.name;
      }),
    ).toEqual(["report-28h7k-a", "report-28h7k-b"]);
    // Which container, on which node, each a fact of its own.
    expect(
      (items[0]!.facts || []).map((fact: { key: string }) => {
        return fact.key;
      }),
    ).toEqual(["namespace", "workload", "node", "container"]);

    const retrying: ResourcePartChipAttention | undefined =
      getKubernetesJobFailedPodsAttention({
        read: { ...read, part: job({ name: "report-28h7k", failedCount: 2 }) },
        translator: ENGLISH,
        routeFor: ROUTES.getPartRoute,
      });
    expect(retrying?.tone).toBe("warning");
  });

  test("with a cluster to read Events from, the dialog reads them when it opens", async () => {
    const reads: Array<{ rows: number; kind: KubernetesProblemKind }> = [];
    const given: ResourcePartChipAttention | undefined =
      getKubernetesJobFailedPodsAttention({
        read: read,
        translator: ENGLISH,
        routeFor: ROUTES.getPartRoute,
        loadRows: async (data: {
          rows: Array<KubernetesHealthRow>;
          kind: KubernetesProblemKind;
        }): Promise<Array<ResourceAttentionItem>> => {
          reads.push({ rows: data.rows.length, kind: data.kind });
          return [];
        },
      });

    // Nothing is read until the dialog opens.
    expect(given?.dialog.items).toBeUndefined();
    expect(reads).toEqual([]);
    const result: ResourceAttentionDialogRead | undefined =
      await given?.dialog.load?.();
    expect(result).toEqual({ items: [] });
    expect(reads).toEqual([{ rows: 2, kind: KubernetesProblemKind.Failed }]);
  });

  test("a page that is not a Job's has no such count", () => {
    expect(
      getKubernetesJobFailedPodsAttention({
        read: { ...read, part: { ...read.part!, kind: "Deployment" } },
        translator: ENGLISH,
        routeFor: ROUTES.getPartRoute,
      }),
    ).toBeUndefined();
  });

  test("its hero: the failed count is a button that opens those pods; the succeeded count stays a fact", () => {
    render(
      <KubernetesPartHero
        kind="Job"
        name="report-28h7k"
        read={{
          ...read,
          part: {
            ...read.part!,
            status: {
              ...(read.part!.status as Record<string, unknown>),
              succeeded: 1,
            } as unknown as JSONObject,
          },
        }}
        clusterName="production"
        routes={ROUTES}
      />,
    );

    const chips: HTMLElement = screen.getByTestId("kubernetes-job-hero-chips");
    expect(chips).toHaveTextContent("1 pod succeeded");
    const failed: HTMLElement = screen.getByTestId(
      "kubernetes-job-failed-pods",
    );
    expect(failed.tagName).toBe("BUTTON");
    expect(failed).toHaveTextContent("3 pods failed");
    expect(failed).toHaveAttribute("data-tone", "danger");

    fireEvent.click(failed);

    const dialog: HTMLElement = screen.getByTestId(
      "kubernetes-job-failed-pods-dialog",
    );
    expect(screen.getByText("2 failed pods")).toBeInTheDocument();
    const rows: Array<HTMLElement> = within(dialog).getAllByTestId(
      "kubernetes-job-failed-pods-dialog-item",
    );
    expect(rows).toHaveLength(2);
    expect(
      within(rows[0]!)
        .getAllByTestId("kubernetes-job-failed-pods-dialog-reason")
        .map((chip: HTMLElement): string => {
          return chip.textContent || "";
        }),
    ).toEqual(["Failed", "Error, exit code 1"]);
    expect(
      within(rows[0]!).getByTestId("kubernetes-job-failed-pods-dialog-view"),
    ).toHaveAttribute(
      "href",
      expect.stringContaining("/pods/report-28h7k-a?namespace=shop"),
    );
  });

  test("its status, Failed, opens the Job and its failed pods, the Job as This Job", () => {
    render(
      <KubernetesPartHero
        kind="Job"
        name="report-28h7k"
        read={read}
        clusterName="production"
        routes={ROUTES}
      />,
    );

    fireEvent.click(screen.getByTestId("kubernetes-job-hero-status"));

    const rows: Array<HTMLElement> = within(
      screen.getByTestId("kubernetes-job-hero-status-dialog"),
    ).getAllByTestId("kubernetes-job-hero-status-dialog-item");
    expect(rows).toHaveLength(3);
    expect(
      within(rows[0]!).getByTestId("kubernetes-job-hero-status-dialog-name"),
    ).toHaveTextContent("This Job");
  });
});

/*
 * ---------------------------------------------------------------------------
 * A CronJob's page
 * ---------------------------------------------------------------------------
 */

describe("a CronJob says which of its runs failed, and why", () => {
  const cronJob: KubernetesPartRow = {
    _id: "cron-nightly",
    kind: "CronJob",
    namespaceKey: "shop",
    name: "nightly",
    spec: { schedule: "0 2 * * *", suspend: false } as unknown as JSONObject,
    status: {} as unknown as JSONObject,
    lastSeenAt: SEEN,
    resourceCreationTimestamp: ago(60 * 24 * 30),
  };

  test("its newest run failed: amber, the runs newest first, each with why and a step to its page", () => {
    const read: KubernetesPartRead = {
      part: cronJob,
      jobs: [
        job({
          name: "nightly-1",
          failed: true,
          cronJob: "nightly",
          createdMinutesAgo: 2880,
          failedMinutesAgo: 2860,
        }),
        job({ name: "nightly-2", cronJob: "nightly", createdMinutesAgo: 1440 }),
        job({
          name: "nightly-3",
          failed: true,
          cronJob: "nightly",
          createdMinutesAgo: 60,
          failedMinutesAgo: 40,
        }),
      ],
      pods: [],
      isPodsTruncated: false,
    };

    const chip: ReturnType<typeof getKubernetesCronJobFailedRunsChip> =
      getKubernetesCronJobFailedRunsChip({
        read: read,
        translator: ENGLISH,
        routeFor: ROUTES.getPartRoute,
      });

    expect(chip?.label).toBe("2 runs failed");
    expect(chip?.attention.tone).toBe("warning");
    expect(chip?.attention.hint).toBe("Show which runs and why");
    const items: Array<ResourceAttentionItem> =
      chip?.attention.dialog.items || [];
    // The newest failure first.
    expect(
      items.map((item: ResourceAttentionItem): string => {
        return item.name;
      }),
    ).toEqual(["nightly-3", "nightly-1"]);
    expect(textsOf(items[0]!)).toEqual(["Failed", "BackoffLimitExceeded"]);
    expect(items[0]!.message).toBe(
      "Job has reached the specified backoff limit",
    );
    expect(items[0]!.since?.template).toBe("Failed {{time}}");
    expect(items[0]!.route?.toString()).toContain("/jobs/");
    expect(items[0]!.detail).toBeUndefined();
  });

  test("a run that failed before a newer one went well is history: grey", () => {
    const chip: ReturnType<typeof getKubernetesCronJobFailedRunsChip> =
      getKubernetesCronJobFailedRunsChip({
        read: {
          part: cronJob,
          jobs: [
            job({
              name: "nightly-1",
              failed: true,
              cronJob: "nightly",
              createdMinutesAgo: 2880,
            }),
            job({
              name: "nightly-2",
              cronJob: "nightly",
              createdMinutesAgo: 60,
            }),
          ],
          pods: [],
          isPodsTruncated: false,
        },
        translator: ENGLISH,
        routeFor: ROUTES.getPartRoute,
      });
    expect(chip?.label).toBe("1 run failed");
    expect(chip?.attention.tone).toBe("neutral");
  });

  test("no run failed: no chip", () => {
    expect(
      getKubernetesCronJobFailedRunsChip({
        read: {
          part: cronJob,
          jobs: [job({ name: "nightly-2", cronJob: "nightly" })],
          pods: [],
          isPodsTruncated: false,
        },
        translator: ENGLISH,
        routeFor: ROUTES.getPartRoute,
      }),
    ).toBeNull();
  });

  test("its hero draws the chip, which opens the runs", () => {
    render(
      <KubernetesPartHero
        kind="CronJob"
        name="nightly"
        read={{
          part: cronJob,
          jobs: [
            job({
              name: "nightly-3",
              failed: true,
              cronJob: "nightly",
              createdMinutesAgo: 60,
            }),
          ],
          pods: [],
          isPodsTruncated: false,
        }}
        clusterName="production"
        routes={ROUTES}
      />,
    );

    const chip: HTMLElement = screen.getByTestId(
      "kubernetes-cronjob-failed-runs",
    );
    expect(chip.tagName).toBe("BUTTON");
    expect(chip).toHaveTextContent("1 run failed");
    fireEvent.click(chip);
    expect(
      screen.getByTestId("kubernetes-cronjob-failed-runs-dialog-name"),
    ).toHaveTextContent("nightly-3");
  });
});

/*
 * ---------------------------------------------------------------------------
 * A namespace's page
 * ---------------------------------------------------------------------------
 */

const NAMESPACE: KubernetesPartRow = {
  _id: "ns-shop",
  kind: "Namespace",
  namespaceKey: "",
  name: "shop",
  spec: { finalizers: ["kubernetes"] } as unknown as JSONObject,
  status: { phase: "Active" } as unknown as JSONObject,
  lastSeenAt: SEEN,
  resourceCreationTimestamp: ago(60 * 24 * 90),
};

const CHECKOUT: KubernetesPartRow = {
  _id: "deploy-checkout",
  kind: "Deployment",
  namespaceKey: "shop",
  name: "checkout",
  spec: { replicas: 3 } as unknown as JSONObject,
  status: {
    availableReplicas: 1,
    conditions: [
      condition("Progressing", "True", { reason: "NewReplicaSetAvailable" }),
    ],
  } as unknown as JSONObject,
  lastSeenAt: SEEN,
  resourceCreationTimestamp: ago(6000),
};

const LOST_CLAIM: KubernetesPartRow = {
  _id: "pvc-data",
  kind: "PersistentVolumeClaim",
  namespaceKey: "shop",
  name: "data",
  status: { phase: "Lost" } as unknown as JSONObject,
  lastSeenAt: SEEN,
  resourceCreationTimestamp: ago(6000),
};

const NAMESPACE_READ: KubernetesPartRead = {
  part: NAMESPACE,
  pods: [
    pod({
      name: "checkout-7d9f8b6c5-a",
      owner: ["ReplicaSet", "checkout-7d9f8b6c5"],
      containers: CRASH_LOOPING,
      ready: { status: "False", at: ago(50) },
    }),
    pod({
      name: "checkout-7d9f8b6c5-b",
      owner: ["ReplicaSet", "checkout-7d9f8b6c5"],
      containers: CRASH_LOOPING,
      ready: { status: "False", at: ago(50) },
    }),
  ],
  jobs: [],
  objects: [CHECKOUT, LOST_CLAIM],
  isPodsTruncated: false,
};

describe("a namespace counts what in it needs attention, and lists it", () => {
  test("its Needs attention: what in it is broken, pods folded into their workloads, no namespace line under each", () => {
    const items: Array<ResourceAttentionItem> = getKubernetesPartAttentionItems(
      {
        read: NAMESPACE_READ,
        routeFor: ROUTES.getPartRoute,
      },
    );

    expect(
      items.map((item: ResourceAttentionItem): string => {
        return item.key;
      }),
    ).toEqual(["Deployment:shop/checkout", "PersistentVolumeClaim:shop/data"]);
    // The pods' why, in the Deployment's row.
    expect(textsOf(items[0]!)).toContain("CrashLoopBackOff");
    for (const item of items) {
      expect(item.detail).toBeUndefined();
    }
  });

  test("a namespace stuck deleting comes first among equals, as This namespace's row", () => {
    const stuck: KubernetesPartRow = {
      ...NAMESPACE,
      status: {
        phase: "Terminating",
        conditions: [
          condition("NamespaceContentRemaining", "True", {
            reason: "SomeResourcesRemain",
            message:
              "Some resources are remaining: pods. has 2 resource instances",
            at: ago(40),
          }),
        ],
      } as unknown as JSONObject,
    };
    const items: Array<ResourceAttentionItem> = getKubernetesPartAttentionItems(
      {
        read: { ...NAMESPACE_READ, part: stuck },
        routeFor: ROUTES.getPartRoute,
      },
    );
    // Critical first: the Deployment and the lost claim, then the namespace.
    expect(
      items.map((item: ResourceAttentionItem): string => {
        return item.key;
      }),
    ).toEqual([
      "Deployment:shop/checkout",
      "PersistentVolumeClaim:shop/data",
      "Namespace:shop",
    ]);
    expect(textsOf(items[2]!)).toEqual(["Resources remain"]);
  });

  test("its counts: each workload once, its pods each, a claim neither", () => {
    const attention: KubernetesNamespaceAttention =
      getKubernetesNamespaceAttention({
        read: NAMESPACE_READ,
        routeFor: ROUTES.getPartRoute,
      });

    expect(
      attention.workloads.map((item: ResourceAttentionItem): string => {
        return item.key;
      }),
    ).toEqual(["Deployment:shop/checkout"]);
    expect(
      attention.pods.map((row: KubernetesPartRow): string => {
        return row.name || "";
      }),
    ).toEqual(["checkout-7d9f8b6c5-a", "checkout-7d9f8b6c5-b"]);

    const chips: Array<KubernetesNamespaceCountChip> =
      getKubernetesNamespaceCountChips({
        attention: attention,
        translator: ENGLISH,
        routeFor: ROUTES.getPartRoute,
      });
    expect(
      chips.map((chip: KubernetesNamespaceCountChip) => {
        return [chip.key, chip.label, chip.attention.tone];
      }),
    ).toEqual([
      ["workloads", "1 workload needs attention", "danger"],
      ["pods", "2 pods need attention", "danger"],
    ]);
    // A pod's row says why, which container and since when.
    const podItems: Array<ResourceAttentionItem> =
      chips[1]!.attention.dialog.items || [];
    expect(textsOf(podItems[0]!)).toEqual([
      "CrashLoopBackOff",
      "Last restart: Error, exit code 2",
    ]);
    expect(podItems[0]!.since?.template).toBe("Failing since {{time}}");
  });

  test("nothing in it needs attention: no counts", () => {
    expect(
      getKubernetesNamespaceCountChips({
        attention: getKubernetesNamespaceAttention({
          read: {
            part: NAMESPACE,
            pods: [],
            jobs: [],
            objects: [],
            isPodsTruncated: false,
          },
          routeFor: ROUTES.getPartRoute,
        }),
        translator: ENGLISH,
        routeFor: ROUTES.getPartRoute,
      }),
    ).toEqual([]);
  });

  test("its hero: where it is, and the two counts as buttons that open which and why", () => {
    render(
      <KubernetesPartHero
        kind="Namespace"
        name="shop"
        read={NAMESPACE_READ}
        clusterName="production"
        routes={ROUTES}
      />,
    );

    expect(
      screen.getByTestId("kubernetes-namespace-hero-location"),
    ).toHaveTextContent("Namespace of cluster production");
    const workloads: HTMLElement = screen.getByTestId(
      "kubernetes-namespace-workloads",
    );
    const pods: HTMLElement = screen.getByTestId("kubernetes-namespace-pods");
    expect(workloads.tagName).toBe("BUTTON");
    expect(workloads).toHaveTextContent("1 workload needs attention");
    expect(pods).toHaveTextContent("2 pods need attention");

    fireEvent.click(workloads);
    expect(
      screen.getByTestId("kubernetes-namespace-workloads-dialog-name"),
    ).toHaveTextContent("checkout");
  });

  test("an older server's answer has no objects, and the page still reads", () => {
    expect(
      parseKubernetesPartRead({
        part: NAMESPACE as unknown as JSONObject,
        pods: [],
        jobs: [],
      } as unknown as JSONObject).objects,
    ).toEqual([]);
    expect(
      parseKubernetesPartRead({
        part: NAMESPACE as unknown as JSONObject,
        pods: [],
        jobs: [],
        objects: [CHECKOUT, "junk", null],
      } as unknown as JSONObject).objects,
    ).toEqual([CHECKOUT]);
  });
});

/*
 * ---------------------------------------------------------------------------
 * Pods of many states, as a namespace's count lists them
 * ---------------------------------------------------------------------------
 */

describe("a list of pods of several states says since when in each one's words", () => {
  const pending: KubernetesPartRow = {
    ...pod({
      name: "queued",
      owner: ["ReplicaSet", "checkout-7d9f8b6c5"],
      phase: "Pending",
      containers: [],
    }),
    status: {
      phase: "Pending",
      conditions: [
        condition("PodScheduled", "False", {
          reason: "Unschedulable",
          at: ago(30),
        }),
      ],
      containerStatuses: [],
      initContainerStatuses: [],
    } as unknown as JSONObject,
  };
  const notReady: KubernetesPartRow = pod({
    name: "slow",
    owner: ["ReplicaSet", "checkout-7d9f8b6c5"],
    containers: [container({ ready: false })],
    ready: { status: "False", at: ago(30) },
  });
  const crashing: KubernetesPartRow = pod({
    name: "crashing",
    owner: ["ReplicaSet", "checkout-7d9f8b6c5"],
    containers: CRASH_LOOPING,
    ready: { status: "False", at: ago(30) },
  });
  const fine: KubernetesPartRow = pod({
    name: "fine",
    owner: ["ReplicaSet", "checkout-7d9f8b6c5"],
  });

  test("only the pods the rules say need attention are listed", () => {
    expect(
      selectKubernetesProblemPods([pending, notReady, crashing, fine], {
        kind: KubernetesProblemKind.NeedsAttention,
      }).map((row: KubernetesPartRow): string => {
        return row.name || "";
      }),
    ).toEqual(["queued", "slow", "crashing"]);
  });

  test("each says since when as its state is", () => {
    const items: Array<ResourceAttentionItem> = buildKubernetesProblemItems({
      rows: [pending, notReady, crashing],
      query: { kind: KubernetesProblemKind.NeedsAttention },
      routeFor: ROUTES.getPartRoute,
    });
    const since: Record<string, string> = {};
    for (const item of items) {
      since[item.name] = item.since?.template || "";
    }
    expect(since).toEqual({
      crashing: "Failing since {{time}}",
      queued: "Pending since {{time}}",
      slow: "Not ready since {{time}}",
    });
  });

  test("a loader bound to a cluster reads the rows it is handed, with their kind", async () => {
    const loader: KubernetesProblemRowsLoader = getKubernetesProblemRowsLoader({
      clusterIdentifier: "",
      routeFor: ROUTES.getPartRoute,
    });
    // No cluster name to read Events by: the rows as they are, none read.
    const items: Array<ResourceAttentionItem> = await loader({
      rows: [crashing],
      kind: KubernetesProblemKind.NeedsAttention,
    });
    expect(
      items.map((item: ResourceAttentionItem): string => {
        return item.name;
      }),
    ).toEqual(["crashing"]);
  });
});

/*
 * ---------------------------------------------------------------------------
 * A container's page
 * ---------------------------------------------------------------------------
 */

describe("a container's page says why it is not running", () => {
  const crashingPod: KubernetesPartRow = pod({
    name: "checkout-7d9f8b6c5-x2k4q",
    owner: ["ReplicaSet", "checkout-7d9f8b6c5"],
    node: "node-b",
    containers: [
      container({ name: "sidecar" }),
      container({
        ready: false,
        restartCount: 14,
        state: "waiting",
        reason: "CrashLoopBackOff",
        message: "back-off 5m0s restarting failed container=app",
        lastTerminationReason: "Error",
        lastTerminationExitCode: 2,
        lastTerminatedAt: ago(3),
      }),
    ],
    ready: { status: "False", at: ago(90) },
  });

  test("its row: why in Kubernetes' words, its pod and node a step away, its restarts, since when", () => {
    const items: Array<ResourceAttentionItem> =
      getKubernetesContainerAttentionItems({
        pod: crashingPod,
        assessment: assessKubernetesContainer(crashingPod, { name: "app" }),
        routeFor: ROUTES.getPartRoute,
      });

    expect(items).toHaveLength(1);
    const item: ResourceAttentionItem = items[0]!;
    expect(item.key).toBe(getKubernetesContainerKey(crashingPod, "app"));
    expect(item.key).toBe("Container:shop/checkout-7d9f8b6c5-x2k4q/app");
    expect(item.severity).toBe(ResourceAttentionSeverity.Critical);
    expect(textsOf(item)).toEqual([
      "CrashLoopBackOff",
      "Last restart: Error, exit code 2",
    ]);
    expect(item.message).toBe("back-off 5m0s restarting failed container=app");
    expect(item.since?.template).toBe("Failing since {{time}}");
    expect(
      (item.facts || []).map((fact: { key: string; value: string }) => {
        return [fact.key, fact.value];
      }),
    ).toEqual([
      ["pod", "checkout-7d9f8b6c5-x2k4q"],
      ["node", "node-b"],
      ["restarts", "14"],
    ]);
    expect(item.facts![0]!.route?.toString()).toContain(
      "/pods/checkout-7d9f8b6c5-x2k4q?namespace=shop",
    );
  });

  test("a container that is fine has nothing to list", () => {
    expect(
      getKubernetesContainerAttentionItems({
        pod: crashingPod,
        assessment: assessKubernetesContainer(crashingPod, { name: "sidecar" }),
        routeFor: ROUTES.getPartRoute,
      }),
    ).toEqual([]);
  });

  test("its hero: its word, where it runs, its restarts, and a status that opens why", () => {
    render(
      <KubernetesContainerHero
        name="app"
        pod="checkout-7d9f8b6c5-x2k4q"
        namespace="shop"
        read={{ part: crashingPod, pods: [], jobs: [], isPodsTruncated: false }}
        routes={ROUTES}
      />,
    );

    expect(
      screen.getByTestId("kubernetes-container-hero-name"),
    ).toHaveTextContent("app");
    expect(
      screen.getByTestId("kubernetes-container-hero-location"),
    ).toHaveTextContent(
      "Container of pod checkout-7d9f8b6c5-x2k4q in namespace shop, on node node-b",
    );
    expect(
      screen.getByTestId("kubernetes-container-hero-chips"),
    ).toHaveTextContent("14 restarts");

    const status: HTMLElement = screen.getByTestId(
      "kubernetes-container-hero-status",
    );
    expect(status.tagName).toBe("BUTTON");
    expect(status).toHaveTextContent("CrashLoopBackOff");

    fireEvent.click(status);

    const row: HTMLElement = screen.getByTestId(
      "kubernetes-container-hero-status-dialog-item",
    );
    expect(row).toHaveAttribute("data-current", "true");
    expect(
      within(row).getByTestId("kubernetes-container-hero-status-dialog-name"),
    ).toHaveTextContent("This container");
    // Its pod, a step from its page, in the dialog's facts.
    expect(
      within(row).getAllByTestId(
        "kubernetes-container-hero-status-dialog-fact-link",
      )[0],
    ).toHaveAttribute(
      "href",
      expect.stringContaining("/pods/checkout-7d9f8b6c5-x2k4q?namespace=shop"),
    );
  });

  test("an init container says so in a badge", () => {
    const initPod: KubernetesPartRow = {
      ...crashingPod,
      status: {
        phase: "Pending",
        conditions: [],
        containerStatuses: [],
        initContainerStatuses: [
          container({
            name: "migrate",
            ready: false,
            state: "waiting",
            reason: "CrashLoopBackOff",
          }),
        ],
      } as unknown as JSONObject,
    };

    render(
      <KubernetesContainerHero
        name="migrate"
        pod="checkout-7d9f8b6c5-x2k4q"
        namespace="shop"
        read={{ part: initPod, pods: [], jobs: [], isPodsTruncated: false }}
        routes={ROUTES}
      />,
    );

    expect(
      screen.getByTestId("kubernetes-container-hero-badge"),
    ).toHaveTextContent("Init container");
  });

  test("before its pod is read: its name and where the address says it is", () => {
    render(
      <KubernetesContainerHero
        name="app"
        pod="checkout-7d9f8b6c5-x2k4q"
        namespace="shop"
        read={null}
        routes={ROUTES}
      />,
    );

    expect(
      screen.getByTestId("kubernetes-container-hero-name"),
    ).toHaveTextContent("app");
    expect(screen.queryByTestId("kubernetes-container-hero-status")).toBeNull();
    expect(
      screen.getByTestId("kubernetes-container-hero-location"),
    ).toHaveTextContent(
      "Container of pod checkout-7d9f8b6c5-x2k4q in namespace shop",
    );
  });

  test("in German the product's words are German, Kubernetes' own as written", async () => {
    await act(async (): Promise<void> => {
      await i18next.changeLanguage("de");
    });

    render(
      <KubernetesContainerHero
        name="app"
        pod="checkout-7d9f8b6c5-x2k4q"
        namespace="shop"
        read={{ part: crashingPod, pods: [], jobs: [], isPodsTruncated: false }}
        routes={ROUTES}
      />,
    );

    await waitFor(() => {
      expect(
        screen.getByTestId("kubernetes-container-hero-status"),
      ).toHaveTextContent("CrashLoopBackOff");
    });
    expect(
      screen.getByTestId("kubernetes-container-hero-chips"),
    ).toHaveTextContent("14 Neustarts");
  });
});

describe("a link to a container says whose", () => {
  test("its pod and namespace, so a same-named container of another pod never opens", () => {
    const route: string = getKubernetesContainerRoute(CLUSTER_ID, {
      name: "app",
      pod: "checkout-7d9f8b6c5-x2k4q",
      namespace: "shop",
    }).toString();
    expect(route).toContain("/containers/app?");
    expect(route).toContain(
      `${KUBERNETES_POD_QUERY_PARAM}=checkout-7d9f8b6c5-x2k4q`,
    );
    expect(route).toContain("namespace=shop");
  });

  test("without a pod, the name alone, as older links did", () => {
    const route: string = getKubernetesContainerRoute(CLUSTER_ID, {
      name: "app",
      namespace: "shop",
    }).toString();
    expect(route).toMatch(/\/containers\/app$/);
  });

  test("a list's state: Running, NotReady, or Kubernetes' reason", () => {
    expect(
      getKubernetesContainerRowStatus({ state: "running", isReady: true }),
    ).toBe("Running");
    expect(
      getKubernetesContainerRowStatus({ state: "running", isReady: false }),
    ).toBe("NotReady");
    expect(
      getKubernetesContainerRowStatus({
        state: "waiting",
        reason: "CrashLoopBackOff",
      }),
    ).toBe("CrashLoopBackOff");
    expect(getKubernetesContainerRowStatus({ state: "waiting" })).toBe(
      "Waiting",
    );
    expect(
      getKubernetesContainerRowStatus({
        state: "terminated",
        reason: "Completed",
      }),
    ).toBe("Completed");
    expect(getKubernetesContainerRowStatus({ state: "terminated" })).toBe(
      "Terminated",
    );
    expect(getKubernetesContainerRowStatus({ state: "unknown" })).toBe(
      "Unknown",
    );
    expect(getKubernetesContainerRowStatus({})).toBe("Unknown");
  });
});
