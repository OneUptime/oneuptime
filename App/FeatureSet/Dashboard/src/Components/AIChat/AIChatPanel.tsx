import AIConversation from "Common/Models/DatabaseModels/AIConversation";
import AIConversationMessage from "Common/Models/DatabaseModels/AIConversationMessage";
import AIRun from "Common/Models/DatabaseModels/AIRun";
import AIRunEvent from "Common/Models/DatabaseModels/AIRunEvent";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import AIChatMessageRole from "Common/Types/AI/AIChatMessageRole";
import AIChatMessageStatus from "Common/Types/AI/AIChatMessageStatus";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import { JSONObject } from "Common/Types/JSON";
import ModelEventType from "Common/Types/Realtime/ModelEventType";
import ObjectID from "Common/Types/ObjectID";
import Icon from "Common/UI/Components/Icon/Icon";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import GlobalEvents from "Common/UI/Utils/GlobalEvents";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import Realtime from "Common/UI/Utils/Realtime";
import User from "Common/UI/Utils/User";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import EventName from "../../Utils/EventName";
import ChatActivityFeed from "./ChatActivityFeed";
import ChatHomeView from "./ChatHomeView";
import ChatInput from "./ChatInput";
import ChatMessageList from "./ChatMessageList";

const POLL_INTERVAL_MS: number = 1200;

function getUserInitials(): string {
  try {
    const name: string = User.getName().toString().trim();
    if (!name) {
      return "U";
    }
    const parts: Array<string> = name.split(/\s+/);
    const first: string = parts[0]?.charAt(0) || "";
    const second: string = parts[1]?.charAt(0) || "";
    return (first + second).toUpperCase() || "U";
  } catch {
    return "U";
  }
}

/*
 * The Ask AI panel: a slide-over chat over the project's observability data.
 * Fluidity model — sends render optimistically before the server responds,
 * polling (accelerated by AIRunEvent realtime pings) drives live progress
 * with change-detection so unchanged data never re-renders, and scroll
 * follows output only while the user is pinned to the bottom.
 */
