import DiscordInteractionDispatcher, {
  DiscordPreparedInteraction,
} from "../../../../Server/Utils/Workspace/Discord/DiscordInteractionDispatcher";
import DiscordDraftFlow from "../../../../Server/Utils/Workspace/Discord/DiscordDraftFlow";
import DiscordBindingService from "../../../../Server/Services/DiscordBindingService";
import ReceiptService from "../../../../Server/Services/DiscordInteractionReceiptService";
import WorkspaceActionAuthorization from "../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import DiscordClient from "../../../../Server/Utils/Workspace/Discord/DiscordClient";
import {
  DiscordActionModuleRegistration,
  DiscordActionResult,
  DiscordDraftDescriptor,
  DiscordHandlerResponseMode,
  DiscordInteractionKind,
} from "../../../../Server/Utils/Workspace/Discord/Actions/Types";
import ObjectID from "../../../../Types/ObjectID";
import { JSONObject } from "../../../../Types/JSON";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";

/*
 * Adapter failures are listed before implementation in CREATION_DRAFT_FAILURES.
 * Flow persistence and domain authorization have separate contracts. These
 * tests protect receipt ordering, native envelopes, and continuation parsing.
 */
const applicationId: string = "111111111111111111";
const guildId: string = "222222222222222222";
const channelId: string = "333333333333333333";
const discordUserId: string = "444444444444444444";
const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();
const draftId: ObjectID = ObjectID.generate();
const descriptor: DiscordDraftDescriptor = {
  name: "create-example",
  title: "Create example",
  submitAction: "SubmitExample",
  fields: [{ kind: "text", customId: "title", label: "Title", required: true }],
};
const message: JSONObject = {
  content: "Draft review",
  flags: 64,
  allowed_mentions: { parse: [], replied_user: false },
};
let dispatcher: DiscordInteractionDispatcher;
let submit: jest.Mock;
let execute: jest.Mock;

function envelope(kind: DiscordInteractionKind, data: JSONObject): JSONObject {
  return {
    id: "555555555555555555",
    application_id: applicationId,
    token: "fixture.interaction_token",
    type: kind,
    guild_id: guildId,
    channel_id: channelId,
    member: { user: { id: discordUserId } },
    data,
  };
}

function component(operation: string, values?: Array<string>): JSONObject {
  return envelope(DiscordInteractionKind.MessageComponent, {
    custom_id: `oud:${draftId}:1:${operation}`,
    component_type: values ? 3 : 2,
    ...(values ? { values } : {}),
  });
}

beforeEach((): void => {
  jest.spyOn(ReceiptService, "claim").mockResolvedValue({ kind: "acquired" });
  jest.spyOn(ReceiptService, "bindContext").mockResolvedValue();
  jest.spyOn(ReceiptService, "complete").mockResolvedValue();
  jest.spyOn(ReceiptService, "fail").mockResolvedValue();
  jest.spyOn(DiscordBindingService, "resolveLinkedMember").mockResolvedValue({
    projectId,
    userId,
  });
  jest
    .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
    .mockResolvedValue({ tenantId: projectId, userId });
  jest
    .spyOn(DiscordClient, "editOriginalInteractionResponse")
    .mockResolvedValue();
  jest.spyOn(DiscordDraftFlow.prototype, "start").mockResolvedValue(message);
  execute = jest.fn(async (): Promise<JSONObject> => {
    return message;
  });
  jest
    .spyOn(DiscordDraftFlow.prototype, "continue")
    .mockResolvedValue({ mode: "deferred", execute });
  submit = jest.fn();
  const module: DiscordActionModuleRegistration = {
    handlers: [
      {
        actions: ["OpenExample"],
        interactionKinds: [DiscordInteractionKind.ApplicationCommand],
        responseMode: DiscordHandlerResponseMode.Deferred,
        handle: async (): Promise<DiscordActionResult> => {
          return { kind: "draft", draft: descriptor };
        },
      },
    ],
    commands: [
      {
        name: "create-example",
        description: "Open a draft",
        action: "OpenExample",
      },
    ],
    draftSubmissions: [
      {
        name: descriptor.name,
        action: descriptor.submitAction,
        handle: submit,
      },
    ],
  };
  dispatcher = new DiscordInteractionDispatcher({
    applicationId,
    modules: [module],
  });
});

afterEach((): void => {
  jest.restoreAllMocks();
});

