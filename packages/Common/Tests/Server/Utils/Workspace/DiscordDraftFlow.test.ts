import ObjectID from "../../../../Types/ObjectID";
import { JSONObject } from "../../../../Types/JSON";
import DiscordDraftFlow, {
  isValidatedProvenance,
} from "../../../../Server/Utils/Workspace/Discord/DiscordDraftFlow";
import DraftService, {
  DiscordDraftRead,
  DiscordDraftClaim,
} from "../../../../Server/Services/DiscordCreationDraftService";
import {
  DiscordActionContext,
  DiscordDraftDescriptor,
  DiscordDraftSubmissionRequest,
  DiscordInteractionKind,
} from "../../../../Server/Utils/Workspace/Discord/Actions/Types";

/*
 * Failure inventory predates flow implementation. Domain mutation must not run
 * through a forged continuation, stale review, different actor, cancellation,
 * missing durable claim, or duplicate final click. Native fields must preserve
 * page selections, reject forged options, and never silently truncate choices.
 * Persistence concurrency itself has separate PostgreSQL workflow coverage.
 */
jest.mock(
  "../../../../Server/Services/DiscordCreationDraftService",
  (): Record<string, unknown> => {
    return {
      __esModule: true,
      default: {
        open: jest.fn(),
        read: jest.fn(),
        change: jest.fn(),
        claim: jest.fn(),
        cancel: jest.fn(),
        finish: jest.fn(),
      },
    };
  },
);

interface View {
  id: ObjectID;
  revision: number;
  reviewedRevision?: number;
  expiresAt: Date;
  content: JSONObject;
}
let current: View;
let flow: DiscordDraftFlow;
const projectId: ObjectID = ObjectID.generate();
const userId: ObjectID = ObjectID.generate();
const firstOption: string = ObjectID.generate().toString();
const secondOption: string = ObjectID.generate().toString();
const createdResourceId: string = ObjectID.generate().toString();
const context: DiscordActionContext = {
  projectId,
  userId,
  props: {},
  guildId: "100000000000000004",
  channelId: "100000000000000005",
  discordUserId: "100000000000000003",
};
const descriptor: DiscordDraftDescriptor = {
  name: "create-incident",
  title: "Create incident",
  submitAction: "SubmitNewIncident",
  fields: [
    {
      kind: "text",
      customId: "title",
      label: "Title",
      required: true,
      maxLength: 200,
    },
    {
      kind: "text",
      customId: "description",
      label: "Description",
      required: true,
      maxLength: 4000,
      style: "paragraph",
    },
    {
      kind: "choice",
      customId: "monitors",
      label: "Monitors",
      provider: "monitors",
      required: false,
      multiple: true,
    },
  ],
};
const submit: jest.Mock = jest.fn();
const getPage: jest.Mock = jest.fn();

function findComponent(message: JSONObject, label: string): JSONObject {
  const visit: (value: unknown) => JSONObject | undefined = (
    value: unknown,
  ): JSONObject | undefined => {
    if (!value || typeof value !== "object") {
      return undefined;
    }
    if (Array.isArray(value)) {
      for (const child of value) {
        const found: JSONObject | undefined = visit(child);
        if (found) {
          return found;
        }
      }
      return undefined;
    }
    const item: JSONObject = value as JSONObject;
    if (item["label"] === label || item["placeholder"] === label) {
      return item;
    }
    for (const child of Object.values(item)) {
      const found: JSONObject | undefined = visit(child);
      if (found) {
        return found;
      }
    }
    return undefined;
  };
  const component: JSONObject | undefined = visit(message);
  expect(component).toBeDefined();
  return component!;
}

async function act(
  customId: string,
  kind: DiscordInteractionKind = DiscordInteractionKind.MessageComponent,
  values: Readonly<Record<string, string>> = {},
  selections: Readonly<Record<string, ReadonlyArray<string>>> = {},
): Promise<JSONObject> {
  const plan: Awaited<ReturnType<DiscordDraftFlow["continue"]>> =
    await flow.continue({
      kind,
      customId,
      values,
      selections,
      context,
    });
  return plan.mode === "immediate" ? plan.response : await plan.execute();
}
async function click(message: JSONObject, label: string): Promise<JSONObject> {
  return act(String(findComponent(message, label)["custom_id"]));
}
async function filled(): Promise<JSONObject> {
  const opened: JSONObject = await flow.start({ draft: descriptor, context });
  const modal: JSONObject = await click(opened, "Edit text");
  expect(modal["type"]).toBe(9);
  const data: JSONObject = modal["data"] as JSONObject;
  return act(String(data["custom_id"]), DiscordInteractionKind.ModalSubmit, {
    title: "New incident",
    description: "Details",
  });
}