const AIChatPanel: FunctionComponent = (): ReactElement => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [isVisible, setIsVisible] = useState<boolean>(false);
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

  const activeConversationIdRef: React.MutableRefObject<string | undefined> =
    useRef<string | undefined>(undefined);
  activeConversationIdRef.current = activeConversationId;

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

  const userInitials: string = getUserInitials();

  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  // Stable dependency: getCurrentProjectId returns a fresh instance per call.
  const projectIdString: string = projectId?.toString() || "";

  const activeConversationTitle: string =
    conversations
      .find((conversation: AIConversation) => {
        return conversation.id?.toString() === activeConversationId;
      })
      ?.title?.toString() || "Conversation";

  /*
   * The conversation view shows as soon as a send is in flight (optimistic),
   * not only once the server has assigned a conversation id.
   */
  const isConversationView: boolean =
    Boolean(activeConversationId) || messages.length > 0 || isAwaitingResponse;

  // ---- open/close ----------------------------------------------------------

  useEffect(() => {
    const toggle: () => void = (): void => {
      setIsOpen((open: boolean) => {
        return !open;
      });
    };

    GlobalEvents.addEventListener(EventName.AI_CHAT_TOGGLE, toggle);

    return () => {
      GlobalEvents.removeEventListener(EventName.AI_CHAT_TOGGLE, toggle);
    };
  }, []);

  // Slide-in animation frame.
  useEffect(() => {
    if (!isOpen) {
      setIsVisible(false);
      return;
    }
    const timer: ReturnType<typeof setTimeout> = setTimeout(() => {
      setIsVisible(true);
    }, 10);
    return () => {
      clearTimeout(timer);
    };
  }, [isOpen]);

  // Escape closes the panel.
  useEffect(() => {
    if (!isOpen) {
      return;
    }
    const onKeyDown: (event: KeyboardEvent) => void = (
      event: KeyboardEvent,
    ): void => {
      if (event.key === "Escape") {
        setIsOpen(false);
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [isOpen]);

  // ---- data ----------------------------------------------------------------

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
            },
            sort: {
              lastMessageAt: SortOrder.Descending,
            },
            limit: 10,
            skip: 0,
          });
        setConversations(result.data);
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      }
    }, []);

  const fetchMessages: (conversationId: string) => Promise<void> = useCallback(
    async (conversationId: string): Promise<void> => {
      try {
        /*
         * Newest 50, then reversed to display order — a long conversation
         * must always show (and poll) its most recent messages.
         */
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

        // Only apply if this conversation is still the active one.
        if (activeConversationIdRef.current !== conversationId) {
          return;
        }

        const ordered: Array<AIConversationMessage> = [
          ...result.data,
        ].reverse();

        // Skip state churn (and re-renders) when nothing changed.
        const signature: string = ordered
          .map((message: AIConversationMessage) => {
            return `${message.id?.toString()}:${message.status}:${
              (message.citations || []).length
            }:${(message.contentInMarkdown || "").length}`;
          })
          .join("|");

        if (signature !== messagesSignatureRef.current) {
          messagesSignatureRef.current = signature;
          setMessages(ordered);
        }

        // result.data is newest-first: first match = latest.
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

        // Refetch the run only when it changed — not on every poll tick.
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
    [],
  );

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

  const resetConversationState: () => void = useCallback((): void => {
    setMessages([]);
    setRunEvents([]);
    setLatestRun(undefined);
    latestRunIdRef.current = undefined;
    messagesSignatureRef.current = "";
    eventsSignatureRef.current = "";
    isPinnedToBottomRef.current = true;
  }, []);

  // Reset panel state when the user switches projects.
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
    resetConversationState();
    setError("");
    if (isOpen) {
      fetchConversations().catch(() => {
        // handled in fetchConversations
      });
    }
  }, [projectIdString, isOpen, fetchConversations, resetConversationState]);

  // Load conversations when the panel opens.
  useEffect(() => {
    if (isOpen) {
      setError("");
      fetchConversations().catch(() => {
        // handled in fetchConversations
      });
    }
  }, [isOpen, fetchConversations]);

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

  useEffect(() => {
    if (!isWorking || !activeConversationId) {
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
  }, [isWorking, activeConversationId, fetchMessages]);

  /*
   * Realtime pings accelerate the poll where the socket path works.
   * AIRunEvent CREATE events emit unconditionally (unlike model updates,
   * which only emit for @EnableWorkflow models) and fire on every tool call
   * and on completion — exactly the progress signal the panel needs.
   */
  useEffect(() => {
    if (!isOpen || !projectIdString) {
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
  }, [isOpen, projectIdString, fetchMessages]);

  // ---- scroll behavior -------------------------------------------------------

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

  // Follow new output only while the user is pinned to the bottom.
  useEffect(() => {
    if (isPinnedToBottomRef.current) {
      scrollToBottom(true);
    }
  }, [messages, runEvents, isAwaitingResponse, scrollToBottom]);

  // ---- actions ---------------------------------------------------------------

  const openConversation: (conversationId: string) => void = (
    conversationId: string,
  ): void => {
    resetConversationState();
    setActiveConversationId(conversationId);
    activeConversationIdRef.current = conversationId;
    fetchMessages(conversationId).then(
      () => {
        scrollToBottom(false);
      },
      () => {
        // handled in fetchMessages
      },
    );
  };

  const goHome: () => void = (): void => {
    setActiveConversationId(undefined);
    activeConversationIdRef.current = undefined;
    resetConversationState();
    fetchConversations().catch(() => {
      // handled in fetchConversations
    });
  };

  const deleteConversation: (conversationId: string) => void = (
    conversationId: string,
  ): void => {
    setConversations((current: Array<AIConversation>) => {
      return current.filter((conversation: AIConversation) => {
        return conversation.id?.toString() !== conversationId;
      });
    });
    ModelAPI.deleteItem<AIConversation>({
      modelType: AIConversation,
      id: new ObjectID(conversationId),
    })
      .then(() => {
        return fetchConversations();
      })
      .catch((err: unknown) => {
        setError(API.getFriendlyMessage(err));
        // Roll the optimistic removal back.
        fetchConversations().catch(() => {
          // handled in fetchConversations
        });
      });
  };

  const sendMessage: (contentOverride?: string) => Promise<void> = async (
    contentOverride?: string,
  ): Promise<void> => {
    const content: string = (contentOverride ?? inputValue).trim();

    if (!content || isSending || isWorking) {
      return;
    }

    setError("");
    setInputValue("");
    setIsSending(true);
    setIsAwaitingResponse(true);

    // Optimistic render: the user's message appears instantly.
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
          url: URL.fromString(APP_API_URL.toString() + "/ai-chat/send-message"),
          data: {
            content: content,
            ...(activeConversationIdRef.current
              ? { conversationId: activeConversationIdRef.current }
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

      // Belt-and-braces: if the first fetch raced the server, catch up soon.
      setTimeout(() => {
        if (activeConversationIdRef.current === conversationId) {
          fetchMessages(conversationId).catch(() => {
            // handled in fetchMessages
          });
        }
      }, 1500);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
      // Roll back the optimistic message and give the text back.
      setMessages((current: Array<AIConversationMessage>) => {
        return current.filter((message: AIConversationMessage) => {
          return message.id?.toString() !== optimisticMessage.id?.toString();
        });
      });
      setInputValue(content);
    }

    setIsSending(false);
    setIsAwaitingResponse(false);
  };

  // ---- render ----------------------------------------------------------------

  if (!isOpen) {
    return <></>;
  }

  return (
    <div className="relative z-40" role="dialog" aria-modal="true">
      <div
        className={`fixed inset-0 bg-gray-900 transition-opacity duration-300 ${
          isVisible ? "bg-opacity-30" : "bg-opacity-0"
        }`}
        onClick={() => {
          setIsOpen(false);
        }}
      ></div>

      <div
        className={`fixed inset-y-0 right-0 z-50 flex w-screen max-w-xl transform flex-col bg-gray-50 shadow-2xl transition-transform duration-300 ease-in-out ${
          isVisible ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-100 bg-white px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            {activeConversationId && (
              <button
                type="button"
                title="All conversations"
                onClick={() => {
                  goHome();
                }}
                className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-50 hover:text-gray-600"
              >
                <Icon icon={IconProp.ChevronLeft} className="h-4 w-4" />
              </button>
            )}
            <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 shadow-sm">
              <Icon icon={IconProp.Sparkles} className="h-5 w-5 text-white" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-gray-900">
                {isConversationView ? activeConversationTitle : "Ask AI"}
              </div>
              <div className="truncate text-[11px] text-gray-400">
                {isWorking
                  ? "Investigating your data…"
                  : "Your observability copilot"}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-1">
            {activeConversationId && (
              <button
                type="button"
                title="New conversation"
                onClick={() => {
                  goHome();
                }}
                className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-50 hover:text-gray-600"
              >
                <Icon icon={IconProp.Add} className="h-4 w-4" />
              </button>
            )}
            <button
              type="button"
              title="Close (Esc)"
              onClick={() => {
                setIsOpen(false);
              }}
              className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-50 hover:text-gray-600"
            >
              <Icon icon={IconProp.Close} className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Error banner */}
        {error && (
          <div className="flex items-start justify-between gap-2 border-b border-red-100 bg-red-50 px-4 py-2">
            <div className="flex items-start gap-2 text-xs text-red-700">
              <Icon
                icon={IconProp.Error}
                className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-red-400"
              />
              {error}
            </div>
            <button
              type="button"
              onClick={() => {
                setError("");
              }}
              className="text-red-300 hover:text-red-500"
            >
              <Icon icon={IconProp.Close} className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Body */}
        <div
          ref={scrollContainerRef}
          onScroll={onBodyScroll}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          {!isConversationView && (
            <ChatHomeView
              conversations={conversations}
              isSending={isSending}
              onOpenConversation={openConversation}
              onDeleteConversation={deleteConversation}
              onAsk={(question: string) => {
                sendMessage(question).catch(() => {
                  // handled in sendMessage
                });
              }}
            />
          )}

          {isConversationView && (
            <div className="px-4 py-5">
              {messages.length === 0 && !isWorking && (
                <div className="flex justify-center py-10">
                  <span className="h-5 w-5 animate-spin rounded-full border-2 border-gray-200 border-t-indigo-500"></span>
                </div>
              )}

              <ChatMessageList
                messages={messages}
                latestRun={latestRun}
                userInitials={userInitials}
              />

              {isWorking && (
                <div className={messages.length > 0 ? "mt-5" : ""}>
                  <ChatActivityFeed events={runEvents} />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Composer */}
        <ChatInput
          value={inputValue}
          onChange={setInputValue}
          canSend={!isSending && !isWorking}
          isWorking={isWorking}
          onSend={() => {
            sendMessage().catch(() => {
              // handled in sendMessage
            });
          }}
        />
      </div>
    </div>
  );
};

export default AIChatPanel;
