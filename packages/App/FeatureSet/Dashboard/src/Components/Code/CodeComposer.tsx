import CodeContextModal, { CodeContextDraft } from "./CodeContextModal";
import {
  CODE_TASK_CONTEXT_KINDS,
  CODE_TASK_CONTEXT_MENU_ORDER,
} from "./CodeTaskCopy";
import {
  CODE_TASK_LIMITS,
  CodeTaskContextInput,
  CodeTaskContextInputUtil,
  CodeTaskContextType,
} from "Common/Types/AI/CodeTask";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import MoreMenu from "Common/UI/Components/MoreMenu/MoreMenu";
import MoreMenuItem from "Common/UI/Components/MoreMenu/MoreMenuItem";
import MoreMenuSection from "Common/UI/Components/MoreMenu/MoreMenuSection";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import API from "Common/UI/Utils/API/API";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

export interface ComponentProps {
  // In the reader's language: the caller translates them.
  placeholder: string;
  label: string;
  sendLabel: string;
  /*
   * Sends the request with its context; resolves once it is accepted. On a
   * refusal it throws, and the composer keeps what was typed and says why.
   */
  onSend: (data: {
    message: string;
    context: Array<CodeTaskContextInput>;
  }) => Promise<void>;
  /*
   * Why the person cannot send now, when they cannot: the composer stays on
   * screen (they can still read what they wrote) but sends nothing.
   */
  isDisabled?: boolean | undefined;
  // A request to put in the box (an example the person picked).
  prefill?: { text: string; token: number } | undefined;
  // Under the box: what happens when it is sent.
  footer?: ReactElement | undefined;
  dataTestId?: string | undefined;
  autoFocus?: boolean | undefined;
  /*
   * What the request goes to, picked in the box's bottom row beside Add
   * context - the repository and the branch, the way coding agents pick
   * them beside their prompt.
   */
  tools?: ReactElement | undefined;
  /*
   * Whatever stops the box sending, said once at its top - where it blocks
   * - with the one thing that fixes it (CodeBlockerNotice).
   */
  notice?: ReactElement | undefined;
  // Code's first page: a taller box, for a request written from scratch.
  isLarge?: boolean | undefined;
  /*
   * What the request goes to is still being read: the box takes words, and
   * sends once it is known.
   */
  isWaiting?: boolean | undefined;
}

const MAX_TEXTAREA_HEIGHT_PX: number = 320;

/*
 * What a chip says on hover: the whole of what it stands for - a note's
 * text, a link's address - where the chip itself shows only the start.
 */
export const getChipTooltip: (draft: CodeContextDraft) => string = (
  draft: CodeContextDraft,
): string => {
  if (draft.input.type === CodeTaskContextType.Note && draft.input.text) {
    return draft.input.text;
  }

  if (draft.input.type === CodeTaskContextType.Link && draft.input.url) {
    return draft.input.url;
  }

  return draft.label;
};

const SPINNER_CLASS_NAME: string =
  "h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent motion-safe:animate-spin";

/*
 * Where a person asks OneUptime AI to do something, or replies in a task:
 * one rounded box, as coding agents draw theirs. Their words first; the
 * context they add (files, notes, links, incidents, alerts, exceptions,
 * monitors, traces, logs, profiles) as chips under them; and a bottom row
 * with Add context, what the request goes to (the repository and branch
 * pickers a page hands over), and Send. Whatever stops AI is said at the
 * top of the box, where it blocks, and the box sends nothing until it is
 * fixed.
 *
 * Enter sends and Shift + Enter starts a new line, as in every OneUptime AI
 * composer. A refused send keeps the text and the chips.
 */
