/*
 * What the provider does for sources that are extras, or that change while
 * the list is open: a background source is never shown as loading or failed,
 * one source can be asked again on its own without the list emptying, and
 * the webhook's URL reaches every source.
 */

import {
  ValuePickerContextValue,
  ValuePickerProvider,
  useValuePicker,
} from "../../../../../UI/Components/Workflow/ValuePicker/ValuePickerContext";
import {
  ValueSuggestion,
  ValueSuggestionContext,
  ValueSuggestionGroup,
  ValueSuggestionGroupKind,
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
import { act, cleanup, render, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, jest, test } from "@jest/globals";
import type { Mock } from "jest-mock";

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

const BODY: string = "{{local.components.webhook-1.returnValues.request-body}}";

type GroupFunction = (sample?: string) => ValueSuggestionGroup;

const webhookGroup: GroupFunction = (sample?: string): ValueSuggestionGroup => {
  const body: ValueSuggestion = { reference: BODY, label: "Request Body" };

  if (sample) {
    body.sample = sample;
  }

  return {
    id: "step:webhook-1",
    kind: ValueSuggestionGroupKind.Step,
    title: "Webhook",
    order: 0,
    items: [body],
  };
};

interface Captured {
  current: ValuePickerContextValue | null;
}

type RenderFunction = (props: {
  sources: Array<ValueSuggestionSource>;
  webhookUrl?: string | undefined;
  component?: NodeDataProp | undefined;
}) => { captured: Captured; rerender: (component: NodeDataProp) => void };

const renderProvider: RenderFunction = (props: {
  sources: Array<ValueSuggestionSource>;
  webhookUrl?: string | undefined;
  component?: NodeDataProp | undefined;
}): { captured: Captured; rerender: (component: NodeDataProp) => void } => {
  const captured: Captured = { current: null };

  const Probe: () => ReactElement = (): ReactElement => {
    captured.current = useValuePicker();
    return <></>;
  };

  const ui: (component: NodeDataProp) => ReactElement = (
    component: NodeDataProp,
  ): ReactElement => {
    return (
      <ValuePickerProvider
        workflowId={new ObjectID("b0c3f6d2-5d2e-4c55-9a0e-6f1e2d3c4b5a")}
        component={component}
        graphComponents={[webhook, log]}
        valueSources={{
          upstream: [webhook],
          downstreamIds: [],
          hasIncomingConnection: true,
        }}
        sources={props.sources}
        webhookUrl={props.webhookUrl}
      >
        <Probe />
      </ValuePickerProvider>
    );
  };

  const view: ReturnType<typeof render> = render(ui(props.component || log));

  return {
    captured: captured,
    rerender: (component: NodeDataProp) => {
      view.rerender(ui(component));
    },
  };
};

type SampleOfFunction = (captured: Captured) => string | undefined;

const bodySample: SampleOfFunction = (
  captured: Captured,
): string | undefined => {
  return captured.current?.groups[0]?.items[0]?.sample;
};

type LoadGroups = (
  context: ValueSuggestionContext,
) => Promise<Array<ValueSuggestionGroup>>;

afterEach(() => {
  cleanup();
});

describe("a background source", () => {
  test("is never shown as loading", () => {
    const { captured } = renderProvider({
      sources: [
        {
          id: "samples",
          isBackground: true,
          loadGroups: () => {
            return new Promise<Array<ValueSuggestionGroup>>(() => {});
          },
        },
      ],
    });

    expect(captured.current?.isLoading).toBe(false);
  });

  test("is not reported when it fails", async () => {
    const loadGroups: Mock<LoadGroups> = jest.fn<LoadGroups>(async () => {
      throw new Error("Permission denied");
    });
    const { captured } = renderProvider({
      sources: [{ id: "samples", isBackground: true, loadGroups: loadGroups }],
    });

    await waitFor(() => {
      expect(loadGroups).toHaveBeenCalled();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(captured.current?.loadErrors).toEqual([]);
  });

  test("a source that is not one still is, both ways", async () => {
    const { captured } = renderProvider({
      sources: [
        {
          id: "variables",
          loadGroups: async () => {
            throw new Error("Permission denied");
          },
        },
      ],
    });

    await waitFor(() => {
      expect(captured.current?.loadErrors).toEqual(["Permission denied"]);
    });
  });
});

describe("refreshSource", () => {
  test("asks that source again, and only that one", async () => {
    let answer: string = "first";
    const samples: Mock<LoadGroups> = jest.fn<LoadGroups>(async () => {
      return [webhookGroup(answer)];
    });
    const variables: Mock<LoadGroups> = jest.fn<LoadGroups>(async () => {
      return [];
    });
    const { captured } = renderProvider({
      sources: [
        { id: "samples", isBackground: true, loadGroups: samples },
        { id: "variables", loadGroups: variables },
      ],
    });

    await waitFor(() => {
      expect(bodySample(captured)).toBe("first");
    });

    answer = "second";

    await act(async () => {
      captured.current!.refreshSource("samples");
    });

    await waitFor(() => {
      expect(bodySample(captured)).toBe("second");
    });
    expect(samples).toHaveBeenCalledTimes(2);
    expect(variables).toHaveBeenCalledTimes(1);
  });

  test("keeps what the source said until the new answer is in", async () => {
    let resolveSecond: ((groups: Array<ValueSuggestionGroup>) => void) | null =
      null;
    let calls: number = 0;
    const { captured } = renderProvider({
      sources: [
        {
          id: "samples",
          isBackground: true,
          loadGroups: () => {
            calls++;

            if (calls === 1) {
              return Promise.resolve([webhookGroup("first")]);
            }

            return new Promise<Array<ValueSuggestionGroup>>(
              (resolve: (groups: Array<ValueSuggestionGroup>) => void) => {
                resolveSecond = resolve;
              },
            );
          },
        },
      ],
    });

    await waitFor(() => {
      expect(bodySample(captured)).toBe("first");
    });

    await act(async () => {
      captured.current!.refreshSource("samples");
    });

    expect(bodySample(captured)).toBe("first");
    expect(captured.current?.isLoading).toBe(false);

    await act(async () => {
      resolveSecond!([webhookGroup("second")]);
    });

    expect(bodySample(captured)).toBe("second");
  });

  test("a refresh that fails changes nothing", async () => {
    let calls: number = 0;
    const { captured } = renderProvider({
      sources: [
        {
          id: "samples",
          isBackground: true,
          loadGroups: async () => {
            calls++;

            if (calls > 1) {
              throw new Error("offline");
            }

            return [webhookGroup("first")];
          },
        },
      ],
    });

    await waitFor(() => {
      expect(bodySample(captured)).toBe("first");
    });

    await act(async () => {
      captured.current!.refreshSource("samples");
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(calls).toBe(2);
    expect(bodySample(captured)).toBe("first");
    expect(captured.current?.loadErrors).toEqual([]);
  });

  test("asks one at a time: a refresh still out is not asked over", async () => {
    let calls: number = 0;
    const { captured } = renderProvider({
      sources: [
        {
          id: "samples",
          isBackground: true,
          loadGroups: () => {
            calls++;

            return calls === 1
              ? Promise.resolve([webhookGroup("first")])
              : new Promise<Array<ValueSuggestionGroup>>(() => {});
          },
        },
      ],
    });

    await waitFor(() => {
      expect(bodySample(captured)).toBe("first");
    });

    await act(async () => {
      captured.current!.refreshSource("samples");
      captured.current!.refreshSource("samples");
      captured.current!.refreshSource("samples");
    });

    expect(calls).toBe(2);
  });

  test("a source it does not have, or one with nothing to load, is ignored", async () => {
    const { captured } = renderProvider({
      sources: [
        {
          id: "steps",
          getGroups: () => {
            return [webhookGroup("static")];
          },
        },
      ],
    });

    await act(async () => {
      captured.current!.refreshSource("steps");
      captured.current!.refreshSource("nothing-by-that-name");
    });

    expect(bodySample(captured)).toBe("static");
  });

  test("an answer to a refresh from before the step changed is thrown away", async () => {
    let resolveStale: ((groups: Array<ValueSuggestionGroup>) => void) | null =
      null;
    let calls: number = 0;
    const { captured, rerender } = renderProvider({
      sources: [
        {
          id: "samples",
          isBackground: true,
          loadGroups: (context: ValueSuggestionContext) => {
            calls++;

            if (calls === 2) {
              return new Promise<Array<ValueSuggestionGroup>>(
                (resolve: (groups: Array<ValueSuggestionGroup>) => void) => {
                  resolveStale = resolve;
                },
              );
            }

            return Promise.resolve([
              webhookGroup(`for ${context.component?.id}`),
            ]);
          },
        },
      ],
    });

    await waitFor(() => {
      expect(bodySample(captured)).toBe("for log-1");
    });

    await act(async () => {
      captured.current!.refreshSource("samples");
    });

    const other: NodeDataProp = step(ComponentID.Log, "log-2");

    rerender(other);

    await waitFor(() => {
      expect(bodySample(captured)).toBe("for log-2");
    });

    await act(async () => {
      resolveStale!([webhookGroup("stale")]);
    });

    expect(bodySample(captured)).toBe("for log-2");
  });
});

describe("the webhook's URL", () => {
  test("reaches every source, with the step and the steps before it", async () => {
    const loadGroups: Mock<LoadGroups> = jest.fn<LoadGroups>(async () => {
      return [];
    });

    renderProvider({
      sources: [{ id: "samples", isBackground: true, loadGroups: loadGroups }],
      webhookUrl: "https://example.com/workflow/trigger/key",
    });

    await waitFor(() => {
      expect(loadGroups).toHaveBeenCalled();
    });

    const context: ValueSuggestionContext = loadGroups.mock.calls[0]![0];

    expect(context.webhookUrl).toBe("https://example.com/workflow/trigger/key");
    expect(context.component?.id).toBe("log-1");
    expect(
      context.upstreamComponents.map((upstream: NodeDataProp) => {
        return upstream.id;
      }),
    ).toEqual(["webhook-1"]);
  });
});
