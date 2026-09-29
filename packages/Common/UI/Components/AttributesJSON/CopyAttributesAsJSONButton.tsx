import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
} from "react";
import IconProp from "../../../Types/Icon/IconProp";
import {
  ATTRIBUTES_JSON_FORMATS,
  AttributesJSONFormat,
  countAttributes,
  previewAttributesJSON,
  stringifyAttributesJSON,
} from "../../../Utils/Telemetry/AttributesJSON";
import Clipboard from "../../Utils/Clipboard";
import Icon from "../Icon/Icon";
import {
  ATTRIBUTES_JSON_FORMAT_DESCRIPTIONS,
  ATTRIBUTES_JSON_FORMAT_LABELS,
  useAttributesJSONFormat,
} from "./AttributesJSONPreferences";
import BracesGlyph from "./BracesGlyph";

/*
 * "Copy JSON" for a set of telemetry attributes: a split button whose main
 * half copies in the viewer's preferred shape and whose caret opens a small
 * picker - flat or nested, each with a one-line preview built from the real
 * first attribute - that copies in that shape and remembers it.
 *
 * Detail panels listen for Escape (close the drawer) and Enter (toggle the
 * focused log row) on the document. Those keys belong to this control while
 * it has focus, so they are stopped here instead of also closing the panel
 * the user is copying from.
 */

export interface ComponentProps {
  attributes: unknown;
  // The visible text of the main button. Default: "Copy JSON".
  label?: string | undefined;
  // What is being copied, in tooltips and announcements. Default: "attributes".
  subject?: string | undefined;
  size?: "xs" | "sm" | undefined;
  // Icon-only main button, for a control that sits on every row of a list.
  compact?: boolean | undefined;
  // Which edge of the control the format menu lines up with.
  menuAlign?: "left" | "right" | undefined;
  className?: string | undefined;
  dataTestId?: string | undefined;
}

type CopyStatus = "idle" | "copied" | "failed";

const STATUS_RESET_MS: number = 1600;

function pluralizeAttributes(count: number): string {
  return `${count} ${count === 1 ? "attribute" : "attributes"}`;
}

