import BadDataException from "../../../../Types/Exception/BadDataException";
import { JSONObject } from "../../../../Types/JSON";
import ObjectID from "../../../../Types/ObjectID";
import DraftService, {
  DiscordDraftClaim,
  DiscordDraftOutcome,
  DiscordDraftRead,
  DiscordDraftScope,
  DiscordDraftView,
} from "../../../Services/DiscordCreationDraftService";
import {
  DiscordActionContext,
  DiscordChoicePage,
  DiscordChoiceProviderRegistration,
  DiscordDraftDescriptor,
  DiscordDraftField,
  DiscordDraftProvenance,
  DiscordDraftSubmissionRegistration,
  DiscordDraftSubmissionResult,
  DiscordInteractionKind,
  DiscordStringSelectOption,
} from "./Actions/Types";

const NAME: RegExp = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;
const SNOWFLAKE: RegExp = /^[0-9]{17,20}$/;
const REVISION: RegExp = /^[1-9][0-9]{0,9}$/;
const MAX_SELECTIONS: number = 25;
const SAFE_MENTIONS: JSONObject = { parse: [], replied_user: false };
const provenanceTokens: WeakSet<DiscordDraftProvenance> =
  new WeakSet<DiscordDraftProvenance>();

export function isValidatedProvenance(
  value: unknown,
): value is DiscordDraftProvenance {
  return (
    typeof value === "object" &&
    value !== null &&
    provenanceTokens.has(value as DiscordDraftProvenance)
  );
}

interface PageState {
  field: string;
  cursor?: string;
  search?: string;
  previousCursor?: string;
  nextCursor?: string;
  options: Array<DiscordStringSelectOption>;
}
interface State {
  schema: 1;
  descriptor: DiscordDraftDescriptor;
  values: Record<string, string>;
  selections: Record<string, Array<string>>;
  page?: PageState;
}
interface Continuation {
  kind: DiscordInteractionKind;
  customId: string;
  values: Readonly<Record<string, string>>;
  selections: Readonly<Record<string, ReadonlyArray<string>>>;
  context: DiscordActionContext;
}
export type DiscordDraftPlan =
  | { mode: "immediate"; response: JSONObject }
  | { mode: "deferred"; execute: () => Promise<JSONObject> };

/*
 * The database owns replay and actor binding. This layer owns bounded native
 * forms and can mint final-handler provenance only after a durable claim.
 * It deliberately has no route registration or domain creation dependency.
 */
export default class DiscordDraftFlow {
  private readonly applicationId: string;
  private readonly submissions: Map<
    string,
    DiscordDraftSubmissionRegistration
  > = new Map();
  private readonly providers: Map<string, DiscordChoiceProviderRegistration> =
    new Map();

  public constructor(data: {
    applicationId: string;
    submissions: ReadonlyArray<DiscordDraftSubmissionRegistration>;
    choiceProviders: ReadonlyArray<DiscordChoiceProviderRegistration>;
  }) {
    this.applicationId = data.applicationId;
    for (const registration of data.submissions) {
      this.assertName(registration.name);
      this.assertName(registration.action);
      if (this.submissions.has(registration.name)) {
        throw new BadDataException("Duplicate Discord draft registration.");
      }
      this.submissions.set(registration.name, registration);
    }
    for (const provider of data.choiceProviders) {
      this.assertName(provider.name);
      if (this.providers.has(provider.name)) {
        throw new BadDataException("Duplicate Discord draft provider.");
      }
      this.providers.set(provider.name, provider);
    }
  }

  private assertName(value: string): void {
    if (
      !NAME.test(value) ||
      ["constructor", "prototype", "__proto__"].includes(value)
    ) {
      throw new BadDataException("Invalid Discord draft field.");
    }
  }

  private scope(context: DiscordActionContext): DiscordDraftScope {
    for (const value of [
      this.applicationId,
      context.guildId,
      context.channelId,
      context.discordUserId,
    ]) {
      if (
        typeof value !== "string" ||
        !SNOWFLAKE.test(value) ||
        BigInt(value) > BigInt("18446744073709551615")
      ) {
        throw new BadDataException(
          "Discord drafts require a bound guild channel.",
        );
      }
    }
    return {
      applicationId: this.applicationId,
      projectId: context.projectId,
      userId: context.userId,
      guildId: context.guildId,
      channelId: context.channelId!,
      discordUserId: context.discordUserId,
    };
  }

