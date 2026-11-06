/*
 * What a {{...}} in a step's setting comes to when it finds no value
 * (Types/Workflow/EmptyValues, issue 5761): which settings take an empty value,
 * and what a reference that found nothing reads of an earlier step's record.
 */

import Alert from "../../../Models/DatabaseModels/Alert";
import Incident from "../../../Models/DatabaseModels/Incident";
import { JSONObject, JSONValue } from "../../../Types/JSON";
import ComponentMetadata, {
  Argument,
  ComponentInputType,
  ComponentType,
  NodeDataProp,
  NodeType,
} from "../../../Types/Workflow/Component";
import ComponentID from "../../../Types/Workflow/ComponentID";
import APIComponents from "../../../Types/Workflow/Components/API";
import BaseModelComponents from "../../../Types/Workflow/Components/BaseModel";
import ConditionComponents, {
  CONDITION_ARGUMENT_IDS,
} from "../../../Types/Workflow/Components/Condition";
import EmailComponents from "../../../Types/Workflow/Components/Email";
import JavaScriptComponents from "../../../Types/Workflow/Components/JavaScript";
import SlackComponents from "../../../Types/Workflow/Components/Slack";
import {
  RecordFieldReading,
  RecordFieldReadingKind,
  isEmptyRecordField,
  readRecordField,
  takesEmptyValues,
  whatToDoAboutRecordField,
} from "../../../Types/Workflow/EmptyValues";
import { describe, expect, test } from "@jest/globals";

const ALERT_STEPS: Array<ComponentMetadata> = BaseModelComponents.getComponents(
  new Alert(),
);

type FindStepFunction = (
  steps: Array<ComponentMetadata>,
  id: string,
) => ComponentMetadata;

const findStep: FindStepFunction = (
  steps: Array<ComponentMetadata>,
  id: string,
): ComponentMetadata => {
  const found: ComponentMetadata | undefined = steps.find(
    (step: ComponentMetadata): boolean => {
      return step.id === id;
    },
  );

  if (!found) {
    throw new Error(`There is no step ${id}.`);
  }

  return found;
};

type ArgumentOfFunction = (metadata: ComponentMetadata, id: string) => Argument;

const argumentOf: ArgumentOfFunction = (
  metadata: ComponentMetadata,
  id: string,
): Argument => {
  const found: Argument | undefined = metadata.arguments.find(
    (argument: Argument): boolean => {
      return argument.id === id;
    },
  );

  if (!found) {
    throw new Error(`${metadata.id} has no argument ${id}.`);
  }

  return found;
};

type TakesFunction = (metadata: ComponentMetadata, id: string) => boolean;

const takes: TakesFunction = (
  metadata: ComponentMetadata,
  id: string,
): boolean => {
  return takesEmptyValues({
    metadata: metadata,
    argument: argumentOf(metadata, id),
  });
};

