/*
 * Every step's settings on a view (WorkflowViewOnly), rendered for real.
 *
 * A view is the Builder of someone who may open a workflow but not change
 * it. Each step's settings are held still one by one there: a list to pick
 * from is disabled, a code box shows its code to be read, a value box its
 * value, a grip picks nothing up (ArgumentsForm, WorkflowViewOnlyFieldset).
 * What only reads a setting stays usable: a code box's own Copy, and More
 * fields, to read what is folded - both were dead while one disabled
 * fieldset held a step's whole settings (#5320's follow-up).
 *
 * This sweeps every step there is - every built-in step and every record
 * step of a model - three ways: as just added, set up with values, and with
 * values from earlier steps (chips where a box would be). In every one,
 * nothing in the settings or the identifier may still take a press, a key or
 * typing, every code box is read only with its Copy free, and More fields
 * is free to open. A new control in any step that ignores the view fails
 * here, whatever it is drawn with; WorkflowViewOnlyGuard reads the same rule
 * in the source.
 */

import React from "react";

jest.mock("../../../../UI/Config", () => {
  const actual: Record<string, unknown> = jest.requireActual(
    "../../../../UI/Config",
  );
  const URLType: { fromString: (url: string) => unknown } = jest.requireActual(
    "../../../../Types/API/URL",
  ).default;

  return {
    __esModule: true,
    ...actual,
    WORKFLOW_URL: URLType.fromString("https://oneuptime.example.com/workflow"),
  };
});

// A record's fields, for every model a record step asks about.
jest.mock("../../../../UI/Utils/API/API", () => {
  const HTTPResponseType: new (
    status: number,
    data: unknown,
    headers: unknown,
  ) => unknown = jest.requireActual(
    "../../../../Types/API/HTTPResponse",
  ).default;
  const fixture: { INCIDENT_COLUMNS: Array<unknown> } = jest.requireActual(
    "./FieldPicker/FieldPickerFixture",
  );

  return {
    __esModule: true,
    default: {
      get: jest.fn(async () => {
        return new HTTPResponseType(
          200,
          { tableName: "Incident", columns: fixture.INCIDENT_COLUMNS },
          {},
        );
      }),
      post: jest.fn(async () => {
        return new HTTPResponseType(200, {}, {});
      }),
      getFriendlyMessage: jest.fn((error: unknown) => {
        return String(error);
      }),
    },
  };
});

jest.mock("../../../../UI/Utils/ModelAPI/ModelAPI", () => {
  return {
    __esModule: true,
    default: {
      getList: jest.fn(async () => {
        return { data: [], count: 0, skip: 0, limit: 10 };
      }),
      getItem: jest.fn(async () => {
        return null;
      }),
      count: jest.fn(async () => {
        return 0;
      }),
    },
  };
});

jest.mock("../../../../UI/Utils/Permission", () => {
  return {
    __esModule: true,
    default: {
      getAllPermissions: (): Array<unknown> => {
        return [];
      },
      getProjectPermissions: (): null => {
        return null;
      },
      getGlobalPermissions: (): null => {
        return null;
      },
    },
  };
});

jest.mock("../../../../UI/Utils/User", () => {
  return {
    __esModule: true,
    default: {
      isMasterAdmin: (): boolean => {
        return false;
      },
      getUserId: (): null => {
        return null;
      },
    },
  };
});

