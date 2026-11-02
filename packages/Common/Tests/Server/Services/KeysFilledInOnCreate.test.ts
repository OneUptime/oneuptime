import AIAgentService from "../../../Server/Services/AIAgentService";
import ProbeService from "../../../Server/Services/ProbeService";
import RunnerService from "../../../Server/Services/RunnerService";
import CreateBy from "../../../Server/Types/Database/CreateBy";
import { OnCreate } from "../../../Server/Types/Database/Hooks";
import AIAgent from "../../../Models/DatabaseModels/AIAgent";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Probe from "../../../Models/DatabaseModels/Probe";
import Runner from "../../../Models/DatabaseModels/Runner";
import DatabaseCommonInteractionProps from "../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../Types/ObjectID";
import Version from "../../../Types/Version";
import { describe, expect, test } from "@jest/globals";

/*
 * A PROBE, AN AI AGENT AND A RUNNER CAN BE CREATED FROM THEIR NAME ALONE.
 *
 * Their key is a secret the agent connects with, and their version a label.
 * The create schema does not ask for either (GeneratedKeyColumns): the
 * service fills them in when a create leaves them out - a key it generates,
 * and 1.0.0 for a version. So a Terraform configuration names the probe and
 * reads its key back (a sensitive attribute) to install it, instead of
 * writing a secret into the configuration.
 *
 * A key or a version the create gives is kept as it is.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);

const UUID_SHAPE: RegExp =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

function props(): DatabaseCommonInteractionProps {
  return { tenantId: PROJECT_ID, isRoot: true };
}

type OnBeforeCreate<T extends BaseModel> = (
  createBy: CreateBy<T>,
) => Promise<OnCreate<T>>;

function hookOf<T extends BaseModel>(service: unknown): OnBeforeCreate<T> {
  const hook: OnBeforeCreate<T> = (
    service as { onBeforeCreate: OnBeforeCreate<T> }
  ).onBeforeCreate;

  return hook.bind(service);
}

async function createProbe(data: Partial<Probe>): Promise<Probe> {
  const probe: Probe = new Probe();
  probe.name = "EU probe";
  probe.projectId = PROJECT_ID;
  Object.assign(probe, data);

  const result: OnCreate<Probe> = await hookOf<Probe>(ProbeService)({
    data: probe,
    props: props(),
  });

  return result.createBy.data;
}

async function createAIAgent(data: Partial<AIAgent>): Promise<AIAgent> {
  const agent: AIAgent = new AIAgent();
  agent.name = "Triage agent";
  agent.projectId = PROJECT_ID;
  Object.assign(agent, data);

  const result: OnCreate<AIAgent> = await hookOf<AIAgent>(AIAgentService)({
    data: agent,
    props: props(),
  });

  return result.createBy.data;
}

async function createRunner(data: Partial<Runner>): Promise<Runner> {
  const runner: Runner = new Runner();
  runner.name = "Build runner";
  runner.projectId = PROJECT_ID;
  Object.assign(runner, data);

  const result: OnCreate<Runner> = await hookOf<Runner>(RunnerService)({
    data: runner,
    props: props(),
  });

  return result.createBy.data;
}

describe("a probe created from its name alone", () => {
  test("gets a key of its own, and version 1.0.0", async () => {
    const first: Probe = await createProbe({});
    const second: Probe = await createProbe({});

    expect(first.key).toMatch(UUID_SHAPE);
    expect(second.key).toMatch(UUID_SHAPE);
    expect(first.key).not.toBe(second.key);
    expect(first.probeVersion?.toString()).toBe("1.0.0");
  });

  test("keeps the key and the version a create gives", async () => {
    const probe: Probe = await createProbe({
      key: "b6a1f6d2-6f3e-4c1a-9a43-6f1d2e3c4b5a",
      probeVersion: new Version("2.1.0"),
    });

    expect(probe.key).toBe("b6a1f6d2-6f3e-4c1a-9a43-6f1d2e3c4b5a");
    expect(probe.probeVersion?.toString()).toBe("2.1.0");
  });
});

describe("an AI agent created from its name alone", () => {
  test("gets a key of its own, and version 1.0.0", async () => {
    const first: AIAgent = await createAIAgent({});
    const second: AIAgent = await createAIAgent({});

    expect(first.key).toMatch(UUID_SHAPE);
    expect(first.key).not.toBe(second.key);
    expect(first.aiAgentVersion?.toString()).toBe("1.0.0");
  });

  test("keeps the key and the version a create gives", async () => {
    const agent: AIAgent = await createAIAgent({
      key: "c7b2a7e3-7a4f-4d2b-8b54-7a2e3f4d5c6b",
      aiAgentVersion: new Version("3.0.0"),
    });

    expect(agent.key).toBe("c7b2a7e3-7a4f-4d2b-8b54-7a2e3f4d5c6b");
    expect(agent.aiAgentVersion?.toString()).toBe("3.0.0");
  });
});

describe("a Runner created from its name alone", () => {
  test("gets a key of its own", async () => {
    const first: Runner = await createRunner({});
    const second: Runner = await createRunner({});

    expect(first.key).toMatch(UUID_SHAPE);
    expect(first.key).not.toBe(second.key);
  });

  test("keeps the key a create gives", async () => {
    const runner: Runner = await createRunner({
      key: "d8c3b8f4-8b5a-4e3c-9c65-8b3f4a5e6d7c",
    });

    expect(runner.key).toBe("d8c3b8f4-8b5a-4e3c-9c65-8b3f4a5e6d7c");
  });
});
