import BaseModelComponent from "../../../../Types/Workflow/Components/BaseModel";
import {
  DatabaseOperation,
  getDatabaseOperation,
  WRITE_DATABASE_OPERATIONS,
} from "../../../../Types/Workflow/DatabaseOperation";
import ComponentMetadata, {
  ComponentType,
} from "../../../../Types/Workflow/Component";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import EnableWorkflowOn from "../../../../Types/BaseDatabase/EnableWorkflowOn";
import { describe, expect, test } from "@jest/globals";

/*
 * EnableWorkflowOn.writeSteps: false is for a table only OneUptime writes,
 * such as a call log. Workflows still get its triggers and its Find steps, but
 * no step that writes its rows - those steps run as root, so they would let a
 * workflow forge or rewrite the log.
 */

const ALL_FLAGS: EnableWorkflowOn = {
  create: true,
  read: true,
  update: true,
  delete: true,
};

const makeModel: (
  enableWorkflowOn: EnableWorkflowOn | undefined,
) => BaseModel = (
  enableWorkflowOn: EnableWorkflowOn | undefined,
): BaseModel => {
  return {
    enableWorkflowOn: enableWorkflowOn,
    tableName: "WidgetLog",
    singularName: "Widget Log",
    pluralName: "Widget Logs",
  } as unknown as BaseModel;
};

const operationsOf: (enableWorkflowOn: EnableWorkflowOn) => Array<string> = (
  enableWorkflowOn: EnableWorkflowOn,
): Array<string> => {
  return BaseModelComponent.getComponents(makeModel(enableWorkflowOn)).map(
    (component: ComponentMetadata): string => {
      return (
        getDatabaseOperation({
          componentId: component.id,
          tableName: "WidgetLog",
        }) || `unknown:${component.id}`
      );
    },
  );
};

describe("EnableWorkflowOn.writeSteps", () => {
  test("left out, every flag offers its trigger and its write steps, as before", () => {
    expect(operationsOf(ALL_FLAGS)).toHaveLength(11);
    expect(operationsOf({ ...ALL_FLAGS, writeSteps: true })).toEqual(
      operationsOf(ALL_FLAGS),
    );
  });

  test("false keeps the triggers and the Find steps, and nothing else", () => {
    expect(operationsOf({ ...ALL_FLAGS, writeSteps: false })).toEqual([
      DatabaseOperation.FindOne,
      DatabaseOperation.FindMany,
      DatabaseOperation.OnDelete,
      DatabaseOperation.OnCreate,
      DatabaseOperation.OnUpdate,
    ]);
  });

  test("false never offers a step that writes", () => {
    const offered: Array<string> = operationsOf({
      ...ALL_FLAGS,
      writeSteps: false,
    });

    for (const operation of WRITE_DATABASE_OPERATIONS) {
      expect(offered).not.toContain(operation);
    }
  });

  test.each([
    [{ create: true }, [DatabaseOperation.OnCreate]],
    [{ update: true }, [DatabaseOperation.OnUpdate]],
    [{ delete: true }, [DatabaseOperation.OnDelete]],
    [{ read: true }, [DatabaseOperation.FindOne, DatabaseOperation.FindMany]],
  ])(
    "with writeSteps false, %j offers %j",
    (flags: EnableWorkflowOn, expected: Array<DatabaseOperation>) => {
      expect(operationsOf({ ...flags, writeSteps: false })).toEqual(expected);
    },
  );

  test("false with no other flag offers nothing", () => {
    expect(
      BaseModelComponent.getComponents(makeModel({ writeSteps: false })),
    ).toEqual([]);
  });

  test("the triggers it keeps are still entry points, and the Find steps still connectable", () => {
    const components: Array<ComponentMetadata> =
      BaseModelComponent.getComponents(
        makeModel({ ...ALL_FLAGS, writeSteps: false }),
      );

    for (const component of components) {
      const operation: DatabaseOperation | null = getDatabaseOperation({
        componentId: component.id,
        tableName: "WidgetLog",
      });

      if (
        operation === DatabaseOperation.FindOne ||
        operation === DatabaseOperation.FindMany
      ) {
        expect(component.componentType).toBe(ComponentType.Component);
        expect(component.inPorts.length).toBeGreaterThan(0);
      } else {
        expect(component.componentType).toBe(ComponentType.Trigger);
        expect(component.inPorts).toEqual([]);
      }
    }
  });
});

describe("WRITE_DATABASE_OPERATIONS", () => {
  test("is exactly the create, update and delete steps", () => {
    expect([...WRITE_DATABASE_OPERATIONS].sort()).toEqual(
      [
        DatabaseOperation.CreateOne,
        DatabaseOperation.CreateMany,
        DatabaseOperation.UpdateOne,
        DatabaseOperation.UpdateMany,
        DatabaseOperation.DeleteOne,
        DatabaseOperation.DeleteMany,
      ].sort(),
    );
  });

  test("leaves out the Find steps and every trigger", () => {
    for (const operation of [
      DatabaseOperation.FindOne,
      DatabaseOperation.FindMany,
      DatabaseOperation.OnCreate,
      DatabaseOperation.OnUpdate,
      DatabaseOperation.OnDelete,
    ]) {
      expect(WRITE_DATABASE_OPERATIONS).not.toContain(operation);
    }
  });

  test("cannot be changed at runtime", () => {
    expect(Object.isFrozen(WRITE_DATABASE_OPERATIONS)).toBe(true);
  });
});