import ComponentSettingsModal from "../../../../UI/Components/Workflow/ComponentSettingsModal";
import { WORKFLOW_VIEW_ONLY_FIELDSET_SELECTOR } from "../../../../UI/Components/Workflow/WorkflowViewOnlyFieldset";
import { CONDITION_TEST_IDS } from "../../../../UI/Components/Workflow/Condition/ConditionEditor";
import { SWITCH_TEST_IDS } from "../../../../UI/Components/Workflow/Switch/SwitchEditor";
import {
  ArgumentControl,
  argumentControlFor,
} from "../../../../UI/Components/Workflow/ValuePicker/ArgumentControl";
import Incident from "../../../../Models/DatabaseModels/Incident";
import { JSONObject, JSONValue } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import ComponentMetadata, {
  Argument,
  ComponentInputType,
  NodeDataProp,
  NodeType,
  isArgumentShown,
} from "../../../../Types/Workflow/Component";
import ComponentID from "../../../../Types/Workflow/ComponentID";
import Components from "../../../../Types/Workflow/Components";
import BaseModelComponentFactory from "../../../../Types/Workflow/Components/BaseModel";
import getJestMockFunction from "../../../MockType";
import {
  CODE_COPY_SELECTOR,
  FOLD_HEADER_SELECTOR,
  LiveControl,
  findLiveControls,
  isHeldStill,
} from "./ViewOnlyControls";
import { afterEach, describe, expect, test } from "@jest/globals";
import "@testing-library/jest-dom";
import { cleanup, render, screen, waitFor } from "@testing-library/react";

const WORKFLOW_ID: ObjectID = new ObjectID(
  "b0c3f6d2-5d2e-4c55-9a0e-6f1e2d3c4b5a",
);

const VIEW_ONLY_REASON: string =
  "Changing this workflow takes permission to edit it. You need one of these permissions: Project Owner, Project Admin, Edit Workflow, Workflow Admin.";

const A_RECORD_ID: string = "3f2c1b0a-9d8e-4f7a-8b6c-5d4e3f2a1b0c";

// A model's record steps: Create, Find, Update, Delete and its triggers.
const RECORD_STEPS: Array<ComponentMetadata> =
  BaseModelComponentFactory.getComponents(new Incident());

// Every step there is: the built-in ones, and a model's record steps.
const EVERY_STEP: Array<ComponentMetadata> = [...Components, ...RECORD_STEPS];

enum Variant {
  JustAdded = "as just added",
  SetUp = "set up",
  FromEarlierSteps = "with values from earlier steps",
}

const REFERENCE: string = "{{local.variables.DEPLOY_ENV}}";

// A value of each kind, as a step stores it.
const plainValue: (arg: Argument) => JSONValue = (arg: Argument): JSONValue => {
  switch (arg.type) {
    case ComponentInputType.URL:
      return "https://deploys.example.com/hooks/checkout";
    case ComponentInputType.Email:
      return "ops@example.com";
    case ComponentInputType.LongText:
    case ComponentInputType.Markdown:
    case ComponentInputType.AnyValue:
      return "Checkout was deployed.\nNothing else changed.";
    case ComponentInputType.Number:
    case ComponentInputType.Decimal:
      return 5;
    case ComponentInputType.Password:
      return "deploy-secret";
    case ComponentInputType.Boolean:
      return true;
    case ComponentInputType.Date:
      return "2026-11-02";
    case ComponentInputType.DateTime:
      return "2026-11-02T10:00";
    case ComponentInputType.HTML:
      return "<p>Checkout was deployed.</p>";
    case ComponentInputType.JavaScript:
      return "return { ok: true };";
    case ComponentInputType.JSON:
    case ComponentInputType.BaseModel:
    case ComponentInputType.Query:
      return '{"title": "Checkout is down"}';
    case ComponentInputType.Select:
      return '{"title": true}';
    case ComponentInputType.JSONArray:
    case ComponentInputType.BaseModelArray:
      return '[{"title": "Checkout is down"}]';
    case ComponentInputType.StringDictionary:
      return { Authorization: "Bearer deploy-token" };
    case ComponentInputType.CronTab:
      return "*/5 * * * *";
    case ComponentInputType.Operator:
      return "==";
    case ComponentInputType.ValueType:
      return "text";
    case ComponentInputType.Choice:
      return (arg.choices || [])[0]?.value || "";
    case ComponentInputType.UserList:
    case ComponentInputType.TeamList:
    case ComponentInputType.OnCallScheduleList:
    case ComponentInputType.OnCallPolicyList:
      return [A_RECORD_ID];
    case ComponentInputType.WorkflowSelect:
    case ComponentInputType.IncidentTemplateSelect:
    case ComponentInputType.AlertSeveritySelect:
    case ComponentInputType.IncidentSeveritySelect:
      return A_RECORD_ID;
    case ComponentInputType.SwitchCases:
      return [
        { id: "case-1", comparison: "<", value: "300", compareAs: "number" },
        { id: "case-2", comparison: "==", value: "n/a", compareAs: "text" },
      ] as unknown as JSONValue;
    case ComponentInputType.Text:
    default:
      return "Deploy finished";
  }
};

