import AutoRemediationRuleService, {
  Service as AutoRemediationRuleServiceClass,
} from "../../../Server/Services/AutoRemediationRuleService";
import RunnerService from "../../../Server/Services/RunnerService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import AutoRemediationRule from "../../../Models/DatabaseModels/AutoRemediationRule";
import Runner from "../../../Models/DatabaseModels/Runner";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";

/*
 * Contract under test — an auto-remediation rule's Command Runners (the
 * hosts its AI-composed Bash/SSH commands may target) never include a
 * kubernetes-agent Runner, on the API path as well as on the dashboard,
 * which does not offer them:
 *
 * - creating a rule with one is refused, whatever shape the Runner list
 *   arrives in, with a message that names the Runner and says what to do;
 * - writing the list later is refused when it ADDS one to a rule;
 * - a rule that already holds one (saved before this guard) may re-post it:
 *   the rule form re-posts every field, and dropping it silently would
 *   widen a rule narrowed to it to "any Runner";
 * - ordinary Runners, including one that lives in a pod, are unaffected,
 *   and a write that does not touch the list reads nothing.
 *
 * "Agent" is RunnerService's one rule (isKubernetesAgentRunnerRow): the
 * server-owned name marker (case-insensitively) or an agent posture.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const RULE_ID: ObjectID = new ObjectID("77777777-7777-4777-8777-777777777777");
const OTHER_RULE_ID: ObjectID = new ObjectID(
  "88888888-8888-4888-8888-888888888888",
);
const HOST_RUNNER_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const POD_RUNNER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const AGENT_RUNNER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const RENAMED_AGENT_RUNNER_ID: ObjectID = new ObjectID(
  "55555555-5555-4555-8555-555555555555",
);
const CASE_VARIANT_AGENT_RUNNER_ID: ObjectID = new ObjectID(
  "66666666-6666-4666-8666-666666666666",
);

function runnerRow(
  id: ObjectID,
  name: string,
  hostInfo: Record<string, unknown>,
): Runner {
  return {
    id,
    _id: id.toString(),
    name,
    hostInfo,
  } as unknown as Runner;
}

const RUNNERS: Array<Runner> = [
  runnerRow(HOST_RUNNER_ID, "office-runner", {}),
  // An ordinary Runner that lives in a pod but names no cluster.
  runnerRow(POD_RUNNER_ID, "pod-runner", {
    kubernetes: { inCluster: true },
  }),
  runnerRow(AGENT_RUNNER_ID, "kubernetes-agent/prod-us", {}),
  // Renamed by root before the rename guard: the posture still says agent.
  runnerRow(RENAMED_AGENT_RUNNER_ID, "prod in-cluster runner", {
    kubernetes: { inCluster: true, clusterIdentifier: "prod-us" },
  }),
  runnerRow(CASE_VARIANT_AGENT_RUNNER_ID, "Kubernetes-Agent/staging", {}),
];

/*
 * The hooks are protected, as every DatabaseService hook is. Reached
 * through a narrow interface so a change to their shape breaks this file.
 */
interface RuleHookAccess {
  onBeforeCreate(
    createBy: CreateBy<AutoRemediationRule>,
  ): Promise<OnCreate<AutoRemediationRule>>;
  onBeforeUpdate(
    updateBy: UpdateBy<AutoRemediationRule>,
  ): Promise<OnUpdate<AutoRemediationRule>>;
}

const hooks: RuleHookAccess =
  AutoRemediationRuleService as unknown as RuleHookAccess;

function rule(commandRunners: unknown): AutoRemediationRule {
  const model: AutoRemediationRule = new AutoRemediationRule();
  model.name = "restart web on high latency";
  model.projectId = PROJECT_ID;
  (model as unknown as Record<string, unknown>)["commandRunners"] =
    commandRunners;
  return model;
}

// A stored rule as the held-Runner read returns it.
function storedRule(id: ObjectID, heldRunnerIds: Array<ObjectID>): unknown {
  return {
    id,
    _id: id.toString(),
    commandRunners: heldRunnerIds.map((runnerId: ObjectID) => {
      return runnerRow(runnerId, "held", {});
    }),
  };
}

async function create(commandRunners: unknown): Promise<unknown> {
  try {
    await hooks.onBeforeCreate({
      data: rule(commandRunners),
      props: { tenantId: PROJECT_ID },
    } as unknown as CreateBy<AutoRemediationRule>);
    return null;
  } catch (error) {
    return error;
  }
}