  private assertDescriptor(draft: DiscordDraftDescriptor): void {
    if (!draft || typeof draft !== "object") {
      throw new BadDataException("Invalid Discord draft.");
    }
    this.assertName(draft.name);
    this.assertName(draft.submitAction);
    if (
      this.submissions.get(draft.name)?.action !== draft.submitAction ||
      typeof draft.title !== "string" ||
      !draft.title.length ||
      draft.title.length > 45 ||
      !Array.isArray(draft.fields) ||
      !draft.fields.length ||
      draft.fields.length > 10
    ) {
      throw new BadDataException("Invalid Discord draft registration.");
    }
    const names: Set<string> = new Set();
    let textFields: number = 0;
    for (const field of draft.fields) {
      this.assertName(field.customId);
      if (
        names.has(field.customId) ||
        typeof field.label !== "string" ||
        !field.label.length ||
        field.label.length > 45 ||
        typeof field.required !== "boolean"
      ) {
        throw new BadDataException("Invalid Discord draft field.");
      }
      names.add(field.customId);
      if (field.kind === "text") {
        textFields++;
        const min: number = field.minLength ?? 0;
        const max: number = field.maxLength ?? 4000;
        if (
          !Number.isInteger(min) ||
          !Number.isInteger(max) ||
          min < 0 ||
          max > 4000 ||
          max < 1 ||
          min > max ||
          (field.placeholder?.length || 0) > 100 ||
          (field.style !== undefined &&
            !["short", "paragraph"].includes(field.style))
        ) {
          throw new BadDataException("Invalid Discord draft text bounds.");
        }
      } else if (
        field.kind !== "choice" ||
        !this.providers.has(field.provider) ||
        typeof field.multiple !== "boolean"
      ) {
        throw new BadDataException("Invalid Discord draft choice provider.");
      }
    }
    if (textFields > 5) {
      throw new BadDataException(
        "Discord drafts support at most five text fields.",
      );
    }
  }

  private encode(state: State): JSONObject {
    return JSON.parse(JSON.stringify(state)) as JSONObject;
  }

  private decode(content: JSONObject): State {
    const state: State = JSON.parse(JSON.stringify(content)) as State;
    if (state.schema !== 1 || !state.values || !state.selections) {
      throw new BadDataException("Invalid stored Discord draft.");
    }
    this.assertDescriptor(state.descriptor);
    this.validate(state, false);
    return state;
  }

  private validate(state: State, complete: boolean): void {
    const fields: ReadonlyArray<DiscordDraftField> = state.descriptor.fields;
    for (const key of Object.keys(state.values)) {
      if (
        !fields.some((f: DiscordDraftField): boolean => {
          return f.kind === "text" && f.customId === key;
        })
      ) {
        throw new BadDataException("Unknown Discord draft text field.");
      }
    }
    for (const key of Object.keys(state.selections)) {
      if (
        !fields.some((f: DiscordDraftField): boolean => {
          return f.kind === "choice" && f.customId === key;
        })
      ) {
        throw new BadDataException("Unknown Discord draft selection.");
      }
    }
    let selectedCount: number = 0;
    for (const field of fields) {
      if (field.kind === "text") {
        const value: unknown = state.values[field.customId];
        if (
          value !== undefined &&
          (typeof value !== "string" ||
            value.length > (field.maxLength ?? 4000))
        ) {
          throw new BadDataException(
            "Discord draft text exceeds its field limit.",
          );
        }
        if (
          complete &&
          ((field.required && !(value as string | undefined)?.trim()) ||
            (typeof value === "string" &&
              value.length > 0 &&
              value.length < (field.minLength ?? 0)))
        ) {
          throw new BadDataException(
            `Complete ${field.label} before reviewing.`,
          );
        }
      } else {
        const selected: Array<string> = state.selections[field.customId] || [];
        if (
          !Array.isArray(selected) ||
          selected.some((value: string): boolean => {
            return (
              typeof value !== "string" || !value.length || value.length > 100
            );
          }) ||
          new Set(selected).size !== selected.length ||
          (!field.multiple && selected.length > 1)
        ) {
          throw new BadDataException("Invalid Discord draft selections.");
        }
        selectedCount += selected.length;
        if (complete && field.required && selected.length === 0) {
          throw new BadDataException(`Select ${field.label} before reviewing.`);
        }
      }
    }
    if (
      selectedCount > MAX_SELECTIONS ||
      this.reviewText(state).length > 5800
    ) {
      throw new BadDataException(
        "Draft exceeds the review limit: use at most 25 selections and shorter text.",
      );
    }
  }

