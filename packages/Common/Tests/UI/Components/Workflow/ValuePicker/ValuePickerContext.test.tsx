/*
 * What a step's settings tell the value picker, and what it makes of it:
 * every source's values in one list, the ones that need a request loaded as
 * the settings open, a record's fields loaded once, and the words for a
 * chip worked out from the workflow it is in.
 */

import {
  ChildrenState,
  ChildrenStatus,
  ValuePickerContextValue,
  ValuePickerProvider,
  useValuePicker,
} from "../../../../../UI/Components/Workflow/ValuePicker/ValuePickerContext";
import { ReferenceTone } from "../../../../../UI/Components/Workflow/ValuePicker/ReferenceDescription";
import {
  ValueSuggestion,
  ValueSuggestionGroup,
  ValueSuggestionGroupKind,
  ValueSuggestionSource,
} from "../../../../../UI/Components/Workflow/ValuePicker/ValueSuggestion";
import {
  VARIABLE_SOURCE_ID,
  buildVariableGroups,
} from "../../../../../UI/Components/Workflow/ValuePicker/VariableValueSource";
import { StepValueSources } from "../../../../../UI/Components/Workflow/ValuePicker/StepGraph";
import Components from "../../../../../Types/Workflow/Components";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import ComponentMetadata, {
  NodeDataProp,
  NodeType,
} from "../../../../../Types/Workflow/Component";
import ObjectID from "../../../../../Types/ObjectID";
import React, { ReactElement, ReactNode } from "react";
import "@testing-library/jest-dom";
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";

type StepFunction = (metadataId: ComponentID, id: string) => NodeDataProp;

const step: StepFunction = (
  metadataId: ComponentID,
  id: string,
): NodeDataProp => {
  const metadata: ComponentMetadata = Components.find(
    (component: ComponentMetadata) => {
      return component.id === metadataId;
    },
  )!;

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
  };
};

const webhook: NodeDataProp = step(ComponentID.Webhook, "webhook-1");
const log: NodeDataProp = step(ComponentID.Log, "log-1");
const slack: NodeDataProp = step(
  ComponentID.SlackSendMessageToChannel,
  "slack-1",
);

interface Captured {
  current: ValuePickerContextValue | null;
}

type ProbeFunction = (captured: Captured) => () => ReactElement;

// Renders nothing; keeps what the provider hands down.
const probe: ProbeFunction = (captured: Captured): (() => ReactElement) => {
  const Probe: () => ReactElement = (): ReactElement => {
    captured.current = useValuePicker();
    return <></>;
  };

  return Probe;
};

type RenderProviderFunction = (props: {
  sources?: Array<ValueSuggestionSource>;
  valueSources?: StepValueSources;
  component?: NodeDataProp;
  graph?: Array<NodeDataProp>;
}) => Captured;

const renderProvider: RenderProviderFunction = (props: {
  sources?: Array<ValueSuggestionSource>;
  valueSources?: StepValueSources;
  component?: NodeDataProp;
  graph?: Array<NodeDataProp>;
}): Captured => {
  const captured: Captured = { current: null };
  const Probe: () => ReactElement = probe(captured);

  const ui: ReactNode = (
    <ValuePickerProvider
      workflowId={new ObjectID("b0c3f6d2-5d2e-4c55-9a0e-6f1e2d3c4b5a")}
      component={props.component ?? log}
      graphComponents={props.graph || [webhook, log, slack]}
      valueSources={props.valueSources}
      sources={props.sources}
    >
      <Probe />
    </ValuePickerProvider>
  );

  render(<>{ui}</>);

  return captured;
};

const STEPS_ONLY: ValueSuggestionSource = {
  id: "steps",
  getGroups: (context: { upstreamComponents: Array<NodeDataProp> }) => {
    return context.upstreamComponents.map(
      (upstream: NodeDataProp, index: number): ValueSuggestionGroup => {
        return {
          id: `step:${upstream.id}`,
          kind: ValueSuggestionGroupKind.Step,
          title: upstream.metadata.title,
          order: index,
          items: [
            {
              reference: `{{local.components.${upstream.id}.returnValues.x}}`,
              label: "x",
            },
          ],
        };
      },
    );
  },
};

type GroupIdsFunction = (captured: Captured) => Array<string>;

const groupIds: GroupIdsFunction = (captured: Captured): Array<string> => {
  return captured.current!.groups.map((group: ValueSuggestionGroup) => {
    return group.id;
  });
};

afterEach(() => {
  cleanup();
});