describe("takesEmptyValues", () => {
  const SLACK: ComponentMetadata = findStep(
    SlackComponents,
    "slack-send-message-to-channel",
  );

  test("a message takes one", () => {
    expect(takes(SLACK, "text")).toBe(true);
  });

  test("an address does not, so that it never quietly becomes another", () => {
    expect(takes(SLACK, "webhook-url")).toBe(false);
  });

  test("an HTTP request's body and headers take one, and its URL does not", () => {
    const post: ComponentMetadata = findStep(
      APIComponents,
      ComponentID.ApiPost,
    );

    expect(takes(post, "request-body")).toBe(true);
    expect(takes(post, "request-headers")).toBe(true);
    expect(takes(post, "url")).toBe(false);
  });

  test("If / Else's value takes one, so is empty sees it empty", () => {
    const ifElse: ComponentMetadata = findStep(
      ConditionComponents,
      ComponentID.IfElse,
    );

    expect(takes(ifElse, CONDITION_ARGUMENT_IDS.valueToCheck)).toBe(true);
    expect(takes(ifElse, CONDITION_ARGUMENT_IDS.compareWith)).toBe(true);
  });

  /*
   * Its addresses are text, so an empty one stops the step ("To Email not
   * found") where a mail used to go to the reference as written.
   */
  test("an email's body, subject and addresses take one, and its password does not", () => {
    const email: ComponentMetadata = EmailComponents[0] as ComponentMetadata;

    expect(takes(email, "subject")).toBe(true);
    expect(takes(email, "email-body")).toBe(true);
    expect(takes(email, "to")).toBe(true);
    expect(takes(email, "smtp-password")).toBe(false);
    expect(takes(email, "smtp-port")).toBe(false);
  });

  // `const x = {{...}};` is code, and `const x = ;` does not run.
  test("JavaScript does not", () => {
    const javaScript: ComponentMetadata =
      JavaScriptComponents[0] as ComponentMetadata;

    expect(takes(javaScript, "code")).toBe(false);
  });

  /*
   * An ID that is blank is not harmless the way it is in a message: a Query's
   * {"monitorId": null} matches every alert with no monitor, on a Delete Many
   * too. So nothing a step that reads or writes records is given takes one,
   * and the step stops on the reference (UnresolvedIdReference).
   */
  test.each([
    ["alert-find-one", "query"],
    ["alert-find-one", "select"],
    ["alert-find-many", "query"],
    ["alert-update-one", "query"],
    ["alert-update-one", "data"],
    ["alert-update-many", "query"],
    ["alert-update-many", "data"],
    ["alert-delete-one", "query"],
    ["alert-delete-many", "query"],
    ["alert-create-one", "json"],
    ["alert-create-many", "json-array"],
  ])("%s's %s does not", (stepId: string, argumentId: string) => {
    expect(takes(findStep(ALERT_STEPS, stepId), argumentId)).toBe(false);
  });

  test("every setting of every record step does not, whatever its type", () => {
    for (const step of ALERT_STEPS) {
      for (const argument of step.arguments) {
        expect({
          step: step.id,
          argument: argument.id,
          takes: takesEmptyValues({ metadata: step, argument: argument }),
        }).toEqual({ step: step.id, argument: argument.id, takes: false });
      }
    }
  });

  test.each(
    (Object.values(ComponentInputType) as Array<ComponentInputType>).map(
      (type: ComponentInputType): [ComponentInputType, boolean] => {
        return [
          type,
          [
            ComponentInputType.Text,
            ComponentInputType.LongText,
            ComponentInputType.Markdown,
            ComponentInputType.HTML,
            ComponentInputType.AnyValue,
            ComponentInputType.JSON,
            ComponentInputType.JSONArray,
            ComponentInputType.StringDictionary,
            ComponentInputType.SwitchCases,
          ].includes(type),
        ];
      },
    ),
  )("a %s setting: %s", (type: ComponentInputType, expected: boolean) => {
    expect(
      takesEmptyValues({
        metadata: { tableName: undefined } as ComponentMetadata,
        argument: { type: type } as Argument,
      }),
    ).toBe(expected);
  });
});

type RecordStepFunction = (data: {
  metadataId: string;
  select?: JSONObject | string | undefined;
  steps?: Array<ComponentMetadata> | undefined;
}) => NodeDataProp;

const recordStep: RecordStepFunction = (data: {
  metadataId: string;
  select?: JSONObject | string | undefined;
  steps?: Array<ComponentMetadata> | undefined;
}): NodeDataProp => {
  const metadata: ComponentMetadata = findStep(
    data.steps || ALERT_STEPS,
    data.metadataId,
  );

  return {
    error: "",
    id: "step-1",
    nodeType: NodeType.Node,
    metadata: metadata,
    metadataId: metadata.id,
    internalId: "internal",
    arguments: data.select === undefined ? {} : { select: data.select },
    returnValues: {},
    componentType: ComponentType.Component,
  };
};

const PATH: (returnValueId: string, deeper: string) => string = (
  returnValueId: string,
  deeper: string,
): string => {
  return `local.components.step-1.returnValues.${returnValueId}${deeper}`;
};

type ReadFunction = (data: {
  step?: NodeDataProp | undefined;
  path: string;
  returned?: JSONObject | undefined;
}) => RecordFieldReading | null;

const read: ReadFunction = (data: {
  step?: NodeDataProp | undefined;
  path: string;
  returned?: JSONObject | undefined;
}): RecordFieldReading | null => {
  return readRecordField({
    path: data.path,
    getStep: (componentId: string): NodeDataProp | undefined => {
      return componentId === "step-1" ? data.step : undefined;
    },
    storageMap: {
      local: {
        variables: {},
        components:
          data.returned === undefined
            ? {}
            : { "step-1": { returnValues: data.returned } },
      },
      global: { variables: {} },
    },
  });
};

const ON_CREATE: NodeDataProp = recordStep({
  metadataId: "alert-on-create",
  select: {
    title: true,
    customFields: true,
    monitor: { name: true },
    labels: { name: true },
  },
});