  public handles(customId: string): boolean {
    return customId.startsWith("oud:");
  }

  public async start(data: {
    draft: DiscordDraftDescriptor;
    context: DiscordActionContext;
  }): Promise<JSONObject> {
    this.assertDescriptor(data.draft);
    const state: State = {
      schema: 1,
      descriptor: data.draft,
      values: {},
      selections: {},
    };
    const draft: DiscordDraftView = await DraftService.open({
      scope: this.scope(data.context),
      content: this.encode(state),
    });
    return this.overview(draft, state);
  }

  public async continue(input: Continuation): Promise<DiscordDraftPlan> {
    const parts: Array<string> = input.customId.split(":");
    const operation: string = parts[3] || "";
    const operations: Array<string> = [
      "edit",
      "text",
      "review",
      "submit",
      "cancel",
      "field",
      "select",
      "next",
      "previous",
      "back",
      "search",
      "search-text",
    ];
    if (
      parts.length !== 4 ||
      parts[0] !== "oud" ||
      !ObjectID.isValidUUID(parts[1]!) ||
      !REVISION.test(parts[2]!) ||
      !operations.includes(operation)
    ) {
      throw new BadDataException("Invalid Discord draft continuation.");
    }
    const revision: number = Number(parts[2]);
    if (revision >= 2147483647) {
      throw new BadDataException("Invalid Discord draft revision.");
    }
    const modal: boolean = ["text", "search-text"].includes(operation);
    if (
      input.kind !==
        (modal
          ? DiscordInteractionKind.ModalSubmit
          : DiscordInteractionKind.MessageComponent) ||
      (!modal && Object.keys(input.values).length) ||
      (!["field", "select"].includes(operation) &&
        Object.keys(input.selections).length)
    ) {
      throw new BadDataException("Unexpected Discord draft fields.");
    }
    const key: { id: ObjectID; scope: DiscordDraftScope } = {
      id: new ObjectID(parts[1]!),
      scope: this.scope(input.context),
    };
    const execute: () => Promise<JSONObject> =
      async (): Promise<JSONObject> => {
        const read: DiscordDraftRead = await DraftService.read(key);
        if (read.kind !== "open") {
          return this.closed(read);
        }
        const draft: DiscordDraftView = read.draft;
        if (draft.revision !== revision) {
          return this.message("Draft changed. Open the latest message.");
        }
        const state: State = this.decode(draft.content);
        if (operation === "edit" || operation === "search") {
          if (operation === "search" && !state.page) {
            throw new BadDataException("Open a choice field first.");
          }
          return this.modal(draft, state, operation === "search");
        }
        if (operation === "cancel") {
          return this.closed(await DraftService.cancel(key));
        }
        if (operation === "submit") {
          return this.submit(key, revision, input.context);
        }
        if (operation === "text") {
          for (const name of Object.keys(input.values)) {
            if (
              !state.descriptor.fields.some((f: DiscordDraftField): boolean => {
                return f.kind === "text" && f.customId === name;
              })
            ) {
              throw new BadDataException("Unknown Discord draft text field.");
            }
          }
          state.values = { ...input.values };
          delete state.page;
        } else if (operation === "field") {
          const selected: ReadonlyArray<string> = this.selection(
            input,
            "field",
          );
          if (selected.length !== 1) {
            throw new BadDataException("Choose one field.");
          }
          await this.loadPage(state, selected[0]!, input.context);
        } else if (operation === "select") {
          const page: PageState = this.requirePage(state);
          const selected: ReadonlyArray<string> = this.selection(
            input,
            "selection",
          );
          const field: DiscordDraftField = this.choiceField(state, page.field);
          const offered: Set<string> = new Set(
            page.options.map((option: DiscordStringSelectOption): string => {
              return option.value;
            }),
          );
          if (
            selected.some((value: string): boolean => {
              return !offered.has(value);
            })
          ) {
            throw new BadDataException("Selection is not on the current page.");
          }
          const previous: Array<string> = state.selections[page.field] || [];
          state.selections[page.field] =
            field.kind === "choice" && field.multiple
              ? [
                  ...previous.filter((value: string): boolean => {
                    return !offered.has(value);
                  }),
                  ...selected,
                ]
              : [...selected];
        } else if (operation === "next" || operation === "previous") {
          const page: PageState = this.requirePage(state);
          const cursor: string | undefined =
            operation === "next" ? page.nextCursor : page.previousCursor;
          if (cursor === undefined) {
            throw new BadDataException("No further choice page.");
          }
          await this.loadPage(
            state,
            page.field,
            input.context,
            cursor,
            page.search,
          );
        } else if (operation === "search-text") {
          const page: PageState = this.requirePage(state);
          if (
            Object.keys(input.values).some((keyName: string): boolean => {
              return keyName !== "search";
            }) ||
            typeof input.values["search"] !== "string" ||
            input.values["search"].length > 100
          ) {
            throw new BadDataException("Invalid choice search.");
          }
          await this.loadPage(
            state,
            page.field,
            input.context,
            undefined,
            input.values["search"],
          );
        } else if (operation === "back" || operation === "review") {
          delete state.page;
        }
        this.validate(state, operation === "review");
        const changed: DiscordDraftRead = await DraftService.change({
          ...key,
          revision,
          content: this.encode(state),
          review: operation === "review",
        });
        if (changed.kind !== "open") {
          return this.closed(changed);
        }
        return state.page
          ? this.choices(changed.draft, state)
          : this.overview(changed.draft, state);
      };
    if (operation === "edit" || operation === "search") {
      const response: JSONObject = await execute();
      return {
        mode: "immediate",
        response:
          response["type"] === 9 ? response : { type: 4, data: response },
      };
    }
    return { mode: "deferred", execute };
  }