// The same, taken from an earlier step wherever a setting can hold one.
const referenceValue: (arg: Argument) => JSONValue = (
  arg: Argument,
): JSONValue => {
  switch (arg.type) {
    case ComponentInputType.HTML:
      return `<p>${REFERENCE} was deployed.</p>`;
    case ComponentInputType.JavaScript:
      return "return { ok: args.status === 'deployed' };";
    case ComponentInputType.JSON:
    case ComponentInputType.BaseModel:
    case ComponentInputType.Query:
      return `{"title": "${REFERENCE}"}`;
    case ComponentInputType.Select:
    case ComponentInputType.JSONArray:
    case ComponentInputType.BaseModelArray:
      return REFERENCE;
    case ComponentInputType.StringDictionary:
      return { Authorization: `Bearer ${REFERENCE}` };
    case ComponentInputType.Choice:
      return (arg.choices || [])[0]?.value || "";
    case ComponentInputType.UserList:
    case ComponentInputType.TeamList:
    case ComponentInputType.OnCallScheduleList:
    case ComponentInputType.OnCallPolicyList:
      return [REFERENCE];
    case ComponentInputType.SwitchCases:
      return plainValue(arg);
    default:
      return REFERENCE;
  }
};

const argumentsFor: (
  metadata: ComponentMetadata,
  variant: Variant,
) => JSONObject = (
  metadata: ComponentMetadata,
  variant: Variant,
): JSONObject => {
  const args: JSONObject = {};

  if (variant === Variant.JustAdded) {
    return args;
  }

  for (const arg of metadata.arguments || []) {
    args[arg.id] =
      variant === Variant.SetUp ? plainValue(arg) : referenceValue(arg);
  }

  return args;
};

const stepOf: (
  metadata: ComponentMetadata,
  args: JSONObject,
) => NodeDataProp = (
  metadata: ComponentMetadata,
  args: JSONObject,
): NodeDataProp => {
  const id: string = `${metadata.id}-1`;

  return {
    error: "",
    id: id,
    nodeType: NodeType.Node,
    metadata: metadata,
    metadataId: metadata.id,
    internalId: `internal-${id}`,
    arguments: args,
    returnValues: {},
    componentType: metadata.componentType,
  };
};

const settingsView: () => HTMLElement | null = (): HTMLElement | null => {
  return screen.queryByTestId("workflow-component-settings-view-only");
};

// Waits until the step's settings are drawn: no loader, every shown setting named.
const settled: (
  metadata: ComponentMetadata,
  args: JSONObject,
) => Promise<void> = async (
  metadata: ComponentMetadata,
  args: JSONObject,
): Promise<void> => {
  await waitFor(() => {
    const settings: HTMLElement | null = settingsView();

    if (!(metadata.arguments || []).length) {
      return;
    }

    expect(settings).not.toBeNull();
    expect(
      settings!.querySelector('[data-testid="component-loader"]'),
    ).toBeNull();
    expect(
      settings!.querySelector('[role="status"][data-testid$="-loading"]'),
    ).toBeNull();

    if (
      metadata.id === ComponentID.IfElse ||
      metadata.id === ComponentID.Switch
    ) {
      expect(
        settings!.querySelector(
          `[data-testid="${CONDITION_TEST_IDS.root}"], [data-testid="${SWITCH_TEST_IDS.root}"]`,
        ),
      ).not.toBeNull();
      return;
    }

    for (const arg of metadata.arguments || []) {
      if (isArgumentShown(arg, args)) {
        expect([metadata.id, settings!.textContent]).toEqual([
          metadata.id,
          expect.stringContaining(arg.name),
        ]);
      }
    }
  });
};