test("defers a creation command and binds its actor before opening the draft", async (): Promise<void> => {
  const prepared: DiscordPreparedInteraction = await dispatcher.prepare(
    envelope(DiscordInteractionKind.ApplicationCommand, {
      name: "create-example",
    }),
  );
  expect(prepared.initialResponse).toMatchObject({
    type: 5,
    data: { flags: 64 },
  });
  expect(DiscordDraftFlow.prototype.start).not.toHaveBeenCalled();
  await prepared.runAfterResponse!();
  expect(DiscordDraftFlow.prototype.start).toHaveBeenCalledWith({
    draft: descriptor,
    context: expect.objectContaining({
      projectId,
      userId,
      guildId,
      channelId,
      discordUserId,
    }),
  });
  expect(
    jest.mocked(ReceiptService.bindContext).mock.invocationCallOrder[0]!,
  ).toBeLessThan(
    jest.mocked(DiscordDraftFlow.prototype.start).mock.invocationCallOrder[0]!,
  );
  expect(DiscordClient.editOriginalInteractionResponse).toHaveBeenCalledWith(
    expect.objectContaining({ message }),
  );
});

test("returns the native modal envelope without starting deferred work", async (): Promise<void> => {
  const modal: JSONObject = {
    type: 9,
    data: { custom_id: `oud:${draftId}:1:text`, title: "Edit", components: [] },
  };
  jest
    .mocked(DiscordDraftFlow.prototype.continue)
    .mockResolvedValue({ mode: "immediate", response: modal });
  const prepared: DiscordPreparedInteraction = await dispatcher.prepare(
    component("edit"),
  );
  expect(prepared.initialResponse).toEqual(modal);
  expect(prepared.runAfterResponse).toBeUndefined();
  expect(execute).not.toHaveBeenCalled();
});

/*
 * A continuation edits the draft message it came from (deferred update, type
 * 6) so the earlier message never keeps a live Submit button. The v13 design
 * deferred with a new ephemeral message (type 5); that is a deliberate change.
 */
test("acknowledges with a deferred update before executing a final continuation and records the receipt afterwards", async (): Promise<void> => {
  const prepared: DiscordPreparedInteraction = await dispatcher.prepare(
    component("submit"),
  );
  expect(prepared.initialResponse).toEqual({ type: 6 });
  expect(execute).not.toHaveBeenCalled();
  expect(DiscordDraftFlow.prototype.continue).not.toHaveBeenCalled();
  expect(ReceiptService.complete).not.toHaveBeenCalled();
  await prepared.runAfterResponse!();
  expect(execute).toHaveBeenCalledTimes(1);
  expect(execute.mock.invocationCallOrder[0]!).toBeLessThan(
    jest.mocked(ReceiptService.complete).mock.invocationCallOrder[0]!,
  );
  expect(
    jest.mocked(ReceiptService.bindContext).mock.invocationCallOrder[0]!,
  ).toBeLessThan(execute.mock.invocationCallOrder[0]!);
  expect(DiscordClient.editOriginalInteractionResponse).toHaveBeenCalledWith(
    expect.objectContaining({ message }),
  );
});

test("a deferred continuation that fails replaces the draft message with the refusal and fails the receipt", async (): Promise<void> => {
  execute.mockRejectedValue(new NotAuthorizedException("Draft refused"));
  const prepared: DiscordPreparedInteraction = await dispatcher.prepare(
    component("review"),
  );
  await prepared.runAfterResponse!();
  expect(ReceiptService.fail).toHaveBeenCalledTimes(1);
  expect(ReceiptService.complete).not.toHaveBeenCalled();
  expect(DiscordClient.editOriginalInteractionResponse).toHaveBeenCalledWith(
    expect.objectContaining({
      message: expect.objectContaining({ content: "Draft refused" }),
    }),
  );
});

test("a modal submit continuation is also a deferred update of the draft message", async (): Promise<void> => {
  const prepared: DiscordPreparedInteraction = await dispatcher.prepare(
    envelope(DiscordInteractionKind.ModalSubmit, {
      custom_id: `oud:${draftId}:1:text`,
      components: [
        {
          type: 18,
          component: { type: 4, custom_id: "title", value: "Edited title" },
        },
      ],
    }),
  );
  expect(prepared.initialResponse).toEqual({ type: 6 });
  expect(DiscordDraftFlow.prototype.continue).not.toHaveBeenCalled();
  await prepared.runAfterResponse!();
  expect(DiscordDraftFlow.prototype.continue).toHaveBeenCalledTimes(1);
});

test("a draft result from an immediate handler is a native ephemeral message, not a router crash", async (): Promise<void> => {
  const immediate: DiscordInteractionDispatcher =
    new DiscordInteractionDispatcher({
      applicationId,
      modules: [
        {
          handlers: [
            {
              actions: ["OpenNow"],
              interactionKinds: [DiscordInteractionKind.MessageComponent],
              responseMode: DiscordHandlerResponseMode.Immediate,
              handle: async (): Promise<DiscordActionResult> => {
                return { kind: "draft", draft: descriptor };
              },
            },
          ],
          draftSubmissions: [
            {
              name: descriptor.name,
              action: descriptor.submitAction,
              handle: submit,
            },
          ],
        },
      ],
    });
  const prepared: DiscordPreparedInteraction = await immediate.prepare(
    envelope(DiscordInteractionKind.MessageComponent, {
      custom_id: `OpenNow:${ObjectID.generate()}`,
      component_type: 2,
    }),
  );
  expect(prepared.initialResponse).toEqual({ type: 4, data: message });
  expect(prepared.runAfterResponse).toBeUndefined();
  expect(DiscordDraftFlow.prototype.start).toHaveBeenCalledTimes(1);
});

