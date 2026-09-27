import DiscordInteractionDispatcher, {
  DiscordMalformedInteractionError,
  DiscordPreparedInteraction,
} from "../../../../Server/Utils/Workspace/Discord/DiscordInteractionDispatcher";
import DiscordBindingService from "../../../../Server/Services/DiscordBindingService";
import GlobalCache from "../../../../Server/Infrastructure/GlobalCache";
import WorkspaceActionAuthorization from "../../../../Server/Utils/Workspace/WorkspaceActionAuthorization";
import DiscordClient from "../../../../Server/Utils/Workspace/Discord/DiscordClient";
import DiscordInteractionReceiptService from "../../../../Server/Services/DiscordInteractionReceiptService";
import {
  DiscordActionModuleRegistration,
  DiscordActionRequest,
  DiscordCommandOptionType,
  DiscordHandlerResponseMode,
  DiscordInteractionKind,
} from "../../../../Server/Utils/Workspace/Discord/Actions/Types";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../../Types/ObjectID";
import { JSONObject } from "../../../../Types/JSON";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";

const APPLICATION_ID: string = "111111111111111111";
const INTERACTION_ID: string = "222222222222222222";
const GUILD_ID: string = "333333333333333333";
const CHANNEL_ID: string = "444444444444444444";
const DISCORD_USER_ID: string = "555555555555555555";
const OTHER_DISCORD_USER_ID: string = "666666666666666666";
const INSTALLATION_GENERATION: string = "a".repeat(64);
const NEXT_INSTALLATION_GENERATION: string = "b".repeat(64);
const PROJECT_ID: ObjectID = new ObjectID(
  "11111111-1111-4111-8111-111111111111",
);
const USER_ID: ObjectID = new ObjectID("22222222-2222-4222-8222-222222222222");
const OTHER_USER_ID: ObjectID = new ObjectID(
  "44444444-4444-4444-8444-444444444444",
);
const RESOURCE_ID: ObjectID = new ObjectID(
  "33333333-3333-4333-8333-333333333333",
);
const PROPS: DatabaseCommonInteractionProps = {
  tenantId: PROJECT_ID,
  userId: USER_ID,
};

function interaction(
  type: DiscordInteractionKind,
  data: JSONObject,
): JSONObject {
  return {
    id: INTERACTION_ID,
    application_id: APPLICATION_ID,
    token: "signed.interaction_token",
    type,
    guild_id: GUILD_ID,
    channel_id: CHANNEL_ID,
    member: { user: { id: DISCORD_USER_ID } },
    data,
  };
}

function component(customId: string, values?: Array<string>): JSONObject {
  return interaction(DiscordInteractionKind.MessageComponent, {
    custom_id: customId,
    component_type: values ? 3 : 2,
    ...(values ? { values } : {}),
  });
}

function registration(data: {
  action: string;
  kind: DiscordInteractionKind;
  mode: DiscordHandlerResponseMode;
  handle: (request: DiscordActionRequest) => Promise<any>;
}): DiscordActionModuleRegistration {
  return {
    handlers: [
      {
        actions: [data.action],
        interactionKinds: [data.kind],
        responseMode: data.mode,
        handle: data.handle,
      },
    ],
  };
}

