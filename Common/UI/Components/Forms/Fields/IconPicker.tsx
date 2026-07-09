import useComponentOutsideClick from "../../../Types/UseComponentOutsideClick";
import FloatingPortal from "../../Floating/FloatingPortal";
import Icon from "../../Icon/Icon";
import Input, { InputType } from "../../Input/Input";
import IconProp from "../../../../Types/Icon/IconProp";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useRef,
  useState,
} from "react";

export interface ComponentProps {
  onChange: (value: IconProp | null) => void;
  initialValue?: undefined | IconProp;
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

const IconPicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [selectedIcon, setSelectedIcon] = useState<IconProp | null>(null);
  const [searchQuery, setSearchQuery] = useState<string>("");
  const { ref, isComponentVisible, setIsComponentVisible } =
    useComponentOutsideClick(false);
  const anchorRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const triggerRef: React.RefObject<HTMLButtonElement> =
    useRef<HTMLButtonElement>(null);
  const popoverId: string = `icon-picker-${useId()}`;

  const [isInitialValuesInitialized, setIsInitialValuesInitialized] =
    useState<boolean>(false);

  useEffect(() => {
    if (props.initialValue && !isInitialValuesInitialized) {
      setSelectedIcon(props.initialValue);
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

  type HandleChangeFunction = (icon: IconProp | null) => void;

  const handleChange: HandleChangeFunction = (icon: IconProp | null): void => {
    setSelectedIcon(icon);
    props.onChange(icon);
    setIsComponentVisible(false);
    window.setTimeout((): void => {
      triggerRef.current?.focus();
    }, 0);
  };

  const closeAndRestoreFocus: () => void = (): void => {
    setIsComponentVisible(false);
    window.setTimeout((): void => {
      triggerRef.current?.focus();
    }, 0);
  };

  // Get all icons from IconProp enum
  const allIcons: Array<IconProp> = Object.values(IconProp);

  // Filter icons based on search query
  const filteredIcons: Array<IconProp> = allIcons.filter((icon: IconProp) => {
    return icon.toLowerCase().includes(searchQuery.toLowerCase());
  });

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
          {selectedIcon ? (
            <Icon
              icon={selectedIcon}
              className="h-4 w-4 shrink-0 text-gray-600"
            />
          ) : (
            <span className="h-4 w-4 shrink-0 rounded border border-dashed border-gray-300" />
          )}
          <span className="min-w-0 flex-1 truncate">
            {selectedIcon || props.value || props.placeholder}
          </span>
          <Icon
            icon={IconProp.ChevronDown}
            className="h-4 w-4 shrink-0 text-gray-400"
          />
        </button>
        {selectedIcon && !props.disabled && !props.readOnly && (
          <button
            type="button"
            aria-label="Clear icon"
            className="mr-2 flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-gray-400 hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus:ring-2 focus:ring-indigo-500"
            onClick={(): void => {
              setSelectedIcon(null);
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
            width={320}
            maxHeight={400}
            className="overflow-y-auto rounded-lg border border-gray-200 bg-white p-3 shadow-lg"
            id={popoverId}
            role="dialog"
            ariaLabel="Choose an icon"
            onEscape={(): void => {
              closeAndRestoreFocus();
            }}
          >
            {/* Search input */}
            <div className="mb-3">
              <Input
                type={InputType.TEXT}
                placeholder="Search icons..."
                value={searchQuery}
                onChange={(value: string) => {
                  setSearchQuery(value);
                }}
                className="w-full px-3 py-2 border border-gray-300 rounded-md text-sm"
              />
            </div>

            {/* Icons grid */}
            <div
              className="grid grid-cols-6 gap-2 overflow-y-auto"
              style={{ maxHeight: "300px" }}
            >
              {filteredIcons.map((icon: IconProp) => {
                return (
                  <button
                    key={icon}
                    type="button"
                    aria-label={icon}
                    onClick={(): void => {
                      handleChange(icon);
                    }}
                    className={`flex items-center justify-center rounded p-2 hover:bg-gray-100 focus:outline-none focus:ring-2 focus:ring-indigo-500 ${
                      selectedIcon === icon
                        ? "bg-indigo-100 ring-2 ring-indigo-500"
                        : ""
                    }`}
                    title={icon}
                  >
                    <Icon icon={icon} className="h-5 w-5 text-gray-600" />
                  </button>
                );
              })}
            </div>

            {filteredIcons.length === 0 && (
              <div className="text-center text-gray-500 py-4">
                No icons found
              </div>
            )}
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

export default IconPicker;