  private selection(input: Continuation, key: string): ReadonlyArray<string> {
    const values: ReadonlyArray<string> | undefined = input.selections[key];
    if (
      Object.keys(input.selections).length !== 1 ||
      !Array.isArray(values) ||
      values.some((value: string): boolean => {
        return typeof value !== "string";
      }) ||
      values.length > 25 ||
      new Set(values).size !== values.length
    ) {
      throw new BadDataException("Invalid native selection.");
    }
    return values;
  }

  private choiceField(
    state: State,
    name: string,
  ): Extract<DiscordDraftField, { kind: "choice" }> {
    const field: DiscordDraftField | undefined = state.descriptor.fields.find(
      (item: DiscordDraftField): boolean => {
        return item.customId === name && item.kind === "choice";
      },
    );
    if (!field || field.kind !== "choice") {
      throw new BadDataException("Unknown choice field.");
    }
    return field;
  }

  private requirePage(state: State): PageState {
    if (!state.page) {
      throw new BadDataException("Open a choice field first.");
    }
    return state.page;
  }

  private async loadPage(
    state: State,
    name: string,
    context: DiscordActionContext,
    cursor?: string,
    search?: string,
  ): Promise<void> {
    const field: Extract<DiscordDraftField, { kind: "choice" }> =
      this.choiceField(state, name);
    const page: DiscordChoicePage = await this.providers
      .get(field.provider)!
      .getPage({
        provider: field.provider,
        context,
        limit: 25,
        ...(cursor === undefined ? {} : { cursor }),
        ...(search === undefined ? {} : { search }),
      });
    const seen: Set<string> = new Set();
    if (!Array.isArray(page.options) || page.options.length > 25) {
      throw new BadDataException("Invalid choice page.");
    }
    for (const option of page.options) {
      if (
        typeof option.label !== "string" ||
        !option.label.length ||
        option.label.length > 100 ||
        typeof option.value !== "string" ||
        !option.value.length ||
        option.value.length > 100 ||
        (option.description?.length || 0) > 100 ||
        seen.has(option.value)
      ) {
        throw new BadDataException("Invalid choice option.");
      }
      seen.add(option.value);
    }
    for (const token of [page.previousCursor, page.nextCursor]) {
      if (
        token !== undefined &&
        (typeof token !== "string" || !token.length || token.length > 512)
      ) {
        throw new BadDataException("Invalid choice cursor.");
      }
    }
    state.page = {
      field: name,
      options: [...page.options],
      ...(cursor === undefined ? {} : { cursor }),
      ...(search === undefined ? {} : { search }),
      ...(page.previousCursor === undefined
        ? {}
        : { previousCursor: page.previousCursor }),
      ...(page.nextCursor === undefined ? {} : { nextCursor: page.nextCursor }),
    };
  }

