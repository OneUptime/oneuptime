import { afterEach, describe, expect, jest, test } from "@jest/globals";
import ProposeOpenStackFix from "../../../../Server/Types/Workflow/Components/OpenStack/ProposeFix";
import {
  RunOptions,
  RunReturnType,
} from "../../../../Server/Types/Workflow/ComponentCode";
import logger from "../../../../Server/Utils/Logger";
import OpenStackWorkflowFix, {
  OpenStackWorkflowFixInput,
  OpenStackWorkflowFixResult,
} from "../../../../Server/Utils/OpenStack/OpenStackWorkflowFix";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import ComponentMetadata, { Port } from "../../../../Types/Workflow/Component";
import ComponentID from "../../../../Types/Workflow/ComponentID";
import OpenStackComponents from "../../../../Types/Workflow/Components/OpenStack";
import Exception from "../../../../Types/Exception/Exception";

/*
 * The step a workflow runs: what it hands OpenStackWorkflowFix, and which output each answer
 * takes. What is decided about a fix is OpenStackWorkflowFix's own tests.
 */

const PROJECT_ID: ObjectID = new ObjectID(
  "22222222-2222-4222-8222-222222222222",
);
const ALERT_ID: string = "55555555-5555-4555-8555-555555555555";
const INCIDENT_ID: string = "56565656-5656-4656-8656-565656565656";
const CLOUD_ID: string = "33333333-3333-4333-8333-333333333333";
const SUGGESTION_ID: ObjectID = new ObjectID(
  "77777777-7777-4777-8777-777777777777",
);
const COMMAND: string =
  "openstack compute service set --enable compute-01 nova-compute";

const METADATA: ComponentMetadata = OpenStackComponents[0]!;

function portNamed(id: string): Port {
  return METADATA.outPorts.find((port: Port): boolean => {
    return port.id === id;
  }) as Port;
}

function optionsOf(logged: Array<unknown>): RunOptions {
  return {
    log: (item: unknown): void => {
      logged.push(item);
    },
    workflowLogId: ObjectID.generate(),
    workflowId: ObjectID.generate(),
    workflowName: "Page and propose",
    projectId: PROJECT_ID,
    onError: (exception: Exception): Exception => {
      return exception;
    },
    executeWorkflow: async (): Promise<void> => {},
  };
}

function runWith(
  args: JSONObject,
  logged: Array<unknown> = [],
): Promise<RunReturnType> {
  return new ProposeOpenStackFix().run(args, optionsOf(logged));
}

afterEach(() => {
  jest.restoreAllMocks();
});

describe("the step, as the catalog shows it", () => {
  test("has its one way in, and says what each way out means", () => {
    expect(METADATA.id).toBe(ComponentID.OpenStackProposeFix);
    expect(METADATA.inPorts).toHaveLength(1);
    expect(
      METADATA.outPorts.map((port: Port): string => {
        return port.id;
      }),
    ).toEqual(["success", "error"]);
    expect(METADATA.description).toContain("never makes the change itself");
  });
});

describe("what it asks for", () => {
  test("the project is the workflow's, and the rest is what the step was given", async () => {
    const propose: ReturnType<typeof jest.spyOn> = jest
      .spyOn(OpenStackWorkflowFix, "propose")
      .mockResolvedValue({
        isProposed: true,
        suggestionId: SUGGESTION_ID,
        tierName: "Safe",
        wasAlreadyWaiting: false,
      });

    await runWith({
      "alert-id": ` ${ALERT_ID} `,
      "cloud-id": CLOUD_ID,
      command: ` ${COMMAND} `,
      reason: " Because it stopped. ",
    });

    const sent: OpenStackWorkflowFixInput = propose.mock
      .calls[0]![0] as OpenStackWorkflowFixInput;

    expect(sent.projectId).toEqual(PROJECT_ID);
    expect(sent.workflowName).toBe("Page and propose");
    expect(sent.alertId?.toString()).toBe(ALERT_ID);
    expect(sent.incidentId).toBeUndefined();
    expect(sent.cloudId?.toString()).toBe(CLOUD_ID);
    expect(sent.command).toBe(COMMAND);
    expect(sent.reason).toBe("Because it stopped.");
  });

  test("an incident's ID goes as one", async () => {
    const propose: ReturnType<typeof jest.spyOn> = jest
      .spyOn(OpenStackWorkflowFix, "propose")
      .mockResolvedValue({ isProposed: false, refusal: "no" });

    await runWith({ "incident-id": INCIDENT_ID, command: COMMAND });

    const sent: OpenStackWorkflowFixInput = propose.mock
      .calls[0]![0] as OpenStackWorkflowFixInput;

    expect(sent.incidentId?.toString()).toBe(INCIDENT_ID);
    expect(sent.alertId).toBeUndefined();
    expect(sent.cloudId).toBeUndefined();
  });

  test.each([
    ["alert-id", "Alert ID"],
    ["incident-id", "Incident ID"],
    ["cloud-id", "OpenStack Cloud ID"],
  ])(
    "%s that isn't an ID stops there, and nothing is asked",
    async (id: string, name: string) => {
      const propose: ReturnType<typeof jest.spyOn> = jest.spyOn(
        OpenStackWorkflowFix,
        "propose",
      );

      const result: RunReturnType = await runWith({
        [id]: "{{local.components.nothing}}",
        command: COMMAND,
      });

      expect(result.executePort).toEqual(portNamed("error"));
      expect(result.returnValues["error"]).toContain(`${name} is not an ID`);
      expect(propose).not.toHaveBeenCalled();
    },
  );

  test("a value that isn't text is no command, rather than an error at the database", async () => {
    const propose: ReturnType<typeof jest.spyOn> = jest
      .spyOn(OpenStackWorkflowFix, "propose")
      .mockResolvedValue({ isProposed: false, refusal: "no command" });

    await runWith({ "alert-id": ALERT_ID, command: { a: 1 } as never });

    expect(
      (propose.mock.calls[0]![0] as OpenStackWorkflowFixInput).command,
    ).toBe("");
  });
});

