import AutoRemediationRuleEngineService from "../../../Server/Services/AutoRemediationRuleEngineService";
import KubernetesClusterService from "../../../Server/Services/KubernetesClusterService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import logger from "../../../Server/Utils/Logger";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import { AutoRemediationDecisionLane } from "../../../Types/AutoRemediation/AutoRemediationDecision";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { KubernetesAiRemediationMode } from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../../Types/ObjectID";
import AiResourceType, {
  ALL_AI_RESOURCE_TYPES,
} from "../../../Types/ResourceAiAgent/AiResourceType";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { SpyInstance } from "jest-mock";
import fs from "fs";
import path from "path";
import ts from "typescript";

/*
 * EVERY WAY FIXES ARE TURNED ON REACHES THE ENGINE (#5303's follow-up).
 *
 * A cluster's or a resource's Fixes are turned on on its AI agent page,
 * through the API or Terraform, or by the server for its AI agent's
 * configuration (first-connection defaults, the agent's own settings). All
 * of them are updates of its row, so its service's onUpdateSuccess hands
 * the write to AutoRemediationRuleEngineService.onFixesSettingWritten,
 * which decides again about the open records OneUptime AI found them off
 * for. These hold that, as code and as behaviour:
 *
 *   - a Kubernetes cluster's service hands over a write that turns Fixes on
 *     - the operator's and the server's own - never awaited, and nothing for
 *     a heartbeat or for Fixes turned off;
 *   - every resource with an AI agent goes through the one shared hook
 *     (ResourceAiAccessSettings.afterUpdate), which hands over before it
 *     returns early for a write that is not an operator's.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const CLUSTER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

const COMMON_ROOT: string = path.resolve(__dirname, "../../..");

type Hooks = {
  onUpdateSuccess: (
    onUpdate: OnUpdate<KubernetesCluster>,
    updatedItemIds: Array<ObjectID>,
  ) => Promise<OnUpdate<KubernetesCluster>>;
};

const clusterHooks: Hooks = KubernetesClusterService as unknown as Hooks;

function onUpdate(
  data: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
  carryForward: unknown = null,
): OnUpdate<KubernetesCluster> {
  return {
    updateBy: {
      query: { _id: CLUSTER_ID.toString() },
      data,
      limit: 1,
      skip: 0,
      props,
    } as unknown as UpdateBy<KubernetesCluster>,
    carryForward,
  };
}

interface HandedOver {
  lane: AutoRemediationDecisionLane;
  written: unknown;
  updatedIds: Array<ObjectID>;
  readProjectId: (id: ObjectID) => Promise<ObjectID | null | undefined>;
}

describe("a Kubernetes cluster's Fixes turned on", () => {
  let handedOver: SpyInstance<
    typeof AutoRemediationRuleEngineService.onFixesSettingWritten
  >;
  let clusterRead: SpyInstance<typeof KubernetesClusterService.findOneById>;

  beforeEach(() => {
    handedOver = jest
      .spyOn(AutoRemediationRuleEngineService, "onFixesSettingWritten")
      .mockResolvedValue(0);
    clusterRead = jest
      .spyOn(KubernetesClusterService, "findOneById")
      .mockImplementation((async () => {
        const cluster: KubernetesCluster = new KubernetesCluster();
        cluster.projectId = PROJECT_ID;
        return cluster;
      }) as never);
    // The feeds and markers this hook also writes have their own suites.
    jest
      .spyOn(
        KubernetesClusterService as never,
        "writeKubernetesClusterUpdatedFeed" as never,
      )
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(
        KubernetesClusterService as never,
        "writeAiAccessSettingsChangedFeed" as never,
      )
      .mockResolvedValue(undefined as never);
    jest
      .spyOn(KubernetesClusterService as never, "markAiAccessConfigured" as never)
      .mockResolvedValue(undefined as never);
    jest.spyOn(logger, "error").mockImplementation((): void => {});
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function handed(): HandedOver {
    expect(handedOver).toHaveBeenCalledTimes(1);
    return handedOver.mock.calls[0]![0] as HandedOver;
  }

  test("the server's write for the agent's configuration is handed over, the cluster's project read as OneUptime", async () => {
    const data: Record<string, unknown> = {
      aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
    };

    await clusterHooks.onUpdateSuccess(onUpdate(data, { isRoot: true }), [
      CLUSTER_ID,
    ]);

    const call: HandedOver = handed();
    expect(call.lane).toBe(AutoRemediationDecisionLane.KubernetesCluster);
    expect(call.written).toBe(data);
    expect(call.updatedIds).toEqual([CLUSTER_ID]);
    expect((await call.readProjectId(CLUSTER_ID))?.toString()).toBe(
      PROJECT_ID.toString(),
    );
    expect(clusterRead.mock.calls[0]![0]).toEqual({
      id: CLUSTER_ID,
      select: { projectId: true },
      props: { isRoot: true },
    });
  });

  test("an operator's write: the project the write found the cluster in, without a second read", async () => {
    await clusterHooks.onUpdateSuccess(
      onUpdate(
        { aiRemediationMode: KubernetesAiRemediationMode.Automatic },
        { userId: ObjectID.generate(), tenantId: OTHER_PROJECT_ID },
        {
          previousAiAccessSettings: {
            [CLUSTER_ID.toString()]: {
              projectId: OTHER_PROJECT_ID,
              isAiInvestigationEnabled: true,
              aiRemediationMode: KubernetesAiRemediationMode.Disabled,
              aiKubectlCommandAllowlist: [],
              aiAccessRunnerId: null,
            },
          },
        },
      ),
      [CLUSTER_ID],
    );

    expect((await handed().readProjectId(CLUSTER_ID))?.toString()).toBe(
      OTHER_PROJECT_ID.toString(),
    );
    expect(clusterRead).not.toHaveBeenCalled();
  });

  test.each([
    [{ aiRemediationMode: KubernetesAiRemediationMode.Disabled }],
    [{ isAiInvestigationEnabled: true }],
    [{ lastSeenAt: new Date("2026-11-03T10:00:00.000Z") }],
    [{ otelCollectorStatus: "connected" }],
  ])("%j is not handed over", async (data: Record<string, unknown>) => {
    await clusterHooks.onUpdateSuccess(onUpdate(data, { isRoot: true }), [
      CLUSTER_ID,
    ]);

    expect(handedOver).not.toHaveBeenCalled();
  });

  test("the save does not wait for a fix to start", async () => {
    handedOver.mockImplementation((): Promise<number> => {
      return new Promise<number>(() => {
        // Never settles.
      });
    });

    await expect(
      clusterHooks.onUpdateSuccess(
        onUpdate(
          { aiRemediationMode: KubernetesAiRemediationMode.RequireApproval },
          { isRoot: true },
        ),
        [CLUSTER_ID],
      ),
    ).resolves.toBeDefined();
  });

  test("a hand-over that fails is logged, never thrown into the save", async () => {
    handedOver.mockRejectedValue(new Error("Valkey went away"));

    await expect(
      clusterHooks.onUpdateSuccess(
        onUpdate(
          { aiRemediationMode: KubernetesAiRemediationMode.BypassApproval },
          { isRoot: true },
        ),
        [CLUSTER_ID],
      ),
    ).resolves.toBeDefined();

    await new Promise<void>((resolve: () => void) => {
      setTimeout(resolve, 0);
    });
    expect(logger.error).toHaveBeenCalled();
  });
});

// The text of a class's method, by name.
function methodText(
  relativePath: string,
  methodName: string,
): string {
  const source: string = fs.readFileSync(
    path.join(COMMON_ROOT, relativePath),
    "utf8",
  );
  const file: ts.SourceFile = ts.createSourceFile(
    path.basename(relativePath),
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  let found: string = "";

  const visit: (node: ts.Node) => void = (node: ts.Node): void => {
    if (
      ts.isMethodDeclaration(node) &&
      node.name.getText(file) === methodName
    ) {
      found = node.getText(file);
      return;
    }

    ts.forEachChild(node, visit);
  };

  visit(file);
  return found;
}

/*
 * The service each resource with an AI agent is written through. The three
 * cloud accounts share one table.
 */