test("passes Label-wrapped text values and current actor context to the flow", async (): Promise<void> => {
  const prepared: DiscordPreparedInteraction = await dispatcher.prepare(
    envelope(DiscordInteractionKind.ModalSubmit, {
      custom_id: `oud:${draftId}:1:text`,
      components: [
        {
          type: 18,
          component: { type: 4, custom_id: "title", value: "Edited title" },
        },
      ],
    }),
  );
  await prepared.runAfterResponse!();
  expect(DiscordDraftFlow.prototype.continue).toHaveBeenCalledWith(
    expect.objectContaining({
      kind: DiscordInteractionKind.ModalSubmit,
      values: { title: "Edited title" },
      selections: {},
      context: expect.objectContaining({ projectId, userId, channelId }),
    }),
  );
});

test("preserves all selected values rather than using the single-value picker parser", async (): Promise<void> => {
  const prepared: DiscordPreparedInteraction = await dispatcher.prepare(
    component("select", ["first", "second"]),
  );
  await prepared.runAfterResponse!();
  expect(DiscordDraftFlow.prototype.continue).toHaveBeenCalledWith(
    expect.objectContaining({
      values: {},
      selections: { selection: ["first", "second"] },
    }),
  );
});

test("a field chooser keys its single selection as the field and an empty select is preserved", async (): Promise<void> => {
  const chooser: DiscordPreparedInteraction = await dispatcher.prepare(
    component("field", ["monitors"]),
  );
  await chooser.runAfterResponse!();
  expect(DiscordDraftFlow.prototype.continue).toHaveBeenLastCalledWith(
    expect.objectContaining({ selections: { field: ["monitors"] } }),
  );
  const cleared: DiscordPreparedInteraction = await dispatcher.prepare(
    component("select", []),
  );
  await cleared.runAfterResponse!();
  expect(DiscordDraftFlow.prototype.continue).toHaveBeenLastCalledWith(
    expect.objectContaining({ selections: { selection: [] } }),
  );
});

test.each(["not-an-array", [123]])(
  "rejects malformed selection payload %j before the flow",
  async (values: string | Array<number>): Promise<void> => {
    const prepared: DiscordPreparedInteraction = await dispatcher.prepare(
      envelope(DiscordInteractionKind.MessageComponent, {
        custom_id: `oud:${draftId}:1:select`,
        component_type: 3,
        values,
      }),
    );
    expect(prepared.initialResponse).toMatchObject({
      type: 4,
      data: { flags: 64 },
    });
    expect(DiscordDraftFlow.prototype.continue).not.toHaveBeenCalled();
  },
);

test.each(["membership", "receipt binding"])(
  "refuses continuation before the flow when %s fails",
  async (boundary: string): Promise<void> => {
    if (boundary === "membership") {
      jest
        .mocked(WorkspaceActionAuthorization.getProjectMemberProps)
        .mockRejectedValue(new NotAuthorizedException("Access removed"));
    } else {
      jest
        .mocked(ReceiptService.bindContext)
        .mockRejectedValue(new Error("Binding failed"));
    }
    const prepared: DiscordPreparedInteraction = await dispatcher.prepare(
      component("edit"),
    );
    expect(prepared.initialResponse).toMatchObject({
      type: 4,
      data: { flags: 64 },
    });
    expect(DiscordDraftFlow.prototype.continue).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  },
);

test("does not route an in-progress receipt to the draft flow", async (): Promise<void> => {
  jest.mocked(ReceiptService.claim).mockResolvedValue({ kind: "in_progress" });
  const prepared: DiscordPreparedInteraction = await dispatcher.prepare(
    component("submit"),
  );
  expect(prepared.runAfterResponse).toBeUndefined();
  expect(DiscordDraftFlow.prototype.continue).not.toHaveBeenCalled();
  expect(submit).not.toHaveBeenCalled();
});

test("does not register a final draft handler as an ordinary component action", async (): Promise<void> => {
  const prepared: DiscordPreparedInteraction = await dispatcher.prepare(
    envelope(DiscordInteractionKind.MessageComponent, {
      custom_id: "SubmitExample",
      component_type: 2,
    }),
  );
  expect(prepared.initialResponse).toMatchObject({
    type: 4,
    data: { flags: 64 },
  });
  expect(prepared.runAfterResponse).toBeUndefined();
  expect(submit).not.toHaveBeenCalled();
});