async function update(data: {
  commandRunners?: unknown;
  otherFields?: Record<string, unknown> | undefined;
  query?: Record<string, unknown> | undefined;
  // Null: a write with no tenant (a root write). Absent: the project.
  tenantId?: ObjectID | null | undefined;
}): Promise<unknown> {
  const payload: Record<string, unknown> = { ...(data.otherFields || {}) };

  if (data.commandRunners !== undefined) {
    payload["commandRunners"] = data.commandRunners;
  }

  try {
    await hooks.onBeforeUpdate({
      query: data.query || { _id: RULE_ID.toString() },
      data: payload,
      props: {
        tenantId:
          data.tenantId === undefined ? PROJECT_ID : data.tenantId || undefined,
      },
    } as unknown as UpdateBy<AutoRemediationRule>);
    return null;
  } catch (error) {
    return error;
  }
}

describe("AutoRemediationRule Command Runners never include a kubernetes-agent Runner", () => {
  let runnerFind: jest.SpyInstance;
  let ruleFind: jest.SpyInstance;
  let storedRules: Array<unknown>;

  beforeEach(() => {
    storedRules = [storedRule(RULE_ID, [])];

    // Answered from the ids actually asked for, as Postgres would.
    runnerFind = jest
      .spyOn(RunnerService, "findBy")
      .mockImplementation(async (args: unknown): Promise<Array<Runner>> => {
        const idFilter: {
          objectLiteralParameters?: Record<string, unknown>;
        } = (args as { query: Record<string, unknown> }).query["_id"] as {
          objectLiteralParameters?: Record<string, unknown>;
        };
        const ids: Array<string> = Object.values(
          idFilter.objectLiteralParameters || {},
        )[0] as Array<string>;

        return RUNNERS.filter((runner: Runner) => {
          return ids.includes(runner.id!.toString());
        });
      });

    ruleFind = jest
      .spyOn(AutoRemediationRuleService, "findBy")
      .mockImplementation(async (): Promise<Array<AutoRemediationRule>> => {
        return storedRules as Array<AutoRemediationRule>;
      });
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe("on create", () => {
    it("refuses a rule whose Command Runners include the agent Runner, and says what to do", async () => {
      const thrown: unknown = await create([
        RUNNERS[0],
        runnerRow(AGENT_RUNNER_ID, "kubernetes-agent/prod-us", {}),
      ]);

      expect(thrown).toBeInstanceOf(BadDataException);
      const message: string = (thrown as Error).message;
      expect(message).toContain('Runner "kubernetes-agent/prod-us"');
      expect(message).toContain("Command Runners");
      expect(message).toContain("Bash or SSH");
      expect(message).toContain("the cluster's AI page");
      expect(message).toContain("Project Settings → Runners");
      expect(message).toBe(
        AutoRemediationRuleServiceClass.getAgentCommandRunnerRefusal(
          RUNNERS[2]!,
        ),
      );
    });

    it("reads the list in every shape a write can carry it", async () => {
      for (const runners of [
        [{ _id: AGENT_RUNNER_ID.toString() }],
        [AGENT_RUNNER_ID],
        [AGENT_RUNNER_ID.toString()],
        [{ id: AGENT_RUNNER_ID.toString() }],
      ]) {
        expect(await create(runners)).toBeInstanceOf(BadDataException);
      }
    });

    it("refuses an agent row recognised by its posture only, or by a case variant of the marker", async () => {
      expect(
        String(await create([RENAMED_AGENT_RUNNER_ID.toString()])),
      ).toContain('Runner "prod in-cluster runner"');
      expect(
        String(await create([CASE_VARIANT_AGENT_RUNNER_ID.toString()])),
      ).toContain('Runner "Kubernetes-Agent/staging"');
    });

    it("checks the Runners as root, whichever project they are in (fails closed)", async () => {
      await create([AGENT_RUNNER_ID.toString()]);

      const args: {
        query: Record<string, unknown>;
        props: { isRoot?: boolean };
      } = runnerFind.mock.calls[0]![0] as {
        query: Record<string, unknown>;
        props: { isRoot?: boolean };
      };
      expect(args.props.isRoot).toBe(true);
      expect(args.query["projectId"]).toBeUndefined();
    });

    it("negative control: ordinary Runners, one in a pod included, are accepted", async () => {
      expect(
        await create([HOST_RUNNER_ID.toString(), POD_RUNNER_ID.toString()]),
      ).toBeNull();
      expect(ruleFind).not.toHaveBeenCalled();
    });

    it("negative control: a rule with no Command Runners (any Runner) reads nothing", async () => {
      expect(await create(undefined)).toBeNull();
      expect(await create([])).toBeNull();
      expect(await create(null)).toBeNull();
      expect(runnerFind).not.toHaveBeenCalled();
    });
  });

  describe("on update", () => {
    it("refuses adding the agent Runner to a rule that does not hold it", async () => {
      const thrown: unknown = await update({
        commandRunners: [
          { _id: HOST_RUNNER_ID.toString() },
          { _id: AGENT_RUNNER_ID.toString() },
        ],
      });

      expect(thrown).toBeInstanceOf(BadDataException);
      expect((thrown as Error).message).toContain(
        'Runner "kubernetes-agent/prod-us"',
      );
    });

    it("lets a rule re-post an agent Runner it already holds (the form re-posts every field)", async () => {
      storedRules = [storedRule(RULE_ID, [AGENT_RUNNER_ID, HOST_RUNNER_ID])];

      expect(
        await update({
          commandRunners: [
            { _id: AGENT_RUNNER_ID.toString() },
            { _id: HOST_RUNNER_ID.toString() },
          ],
          otherFields: { name: "renamed rule" },
        }),
      ).toBeNull();
    });

    it("still refuses a second agent Runner next to one the rule holds", async () => {
      storedRules = [storedRule(RULE_ID, [AGENT_RUNNER_ID])];

      const thrown: unknown = await update({
        commandRunners: [
          AGENT_RUNNER_ID.toString(),
          RENAMED_AGENT_RUNNER_ID.toString(),
        ],
      });

      expect(thrown).toBeInstanceOf(BadDataException);
      expect((thrown as Error).message).toContain(
        'Runner "prod in-cluster runner"',
      );
    });

    it("refuses when any rule the write reaches does not hold it", async () => {
      storedRules = [
        storedRule(RULE_ID, [AGENT_RUNNER_ID]),
        storedRule(OTHER_RULE_ID, [HOST_RUNNER_ID]),
      ];

      expect(
        await update({
          commandRunners: [AGENT_RUNNER_ID.toString()],
          query: { name: "restart web on high latency" },
        }),
      ).toBeInstanceOf(BadDataException);
    });

    it("reads the rules being written, scoped to the caller's project, with the Runners they hold", async () => {
      await update({ commandRunners: [AGENT_RUNNER_ID.toString()] });

      expect(ruleFind).toHaveBeenCalledTimes(1);
      const args: {
        query: Record<string, unknown>;
        select: Record<string, unknown>;
        props: { isRoot?: boolean };
      } = ruleFind.mock.calls[0]![0] as {
        query: Record<string, unknown>;
        select: Record<string, unknown>;
        props: { isRoot?: boolean };
      };
      expect(args.query["_id"]).toBe(RULE_ID.toString());
      expect(args.query["projectId"]).toBe(PROJECT_ID);
      expect(args.select["commandRunners"]).toEqual({ _id: true });
      expect(args.props.isRoot).toBe(true);
    });

    it("a write with no tenant reads the rules by the query alone", async () => {
      await update({
        commandRunners: [AGENT_RUNNER_ID.toString()],
        tenantId: null,
      });

      const query: Record<string, unknown> = (
        ruleFind.mock.calls[0]![0] as { query: Record<string, unknown> }
      ).query;
      expect(query).not.toHaveProperty("projectId");
    });

    it("negative control: ordinary Runners are written without reading any rule", async () => {
      expect(
        await update({
          commandRunners: [HOST_RUNNER_ID.toString(), POD_RUNNER_ID],
        }),
      ).toBeNull();
      expect(runnerFind).toHaveBeenCalledTimes(1);
      expect(ruleFind).not.toHaveBeenCalled();
    });

    it("negative control: a write that does not touch the list, or clears it, reads nothing", async () => {
      expect(await update({ otherFields: { name: "renamed" } })).toBeNull();
      expect(await update({ commandRunners: [] })).toBeNull();
      expect(await update({ commandRunners: null })).toBeNull();

      expect(runnerFind).not.toHaveBeenCalled();
      expect(ruleFind).not.toHaveBeenCalled();
    });
  });
});
