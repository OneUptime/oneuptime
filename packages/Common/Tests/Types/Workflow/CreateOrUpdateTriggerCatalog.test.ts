/*
 * On Create or Update, across the whole catalog: every model a workflow can
 * watch that has both an On Create and an On Update trigger gets one, and no
 * other model does. Its settings are On Update's - the same two field lists,
 * under the same ids, read the same way - so the field lists, the value
 * picker, the help and Run Workflow treat it as they treat On Update; what it
 * adds is What Happened, which says whether a run is for a create or an
 * update, and asks it in Run Workflow.
 */

import Entities from "../../../Models/DatabaseModels/Index";
import BaseModel from "../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Incident from "../../../Models/DatabaseModels/Incident";
import IncomingCallLog from "../../../Models/DatabaseModels/IncomingCallLog";
import Workflow from "../../../Models/DatabaseModels/Workflow";
import ComponentMetadata, {
  Argument,
  ComponentInputType,
  ComponentType,
  ReturnValue,
} from "../../../Types/Workflow/Component";
import { getNewStepArguments } from "../../../Types/Workflow/ComponentOutPorts";
import BaseModelComponent, {
  SELECT_FIELDS_NAME,
  WATCHED_FIELDS_NAME,
} from "../../../Types/Workflow/Components/BaseModel";
import {
  WHAT_HAPPENED_ID,
  WHAT_HAPPENED_NAME,
  WhatHappened,
  getCreateOrUpdateTriggerId,
  hasCreateOrUpdateTrigger,
  isCreateOrUpdateTrigger,
} from "../../../Types/Workflow/CreateOrUpdateTrigger";
import {
  DatabaseOperation,
  getDatabaseOperation,
} from "../../../Types/Workflow/DatabaseOperation";
import { getDisplayColumn } from "../../../Types/Workflow/Documentation/ModelExamples";
import {
  RunRecordEvent,
  RunRecordTriggerInfo,
  getRunRecordArgument,
  getRunRecordEvent,
  getRunRecordTriggerInfo,
  withRunRecordEvent,
} from "../../../Types/Workflow/RunRecord";
import Text from "../../../Types/Text";
import { describe, expect, test } from "@jest/globals";
import { getMetadataArgsStorage } from "typeorm";
import { ColumnMetadataArgs } from "typeorm/metadata-args/ColumnMetadataArgs";

interface ModelTriggers {
  modelName: string;
  model: BaseModel;
  components: Array<ComponentMetadata>;
}

const MODELS: Array<ModelTriggers> = Entities.map(
  (modelType: { new (): BaseModel; name: string }): ModelTriggers => {
    const model: BaseModel = new modelType();

    return {
      modelName: modelType.name,
      model: model,
      components: BaseModelComponent.getComponents(model),
    };
  },
);

type ByOperationFunction = (
  entry: ModelTriggers,
  operation: DatabaseOperation,
) => ComponentMetadata | undefined;

const byOperation: ByOperationFunction = (
  entry: ModelTriggers,
  operation: DatabaseOperation,
): ComponentMetadata | undefined => {
  return entry.components.find((component: ComponentMetadata): boolean => {
    return (
      getDatabaseOperation({
        componentId: component.id,
        tableName: entry.model.tableName || "",
      }) === operation
    );
  });
};

const WITH_TRIGGER: Array<ModelTriggers> = MODELS.filter(
  (entry: ModelTriggers): boolean => {
    return Boolean(byOperation(entry, DatabaseOperation.OnCreateOrUpdate));
  },
);

type FindIncidentStepFunction = (
  operation: DatabaseOperation,
) => ComponentMetadata;

const incidentStep: FindIncidentStepFunction = (
  operation: DatabaseOperation,
): ComponentMetadata => {
  return byOperation(
    {
      modelName: "Incident",
      model: new Incident(),
      components: BaseModelComponent.getComponents(new Incident()),
    },
    operation,
  )!;
};

const INCIDENT_TRIGGER: ComponentMetadata = incidentStep(
  DatabaseOperation.OnCreateOrUpdate,
);
const INCIDENT_ON_UPDATE: ComponentMetadata = incidentStep(
  DatabaseOperation.OnUpdate,
);

type ArgumentOfFunction = (
  arguments_: Array<Argument> | undefined,
  id: string,
) => Argument | undefined;

const argumentOf: ArgumentOfFunction = (
  arguments_: Array<Argument> | undefined,
  id: string,
): Argument | undefined => {
  return (arguments_ || []).find((argument: Argument): boolean => {
    return argument.id === id;
  });
};

