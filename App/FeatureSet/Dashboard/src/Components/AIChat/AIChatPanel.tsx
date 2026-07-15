import IconProp from "Common/Types/Icon/IconProp";
import Route from "Common/Types/API/Route";
import Icon from "Common/UI/Components/Icon/Icon";
import GlobalEvents from "Common/UI/Utils/GlobalEvents";
import Navigation from "Common/UI/Utils/Navigation";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import EventName from "../../Utils/EventName";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import ChatActivityFeed from "./ChatActivityFeed";
import ChatDownloadMenu from "./ChatDownloadMenu";
import ChatHomeView from "./ChatHomeView";
import ChatInput from "./ChatInput";
import ChatMessageList from "./ChatMessageList";
import ProviderPicker from "./ProviderPicker";
import PermissionModePicker from "./PermissionModePicker";
import { useAiChat, UseAiChat } from "./useAiChat";

/*
 * The "Ask AI" quick launcher: a compact slide-over for fast questions from
 * anywhere in the app, opened from the header (or the AI_CHAT_TOGGLE global
 * event). It shares all of its behavior with the full-page AI Chat via the
 * useAiChat hook, and offers a one-click expand to jump to the spacious
 * full-page workspace.
 */
const AIChatPanel: FunctionComponent = (): ReactElement => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [isVisible, setIsVisible] = useState<boolean>(false);

  const chat: UseAiChat = useAiChat({ enabled: isOpen });

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

  const openFullCopilot: () => void = (): void => {
    setIsOpen(false);
    Navigation.navigate(
      RouteUtil.populateRouteParams(RouteMap[PageMap.AI_COPILOT] as Route),
    );
  };

  if (!isOpen) {
    return <></>;
  }

  const composerLeading: ReactElement = (
    <div className="flex flex-wrap items-center gap-1.5">
      <ProviderPicker
        providers={chat.providers}
        selectedProviderId={chat.selectedProviderId}
        onSelect={chat.setSelectedProviderId}
      />
      <PermissionModePicker
        value={chat.permissionMode}
        onChange={chat.setPermissionMode}
        disabled={chat.isWorking}
      />
    </div>
  );

  return (
    <div className="relative z-40" role="dialog" aria-modal="true">
      <div
        className={`fixed inset-0 bg-gray-900 transition-opacity duration-300 ${
          isVisible ? "bg-opacity-25" : "bg-opacity-0"
        }`}
        onClick={() => {
          setIsOpen(false);
        }}
      ></div>

      <div
        className={`fixed inset-y-0 right-0 z-50 flex w-screen max-w-3xl transform flex-col border-l border-gray-200 bg-white shadow-2xl transition-transform duration-300 ease-in-out ${
          isVisible ? "translate-x-0" : "translate-x-full"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between border-b border-gray-200 bg-white px-4 py-3">
          <div className="flex min-w-0 items-center gap-3">
            {chat.activeConversationId && (
              <button
                type="button"
                title="All conversations"
                onClick={() => {
                  chat.newConversation();
                }}
                className="rounded-lg p-1.5 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
              >
                <Icon icon={IconProp.ChevronLeft} className="h-4 w-4" />
              </button>
            )}
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-gray-900">
              <Icon icon={IconProp.Sparkles} className="h-4 w-4 text-white" />
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-gray-900">
                {chat.isConversationView
                  ? chat.activeConversationTitle
                  : "Ask AI"}
              </div>
              <div className="truncate text-xs text-gray-400">
                {chat.isWorking
                  ? "Investigating your data…"
                  : "Your observability assistant"}
              </div>
            </div>
          </div>
          <div className="flex items-center gap-0.5">
            {chat.isConversationView && chat.messages.length > 0 && (
              <ChatDownloadMenu
                title={chat.activeConversationTitle}
                messages={chat.messages}
                latestRun={chat.latestRun}
                onError={chat.setError}
              />
            )}
            <button
              type="button"
              title="Open in full page"
              onClick={openFullCopilot}
              className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-900"
            >
              <Icon icon={IconProp.Expand} className="h-4 w-4" />
            </button>
            {chat.activeConversationId && (
              <button
                type="button"
                title="New conversation"
                onClick={() => {
                  chat.newConversation();
                }}
                className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
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
              className="rounded-lg p-2 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
            >
              <Icon icon={IconProp.Close} className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Error banner */}
        {chat.error && (
          <div className="flex items-start justify-between gap-2 border-b border-rose-100 bg-rose-50 px-4 py-2.5">
            <div className="flex items-start gap-2 text-xs text-rose-700">
              <Icon
                icon={IconProp.Error}
                className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-rose-500"
              />
              {chat.error}
            </div>
            <button
              type="button"
              title="Dismiss"
              onClick={() => {
                chat.setError("");
              }}
              className="-m-1 rounded p-1 text-rose-500 transition-colors hover:bg-rose-100 hover:text-rose-700"
            >
              <Icon icon={IconProp.Close} className="h-3.5 w-3.5" />
            </button>
          </div>
        )}

        {/* Body */}
        <div
          ref={chat.scrollContainerRef}
          onScroll={chat.onBodyScroll}
          className="min-h-0 flex-1 overflow-y-auto"
        >
          {!chat.isConversationView && (
            <ChatHomeView
              conversations={chat.conversations}
              isSending={chat.isSending}
              showNoProviderNotice={
                chat.providersLoaded && chat.providers.length === 0
              }
              onOpenConversation={chat.openConversation}
              onDeleteConversation={chat.deleteConversation}
              onAsk={(question: string) => {
                chat.sendMessage(question).catch(() => {
                  // handled in the hook
                });
              }}
            />
          )}

          {chat.isConversationView && (
            <div className="px-4 py-6">
              {chat.messages.length === 0 && !chat.isWorking && (
                <div className="flex justify-center py-10">
                  <span className="h-5 w-5 animate-spin rounded-full border-2 border-gray-200 border-t-gray-500"></span>
                </div>
              )}

              <ChatMessageList
                messages={chat.messages}
                latestRun={chat.latestRun}
                isSubmittingApproval={chat.isSubmittingApproval}
                onRespondToApproval={(
                  assistantMessageId: string,
                  decisions: Array<{ toolCallId: string; approved: boolean }>,
                ) => {
                  chat
                    .respondToApproval(assistantMessageId, decisions)
                    .catch(() => {
                      // handled in the hook
                    });
                }}
              />

              {chat.isWorking && (
                <div className={chat.messages.length > 0 ? "mt-5" : ""}>
                  <ChatActivityFeed events={chat.runEvents} />
                </div>
              )}
            </div>
          )}
        </div>

        {/* Composer */}
        <ChatInput
          value={chat.inputValue}
          onChange={chat.setInputValue}
          canSend={
            !chat.isSending && !chat.isWorking && !chat.isAwaitingApproval
          }
          isWorking={chat.isWorking}
          leading={composerLeading}
          onSend={() => {
            chat.sendMessage().catch(() => {
              // handled in the hook
            });
          }}
        />
      </div>
    </div>
  );
};

export default AIChatPanel;
