import { CODE_PICKER_VALUE_LABEL } from "./CodeTaskCopy";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";

export interface CodePickerOption {
  value: string;
  // What the option is called, as written (a repository's or a branch's name).
  label: string;
  // A quieter second line: a repository's organization/name.
  description?: string | undefined;
  // A small tag after it, in the reader's language: Default, Not connected.
  badge?: string | undefined;
  // Drawn quieter: a repository AI cannot reach.
  isMuted?: boolean | undefined;
}

export interface ComponentProps {
  // What the picker picks, in the reader's language: "Repository".
  label: string;
  // What it holds now, as written: "checkout-api", "main".
  valueText: string;
  // The mark before it (the GitHub mark, a branch).
  icon: ReactElement;
  // Branch names read as code.
  isMonospace?: boolean | undefined;
  options: Array<CodePickerOption>;
  value: string | null;
  onChange: (value: string) => void;
  searchPlaceholder: string;
  // What an empty list says, in the reader's language.
  noMatchText: string;
  /*
   * Told what the person types, for a picker that finds its own options (a
   * repository's branches); the picker then shows `options` as given
   * instead of filtering them itself.
   */
  onSearch?: ((search: string) => void) | undefined;
  isLoading?: boolean | undefined;
  loadingText?: string | undefined;
  // Why the options could not be read, with Try again (onRetry).
  error?: string | null | undefined;
  onRetry?: (() => void) | undefined;
  // A line under the list: how to find more.
  note?: string | null | undefined;
  // Told when the picker opens, to read its options the first time.
  onOpen?: (() => void) | undefined;
  isDisabled?: boolean | undefined;
  dataTestId: string;
}

// React's ids hold colons, which an element id may hold but a selector may not.
const ID_COLONS: RegExp = /:/g;

/*
 * The widest a picker grows before its name is cut with "…" - narrower
 * still where the row it sits in has less room (the picker shrinks, and its
 * button with it).
 */
export const PICKER_MAX_WIDTH_CLASS_NAME: string =
  "max-w-[11rem] sm:max-w-[16rem]";

// The list's width, and the room it keeps from the edges of the window.
export const PICKER_MENU_WIDTH_PX: number = 288;
const WINDOW_MARGIN_PX: number = 12;

/*
 * How far left of its button a list must open to stay inside the window:
 * none while it fits, else the overflow - but never past the window's left
 * edge, on a screen narrower than the list.
 */
export const getPickerMenuShift: (data: {
  buttonLeft: number;
  windowWidth: number;
  menuWidth: number;
}) => number = (data: {
  buttonLeft: number;
  windowWidth: number;
  menuWidth: number;
}): number => {
  const overflow: number =
    data.buttonLeft + data.menuWidth - (data.windowWidth - WINDOW_MARGIN_PX);

  if (overflow <= 0) {
    return 0;
  }

  return Math.max(0, Math.min(overflow, data.buttonLeft - WINDOW_MARGIN_PX));
};

/*
 * A small picker inside Code's request box, the way coding agents pick a
 * repository and a branch beside their prompt: a quiet button that says
 * what is picked, opening a list with a search box. Typing filters (or
 * asks the server, with onSearch); the arrow keys move through the list,
 * Enter picks, Escape closes and gives the button its focus back, and a
 * click anywhere else closes it. The search box is the list's combobox
 * (aria-activedescendant), so a screen reader follows the keys. The list
 * opens under its button and moves left as far as it must to stay on a
 * phone's screen.
 */