describe("which models have it", () => {
  test("many do, so the checks below check something", () => {
    expect(WITH_TRIGGER.length).toBeGreaterThan(100);
  });

  test("exactly the models with both an On Create and an On Update trigger", () => {
    const wrong: Array<string> = MODELS.filter(
      (entry: ModelTriggers): boolean => {
        const hasBoth: boolean =
          Boolean(byOperation(entry, DatabaseOperation.OnCreate)) &&
          Boolean(byOperation(entry, DatabaseOperation.OnUpdate));
        const hasIt: boolean = Boolean(
          byOperation(entry, DatabaseOperation.OnCreateOrUpdate),
        );

        return hasBoth !== hasIt;
      },
    ).map((entry: ModelTriggers): string => {
      return entry.modelName;
    });

    expect(wrong).toEqual([]);
  });

  test("and those are the models whose flags say create and update", () => {
    for (const entry of MODELS) {
      expect({
        model: entry.modelName,
        hasIt: Boolean(byOperation(entry, DatabaseOperation.OnCreateOrUpdate)),
      }).toEqual({
        model: entry.modelName,
        hasIt: hasCreateOrUpdateTrigger(entry.model.enableWorkflowOn),
      });
    }
  });

  /*
   * A table only OneUptime writes keeps its triggers and loses its write
   * steps (EnableWorkflowOn.writeSteps). This is a trigger.
   */
  test("a table only OneUptime writes keeps it with its other triggers", () => {
    const entry: ModelTriggers = {
      modelName: "IncomingCallLog",
      model: new IncomingCallLog(),
      components: BaseModelComponent.getComponents(new IncomingCallLog()),
    };

    expect(entry.model.enableWorkflowOn?.writeSteps).toBe(false);
    expect(byOperation(entry, DatabaseOperation.OnCreateOrUpdate)?.id).toBe(
      "incoming-call-log-on-create-or-update",
    );
  });
});

describe("what it is called, and where it is", () => {
  test.each(
    WITH_TRIGGER.map((entry: ModelTriggers): [string, ModelTriggers] => {
      return [entry.modelName, entry];
    }),
  )(
    "%s: named and filed like its other triggers",
    (_name: string, entry: ModelTriggers) => {
      const trigger: ComponentMetadata = byOperation(
        entry,
        DatabaseOperation.OnCreateOrUpdate,
      )!;
      const onUpdate: ComponentMetadata = byOperation(
        entry,
        DatabaseOperation.OnUpdate,
      )!;

      expect(trigger.id).toBe(
        getCreateOrUpdateTriggerId(entry.model.tableName!),
      );
      expect(isCreateOrUpdateTrigger(trigger)).toBe(true);
      expect(trigger.title).toBe(
        `On Create or Update ${entry.model.singularName}`,
      );
      expect(trigger.description).toBe(
        `When the ${entry.model.singularName} is created or updated...`,
      );
      expect(trigger.componentType).toBe(ComponentType.Trigger);
      expect(trigger.category).toBe(onUpdate.category);
      expect(trigger.tableName).toBe(onUpdate.tableName);
      expect(trigger.iconProp).toBe(onUpdate.iconProp);
      expect(trigger.inPorts).toEqual([]);
      expect(
        trigger.outPorts.map((port: { id: string; title: string }) => {
          return [port.id, port.title];
        }),
      ).toEqual([["success", "Success"]]);
    },
  );

  /*
   * Workflow.triggerId holds the id of a workflow's trigger, and the runner
   * finds a workflow's runs by it: one too long for the column could never
   * be saved.
   */
  test("every id fits the column a workflow keeps its trigger in", () => {
    const column: ColumnMetadataArgs | undefined = getMetadataArgsStorage()
      .columns.filter((candidate: ColumnMetadataArgs): boolean => {
        return (
          candidate.target === Workflow &&
          candidate.propertyName === "triggerId"
        );
      })
      .pop();
    const length: number = Number(column?.options.length);

    expect(length).toBeGreaterThan(0);

    for (const entry of WITH_TRIGGER) {
      expect({
        id: byOperation(entry, DatabaseOperation.OnCreateOrUpdate)!.id,
        fits:
          byOperation(entry, DatabaseOperation.OnCreateOrUpdate)!.id.length <=
          length,
      }).toEqual({
        id: byOperation(entry, DatabaseOperation.OnCreateOrUpdate)!.id,
        fits: true,
      });
    }
  });

  test("no two steps of the whole catalog share an id", () => {
    const ids: Array<string> = MODELS.flatMap(
      (entry: ModelTriggers): Array<string> => {
        return entry.components.map((component: ComponentMetadata): string => {
          return component.id;
        });
      },
    );

    expect(new Set(ids).size).toBe(ids.length);
  });
});