beforeEach((): void => {
  jest.clearAllMocks();
  jest
    .mocked(DraftService.open)
    .mockImplementation(
      async (input: Parameters<typeof DraftService.open>[0]): Promise<View> => {
        current = {
          id: ObjectID.generate(),
          revision: 1,
          expiresAt: new Date(Date.now() + 600000),
          content: input.content,
        };
        return current;
      },
    );
  jest
    .mocked(DraftService.read)
    .mockImplementation(async (): Promise<DiscordDraftRead> => {
      return { kind: "open", draft: current };
    });
  jest
    .mocked(DraftService.change)
    .mockImplementation(
      async (
        input: Parameters<typeof DraftService.change>[0],
      ): Promise<DiscordDraftRead> => {
        if (input.revision !== current.revision) {
          return {
            kind: "rejected",
            reason: "Draft changed. Open the latest message.",
          };
        }
        current = {
          ...current,
          revision: current.revision + 1,
          content: input.content,
        };
        if (input.review) {
          current.reviewedRevision = current.revision;
        } else {
          delete current.reviewedRevision;
        }
        return { kind: "open", draft: current };
      },
    );
  jest
    .mocked(DraftService.claim)
    .mockImplementation(
      async (
        input: Parameters<typeof DraftService.claim>[0],
      ): Promise<DiscordDraftClaim> => {
        if (
          input.revision !== current.revision ||
          current.reviewedRevision !== current.revision
        ) {
          return {
            kind: "rejected",
            reason: "Review the current draft first.",
          };
        }
        const content: JSONObject = current.content;
        delete current.reviewedRevision;
        return { kind: "acquired", claimId: ObjectID.generate(), content };
      },
    );
  jest
    .mocked(DraftService.cancel)
    .mockResolvedValue({ kind: "terminal", outcome: { kind: "cancelled" } });
  jest.mocked(DraftService.finish).mockResolvedValue(true);
  submit.mockResolvedValue({
    outcome: {
      kind: "created",
      resourceType: "Incident",
      resourceId: createdResourceId,
    },
    response: {
      kind: "message",
      content: `Incident created: ${createdResourceId}`,
      ephemeral: true,
    },
  });
  getPage.mockResolvedValue({
    options: [{ label: "First monitor", value: firstOption }],
    nextCursor: "25",
  });
  flow = new DiscordDraftFlow({
    applicationId: "100000000000000001",
    submissions: [
      {
        name: descriptor.name,
        action: descriptor.submitAction,
        handle: submit,
      },
    ],
    choiceProviders: [{ name: "monitors", getPage }],
  });
});