afterEach(() => {
  cleanup();
});

describe("the sweep reads every kind of setting control there is", () => {
  test("every built-in step, and a model's record steps", () => {
    expect(Components.length).toBeGreaterThan(30);
    expect(EVERY_STEP).toHaveLength(Components.length + RECORD_STEPS.length);
    // The record steps draw the field list and the record editor.
    expect(
      RECORD_STEPS.filter((metadata: ComponentMetadata): boolean => {
        return Boolean(metadata.tableName);
      }).length,
    ).toBeGreaterThan(5);
  });

  test("among them, every control a setting is drawn with", () => {
    const controls: Set<string> = new Set<string>();

    for (const metadata of EVERY_STEP) {
      for (const arg of metadata.arguments || []) {
        for (const value of [undefined, plainValue(arg), referenceValue(arg)]) {
          controls.add(
            argumentControlFor({
              type: arg.type,
              value: value,
              isRowsDictionary:
                arg.type === ComponentInputType.StringDictionary,
            }),
          );
        }
      }
    }

    expect(Array.from(controls).sort()).toEqual(
      expect.arrayContaining([
        ArgumentControl.Text,
        ArgumentControl.MultiLineText,
        ArgumentControl.Number,
        ArgumentControl.Password,
        ArgumentControl.Boolean,
        ArgumentControl.JSONCode,
        ArgumentControl.HTMLCode,
        ArgumentControl.KeyValueRows,
        ArgumentControl.ChoiceRows,
        ArgumentControl.RecordList,
        ArgumentControl.Plain,
      ]),
    );

    // And the editors of their own.
    const ids: Array<string> = EVERY_STEP.map(
      (metadata: ComponentMetadata): string => {
        return metadata.id;
      },
    );

    expect(ids).toEqual(
      expect.arrayContaining([
        ComponentID.IfElse,
        ComponentID.Switch,
        ComponentID.Schedule,
      ]),
    );
  });
});

// A step's settings dialog on a view, drawn and settled.
const renderInView: (
  metadata: ComponentMetadata,
  variant: Variant,
) => Promise<HTMLElement | null> = async (
  metadata: ComponentMetadata,
  variant: Variant,
): Promise<HTMLElement | null> => {
  const args: JSONObject = argumentsFor(metadata, variant);

  render(
    <ComponentSettingsModal
      title={metadata.title}
      description={metadata.description}
      onClose={getJestMockFunction()}
      onSave={getJestMockFunction()}
      onDelete={getJestMockFunction()}
      component={stepOf(metadata, args)}
      graphComponents={[stepOf(metadata, args)]}
      workflowId={WORKFLOW_ID}
      readOnlyReason={VIEW_ONLY_REASON}
    />,
  );

  await settled(metadata, args);

  return settingsView();
};

const stepWithId: (id: string) => ComponentMetadata = (
  id: string,
): ComponentMetadata => {
  const metadata: ComponentMetadata | undefined = EVERY_STEP.find(
    (candidate: ComponentMetadata): boolean => {
      return candidate.id === id;
    },
  );

  if (!metadata) {
    throw new Error(`No step ${id}`);
  }

  return metadata;
};

/*
 * The sweep below holds every step to the same three things. Here, a step of
 * each kind is drawn to show it meets them - a code box, More fields, a
 * field list, a record editor, a value from an earlier step as a chip, the
 * people a page goes to - so the sweep is never true for having drawn none.
 */
