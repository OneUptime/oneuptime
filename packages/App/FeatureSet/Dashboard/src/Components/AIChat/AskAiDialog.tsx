import AIConversation from "Common/Models/DatabaseModels/AIConversation";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import GlobalEvents from "Common/UI/Utils/GlobalEvents";
import { usePageInert } from "Common/UI/Utils/PageInert";
import { usePageScrollLock } from "Common/UI/Utils/PageScrollLock";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";
import { useLocation } from "react-router-dom";
import EventName from "../../Utils/EventName";
import AIChatUnavailableView from "./AIChatUnavailableView";
import AskAiConversation from "./AskAiConversation";
import AskAiHistory from "./AskAiHistory";
import AskAiMark, { AskAiMarkSize } from "./AskAiMark";
import AskAiResumeButton from "./AskAiResumeButton";
import {
  AskAiEventRead,
  AskAiRequest,
  readAskAiEvent,
  takePendingAskAiRequest,
} from "./AskAiEvents";
import ChatDownloadMenu from "./ChatDownloadMenu";
import ChatHomeView from "./ChatHomeView";
import ChatInput from "./ChatInput";
import PageContextChip from "./PageContextChip";
import PermissionModePicker from "./PermissionModePicker";
import ProviderPicker from "./ProviderPicker";
import { useAiChat, UseAiChat } from "./useAiChat";

/*
 * ASK AI, ON THE MAIN STAGE.
 *
 * Ask AI used to slide in from the side, a narrow panel over the page with
 * every control and every step of its work on show. It is a dialog now: a
 * large surface in the middle of the screen over the dimmed, blurred page
 * it was opened from - and on a phone a full-screen sheet.
 *
 * - Every way in reaches it (AskAiEvents): the header's Ask AI, Ctrl/Cmd +
 *   I, the command palette, the "Explain with AI" and "Ask about this case"
 *   buttons on pages, and the chat's own address (Products -> AI -> Chat),
 *   which opens it over the page the person came from.
 * - It knows the page it was opened from and keeps it in view as what the
 *   question is about (the composer's context pill), and starts with that
 *   page's own suggestions.
 * - It is a real dialog: the focus moves in and stays in, Esc closes it,
 *   the focus goes back to what opened it, and the page behind it is inert
 *   and does not scroll.
 * - Closing it loses nothing: the conversation is there when it opens
 *   again, and an answer still being written when it closed says when it
 *   is ready (AskAiResumeButton). Opening something from inside it - a
 *   source, a card's Open - closes it, so the page opened is seen; the
 *   conversation waits for the person to come back.
 * - It is quiet: an answer leads, its work is one line that opens into its
 *   steps, and its sources, the time and its actions sit on one row under
 *   it.
 */

const ICON_BUTTON_CLASS_NAME: string =
  "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

// Every element a Tab can land on, as Modal reads them.
const FOCUSABLE_SELECTOR: string =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

type View = "unavailable" | "history" | "conversation" | "home";

interface HeaderButtonProps {
  icon: IconProp;
  label: string;
  onClick: () => void;
  testId: string;
}

const HeaderButton: FunctionComponent<HeaderButtonProps> = (
  props: HeaderButtonProps,
): ReactElement => {
  return (
    <button
      type="button"
      title={props.label}
      aria-label={props.label}
      data-testid={props.testId}
      onClick={props.onClick}
      className={ICON_BUTTON_CLASS_NAME}
    >
      <Icon icon={props.icon} className="h-4 w-4" />
    </button>
  );
};

/*
 * Where the dialog is appended in the DOM: <body>, so no ancestor's
 * stacking context or transform can trap it - or the fullscreen element
 * while a chart or map is fullscreen, since only its subtree is painted
 * then (SideOver's rule).
 */
function getPortalTarget(): HTMLElement | null {
  if (typeof document === "undefined") {
    return null;
  }

  const fullscreenElement: Element | null = document.fullscreenElement;

  return fullscreenElement instanceof HTMLElement
    ? fullscreenElement
    : document.body;
}

/*
 * Whether this dialog is the top one: a Modal opened from inside it (an AI
 * context's View) or the command palette over it handles its own keys.
 */
