import { randomBytes } from "crypto";
import DiscordBindingService, {
  DiscordBindingSnapshot,
} from "../../../Services/DiscordBindingService";
import DiscordInteractionReceiptService, {
  DiscordInteractionReceiptClaim,
} from "../../../Services/DiscordInteractionReceiptService";
import GlobalCache from "../../../Infrastructure/GlobalCache";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import BadDataException from "../../../../Types/Exception/BadDataException";
import NotAuthorizedException from "../../../../Types/Exception/NotAuthorizedException";
import { JSONArray, JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import WorkspaceActionAuthorization from "../WorkspaceActionAuthorization";
import {
  DiscordActionContext,
  DiscordActionModuleRegistration,
  DiscordActionRegistration,
  DiscordActionRequest,
  DiscordActionResult,
  DiscordChoicePage,
  DiscordChoiceProviderRegistration,
  DiscordCommandOption,
  DiscordCommandRegistration,
  DiscordHandlerResponseMode,
  DiscordInteractionKind,
  DiscordModalDescriptor,
  DiscordModalField,
  DiscordStringSelectOption,
} from "./Actions/Types";
import DiscordClient from "./DiscordClient";

const PICKER_NAMESPACE: string = "discord-interaction-picker";
const SESSION_TTL_SECONDS: number = 15 * 60;
const EPHEMERAL_FLAG: number = 64;
const SAFE_MENTIONS: JSONObject = { parse: [], replied_user: false };
const COMMAND_NAME_PATTERN: RegExp = /^[a-z0-9_-]{1,32}$/;
const FORM_FIELD_ID_PATTERN: RegExp = /^[A-Za-z][A-Za-z0-9_-]{0,99}$/;
const INTERNAL_TOKEN_PATTERN: RegExp = /^[a-f0-9]{32}$/;
const SNOWFLAKE_PATTERN: RegExp = /^[0-9]{17,20}$/;
const INSTALLATION_GENERATION_PATTERN: RegExp = /^[a-f0-9]{64}$/;

interface ParsedInteraction {
  id: string;
  type: DiscordInteractionKind;
  token: string;
  guildId: string;
  channelId?: string | undefined;
  discordUserId: string;
  data: JSONObject;
}

interface ParsedAction {
  action: string;
  resourceId?: ObjectID | undefined;
  values: Readonly<Record<string, string>>;
}

interface PickerState {
  provider: string;
  submitAction: string;
  field: string;
  title: string;
  resourceId?: string | undefined;
  description?: string | undefined;
  placeholder?: string | undefined;
  search?: string | undefined;
  cursor?: string | undefined;
  previousCursor?: string | undefined;
  nextCursor?: string | undefined;
  projectId: string;
  userId: string;
  guildId: string;
  discordUserId: string;
  installationGeneration: string;
  expiresAt: number;
}

// A signed envelope missing the fields every actionable interaction carries.
export class DiscordMalformedInteractionError extends BadDataException {}

export interface DiscordPreparedInteraction {
  initialResponse: JSONObject;
  runAfterResponse?: (() => Promise<void>) | undefined;
}

export default class DiscordInteractionDispatcher {
  private readonly applicationId: string;
  private readonly handlers: Map<string, DiscordActionRegistration> = new Map();
  private readonly providers: Map<string, DiscordChoiceProviderRegistration> =
    new Map();
  private readonly commands: Map<string, DiscordCommandRegistration> =
    new Map();

  public constructor(data: {
    applicationId: string;
    modules: ReadonlyArray<DiscordActionModuleRegistration>;
  }) {
    this.applicationId = DiscordClient.snowflake(data.applicationId);
    for (const module of data.modules) {
      for (const registration of module.handlers) {
        if (
          !registration.actions.length ||
          !registration.interactionKinds.length
        ) {
          throw new BadDataException("Invalid Discord action registration.");
        }
        for (const action of registration.actions) {
          this.assertName(action, 64, "action");
          for (const kind of registration.interactionKinds) {
            const key: string = this.handlerKey(kind, action);
            if (this.handlers.has(key)) {
              throw new BadDataException(
                "Duplicate Discord action registration.",
              );
            }
            this.handlers.set(key, registration);
          }
        }
      }
      for (const provider of module.choiceProviders || []) {
        this.assertName(provider.name, 64, "choice provider", true);
        if (this.providers.has(provider.name)) {
          throw new BadDataException("Duplicate Discord choice provider.");
        }
        this.providers.set(provider.name, provider);
      }
      for (const command of module.commands || []) {
        this.assertCommand(command);
        if (this.commands.has(command.name)) {
          throw new BadDataException("Duplicate Discord command registration.");
        }
        this.commands.set(command.name, command);
      }
    }
  }

  public commandPayloads(): JSONArray {
    return Array.from(this.commands.values()).map(
      (command: DiscordCommandRegistration): JSONObject => {
        return {
          type: 1,
          name: command.name,
          description: command.description,
          options: (command.options || []).map(
            (option: DiscordCommandOption): JSONObject => {
              return {
                type: option.type,
                name: option.name,
                description: option.description,
                ...(option.required === undefined
                  ? {}
                  : { required: option.required }),
                ...(option.choices
                  ? { choices: option.choices as unknown as JSONArray }
                  : {}),
                ...(option.autocompleteProvider ? { autocomplete: true } : {}),
              };
            },
          ),
        };
      },
    );
  }

  public async prepare(
    interaction: JSONObject,
  ): Promise<DiscordPreparedInteraction> {
    let parsed: ParsedInteraction;
    try {
      parsed = this.parseInteraction(interaction);
    } catch (error) {
      // Discord never sends these; the route answers 400 before any receipt exists.
      throw new DiscordMalformedInteractionError(
        error instanceof BadDataException
          ? error.message
          : "Invalid Discord interaction.",
      );
    }

    if (parsed.type === DiscordInteractionKind.ApplicationCommandAutocomplete) {
      try {
        return { initialResponse: await this.handleAutocomplete(parsed) };
      } catch {
        // Discord accepts only type 8 for autocomplete; a message response is rejected.
        return { initialResponse: { type: 8, data: { choices: [] } } };
      }
    }

    let claim: DiscordInteractionReceiptClaim;
    try {
      claim = await DiscordInteractionReceiptService.claim({
        applicationId: this.applicationId,
        interactionId: parsed.id,
        guildId: parsed.guildId,
        discordUserId: parsed.discordUserId,
      });
    } catch {
      return {
        initialResponse: this.messageResponse(
          "Discord interactions are temporarily unavailable. Try again shortly.",
        ),
      };
    }
    if (claim.kind === "in_progress") {
      return { initialResponse: this.inProgressResponse() };
    }
    if (claim.kind === "terminal") {
      return { initialResponse: claim.response };
    }

    try {
      const prepared: DiscordPreparedInteraction =
        await this.prepareFirstDelivery(parsed);
      if (!prepared.runAfterResponse) {
        await DiscordInteractionReceiptService.complete({
          applicationId: this.applicationId,
          interactionId: parsed.id,
          response: this.completedReplayResponse(),
        });
      }
      return prepared;
    } catch (error) {
      const response: JSONObject = this.errorResponse(error);
      try {
        await DiscordInteractionReceiptService.fail({
          applicationId: this.applicationId,
          interactionId: parsed.id,
          response,
        });
      } catch {
        return { initialResponse: this.reconciliationResponse() };
      }
      return { initialResponse: response };
    }
  }

  private async prepareFirstDelivery(
    parsed: ParsedInteraction,
  ): Promise<DiscordPreparedInteraction> {
    if (parsed.type === DiscordInteractionKind.ApplicationCommand) {
      return await this.prepareRegisteredAction(
        parsed,
        this.parseCommand(parsed.data),
      );
    }
    if (parsed.type === DiscordInteractionKind.ModalSubmit) {
      const customId: string = this.customId(parsed.data);
      if (customId.startsWith("PickerSearchSubmit:")) {
        return this.preparePickerSearchSubmit(parsed, customId);
      }
      return await this.prepareRegisteredAction(parsed, {
        ...this.parseCustomAction(customId),
        values: this.modalValues(parsed.data),
      });
    }
    if (parsed.type === DiscordInteractionKind.MessageComponent) {
      const customId: string = this.customId(parsed.data);
      if (customId.startsWith("PickerSelect:")) {
        return this.preparePickerSelection(parsed, customId);
      }
      if (customId.startsWith("PickerPage:")) {
        return this.preparePickerPage(parsed, customId);
      }
      if (customId.startsWith("PickerSearch:")) {
        return await this.preparePickerSearchModal(parsed, customId);
      }
      return await this.prepareRegisteredAction(
        parsed,
        this.parseCustomAction(customId),
      );
    }
    throw new BadDataException("This Discord interaction is not supported.");
  }

  private async prepareRegisteredAction(
    interaction: ParsedInteraction,
    action: ParsedAction,
  ): Promise<DiscordPreparedInteraction> {
    const registration: DiscordActionRegistration | undefined =
      this.handlers.get(this.handlerKey(interaction.type, action.action));
    if (!registration) {
      throw new BadDataException("This Discord action is not supported.");
    }
    const invoke: () => Promise<{
      result: DiscordActionResult;
      context: DiscordActionContext;
    }> = async (): Promise<{
      result: DiscordActionResult;
      context: DiscordActionContext;
    }> => {
      const context: DiscordActionContext =
        await this.resolveReceiptContext(interaction);
      const request: DiscordActionRequest = {
        ...action,
        context,
      };
      return { result: await registration.handle(request), context };
    };

    if (registration.responseMode === DiscordHandlerResponseMode.Immediate) {
      const executed: {
        result: DiscordActionResult;
        context: DiscordActionContext;
      } = await invoke();
      return {
        initialResponse: await this.renderImmediate(
          executed.result,
          executed.context,
          interaction.type,
        ),
      };
    }
    return this.deferred(interaction, async (): Promise<JSONObject> => {
      const executed: {
        result: DiscordActionResult;
        context: DiscordActionContext;
      } = await invoke();
      return await this.renderDeferred(executed.result, executed.context);
    });
  }

  private deferred(
    interaction: ParsedInteraction,
    execute: () => Promise<JSONObject>,
    updateMessage: boolean = false,
  ): DiscordPreparedInteraction {
    return {
      initialResponse: updateMessage
        ? { type: 6 }
        : {
            type: 5,
            data: { flags: EPHEMERAL_FLAG, allowed_mentions: SAFE_MENTIONS },
          },
      runAfterResponse: async (): Promise<void> => {
        let message: JSONObject;
        let terminalResponse: JSONObject;
        let succeeded: boolean = false;
        try {
          message = await execute();
          terminalResponse = this.replayResponseFor(message);
          succeeded = true;
        } catch (error) {
          terminalResponse = this.errorResponse(error);
          message = terminalResponse["data"] as JSONObject;
        }
        try {
          if (succeeded) {
            await DiscordInteractionReceiptService.complete({
              applicationId: this.applicationId,
              interactionId: interaction.id,
              response: terminalResponse,
            });
          } else {
            await DiscordInteractionReceiptService.fail({
              applicationId: this.applicationId,
              interactionId: interaction.id,
              response: terminalResponse,
            });
          }
        } catch {
          message = this.reconciliationMessage();
        }
        try {
          await DiscordClient.editOriginalInteractionResponse({
            applicationId: this.applicationId,
            interactionToken: interaction.token,
            message,
          });
        } catch {
          /*
           * The initial response is already committed. Never leak token/provider
           * details or retry an outcome Discord may already have applied.
           */
        }
      },
    };
  }

  private async handleAutocomplete(
    interaction: ParsedInteraction,
  ): Promise<JSONObject> {
    const commandName: unknown = interaction.data["name"];
    if (typeof commandName !== "string") {
      throw new BadDataException("Invalid Discord command.");
    }
    const command: DiscordCommandRegistration | undefined =
      this.commands.get(commandName);
    if (!command) {
      throw new BadDataException("This Discord command is not supported.");
    }
    const values: Record<string, string> = this.commandValues(interaction.data);
    const rawOptions: unknown = interaction.data["options"];
    const focused: JSONObject | undefined = Array.isArray(rawOptions)
      ? (rawOptions as Array<JSONObject>).find(
          (option: JSONObject): boolean => {
            return option["focused"] === true;
          },
        )
      : undefined;
    const focusedName: unknown = focused?.["name"];
    if (typeof focusedName !== "string") {
      throw new BadDataException("Invalid Discord command autocomplete.");
    }
    const option: DiscordCommandOption | undefined = command.options?.find(
      (candidate: DiscordCommandOption): boolean => {
        return candidate.name === focusedName;
      },
    );
    if (!option?.autocompleteProvider) {
      throw new BadDataException("This Discord autocomplete is not supported.");
    }
    const provider: DiscordChoiceProviderRegistration | undefined =
      this.providers.get(option.autocompleteProvider);
    if (!provider) {
      throw new BadDataException("This Discord autocomplete is not supported.");
    }
    const context: DiscordActionContext =
      await this.resolveContext(interaction);
    const resourceId: ObjectID | undefined = this.optionalObjectId(
      values["resource-id"],
    );
    const page: DiscordChoicePage = await provider.getPage({
      provider: provider.name,
      resourceId,
      search: values[focusedName] || "",
      limit: 25,
      context,
    });
    const options: Array<DiscordStringSelectOption> = this.choiceOptions(
      page.options,
    );
    return {
      type: 8,
      data: {
        choices: options.map(
          (choice: DiscordStringSelectOption): JSONObject => {
            return {
              name: choice.label,
              value: choice.value,
            };
          },
        ),
      },
    };
  }

  private preparePickerSelection(
    interaction: ParsedInteraction,
    customId: string,
  ): DiscordPreparedInteraction {
    const token: string = this.internalToken(customId, "PickerSelect", 2);
    const selected: string = this.singleComponentValue(interaction.data);
    return this.deferred(
      interaction,
      async (): Promise<JSONObject> => {
        const state: PickerState = await this.loadPickerState(token);
        const context: DiscordActionContext =
          await this.resolveReceiptContext(interaction);
        await this.assertPickerContext(state, context);
        const action: ParsedAction = {
          action: state.submitAction,
          resourceId: this.optionalObjectId(state.resourceId),
          values: { [state.field]: selected },
        };
        const registration: DiscordActionRegistration | undefined =
          this.handlers.get(
            this.handlerKey(
              DiscordInteractionKind.MessageComponent,
              state.submitAction,
            ),
          );
        if (!registration) {
          throw new BadDataException("This Discord action is not supported.");
        }
        const result: DiscordActionResult = await registration.handle({
          ...action,
          context,
        });
        return await this.renderDeferred(result, context);
      },
      true,
    );
  }

  private preparePickerPage(
    interaction: ParsedInteraction,
    customId: string,
  ): DiscordPreparedInteraction {
    const parts: Array<string> = customId.split(":");
    if (
      parts.length !== 3 ||
      parts[0] !== "PickerPage" ||
      (parts[2] !== "previous" && parts[2] !== "next")
    ) {
      throw new BadDataException("Invalid Discord picker action.");
    }
    const token: string = this.boundedToken(parts[1]);
    const direction: "previous" | "next" = parts[2] as "previous" | "next";
    return this.deferred(
      interaction,
      async (): Promise<JSONObject> => {
        const state: PickerState = await this.loadPickerState(token);
        const context: DiscordActionContext =
          await this.resolveReceiptContext(interaction);
        await this.assertPickerContext(state, context);
        const cursor: string | undefined =
          direction === "previous" ? state.previousCursor : state.nextCursor;
        if (!cursor) {
          throw new BadDataException(
            "This Discord picker page is unavailable.",
          );
        }
        return await this.renderPicker({ ...state, cursor }, context, true);
      },
      true,
    );
  }

  private async preparePickerSearchModal(
    interaction: ParsedInteraction,
    customId: string,
  ): Promise<DiscordPreparedInteraction> {
    const token: string = this.internalToken(customId, "PickerSearch", 2);
    const state: PickerState = await this.loadPickerState(token);
    const context: DiscordActionContext =
      await this.resolveReceiptContext(interaction);
    await this.assertPickerContext(state, context);
    return {
      initialResponse: this.modalResponse({
        customId: `PickerSearchSubmit:${token}`,
        title: "Search options",
        fields: [
          {
            kind: "text",
            customId: "search",
            label: "Search",
            style: "short",
            required: false,
            maxLength: 100,
          },
        ],
      }),
    };
  }

  private preparePickerSearchSubmit(
    interaction: ParsedInteraction,
    customId: string,
  ): DiscordPreparedInteraction {
    const token: string = this.internalToken(customId, "PickerSearchSubmit", 2);
    const values: Readonly<Record<string, string>> = this.modalValues(
      interaction.data,
    );
    const search: string = values["search"] || "";
    if (search.length > 100) {
      throw new BadDataException("Invalid Discord picker search.");
    }
    return this.deferred(interaction, async (): Promise<JSONObject> => {
      const state: PickerState = await this.loadPickerState(token);
      const context: DiscordActionContext =
        await this.resolveReceiptContext(interaction);
      return await this.renderPicker(
        { ...state, search, cursor: undefined },
        context,
      );
    });
  }

  private async renderImmediate(
    result: DiscordActionResult,
    context: DiscordActionContext,
    interactionKind: DiscordInteractionKind,
  ): Promise<JSONObject> {
    if (result.kind === "modal") {
      return this.modalResponse(result.modal);
    }
    if (result.kind === "picker") {
      return {
        type: 4,
        data: {
          ...(await this.renderPicker(result.picker, context)),
          flags: EPHEMERAL_FLAG,
        },
      };
    }
    if (result.kind === "acknowledge") {
      return interactionKind === DiscordInteractionKind.MessageComponent
        ? { type: 6 }
        : this.messageResponse("Done.");
    }
    return this.messageResponse(
      result.content,
      result.ephemeral === undefined ? true : result.ephemeral,
    );
  }

  private async renderDeferred(
    result: DiscordActionResult,
    context: DiscordActionContext,
  ): Promise<JSONObject> {
    if (result.kind === "message") {
      return this.messageData(result.content);
    }
    if (result.kind === "picker") {
      return await this.renderPicker(result.picker, context);
    }
    if (result.kind === "acknowledge") {
      return this.messageData("Done.");
    }
    throw new BadDataException(
      "Discord cannot open a modal after a deferred response.",
    );
  }

  private async renderPicker(
    picker:
      | {
          provider: string;
          submitAction: string;
          field: string;
          title: string;
          resourceId?: ObjectID | undefined;
          description?: string | undefined;
          placeholder?: string | undefined;
        }
      | PickerState,
    context: DiscordActionContext,
    contextVerified: boolean = false,
  ): Promise<JSONObject> {
    const provider: DiscordChoiceProviderRegistration | undefined =
      this.providers.get(picker.provider);
    if (!provider) {
      throw new BadDataException("This Discord picker is not supported.");
    }
    const existingState: PickerState | undefined =
      "installationGeneration" in picker ? picker : undefined;
    let binding: Pick<
      PickerState,
      | "projectId"
      | "userId"
      | "guildId"
      | "discordUserId"
      | "installationGeneration"
      | "expiresAt"
    >;
    if (existingState) {
      if (!contextVerified) {
        await this.assertPickerContext(existingState, context);
      }
      binding = {
        projectId: existingState.projectId,
        userId: existingState.userId,
        guildId: existingState.guildId,
        discordUserId: existingState.discordUserId,
        installationGeneration: existingState.installationGeneration,
        expiresAt: existingState.expiresAt,
      };
    } else {
      const snapshot: DiscordBindingSnapshot =
        await DiscordBindingService.snapshot(context.projectId);
      if (snapshot.workspaceProjectId !== context.guildId) {
        throw new BadDataException(
          "This Discord connection changed. Open the action again.",
        );
      }
      binding = {
        projectId: context.projectId.toString(),
        userId: context.userId.toString(),
        guildId: context.guildId,
        discordUserId: context.discordUserId,
        installationGeneration: snapshot.fingerprint,
        expiresAt: Date.now() + SESSION_TTL_SECONDS * 1000,
      };
    }
    const resourceId: ObjectID | undefined =
      picker.resourceId instanceof ObjectID
        ? picker.resourceId
        : this.optionalObjectId(picker.resourceId);
    const search: string | undefined =
      "search" in picker ? picker.search : undefined;
    const cursor: string | undefined =
      "cursor" in picker ? picker.cursor : undefined;
    if ((search?.length || 0) > 100 || (cursor?.length || 0) > 100) {
      throw new BadDataException("Invalid Discord picker page.");
    }
    const page: DiscordChoicePage = await provider.getPage({
      provider: provider.name,
      resourceId,
      search,
      cursor,
      limit: 25,
      context,
    });
    const options: Array<DiscordStringSelectOption> = this.choiceOptions(
      page.options,
    );
    const state: PickerState = {
      provider: provider.name,
      submitAction: picker.submitAction,
      field: picker.field,
      title: picker.title,
      resourceId: resourceId?.toString(),
      description: picker.description,
      placeholder: picker.placeholder,
      search,
      cursor,
      previousCursor: page.previousCursor,
      nextCursor: page.nextCursor,
      ...binding,
    };
    this.assertPickerState(state);
    const expiresInSeconds: number = Math.ceil(
      (state.expiresAt - Date.now()) / 1000,
    );
    if (expiresInSeconds < 1) {
      throw new BadDataException(
        "This Discord selection expired. Open the action again.",
      );
    }
    const token: string = randomBytes(16).toString("hex");
    await GlobalCache.setString(
      PICKER_NAMESPACE,
      token,
      JSON.stringify(state),
      { expiresInSeconds },
    );
    const components: Array<JSONObject> = [];
    if (options.length) {
      components.push({
        type: 1,
        components: [
          {
            type: 3,
            custom_id: `PickerSelect:${token}`,
            min_values: 1,
            max_values: 1,
            placeholder: (picker.placeholder || "Choose an option").slice(
              0,
              150,
            ),
            options: options.map(
              (option: DiscordStringSelectOption): JSONObject => {
                return {
                  label: option.label,
                  value: option.value,
                  ...(option.description
                    ? { description: option.description }
                    : {}),
                  ...(option.default === undefined
                    ? {}
                    : { default: option.default }),
                };
              },
            ),
          },
        ],
      });
    }
    const buttons: Array<JSONObject> = [];
    if (page.previousCursor) {
      buttons.push({
        type: 2,
        style: 2,
        label: "Previous",
        custom_id: `PickerPage:${token}:previous`,
      });
    }
    if (page.nextCursor) {
      buttons.push({
        type: 2,
        style: 2,
        label: "Next",
        custom_id: `PickerPage:${token}:next`,
      });
    }
    buttons.push({
      type: 2,
      style: 2,
      label: "Search",
      custom_id: `PickerSearch:${token}`,
    });
    components.push({ type: 1, components: buttons });
    const content: string = [
      picker.title,
      picker.description,
      search ? `Search: ${search}` : undefined,
      options.length ? undefined : "No matching options.",
    ]
      .filter(Boolean)
      .join("\n")
      .slice(0, 2000);
    return {
      content,
      components,
      allowed_mentions: SAFE_MENTIONS,
    };
  }

  private async loadPickerState(token: string): Promise<PickerState> {
    let raw: string | null;
    try {
      raw = await GlobalCache.getString(PICKER_NAMESPACE, token);
    } catch {
      throw new BadDataException(
        "Discord selection is temporarily unavailable. Try again shortly.",
      );
    }
    if (!raw || raw.length > 4096) {
      throw new BadDataException(
        "This Discord selection expired. Open the action again.",
      );
    }
    let state: PickerState;
    try {
      state = JSON.parse(raw) as PickerState;
    } catch {
      throw new BadDataException("Invalid Discord picker state.");
    }
    this.assertPickerState(state);
    return state;
  }

  private assertPickerState(state: PickerState): void {
    this.assertName(state.provider, 64, "choice provider", true);
    this.assertName(state.submitAction, 64, "action");
    this.assertName(state.field, 64, "field", true);
    if (
      typeof state.title !== "string" ||
      state.title.length < 1 ||
      state.title.length > 100 ||
      (state.resourceId !== undefined &&
        !ObjectID.isValidUUID(state.resourceId)) ||
      (state.description?.length || 0) > 1000 ||
      (state.placeholder?.length || 0) > 150 ||
      (state.search?.length || 0) > 100 ||
      (state.cursor?.length || 0) > 100 ||
      (state.previousCursor?.length || 0) > 100 ||
      (state.nextCursor?.length || 0) > 100 ||
      !ObjectID.isValidUUID(state.projectId) ||
      !ObjectID.isValidUUID(state.userId) ||
      !SNOWFLAKE_PATTERN.test(state.guildId) ||
      !SNOWFLAKE_PATTERN.test(state.discordUserId) ||
      !INSTALLATION_GENERATION_PATTERN.test(state.installationGeneration) ||
      !Number.isSafeInteger(state.expiresAt) ||
      state.expiresAt <= Date.now() ||
      state.expiresAt > Date.now() + SESSION_TTL_SECONDS * 1000 + 1000
    ) {
      throw new BadDataException("Invalid Discord picker state.");
    }
  }

  private async assertPickerContext(
    state: PickerState,
    context: DiscordActionContext,
  ): Promise<void> {
    if (
      state.projectId !== context.projectId.toString() ||
      state.userId !== context.userId.toString() ||
      state.guildId !== context.guildId ||
      state.discordUserId !== context.discordUserId
    ) {
      throw new NotAuthorizedException(
        "This Discord selection belongs to another user or project. Open the action again.",
      );
    }
    const snapshot: DiscordBindingSnapshot =
      await DiscordBindingService.snapshot(context.projectId);
    if (
      snapshot.workspaceProjectId !== state.guildId ||
      snapshot.fingerprint !== state.installationGeneration
    ) {
      throw new BadDataException(
        "This Discord connection changed. Open the action again.",
      );
    }
  }

  private async resolveContext(
    interaction: ParsedInteraction,
  ): Promise<DiscordActionContext> {
    const member: { projectId: ObjectID; userId: ObjectID } | null =
      await DiscordBindingService.resolveLinkedMember({
        guildId: interaction.guildId,
        discordUserId: interaction.discordUserId,
      });
    if (!member) {
      throw new NotAuthorizedException(
        "Link your Discord account in OneUptime user settings before using this action.",
      );
    }
    const props: DatabaseCommonInteractionProps =
      await WorkspaceActionAuthorization.getProjectMemberProps(member);
    return {
      ...member,
      props,
      guildId: interaction.guildId,
      channelId: interaction.channelId,
      discordUserId: interaction.discordUserId,
    };
  }

  private async resolveReceiptContext(
    interaction: ParsedInteraction,
  ): Promise<DiscordActionContext> {
    const context: DiscordActionContext =
      await this.resolveContext(interaction);
    await DiscordInteractionReceiptService.bindContext({
      applicationId: this.applicationId,
      interactionId: interaction.id,
      guildId: interaction.guildId,
      discordUserId: interaction.discordUserId,
      projectId: context.projectId,
      userId: context.userId,
    });
    return context;
  }

  private parseInteraction(interaction: JSONObject): ParsedInteraction {
    const id: string = DiscordClient.snowflake(String(interaction["id"] || ""));
    const applicationId: string = DiscordClient.snowflake(
      String(interaction["application_id"] || ""),
    );
    if (applicationId !== this.applicationId) {
      throw new BadDataException("This Discord interaction is not supported.");
    }
    const rawType: unknown = interaction["type"];
    if (
      rawType !== DiscordInteractionKind.ApplicationCommand &&
      rawType !== DiscordInteractionKind.MessageComponent &&
      rawType !== DiscordInteractionKind.ApplicationCommandAutocomplete &&
      rawType !== DiscordInteractionKind.ModalSubmit
    ) {
      throw new BadDataException("This Discord interaction is not supported.");
    }
    const token: unknown = interaction["token"];
    if (typeof token !== "string" || token.length > 1024) {
      throw new BadDataException("Invalid Discord interaction token.");
    }
    DiscordClient.encodePathSegment(token);
    const guildId: string = DiscordClient.snowflake(
      String(interaction["guild_id"] || ""),
    );
    const channelIdValue: unknown = interaction["channel_id"];
    const channelId: string | undefined = channelIdValue
      ? DiscordClient.snowflake(String(channelIdValue))
      : undefined;
    const member: JSONObject | undefined = interaction["member"] as
      | JSONObject
      | undefined;
    const user: JSONObject | undefined =
      (interaction["user"] as JSONObject | undefined) ||
      (member?.["user"] as JSONObject | undefined);
    const discordUserId: string = DiscordClient.snowflake(
      String(user?.["id"] || ""),
    );
    const data: unknown = interaction["data"];
    if (!data || typeof data !== "object" || Array.isArray(data)) {
      throw new BadDataException("Invalid Discord interaction data.");
    }
    const routingKey: unknown =
      rawType === DiscordInteractionKind.MessageComponent ||
      rawType === DiscordInteractionKind.ModalSubmit
        ? (data as JSONObject)["custom_id"]
        : (data as JSONObject)["name"];
    if (typeof routingKey !== "string" || !routingKey) {
      throw new BadDataException("Invalid Discord interaction data.");
    }
    return {
      id,
      type: rawType,
      token,
      guildId,
      channelId,
      discordUserId,
      data: data as JSONObject,
    };
  }

  private parseCustomAction(customId: string): ParsedAction {
    const parts: Array<string> = customId.split(":");
    if (parts.length !== 2) {
      throw new BadDataException("Invalid Discord action.");
    }
    this.assertName(parts[0]!, 64, "action");
    if (!ObjectID.isValidUUID(parts[1]!)) {
      throw new BadDataException("Invalid Discord action resource.");
    }
    return {
      action: parts[0]!,
      resourceId: new ObjectID(parts[1]!),
      values: {},
    };
  }

  private parseCommand(data: JSONObject): ParsedAction {
    const name: unknown = data["name"];
    if (typeof name !== "string") {
      throw new BadDataException("Invalid Discord command.");
    }
    const command: DiscordCommandRegistration | undefined =
      this.commands.get(name);
    if (!command) {
      throw new BadDataException("This Discord command is not supported.");
    }
    const values: Record<string, string> = this.commandValues(data);
    return {
      action: command.action,
      resourceId: this.optionalObjectId(values["resource-id"]),
      values,
    };
  }

  private commandValues(data: JSONObject): Record<string, string> {
    const rawOptions: unknown = data["options"];
    if (rawOptions === undefined) {
      return {};
    }
    if (!Array.isArray(rawOptions) || rawOptions.length > 25) {
      throw new BadDataException("Invalid Discord command options.");
    }
    const values: Record<string, string> = {};
    let totalLength: number = 0;
    for (const raw of rawOptions) {
      if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
        throw new BadDataException("Invalid Discord command options.");
      }
      const option: JSONObject = raw as JSONObject;
      const name: unknown = option["name"];
      const value: unknown = option["value"];
      if (
        typeof name !== "string" ||
        !COMMAND_NAME_PATTERN.test(name) ||
        values[name] !== undefined ||
        (typeof value !== "string" &&
          typeof value !== "number" &&
          typeof value !== "boolean")
      ) {
        throw new BadDataException("Invalid Discord command options.");
      }
      const text: string = String(value);
      totalLength += name.length + text.length;
      if (text.length > 6000 || totalLength > 10_000) {
        throw new BadDataException("Invalid Discord command options.");
      }
      values[name] = text;
    }
    return values;
  }

  private modalValues(data: JSONObject): Readonly<Record<string, string>> {
    const rows: unknown = data["components"];
    if (!Array.isArray(rows) || rows.length < 1 || rows.length > 5) {
      throw new BadDataException("Invalid Discord form values.");
    }
    const values: Record<string, string> = {};
    let totalLength: number = 0;
    for (const rawRow of rows) {
      if (!rawRow || typeof rawRow !== "object" || Array.isArray(rawRow)) {
        throw new BadDataException("Invalid Discord form values.");
      }
      const row: JSONObject = rawRow as JSONObject;
      // Label (type 18) submits carry one `component`; legacy action rows carry `components`.
      const components: unknown =
        row["type"] === 18 ? [row["component"]] : row["components"];
      if (!Array.isArray(components) || components.length > 5) {
        throw new BadDataException("Invalid Discord form values.");
      }
      for (const rawComponent of components) {
        if (
          !rawComponent ||
          typeof rawComponent !== "object" ||
          Array.isArray(rawComponent)
        ) {
          throw new BadDataException("Invalid Discord form values.");
        }
        const component: JSONObject = rawComponent as JSONObject;
        const customId: unknown = component["custom_id"];
        if (
          typeof customId !== "string" ||
          !FORM_FIELD_ID_PATTERN.test(customId) ||
          values[customId] !== undefined
        ) {
          throw new BadDataException("Invalid Discord form values.");
        }
        let value: unknown = component["value"];
        if (value === undefined) {
          const selected: unknown = component["values"];
          value =
            Array.isArray(selected) && selected.length === 1
              ? selected[0]
              : undefined;
        }
        if (typeof value !== "string" || value.length > 4000) {
          throw new BadDataException("Invalid Discord form values.");
        }
        totalLength += customId.length + value.length;
        if (totalLength > 6000) {
          throw new BadDataException("Invalid Discord form values.");
        }
        values[customId] = value;
      }
    }
    return values;
  }

  private customId(data: JSONObject): string {
    const customId: unknown = data["custom_id"];
    if (
      typeof customId !== "string" ||
      customId.length < 1 ||
      customId.length > 100
    ) {
      throw new BadDataException("Invalid Discord action.");
    }
    return customId;
  }

  private singleComponentValue(data: JSONObject): string {
    const values: unknown = data["values"];
    if (
      !Array.isArray(values) ||
      values.length !== 1 ||
      typeof values[0] !== "string" ||
      values[0].length < 1 ||
      values[0].length > 100
    ) {
      throw new BadDataException("Invalid Discord selection.");
    }
    return values[0];
  }

  private modalResponse(modal: DiscordModalDescriptor): JSONObject {
    if (
      modal.customId.length < 1 ||
      modal.customId.length > 100 ||
      modal.title.length < 1 ||
      modal.title.length > 45 ||
      modal.fields.length < 1 ||
      modal.fields.length > 5
    ) {
      throw new BadDataException("Invalid Discord modal.");
    }
    return {
      type: 9,
      data: {
        custom_id: modal.customId,
        title: modal.title,
        components: modal.fields.map((field: DiscordModalField): JSONObject => {
          // Discord accepts a select in a modal only inside a Label (type 18).
          return {
            type: 18,
            label: field.label,
            component: this.modalComponent(field),
          };
        }),
      },
    };
  }

  private modalComponent(field: DiscordModalField): JSONObject {
    this.assertName(field.customId, 100, "modal field", true);
    if (field.label.length < 1 || field.label.length > 45) {
      throw new BadDataException("Invalid Discord modal field.");
    }
    if (field.kind === "text") {
      if (
        (field.minLength !== undefined &&
          (field.minLength < 0 || field.minLength > 4000)) ||
        (field.maxLength !== undefined &&
          (field.maxLength < 1 || field.maxLength > 4000)) ||
        (field.minLength !== undefined &&
          field.maxLength !== undefined &&
          field.minLength > field.maxLength) ||
        (field.placeholder?.length || 0) > 100 ||
        (field.value?.length || 0) > 4000
      ) {
        throw new BadDataException("Invalid Discord modal field.");
      }
      return {
        type: 4,
        custom_id: field.customId,
        style: field.style === "paragraph" ? 2 : 1,
        ...(field.required === undefined ? {} : { required: field.required }),
        ...(field.minLength === undefined
          ? {}
          : { min_length: field.minLength }),
        ...(field.maxLength === undefined
          ? {}
          : { max_length: field.maxLength }),
        ...(field.placeholder ? { placeholder: field.placeholder } : {}),
        ...(field.value ? { value: field.value } : {}),
      };
    }
    const options: Array<DiscordStringSelectOption> = this.choiceOptions(
      field.options,
    );
    if (!options.length) {
      throw new BadDataException("Invalid Discord modal field.");
    }
    return {
      type: 3,
      custom_id: field.customId,
      options: options as unknown as JSONArray,
      ...(field.required === undefined ? {} : { required: field.required }),
      ...(field.minValues === undefined ? {} : { min_values: field.minValues }),
      ...(field.maxValues === undefined ? {} : { max_values: field.maxValues }),
      ...(field.placeholder ? { placeholder: field.placeholder } : {}),
    };
  }

  private choiceOptions(
    choices: ReadonlyArray<DiscordStringSelectOption>,
  ): Array<DiscordStringSelectOption> {
    if (!Array.isArray(choices) || choices.length > 25) {
      throw new BadDataException("Invalid Discord choices.");
    }
    const values: Set<string> = new Set<string>();
    return choices.map(
      (choice: DiscordStringSelectOption): DiscordStringSelectOption => {
        if (
          typeof choice.label !== "string" ||
          choice.label.length < 1 ||
          choice.label.length > 100 ||
          typeof choice.value !== "string" ||
          choice.value.length < 1 ||
          choice.value.length > 100 ||
          (choice.description?.length || 0) > 100 ||
          values.has(choice.value)
        ) {
          throw new BadDataException("Invalid Discord choices.");
        }
        values.add(choice.value);
        return choice;
      },
    );
  }

  private messageResponse(
    content: string,
    ephemeral: boolean = true,
  ): JSONObject {
    return {
      type: 4,
      data: {
        ...this.messageData(content),
        ...(ephemeral ? { flags: EPHEMERAL_FLAG } : {}),
      },
    };
  }

  private messageData(content: string): JSONObject {
    if (typeof content !== "string" || !content || content.length > 2000) {
      throw new BadDataException("Invalid Discord response message.");
    }
    return { content, allowed_mentions: SAFE_MENTIONS };
  }

  private errorResponse(error: unknown): JSONObject {
    return this.messageResponse(this.safeErrorMessage(error));
  }

  private completedReplayResponse(): JSONObject {
    return this.messageResponse(
      "This Discord interaction was already processed.",
    );
  }

  /*
   * A redelivered interaction replays the outcome its actor already saw.
   * Only plain text fits the receipt's safe-replay shape; pickers and other
   * component payloads fall back to the generic completion notice.
   */
  private replayResponseFor(message: JSONObject): JSONObject {
    const content: unknown = message["content"];
    const keys: Array<string> = Object.keys(message);
    const plainText: boolean =
      typeof content === "string" &&
      content.length > 0 &&
      content.length <= 2000 &&
      keys.every((key: string): boolean => {
        return key === "content" || key === "allowed_mentions";
      });
    return plainText
      ? this.messageResponse(content as string)
      : this.completedReplayResponse();
  }

  private inProgressResponse(): JSONObject {
    return this.messageResponse(
      "This Discord interaction is already in progress. Wait for the original response.",
    );
  }

  private reconciliationResponse(): JSONObject {
    return {
      type: 4,
      data: { ...this.reconciliationMessage(), flags: EPHEMERAL_FLAG },
    };
  }

  private reconciliationMessage(): JSONObject {
    return this.messageData(
      "The result of this Discord interaction could not be confirmed. Do not retry it; ask an administrator to reconcile it.",
    );
  }

  private safeErrorMessage(error: unknown): string {
    if (
      error instanceof BadDataException ||
      error instanceof NotAuthorizedException
    ) {
      return error.message.slice(0, 2000);
    }
    return "The Discord action result could not be confirmed. Do not retry it; ask an administrator to reconcile it.";
  }

  private handlerKey(kind: DiscordInteractionKind, action: string): string {
    return `${kind}:${action}`;
  }

  private internalToken(
    customId: string,
    action: string,
    expectedParts: number,
  ): string {
    const parts: Array<string> = customId.split(":");
    if (parts.length !== expectedParts || parts[0] !== action) {
      throw new BadDataException("Invalid Discord picker action.");
    }
    return this.boundedToken(parts[1]);
  }

  private boundedToken(value: string | undefined): string {
    if (!value || !INTERNAL_TOKEN_PATTERN.test(value)) {
      throw new BadDataException("Invalid Discord picker action.");
    }
    return value;
  }

  private optionalObjectId(value: string | undefined): ObjectID | undefined {
    if (value === undefined) {
      return undefined;
    }
    if (!ObjectID.isValidUUID(value)) {
      throw new BadDataException("Invalid Discord resource.");
    }
    return new ObjectID(value);
  }

  private assertName(
    value: string,
    maxLength: number,
    label: string,
    allowHyphen: boolean = false,
  ): void {
    const pattern: RegExp = allowHyphen
      ? /^[A-Za-z][A-Za-z0-9_-]*$/
      : /^[A-Za-z][A-Za-z0-9]*$/;
    if (
      typeof value !== "string" ||
      value.length < 1 ||
      value.length > maxLength ||
      !pattern.test(value)
    ) {
      throw new BadDataException(`Invalid Discord ${label}.`);
    }
  }

  private assertCommand(command: DiscordCommandRegistration): void {
    if (
      !COMMAND_NAME_PATTERN.test(command.name) ||
      command.description.length < 1 ||
      command.description.length > 100 ||
      (command.options?.length || 0) > 25
    ) {
      throw new BadDataException("Invalid Discord command registration.");
    }
    this.assertName(command.action, 64, "action");
    const names: Set<string> = new Set<string>();
    for (const option of command.options || []) {
      if (
        !COMMAND_NAME_PATTERN.test(option.name) ||
        option.description.length < 1 ||
        option.description.length > 100 ||
        names.has(option.name) ||
        (option.choices?.length || 0) > 25 ||
        (option.choices && option.autocompleteProvider)
      ) {
        throw new BadDataException("Invalid Discord command registration.");
      }
      if (
        option.autocompleteProvider &&
        !this.providers.has(option.autocompleteProvider)
      ) {
        throw new BadDataException("Unknown Discord autocomplete provider.");
      }
      names.add(option.name);
    }
    if (
      !this.handlers.has(
        this.handlerKey(
          DiscordInteractionKind.ApplicationCommand,
          command.action,
        ),
      )
    ) {
      throw new BadDataException("Unknown Discord command action.");
    }
  }
}
