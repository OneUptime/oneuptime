import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import useTranslateValue from "../../Utils/Translation";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useLayoutEffect,
  useRef,
  useState,
} from "react";

// How tall a text area is when nothing asks for anything else.
export const DEFAULT_TEXT_AREA_ROWS: number = 6;

/*
 * An auto-growing text area starts at a few lines rather than six. Most of
 * what goes in one is a line or two, and a short value in a tall empty box
 * reads as wasted space; the box gets taller as soon as there is more to show.
 */
export const AUTO_GROW_MIN_ROWS: number = 3;

/*
 * Past this it stops growing and scrolls instead, so a long prompt cannot push
 * everything after it off the screen.
 */
export const AUTO_GROW_MAX_ROWS: number = 15;

// Tailwind's text-sm line height, for a browser that reports "normal".
const FALLBACK_LINE_HEIGHT_IN_PX: number = 20;

export interface ComponentProps {
  onChange?: undefined | ((value: string) => void);
  initialValue?: string | undefined;
  id?: string | undefined;
  value?: string | undefined;
  placeholder?: undefined | string;
  onFocus?: () => void;
  onBlur?: () => void;
  className?: undefined | string;
  tabIndex?: number | undefined;
  error?: string | undefined;
  autoFocus?: boolean | undefined;
  dataTestId?: string | undefined;
  disableSpellCheck?: boolean | undefined;
  /** The id of the element that names this control, when it is labelled elsewhere. */
  ariaLabelledby?: string | undefined;
  /*
   * Grow with the text instead of sitting at a fixed height: the box starts
   * `rows` lines tall, gets taller as lines are added, and from `maxRows`
   * on it scrolls.
   */
  autoGrow?: boolean | undefined;
  // Lines shown when empty. Six, or three for an auto-growing box.
  rows?: number | undefined;
  // Only with autoGrow: the most lines it grows to before it scrolls.
  maxRows?: number | undefined;
}

type ToPixelsFunction = (value: string) => number;

const toPixels: ToPixelsFunction = (value: string): number => {
  const pixels: number = parseFloat(value);
  return Number.isFinite(pixels) ? pixels : 0;
};

