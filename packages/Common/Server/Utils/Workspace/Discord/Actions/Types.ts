import DatabaseCommonInteractionProps from "../../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import ObjectID from "../../../../../Types/ObjectID";
import { DiscordDraftOutcome } from "../../../../Services/DiscordCreationDraftService";

export enum DiscordInteractionKind {
  ApplicationCommand = 2,
  MessageComponent = 3,
  ApplicationCommandAutocomplete = 4,
  ModalSubmit = 5,
}

export enum DiscordHandlerResponseMode {
  Immediate = "immediate",
  Deferred = "deferred",
}

export interface DiscordActionContext {
  projectId: ObjectID;
  userId: ObjectID;
  props: DatabaseCommonInteractionProps;
  guildId: string;
  channelId?: string | undefined;
  discordUserId: string;
}

export interface DiscordActionRequest {
  action: string;
  resourceId?: ObjectID | undefined;
  values: Readonly<Record<string, string>>;
  // Multi-value select menus; only draft continuations carry these.
  selections?: Readonly<Record<string, ReadonlyArray<string>>> | undefined;
  context: DiscordActionContext;
}

export interface DiscordTextInputField {
  kind: "text";
  customId: string;
  label: string;
  style: "short" | "paragraph";
  required?: boolean | undefined;
  minLength?: number | undefined;
  maxLength?: number | undefined;
  placeholder?: string | undefined;
  value?: string | undefined;
}

export interface DiscordStringSelectOption {
  label: string;
  value: string;
  description?: string | undefined;
  default?: boolean | undefined;
}

export interface DiscordChoiceQuery {
  provider: string;
  resourceId?: ObjectID | undefined;
  search?: string | undefined;
  cursor?: string | undefined;
  limit: number;
  context: DiscordActionContext;
}

export interface DiscordChoicePage {
  options: ReadonlyArray<DiscordStringSelectOption>;
  previousCursor?: string | undefined;
  nextCursor?: string | undefined;
}

export type DiscordChoiceProvider = (
  query: DiscordChoiceQuery,
) => Promise<DiscordChoicePage>;

export interface DiscordChoiceProviderRegistration {
  name: string;
  getPage: DiscordChoiceProvider;
}

export interface DiscordStringSelectField {
  kind: "string-select";
  customId: string;
  label: string;
  required?: boolean | undefined;
  minValues?: number | undefined;
  maxValues?: number | undefined;
  placeholder?: string | undefined;
  options: ReadonlyArray<DiscordStringSelectOption>;
}

export type DiscordModalField =
  | DiscordTextInputField
  | DiscordStringSelectField;

export interface DiscordModalDescriptor {
  customId: string;
  title: string;
  fields: ReadonlyArray<DiscordModalField>;
}

/*
 * A multi-step creation form whose partial state persists as a draft. Text
 * fields are edited in one native modal; choice fields page through a
 * registered choice provider. The flow owns rendering and persistence.
 */
export type DiscordDraftField =
  | {
      kind: "text";
      customId: string;
      label: string;
      required: boolean;
      style?: "short" | "paragraph";
      minLength?: number;
      maxLength?: number;
      placeholder?: string;
    }
  | {
      kind: "choice";
      customId: string;
      label: string;
      provider: string;
      required: boolean;
      multiple: boolean;
    };

export interface DiscordDraftDescriptor {
  name: string;
  title: string;
  submitAction: string;
  fields: ReadonlyArray<DiscordDraftField>;
}

// Minted only by the flow after a durable claim; a handler cannot forge it.
export interface DiscordDraftProvenance {
  readonly __discordDraft: unique symbol;
}

export interface DiscordDraftSubmissionRequest {
  action: string;
  values: Readonly<Record<string, string>>;
  selections: Readonly<Record<string, ReadonlyArray<string>>>;
  context: DiscordActionContext;
  provenance: DiscordDraftProvenance;
}

export interface DiscordDraftSubmissionResult {
  outcome: Exclude<DiscordDraftOutcome, { kind: "cancelled" }>;
  response: { kind: "message"; content: string; ephemeral?: boolean };
}

export interface DiscordDraftSubmissionRegistration {
  name: string;
  action: string;
  handle: (
    request: DiscordDraftSubmissionRequest,
  ) => Promise<DiscordDraftSubmissionResult>;
}

export type DiscordActionResult =
  | { kind: "draft"; draft: DiscordDraftDescriptor }
  | {
      kind: "message";
      content: string;
      ephemeral?: boolean | undefined;
      replaceOriginal?: boolean | undefined;
    }
  | {
      kind: "modal";
      modal: DiscordModalDescriptor;
    }
  | {
      kind: "picker";
      picker: {
        provider: string;
        submitAction: string;
        field: string;
        title: string;
        resourceId?: ObjectID | undefined;
        description?: string | undefined;
        placeholder?: string | undefined;
      };
    }
  | {
      kind: "acknowledge";
    };

export type DiscordActionHandler = (
  request: DiscordActionRequest,
) => Promise<DiscordActionResult>;

export interface DiscordActionRegistration {
  actions: ReadonlyArray<string>;
  interactionKinds: ReadonlyArray<DiscordInteractionKind>;
  responseMode: DiscordHandlerResponseMode;
  handle: DiscordActionHandler;
}

export enum DiscordCommandOptionType {
  String = 3,
  Integer = 4,
  Boolean = 5,
  User = 6,
  Channel = 7,
  Role = 8,
  Mentionable = 9,
  Number = 10,
}

export interface DiscordCommandOptionChoice {
  name: string;
  value: string | number;
}

export interface DiscordCommandOption {
  type: DiscordCommandOptionType;
  name: string;
  description: string;
  required?: boolean | undefined;
  choices?: ReadonlyArray<DiscordCommandOptionChoice> | undefined;
  autocompleteProvider?: string | undefined;
}

export interface DiscordCommandRegistration {
  name: string;
  description: string;
  action: string;
  options?: ReadonlyArray<DiscordCommandOption> | undefined;
}

export interface DiscordActionModuleRegistration {
  handlers: ReadonlyArray<DiscordActionRegistration>;
  choiceProviders?:
    | ReadonlyArray<DiscordChoiceProviderRegistration>
    | undefined;
  commands?: ReadonlyArray<DiscordCommandRegistration> | undefined;
  // Final handlers for reviewed drafts; never reachable as a wire action.
  draftSubmissions?:
    | ReadonlyArray<DiscordDraftSubmissionRegistration>
    | undefined;
}