test("start persists a bound expiring draft without executing creation", async (): Promise<void> => {
  const message: JSONObject = await flow.start({ draft: descriptor, context });
  expect(message).toMatchObject({
    flags: 64,
    allowed_mentions: { parse: [], replied_user: false },
  });
  expect(String(message["content"])).toContain("Expires");
  expect(DraftService.open).toHaveBeenCalledWith(
    expect.objectContaining({
      scope: {
        applicationId: "100000000000000001",
        projectId,
        userId,
        guildId: context.guildId,
        channelId: context.channelId,
        discordUserId: context.discordUserId,
      },
    }),
  );
  expect(submit).not.toHaveBeenCalled();
});
test("unregistered or malformed descriptors cannot open a draft", async (): Promise<void> => {
  await expect(
    flow.start({ draft: { ...descriptor, submitAction: "Unknown" }, context }),
  ).rejects.toThrow();
  await expect(
    flow.start({
      draft: {
        ...descriptor,
        fields: [...descriptor.fields, descriptor.fields[0]!],
      },
      context,
    }),
  ).rejects.toThrow();
  expect(DraftService.open).not.toHaveBeenCalled();
});
test("forged namespace and payload fields never invoke the domain", async (): Promise<void> => {
  expect(flow.handles("SubmitNewIncident")).toBe(false);
  await expect(act("oud:invalid:1:submit")).rejects.toThrow();
  expect(submit).not.toHaveBeenCalled();
});
test("native modal stores complete scalar values, rejects unknown fields", async (): Promise<void> => {
  const opened: JSONObject = await flow.start({ draft: descriptor, context });
  const modal: JSONObject = await click(opened, "Edit text");
  const customId: string = String((modal["data"] as JSONObject)["custom_id"]);
  await expect(
    act(customId, DiscordInteractionKind.ModalSubmit, {
      title: "Title",
      description: "Details",
      tenant: projectId.toString(),
    }),
  ).rejects.toThrow();
  expect(DraftService.change).not.toHaveBeenCalled();
  expect(submit).not.toHaveBeenCalled();
});
test("review is required and final dispatch carries privately minted provenance", async (): Promise<void> => {
  const edited: JSONObject = await filled();
  const reviewed: JSONObject = await click(edited, "Review");
  const response: JSONObject = await click(reviewed, "Submit");
  expect(String(response["content"])).toContain("Incident created:");
  expect(submit).toHaveBeenCalledTimes(1);
  const request: DiscordDraftSubmissionRequest = submit.mock
    .calls[0]![0] as DiscordDraftSubmissionRequest;
  expect(isValidatedProvenance(request.provenance)).toBe(true);
  expect(
    isValidatedProvenance({
      draftId: current.id.toString(),
      revision: current.revision,
    }),
  ).toBe(false);
  expect(isValidatedProvenance({ ...request.provenance })).toBe(false);
  expect(request.values).toEqual({
    title: "New incident",
    description: "Details",
  });
  expect(DraftService.finish).toHaveBeenCalledWith(
    expect.objectContaining({
      outcome: {
        kind: "created",
        resourceType: "Incident",
        resourceId: createdResourceId,
      },
    }),
  );
});
test.each(["in_progress", "terminal", "rejected"])(
  "%s claim never executes creation",
  async (kind: string): Promise<void> => {
    const reviewed: JSONObject = await click(await filled(), "Review");
    jest.mocked(DraftService.claim).mockResolvedValue(
      kind === "terminal"
        ? {
            kind: "terminal",
            outcome: {
              kind: "created",
              resourceType: "Incident",
              resourceId: createdResourceId,
            },
          }
        : kind === "rejected"
          ? { kind: "rejected", reason: "Changed" }
          : { kind: "in_progress" },
    );
    await click(reviewed, "Submit");
    expect(submit).not.toHaveBeenCalled();
  },
);
test("cancel does not invoke the domain", async (): Promise<void> => {
  await click(await filled(), "Cancel");
  expect(DraftService.cancel).toHaveBeenCalledTimes(1);
  expect(submit).not.toHaveBeenCalled();
});
test("a removed actor or installation refusal never reveals draft content", async (): Promise<void> => {
  const opened: JSONObject = await flow.start({ draft: descriptor, context });
  jest
    .mocked(DraftService.read)
    .mockResolvedValue({ kind: "rejected", reason: "Connection changed." });
  const response: JSONObject = await click(opened, "Edit text");
  expect(JSON.stringify(response)).not.toContain("New incident");
  expect(DraftService.change).not.toHaveBeenCalled();
  expect(submit).not.toHaveBeenCalled();
});
test("handler and completion failures never invite another creation", async (): Promise<void> => {
  const reviewed: JSONObject = await click(await filled(), "Review");
  submit.mockRejectedValue(new Error("private payload and token"));
  const response: JSONObject = await click(reviewed, "Submit");
  expect(JSON.stringify(response)).not.toContain("private payload");
  expect(String(response["content"])).toContain("Do not");
  expect(submit).toHaveBeenCalledTimes(1);
  expect(DraftService.finish).toHaveBeenCalledWith(
    expect.objectContaining({ outcome: { kind: "ambiguous" } }),
  );
});