describe("which way it goes out", () => {
  test("a person has been asked: Success, with what a later step can read", async () => {
    jest.spyOn(OpenStackWorkflowFix, "propose").mockResolvedValue({
      isProposed: true,
      suggestionId: SUGGESTION_ID,
      tierName: "Riskier",
      wasAlreadyWaiting: false,
    });

    const logged: Array<unknown> = [];
    const result: RunReturnType = await runWith(
      { "alert-id": ALERT_ID, command: COMMAND },
      logged,
    );

    expect(result.executePort).toEqual(portNamed("success"));
    expect(result.returnValues).toEqual({
      "suggestion-id": SUGGESTION_ID.toString(),
      tier: "Riskier",
      "already-waiting": false,
    });
    expect(logged.join(" ")).toContain("A person has been asked");
  });

  test("the same change already waiting is Success too, and says so", async () => {
    jest.spyOn(OpenStackWorkflowFix, "propose").mockResolvedValue({
      isProposed: true,
      suggestionId: SUGGESTION_ID,
      tierName: "Safe",
      wasAlreadyWaiting: true,
    });

    const logged: Array<unknown> = [];
    const result: RunReturnType = await runWith(
      { "alert-id": ALERT_ID, command: COMMAND },
      logged,
    );

    expect(result.executePort).toEqual(portNamed("success"));
    expect(result.returnValues["already-waiting"]).toBe(true);
    expect(logged.join(" ")).toContain("already waiting");
  });

  test("a refusal: Error, with why, in the run's log too", async () => {
    const refused: OpenStackWorkflowFixResult = {
      isProposed: false,
      refusal: "OneUptime never makes this change: it deletes.",
    };

    jest.spyOn(OpenStackWorkflowFix, "propose").mockResolvedValue(refused);

    const logged: Array<unknown> = [];
    const result: RunReturnType = await runWith(
      { "alert-id": ALERT_ID, command: "openstack server delete x" },
      logged,
    );

    expect(result.executePort).toEqual(portNamed("error"));
    expect(result.returnValues).toEqual({
      error: "OneUptime never makes this change: it deletes.",
    });
    expect(logged).toEqual(["OneUptime never makes this change: it deletes."]);
  });

  test("a failure: Error, and what failed stays in the server's own log", async () => {
    const error: Error = new Error(
      'duplicate key value violates unique constraint "secret_internal_index"',
    );

    jest.spyOn(OpenStackWorkflowFix, "propose").mockRejectedValue(error);

    const logError: ReturnType<typeof jest.spyOn> = jest
      .spyOn(logger, "error")
      .mockImplementation((): void => {});

    const logged: Array<unknown> = [];
    const result: RunReturnType = await runWith(
      { "alert-id": ALERT_ID, command: COMMAND },
      logged,
    );

    expect(result.executePort).toEqual(portNamed("error"));
    expect(result.returnValues["error"]).toContain("nothing changed");
    expect(JSON.stringify(result.returnValues)).not.toContain(
      "secret_internal",
    );
    expect(JSON.stringify(logged)).not.toContain("secret_internal");
    expect(logError).toHaveBeenCalledWith(error);
  });
});
