import Log from "../../../../../Server/Types/Workflow/Components/Log";
import {
  RunOptions,
  RunReturnType,
} from "../../../../../Server/Types/Workflow/ComponentCode";
import Exception from "../../../../../Types/Exception/Exception";
import ObjectID from "../../../../../Types/ObjectID";
import ComponentMetadata from "../../../../../Types/Workflow/Component";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import LogComponents from "../../../../../Types/Workflow/Components/Log";
import { describe, expect, test } from "@jest/globals";

/*
 * The Log step: what the Add Component picker says it does, and what it
 * does - its value goes to the run's log (Runs > a run > Logs), and the run
 * goes on through Out. The picker said "Log to console what ever is passed
 * to this component": no console is involved, and nobody reads one.
 */

const metadata: ComponentMetadata = LogComponents.find(
  (component: ComponentMetadata): boolean => {
    return component.id === ComponentID.Log;
  },
)!;

describe("the Log step", () => {
  test("says in plain words where its value goes", () => {
    expect(metadata.description).toBe("Writes its value to the run's log.");
    expect(metadata.description).not.toMatch(/console|what ever/i);
  });

  test("writes its value to the run's log and goes on through Out", async () => {
    const logged: Array<unknown> = [];
    const options: RunOptions = {
      log: (value: unknown): void => {
        logged.push(value);
      },
      workflowLogId: ObjectID.generate(),
      workflowId: ObjectID.generate(),
      projectId: ObjectID.generate(),
      onError: (exception: Exception): Exception => {
        return exception;
      },
      executeWorkflow: async (): Promise<void> => {},
    } as RunOptions;

    const result: RunReturnType = await new Log().run(
      { value: { incident: 42 } },
      options,
    );

    expect(logged).toEqual(["Value: ", { incident: 42 }]);
    expect(result.executePort?.id).toBe("out");
    expect(result.returnValues).toEqual({});
  });
});