  private async submit(
    key: { id: ObjectID; scope: DiscordDraftScope },
    revision: number,
    context: DiscordActionContext,
  ): Promise<JSONObject> {
    const claim: DiscordDraftClaim = await DraftService.claim({
      ...key,
      revision,
    });
    if (claim.kind !== "acquired") {
      return this.closed(claim);
    }
    let result: DiscordDraftSubmissionResult | undefined;
    let outcome: DiscordDraftOutcome = { kind: "ambiguous" };
    try {
      const state: State = this.decode(claim.content);
      this.validate(state, true);
      const provenance: DiscordDraftProvenance = Object.freeze(
        {},
      ) as DiscordDraftProvenance;
      provenanceTokens.add(provenance);
      result = await this.submissions.get(state.descriptor.name)!.handle({
        action: state.descriptor.submitAction,
        values: state.values,
        selections: state.selections,
        context,
        provenance,
      });
      if (
        result?.outcome?.kind === "created" &&
        ["Incident", "ScheduledMaintenance"].includes(
          result.outcome.resourceType,
        ) &&
        typeof result.outcome.resourceId === "string" &&
        ObjectID.isValidUUID(result.outcome.resourceId)
      ) {
        outcome = {
          kind: "created",
          resourceType: result.outcome.resourceType,
          resourceId: result.outcome.resourceId,
        };
      }
    } catch {
      // Domain persistence may already have committed. Never reacquire or retry.
    }
    let finished: boolean = false;
    try {
      finished = await DraftService.finish({
        ...key,
        claimId: claim.claimId,
        outcome,
      });
    } catch {
      // Keep the non-stealable claim and the known resource identity in the reply.
    }
    if (outcome.kind !== "created") {
      return this.message(
        "Creation outcome is uncertain. Do not submit again; inspect the dashboard before taking further action.",
      );
    }
    if (!finished) {
      return this.message(
        `${outcome.resourceType} created: ${outcome.resourceId}. Completion recording failed. Do not submit again; inspect this resource.`,
      );
    }
    return this.message(
      result?.response?.kind === "message" &&
        typeof result.response.content === "string" &&
        result.response.content.length > 0 &&
        result.response.content.length <= 2000
        ? result.response.content
        : `${outcome.resourceType} created: ${outcome.resourceId}.`,
    );
  }

  private closed(read: DiscordDraftRead | DiscordDraftClaim): JSONObject {
    if (read.kind === "rejected") {
      return this.message(read.reason);
    }
    if (read.kind === "terminal") {
      if (read.outcome.kind === "created") {
        return this.message(
          `${read.outcome.resourceType} already created: ${read.outcome.resourceId}. Do not submit again.`,
        );
      }
      if (read.outcome.kind === "cancelled") {
        return this.message("Draft cancelled.");
      }
    }
    return this.message(
      "This draft is already being processed or needs reconciliation. Do not submit again; inspect the dashboard.",
    );
  }

  private message(content: string): JSONObject {
    return {
      content,
      flags: 64,
      allowed_mentions: SAFE_MENTIONS,
      components: [],
      embeds: [],
    };
  }

  private id(draft: DiscordDraftView, operation: string): string {
    return `oud:${draft.id}:${draft.revision}:${operation}`;
  }

  private button(
    draft: DiscordDraftView,
    operation: string,
    label: string,
  ): JSONObject {
    return {
      type: 2,
      style: operation === "cancel" ? 4 : 2,
      custom_id: this.id(draft, operation),
      label,
    };
  }

  private reviewText(state: State): string {
    return state.descriptor.fields
      .map((field: DiscordDraftField): string => {
        const value: string =
          field.kind === "text"
            ? state.values[field.customId] || "(not set)"
            : (state.selections[field.customId] || []).join(", ") || "(none)";
        return `${field.label}\n${value}`;
      })
      .join("\n\n");
  }

