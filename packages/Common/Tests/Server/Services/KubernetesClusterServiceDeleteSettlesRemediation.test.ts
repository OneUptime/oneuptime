import KubernetesClusterService from "../../../Server/Services/KubernetesClusterService";
import AutoRemediationSuggestionService from "../../../Server/Services/AutoRemediationSuggestionService";
import DeleteBy from "../../../Server/Types/Database/DeleteBy";
import { OnDelete } from "../../../Server/Types/Database/Hooks";
import logger from "../../../Server/Utils/Logger";
import AutoRemediationSuggestion from "../../../Models/DatabaseModels/AutoRemediationSuggestion";
import KubernetesCluster from "../../../Models/DatabaseModels/KubernetesCluster";
import AutoRemediationSuggestionStatus from "../../../Types/AutoRemediation/AutoRemediationSuggestionStatus";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import { JSONObject } from "../../../Types/JSON";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Known follow-up 10 — deleting a Kubernetes cluster settles its in-flight
 * cluster-level AI remediation rounds.
 *
 * A round the cluster's AI mode produced (Planning, or waiting in Suggested
 * for one-click approval) can never finish once its cluster is gone: its
 * kubectl names a cluster that no longer exists, and the foreign key nulls
 * its link, so nothing would ever say why it is stuck. The delete hooks:
 *
 * - read the rounds BEFORE the delete (the link is gone after it), scoped to
 *   the clusters the delete matches in the caller's project;
 * - settle them only for the clusters that were actually deleted, through
 *   the same conditional status transition a human dismissal uses, with a
 *   note that says why — and, for a round that already ran commands, that
 *   those ran and nothing was rolled back;
 * - never fail the delete over it.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const CLUSTER_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const OTHER_CLUSTER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const USER_ID: ObjectID = new ObjectID("44444444-4444-4444-8444-444444444444");
const PLANNING_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const SUGGESTED_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);

interface DeleteHooks {
  onBeforeDelete(
    deleteBy: DeleteBy<KubernetesCluster>,
  ): Promise<OnDelete<KubernetesCluster>>;
  onDeleteSuccess(
    onDelete: OnDelete<KubernetesCluster>,
    deletedItemIds: Array<ObjectID>,
  ): Promise<OnDelete<KubernetesCluster>>;
}

const hooks: DeleteHooks = KubernetesClusterService as unknown as DeleteHooks;

function userProps(): DatabaseCommonInteractionProps {
  return {
    userId: USER_ID,
    tenantId: PROJECT_ID,
  } as DatabaseCommonInteractionProps;
}

function deleteBy(
  props: DatabaseCommonInteractionProps = userProps(),
): DeleteBy<KubernetesCluster> {
  return {
    query: { _id: CLUSTER_ID.toString() },
    limit: 1,
    skip: 0,
    props,
  } as unknown as DeleteBy<KubernetesCluster>;
}

function commandPlan(executedCommands: number): JSONObject {
  const commands: Array<JSONObject> = [];

  for (let i: number = 0; i < 3; i++) {
    commands.push({
      sequence: i + 1,
      stepType: "Kubectl",
      command: `kubectl rollout restart deployment/web-${i} -n web`,
      runnerId: ObjectID.generate().toString(),
      kubernetesClusterId: CLUSTER_ID.toString(),
      kubectlTier: "SafeWrite",
      policyVerdict: "AutoApproved",
      rationale: "restart",
      ...(i < executedCommands
        ? {
            execution: {
              status: "Succeeded",
              runnerJobId: ObjectID.generate().toString(),
            },
          }
        : i === 2
          ? // A command skipped after an earlier one failed never ran.
            { execution: { status: "Skipped" } }
          : {}),
    });
  }

  return { commands, summary: "restart web" } as JSONObject;
}

function round(data: {
  id: ObjectID;
  status: AutoRemediationSuggestionStatus;
  clusterId?: ObjectID | undefined;
  rationaleMarkdown?: string | undefined;
  commandPlan?: JSONObject | undefined;
}): AutoRemediationSuggestion {
  return {
    id: data.id,
    _id: data.id.toString(),
    status: data.status,
    kubernetesClusterId: data.clusterId || CLUSTER_ID,
    rationaleMarkdown: data.rationaleMarkdown,
    commandPlan: data.commandPlan,
  } as unknown as AutoRemediationSuggestion;
}

