import Button, { ButtonSize, ButtonStyleType } from "../Button/Button";
import { Translator } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import {
  COLOR_CODE_EXAMPLE,
  ColorCodeInput,
  colorToHsv,
  getHueAtPoint,
  getSaturationAtPoint,
  Hsv,
  hsvToHex,
  moveHueByKey,
  moveSaturationByKey,
  normalizeColorValue,
  readColorCodeInput,
} from "./ColorValue";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useRef,
  useState,
} from "react";

/*
 * "Custom color": the exact-color picker behind a color field's swatches.
 *
 * A saturation square and a hue strip for finding a color by eye, and a box
 * for its code, for a brand color someone already has. All three are wired
 * both ways: drag the square and the code follows; type a code and the
 * square moves to it. The square and the strip are sliders a keyboard can
 * move too (arrows, Shift for bigger steps), so there is nothing here only a
 * mouse can do.
 *
 * It replaces react-color's ChromePicker, whose box came with up/down arrows
 * that switched the box between HEX, RGB and HSL - three notations nobody
 * asked for, behind a control nobody recognised - and an alpha slider the
 * stored hex cannot hold.
 *
 * A code is checked as it is typed but only taken once it is a whole color:
 * six digits are taken at once, shorthand (#abc) on Enter or blur, so typing
 * #3e409a does not flash #33ee44 at "#3e4". Something that is not a color is
 * explained under the box, in words, on Enter or blur - never mid-word.
 */

export interface ComponentProps {
  id: string;
  // The field's color, normalized; "" for none.
  value: string;
  onChange: (hex: string) => void;
  onDone: () => void;
  // Put the caret in the code box on open, for someone who came by keyboard.
  autoFocusCodeInput?: boolean | undefined;
  disabled?: boolean | undefined;
  className?: string | undefined;
}

// Where the square and the strip start when the field has no color yet.
const DEFAULT_HSV: Hsv = colorToHsv(COLOR_CODE_EXAMPLE)!;

const POINTER_RING: string = "0 0 0 2px #ffffff, 0 0 0 3px rgb(0 0 0 / 0.35)";

const HUE_GRADIENT: string =
  "linear-gradient(to right, #ff0000 0%, #ffff00 17%, #00ff00 33%, #00ffff 50%, #0000ff 67%, #ff00ff 83%, #ff0000 100%)";

interface PointerDragHandlers {
  onMouseDown: (event: React.MouseEvent<HTMLElement>) => void;
  onTouchStart: (event: React.TouchEvent<HTMLElement>) => void;
  onTouchMove: (event: React.TouchEvent<HTMLElement>) => void;
}

/*
 * A press on the square or the strip, and the drag that follows it. The
 * moves and the release are read on window, so a drag that leaves the panel
 * - overshooting to the far edge is the usual way to reach full saturation -
 * keeps going until the button comes up. The press is claimed (no text is
 * selected while dragging) and focus goes to the control pressed, so the
 * arrow keys carry on from where the pointer left it.
 */
