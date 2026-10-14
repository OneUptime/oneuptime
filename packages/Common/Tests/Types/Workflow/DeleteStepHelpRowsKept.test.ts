import Models from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import ComponentMetadata, {
  NodeDataProp,
} from "../../../Types/Workflow/Component";
import BaseModelComponents from "../../../Types/Workflow/Components/BaseModel";
import ComponentDocumentation from "../../../Types/Workflow/Documentation/ComponentDocumentation";
import getComponentDocumentation from "../../../Types/Workflow/Documentation/Index";
import {
  describeRowsKeptOnDelete,
  getRowsKeptOnDelete,
  ROWS_KEPT_ON_DELETE_BY_QUERY,
} from "../../../Types/StateTimeline/RowsKeptOnDelete";
import { describe, expect, test } from "@jest/globals";

/*
 * A DELETE STEP OF A STATE TIMELINE SAYS, BEFORE IT RUNS, WHAT ALWAYS STAYS.
 *
 * A delete by query of a state timeline leaves each record's current row,
 * and a monitor's or a site's last 90 days, so its Delete One and Delete
 * Many steps can delete fewer rows than their query matches. Their help
 * says so in a note, in the same words as the run's log
 * (Types/StateTimeline/RowsKeptOnDelete); every other table's help is as it
 * was. ComponentDocumentation.test holds every note to the help's rules.
 */

function modelFor(tableName: string): BaseModel {
  const modelType: (new () => BaseModel) | undefined = (
    Models as Array<new () => BaseModel>
  ).find((model: new () => BaseModel): boolean => {
    return new model().tableName === tableName;
  });

  if (!modelType) {
    throw new Error(`No model for ${tableName}`);
  }

  return new modelType();
}

function helpOf(model: BaseModel, suffix: string): ComponentDocumentation {
  const metadata: ComponentMetadata | undefined =
    BaseModelComponents.getComponents(model).find(
      (component: ComponentMetadata): boolean => {
        return component.id.endsWith(suffix);
      },
    );

  if (!metadata) {
    throw new Error(`No ${suffix} step for ${model.tableName}`);
  }

  const help: ComponentDocumentation | null = getComponentDocumentation({
    metadata: metadata,
    stepId: "step-1",
    graphComponents: [] as Array<NodeDataProp>,
  });

  if (!help) {
    throw new Error(`No help for ${metadata.id}`);
  }

  return help;
}

function notesOf(help: ComponentDocumentation): Array<string> {
  return (help.notes || []).map((note: { text: string }): string => {
    return note.text;
  });
}

// The state timelines a workflow can delete from: every one but a network site's, which only its rollups write.
const WITH_DELETE_STEPS: Array<string> = Object.keys(
  ROWS_KEPT_ON_DELETE_BY_QUERY,
).filter((tableName: string): boolean => {
  return Boolean(modelFor(tableName).enableWorkflowOn?.delete);
});

test("every state timeline but a network site's has delete steps", () => {
  expect(WITH_DELETE_STEPS.sort()).toEqual(
    Object.keys(ROWS_KEPT_ON_DELETE_BY_QUERY)
      .filter((tableName: string): boolean => {
        return tableName !== "NetworkSiteStatusTimeline";
      })
      .sort(),
  );

  expect(
    BaseModelComponents.getComponents(
      modelFor("NetworkSiteStatusTimeline"),
    ).filter((component: ComponentMetadata): boolean => {
      return component.id.includes("-delete-");
    }),
  ).toEqual([]);
});

describe.each(WITH_DELETE_STEPS)("%s", (tableName: string) => {
  const model: BaseModel = modelFor(tableName);

  test.each(["-delete-many", "-delete-one"])(
    "the %s step's help says what always stays, in the run log's words",
    (suffix: string) => {
      const rule: string = describeRowsKeptOnDelete(
        getRowsKeptOnDelete(tableName)!,
      );

      const kept: Array<string> = notesOf(helpOf(model, suffix)).filter(
        (text: string): boolean => {
          return text.includes(rule);
        },
      );

      expect(kept).toEqual([
        `Some ${model.pluralName} always stay: ${rule}. The run's log says how many were kept${getRowsKeptOnDelete(tableName)!.oneRowByIdCanGo ? ", and a query by ID deletes the one it names" : ""}.`,
      ]);
    },
  );
});

describe("every other table", () => {
  test("has delete steps whose help says nothing of rows that stay", () => {
    for (const modelType of Models as Array<new () => BaseModel>) {
      const model: BaseModel = new modelType();

      if (
        !model.tableName ||
        getRowsKeptOnDelete(model.tableName) ||
        !model.enableWorkflowOn?.delete
      ) {
        continue;
      }

      for (const suffix of ["-delete-many", "-delete-one"]) {
        const metadata: ComponentMetadata | undefined =
          BaseModelComponents.getComponents(model).find(
            (component: ComponentMetadata): boolean => {
              return component.id.endsWith(suffix);
            },
          );

        if (!metadata) {
          continue;
        }

        const help: ComponentDocumentation | null = getComponentDocumentation({
          metadata: metadata,
          stepId: "step-1",
        });

        expect({
          step: metadata.id,
          saysRowsStay: notesOf(help!).some((text: string): boolean => {
            return text.includes("always stay");
          }),
        }).toEqual({ step: metadata.id, saysRowsStay: false });
      }
    }
  });
});
