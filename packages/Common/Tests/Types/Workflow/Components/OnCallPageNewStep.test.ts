/*
 * What a Page step starts with when it is added to a workflow.
 *
 * Most pages a workflow sends are about the record the workflow started on:
 * "when an incident is created, page whoever is on call". So a Page step
 * added to a workflow that starts on an incident or an alert starts as a
 * page about that record, with the record's ID filled in from the trigger,
 * and all it still asks is who to page.
 *
 * What must hold:
 *
 *   - the ID it fills in is the trigger's own value, by the trigger's id in
 *     this workflow, in the words the run resolves;
 *   - what it starts with is a complete answer: with somebody to page added,
 *     the step has nothing left to set up;
 *   - it does this for the Page steps only, and for triggers whose record
 *     is still there when the step runs - not for one that fires when the
 *     record is deleted;
 *   - any other workflow gets nothing, which is a page about a new alert.
 */

import Alert from "../../../../Models/DatabaseModels/Alert";
import AlertEpisode from "../../../../Models/DatabaseModels/AlertEpisode";
import Incident from "../../../../Models/DatabaseModels/Incident";
import IncidentEpisode from "../../../../Models/DatabaseModels/IncidentEpisode";
import Monitor from "../../../../Models/DatabaseModels/Monitor";
import ScheduledMaintenance from "../../../../Models/DatabaseModels/ScheduledMaintenance";
import BaseModel from "../../../../Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import { JSONObject } from "../../../../Types/JSON";
import ComponentMetadata, {
  Argument,
  ComponentType,
  NodeDataProp,
  NodeType,
  isArgumentRequired,
  isArgumentShown,
} from "../../../../Types/Workflow/Component";
import ComponentID from "../../../../Types/Workflow/ComponentID";
import Components from "../../../../Types/Workflow/Components";
import BaseModelComponents from "../../../../Types/Workflow/Components/BaseModel";
import { getNewPageStepArguments } from "../../../../Types/Workflow/Components/OnCallPageNewStep";
import {
  PAGE_ARGUMENT_IDS,
  PageAbout,
  readPageAbout,
} from "../../../../Types/Workflow/Components/OnCallPageSettings";
import { parseTemplateExpressions } from "../../../../Types/Workflow/TemplateSyntax";
import { describe, expect, test } from "@jest/globals";

const PAGE_STEP_IDS: Array<ComponentID> = [
  ComponentID.PageUsers,
  ComponentID.PageTeam,
  ComponentID.PageOnCall,
  ComponentID.PageOnCallPolicy,
];

function metadataOf(id: string): ComponentMetadata {
  const found: ComponentMetadata | undefined = Components.find(
    (component: ComponentMetadata): boolean => {
      return component.id === id;
    },
  );

  if (!found) {
    throw new Error(`No step ${id}`);
  }

  return found;
}

// One of a model's own steps, by how its id ends: "on-create", "find-one".
function modelStep(model: BaseModel, suffix: string): ComponentMetadata {
  const found: ComponentMetadata | undefined =
    BaseModelComponents.getComponents(model).find(
      (component: ComponentMetadata): boolean => {
        return component.id.endsWith(`-${suffix}`);
      },
    );

  if (!found) {
    throw new Error(`${model.tableName} has no ${suffix} step`);
  }

  return found;
}

function node(
  metadata: ComponentMetadata,
  id: string = `${metadata.id}-1`,
  extra: Partial<NodeDataProp> = {},
): NodeDataProp {
  return {
    error: "",
    id: id,
    nodeType: NodeType.Node,
    metadata: metadata,
    metadataId: metadata.id,
    internalId: `${id}-internal`,
    arguments: {},
    returnValues: {},
    componentType: metadata.componentType,
    ...extra,
  };
}

const INCIDENT_CREATED: ComponentMetadata = modelStep(
  new Incident(),
  "on-create",
);
const INCIDENT_UPDATED: ComponentMetadata = modelStep(
  new Incident(),
  "on-update",
);
const INCIDENT_DELETED: ComponentMetadata = modelStep(
  new Incident(),
  "on-delete",
);
const ALERT_CREATED: ComponentMetadata = modelStep(new Alert(), "on-create");
const ALERT_UPDATED: ComponentMetadata = modelStep(new Alert(), "on-update");
const ALERT_DELETED: ComponentMetadata = modelStep(new Alert(), "on-delete");

