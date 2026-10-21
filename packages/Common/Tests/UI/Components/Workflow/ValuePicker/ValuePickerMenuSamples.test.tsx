/*
 * The value picker with what the steps held the last times they ran - the
 * maintainer's ask: "if its a webhook component and it has received a request
 * already - you know what data is in there, so you can suggest based on that
 * data."
 *
 * The real sources are used: the steps' own values from their definitions,
 * and the samples source, whose request to the server is the one thing
 * replaced. So what is checked is what a builder sees.
 */

jest.mock("../../../../../Models/DatabaseModels/Index", () => {
  return { __esModule: true, default: [] };
});

import ValuePickerMenu, {
  HIDDEN_SAMPLE_TEXT,
  NOTE_REFRESH_INTERVAL_MS,
  NOTE_REFRESH_MAX_MS,
} from "../../../../../UI/Components/Workflow/ValuePicker/ValuePickerMenu";
import { ValuePickerProvider } from "../../../../../UI/Components/Workflow/ValuePicker/ValuePickerContext";
import {
  FormatWhenFunction,
  createStepSampleSource,
} from "../../../../../UI/Components/Workflow/ValuePicker/StepSampleSource";
import { createStepValueSource } from "../../../../../UI/Components/Workflow/ValuePicker/StepValueSource";
import { ValueSuggestionSource } from "../../../../../UI/Components/Workflow/ValuePicker/ValueSuggestion";
import { ModelSchemaColumn } from "../../../../../UI/Components/Workflow/ModelSchema";
import Clipboard from "../../../../../UI/Utils/Clipboard";
import ComponentMetadata, {
  NodeDataProp,
  NodeType,
} from "../../../../../Types/Workflow/Component";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import Components from "../../../../../Types/Workflow/Components";
import BaseModelComponentFactory from "../../../../../Types/Workflow/Components/BaseModel";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import ObjectID from "../../../../../Types/ObjectID";
import {
  StepSample,
  describeSampleValue,
} from "../../../../../Types/Workflow/StepSamples";
import { getWebhookTriggerCurlExample } from "../../../../../Types/Workflow/WebhookTrigger";
import getJestMockFunction, { MockFunction } from "../../../../MockType";
import React, { ReactElement } from "react";
import "@testing-library/jest-dom";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent, { UserEvent } from "@testing-library/user-event";
import {
  afterEach,
  beforeEach,
  describe,
  expect,
  jest,
  test,
} from "@jest/globals";
import type { Mock } from "jest-mock";

const INCIDENT_COMPONENTS: Array<ComponentMetadata> =
  BaseModelComponentFactory.getComponents(new Incident());

type StepFunction = (metadataId: string, id: string) => NodeDataProp;

