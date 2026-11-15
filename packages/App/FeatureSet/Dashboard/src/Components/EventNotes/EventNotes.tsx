import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import Project from "Common/Models/DatabaseModels/Project";
import { getHandDrawnButtonStateClassName } from "Common/UI/Components/Button/ButtonStates";
import Query from "Common/Types/BaseDatabase/Query";
import Select from "Common/Types/BaseDatabase/Select";
import Sort from "Common/Types/BaseDatabase/Sort";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ObjectID from "Common/Types/ObjectID";
import StatusPageSubscriberNotificationStatus from "Common/Types/StatusPage/StatusPageSubscriberNotificationStatus";
import SubscriberUpdateNotification from "Common/Types/StatusPage/SubscriberUpdateNotification";
import ErrorMessageText from "Common/UI/Components/ErrorMessage/ErrorMessageText";
import { FormType } from "Common/UI/Components/Forms/ModelForm";
import Icon from "Common/UI/Components/Icon/Icon";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import { HeldPermissions } from "Common/Types/HeldPermissions";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
  PermissionGateOptions,
} from "Common/UI/Utils/PermissionGate";
import { usePrivateRecordGateOptions } from "Common/UI/Utils/PrivateRecordScope";
import ProjectUtil from "Common/UI/Utils/Project";
import useTranslateValue from "Common/UI/Utils/Translation";
import User from "Common/UI/Utils/User";
import React, {
  ReactElement,
  useEffect,
  useLayoutEffect,
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
  getNoteSortField,
  getNoteTimestamp,
  groupNotesByDay,
  hasNotificationInFlight,
  isComposerOpenRequested,
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
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import { getPrivateEventPublicNotesCopy } from "./PrivateEventNotesCopy";
import usePublicNoteApproval, {
  UsePublicNoteApprovalResult,
} from "./PublicNoteApproval/usePublicNoteApproval";
import {
  approveNote,
  getNoteApprovalState,
  isNotePublished,
  rejectNote,
  resubmitNote,
  withdrawNoteEdit,
} from "./PublicNoteApproval/PublicNoteApprovalUtil";

/*
 * What the page hands the notes feed: the kind of note it shows, from the
 * event's NoteKinds module, and the project new notes are saved in.
 */
export interface ComponentProps<TNote extends BaseModel>
  extends EventNoteKind<TNote> {
  currentProject: Project | null;
}

/*
 * What a reader did that read the notes again, with the notes already on
 * screen: the refresh button (or the re-read after a write), a search, the
 * sort order, Load more. A failure of one keeps the notes and says so in a
 * banner over the feed.
 */
type NotesAction = "refresh" | "search" | "sort" | "more";

// The banner's first line: what failed.
const NOTES_ACTION_FAILED: Record<NotesAction, string> = {
  refresh: translationKey("Couldn't refresh the notes."),
  search: translationKey("Couldn't search the notes."),
  sort: translationKey("Couldn't sort the notes."),
  more: translationKey("Couldn't load more notes."),
};

interface NotesActionError {
  action: NotesAction;
  // API.getFriendlyMessage's answer.
  message: string;
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

  const model: TNote = useMemo(() => {
    return new props.modelType();
  }, [props.modelType]);

  const isPublic: boolean = props.visibility === "public";
  /*
   * A private incident's or episode's public notes: the ones it already
   * has, read and edited as any are, but no new ones - its composer says
   * why, with the way to its private notes - and nothing offered that
   * tells subscribers, whom a private event never reaches.
   */
  const isPrivateEvent: boolean = isPublic && Boolean(props.isPrivateEvent);
  /*
   * And nothing on the page says they are on a status page: the
   * description, the audience of a note being edited and what deleting one
   * does are a private event's own (getPrivateEventPublicNotesCopy).
   */
  const visibilityCopy: NotesCopy = getNotesCopy(
    props.visibility,
    props.eventNoun,
    translator,
  );
  const copy: NotesCopy = {
    ...(isPrivateEvent
      ? getPrivateEventPublicNotesCopy(
          visibilityCopy,
          props.eventNoun,
          translator,
        )
      : visibilityCopy),
    // The kind's own words for what its notes are for, where it has them.
    ...(props.description ? { description: props.description } : {}),
  };
  /*
   * What the viewer holds, blocks included - on a private record's page,
   * what they hold on the record: its notes are written, changed and
   * removed only by a team of theirs that owns it (PrivateRecordScope).
   */
  const privateRecordOptions: PermissionGateOptions | undefined =
    usePrivateRecordGateOptions(model);
  const heldPermissions: HeldPermissions =
    PermissionGate.getHeldPermissions(privateRecordOptions);
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
        held: heldPermissions,
        isMasterAdmin,
      })
    );
  };

  const hasAttachments: boolean = Boolean(props.attachmentApiPath);
  const createGate: PermissionGateResult = PermissionGate.check(
    model,
    ModelAction.Create,
    privateRecordOptions,
  );
  const editGate: NoteActionGate = toActionGate(
    PermissionGate.check(model, ModelAction.Update, privateRecordOptions),
  );
  const deleteGate: NoteActionGate = toActionGate(
    PermissionGate.check(model, ModelAction.Delete, privateRecordOptions),
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
    !isPrivateEvent &&
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
    !isPrivateEvent &&
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
  const [actionError, setActionError] = useState<NotesActionError | null>(null);
  const [searchInput, setSearchInput] = useState<string>("");
  // The search the reader asked for: the box's words, once typing stops.
  const [searchText, setSearchText] = useState<string>("");
  /*
   * The search and the order the notes on screen were read for, which the
   * toolbar describes: its count of notes or of matches, and the sort
   * button. A search or an order the reader asks for is taken up when its
   * notes arrive. They were set as the reader asked, before the read, and a
   * read that failed left the toolbar describing notes that were not on
   * screen: the sort button named the order it had failed to read in -
   * pressing it again read the order on screen, instead of trying again -
   * and a search that never ran counted its matches.
   */
  const [shownSearchText, setShownSearchText] = useState<string>("");
  const [sortOrder, setSortOrder] = useState<NoteSortOrder>("newest");
  const [editingNoteId, setEditingNoteId] = useState<string | null>(null);

  /*
   * Whether the composer is open or folded to its prompt. Kept here, not in
   * the composer, so the empty feed's "Post the first update" can open it -
   * and a page opened to write a note (?compose=1, where "Add Private Note"
   * on a private incident's public notes leads) starts with it open.
   */
  const [isComposerOpen, setIsComposerOpen] = useState<boolean>(() => {
    return isComposerOpenRequested(window.location.search);
  });

  /*
   * Every fetch takes a number and drops its answer if a newer one started,
   * so a slow page of results can never overwrite a newer search or refresh.
   */
  const fetchGeneration: React.MutableRefObject<number> = useRef<number>(0);
  const loadedCount: React.MutableRefObject<number> = useRef<number>(0);
  loadedCount.current = notes.length;
  // The banner on screen, for a read that answers while it is up.
  const shownActionError: React.MutableRefObject<NotesActionError | null> =
    useRef<NotesActionError | null>(null);
  shownActionError.current = actionError;
  /*
   * The order the sort button asked for, until a read answers: a read from
   * the top started meanwhile - a search, the refresh after a note is
   * posted - reads in it too, so the sort is not lost to it. A read that
   * fails drops it, as the button never took it up: the button names the
   * order on screen, and pressing it asks for the other one again.
   */
  const askedSortOrder: React.MutableRefObject<NoteSortOrder | null> =
    useRef<NoteSortOrder | null>(null);

  // The feed's body, and its Try again while a failed load is drawn.
  const feedBodyRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const tryAgainButtonRef: React.RefObject<HTMLButtonElement> =
    useRef<HTMLButtonElement>(null);
  // The banner of a failed action, Load more, and the refresh button.
  const actionErrorRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const loadMoreButtonRef: React.RefObject<HTMLButtonElement> =
    useRef<HTMLButtonElement>(null);
  const refreshButtonRef: React.RefObject<HTMLButtonElement> =
    useRef<HTMLButtonElement>(null);

  const select: JSONObject = useMemo(() => {
    return buildNotesSelect({
      model,
      visibility: props.visibility,
      isAttachmentsEnabled: hasAttachments,
      held: heldPermissions,
      isMasterAdmin,
    });
  }, [
    model,
    props.visibility,
    hasAttachments,
    isMasterAdmin,
    heldPermissions.allowed.join(","),
    heldPermissions.blocked.join(","),
  ]);

  // The time each note is filed under (getNoteTimestamp), as the server sorts.
  const timestampField: string = getNoteSortField(model);

  /*
   * Public note approval (PublicNoteApproval): who approves this kind of
   * note, and where each note on the page stands. Nothing is read for a
   * kind without approval.
   */
  const approvalApiPath: string | undefined = isPublic
    ? props.approval?.apiPath
    : undefined;
  const approval: UsePublicNoteApprovalResult = usePublicNoteApproval({
    apiPath: approvalApiPath,
    notes: notes as Array<NoteRecord>,
  });
  const isApprovalRequired: boolean = Boolean(approval.policy?.isRequired);

  /*
   * An edit of a published note waits for approval while the project asks
   * for it: its text waits, and its files cannot change then.
   */
  const isEditHeldForApproval: (note: TNote) => boolean = (
    note: TNote,
  ): boolean => {
    return (
      isApprovalRequired &&
      isNotePublished(getNoteApprovalState(note as NoteRecord))
    );
  };

  /*
   * The feed's body and the banner take the focus from script alone, for a
   * moment - while notes are read, or once Load more has failed - and are
   * focusable only while they hold it, as a list's box is (Table). The
   * feed's body was focusable for good: it took every click on a note's
   * words, and in Chromium the next Tab then started over at its top rather
   * than after what was clicked. Focusable at once, before what had the
   * focus is disabled or taken away.
   */
  const holdFocus: (element: HTMLElement, options?: FocusOptions) => void = (
    element: HTMLElement,
    options?: FocusOptions,
  ): void => {
    element.tabIndex = -1;
    element.focus(options);
  };

  /*
   * The focus moved on from the feed's body or the banner, which is not
   * focusable again until it next holds the focus. A window that loses the
   * focus keeps its focused element, to give the focus back to when it is
   * in front again: the element stays focusable then.
   */
  const letGoOfFocus: (event: React.FocusEvent<HTMLDivElement>) => void = (
    event: React.FocusEvent<HTMLDivElement>,
  ): void => {
    const element: HTMLDivElement = event.currentTarget;

    if (event.target === element && document.activeElement !== element) {
      element.removeAttribute("tabindex");
    }
  };

  /*
   * The banner goes away - dismissed, or ended by a read that answered -
   * and a focus left on it fell to the page: a keyboard or screen reader
   * user started over from its top. It goes back to where the reader was
   * instead: to Load more after Load more failed, so trying again is one
   * key away, and after the others to the feed's body, just before the
   * notes (the refresh button, when no feed is drawn). While Load more
   * reads once more, the feed's body holds it until the read is over
   * (below). A focus that was not on the banner is left where it is.
   */
  const moveFocusOffBanner: (action: NotesAction) => void = (
    action: NotesAction,
  ): void => {
    const banner: HTMLDivElement | null = actionErrorRef.current;

    if (!banner || !banner.contains(document.activeElement)) {
      return;
    }

    const loadMore: HTMLButtonElement | null = loadMoreButtonRef.current;
    const body: HTMLDivElement | null = feedBodyRef.current;

    if (action === "more" && loadMore && !loadMore.disabled) {
      loadMore.focus();
    } else if (body) {
      holdFocus(body);
    } else {
      refreshButtonRef.current?.focus();
    }
  };

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
    // What a replace is for - a new search, or the other sort order.
    replacing?: "search" | "sort" | undefined;
  }) => Promise<void>;

  const fetchNotes: FetchNotesFunction = async (options: {
    mode: FetchMode;
    limit?: number | undefined;
    replacing?: "search" | "sort" | undefined;
  }): Promise<void> => {
    const generation: number = ++fetchGeneration.current;
    const skip: number = options.mode === "more" ? loadedCount.current : 0;
    const limit: number = options.limit || NOTES_PAGE_SIZE;
    /*
     * Load more and the background re-read go on with the notes on screen,
     * for their search and in their order: a page of other notes would be
     * added to them, or put in their place unasked. Every other read starts
     * from the top, for the search in the box - after a search failed, the
     * refresh button tries it again - and in the order the sort button
     * asked for, while that is on its way.
     */
    const isOnScreen: boolean =
      options.mode === "more" || options.mode === "silent";
    const readSearchText: string = isOnScreen ? shownSearchText : searchText;
    const readSortOrder: NoteSortOrder = isOnScreen
      ? sortOrder
      : askedSortOrder.current || sortOrder;

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
          searchText: readSearchText,
        }) as Query<TNote>,
        select: select as Select<TNote>,
        sort: {
          [timestampField]:
            readSortOrder === "newest"
              ? SortOrder.Descending
              : SortOrder.Ascending,
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
      // What they were read for is the notes' own now, and the toolbar's.
      setShownSearchText(readSearchText);
      setSortOrder(readSortOrder);
      askedSortOrder.current = null;

      /*
       * A read the reader started that answers ends the banner of a
       * failure before it. The banner holds one failure, the latest - a new
       * one takes the place of the last - so it answers the reader's latest
       * read, and left up it said a read had failed over notes a later one
       * had just brought. A read from the top brings the notes the reader
       * asks for now: the search in the box, in the order asked for. Load
       * more brings the next page of the notes on screen alone, so it ends
       * a Load more's banner alone: after it, a refresh, search or sort that
       * failed has still not been done. The background re-read ends none:
       * the reader asked for nothing, and the banner would go before they
       * had read it.
       */
      const banner: NotesActionError | null = shownActionError.current;

      if (
        banner &&
        options.mode !== "silent" &&
        (options.mode !== "more" || banner.action === "more")
      ) {
        moveFocusOffBanner(banner.action);
        setActionError(null);
      }
    } catch (err) {
      if (generation !== fetchGeneration.current) {
        return;
      }

      askedSortOrder.current = null;

      if (options.mode === "initial") {
        setLoadError(API.getFriendlyMessage(err));
      } else if (options.mode !== "silent") {
        setActionError({
          action:
            options.mode === "more"
              ? "more"
              : options.mode === "replace"
                ? options.replacing || "search"
                : "refresh",
          message: API.getFriendlyMessage(err),
        });
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

  /*
   * Try again gives way to the loading skeleton, which holds nothing to
   * focus: a focus left on it fell to the page, and the next Tab started
   * again from the top of the page. The feed's body holds it instead while
   * the notes load again - once they are drawn, the next Tab reaches the
   * first of them - and hands it back to Try again if they fail once more
   * (below). A focus that was not in the feed is left where it is.
   */
  const tryAgain: () => void = (): void => {
    const body: HTMLDivElement | null = feedBodyRef.current;

    if (body && body.contains(document.activeElement)) {
      holdFocus(body);
    }

    fetchNotes({ mode: "initial" });
  };

  /*
   * Load more is disabled while it reads, and a focus on it fell to the
   * page - in Firefox as soon as it was disabled, and in every browser once
   * the last page took Load more away - and the next Tab started over at
   * the top of the page. The feed's body holds the focus while the next
   * page is read, with the page left where it is (the reader is at the
   * feed's foot), and hands it on as the read ends (below). A focus that was
   * not on Load more is left where it is.
   */
  const loadMoreNotes: () => void = (): void => {
    const button: HTMLButtonElement | null = loadMoreButtonRef.current;
    const body: HTMLDivElement | null = feedBodyRef.current;

    if (button && body && document.activeElement === button) {
      holdFocus(body, { preventScroll: true });
    }

    fetchNotes({ mode: "more" });
  };

  /*
   * The notes failed to load once more while the feed's body held the
   * focus: it goes back to Try again - not to the copy button of the
   * reference the explanation above it may hold - so trying once more is
   * one key away. A layout effect, so it runs as the failure is drawn: a
   * passive one can wait for the next task on a busy page, and run only
   * after the next press of Try again has given the focus to the feed's
   * body - then it put the focus on the Try again that press was taking
   * away, and the focus fell to the page.
   */
  useLayoutEffect(() => {
    const body: HTMLDivElement | null = feedBodyRef.current;

    if (isLoading || !loadError || !body || document.activeElement !== body) {
      return;
    }

    tryAgainButtonRef.current?.focus();
  }, [isLoading, loadError]);

  /*
   * Load more's read is over with the focus on the feed's body, where Load
   * more (loadMoreNotes) or a Dismiss meanwhile put it: it goes to the
   * banner if the read failed, which comes into view to say what failed
   * and why (its Dismiss puts the focus back on Load more); back to Load
   * more when more notes are left, so the next page is one key away, with
   * the page left on the notes that came; and it stays on the feed's body,
   * just before the notes, once the last page has taken Load more away. A
   * layout effect, so it moves as the notes or the failure are drawn.
   */
  useLayoutEffect(() => {
    const body: HTMLDivElement | null = feedBodyRef.current;

    if (isLoadingMore || !body || document.activeElement !== body) {
      return;
    }

    const banner: HTMLDivElement | null = actionErrorRef.current;
    const loadMore: HTMLButtonElement | null = loadMoreButtonRef.current;

    if (banner && actionError?.action === "more") {
      holdFocus(banner);
    } else if (loadMore && !loadMore.disabled) {
      loadMore.focus({ preventScroll: true });
    }
  }, [isLoadingMore]);

  // Dismiss takes the banner away, moving a focus on it first.
  const dismissActionError: () => void = (): void => {
    if (actionError) {
      moveFocusOffBanner(actionError.action);
    }

    setActionError(null);
  };

  /*
   * The sort button names the order of the notes on screen, and asks for
   * the other one: after a sort failed, the one that failed, so pressing it
   * again tries it again. It names the new order once the notes come in it.
   */
  const sortTheOtherWay: () => void = (): void => {
    askedSortOrder.current = sortOrder === "newest" ? "oldest" : "newest";

    fetchNotes({ mode: "replace", replacing: "sort" });
  };

  const hasFetchedOnce: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  // The first read, then a search's, once typing stops (below).
  useEffect(() => {
    fetchNotes({
      mode: hasFetchedOnce.current ? "replace" : "initial",
      replacing: "search",
    });
    hasFetchedOnce.current = true;
  }, [searchText]);

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

    // A published note's files stay while its edits wait for approval.
    if (isEditAttachmentsEnabled && !isEditHeldForApproval(original)) {
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

  /*
   * A decision, a note sent again or an edit withdrawn: the server decides
   * (PublicNoteApprovalRoutes), and the feed reads the notes again.
   */
  const runApprovalAction: (
    action: (data: { apiPath: string; noteId: string }) => Promise<void>,
    note: TNote,
  ) => Promise<void> = async (
    action: (data: { apiPath: string; noteId: string }) => Promise<void>,
    note: TNote,
  ): Promise<void> => {
    const noteId: string | null = getNoteId(note as NoteRecord);

    if (!noteId || !approvalApiPath) {
      return;
    }

    await action({ apiPath: approvalApiPath, noteId });
    await refresh();
    await approval.refresh();
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
  // The notes on screen are a search's matches.
  const isSearching: boolean = shownSearchText.length > 0;
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
          {/*
           * Read as a list's failure reads (ErrorMessageText): an error
           * nobody explained says why and what to do next, with the
           * reference to give when the server failed (#6836); any other is
           * in the reader's language, read the way it is written. The
           * heading above says what failed, so the explanation does not say
           * it again, and the reference's row is centred as the lines around
           * it are. It was the message as API.getFriendlyMessage words it:
           * English on every page, and on a Persian one with its full stop
           * at its start.
           */}
          <p className="mt-1 max-w-md text-sm text-gray-500">
            <ErrorMessageText
              message={loadError}
              hideWhatFailed={true}
              isCentered={true}
            />
          </p>
          <button
            ref={tryAgainButtonRef}
            type="button"
            className="mt-4 inline-flex h-9 items-center gap-2 rounded-md border border-gray-300 bg-white px-3 text-sm font-medium text-gray-700 shadow-sm hover:bg-gray-50"
            onClick={() => {
              tryAgain();
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

              if (searchText) {
                setSearchText("");
              } else {
                /*
                 * The search was cleared already, and that read failed:
                 * with nothing in the box to change, the notes are read
                 * again from here.
                 */
                fetchNotes({ mode: "replace", replacing: "search" });
              }
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
          {createGate.isAllowed && !isComposerOpen && !isPrivateEvent && (
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
                      approval={
                        approvalApiPath
                          ? {
                              state: getNoteApprovalState(note as NoteRecord),
                              summary: noteId
                                ? approval.summaries[noteId]
                                : undefined,
                              isRequired: isApprovalRequired,
                              isEditHeld: isEditHeldForApproval(note),
                              canEdit: editGate.isShown && !editGate.isDisabled,
                              onApprove: () => {
                                return runApprovalAction(approveNote, note);
                              },
                              onReject: (reason: string) => {
                                return runApprovalAction(
                                  (data: {
                                    apiPath: string;
                                    noteId: string;
                                  }): Promise<void> => {
                                    return rejectNote({ ...data, reason });
                                  },
                                  note,
                                );
                              },
                              onResubmit: () => {
                                return runApprovalAction(resubmitNote, note);
                              },
                              onWithdrawEdit: () => {
                                return runApprovalAction(
                                  withdrawNoteEdit,
                                  note,
                                );
                              },
                            }
                          : undefined
                      }
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
              ref={loadMoreButtonRef}
              type="button"
              data-testid="notes-load-more"
              disabled={isLoadingMore}
              onClick={() => {
                loadMoreNotes();
              }}
              className={`inline-flex h-9 items-center gap-2 rounded-md border border-gray-300 bg-white px-3.5 text-sm font-medium text-gray-700 shadow-sm transition ${getHandDrawnButtonStateClassName(
                { isBusy: isLoadingMore, hoverClassName: "hover:bg-gray-50" },
              )}`}
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

  /*
   * A private event with no public notes has nothing to list: the composer's
   * place already says why it takes none, so no empty feed is drawn under it.
   */
  const showFeed: boolean = !(
    isPrivateEvent &&
    !isLoading &&
    !loadError &&
    notes.length === 0 &&
    !isSearching &&
    searchInput.length === 0
  );

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
                    {/*
                     * In the reader's digits, as every count the feed draws
                     * is: a Persian page drew a Latin "2" here, and
                     * "۲ یادداشت" over its notes.
                     */}
                    {translator.formatNumber(totalCount)}
                  </span>
                )}
              </h2>
              <p
                className="mt-1 max-w-2xl text-sm text-gray-500"
                data-testid="notes-description"
              >
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
              ref={refreshButtonRef}
              type="button"
              data-testid="notes-refresh"
              title={tx("Refresh notes")}
              aria-label={tx("Refresh notes")}
              disabled={isLoading || isRefreshing}
              onClick={() => {
                refresh();
              }}
              className={`inline-flex h-8 w-8 items-center justify-center rounded-md border border-gray-200 bg-white text-gray-500 shadow-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${getHandDrawnButtonStateClassName(
                {
                  isLocked: isLoading,
                  isBusy: isRefreshing,
                  hoverClassName: "hover:bg-gray-50 hover:text-gray-700",
                },
              )}`}
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
        onPosted={async () => {
          await refresh();
          await approval.refresh();
        }}
      />

      {/*
       * Focusable from script alone, without a ring, and only while it holds
       * the focus a failed Load more gives it (holdFocus).
       */}
      {actionError && (
        <div
          ref={actionErrorRef}
          role="alert"
          className="flex items-start justify-between gap-3 rounded-lg border border-red-200 bg-red-50 px-4 py-2.5 text-sm text-red-800 focus:outline-none"
          data-testid="notes-action-error"
          onBlur={letGoOfFocus}
        >
          {/*
           * What failed, then the error's words as the load failure's read
           * (ErrorMessageText): an error nobody explained says why and what
           * to do next, with the reference to give when the server failed
           * (#6836); any other is in the reader's language, read the way it
           * is written. It was the message as API.getFriendlyMessage words
           * it, and nothing else: English on every page, on a Persian one
           * with its full stop at its start, and silent on which of the
           * refresh, a search, the sort order or Load more had failed.
           */}
          <div className="min-w-0">
            <p
              className="font-medium"
              data-testid="notes-action-error-what-failed"
            >
              {tx(NOTES_ACTION_FAILED[actionError.action])}
            </p>
            <p data-testid="notes-action-error-words">
              <ErrorMessageText
                message={actionError.message}
                hideWhatFailed={true}
              />
            </p>
          </div>
          {/*
           * On one line beside the words, however long they are: a Persian
           * "Dismiss" is two words, which the banner's text broke apart.
           */}
          <button
            type="button"
            className="shrink-0 whitespace-nowrap font-medium text-red-700 hover:text-red-900"
            onClick={() => {
              dismissActionError();
            }}
          >
            {tx("Dismiss")}
          </button>
        </div>
      )}

      {showFeed && (
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
                    sortTheOtherWay();
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
          {/*
           * Focusable from script alone, without a ring, and only while it
           * holds the focus (holdFocus): while Try again reads the notes
           * again (tryAgain) and Load more the next page (loadMoreNotes), and
           * from a banner Dismiss takes away (dismissActionError).
           */}
          <div
            ref={feedBodyRef}
            className="px-4 py-5 focus:outline-none sm:px-5"
            data-testid="notes-feed-body"
            onBlur={letGoOfFocus}
          >
            {getFeedBody()}
          </div>
        </section>
      )}
    </div>
  );
}

export default EventNotes;
