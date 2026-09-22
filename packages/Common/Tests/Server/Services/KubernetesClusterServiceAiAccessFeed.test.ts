import KubernetesClusterService from "../../../Server/Services/KubernetesClusterService";
import KubernetesClusterFeedService from "../../../Server/Services/KubernetesClusterFeedService";
import RunbookCredentialService from "../../../Server/Services/RunbookCredentialService";
import RunnerService from "../../../Server/Services/RunnerService";
import UserService from "../../../Server/Services/UserService";
import { OnUpdate } from "../../../Server/Types/Database/Hooks";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import { KubernetesClusterFeedEventType } from "../../../Models/DatabaseModels/KubernetesClusterFeed";
import RunbookCredential from "../../../Models/DatabaseModels/RunbookCredential";
import Runner from "../../../Models/DatabaseModels/Runner";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { Gray500, Yellow500 } from "../../../Types/BrandColors";
import Color from "../../../Types/Color";
import { KubernetesAiRemediationMode } from "../../../Types/Kubernetes/KubernetesClusterAiAccess";
import ObjectID from "../../../Types/ObjectID";
import Permission, {
  UserTenantAccessPermission,
} from "../../../Types/Permission";
import RunbookCredentialType from "../../../Types/Runbook/RunbookCredentialType";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Who changed what OneUptime AI may do on a Kubernetes cluster.
 *
 * The cluster's generic "was updated" feed item only covers
 * MEANINGFUL_UPDATE_COLUMNS (name, description, labels, archive, retention),
 * so switching a production cluster to Bypass approval, widening its kubectl
 * allowlist or rebinding its Runner left no trace at all — while the
 * in-cluster Runner's registration recorded every bind it made. Every
 * operator change to the AI access settings now posts one feed item naming
 * who changed what (old -> new), written only after the update succeeded;
 * the server's own writes (registration, command bookkeeping, heartbeats)
 * post none of these.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const CLUSTER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const RUNNER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const CREDENTIAL_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const USER_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");

const USER_MARKDOWN: string = "[Jane Operator](https://oneuptime.example/u)";
const CLUSTER_LINK: string = "[Kubernetes Cluster prod-us](https://x/k8s)";

type Hooks = {
  onBeforeUpdate: (
    updateBy: UpdateBy<KubernetesCluster>,
  ) => Promise<OnUpdate<KubernetesCluster>>;
  onUpdateSuccess: (
    onUpdate: OnUpdate<KubernetesCluster>,
    updatedItemIds: Array<ObjectID>,
  ) => Promise<OnUpdate<KubernetesCluster>>;
  writeAiAccessSettingsChangedFeed: () => Promise<void>;
  writeKubernetesClusterUpdatedFeed: () => Promise<void>;
};

const service: Hooks = KubernetesClusterService as unknown as Hooks;

interface FeedItem {
  kubernetesClusterId: ObjectID;
  projectId: ObjectID;
  kubernetesClusterFeedEventType: KubernetesClusterFeedEventType;
  displayColor?: Color;
  feedInfoInMarkdown: string;
  moreInformationInMarkdown?: string;
  userId?: ObjectID;
}

function adminProps(
  overrides: Partial<DatabaseCommonInteractionProps> = {},
): DatabaseCommonInteractionProps {
  const tenantPermission: UserTenantAccessPermission = {
    _type: "UserTenantAccessPermission",
    projectId: PROJECT_ID,
    permissions: [
      {
        _type: "UserPermission",
        permission: Permission.ProjectAdmin,
        labelIds: [],
        isBlockPermission: false,
      },
    ],
  };

  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
    userTenantAccessPermission: {
      [PROJECT_ID.toString()]: tenantPermission,
    },
    ...overrides,
  } as DatabaseCommonInteractionProps;
}

function updateBy(
  data: Record<string, unknown>,
  props: DatabaseCommonInteractionProps,
): UpdateBy<KubernetesCluster> {
  return {
    query: { _id: CLUSTER_ID.toString() },
    data,
    limit: 1,
    skip: 0,
    props,
  } as unknown as UpdateBy<KubernetesCluster>;
}