  private overview(draft: DiscordDraftView, state: State): JSONObject {
    const rows: Array<JSONObject> = [];
    const fields: Array<DiscordDraftField> = state.descriptor.fields.filter(
      (field: DiscordDraftField): boolean => {
        return field.kind === "choice";
      },
    );
    if (fields.length) {
      rows.push({
        type: 1,
        components: [
          {
            type: 3,
            custom_id: this.id(draft, "field"),
            placeholder: "Choose a field",
            min_values: 1,
            max_values: 1,
            options: fields.map((field: DiscordDraftField): JSONObject => {
              return { label: field.label, value: field.customId };
            }),
          },
        ],
      });
    }
    const buttons: Array<JSONObject> = [];
    if (
      state.descriptor.fields.some((field: DiscordDraftField): boolean => {
        return field.kind === "text";
      })
    ) {
      buttons.push(this.button(draft, "edit", "Edit text"));
    }
    buttons.push(this.button(draft, "review", "Review"));
    if (draft.reviewedRevision === draft.revision) {
      buttons.push(this.button(draft, "submit", "Submit"));
    }
    buttons.push(this.button(draft, "cancel", "Cancel"));
    rows.push({ type: 1, components: buttons });
    const review: string = this.reviewText(state);
    return {
      ...this.message(
        `${state.descriptor.title}. Expires ${draft.expiresAt.toISOString()}. Review all fields before submitting. Maximum 25 selections.`,
      ),
      components: rows,
      embeds: [
        { description: review.slice(0, 4096) },
        ...(review.length > 4096 ? [{ description: review.slice(4096) }] : []),
      ],
    };
  }

  private modal(
    draft: DiscordDraftView,
    state: State,
    search: boolean,
  ): JSONObject {
    const fields: Array<Extract<DiscordDraftField, { kind: "text" }>> = search
      ? [
          {
            kind: "text",
            customId: "search",
            label: "Search choices",
            required: false,
            maxLength: 100,
          },
        ]
      : state.descriptor.fields.filter(
          (
            field: DiscordDraftField,
          ): field is Extract<DiscordDraftField, { kind: "text" }> => {
            return field.kind === "text";
          },
        );
    if (!fields.length) {
      throw new BadDataException("This draft has no text fields.");
    }
    return {
      type: 9,
      data: {
        title: search ? "Search choices" : state.descriptor.title,
        custom_id: this.id(draft, search ? "search-text" : "text"),
        components: fields.map(
          (field: Extract<DiscordDraftField, { kind: "text" }>): JSONObject => {
            return {
              type: 18,
              label: field.label,
              component: {
                type: 4,
                custom_id: field.customId,
                style: field.style === "paragraph" ? 2 : 1,
                required: field.required,
                max_length: field.maxLength ?? 4000,
                ...(field.minLength === undefined
                  ? {}
                  : { min_length: field.minLength }),
                ...(field.placeholder === undefined
                  ? {}
                  : { placeholder: field.placeholder }),
                value: search
                  ? state.page?.search || ""
                  : state.values[field.customId] || "",
              },
            };
          },
        ),
      },
    };
  }

  private choices(draft: DiscordDraftView, state: State): JSONObject {
    const page: PageState = this.requirePage(state);
    const field: Extract<DiscordDraftField, { kind: "choice" }> =
      this.choiceField(state, page.field);
    const selected: Array<string> = state.selections[page.field] || [];
    const rows: Array<JSONObject> = [];
    if (page.options.length) {
      rows.push({
        type: 1,
        components: [
          {
            type: 3,
            custom_id: this.id(draft, "select"),
            placeholder: `Select ${field.label}`,
            min_values: 0,
            max_values: field.multiple ? page.options.length : 1,
            options: page.options.map(
              (option: DiscordStringSelectOption): JSONObject => {
                return {
                  label: option.label,
                  value: option.value,
                  ...(option.description
                    ? { description: option.description }
                    : {}),
                  default: selected.includes(option.value),
                };
              },
            ),
          },
        ],
      });
    }
    const buttons: Array<JSONObject> = [];
    if (page.previousCursor !== undefined) {
      buttons.push(this.button(draft, "previous", "Previous"));
    }
    if (page.nextCursor !== undefined) {
      buttons.push(this.button(draft, "next", "Next"));
    }
    buttons.push(
      this.button(draft, "search", "Search"),
      this.button(draft, "back", "Back"),
      this.button(draft, "cancel", "Cancel"),
    );
    rows.push({ type: 1, components: buttons });
    return {
      ...this.message(
        `${field.label}: ${selected.length} selected. ${page.options.length ? "Selections on other pages are preserved." : "No matching choices."} Expires ${draft.expiresAt.toISOString()}.`,
      ),
      components: rows,
    };
  }
}