const usePointerDrag: (
  onPoint: (x: number, y: number) => void,
  disabled: boolean,
) => PointerDragHandlers = (
  onPoint: (x: number, y: number) => void,
  disabled: boolean,
): PointerDragHandlers => {
  const onPointRef: React.MutableRefObject<(x: number, y: number) => void> =
    useRef<(x: number, y: number) => void>(onPoint);
  onPointRef.current = onPoint;

  const stopDragRef: React.MutableRefObject<(() => void) | null> = useRef<
    (() => void) | null
  >(null);

  useEffect(() => {
    return () => {
      stopDragRef.current?.();
    };
  }, []);

  return {
    onMouseDown: (event: React.MouseEvent<HTMLElement>): void => {
      if (disabled || event.button !== 0) {
        return;
      }

      event.preventDefault();
      event.currentTarget.focus({ preventScroll: true });
      onPointRef.current(event.clientX, event.clientY);

      stopDragRef.current?.();

      const onMove: (moveEvent: MouseEvent) => void = (
        moveEvent: MouseEvent,
      ): void => {
        onPointRef.current(moveEvent.clientX, moveEvent.clientY);
      };

      const stop: () => void = (): void => {
        window.removeEventListener("mousemove", onMove);
        window.removeEventListener("mouseup", stop);
        stopDragRef.current = null;
      };

      window.addEventListener("mousemove", onMove);
      window.addEventListener("mouseup", stop);
      stopDragRef.current = stop;
    },
    onTouchStart: (event: React.TouchEvent<HTMLElement>): void => {
      const touch: React.Touch | undefined = event.touches[0];

      if (disabled || !touch) {
        return;
      }

      onPointRef.current(touch.clientX, touch.clientY);
    },
    onTouchMove: (event: React.TouchEvent<HTMLElement>): void => {
      const touch: React.Touch | undefined = event.touches[0];

      if (disabled || !touch) {
        return;
      }

      onPointRef.current(touch.clientX, touch.clientY);
    },
  };
};

