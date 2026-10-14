/*
 * The note on a Webhook or Incoming Email trigger nothing has reached yet,
 * while the workflow is off. Its trigger is paused: the URL refuses requests
 * and email to the address is ignored, so a test request to copy, or an
 * email to send, would never arrive. The note says so, and offers a test
 * run with Run Workflow, which fills the fields in.
 */

jest.mock("../../../../../Models/DatabaseModels/Index", () => {
  return { __esModule: true, default: [] };
});

import {
  BuildStepSampleGroupsOptions,
  STEP_SAMPLE_SOURCE_ID,
  StepSampleCopy,
  buildStepSampleGroups,
  createStepSampleSource,
} from "../../../../../UI/Components/Workflow/ValuePicker/StepSampleSource";
import {
  ValueSuggestionContext,
  ValueSuggestionGroup,
  ValueSuggestionNote,
  ValueSuggestionSource,
} from "../../../../../UI/Components/Workflow/ValuePicker/ValueSuggestion";
import ComponentMetadata, {
  NodeDataProp,
  NodeType,
} from "../../../../../Types/Workflow/Component";
import ComponentID from "../../../../../Types/Workflow/ComponentID";
import Components from "../../../../../Types/Workflow/Components";
import ObjectID from "../../../../../Types/ObjectID";
import {
  StepSample,
  describeSampleValue,
} from "../../../../../Types/Workflow/StepSamples";
import { describe, expect, jest, test } from "@jest/globals";

type StepFunction = (metadataId: string, id: string) => NodeDataProp;

