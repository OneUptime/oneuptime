import AIConversation from "Common/Models/DatabaseModels/AIConversation";
import AIConversationMessage from "Common/Models/DatabaseModels/AIConversationMessage";
import AIRun from "Common/Models/DatabaseModels/AIRun";
import AIRunEvent from "Common/Models/DatabaseModels/AIRunEvent";
import HTTPErrorResponse from "Common/Types/API/HTTPErrorResponse";
import HTTPResponse from "Common/Types/API/HTTPResponse";
import URL from "Common/Types/API/URL";
import AIChatMessageStatus from "Common/Types/AI/AIChatMessageStatus";
import SortOrder from "Common/Types/BaseDatabase/SortOrder";
import { JSONObject } from "Common/Types/JSON";
import ModelEventType from "Common/Types/Realtime/ModelEventType";
import ObjectID from "Common/Types/ObjectID";
import Button, { ButtonStyleType } from "Common/UI/Components/Button/Button";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import SideOver, { SideOverSize } from "Common/UI/Components/SideOver/SideOver";
import { APP_API_URL } from "Common/UI/Config";
import API from "Common/UI/Utils/API/API";
import GlobalEvents from "Common/UI/Utils/GlobalEvents";
import ModelAPI, { ListResult } from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import Realtime from "Common/UI/Utils/Realtime";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useRef,
  useState,
} from "react";
import EventName from "../../Utils/EventName";
import ChatInput from "./ChatInput";
import ChatMessageList from "./ChatMessageList";

const POLL_INTERVAL_MS: number = 2000;

/*
 * The Ask AI panel. Mounted once in the dashboard master page so it survives
 * route changes; toggled from the header via a GlobalEvents event. Progress
 * streaming = poll the in-progress assistant message every 2s, accelerated
 * by Realtime update pings where the socket path works.
 */
const AIChatPanel: FunctionComponent = (): ReactElement => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [conversations, setConversations] = useState<Array<AIConversation>>([]);
  const [activeConversationId, setActiveConversationId] = useState<
    string | undefined
  >(undefined);
  const [messages, setMessages] = useState<Array<AIConversationMessage>>([]);
  const [latestRun, setLatestRun] = useState<AIRun | undefined>(undefined);
  const [isSending, setIsSending] = useState<boolean>(false);
  const [error, setError] = useState<string>("");

  const activeConversationIdRef: React.MutableRefObject<string | undefined> =
    useRef<string | undefined>(undefined);
  activeConversationIdRef.current = activeConversationId;

  const latestRunIdRef: React.MutableRefObject<string | undefined> = useRef<
    string | undefined
  >(undefined);

  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  // Stable dependency: getCurrentProjectId returns a fresh instance per call.
  const projectIdString: string = projectId?.toString() || "";

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
    setMessages([]);
    setLatestRun(undefined);
    latestRunIdRef.current = undefined;
    setError("");
    if (isOpen) {
      fetchConversations().catch(() => {
        // handled in fetchConversations
      });
    }
  }, [projectIdString]);

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
        if (activeConversationIdRef.current === conversationId) {
          setMessages([...result.data].reverse());

          // result.data is newest-first: first completed match = latest.
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
        }
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      }
    },
    [],
  );

  // Load conversations when the panel opens.
  useEffect(() => {
    if (isOpen) {
      setError("");
      fetchConversations().catch(() => {
        // handled in fetchConversations
      });
    }
  }, [isOpen, fetchConversations]);

  // Poll while a response is being generated.
  const hasWorkingMessage: boolean = messages.some(
    (message: AIConversationMessage) => {
      return (
        message.status === AIChatMessageStatus.InProgress ||
        message.status === AIChatMessageStatus.Pending
      );
    },
  );

  useEffect(() => {
    if (!hasWorkingMessage || !activeConversationId) {
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
  }, [hasWorkingMessage, activeConversationId, fetchMessages]);

  /*
   * Realtime pings accelerate the poll where the socket path works.
   * Subscribe to AIRunEvent CREATE: create events emit unconditionally,
   * while model update events only emit for @EnableWorkflow models — which
   * these personal-data models deliberately are not. Run events fire on
   * every tool call and on run completion, which is exactly the progress
   * signal the panel needs.
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

  const openConversation: (conversationId: string) => void = (
    conversationId: string,
  ): void => {
    setActiveConversationId(conversationId);
    setMessages([]);
    setLatestRun(undefined);
    latestRunIdRef.current = undefined;
    fetchMessages(conversationId).catch(() => {
      // handled in fetchMessages
    });
  };

  const sendMessage: (content: string) => Promise<void> = async (
    content: string,
  ): Promise<void> => {
    setIsSending(true);
    setError("");

    try {
      const response: HTTPResponse<JSONObject> | HTTPErrorResponse =
        await API.post<JSONObject>({
          url: URL.fromString(APP_API_URL.toString() + "/ai-chat/send-message"),
          data: {
            content: content,
            ...(activeConversationId
              ? { conversationId: activeConversationId }
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

      if (!activeConversationId) {
        setActiveConversationId(conversationId);
        fetchConversations().catch(() => {
          // handled in fetchConversations
        });
      }

      await fetchMessages(conversationId);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsSending(false);
  };

  if (!isOpen) {
    return <></>;
  }

  return (
    <SideOver
      title="Ask AI"
      description="Ask questions about this project's logs, traces, metrics, exceptions, incidents, monitors and alerts."
      size={SideOverSize.Medium}
      onClose={() => {
        setIsOpen(false);
      }}
    >
      <div className="flex h-full flex-col justify-between px-1">
        <div className="grow overflow-y-auto pb-4">
          {error && <ErrorMessage message={error} />}

          {!activeConversationId && (
            <div>
              {conversations.length > 0 && (
                <div className="mb-4">
                  <div className="text-xs font-semibold uppercase tracking-wide text-gray-400 mb-2">
                    Recent conversations
                  </div>
                  <div className="flex flex-col gap-1">
                    {conversations.map((conversation: AIConversation) => {
                      return (
                        <button
                          key={conversation.id?.toString()}
                          type="button"
                          className="rounded-md px-3 py-2 text-left text-sm hover:bg-gray-50 border border-gray-100 truncate"
                          onClick={() => {
                            openConversation(conversation.id!.toString());
                          }}
                        >
                          {conversation.title || "Untitled conversation"}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
              <div className="text-sm text-gray-500">
                Ask a question below to start a new conversation — for example:
                “What are the top exceptions this week?”, “Why is the checkout
                service slow?” or “Which monitors are down right now?”
              </div>
            </div>
          )}

          {activeConversationId && (
            <div>
              <div className="mb-3">
                <Button
                  title="← All conversations"
                  buttonStyle={ButtonStyleType.SECONDARY_LINK}
                  onClick={() => {
                    setActiveConversationId(undefined);
                    setMessages([]);
                    setLatestRun(undefined);
                    fetchConversations().catch(() => {
                      // handled in fetchConversations
                    });
                  }}
                />
              </div>
              <ChatMessageList messages={messages} latestRun={latestRun} />
            </div>
          )}
        </div>

        <ChatInput
          isSending={isSending || hasWorkingMessage}
          onSend={(content: string) => {
            sendMessage(content).catch(() => {
              // handled in sendMessage
            });
          }}
        />
      </div>
    </SideOver>
  );
};

export default AIChatPanel;