const RESOURCE_SERVICE_FILES: Record<AiResourceType, string> = {
  [AiResourceType.DockerHost]: "Server/Services/DockerHostService.ts",
  [AiResourceType.PodmanHost]: "Server/Services/PodmanHostService.ts",
  [AiResourceType.DockerSwarmCluster]:
    "Server/Services/DockerSwarmClusterService.ts",
  [AiResourceType.ProxmoxCluster]: "Server/Services/ProxmoxClusterService.ts",
  [AiResourceType.VMwareVCenter]: "Server/Services/VMwareVCenterService.ts",
  [AiResourceType.CephCluster]: "Server/Services/CephClusterService.ts",
  [AiResourceType.DatabaseServer]: "Server/Services/DatabaseServerService.ts",
  [AiResourceType.Host]: "Server/Services/HostService.ts",
  [AiResourceType.AwsAccount]: "Server/Services/CloudAccountService.ts",
  [AiResourceType.AzureSubscription]: "Server/Services/CloudAccountService.ts",
  [AiResourceType.GoogleCloudProject]: "Server/Services/CloudAccountService.ts",
};

describe("every service whose rows have Fixes hands them over", () => {
  test("the scan names a service for every resource type with an AI agent", () => {
    expect(Object.keys(RESOURCE_SERVICE_FILES).sort()).toEqual(
      [...ALL_AI_RESOURCE_TYPES].sort(),
    );
  });

  test.each(
    Array.from(new Set(Object.values(RESOURCE_SERVICE_FILES))).map(
      (file: string): [string] => {
        return [file];
      },
    ),
  )(
    "%s's onUpdateSuccess runs the shared hook, which hands Fixes over",
    (file: string) => {
      const hook: string = methodText(file, "onUpdateSuccess");

      expect(hook.length).toBeGreaterThan(0);
      expect(hook).toContain("ResourceAiAccessSettings.afterUpdate(");
    },
  );

  test("the shared hook hands over before it returns for a write that carries nothing forward - the server's own included", () => {
    const hook: string = methodText(
      "Server/Utils/AI/ResourceAccess/ResourceAiAccessSettings.ts",
      "afterUpdate",
    );
    const handOver: number = hook.indexOf(
      "AutoRemediationRuleEngineService.onFixesSettingWritten(",
    );
    const earlyReturn: number = hook.indexOf("if (!carryForward");

    expect(handOver).toBeGreaterThan(-1);
    expect(earlyReturn).toBeGreaterThan(-1);
    expect(handOver).toBeLessThan(earlyReturn);
    // Gated on the write, never awaited, its failure caught.
    expect(hook).toContain("if (doesTurnFixesOn(data.onUpdate.updateBy.data))");
    expect(hook.substring(Math.max(0, handOver - 20), handOver)).not.toContain(
      "await",
    );
    expect(hook.substring(handOver, handOver + 1500)).toContain(".catch(");
    expect(hook.substring(handOver, handOver + 300)).toContain(
      "lane: AutoRemediationDecisionLane.Resource",
    );
  });

  test("a Kubernetes cluster's service hands over itself, never awaited", () => {
    const hook: string = methodText(
      "Server/Services/KubernetesClusterService.ts",
      "onUpdateSuccess",
    );
    const handOver: number = hook.indexOf(
      "AutoRemediationRuleEngineService.onFixesSettingWritten(",
    );

    expect(handOver).toBeGreaterThan(-1);
    expect(hook).toContain("if (doesTurnFixesOn(onUpdate.updateBy.data))");
    expect(hook.substring(Math.max(0, handOver - 20), handOver)).not.toContain(
      "await",
    );
    expect(hook.substring(handOver, handOver + 1500)).toContain(".catch(");
    expect(hook.substring(handOver, handOver + 300)).toContain(
      "lane: AutoRemediationDecisionLane.KubernetesCluster",
    );
  });

  test("the server writes an agent's settings through the services' own update, so their hooks run", () => {
    for (const file of [
      "Server/Services/KubernetesAiAgentService.ts",
      "Server/Services/ResourceAiAgentService.ts",
    ]) {
      const source: string = fs.readFileSync(
        path.join(COMMON_ROOT, file),
        "utf8",
      );
      const firstConnection: string = methodText(
        file,
        "applyFirstConnectionDefaults",
      );
      const reported: string = methodText(file, "applyReportedAiSettings");

      expect(source.length).toBeGreaterThan(0);

      for (const method of [firstConnection, reported]) {
        expect(method).toContain(".updateOneBy(");
        expect(method).not.toContain("WithoutHooks");
      }
    }
  });
});
