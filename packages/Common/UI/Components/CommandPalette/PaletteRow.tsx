import Icon from "../Icon/Icon";
import KeyboardShortcut, {
  KeyboardShortcutSize,
  KeyboardShortcutVariant,
} from "../KeyboardShortcut/KeyboardShortcut";
import { KeyboardShortcutKey } from "../KeyboardShortcut/KeyboardKey";
import IconProp from "../../../Types/Icon/IconProp";
import { getHighlightSegments, PaletteHighlightSegment } from "./PaletteFilter";
import React, { FunctionComponent, ReactElement, ReactNode } from "react";

interface IconColorClasses {
  bg: string;
  ring: string;
  text: string;
}

/*
 * Same Tailwind color-name convention (and palette) as the NavBar items /
 * NavBarMenuModal: a soft tinted square with a ring and a colored glyph.
 * Unknown colors fall back to indigo. Every class here already has an
 * html.dark remap in Theme.css (the navbar menu ships the identical set).
 */
const ICON_COLOR_CLASSES: Record<string, IconColorClasses> = {
  purple: {
    bg: "bg-purple-50",
    ring: "ring-purple-200",
    text: "text-purple-600",
  },
  blue: { bg: "bg-blue-50", ring: "ring-blue-200", text: "text-blue-600" },
  gray: { bg: "bg-gray-100", ring: "ring-gray-300", text: "text-gray-600" },
  amber: { bg: "bg-amber-50", ring: "ring-amber-200", text: "text-amber-600" },
  green: { bg: "bg-green-50", ring: "ring-green-200", text: "text-green-600" },
  cyan: { bg: "bg-cyan-50", ring: "ring-cyan-200", text: "text-cyan-600" },
  slate: { bg: "bg-slate-100", ring: "ring-slate-300", text: "text-slate-600" },
  indigo: {
    bg: "bg-indigo-50",
    ring: "ring-indigo-200",
    text: "text-indigo-600",
  },
  rose: { bg: "bg-rose-50", ring: "ring-rose-200", text: "text-rose-600" },
  violet: {
    bg: "bg-violet-50",
    ring: "ring-violet-200",
    text: "text-violet-600",
  },
  orange: {
    bg: "bg-orange-50",
    ring: "ring-orange-200",
    text: "text-orange-600",
  },
  stone: { bg: "bg-stone-100", ring: "ring-stone-300", text: "text-stone-600" },
  sky: { bg: "bg-sky-50", ring: "ring-sky-200", text: "text-sky-600" },
  emerald: {
    bg: "bg-emerald-50",
    ring: "ring-emerald-200",
    text: "text-emerald-600",
  },
  yellow: {
    bg: "bg-yellow-50",
    ring: "ring-yellow-200",
    text: "text-yellow-600",
  },
  red: { bg: "bg-red-50", ring: "ring-red-200", text: "text-red-600" },
  teal: { bg: "bg-teal-50", ring: "ring-teal-200", text: "text-teal-600" },
};

/** What a palette row needs to paint itself — command and provider results both reduce to this. */
export interface PaletteRowItem {
  /**
   * Unique across everything visible in the palette (recents are prefixed,
   * provider results are namespaced by provider id). Used for the option's
   * DOM id and data-testid.
   */
  id: string;
  title: string;
  description?: string | undefined;
  icon?: IconProp | undefined;
  iconColor?: string | undefined;
  shortcut?: Array<KeyboardShortcutKey> | undefined;
}

export interface ComponentProps {
  item: PaletteRowItem;
  /** Current search text — matching runs of title/description get a <mark>. */
  query: string;
  isActive: boolean;
  /** Selection follows the mouse: fired on mousemove over the row. */
  onActivate: () => void;
  onSelect: () => void;
  setRowElement: (element: HTMLDivElement | null) => void;
}

// Wrap the portions of text that match the query in a highlight.
const highlightMatch: (text: string, query: string) => ReactNode = (
  text: string,
  query: string,
): ReactNode => {
  const segments: Array<PaletteHighlightSegment> = getHighlightSegments(
    text,
    query,
  );
  return segments.map((segment: PaletteHighlightSegment, index: number) => {
    if (!segment.isMatch) {
      return <React.Fragment key={index}>{segment.text}</React.Fragment>;
    }
    return (
      <mark
        key={index}
        className="rounded-sm bg-yellow-100 px-0.5 text-inherit"
      >
        {segment.text}
      </mark>
    );
  });
};

const PaletteRow: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const item: PaletteRowItem = props.item;
  const colors: IconColorClasses =
    ICON_COLOR_CLASSES[item.iconColor || "indigo"] ||
    ICON_COLOR_CLASSES["indigo"]!;

  return (
    <div
      id={`command-palette-option-${item.id}`}
      data-testid={`command-palette-option-${item.id}`}
      role="option"
      aria-selected={props.isActive}
      ref={(element: HTMLDivElement | null) => {
        props.setRowElement(element);
      }}
      onMouseMove={() => {
        props.onActivate();
      }}
      onClick={() => {
        props.onSelect();
      }}
      className={`flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2 transition-colors duration-100 ${
        props.isActive ? "bg-indigo-50" : ""
      }`}
    >
      {item.icon && (
        <div
          className={`flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ring-1 ${colors.bg} ${colors.ring}`}
        >
          <Icon icon={item.icon} className={`h-4 w-4 ${colors.text}`} />
        </div>
      )}
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-medium text-gray-900">
          {highlightMatch(item.title, props.query)}
        </p>
        {item.description && (
          <p className="truncate text-xs text-gray-500">
            {highlightMatch(item.description, props.query)}
          </p>
        )}
      </div>
      {item.shortcut && item.shortcut.length > 0 && (
        <KeyboardShortcut
          keys={item.shortcut}
          size={KeyboardShortcutSize.ExtraSmall}
          variant={KeyboardShortcutVariant.Ghost}
          className="flex-shrink-0"
        />
      )}
    </div>
  );
};

export default PaletteRow;
