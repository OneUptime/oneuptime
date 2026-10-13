/*
 * What the value picker's provider passes on about where this step runs:
 * the steps before it on some runs only and the steps whose values are not
 * there (StepGraph), whether the workflow is off, and the builder's way to
 * start a test run. The sources make the list from these, so a change to
 * any of them must reach them.
 */

import {
  ValuePickerContextValue,
  ValuePickerProvider,
  useValuePicker,
} from "../../../../../UI/Components/Workflow/ValuePicker/ValuePickerContext";
import {
  StepValueSources,
  UnavailableReason,
} from "../../../../../UI/Components/Workflow/ValuePicker/StepGraph";
import {
  ValueSuggestionContext,
  ValueSuggestionGroup,
  ValueSuggestionSource,
} from "../../../../../UI/Components/Workflow/ValuePicker/ValueSuggestion";
import Components from "../../../../../Types/Workflow/Components";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import ComponentMetadata, {
  NodeDataProp,
  NodeType,
} from "../../../../../Types/Workflow/Component";
import ObjectID from "../../../../../Types/ObjectID";
import React, { ReactElement } from "react";
import "@testing-library/jest-dom";
import { act, cleanup, render, RenderResult } from "@testing-library/react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { Mock } from "jest-mock";

type StepFunction = (metadataId: ComponentID, id: string) => NodeDataProp;

const step: StepFunction = (
  metadataId: ComponentID,
  id: string,
): NodeDataProp => {
  const metadata: ComponentMetadata = Components.find(
    (component: ComponentMetadata): boolean => {
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
const ifElse: NodeDataProp = step(ComponentID.IfElse, "if-else-1");
const post: NodeDataProp = step(ComponentID.ApiPost, "api-post-1");
const get: NodeDataProp = step(ComponentID.ApiGet, "api-get-1");
const slack: NodeDataProp = step(
  ComponentID.SlackSendMessageToChannel,
  "slack-1",
);

const VALUE_SOURCES: StepValueSources = {
  upstream: [webhook, ifElse, post],
  downstreamIds: ["api-get-1"],
  hasIncomingConnection: true,
  sometimes: { "api-post-1": { branchStep: ifElse, portTitle: "Yes" } },
  unavailable: [{ step: get, reason: UnavailableReason.RunsAfter }],
};

interface Captured {
  current: ValuePickerContextValue | null;
}

interface ProviderProps {
  sources: Array<ValueSuggestionSource>;
  valueSources?: StepValueSources | undefined;
  isWorkflowOff?: boolean | undefined;
  onTestRun?: (() => void) | undefined;
}

type UiFunction = (props: ProviderProps, captured: Captured) => ReactElement;

const ui: UiFunction = (
  props: ProviderProps,
  captured: Captured,
): ReactElement => {
  const Probe: () => ReactElement = (): ReactElement => {
    captured.current = useValuePicker();
    return <></>;
  };

  return (
    <ValuePickerProvider
      workflowId={new ObjectID("b0c3f6d2-5d2e-4c55-9a0e-6f1e2d3c4b5a")}
      component={slack}
      graphComponents={[webhook, ifElse, post, get, slack]}
      valueSources={props.valueSources}
      isWorkflowOff={props.isWorkflowOff}
      onTestRun={props.onTestRun}
      sources={props.sources}
    >
      <Probe />
    </ValuePickerProvider>
  );
};

type LoadGroups = (
  context: ValueSuggestionContext,
) => Promise<Array<ValueSuggestionGroup>>;

afterEach(() => {
  cleanup();
});

describe("where this step runs, as the graph says", () => {
  test("the steps before it on some runs only, and the ones not there, reach the sources", () => {
    const seen: Array<ValueSuggestionContext> = [];
    const source: ValueSuggestionSource = {
      id: "steps",
      getGroups: (context: ValueSuggestionContext) => {
        seen.push(context);
        return [];
      },
    };

    render(ui({ sources: [source], valueSources: VALUE_SOURCES }, { current: null }));

    const context: ValueSuggestionContext = seen[seen.length - 1]!;

    expect(context.upstreamComponents).toEqual([webhook, ifElse, post]);
    expect(context.sometimesSteps).toEqual(VALUE_SOURCES.sometimes);
    expect(context.unavailableSteps).toEqual(VALUE_SOURCES.unavailable);
  });

  test("without the graph, nothing is said to be sometimes or not there", () => {
    const seen: Array<ValueSuggestionContext> = [];
    const source: ValueSuggestionSource = {
      id: "steps",
      getGroups: (context: ValueSuggestionContext) => {
        seen.push(context);
        return [];
      },
    };

    render(ui({ sources: [source] }, { current: null }));

    const context: ValueSuggestionContext = seen[seen.length - 1]!;

    expect(context.sometimesSteps).toBeUndefined();
    expect(context.unavailableSteps).toBeUndefined();
  });
});

describe("whether the workflow is off", () => {
  test("reaches the sources that load, and turning it on asks them again", async () => {
    const loadGroups: Mock<LoadGroups> = jest.fn<LoadGroups>(
      async (): Promise<Array<ValueSuggestionGroup>> => {
        return [];
      },
    );
    const sources: Array<ValueSuggestionSource> = [
      { id: "samples", loadGroups: loadGroups },
    ];
    const captured: Captured = { current: null };

    let view: RenderResult | null = null;

    await act(async () => {
      view = render(
        ui(
          { sources: sources, valueSources: VALUE_SOURCES, isWorkflowOff: true },
          captured,
        ),
      );
    });

    expect(loadGroups).toHaveBeenCalledTimes(1);
    expect(loadGroups.mock.calls[0]![0].isWorkflowOff).toBe(true);

    // Turned on in another tab, say: the notes must stop offering a test run.
    await act(async () => {
      view!.rerender(
        ui(
          { sources: sources, valueSources: VALUE_SOURCES, isWorkflowOff: false },
          captured,
        ),
      );
    });

    expect(loadGroups).toHaveBeenCalledTimes(2);
    expect(loadGroups.mock.calls[1]![0].isWorkflowOff).toBe(false);
  });

  test("the same state does not ask again", async () => {
    const loadGroups: Mock<LoadGroups> = jest.fn<LoadGroups>(
      async (): Promise<Array<ValueSuggestionGroup>> => {
        return [];
      },
    );
    const sources: Array<ValueSuggestionSource> = [
      { id: "samples", loadGroups: loadGroups },
    ];
    const captured: Captured = { current: null };

    let view: RenderResult | null = null;

    await act(async () => {
      view = render(
        ui(
          { sources: sources, valueSources: VALUE_SOURCES, isWorkflowOff: true },
          captured,
        ),
      );
    });

    await act(async () => {
      view!.rerender(
        ui(
          { sources: sources, valueSources: VALUE_SOURCES, isWorkflowOff: true },
          captured,
        ),
      );
    });

    expect(loadGroups).toHaveBeenCalledTimes(1);
  });
});

describe("the builder's test run", () => {
  test("is handed to the list, which offers it beside a note that asks for one", () => {
    const onTestRun: () => void = (): void => {};
    const captured: Captured = { current: null };

    render(ui({ sources: [], onTestRun: onTestRun }, captured));

    expect(captured.current!.onTestRun).toBe(onTestRun);
  });

  test("absent for someone who may not run the workflow", () => {
    const captured: Captured = { current: null };

    render(ui({ sources: [] }, captured));

    expect(captured.current!.onTestRun).toBeUndefined();
  });
});
