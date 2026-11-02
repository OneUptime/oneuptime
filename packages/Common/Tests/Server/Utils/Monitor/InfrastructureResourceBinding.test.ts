import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import ObjectID from "../../../../Types/ObjectID";
import MonitorType from "../../../../Types/Monitor/MonitorType";
import MonitorStep from "../../../../Types/Monitor/MonitorStep";
import MonitorSteps from "../../../../Types/Monitor/MonitorSteps";
import { JSONObject } from "../../../../Types/JSON";
import QueryHelper from "../../../../Server/Types/Database/QueryHelper";

/*
 * An infrastructure step names its resource by the value its telemetry is
 * matched on, and that value can change: a cluster or vCenter renamed on its
 * Settings page, a host name corrected by ingest. The step keeps the
 * resource's id, bound on every write and read by the worker.
 */

interface Row {
  _id: string;
  projectId: string;
  name?: string;
  hostIdentifier?: string;
}

let rows: Array<Row> = [];
let isReadFailing: boolean = false;

// What the binding asks of a resource service, answered from `rows`.
const findOneBy: (data: {
  query: Record<string, unknown>;
}) => Promise<Row | null> = async (data: {
  query: Record<string, unknown>;
}): Promise<Row | null> => {
  if (isReadFailing) {
    throw new Error("connection refused");
  }

  const query: Record<string, unknown> = data.query;
  const projectId: string = String(query["projectId"]);

  return (
    rows.find((row: Row): boolean => {
      if (row.projectId !== projectId) {
        return false;
      }

      if (query["_id"]) {
        return row._id === String(query["_id"]);
      }

      for (const column of ["name", "hostIdentifier"]) {
        const wanted: { sameText?: string } | undefined = query[column] as
          | { sameText?: string }
          | undefined;

        if (wanted?.sameText !== undefined) {
          const stored: string | undefined = (
            row as unknown as Record<string, string>
          )[column];
          return (stored || "").trim().toLowerCase() === wanted.sameText;
        }
      }

      return false;
    }) || null
  );
};

jest.mock("../../../../Server/Services/HostService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (d: never) => {
        return findOneBy(d);
      },
    },
  };
});
jest.mock("../../../../Server/Services/ProxmoxClusterService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (d: never) => {
        return findOneBy(d);
      },
    },
  };
});
jest.mock("../../../../Server/Services/VMwareVCenterService", () => {
  return {
    __esModule: true,
    default: {
      findOneBy: (d: never) => {
        return findOneBy(d);
      },
    },
  };
});

import InfrastructureResourceBinding from "../../../../Server/Utils/Monitor/InfrastructureResourceBinding";

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CLUSTER_ID: string = "22222222-2222-4222-8222-222222222222";
const HOST_ID: string = "33333333-3333-4333-8333-333333333333";
const OTHER_CLUSTER_ID: string = "44444444-4444-4444-8444-444444444444";
const STEP_ID: string = "55555555-5555-4555-8555-555555555555";

function proxmoxStep(config: Record<string, unknown>): MonitorStep {
  const step: MonitorStep = new MonitorStep();
  step.data!.id = STEP_ID;
  (step.data as unknown as Record<string, unknown>)["proxmoxMonitor"] = {
    resourceFilters: {},
    metricViewConfig: { queryConfigs: [], formulaConfigs: [] },
    ...config,
  };
  return step;
}

function hostStep(config: Record<string, unknown>): MonitorStep {
  const step: MonitorStep = new MonitorStep();
  (step.data as unknown as Record<string, unknown>)["hostMonitor"] = {
    metricViewConfig: { queryConfigs: [], formulaConfigs: [] },
    ...config,
  };
  return step;
}

function stepsOf(...steps: Array<MonitorStep>): MonitorSteps {
  const monitorSteps: MonitorSteps = new MonitorSteps();
  monitorSteps.data!.monitorStepsInstanceArray = steps;
  return monitorSteps;
}