describe("its settings are On Update's", () => {
  test.each(
    WITH_TRIGGER.map((entry: ModelTriggers): [string, ModelTriggers] => {
      return [entry.modelName, entry];
    }),
  )(
    "%s: Fields to watch, then Fields to pass on, as On Update has them",
    (_name: string, entry: ModelTriggers) => {
      const trigger: ComponentMetadata = byOperation(
        entry,
        DatabaseOperation.OnCreateOrUpdate,
      )!;
      const onUpdate: ComponentMetadata = byOperation(
        entry,
        DatabaseOperation.OnUpdate,
      )!;

      const shape: (argument: Argument) => Partial<Argument> = (
        argument: Argument,
      ): Partial<Argument> => {
        return {
          id: argument.id,
          name: argument.name,
          type: argument.type,
          required: argument.required,
          placeholder: argument.placeholder,
        };
      };

      expect(trigger.arguments.map(shape)).toEqual(
        onUpdate.arguments.map(shape),
      );
      // Fields to pass on reads the same; only Fields to watch says more.
      expect(argumentOf(trigger.arguments, "select")?.description).toBe(
        argumentOf(onUpdate.arguments, "select")?.description,
      );
    },
  );

  test("the two lists are Fields to watch and Fields to pass on, optional and required", () => {
    const watch: Argument = argumentOf(
      INCIDENT_TRIGGER.arguments,
      "listen-on",
    )!;
    const passOn: Argument = argumentOf(INCIDENT_TRIGGER.arguments, "select")!;

    expect(watch.name).toBe(WATCHED_FIELDS_NAME);
    expect(watch.type).toBe(ComponentInputType.Select);
    expect(watch.required).toBe(false);
    expect(passOn.name).toBe(SELECT_FIELDS_NAME);
    expect(passOn.type).toBe(ComponentInputType.Select);
    expect(passOn.required).toBe(true);
  });

  /*
   * A create always runs it: Fields to watch narrows the updates only, and
   * its one line says so where On Update's says what empty means.
   */
  test("Fields to watch says it is about updates, and that a new record always runs", () => {
    expect(
      argumentOf(INCIDENT_TRIGGER.arguments, "listen-on")?.description,
    ).toBe(
      "Run on an update only when it changes one of these fields. A new Incident always runs this workflow. Leave it empty to run on every change.",
    );
    // On Update's line is as it was.
    expect(
      argumentOf(INCIDENT_ON_UPDATE.arguments, "listen-on")?.description,
    ).toBe(
      "Run only when an update changes one of these fields. Leave it empty to run on every change to the Incident.",
    );
  });

  test("a new one starts by passing on the field that names its record, as On Update does", () => {
    for (const entry of WITH_TRIGGER) {
      const trigger: ComponentMetadata = byOperation(
        entry,
        DatabaseOperation.OnCreateOrUpdate,
      )!;
      const onUpdate: ComponentMetadata = byOperation(
        entry,
        DatabaseOperation.OnUpdate,
      )!;

      expect(getNewStepArguments(trigger.id, trigger.tableName)).toEqual(
        getNewStepArguments(onUpdate.id, onUpdate.tableName),
      );
    }

    expect(
      getNewStepArguments(INCIDENT_TRIGGER.id, INCIDENT_TRIGGER.tableName),
    ).toEqual({ select: { [getDisplayColumn(new Incident()).id]: true } });
    expect(getDisplayColumn(new Incident()).id).toBe("title");
  });
});

describe("what it hands on", () => {
  test("the record, as On Update hands it, then What Happened", () => {
    const record: ReturnValue = INCIDENT_TRIGGER.returnValues[0]!;
    const whatHappened: ReturnValue = INCIDENT_TRIGGER.returnValues[1]!;

    expect(INCIDENT_TRIGGER.returnValues).toHaveLength(2);
    expect(record.id).toBe("model");
    expect(record.name).toBe(INCIDENT_ON_UPDATE.returnValues[0]!.name);
    expect(record.type).toBe(ComponentInputType.BaseModel);
    expect(record.description).toBe("The Incident that was created or updated");

    expect(whatHappened.id).toBe(WHAT_HAPPENED_ID);
    expect(whatHappened.name).toBe(WHAT_HAPPENED_NAME);
    expect(whatHappened.type).toBe(ComponentInputType.Text);
    expect(whatHappened.required).toBe(true);
    expect(whatHappened.description).toBe(
      '"created" when the Incident was just created, "updated" when it was just updated.',
    );
  });

  test("every model's trigger hands on its record and What Happened, nothing else", () => {
    for (const entry of WITH_TRIGGER) {
      expect(
        byOperation(
          entry,
          DatabaseOperation.OnCreateOrUpdate,
        )!.returnValues.map((returnValue: ReturnValue): string => {
          return returnValue.id;
        }),
      ).toEqual(["model", WHAT_HAPPENED_ID]);
    }
  });
});

