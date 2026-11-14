import FileModel from "Common/Models/DatabaseModels/File";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { ButtonStyleType } from "Common/UI/Components/Button/Button";
import Icon from "Common/UI/Components/Icon/Icon";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/LazyMarkdownViewer";
import ConfirmModal from "Common/UI/Components/Modal/ConfirmModal";
import MoreMenu from "Common/UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import Tooltip from "Common/UI/Components/Tooltip/Tooltip";
import API from "Common/UI/Utils/API/API";
import Clipboard from "Common/UI/Utils/Clipboard";
import useTranslateValue from "Common/UI/Utils/Translation";
import { formatList, Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement, useState } from "react";
import WorkspaceType from "Common/Types/Workspace/WorkspaceType";
import {
  NOTE_ADDED_BY,
  NoteActionFailedCopy,
  NoteAuthor,
  NoteNotificationSummary,
  NoteRecord,
  NoteSource,
  NotesCopy,
  NoteVisibility,
  getNoteAuthor,
  getNoteFullTimeLabel,
  getNoteId,
  getNoteSource,
  getNoteTimeLabel,
  getNoteTimestamp,
  getPostedNotificationSummary,
  getUpdateNotificationSummary,
} from "./EventNotesUtil";
import NoteAttachments from "./NoteAttachments";
import NoteAvatar from "./NoteAvatar";
import NoteComposer, { NoteComposerValues, NotifyOption } from "./NoteComposer";
import NoteNotificationBadge, {
  NoteResendConfirmation,
} from "./NoteNotificationBadge";
import { PublicNoteApprovalState } from "Common/Types/StatusPage/PublicNoteApproval";
import NoteApprovalPanel from "./PublicNoteApproval/NoteApprovalPanel";
import {
  PublicNoteApprovalBadge,
  PublicNoteApprovalCopy,
  PublicNoteApprovalNoteSummary,
  getApprovalBadge,
  isNotePublished,
} from "./PublicNoteApproval/PublicNoteApprovalUtil";

/*
 * A public note's approval (Common/Types/StatusPage/PublicNoteApproval):
 * where it stands, and what the reader can do about it.
 */
export interface NoteCardApproval {
  state: PublicNoteApprovalState;
  summary?: PublicNoteApprovalNoteSummary | undefined;
  // The project asks for this kind of note to be approved now.
  isRequired: boolean;
  // An edit of this note waits for approval: it is published, and approval is asked for.
  isEditHeld: boolean;
  canEdit: boolean;
  onApprove: () => Promise<void>;
  onReject: (reason: string) => Promise<void>;
  onResubmit: () => Promise<void>;
  onWithdrawEdit: () => Promise<void>;
}

/*
 * How an edit or delete affordance is offered: `isShown: false` hides it (the
 * permission snapshot has not loaded, or the model offers no such
 * operation); a disabled one says which permission is missing.
 */
export interface NoteActionGate {
  isShown: boolean;
  isDisabled: boolean;
  tooltip?: string | undefined;
}

export interface ComponentProps {
  note: NoteRecord;
  visibility: NoteVisibility;
  copy: NotesCopy;
  now: Date;
  isLastInFeed: boolean;
  attachmentApiPath?: string | undefined;
  editGate: NoteActionGate;
  deleteGate: NoteActionGate;
  isEditing: boolean;
  onStartEdit: () => void;
  onCancelEdit: () => void;
  // Throws with a message the card shows when the save is refused.
  onSaveEdit: (values: NoteComposerValues) => Promise<void>;
  onDelete: () => Promise<void>;
  onRetryPostedNotification?: (() => Promise<void>) | undefined;
  onRetryUpdateNotification?: (() => Promise<void>) | undefined;
  /*
   * Offers Resend for a posted notification that went out, and asks before
   * it or a Retry is sent, with this confirmation. Left out, only a failed
   * one offers Retry, with no confirmation.
   */
  postedNotificationResendConfirmation?: NoteResendConfirmation | undefined;
  isPostedAtEditable: boolean;
  updateNotifyOption?: NotifyOption | undefined;
  // A public note's approval, where its project can ask for one.
  approval?: NoteCardApproval | undefined;
}

const NoteCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  const translator: Translator = useTranslator();
  const tx: (value: string) => string = (value: string): string => {
    return translateString(value) || value;
  };

  const noteId: string | null = getNoteId(props.note);
  /*
   * A message saved from Slack or Microsoft Teams is its author's words,
   * filed when they wrote it; whoever saved it is named after the chat.
   */
  const author: NoteAuthor = getNoteAuthor(props.note);
  // A name somebody has is shown as it is; only the stand-in for none is looked up.
  const authorName: string = author.isNameStandIn
    ? tx(author.name)
    : author.name;
  const timestamp: Date | null = getNoteTimestamp(props.note, props.visibility);
  const source: NoteSource | null = getNoteSource(props.note);

  const [editValues, setEditValues] = useState<NoteComposerValues | null>(null);
  const [editError, setEditError] = useState<string>("");
  const [isSaving, setIsSaving] = useState<boolean>(false);
  const [isDeleteConfirmOpen, setIsDeleteConfirmOpen] =
    useState<boolean>(false);
  const [isDeleting, setIsDeleting] = useState<boolean>(false);
  const [deleteError, setDeleteError] = useState<string>("");
  const [copyState, setCopyState] = useState<"idle" | "copied" | "failed">(
    "idle",
  );

  const approvalState: PublicNoteApprovalState =
    props.approval?.state || PublicNoteApprovalState.Published;
  const hasWaitingEdit: boolean =
    approvalState === PublicNoteApprovalState.EditWaitingForApproval ||
    approvalState === PublicNoteApprovalState.EditRejected;
  // Waiting, or rejected: on no status page, and told to no subscriber yet.
  const isPublished: boolean = isNotePublished(approvalState);
  const approvalBadge: PublicNoteApprovalBadge | null = props.approval
    ? getApprovalBadge(approvalState, props.approval.summary)
    : null;

  const startEdit: () => void = (): void => {
    setEditError("");
    setEditValues({
      // An edit waiting for approval is what is edited, not the note as published.
      note:
        (hasWaitingEdit ? props.note.pendingNote : undefined) ??
        (props.note.note || ""),
      attachments: (props.note.attachments || []).map((file: FileModel) => {
        const stripped: FileModel = new FileModel();
        stripped._id = (file._id || file.id?.toString()) as string;

        if (file.name) {
          stripped.name = file.name;
        }

        if (file.fileType) {
          stripped.fileType = file.fileType;
        }

        return stripped;
      }),
      shouldNotify: false,
      postedAt: props.note.postedAt
        ? OneUptimeDate.fromString(props.note.postedAt)
        : null,
    });
    props.onStartEdit();
  };

  const saveEdit: () => Promise<void> = async (): Promise<void> => {
    if (!editValues) {
      return;
    }

    setEditError("");
    setIsSaving(true);

    try {
      await props.onSaveEdit(editValues);
      setEditValues(null);
    } catch (err) {
      setEditError(API.getFriendlyMessage(err));
    }

    setIsSaving(false);
  };

  const confirmDelete: () => Promise<void> = async (): Promise<void> => {
    setDeleteError("");
    setIsDeleting(true);

    try {
      await props.onDelete();
      setIsDeleteConfirmOpen(false);
    } catch (err) {
      setDeleteError(API.getFriendlyMessage(err));
    }

    setIsDeleting(false);
  };

  const copyId: () => Promise<void> = async (): Promise<void> => {
    if (!noteId) {
      return;
    }

    const isCopied: boolean = await Clipboard.copyToClipboard(noteId);
    setCopyState(isCopied ? "copied" : "failed");

    setTimeout(() => {
      setCopyState("idle");
    }, 2000);
  };

  const postedSummary: NoteNotificationSummary | null =
    props.visibility === "public" && isPublished
      ? getPostedNotificationSummary(
          props.note.subscriberNotificationStatusOnNoteCreated,
          props.note.subscriberNotificationStatusMessage,
          {
            isResendAfterSuccessOffered: Boolean(
              props.postedNotificationResendConfirmation,
            ),
          },
        )
      : null;

  const updateSummary: NoteNotificationSummary | null =
    props.visibility === "public" && isPublished
      ? getUpdateNotificationSummary(
          props.note.subscriberNotificationStatusOnNoteUpdated,
          props.note.subscriberNotificationStatusMessageOnNoteUpdated,
        )
      : null;

  const isEditingThis: boolean = props.isEditing && editValues !== null;

  const menuItems: Array<ReactElement> = [];

  if (props.editGate.isShown) {
    menuItems.push(
      <MoreMenuItem
        key="edit"
        icon={IconProp.Pencil}
        text={tx("Edit note")}
        isDisabled={props.editGate.isDisabled}
        tooltip={props.editGate.tooltip}
        onClick={startEdit}
      />,
    );
  }

  if (noteId) {
    menuItems.push(
      <MoreMenuItem
        key="copy-id"
        icon={IconProp.Copy}
        text={
          copyState === "copied"
            ? tx("Copied")
            : copyState === "failed"
              ? tx("Copy failed")
              : tx("Copy note ID")
        }
        onClick={() => {
          copyId();
        }}
      />,
    );
  }

  if (props.deleteGate.isShown) {
    menuItems.push(
      <MoreMenuItem
        key="delete"
        icon={IconProp.Trash}
        text={tx("Delete note")}
        className="text-red-600"
        iconClassName="text-red-500"
        isDisabled={props.deleteGate.isDisabled}
        tooltip={props.deleteGate.tooltip}
        onClick={() => {
          setDeleteError("");
          setIsDeleteConfirmOpen(true);
        }}
      />,
    );
  }

  return (
    <li
      className="relative flex gap-3 pb-6 last:pb-0"
      data-testid="note-card"
      data-note-id={noteId || undefined}
    >
      {!props.isLastInFeed && (
        <span
          aria-hidden="true"
          className="absolute left-[17px] top-10 -bottom-0 w-px bg-gray-200"
        />
      )}

      <div className="relative z-10 pt-0.5">
        <NoteAvatar
          userId={author.userId}
          name={authorName}
          isAutomation={author.isAutomation}
          isNameless={author.isNameStandIn}
        />
      </div>

      <article
        className={`min-w-0 flex-1 rounded-lg border bg-white ${
          isEditingThis
            ? "border-transparent"
            : "border-gray-200 shadow-[0_1px_2px_rgba(16,24,40,0.04)]"
        }`}
        /*
         * Who wrote it and when, joined as the reader's language joins two
         * parts ("، " in Persian, "、" in Japanese); a note with no time is
         * named by its author alone, not with a comma left hanging.
         */
        aria-label={formatList(
          timestamp
            ? [authorName, getNoteFullTimeLabel(timestamp)]
            : [authorName],
          translator,
        )}
      >
        {isEditingThis ? (
          <NoteComposer
            mode="edit"
            visibility={props.visibility}
            copy={props.copy}
            values={editValues!}
            onChange={setEditValues}
            editorKey={`edit-${noteId}`}
            isAttachmentsEnabled={
              Boolean(props.attachmentApiPath) && !props.approval?.isEditHeld
            }
            notifyOption={props.updateNotifyOption}
            isPostedAtEditable={props.isPostedAtEditable}
            isSubmitting={isSaving}
            error={editError}
            errorWhatFailed={
              props.approval?.isEditHeld
                ? PublicNoteApprovalCopy.editSendFailed
                : NoteActionFailedCopy.edit
            }
            isAutoFocused={true}
            notice={
              props.approval?.isEditHeld ? (
                <p data-testid="note-edit-approval-notice">
                  {tx(PublicNoteApprovalCopy.editNotice)}
                  {props.attachmentApiPath &&
                  (props.note.attachments || []).length > 0
                    ? ` ${tx(PublicNoteApprovalCopy.editFilesLocked)}`
                    : ""}
                </p>
              ) : undefined
            }
            submitLabel={
              props.approval?.isEditHeld
                ? tx(PublicNoteApprovalCopy.editSubmit)
                : tx("Save changes")
            }
            dataTestId="note-edit-composer"
            onSubmit={() => {
              saveEdit();
            }}
            onCancel={() => {
              setEditValues(null);
              setEditError("");
              props.onCancelEdit();
            }}
          />
        ) : (
          <>
            <header className="relative flex flex-wrap items-center gap-x-2 gap-y-1.5 border-b border-gray-100 py-2 pl-4 pr-11">
              {/*
               * A name wraps rather than being cut: a name from a chat is
               * often long ("Priya Raghunathan (Platform, EMEA)"), and who
               * wrote a note is what its header is for.
               */}
              <span
                className="min-w-0 break-words text-sm font-semibold text-gray-900"
                data-testid="note-author"
              >
                {authorName}
              </span>
              {timestamp && (
                <Tooltip text={getNoteFullTimeLabel(timestamp)}>
                  <time
                    dateTime={timestamp.toISOString()}
                    className="whitespace-nowrap text-sm text-gray-500"
                    data-testid="note-time"
                  >
                    {getNoteTimeLabel(timestamp, props.now, translator)}
                  </time>
                </Tooltip>
              )}
              {source && (
                <span
                  className="inline-flex items-center gap-1 rounded-md bg-gray-100 px-1.5 py-0.5 text-xs font-medium text-gray-600"
                  data-testid="note-source"
                >
                  <Icon
                    icon={
                      source.workspaceType === WorkspaceType.MicrosoftTeams
                        ? IconProp.MicrosoftTeams
                        : IconProp.Slack
                    }
                    className="h-3 w-3"
                  />
                  {tx(source.label)}
                </span>
              )}
              {author.savedByName && (
                <span
                  className="min-w-0 break-words text-xs text-gray-500"
                  data-testid="note-saved-by"
                >
                  {translator.translateTemplate(NOTE_ADDED_BY, {
                    name: author.savedByName,
                  })}
                </span>
              )}

              <div className="ml-auto flex min-w-0 flex-wrap items-center justify-end gap-1.5">
                {approvalBadge && (
                  <span
                    data-testid="note-approval-badge"
                    data-tone={approvalBadge.tone}
                    className={`inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${
                      approvalBadge.tone === "rejected"
                        ? "bg-red-50 text-red-700 ring-red-200"
                        : approvalBadge.tone === "approved"
                          ? "bg-green-50 text-green-700 ring-green-200"
                          : "bg-amber-50 text-amber-800 ring-amber-200"
                    }`}
                  >
                    <Icon
                      icon={
                        approvalBadge.tone === "rejected"
                          ? IconProp.XCircle
                          : approvalBadge.tone === "approved"
                            ? IconProp.ShieldCheck
                            : IconProp.Clock
                      }
                      className="h-3 w-3"
                    />
                    {tx(approvalBadge.label)}
                  </span>
                )}
                {postedSummary && (
                  <NoteNotificationBadge
                    summary={postedSummary}
                    kindLabel="Subscriber notification"
                    onRetry={props.onRetryPostedNotification}
                    resendConfirmation={
                      props.postedNotificationResendConfirmation
                    }
                    dataTestId="note-notification-status"
                  />
                )}
                {updateSummary && (
                  <NoteNotificationBadge
                    summary={updateSummary}
                    kindLabel="Update notification"
                    onRetry={props.onRetryUpdateNotification}
                    dataTestId="note-update-notification-status"
                  />
                )}
              </div>
              {menuItems.length > 0 && (
                /*
                 * Pinned to the corner so a header that wraps on a narrow
                 * screen never pushes the menu out of the card.
                 */
                <div className="absolute right-2 top-1.5">
                  <MoreMenu
                    ariaLabel="Note actions"
                    dataTestId="note-actions"
                    elementToBeShownInsteadOfButton={
                      <Icon
                        icon={IconProp.EllipsisHorizontal}
                        className="h-4 w-4"
                      />
                    }
                    triggerClassName="inline-flex h-7 w-7 cursor-pointer items-center justify-center rounded-md text-gray-400 transition hover:bg-gray-100 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  >
                    {menuItems}
                  </MoreMenu>
                </div>
              )}
            </header>

            <div
              className="px-4 py-3 text-sm leading-6 text-gray-800 [&_.max-w-none>*:first-child]:mt-0 [&_.max-w-none>*:last-child]:mb-0"
              data-testid="note-body"
            >
              <MarkdownViewer text={props.note.note || ""} />
            </div>

            {props.attachmentApiPath &&
              props.note.attachments &&
              props.note.attachments.length > 0 && (
                <div className="px-4 pb-3">
                  <NoteAttachments
                    noteId={noteId}
                    attachments={props.note.attachments}
                    attachmentApiPath={props.attachmentApiPath}
                  />
                </div>
              )}

            {props.approval && (
              <NoteApprovalPanel
                state={approvalState}
                summary={props.approval.summary}
                pendingNote={
                  hasWaitingEdit ? props.note.pendingNote || "" : undefined
                }
                isRequired={props.approval.isRequired}
                canEdit={props.approval.canEdit}
                onApprove={props.approval.onApprove}
                onReject={props.approval.onReject}
                onResubmit={props.approval.onResubmit}
                onWithdrawEdit={props.approval.onWithdrawEdit}
              />
            )}
          </>
        )}
      </article>

      {isDeleteConfirmOpen && (
        <ConfirmModal
          title={tx(props.copy.deleteTitle)}
          description={tx(props.copy.deleteDescription)}
          submitButtonText={tx("Delete note")}
          submitButtonType={ButtonStyleType.DANGER}
          closeButtonText={tx("Keep note")}
          isLoading={isDeleting}
          error={deleteError || undefined}
          errorWhatFailed={tx(NoteActionFailedCopy.delete)}
          onClose={() => {
            setIsDeleteConfirmOpen(false);
          }}
          onSubmit={() => {
            confirmDelete();
          }}
        />
      )}
    </li>
  );
};

export default NoteCard;
