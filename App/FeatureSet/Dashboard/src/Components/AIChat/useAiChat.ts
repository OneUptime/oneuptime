import AIConversation from "Common/Models/DatabaseModels/AIConversation";
import AIConversationMessage from "Common/Models/DatabaseModels/AIConversationMessage";
import AIRun from "Common/Models/DatabaseModels/AIRun";
import AIRunEvent from "Common/Models/DatabaseModels/AIRunEvent";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import AIChatMessageRole from "Common/Types/AI/AIChatMessageRole";
import AIChatMessageStatus from "Common/Types/AI/AIChatMessageStatus";
import AIChatPermissionMode, {
  AIChatPermissionModeHelper,
} from "Common/Types/AI/AIChatPermissionMode";
import { AIChatToolAction } from "Common/Types/AI/AIChatTypes";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import { JSONArray, JSONObject } from "Common/Types/JSON";
import ModelEventType from "Common/Types/Realtime/ModelEventType";
import ObjectID from "Common/Types/ObjectID";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import Realtime from "Common/UI/Utils/Realtime";
import React, { useCallback, useEffect, useRef, useState } from "react";

const POLL_INTERVAL_MS: number = 1200;

/*
 * A provider the user can pick in the chat provider switcher. Mirrors the
 * shape returned by POST /ai-chat/providers — secrets are never included.
 */
export interface ChatProvider {
  id: string;
  name: string;
  llmType: string | null;
  modelName: string | null;
  isDefault: boolean;
  isGlobal: boolean;
}

export interface UseAiChat {
  conversations: Array<AIConversation>;
  activeConversationId: string | undefined;
  activeConversationTitle: string;
  messages: Array<AIConversationMessage>;
  runEvents: Array<AIRunEvent>;
  latestRun: AIRun | undefined;
  inputValue: string;
  setInputValue: (value: string) => void;
  isSending: boolean;
  isWorking: boolean;
  isAwaitingApproval: boolean;
  isConversationView: boolean;
  error: string;
  setError: (error: string) => void;
  providers: Array<ChatProvider>;
  selectedProviderId: string | undefined;
  setSelectedProviderId: (id: string | undefined) => void;
  selectedProvider: ChatProvider | undefined;
  permissionMode: AIChatPermissionMode;
  setPermissionMode: (mode: AIChatPermissionMode) => void;
  isSubmittingApproval: boolean;
  respondToApproval: (
    assistantMessageId: string,
    decisions: Array<{ toolCallId: string; approved: boolean }>,
  ) => Promise<void>;
  sendMessage: (contentOverride?: string) => Promise<void>;
  openConversation: (conversationId: string) => void;
  newConversation: () => void;
  deleteConversation: (conversationId: string) => void;
  scrollContainerRef: React.RefObject<HTMLDivElement>;
  onBodyScroll: () => void;
  scrollToBottom: (smooth: boolean) => void;
}

/*
 * The whole Ask-AI experience as a headless hook, shared by the full-page
 * Copilot and the quick-launch popover. `enabled` gates all fetching/polling
 * so an unmounted-but-present surface (e.g. a closed popover) does no work.
 *
 * Behavior mirrors the original AIChatPanel: optimistic sends, change-detected
 * polling accelerated by AIRunEvent realtime pings, and scroll that follows
 * output only while the user is pinned to the bottom.
 */