const CopyAttributesAsJSONButton: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement | null => {
  const [format, setFormat] = useAttributesJSONFormat();
  const [isMenuOpen, setIsMenuOpen] = useState<boolean>(false);
  const [status, setStatus] = useState<CopyStatus>("idle");
  const [announcement, setAnnouncement] = useState<string>("");

  const wrapperRef: React.MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);
  const mainButtonRef: React.MutableRefObject<HTMLButtonElement | null> =
    useRef<HTMLButtonElement | null>(null);
  const caretButtonRef: React.MutableRefObject<HTMLButtonElement | null> =
    useRef<HTMLButtonElement | null>(null);
  const itemRefs: React.MutableRefObject<Array<HTMLButtonElement | null>> =
    useRef<Array<HTMLButtonElement | null>>([]);
  const resetTimerRef: React.MutableRefObject<ReturnType<
    typeof setTimeout
  > | null> = useRef<ReturnType<typeof setTimeout> | null>(null);
  const isMountedRef: React.MutableRefObject<boolean> = useRef<boolean>(true);

  const menuId: string = `${useId()}-json-format-menu`;
  const label: string = props.label || "Copy JSON";
  const subject: string = props.subject || "attributes";
  const size: "xs" | "sm" = props.size || "xs";
  const menuAlign: "left" | "right" = props.menuAlign || "right";

  const count: number = useMemo((): number => {
    return countAttributes(props.attributes);
  }, [props.attributes]);

  const previews: Record<AttributesJSONFormat, string> = useMemo(() => {
    return {
      flat: previewAttributesJSON(props.attributes, "flat"),
      nested: previewAttributesJSON(props.attributes, "nested"),
    };
  }, [props.attributes]);

  useEffect(() => {
    isMountedRef.current = true;

    return () => {
      isMountedRef.current = false;

      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }
    };
  }, []);

  // A click anywhere outside the control closes the menu.
  useEffect(() => {
    if (!isMenuOpen) {
      return undefined;
    }

    const handlePointerDown: (event: MouseEvent) => void = (
      event: MouseEvent,
    ): void => {
      if (
        wrapperRef.current &&
        event.target instanceof Node &&
        !wrapperRef.current.contains(event.target)
      ) {
        setIsMenuOpen(false);
      }
    };

    document.addEventListener("mousedown", handlePointerDown);

    return () => {
      document.removeEventListener("mousedown", handlePointerDown);
    };
  }, [isMenuOpen]);

  // Opening the menu puts focus on the format currently in use.
  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }

    const selectedIndex: number = ATTRIBUTES_JSON_FORMATS.indexOf(format);
    itemRefs.current[Math.max(0, selectedIndex)]?.focus();
    // Only on open: moving between items must not snap focus back.
  }, [isMenuOpen]);

  const showStatus: (next: CopyStatus) => void = useCallback(
    (next: CopyStatus): void => {
      setStatus(next);

      if (resetTimerRef.current) {
        clearTimeout(resetTimerRef.current);
      }

      resetTimerRef.current = setTimeout(() => {
        resetTimerRef.current = null;

        if (isMountedRef.current) {
          setStatus("idle");
        }
      }, STATUS_RESET_MS);
    },
    [],
  );

  const copy: (copyFormat: AttributesJSONFormat) => Promise<void> = async (
    copyFormat: AttributesJSONFormat,
  ): Promise<void> => {
    const text: string = stringifyAttributesJSON(props.attributes, copyFormat);
    const succeeded: boolean = await Clipboard.copyToClipboard(text);

    if (!isMountedRef.current) {
      return;
    }

    showStatus(succeeded ? "copied" : "failed");
    setAnnouncement(
      succeeded
        ? `Copied ${pluralizeAttributes(count)} as ${copyFormat} JSON`
        : "Could not copy to the clipboard",
    );
  };

  const closeMenu: (options?: { restoreFocus?: boolean }) => void = (options?: {
    restoreFocus?: boolean;
  }): void => {
    setIsMenuOpen(false);

    if (options?.restoreFocus) {
      caretButtonRef.current?.focus();
    }
  };

  const chooseFormat: (nextFormat: AttributesJSONFormat) => void = (
    nextFormat: AttributesJSONFormat,
  ): void => {
    setFormat(nextFormat);
    setIsMenuOpen(false);
    mainButtonRef.current?.focus();
    void copy(nextFormat);
  };

  const moveFocus: (delta: number | "first" | "last") => void = (
    delta: number | "first" | "last",
  ): void => {
    const items: Array<HTMLButtonElement> = itemRefs.current.filter(
      (item: HTMLButtonElement | null): item is HTMLButtonElement => {
        return item !== null;
      },
    );

    if (items.length === 0) {
      return;
    }

    const activeIndex: number = items.findIndex((item: HTMLButtonElement) => {
      return item === document.activeElement;
    });

    let nextIndex: number;

    if (delta === "first") {
      nextIndex = 0;
    } else if (delta === "last") {
      nextIndex = items.length - 1;
    } else {
      const from: number = activeIndex < 0 ? 0 : activeIndex;
      nextIndex = (from + delta + items.length) % items.length;
    }

    items[nextIndex]?.focus();
  };

  const handleKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void = (
    event: React.KeyboardEvent<HTMLDivElement>,
  ): void => {
    if (event.key === "Enter" || event.key === " ") {
      // Activates the focused button natively; nothing else should react.
      event.stopPropagation();
      return;
    }

    if (event.key === "Escape") {
      if (isMenuOpen) {
        event.preventDefault();
        event.stopPropagation();
        closeMenu({ restoreFocus: true });
      }
      return;
    }

    if (!isMenuOpen) {
      if (
        event.key === "ArrowDown" &&
        event.target === caretButtonRef.current
      ) {
        event.preventDefault();
        setIsMenuOpen(true);
      }
      return;
    }

    switch (event.key) {
      case "ArrowDown":
        event.preventDefault();
        moveFocus(1);
        break;
      case "ArrowUp":
        event.preventDefault();
        moveFocus(-1);
        break;
      case "Home":
        event.preventDefault();
        moveFocus("first");
        break;
      case "End":
        event.preventDefault();
        moveFocus("last");
        break;
      case "Tab":
        closeMenu();
        break;
      default:
        break;
    }
  };

  if (count === 0) {
    return null;
  }

  const isXs: boolean = size === "xs";
  const heightClass: string = isXs ? "h-6" : "h-7";
  const textClass: string = isXs ? "text-[11px]" : "text-xs";
  const mainPaddingClass: string = props.compact
    ? isXs
      ? "px-1.5"
      : "px-2"
    : isXs
      ? "px-2"
      : "px-2.5";
  const iconClass: string = isXs ? "h-3.5 w-3.5" : "h-4 w-4";

  const frameClass: string =
    status === "copied"
      ? "border-emerald-300 ring-emerald-100"
      : status === "failed"
        ? "border-red-300 ring-red-100"
        : "border-gray-200 ring-transparent hover:border-gray-300";

  const mainStateClass: string =
    status === "copied"
      ? "bg-emerald-50 text-emerald-700"
      : status === "failed"
        ? "bg-red-50 text-red-700"
        : "text-gray-600 hover:bg-gray-50 hover:text-gray-900";

  const mainText: string =
    status === "copied"
      ? "Copied"
      : status === "failed"
        ? "Copy failed"
        : label;

  const mainTitle: string = `Copy ${pluralizeAttributes(count)} as ${format} JSON`;

  return (
    <div
      ref={wrapperRef}
      className={`relative inline-flex flex-none ${props.className || ""}`}
      onKeyDown={handleKeyDown}
      data-testid={props.dataTestId}
    >
      <div
        className={`inline-flex items-stretch rounded-md border bg-white shadow-sm ring-2 transition-[border-color,box-shadow] duration-150 ${heightClass} ${frameClass}`}
      >
        <button
          ref={mainButtonRef}
          type="button"
          className={`inline-flex items-center gap-1.5 rounded-l-[5px] font-medium transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 ${textClass} ${mainPaddingClass} ${mainStateClass}`}
          title={mainTitle}
          aria-label={props.compact ? `Copy ${subject} as JSON` : undefined}
          data-copy-format={format}
          onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
            event.preventDefault();
            event.stopPropagation();
            void copy(format);
          }}
        >
          <span aria-hidden="true" className="flex items-center justify-center">
            {status === "copied" ? (
              <Icon
                icon={IconProp.Check}
                className={`${iconClass} text-emerald-600`}
              />
            ) : status === "failed" ? (
              <Icon
                icon={IconProp.Alert}
                className={`${iconClass} text-red-500`}
              />
            ) : (
              <BracesGlyph className={`${iconClass} text-indigo-500`} />
            )}
          </span>
          {props.compact ? null : (
            <span className="whitespace-nowrap">{mainText}</span>
          )}
        </button>
        <span aria-hidden="true" className="w-px self-stretch bg-gray-200" />
        <button
          ref={caretButtonRef}
          type="button"
          className={`inline-flex items-center rounded-r-[5px] px-1 text-gray-400 transition-colors duration-150 hover:bg-gray-50 hover:text-gray-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 ${
            isMenuOpen ? "bg-gray-50 text-gray-700" : ""
          }`}
          title="Choose JSON format"
          aria-label="Choose JSON format"
          aria-haspopup="menu"
          aria-expanded={isMenuOpen}
          aria-controls={isMenuOpen ? menuId : undefined}
          onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
            event.preventDefault();
            event.stopPropagation();
            setIsMenuOpen(!isMenuOpen);
          }}
        >
          <Icon
            icon={IconProp.ChevronDown}
            className={`h-3 w-3 transition-transform duration-150 ${
              isMenuOpen ? "rotate-180" : ""
            }`}
          />
        </button>
      </div>

      {isMenuOpen && (
        <div
          id={menuId}
          role="menu"
          aria-label="Copy attributes as"
          aria-orientation="vertical"
          className={`absolute top-full z-50 mt-1.5 w-72 rounded-lg bg-white p-1 text-left shadow-lg ring-1 ring-gray-900/10 ${
            menuAlign === "right"
              ? "right-0 origin-top-right"
              : "left-0 origin-top-left"
          }`}
        >
          <div className="px-2.5 pb-1 pt-1.5 text-[10px] font-semibold uppercase tracking-wider text-gray-400">
            Copy {subject} as
          </div>
          {ATTRIBUTES_JSON_FORMATS.map(
            (itemFormat: AttributesJSONFormat, index: number): ReactElement => {
              const isSelected: boolean = itemFormat === format;

              return (
                <button
                  key={itemFormat}
                  ref={(element: HTMLButtonElement | null) => {
                    itemRefs.current[index] = element;
                  }}
                  type="button"
                  role="menuitemradio"
                  aria-checked={isSelected}
                  tabIndex={-1}
                  data-format={itemFormat}
                  className="group flex w-full items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors duration-100 hover:bg-gray-50 focus:bg-indigo-50 focus:outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-indigo-300"
                  onClick={(event: React.MouseEvent<HTMLButtonElement>) => {
                    event.preventDefault();
                    event.stopPropagation();
                    chooseFormat(itemFormat);
                  }}
                >
                  <span
                    aria-hidden="true"
                    className={`mt-0.5 flex h-7 w-7 flex-none items-center justify-center rounded-md ring-1 ring-inset transition-colors duration-100 ${
                      isSelected
                        ? "bg-indigo-50 text-indigo-600 ring-indigo-200"
                        : "bg-gray-50 text-gray-500 ring-gray-200 group-hover:bg-white group-hover:text-indigo-600 group-focus:bg-white group-focus:text-indigo-600"
                    }`}
                  >
                    {itemFormat === "flat" ? (
                      <Icon icon={IconProp.List} className="h-3.5 w-3.5" />
                    ) : (
                      <BracesGlyph className="h-3.5 w-3.5" />
                    )}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-gray-900">
                        {ATTRIBUTES_JSON_FORMAT_LABELS[itemFormat]} JSON
                      </span>
                      {isSelected && (
                        <Icon
                          icon={IconProp.Check}
                          className="h-3.5 w-3.5 flex-none text-indigo-600"
                        />
                      )}
                    </span>
                    <span className="block text-[11px] leading-4 text-gray-500">
                      {ATTRIBUTES_JSON_FORMAT_DESCRIPTIONS[itemFormat]}
                    </span>
                    <code
                      className="mt-1.5 block truncate rounded bg-gray-50 px-1.5 py-1 font-mono text-[10.5px] leading-4 text-gray-600 ring-1 ring-inset ring-gray-100"
                      title={previews[itemFormat]}
                    >
                      {previews[itemFormat]}
                    </code>
                  </span>
                </button>
              );
            },
          )}
          <div className="mt-1 flex items-center justify-between gap-3 border-t border-gray-100 px-2.5 pb-1 pt-2 text-[10.5px] text-gray-400">
            <span className="whitespace-nowrap tabular-nums">
              {pluralizeAttributes(count)}
            </span>
            <span className="truncate">Values keep their types</span>
          </div>
        </div>
      )}

      <span className="sr-only" role="status" aria-live="polite">
        {announcement}
      </span>
    </div>
  );
};

export default CopyAttributesAsJSONButton;