const TextArea: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { translateString } = useTranslateValue();
  /*
   * An id of its own for this field's error message, as Input has: a fixed
   * one was shared by every text area in error on a form, so each was
   * described by the first one's message.
   */
  const errorId: string = `textarea-error-${useId()}`;
  const [text, setText] = useState<string>(props.initialValue || "");

  /*
   * What the box holds right now, readable from an effect without waiting for
   * a render. It is how the initialValue effect below tells "the form is
   * echoing back what was just typed" from "something else changed the value".
   */
  const textRef: React.MutableRefObject<string> = useRef<string>(text);
  const textAreaRef: React.MutableRefObject<HTMLTextAreaElement | null> =
    useRef<HTMLTextAreaElement | null>(null);

  const rows: number =
    props.rows ||
    (props.autoGrow ? AUTO_GROW_MIN_ROWS : DEFAULT_TEXT_AREA_ROWS);
  const maxRows: number = Math.max(props.maxRows || AUTO_GROW_MAX_ROWS, rows);

  let className: string = "";

  if (!props.className) {
    /*
     * min-h-32 keeps a fixed text area from being dragged down to nothing. An
     * auto-growing one takes its floor from `rows` instead: with min-h-32 it
     * could never be shorter than six lines, which is the whole point of it.
     */
    className = `block w-full rounded-md border border-gray-300 bg-white py-2 pl-3 pr-3 text-sm placeholder-gray-500 focus:border-indigo-500 focus:text-gray-900 focus:placeholder-gray-400 focus:outline-none focus:ring-1 focus:ring-indigo-500 sm:text-sm resize-y${
      props.autoGrow ? "" : " min-h-32"
    }`;
  } else {
    className = props.className;
  }

  if (props.error) {
    className +=
      " border-red-300 pr-10 text-red-900 placeholder-red-300 focus:border-red-500 focus:outline-none focus:ring-red-500";
  }

  useEffect(() => {
    if (props.value) {
      textRef.current = props.value.toString();
      setText(props.value.toString());
    }
  }, [props.value]);

  /*
   * Follow initialValue when it changes from outside, as Input and
   * MarkdownEditor do. A form field passes its current value here, and the
   * form changes that value without the box being typed into whenever a
   * workflow step's "pick this value from a component or a variable" adds a
   * reference. Until this effect the reference went into the form, the box
   * kept showing the old text, and the next keystroke wrote the old text
   * back over it.
   *
   * Only a value that differs from what the box holds is taken: the form
   * echoes every keystroke back as initialValue, and re-setting the same text
   * would be a wasted render at best.
   */
  useEffect(() => {
    if (
      props.initialValue !== undefined &&
      props.initialValue !== null &&
      props.initialValue !== textRef.current
    ) {
      textRef.current = props.initialValue;
      setText(props.initialValue);
    }
  }, [props.initialValue]);

  type FitToTextFunction = () => void;

  /*
   * Size an auto-growing box to its text. Setting the height to auto first
   * lets the box shrink again when lines are deleted, and lets `rows` set the
   * floor. scrollHeight is the text plus padding; the border is added because
   * the box is border-box sized.
   */
  const fitToText: FitToTextFunction = (): void => {
    const textArea: HTMLTextAreaElement | null = textAreaRef.current;

    if (!props.autoGrow || !textArea) {
      return;
    }

    textArea.style.height = "auto";

    const contentHeight: number = textArea.scrollHeight;

    /*
     * Zero means the box is not laid out - it sits in something hidden, or in
     * a test DOM with no layout at all. `rows` alone sizes it until it is.
     */
    if (!contentHeight) {
      textArea.style.height = "";
      textArea.style.overflowY = "";
      return;
    }

    const style: CSSStyleDeclaration = window.getComputedStyle(textArea);
    const border: number =
      toPixels(style.borderTopWidth) + toPixels(style.borderBottomWidth);
    const padding: number =
      toPixels(style.paddingTop) + toPixels(style.paddingBottom);
    const lineHeight: number =
      toPixels(style.lineHeight) || FALLBACK_LINE_HEIGHT_IN_PX;

    const tallest: number = lineHeight * maxRows + padding + border;
    const wanted: number = contentHeight + border;

    textArea.style.height = `${Math.min(wanted, tallest)}px`;
    // No scrollbar while it still grows, so one never flickers in and out.
    textArea.style.overflowY = wanted > tallest ? "auto" : "hidden";
  };

  useLayoutEffect(() => {
    fitToText();
  }, [text, props.autoGrow, rows, maxRows]);

  /*
   * The same text wraps onto more or fewer lines when the box gets narrower
   * or wider - a modal opening, a window resized - so measure again then.
   * Only a change of width counts: fitting the height is itself a resize, and
   * reacting to it would measure in a loop.
   */
  useEffect(() => {
    const textArea: HTMLTextAreaElement | null = textAreaRef.current;

    if (
      !props.autoGrow ||
      !textArea ||
      typeof window === "undefined" ||
      typeof window.ResizeObserver === "undefined"
    ) {
      return;
    }

    let lastWidth: number = textArea.getBoundingClientRect().width;

    const observer: ResizeObserver = new window.ResizeObserver(() => {
      const width: number = textArea.getBoundingClientRect().width;

      if (width !== lastWidth) {
        lastWidth = width;
        fitToText();
      }
    });

    observer.observe(textArea);

    return () => {
      observer.disconnect();
    };
  }, [props.autoGrow, maxRows]);

  type HandleChangeFunction = (content: string) => void;

  const handleChange: HandleChangeFunction = (content: string): void => {
    textRef.current = content;
    setText(content);
    if (props.onChange) {
      props.onChange(content);
    }
  };

  return (
    <>
      <div className="relative mt-2 mb-1 rounded-md shadow-sm">
        <textarea
          ref={textAreaRef}
          autoFocus={props.autoFocus}
          id={props.id}
          placeholder={translateString(props.placeholder)}
          data-testid={props.dataTestId}
          className={`${className || ""}`}
          value={text}
          rows={rows}
          data-auto-grow={props.autoGrow ? "true" : undefined}
          spellCheck={!props.disableSpellCheck}
          aria-labelledby={props.ariaLabelledby}
          aria-invalid={props.error ? "true" : undefined}
          aria-describedby={props.error ? errorId : undefined}
          onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => {
            const value: string = e.target.value;

            if (value === "\n") {
              handleChange("");
            }

            handleChange(e.target.value);
          }}
          onFocus={() => {
            if (props.onFocus) {
              props.onFocus();
            }
          }}
          onBlur={() => {
            if (props.onBlur) {
              props.onBlur();
            }
          }}
          tabIndex={props.tabIndex}
        />
        {props.error && (
          <div
            className="pointer-events-none absolute inset-y-0 right-0 flex items-center pr-3"
            aria-hidden="true"
          >
            <Icon icon={IconProp.ErrorSolid} className="h-5 w-5 text-red-500" />
          </div>
        )}
      </div>
      {props.error && (
        <p
          id={errorId}
          data-testid="error-message"
          className="mt-1 text-sm text-red-400"
          role="alert"
        >
          {props.error}
        </p>
      )}
    </>
  );
};

export default TextArea;
