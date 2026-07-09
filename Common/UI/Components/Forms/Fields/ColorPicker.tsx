import useComponentOutsideClick from "../../../Types/UseComponentOutsideClick";
import FloatingPortal from "../../Floating/FloatingPortal";
import Icon from "../../Icon/Icon";
import Color from "../../../../Types/Color";
import IconProp from "../../../../Types/Icon/IconProp";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";
import { ChromePicker, ColorResult } from "react-color";

export interface ComponentProps {
  onChange: (value: Color | null) => void;
  initialValue?: undefined | Color;
  placeholder: string;
  onFocus?: (() => void) | undefined;
  tabIndex?: number | undefined;
  value?: string | undefined;
  readOnly?: boolean | undefined;
  disabled?: boolean | undefined;
  onBlur?: (() => void) | undefined;
  dataTestId?: string | undefined;
  onEnterPress?: (() => void) | undefined;
  error?: string | undefined;
  ariaLabelledby?: string | undefined;
}

const ColorPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [color, setColor] = useState<string>("");
  const { ref, isComponentVisible, setIsComponentVisible } =
    useComponentOutsideClick(false);
  const anchorRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const triggerRef: React.RefObject<HTMLButtonElement> =
    useRef<HTMLButtonElement>(null);
  const popoverId: string = `color-picker-${useId()}`;

  const [isInitialValuesInitialized, setIsInitialValuesInitialized] =
    useState<boolean>(false);

  useEffect(() => {
    if (props.initialValue && !isInitialValuesInitialized) {
      setColor(props.initialValue.toString());
      setIsInitialValuesInitialized(true);
    }
  }, [props.initialValue]);

  useEffect(() => {
    if (!isComponentVisible) {
      return;
    }

    const focusTimeout: number = window.setTimeout((): void => {
      const initialControl: HTMLElement | null =
        (ref.current as HTMLElement | null)?.querySelector<HTMLElement>(
          "input:not([disabled]), button:not([disabled])",
        ) || null;
      initialControl?.focus();
    }, 0);

    return () => {
      window.clearTimeout(focusTimeout);
    };
  }, [isComponentVisible]);

  type HandleChangeFunction = (color: string) => void;

  const handleChange: HandleChangeFunction = (color: string): void => {
    setColor(color);
    if (!color) {
      return props.onChange(null);
    }
    props.onChange(new Color(color));
  };

  const closeAndRestoreFocus: () => void = (): void => {
    setIsComponentVisible(false);
    window.setTimeout((): void => {
      triggerRef.current?.focus();
    }, 0);
  };

  return (
    <div>
      <div
        ref={anchorRef}
        onKeyDown={(event: React.KeyboardEvent<HTMLDivElement>): void => {
          if (event.key === "Escape" && isComponentVisible) {
            event.preventDefault();
            event.stopPropagation();
            closeAndRestoreFocus();
          }
        }}
        className="relative flex w-full items-center rounded-lg border border-gray-300 bg-white text-sm shadow-sm transition-colors hover:border-indigo-300 focus-within:border-indigo-400 focus-within:ring-2 focus-within:ring-indigo-100"
      >
        <button
          ref={triggerRef}
          type="button"
          disabled={props.disabled || props.readOnly}
          tabIndex={props.tabIndex}
          data-testid={props.dataTestId}
          aria-labelledby={props.ariaLabelledby}
          aria-haspopup="dialog"
          aria-expanded={isComponentVisible}
          aria-controls={isComponentVisible ? popoverId : undefined}
          onFocus={props.onFocus}
          onBlur={props.onBlur}
          onClick={(): void => {
            setIsComponentVisible(!isComponentVisible);
          }}
          onKeyDown={(event: React.KeyboardEvent<HTMLButtonElement>): void => {
            if (event.key === "Enter") {
              props.onEnterPress?.();
            }
          }}
          className="flex min-w-0 flex-1 items-center gap-2.5 rounded-lg px-3 py-2 text-left text-gray-700 outline-none disabled:cursor-not-allowed disabled:bg-gray-100 disabled:text-gray-400"
        >
          <span
            aria-hidden="true"
            className="h-4 w-4 shrink-0 rounded border border-gray-200"
            style={{ backgroundColor: color || "transparent" }}
          />
          <span className="min-w-0 flex-1 truncate">
            {color || props.value || props.placeholder}
          </span>
          <Icon
            icon={IconProp.ChevronDown}
            className="h-4 w-4 shrink-0 text-gray-400"
          />
        </button>
        {color && !props.disabled && !props.readOnly && (
          <button
            type="button"
            aria-label="Clear color"
            className="mr-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            onClick={(): void => {
              setColor("");
              props.onChange(null);
            }}
          >
            <Icon icon={IconProp.Close} className="h-4 w-4" />
          </button>
        )}
        {isComponentVisible ? (
          <FloatingPortal
            anchorRef={anchorRef}
            floatingRef={ref}
            width={227}
            maxHeight={360}
            className="overflow-x-hidden overflow-y-auto rounded-lg border border-gray-200 bg-white shadow-lg"
            id={popoverId}
            role="dialog"
            ariaLabel="Choose a color"
            onEscape={(): void => {
              closeAndRestoreFocus();
            }}
          >
            <ChromePicker
              color={color}
              onChange={(color: ColorResult) => {
                setColor(color.hex);
              }}
              onChangeComplete={(color: ColorResult) => {
                return handleChange(color.hex);
              }}
            />
          </FloatingPortal>
        ) : (
          <></>
        )}
      </div>
      {props.error && (
        <p data-testid="error-message" className="mt-1 text-sm text-red-400">
          {props.error}
        </p>
      )}
    </div>
  );
};

export default ColorPicker;