export function useAiChat(options: { enabled: boolean }): UseAiChat {
  const { enabled } = options;

  const [conversations, setConversations] = useState<Array<AIConversation>>([]);
  const [activeConversationId, setActiveConversationId] = useState<
    string | undefined
  >(undefined);
  const [messages, setMessages] = useState<Array<AIConversationMessage>>([]);
  const [runEvents, setRunEvents] = useState<Array<AIRunEvent>>([]);
  const [latestRun, setLatestRun] = useState<AIRun | undefined>(undefined);
  const [inputValue, setInputValue] = useState<string>("");
  const [isSending, setIsSending] = useState<boolean>(false);
  const [isAwaitingResponse, setIsAwaitingResponse] = useState<boolean>(false);
  const [error, setError] = useState<string>("");
  const [providers, setProviders] = useState<Array<ChatProvider>>([]);
  const [selectedProviderId, setSelectedProviderId] = useState<
    string | undefined
  >(undefined);
  const [permissionMode, setPermissionMode] = useState<AIChatPermissionMode>(
    AIChatPermissionModeHelper.getDefault(),
  );
  const [isSubmittingApproval, setIsSubmittingApproval] =
    useState<boolean>(false);

  const activeConversationIdRef: React.MutableRefObject<string | undefined> =
    useRef<string | undefined>(undefined);
  activeConversationIdRef.current = activeConversationId;

  const selectedProviderIdRef: React.MutableRefObject<string | undefined> =
    useRef<string | undefined>(undefined);
  selectedProviderIdRef.current = selectedProviderId;

  const permissionModeRef: React.MutableRefObject<AIChatPermissionMode> =
    useRef<AIChatPermissionMode>(permissionMode);
  permissionModeRef.current = permissionMode;

  const latestRunIdRef: React.MutableRefObject<string | undefined> = useRef<
    string | undefined
  >(undefined);
  const messagesSignatureRef: React.MutableRefObject<string> =
    useRef<string>("");
  const eventsSignatureRef: React.MutableRefObject<string> = useRef<string>("");
  const scrollContainerRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const isPinnedToBottomRef: React.MutableRefObject<boolean> =
    useRef<boolean>(true);

  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  const projectIdString: string = projectId?.toString() || "";

  const selectedProvider: ChatProvider | undefined = providers.find(
    (provider: ChatProvider) => {
      return provider.id === selectedProviderId;
    },
  );

  const activeConversationTitle: string =
    conversations
      .find((conversation: AIConversation) => {
        return conversation.id?.toString() === activeConversationId;
      })
      ?.title?.toString() || "Conversation";

  const isConversationView: boolean =
    Boolean(activeConversationId) || messages.length > 0 || isAwaitingResponse;

  // ---- data ----------------------------------------------------------------

  const fetchProviders: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      try {
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post<JSONObject>({
            url: URL.fromString(APP_API_URL.toString() + "/ai-chat/providers"),
            data: {},
            headers: ModelAPI.getCommonHeaders(),
          });

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        const data: JSONObject = response.data as JSONObject;
        const list: Array<ChatProvider> = (
          (data["providers"] as JSONArray) || []
        ).map((provider: JSONObject) => {
          return {
            id: provider["id"] as string,
            name: provider["name"] as string,
            llmType: (provider["llmType"] as string) || null,
            modelName: (provider["modelName"] as string) || null,
            isDefault: Boolean(provider["isDefault"]),
            isGlobal: Boolean(provider["isGlobal"]),
          };
        });

        setProviders(list);

        // Default the picker to the project's resolved provider on first load.
        const defaultProviderId: string | undefined =
          (data["defaultProviderId"] as string) || undefined;

        if (!selectedProviderIdRef.current) {
          setSelectedProviderId(
            defaultProviderId || (list.length > 0 ? list[0]!.id : undefined),
          );
        }
      } catch {
        // The picker is optional — a failure just means the default is used.
      }
    }, []);

  const fetchConversations: () => Promise<void> =
    useCallback(async (): Promise<void> => {
      try {
        const result: ListResult<AIConversation> =
          await ModelAPI.getList<AIConversation>({
            modelType: AIConversation,
            query: {},
            select: {
              _id: true,
              title: true,
              lastMessageAt: true,
              llmProviderId: true,
              permissionMode: true,
            },
            sort: {
              lastMessageAt: SortOrder.Descending,
            },
            limit: 25,
            skip: 0,
          });
        setConversations(result.data);
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      }
    }, []);

  const fetchRunEvents: (runId: ObjectID) => Promise<void> = useCallback(
    async (runId: ObjectID): Promise<void> => {
      const result: ListResult<AIRunEvent> = await ModelAPI.getList<AIRunEvent>(
        {
          modelType: AIRunEvent,
          query: {
            aiRunId: runId,
          },
          select: {
            _id: true,
            eventType: true,
            toolName: true,
            resultSummary: true,
            sequence: true,
          },
          sort: {
            sequence: SortOrder.Ascending,
          },
          limit: 100,
          skip: 0,
        },
      );

      const signature: string = `${result.data.length}:${result.data[
        result.data.length - 1
      ]?.id?.toString()}`;

      if (signature !== eventsSignatureRef.current) {
        eventsSignatureRef.current = signature;
        setRunEvents(result.data);
      }
    },
    [],
  );

  const fetchMessages: (conversationId: string) => Promise<void> = useCallback(
    async (conversationId: string): Promise<void> => {
      try {
        const result: ListResult<AIConversationMessage> =
          await ModelAPI.getList<AIConversationMessage>({
            modelType: AIConversationMessage,
            query: {
              conversationId: new ObjectID(conversationId),
            },
            select: {
              _id: true,
              role: true,
              contentInMarkdown: true,
              status: true,
              citations: true,
              widgets: true,
              toolActions: true,
              errorMessage: true,
              aiRunId: true,
              createdAt: true,
            },
            sort: {
              createdAt: SortOrder.Descending,
            },
            limit: 50,
            skip: 0,
          });

        if (activeConversationIdRef.current !== conversationId) {
          return;
        }

        const ordered: Array<AIConversationMessage> = [
          ...result.data,
        ].reverse();

        const signature: string = ordered
          .map((message: AIConversationMessage) => {
            return `${message.id?.toString()}:${message.status}:${
              (message.citations || []).length
            }:${(message.widgets || []).length}:${(message.toolActions || [])
              .map((action: AIChatToolAction) => {
                return action.status;
              })
              .join(",")}:${(message.contentInMarkdown || "").length}`;
          })
          .join("|");

        if (signature !== messagesSignatureRef.current) {
          messagesSignatureRef.current = signature;
          setMessages(ordered);
        }

        const workingMessage: AIConversationMessage | undefined =
          result.data.find((message: AIConversationMessage) => {
            return (
              message.status === AIChatMessageStatus.InProgress ||
              message.status === AIChatMessageStatus.Pending
            );
          });

        if (workingMessage?.aiRunId) {
          await fetchRunEvents(workingMessage.aiRunId);
        } else if (eventsSignatureRef.current) {
          eventsSignatureRef.current = "";
          setRunEvents([]);
        }

        const lastCompleted: AIConversationMessage | undefined =
          result.data.find((message: AIConversationMessage) => {
            return (
              message.status === AIChatMessageStatus.Completed &&
              message.aiRunId
            );
          });

        if (
          lastCompleted?.aiRunId &&
          lastCompleted.aiRunId.toString() !== latestRunIdRef.current
        ) {
          const run: AIRun | null = await ModelAPI.getItem<AIRun>({
            modelType: AIRun,
            id: lastCompleted.aiRunId,
            select: {
              totalTokens: true,
              totalCostInUSDCents: true,
              toolCallCount: true,
              llmCallCount: true,
              egressManifest: true,
            },
          });
          if (run) {
            latestRunIdRef.current = lastCompleted.aiRunId.toString();
            setLatestRun(run);
          }
        }
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      }
    },
    [fetchRunEvents],
  );

  const resetConversationState: () => void = useCallback((): void => {
    setMessages([]);
    setRunEvents([]);
    setLatestRun(undefined);
    latestRunIdRef.current = undefined;
    messagesSignatureRef.current = "";
    eventsSignatureRef.current = "";
    isPinnedToBottomRef.current = true;
  }, []);

  // Reset everything when the project changes.
  const lastProjectIdRef: React.MutableRefObject<string> =
    useRef<string>(projectIdString);

  useEffect(() => {
    if (lastProjectIdRef.current === projectIdString) {
      return;
    }
    lastProjectIdRef.current = projectIdString;
    setConversations([]);
    setActiveConversationId(undefined);
    activeConversationIdRef.current = undefined;
    setProviders([]);
    setSelectedProviderId(undefined);
    setPermissionMode(AIChatPermissionModeHelper.getDefault());
    resetConversationState();
    setError("");
    if (enabled) {
      fetchConversations().catch(() => {
        // handled in fetchConversations
      });
      fetchProviders().catch(() => {
        // optional
      });
    }
  }, [
    projectIdString,
    enabled,
    fetchConversations,
    fetchProviders,
    resetConversationState,
  ]);

  // Load conversations + providers when enabled.
  useEffect(() => {
    if (enabled) {
      setError("");
      fetchConversations().catch(() => {
        // handled in fetchConversations
      });
      fetchProviders().catch(() => {
        // optional
      });
    }
  }, [enabled, fetchConversations, fetchProviders]);

  // ---- working state + polling ---------------------------------------------

  const hasWorkingMessage: boolean = messages.some(
    (message: AIConversationMessage) => {
      return (
        message.status === AIChatMessageStatus.InProgress ||
        message.status === AIChatMessageStatus.Pending
      );
    },
  );

  const isWorking: boolean = hasWorkingMessage || isAwaitingResponse;

  // A message is paused waiting for the user to approve pending tool actions.
  const isAwaitingApproval: boolean = messages.some(
    (message: AIConversationMessage) => {
      return message.status === AIChatMessageStatus.WaitingForApproval;
    },
  );

  useEffect(() => {
    if (!enabled || !isWorking || !activeConversationId) {
      return;
    }

    const interval: ReturnType<typeof setInterval> = setInterval(() => {
      fetchMessages(activeConversationId).catch(() => {
        // handled in fetchMessages
      });
    }, POLL_INTERVAL_MS);

    return () => {
      clearInterval(interval);
    };
  }, [enabled, isWorking, activeConversationId, fetchMessages]);

  useEffect(() => {
    if (!enabled || !projectIdString) {
      return;
    }

    const unsubscribe: () => void = Realtime.listenToModelEvent(
      {
        modelType: AIRunEvent,
        eventType: ModelEventType.Create,
        tenantId: new ObjectID(projectIdString),
      },
      () => {
        if (activeConversationIdRef.current) {
          fetchMessages(activeConversationIdRef.current).catch(() => {
            // handled in fetchMessages
          });
        }
      },
    );

    return () => {
      unsubscribe();
    };
  }, [enabled, projectIdString, fetchMessages]);

  // ---- scroll --------------------------------------------------------------

  const scrollToBottom: (smooth: boolean) => void = useCallback(
    (smooth: boolean): void => {
      const container: HTMLDivElement | null = scrollContainerRef.current;
      if (!container) {
        return;
      }
      container.scrollTo({
        top: container.scrollHeight,
        behavior: smooth ? "smooth" : "auto",
      });
    },
    [],
  );

  const onBodyScroll: () => void = useCallback((): void => {
    const container: HTMLDivElement | null = scrollContainerRef.current;
    if (!container) {
      return;
    }
    isPinnedToBottomRef.current =
      container.scrollHeight - container.scrollTop - container.clientHeight <
      100;
  }, []);

  useEffect(() => {
    if (isPinnedToBottomRef.current) {
      scrollToBottom(true);
    }
  }, [messages, runEvents, isAwaitingResponse, scrollToBottom]);

  // ---- actions -------------------------------------------------------------

  const openConversation: (conversationId: string) => void = useCallback(
    (conversationId: string): void => {
      resetConversationState();
      setActiveConversationId(conversationId);
      activeConversationIdRef.current = conversationId;

      // Restore the provider this conversation was last using, if any.
      const conversation: AIConversation | undefined = conversations.find(
        (item: AIConversation) => {
          return item.id?.toString() === conversationId;
        },
      );
      if (conversation?.llmProviderId) {
        setSelectedProviderId(conversation.llmProviderId.toString());
      }
      if (
        conversation?.permissionMode &&
        AIChatPermissionModeHelper.isValid(conversation.permissionMode)
      ) {
        setPermissionMode(conversation.permissionMode);
      }

      fetchMessages(conversationId).then(
        () => {
          scrollToBottom(false);
        },
        () => {
          // handled in fetchMessages
        },
      );
    },
    [conversations, fetchMessages, resetConversationState, scrollToBottom],
  );

  const newConversation: () => void = useCallback((): void => {
    setActiveConversationId(undefined);
    activeConversationIdRef.current = undefined;
    resetConversationState();
    fetchConversations().catch(() => {
      // handled in fetchConversations
    });
  }, [fetchConversations, resetConversationState]);

  const deleteConversation: (conversationId: string) => void = useCallback(
    (conversationId: string): void => {
      setConversations((current: Array<AIConversation>) => {
        return current.filter((conversation: AIConversation) => {
          return conversation.id?.toString() !== conversationId;
        });
      });

      if (activeConversationIdRef.current === conversationId) {
        newConversation();
      }

      ModelAPI.deleteItem<AIConversation>({
        modelType: AIConversation,
        id: new ObjectID(conversationId),
      })
        .then(() => {
          return fetchConversations();
        })
        .catch((err: unknown) => {
          setError(API.getFriendlyMessage(err));
          fetchConversations().catch(() => {
            // handled in fetchConversations
          });
        });
    },
    [fetchConversations, newConversation],
  );

  const sendMessage: (contentOverride?: string) => Promise<void> = useCallback(
    async (contentOverride?: string): Promise<void> => {
      const content: string = (contentOverride ?? inputValue).trim();

      if (!content || isSending || isWorking) {
        return;
      }

      setError("");
      setInputValue("");
      setIsSending(true);
      setIsAwaitingResponse(true);

      const optimisticMessage: AIConversationMessage =
        new AIConversationMessage();
      optimisticMessage.id = ObjectID.generate();
      optimisticMessage.role = AIChatMessageRole.User;
      optimisticMessage.contentInMarkdown = content;
      optimisticMessage.status = AIChatMessageStatus.Completed;
      optimisticMessage.createdAt = OneUptimeDate.getCurrentDate();

      setMessages((current: Array<AIConversationMessage>) => {
        return [...current, optimisticMessage];
      });
      isPinnedToBottomRef.current = true;

      try {
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post<JSONObject>({
            url: URL.fromString(
              APP_API_URL.toString() + "/ai-chat/send-message",
            ),
            data: {
              content: content,
              permissionMode: permissionModeRef.current,
              ...(activeConversationIdRef.current
                ? { conversationId: activeConversationIdRef.current }
                : {}),
              ...(selectedProviderIdRef.current
                ? { llmProviderId: selectedProviderIdRef.current }
                : {}),
            },
            headers: ModelAPI.getCommonHeaders(),
          });

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        const conversationId: string = (response.data as JSONObject)[
          "conversationId"
        ] as string;

        if (!activeConversationIdRef.current) {
          activeConversationIdRef.current = conversationId;
          setActiveConversationId(conversationId);
          fetchConversations().catch(() => {
            // handled in fetchConversations
          });
        }

        await fetchMessages(conversationId);

        setTimeout(() => {
          if (activeConversationIdRef.current === conversationId) {
            fetchMessages(conversationId).catch(() => {
              // handled in fetchMessages
            });
          }
        }, 1500);
      } catch (err) {
        setError(API.getFriendlyMessage(err));
        setMessages((current: Array<AIConversationMessage>) => {
          return current.filter((message: AIConversationMessage) => {
            return message.id?.toString() !== optimisticMessage.id?.toString();
          });
        });
        setInputValue(content);
      }

      setIsSending(false);
      setIsAwaitingResponse(false);
    },
    [inputValue, isSending, isWorking, fetchConversations, fetchMessages],
  );

  const respondToApproval: (
    assistantMessageId: string,
    decisions: Array<{ toolCallId: string; approved: boolean }>,
  ) => Promise<void> = useCallback(
    async (
      assistantMessageId: string,
      decisions: Array<{ toolCallId: string; approved: boolean }>,
    ): Promise<void> => {
      if (isSubmittingApproval || !activeConversationIdRef.current) {
        return;
      }

      setError("");
      setIsSubmittingApproval(true);

      /*
       * Optimistically move the message off "waiting" so the spinner and
       * polling resume immediately — the detached resume flips it server-side a
       * moment later and the poll reconciles.
       */
      setMessages((current: Array<AIConversationMessage>) => {
        return current.map((message: AIConversationMessage) => {
          if (message.id?.toString() === assistantMessageId) {
            message.status = AIChatMessageStatus.InProgress;
          }
          return message;
        });
      });
      setIsAwaitingResponse(true);
      isPinnedToBottomRef.current = true;

      try {
        const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
          await API.post<JSONObject>({
            url: URL.fromString(
              APP_API_URL.toString() + "/ai-chat/respond-to-approval",
            ),
            data: {
              conversationId: activeConversationIdRef.current,
              assistantMessageId: assistantMessageId,
              decisions: decisions,
            },
            headers: ModelAPI.getCommonHeaders(),
          });

        if (response instanceof HTTPErrorResponse) {
          throw response;
        }

        if (activeConversationIdRef.current) {
          await fetchMessages(activeConversationIdRef.current);
        }
      } catch (err) {
        setError(API.getFriendlyMessage(err));
        if (activeConversationIdRef.current) {
          fetchMessages(activeConversationIdRef.current).catch(() => {
            // handled in fetchMessages
          });
        }
      }

      setIsSubmittingApproval(false);
      setIsAwaitingResponse(false);
    },
    [isSubmittingApproval, fetchMessages],
  );

  return {
    conversations,
    activeConversationId,
    activeConversationTitle,
    messages,
    runEvents,
    latestRun,
    inputValue,
    setInputValue,
    isSending,
    isWorking,
    isAwaitingApproval,
    isConversationView,
    error,
    setError,
    providers,
    selectedProviderId,
    setSelectedProviderId,
    selectedProvider,
    permissionMode,
    setPermissionMode,
    isSubmittingApproval,
    respondToApproval,
    sendMessage,
    openConversation,
    newConversation,
    deleteConversation,
    scrollContainerRef,
    onBodyScroll,
    scrollToBottom,
  };
}