describe("Discord interaction dispatcher", () => {
  beforeEach((): void => {
    jest
      .spyOn(DiscordInteractionReceiptService, "claim")
      .mockResolvedValue({ kind: "acquired" });
    jest
      .spyOn(DiscordInteractionReceiptService, "complete")
      .mockResolvedValue();
    jest
      .spyOn(DiscordInteractionReceiptService, "bindContext")
      .mockResolvedValue();
    jest.spyOn(DiscordInteractionReceiptService, "fail").mockResolvedValue();
    jest.spyOn(GlobalCache, "setString").mockResolvedValue();
    jest.spyOn(GlobalCache, "getString").mockResolvedValue(null);
    jest
      .spyOn(DiscordBindingService, "resolveLinkedMember")
      .mockResolvedValue({ projectId: PROJECT_ID, userId: USER_ID });
    jest.spyOn(DiscordBindingService, "snapshot").mockResolvedValue({
      fingerprint: INSTALLATION_GENERATION,
      workspaceProjectId: GUILD_ID,
    });
    jest
      .spyOn(WorkspaceActionAuthorization, "getProjectMemberProps")
      .mockResolvedValue(PROPS);
    jest
      .spyOn(DiscordClient, "editOriginalInteractionResponse")
      .mockResolvedValue();
  });

  afterEach((): void => {
    jest.restoreAllMocks();
  });

  test("defers slow component work before invoking the handler and edits the original response", async (): Promise<void> => {
    let finish: (() => void) | undefined;
    let markStarted: (() => void) | undefined;
    const started: Promise<void> = new Promise((resolve: () => void): void => {
      markStarted = resolve;
    });
    const handle: jest.Mock = jest.fn(async (): Promise<any> => {
      markStarted!();
      return await new Promise((resolve: (value: any) => void): void => {
        finish = (): void => {
          return resolve({ kind: "message", content: "Done @everyone" });
        };
      });
    });
    const dispatcher: DiscordInteractionDispatcher =
      new DiscordInteractionDispatcher({
        applicationId: APPLICATION_ID,
        modules: [
          registration({
            action: "AcknowledgeIncident",
            kind: DiscordInteractionKind.MessageComponent,
            mode: DiscordHandlerResponseMode.Deferred,
            handle,
          }),
        ],
      });

    const prepared: DiscordPreparedInteraction = await dispatcher.prepare(
      component(`AcknowledgeIncident:${RESOURCE_ID}`),
    );
    expect(prepared.initialResponse).toEqual({
      type: 5,
      data: { flags: 64, allowed_mentions: { parse: [], replied_user: false } },
    });
    expect(handle).not.toHaveBeenCalled();

    const deferred: Promise<void> = prepared.runAfterResponse!();
    await started;
    expect(DiscordInteractionReceiptService.claim).toHaveBeenCalledWith({
      applicationId: APPLICATION_ID,
      interactionId: INTERACTION_ID,
      guildId: GUILD_ID,
      discordUserId: DISCORD_USER_ID,
    });
    expect(DiscordInteractionReceiptService.bindContext).toHaveBeenCalledWith({
      applicationId: APPLICATION_ID,
      interactionId: INTERACTION_ID,
      guildId: GUILD_ID,
      discordUserId: DISCORD_USER_ID,
      projectId: PROJECT_ID,
      userId: USER_ID,
    });
    expect(
      (DiscordInteractionReceiptService.bindContext as jest.Mock).mock
        .invocationCallOrder[0] as number,
    ).toBeLessThan(handle.mock.invocationCallOrder[0] as number);
    expect(handle).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "AcknowledgeIncident",
        resourceId: RESOURCE_ID,
        values: {},
        context: expect.objectContaining({
          projectId: PROJECT_ID,
          userId: USER_ID,
          props: PROPS,
        }),
      }),
    );
    finish!();
    await deferred;
    expect(handle.mock.invocationCallOrder[0] as number).toBeLessThan(
      (DiscordInteractionReceiptService.complete as jest.Mock).mock
        .invocationCallOrder[0] as number,
    );
    expect(DiscordClient.editOriginalInteractionResponse).toHaveBeenCalledWith(
      expect.objectContaining({
        applicationId: APPLICATION_ID,
        interactionToken: "signed.interaction_token",
        message: expect.objectContaining({
          content: "Done @everyone",
          allowed_mentions: { parse: [], replied_user: false },
        }),
      }),
    );
  });

  test("renders an immediate native modal and bounded fields", async (): Promise<void> => {
    const dispatcher: DiscordInteractionDispatcher =
      new DiscordInteractionDispatcher({
        applicationId: APPLICATION_ID,
        modules: [
          registration({
            action: "ViewAddIncidentNote",
            kind: DiscordInteractionKind.MessageComponent,
            mode: DiscordHandlerResponseMode.Immediate,
            handle: async (): Promise<any> => {
              return {
                kind: "modal",
                modal: {
                  customId: `SubmitIncidentNote:${RESOURCE_ID}`,
                  title: "Add incident note",
                  fields: [
                    {
                      kind: "string-select",
                      customId: "noteType",
                      label: "Visibility",
                      required: true,
                      options: [
                        { label: "Private", value: "private" },
                        { label: "Public", value: "public" },
                      ],
                    },
                    {
                      kind: "text",
                      customId: "note",
                      label: "Note",
                      style: "paragraph",
                      required: true,
                      minLength: 1,
                      maxLength: 4000,
                    },
                  ],
                },
              };
            },
          }),
        ],
      });

    const prepared: DiscordPreparedInteraction = await dispatcher.prepare(
      component(`ViewAddIncidentNote:${RESOURCE_ID}`),
    );
    expect(prepared.runAfterResponse).toBeUndefined();
    expect(DiscordInteractionReceiptService.complete).toHaveBeenCalledTimes(1);
    expect(prepared.initialResponse).toMatchObject({
      type: 9,
      data: {
        custom_id: `SubmitIncidentNote:${RESOURCE_ID}`,
        title: "Add incident note",
        components: [
          {
            type: 18,
            label: "Visibility",
            component: { type: 3, custom_id: "noteType" },
          },
          {
            type: 18,
            label: "Note",
            component: {
              type: 4,
              custom_id: "note",
              min_length: 1,
              max_length: 4000,
            },
          },
        ],
      },
    });
    // Discord rejects a label on an input nested inside a Label component.
    for (const field of (prepared.initialResponse["data"] as JSONObject)[
      "components"
    ] as Array<JSONObject>) {
      expect(field["component"] as JSONObject).not.toHaveProperty("label");
    }
  });

  test("keeps immediate picker controls ephemeral", async (): Promise<void> => {
    const dispatcher: DiscordInteractionDispatcher =
      new DiscordInteractionDispatcher({
        applicationId: APPLICATION_ID,
        modules: [
          {
            ...registration({
              action: "ViewChangeIncidentState",
              kind: DiscordInteractionKind.MessageComponent,
              mode: DiscordHandlerResponseMode.Immediate,
              handle: async (): Promise<any> => {
                return {
                  kind: "picker",
                  picker: {
                    provider: "incident-states",
                    submitAction: "SubmitChangeIncidentState",
                    field: "stateId",
                    title: "Change incident state",
                    resourceId: RESOURCE_ID,
                  },
                };
              },
            }),
            choiceProviders: [
              {
                name: "incident-states",
                getPage: async (): Promise<any> => {
                  return {
                    options: [
                      { label: "Investigating", value: USER_ID.toString() },
                    ],
                  };
                },
              },
            ],
          },
        ],
      });

    const prepared: DiscordPreparedInteraction = await dispatcher.prepare(
      component(`ViewChangeIncidentState:${RESOURCE_ID}`),
    );

    expect(prepared.initialResponse).toMatchObject({
      type: 4,
      data: {
        flags: 64,
        allowed_mentions: { parse: [], replied_user: false },
        components: expect.any(Array),
      },
    });
  });

  test("flattens modal values without trusting a form as authorization", async (): Promise<void> => {
    const handle: jest.Mock = jest
      .fn()
      .mockResolvedValue({ kind: "message", content: "Note added." });
    const dispatcher: DiscordInteractionDispatcher =
      new DiscordInteractionDispatcher({
        applicationId: APPLICATION_ID,
        modules: [
          registration({
            action: "SubmitIncidentNote",
            kind: DiscordInteractionKind.ModalSubmit,
            mode: DiscordHandlerResponseMode.Deferred,
            handle,
          }),
        ],
      });
    const prepared: DiscordPreparedInteraction = await dispatcher.prepare(
      interaction(DiscordInteractionKind.ModalSubmit, {
        custom_id: `SubmitIncidentNote:${RESOURCE_ID}`,
        components: [
          {
            type: 1,
            components: [
              { type: 3, custom_id: "noteType", values: ["private"] },
              { type: 4, custom_id: "note", value: "hello" },
            ],
          },
        ],
      }),
    );
    await prepared.runAfterResponse!();
    expect(handle).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceId: RESOURCE_ID,
        values: { noteType: "private", note: "hello" },
      }),
    );
    expect(
      WorkspaceActionAuthorization.getProjectMemberProps,
    ).toHaveBeenCalledTimes(1);
  });

  test("reads modal values submitted inside Label components", async (): Promise<void> => {
    const handle: jest.Mock = jest
      .fn()
      .mockResolvedValue({ kind: "message", content: "Note added." });
    const dispatcher: DiscordInteractionDispatcher =
      new DiscordInteractionDispatcher({
        applicationId: APPLICATION_ID,
        modules: [
          registration({
            action: "SubmitIncidentNote",
            kind: DiscordInteractionKind.ModalSubmit,
            mode: DiscordHandlerResponseMode.Deferred,
            handle,
          }),
        ],
      });
    const prepared: DiscordPreparedInteraction = await dispatcher.prepare(
      interaction(DiscordInteractionKind.ModalSubmit, {
        custom_id: `SubmitIncidentNote:${RESOURCE_ID}`,
        components: [
          {
            type: 18,
            id: 1,
            component: {
              type: 3,
              id: 2,
              custom_id: "noteType",
              values: ["public"],
            },
          },
          {
            type: 18,
            id: 3,
            component: { type: 4, id: 4, custom_id: "note", value: "hello" },
          },
        ],
      }),
    );
    await prepared.runAfterResponse!();
    expect(handle).toHaveBeenCalledWith(
      expect.objectContaining({
        resourceId: RESOURCE_ID,
        values: { noteType: "public", note: "hello" },
      }),
    );
  });

  test("routes commands and autocomplete through registered typed providers", async (): Promise<void> => {
    const handle: jest.Mock = jest
      .fn()
      .mockResolvedValue({ kind: "message", content: "Changed." });
    const getPage: jest.Mock = jest.fn().mockResolvedValue({
      options: [{ label: "Investigating", value: RESOURCE_ID.toString() }],
    });
    const module: DiscordActionModuleRegistration = {
      ...registration({
        action: "ChangeIncidentState",
        kind: DiscordInteractionKind.ApplicationCommand,
        mode: DiscordHandlerResponseMode.Deferred,
        handle,
      }),
      choiceProviders: [{ name: "incident-states", getPage }],
      commands: [
        {
          name: "incident-state",
          description: "Change an incident state",
          action: "ChangeIncidentState",
          options: [
            {
              type: DiscordCommandOptionType.String,
              name: "resource-id",
              description: "Incident ID",
              required: true,
            },
            {
              type: DiscordCommandOptionType.String,
              name: "state",
              description: "State",
              autocompleteProvider: "incident-states",
              required: true,
            },
          ],
        },
      ],
    };
    const dispatcher: DiscordInteractionDispatcher =
      new DiscordInteractionDispatcher({
        applicationId: APPLICATION_ID,
        modules: [module],
      });

    expect(dispatcher.commandPayloads()).toEqual([
      expect.objectContaining({
        name: "incident-state",
        description: "Change an incident state",
        options: expect.arrayContaining([
          expect.objectContaining({ name: "state", autocomplete: true }),
        ]),
      }),
    ]);
    const autocomplete: DiscordPreparedInteraction = await dispatcher.prepare(
      interaction(DiscordInteractionKind.ApplicationCommandAutocomplete, {
        name: "incident-state",
        options: [
          { name: "resource-id", type: 3, value: RESOURCE_ID.toString() },
          { name: "state", type: 3, value: "invest", focused: true },
        ],
      }),
    );
    expect(autocomplete.initialResponse).toEqual({
      type: 8,
      data: {
        choices: [{ name: "Investigating", value: RESOURCE_ID.toString() }],
      },
    });
    expect(getPage).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: "incident-states",
        resourceId: RESOURCE_ID,
        search: "invest",
        limit: 25,
      }),
    );

    const command: DiscordPreparedInteraction = await dispatcher.prepare({
      ...interaction(DiscordInteractionKind.ApplicationCommand, {
        name: "incident-state",
        options: [
          { name: "resource-id", type: 3, value: RESOURCE_ID.toString() },
          { name: "state", type: 3, value: RESOURCE_ID.toString() },
        ],
      }),
      id: "666666666666666666",
    });
    await command.runAfterResponse!();
    expect(handle).toHaveBeenCalledWith(
      expect.objectContaining({
        action: "ChangeIncidentState",
        resourceId: RESOURCE_ID,
        values: expect.objectContaining({ state: RESOURCE_ID.toString() }),
      }),
    );
  });

  test("rejects forged custom IDs, malformed values, and unknown actions with a visible response", async (): Promise<void> => {
    const handle: jest.Mock = jest.fn();
    const dispatcher: DiscordInteractionDispatcher =
      new DiscordInteractionDispatcher({
        applicationId: APPLICATION_ID,
        modules: [
          registration({
            action: "AcknowledgeIncident",
            kind: DiscordInteractionKind.MessageComponent,
            mode: DiscordHandlerResponseMode.Deferred,
            handle,
          }),
        ],
      });
    for (const customId of [
      "AcknowledgeIncident:not-a-uuid",
      `AcknowledgeIncident:${RESOURCE_ID}:extra`,
      `UnknownIncidentAction:${RESOURCE_ID}`,
      "x".repeat(101),
    ]) {
      const result: DiscordPreparedInteraction = await dispatcher.prepare({
        ...component(customId),
        id: String(BigInt(INTERACTION_ID) + BigInt(customId.length)),
      });
      expect(result.initialResponse).toMatchObject({
        type: 4,
        data: {
          flags: 64,
          allowed_mentions: { parse: [], replied_user: false },
        },
      });
      expect(
        String((result.initialResponse["data"] as JSONObject)["content"]),
      ).toMatch(/not supported|invalid/i);
    }
    expect(handle).not.toHaveBeenCalled();
  });

  test("returns explicit durable replay outcomes without queuing the handler", async (): Promise<void> => {
    const handle: jest.Mock = jest
      .fn()
      .mockResolvedValue({ kind: "message", content: "done" });
    const dispatcher: DiscordInteractionDispatcher =
      new DiscordInteractionDispatcher({
        applicationId: APPLICATION_ID,
        modules: [
          registration({
            action: "AcknowledgeIncident",
            kind: DiscordInteractionKind.MessageComponent,
            mode: DiscordHandlerResponseMode.Deferred,
            handle,
          }),
        ],
      });
    (DiscordInteractionReceiptService.claim as jest.Mock).mockResolvedValueOnce(
      {
        kind: "in_progress",
      },
    );
    const inProgress: DiscordPreparedInteraction = await dispatcher.prepare(
      component(`AcknowledgeIncident:${RESOURCE_ID}`),
    );
    expect(inProgress.runAfterResponse).toBeUndefined();
    expect(inProgress.initialResponse).toMatchObject({
      type: 4,
      data: { flags: 64, allowed_mentions: { parse: [], replied_user: false } },
    });
    expect(
      String((inProgress.initialResponse["data"] as JSONObject)["content"]),
    ).toContain("already in progress");

    const storedResponse: JSONObject = {
      type: 4,
      data: {
        content: "This Discord interaction was already processed.",
        flags: 64,
        allowed_mentions: { parse: [], replied_user: false },
      },
    };
    (DiscordInteractionReceiptService.claim as jest.Mock).mockResolvedValueOnce(
      {
        kind: "terminal",
        response: storedResponse,
      },
    );
    const completed: DiscordPreparedInteraction = await dispatcher.prepare({
      ...component(`AcknowledgeIncident:${RESOURCE_ID}`),
      id: "777777777777777777",
    });
    expect(completed).toEqual({ initialResponse: storedResponse });

    // Redis can restart empty without becoming the replay authority.
    (GlobalCache.getString as jest.Mock).mockResolvedValueOnce(null);
    (DiscordInteractionReceiptService.claim as jest.Mock).mockResolvedValueOnce(
      {
        kind: "terminal",
        response: storedResponse,
      },
    );
    const afterRedisRestart: DiscordPreparedInteraction =
      await dispatcher.prepare({
        ...component(`AcknowledgeIncident:${RESOURCE_ID}`),
        id: "888888888888888888",
      });
    expect(afterRedisRestart).toEqual({ initialResponse: storedResponse });

    (DiscordInteractionReceiptService.claim as jest.Mock).mockRejectedValueOnce(
      new Error("redis down"),
    );
    const unavailable: DiscordPreparedInteraction = await dispatcher.prepare({
      ...component(`AcknowledgeIncident:${RESOURCE_ID}`),
      id: "999999999999999999",
    });
    expect(unavailable.runAfterResponse).toBeUndefined();
    expect(unavailable.initialResponse).toMatchObject({
      type: 4,
      data: { flags: 64 },
    });
    expect(
      String((unavailable.initialResponse["data"] as JSONObject)["content"]),
    ).toContain("temporarily unavailable");
    expect(handle).not.toHaveBeenCalled();
  });

  test("records success only after persistence and stores failures without retrying", async (): Promise<void> => {
    const persisted: jest.Mock = jest
      .fn()
      .mockResolvedValueOnce({ kind: "message", content: "persisted" })
      .mockRejectedValueOnce(new Error("persistence failed"));
    const dispatcher: DiscordInteractionDispatcher =
      new DiscordInteractionDispatcher({
        applicationId: APPLICATION_ID,
        modules: [
          registration({
            action: "SubmitIncidentNote",
            kind: DiscordInteractionKind.ModalSubmit,
            mode: DiscordHandlerResponseMode.Deferred,
            handle: persisted,
          }),
        ],
      });
    const noteInteraction: JSONObject = interaction(
      DiscordInteractionKind.ModalSubmit,
      {
        custom_id: `SubmitIncidentNote:${RESOURCE_ID}`,
        components: [
          {
            type: 1,
            components: [{ type: 4, custom_id: "note", value: "hello" }],
          },
        ],
      },
    );

    const success: DiscordPreparedInteraction =
      await dispatcher.prepare(noteInteraction);
    await success.runAfterResponse!();
    expect(persisted.mock.invocationCallOrder[0] as number).toBeLessThan(
      (DiscordInteractionReceiptService.complete as jest.Mock).mock
        .invocationCallOrder[0] as number,
    );
    expect(DiscordInteractionReceiptService.fail).not.toHaveBeenCalled();

    const failure: DiscordPreparedInteraction = await dispatcher.prepare({
      ...noteInteraction,
      id: "666666666666666666",
    });
    await failure.runAfterResponse!();
    expect(DiscordInteractionReceiptService.complete).toHaveBeenCalledTimes(1);
    expect(DiscordInteractionReceiptService.fail).toHaveBeenCalledTimes(1);
    expect(
      (DiscordInteractionReceiptService.fail as jest.Mock).mock.calls[0]![0]
        .response,
    ).toMatchObject({
      type: 4,
      data: {
        flags: 64,
        allowed_mentions: { parse: [], replied_user: false },
        content: expect.stringMatching(/could not be confirmed.*do not retry/i),
      },
    });
  });

  test("leaves an ambiguous completed mutation in progress for reconciliation", async (): Promise<void> => {
    const handle: jest.Mock = jest
      .fn()
      .mockResolvedValue({ kind: "message", content: "persisted" });
    (
      DiscordInteractionReceiptService.complete as jest.Mock
    ).mockRejectedValueOnce(new Error("database unavailable after commit"));
    const dispatcher: DiscordInteractionDispatcher =
      new DiscordInteractionDispatcher({
        applicationId: APPLICATION_ID,
        modules: [
          registration({
            action: "AcknowledgeIncident",
            kind: DiscordInteractionKind.MessageComponent,
            mode: DiscordHandlerResponseMode.Deferred,
            handle,
          }),
        ],
      });
    const prepared: DiscordPreparedInteraction = await dispatcher.prepare(
      component(`AcknowledgeIncident:${RESOURCE_ID}`),
    );
    await prepared.runAfterResponse!();
    expect(handle).toHaveBeenCalledTimes(1);
    expect(DiscordInteractionReceiptService.fail).not.toHaveBeenCalled();
    const edit: JSONObject = (
      DiscordClient.editOriginalInteractionResponse as jest.Mock
    ).mock.calls[0]![0].message;
    expect(String(edit["content"])).toContain("could not be confirmed");
  });

  test("fails closed before domain work when durable actor binding fails", async (): Promise<void> => {
    const handle: jest.Mock = jest
      .fn()
      .mockResolvedValue({ kind: "message", content: "persisted" });
    (
      DiscordInteractionReceiptService.bindContext as jest.Mock
    ).mockRejectedValueOnce(new Error("receipt actor mismatch"));
    const dispatcher: DiscordInteractionDispatcher =
      new DiscordInteractionDispatcher({
        applicationId: APPLICATION_ID,
        modules: [
          registration({
            action: "AcknowledgeIncident",
            kind: DiscordInteractionKind.MessageComponent,
            mode: DiscordHandlerResponseMode.Deferred,
            handle,
          }),
        ],
      });
    const prepared: DiscordPreparedInteraction = await dispatcher.prepare(
      component(`AcknowledgeIncident:${RESOURCE_ID}`),
    );
    await prepared.runAfterResponse!();
    expect(handle).not.toHaveBeenCalled();
    expect(DiscordInteractionReceiptService.fail).toHaveBeenCalledTimes(1);
    expect(DiscordInteractionReceiptService.complete).not.toHaveBeenCalled();
  });

  test("renders paginated picker controls and reauthorizes a selected value", async (): Promise<void> => {
    const handle: jest.Mock = jest
      .fn()
      .mockResolvedValueOnce({
        kind: "picker",
        picker: {
          provider: "incident-states",
          submitAction: "SubmitChangeIncidentState",
          field: "stateId",
          title: "Change incident state",
          resourceId: RESOURCE_ID,
        },
      })
      .mockResolvedValueOnce({ kind: "message", content: "State changed." });
    const getPage: jest.Mock = jest.fn().mockResolvedValue({
      options: [{ label: "Investigating", value: USER_ID.toString() }],
      nextCursor: "25",
    });
    const dispatcher: DiscordInteractionDispatcher =
      new DiscordInteractionDispatcher({
        applicationId: APPLICATION_ID,
        modules: [
          {
            handlers: [
              {
                actions: ["ViewChangeIncidentState"],
                interactionKinds: [DiscordInteractionKind.MessageComponent],
                responseMode: DiscordHandlerResponseMode.Deferred,
                handle,
              },
              {
                actions: ["SubmitChangeIncidentState"],
                interactionKinds: [DiscordInteractionKind.MessageComponent],
                responseMode: DiscordHandlerResponseMode.Deferred,
                handle,
              },
            ],
            choiceProviders: [{ name: "incident-states", getPage }],
          },
        ],
      });
    const prepared: DiscordPreparedInteraction = await dispatcher.prepare(
      component(`ViewChangeIncidentState:${RESOURCE_ID}`),
    );
    await prepared.runAfterResponse!();
    const edit: JSONObject = (
      DiscordClient.editOriginalInteractionResponse as jest.Mock
    ).mock.calls[0]![0].message;
    expect(edit["components"]).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          components: expect.arrayContaining([
            expect.objectContaining({ type: 3, options: expect.any(Array) }),
          ]),
        }),
      ]),
    );
    expect(JSON.stringify(edit)).toContain("PickerPage:");
    expect(JSON.stringify(edit)).toContain("PickerSearch:");

    const cacheWrite: [string, string, string] = (
      GlobalCache.setString as jest.Mock
    ).mock.calls[0];
    const initialState: JSONObject = JSON.parse(cacheWrite[2]) as JSONObject;
    expect(initialState).toMatchObject({
      projectId: PROJECT_ID.toString(),
      userId: USER_ID.toString(),
      guildId: GUILD_ID,
      discordUserId: DISCORD_USER_ID,
      installationGeneration: INSTALLATION_GENERATION,
      expiresAt: expect.any(Number),
    });
    const pickerToken: string = cacheWrite[1];
    (GlobalCache.getString as jest.Mock).mockResolvedValue(cacheWrite[2]);
    const selected: DiscordPreparedInteraction = await dispatcher.prepare({
      ...component(`PickerSelect:${pickerToken}`, [USER_ID.toString()]),
      id: "888888888888888888",
    });
    await selected.runAfterResponse!();
    expect(handle).toHaveBeenLastCalledWith(
      expect.objectContaining({
        action: "SubmitChangeIncidentState",
        resourceId: RESOURCE_ID,
        values: { stateId: USER_ID.toString() },
      }),
    );

    const page: DiscordPreparedInteraction = await dispatcher.prepare({
      ...component(`PickerPage:${pickerToken}:next`),
      id: "999999999999999999",
    });
    await page.runAfterResponse!();
    const pageState: JSONObject = JSON.parse(
      (GlobalCache.setString as jest.Mock).mock.calls[1]![2],
    ) as JSONObject;
    expect(pageState["expiresAt"]).toBe(initialState["expiresAt"]);
  });

  test("binds picker continuation to its opener and installation generation", async (): Promise<void> => {
    const handle: jest.Mock = jest.fn().mockResolvedValue({
      kind: "picker",
      picker: {
        provider: "incident-states",
        submitAction: "SubmitChangeIncidentState",
        field: "stateId",
        title: "Change incident state",
        resourceId: RESOURCE_ID,
      },
    });
    const getPage: jest.Mock = jest.fn().mockResolvedValue({
      options: [{ label: "Investigating", value: USER_ID.toString() }],
    });
    const dispatcher: DiscordInteractionDispatcher =
      new DiscordInteractionDispatcher({
        applicationId: APPLICATION_ID,
        modules: [
          {
            handlers: [
              {
                actions: ["ViewChangeIncidentState"],
                interactionKinds: [DiscordInteractionKind.MessageComponent],
                responseMode: DiscordHandlerResponseMode.Deferred,
                handle,
              },
              {
                actions: ["SubmitChangeIncidentState"],
                interactionKinds: [DiscordInteractionKind.MessageComponent],
                responseMode: DiscordHandlerResponseMode.Deferred,
                handle,
              },
            ],
            choiceProviders: [{ name: "incident-states", getPage }],
          },
        ],
      });
    const opened: DiscordPreparedInteraction = await dispatcher.prepare(
      component(`ViewChangeIncidentState:${RESOURCE_ID}`),
    );
    await opened.runAfterResponse!();
    const cacheWrite: [string, string, string] = (
      GlobalCache.setString as jest.Mock
    ).mock.calls[0];
    const pickerToken: string = cacheWrite[1];
    (GlobalCache.getString as jest.Mock).mockResolvedValue(cacheWrite[2]);

    (
      DiscordBindingService.resolveLinkedMember as jest.Mock
    ).mockResolvedValueOnce({ projectId: PROJECT_ID, userId: OTHER_USER_ID });
    const stolen: DiscordPreparedInteraction = await dispatcher.prepare({
      ...component(`PickerSelect:${pickerToken}`, [USER_ID.toString()]),
      id: "777777777777777777",
      member: { user: { id: OTHER_DISCORD_USER_ID } },
    });
    await stolen.runAfterResponse!();
    expect(handle).toHaveBeenCalledTimes(1);

    (DiscordBindingService.snapshot as jest.Mock).mockResolvedValue({
      fingerprint: NEXT_INSTALLATION_GENERATION,
      workspaceProjectId: GUILD_ID,
    });
    const afterReconnect: DiscordPreparedInteraction = await dispatcher.prepare(
      {
        ...component(`PickerSearch:${pickerToken}`),
        id: "888888888888888888",
      },
    );
    expect(afterReconnect.initialResponse).toMatchObject({
      type: 4,
      data: { flags: 64 },
    });
    expect(getPage).toHaveBeenCalledTimes(1);
  });

  test("bounds modal payloads and provider output before calling domain code", async (): Promise<void> => {
    const handle: jest.Mock = jest.fn();
    const dispatcher: DiscordInteractionDispatcher =
      new DiscordInteractionDispatcher({
        applicationId: APPLICATION_ID,
        modules: [
          registration({
            action: "SubmitIncidentNote",
            kind: DiscordInteractionKind.ModalSubmit,
            mode: DiscordHandlerResponseMode.Deferred,
            handle,
          }),
        ],
      });
    const result: DiscordPreparedInteraction = await dispatcher.prepare(
      interaction(DiscordInteractionKind.ModalSubmit, {
        custom_id: `SubmitIncidentNote:${RESOURCE_ID}`,
        components: [
          {
            type: 1,
            components: [
              { type: 4, custom_id: "note", value: "x".repeat(4001) },
            ],
          },
        ],
      }),
    );
    expect(result.initialResponse).toMatchObject({
      type: 4,
      data: { flags: 64 },
    });
    expect(handle).not.toHaveBeenCalled();
  });

  test("keeps an immediate reconciliation response ephemeral when receipt writes fail", async (): Promise<void> => {
    const handle: jest.Mock = jest
      .fn()
      .mockResolvedValue({ kind: "message", content: "updated" });
    (
      DiscordInteractionReceiptService.complete as jest.Mock
    ).mockRejectedValueOnce(new Error("complete failed after mutation"));
    (DiscordInteractionReceiptService.fail as jest.Mock).mockRejectedValueOnce(
      new Error("terminal write also failed"),
    );
    const dispatcher: DiscordInteractionDispatcher =
      new DiscordInteractionDispatcher({
        applicationId: APPLICATION_ID,
        modules: [
          registration({
            action: "AcknowledgeIncident",
            kind: DiscordInteractionKind.MessageComponent,
            mode: DiscordHandlerResponseMode.Immediate,
            handle,
          }),
        ],
      });

    const prepared: DiscordPreparedInteraction = await dispatcher.prepare(
      component(`AcknowledgeIncident:${RESOURCE_ID}`),
    );
    expect(handle).toHaveBeenCalledTimes(1);
    expect(prepared.initialResponse).toEqual({
      type: 4,
      data: expect.objectContaining({
        flags: 64,
        allowed_mentions: { parse: [], replied_user: false },
        content: expect.stringMatching(/could not be confirmed.*do not retry/i),
      }),
    });
  });

  test("returns an empty native autocomplete result when provider authorization fails", async (): Promise<void> => {
    const getPage: jest.Mock = jest
      .fn()
      .mockRejectedValue(new NotAuthorizedException("Membership removed"));
    const dispatcher: DiscordInteractionDispatcher =
      new DiscordInteractionDispatcher({
        applicationId: APPLICATION_ID,
        modules: [
          {
            ...registration({
              action: "ChangeIncidentState",
              kind: DiscordInteractionKind.ApplicationCommand,
              mode: DiscordHandlerResponseMode.Deferred,
              handle: jest.fn(),
            }),
            choiceProviders: [{ name: "incident-states", getPage }],
            commands: [
              {
                name: "incident-state",
                description: "Change an incident state",
                action: "ChangeIncidentState",
                options: [
                  {
                    type: DiscordCommandOptionType.String,
                    name: "state",
                    description: "State",
                    autocompleteProvider: "incident-states",
                  },
                ],
              },
            ],
          },
        ],
      });

    const prepared: DiscordPreparedInteraction = await dispatcher.prepare(
      interaction(DiscordInteractionKind.ApplicationCommandAutocomplete, {
        name: "incident-state",
        options: [{ name: "state", type: 3, value: "invest", focused: true }],
      }),
    );
    expect(prepared).toEqual({
      initialResponse: { type: 8, data: { choices: [] } },
    });
    expect(getPage).toHaveBeenCalledTimes(1);
    expect(DiscordInteractionReceiptService.claim).not.toHaveBeenCalled();
  });

  test("rejects malformed actionable envelopes before claiming a receipt", async (): Promise<void> => {
    const dispatcher: DiscordInteractionDispatcher =
      new DiscordInteractionDispatcher({
        applicationId: APPLICATION_ID,
        modules: [
          registration({
            action: "AcknowledgeIncident",
            kind: DiscordInteractionKind.MessageComponent,
            mode: DiscordHandlerResponseMode.Deferred,
            handle: jest.fn(),
          }),
        ],
      });
    const valid: JSONObject = component(`AcknowledgeIncident:${RESOURCE_ID}`);
    const malformed: Array<JSONObject> = [
      { ...valid, id: undefined },
      { ...valid, token: undefined },
      { ...valid, guild_id: undefined },
      { ...valid, member: undefined },
      { ...valid, data: undefined },
      { ...valid, data: { component_type: 2 } },
      interaction(DiscordInteractionKind.ModalSubmit, { components: [] }),
      interaction(DiscordInteractionKind.ApplicationCommand, {}),
      interaction(DiscordInteractionKind.ApplicationCommandAutocomplete, {}),
    ];
    for (const payload of malformed) {
      await expect(dispatcher.prepare(payload)).rejects.toBeInstanceOf(
        DiscordMalformedInteractionError,
      );
    }
    expect(DiscordInteractionReceiptService.claim).not.toHaveBeenCalled();
  });
});
