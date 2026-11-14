import FileModel from "Common/Models/DatabaseModels/File";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { getHandDrawnButtonStateClassName } from "Common/UI/Components/Button/ButtonStates";
import ErrorMessageText from "Common/UI/Components/ErrorMessage/ErrorMessageText";
import FilePicker from "Common/UI/Components/FilePicker/FilePicker";
import Icon from "Common/UI/Components/Icon/Icon";
import KeyboardKey, {
  KeyboardKeyUtil,
} from "Common/UI/Components/KeyboardShortcut/KeyboardKey";
import MarkdownEditor from "Common/UI/Components/Markdown.tsx/MarkdownEditor";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  NoteActionFailedCopy,
  NotesCopy,
  NoteVisibility,
  fromDateTimeInputValue,
  isNoteBlank,
  toDateTimeInputValue,
} from "./EventNotesUtil";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import InlineSeparator from "Common/UI/Components/InlineSeparator/InlineSeparator";

export interface NoteComposerValues {
  note: string;
  attachments: Array<FileModel>;
  /*
   * Creating: notify status page subscribers about the new note.
   * Editing: send subscribers the edited note as an update.
   */
  shouldNotify: boolean;
  // Null means "now" - resolved when the note is saved, not when typing began.
  postedAt: Date | null;
}

export interface NotifyOption {
  title: string;
  checkedDescription: string;
  uncheckedDescription: string;
}

/*
 * card:   the composer is a card of its own, with Cancel and its submit
 *         button in its footer - inline on the Notes page and in a note being
 *         edited.
 * dialog: the composer is the body of a dialog that brings the frame and the
 *         Cancel and submit buttons (EventNoteComposer's dialog, from the
 *         overview feed's "Add ... Note"). Everything else is the same: who
 *         reads it, the editor, templates, AI, attachments, the posting time
 *         and who it notifies.
 */
export type NoteComposerVariant = "card" | "dialog";

export interface ComponentProps {
  mode: "create" | "edit";
  variant?: NoteComposerVariant | undefined;
  visibility: NoteVisibility;
  copy: NotesCopy;
  values: NoteComposerValues;
  onChange: (values: NoteComposerValues) => void;
  /*
   * Changing the key remounts the editor with `values.note`. The rich text
   * editor does not repaint text set from outside while it has focus, so the
   * caller bumps this after posting (the box must empty) and after inserting
   * a template or an AI draft.
   */
  editorKey: string;
  isAttachmentsEnabled: boolean;
  notifyOption?: NotifyOption | undefined;
  /*
   * Who the notification would reach ("Will notify: Site 03 (up to 41
   * email)"), shown under the notify checkbox while it is ticked.
   */
  notifyAudience?: ReactElement | undefined;
  /*
   * What the notification would look like ('Preview' for incident public
   * notes), from the note as it is being written. Shown beside the notify
   * checkbox's label, on its line, while it is ticked.
   */
  notifyPreview?: ((values: NoteComposerValues) => ReactElement) | undefined;
  isPostedAtEditable: boolean;
  isSubmitting: boolean;
  error?: string | undefined;
  /*
   * What the composer was doing, as an English key looked up here: said
   * first when the error is one nobody explained (ErrorExplanation). Left
   * out, it is posting the note, or saving the edit.
   */
  errorWhatFailed?: string | undefined;
  onSubmit: () => void;
  onCancel?: (() => void) | undefined;
  // Templates, "Draft with AI" - shown at the start of the footer.
  leadingActions?: ReactElement | undefined;
  isAutoFocused?: boolean | undefined;
  submitLabel?: string | undefined;
  /*
   * A line above the footer about what happens once it is sent: the note
   * waits for approval (PublicNoteApproval).
   */
  notice?: ReactElement | undefined;
  dataTestId?: string | undefined;
}

export const AUDIENCE_STYLES: Record<
  NoteVisibility,
  { icon: IconProp; className: string }
> = {
  public: {
    icon: IconProp.Globe,
    className: "bg-sky-50 text-sky-800 ring-sky-200",
  },
  private: {
    icon: IconProp.Lock,
    className: "bg-amber-50 text-amber-800 ring-amber-200",
  },
};

