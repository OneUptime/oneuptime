import FileModel from "Common/Models/DatabaseModels/File";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import FilePicker from "Common/UI/Components/FilePicker/FilePicker";
import Icon from "Common/UI/Components/Icon/Icon";
import KeyboardKey, {
  KeyboardKeyUtil,
} from "Common/UI/Components/KeyboardShortcut/KeyboardKey";
import MarkdownEditor from "Common/UI/Components/Markdown.tsx/MarkdownEditor";
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
  NotesCopy,
  NoteVisibility,
  fromDateTimeInputValue,
  isNoteBlank,
  toDateTimeInputValue,
} from "./EventNotesUtil";

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

export interface ComponentProps {
  mode: "create" | "edit";
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
  isPostedAtEditable: boolean;
  isSubmitting: boolean;
  error?: string | undefined;
  onSubmit: () => void;
  onCancel?: (() => void) | undefined;
  // Templates, "Draft with AI" - shown at the start of the footer.
  leadingActions?: ReactElement | undefined;
  isAutoFocused?: boolean | undefined;
  submitLabel?: string | undefined;
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
 */
export const AudienceBadge: FunctionComponent<{
  visibility: NoteVisibility;
  copy: NotesCopy;
}> = (props: { visibility: NoteVisibility; copy: NotesCopy }): ReactElement => {
  const { translateString } = useTranslateValue();
  const style: { icon: IconProp; className: string } =
    AUDIENCE_STYLES[props.visibility];

  return (
    <span
      data-testid="note-audience"
      className={`inline-flex min-w-0 items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium ring-1 ring-inset ${style.className}`}
    >
      <Icon icon={style.icon} className="h-3.5 w-3.5 shrink-0" />
      <span className="font-semibold">
        {translateString(props.copy.audienceLabel) || props.copy.audienceLabel}
      </span>
      <span aria-hidden="true" className="opacity-50">
        ·
      </span>
      <span className="truncate">
        {translateString(props.copy.audienceHint) || props.copy.audienceHint}
      </span>
    </span>
  );
};

const NoteComposer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const tx: (value: string) => string = (value: string): string => {
    return translateString(value) || value;
  };

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
    ? OneUptimeDate.getDateAsLocalShortDateTimeString(props.values.postedAt)
    : tx("now");

  return (
    <form
      ref={containerRef}
      data-testid={props.dataTestId}
      aria-busy={props.isSubmitting}
      className="rounded-xl border border-gray-200 bg-white shadow-sm focus-within:border-indigo-300 focus-within:ring-4 focus-within:ring-indigo-50"
      onSubmit={(event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();

        if (!isSubmitDisabled) {
          props.onSubmit();
        }
      }}
      onKeyDown={(event: React.KeyboardEvent<HTMLFormElement>) => {
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
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-gray-100 px-4 py-2.5">
        <span id={editorLabelId} className="sr-only">
          {props.mode === "create"
            ? tx(`New ${props.copy.noteNoun}`)
            : tx(`Edit ${props.copy.noteNoun}`)}
        </span>
        <AudienceBadge visibility={props.visibility} copy={props.copy} />
        {props.mode === "edit" && (
          <span className="text-xs font-medium text-gray-500">
            {tx("Editing")}
          </span>
        )}
      </div>

      <div className="px-4 pt-3">
        <MarkdownEditor
          key={props.editorKey}
          initialValue={props.values.note}
          placeholder={tx(props.copy.composerPlaceholder)}
          ariaLabelledby={editorLabelId}
          dataTestId="note-editor"
          onChange={(value: string) => {
            update({ note: value });
          }}
        />
      </div>

      {props.isAttachmentsEnabled && isAttachmentPickerOpen && (
        <div className="px-4 pt-3" data-testid="note-attachment-picker">
          <FilePicker
            /*
             * The picker keeps its own list and ignores an emptied value, so
             * it is remounted with the editor when the draft is reset.
             */
            key={props.editorKey}
            isMultiFilePicker={true}
            initialValue={initialAttachments}
            placeholder={tx("Upload files")}
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
            className="flex flex-wrap gap-2 px-4 pt-3"
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
        <div className="mx-4 mt-3 flex flex-wrap items-end gap-3 rounded-lg border border-gray-200 bg-gray-50 px-3 py-3">
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
            className="mb-1 text-sm font-medium text-indigo-600 hover:text-indigo-500 disabled:cursor-not-allowed disabled:text-gray-400"
            disabled={!props.values.postedAt}
            onClick={() => {
              update({ postedAt: null });
            }}
          >
            {tx("Use the current time")}
          </button>
          <p className="mb-1 basis-full text-xs text-gray-500">
            {tx("Shown on the status page as the time of this update.")}{" "}
            {tx("Times are in")} {OneUptimeDate.getCurrentTimezoneString()}.
          </p>
        </div>
      )}

      {props.error && (
        <div
          role="alert"
          data-testid="note-composer-error"
          className="mx-4 mt-3 flex items-start gap-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-800"
        >
          <Icon icon={IconProp.Error} className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{props.error}</span>
        </div>
      )}

      {props.notifyOption && (
        <div className="mx-4 mt-3 flex items-start gap-3 rounded-lg border border-gray-200 px-3 py-2.5">
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
            <label
              htmlFor={notifyId}
              className="block cursor-pointer text-sm font-medium text-gray-900"
            >
              {tx(props.notifyOption.title)}
            </label>
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
          </div>
        </div>
      )}

      <div className="mt-3 flex flex-col gap-3 rounded-b-xl border-t border-gray-100 bg-gray-50/70 px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap items-center gap-1">
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
              <span>
                {tx("Posted")} {postedAtLabel}
              </span>
            </button>
          )}
        </div>

        <div className="flex items-center justify-end gap-2">
          {props.onCancel && (
            <button
              type="button"
              onClick={props.onCancel}
              disabled={props.isSubmitting}
              className="inline-flex h-9 items-center rounded-md px-3 text-sm font-medium text-gray-700 transition hover:bg-gray-100 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-50"
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
            className="inline-flex h-9 items-center gap-2 rounded-md bg-indigo-600 px-3.5 text-sm font-semibold text-white shadow-sm transition hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:bg-indigo-300"
          >
            {props.isSubmitting && (
              <Icon icon={IconProp.Spinner} className="h-4 w-4 animate-spin" />
            )}
            <span>{tx(props.submitLabel || props.copy.submitLabel)}</span>
            <kbd className="max-sm:hidden rounded bg-white/15 px-1.5 py-0.5 font-sans text-[11px] font-medium text-indigo-50 sm:inline">
              {submitShortcut}
            </kbd>
          </button>
        </div>
      </div>
    </form>
  );
};

export default NoteComposer;