describe("readRecordField", () => {
  const RECORD: JSONObject = {
    _id: "a-1",
    title: "t",
    customFields: {},
    monitor: { _id: "m-1", name: "Checkout" },
  };

  test("a field the step leaves out, of a record it returned", () => {
    expect(
      read({
        step: ON_CREATE,
        path: PATH("model", ".description"),
        returned: { model: RECORD },
      }),
    ).toEqual({
      kind: RecordFieldReadingKind.NotPassedOn,
      step: ON_CREATE,
      fieldPath: "description",
    });
  });

  test("a related record the step leaves out", () => {
    expect(
      read({
        step: ON_CREATE,
        path: PATH("model", ".currentAlertState.name"),
        returned: { model: RECORD },
      })?.kind,
    ).toBe(RecordFieldReadingKind.NotPassedOn);
  });

  test("a related record's other field", () => {
    expect(
      read({
        step: ON_CREATE,
        path: PATH("model", ".monitor.description"),
        returned: { model: RECORD },
      }),
    ).toEqual({
      kind: RecordFieldReadingKind.NotPassedOn,
      step: ON_CREATE,
      fieldPath: "monitor.description",
    });
  });

  test("a field of a record the step found none of", () => {
    expect(
      read({
        step: ON_CREATE,
        path: PATH("model", ".description"),
        returned: { model: null },
      })?.kind,
    ).toBe(RecordFieldReadingKind.NotPassedOn);
  });

  test("a field of an item of the records a Find Many returned", () => {
    expect(
      read({
        step: recordStep({
          metadataId: "alert-find-many",
          select: { title: true },
        }),
        path: PATH("models[0]", ".description"),
        returned: { models: [RECORD] },
      }),
    ).toMatchObject({
      kind: RecordFieldReadingKind.NotPassedOn,
      fieldPath: "description",
    });
  });

  test("any field but the ID of what On Delete passes on", () => {
    expect(
      read({
        step: recordStep({ metadataId: "alert-on-delete" }),
        path: PATH("model", ".title"),
        returned: { model: { _id: "a-1" } },
      })?.kind,
    ).toBe(RecordFieldReadingKind.NotPassedOn);
  });

  /*
   * {"alertSeverity": true} reads the severity's ID and nothing else
   * (SelectUtil.sanitizeSelect), so its name is no more there than a field
   * left out of the list.
   */
  test("a field of a related record asked for without naming any", () => {
    const step: NodeDataProp = recordStep({
      metadataId: "alert-on-create",
      select: { alertSeverity: true },
    });

    expect(
      read({
        step: step,
        path: PATH("model", ".alertSeverity.name"),
        returned: { model: { _id: "a-1", alertSeverity: { _id: "s-1" } } },
      }),
    ).toEqual({
      kind: RecordFieldReadingKind.NotPassedOn,
      step: step,
      fieldPath: "alertSeverity.name",
    });
  });

  test("a field of an item of a related list asked for without naming any", () => {
    expect(
      read({
        step: recordStep({
          metadataId: "alert-on-create",
          select: { labels: true },
        }),
        path: PATH("model", ".labels[0].name"),
        returned: { model: { _id: "a-1", labels: [{ _id: "l-1" }] } },
      })?.kind,
    ).toBe(RecordFieldReadingKind.NotPassedOn);
  });

  test("Fields to pass on that cannot be read say nothing of a related record's field", () => {
    expect(
      read({
        step: recordStep({ metadataId: "alert-on-create", select: "{broken" }),
        path: PATH("model", ".monitor.name"),
        returned: { model: RECORD },
      }),
    ).toBeNull();
  });

  test("past a field of a related record reads nothing it could have passed on", () => {
    expect(
      read({
        step: ON_CREATE,
        path: PATH("model", ".monitor.name.first"),
        returned: { model: RECORD },
      }),
    ).toBeNull();
  });

  test("a key a JSON field does not hold: a custom field this record has none of", () => {
    expect(
      read({
        step: ON_CREATE,
        path: PATH("model", ".customFields.Impact"),
        returned: { model: RECORD },
      }),
    ).toEqual({
      kind: RecordFieldReadingKind.NotInJSONField,
      step: ON_CREATE,
      fieldPath: "customFields.Impact",
    });
  });

  test("a field the record does not have is no field, passed on or not", () => {
    expect(
      read({
        step: ON_CREATE,
        path: PATH("model", ".monitorr.name"),
        returned: { model: RECORD },
      }),
    ).toEqual({
      kind: RecordFieldReadingKind.NoSuchField,
      step: ON_CREATE,
      fieldPath: "monitorr.name",
    });
  });

  test("a field the related record does not have is no field", () => {
    expect(
      read({
        step: ON_CREATE,
        path: PATH("model", ".monitor.nmae"),
        returned: { model: RECORD },
      })?.kind,
    ).toBe(RecordFieldReadingKind.NoSuchField);
  });

  test("a field the record has, on an incident as on an alert", () => {
    expect(
      read({
        step: recordStep({
          metadataId: "incident-on-create",
          select: { title: true },
          steps: BaseModelComponents.getComponents(new Incident()),
        }),
        path: PATH("model", ".currentIncidentState.name"),
        returned: { model: { _id: "i-1", title: "t" } },
      })?.kind,
    ).toBe(RecordFieldReadingKind.NotPassedOn);
  });

  // Passed on and not there says nothing: left as written, as anything else is.
  test.each([
    ["a field it passes on", ".title"],
    ["a related record's field it passes on", ".monitor.name"],
    ["the record's ID", "._id"],
    ["the whole record", ""],
  ])("%s says nothing", (_name: string, deeper: string) => {
    expect(
      read({
        step: ON_CREATE,
        path: PATH("model", deeper),
        returned: { model: {} },
      }),
    ).toBeNull();
  });

  test("a step that did not return it says nothing", () => {
    // The step did not run, or took its Error output.
    expect(
      read({ step: ON_CREATE, path: PATH("model", ".description") }),
    ).toBeNull();
    expect(
      read({
        step: ON_CREATE,
        path: PATH("model", ".description"),
        returned: {},
      }),
    ).toBeNull();
  });

  test("a step the workflow does not have says nothing", () => {
    expect(
      read({ path: PATH("model", ".title"), returned: { model: RECORD } }),
    ).toBeNull();
  });

  test("a step that is no record step says nothing", () => {
    const slack: ComponentMetadata = findStep(
      SlackComponents,
      "slack-send-message-to-channel",
    );

    expect(
      read({
        step: { id: "step-1", metadata: slack } as NodeDataProp,
        path: PATH("error", ".description"),
        returned: { error: "x" },
      }),
    ).toBeNull();
  });

  test("a value of a record step that is no record says nothing", () => {
    expect(
      read({
        step: recordStep({ metadataId: "alert-delete-many" }),
        path: PATH("items-deleted", ".description"),
        returned: { "items-deleted": 3 as JSONValue },
      } as never),
    ).toBeNull();
  });

  test("Fields to pass on that cannot be read say nothing about what is left out", () => {
    expect(
      read({
        step: recordStep({ metadataId: "alert-on-create", select: "{broken" }),
        path: PATH("model", ".description"),
        returned: { model: RECORD },
      }),
    ).toBeNull();
  });

  test.each([
    ["a variable", "local.variables.x"],
    ["a global variable", "global.variables.x"],
    ["a mistyped root", "local.componets.step-1.returnValues.model.title"],
    ["nothing", ""],
  ])("%s says nothing", (_name: string, path: string) => {
    expect(
      read({ step: ON_CREATE, path: path, returned: { model: RECORD } }),
    ).toBeNull();
  });
});

