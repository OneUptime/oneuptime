/*
 * What the steps before this one held the last times they ran, as the
 * picker shows it: a sample beside each value, a JSON value's fields to open
 * it to, the same fields for a search to find, and - for a Webhook nothing
 * has called yet - a note with a test request to copy.
 *
 * Built from the real component definitions, so a renamed return value
 * shows up here.
 */

jest.mock("../../../../../Models/DatabaseModels/Index", () => {
  return { __esModule: true, default: [] };
});

import {
  BuildStepSampleGroupsOptions,
  FormatWhenFunction,
  STEP_SAMPLE_SOURCE_ID,
  StepSampleCopy,
  buildStepSampleGroups,
  createStepSampleSource,
} from "../../../../../UI/Components/Workflow/ValuePicker/StepSampleSource";
import {
  buildStepValueGroups,
  stepGroupId,
} from "../../../../../UI/Components/Workflow/ValuePicker/StepValueSource";
import {
  ValueSuggestion,
  ValueSuggestionContext,
  ValueSuggestionGroup,
  ValueSuggestionSource,
  mergeSuggestionGroups,
} from "../../../../../UI/Components/Workflow/ValuePicker/ValueSuggestion";
import { ModelSchemaColumn } from "../../../../../UI/Components/Workflow/ModelSchema";
import ComponentMetadata, {
  NodeDataProp,
  NodeType,
} from "../../../../../Types/Workflow/Component";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import Components from "../../../../../Types/Workflow/Components";
import BaseModelComponentFactory from "../../../../../Types/Workflow/Components/BaseModel";
import Incident from "../../../../../Models/DatabaseModels/Incident";
import ObjectID from "../../../../../Types/ObjectID";
import { JSONObject } from "../../../../../Types/JSON";
import {
  StepSample,
  StepSampleKind,
  StepSampleValue,
  describeSampleValue,
} from "../../../../../Types/Workflow/StepSamples";
import { getWebhookTriggerCurlExample } from "../../../../../Types/Workflow/WebhookTrigger";
import { describe, expect, jest, test } from "@jest/globals";
import type { Mock } from "jest-mock";

const INCIDENT_COMPONENTS: Array<ComponentMetadata> =
  BaseModelComponentFactory.getComponents(new Incident());

type MetadataFunction = (id: string) => ComponentMetadata;

const metadataOf: MetadataFunction = (id: string): ComponentMetadata => {
  const metadata: ComponentMetadata | undefined = [
    ...Components,
    ...INCIDENT_COMPONENTS,
  ].find((component: ComponentMetadata) => {
    return component.id === id;
  });

  if (!metadata) {
    throw new Error(`No component ${id}`);
  }

  return metadata;
};

type StepFunction = (metadataId: string, id: string) => NodeDataProp;

