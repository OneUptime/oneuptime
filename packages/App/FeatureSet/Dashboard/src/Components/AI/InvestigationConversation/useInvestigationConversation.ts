import AIChatPermissionMode from "Common/Types/AI/AIChatPermissionMode";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import { JSONObject } from "Common/Types/JSON";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import LocalStorage from "Common/UI/Utils/LocalStorage";
import User from "Common/UI/Utils/User";
import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  EMPTY_THREAD_VIEW,
  InvestigationConversationSubjectType,
  THREAD_PERMISSION_MODE_STORAGE_KEY,
  THREAD_POLL_BUSY_MS,
  THREAD_POLL_HIDDEN_MS,
  THREAD_POLL_IDLE_MS,
  ThreadMessage,
  ThreadView,
  buildOptimisticQuestion,
  getThreadSignature,
  isThreadBusy,
  parseStoredPermissionMode,
  parseThreadView,
} from "./InvestigationConversationData";

export interface ThreadDecision {
  toolCallId: string;
  approved: boolean;
}

export interface UseInvestigationConversation {
  // The thread, with the viewer's just-sent question shown until it lands.
  view: ThreadView;
  hasLoaded: boolean;
  loadError: string | null;
  input: string;
  setInput: (value: string) => void;
  isSending: boolean;
  actionError: string | null;
  clearActionError: () => void;
  isSubmittingApproval: boolean;
  isCancelling: boolean;
  permissionMode: AIChatPermissionMode;
  setPermissionMode: (mode: AIChatPermissionMode) => void;
  sendMessage: (contentOverride?: string) => Promise<void>;
  respondToApproval: (
    assistantMessageId: string,
    decisions: Array<ThreadDecision>,
  ) => Promise<void>;
  cancel: () => Promise<void>;
  refresh: () => Promise<void>;
}

function readStoredPermissionMode(): AIChatPermissionMode {
  try {
    const stored: unknown = LocalStorage.getItem(
      THREAD_PERMISSION_MODE_STORAGE_KEY,
    );
    return parseStoredPermissionMode(
      typeof stored === "string" ? stored : undefined,
    );
  } catch {
    return parseStoredPermissionMode(undefined);
  }
}

function getViewerName(): string {
  try {
    return User.getName().toString().trim() || "You";
  } catch {
    return "You";
  }
}

function getViewerUserId(): string | null {
  try {
    return User.getUserId().toString() || null;
  } catch {
    return null;
  }
}

function isDocumentHidden(): boolean {
  return typeof document !== "undefined" && document.hidden === true;
}

/*
 * The investigation box's conversation as a headless hook: it reads the
 * shared thread, keeps it fresh (quickly while an answer is being written,
 * slowly when idle so other responders' questions still show up, and
 * rarely in a background tab), and sends questions, approvals and stops.
 * Every response is checked against the subject it was asked for, so a
 * page that moved to another incident never shows the previous thread.
 */
