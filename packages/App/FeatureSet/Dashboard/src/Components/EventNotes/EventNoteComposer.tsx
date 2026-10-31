import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import { NoteTemplateVariables } from "Common/Utils/Incident/IncidentNoteTemplateVariables";
import GenerateFromAIModal from "Common/UI/Components/AI/GenerateFromAIModal";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import Modal, { ModalWidth } from "Common/UI/Components/Modal/Modal";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import { HeldPermissions } from "Common/Types/HeldPermissions";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
  PermissionGateOptions,
} from "Common/UI/Utils/PermissionGate";
import { usePrivateRecordGateOptions } from "Common/UI/Utils/PrivateRecordScope";
import useTranslateValue from "Common/UI/Utils/Translation";
import User from "Common/UI/Utils/User";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
import React, {
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { EventNoteKind } from "./EventNoteKind";
import {
  NotesCopy,
  applyTemplateToDraft,
  canWriteNoteColumn,
  getNotesCopy,
  getRouteWithComposerOpen,
  isNoteBlank,
} from "./EventNotesUtil";
import NoteAvatar from "./NoteAvatar";
import useAiOffered from "../../Utils/UseAiOffered";
import NoteComposer, {
  AudienceBadge,
  NoteComposerValues,
  NotifyOption,
} from "./NoteComposer";
import NoteTemplateMenu, { NoteTemplateOption } from "./NoteTemplateMenu";
import { loadNoteTemplateOptions } from "./NoteTemplateOptions";
import {
  PRIVATE_EVENT_PRIVATE_NOTE_ACTION,
  getPrivateEventPublicNoteRefusal,
} from "./PrivateEventNotesCopy";

/*
 * Where the composer is drawn.
 *
 * inline: on the Notes page, above the notes. Folded to a one-line prompt
 *         until it is opened; the page holds whether it is open, so its
 *         empty state can open it too.
 * dialog: in a dialog of its own - the overview feed's "Add Public Note" and
 *         "Add Private Note". Always open; Cancel, Escape and the backdrop
 *         close it, asking first when there is a draft to lose.
 */
export type EventNoteComposerPresentation =
  | {
      type: "inline";
      isOpen: boolean;
      onOpenChange: (isOpen: boolean) => void;
    }
  | {
      type: "dialog";
      title: string;
      onClose: () => void;
    };

export interface ComponentProps<TNote extends BaseModel> {
  kind: EventNoteKind<TNote>;
  /*
   * The project the note is saved in. Without one nothing is posted, and the
   * composer says why.
   */
  projectId: ObjectID | null;
  presentation: EventNoteComposerPresentation;
  /*
   * After a note is saved. The Notes page reads its notes again (the
   * composer stays open, empty, for the next one); the dialog's owner closes
   * it and refreshes its feed.
   */
  onPosted: () => Promise<void> | void;
}

export interface NoteCreateGate {
  isShown: boolean;
  isDisabled: boolean;
  tooltip?: string | undefined;
}

/*
 * Whether writing a note of this kind is offered: allowed; locked with the
 * missing permission as the reason; or, while the permissions have not
 * arrived (or nothing could grant it), not offered at all. The same gate the
 * Notes page's composer and the feed's "Add ... Note" use.
 */
export function getNoteCreateGate(
  modelType: {
    new (): BaseModel;
  },
  // The page's private record scope, when it is open on one.
  options?: PermissionGateOptions | undefined,
): NoteCreateGate {
  const result: PermissionGateResult = PermissionGate.check(
    new modelType(),
    ModelAction.Create,
    options,
  );

  if (result.isAllowed) {
    return { isShown: true, isDisabled: false };
  }

  if (result.disabledReason) {
    return { isShown: true, isDisabled: true, tooltip: result.disabledReason };
  }

  return { isShown: false, isDisabled: true };
}

/*
 * Whether a note gate refuses the note, saying why: shown, and locked. Not
 * a refusal while the permissions have not arrived (not shown), when
 * whether the reader may is not known yet.
 */
export function isNoteCreateRefused(gate: NoteCreateGate): boolean {
  return gate.isShown && gate.isDisabled;
}

/*
 * The same, for one kind of note on one event: a private incident or
 * episode takes no public notes (EventNoteKind.isPrivateEvent), so its
 * "Add Public Note" is locked with why, whatever the permissions say - the
 * server refuses one with the same words. They point to a private note
 * instead, unless `isPrivateNoteOffered` is false: the reader may not add
 * one either (on a private record's page, their team that owns it may not).
 */
export function getNoteKindCreateGate(
  kind: EventNoteKind<BaseModel>,
  translator?: Translator | undefined,
  // The page's private record scope, when it is open on one.
  options?: PermissionGateOptions | undefined,
  isPrivateNoteOffered?: boolean | undefined,
): NoteCreateGate {
  if (kind.isPrivateEvent && kind.visibility === "public") {
    return {
      isShown: true,
      isDisabled: true,
      tooltip: getPrivateEventPublicNoteRefusal(
        kind.eventNoun,
        translator,
        isPrivateNoteOffered !== false,
      ),
    };
  }

  return getNoteCreateGate(kind.modelType, options);
}

/*
 * Writing a new note on an incident, alert, scheduled maintenance event or
 * episode: the draft, Templates (their {{placeholders}} filled with the
 * event's values), Draft with AI, attachments, the posting time, and - on a
 * public note - "Notify status page subscribers" with who it reaches and
 * Preview notification. Then posting it.
 *
 * The Notes page draws it inline, above the notes (EventNotes); the overview
 * feed's "Add ... Note" draws it in a dialog (EventNoteComposerDialog). Both
 * read the note's kind from the same place (NoteKinds/), so a note written
 * from the feed is the same note, written the same way, as one written on its
 * page.
 */
function EventNoteComposer<TNote extends BaseModel>(
  props: ComponentProps<TNote>,
): ReactElement | null {
  const translator: Translator = useTranslator();
  const { translateString } = useTranslateValue();
  const tx: (value: string) => string = (value: string): string => {
    return translateString(value) || value;
  };

  const kind: EventNoteKind<TNote> = props.kind;
  const presentation: EventNoteComposerPresentation = props.presentation;
  const isDialog: boolean = presentation.type === "dialog";

  const copy: NotesCopy = getNotesCopy(
    kind.visibility,
    kind.eventNoun,
    translator,
  );
  const model: TNote = useMemo(() => {
    return new kind.modelType();
  }, [kind.modelType]);

  const isPublic: boolean = kind.visibility === "public";
  /*
   * What the viewer holds, blocks included - on a private record's page,
   * what they hold on the record: its notes are posted only by a team of
   * theirs that owns it (PrivateRecordScope).
   */
  const privateRecordOptions: PermissionGateOptions | undefined =
    usePrivateRecordGateOptions(model);
  const heldPermissions: HeldPermissions =
    PermissionGate.getHeldPermissions(privateRecordOptions);
  const isMasterAdmin: boolean = User.isMasterAdmin();

  const canWrite: (column: string) => boolean = (column: string): boolean => {
    return (
      model.hasColumn(column) &&
      canWriteNoteColumn({
        model,
        column,
        action: "create",
        held: heldPermissions,
        isMasterAdmin,
      })
    );
  };

  const createGate: PermissionGateResult = PermissionGate.check(
    model,
    ModelAction.Create,
    privateRecordOptions,
  );

  /*
   * Whether the reader may write the event's private notes instead, where
   * this kind names them (siblingModelType): on a private record's page,
   * only a team of theirs that owns it may. Not known yet - as if they may.
   */
  const isPrivateNoteOffered: boolean =
    !kind.siblingModelType ||
    !isNoteCreateRefused(
      getNoteCreateGate(kind.siblingModelType, privateRecordOptions),
    );

  /*
   * Why no note of this kind is written here: a private incident or episode
   * takes no public notes. Said where the composer would be, with the way to
   * the event's private notes - for a reader who may write one; null for
   * every other event.
   */
  const privateEventReason: string | null =
    kind.isPrivateEvent && kind.visibility === "public"
      ? getPrivateEventPublicNoteRefusal(
          kind.eventNoun,
          translator,
          isPrivateNoteOffered,
        )
      : null;

  const isCreateAttachmentsEnabled: boolean =
    Boolean(kind.attachmentApiPath) && canWrite("attachments");
  const isCreatePostedAtEditable: boolean = isPublic && canWrite("postedAt");
  const isNotifyControlShown: boolean =
    isPublic &&
    Boolean(kind.subscriberNotifications) &&
    canWrite("shouldStatusPageSubscribersBeNotifiedOnNoteCreated");

  const isNotifyingByDefault: boolean =
    kind.subscriberNotifications?.isNotifyingByDefault ?? true;

  const createDraft: () => NoteComposerValues = (): NoteComposerValues => {
    return {
      note: "",
      attachments: [],
      shouldNotify: isNotifyingByDefault,
      postedAt: null,
    };
  };

  const [draft, setDraft] = useState<NoteComposerValues>(createDraft);
  const [composerRevision, setComposerRevision] = useState<number>(0);
  const [isPosting, setIsPosting] = useState<boolean>(false);
  const [postError, setPostError] = useState<string>("");
  const [isDiscardConfirmOpen, setIsDiscardConfirmOpen] =
    useState<boolean>(false);
  const [isAIModalOpen, setIsAIModalOpen] = useState<boolean>(false);
  /*
   * "Draft with AI" is offered only where AI can run: with the project's AI
   * switched off it would only open a dialog the server refuses
   * (Common/Utils/Suggestions/AiSuggestion).
   */
  const isAiOffered: boolean = useAiOffered();
  const aiDraft: EventNoteKind<TNote>["ai"] = isAiOffered ? kind.ai : undefined;

  const isOpen: boolean =
    presentation.type === "dialog" ? true : presentation.isOpen;

  const setIsOpen: (open: boolean) => void = (open: boolean): void => {
    if (presentation.type === "inline") {
      presentation.onOpenChange(open);
    }
  };

  const dialogBodyRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);

  /*
   * A dialog puts the focus on its first control when it opens - here the
   * editor's toolbar. The note is what this one is for, so it goes to the
   * editor after that. (This runs after the dialog's own focus: a parent's
   * effects run after its children's.)
   */
  useEffect(() => {
    if (!isDialog) {
      return;
    }

    dialogBodyRef.current
      ?.querySelector<HTMLElement>('[contenteditable="true"], textarea')
      ?.focus();
  }, []);

  const resetComposer: (options: { isOpen: boolean }) => void = (options: {
    isOpen: boolean;
  }): void => {
    setDraft(createDraft());
    setPostError("");
    setComposerRevision((revision: number) => {
      return revision + 1;
    });
    setIsOpen(options.isOpen);
  };

  const insertIntoDraft: (
    text: string,
    variables?: NoteTemplateVariables | undefined,
  ) => void = (
    text: string,
    variables?: NoteTemplateVariables | undefined,
  ): void => {
    setDraft((current: NoteComposerValues) => {
      return {
        ...current,
        note: applyTemplateToDraft(current.note, text, variables),
      };
    });
    setComposerRevision((revision: number) => {
      return revision + 1;
    });
    setIsOpen(true);
  };

  /*
   * A template goes in with its placeholders filled. Reading the values must
   * never cost the author the template: if it fails, the template goes in as
   * written and they fill the placeholders in by hand.
   */
  const insertTemplateIntoDraft: (
    templateNote: string,
  ) => Promise<void> = async (templateNote: string): Promise<void> => {
    let variables: NoteTemplateVariables | undefined = undefined;

    if (kind.templateVariables) {
      try {
        variables = await kind.templateVariables();
      } catch {
        variables = undefined;
      }
    }

    insertIntoDraft(templateNote, variables);
  };

  const postNote: () => Promise<void> = async (): Promise<void> => {
    if (isNoteBlank(draft.note) || isPosting) {
      return;
    }

    setPostError("");

    if (!props.projectId) {
      setPostError(
        tx(
          "Select a project before posting a note. Project ID cannot be null.",
        ),
      );
      return;
    }

    setIsPosting(true);

    try {
      const note: TNote = new kind.modelType();
      const record: JSONObject = note as unknown as JSONObject;

      record["note"] = draft.note;
      record[kind.parentIdField] = kind.parentId;
      record["projectId"] = props.projectId;

      if (isCreateAttachmentsEnabled && draft.attachments.length > 0) {
        record["attachments"] = draft.attachments;
      }

      if (isNotifyControlShown) {
        /*
         * Always sent, never left to the default: an unsent flag makes the
         * server fall back to the event's setting, which is not necessarily
         * what the box showed.
         */
        record["shouldStatusPageSubscribersBeNotifiedOnNoteCreated"] =
          draft.shouldNotify;
      }

      if (isCreatePostedAtEditable) {
        record["postedAt"] = draft.postedAt || OneUptimeDate.getCurrentDate();
      }

      await ModelAPI.create<TNote>({
        model: note,
        modelType: kind.modelType,
      });

      if (presentation.type === "inline") {
        resetComposer({ isOpen: true });
      }

      await props.onPosted();
    } catch (err) {
      setPostError(API.getFriendlyMessage(err));
    }

    setIsPosting(false);
  };

  const hasDraft: boolean =
    !isNoteBlank(draft.note) || draft.attachments.length > 0;

  // Puts the composer away: folded on the page, closed in a dialog.
  const close: () => void = (): void => {
    if (presentation.type === "dialog") {
      presentation.onClose();
      return;
    }

    resetComposer({ isOpen: false });
  };

  // Cancel, Escape on an empty note, and a dialog's X and backdrop.
  const requestClose: () => void = (): void => {
    if (isPosting) {
      return;
    }

    if (!hasDraft) {
      close();
      return;
    }

    setIsDiscardConfirmOpen(true);
  };

  const loadTemplates: () => Promise<
    Array<NoteTemplateOption>
  > = async (): Promise<Array<NoteTemplateOption>> => {
    if (!kind.templates) {
      return [];
    }

    return loadNoteTemplateOptions(kind.templates.modelType);
  };

  /*
   * English keys, looked up where NoteComposer shows them; translationKey()
   * is what lets the extractor find them in an object like this one.
   */
  const createNotifyOption: NotifyOption | undefined = isNotifyControlShown
    ? {
        title: translationKey("Notify status page subscribers"),
        checkedDescription: translationKey(
          "Subscribers will be notified about this update as soon as you post it.",
        ),
        uncheckedDescription: isNotifyingByDefault
          ? translationKey(
              "The update will appear on your status page without notifying subscribers.",
            )
          : kind.subscriberNotifications!.quietDescription,
      }
    : undefined;

  const composerActions: ReactElement = (
    <>
      {kind.templates && (
        <NoteTemplateMenu
          loadTemplates={loadTemplates}
          settingsRoute={kind.templates.settingsRoute}
          isOpeningUpwards={isOpen}
          onPick={(template: NoteTemplateOption) => {
            void insertTemplateIntoDraft(template.note);
          }}
        />
      )}
      {aiDraft && (
        <button
          type="button"
          data-testid="note-ai-button"
          onClick={() => {
            setIsAIModalOpen(true);
          }}
          className="inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium text-gray-600 transition hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
        >
          <Icon icon={IconProp.Sparkles} className="h-4 w-4 text-violet-500" />
          <span>{tx("Draft with AI")}</span>
        </button>
      )}
    </>
  );

  const getLockedMessage: (reason: string) => ReactElement = (
    reason: string,
  ): ReactElement => {
    return (
      <div
        className="flex items-start gap-3 rounded-xl border border-dashed border-gray-300 bg-white px-4 py-3 text-sm text-gray-600"
        data-testid="note-composer-locked"
      >
        <Icon icon={IconProp.Lock} className="mt-0.5 h-4 w-4 text-gray-400" />
        <span>{tx(reason)}</span>
      </div>
    );
  };

  /*
   * Where the composer would be on a private incident or episode: why it
   * takes no public notes, and - where the event's private notes are - the
   * way there.
   */
  const getPrivateEventMessage: (reason: string) => ReactElement = (
    reason: string,
  ): ReactElement => {
    return (
      <div
        className="flex flex-col gap-3 rounded-xl border border-dashed border-gray-300 bg-white px-4 py-3 text-sm text-gray-600 sm:flex-row sm:items-center sm:justify-between"
        data-testid="note-composer-private-event"
      >
        <div className="flex min-w-0 items-start gap-3">
          <Icon
            icon={IconProp.Lock}
            className="mt-0.5 h-4 w-4 shrink-0 text-gray-400"
          />
          <span>{reason}</span>
        </div>
        {kind.siblingRoute && isPrivateNoteOffered && (
          <Link
            to={getRouteWithComposerOpen(kind.siblingRoute)}
            className="inline-flex h-8 shrink-0 items-center gap-1.5 self-start rounded-md border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 sm:self-auto"
          >
            <Icon icon={IconProp.Lock} className="h-4 w-4 text-amber-600" />
            <span>{tx(PRIVATE_EVENT_PRIVATE_NOTE_ACTION)}</span>
          </Link>
        )}
      </div>
    );
  };

  const getNoteComposer: () => ReactElement = (): ReactElement => {
    return (
      <NoteComposer
        key={`composer-${composerRevision}`}
        mode="create"
        variant={isDialog ? "dialog" : "card"}
        visibility={kind.visibility}
        copy={copy}
        values={draft}
        onChange={setDraft}
        editorKey={`create-${composerRevision}`}
        isAttachmentsEnabled={isCreateAttachmentsEnabled}
        notifyOption={createNotifyOption}
        notifyAudience={kind.subscriberNotifications?.audienceSummary}
        notifyPreview={
          kind.subscriberNotifications?.renderPreview
            ? (values: NoteComposerValues): ReactElement => {
                return kind.subscriberNotifications!.renderPreview!({
                  note: values.note,
                  postedAt: values.postedAt,
                });
              }
            : undefined
        }
        isPostedAtEditable={isCreatePostedAtEditable}
        isSubmitting={isPosting}
        error={postError}
        isAutoFocused={true}
        leadingActions={composerActions}
        dataTestId="note-composer"
        onSubmit={() => {
          void postNote();
        }}
        onCancel={requestClose}
      />
    );
  };

  const getComposer: () => ReactElement | null = (): ReactElement | null => {
    if (privateEventReason) {
      return getPrivateEventMessage(privateEventReason);
    }

    if (!createGate.isAllowed) {
      if (!createGate.disabledReason) {
        return null;
      }

      return getLockedMessage(createGate.disabledReason);
    }

    if (!isOpen) {
      return (
        <div
          className="flex flex-col gap-2 rounded-xl border border-gray-200 bg-white p-2 shadow-sm sm:flex-row sm:items-center"
          data-testid="note-composer-prompt"
        >
          <button
            type="button"
            onClick={() => {
              setIsOpen(true);
            }}
            className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-2 py-1.5 text-left transition hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
          >
            <NoteAvatar userId={safeUserId()} name={safeUserName()} size="sm" />
            <span className="truncate text-sm text-gray-500">
              {tx(copy.composerPrompt)}
            </span>
          </button>
          <div className="flex items-center gap-1 pl-10 sm:pl-0">
            <span className="mr-1 max-xl:hidden xl:inline-flex">
              <AudienceBadge visibility={kind.visibility} copy={copy} />
            </span>
            {composerActions}
          </div>
        </div>
      );
    }

    return getNoteComposer();
  };

  const getDialog: (title: string) => ReactElement = (
    title: string,
  ): ReactElement => {
    const canPost: boolean = createGate.isAllowed && !privateEventReason;

    return (
      <Modal
        title={title}
        modalWidth={ModalWidth.Large}
        onClose={requestClose}
        onSubmit={
          canPost
            ? () => {
                void postNote();
              }
            : undefined
        }
        submitButtonText={canPost ? copy.submitLabel : undefined}
        closeButtonText={canPost ? undefined : "Close"}
        isLoading={isPosting}
        disableSubmitButton={isNoteBlank(draft.note)}
      >
        <div ref={dialogBodyRef} data-testid="note-composer-dialog">
          {canPost
            ? getNoteComposer()
            : privateEventReason
              ? getPrivateEventMessage(privateEventReason)
              : getLockedMessage(
                  createGate.disabledReason ||
                    PermissionGate.getMissingPermissionMessage(
                      model,
                      ModelAction.Create,
                    ),
                )}
        </div>
      </Modal>
    );
  };

  return (
    <>
      {presentation.type === "dialog"
        ? getDialog(presentation.title)
        : getComposer()}

      {isDiscardConfirmOpen && (
        <ConfirmModal
          title={tx("Discard this draft?")}
          description={tx("The note you started writing will be lost.")}
          submitButtonText={tx("Discard draft")}
          submitButtonType={ButtonStyleType.DANGER}
          closeButtonText={tx("Keep writing")}
          onClose={() => {
            setIsDiscardConfirmOpen(false);
          }}
          onSubmit={() => {
            setIsDiscardConfirmOpen(false);
            close();
          }}
        />
      )}

      {isAIModalOpen && aiDraft && (
        <GenerateFromAIModal
          title={aiDraft.title}
          description={aiDraft.description}
          templates={aiDraft.templates}
          onClose={() => {
            setIsAIModalOpen(false);
          }}
          onGenerate={aiDraft.generate}
          onSuccess={(generated: string) => {
            setIsAIModalOpen(false);
            insertIntoDraft(generated);
          }}
        />
      )}
    </>
  );
}

function safeUserId(): ObjectID | null {
  try {
    return User.getUserId();
  } catch {
    return null;
  }
}

function safeUserName(): string {
  try {
    const name: string = User.getName()?.toString() || "";

    if (name) {
      return name;
    }

    return User.getEmail()?.toString() || "You";
  } catch {
    return "You";
  }
}

export default EventNoteComposer;