/*
 * Who will read what is being typed, stated where it is being typed. The two
 * kinds of note used to look identical until they were saved.
 *
 * The sentence is never cut: who can read a note is the point of the badge,
 * and a private note's sentence names its event ("Only people who can see
 * this maintenance event can read this"), which a phone, or a longer
 * language, cannot fit on one line. It wraps instead, its second line
 * under the first word, the icon beside the first line, and never leaves
 * one word alone on its last line (text-pretty). The corners are half a
 * line's height, so one line is the same pill it always was.
 *
 * isCompact: the lock and "Private" alone, beside the closed composer's
 * prompt. The prompt is what a person reads there, and the whole sentence
 * took most of that row: at 1280 px the prompt was cut to its first word,
 * in English and in German alike (#7595). The sentence is the chip's
 * tooltip and is read out with it, and the composer says it in full the
 * moment it opens.
 */
export const AudienceBadge: FunctionComponent<{
  visibility: NoteVisibility;
  copy: NotesCopy;
  isCompact?: boolean | undefined;
}> = (props: {
  visibility: NoteVisibility;
  copy: NotesCopy;
  isCompact?: boolean | undefined;
}): ReactElement => {
  const { translateString } = useTranslateValue();
  const style: { icon: IconProp; className: string } =
    AUDIENCE_STYLES[props.visibility];

  if (props.isCompact) {
    return (
      <Tooltip text={props.copy.audienceHint} isTriggerAlreadyDescribed={true}>
        <span
          data-testid="note-audience-chip"
          className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-semibold ring-1 ring-inset ${style.className}`}
        >
          <Icon icon={style.icon} className="h-3.5 w-3.5 shrink-0" />
          <span>
            {translateString(props.copy.audienceLabel) ||
              props.copy.audienceLabel}
          </span>
          <span className="sr-only">
            {translateString(props.copy.audienceHint) ||
              props.copy.audienceHint}
          </span>
        </span>
      </Tooltip>
    );
  }

  return (
    <span
      data-testid="note-audience"
      className={`inline-flex min-w-0 max-w-full items-start gap-1.5 rounded-xl px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${style.className}`}
    >
      <Icon icon={style.icon} className="mt-px h-3.5 w-3.5 shrink-0" />
      <span className="min-w-0 break-words text-pretty">
        <span className="font-semibold">
          {translateString(props.copy.audienceLabel) ||
            props.copy.audienceLabel}
        </span>
        <span aria-hidden="true" className="mx-1.5 opacity-50">
          <InlineSeparator markOnly />
        </span>
        <span data-testid="note-audience-hint">
          {translateString(props.copy.audienceHint) || props.copy.audienceHint}
        </span>
      </span>
    </span>
  );
};

const NoteComposer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const { translateString } = useTranslateValue();
  const tx: (value: string) => string = (value: string): string => {
    return translateString(value) || value;
  };

  const isDialog: boolean = props.variant === "dialog";

  /*
   * The card pads its own sections. In a dialog the dialog's body already
   * does, so the sections line up with its title instead.
   */
  const inset: string = isDialog ? "" : "px-4";
  const insetBox: string = isDialog ? "" : "mx-4";

  const editorLabelId: string = useId();
  const notifyId: string = useId();
  const postedAtId: string = useId();
  const containerRef: React.RefObject<HTMLFormElement> =
    useRef<HTMLFormElement>(null);

  const [isAttachmentPickerOpen, setIsAttachmentPickerOpen] =
    useState<boolean>(false);
  const [isPostedAtOpen, setIsPostedAtOpen] = useState<boolean>(false);

  /*
   * The picker is seeded once per editor key. Handing it the stripped copies
   * it reports back on every change would replace the upload details it
   * shows (size, type) with the bare ids the note is saved with.
   */
  const initialAttachments: Array<FileModel> = useMemo(() => {
    return props.values.attachments;
  }, [props.editorKey]);

  const isBlank: boolean = isNoteBlank(props.values.note);
  const isSubmitDisabled: boolean = isBlank || props.isSubmitting;

  useEffect(() => {
    if (!props.isAutoFocused || !containerRef.current) {
      return;
    }

    const editable: HTMLElement | null = containerRef.current.querySelector(
      '[contenteditable="true"], textarea',
    );

    editable?.focus();
  }, [props.isAutoFocused, props.editorKey]);

  const update: (patch: Partial<NoteComposerValues>) => void = (
    patch: Partial<NoteComposerValues>,
  ): void => {
    props.onChange({ ...props.values, ...patch });
  };

  const submitShortcut: string = KeyboardKeyUtil.getDisplayLabel([
    KeyboardKey.Mod,
    KeyboardKey.Enter,
  ]);

  const postedAtLabel: string = props.values.postedAt
    ? translator.translateTemplate("Posted {{time}}", {
        time: OneUptimeDate.getDateAsLocalShortDateTimeString(
          props.values.postedAt,
        ),
      })
    : tx("Posted now");

  return (
    <form
      ref={containerRef}
      data-testid={props.dataTestId}
      aria-busy={props.isSubmitting}
      className={
        isDialog
          ? "bg-white"
          : "rounded-xl border border-gray-200 bg-white shadow-sm focus-within:border-indigo-300 focus-within:ring-4 focus-within:ring-indigo-50"
      }
      onSubmit={(event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        if (!isSubmitDisabled) {
          props.onSubmit();
        }
      }}
      onKeyDown={(event: React.KeyboardEvent<HTMLFormElement>) => {
        /*
         * Only keys typed in the composer itself. React bubbles a portalled
         * dialog's events here too - 'Preview notification' opens from the
         * composer - and its Escape must close the dialog, not the draft,
         * and its Cmd+Enter must not post.
         */
        if (!event.currentTarget.contains(event.target as Node)) {
          return;
        }

        if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) {
          event.preventDefault();

          if (!isSubmitDisabled) {
            props.onSubmit();
          }

          return;
        }

        if (event.key === "Escape" && props.onCancel && isBlank) {
          event.preventDefault();
          props.onCancel();
        }
      }}
    >
      <div
        className={
          isDialog
            ? "flex flex-wrap items-center justify-between gap-2 pb-3"
            : "flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-2.5"
        }
      >
        <span id={editorLabelId} className="sr-only">
          {props.mode === "create"
            ? tx(props.copy.newNoteLabel)
            : tx(props.copy.editNoteLabel)}
        </span>
        <AudienceBadge visibility={props.visibility} copy={props.copy} />
        {props.mode === "edit" && (
          <span className="text-xs font-medium text-gray-500">
            {tx("Editing")}
          </span>
        )}
      </div>

      <div className={isDialog ? "" : "px-4 pt-3"}>
        <MarkdownEditor
          key={props.editorKey}
          initialValue={props.values.note}
          // In English: the editor looks it up, once.
          placeholder={props.copy.composerPlaceholder}
          ariaLabelledby={editorLabelId}
          dataTestId="note-editor"
          onChange={(value: string) => {
            update({ note: value });
          }}
        />
      </div>

      {props.isAttachmentsEnabled && isAttachmentPickerOpen && (
        <div className={`${inset} pt-3`} data-testid="note-attachment-picker">
          <FilePicker
            /*
             * The picker keeps its own list and ignores an emptied value, so
             * it is remounted with the editor when the draft is reset.
             */
            key={props.editorKey}
            isMultiFilePicker={true}
            initialValue={initialAttachments}
            placeholder="Upload files"
            onChange={(files: Array<FileModel>) => {
              update({
                attachments: files.map((file: FileModel) => {
                  const stripped: FileModel = new FileModel();
                  stripped._id = file._id!;

                  if (file.name) {
                    stripped.name = file.name;
                  }

                  if (file.fileType) {
                    stripped.fileType = file.fileType;
                  }

                  return stripped;
                }),
              });
            }}
          />
        </div>
      )}

      {props.isAttachmentsEnabled &&
        !isAttachmentPickerOpen &&
        props.values.attachments.length > 0 && (
          /*
           * What is attached, without the whole upload area: editing a note
           * with a screenshot should not bury the text under a drop zone.
           * "Attach" opens the picker to add or remove files.
           */
          <ul
            className={`flex flex-wrap gap-2 ${inset} pt-3`}
            data-testid="note-attachment-summary"
            aria-label={tx("Attached files")}
          >
            {props.values.attachments.map((file: FileModel, index: number) => {
              return (
                <li
                  key={file._id?.toString() || index}
                  className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 px-2.5 py-1 text-xs font-medium text-gray-700"
                >
                  <Icon
                    icon={IconProp.PaperClip}
                    className="h-3.5 w-3.5 shrink-0 text-gray-400"
                  />
                  <span className="truncate">
                    {file.name || tx("Attachment")}
                  </span>
                </li>
              );
            })}
          </ul>
        )}

      {props.isPostedAtEditable && isPostedAtOpen && (
        <div
          className={`${insetBox} mt-3 flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-3`}
        >
          <div>
            <label
              htmlFor={postedAtId}
              className="block text-xs font-medium text-gray-700"
            >
              {tx("Posted at")}
            </label>
            <input
              id={postedAtId}
              type="datetime-local"
              data-testid="note-posted-at-input"
              value={
                props.values.postedAt
                  ? toDateTimeInputValue(props.values.postedAt)
                  : toDateTimeInputValue(OneUptimeDate.getCurrentDate())
              }
              onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                update({
                  postedAt: fromDateTimeInputValue(event.target.value),
                });
              }}
              className="mt-1 block rounded-md border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 focus:border-indigo-500 focus:outline-none focus:ring-1 focus:ring-indigo-500"
            />
          </div>
          <button
            type="button"
            className={`mb-1 text-sm font-medium text-indigo-600 ${getHandDrawnButtonStateClassName(
              {
                isLocked: !props.values.postedAt,
                hoverClassName: "hover:text-indigo-500",
              },
            )}`}
            disabled={!props.values.postedAt}
            onClick={() => {
              update({ postedAt: null });
            }}
          >
            {tx("Use the current time")}
          </button>
          <p className="mb-1 basis-full text-xs text-gray-500">
            {tx("Shown on the status page as the time of this update.")}{" "}
            {translator.translateTemplate("Times are in {{timezone}}.", {
              timezone: OneUptimeDate.getCurrentTimezoneString(),
            })}
          </p>
        </div>
      )}

      {props.error && (
        <div
          role="alert"
          data-testid="note-composer-error"
          className={`${insetBox} mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800`}
        >
          <Icon icon={IconProp.Error} className="mt-0.5 h-4 w-4 shrink-0" />
          {/*
           * Read as a list's failure reads (ErrorMessageText): an error
           * nobody explained says what failed, why and what to do next,
           * with the reference to give when the server failed (#6836); any
           * other is in the reader's language, read the way it is written.
           * It was the message as API.getFriendlyMessage words it: English
           * on every page, and on a Persian one with its full stop at its
           * start.
           */}
          <span className="min-w-0 flex-1">
            <ErrorMessageText
              message={props.error}
              whatFailed={tx(
                props.errorWhatFailed ||
                  (props.mode === "edit"
                    ? NoteActionFailedCopy.edit
                    : NoteActionFailedCopy.post),
              )}
            />
          </span>
        </div>
      )}

      {props.notifyOption && (
        <div
          className={`${insetBox} mt-3 flex items-start gap-3 rounded-lg border border-gray-200 px-3 py-2.5`}
        >
          <input
            id={notifyId}
            type="checkbox"
            data-testid="note-notify-checkbox"
            checked={props.values.shouldNotify}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              update({ shouldNotify: event.target.checked });
            }}
            className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer rounded border-gray-300 text-indigo-600 focus:ring-indigo-500"
          />
          <div className="min-w-0">
            {/*
             * The box and its preview on one line ("Notify status page
             * subscribers · Preview"), as the summary of Declare Incident
             * puts the preview beside its Yes. The preview wraps under the
             * label when the two do not fit.
             */}
            <div
              className="flex flex-wrap items-center gap-x-3 gap-y-0.5"
              data-testid="note-notify-line"
            >
              <label
                htmlFor={notifyId}
                className="block cursor-pointer text-sm font-medium text-gray-900"
              >
                {tx(props.notifyOption.title)}
              </label>
              {props.values.shouldNotify && props.notifyPreview ? (
                <div className="flex" data-testid="note-notify-preview">
                  {props.notifyPreview(props.values)}
                </div>
              ) : (
                <></>
              )}
            </div>
            <p
              className="mt-0.5 text-xs text-gray-500"
              data-testid="note-notify-description"
            >
              {tx(
                props.values.shouldNotify
                  ? props.notifyOption.checkedDescription
                  : props.notifyOption.uncheckedDescription,
              )}
            </p>
            {props.values.shouldNotify && props.notifyAudience ? (
              <div data-testid="note-notify-audience">
                {props.notifyAudience}
              </div>
            ) : (
              <></>
            )}
          </div>
        </div>
      )}

      {props.notice && (
        <div
          className={`${insetBox} mt-3 flex items-start gap-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900`}
          data-testid="note-composer-notice"
        >
          <Icon
            icon={IconProp.ShieldCheck}
            className="mt-0.5 h-4 w-4 shrink-0 text-amber-600"
          />
          <div className="min-w-0">{props.notice}</div>
        </div>
      )}

      {/*
       * The tools and the buttons share one row when both fit and the buttons
       * drop to their own row, at the end, when they do not. Squeezed side by
       * side, the tools stacked in three rows and the submit button broke
       * its own label ("Add / note") on a tablet and beside the side menu.
       * On the narrowest phones a long label ("Update veröffentlichen") puts
       * Cancel on a row of its own rather than run past the card's edge.
       */}
      <div
        data-testid="note-composer-footer"
        className={
          isDialog
            ? "mt-3"
            : "mt-3 flex flex-wrap items-center gap-3 rounded-b-xl border-t border-gray-100 bg-gray-50/70 px-3 py-2.5"
        }
      >
        <div
          className={
            isDialog
              ? "-mx-2.5 flex flex-wrap items-center gap-1"
              : "flex flex-wrap items-center gap-1"
          }
          data-testid="note-composer-tools"
        >
          {props.leadingActions}
          {props.isAttachmentsEnabled && (
            <button
              type="button"
              data-testid="note-attach-button"
              aria-pressed={isAttachmentPickerOpen}
              onClick={() => {
                setIsAttachmentPickerOpen(!isAttachmentPickerOpen);
              }}
              className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                isAttachmentPickerOpen
                  ? "bg-gray-200/70 text-gray-900"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              }`}
            >
              <Icon icon={IconProp.PaperClip} className="h-4 w-4" />
              <span>{tx("Attach")}</span>
              {props.values.attachments.length > 0 && (
                <span className="rounded-full bg-indigo-100 px-1.5 text-xs font-semibold text-indigo-700">
                  {props.values.attachments.length}
                </span>
              )}
            </button>
          )}
          {props.isPostedAtEditable && (
            <button
              type="button"
              data-testid="note-posted-at-button"
              aria-expanded={isPostedAtOpen}
              onClick={() => {
                setIsPostedAtOpen(!isPostedAtOpen);
              }}
              className={`inline-flex h-8 items-center gap-1.5 rounded-md px-2.5 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
                isPostedAtOpen || props.values.postedAt
                  ? "bg-gray-200/70 text-gray-900"
                  : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
              }`}
            >
              <Icon icon={IconProp.Clock} className="h-4 w-4" />
              <span>{postedAtLabel}</span>
            </button>
          )}
        </div>

        {/*
         * A dialog draws Cancel and the submit button in its own footer, where
         * every dialog has them.
         */}
        {!isDialog && (
          <div
            className="ms-auto flex flex-wrap items-center justify-end gap-2"
            data-testid="note-composer-buttons"
          >
            {props.onCancel && (
              <button
                type="button"
                onClick={props.onCancel}
                disabled={props.isSubmitting}
                className={`inline-flex h-9 items-center rounded-md px-3 text-sm font-medium text-gray-700 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${getHandDrawnButtonStateClassName(
                  {
                    isLocked: props.isSubmitting,
                    hoverClassName: "hover:bg-gray-100",
                  },
                )}`}
              >
                {tx("Cancel")}
              </button>
            )}
            <button
              type="submit"
              data-testid="note-submit"
              disabled={isSubmitDisabled}
              title={
                isBlank
                  ? tx("Write something first")
                  : `${tx(props.submitLabel || props.copy.submitLabel)} (${submitShortcut})`
              }
              /*
               * An empty note cannot be posted, and the button looks it the
               * way every locked button does (getHandDrawnButtonStateClassName):
               * a paler fill of its own was a bright block in the dark theme.
               * While the note posts it is busy, not locked, so it keeps its
               * look beside its spinner.
               */
              className={`inline-flex h-9 items-center gap-2 rounded-md bg-indigo-600 px-3.5 text-sm font-semibold text-white shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${getHandDrawnButtonStateClassName(
                {
                  isLocked: isBlank,
                  isBusy: props.isSubmitting,
                  hoverClassName: "hover:bg-indigo-700",
                },
              )}`}
            >
              {props.isSubmitting && (
                <Icon
                  icon={IconProp.Spinner}
                  className="h-4 w-4 animate-spin"
                />
              )}
              <span>{tx(props.submitLabel || props.copy.submitLabel)}</span>
              <kbd className="max-sm:hidden rounded bg-white/15 px-1.5 py-0.5 font-sans text-[11px] font-medium text-indigo-50 sm:inline">
                {submitShortcut}
              </kbd>
            </button>
          </div>
        )}
      </div>
    </form>
  );
};

export default NoteComposer;