function configOf(step: MonitorStep, key: string): Record<string, unknown> {
  return (step.data as unknown as Record<string, unknown>)[key] as Record<
    string,
    unknown
  >;
}

function bindProxmox(data: {
  written: { identifier: string; resourceId?: string };
  stored?: { identifier: string; resourceId?: string };
}): Promise<{ identifier: string; resourceId: string | undefined }> {
  return InfrastructureResourceBinding.bind({
    projectId: PROJECT_ID,
    monitorType: MonitorType.Proxmox,
    written: data.written,
    stored: data.stored,
  });
}

beforeEach(() => {
  isReadFailing = false;
  rows = [
    { _id: CLUSTER_ID, projectId: PROJECT_ID.toString(), name: "pve-prod" },
    {
      _id: HOST_ID,
      projectId: PROJECT_ID.toString(),
      hostIdentifier: "web-01",
    },
  ];
  jest
    .spyOn(QueryHelper, "findWithSameText")
    .mockImplementation((text: string | number): never => {
      return { sameText: String(text).trim().toLowerCase() } as never;
    });
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("a new or changed value is bound to the resource it names", () => {
  test("case and spaces aside, and the value is kept as written", async () => {
    expect(
      await bindProxmox({ written: { identifier: " PVE-Prod " } }),
    ).toEqual({ identifier: " PVE-Prod ", resourceId: CLUSTER_ID });
  });

  test("a host name typed in another case is bound to the host ingest stores", async () => {
    expect(
      await InfrastructureResourceBinding.bind({
        projectId: PROJECT_ID,
        monitorType: MonitorType.Host,
        written: { identifier: "Web-01" },
      }),
    ).toEqual({ identifier: "Web-01", resourceId: HOST_ID });
  });

  test("a changed value moves the step to the resource it names, not the one it was on", async () => {
    rows.push({
      _id: OTHER_CLUSTER_ID,
      projectId: PROJECT_ID.toString(),
      name: "pve-dr",
    });

    expect(
      await bindProxmox({
        written: { identifier: "pve-dr", resourceId: CLUSTER_ID },
        stored: { identifier: "pve-prod", resourceId: CLUSTER_ID },
      }),
    ).toEqual({ identifier: "pve-dr", resourceId: OTHER_CLUSTER_ID });
  });

  test("a changed value naming no resource keeps the value and loses the id", async () => {
    expect(
      await bindProxmox({
        written: { identifier: "not-yet-reporting", resourceId: CLUSTER_ID },
        stored: { identifier: "pve-prod", resourceId: CLUSTER_ID },
      }),
    ).toEqual({ identifier: "not-yet-reporting", resourceId: undefined });
  });

  test("a create binds by value only: an id sent with a value naming nothing is dropped", async () => {
    expect(
      await bindProxmox({
        written: { identifier: "not-yet-reporting", resourceId: CLUSTER_ID },
      }),
    ).toEqual({ identifier: "not-yet-reporting", resourceId: undefined });
  });

  test("another project's resource is never bound", async () => {
    expect(
      await InfrastructureResourceBinding.bind({
        projectId: ObjectID.generate(),
        monitorType: MonitorType.Proxmox,
        written: { identifier: "pve-prod" },
      }),
    ).toEqual({ identifier: "pve-prod", resourceId: undefined });
  });

  test("a blank value or a monitor of another type is left as it is", async () => {
    expect(await bindProxmox({ written: { identifier: "  " } })).toEqual({
      identifier: "  ",
      resourceId: undefined,
    });
    expect(
      await InfrastructureResourceBinding.bind({
        projectId: PROJECT_ID,
        monitorType: MonitorType.Website,
        written: { identifier: "pve-prod", resourceId: CLUSTER_ID },
      }),
    ).toEqual({ identifier: "pve-prod", resourceId: CLUSTER_ID });
  });
});

describe("a value the write leaves as it was keeps its resource", () => {
  test("renamed since: the dashboard, which sends the id back, takes the current name", async () => {
    rows[0]!.name = "pve-production";

    expect(
      await bindProxmox({
        written: { identifier: "pve-prod", resourceId: CLUSTER_ID },
        stored: { identifier: "pve-prod", resourceId: CLUSTER_ID },
      }),
    ).toEqual({ identifier: "pve-production", resourceId: CLUSTER_ID });
  });

  test("renamed since: a client that does not send the id (Terraform) keeps the id and its own value", async () => {
    rows[0]!.name = "pve-production";

    expect(
      await bindProxmox({
        written: { identifier: "pve-prod" },
        stored: { identifier: "PVE-Prod", resourceId: CLUSTER_ID },
      }),
    ).toEqual({ identifier: "pve-prod", resourceId: CLUSTER_ID });
  });

  test("it stays on its resource when another one has taken the old name", async () => {
    rows[0]!.name = "pve-old";
    rows.push({
      _id: OTHER_CLUSTER_ID,
      projectId: PROJECT_ID.toString(),
      name: "pve-prod",
    });

    expect(
      await bindProxmox({
        written: { identifier: "pve-prod", resourceId: CLUSTER_ID },
        stored: { identifier: "pve-prod", resourceId: CLUSTER_ID },
      }),
    ).toEqual({ identifier: "pve-old", resourceId: CLUSTER_ID });
  });

  test("a host name differing only in case is not rewritten", async () => {
    expect(
      await InfrastructureResourceBinding.bind({
        projectId: PROJECT_ID,
        monitorType: MonitorType.Host,
        written: { identifier: "Web-01", resourceId: HOST_ID },
        stored: { identifier: "Web-01", resourceId: HOST_ID },
      }),
    ).toEqual({ identifier: "Web-01", resourceId: HOST_ID });
  });

  test("its resource gone, it is bound by its value again, or has no id", async () => {
    rows = [];

    expect(
      await bindProxmox({
        written: { identifier: "pve-prod", resourceId: CLUSTER_ID },
        stored: { identifier: "pve-prod", resourceId: CLUSTER_ID },
      }),
    ).toEqual({ identifier: "pve-prod", resourceId: undefined });

    rows = [
      {
        _id: OTHER_CLUSTER_ID,
        projectId: PROJECT_ID.toString(),
        name: "pve-prod",
      },
    ];

    expect(
      await bindProxmox({
        written: { identifier: "pve-prod", resourceId: CLUSTER_ID },
        stored: { identifier: "pve-prod", resourceId: CLUSTER_ID },
      }),
    ).toEqual({ identifier: "pve-prod", resourceId: OTHER_CLUSTER_ID });
  });
});

describe("a monitor's steps are bound in place", () => {
  test("against the stored step with the same id", async () => {
    rows[0]!.name = "pve-production";
    const stored: MonitorSteps = stepsOf(
      proxmoxStep({ clusterIdentifier: "pve-prod", resourceId: CLUSTER_ID }),
    );
    // As Terraform writes it: the same value, no id.
    const written: MonitorSteps = stepsOf(
      proxmoxStep({ clusterIdentifier: "pve-prod" }),
    );

    expect(
      await InfrastructureResourceBinding.bindMonitorSteps({
        projectId: PROJECT_ID,
        monitorType: MonitorType.Proxmox,
        monitorSteps: written,
        storedMonitorSteps: stored,
      }),
    ).toBe(true);
    expect(
      configOf(written.data!.monitorStepsInstanceArray[0]!, "proxmoxMonitor"),
    ).toMatchObject({ clusterIdentifier: "pve-prod", resourceId: CLUSTER_ID });
  });

  test("a step with no stored twin is bound as a new one", async () => {
    const written: MonitorSteps = stepsOf(
      proxmoxStep({ clusterIdentifier: "PVE-PROD" }),
    );

    expect(
      await InfrastructureResourceBinding.bindMonitorSteps({
        projectId: PROJECT_ID,
        monitorType: MonitorType.Proxmox,
        monitorSteps: written,
      }),
    ).toBe(true);
    expect(
      configOf(written.data!.monitorStepsInstanceArray[0]!, "proxmoxMonitor"),
    ).toMatchObject({ clusterIdentifier: "PVE-PROD", resourceId: CLUSTER_ID });

    /*
     * Saved again from the dashboard, which shows the cluster by its own
     * name and sends the id back: the step takes the cluster's spelling.
     */
    const saved: MonitorSteps = MonitorSteps.clone(written);

    expect(
      await InfrastructureResourceBinding.bindMonitorSteps({
        projectId: PROJECT_ID,
        monitorType: MonitorType.Proxmox,
        monitorSteps: saved,
        storedMonitorSteps: written,
      }),
    ).toBe(true);
    expect(
      configOf(saved.data!.monitorStepsInstanceArray[0]!, "proxmoxMonitor"),
    ).toMatchObject({ clusterIdentifier: "pve-prod", resourceId: CLUSTER_ID });

    // Bound already, on its cluster's value: nothing to change.
    expect(
      await InfrastructureResourceBinding.bindMonitorSteps({
        projectId: PROJECT_ID,
        monitorType: MonitorType.Proxmox,
        monitorSteps: MonitorSteps.clone(saved),
        storedMonitorSteps: saved,
      }),
    ).toBe(false);
  });

  test("a monitor of another type is left alone", async () => {
    const written: MonitorSteps = stepsOf(
      proxmoxStep({ clusterIdentifier: "pve-prod" }),
    );

    expect(
      await InfrastructureResourceBinding.bindMonitorSteps({
        projectId: PROJECT_ID,
        monitorType: MonitorType.Website,
        monitorSteps: written,
      }),
    ).toBe(false);
    expect(
      configOf(written.data!.monitorStepsInstanceArray[0]!, "proxmoxMonitor")[
        "resourceId"
      ],
    ).toBeUndefined();
  });

  test("the stored JSON, the data migration's path, gets ids and keeps every value", async () => {
    rows[0]!.name = "pve-production";
    const json: JSONObject = {
      _type: "MonitorSteps",
      value: {
        monitorStepsInstanceArray: [
          {
            _type: "MonitorStep",
            value: { hostMonitor: { hostIdentifier: " Web-01" } },
          },
        ],
      },
    };

    expect(
      await InfrastructureResourceBinding.bindMonitorStepsJSON({
        projectId: PROJECT_ID,
        monitorType: MonitorType.Host,
        monitorStepsJSON: json,
      }),
    ).toBe(true);
    expect(
      (
        (json["value"] as JSONObject)[
          "monitorStepsInstanceArray"
        ] as Array<JSONObject>
      )[0]!["value"],
    ).toEqual({
      hostMonitor: { hostIdentifier: " Web-01", resourceId: HOST_ID },
    });

    const bound: JSONObject = {
      _type: "MonitorSteps",
      value: {
        monitorStepsInstanceArray: [
          {
            _type: "MonitorStep",
            value: {
              proxmoxMonitor: {
                clusterIdentifier: "pve-prod",
                resourceId: CLUSTER_ID,
              },
            },
          },
        ],
      },
    };

    expect(
      await InfrastructureResourceBinding.bindMonitorStepsJSON({
        projectId: PROJECT_ID,
        monitorType: MonitorType.Proxmox,
        monitorStepsJSON: bound,
      }),
    ).toBe(false);
  });
});

describe("the worker evaluates a step on its resource's current value", () => {
  function resolve(
    monitorType: MonitorType,
    step: MonitorStep,
  ): Promise<MonitorStep> {
    return InfrastructureResourceBinding.resolveForEvaluation({
      projectId: PROJECT_ID,
      monitorType,
      monitorStep: step,
    });
  }

  test("a cluster renamed since the monitor was saved is followed by its id", async () => {
    rows[0]!.name = "pve-production";
    const step: MonitorStep = proxmoxStep({
      clusterIdentifier: "pve-prod",
      resourceId: CLUSTER_ID,
    });

    const resolved: MonitorStep = await resolve(MonitorType.Proxmox, step);

    expect(configOf(resolved, "proxmoxMonitor")["clusterIdentifier"]).toBe(
      "pve-production",
    );
    // A copy: the stored step is left as it is.
    expect(configOf(step, "proxmoxMonitor")["clusterIdentifier"]).toBe(
      "pve-prod",
    );
  });

  test("an unbound host step is matched as ingest stores host names", async () => {
    const resolved: MonitorStep = await resolve(
      MonitorType.Host,
      hostStep({ hostIdentifier: " Web-01 " }),
    );

    expect(configOf(resolved, "hostMonitor")["hostIdentifier"]).toBe("web-01");
  });

  test("an unbound step takes the value of the resource it names, case aside", async () => {
    const resolved: MonitorStep = await resolve(
      MonitorType.Proxmox,
      proxmoxStep({ clusterIdentifier: "PVE-PROD" }),
    );

    expect(configOf(resolved, "proxmoxMonitor")["clusterIdentifier"]).toBe(
      "pve-prod",
    );
  });

  test("a step naming no resource, or whose resource is gone, is evaluated on its own value", async () => {
    rows = [];
    const unbound: MonitorStep = proxmoxStep({ clusterIdentifier: "pve-prod" });
    const bound: MonitorStep = proxmoxStep({
      clusterIdentifier: "pve-prod",
      resourceId: CLUSTER_ID,
    });

    expect(await resolve(MonitorType.Proxmox, unbound)).toBe(unbound);
    expect(await resolve(MonitorType.Proxmox, bound)).toBe(bound);
  });

  test("a failed read leaves the step on its own value", async () => {
    isReadFailing = true;
    const step: MonitorStep = proxmoxStep({
      clusterIdentifier: "pve-prod",
      resourceId: CLUSTER_ID,
    });

    expect(await resolve(MonitorType.Proxmox, step)).toBe(step);
  });

  test("a step with no value, or a monitor of another type, is evaluated as it is", async () => {
    const blank: MonitorStep = proxmoxStep({ clusterIdentifier: "" });
    const step: MonitorStep = proxmoxStep({ clusterIdentifier: "x" });

    expect(await resolve(MonitorType.Proxmox, blank)).toBe(blank);
    expect(await resolve(MonitorType.Website, step)).toBe(step);
  });
});

describe("resource links read a monitor's steps on their bound resources' values", () => {
  test("a bound step renamed since is resolved; an unbound one is left to the case-insensitive linker", async () => {
    rows[0]!.name = "pve-production";
    const bound: MonitorSteps = stepsOf(
      proxmoxStep({ clusterIdentifier: "pve-prod", resourceId: CLUSTER_ID }),
    );
    const unbound: MonitorSteps = stepsOf(
      proxmoxStep({ clusterIdentifier: "PVE-PRODUCTION" }),
    );

    const resolved: MonitorSteps =
      await InfrastructureResourceBinding.resolveMonitorSteps({
        projectId: PROJECT_ID,
        monitorType: MonitorType.Proxmox,
        monitorSteps: bound,
      });

    expect(resolved).not.toBe(bound);
    expect(
      configOf(resolved.data!.monitorStepsInstanceArray[0]!, "proxmoxMonitor")[
        "clusterIdentifier"
      ],
    ).toBe("pve-production");

    expect(
      await InfrastructureResourceBinding.resolveMonitorSteps({
        projectId: PROJECT_ID,
        monitorType: MonitorType.Proxmox,
        monitorSteps: unbound,
      }),
    ).toBe(unbound);
  });
});