const step: StepFunction = (metadataId: string, id: string): NodeDataProp => {
  const metadata: ComponentMetadata = [
    ...Components,
    ...INCIDENT_COMPONENTS,
  ].find((component: ComponentMetadata) => {
    return component.id === metadataId;
  })!;

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
const onCreate: NodeDataProp = step(
  "incident-on-create",
  "incident-on-create-1",
);
const log: NodeDataProp = step(ComponentID.Log, "log-1");

const WORKFLOW_ID: ObjectID = new ObjectID(
  "b0c3f6d2-5d2e-4c55-9a0e-6f1e2d3c4b5a",
);
const WEBHOOK_URL: string =
  "https://oneuptime.example.com/workflow/trigger/secret-key-123";
const RAN_AT: string = "2026-10-01T11:55:00.000Z";

const BODY: string = "{{local.components.webhook-1.returnValues.request-body}}";
const HEADERS: string =
  "{{local.components.webhook-1.returnValues.request-headers}}";
const TITLE: string =
  "{{local.components.webhook-1.returnValues.request-body.incident.title}}";

const formatWhen: FormatWhenFunction = (): string => {
  return "5 minutes ago";
};

const WEBHOOK_SAMPLE: StepSample = {
  componentId: "webhook-1",
  returnValues: {
    "request-body": describeSampleValue(
      {
        environment: "production",
        incident: { title: "Database is down", severity: "critical" },
        tags: ["db"],
      },
      { ranAt: RAN_AT },
    ),
    "request-headers": describeSampleValue(
      { authorization: "Bearer abc123", "content-type": "application/json" },
      { ranAt: RAN_AT },
    ),
    "request-params": describeSampleValue({}, { ranAt: RAN_AT }),
  },
};

type Load = (
  workflowId: ObjectID,
  componentIds: Array<string>,
) => Promise<Array<StepSample>>;

interface RenderOptions {
  load: Mock<Load>;
  upstream?: Array<NodeDataProp> | undefined;
  hasSearchBox?: boolean | undefined;
  query?: string | undefined;
  webhookUrl?: string | undefined;
  columns?: Array<ModelSchemaColumn> | undefined;
}

interface Rendered {
  onPick: MockFunction;
  user: UserEvent;
  unmount: () => void;
}

type RenderMenuFunction = (options: RenderOptions) => Rendered;

const renderMenu: RenderMenuFunction = (options: RenderOptions): Rendered => {
  const onPick: MockFunction = getJestMockFunction();
  const upstream: Array<NodeDataProp> = options.upstream || [webhook];

  const sources: Array<ValueSuggestionSource> = [
    createStepValueSource({
      loadRecordColumns: async (): Promise<Array<ModelSchemaColumn>> => {
        return options.columns || [];
      },
    }),
    createStepSampleSource({ load: options.load, formatWhen: formatWhen }),
  ];

  const ui: ReactElement = (
    <ValuePickerProvider
      workflowId={WORKFLOW_ID}
      component={log}
      graphComponents={[...upstream, log]}
      valueSources={{
        upstream: upstream,
        downstreamIds: [],
        hasIncomingConnection: true,
      }}
      sources={sources}
      webhookUrl={options.webhookUrl}
    >
      <ValuePickerMenu
        hasSearchBox={options.hasSearchBox ?? true}
        query={options.query}
        onPick={onPick}
      />
    </ValuePickerProvider>
  );

  const view: ReturnType<typeof render> = render(ui);

  return {
    onPick: onPick,
    user: userEvent.setup({ delay: null }),
    unmount: view.unmount,
  };
};

type LoadReturningFunction = (
  ...answers: Array<Array<StepSample>>
) => Mock<Load>;

// A loader that gives these answers in turn, the last one from then on.
const loadReturning: LoadReturningFunction = (
  ...answers: Array<Array<StepSample>>
): Mock<Load> => {
  let call: number = 0;

  return jest.fn<Load>(async (): Promise<Array<StepSample>> => {
    const answer: Array<StepSample> =
      answers[Math.min(call, answers.length - 1)] || [];
    call++;
    return answer;
  });
};

type OptionFunction = (reference: string) => HTMLElement | undefined;

const optionFor: OptionFunction = (
  reference: string,
): HTMLElement | undefined => {
  return screen.queryAllByRole("option").find((option: HTMLElement) => {
    return option.getAttribute("data-reference") === reference;
  });
};

type ReferencesFunction = () => Array<string>;

const listedReferences: ReferencesFunction = (): Array<string> => {
  return screen.queryAllByRole("option").map((option: HTMLElement) => {
    return option.getAttribute("data-reference") || "";
  });
};

type SampleTextFunction = (reference: string) => string | null;

const sampleText: SampleTextFunction = (reference: string): string | null => {
  const option: HTMLElement | undefined = optionFor(reference);

  if (!option) {
    return null;
  }

  const sample: HTMLElement | null = within(option).queryByTestId(
    "value-picker-sample",
  );

  return sample ? sample.textContent : null;
};

afterEach(() => {
  cleanup();
  jest.restoreAllMocks();
});

describe("a webhook that has received a request", () => {
  test("says beside each value what the last request held", async () => {
    renderMenu({ load: loadReturning([WEBHOOK_SAMPLE]) });

    await waitFor(() => {
      expect(sampleText(BODY)).toBe("3 fields");
    });
    expect(sampleText(HEADERS)).toBe("2 fields");
  });

  test("the body opens to the fields it had, each with what it held", async () => {
    const rendered: Rendered = renderMenu({
      load: loadReturning([WEBHOOK_SAMPLE]),
    });

    await waitFor(() => {
      expect(sampleText(BODY)).toBe("3 fields");
    });

    await rendered.user.click(optionFor(BODY)!);

    expect(rendered.onPick).not.toHaveBeenCalled();
    expect(screen.getByTestId("value-picker-drill-note")).toHaveTextContent(
      "From the request received 5 minutes ago.",
    );
    await waitFor(() => {
      expect(optionFor(TITLE)).toBeDefined();
    });
    expect(listedReferences()).toEqual([
      BODY,
      "{{local.components.webhook-1.returnValues.request-body.environment}}",
      "{{local.components.webhook-1.returnValues.request-body.incident}}",
      "{{local.components.webhook-1.returnValues.request-body.incident.severity}}",
      TITLE,
      "{{local.components.webhook-1.returnValues.request-body.tags}}",
      "{{local.components.webhook-1.returnValues.request-body.tags[0]}}",
    ]);
    expect(sampleText(TITLE)).toBe('"Database is down"');
    expect(within(optionFor(TITLE)!).getByText("incident.title")).toBeVisible();

    await rendered.user.click(optionFor(TITLE)!);

    expect(rendered.onPick).toHaveBeenCalledWith(TITLE);
  });

  test("the whole body is still one pick away, at the top of its fields", async () => {
    const rendered: Rendered = renderMenu({
      load: loadReturning([WEBHOOK_SAMPLE]),
    });

    await waitFor(() => {
      expect(sampleText(BODY)).toBe("3 fields");
    });

    await rendered.user.click(optionFor(BODY)!);
    await rendered.user.keyboard("{Enter}");

    expect(rendered.onPick).toHaveBeenCalledWith(BODY);
  });

  test("a search for a field finds it without opening anything", async () => {
    const rendered: Rendered = renderMenu({
      load: loadReturning([WEBHOOK_SAMPLE]),
    });

    await waitFor(() => {
      expect(sampleText(BODY)).toBe("3 fields");
    });

    await rendered.user.type(
      screen.getByTestId("value-picker-search"),
      "title",
    );

    expect(listedReferences()).toEqual([TITLE]);
    expect(
      within(optionFor(TITLE)!).getByText("Request Body › incident.title"),
    ).toBeVisible();
    expect(sampleText(TITLE)).toBe('"Database is down"');

    await rendered.user.keyboard("{Enter}");

    expect(rendered.onPick).toHaveBeenCalledWith(TITLE);
  });

  test("a search by what a field held finds it", async () => {
    const rendered: Rendered = renderMenu({
      load: loadReturning([WEBHOOK_SAMPLE]),
    });

    await waitFor(() => {
      expect(sampleText(BODY)).toBe("3 fields");
    });

    await rendered.user.type(
      screen.getByTestId("value-picker-search"),
      "production",
    );

    expect(listedReferences()).toEqual([
      "{{local.components.webhook-1.returnValues.request-body.environment}}",
    ]);
  });

  test("typed after {{, the body's path lists its fields once the dot is there", async () => {
    const load: Mock<Load> = loadReturning([WEBHOOK_SAMPLE]);

    renderMenu({
      load: load,
      hasSearchBox: false,
      query: "local.components.webhook-1.returnValues.request-body.",
    });

    await waitFor(() => {
      expect(listedReferences()).toContain(TITLE);
    });
    expect(listedReferences()).not.toContain(BODY);

    cleanup();

    renderMenu({
      load: load,
      hasSearchBox: false,
      query: "local.components.webhook-1.returnValues.request-body",
    });

    await waitFor(() => {
      expect(sampleText(BODY)).toBe("3 fields");
    });
    expect(listedReferences()).toEqual([BODY]);
  });

  test("a header that is a credential is offered, but not what it held", async () => {
    const rendered: Rendered = renderMenu({
      load: loadReturning([WEBHOOK_SAMPLE]),
    });

    await waitFor(() => {
      expect(sampleText(HEADERS)).toBe("2 fields");
    });

    await rendered.user.click(optionFor(HEADERS)!);

    const authorization: string =
      "{{local.components.webhook-1.returnValues.request-headers.authorization}}";

    await waitFor(() => {
      expect(optionFor(authorization)).toBeDefined();
    });

    const sample: HTMLElement = within(optionFor(authorization)!).getByTestId(
      "value-picker-sample",
    );

    expect(sample).toHaveAttribute("data-hidden", "true");
    expect(sample).toHaveTextContent(HIDDEN_SAMPLE_TEXT);
    expect(document.body.textContent).not.toContain("abc123");
    expect(
      sampleText(
        "{{local.components.webhook-1.returnValues.request-headers.content-type}}",
      ),
    ).toBe('"application/json"');
  });

  test("asks the server once, for the steps before this one", async () => {
    const load: Mock<Load> = loadReturning([WEBHOOK_SAMPLE]);

    renderMenu({ load: load });

    await waitFor(() => {
      expect(sampleText(BODY)).toBe("3 fields");
    });

    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0]?.[1]).toEqual(["webhook-1"]);
    expect(screen.queryByTestId("value-picker-group-note")).toBeNull();
  });
});

