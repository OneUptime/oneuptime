import AIConversation from "Common/Models/DatabaseModels/AIConversation";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import GlobalEvents from "Common/UI/Utils/GlobalEvents";
import { movePageDock, usePageDock } from "Common/UI/Utils/PageDock";
import { usePageInert } from "Common/UI/Utils/PageInert";
import { usePageScrollLock } from "Common/UI/Utils/PageScrollLock";
import { translationKey, Translator } from "Common/UI/Utils/TranslateTemplate";
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
import {
  ASK_AI_PANEL_DEFAULT_WIDTH,
  ASK_AI_PANEL_MIN_WIDTH,
  canDockAskAi,
  clampAskAiPanelWidth,
  forgetAskAiPanelWidth,
  getAskAiPanelMaxWidth,
  readAskAiPanelWidth,
  rememberAskAiPanelWidth,
  useWindowWidth,
} from "./AskAiPanelLayout";
import AskAiResizeHandle from "./AskAiResizeHandle";
import AskAiResumeButton from "./AskAiResumeButton";
import {
  AskAiEventRead,
  AskAiRequest,
  publishIsAskAiOpen,
  readAskAiEvent,
  takePendingAskAiRequest,
} from "./AskAiEvents";
import ChatDownloadMenu from "./ChatDownloadMenu";
import ChatHomeView from "./ChatHomeView";
import ChatInput from "./ChatInput";
import PageContextChip from "./PageContextChip";
import PermissionModePicker from "./PermissionModePicker";
import ProviderPicker from "./ProviderPicker";
import {
  getTitleDirection,
  PAGE_START_ALIGN_CLASS_NAME,
} from "./TitleDirection";
import { useAiChat, UseAiChat } from "./useAiChat";

/*
 * ASK AI, BESIDE THE PAGE.
 *
 * Ask AI is a power tool: asked about what is on screen while the person keeps
 * working on it. It was a dialog in the middle of the screen, over a dimmed,
 * blurred and inert page, so every look at the page meant closing it. It is
 * docked at the side of the window now, and the page is still all there.
 *
 * - The page makes room for it (PageDock), and nothing is behind it: the page
 *   lays itself out in what is left, and keeps its scrolling, links and keys.
 *   Nothing dims the page or locks it, and nothing closes Ask AI but asking:
 *   a click on the page is a click on the page.
 * - It stays while the person moves around. Whatever opens from inside it - a
 *   source, a card's Open - opens in the page beside it, and the question it
 *   asks about next follows the page on screen (the composer's context pill).
 * - Its edge drags to the width the work needs, and that width is kept for the
 *   next time (AskAiResizeHandle). The page always keeps its own room.
 * - The focus belongs to the person. It moves in when Ask AI opens, and Esc
 *   closes it only from inside it. From the page, Ctrl/Cmd + I goes back to
 *   its composer, and from there closes it, giving the focus back to what had
 *   it. Tab goes in and out of it as through any part of the page.
 * - Where the window has no room for both (a tablet, a phone) it is a sheet
 *   over the page, and only there a real dialog: the focus stays inside, the
 *   page behind it is inert and still, and what opens from inside it closes
 *   it, so the page opened is seen.
 * - Every way in reaches it (AskAiEvents): the header's Ask AI, Ctrl/Cmd + I,
 *   the command palette, the "Explain with AI" and "Ask about this case"
 *   buttons on pages, and the chat's own address (Products -> AI -> Chat),
 *   which opens it beside the page the person came from.
 * - Closing it loses nothing: the conversation is there when it opens again,
 *   and an answer still being written when it closed says when it is ready
 *   (AskAiResumeButton).
 * - It is quiet: the composer stays at its foot in every view, an answer leads,
 *   its work is one line that opens into its steps, and its sources, the time
 *   and its actions sit on one row under it.
 */

const ICON_BUTTON_CLASS_NAME: string =
  "flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500";

// Every element a Tab can land on, as Modal reads them.
const FOCUSABLE_SELECTOR: string =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

const PANEL_SELECTOR: string = '[data-testid="ask-ai-panel"]';