describe("isEmptyRecordField", () => {
  const reading: (kind: RecordFieldReadingKind) => RecordFieldReading = (
    kind: RecordFieldReadingKind,
  ): RecordFieldReading => {
    return { kind: kind, step: ON_CREATE, fieldPath: "x" };
  };

  test("a field left out is empty, as the builder says it is", () => {
    expect(
      isEmptyRecordField(reading(RecordFieldReadingKind.NotPassedOn)),
    ).toBe(true);
  });

  test("a key a JSON field does not hold is empty", () => {
    expect(
      isEmptyRecordField(reading(RecordFieldReadingKind.NotInJSONField)),
    ).toBe(true);
  });

  test("a field that does not exist is left to show", () => {
    expect(
      isEmptyRecordField(reading(RecordFieldReadingKind.NoSuchField)),
    ).toBe(false);
  });

  test("nothing known is left to show", () => {
    expect(isEmptyRecordField(null)).toBe(false);
  });
});

describe("whatToDoAboutRecordField", () => {
  test("names the step and the setting to add the field to", () => {
    expect(
      whatToDoAboutRecordField({
        kind: RecordFieldReadingKind.NotPassedOn,
        step: ON_CREATE,
        fieldPath: "monitor.name",
      }),
    ).toBe(
      `"${ON_CREATE.metadata.title}" does not pass on monitor.name. Add it to that step's Fields to pass on.`,
    );
  });

  test("names the field that has no such name", () => {
    expect(
      whatToDoAboutRecordField({
        kind: RecordFieldReadingKind.NoSuchField,
        step: ON_CREATE,
        fieldPath: "monitorr.name",
      }),
    ).toBe(
      `"${ON_CREATE.metadata.title}" returns no field called monitorr.name. Check its spelling.`,
    );
  });

  test("a key a JSON field does not hold is not a field to add", () => {
    const message: string = whatToDoAboutRecordField({
      kind: RecordFieldReadingKind.NotInJSONField,
      step: ON_CREATE,
      fieldPath: "customFields.Impact",
    });

    expect(message).toBe(
      `The record "${ON_CREATE.metadata.title}" returned holds no customFields.Impact.`,
    );
    expect(message).not.toContain("Fields to pass on");
  });

  test("On Delete has no field to add: the record is gone", () => {
    const step: NodeDataProp = recordStep({ metadataId: "alert-on-delete" });

    expect(
      whatToDoAboutRecordField({
        kind: RecordFieldReadingKind.NotPassedOn,
        step: step,
        fieldPath: "title",
      }),
    ).toBe(
      `"${step.metadata.title}" passes on only the ID: the record is already gone.`,
    );
  });
});