describe("a webhook nothing has called yet", () => {
  test("says so under its name, with a test request to copy", async () => {
    const copy: ReturnType<typeof jest.spyOn> = jest
      .spyOn(Clipboard, "copyToClipboard")
      .mockResolvedValue(true as never);
    const rendered: Rendered = renderMenu({
      load: loadReturning([]),
      webhookUrl: WEBHOOK_URL,
    });

    const note: HTMLElement = await screen.findByTestId(
      "value-picker-group-note",
    );

    expect(note).toHaveTextContent(
      "No request has reached this webhook yet. Send a test request, and the fields it sends show up here.",
    );
    expect(within(note).getByRole("status")).toHaveTextContent(
      "Waiting for a request…",
    );
    // The URL is the credential: it is copied, never shown.
    expect(document.body.textContent).not.toContain("secret-key-123");

    await rendered.user.click(
      within(note).getByTestId("value-picker-note-copy"),
    );

    expect(copy).toHaveBeenCalledWith(
      getWebhookTriggerCurlExample(WEBHOOK_URL),
    );
    await waitFor(() => {
      expect(
        within(note).getByTestId("value-picker-note-copy"),
      ).toHaveTextContent("Copied!");
    });
    expect(rendered.onPick).not.toHaveBeenCalled();
  });

  test("a refused clipboard does not claim to have copied", async () => {
    jest.spyOn(Clipboard, "copyToClipboard").mockResolvedValue(false as never);
    const rendered: Rendered = renderMenu({
      load: loadReturning([]),
      webhookUrl: WEBHOOK_URL,
    });

    const note: HTMLElement = await screen.findByTestId(
      "value-picker-group-note",
    );

    await rendered.user.click(
      within(note).getByTestId("value-picker-note-copy"),
    );

    expect(
      within(note).getByTestId("value-picker-note-copy"),
    ).toHaveTextContent("Copy test request");
  });

  test("for someone who may not see the URL there is nothing to copy", async () => {
    renderMenu({ load: loadReturning([]) });

    const note: HTMLElement = await screen.findByTestId(
      "value-picker-group-note",
    );

    expect(note).toHaveTextContent(
      "No request has reached this webhook yet. The fields of the first one show up here.",
    );
    expect(within(note).queryByTestId("value-picker-note-copy")).toBeNull();
  });

  test("the copy button does not take the focus from the search box", async () => {
    jest.spyOn(Clipboard, "copyToClipboard").mockResolvedValue(true as never);
    renderMenu({ load: loadReturning([]), webhookUrl: WEBHOOK_URL });

    const note: HTMLElement = await screen.findByTestId(
      "value-picker-group-note",
    );
    const search: HTMLElement = screen.getByTestId("value-picker-search");

    expect(search).toHaveFocus();
    expect(
      fireEvent.mouseDown(within(note).getByTestId("value-picker-note-copy")),
    ).toBe(false);
  });

  test("opening its body says no request has arrived yet", async () => {
    const rendered: Rendered = renderMenu({ load: loadReturning([]) });

    await screen.findByTestId("value-picker-group-note");

    await rendered.user.click(
      within(optionFor(BODY)!).getByTestId("value-picker-look-inside"),
    );

    expect(screen.getByTestId("value-picker-drill-note")).toHaveTextContent(
      "No request has arrived yet. Its fields show up here after the first one.",
    );
  });
});