const CodePicker: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const listId: string = `code-picker-${useId().replace(ID_COLONS, "")}`;
  const containerRef: React.RefObject<HTMLDivElement> =
    useRef<HTMLDivElement>(null);
  const buttonRef: React.RefObject<HTMLButtonElement> =
    useRef<HTMLButtonElement>(null);
  const searchRef: React.RefObject<HTMLInputElement> =
    useRef<HTMLInputElement>(null);

  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [search, setSearch] = useState<string>("");
  const [activeIndex, setActiveIndex] = useState<number>(0);
  const [menuShift, setMenuShift] = useState<number>(0);

  const shownOptions: Array<CodePickerOption> = useMemo(() => {
    if (props.onSearch) {
      return props.options;
    }

    const needle: string = search.trim().toLowerCase();

    if (!needle) {
      return props.options;
    }

    return props.options.filter((option: CodePickerOption): boolean => {
      return (
        option.label.toLowerCase().includes(needle) ||
        (option.description || "").toLowerCase().includes(needle)
      );
    });
  }, [props.options, props.onSearch, search]);

  // The picked option is the one the keys start from.
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const picked: number = shownOptions.findIndex(
      (option: CodePickerOption): boolean => {
        return option.value === props.value;
      },
    );

    setActiveIndex(picked >= 0 ? picked : 0);
  }, [isOpen, shownOptions]);

  // Where the list opens: under its button, moved left to stay on screen.
  useLayoutEffect(() => {
    if (!isOpen || !buttonRef.current) {
      return;
    }

    setMenuShift(
      getPickerMenuShift({
        buttonLeft: buttonRef.current.getBoundingClientRect().left,
        windowWidth: window.innerWidth,
        menuWidth: PICKER_MENU_WIDTH_PX,
      }),
    );
  }, [isOpen]);

  // A click anywhere else closes the list.
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const onPointerDown: (event: MouseEvent) => void = (
      event: MouseEvent,
    ): void => {
      if (
        containerRef.current &&
        event.target instanceof Node &&
        !containerRef.current.contains(event.target)
      ) {
        setIsOpen(false);
      }
    };

    document.addEventListener("mousedown", onPointerDown);

    return () => {
      document.removeEventListener("mousedown", onPointerDown);
    };
  }, [isOpen]);

  useEffect(() => {
    if (isOpen) {
      searchRef.current?.focus();
    }
  }, [isOpen]);

  const open: () => void = (): void => {
    setSearch("");
    setIsOpen(true);
    props.onSearch?.("");
    props.onOpen?.();
  };

  const close: (returnFocus: boolean) => void = (
    returnFocus: boolean,
  ): void => {
    setIsOpen(false);

    if (returnFocus) {
      buttonRef.current?.focus();
    }
  };

  const pick: (option: CodePickerOption) => void = (
    option: CodePickerOption,
  ): void => {
    props.onChange(option.value);
    close(true);
  };

  const onKeyDown: (event: React.KeyboardEvent<HTMLInputElement>) => void = (
    event: React.KeyboardEvent<HTMLInputElement>,
  ): void => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((current: number) => {
        return Math.min(current + 1, shownOptions.length - 1);
      });
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((current: number) => {
        return Math.max(current - 1, 0);
      });
    } else if (event.key === "Enter") {
      event.preventDefault();
      const option: CodePickerOption | undefined = shownOptions[activeIndex];

      if (option) {
        pick(option);
      }
    } else if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === "Tab") {
      close(false);
    }
  };

  // The active option stays in view as the keys move through a long list.
  useEffect(() => {
    if (!isOpen) {
      return;
    }

    const element: HTMLElement | null = document.getElementById(
      `${listId}-option-${activeIndex}`,
    );

    element?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, isOpen]);

  const renderStatus: () => ReactElement = (): ReactElement => {
    if (props.isLoading) {
      return (
        <div
          role="status"
          data-testid={`${props.dataTestId}-loading`}
          className="flex items-center gap-2 px-3 py-3 text-sm text-gray-500"
        >
          <span
            aria-hidden="true"
            className="h-3.5 w-3.5 rounded-full border-2 border-gray-200 border-t-gray-500 motion-safe:animate-spin"
          />
          {props.loadingText || translator.translateText("Loading…")}
        </div>
      );
    }

    if (props.error) {
      return (
        <div
          role="alert"
          data-testid={`${props.dataTestId}-error`}
          className="px-3 py-3 text-sm text-gray-600"
        >
          <p>{props.error}</p>
          {props.onRetry ? (
            <button
              type="button"
              data-testid={`${props.dataTestId}-retry`}
              onClick={() => {
                props.onRetry?.();
                searchRef.current?.focus();
              }}
              className="mt-1.5 font-medium text-indigo-600 hover:text-indigo-500 focus:outline-none focus-visible:underline"
            >
              {translator.translateText("Try again")}
            </button>
          ) : (
            <></>
          )}
        </div>
      );
    }

    return (
      <p
        role="status"
        data-testid={`${props.dataTestId}-empty`}
        className="px-3 py-3 text-sm text-gray-500"
      >
        {props.noMatchText}
      </p>
    );
  };

  const hasOptions: boolean =
    !props.isLoading && !props.error && shownOptions.length > 0;

  return (
    <div
      ref={containerRef}
      data-testid={props.dataTestId}
      className={`relative min-w-0 ${PICKER_MAX_WIDTH_CLASS_NAME}`}
    >
      <button
        ref={buttonRef}
        type="button"
        disabled={props.isDisabled}
        aria-haspopup="listbox"
        aria-expanded={isOpen}
        aria-label={translator.translateTemplate(CODE_PICKER_VALUE_LABEL, {
          label: props.label,
          value: props.valueText,
        })}
        title={props.valueText}
        data-testid={`${props.dataTestId}-button`}
        onClick={() => {
          if (isOpen) {
            close(false);
          } else {
            open();
          }
        }}
        className={`inline-flex h-8 max-w-full items-center gap-1.5 rounded-lg px-2 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
          props.isDisabled
            ? "cursor-not-allowed text-gray-400"
            : `text-gray-700 hover:bg-gray-100 hover:text-gray-900 ${
                isOpen ? "bg-gray-100 text-gray-900" : ""
              }`
        }`}
      >
        <span className="flex h-4 w-4 flex-shrink-0 items-center justify-center">
          {props.icon}
        </span>
        <span
          data-testid={`${props.dataTestId}-value`}
          className={`truncate ${props.isMonospace ? "font-mono" : ""}`}
        >
          {props.valueText}
        </span>
        {props.isDisabled ? (
          <></>
        ) : (
          <Icon
            icon={IconProp.ChevronDown}
            className="h-3 w-3 flex-shrink-0 text-gray-400"
          />
        )}
      </button>

      {isOpen ? (
        <div
          data-testid={`${props.dataTestId}-menu`}
          style={menuShift ? { left: -menuShift } : undefined}
          className="absolute left-0 top-full z-50 mt-1.5 w-72 max-w-[calc(100vw-1.5rem)] overflow-hidden rounded-xl border border-gray-200 bg-white shadow-lg"
        >
          <div className="border-b border-gray-100 p-2">
            <div className="relative">
              <Icon
                icon={IconProp.Search}
                className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-gray-400"
              />
              <input
                data-unsaved-changes-ignore
                ref={searchRef}
                type="text"
                role="combobox"
                aria-expanded={hasOptions}
                aria-controls={listId}
                aria-autocomplete="list"
                aria-activedescendant={
                  hasOptions ? `${listId}-option-${activeIndex}` : undefined
                }
                aria-label={props.searchPlaceholder}
                placeholder={props.searchPlaceholder}
                value={search}
                data-testid={`${props.dataTestId}-search`}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                  setSearch(event.target.value);
                  props.onSearch?.(event.target.value);
                }}
                onKeyDown={onKeyDown}
                className="block w-full rounded-lg border-0 bg-gray-50 py-1.5 pl-8 pr-2 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
              />
            </div>
          </div>

          {hasOptions ? (
            <ul
              id={listId}
              role="listbox"
              aria-label={props.label}
              className="max-h-64 overflow-y-auto overscroll-contain py-1"
            >
              {shownOptions.map((option: CodePickerOption, index: number) => {
                const isPicked: boolean = option.value === props.value;
                const isActive: boolean = index === activeIndex;

                return (
                  <li
                    key={option.value}
                    id={`${listId}-option-${index}`}
                    role="option"
                    aria-selected={isPicked}
                    data-testid={`${props.dataTestId}-option`}
                    data-value={option.value}
                    data-active={isActive ? "true" : undefined}
                    // Picking happens on click; the search box keeps its focus until then.
                    onMouseDown={(event: React.MouseEvent) => {
                      event.preventDefault();
                    }}
                    onMouseEnter={() => {
                      setActiveIndex(index);
                    }}
                    onClick={() => {
                      pick(option);
                    }}
                    className={`flex cursor-pointer items-start gap-2 px-3 py-2 ${
                      isActive ? "bg-gray-50" : ""
                    }`}
                  >
                    <span className="flex h-5 w-4 flex-shrink-0 items-center justify-center text-indigo-600">
                      {isPicked ? (
                        <Icon icon={IconProp.Check} className="h-3.5 w-3.5" />
                      ) : (
                        <></>
                      )}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span
                        className={`block truncate text-sm leading-5 ${
                          props.isMonospace ? "font-mono" : ""
                        } ${
                          option.isMuted
                            ? "text-gray-500"
                            : "font-medium text-gray-900"
                        }`}
                      >
                        {option.label}
                      </span>
                      {option.description ? (
                        <span className="block truncate text-xs leading-5 text-gray-500">
                          {option.description}
                        </span>
                      ) : (
                        <></>
                      )}
                    </span>
                    {option.badge ? (
                      <span className="mt-0.5 flex-shrink-0 whitespace-nowrap rounded-md bg-gray-100 px-1.5 py-0.5 text-[11px] font-medium text-gray-600">
                        {option.badge}
                      </span>
                    ) : (
                      <></>
                    )}
                  </li>
                );
              })}
            </ul>
          ) : (
            renderStatus()
          )}

          {props.note && hasOptions ? (
            <p
              data-testid={`${props.dataTestId}-note`}
              className="border-t border-gray-100 px-3 py-2 text-xs leading-5 text-gray-500"
            >
              {props.note}
            </p>
          ) : (
            <></>
          )}
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default CodePicker;