describe("Run Workflow", () => {
  test("asks for the record as the other record triggers do, then What Happened", () => {
    const runArguments: Array<Argument> =
      INCIDENT_TRIGGER.runWorkflowManuallyArguments || [];

    expect(
      runArguments.map((argument: Argument): string => {
        return argument.id;
      }),
    ).toEqual(["_id", WHAT_HAPPENED_ID]);
    expect(runArguments[0]).toEqual(
      (INCIDENT_ON_UPDATE.runWorkflowManuallyArguments || [])[0],
    );
    expect(getRunRecordArgument(INCIDENT_TRIGGER)).toEqual(
      getRunRecordArgument(INCIDENT_ON_UPDATE),
    );
  });

  test("What Happened is a choice of the two, created first, and never required", () => {
    const whatHappened: Argument = argumentOf(
      INCIDENT_TRIGGER.runWorkflowManuallyArguments,
      WHAT_HAPPENED_ID,
    )!;

    expect(whatHappened.name).toBe(WHAT_HAPPENED_NAME);
    expect(whatHappened.type).toBe(ComponentInputType.Choice);
    expect(whatHappened.required).toBe(false);
    expect(whatHappened.choices).toEqual([
      { value: WhatHappened.Created, label: "Just created" },
      { value: WhatHappened.Updated, label: "Just updated" },
    ]);
  });

  test("the other record triggers ask no such question", () => {
    for (const operation of [
      DatabaseOperation.OnCreate,
      DatabaseOperation.OnUpdate,
      DatabaseOperation.OnDelete,
    ]) {
      expect(
        argumentOf(
          incidentStep(operation).runWorkflowManuallyArguments,
          WHAT_HAPPENED_ID,
        ),
      ).toBeUndefined();
    }
  });

  test("the panel knows it as a record trigger, created or updated", () => {
    const info: RunRecordTriggerInfo =
      getRunRecordTriggerInfo(INCIDENT_TRIGGER)!;

    expect(info.event).toBe(RunRecordEvent.CreatedOrUpdated);
    expect(info.singularName).toBe("Incident");
    expect(info.hasNumber).toBe(true);
    expect(info.hasName).toBe(true);
    expect(info.whatHappenedArgument?.id).toBe(WHAT_HAPPENED_ID);

    // The other three have no such question to ask.
    for (const operation of [
      DatabaseOperation.OnCreate,
      DatabaseOperation.OnUpdate,
      DatabaseOperation.OnDelete,
    ]) {
      expect(
        getRunRecordTriggerInfo(incidentStep(operation))?.whatHappenedArgument,
      ).toBeUndefined();
    }
  });

  test("what the run is for follows What Happened: created until it says updated", () => {
    const info: RunRecordTriggerInfo =
      getRunRecordTriggerInfo(INCIDENT_TRIGGER)!;

    expect(getRunRecordEvent(info, {})).toBe(RunRecordEvent.Created);
    expect(getRunRecordEvent(info, null)).toBe(RunRecordEvent.Created);
    expect(getRunRecordEvent(info, { [WHAT_HAPPENED_ID]: "created" })).toBe(
      RunRecordEvent.Created,
    );
    expect(getRunRecordEvent(info, { [WHAT_HAPPENED_ID]: "updated" })).toBe(
      RunRecordEvent.Updated,
    );
    expect(getRunRecordEvent(info, { [WHAT_HAPPENED_ID]: " UPDATED " })).toBe(
      RunRecordEvent.Updated,
    );
    expect(getRunRecordEvent(info, { [WHAT_HAPPENED_ID]: "deleted" })).toBe(
      RunRecordEvent.Created,
    );

    expect(withRunRecordEvent(info, { [WHAT_HAPPENED_ID]: "updated" })).toEqual(
      { ...info, event: RunRecordEvent.Updated },
    );
  });

  test("the other record triggers keep their own event, whatever the values say", () => {
    for (const [operation, event] of [
      [DatabaseOperation.OnCreate, RunRecordEvent.Created],
      [DatabaseOperation.OnUpdate, RunRecordEvent.Updated],
      [DatabaseOperation.OnDelete, RunRecordEvent.Deleted],
    ] as Array<[DatabaseOperation, RunRecordEvent]>) {
      const info: RunRecordTriggerInfo = getRunRecordTriggerInfo(
        incidentStep(operation),
      )!;

      expect(getRunRecordEvent(info, { [WHAT_HAPPENED_ID]: "updated" })).toBe(
        event,
      );
      // Untouched, the very same object.
      expect(withRunRecordEvent(info, { [WHAT_HAPPENED_ID]: "created" })).toBe(
        info,
      );
    }
  });
});

describe("its id is the model's", () => {
  test("in dashes, like every generated step's", () => {
    expect(INCIDENT_TRIGGER.id).toBe(
      `${Text.pascalCaseToDashes("Incident")}-on-create-or-update`,
    );
  });
});