describe("KubernetesClusterService AI access feed", () => {
  let feedItems: jest.SpyInstance;
  let aiFeedWriter: jest.SpyInstance;
  let genericFeedWriter: jest.SpyInstance;
  let clusterSettings: jest.SpyInstance;

  beforeEach(() => {
    clusterSettings = jest
      .spyOn(KubernetesClusterService, "findBy")
      .mockResolvedValue([
        {
          id: CLUSTER_ID,
          projectId: PROJECT_ID,
          isAiInvestigationEnabled: true,
          aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
          aiKubectlCommandAllowlist: null,
          aiAccessRunnerId: null,
          aiAccessCredentialId: null,
        } as unknown as KubernetesCluster,
      ]);
    jest.spyOn(KubernetesClusterService, "findOneById").mockResolvedValue({
      projectId: PROJECT_ID,
    } as unknown as KubernetesCluster);
    jest
      .spyOn(KubernetesClusterService, "getKubernetesClusterMarkdownLink")
      .mockResolvedValue(CLUSTER_LINK);
    // The configured marker is covered by the binding guard tests.
    jest.spyOn(KubernetesClusterService, "updateBy").mockResolvedValue(1);
    jest
      .spyOn(UserService, "getUserMarkdownString")
      .mockResolvedValue(USER_MARKDOWN);
    jest
      .spyOn(RunnerService, "findOneBy")
      .mockResolvedValue({ id: RUNNER_ID } as unknown as Runner);
    jest.spyOn(RunnerService, "findOneById").mockResolvedValue({
      id: RUNNER_ID,
      name: "kubernetes-agent/prod-us",
    } as unknown as Runner);
    jest.spyOn(RunbookCredentialService, "findOneBy").mockResolvedValue({
      id: CREDENTIAL_ID,
      credentialType: RunbookCredentialType.Kubernetes,
    } as unknown as RunbookCredential);
    jest.spyOn(RunbookCredentialService, "findOneById").mockResolvedValue({
      id: CREDENTIAL_ID,
      name: "prod-us cluster-admin token",
    } as unknown as RunbookCredential);

    feedItems = jest
      .spyOn(KubernetesClusterFeedService, "createKubernetesClusterFeedItem")
      .mockResolvedValue(undefined);

    // Called through, so each test can await the fire-and-forget promise.
    aiFeedWriter = jest.spyOn(service, "writeAiAccessSettingsChangedFeed");
    genericFeedWriter = jest.spyOn(
      service,
      "writeKubernetesClusterUpdatedFeed",
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  /*
   * The whole update as the framework runs it: onBeforeUpdate (which reads
   * the settings before the write), then onUpdateSuccess with the rows the
   * write touched. Waits for the fire-and-forget feed writes to finish.
   */
  async function runUpdate(
    data: Record<string, unknown>,
    props: DatabaseCommonInteractionProps = adminProps(),
    updatedItemIds: Array<ObjectID> = [CLUSTER_ID],
  ): Promise<Array<FeedItem>> {
    const onUpdate: OnUpdate<KubernetesCluster> = await service.onBeforeUpdate(
      updateBy(data, props),
    );
    await service.onUpdateSuccess(onUpdate, updatedItemIds);

    for (const result of [
      ...aiFeedWriter.mock.results,
      ...genericFeedWriter.mock.results,
    ]) {
      await result.value;
    }

    return feedItems.mock.calls.map((call: Array<unknown>) => {
      return call[0] as FeedItem;
    });
  }

  function onlyItem(items: Array<FeedItem>): FeedItem {
    expect(items).toHaveLength(1);
    return items[0]!;
  }

  it("records a switch to Bypass approval, naming who did it, the old and new mode, in warning colour", async () => {
    const item: FeedItem = onlyItem(
      await runUpdate({
        aiRemediationMode: KubernetesAiRemediationMode.BypassApproval,
      }),
    );

    expect(item.kubernetesClusterId).toBe(CLUSTER_ID);
    expect(item.projectId).toBe(PROJECT_ID);
    expect(item.kubernetesClusterFeedEventType).toBe(
      KubernetesClusterFeedEventType.KubernetesClusterUpdated,
    );
    expect(item.userId).toBe(USER_ID);
    expect(item.displayColor).toBe(Yellow500);
    expect(item.feedInfoInMarkdown).toContain(`**${USER_MARKDOWN}**`);
    expect(item.feedInfoInMarkdown).toContain(CLUSTER_LINK);
    expect(item.feedInfoInMarkdown).toContain(
      "AI remediation changed from **Ask for approval** to **Bypass approval**",
    );
    expect(item.moreInformationInMarkdown).toContain(
      `**Changed by**: ${USER_MARKDOWN}`,
    );
  });

  it("records turning remediation back to Ask for approval in the neutral colour", async () => {
    clusterSettings.mockResolvedValue([
      {
        id: CLUSTER_ID,
        projectId: PROJECT_ID,
        aiRemediationMode: KubernetesAiRemediationMode.BypassApproval,
      } as unknown as KubernetesCluster,
    ]);

    const item: FeedItem = onlyItem(
      await runUpdate({
        aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
      }),
    );

    expect(item.displayColor).toBe(Gray500);
    expect(item.feedInfoInMarkdown).toContain(
      "AI remediation changed from **Bypass approval** to **Ask for approval**",
    );
  });

  it("records turning AI investigation off", async () => {
    const item: FeedItem = onlyItem(
      await runUpdate({ isAiInvestigationEnabled: false }),
    );

    expect(item.feedInfoInMarkdown).toContain(
      "AI investigation with kubectl turned **off**",
    );
    expect(item.displayColor).toBe(Gray500);
  });

  it("names the Runner bound through the relation the dashboard posts", async () => {
    const item: FeedItem = onlyItem(
      await runUpdate({ aiAccessRunner: { _id: RUNNER_ID.toString() } }),
    );

    expect(item.feedInfoInMarkdown).toContain(
      "Runner **kubernetes-agent/prod-us** bound to run kubectl",
    );
    expect(item.displayColor).toBe(Yellow500);
  });

  it("records clearing the Runner", async () => {
    clusterSettings.mockResolvedValue([
      {
        id: CLUSTER_ID,
        projectId: PROJECT_ID,
        aiAccessRunnerId: RUNNER_ID,
      } as unknown as KubernetesCluster,
    ]);

    const item: FeedItem = onlyItem(
      await runUpdate({ aiAccessRunnerId: null }),
    );

    expect(item.feedInfoInMarkdown).toContain("Runner cleared");
    expect(item.displayColor).toBe(Gray500);
  });

  /*
   * The feed is readable by everyone who may read the cluster; credentials
   * only by those who may read credentials. So a credential is reported as
   * bound, never by name.
   */
  it("records a credential being bound without naming it", async () => {
    const item: FeedItem = onlyItem(
      await runUpdate({ aiAccessCredentialId: CREDENTIAL_ID }),
    );

    expect(item.feedInfoInMarkdown).toContain("Kubernetes credential bound");
    expect(item.feedInfoInMarkdown).not.toContain("cluster-admin token");
    expect(item.moreInformationInMarkdown || "").not.toContain(
      "cluster-admin token",
    );
  });

  it("lists the allowlist patterns now in effect", async () => {
    const item: FeedItem = onlyItem(
      await runUpdate({
        aiKubectlCommandAllowlist: [
          "kubectl set image deployment/web * -n web",
        ],
      }),
    );

    expect(item.feedInfoInMarkdown).toContain(
      "kubectl allowlist changed to 1 pattern (was none)",
    );
    expect(item.moreInformationInMarkdown).toContain(
      "`kubectl set image deployment/web * -n web`",
    );
    expect(item.displayColor).toBe(Yellow500);
  });

  it("puts several changes in one item", async () => {
    const item: FeedItem = onlyItem(
      await runUpdate({
        isAiInvestigationEnabled: false,
        aiRemediationMode: KubernetesAiRemediationMode.Disabled,
      }),
    );

    expect(item.feedInfoInMarkdown).toContain("turned **off**");
    expect(item.feedInfoInMarkdown).toContain(
      "from **Ask for approval** to **Off**",
    );
  });

  /*
   * API keys and Terraform carry a tenant but no user; the change must
   * still be recorded, attributed to an API key.
   */
  it("attributes a change made with an API key", async () => {
    const item: FeedItem = onlyItem(
      await runUpdate(
        { aiRemediationMode: KubernetesAiRemediationMode.Disabled },
        adminProps({ userId: undefined }),
      ),
    );

    expect(item.userId).toBeUndefined();
    expect(item.feedInfoInMarkdown).toMatch(/^🤖 An API key changed/);
    expect(item.moreInformationInMarkdown).toContain("An API key (no user)");
  });

  it("records nothing when the form re-posts values that did not change", async () => {
    clusterSettings.mockResolvedValue([
      {
        id: CLUSTER_ID,
        projectId: PROJECT_ID,
        isAiInvestigationEnabled: true,
        aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
        aiKubectlCommandAllowlist: ["kubectl scale *"],
        aiAccessRunnerId: RUNNER_ID,
        aiAccessCredentialId: null,
      } as unknown as KubernetesCluster,
    ]);

    expect(
      await runUpdate({
        isAiInvestigationEnabled: true,
        aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
        aiKubectlCommandAllowlist: ["kubectl scale *"],
        aiAccessRunner: { _id: RUNNER_ID.toString() },
        aiAccessCredential: null,
      }),
    ).toHaveLength(0);
  });

  it("records nothing when the update matched no row", async () => {
    expect(
      await runUpdate(
        { aiRemediationMode: KubernetesAiRemediationMode.BypassApproval },
        adminProps(),
        [],
      ),
    ).toHaveLength(0);
  });

  it("records nothing when the update is refused", async () => {
    const settingsMember: DatabaseCommonInteractionProps = adminProps();
    settingsMember.userTenantAccessPermission![
      PROJECT_ID.toString()
    ]!.permissions[0]!.permission = Permission.SettingsMember;

    await expect(
      runUpdate(
        { aiRemediationMode: KubernetesAiRemediationMode.BypassApproval },
        settingsMember,
      ),
    ).rejects.toThrow();

    expect(feedItems).not.toHaveBeenCalled();
  });

  it("does not fail the update when the feed write fails", async () => {
    feedItems.mockRejectedValue(new Error("feed down"));

    const onUpdate: OnUpdate<KubernetesCluster> = await service.onBeforeUpdate(
      updateBy(
        { aiRemediationMode: KubernetesAiRemediationMode.Disabled },
        adminProps(),
      ),
    );

    await expect(service.onUpdateSuccess(onUpdate, [CLUSTER_ID])).resolves.toBe(
      onUpdate,
    );
  });

  describe("server writes post no AI access item", () => {
    it("the in-cluster Runner's registration (root) records its own bind, not this one", async () => {
      expect(
        await runUpdate(
          {
            aiAccessRunnerId: RUNNER_ID,
            aiAccessCredentialId: null,
            isAiInvestigationEnabled: true,
            aiRemediationMode: KubernetesAiRemediationMode.RequireApproval,
          },
          { isRoot: true },
        ),
      ).toHaveLength(0);
    });

    it.each([
      [{ aiAccessLastVerifiedAt: new Date(), aiAccessLastError: null }],
      [{ aiAccessLastError: "forbidden" }],
      [{ lastSeenAt: new Date(), otelCollectorStatus: "connected" }],
      [{ nodeCount: 3 }],
    ])("a root write of %p posts nothing at all", async (data: object) => {
      expect(
        await runUpdate(data as Record<string, unknown>, { isRoot: true }),
      ).toHaveLength(0);
    });
  });

  it("a rename by a user posts only the generic updated item", async () => {
    const item: FeedItem = onlyItem(await runUpdate({ name: "prod-us-east" }));

    expect(item.feedInfoInMarkdown).toContain("was updated");
    expect(item.feedInfoInMarkdown).not.toContain("OneUptime AI");
  });
});