test("an immediate edit refusal is a native ephemeral interaction response", async (): Promise<void> => {
  const opened: JSONObject = await flow.start({ draft: descriptor, context });
  jest.mocked(DraftService.read).mockResolvedValue({
    kind: "rejected",
    reason: "Connection changed.",
  });
  const plan: Awaited<ReturnType<DiscordDraftFlow["continue"]>> =
    await flow.continue({
      kind: DiscordInteractionKind.MessageComponent,
      customId: String(findComponent(opened, "Edit text")["custom_id"]),
      values: {},
      selections: {},
      context,
    });
  expect(plan).toMatchObject({
    mode: "immediate",
    response: {
      type: 4,
      data: {
        content: "Connection changed.",
        flags: 64,
        allowed_mentions: { parse: [], replied_user: false },
      },
    },
  });
  expect(submit).not.toHaveBeenCalled();
});
test("choice pages preserve prior-page selections and use current actor context", async (): Promise<void> => {
  const opened: JSONObject = await filled();
  const chooser: JSONObject = findComponent(opened, "Choose a field");
  const pageOne: JSONObject = await act(
    String(chooser["custom_id"]),
    DiscordInteractionKind.MessageComponent,
    {},
    { field: ["monitors"] },
  );
  const select: JSONObject = findComponent(pageOne, "Select Monitors");
  const selected: JSONObject = await act(
    String(select["custom_id"]),
    DiscordInteractionKind.MessageComponent,
    {},
    { selection: [firstOption] },
  );
  getPage.mockResolvedValue({
    options: [{ label: "Second monitor", value: secondOption }],
    previousCursor: "0",
  });
  const pageTwo: JSONObject = await click(selected, "Next");
  const selectTwo: JSONObject = findComponent(pageTwo, "Select Monitors");
  const selectedTwo: JSONObject = await act(
    String(selectTwo["custom_id"]),
    DiscordInteractionKind.MessageComponent,
    {},
    { selection: [secondOption] },
  );
  const overview: JSONObject = await click(selectedTwo, "Back");
  await click(await click(overview, "Review"), "Submit");
  expect(getPage).toHaveBeenCalledWith(
    expect.objectContaining({ context, cursor: "25", limit: 25 }),
  );
  expect(
    (submit.mock.calls[0]![0] as DiscordDraftSubmissionRequest).selections[
      "monitors"
    ],
  ).toEqual([firstOption, secondOption]);
});
test("forged options are refused instead of being appended to selections", async (): Promise<void> => {
  const opened: JSONObject = await filled();
  const chooser: JSONObject = findComponent(opened, "Choose a field");
  const pageOne: JSONObject = await act(
    String(chooser["custom_id"]),
    DiscordInteractionKind.MessageComponent,
    {},
    { field: ["monitors"] },
  );
  const select: JSONObject = findComponent(pageOne, "Select Monitors");
  await expect(
    act(
      String(select["custom_id"]),
      DiscordInteractionKind.MessageComponent,
      {},
      { selection: [ObjectID.generate().toString()] },
    ),
  ).rejects.toThrow();
  expect(submit).not.toHaveBeenCalled();
});
test("provider failure is not represented as an empty page", async (): Promise<void> => {
  const opened: JSONObject = await filled();
  getPage.mockRejectedValue(new Error("Provider unavailable"));
  const chooser: JSONObject = findComponent(opened, "Choose a field");
  await expect(
    act(
      String(chooser["custom_id"]),
      DiscordInteractionKind.MessageComponent,
      {},
      { field: ["monitors"] },
    ),
  ).rejects.toThrow();
  expect(submit).not.toHaveBeenCalled();
});

test.each(["false", "throw"])(
  "completion %s preserves the known resource and forbids automatic recreation",
  async (failure: string): Promise<void> => {
    const reviewed: JSONObject = await click(await filled(), "Review");
    const submitId: string = String(
      findComponent(reviewed, "Submit")["custom_id"],
    );
    if (failure === "throw") {
      jest
        .mocked(DraftService.finish)
        .mockRejectedValue(new Error("private database detail"));
    } else {
      jest.mocked(DraftService.finish).mockResolvedValue(false);
    }
    const response: JSONObject = await act(submitId);
    expect(String(response["content"])).toContain(createdResourceId);
    expect(String(response["content"])).toContain("Do not");
    expect(JSON.stringify(response)).not.toContain("private database detail");
    jest.mocked(DraftService.claim).mockResolvedValue({ kind: "in_progress" });
    await act(submitId);
    expect(submit).toHaveBeenCalledTimes(1);
  },
);

test("a claimed handler response without a safe resource outcome remains ambiguous", async (): Promise<void> => {
  const reviewed: JSONObject = await click(await filled(), "Review");
  submit.mockResolvedValue({
    response: {
      kind: "message",
      content: "Incident created: unverified",
      ephemeral: true,
    },
  });
  const response: JSONObject = await click(reviewed, "Submit");
  expect(String(response["content"])).toContain("Do not");
  expect(JSON.stringify(response)).not.toContain("unverified");
  expect(DraftService.finish).toHaveBeenCalledWith(
    expect.objectContaining({ outcome: { kind: "ambiguous" } }),
  );
  expect(submit).toHaveBeenCalledTimes(1);
});

test("missing channel context cannot create a resumable draft", async (): Promise<void> => {
  await expect(
    flow.start({
      draft: descriptor,
      context: { ...context, channelId: undefined },
    }),
  ).rejects.toThrow();
  expect(DraftService.open).not.toHaveBeenCalled();
  expect(submit).not.toHaveBeenCalled();
});