describe("KubernetesClusterService delete settles in-flight cluster-level AI remediation", () => {
  let clusterFind: jest.SpyInstance;
  let suggestionFind: jest.SpyInstance;
  let transition: jest.SpyInstance;

  beforeEach(() => {
    jest.spyOn(logger, "error").mockImplementation((): void => {
      return undefined;
    });
    clusterFind = jest
      .spyOn(KubernetesClusterService, "findBy")
      .mockResolvedValue([
        {
          id: CLUSTER_ID,
          name: "prod-us",
          clusterIdentifier: "prod-us",
        } as unknown as KubernetesCluster,
      ]);
    suggestionFind = jest
      .spyOn(AutoRemediationSuggestionService, "findBy")
      .mockResolvedValue([
        round({
          id: PLANNING_ID,
          status: AutoRemediationSuggestionStatus.Planning,
        }),
        round({
          id: SUGGESTED_ID,
          status: AutoRemediationSuggestionStatus.Suggested,
          rationaleMarkdown: "The web pods crash-loop; restart them.",
          commandPlan: commandPlan(0),
        }),
      ]);
    transition = jest
      .spyOn(AutoRemediationSuggestionService, "attemptStatusTransition")
      .mockResolvedValue(1);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  async function deleteCluster(
    deletedItemIds: Array<ObjectID> = [CLUSTER_ID],
    props: DatabaseCommonInteractionProps = userProps(),
  ): Promise<void> {
    const onDelete: OnDelete<KubernetesCluster> = await hooks.onBeforeDelete(
      deleteBy(props),
    );
    await hooks.onDeleteSuccess(onDelete, deletedItemIds);
  }

  function transitions(): Array<{
    suggestionId: ObjectID;
    fromStatus: AutoRemediationSuggestionStatus;
    set: Record<string, unknown>;
  }> {
    return transition.mock.calls.map((call: Array<unknown>) => {
      return call[0] as {
        suggestionId: ObjectID;
        fromStatus: AutoRemediationSuggestionStatus;
        set: Record<string, unknown>;
      };
    });
  }

  it("reads the rounds before the delete, for the matched clusters in the caller's project", async () => {
    await hooks.onBeforeDelete(deleteBy());

    const clusterQuery: Record<string, unknown> = (
      clusterFind.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;
    expect(clusterQuery["_id"]).toBe(CLUSTER_ID.toString());
    expect(clusterQuery["projectId"]).toBe(PROJECT_ID);

    const suggestionQuery: Record<string, unknown> = (
      suggestionFind.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;
    expect(JSON.stringify(suggestionQuery["kubernetesClusterId"])).toContain(
      CLUSTER_ID.toString(),
    );
    expect(JSON.stringify(suggestionQuery["status"])).toContain("Planning");
    expect(JSON.stringify(suggestionQuery["status"])).toContain("Suggested");

    // Nothing is settled before the delete has happened.
    expect(transition).not.toHaveBeenCalled();
  });

  it("dismisses Planning and Suggested rounds with a note that says the cluster was deleted", async () => {
    await deleteCluster();

    expect(transitions()).toHaveLength(2);

    const [planning, suggested] = transitions();

    expect(planning!.suggestionId).toBe(PLANNING_ID);
    expect(planning!.fromStatus).toBe(AutoRemediationSuggestionStatus.Planning);
    expect(planning!.set["status"]).toBe(
      AutoRemediationSuggestionStatus.Dismissed,
    );
    expect(planning!.set["dismissedByUserId"]).toBe(USER_ID.toString());
    expect(planning!.set["dismissedAt"]).toBeInstanceOf(Date);
    expect(String(planning!.set["rationaleMarkdown"])).toContain(
      'the Kubernetes cluster "prod-us" this remediation was for was deleted',
    );
    expect(String(planning!.set["rationaleMarkdown"])).toContain(
      "None of its kubectl commands ran",
    );

    expect(suggested!.fromStatus).toBe(
      AutoRemediationSuggestionStatus.Suggested,
    );
    // The AI's own reasoning is kept, after the note.
    expect(String(suggested!.set["rationaleMarkdown"])).toMatch(
      /was deleted[\s\S]*The web pods crash-loop; restart them\./,
    );
  });

  it("says so when the round had already run commands, and that nothing was rolled back", async () => {
    suggestionFind.mockResolvedValue([
      round({
        id: PLANNING_ID,
        status: AutoRemediationSuggestionStatus.Planning,
        commandPlan: commandPlan(1),
      }),
    ]);

    await deleteCluster();

    const note: string = String(transitions()[0]!.set["rationaleMarkdown"]);
    expect(note).toContain("1 command(s) had already run");
    expect(note).toContain("nothing was rolled back");
    expect(note).not.toContain("None of its kubectl commands ran");
  });

  it("settles only the rounds of clusters that were actually deleted", async () => {
    clusterFind.mockResolvedValue([
      { id: CLUSTER_ID, name: "prod-us" } as unknown as KubernetesCluster,
      {
        id: OTHER_CLUSTER_ID,
        name: "prod-eu",
      } as unknown as KubernetesCluster,
    ]);
    suggestionFind.mockResolvedValue([
      round({
        id: PLANNING_ID,
        status: AutoRemediationSuggestionStatus.Planning,
        clusterId: OTHER_CLUSTER_ID,
      }),
      round({
        id: SUGGESTED_ID,
        status: AutoRemediationSuggestionStatus.Suggested,
      }),
    ]);

    // Only CLUSTER_ID was deleted (the other was refused by permissions).
    await deleteCluster([CLUSTER_ID]);

    expect(
      transitions().map((call: { suggestionId: ObjectID }) => {
        return call.suggestionId.toString();
      }),
    ).toEqual([SUGGESTED_ID.toString()]);
  });

  it("negative control: a delete that removed nothing settles nothing", async () => {
    await deleteCluster([]);

    expect(transition).not.toHaveBeenCalled();
  });

  it("negative control: a cluster with no in-flight round reads no plan and settles nothing", async () => {
    suggestionFind.mockResolvedValue([]);

    await deleteCluster();

    expect(transition).not.toHaveBeenCalled();
  });

  it("never fails the delete: a failed read or a failed settle is only logged", async () => {
    suggestionFind.mockRejectedValue(new Error("db down"));
    await expect(deleteCluster()).resolves.toBeUndefined();

    suggestionFind.mockResolvedValue([
      round({
        id: PLANNING_ID,
        status: AutoRemediationSuggestionStatus.Planning,
      }),
    ]);
    transition.mockRejectedValue(new Error("db down"));
    await expect(deleteCluster()).resolves.toBeUndefined();
  });

  it("a root delete (no user) settles without naming anyone", async () => {
    await deleteCluster([CLUSTER_ID], {
      isRoot: true,
    } as DatabaseCommonInteractionProps);

    expect(transitions()[0]!.set).not.toHaveProperty("dismissedByUserId");
    expect(transitions()[0]!.set["status"]).toBe(
      AutoRemediationSuggestionStatus.Dismissed,
    );
  });
});