const CodeComposer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const textareaRef: React.RefObject<HTMLTextAreaElement> =
    useRef<HTMLTextAreaElement>(null);

  const [message, setMessage] = useState<string>("");
  const [drafts, setDrafts] = useState<Array<CodeContextDraft>>([]);
  const [addingKind, setAddingKind] = useState<CodeTaskContextType | null>(
    null,
  );
  const [isSending, setIsSending] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (props.prefill?.text) {
      setMessage(props.prefill.text);
      textareaRef.current?.focus();
    }
  }, [props.prefill?.token]);

  /*
   * Grow with the text, up to about thirteen lines - and fit again when the
   * box's own height changes (a box that cannot send is shorter).
   */
  useEffect(() => {
    const textarea: HTMLTextAreaElement | null = textareaRef.current;

    if (!textarea) {
      return;
    }

    textarea.style.height = "auto";
    textarea.style.height = `${Math.min(
      textarea.scrollHeight,
      MAX_TEXTAREA_HEIGHT_PX,
    )}px`;
  }, [message, props.isDisabled, props.isLarge]);

  const canSend: boolean =
    Boolean(message.trim()) &&
    !isSending &&
    !props.isDisabled &&
    !props.isWaiting;

  const send: () => Promise<void> = async (): Promise<void> => {
    if (!canSend) {
      return;
    }

    setIsSending(true);
    setError(null);

    try {
      await props.onSend({
        message: message.trim(),
        context: drafts.map((draft: CodeContextDraft): CodeTaskContextInput => {
          return draft.input;
        }),
      });

      setMessage("");
      setDrafts([]);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }

    setIsSending(false);
  };

  const addDraft: (draft: CodeContextDraft) => void = (
    draft: CodeContextDraft,
  ): void => {
    const key: string = CodeTaskContextInputUtil.getKey(draft.input);

    setDrafts((current: Array<CodeContextDraft>) => {
      if (
        current.some((existing: CodeContextDraft): boolean => {
          return CodeTaskContextInputUtil.getKey(existing.input) === key;
        })
      ) {
        return current;
      }

      return [...current, draft];
    });

    setAddingKind(null);
    textareaRef.current?.focus();
  };

  const isContextFull: boolean =
    drafts.length >= CODE_TASK_LIMITS.maxContextItems;
  const isContextLocked: boolean = Boolean(props.isDisabled) || isContextFull;

  const renderMenuItem: (kind: CodeTaskContextType) => ReactElement = (
    kind: CodeTaskContextType,
  ): ReactElement => {
    return (
      <MoreMenuItem
        key={kind}
        text={CODE_TASK_CONTEXT_KINDS[kind].label}
        icon={CODE_TASK_CONTEXT_KINDS[kind].icon}
        dataTestId={`code-add-context-${kind}`}
        onClick={() => {
          setAddingKind(kind);
        }}
      />
    );
  };

  return (
    <div data-testid={props.dataTestId || "code-composer"}>
      {/*
       * No overflow clip on the box: the menus of Add context and the
       * pickers open out of it. The notice rounds its own top corners.
       */}
      <div
        data-testid="code-composer-box"
        data-disabled={props.isDisabled ? "true" : undefined}
        className={`rounded-2xl border bg-white shadow-sm transition-shadow ${
          props.isDisabled
            ? "border-gray-200"
            : "border-gray-300 focus-within:border-indigo-400 focus-within:ring-4 focus-within:ring-indigo-500/10"
        }`}
      >
        {props.notice ? (
          <div
            data-testid="code-composer-notice"
            className="rounded-t-2xl border-b border-gray-200"
          >
            {props.notice}
          </div>
        ) : (
          <></>
        )}

        <textarea
          ref={textareaRef}
          rows={props.isLarge && !props.isDisabled ? 4 : 2}
          value={message}
          disabled={props.isDisabled}
          aria-label={props.label}
          placeholder={props.placeholder}
          autoFocus={props.autoFocus}
          maxLength={CODE_TASK_LIMITS.maxMessageLength}
          data-testid="code-composer-input"
          onChange={(event: React.ChangeEvent<HTMLTextAreaElement>) => {
            setMessage(event.target.value);
          }}
          onKeyDown={(event: React.KeyboardEvent<HTMLTextAreaElement>) => {
            if (
              event.key === "Enter" &&
              !event.shiftKey &&
              !event.nativeEvent.isComposing
            ) {
              event.preventDefault();
              void send();
            }
          }}
          className={`block w-full resize-none border-0 bg-transparent px-4 pb-2 text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-0 disabled:cursor-not-allowed disabled:text-gray-400 ${
            props.notice ? "" : "rounded-t-2xl"
          } ${
            props.isLarge
              ? "pt-4 text-base leading-7 sm:text-[15px]"
              : "pt-3.5 text-sm leading-6"
          }`}
        />

        {drafts.length > 0 ? (
          <ul
            data-testid="code-composer-context"
            aria-label={translator.translateText("Context")}
            className="flex flex-wrap gap-1.5 px-3 pb-1"
          >
            {drafts.map((draft: CodeContextDraft) => {
              const kind: CodeTaskContextType = draft.input.type;

              return (
                <li
                  key={CodeTaskContextInputUtil.getKey(draft.input)}
                  data-testid="code-composer-context-chip"
                  className="inline-flex max-w-full items-center gap-1.5 rounded-lg border border-gray-200 bg-gray-50 py-1 pl-2 pr-1 text-xs text-gray-700"
                >
                  <Icon
                    icon={CODE_TASK_CONTEXT_KINDS[kind].icon}
                    className="h-3.5 w-3.5 flex-shrink-0 text-gray-400"
                  />
                  <span
                    className={`truncate ${
                      kind === CodeTaskContextType.File ? "font-mono" : ""
                    }`}
                    title={getChipTooltip(draft)}
                  >
                    {draft.label}
                  </span>
                  <button
                    type="button"
                    title={translator.translateText("Remove")}
                    aria-label={translator.translateTemplate(
                      "Remove {{name}}",
                      {
                        name: draft.label,
                      },
                    )}
                    onClick={() => {
                      setDrafts((current: Array<CodeContextDraft>) => {
                        return current.filter(
                          (existing: CodeContextDraft): boolean => {
                            return existing !== draft;
                          },
                        );
                      });
                    }}
                    className="flex h-5 w-5 flex-shrink-0 items-center justify-center rounded text-gray-400 hover:bg-gray-200 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  >
                    <Icon icon={IconProp.Close} className="h-3 w-3" />
                  </button>
                </li>
              );
            })}
          </ul>
        ) : (
          <></>
        )}

        {/*
         * Add context and what the request goes to on the left, Send on the
         * right. A phone wraps Send under them, still at the right.
         */}
        <div
          data-testid="code-composer-toolbar"
          className="flex flex-wrap items-center gap-1 px-2 pb-2 pt-1"
        >
          <MoreMenu
            isDisabled={isContextLocked}
            isMenuLeftAligned={true}
            dataTestId="code-add-context"
            elementToBeShownInsteadOfButton={
              <span
                className={`inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg px-2 text-xs font-medium ${
                  isContextLocked
                    ? "text-gray-300"
                    : "text-gray-600 hover:bg-gray-100 hover:text-gray-900"
                }`}
              >
                <Icon icon={IconProp.Add} className="h-4 w-4" />
                <span className={props.tools ? "max-sm:hidden" : ""}>
                  {translator.translateText("Add context")}
                </span>
              </span>
            }
            ariaLabel={translator.translateText("Add context")}
          >
            <MoreMenuSection title="From you">
              {CODE_TASK_CONTEXT_MENU_ORDER.filter(
                (kind: CodeTaskContextType): boolean => {
                  return !CODE_TASK_CONTEXT_KINDS[kind].isRecord;
                },
              ).map(renderMenuItem)}
            </MoreMenuSection>
            <MoreMenuSection title="From OneUptime">
              {CODE_TASK_CONTEXT_MENU_ORDER.filter(
                (kind: CodeTaskContextType): boolean => {
                  return CODE_TASK_CONTEXT_KINDS[kind].isRecord;
                },
              ).map(renderMenuItem)}
            </MoreMenuSection>
          </MoreMenu>

          {props.tools ? (
            <div
              data-testid="code-composer-tools"
              className="flex min-w-0 flex-wrap items-center gap-1"
            >
              {props.tools}
            </div>
          ) : (
            <></>
          )}

          <div className="ml-auto flex items-center gap-3">
            {/* How to send, for a box that can send: none on a phone. */}
            {props.isDisabled ? (
              <></>
            ) : (
              <span
                data-testid="code-composer-keys"
                className="text-[11px] text-gray-500 max-lg:hidden"
              >
                <TranslatedSentence
                  template="{{enter}} to send · {{shiftEnter}} for a new line"
                  slots={{
                    enter: (
                      <kbd className="font-sans font-medium text-gray-600">
                        Enter
                      </kbd>
                    ),
                    shiftEnter: (
                      <kbd className="font-sans font-medium text-gray-600">
                        Shift + Enter
                      </kbd>
                    ),
                  }}
                />
              </span>
            )}
            <button
              type="button"
              data-testid="code-composer-send"
              disabled={!canSend}
              onClick={() => {
                void send();
              }}
              className={`inline-flex h-8 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 text-sm font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2 ${
                canSend
                  ? "bg-indigo-600 text-white shadow-sm hover:bg-indigo-500"
                  : "cursor-not-allowed bg-gray-100 text-gray-400"
              }`}
            >
              {isSending ? (
                <span className={SPINNER_CLASS_NAME} />
              ) : (
                <Icon icon={IconProp.ArrowUp} className="h-4 w-4" />
              )}
              {props.sendLabel}
            </button>
          </div>
        </div>
      </div>

      {error ? (
        <div
          role="alert"
          data-testid="code-composer-error"
          className="mt-2 flex items-start gap-1.5 text-sm text-red-700"
        >
          <Icon
            icon={IconProp.ExclaimationCircle}
            className="mt-0.5 h-4 w-4 flex-shrink-0"
          />
          <span>{error}</span>
        </div>
      ) : (
        <></>
      )}

      {props.footer ? <div className="mt-2 px-1">{props.footer}</div> : <></>}

      {addingKind ? (
        <CodeContextModal
          kind={addingKind}
          onAdd={addDraft}
          onClose={() => {
            setAddingKind(null);
          }}
        />
      ) : (
        <></>
      )}
    </div>
  );
};

export default CodeComposer;
