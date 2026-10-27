import AIConversation from "Common/Models/DatabaseModels/AIConversation";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import {
  getTitleDirection,
  PAGE_START_ALIGN_CLASS_NAME,
} from "./TitleDirection";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

export interface ComponentProps {
  conversations: Array<AIConversation>;
  activeConversationId: string | undefined;
  onOpenConversation: (conversationId: string) => void;
  onDeleteConversation: (conversationId: string) => void;
}

/*
 * Every conversation the person had with Ask AI in this project, newest
 * first: pick one up where it was left, or delete it. Conversations are
 * personal - the server returns only the reader's own.
 *
 * Deleting asks once, in the row: the bin turns the row's end into Delete
 * and Cancel. One click on a bin that shows on every row a pointer passes
 * over deleted a conversation for good, with no way back. Esc (or Cancel)
 * keeps it, and leaves the dialog open; after a delete the focus moves to
 * the row that took its place.
 */
const AskAiHistory: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  // The conversation whose row asks whether to delete it.
  const [confirmingId, setConfirmingId] = useState<string | null>(null);
  // Each row's open button and bin, to put the focus back on.
  const openButtonsRef: React.MutableRefObject<Map<string, HTMLButtonElement>> =
    useRef<Map<string, HTMLButtonElement>>(new Map());
  const binButtonsRef: React.MutableRefObject<Map<string, HTMLButtonElement>> =
    useRef<Map<string, HTMLButtonElement>>(new Map());
  const cancelButtonRef: React.RefObject<HTMLButtonElement> =
    useRef<HTMLButtonElement>(null);
  // Where the row deleted last stood, to give its place the focus.
  const deletedIndexRef: React.MutableRefObject<number | null> = useRef<
    number | null
  >(null);
  // The bin of a row whose question was taken back, to give it the focus.
  const keptIdRef: React.MutableRefObject<string | null> = useRef<
    string | null
  >(null);

  // Asked, the focus goes to Cancel: an Enter pressed twice keeps it.
  useEffect(() => {
    if (confirmingId) {
      cancelButtonRef.current?.focus();
      return;
    }

    const keptId: string | null = keptIdRef.current;
    keptIdRef.current = null;

    if (keptId) {
      binButtonsRef.current.get(keptId)?.focus();
    }
  }, [confirmingId]);

  useEffect(() => {
    const deletedIndex: number | null = deletedIndexRef.current;

    if (deletedIndex === null) {
      return;
    }

    deletedIndexRef.current = null;

    const next: AIConversation | undefined =
      props.conversations[
        Math.min(deletedIndex, props.conversations.length - 1)
      ];
    const nextId: string = next?.id?.toString() || "";

    // None left: the dialog gives the focus to Back.
    openButtonsRef.current.get(nextId)?.focus();
  }, [props.conversations]);

  if (props.conversations.length === 0) {
    return (
      <div
        data-testid="ai-chat-history-empty"
        className="flex h-full flex-col items-center justify-center px-6 py-16 text-center"
      >
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-gray-100">
          <Icon
            icon={IconProp.ChatBubbleOvalLeft}
            className="h-5 w-5 text-gray-400"
          />
        </div>
        <p className="mt-3 text-sm text-gray-500">
          {translator.translateText("No conversations yet.")}
        </p>
      </div>
    );
  }

  const keep: (conversationId: string) => void = (
    conversationId: string,
  ): void => {
    keptIdRef.current = conversationId;
    setConfirmingId(null);
  };

  return (
    <div className="mx-auto w-full max-w-2xl px-3 py-4 sm:px-4">
      <ul role="list" data-testid="ai-chat-history" className="space-y-px">
        {props.conversations.map(
          (conversation: AIConversation, index: number): ReactElement => {
            const conversationId: string = conversation.id?.toString() || "";
            const title: string =
              conversation.title ||
              (translator.translateText("Untitled conversation") as string);
            const isActive: boolean =
              conversationId === props.activeConversationId;
            const isConfirming: boolean = confirmingId === conversationId;
            const deleteLabel: string = translator.translateTemplate(
              "Delete conversation: {{title}}",
              { title: title },
            ) as string;

            return (
              <li
                key={conversationId}
                data-testid="ai-chat-history-row"
                data-confirming={isConfirming ? "true" : undefined}
                className={`group flex items-center gap-1 rounded-lg transition-colors ${
                  isConfirming
                    ? "bg-rose-50"
                    : `hover:bg-gray-50 ${isActive ? "bg-gray-50" : ""}`
                }`}
              >
                <button
                  ref={(element: HTMLButtonElement | null) => {
                    if (element) {
                      openButtonsRef.current.set(conversationId, element);
                    } else {
                      openButtonsRef.current.delete(conversationId);
                    }
                  }}
                  type="button"
                  aria-current={isActive ? "true" : undefined}
                  onClick={() => {
                    setConfirmingId(null);
                    props.onOpenConversation(conversationId);
                  }}
                  className="flex min-w-0 flex-1 items-center gap-3 rounded-lg px-3 py-2.5 text-start focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
                >
                  <Icon
                    icon={IconProp.ChatBubbleOvalLeft}
                    className="h-4 w-4 flex-shrink-0 text-gray-400"
                  />
                  {/*
                   * Read its own way, cut at its own end, beside its icon
                   * (TitleDirection).
                   */}
                  <span
                    dir={getTitleDirection(title)}
                    className={`min-w-0 flex-1 truncate text-sm ${PAGE_START_ALIGN_CLASS_NAME} ${
                      isActive
                        ? "font-medium text-gray-900"
                        : "text-gray-700 group-hover:text-gray-900"
                    }`}
                  >
                    {title}
                  </span>
                  {/* The row's end makes room for the question. */}
                  {conversation.lastMessageAt && !isConfirming ? (
                    <span className="flex-shrink-0 text-xs text-gray-400">
                      {OneUptimeDate.fromNow(conversation.lastMessageAt)}
                    </span>
                  ) : (
                    <></>
                  )}
                </button>
                {isConfirming ? (
                  /*
                   * Named after the conversation it decides, as the bin
                   * is: "Cancel" alone would not say what it keeps.
                   */
                  <div
                    role="group"
                    aria-label={deleteLabel}
                    data-testid="ai-chat-history-confirm"
                    onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => {
                      // Esc keeps the conversation, and the dialog open.
                      if (event.key === "Escape") {
                        event.preventDefault();
                        keep(conversationId);
                      }
                    }}
                    className="flex flex-shrink-0 items-center gap-0.5 pe-1"
                  >
                    {/*
                     * Delete first and Cancel at the row's end, where the
                     * bin was: a double click on the bin lands on Cancel.
                     */}
                    <button
                      type="button"
                      data-testid="ai-chat-history-delete"
                      onClick={() => {
                        deletedIndexRef.current = index;
                        setConfirmingId(null);
                        props.onDeleteConversation(conversationId);
                      }}
                      className="rounded-md px-2 py-1 text-xs font-semibold text-rose-600 transition-colors hover:bg-rose-100 hover:text-rose-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    >
                      {translator.translateText("Delete")}
                    </button>
                    <button
                      ref={cancelButtonRef}
                      type="button"
                      data-testid="ai-chat-history-cancel"
                      onClick={() => {
                        keep(conversationId);
                      }}
                      className="rounded-md px-2 py-1 text-xs font-medium text-gray-600 transition-colors hover:bg-white hover:text-gray-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                    >
                      {translator.translateText("Cancel")}
                    </button>
                  </div>
                ) : (
                  /*
                   * Delete shows on the row a pointer or the keyboard is
                   * on, and always on a phone, which has neither hover
                   * nor a pointer to point with.
                   */
                  <button
                    ref={(element: HTMLButtonElement | null) => {
                      if (element) {
                        binButtonsRef.current.set(conversationId, element);
                      } else {
                        binButtonsRef.current.delete(conversationId);
                      }
                    }}
                    type="button"
                    title={translator.translateText("Delete conversation")}
                    aria-label={deleteLabel}
                    onClick={() => {
                      setConfirmingId(conversationId);
                    }}
                    className="me-1 flex-shrink-0 rounded-md p-1.5 text-gray-400 transition-colors hover:bg-rose-50 hover:text-rose-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 sm:opacity-0 sm:focus:opacity-100 sm:group-hover:opacity-100 sm:group-focus-within:opacity-100"
                  >
                    <Icon icon={IconProp.Trash} className="h-3.5 w-3.5" />
                  </button>
                )}
              </li>
            );
          },
        )}
      </ul>
    </div>
  );
};

export default AskAiHistory;