const CustomColorPanel: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const isDisabled: boolean = Boolean(props.disabled);

  const [hsv, setHsv] = useState<Hsv>((): Hsv => {
    return colorToHsv(props.value) || DEFAULT_HSV;
  });
  const [codeText, setCodeText] = useState<string>(props.value);
  const [codeMessage, setCodeMessage] = useState<string | null>(null);

  const squareRef: React.MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);
  const hueRef: React.MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);
  const codeInputRef: React.MutableRefObject<HTMLInputElement | null> =
    useRef<HTMLInputElement | null>(null);

  // The color this panel last reported, so its own echo is not "a change".
  const lastReportedRef: React.MutableRefObject<string> = useRef<string>(
    props.value,
  );

  const codeInputId: string = `${props.id}-code`;
  const codeMessageId: string = `${props.id}-code-message`;

  /*
   * A color set from outside - a swatch picked while the panel is open, a
   * form filled in later - moves the square, the strip and the box to it.
   * The panel's own reports come back here too and are left alone, so the
   * hue of a grey (which has none of its own) is not lost on the way round.
   */
  useEffect(() => {
    if (props.value === lastReportedRef.current) {
      return;
    }

    lastReportedRef.current = props.value;

    const next: Hsv | null = colorToHsv(props.value, hsv.h);

    if (next) {
      setHsv(next);
    }

    if (document.activeElement !== codeInputRef.current) {
      setCodeText(props.value);
      setCodeMessage(null);
    }
  }, [props.value]);

  useEffect(() => {
    if (props.autoFocusCodeInput) {
      codeInputRef.current?.focus();
    }
  }, []);

  type ReportFunction = (next: Hsv) => void;

  // A change made on the square or the strip.
  const report: ReportFunction = (next: Hsv): void => {
    setHsv(next);

    const hex: string = hsvToHex(next);

    setCodeText(hex);
    setCodeMessage(null);

    if (hex !== lastReportedRef.current) {
      lastReportedRef.current = hex;
      props.onChange(hex);
    }
  };

  type ReportCodeFunction = (hex: string) => void;

  // A whole code typed in the box.
  const reportCode: ReportCodeFunction = (hex: string): void => {
    setCodeMessage(null);

    const next: Hsv | null = colorToHsv(hex, hsv.h);

    if (next) {
      setHsv(next);
    }

    if (hex !== lastReportedRef.current) {
      lastReportedRef.current = hex;
      props.onChange(hex);
    }
  };

  const squareDrag: PointerDragHandlers = usePointerDrag(
    (x: number, y: number): void => {
      const box: DOMRect | undefined =
        squareRef.current?.getBoundingClientRect();

      if (!box) {
        return;
      }

      const point: { s: number; v: number } | null = getSaturationAtPoint({
        x,
        y,
        box,
      });

      if (point) {
        report({ h: hsv.h, s: point.s, v: point.v });
      }
    },
    isDisabled,
  );

  const hueDrag: PointerDragHandlers = usePointerDrag(
    (x: number): void => {
      const box: DOMRect | undefined = hueRef.current?.getBoundingClientRect();

      if (!box) {
        return;
      }

      const hue: number | null = getHueAtPoint({ x, box });

      if (hue !== null) {
        report({ ...hsv, h: hue });
      }
    },
    isDisabled,
  );

  type FinishCodeFunction = () => boolean;

  /*
   * Enter, blur or Done: take a shorthand code too, or say what is wrong.
   * False when the box holds something that is not a color, so Done leaves
   * the panel open with the message showing instead of throwing the text
   * away.
   */
  const finishCode: FinishCodeFunction = (): boolean => {
    const input: ColorCodeInput = readColorCodeInput(codeText);

    if (input.kind === "empty") {
      setCodeText(props.value);
      setCodeMessage(null);
      return true;
    }

    if (input.kind === "invalid") {
      setCodeMessage(input.message);
      return false;
    }

    setCodeText(input.hex);
    reportCode(input.hex);
    return true;
  };

  const hexNow: string = normalizeColorValue(hsvToHex(hsv));
  const saturationPercent: number = Math.round(hsv.s * 100);
  const brightnessPercent: number = Math.round(hsv.v * 100);
  const hueDegrees: number = Math.round(hsv.h);

  return (
    <div
      id={props.id}
      role="group"
      aria-label={translator.translateText("Custom color")}
      data-testid="color-picker-custom-panel"
      className={
        props.className ||
        "w-full rounded-lg border border-gray-200 bg-white p-3 shadow-sm"
      }
      onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => {
        /*
         * Escape closes the panel and nothing else: the dialog the field may
         * sit in reads Escape from document and stands down for a key that
         * was already claimed.
         */
        if (event.key === "Escape") {
          event.preventDefault();
          event.stopPropagation();
          props.onDone();
        }
      }}
    >
      <div
        ref={squareRef}
        role="slider"
        tabIndex={isDisabled ? -1 : 0}
        aria-label={translator.translateText("Saturation and brightness")}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={saturationPercent}
        aria-valuetext={translator.translateTemplate(
          "Saturation {{saturation}}%, brightness {{brightness}}%",
          {
            saturation: saturationPercent,
            brightness: brightnessPercent,
          },
        )}
        aria-disabled={isDisabled ? true : undefined}
        data-testid="color-picker-saturation"
        className="relative h-28 w-full cursor-crosshair touch-none rounded-md focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
        style={{ backgroundColor: `hsl(${hsv.h}, 100%, 50%)` }}
        onMouseDown={squareDrag.onMouseDown}
        onTouchStart={squareDrag.onTouchStart}
        onTouchMove={squareDrag.onTouchMove}
        onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => {
          if (isDisabled) {
            return;
          }

          const next: Hsv | null = moveSaturationByKey({
            hsv,
            key: event.key,
            shiftKey: event.shiftKey,
          });

          if (next) {
            event.preventDefault();
            report(next);
          }
        }}
      >
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-md"
          style={{
            background:
              "linear-gradient(to right, #ffffff, rgb(255 255 255 / 0))",
          }}
        ></div>
        <div
          aria-hidden="true"
          className="pointer-events-none absolute inset-0 rounded-md"
          style={{
            background: "linear-gradient(to top, #000000, rgb(0 0 0 / 0))",
          }}
        ></div>
        <div
          aria-hidden="true"
          data-testid="color-picker-saturation-pointer"
          className="pointer-events-none absolute h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            left: `${hsv.s * 100}%`,
            top: `${(1 - hsv.v) * 100}%`,
            backgroundColor: hexNow,
            boxShadow: POINTER_RING,
          }}
        ></div>
      </div>

      <div
        ref={hueRef}
        role="slider"
        tabIndex={isDisabled ? -1 : 0}
        aria-label={translator.translateText("Hue")}
        aria-valuemin={0}
        aria-valuemax={359}
        aria-valuenow={hueDegrees}
        aria-valuetext={`${hueDegrees}°`}
        aria-disabled={isDisabled ? true : undefined}
        data-testid="color-picker-hue"
        className="relative mt-3 h-3 w-full cursor-pointer touch-none rounded-full focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
        style={{ background: HUE_GRADIENT }}
        onMouseDown={hueDrag.onMouseDown}
        onTouchStart={hueDrag.onTouchStart}
        onTouchMove={hueDrag.onTouchMove}
        onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>) => {
          if (isDisabled) {
            return;
          }

          const next: number | null = moveHueByKey({
            hue: hsv.h,
            key: event.key,
            shiftKey: event.shiftKey,
          });

          if (next !== null) {
            event.preventDefault();
            report({ ...hsv, h: next });
          }
        }}
      >
        <div
          aria-hidden="true"
          data-testid="color-picker-hue-pointer"
          className="pointer-events-none absolute top-1/2 h-4 w-4 -translate-x-1/2 -translate-y-1/2 rounded-full"
          style={{
            left: `${(hsv.h / 359) * 100}%`,
            backgroundColor: `hsl(${hsv.h}, 100%, 50%)`,
            boxShadow: POINTER_RING,
          }}
        ></div>
      </div>

      <div className="mt-3">
        <label
          htmlFor={codeInputId}
          className="block text-xs font-medium text-gray-600"
        >
          {translator.translateText("Color code")}
        </label>
        <div className="mt-1 flex items-center gap-2">
          <input
            ref={codeInputRef}
            id={codeInputId}
            type="text"
            inputMode="text"
            autoComplete="off"
            spellCheck={false}
            maxLength={9}
            disabled={isDisabled}
            data-testid="color-picker-code"
            placeholder={COLOR_CODE_EXAMPLE}
            value={codeText}
            aria-invalid={codeMessage ? true : undefined}
            aria-describedby={codeMessage ? codeMessageId : undefined}
            className={`block w-full min-w-0 rounded-md border bg-white px-2.5 py-1.5 font-mono text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-1 ${
              codeMessage
                ? "border-red-300 focus:border-red-500 focus:ring-red-500"
                : "border-gray-300 focus:border-indigo-500 focus:ring-indigo-500"
            }`}
            onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
              const text: string = event.target.value;
              const input: ColorCodeInput = readColorCodeInput(text);

              setCodeText(text);

              // A whole six-digit code is taken as it is typed.
              if (input.kind === "valid" && !input.isShorthand) {
                reportCode(input.hex);
                return;
              }

              // Fixing a code that was called wrong clears the message.
              if (input.kind === "valid" || input.kind === "empty") {
                setCodeMessage(null);
              }
            }}
            onBlur={() => {
              finishCode();
            }}
            onKeyDown={(event: React.KeyboardEvent<HTMLInputElement>) => {
              if (event.key === "Enter") {
                // Enter takes the code; it never submits the form around it.
                event.preventDefault();
                finishCode();
              }
            }}
          />
          <Button
            title={translator.translateText("Done") || "Done"}
            buttonStyle={ButtonStyleType.NORMAL}
            buttonSize={ButtonSize.Small}
            dataTestId="color-picker-done"
            onClick={() => {
              if (finishCode()) {
                props.onDone();
              }
            }}
          />
        </div>
        {codeMessage ? (
          <p
            id={codeMessageId}
            role="alert"
            data-testid="color-picker-code-message"
            className="mt-1.5 text-xs text-red-600"
          >
            {translator.translateText(codeMessage) || codeMessage}
          </p>
        ) : (
          <></>
        )}
      </div>
    </div>
  );
};

export default CustomColorPanel;