describe("the sweep meets what it checks", () => {
  test("a request's code box and its More fields", async () => {
    const settings: HTMLElement | null = await renderInView(
      stepWithId(ComponentID.ApiPost),
      Variant.SetUp,
    );

    expect(settings!.querySelectorAll("[data-code-type]").length).toBe(1);
    expect(settings!.querySelectorAll(FOLD_HEADER_SELECTOR).length).toBe(1);
  });

  test("a script's two code boxes", async () => {
    const settings: HTMLElement | null = await renderInView(
      stepWithId(ComponentID.JavaScriptCode),
      Variant.SetUp,
    );

    expect(settings!.querySelectorAll("[data-code-type]").length).toBe(2);
  });

  test("a record step's field list and its query", async () => {
    const settings: HTMLElement | null = await renderInView(
      stepWithId("incident-find-one"),
      Variant.SetUp,
    );

    expect(
      settings!.querySelector('[data-testid="fields-to-pass-on"]'),
    ).not.toBeNull();
    expect(
      settings!.querySelector('[data-testid="model-column-json-toggle"]'),
    ).not.toBeNull();
  });

  test("values from earlier steps, as chips, and a number taken from one", async () => {
    const settings: HTMLElement | null = await renderInView(
      stepWithId(ComponentID.SendEmail),
      Variant.FromEarlierSteps,
    );

    expect(
      settings!.querySelectorAll(
        '[data-template-editor][contenteditable="false"]',
      ).length,
    ).toBeGreaterThan(2);
    expect(settings!.textContent).toContain("DEPLOY_ENV");
  });

  test("the people a page goes to", async () => {
    const settings: HTMLElement | null = await renderInView(
      stepWithId(ComponentID.PageUsers),
      Variant.SetUp,
    );

    expect(
      settings!.querySelectorAll(WORKFLOW_VIEW_ONLY_FIELDSET_SELECTOR).length,
    ).toBeGreaterThan(0);
  });
});

describe.each([Variant.JustAdded, Variant.SetUp, Variant.FromEarlierSteps])(
  "every step's settings on a view, %s",
  (variant: Variant) => {
    test.each(
      EVERY_STEP.map(
        (metadata: ComponentMetadata): [string, ComponentMetadata] => {
          return [`${metadata.title} (${metadata.id})`, metadata];
        },
      ),
    )(
      "%s: nothing can be changed, a code box is read and copied, More fields opens",
      async (_name: string, metadata: ComponentMetadata) => {
        const settings: HTMLElement | null = await renderInView(
          metadata,
          variant,
        );

        const identifier: HTMLElement = screen.getByTestId(
          "workflow-component-id-view-only",
        );

        // Nothing still takes a press, a key or typing.
        const live: Array<LiveControl> = [
          ...(settings ? findLiveControls(settings) : []),
          ...findLiveControls(identifier),
        ];

        expect([metadata.id, live]).toEqual([metadata.id, []]);

        if (!settings) {
          return;
        }

        // Every code box shows its code to be read, its Copy free to press.
        for (const box of Array.from(
          settings.querySelectorAll<HTMLElement>("[data-code-type]"),
        )) {
          expect([metadata.id, box.className]).toEqual([
            metadata.id,
            expect.stringContaining("ou-code-editor--readonly"),
          ]);

          const copy: HTMLElement | null =
            box.querySelector(CODE_COPY_SELECTOR);

          expect([metadata.id, Boolean(copy && !isHeldStill(copy))]).toEqual([
            metadata.id,
            true,
          ]);
        }

        // More fields opens, to read what it folds away.
        for (const fold of Array.from(
          settings.querySelectorAll<HTMLElement>(FOLD_HEADER_SELECTOR),
        )) {
          expect([
            metadata.id,
            fold.matches(":disabled"),
            isHeldStill(fold),
          ]).toEqual([metadata.id, false, false]);
        }
      },
    );
  },
);