describe("a workflow that starts on an incident", () => {
  test.each<[string, ComponentMetadata]>([
    ["created", INCIDENT_CREATED],
    ["updated", INCIDENT_UPDATED],
  ])(
    "%s: every Page step starts as a page about that incident",
    (_when: string, trigger: ComponentMetadata) => {
      for (const metadataId of PAGE_STEP_IDS) {
        expect(
          getNewPageStepArguments({
            metadataId: metadataId,
            steps: [node(trigger)],
          }),
        ).toEqual({
          about: "incident",
          "incident-id": `{{local.components.${trigger.id}-1.returnValues.model._id}}`,
        });
      }
    },
  );

  test("the ID is the trigger's by the id the trigger has in this workflow", () => {
    expect(
      getNewPageStepArguments({
        metadataId: ComponentID.PageOnCall,
        steps: [node(INCIDENT_CREATED, "incident-on-create-7")],
      })![PAGE_ARGUMENT_IDS.incidentId],
    ).toBe("{{local.components.incident-on-create-7.returnValues.model._id}}");
  });

  test("the ID is one value the run can resolve: a single reference and nothing around it", () => {
    const id: string = getNewPageStepArguments({
      metadataId: ComponentID.PageUsers,
      steps: [node(INCIDENT_CREATED)],
    })![PAGE_ARGUMENT_IDS.incidentId] as string;

    expect(parseTemplateExpressions(id)).toHaveLength(1);
    expect(id.startsWith("{{")).toBe(true);
    expect(id.endsWith("}}")).toBe(true);
  });

  test("nothing else is filled in: who to page is the person's to say", () => {
    const filled: JSONObject = getNewPageStepArguments({
      metadataId: ComponentID.PageUsers,
      steps: [node(INCIDENT_CREATED)],
    })!;

    expect(Object.keys(filled).sort()).toEqual(["about", "incident-id"]);
  });
});

describe("a workflow that starts on an alert", () => {
  test.each<[string, ComponentMetadata]>([
    ["created", ALERT_CREATED],
    ["updated", ALERT_UPDATED],
  ])(
    "%s: every Page step starts as a page about that alert",
    (_when: string, trigger: ComponentMetadata) => {
      for (const metadataId of PAGE_STEP_IDS) {
        expect(
          getNewPageStepArguments({
            metadataId: metadataId,
            steps: [node(trigger)],
          }),
        ).toEqual({
          about: "alert",
          "alert-id": `{{local.components.${trigger.id}-1.returnValues.model._id}}`,
        });
      }
    },
  );
});

describe("what it starts with is a whole answer", () => {
  /*
   * With somebody to page added, the step the Builder made has nothing left
   * to set up: no required setting that is shown is empty.
   */
  test.each<[string, ComponentMetadata, PageAbout, string]>([
    ["an incident", INCIDENT_CREATED, PageAbout.Incident, "Incident ID"],
    ["an alert", ALERT_CREATED, PageAbout.Alert, "Alert ID"],
  ])(
    "about %s: only who to page is still asked",
    (
      _name: string,
      trigger: ComponentMetadata,
      about: PageAbout,
      recordSetting: string,
    ) => {
      for (const metadataId of PAGE_STEP_IDS) {
        const metadata: ComponentMetadata = metadataOf(metadataId);
        const started: JSONObject = getNewPageStepArguments({
          metadataId: metadataId,
          steps: [node(trigger)],
        })!;

        // The step reads what the Builder stored as the choice it meant.
        expect(readPageAbout(started[PAGE_ARGUMENT_IDS.about])).toBe(about);

        const shown: Array<Argument> = metadata.arguments.filter(
          (setting: Argument): boolean => {
            return isArgumentShown(setting, started);
          },
        );

        expect(
          shown.map((setting: Argument): string => {
            return setting.name;
          }),
        ).toEqual([metadata.arguments[0]!.name, "Page About", recordSetting]);

        const stillEmpty: Array<string> = shown
          .filter((setting: Argument): boolean => {
            return (
              isArgumentRequired(setting, started) &&
              (started[setting.id] === undefined || started[setting.id] === "")
            );
          })
          .map((setting: Argument): string => {
            return setting.name;
          });

        // Who to page, and nothing else.
        expect(stillEmpty).toEqual([metadata.arguments[0]!.name]);
      }
    },
  );
});

describe("a workflow whose record is gone by the time the step runs", () => {
  test.each<[string, ComponentMetadata]>([
    ["an incident deleted", INCIDENT_DELETED],
    ["an alert deleted", ALERT_DELETED],
  ])(
    "%s: the step starts empty - nobody can be paged about a record that is not there",
    (_name: string, trigger: ComponentMetadata) => {
      expect(trigger.componentType).toBe(ComponentType.Trigger);

      for (const metadataId of PAGE_STEP_IDS) {
        expect(
          getNewPageStepArguments({
            metadataId: metadataId,
            steps: [node(trigger)],
          }),
        ).toBeNull();
      }
    },
  );
});