const step: StepFunction = (metadataId: string, id: string): NodeDataProp => {
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
const email: NodeDataProp = step(ComponentID.IncomingEmail, "incoming-email-1");
const manual: NodeDataProp = step(ComponentID.Manual, "manual-1");
const apiPost: NodeDataProp = step(ComponentID.ApiPost, "api-post-1");
const log: NodeDataProp = step(ComponentID.Log, "log-1");

const WORKFLOW_ID: ObjectID = new ObjectID(
  "b0c3f6d2-5d2e-4c55-9a0e-6f1e2d3c4b5a",
);
const WEBHOOK_URL: string =
  "https://oneuptime.example.com/workflow/trigger/secret-key-123";

const OPTIONS: BuildStepSampleGroupsOptions = {
  formatWhen: (): string => {
    return "5 minutes ago";
  },
};

type ContextFunction = (
  upstream: Array<NodeDataProp>,
  overrides?: Partial<ValueSuggestionContext>,
) => ValueSuggestionContext;

const context: ContextFunction = (
  upstream: Array<NodeDataProp>,
  overrides: Partial<ValueSuggestionContext> = {},
): ValueSuggestionContext => {
  return {
    workflowId: WORKFLOW_ID,
    component: log,
    upstreamComponents: upstream,
    webhookUrl: WEBHOOK_URL,
    isWorkflowOff: true,
    ...overrides,
  };
};

type NoteFunction = (
  ctx: ValueSuggestionContext,
  samples?: Array<StepSample>,
) => ValueSuggestionNote | undefined;

const noteOf: NoteFunction = (
  ctx: ValueSuggestionContext,
  samples: Array<StepSample> = [],
): ValueSuggestionNote | undefined => {
  return buildStepSampleGroups(ctx, samples, OPTIONS)[0]?.note;
};

describe("a Webhook nothing has called yet", () => {
  test("says its URL refuses requests while off, and offers a test run", () => {
    expect(noteOf(context([webhook]))).toEqual({
      text: StepSampleCopy.noRequestYetWhileOff,
      offersTestRun: true,
      refreshSourceId: STEP_SAMPLE_SOURCE_ID,
      waitingText: StepSampleCopy.waitingForTestRun,
    });
  });

  test("offers no test request to copy, even with the URL to hand: it would be refused", () => {
    expect(noteOf(context([webhook]))?.copyText).toBeUndefined();
    expect(noteOf(context([webhook]))?.copyLabel).toBeUndefined();
  });

  test("keeps asking while the list is open, so a test run's request shows up", () => {
    expect(noteOf(context([webhook]))?.refreshSourceId).toBe(
      STEP_SAMPLE_SOURCE_ID,
    );
  });

  test.each([false, undefined])(
    "on (isWorkflowOff %p), it offers a test request to copy instead",
    (isWorkflowOff: boolean | undefined) => {
      const note: ValueSuggestionNote | undefined = noteOf(
        context([webhook], { isWorkflowOff: isWorkflowOff }),
      );

      expect(note?.text).toBe(StepSampleCopy.noRequestYetWithTest);
      expect(note?.copyText).toContain(WEBHOOK_URL);
      expect(note?.offersTestRun).toBeUndefined();
    },
  );

  test("once a request has arrived - a test run's, say - there is no note", () => {
    expect(
      noteOf(context([webhook]), [
        {
          componentId: "webhook-1",
          returnValues: {
            "request-body": describeSampleValue(
              { status: "deployed" },
              { ranAt: "2026-10-01T11:55:00.000Z" },
            ),
          },
        },
      ]),
    ).toBeUndefined();
  });
});

describe("an Incoming Email trigger no email has reached yet", () => {
  test("says email to it is ignored while off, and offers a test run", () => {
    expect(noteOf(context([email]))).toEqual({
      text: StepSampleCopy.noEmailYetWhileOff,
      offersTestRun: true,
      refreshSourceId: STEP_SAMPLE_SOURCE_ID,
      waitingText: StepSampleCopy.waitingForTestRun,
    });
  });

  test("on, it waits for an email, with no test run", () => {
    const note: ValueSuggestionNote | undefined = noteOf(
      context([email], { isWorkflowOff: false }),
    );

    expect(note?.text).toBe(StepSampleCopy.noEmailYet);
    expect(note?.waitingText).toBe(StepSampleCopy.waitingForEmail);
    expect(note?.offersTestRun).toBeUndefined();
  });
});

describe("other steps", () => {
  test("a Manual trigger, or an action, has no such note while off", () => {
    const groups: Array<ValueSuggestionGroup> = buildStepSampleGroups(
      context([manual, apiPost]),
      [],
      OPTIONS,
    );

    expect(
      groups.some((group: ValueSuggestionGroup) => {
        return Boolean(group.note);
      }),
    ).toBe(false);
  });
});

describe("the words", () => {
  test("say what is wrong, and what to do instead", () => {
    expect(StepSampleCopy.noRequestYetWhileOff).toBe(
      "No request has reached this webhook yet, and while this workflow is off its URL refuses requests. Test it with Run Workflow: the fields of the request you send there show up here.",
    );
    expect(StepSampleCopy.noEmailYetWhileOff).toBe(
      "No email has reached the workflow's address yet, and while this workflow is off email to it is ignored. Test it with Run Workflow: the fields of the email you fill in there show up here.",
    );
    expect(StepSampleCopy.testWithRunWorkflow).toBe("Test with Run Workflow");
    expect(StepSampleCopy.waitingForTestRun).toBe("Waiting for a test run…");
  });
});

describe("the source that loads the samples", () => {
  test("passes the off state on to the note", async () => {
    type Load = (
      workflowId: ObjectID,
      componentIds: Array<string>,
    ) => Promise<Array<StepSample>>;

    const source: ValueSuggestionSource = createStepSampleSource({
      load: jest.fn<Load>(async (): Promise<Array<StepSample>> => {
        return [];
      }),
    });

    const off: Array<ValueSuggestionGroup> = await source.loadGroups!(
      context([webhook]),
    );
    const on: Array<ValueSuggestionGroup> = await source.loadGroups!(
      context([webhook], { isWorkflowOff: false }),
    );

    expect(off[0]?.note?.offersTestRun).toBe(true);
    expect(on[0]?.note?.offersTestRun).toBeUndefined();
  });
});