const COMPOSER_TEXT_BOX_SELECTOR: string =
  '[data-testid="ai-chat-composer"] textarea';

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
 * Where the panel is appended in the DOM: <body>, so no ancestor's stacking
 * context or transform can trap it - or the fullscreen element while a chart
 * or map is fullscreen, since only its subtree is painted then (SideOver's
 * rule).
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
 * Whether the sheet is the top dialog: a Modal opened from inside it (an AI
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

function findOpenPanel(): HTMLElement | null {
  return document.querySelector<HTMLElement>(PANEL_SELECTOR);
}

// Whether a modal dialog is up, Ask AI's own sheet aside.
function hasOpenDialogOtherThan(panel: HTMLElement | null): boolean {
  return Array.from(
    document.querySelectorAll('[role="dialog"][aria-modal="true"]'),
  ).some((dialog: Element): boolean => {
    return dialog !== panel;
  });
}

interface PanelProps {
  chat: UseAiChat;
  // Beside the page, or a sheet over it on a window with no room for both.
  isDocked: boolean;
  width: number;
  minWidth: number;
  maxWidth: number;
  onWidthChosen: (width: number) => void;
  onWidthReset: () => void;
  isHistoryOpen: boolean;
  onOpenHistory: () => void;
  onCloseHistory: () => void;
  onNewChat: () => void;
  onClose: () => void;
}

/*
 * The open panel. Mounted on every open, so its entrance and its first focus
 * run per open; the conversation itself lives in AskAiPanel's hook and outlasts
 * it. Crossing the width where the window has room for both changes how it sits
 * and leaves everything in it as it was.
 */
const AskAiPanelSurface: FunctionComponent<PanelProps> = (
  props: PanelProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const chat: UseAiChat = props.chat;
  const rootRef: React.RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);
  const panelRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const titleId: string = useId();
  const [hasEntered, setHasEntered] = useState<boolean>(false);

  const onCloseRef: React.MutableRefObject<() => void> = useRef<() => void>(
    props.onClose,
  );
  onCloseRef.current = props.onClose;
  const isDockedRef: React.MutableRefObject<boolean> = useRef<boolean>(
    props.isDocked,
  );
  isDockedRef.current = props.isDocked;

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
   * Docked, the page makes room and is left alone: it scrolls and answers as
   * it always does. As a sheet there is no room for the page beside it: the
   * page does not scroll, and is inert - nothing there takes the focus, a
   * click or a screen reader's cursor. Shared, counted locks: the command
   * palette or a Modal opened over the sheet never hands the page back while
   * it is still covered.
   */
  usePageDock(props.isDocked ? props.width : null);
  usePageScrollLock(!props.isDocked);
  usePageInert(!props.isDocked, rootRef);

  /*
   * The focus starts in the composer, which focuses itself as it is drawn.
   * Where there is none - AI is off for the project, the history is open -
   * it starts on the panel itself.
   */
  useEffect(() => {
    const panel: HTMLDivElement | null = panelRef.current;

    if (panel && !panel.contains(document.activeElement)) {
      panel.focus({ preventScroll: true });
    }
  }, []);

  /*
   * Esc closes it from inside it: docked, the key is the page's anywhere else,
   * and a page's own Esc never takes Ask AI with it. As a sheet, Tab also goes
   * round inside it. On the window, after everything inside has had the key: a
   * menu in the panel, a Modal over it or the command palette consumes its own
   * Esc (preventDefault), and the panel lets that one go.
   */
  useEffect(() => {
    const onKeyDown: (event: KeyboardEvent) => void = (
      event: KeyboardEvent,
    ): void => {
      const panel: HTMLDivElement | null = panelRef.current;

      if (event.defaultPrevented || !panel) {
        return;
      }

      if (isDockedRef.current) {
        if (event.key === "Escape" && panel.contains(document.activeElement)) {
          event.preventDefault();
          onCloseRef.current();
        }

        return;
      }

      if (!isTopmostDialog(panel)) {
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

  /*
   * A view drawn from a button in the view before it - a suggestion, a recent
   * conversation, New chat - takes that button away with the focus on it, and
   * the focus would fall out of the panel onto the page's body, losing a screen
   * reader's place.
   *
   * The history has no composer: the focus goes to the first conversation -
   * what the history is opened for - or to Back when there is none, and comes
   * back there when the last conversation is deleted. Anywhere else it goes
   * back to the composer the next question is typed in. Focus the person has
   * put elsewhere, on the page beside the panel, stays there.
   */
  const historyViewRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const previousViewRef: React.MutableRefObject<View> = useRef<View>(view);

  useEffect(() => {
    const previousView: View = previousViewRef.current;
    previousViewRef.current = view;

    const panel: HTMLDivElement | null = panelRef.current;

    if (!panel) {
      return;
    }

    const active: Element | null = document.activeElement;
    const isFocusLost: boolean = !active || active === document.body;

    if (view === "history") {
      if (previousView === "history" && !isFocusLost) {
        return;
      }

      const target: HTMLElement | null =
        historyViewRef.current?.querySelector<HTMLElement>(
          '[data-testid="ai-chat-history"] button',
        ) || panel.querySelector<HTMLElement>('[data-testid="ask-ai-back"]');

      target?.focus({ preventScroll: true });
      return;
    }

    if (previousView !== view && isFocusLost) {
      panel
        .querySelector<HTMLElement>(COMPOSER_TEXT_BOX_SELECTOR)
        ?.focus({ preventScroll: true });
    }
  }, [view, chat.conversations.length]);

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
        />
      ) : (
        <></>
      )}
      <PermissionModePicker
        value={chat.permissionMode}
        onChange={chat.setPermissionMode}
        disabled={chat.isWorking}
        menuAlign="left"
      />
    </>
  );

  /*
   * The pill above the box says what the question is about; the box only
   * asks for it. In English: ChatInput looks it up, once (#7682).
   */
  const placeholder: string | undefined =
    view === "conversation" ? translationKey("Ask a follow-up…") : undefined;

  const errorBanner: ReactElement = chat.error ? (
    <div
      role="alert"
      data-testid="ask-ai-error"
      className="mb-2 flex items-start gap-2 rounded-lg bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700 ring-1 ring-inset ring-rose-200"
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
        canSend={!chat.isSending && !chat.isWorking && !chat.isAwaitingApproval}
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

  const onBackdropClick: () => void = (): void => {
    props.onClose();
  };

  return (
    <div
      ref={rootRef}
      className="relative z-40 print:hidden"
      data-testid="ask-ai"
    >
      {props.isDocked ? (
        <></>
      ) : (
        /*
         * Only as a sheet over the page, and only where any of the page shows
         * round it (from sm up): a click beside it goes back to the page.
         */
        <div
          aria-hidden="true"
          data-testid="ask-ai-backdrop"
          onClick={onBackdropClick}
          className={`fixed inset-0 bg-gray-950/40 transition-opacity duration-200 ease-out motion-reduce:transition-none ${
            hasEntered ? "opacity-100" : "opacity-0"
          }`}
        />
      )}
      {/*
       * Once it has settled it carries no transform at all: a lingering
       * translate would make it the containing block for anything fixed
       * inside it (Modal's rule).
       */}
      <div
        ref={panelRef}
        role={props.isDocked ? "complementary" : "dialog"}
        aria-modal={props.isDocked ? undefined : "true"}
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid="ask-ai-panel"
        data-docked={props.isDocked ? "true" : "false"}
        data-view={view}
        style={props.isDocked ? { width: `${props.width}px` } : undefined}
        className={`fixed flex flex-col border-gray-200 bg-white transition duration-200 ease-out [&_*]:[scrollbar-width:thin] focus:outline-none motion-reduce:transition-none ${
          props.isDocked
            ? "inset-y-0 end-0 border-s"
            : "inset-0 sm:start-auto sm:w-[28rem] sm:border-s sm:shadow-2xl"
        } ${
          hasEntered
            ? "opacity-100"
            : "translate-x-4 opacity-0 [&:dir(rtl)]:-translate-x-4"
        }`}
      >
        {props.isDocked ? (
          <AskAiResizeHandle
            width={props.width}
            minWidth={props.minWidth}
            maxWidth={props.maxWidth}
            onResize={(width: number) => {
              const panel: HTMLDivElement | null = panelRef.current;

              if (panel) {
                panel.style.width = `${width}px`;
              }

              movePageDock(width);
            }}
            onResizeEnd={props.onWidthChosen}
            onReset={props.onWidthReset}
          />
        ) : (
          <></>
        )}

        {/* As tall as the page's own header, so the two read as one line. */}
        <div className="flex h-16 flex-shrink-0 items-center gap-1 border-b border-gray-100 pe-2 ps-4">
          {view === "history" ? (
            <div className="-ms-1.5">
              <HeaderButton
                icon={IconProp.ChevronLeft}
                label={translator.translateText("Back") as string}
                onClick={props.onCloseHistory}
                testId="ask-ai-back"
              />
            </div>
          ) : (
            <AskAiMark size={AskAiMarkSize.Small} />
          )}
          {/*
           * A conversation's title reads its own way - an English one on
           * a Persian page is cut at its end ("Why did checkout…"), not
           * at its start - and stands beside the mark, where the page
           * reads from (TitleDirection).
           */}
          <h2
            id={titleId}
            dir={getTitleDirection(title)}
            data-testid="ask-ai-title"
            className={`ms-1.5 min-w-0 flex-1 truncate text-sm font-semibold text-gray-900 ${PAGE_START_ALIGN_CLASS_NAME}`}
          >
            {title}
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
                title={
                  activeConversation?.title || chat.activeConversationTitle
                }
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
            <div
              ref={historyViewRef}
              className="min-h-0 flex-1 overflow-y-auto overscroll-contain"
            >
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

          {view === "home" || view === "conversation" ? (
            <>
              {/*
               * What was said fades out under the composer rather than being
               * cut off by it: there is more of it to scroll to.
               */}
              <div className="relative min-h-0 flex-1">
                {view === "home" ? (
                  <div className="h-full overflow-y-auto overscroll-contain">
                    <ChatHomeView
                      conversations={chat.conversations}
                      isSending={chat.isSending}
                      pageContext={chat.pageContext}
                      isPageContextAttached={chat.isPageContextAttached}
                      onOpenConversation={chat.openConversation}
                      onShowAllConversations={props.onOpenHistory}
                      onAsk={(question: string) => {
                        chat.sendMessage(question).catch(() => {
                          // handled in the hook
                        });
                      }}
                    />
                  </div>
                ) : (
                  <AskAiConversation chat={chat} />
                )}
                <div
                  aria-hidden="true"
                  className="ou-ai-fade-out pointer-events-none absolute inset-x-0 bottom-0 h-6"
                ></div>
              </div>
              {/*
               * At the foot of the panel in both views, the same box: the first
               * question goes where the next will, nothing jumps as it is sent,
               * and it is as wide as the text above it, so the question and
               * the answers line up with the box they are written in.
               */}
              <div className="flex-shrink-0 pb-[max(1rem,env(safe-area-inset-bottom))] pt-1">
                <div className="mx-auto w-full max-w-3xl px-4">{composer}</div>
              </div>
            </>
          ) : (
            <></>
          )}
        </div>
      </div>
    </div>
  );
};

/*
 * The host: mounted once, for the whole app, at its root. It hears every
 * way in, keeps the conversation, and draws the panel while it is open.
 */
const AskAiPanel: FunctionComponent = (): ReactElement => {
  const location: ReturnType<typeof useLocation> = useLocation();
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [hasBeenOpened, setHasBeenOpened] = useState<boolean>(false);
  const [isHistoryOpen, setIsHistoryOpen] = useState<boolean>(false);
  const [hasUnreadAnswer, setHasUnreadAnswer] = useState<boolean>(false);
  const [isResumeDismissed, setIsResumeDismissed] = useState<boolean>(false);
  // The width the person chose; what it can be in this window is worked out.
  const [chosenWidth, setChosenWidth] = useState<number>(readAskAiPanelWidth);
  const windowWidth: number = useWindowWidth();
  const isDocked: boolean = canDockAskAi(windowWidth);

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
  const isDockedRef: React.MutableRefObject<boolean> =
    useRef<boolean>(isDocked);
  isDockedRef.current = isDocked;

  // What had the focus when Ask AI opened, to give it back on close.
  const openerRef: React.MutableRefObject<HTMLElement | null> =
    useRef<HTMLElement | null>(null);
  // Whether the focus was Ask AI's to give back when it closed.
  const shouldGiveFocusBackRef: React.MutableRefObject<boolean> =
    useRef<boolean>(false);
  // The page the panel is open on, and the page shown now.
  const openPathRef: React.MutableRefObject<string> = useRef<string>(
    location.pathname,
  );
  const pathnameRef: React.MutableRefObject<string> = useRef<string>(
    location.pathname,
  );
  pathnameRef.current = location.pathname;
  /*
   * The chat's own address is passing the browser on to the page beside the
   * panel: as a sheet too, that one navigation is not the person leaving.
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

      /*
       * Already open beside the page, the panel stays mounted and its composer
       * does not focus itself again: asked from a button on the page, this is
       * where the person goes next, to read what is there and send it.
       */
      findOpenPanel()
        ?.querySelector<HTMLElement>(COMPOSER_TEXT_BOX_SELECTOR)
        ?.focus({ preventScroll: true });

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
    /*
     * Given back only if it is Ask AI's to give: docked, the person may be
     * working in the page beside it, and the header's Ask AI pressed from
     * there is no reason to take them back to wherever they first opened it.
     */
    const active: Element | null = document.activeElement;

    shouldGiveFocusBackRef.current =
      !active ||
      active === document.body ||
      Boolean(findOpenPanel()?.contains(active));
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

  // A request made before the panel was listening.
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

      // This request is handled: it is no longer waiting for the panel.
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
      const isInAskAi: boolean = Boolean(target?.closest?.(PANEL_SELECTOR));

      if (
        target &&
        !isInAskAi &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable)
      ) {
        return;
      }

      const panel: HTMLElement | null = findOpenPanel();

      // A dialog over the page keeps the focus it is holding, and these keys.
      if (hasOpenDialogOtherThan(panel)) {
        return;
      }

      event.preventDefault();

      /*
       * Open and docked, with the person working in the page beside it: the
       * keys go back to the composer, to ask the next question. From inside
       * Ask AI they close it, so the same keys go there and back.
       */
      if (
        isOpenRef.current &&
        isDockedRef.current &&
        panel &&
        !panel.contains(document.activeElement)
      ) {
        (
          panel.querySelector<HTMLElement>(COMPOSER_TEXT_BOX_SELECTOR) || panel
        ).focus({ preventScroll: true });
        return;
      }

      toggle();
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [toggle]);

  /*
   * Docked, Ask AI stays while the page beside it moves: that is what it is
   * there for, and the question it asks next follows the page (useAiChat).
   * As a sheet it covers the page, so opening something from inside it - a
   * source, a card's Open, a settings link - steps it aside for the page to be
   * seen, and the conversation waits for the person to come back.
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

    if (!isDockedRef.current) {
      close();
    }
  }, [location.pathname, isOpen, close]);

  /*
   * The focus goes back to what opened the panel, once it has closed - if that
   * is still on the page (the person has moved on to another since), and if
   * it was the panel's to give back at all.
   */
  const wasOpenRef: React.MutableRefObject<boolean> = useRef<boolean>(false);

  useEffect(() => {
    if (wasOpenRef.current && !isOpen) {
      const opener: HTMLElement | null = openerRef.current;
      openerRef.current = null;

      if (
        shouldGiveFocusBackRef.current &&
        opener?.isConnected &&
        !opener.closest("[inert]")
      ) {
        opener.focus({ preventScroll: true });
      }
    }

    wasOpenRef.current = isOpen;
  }, [isOpen]);

  // Lets the header's Ask AI show whether it is open (AskAiEvents).
  useEffect(() => {
    publishIsAskAiOpen(isOpen);
  }, [isOpen]);

  useEffect(() => {
    return () => {
      publishIsAskAiOpen(false);
    };
  }, []);

  // An answer that came in while the panel was closed is waiting to be read.
  const wasWorkingRef: React.MutableRefObject<boolean> = useRef<boolean>(false);

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
          <AskAiPanelSurface
            chat={chat}
            isDocked={isDocked}
            width={clampAskAiPanelWidth(chosenWidth, windowWidth)}
            minWidth={ASK_AI_PANEL_MIN_WIDTH}
            maxWidth={getAskAiPanelMaxWidth(windowWidth)}
            onWidthChosen={(width: number) => {
              setChosenWidth(width);
              rememberAskAiPanelWidth(width);
            }}
            onWidthReset={() => {
              setChosenWidth(ASK_AI_PANEL_DEFAULT_WIDTH);
              forgetAskAiPanelWidth();
            }}
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

export default AskAiPanel;
