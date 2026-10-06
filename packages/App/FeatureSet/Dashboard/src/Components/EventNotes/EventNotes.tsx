import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Project from "Common/Models/DatabaseModels/Project";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import Sort from "Common/Types/BaseDatabase/Sort";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import Permission from "Common/Types/Permission";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import SubscriberUpdateNotification from "Common/Types/StatusPage/SubscriberUpdateNotification";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import Icon from "Common/UI/Components/Icon/Icon";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { HeldPermissions } from "Common/Types/HeldPermissions";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import useTranslateValue from "Common/UI/Utils/Translation";
import User from "Common/UI/Utils/User";
import React, {
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  NOTES_PAGE_SIZE,
  NOTES_SEARCH_DEBOUNCE_MS,
  NOTIFICATION_POLL_INTERVAL_MS,
  NoteDayGroup,
  NoteRecord,
  NoteSortOrder,
  NotesCopy,
  buildNotesQuery,
  buildNotesSelect,
  canWriteNoteColumn,
  getNoteId,
  getNotesCopy,
  getNoteTimestamp,
  groupNotesByDay,
  hasNotificationInFlight,
} from "./EventNotesUtil";
import NoteCard, { NoteActionGate } from "./NoteCard";
import { NoteResendConfirmation } from "./NoteNotificationBadge";
import SubscriberNotificationResendCopy from "../StatusPageSubscribers/SubscriberNotificationResendCopy";
import {
  AUDIENCE_STYLES,
  NoteComposerValues,
  NotifyOption,
} from "./NoteComposer";
import EventNoteComposer from "./EventNoteComposer";
import { EventNoteKind } from "./EventNoteKind";
import NotesVisibilitySwitch from "./NotesVisibilitySwitch";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * What the page hands the notes feed: the kind of note it shows, from the
 * event's NoteKinds module, and the project new notes are saved in.
 */
export interface ComponentProps<TNote extends BaseModel>
  extends EventNoteKind<TNote> {
  currentProject: Project | null;
}

const toActionGate: (result: PermissionGateResult) => NoteActionGate = (
  result: PermissionGateResult,
): NoteActionGate => {
  if (result.isAllowed) {
    return { isShown: true, isDisabled: false };
  }

  if (result.disabledReason) {
    return {
      isShown: true,
      isDisabled: true,
      tooltip: result.disabledReason,
    };
  }

  return { isShown: false, isDisabled: true };
};

/*
 * The notes of one incident, alert, scheduled maintenance event or episode:
 * a composer at the top that says who will read the note (EventNoteComposer,
 * the same one the overview feed's "Add ... Note" opens in a dialog), and a
 * timeline of what has been written, grouped by day, newest first. Notes are
 * edited in place and every action a note offers lives in its own menu.
 *
 * This replaced a notes table whose every write went through a modal - and
 * a second modal for picking a template - and which looked the same whether
 * the notes were going on a public status page or staying with the team.
 */