export default function useInvestigationConversation(options: {
  subjectType: InvestigationConversationSubjectType;
  subjectId: string;
}): UseInvestigationConversation {
  const { subjectType, subjectId } = options;
  const subjectKey: string = `${subjectType}:${subjectId}`;

  const [serverView, setServerView] = useState<ThreadView>(EMPTY_THREAD_VIEW);
  const [hasLoaded, setHasLoaded] = useState<boolean>(false);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [input, setInput] = useState<string>("");
  const [isSending, setIsSending] = useState<boolean>(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [isSubmittingApproval, setIsSubmittingApproval] =
    useState<boolean>(false);
  const [isCancelling, setIsCancelling] = useState<boolean>(false);
  const [pendingQuestion, setPendingQuestion] = useState<ThreadMessage | null>(
    null,
  );
  const [permissionMode, setPermissionModeState] =
    useState<AIChatPermissionMode>(readStoredPermissionMode);

  const subjectKeyRef: React.MutableRefObject<string> =
    useRef<string>(subjectKey);
  subjectKeyRef.current = subjectKey;

  const signatureRef: React.MutableRefObject<string> = useRef<string>("");
  const requestCounterRef: React.MutableRefObject<number> = useRef<number>(0);
  const isMountedRef: React.MutableRefObject<boolean> = useRef<boolean>(true);
  const busyRef: React.MutableRefObject<boolean> = useRef<boolean>(false);

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
    };
  }, []);

  const post: (
    path: string,
    data: JSONObject,
  ) => Promise<JSONObject> = useCallback(
    async (path: string, data: JSONObject): Promise<JSONObject> => {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: URL.fromString(`${APP_API_URL.toString()}${path}`),
          data: { subjectType, subjectId, ...data },
          headers: ModelAPI.getCommonHeaders(),
        });

      if (response instanceof HTTPErrorResponse) {
        throw response;
      }

      return (response.data || {}) as JSONObject;
    },
    [subjectType, subjectId],
  );

  const refresh: () => Promise<void> = useCallback(async (): Promise<void> => {
    const requestId: number = requestCounterRef.current + 1;
    requestCounterRef.current = requestId;
    const requestedSubjectKey: string = subjectKey;

    const isCurrent: () => boolean = (): boolean => {
      return (
        isMountedRef.current &&
        requestCounterRef.current === requestId &&
        subjectKeyRef.current === requestedSubjectKey
      );
    };

    try {
      const json: JSONObject = await post("/ai-investigation/conversation", {});

      if (!isCurrent()) {
        return;
      }

      const next: ThreadView = parseThreadView(json);
      const signature: string = getThreadSignature(next);

      busyRef.current = isThreadBusy(next);

      if (signature !== signatureRef.current) {
        signatureRef.current = signature;
        setServerView(next);
      }

      setLoadError(null);
      setHasLoaded(true);
    } catch (error: unknown) {
      if (!isCurrent()) {
        return;
      }

      setLoadError(API.getFriendlyMessage(error));
      setHasLoaded(true);
    }
  }, [post, subjectKey]);

  // A new subject starts from a clean slate.
  useEffect(() => {
    signatureRef.current = "";
    busyRef.current = false;
    setServerView(EMPTY_THREAD_VIEW);
    setHasLoaded(false);
    setLoadError(null);
    setPendingQuestion(null);
    setActionError(null);
    setInput("");
  }, [subjectKey]);

  // The polling loop: one request at a time, paced by what is happening.
  useEffect(() => {
    let isActive: boolean = true;
    let timer: ReturnType<typeof setTimeout> | undefined = undefined;

    const tick: () => Promise<void> = async (): Promise<void> => {
      await refresh();

      if (!isActive) {
        return;
      }

      const delay: number = isDocumentHidden()
        ? THREAD_POLL_HIDDEN_MS
        : busyRef.current
          ? THREAD_POLL_BUSY_MS
          : THREAD_POLL_IDLE_MS;

      timer = setTimeout(() => {
        tick().catch(() => {
          // refresh handles its own errors
        });
      }, delay);
    };

    tick().catch(() => {
      // refresh handles its own errors
    });

    return () => {
      isActive = false;
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [refresh]);

  const setPermissionMode: (mode: AIChatPermissionMode) => void = useCallback(
    (mode: AIChatPermissionMode): void => {
      setPermissionModeState(mode);
      try {
        LocalStorage.setItem(THREAD_PERMISSION_MODE_STORAGE_KEY, mode);
      } catch {
        // Remembering the choice is a convenience only.
      }
    },
    [],
  );

  const sendMessage: (contentOverride?: string) => Promise<void> =
    useCallback(
      async (contentOverride?: string): Promise<void> => {
        const content: string = (contentOverride ?? input).trim();

        if (!content || isSending) {
          return;
        }

        const requestedSubjectKey: string = subjectKey;

        setIsSending(true);
        setActionError(null);
        setPendingQuestion(
          buildOptimisticQuestion({
            content,
            viewerUserId: serverView.viewerUserId || getViewerUserId(),
            viewerName: getViewerName(),
            now: new Date(),
          }),
        );

        if (contentOverride === undefined) {
          setInput("");
        }

        busyRef.current = true;

        try {
          await post("/ai-investigation/conversation/send-message", {
            content,
            permissionMode,
          });

          if (subjectKeyRef.current !== requestedSubjectKey) {
            return;
          }

          await refresh();
        } catch (error: unknown) {
          if (subjectKeyRef.current !== requestedSubjectKey) {
            return;
          }

          busyRef.current = false;
          setActionError(API.getFriendlyMessage(error));

          // Give the question back so nothing typed is ever lost.
          if (contentOverride === undefined) {
            setInput((current: string) => {
              return current ? current : content;
            });
          }
        } finally {
          if (subjectKeyRef.current === requestedSubjectKey) {
            setIsSending(false);
            setPendingQuestion(null);
          }
        }
      },
      [
        input,
        isSending,
        permissionMode,
        post,
        refresh,
        serverView.viewerUserId,
        subjectKey,
      ],
    );

  const respondToApproval: (
    assistantMessageId: string,
    decisions: Array<ThreadDecision>,
  ) => Promise<void> = useCallback(
    async (
      assistantMessageId: string,
      decisions: Array<ThreadDecision>,
    ): Promise<void> => {
      setIsSubmittingApproval(true);
      setActionError(null);

      try {
        await post("/ai-investigation/conversation/respond-to-approval", {
          assistantMessageId,
          decisions: decisions as unknown as JSONObject[],
        } as JSONObject);
        busyRef.current = true;
        await refresh();
      } catch (error: unknown) {
        setActionError(API.getFriendlyMessage(error));
      } finally {
        if (isMountedRef.current) {
          setIsSubmittingApproval(false);
        }
      }
    },
    [post, refresh],
  );

  const cancel: () => Promise<void> = useCallback(async (): Promise<void> => {
    setIsCancelling(true);
    setActionError(null);

    try {
      await post("/ai-investigation/conversation/cancel-run", {});
      await refresh();
    } catch (error: unknown) {
      setActionError(API.getFriendlyMessage(error));
    } finally {
      if (isMountedRef.current) {
        setIsCancelling(false);
      }
    }
  }, [post, refresh]);

  const view: ThreadView = pendingQuestion
    ? {
        ...serverView,
        viewerUserId: serverView.viewerUserId || pendingQuestion.author.userId,
        messages: [...serverView.messages, pendingQuestion],
      }
    : serverView;

  return {
    view,
    hasLoaded,
    loadError,
    input,
    setInput,
    isSending,
    actionError,
    clearActionError: () => {
      setActionError(null);
    },
    isSubmittingApproval,
    isCancelling,
    permissionMode,
    setPermissionMode,
    sendMessage,
    respondToApproval,
    cancel,
    refresh,
  };
}