const step: StepFunction = (metadataId: string, id: string): NodeDataProp => {
  const metadata: ComponentMetadata = metadataOf(metadataId);

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
const manual: NodeDataProp = step(ComponentID.Manual, "manual-1");
const apiPost: NodeDataProp = step(ComponentID.ApiPost, "api-post-1");
const log: NodeDataProp = step(ComponentID.Log, "log-1");
const onCreate: NodeDataProp = step(
  "incident-on-create",
  "incident-on-create-1",
);

const WORKFLOW_ID: ObjectID = new ObjectID(
  "b0c3f6d2-5d2e-4c55-9a0e-6f1e2d3c4b5a",
);
const RAN_AT: string = "2026-10-01T11:55:00.000Z";
const WEBHOOK_URL: string =
  "https://oneuptime.example.com/workflow/trigger/secret-key-123";

const BODY: string = "{{local.components.webhook-1.returnValues.request-body}}";
const HEADERS: string =
  "{{local.components.webhook-1.returnValues.request-headers}}";

// "5 minutes ago", whatever the clock says.
const formatWhen: FormatWhenFunction = (): string => {
  return "5 minutes ago";
};

const OPTIONS: BuildStepSampleGroupsOptions = { formatWhen: formatWhen };

type ValueFunction = (value: unknown) => StepSampleValue;

const value: ValueFunction = (raw: unknown): StepSampleValue => {
  return describeSampleValue(raw, { ranAt: RAN_AT });
};

const WEBHOOK_SAMPLE: StepSample = {
  componentId: "webhook-1",
  returnValues: {
    "request-body": value({
      environment: "production",
      incident: { title: "Database is down", severity: "critical" },
      tags: ["db"],
    }),
    "request-headers": value({
      authorization: "Bearer abc",
      "content-type": "application/json",
    }),
    "request-params": value({}),
  },
};

type ContextFunction = (
  overrides?: Partial<ValueSuggestionContext>,
) => ValueSuggestionContext;

const context: ContextFunction = (
  overrides: Partial<ValueSuggestionContext> = {},
): ValueSuggestionContext => {
  return {
    workflowId: WORKFLOW_ID,
    component: log,
    upstreamComponents: [webhook],
    ...overrides,
  };
};

type ItemFunction = (
  group: ValueSuggestionGroup | undefined,
  reference: string,
) => ValueSuggestion | undefined;

const item: ItemFunction = (
  group: ValueSuggestionGroup | undefined,
  reference: string,
): ValueSuggestion | undefined => {
  return group?.items.find((candidate: ValueSuggestion) => {
    return candidate.reference === reference && !candidate.searchOnly;
  });
};

type ChildrenFunction = (
  suggestion: ValueSuggestion | undefined,
) => Promise<Array<ValueSuggestion>>;

const childrenOf: ChildrenFunction = async (
  suggestion: ValueSuggestion | undefined,
): Promise<Array<ValueSuggestion>> => {
  const loader: (() => Promise<Array<ValueSuggestion>>) | undefined =
    suggestion?.drillIn?.loadChildren;

  if (!loader) {
    throw new Error("The value cannot be opened to fields");
  }

  return loader();
};

describe("buildStepSampleGroups: a step that has run", () => {
  const groups: Array<ValueSuggestionGroup> = buildStepSampleGroups(
    context(),
    [WEBHOOK_SAMPLE],
    OPTIONS,
  );
  const group: ValueSuggestionGroup | undefined = groups[0];

  test("adds to the step's own group", () => {
    expect(groups).toHaveLength(1);
    expect(group?.id).toBe(stepGroupId("webhook-1"));
    expect(group?.title).toBe("Webhook");
    expect(group?.subtitle).toBe("webhook-1");
    expect(group?.note).toBeUndefined();
  });

  test("says beside each value what it held", () => {
    expect(item(group, BODY)?.sample).toBe("3 fields");
    expect(item(group, HEADERS)?.sample).toBe("2 fields");
  });

  test("opens the body to its fields, with what each held", async () => {
    const body: ValueSuggestion | undefined = item(group, BODY);
    const children: Array<ValueSuggestion> = await childrenOf(body);

    expect(
      children.map((child: ValueSuggestion) => {
        return [child.label, child.sample, child.typeLabel];
      }),
    ).toEqual([
      ["environment", '"production"', "Text"],
      ["incident", "2 fields", "JSON"],
      ["incident.severity", '"critical"', "Text"],
      ["incident.title", '"Database is down"', "Text"],
      ["tags", "1 item", "List"],
      ["tags[0]", '"db"', "Text"],
    ]);
    expect(children[3]?.reference).toBe(
      "{{local.components.webhook-1.returnValues.request-body.incident.title}}",
    );
  });

  test("says where the fields come from, above them", () => {
    expect(item(group, BODY)?.drillIn?.note).toBe(
      "From the request received 5 minutes ago.",
    );
    expect(item(group, BODY)?.drillIn?.wholeValueLabel).toBe(
      "The whole Request Body",
    );
    expect(item(group, BODY)?.drillIn?.allowsPath).toBe(true);
  });

  test("a header that is a credential is listed without what it held", async () => {
    const children: Array<ValueSuggestion> = await childrenOf(
      item(group, HEADERS),
    );
    const authorization: ValueSuggestion | undefined = children.find(
      (child: ValueSuggestion) => {
        return child.label === "authorization";
      },
    );

    expect(authorization?.isSampleHidden).toBe(true);
    expect(authorization?.sample).toBeUndefined();
    expect(JSON.stringify(groups)).not.toContain("Bearer abc");
  });

  test("lists the fields again for a search to find, named with the value they are in", () => {
    const searchable: Array<ValueSuggestion> = (group?.items || []).filter(
      (candidate: ValueSuggestion) => {
        return Boolean(candidate.searchOnly);
      },
    );
    const title: ValueSuggestion | undefined = searchable.find(
      (candidate: ValueSuggestion) => {
        return candidate.label === "Request Body › incident.title";
      },
    );

    expect(title?.reference).toBe(
      "{{local.components.webhook-1.returnValues.request-body.incident.title}}",
    );
    expect(title?.sample).toBe('"Database is down"');
    expect(title?.searchOnly?.context).toEqual(["Request Body", BODY]);
  });

  test("an empty value is picked whole, and opened only to read why it is empty", () => {
    const params: ValueSuggestion | undefined = item(
      group,
      "{{local.components.webhook-1.returnValues.request-params}}",
    );

    expect(params?.sample).toBe("no fields");
    expect(params?.drillIn?.loadChildren).toBeUndefined();
    expect(params?.drillIn?.note).toBe(
      "It was empty in the request received 5 minutes ago.",
    );
  });
});

describe("buildStepSampleGroups: a Webhook nothing has called yet", () => {
  test("says so, offers a test request to copy, and asks to be refreshed", () => {
    const group: ValueSuggestionGroup | undefined = buildStepSampleGroups(
      context({ webhookUrl: WEBHOOK_URL }),
      [],
      OPTIONS,
    )[0];

    expect(group?.id).toBe(stepGroupId("webhook-1"));
    expect(group?.note).toEqual({
      text: StepSampleCopy.noRequestYetWithTest,
      copyText: getWebhookTriggerCurlExample(WEBHOOK_URL),
      copyLabel: "Copy test request",
      refreshSourceId: STEP_SAMPLE_SOURCE_ID,
      waitingText: "Waiting for a request…",
    });
    expect(group?.note?.copyText).toContain(WEBHOOK_URL);
  });

  test("without the URL - the reader may not see it - there is nothing to copy", () => {
    const group: ValueSuggestionGroup | undefined = buildStepSampleGroups(
      context(),
      [],
      OPTIONS,
    )[0];

    expect(group?.note?.text).toBe(StepSampleCopy.noRequestYet);
    expect(group?.note?.copyText).toBeUndefined();
    expect(group?.note?.refreshSourceId).toBe(STEP_SAMPLE_SOURCE_ID);
  });

  test("a value with fields says, where they would be, that none has arrived", () => {
    const group: ValueSuggestionGroup | undefined = buildStepSampleGroups(
      context(),
      [],
      OPTIONS,
    )[0];

    expect(item(group, BODY)?.drillIn?.note).toBe(
      StepSampleCopy.noRequestYetInside,
    );
    expect(item(group, BODY)?.drillIn?.loadChildren).toBeUndefined();
    expect(item(group, BODY)?.sample).toBeUndefined();
  });

  test("once a request has arrived the note is gone", () => {
    expect(
      buildStepSampleGroups(
        context({ webhookUrl: WEBHOOK_URL }),
        [WEBHOOK_SAMPLE],
        OPTIONS,
      )[0]?.note,
    ).toBeUndefined();
  });
});

describe("buildStepSampleGroups: other steps", () => {
  test("a step that has not run says so inside its JSON, with no note on the group", () => {
    const group: ValueSuggestionGroup | undefined = buildStepSampleGroups(
      context({ upstreamComponents: [apiPost] }),
      [],
      OPTIONS,
    )[0];

    expect(group?.note).toBeUndefined();
    expect(
      item(group, "{{local.components.api-post-1.returnValues.response-body}}")
        ?.drillIn?.note,
    ).toBe(
      `${apiPost.metadata.title} hasn't run yet. Its fields show up here after it does.`,
    );
    // A number has no fields to say anything about.
    expect(
      item(
        group,
        "{{local.components.api-post-1.returnValues.response-status}}",
      ),
    ).toBeUndefined();
  });

  /*
   * JSON typed into Run Workflow reaches the Manual trigger as one piece of
   * text, so running it would not fill in any fields: nothing is promised.
   */
  test("the Manual trigger does not promise fields that a run would not bring", () => {
    expect(
      buildStepSampleGroups(
        context({ upstreamComponents: [manual] }),
        [],
        OPTIONS,
      ),
    ).toEqual([]);
  });

  test("the Manual trigger's typed JSON is shown as the text it arrived as", () => {
    const group: ValueSuggestionGroup | undefined = buildStepSampleGroups(
      context({ upstreamComponents: [manual] }),
      [
        {
          componentId: "manual-1",
          returnValues: { value: value('{"name": "Ada"}') },
        },
      ],
      OPTIONS,
    )[0];
    const json: ValueSuggestion | undefined = item(
      group,
      "{{local.components.manual-1.returnValues.value}}",
    );

    expect(json?.sample).toBe('"{"name": "Ada"}"');
    expect(json?.drillIn).toBeUndefined();
  });

  test("a number it returned is shown as it was", () => {
    const group: ValueSuggestionGroup | undefined = buildStepSampleGroups(
      context({ upstreamComponents: [apiPost] }),
      [
        {
          componentId: "api-post-1",
          returnValues: {
            "response-status": value(201),
            "response-body": value({ id: "inc_1" }),
          },
        },
      ],
      OPTIONS,
    )[0];

    const status: ValueSuggestion | undefined = item(
      group,
      "{{local.components.api-post-1.returnValues.response-status}}",
    );

    expect(status?.sample).toBe("201");
    expect(status?.drillIn).toBeUndefined();
    expect(
      item(group, "{{local.components.api-post-1.returnValues.response-body}}")
        ?.drillIn?.note,
    ).toBe("From the last run, 5 minutes ago.");
  });

  test("a value it ran without giving back says nothing", () => {
    const group: ValueSuggestionGroup | undefined = buildStepSampleGroups(
      context({ upstreamComponents: [apiPost] }),
      [{ componentId: "api-post-1", returnValues: {} }],
      OPTIONS,
    )[0];

    expect(group).toBeUndefined();
  });

  test("a value with more fields than listed says not every one is", () => {
    const partial: StepSampleValue = {
      ...value({ a: 1 }),
      isPartial: true,
    };
    const group: ValueSuggestionGroup | undefined = buildStepSampleGroups(
      context(),
      [{ componentId: "webhook-1", returnValues: { "request-body": partial } }],
      OPTIONS,
    )[0];

    expect(item(group, BODY)?.drillIn?.note).toBe(
      `From the request received 5 minutes ago. ${StepSampleCopy.partial}`,
    );
  });

  test("a value too big to have kept says its fields come with the next one", () => {
    const cutShort: StepSampleValue = {
      kind: StepSampleKind.Object,
      fields: [],
      isCutShort: true,
      ranAt: RAN_AT,
    };

    const webhookGroup: ValueSuggestionGroup | undefined =
      buildStepSampleGroups(
        context(),
        [
          {
            componentId: "webhook-1",
            returnValues: { "request-body": cutShort },
          },
        ],
        OPTIONS,
      )[0];
    const apiGroup: ValueSuggestionGroup | undefined = buildStepSampleGroups(
      context({ upstreamComponents: [apiPost] }),
      [
        {
          componentId: "api-post-1",
          returnValues: { "response-body": cutShort },
        },
      ],
      OPTIONS,
    )[0];

    expect(item(webhookGroup, BODY)?.drillIn?.note).toBe(
      StepSampleCopy.cutShortRequest,
    );
    expect(item(webhookGroup, BODY)?.drillIn?.loadChildren).toBeUndefined();
    expect(
      item(
        apiGroup,
        "{{local.components.api-post-1.returnValues.response-body}}",
      )?.drillIn?.note,
    ).toBe(StepSampleCopy.cutShortRun);
  });

  test("without a time it can read, it just says the last one", () => {
    const group: ValueSuggestionGroup | undefined = buildStepSampleGroups(
      context(),
      [
        {
          componentId: "webhook-1",
          returnValues: {
            "request-body": { ...value({ a: 1 }), ranAt: "" },
          },
        },
      ],
      OPTIONS,
    )[0];

    expect(item(group, BODY)?.drillIn?.note).toBe("From the last request.");
  });

  test("a hidden value says so instead of what it held", () => {
    const group: ValueSuggestionGroup | undefined = buildStepSampleGroups(
      context({ upstreamComponents: [apiPost] }),
      [
        {
          componentId: "api-post-1",
          returnValues: {
            "response-body": describeSampleValue("secret", {
              ranAt: RAN_AT,
              isHidden: true,
            }),
          },
        },
      ],
      OPTIONS,
    )[0];

    const body: ValueSuggestion | undefined = item(
      group,
      "{{local.components.api-post-1.returnValues.response-body}}",
    );

    expect(body?.isSampleHidden).toBe(true);
    expect(body?.sample).toBeUndefined();
  });

  test("the step being edited, and steps that return nothing, are left out", () => {
    expect(
      buildStepSampleGroups(
        context({ component: apiPost, upstreamComponents: [log, apiPost] }),
        [
          {
            componentId: "api-post-1",
            returnValues: { "response-status": value(200) },
          },
        ],
        OPTIONS,
      ),
    ).toEqual([]);
  });
});

describe("buildStepSampleGroups: a record", () => {
  const recordSample: StepSample = {
    componentId: "incident-on-create-1",
    returnValues: {
      model: value({
        _id: { _type: "ObjectID", value: "inc-1" },
        title: "Database is down",
        notAColumn: "from the run",
      }),
    },
  };

  test("only adds what each field held: the fields come from the model", async () => {
    const group: ValueSuggestionGroup | undefined = buildStepSampleGroups(
      context({ upstreamComponents: [onCreate] }),
      [recordSample],
      OPTIONS,
    )[0];
    const model: ValueSuggestion | undefined = item(
      group,
      "{{local.components.incident-on-create-1.returnValues.model}}",
    );

    expect(model?.sample).toBe("3 fields");

    const children: Array<ValueSuggestion> = await childrenOf(model);

    expect(
      children.every((child: ValueSuggestion) => {
        return child.annotatesOnly === true;
      }),
    ).toBe(true);
    // A search lists the model's fields by their names, not these.
    expect(
      (group?.items || []).some((candidate: ValueSuggestion) => {
        return Boolean(candidate.searchOnly);
      }),
    ).toBe(false);
  });

  test("merged with the model's fields, each keeps its name and gains its sample", async () => {
    const columns: Array<ModelSchemaColumn> = [
      { id: "_id", title: "ID", type: "Object ID", isRelation: false },
      { id: "title", title: "Title", type: "Text", isRelation: false },
      {
        id: "description",
        title: "Description",
        type: "Long Text",
        isRelation: false,
      },
    ];
    const ctx: ValueSuggestionContext = context({
      upstreamComponents: [onCreate],
    });

    const merged: Array<ValueSuggestionGroup> = mergeSuggestionGroups([
      ...buildStepValueGroups(ctx, {
        loadRecordColumns: async (): Promise<Array<ModelSchemaColumn>> => {
          return columns;
        },
      }),
      ...buildStepSampleGroups(ctx, [recordSample], OPTIONS),
    ]);

    const model: ValueSuggestion | undefined = item(
      merged[0],
      "{{local.components.incident-on-create-1.returnValues.model}}",
    );
    const children: Array<ValueSuggestion> = await childrenOf(model);

    expect(
      children.map((child: ValueSuggestion) => {
        return [child.label, child.sample];
      }),
    ).toEqual([
      ["ID", '"inc-1"'],
      ["Title", '"Database is down"'],
      ["Description", undefined],
    ]);
    expect(model?.drillIn?.note).toBe("From the last run, 5 minutes ago.");
  });
});

describe("merged with the steps' own values", () => {
  test("the webhook's body keeps its name and description, and opens to its fields", async () => {
    const ctx: ValueSuggestionContext = context();
    const merged: Array<ValueSuggestionGroup> = mergeSuggestionGroups([
      ...buildStepValueGroups(ctx),
      ...buildStepSampleGroups(ctx, [WEBHOOK_SAMPLE], OPTIONS),
    ]);
    const body: ValueSuggestion | undefined = item(merged[0], BODY);

    expect(merged).toHaveLength(1);
    expect(body?.label).toBe("Request Body");
    expect(body?.typeLabel).toBe("JSON");
    expect(body?.description).toBeTruthy();
    expect(body?.sample).toBe("3 fields");
    expect(body?.drillIn?.pathPlaceholder).toBeTruthy();
    expect((await childrenOf(body)).length).toBe(6);
  });

  test("the waiting note stays on the step's group", () => {
    const ctx: ValueSuggestionContext = context({ webhookUrl: WEBHOOK_URL });
    const merged: Array<ValueSuggestionGroup> = mergeSuggestionGroups([
      ...buildStepValueGroups(ctx),
      ...buildStepSampleGroups(ctx, [], OPTIONS),
    ]);

    expect(merged).toHaveLength(1);
    expect(merged[0]?.note?.copyText).toContain(WEBHOOK_URL);
    expect(
      merged[0]?.items.map((candidate: ValueSuggestion) => {
        return candidate.label;
      }),
    ).toEqual(["Request Headers", "Request Query Params", "Request Body"]);
  });
});

describe("createStepSampleSource", () => {
  type Load = (
    workflowId: ObjectID,
    componentIds: Array<string>,
  ) => Promise<Array<StepSample>>;

  test("asks once for the steps before this one that return something", async () => {
    const load: Mock<Load> = jest.fn<Load>(
      async (): Promise<Array<StepSample>> => {
        return [WEBHOOK_SAMPLE];
      },
    );
    const source: ValueSuggestionSource = createStepSampleSource({
      load: load,
      formatWhen: formatWhen,
    });

    const groups: Array<ValueSuggestionGroup> = await source.loadGroups!(
      context({ upstreamComponents: [webhook, log, apiPost], component: log }),
    );

    expect(load).toHaveBeenCalledTimes(1);
    expect(load.mock.calls[0]?.[0].toString()).toBe(WORKFLOW_ID.toString());
    expect(load.mock.calls[0]?.[1]).toEqual(["webhook-1", "api-post-1"]);
    expect(
      groups.map((group: ValueSuggestionGroup) => {
        return group.id;
      }),
    ).toEqual([stepGroupId("webhook-1"), stepGroupId("api-post-1")]);
  });

  test("asks for nothing without a workflow, or without a step to ask about", async () => {
    const load: Mock<Load> = jest.fn<Load>(
      async (): Promise<Array<StepSample>> => {
        return [];
      },
    );
    const source: ValueSuggestionSource = createStepSampleSource({
      load: load,
    });

    expect(await source.loadGroups!({ upstreamComponents: [webhook] })).toEqual(
      [],
    );
    expect(
      await source.loadGroups!(
        context({ upstreamComponents: [log], component: apiPost }),
      ),
    ).toEqual([]);
    expect(load).not.toHaveBeenCalled();
  });

  test("loads in the background, and lets a failure reach the picker, which stays quiet", async () => {
    const source: ValueSuggestionSource = createStepSampleSource({
      load: async (): Promise<Array<StepSample>> => {
        throw new Error("offline");
      },
    });

    expect(source.id).toBe(STEP_SAMPLE_SOURCE_ID);
    expect(source.isBackground).toBe(true);
    await expect(source.loadGroups!(context())).rejects.toThrow("offline");
  });
});

describe("the default time words", () => {
  test("say how long ago, in words", () => {
    const fiveMinutesAgo: string = new Date(
      Date.now() - 5 * 60 * 1000,
    ).toISOString();
    const group: ValueSuggestionGroup | undefined = buildStepSampleGroups(
      context(),
      [
        {
          componentId: "webhook-1",
          returnValues: {
            "request-body": describeSampleValue({ a: 1 } as JSONObject, {
              ranAt: fiveMinutesAgo,
            }),
          },
        },
      ],
    )[0];

    expect(item(group, BODY)?.drillIn?.note).toBe(
      "From the request received 5 minutes ago.",
    );
  });
});
