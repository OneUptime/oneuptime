import AIRunService from "../../../Server/Services/AIRunService";
import AIRun from "../../../Models/DatabaseModels/AIRun";
import AIRunStatus from "../../../Types/AI/AIRunStatus";
import AIRunType from "../../../Types/AI/AIRunType";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test — code-fix claim tenancy.
 *
 * The OneUptime Runner is installed by customers with a PROJECT-SCOPED
 * credential, so its claim must be filtered to that project: without the
 * filter a Runner would claim the oldest queued code-fix run in the whole
 * deployment and work in another tenant's repository. The in-cluster Runner
 * registers with a cluster key and carries no projectId — it keeps serving
 * every project, which is why the filter is conditional rather than
 * mandatory.
 */

const AGENT_ID: ObjectID = new ObjectID("11111111-1111-4111-8111-111111111111");
const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const RUN_ID: ObjectID = new ObjectID("33333333-3333-4333-8333-333333333333");

function mockNoCandidates(): jest.SpyInstance {
  return jest.spyOn(AIRunService, "findOneBy").mockResolvedValue(null);
}

describe("AIRunService.claimNextQueuedCodeFixRun — tenancy scoping", () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it("scopes the candidate query to the agent's project when it has one", async () => {
    const findOneBy: jest.SpyInstance = mockNoCandidates();

    await AIRunService.claimNextQueuedCodeFixRun({
      aiAgentId: AGENT_ID,
      projectId: PROJECT_ID,
    });

    expect(findOneBy).toHaveBeenCalledWith(
      expect.objectContaining({
        query: expect.objectContaining({
          runType: AIRunType.CodeFix,
          status: AIRunStatus.Queued,
          projectId: PROJECT_ID,
        }),
      }),
    );
  });

  it("leaves the query unscoped for a cluster-scoped agent (no projectId)", async () => {
    const findOneBy: jest.SpyInstance = mockNoCandidates();

    await AIRunService.claimNextQueuedCodeFixRun({
      aiAgentId: AGENT_ID,
    });

    const query: Record<string, unknown> = (
      findOneBy.mock.calls[0]![0] as { query: Record<string, unknown> }
    ).query;

    expect(query["runType"]).toBe(AIRunType.CodeFix);
    expect(query["status"]).toBe(AIRunStatus.Queued);
    expect(query["projectId"]).toBeUndefined();
  });

  it("still claims a matching run in the agent's own project", async () => {
    jest.spyOn(AIRunService, "findOneBy").mockResolvedValue({
      id: RUN_ID,
      _id: RUN_ID.toString(),
      projectId: PROJECT_ID,
      attemptCount: 0,
      triggeredByTelemetryExceptionId: new ObjectID(
        "44444444-4444-4444-8444-444444444444",
      ),
    } as unknown as AIRun);
    const claim: jest.SpyInstance = jest
      .spyOn(AIRunService, "attemptStatusTransition")
      .mockResolvedValue(1 as never);

    await AIRunService.claimNextQueuedCodeFixRun({
      aiAgentId: AGENT_ID,
      projectId: PROJECT_ID,
    });

    expect(claim).toHaveBeenCalledWith(
      expect.objectContaining({
        aiRunId: RUN_ID,
        fromStatus: AIRunStatus.Queued,
        set: expect.objectContaining({
          status: AIRunStatus.Running,
          aiAgentId: AGENT_ID.toString(),
        }),
      }),
    );
  });
});