function isTopmostDialog(panel: HTMLElement | null): boolean {
  if (!panel) {
    return false;
  }

  const openDialogs: Array<Element> = Array.from(
    document.querySelectorAll('[role="dialog"][aria-modal="true"]'),
  );

  return openDialogs[openDialogs.length - 1] === panel;
}

function getFocusableElements(panel: HTMLElement): Array<HTMLElement> {
  return Array.from(
    panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
  ).filter((element: HTMLElement): boolean => {
    const isRendered: boolean =
      typeof element.checkVisibility !== "function" ||
      element.checkVisibility();

    return (
      !element.hasAttribute("disabled") &&
      element.getAttribute("aria-hidden") !== "true" &&
      isRendered
    );
  });
}

interface PanelProps {
  chat: UseAiChat;
  isHistoryOpen: boolean;
  onOpenHistory: () => void;
  onCloseHistory: () => void;
  onNewChat: () => void;
  onClose: () => void;
}

/*
 * The open dialog. Mounted on every open, so its entrance, its first focus,
 * the page lock and the inert page run per open; the conversation itself
 * lives in AskAiDialog's hook and outlasts it.
 */
const AskAiDialogPanel: FunctionComponent<PanelProps> = (
  props: PanelProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const chat: UseAiChat = props.chat;
  const rootRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const panelRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const titleId: string = useId();
  const [hasEntered, setHasEntered] = useState<boolean>(false);
  const backdropPressRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  const onCloseRef: React.MutableRefObject<() => void> = useRef<() => void>(
    props.onClose,
  );
  onCloseRef.current = props.onClose;

  /*
   * Mounted in its closed state and flipped open one frame later, so the
   * browser has something to transition from; the timer opens it in a tab
   * that runs no animation frame (Modal's pattern).
   */
  useEffect(() => {
    const open: () => void = (): void => {
      setHasEntered(true);
    };

    const frame: number = requestAnimationFrame(open);
    const fallbackTimer: ReturnType<typeof setTimeout> = setTimeout(open, 80);

    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(fallbackTimer);
    };
  }, []);

  /*
   * The page behind does not scroll, and is inert: nothing there takes the
   * focus, a click or a screen reader's cursor while the dialog is up.
   * Shared, counted locks: the command palette or a Modal opened over the
   * dialog never hands the page back while it is still covered.
   */
  usePageScrollLock(true);
  usePageInert(true, rootRef);

  /*
   * The focus starts in the composer, which focuses itself as it is drawn.
   * Where there is none - AI is off for the project, the history is open -
   * it starts on the dialog itself.
   */
  useEffect(() => {
    const panel: HTMLDivElement | null = panelRef.current;

    if (panel && !panel.contains(document.activeElement)) {
      panel.focus({ preventScroll: true });
    }
  }, []);

  /*
   * Esc closes it, and Tab goes round inside it. On the window, after
   * everything inside has had the key: a menu in the dialog, a Modal over
   * it or the command palette consumes its own Esc (preventDefault), and
   * the dialog lets that one go.
   */
  useEffect(() => {
    const onKeyDown: (event: KeyboardEvent) => void = (
      event: KeyboardEvent,
    ): void => {
      const panel: HTMLDivElement | null = panelRef.current;

      if (event.defaultPrevented || !panel || !isTopmostDialog(panel)) {
        return;
      }

      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab") {
        return;
      }

      const focusable: Array<HTMLElement> = getFocusableElements(panel);

      if (focusable.length === 0) {
        event.preventDefault();
        panel.focus();
        return;
      }

      const first: HTMLElement = focusable[0]!;
      const last: HTMLElement = focusable[focusable.length - 1]!;
      const active: Element | null = document.activeElement;
      const isInside: boolean = panel.contains(active);

      if (event.shiftKey && (active === first || !isInside)) {
        event.preventDefault();
        last.focus();
      } else if (
        !event.shiftKey &&
        (active === last || active === panel || !isInside)
      ) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  const view: View = chat.unavailableReason
    ? "unavailable"
    : props.isHistoryOpen
      ? "history"
      : chat.isConversationView
        ? "conversation"
        : "home";

  const activeConversation: AIConversation | undefined =
    chat.conversations.find((conversation: AIConversation): boolean => {
      return conversation.id?.toString() === chat.activeConversationId;
    });

  const title: string =
    view === "history"
      ? (translator.translateText("All conversations") as string)
      : view === "conversation" && activeConversation?.title
        ? activeConversation.title
        : (translator.translateText("Ask AI") as string);

  const contextChip: ReactElement | undefined = chat.pageContext ? (
    <PageContextChip
      context={chat.pageContext}
      isAttached={chat.isPageContextAttached}
      onAttach={() => {
        chat.setIsPageContextAttached(true);
      }}
      onDetach={() => {
        chat.setIsPageContextAttached(false);
      }}
    />
  ) : undefined;

  /*
   * The menus of the controls open upwards from a composer at the foot of
   * the dialog, and downwards from the one in the middle of its start.
   */
  const isComposerAtTheTop: boolean = view === "home";

  const controls: ReactElement = (
    <>
      {/*
       * Only when there is a choice: a project with one LLM provider has
       * nothing to switch between, and its name on every question was a
       * chip nobody read.
       */}
      {chat.providers.length > 1 ? (
        <ProviderPicker
          providers={chat.providers}
          selectedProviderId={chat.selectedProviderId}
          onSelect={chat.setSelectedProviderId}
          menuSide={isComposerAtTheTop ? "bottom" : "top"}
        />
      ) : (
        <></>
      )}
      <PermissionModePicker
        value={chat.permissionMode}
        onChange={chat.setPermissionMode}
        disabled={chat.isWorking}
        menuAlign="left"
        menuSide={isComposerAtTheTop ? "bottom" : "top"}
      />
    </>
  );

  /*
   * The pill above the box says what the question is about; the box only
   * asks for it.
   */
  const placeholder: string | undefined =
    view === "conversation"
      ? (translator.translateText("Ask a follow-up…") as string)
      : undefined;

  const errorBanner: ReactElement = chat.error ? (
    <div
      role="alert"
      data-testid="ask-ai-error"
      className="mb-2 flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700 ring-1 ring-inset ring-rose-100"
    >
      <div className="flex h-5 flex-shrink-0 items-center">
        <Icon icon={IconProp.Error} className="h-3.5 w-3.5 text-rose-500" />
      </div>
      <span className="min-w-0 flex-1 break-words">{chat.error}</span>
      <button
        type="button"
        title={translator.translateText("Dismiss")}
        aria-label={translator.translateText("Dismiss")}
        onClick={() => {
          chat.setError("");
        }}
        className="-me-1 flex-shrink-0 rounded p-0.5 text-rose-500 transition-colors hover:bg-rose-100 hover:text-rose-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
      >
        <Icon icon={IconProp.Close} className="h-3.5 w-3.5" />
      </button>
    </div>
  ) : (
    <></>
  );

  // The composer, withheld entirely while AI is switched off.
  const composer: ReactElement = (
    <>
      {errorBanner}
      <ChatInput
        value={chat.inputValue}
        onChange={chat.setInputValue}
        canSend={
          !chat.isSending && !chat.isWorking && !chat.isAwaitingApproval
        }
        isWorking={chat.isWorking}
        isStopping={chat.isCancelling}
        onStop={
          chat.isWorking && !chat.isAwaitingApproval
            ? () => {
                chat.cancelRun().catch(() => {
                  // handled in the hook
                });
              }
            : undefined
        }
        leading={controls}
        contextChip={contextChip}
        placeholder={placeholder}
        onSend={() => {
          chat.sendMessage().catch(() => {
            // handled in the hook
          });
        }}
      />
    </>
  );

  const onBackdropMouseDown: (event: React.MouseEvent<HTMLDivElement>) => void = (
    event: React.MouseEvent<HTMLDivElement>,
  ): void => {
    backdropPressRef.current = event.target === event.currentTarget;
  };

  /*
   * A click on the page around the dialog closes it - both ends of it: a
   * drag that started in the composer (selecting text) and ended outside
   * is not a dismissal.
   */
  const onBackdropClick: (event: React.MouseEvent<HTMLDivElement>) => void = (
    event: React.MouseEvent<HTMLDivElement>,
  ): void => {
    const pressStartedOutside: boolean = backdropPressRef.current;
    backdropPressRef.current = false;

    if (pressStartedOutside && event.target === event.currentTarget) {
      props.onClose();
    }
  };

  return (
    <div ref={rootRef} className="relative z-40" data-testid="ask-ai">
      <div
        aria-hidden="true"
        data-testid="ask-ai-backdrop"
        className={`fixed inset-0 bg-gray-950/40 backdrop-blur-md transition-opacity duration-200 ease-out motion-reduce:transition-none ${
          hasEntered ? "opacity-100" : "opacity-0"
        }`}
      />
      <div
        className="fixed inset-0 flex items-stretch justify-center sm:items-center sm:p-6"
        onMouseDown={onBackdropMouseDown}
        onClick={onBackdropClick}
      >
        {/*
         * Once it has settled it carries no transform at all: a lingering
         * scale would make it the containing block for anything fixed
         * inside it (Modal's rule).
         */}
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={titleId}
          tabIndex={-1}
          data-testid="ask-ai-dialog"
          data-view={view}
          className={`relative flex h-[100dvh] w-full flex-col overflow-hidden bg-white shadow-2xl ring-1 ring-black/5 transition duration-200 ease-out focus:outline-none motion-reduce:transition-none sm:h-[min(52rem,calc(100dvh-3rem))] sm:max-w-4xl sm:rounded-2xl ${
            hasEntered
              ? "opacity-100"
              : "translate-y-4 opacity-0 sm:translate-y-2 sm:scale-[0.98]"
          }`}
        >
          <div className="flex h-14 flex-shrink-0 items-center gap-1 border-b border-gray-100 pe-2 ps-3 sm:ps-4">
            {view === "history" ? (
              <HeaderButton
                icon={IconProp.ChevronLeft}
                label={translator.translateText("Back") as string}
                onClick={props.onCloseHistory}
                testId="ask-ai-back"
              />
            ) : (
              <AskAiMark size={AskAiMarkSize.Small} />
            )}
            <h2
              id={titleId}
              data-testid="ask-ai-title"
              className="ms-1.5 min-w-0 flex-1 truncate text-sm font-semibold text-gray-900"
            >
              {/* A conversation's title reads its own way. */}
              <bdi>{title}</bdi>
            </h2>
            <div className="flex flex-shrink-0 items-center gap-0.5">
              {view === "home" || view === "conversation" ? (
                <HeaderButton
                  icon={IconProp.Clock}
                  label={translator.translateText("All conversations") as string}
                  onClick={props.onOpenHistory}
                  testId="ask-ai-history"
                />
              ) : (
                <></>
              )}
              {view === "conversation" || view === "history" ? (
                <HeaderButton
                  icon={IconProp.PencilSquare}
                  label={translator.translateText("New chat") as string}
                  onClick={props.onNewChat}
                  testId="ask-ai-new-chat"
                />
              ) : (
                <></>
              )}
              {view === "conversation" && chat.messages.length > 0 ? (
                <ChatDownloadMenu
                  title={activeConversation?.title || chat.activeConversationTitle}
                  messages={chat.messages}
                  latestRun={chat.latestRun}
                  onError={chat.setError}
                  triggerClassName={ICON_BUTTON_CLASS_NAME}
                />
              ) : (
                <></>
              )}
              <HeaderButton
                icon={IconProp.Close}
                label={translator.translateText("Close") as string}
                onClick={props.onClose}
                testId="ask-ai-close"
              />
            </div>
          </div>

          <div className="relative flex min-h-0 flex-1 flex-col">
            {view === "unavailable" && chat.unavailableReason ? (
              <div className="flex min-h-0 flex-1 overflow-y-auto overscroll-contain">
                <AIChatUnavailableView reason={chat.unavailableReason} />
              </div>
            ) : (
              <></>
            )}

            {view === "history" ? (
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                <AskAiHistory
                  conversations={chat.conversations}
                  activeConversationId={chat.activeConversationId}
                  onOpenConversation={(conversationId: string) => {
                    props.onCloseHistory();
                    chat.openConversation(conversationId);
                  }}
                  onDeleteConversation={chat.deleteConversation}
                />
              </div>
            ) : (
              <></>
            )}

            {view === "home" ? (
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
                <ChatHomeView
                  conversations={chat.conversations}
                  isSending={chat.isSending}
                  pageContext={chat.pageContext}
                  isPageContextAttached={chat.isPageContextAttached}
                  onOpenConversation={chat.openConversation}
                  onShowAllConversations={props.onOpenHistory}
                  composer={composer}
                  onAsk={(question: string) => {
                    chat.sendMessage(question).catch(() => {
                      // handled in the hook
                    });
                  }}
                />
              </div>
            ) : (
              <></>
            )}

            {view === "conversation" ? (
              <>
                {/*
                 * The conversation fades out under the composer rather than
                 * being cut off by it: there is more of it to scroll to.
                 */}
                <div className="relative min-h-0 flex-1">
                  <AskAiConversation chat={chat} />
                  <div
                    aria-hidden="true"
                    className="ou-ai-fade-out pointer-events-none absolute inset-x-0 bottom-0 h-6"
                  ></div>
                </div>
                {/*
                 * As wide as the conversation's text above it, so the
                 * question and the answers line up with the box they are
                 * written in.
                 */}
                <div className="flex-shrink-0 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-1 sm:pb-5">
                  <div className="mx-auto w-full max-w-3xl px-4 sm:px-6">
                    {composer}
                  </div>
                </div>
              </>
            ) : (
              <></>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

/*
 * The host: mounted once, for the whole app, at its root. It hears every
 * way in, keeps the conversation, and draws the dialog while it is open.
 */
const AskAiDialog: FunctionComponent = (): ReactElement => {
  const location: ReturnType<typeof useLocation> = useLocation();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [hasBeenOpened, setHasBeenOpened] = useState<boolean>(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState<boolean>(false);
  const [hasUnreadAnswer, setHasUnreadAnswer] = useState<boolean>(false);
  const [isResumeDismissed, setIsResumeDismissed] = useState<boolean>(false);

  const chat: UseAiChat = useAiChat({
    enabled: hasBeenOpened,
    isVisible: isOpen,
  });

  /*
   * The listeners mount once; refs keep them pointed at the CURRENT chat
   * and open state.
   */
  const chatRef: React.MutableRefObject<UseAiChat> = useRef<UseAiChat>(chat);
  chatRef.current = chat;
  const isOpenRef: React.MutableRefObject<boolean> = useRef<boolean>(isOpen);
  isOpenRef.current = isOpen;

  // What had the focus when Ask AI opened, to give it back on close.
  const openerRef: React.MutableRefObject<HTMLElement | null> =
    useRef<HTMLElement | null>(null);
  // The page the dialog is open over, and the page shown now.
  const openPathRef: React.MutableRefObject<string> = useRef<string>(
    location.pathname,
  );
  const pathnameRef: React.MutableRefObject<string> = useRef<string>(
    location.pathname,
  );
  pathnameRef.current = location.pathname;
  /*
   * The chat's own address is passing the browser on to the page under the
   * dialog: that one navigation is not the person leaving.
   */
  const isForwardingRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  const open: (request: AskAiRequest) => void = useCallback(
    (request: AskAiRequest): void => {
      if (!isOpenRef.current) {
        openerRef.current =
          document.activeElement instanceof HTMLElement
            ? document.activeElement
            : null;
        openPathRef.current = pathnameRef.current;
      }

      if (request.isForwarded) {
        isForwardingRef.current = true;
      }

      setHasBeenOpened(true);
      setIsOpen(true);
      setHasUnreadAnswer(false);
      setIsResumeDismissed(false);

      if (request.conversationId) {
        setIsHistoryOpen(false);
        chatRef.current.openConversation(request.conversationId);
        return;
      }

      /*
       * A prepared question - an error pattern's evidence, a case to ask
       * about - is a new subject: it starts a new conversation, in the
       * composer, for the person to read before it is sent.
       */
      if (request.prompt) {
        setIsHistoryOpen(false);
        chatRef.current.newConversation();
        chatRef.current.setInputValue(request.prompt);
      }
    },
    [],
  );

  const close: () => void = useCallback((): void => {
    isForwardingRef.current = false;
    setIsOpen(false);
    setIsHistoryOpen(false);
  }, []);

  const toggle: () => void = useCallback((): void => {
    if (isOpenRef.current) {
      close();
      return;
    }

    open({});
  }, [open, close]);

  // A request made before the dialog was listening.
  useEffect(() => {
    const pending: AskAiRequest | null = takePendingAskAiRequest();

    if (pending) {
      open(pending);
    }
  }, [open]);

  // Every way in: the AI_CHAT_TOGGLE event (AskAiEvents).
  useEffect(() => {
    const onToggle: (event: CustomEvent) => void = (
      event: CustomEvent,
    ): void => {
      const read: AskAiEventRead = readAskAiEvent(event);

      // This request is handled: it is no longer waiting for the dialog.
      takePendingAskAiRequest();

      if (read.isToggle) {
        toggle();
        return;
      }

      open(read.request);
    };

    GlobalEvents.addEventListener(EventName.AI_CHAT_TOGGLE, onToggle);

    return () => {
      GlobalEvents.removeEventListener(EventName.AI_CHAT_TOGGLE, onToggle);
    };
  }, [open, toggle]);

  // Cmd/Ctrl + I opens Ask AI from anywhere — keyboard operators included.
  useEffect(() => {
    const onKeyDown: (event: KeyboardEvent) => void = (
      event: KeyboardEvent,
    ): void => {
      if (
        !(event.metaKey || event.ctrlKey) ||
        event.shiftKey ||
        event.altKey ||
        event.key.toLowerCase() !== "i" ||
        event.defaultPrevented
      ) {
        return;
      }

      /*
       * Cmd/Ctrl+I is also the universal italics shortcut: while the user is
       * typing in any input, textarea, or rich-text editor, leave the event
       * alone so note/postmortem editors keep their formatting shortcut.
       * Ask AI's own composer has no italics: there, the keys close it.
       */
      const target: HTMLElement | null = event.target as HTMLElement | null;
      const isInAskAi: boolean = Boolean(
        target?.closest?.('[data-testid="ask-ai-dialog"]'),
      );

      if (
        target &&
        !isInAskAi &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      event.preventDefault();
      toggle();
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [toggle]);

  /*
   * Opening something from inside the dialog - a source, a card's Open, a
   * settings link - moves the page under it: the dialog steps aside so the
   * page is seen, and the conversation waits for the person to come back.
   */
  useEffect(() => {
    if (!isOpen) {
      openPathRef.current = location.pathname;
      return;
    }

    if (location.pathname === openPathRef.current) {
      return;
    }

    openPathRef.current = location.pathname;

    if (isForwardingRef.current) {
      isForwardingRef.current = false;
      return;
    }

    close();
  }, [location.pathname, isOpen, close]);

  /*
   * The focus goes back to what opened the dialog, once it has closed - if
   * that is still on the page (a source opened from the dialog took the
   * person to another one).
   */
  const wasOpenRef: React.MutableRefObject<boolean> = useRef<boolean>(false);

  useEffect(() => {
    if (wasOpenRef.current && !isOpen) {
      const opener: HTMLElement | null = openerRef.current;
      openerRef.current = null;

      if (opener?.isConnected && !opener.closest("[inert]")) {
        opener.focus({ preventScroll: true });
      }
    }

    wasOpenRef.current = isOpen;
  }, [isOpen]);

  // An answer that came in while the dialog was closed is waiting to be read.
  const wasWorkingRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);

  useEffect(() => {
    if (wasWorkingRef.current && !chat.isWorking && !isOpenRef.current) {
      setHasUnreadAnswer(true);
    }

    wasWorkingRef.current = chat.isWorking;
  }, [chat.isWorking]);

  const isResumeShown: boolean =
    !isOpen &&
    !isResumeDismissed &&
    Boolean(chat.activeConversationId) &&
    !chat.unavailableReason &&
    (chat.isWorking || hasUnreadAnswer);

  const portalTarget: HTMLElement | null = isOpen ? getPortalTarget() : null;

  return (
    <>
      {isOpen && portalTarget ? (
        createPortal(
          <AskAiDialogPanel
            chat={chat}
            isHistoryOpen={isHistoryOpen}
            onOpenHistory={() => {
              setIsHistoryOpen(true);
            }}
            onCloseHistory={() => {
              setIsHistoryOpen(false);
            }}
            onNewChat={() => {
              setIsHistoryOpen(false);
              chat.newConversation();
            }}
            onClose={close}
          />,
          portalTarget,
        )
      ) : (
        <></>
      )}
      {isResumeShown ? (
        <AskAiResumeButton
          isWorking={chat.isWorking}
          onOpen={() => {
            open({});
          }}
          onDismiss={() => {
            setIsResumeDismissed(true);
          }}
        />
      ) : (
        <></>
      )}
    </>
  );
};

export default AskAiDialog;
