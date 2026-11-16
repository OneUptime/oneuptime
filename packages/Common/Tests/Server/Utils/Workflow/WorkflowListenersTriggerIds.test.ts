/*
 * The runtime component registry reaches the native isolated-vm addon through
 * the JavaScript component's sandbox (Components/JavaScript -> VMRunner).
 * Nothing here runs a sandbox, so the module is stubbed out before anything
 * imports it.
 */
jest.mock("isolated-vm", () => {
  return {};
});

import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { DatabaseTriggerType } from "../../../../Server/Types/Database/Hooks";
import OnCreateOrUpdateBaseModel from "../../../../Server/Types/Workflow/Components/BaseModel/OnCreateOrUpdateBaseModel";
import OnTriggerBaseModel from "../../../../Server/Types/Workflow/Components/BaseModel/OnTriggerBaseModel";
import RuntimeComponents from "../../../../Server/Types/Workflow/Components/Index";
import WorkflowListeners from "../../../../Server/Utils/Workflow/WorkflowListeners";
import Text from "../../../../Types/Text";

/*
 * A WRITE ASKS ABOUT THE VERY TRIGGERS ITS EVENT STARTS WORKFLOWS BY
 * (issue #8861).
 *
 * A write of a model a workflow can watch posts its event to the workflow
 * service only when a workflow of its project listens to one of the
 * triggers WorkflowListeners.triggerIdsOf names. The workflow service's
 * handler of that event (OnTriggerBaseModel.initTrigger) starts the
 * workflows of its own trigger and, for a create or an update, of the
 * model's On Create or Update. Were the two lists ever to differ - a model
 * named another way, a trigger added to the handler alone - a workflow would
 * listen to a trigger no write asks about, and miss every event of it.
 *
 * So, for every trigger the runtime registry holds - every model's - the
 * triggers a write asks about are the very triggers its handler starts
 * workflows by, and the write's event reaches that handler's route.
 */

interface Handler {
  componentId: string;
  route: string;
  tableName: string;
  triggerType: DatabaseTriggerType;
  startsWorkflowsOf: Array<string>;
  model: BaseModel;
}

const POSTED_TRIGGER_TYPES: ReadonlyArray<DatabaseTriggerType> = [
  "on-create",
  "on-update",
  "on-delete",
];

// Every handler of an event DatabaseService posts.
function handlers(): Array<Handler> {
  const found: Array<Handler> = [];

  for (const [componentId, component] of Object.entries(RuntimeComponents)) {
    if (
      !(component instanceof OnTriggerBaseModel) ||
      // No route of its own: a create's or an update's handler starts its workflows.
      component instanceof OnCreateOrUpdateBaseModel
    ) {
      continue;
    }

    const trigger: OnTriggerBaseModel<BaseModel> =
      component as OnTriggerBaseModel<BaseModel>;
    const model: BaseModel = trigger.service!.getModel();

    found.push({
      componentId: componentId,
      route: `${trigger.modelId}/${trigger.type}`,
      tableName: model.tableName!,
      triggerType: trigger.type as DatabaseTriggerType,
      // What initTrigger reads its workflows by.
      startsWorkflowsOf: [
        trigger.getMetadata().id,
        ...(trigger.createOrUpdateTriggerId
          ? [trigger.createOrUpdateTriggerId]
          : []),
      ],
      model: model,
    });
  }

  return found;
}

describe("the triggers a write asks about", () => {
  const all: Array<Handler> = handlers();

  test("are held for every model's handlers - a create's, an update's and a delete's", () => {
    expect(all.length).toBeGreaterThan(100);

    const types: Set<string> = new Set<string>(
      all.map((handler: Handler): string => {
        return handler.triggerType;
      }),
    );

    expect(Array.from(types).sort()).toEqual([...POSTED_TRIGGER_TYPES].sort());

    // A create's and an update's handler of a model with On Create or Update.
    expect(
      all.some((handler: Handler): boolean => {
        return handler.startsWorkflowsOf.length === 2;
      }),
    ).toBe(true);
  });

  test("are the very triggers the handler of the write's event starts workflows by", () => {
    const differing: Array<string> = [];

    for (const handler of all) {
      const asked: Array<string> = WorkflowListeners.triggerIdsOf({
        tableName: handler.tableName,
        triggerType: handler.triggerType,
        enableWorkflowOn: handler.model.enableWorkflowOn,
      });

      if (
        JSON.stringify([...asked].sort()) !==
        JSON.stringify([...handler.startsWorkflowsOf].sort())
      ) {
        differing.push(
          `${handler.componentId}: asks about ${asked.join(", ")}; starts the workflows of ${handler.startsWorkflowsOf.join(", ")}`,
        );
      }
    }

    expect(differing).toEqual([]);
  });

  test("are asked by the write whose event that handler's route hears", () => {
    const differing: Array<string> = [];

    for (const handler of all) {
      // The route DatabaseService.onTriggerWorkflow posts the write's event to.
      const posted: string = `${Text.pascalCaseToDashes(handler.tableName)}/${handler.triggerType}`;

      if (posted !== handler.route) {
        differing.push(`${handler.componentId}: ${posted} vs ${handler.route}`);
      }
    }

    expect(differing).toEqual([]);
  });
});