describe("which steps' values are offered", () => {
  test("the ones before this step, as the builder worked them out", () => {
    const captured: Captured = renderProvider({
      sources: [STEPS_ONLY],
      valueSources: {
        upstream: [webhook],
        downstreamIds: ["slack-1"],
        hasIncomingConnection: true,
      },
    });

    expect(groupIds(captured)).toEqual(["step:webhook-1"]);
  });

  test("without the builder's order, every step but this one", () => {
    const captured: Captured = renderProvider({ sources: [STEPS_ONLY] });

    expect(groupIds(captured)).toEqual(["step:webhook-1", "step:slack-1"]);
  });

  test("whether the step is connected, and whether it is a trigger", () => {
    const loose: Captured = renderProvider({
      sources: [STEPS_ONLY],
      valueSources: {
        upstream: [webhook],
        downstreamIds: [],
        hasIncomingConnection: false,
      },
    });

    expect(loose.current!.hasIncomingConnection).toBe(false);
    expect(loose.current!.isTrigger).toBe(false);
    cleanup();

    const trigger: Captured = renderProvider({
      sources: [STEPS_ONLY],
      component: webhook,
    });

    expect(trigger.current!.isTrigger).toBe(true);
    // Without the builder's word on it, it is taken to be connected.
    expect(trigger.current!.hasIncomingConnection).toBe(true);
  });
});

describe("sources that need a request", () => {
  test("load as the settings open, and are said to be loading until then", async () => {
    let resolve: (groups: Array<ValueSuggestionGroup>) => void = () => {};
    const loadGroups: jest.Mock<() => Promise<Array<ValueSuggestionGroup>>> =
      jest.fn(() => {
        return new Promise<Array<ValueSuggestionGroup>>(
          (done: (groups: Array<ValueSuggestionGroup>) => void) => {
            resolve = done;
          },
        );
      });

    const captured: Captured = renderProvider({
      sources: [STEPS_ONLY, { id: "later", loadGroups: loadGroups }],
    });

    expect(loadGroups).toHaveBeenCalledTimes(1);
    expect(captured.current!.isLoading).toBe(true);

    await act(async () => {
      resolve(buildVariableGroups([{ name: "DEPLOY_ENV", isGlobal: false }]));
    });

    expect(captured.current!.isLoading).toBe(false);
    expect(groupIds(captured)).toEqual([
      "step:webhook-1",
      "step:slack-1",
      "variables:workflow",
    ]);
  });

  test("one that fails says why, and the rest is still offered", async () => {
    const captured: Captured = renderProvider({
      sources: [
        STEPS_ONLY,
        {
          id: "later",
          loadGroups: async () => {
            throw new Error("Permission denied");
          },
        },
      ],
    });

    await waitFor(() => {
      expect(captured.current!.loadErrors).toEqual(["Permission denied"]);
    });
    expect(captured.current!.isLoading).toBe(false);
    expect(groupIds(captured)).toEqual(["step:webhook-1", "step:slack-1"]);
  });

  test("a source can add to a group another made", async () => {
    const captured: Captured = renderProvider({
      sources: [
        STEPS_ONLY,
        {
          id: "last-run",
          loadGroups: async () => {
            return [
              {
                id: "step:webhook-1",
                kind: ValueSuggestionGroupKind.Step,
                title: "Webhook",
                order: 0,
                items: [
                  {
                    reference:
                      "{{local.components.webhook-1.returnValues.request-body.title}}",
                    label: "title",
                  },
                ],
              },
            ];
          },
        },
      ],
    });

    await waitFor(() => {
      expect(captured.current!.isLoading).toBe(false);
    });

    expect(
      captured.current!.groups[0]!.items.map((item: ValueSuggestion) => {
        return item.label;
      }),
    ).toEqual(["x", "title"]);
  });
});