describe("waiting for the first request", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  const settle: () => Promise<void> = async (): Promise<void> => {
    await act(async () => {
      for (let index: number = 0; index < 6; index++) {
        await Promise.resolve();
      }
    });
  };

  const advance: (ms: number) => Promise<void> = async (
    ms: number,
  ): Promise<void> => {
    await act(async () => {
      jest.advanceTimersByTime(ms);
    });
    await settle();
  };

  test("asks again every few seconds, and the fields appear when the request does", async () => {
    const load: Mock<Load> = loadReturning([], [], [WEBHOOK_SAMPLE]);

    renderMenu({ load: load, webhookUrl: WEBHOOK_URL });
    await settle();

    expect(screen.getByTestId("value-picker-group-note")).toBeInTheDocument();
    expect(load).toHaveBeenCalledTimes(1);

    await advance(NOTE_REFRESH_INTERVAL_MS - 1);
    expect(load).toHaveBeenCalledTimes(1);

    await advance(1);
    expect(load).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("value-picker-group-note")).toBeInTheDocument();

    await advance(NOTE_REFRESH_INTERVAL_MS);
    expect(load).toHaveBeenCalledTimes(3);

    // The request arrived: no more note, the body knows its fields.
    expect(screen.queryByTestId("value-picker-group-note")).toBeNull();
    expect(sampleText(BODY)).toBe("3 fields");

    // And nothing is asked any more.
    await advance(NOTE_REFRESH_INTERVAL_MS * 5);
    expect(load).toHaveBeenCalledTimes(3);
  });

  test("fields arriving while the body is open appear there", async () => {
    const load: Mock<Load> = loadReturning([], [WEBHOOK_SAMPLE]);

    renderMenu({ load: load });
    await settle();

    fireEvent.click(
      within(optionFor(BODY)!).getByTestId("value-picker-look-inside"),
    );

    expect(screen.getByTestId("value-picker-drill-note")).toHaveTextContent(
      "No request has arrived yet.",
    );

    await advance(NOTE_REFRESH_INTERVAL_MS);
    await settle();

    expect(screen.getByTestId("value-picker-drill-note")).toHaveTextContent(
      "From the request received 5 minutes ago.",
    );
    expect(optionFor(TITLE)).toBeDefined();
  });

  test("a request that fails keeps the note, and the next one asks again", async () => {
    let call: number = 0;
    const load: Mock<Load> = jest.fn<Load>(
      async (): Promise<Array<StepSample>> => {
        call++;

        if (call === 2) {
          throw new Error("offline");
        }

        return call >= 3 ? [WEBHOOK_SAMPLE] : [];
      },
    );

    renderMenu({ load: load });
    await settle();

    await advance(NOTE_REFRESH_INTERVAL_MS);
    expect(load).toHaveBeenCalledTimes(2);
    expect(screen.getByTestId("value-picker-group-note")).toBeInTheDocument();
    expect(screen.queryByText(/offline/)).toBeNull();

    await advance(NOTE_REFRESH_INTERVAL_MS);
    expect(load).toHaveBeenCalledTimes(3);
    expect(screen.queryByTestId("value-picker-group-note")).toBeNull();
  });

  test("stops asking when the list closes", async () => {
    const load: Mock<Load> = loadReturning([]);
    const rendered: Rendered = renderMenu({ load: load });

    await settle();
    rendered.unmount();

    await advance(NOTE_REFRESH_INTERVAL_MS * 3);
    expect(load).toHaveBeenCalledTimes(1);
  });

  test(`gives up after ${NOTE_REFRESH_MAX_MS / 60000} minutes`, async () => {
    const load: Mock<Load> = loadReturning([]);

    renderMenu({ load: load });
    await settle();

    // One interval at a time: each refresh finishes before the next is asked.
    for (
      let elapsed: number = 0;
      elapsed <= NOTE_REFRESH_MAX_MS;
      elapsed += NOTE_REFRESH_INTERVAL_MS
    ) {
      await advance(NOTE_REFRESH_INTERVAL_MS);
    }

    const calls: number = load.mock.calls.length;

    // The first load, then one a tick for as long as it waits.
    expect(calls).toBe(1 + NOTE_REFRESH_MAX_MS / NOTE_REFRESH_INTERVAL_MS);

    await advance(NOTE_REFRESH_INTERVAL_MS * 10);
    expect(load).toHaveBeenCalledTimes(calls);
  });

  test("does not ask while the tab is hidden", async () => {
    const load: Mock<Load> = loadReturning([]);
    const visibility: ReturnType<typeof jest.spyOn> = jest
      .spyOn(document, "visibilityState", "get")
      .mockReturnValue("hidden" as never);

    renderMenu({ load: load });
    await settle();

    await advance(NOTE_REFRESH_INTERVAL_MS * 3);
    expect(load).toHaveBeenCalledTimes(1);

    visibility.mockReturnValue("visible" as never);

    await advance(NOTE_REFRESH_INTERVAL_MS);
    expect(load).toHaveBeenCalledTimes(2);
  });
});

