import AutoRemediationRuleService, {
  Service as AutoRemediationRuleServiceClass,
} from "../../../Server/Services/AutoRemediationRuleService";
import RunnerService from "../../../Server/Services/RunnerService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import UpdateBy from "../../../Server/Types/Database/UpdateBy";
import { OnCreate, OnUpdate } from "../../../Server/Types/Database/Hooks";
import RunnerAiCommandsPick from "../../../Server/Utils/Runner/RunnerAiCommandsPick";
import AutoRemediationRule from "../../../Models/DatabaseModels/AutoRemediationRule";
import Runner from "../../../Models/DatabaseModels/Runner";
import AutoRemediationTriggerEntity from "../../../Types/AutoRemediation/AutoRemediationTriggerEntity";
import BadDataException from "../../../Types/Exception/BadDataException";
import ObjectID from "../../../Types/ObjectID";
import Permission from "../../../Types/Permission";
import { afterEach, beforeEach, describe, expect, it } from "@jest/globals";
import { stubProjectDirectory } from "../TestingUtils/ProjectDirectory";
import { stubRowsCallerMayWrite } from "../TestingUtils/RowsCallerMayWrite";

/*
 * Contract under test - an auto remediation rule's Runner
 * (AutoRemediationRule.runnerId), the Runner OneUptime AI runs the rule's
 * commands of its own on:
 *
 * - picking it is what lets OneUptime AI's commands run on it: a Runner has
 *   no "Runs AI Remediation Commands" switch any more, so a write that picks
 *   one asks RunnerAiCommandsPick to allow it, in the project the write is
 *   in, once every check passed - written as runnerId or as the relation;
 * - clearing it, or a write that does not touch it, picks nothing;
 * - it is never the in-cluster Runner the Kubernetes agent chart installed,
 *   on create or update, with the reason and what to do instead - except
 *   one a rule already holds, which the form re-posts.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const OTHER_PROJECT_ID: ObjectID = new ObjectID(
  "99999999-9999-4999-8999-999999999999",
);
const RULE_ID: ObjectID = new ObjectID("77777777-7777-4777-8777-777777777777");
const HOST_RUNNER_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const AGENT_RUNNER_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);

const RUNNERS: Array<Runner> = [
  {
    id: HOST_RUNNER_ID,
    _id: HOST_RUNNER_ID.toString(),
    name: "office-runner",
    hostInfo: {},
  },
  {
    id: AGENT_RUNNER_ID,
    _id: AGENT_RUNNER_ID.toString(),
    name: "kubernetes-agent/prod-us",
    hostInfo: {},
  },
] as unknown as Array<Runner>;

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

// A project admin, who may read runbook credentials: only the Runner is asked about.
function adminProps(tenantId: ObjectID): Record<string, unknown> {
  return {
    tenantId,
    userTenantAccessPermission: {
      [tenantId.toString()]: {
        _type: "UserTenantAccessPermission",
        projectId: tenantId,
        permissions: [
          {
            _type: "UserPermission",
            permission: Permission.ProjectAdmin,
            labelIds: [],
          },
        ],
      },
    },
  };
}

describe("an auto remediation rule's Runner", () => {
  let picks: jest.SpyInstance;
  let storedRules: Array<unknown>;

  beforeEach(() => {
    stubProjectDirectory({});
    storedRules = [
      { id: RULE_ID, _id: RULE_ID.toString(), projectId: PROJECT_ID },
    ];

    // Answered from the ids actually asked for, as Postgres would.
    jest
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

    jest
      .spyOn(AutoRemediationRuleService, "findBy")
      .mockImplementation(async (): Promise<Array<AutoRemediationRule>> => {
        return storedRules as Array<AutoRemediationRule>;
      });
    stubRowsCallerMayWrite(AutoRemediationRuleService, () => {
      return storedRules;
    });

    picks = jest
      .spyOn(RunnerAiCommandsPick, "allowPickedRunners")
      .mockResolvedValue(undefined);
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  // The Runners each pick asked to allow, by project, in order.
  function picked(): Array<{ projectId: string; runnerIds: Array<string> }> {
    return picks.mock.calls
      .map((call: Array<unknown>) => {
        const data: {
          projectId?: ObjectID | null;
          runnerIds: Array<unknown>;
        } = call[0] as {
          projectId?: ObjectID | null;
          runnerIds: Array<unknown>;
        };

        return {
          projectId: data.projectId?.toString() || "",
          runnerIds: data.runnerIds.map(String),
        };
      })
      .filter((call: { runnerIds: Array<string> }): boolean => {
        return call.runnerIds.length > 0;
      });
  }

  async function create(fields: Record<string, unknown>): Promise<unknown> {
    const model: AutoRemediationRule = new AutoRemediationRule();
    model.name = "restart web on high latency";
    model.projectId = PROJECT_ID;
    model.triggerEntityType = AutoRemediationTriggerEntity.Incident;
    Object.assign(model, fields);

    try {
      await hooks.onBeforeCreate({
        data: model,
        props: adminProps(PROJECT_ID),
      } as unknown as CreateBy<AutoRemediationRule>);
      return null;
    } catch (error) {
      return error;
    }
  }

  async function update(
    data: Record<string, unknown>,
    props: Record<string, unknown> = adminProps(PROJECT_ID),
  ): Promise<unknown> {
    try {
      await hooks.onBeforeUpdate({
        query: { _id: RULE_ID.toString() },
        data,
        props,
      } as unknown as UpdateBy<AutoRemediationRule>);
      return null;
    } catch (error) {
      return error;
    }
  }

  describe("on create", () => {
    it("a rule that picks a Runner lets OneUptime AI's commands run on it, in its project", async () => {
      expect(await create({ runnerId: HOST_RUNNER_ID })).toBeNull();

      expect(picked()).toEqual([
        {
          projectId: PROJECT_ID.toString(),
          runnerIds: [HOST_RUNNER_ID.toString()],
        },
      ]);
    });

    it("asks with the rule editor's props, so a pick is checked as the Runner's switch was", async () => {
      expect(await create({ runnerId: HOST_RUNNER_ID })).toBeNull();

      const props: Record<string, unknown> = (
        picks.mock.calls[0]![0] as { props: Record<string, unknown> }
      ).props;
      expect(props["tenantId"]).toEqual(PROJECT_ID);
      expect(props["userTenantAccessPermission"]).toBeDefined();
    });

    it("the relation picks it too", async () => {
      expect(
        await create({ runner: { _id: HOST_RUNNER_ID.toString() } }),
      ).toBeNull();

      expect(picked()).toEqual([
        {
          projectId: PROJECT_ID.toString(),
          runnerIds: [HOST_RUNNER_ID.toString()],
        },
      ]);
    });

    it("a rule that picks none lets no Runner run anything", async () => {
      expect(await create({})).toBeNull();
      expect(await create({ runnerId: null })).toBeNull();

      expect(picked()).toEqual([]);
    });

    it("refuses the Kubernetes agent's in-cluster Runner, says why and what to do, and lets nothing run", async () => {
      const thrown: unknown = await create({ runnerId: AGENT_RUNNER_ID });

      expect(thrown).toBeInstanceOf(BadDataException);
      const message: string = (thrown as Error).message;
      expect(message).toBe(
        AutoRemediationRuleServiceClass.getAgentCommandRunnerRefusal(
          RUNNERS[1]!,
        ),
      );
      expect(message).toContain(
        'Runner "kubernetes-agent/prod-us" is the in-cluster Runner the Kubernetes agent chart installed.',
      );
      expect(message).toContain("so it cannot be this rule's Runner");
      // The AI agent on the cluster is how OneUptime AI reaches it, whatever the rule picks.
      expect(message).toContain(
        "OneUptime AI reaches that cluster through its Kubernetes AI agent instead (the cluster's AI → Agent page), whatever Runner the rule picks.",
      );
      expect(message).toContain(
        "Pick a Runner you created under Runbooks → Runners, or none.",
      );
      expect(picked()).toEqual([]);
    });
  });

  describe("on update", () => {
    it("picking a Runner lets OneUptime AI's commands run on it, in the update's project", async () => {
      expect(await update({ runnerId: HOST_RUNNER_ID.toString() })).toBeNull();

      expect(picked()).toEqual([
        {
          projectId: PROJECT_ID.toString(),
          runnerIds: [HOST_RUNNER_ID.toString()],
        },
      ]);
    });

    it("asks with the editor's props on update too", async () => {
      expect(await update({ runnerId: HOST_RUNNER_ID.toString() })).toBeNull();

      expect(
        (picks.mock.calls[0]![0] as { props: Record<string, unknown> }).props[
          "tenantId"
        ],
      ).toEqual(PROJECT_ID);
    });

    it("OneUptime's own write picks it in the project of each rule it writes", async () => {
      storedRules = [
        { id: RULE_ID, _id: RULE_ID.toString(), projectId: OTHER_PROJECT_ID },
      ];

      expect(
        await update({ runnerId: HOST_RUNNER_ID.toString() }, { isRoot: true }),
      ).toBeNull();

      expect(picked()).toEqual([
        {
          projectId: OTHER_PROJECT_ID.toString(),
          runnerIds: [HOST_RUNNER_ID.toString()],
        },
      ]);
    });

    /*
     * A master admin's write reaches any rule its query names, whatever
     * project the request is made in, so the Runner is allowed in the
     * project of the rule it writes - never the project the request names.
     */
    it("a master admin's write, made in another project, picks it in the project of the rule it writes", async () => {
      storedRules = [
        { id: RULE_ID, _id: RULE_ID.toString(), projectId: OTHER_PROJECT_ID },
      ];

      expect(
        await update(
          { runnerId: HOST_RUNNER_ID.toString() },
          { isMasterAdmin: true, tenantId: PROJECT_ID },
        ),
      ).toBeNull();

      expect(picked()).toEqual([
        {
          projectId: OTHER_PROJECT_ID.toString(),
          runnerIds: [HOST_RUNNER_ID.toString()],
        },
      ]);
    });

    it("OneUptime's write that picks no Runner reads no rule for it", async () => {
      const reads: jest.SpyInstance = jest.spyOn(
        AutoRemediationRuleService,
        "findProjectsToCheckUpdateIn",
      );

      expect(await update({ name: "renamed" }, { isRoot: true })).toBeNull();

      expect(reads).not.toHaveBeenCalled();
      expect(picked()).toEqual([]);
    });

    it("clearing the Runner, or a write that does not touch it, picks nothing", async () => {
      expect(await update({ runnerId: null })).toBeNull();
      expect(await update({ name: "renamed" })).toBeNull();

      expect(picked()).toEqual([]);
    });

    it("refuses the Kubernetes agent's in-cluster Runner for a rule that does not hold it", async () => {
      const thrown: unknown = await update({
        runnerId: AGENT_RUNNER_ID.toString(),
      });

      expect(thrown).toBeInstanceOf(BadDataException);
      expect((thrown as Error).message).toContain(
        'Runner "kubernetes-agent/prod-us"',
      );
      expect(picked()).toEqual([]);
    });

    it("lets a rule re-post the agent Runner it already holds as its Runner", async () => {
      storedRules = [
        {
          id: RULE_ID,
          _id: RULE_ID.toString(),
          projectId: PROJECT_ID,
          runnerId: AGENT_RUNNER_ID,
        },
      ];

      expect(
        await update({
          runnerId: AGENT_RUNNER_ID.toString(),
          name: "renamed rule",
        }),
      ).toBeNull();
    });
  });
});
