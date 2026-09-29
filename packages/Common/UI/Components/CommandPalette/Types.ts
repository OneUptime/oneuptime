import IconProp from "../../../Types/Icon/IconProp";
import { KeyboardShortcutKey } from "../KeyboardShortcut/KeyboardKey";

/**
 * One executable entry in the command palette: a page to jump to, or an
 * action to run. Commands are static (known before the user types) — async
 * results from the backend go through PaletteSearchProvider instead.
 */
export interface PaletteCommand {
  /** Stable unique id — recents are persisted as a list of these ids. */
  id: string;
  title: string;
  description?: string | undefined;
  icon?: IconProp | undefined;
  /** Tailwind color name like "blue" | "purple" — same convention as NavBar items. */
  iconColor?: string | undefined;
  /** Section the command is grouped under when browsing (e.g. "Essentials"). */
  category: string;
  /** Extra match terms the user might type that are not in the title. */
  keywords?: Array<string> | undefined;
  /** Optional shortcut hint rendered as keycaps on the row. */
  shortcut?: Array<KeyboardShortcutKey> | undefined;
  onSelect: () => void;
}

/** One row returned by an async search provider. */
export interface PaletteSearchResult {
  /** Unique within the provider's result set. */
  id: string;
  title: string;
  description?: string | undefined;
  icon?: IconProp | undefined;
  /** Tailwind color name like "blue" | "purple" — same convention as NavBar items. */
  iconColor?: string | undefined;
  onSelect: () => void;
}

/**
 * Async source of palette rows (e.g. "search monitors by name"). Providers
 * run in parallel once the query is long enough; a provider that rejects
 * shows nothing — it must never take the palette down with it.
 */
export interface PaletteSearchProvider {
  /** Stable unique id, also used in section test ids. */
  id: string;
  /** Section heading shown above this provider's results. */
  title: string;
  search: (searchText: string) => Promise<Array<PaletteSearchResult>>;
}