function EventNotes<TNote extends BaseModel>(
  props: ComponentProps<TNote>,
): ReactElement {
  const translator: Translator = useTranslator();
  const { translateString } = useTranslateValue();
  const tx: (value: string) => string = (value: string): string => {
    return translateString(value) || value;
  };

  const copy: NotesCopy = getNotesCopy(
    props.visibility,
    props.eventNoun,
    translator,
  );
  const model: TNote = useMemo(() => {
    return new props.modelType();
  }, [props.modelType]);

  const isPublic: boolean = props.visibility === "public";
  // What the viewer holds, and what a team of theirs blocks.
  const heldPermissions: HeldPermissions = PermissionGate.getHeldPermissions();
  const userPermissions: Array<Permission> = heldPermissions.allowed;
  const blockedPermissions: Array<Permission> = heldPermissions.blocked;
  const isMasterAdmin: boolean = User.isMasterAdmin();

  const canWrite: (column: string, action: "create" | "update") => boolean = (
    column: string,
    action: "create" | "update",
  ): boolean => {
    return (
      model.hasColumn(column) &&
      canWriteNoteColumn({
        model,
        column,
        action,
        userPermissions,
        blockedPermissions,
        isMasterAdmin,
      })
    );
  };

  const hasAttachments: boolean = Boolean(props.attachmentApiPath);
  const createGate: PermissionGateResult = PermissionGate.check(
    model,
    ModelAction.Create,
  );
  const editGate: NoteActionGate = toActionGate(
    PermissionGate.check(model, ModelAction.Update),
  );
  const deleteGate: NoteActionGate = toActionGate(
    PermissionGate.check(model, ModelAction.Delete),
  );

  const isEditAttachmentsEnabled: boolean =
    hasAttachments && canWrite("attachments", "update");
  const isEditPostedAtEditable: boolean =
    isPublic && canWrite("postedAt", "update");

  /*
   * Sending a note's 'posted' notification again writes its status, and
   * tells every subscriber what the note says - what posting it did. So it
   * takes both: permission to edit the note's notification status, and
   * permission to post a note that notifies subscribers. The server checks
   * the same (SubscriberNotificationResendAccess).
   */
  const canResendPostedNotification: boolean =
    isPublic &&
    editGate.isShown &&
    !editGate.isDisabled &&
    createGate.isAllowed &&
    canWrite("subscriberNotificationStatusOnNoteCreated", "update") &&
    canWrite("shouldStatusPageSubscribersBeNotifiedOnNoteCreated", "create");

  /*
   * Telling subscribers about an edit - the edit form's checkbox, and Retry
   * of a failed update - tells them what the note says now, and an editor
   * can change the text first. So it takes the permission to post a note
   * that notifies subscribers as well as the note's edit permission, as
   * sending the 'posted' notification again does. The server checks the
   * same (SubscriberNotificationResendAccess).
   */
  const canNotifyAboutEdit: boolean =
    isPublic &&
    createGate.isAllowed &&
    canWrite("shouldStatusPageSubscribersBeNotifiedOnNoteCreated", "create") &&
    canWrite("subscriberNotificationStatusOnNoteUpdated", "update");

  const canResendUpdateNotification: boolean =
    editGate.isShown && !editGate.isDisabled && canNotifyAboutEdit;

  const postedNotificationResendConfirmation:
    | NoteResendConfirmation
    | undefined =
    isPublic && props.subscriberNotifications?.resend
      ? {
          resendDescription:
            SubscriberNotificationResendCopy.noteResendDescription,
          retryDescription:
            SubscriberNotificationResendCopy.noteRetryDescription,
          audience: props.subscriberNotifications.resend.audience,
        }
      : undefined;

  // Feed.
  const [notes, setNotes] = useState<Array<TNote>>([]);
  const [totalCount, setTotalCount] = useState<number>(0);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRefreshing, setIsRefreshing] = useState<boolean>(false);
  const [isLoadingMore, setIsLoadingMore] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string>("");
  const [actionError, setActionError] = useState<string>("");
  const [searchInput, setSearchInput] = useState<string>("");
  const [searchText, setSearchText] = useState<string>("");
  const [sortOrder, setSortOrder] = useState<NoteSortOrder>("newest");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);

  /*
   * Whether the composer is open or folded to its prompt. Kept here, not in
   * the composer, so the empty feed's "Post the first update" can open it.
   */
  const [isComposerOpen, setIsComposerOpen] = useState<boolean>(false);

  /*
   * Every fetch takes a number and drops its answer if a newer one started,
   * so a slow page of results can never overwrite a newer search or refresh.
   */
  const fetchGeneration: React.MutableRefObject<number> = useRef<number>(0);
  const loadedCount: React.MutableRefObject<number> = useRef<number>(0);
  loadedCount.current = notes.length;

  const select: JSONObject = useMemo(() => {
    return buildNotesSelect({
      model,
      visibility: props.visibility,
      isAttachmentsEnabled: hasAttachments,
      userPermissions,
      blockedPermissions,
      isMasterAdmin,
    });
  }, [
    model,
    props.visibility,
    hasAttachments,
    isMasterAdmin,
    userPermissions.join(","),
    blockedPermissions.join(","),
  ]);

  const timestampField: string =
    isPublic && model.hasColumn("postedAt") ? "postedAt" : "createdAt";

  /*
   * initial: the first load, drawn as a skeleton.
   * replace: a new search or sort; the old results stay up until the new
   *          ones arrive, so the search box keeps its focus.
   * refresh: after a write, or the refresh button; keeps every loaded page.
   * silent:  the background re-read while a notification is in flight.
   * more:    the next page, appended.
   */
  type FetchMode = "initial" | "replace" | "refresh" | "silent" | "more";

  type FetchNotesFunction = (options: {
    mode: FetchMode;
    limit?: number | undefined;
  }) => Promise<void>;

  const fetchNotes: FetchNotesFunction = async (options: {
    mode: FetchMode;
    limit?: number | undefined;
  }): Promise<void> => {
    const generation: number = ++fetchGeneration.current;
    const skip: number = options.mode === "more" ? loadedCount.current : 0;
    const limit: number = options.limit || NOTES_PAGE_SIZE;

    if (options.mode === "initial") {
      setIsLoading(true);
    } else if (options.mode === "refresh" || options.mode === "replace") {
      setIsRefreshing(true);
    } else if (options.mode === "more") {
      setIsLoadingMore(true);
    }

    try {
      const result: ListResult<TNote> = await ModelAPI.getList<TNote>({
        modelType: props.modelType,
        query: buildNotesQuery({
          parentIdField: props.parentIdField,
          parentId: props.parentId,
          projectId: ProjectUtil.getCurrentProjectId(),
          searchText,
        }) as Query<TNote>,
        select: select as Select<TNote>,
        sort: {
          [timestampField]:
            sortOrder === "newest" ? SortOrder.Descending : SortOrder.Ascending,
        } as Sort<TNote>,
        limit,
        skip,
      });

      if (generation !== fetchGeneration.current) {
        return;
      }

      setNotes((current: Array<TNote>) => {
        return options.mode === "more"
          ? [...current, ...result.data]
          : result.data;
      });
      setTotalCount(result.count);
      setLoadError("");
    } catch (err) {
      if (generation !== fetchGeneration.current) {
        return;
      }

      if (options.mode === "initial") {
        setLoadError(API.getFriendlyMessage(err));
      } else if (options.mode !== "silent") {
        setActionError(API.getFriendlyMessage(err));
      }
    }

    setIsLoading(false);
    setIsRefreshing(false);
    setIsLoadingMore(false);
  };

  // Keeps the notes already on screen, however many pages that is.
  const refresh: () => Promise<void> = async (): Promise<void> => {
    await fetchNotes({
      mode: "refresh",
      limit: Math.max(NOTES_PAGE_SIZE, loadedCount.current),
    });
  };

  const hasFetchedOnce: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  useEffect(() => {
    fetchNotes({ mode: hasFetchedOnce.current ? "replace" : "initial" });
    hasFetchedOnce.current = true;
  }, [searchText, sortOrder]);

  useEffect(() => {
    const timeout: ReturnType<typeof setTimeout> = setTimeout(() => {
      setSearchText(searchInput.trim());
    }, NOTES_SEARCH_DEBOUNCE_MS);

    return () => {
      clearTimeout(timeout);
    };
  }, [searchInput]);

  /*
   * A public note's notification is sent by a worker a few seconds after it
   * is posted. While one is queued or on its way, read the feed again now and
   * then so the badge settles by itself.
   */
  useEffect(() => {
    if (
      !isPublic ||
      isLoading ||
      isRefreshing ||
      isLoadingMore ||
      !hasNotificationInFlight(notes as Array<NoteRecord>)
    ) {
      return;
    }

    const timeout: ReturnType<typeof setTimeout> = setTimeout(() => {
      fetchNotes({
        mode: "silent",
        limit: Math.max(NOTES_PAGE_SIZE, loadedCount.current),
      });
    }, NOTIFICATION_POLL_INTERVAL_MS);

    return () => {
      clearTimeout(timeout);
    };
  }, [notes, isLoading, isRefreshing, isLoadingMore]);

  const saveEdit: (
    original: TNote,
    values: NoteComposerValues,
  ) => Promise<void> = async (
    original: TNote,
    values: NoteComposerValues,
  ): Promise<void> => {
    const noteId: string | null = getNoteId(original as NoteRecord);

    if (!noteId) {
      throw new Error(tx("This note cannot be edited."));
    }

    const note: TNote = new props.modelType();
    const record: JSONObject = note as unknown as JSONObject;
    note._id = noteId;
    record["note"] = values.note;

    if (isEditAttachmentsEnabled) {
      record["attachments"] = values.attachments;
    }

    if (isEditPostedAtEditable) {
      const originalPostedAt: Date | undefined = (original as NoteRecord)
        .postedAt;

      if (values.postedAt) {
        if (
          !originalPostedAt ||
          OneUptimeDate.fromString(originalPostedAt).getTime() !==
            values.postedAt.getTime()
        ) {
          record["postedAt"] = values.postedAt;
        }
      } else if (originalPostedAt) {
        // "Use the current time" on an existing note moves it to now.
        record["postedAt"] = OneUptimeDate.getCurrentDate();
      }
    }

    await ModelAPI.createOrUpdate<TNote>({
      model: note,
      modelType: props.modelType,
      formType: FormType.Update,
      miscDataProps:
        canNotifyAboutEdit && values.shouldNotify
          ? SubscriberUpdateNotification.getMiscDataProps()
          : {},
    });

    setEditingNoteId(null);
    await refresh();
  };

  const deleteNote: (note: TNote) => Promise<void> = async (
    note: TNote,
  ): Promise<void> => {
    const noteId: string | null = getNoteId(note as NoteRecord);

    if (!noteId) {
      return;
    }

    await ModelAPI.deleteItem<TNote>({
      modelType: props.modelType,
      id: new ObjectID(noteId),
    });

    if (editingNoteId === noteId) {
      setEditingNoteId(null);
    }

    await refresh();
  };

  const resendNotification: (
    note: TNote,
    kind: "posted" | "update",
  ) => Promise<void> = async (
    note: TNote,
    kind: "posted" | "update",
  ): Promise<void> => {
    const noteId: string | null = getNoteId(note as NoteRecord);

    if (!noteId) {
      return;
    }

    try {
      await ModelAPI.updateById({
        modelType: props.modelType,
        id: new ObjectID(noteId),
        data:
          kind === "posted"
            ? {
                subscriberNotificationStatusOnNoteCreated:
                  StatusPageSubscriberNotificationStatus.Pending,
                subscriberNotificationStatusMessage: null,
              }
            : {
                subscriberNotificationStatusOnNoteUpdated:
                  StatusPageSubscriberNotificationStatus.Pending,
                subscriberNotificationStatusMessageOnNoteUpdated:
                  SubscriberUpdateNotification.resendQueuedMessage,
              },
      });
    } catch (err) {
      throw new Error(API.getFriendlyMessage(err));
    }

    await refresh();
  };

  const updateNotifyOption: NotifyOption | undefined = canNotifyAboutEdit
    ? {
        title: SubscriberUpdateNotification.formFieldTitle,
        checkedDescription:
          "Subscribers will receive the edited note, marked as an update.",
        uncheckedDescription:
          "Leave this unticked for small fixes such as typos.",
      }
    : undefined;

  const openComposer: () => void = (): void => {
    setIsComposerOpen(true);
  };

  const now: Date = OneUptimeDate.getCurrentDate();
  const groups: Array<NoteDayGroup<TNote>> = groupNotesByDay<TNote>({
    notes,
    getDate: (note: TNote) => {
      return getNoteTimestamp(note as NoteRecord, props.visibility);
    },
    now,
  });

  const hasMore: boolean = notes.length < totalCount;
  const isSearching: boolean = searchText.length > 0;
  const audienceStyle: { icon: IconProp } = AUDIENCE_STYLES[props.visibility];

  const getFeedBody: () => ReactElement = (): ReactElement => {
    if (isLoading) {
      return (
        <div className="space-y-6" data-testid="notes-loading" aria-busy="true">
          {[0, 1, 2].map((index: number) => {
            return (
              <div key={index} className="flex animate-pulse gap-3">
                <div className="h-9 w-9 rounded-full bg-gray-100" />
                <div className="flex-1 space-y-2 rounded-lg border border-gray-100 p-4">
                  <div className="h-3 w-40 rounded bg-gray-100" />
                  <div className="h-3 w-full rounded bg-gray-100" />
                  <div className="h-3 w-2/3 rounded bg-gray-100" />
                </div>
              </div>
            );
          })}
        </div>
      );
    }

    if (loadError) {
      return (
        <div
          role="alert"
          className="flex flex-col items-center px-4 py-10 text-center"
          data-testid="notes-error"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-full bg-red-50">
            <Icon icon={IconProp.Error} className="h-5 w-5 text-red-500" />
          </span>
          <p className="mt-3 text-sm font-medium text-gray-900">
            {tx("Notes could not be loaded")}
          </p>
          <p className="mt-1 max-w-md text-sm text-gray-500">{loadError}</p>
          <button
            type="button"
            className="mt-4 inline-flex h-9 items-center gap-2 rounded-md border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
            onClick={() => {
              fetchNotes({ mode: "initial" });
            }}
          >
            <Icon icon={IconProp.Refresh} className="h-4 w-4" />
            {tx("Try again")}
          </button>
        </div>
      );
    }

    if (notes.length === 0 && isSearching) {
      return (
        <div
          className="px-4 py-10 text-center"
          data-testid="notes-search-empty"
        >
          <p className="text-sm font-medium text-gray-900">
            {tx("No notes match your search")}
          </p>
          <p className="mt-1 text-sm text-gray-500">
            {tx("Try different words, or clear the search to see every note.")}
          </p>
          <button
            type="button"
            className="mt-3 text-sm font-medium text-indigo-600 hover:text-indigo-500"
            onClick={() => {
              setSearchInput("");
              setSearchText("");
            }}
          >
            {tx("Clear search")}
          </button>
        </div>
      );
    }

    if (notes.length === 0) {
      return (
        <div
          className="flex flex-col items-center px-4 py-12 text-center"
          data-testid="notes-empty"
        >
          <span
            className={`flex h-12 w-12 items-center justify-center rounded-full ring-8 ${
              isPublic
                ? "bg-sky-50 text-sky-600 ring-sky-50/50"
                : "bg-amber-50 text-amber-600 ring-amber-50/50"
            }`}
          >
            <Icon icon={audienceStyle.icon} className="h-6 w-6" />
          </span>
          <h3 className="mt-4 text-base font-semibold text-gray-900">
            {tx(copy.emptyTitle)}
          </h3>
          <p className="mt-1 max-w-md text-sm text-gray-500">
            {tx(copy.emptyDescription)}
          </p>
          {createGate.isAllowed && !isComposerOpen && (
            <button
              type="button"
              onClick={openComposer}
              data-testid="notes-empty-cta"
              className="mt-5 inline-flex h-9 items-center gap-2 rounded-md bg-indigo-600 px-3.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
            >
              <Icon icon={IconProp.Add} className="h-4 w-4" />
              {isPublic
                ? tx("Post the first update")
                : tx("Write the first note")}
            </button>
          )}
        </div>
      );
    }

    return (
      <div className="space-y-8">
        {groups.map((group: NoteDayGroup<TNote>, groupIndex: number) => {
          return (
            <section
              key={`${group.key}-${groupIndex}`}
              aria-label={tx(group.label)}
              data-testid="notes-day"
            >
              <h3 className="mb-4 flex items-center gap-3 text-xs font-semibold uppercase tracking-wide text-gray-500">
                <span>{tx(group.label)}</span>
                <span className="h-px flex-1 bg-gray-100" />
                <span className="font-medium normal-case tracking-normal text-gray-400">
                  {translator.translatePlural(
                    { one: "{{count}} note", other: "{{count}} notes" },
                    group.notes.length,
                  )}
                </span>
              </h3>
              <ol className="relative">
                {group.notes.map((note: TNote, noteIndex: number) => {
                  const noteId: string | null = getNoteId(note as NoteRecord);

                  return (
                    <NoteCard
                      key={noteId || `${group.key}-${noteIndex}`}
                      note={note as NoteRecord}
                      visibility={props.visibility}
                      copy={copy}
                      now={now}
                      isLastInFeed={noteIndex === group.notes.length - 1}
                      attachmentApiPath={props.attachmentApiPath}
                      editGate={editGate}
                      deleteGate={deleteGate}
                      isEditing={Boolean(noteId) && editingNoteId === noteId}
                      onStartEdit={() => {
                        setEditingNoteId(noteId);
                      }}
                      onCancelEdit={() => {
                        setEditingNoteId(null);
                      }}
                      onSaveEdit={(values: NoteComposerValues) => {
                        return saveEdit(note, values);
                      }}
                      onDelete={() => {
                        return deleteNote(note);
                      }}
                      onRetryPostedNotification={
                        canResendPostedNotification
                          ? () => {
                              return resendNotification(note, "posted");
                            }
                          : undefined
                      }
                      onRetryUpdateNotification={
                        canResendUpdateNotification
                          ? () => {
                              return resendNotification(note, "update");
                            }
                          : undefined
                      }
                      postedNotificationResendConfirmation={
                        postedNotificationResendConfirmation
                      }
                      isPostedAtEditable={
                        isEditPostedAtEditable &&
                        Boolean((note as NoteRecord).postedAt)
                      }
                      updateNotifyOption={updateNotifyOption}
                    />
                  );
                })}
              </ol>
            </section>
          );
        })}

        {hasMore && (
          <div className="flex justify-center">
            <button
              type="button"
              data-testid="notes-load-more"
              disabled={isLoadingMore}
              onClick={() => {
                fetchNotes({ mode: "more" });
              }}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-gray-300 bg-white px-3.5 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 disabled:opacity-60"
            >
              {isLoadingMore && (
                <Icon
                  icon={IconProp.Spinner}
                  className="h-4 w-4 animate-spin"
                />
              )}
              {sortOrder === "newest"
                ? tx("Show older notes")
                : tx("Show newer notes")}
              <span className="text-gray-400">
                {translator.translatePlural(
                  { one: "({{count}} more)", other: "({{count}} more)" },
                  totalCount - notes.length,
                )}
              </span>
            </button>
          </div>
        )}
      </div>
    );
  };

  const showToolbar: boolean =
    !isLoading &&
    !loadError &&
    (notes.length > 0 || isSearching || searchInput.length > 0);

  return (
    <div className="space-y-4" data-testid="event-notes">
      <section
        className="rounded-xl border border-gray-200 bg-white px-4 py-4 shadow-sm sm:px-5"
        data-testid="notes-header"
      >
        <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
          <div className="flex min-w-0 items-start gap-3">
            <span
              className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-lg ${
                isPublic
                  ? "bg-sky-50 text-sky-600"
                  : "bg-amber-50 text-amber-600"
              }`}
            >
              <Icon icon={audienceStyle.icon} className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <h2 className="text-lg font-semibold leading-tight text-gray-900">
                {tx(copy.title)}
                {!isLoading && !loadError && totalCount > 0 && !isSearching && (
                  <span
                    className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 align-middle text-xs font-semibold text-gray-600"
                    data-testid="notes-count"
                  >
                    {totalCount}
                  </span>
                )}
              </h2>
              <p className="mt-1 max-w-2xl text-sm text-gray-500">
                {tx(copy.description)}
              </p>
            </div>
          </div>
          {/*
            Under the description below lg, at the right edge, as a card
            header's actions always are; beside the title from lg up.
          */}
          <div className="flex shrink-0 items-center gap-2 self-end lg:self-auto">
            {props.siblingRoute && (
              <NotesVisibilitySwitch
                current={props.visibility}
                siblingRoute={props.siblingRoute}
              />
            )}
            <button
              type="button"
              data-testid="notes-refresh"
              title={tx("Refresh notes")}
              aria-label={tx("Refresh notes")}
              disabled={isLoading || isRefreshing}
              onClick={() => {
                refresh();
              }}
              className="inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-500 shadow-sm transition hover:bg-gray-50 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 disabled:opacity-60"
            >
              <Icon
                icon={IconProp.Refresh}
                className={`h-4 w-4 ${isRefreshing ? "animate-spin" : ""}`}
              />
            </button>
          </div>
        </div>
      </section>

      <EventNoteComposer<TNote>
        kind={props}
        projectId={
          props.currentProject?._id
            ? new ObjectID(props.currentProject._id)
            : null
        }
        presentation={{
          type: "inline",
          isOpen: isComposerOpen,
          onOpenChange: setIsComposerOpen,
        }}
        onPosted={refresh}
      />

      {actionError && (
        <div
          role="alert"
          className="flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800"
          data-testid="notes-action-error"
        >
          <span>{actionError}</span>
          <button
            type="button"
            className="font-medium text-red-700 hover:text-red-900"
            onClick={() => {
              setActionError("");
            }}
          >
            {tx("Dismiss")}
          </button>
        </div>
      )}

      <section
        className="rounded-xl border border-gray-200 bg-white shadow-sm"
        data-testid="notes-feed"
        aria-live="polite"
      >
        {showToolbar && (
          <div className="flex flex-col gap-2 border-b border-gray-100 px-4 py-3 sm:flex-row sm:items-center sm:px-5">
            <label className="relative flex min-w-0 flex-1 items-center">
              <span className="sr-only">{tx("Search notes")}</span>
              <Icon
                icon={IconProp.Search}
                className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400"
              />
              <input
                type="search"
                data-testid="notes-search"
                value={searchInput}
                placeholder={tx("Search notes…")}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                  setSearchInput(event.target.value);
                }}
                className="block w-full rounded-md border border-gray-200 bg-gray-50 py-1.5 pl-8 pr-3 text-sm text-gray-900 placeholder-gray-400 transition focus:border-indigo-500 focus:bg-white focus:outline-none focus:ring-1 focus:ring-indigo-500"
              />
            </label>
            <div className="flex items-center justify-between gap-3 sm:justify-end">
              <span
                className="text-xs text-gray-500"
                data-testid="notes-summary"
              >
                {isSearching
                  ? translator.translatePlural(
                      { one: "{{count}} match", other: "{{count}} matches" },
                      totalCount,
                    )
                  : translator.translatePlural(
                      { one: "{{count}} note", other: "{{count}} notes" },
                      totalCount,
                    )}
              </span>
              <button
                type="button"
                data-testid="notes-sort"
                onClick={() => {
                  setSortOrder(sortOrder === "newest" ? "oldest" : "newest");
                }}
                className="inline-flex h-8 items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 text-sm font-medium text-gray-700 shadow-sm transition hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
              >
                <Icon
                  icon={
                    sortOrder === "newest"
                      ? IconProp.BarsArrowDown
                      : IconProp.BarsArrowUp
                  }
                  className="h-4 w-4 text-gray-400"
                />
                {sortOrder === "newest"
                  ? tx("Newest first")
                  : tx("Oldest first")}
              </button>
            </div>
          </div>
        )}
        <div className="px-4 py-5 sm:px-5">{getFeedBody()}</div>
      </section>
    </div>
  );
}

export default EventNotes;