describe("the words on a chip", () => {
  test("name the step, and flag one that runs after this one", () => {
    const captured: Captured = renderProvider({
      sources: [STEPS_ONLY],
      valueSources: {
        upstream: [webhook],
        downstreamIds: ["slack-1"],
        hasIncomingConnection: true,
      },
    });

    expect(
      captured.current!.describeReference(
        "{{local.components.webhook-1.returnValues.request-body}}",
      )!.label,
    ).toBe("Webhook › Request Body");
    expect(
      captured.current!.describeReference(
        "{{local.components.slack-1.returnValues.error}}",
      )!.tone,
    ).toBe(ReferenceTone.Warning);
  });

  test("flag a variable that does not exist, once the variables have loaded", async () => {
    const captured: Captured = renderProvider({
      sources: [
        STEPS_ONLY,
        {
          id: VARIABLE_SOURCE_ID,
          loadGroups: async () => {
            return buildVariableGroups([
              { name: "DEPLOY_ENV", isGlobal: false },
            ]);
          },
        },
      ],
    });

    // Not judged while it is not known.
    expect(
      captured.current!.describeReference("{{local.variables.TYPO}}")!.tone,
    ).toBe(ReferenceTone.Normal);

    await waitFor(() => {
      expect(
        captured.current!.describeReference("{{local.variables.TYPO}}")!.tone,
      ).toBe(ReferenceTone.Warning);
    });
    expect(
      captured.current!.describeReference("{{local.variables.DEPLOY_ENV}}")!
        .tone,
    ).toBe(ReferenceTone.Normal);
  });

  test("a variable list that failed to load judges nothing", async () => {
    const captured: Captured = renderProvider({
      sources: [
        {
          id: VARIABLE_SOURCE_ID,
          loadGroups: async () => {
            throw new Error("offline");
          },
        },
      ],
    });

    await waitFor(() => {
      expect(captured.current!.loadErrors).toHaveLength(1);
    });
    expect(
      captured.current!.describeReference("{{local.variables.ANY}}")!.tone,
    ).toBe(ReferenceTone.Normal);
  });
});

describe("what is inside a value", () => {
  type ItemFunction = (
    loadChildren: () => Promise<Array<ValueSuggestion>>,
  ) => ValueSuggestion;

  const item: ItemFunction = (
    loadChildren: () => Promise<Array<ValueSuggestion>>,
  ): ValueSuggestion => {
    return {
      reference: "{{local.components.find-1.returnValues.model}}",
      label: "Incident",
      drillIn: {
        wholeValueLabel: "The whole Incident",
        allowsPath: true,
        loadChildren: loadChildren,
      },
    };
  };

  test("is loaded once, however often it is asked for", async () => {
    const loadChildren: jest.Mock<() => Promise<Array<ValueSuggestion>>> =
      jest.fn(async () => {
        return [{ reference: "{{a.b.c.d.e.title}}", label: "Title" }];
      });
    const captured: Captured = renderProvider({ sources: [STEPS_ONLY] });
    const record: ValueSuggestion = item(loadChildren);

    expect(captured.current!.getChildren(record).status).toBe(
      ChildrenStatus.Idle,
    );

    act(() => {
      captured.current!.loadChildren(record);
      captured.current!.loadChildren(record);
    });

    expect(captured.current!.getChildren(record).status).toBe(
      ChildrenStatus.Loading,
    );

    await waitFor(() => {
      expect(captured.current!.getChildren(record).status).toBe(
        ChildrenStatus.Loaded,
      );
    });

    act(() => {
      captured.current!.loadChildren(record);
    });

    const state: ChildrenState = captured.current!.getChildren(record);

    expect(loadChildren).toHaveBeenCalledTimes(1);
    expect(state.items).toEqual([
      { reference: "{{a.b.c.d.e.title}}", label: "Title" },
    ]);
  });

  test("a failure is kept, with the reason", async () => {
    const captured: Captured = renderProvider({ sources: [STEPS_ONLY] });
    const record: ValueSuggestion = item(async () => {
      throw new Error("No access to Incident");
    });

    act(() => {
      captured.current!.loadChildren(record);
    });

    await waitFor(() => {
      expect(captured.current!.getChildren(record).status).toBe(
        ChildrenStatus.Failed,
      );
    });
    expect(captured.current!.getChildren(record).error).toBe(
      "No access to Incident",
    );
  });

  test("a value with nothing to load inside it is left alone", () => {
    const captured: Captured = renderProvider({ sources: [STEPS_ONLY] });
    const plain: ValueSuggestion = { reference: "{{a.b.c}}", label: "c" };

    act(() => {
      captured.current!.loadChildren(plain);
    });

    expect(captured.current!.getChildren(plain).status).toBe(
      ChildrenStatus.Idle,
    );
  });
});

describe("outside a step's settings", () => {
  test("nothing is offered, and a reference is named by its ids", () => {
    const captured: Captured = { current: null };
    const Probe: () => ReactElement = probe(captured);

    render(<Probe />);

    expect(captured.current!.isAvailable).toBe(false);
    expect(captured.current!.groups).toEqual([]);
    expect(
      captured.current!.describeReference(
        "{{local.components.webhook-1.returnValues.request-body}}",
      )!.label,
    ).toBe("webhook-1 › request-body");
  });
});