describe("any other workflow", () => {
  test.each<[string, ComponentMetadata]>([
    ["Manual", metadataOf(ComponentID.Manual)],
    ["Webhook", metadataOf(ComponentID.Webhook)],
    ["Schedule", metadataOf(ComponentID.Schedule)],
    ["a monitor created", modelStep(new Monitor(), "on-create")],
    [
      "a scheduled maintenance event created",
      modelStep(new ScheduledMaintenance(), "on-create"),
    ],
    [
      "an incident episode created",
      modelStep(new IncidentEpisode(), "on-create"),
    ],
    ["an alert episode created", modelStep(new AlertEpisode(), "on-create")],
  ])(
    "started by %s: the step starts empty, which is a page about a new alert",
    (_name: string, trigger: ComponentMetadata) => {
      expect(trigger.componentType).toBe(ComponentType.Trigger);

      for (const metadataId of PAGE_STEP_IDS) {
        expect(
          getNewPageStepArguments({
            metadataId: metadataId,
            steps: [node(trigger)],
          }),
        ).toBeNull();
      }

      expect(readPageAbout(undefined)).toBe(PageAbout.NewAlert);
    },
  );

  test("no trigger yet: empty", () => {
    expect(
      getNewPageStepArguments({ metadataId: ComponentID.PageUsers, steps: [] }),
    ).toBeNull();
    expect(
      getNewPageStepArguments({
        metadataId: ComponentID.PageUsers,
        steps: [node(metadataOf(ComponentID.Log))],
      }),
    ).toBeNull();
  });

  test("the canvas's Add trigger placeholder is not a trigger", () => {
    expect(
      getNewPageStepArguments({
        metadataId: ComponentID.PageUsers,
        steps: [
          node(INCIDENT_CREATED, "", {
            nodeType: NodeType.PlaceholderNode,
          }),
        ],
      }),
    ).toBeNull();
  });

  test("a step that reads an incident is not what the workflow started on", () => {
    // Find One Incident hands an incident on too, and is not a trigger.
    const findOne: ComponentMetadata = modelStep(new Incident(), "find-one");

    expect(findOne.componentType).toBe(ComponentType.Component);
    expect(findOne.tableName).toBe("Incident");
    expect(
      getNewPageStepArguments({
        metadataId: ComponentID.PageUsers,
        steps: [node(metadataOf(ComponentID.Manual)), node(findOne)],
      }),
    ).toBeNull();
  });
});

describe("only the Page steps", () => {
  test("no other step is started with anything, whatever the workflow starts on", () => {
    const others: Array<ComponentMetadata> = [
      ...Components,
      ...BaseModelComponents.getComponents(new Incident()),
      ...BaseModelComponents.getComponents(new Alert()),
    ].filter((component: ComponentMetadata): boolean => {
      return !PAGE_STEP_IDS.map(String).includes(component.id);
    });

    expect(others.length).toBeGreaterThan(30);

    for (const component of others) {
      expect(
        getNewPageStepArguments({
          metadataId: component.id,
          steps: [node(INCIDENT_CREATED)],
        }),
      ).toBeNull();
    }
  });

  test("a step that is not there", () => {
    for (const metadataId of [undefined, null, ""]) {
      expect(
        getNewPageStepArguments({
          metadataId: metadataId,
          steps: [node(INCIDENT_CREATED)],
        }),
      ).toBeNull();
    }
  });
});

describe("what the workflow holds besides its trigger", () => {
  test("the trigger is found wherever it is among the steps", () => {
    expect(
      getNewPageStepArguments({
        metadataId: ComponentID.PageTeam,
        steps: [
          node(metadataOf(ComponentID.Log)),
          node(metadataOf(ComponentID.IfElse)),
          node(ALERT_CREATED, "alert-on-create-1"),
        ],
      }),
    ).toEqual({
      about: "alert",
      "alert-id":
        "{{local.components.alert-on-create-1.returnValues.model._id}}",
    });
  });

  test("steps the canvas holds half-made are passed over, never thrown on", () => {
    const broken: Array<NodeDataProp> = [
      undefined as unknown as NodeDataProp,
      { id: "no-metadata" } as unknown as NodeDataProp,
      node(INCIDENT_CREATED),
    ];

    expect(
      getNewPageStepArguments({
        metadataId: ComponentID.PageUsers,
        steps: broken,
      }),
    ).toEqual({
      about: "incident",
      "incident-id":
        "{{local.components.incident-on-create-1.returnValues.model._id}}",
    });
  });

  test("a trigger with no id of its own in the workflow gives nothing to point at", () => {
    expect(
      getNewPageStepArguments({
        metadataId: ComponentID.PageUsers,
        steps: [node(INCIDENT_CREATED, "")],
      }),
    ).toBeNull();
  });

  test("a trigger that hands on no record gives nothing to point at", () => {
    const noRecord: ComponentMetadata = {
      ...INCIDENT_CREATED,
      returnValues: [],
    };

    expect(
      getNewPageStepArguments({
        metadataId: ComponentID.PageUsers,
        steps: [node(noRecord, "incident-on-create-1")],
      }),
    ).toBeNull();
  });
});