describe("loading quietly", () => {
  test("while the samples load, the list is there and says nothing about it", () => {
    renderMenu({
      load: jest.fn<Load>(() => {
        return new Promise<Array<StepSample>>(() => {});
      }),
    });

    expect(optionFor(BODY)).toBeDefined();
    expect(screen.queryByText(/Loading/)).toBeNull();
  });

  test("when they cannot be loaded, the list is as it would be without them", async () => {
    const load: Mock<Load> = jest.fn<Load>(
      async (): Promise<Array<StepSample>> => {
        throw new Error(
          "You do not have permission to read this workflow's runs.",
        );
      },
    );

    renderMenu({ load: load });

    await waitFor(() => {
      expect(load).toHaveBeenCalled();
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(screen.queryByText(/permission/)).toBeNull();
    expect(screen.queryByText(/Couldn't load/)).toBeNull();
    expect(screen.queryByTestId("value-picker-group-note")).toBeNull();
    expect(sampleText(BODY)).toBeNull();
    expect(optionFor(BODY)).toBeDefined();
  });
});

describe("a record a step read", () => {
  test("its fields keep the model's names, and gain what each held", async () => {
    const columns: Array<ModelSchemaColumn> = [
      { id: "title", title: "Title", type: "Text", isRelation: false },
      {
        id: "description",
        title: "Description",
        type: "Long Text",
        isRelation: false,
      },
    ];
    const rendered: Rendered = renderMenu({
      upstream: [onCreate],
      columns: columns,
      load: loadReturning([
        {
          componentId: "incident-on-create-1",
          returnValues: {
            model: describeSampleValue(
              { title: "Database is down", description: null },
              { ranAt: RAN_AT },
            ),
          },
        },
      ]),
    });

    const model: string =
      "{{local.components.incident-on-create-1.returnValues.model}}";

    await waitFor(() => {
      expect(sampleText(model)).toBe("2 fields");
    });

    await rendered.user.click(optionFor(model)!);

    const title: string =
      "{{local.components.incident-on-create-1.returnValues.model.title}}";

    await waitFor(() => {
      expect(optionFor(title)).toBeDefined();
    });
    expect(within(optionFor(title)!).getByText("Title")).toBeVisible();
    expect(sampleText(title)).toBe('"Database is down"');
    expect(
      sampleText(
        "{{local.components.incident-on-create-1.returnValues.model.description}}",
      ),
    ).toBe("empty");
  });
});
