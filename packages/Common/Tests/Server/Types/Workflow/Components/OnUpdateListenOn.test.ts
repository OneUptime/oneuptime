import Workflow from "../../../../../Models/DatabaseModels/Workflow";
import MonitorService from "../../../../../Server/Services/MonitorService";
import WorkflowService from "../../../../../Server/Services/WorkflowService";
import OnTriggerBaseModel from "../../../../../Server/Types/Workflow/Components/BaseModel/OnTriggerBaseModel";
import {
  ExecuteWorkflowType,
  InitProps,
} from "../../../../../Server/Types/Workflow/TriggerCode";
import {
  ExpressRequest,
  ExpressResponse,
} from "../../../../../Server/Utils/Express";
import Response from "../../../../../Server/Utils/Response";
import { JSONObject } from "../../../../../Types/JSON";
import ObjectID from "../../../../../Types/ObjectID";
import { afterEach, beforeEach, describe, expect, jest, test } from "@jest/globals";

/*
 * AN ON UPDATE TRIGGER'S LISTEN ON HEARS EVERY CHANGE TO THE FIELDS IT NAMES.
 *
 * DatabaseService tells the workflow which fields an update changed
 * (updatedFields, with their new values: getChangedColumns), and the trigger
 * runs a workflow with a Listen on only when one of its fields is among
 * them. It used to read each field's new value instead of whether the field
 * was there, so a switch turned off (false), a count set to 0 or a text
 * cleared never ran the workflows listening for that very field.
 */

const RECORD_ID: string = "6ba7b810-9dad-41d1-80b4-00c04fd43001";

function workflowListeningOn(
  id: string,
  listenOn: JSONObject | string | undefined,
): Workflow {
  const workflow: Workflow = new Workflow();
  workflow._id = id;
  workflow.id = new ObjectID(id);
  workflow.isEnabled = true;
  workflow.triggerArguments =
    listenOn === undefined ? {} : { "listen-on": listenOn as JSONObject };
  return workflow;
}

const LISTENS_ON_SWITCH: string = "6ba7b810-9dad-41d1-80b4-00c04fd43101";
const LISTENS_ON_NAME: string = "6ba7b810-9dad-41d1-80b4-00c04fd43102";
const LISTENS_ON_NOTHING: string = "6ba7b810-9dad-41d1-80b4-00c04fd43103";

async function runsFor(
  workflows: Array<Workflow>,
  miscData: JSONObject | undefined,
): Promise<Array<string>> {
  jest.spyOn(WorkflowService, "findBy").mockResolvedValue(workflows);

  const trigger: OnTriggerBaseModel<never> = new OnTriggerBaseModel(
    MonitorService as never,
    "on-update",
  );

  const executed: Array<ExecuteWorkflowType> = [];

  await trigger.initTrigger(
    {
      params: { projectId: ObjectID.generate().toString() },
      body: {
        data: {
          _id: RECORD_ID,
          ...(miscData ? { miscData: miscData } : {}),
        },
      },
    } as unknown as ExpressRequest,
    {} as unknown as ExpressResponse,
    {
      router: {} as InitProps["router"],
      executeWorkflow: async (run: ExecuteWorkflowType): Promise<void> => {
        executed.push(run);
      },
      scheduleWorkflow: async (): Promise<void> => {},
      removeWorkflow: async (): Promise<void> => {},
    },
  );

  return executed.map((run: ExecuteWorkflowType): string => {
    return run.workflowId.toString();
  });
}

beforeEach(() => {
  jest.spyOn(Response, "sendJsonObjectResponse").mockImplementation((() => {
    return undefined;
  }) as never);
});

afterEach(() => {
  jest.restoreAllMocks();
});

describe("Listen on hears a field that changed, whatever it changed to", () => {
  test.each([
    ["turned off", false],
    ["turned on", true],
    ["set to 0", 0],
    ["cleared to an empty text", ""],
    ["cleared to no value", null],
  ] as Array<[string, unknown]>)(
    "a switch %s runs the workflow listening on it",
    async (_label: string, value: unknown) => {
      await expect(
        runsFor(
          [workflowListeningOn(LISTENS_ON_SWITCH, { disableActiveMonitoring: true })],
          { updatedFields: { disableActiveMonitoring: value } as JSONObject },
        ),
      ).resolves.toEqual([LISTENS_ON_SWITCH]);
    },
  );

  test("a Listen on written as JSON text is read the same way", async () => {
    await expect(
      runsFor(
        [
          workflowListeningOn(
            LISTENS_ON_SWITCH,
            '{"disableActiveMonitoring": true}',
          ),
        ],
        { updatedFields: { disableActiveMonitoring: false } },
      ),
    ).resolves.toEqual([LISTENS_ON_SWITCH]);
  });
});

describe("and only such a field", () => {
  test("of three workflows, each runs for the changes it listens on - or for any, with no Listen on", async () => {
    const workflows: Array<Workflow> = [
      workflowListeningOn(LISTENS_ON_SWITCH, { disableActiveMonitoring: true }),
      workflowListeningOn(LISTENS_ON_NAME, { name: true }),
      workflowListeningOn(LISTENS_ON_NOTHING, undefined),
    ];

    await expect(
      runsFor(workflows, { updatedFields: { disableActiveMonitoring: false } }),
    ).resolves.toEqual([LISTENS_ON_SWITCH, LISTENS_ON_NOTHING]);

    await expect(
      runsFor(workflows, { updatedFields: { name: "Checkout API" } }),
    ).resolves.toEqual([LISTENS_ON_NAME, LISTENS_ON_NOTHING]);
  });

  test("a field the update did not change does not run a workflow listening on it", async () => {
    await expect(
      runsFor(
        [workflowListeningOn(LISTENS_ON_NAME, { name: true })],
        { updatedFields: { description: "Checks the checkout API" } },
      ),
    ).resolves.toEqual([]);
  });

  test("an update that says nothing of its fields skips the filter, as before", async () => {
    await expect(
      runsFor([workflowListeningOn(LISTENS_ON_NAME, { name: true })], {
        updatedFields: {},
      }),
    ).resolves.toEqual([LISTENS_ON_NAME]);

    await expect(
      runsFor([workflowListeningOn(LISTENS_ON_NAME, { name: true })], undefined),
    ).resolves.toEqual([LISTENS_ON_NAME]);
  });
});
