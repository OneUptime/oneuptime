import Icon from "../Icon/Icon";
import KeyboardShortcut, {
  KeyboardShortcutSize,
  KeyboardShortcutVariant,
} from "../KeyboardShortcut/KeyboardShortcut";
import KeyboardKey, {
  KeyboardShortcutKey,
} from "../KeyboardShortcut/KeyboardKey";
import IconProp from "../../../Types/Icon/IconProp";
import useTranslateValue from "../../Utils/Translation";
import { usePageScrollLock } from "../../Utils/PageScrollLock";
import {
  PaletteCommand,
  PaletteSearchProvider,
  PaletteSearchResult,
} from "./Types";
import {
  filterPaletteCommands,
  getPaletteSectionId,
  normalizePaletteQuery,
  PaletteCommandMatch,
} from "./PaletteFilter";
import {
  readRecentCommandIds,
  RECENT_COMMANDS_LIMIT,
  writeRecentCommandId,
} from "./RecentCommands";
import useProviderSearch, { ProviderSearchSection } from "./UseProviderSearch";
import PaletteRow from "./PaletteRow";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { createPortal } from "react-dom";

export interface ComponentProps {
  commands: Array<PaletteCommand>;
  searchProviders?: Array<PaletteSearchProvider> | undefined;
  isOpen: boolean;
  onClose: () => void;
  /** When set, selected command ids are persisted here and surface as "Recent". */
  recentStorageKey?: string | undefined;
}

/** One selectable row in the flattened keyboard order. */
interface FlatEntry {
  /** Unique across the whole open palette (recents/provider results are prefixed). */
  id: string;
  title: string;
  description?: string | undefined;
  icon?: IconProp | undefined;
  iconColor?: string | undefined;
  shortcut?: Array<KeyboardShortcutKey> | undefined;
  /** The id recorded into recents — only static commands carry one. */
  recentCommandId: string | null;
  onSelect: () => void;
  flatIndex: number;
}

interface PaletteSectionView {
  /** Slug used in `command-palette-section-<id>` test ids. */
  id: string;
  title: string;
  /** True while this (provider) section's search is still in flight. */
  isPending: boolean;
  entries: Array<FlatEntry>;
}

const EMPTY_PROVIDERS: Array<PaletteSearchProvider> = [];

type HasPendingSectionFunction = (
  sections: Array<PaletteSectionView>,
) => boolean;

const hasPendingSection: HasPendingSectionFunction = (
  sections: Array<PaletteSectionView>,
): boolean => {
  return sections.some((section: PaletteSectionView) => {
    return section.isPending;
  });
};

type CommandToEntryFunction = (
  command: PaletteCommand,
  idPrefix: string,
) => Omit<FlatEntry, "flatIndex">;

const commandToEntry: CommandToEntryFunction = (
  command: PaletteCommand,
  idPrefix: string,
): Omit<FlatEntry, "flatIndex"> => {
  return {
    id: `${idPrefix}${command.id}`,
    title: command.title,
    description: command.description,
    icon: command.icon,
    iconColor: command.iconColor,
    shortcut: command.shortcut,
    recentCommandId: command.id,
    onSelect: command.onSelect,
  };
};

/*
 * The open palette lives in its own component so that every open is a fresh
 * mount: the enter animation, the autofocus, the scroll lock, and the
 * read-once recents snapshot all run per open instead of once per page.
 */
interface PanelProps {
  commands: Array<PaletteCommand>;
  searchProviders: Array<PaletteSearchProvider>;
  onClose: () => void;
  recentStorageKey?: string | undefined;
}

const CommandPalettePanel: FunctionComponent<PanelProps> = (
  props: PanelProps,
): ReactElement => {
  const [query, setQuery] = useState<string>("");
  const [activeIndex, setActiveIndex] = useState<number>(0);

  /*
   * The panel mounts in its closed state and is flipped open one frame later
   * so the browser has something to transition from (Modal's pattern).
   */
  const [hasEntered, setHasEntered] = useState<boolean>(false);

  const inputRef: React.RefObject<HTMLInputElement> =
    useRef<HTMLInputElement>(null);
  const rowRefs: React.MutableRefObject<Array<HTMLDivElement | null>> = useRef<
    Array<HTMLDivElement | null>
  >([]);

  /*
   * Whatever had focus when the palette opened gets it back on close —
   * captured at first render, before the autofocus effect moves focus into
   * the input (Modal's pattern).
   */
  const previouslyFocusedElementRef: React.MutableRefObject<HTMLElement | null> =
    useRef<HTMLElement | null>(
      typeof document !== "undefined" &&
        document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null,
    );

  // Kept fresh so the mount-once document listener never calls a stale close.
  const onCloseRef: React.MutableRefObject<() => void> = useRef<() => void>(
    props.onClose,
  );

  useEffect(() => {
    onCloseRef.current = props.onClose;
  }, [props.onClose]);

  // Recently run command ids, read once when the palette opens.
  const [recentCommandIds] = useState<Array<string>>(() => {
    return props.recentStorageKey
      ? readRecentCommandIds(props.recentStorageKey)
      : [];
  });

  /*
   * Callers hand us plain English literals. Run every user-facing string
   * through the same flat-key lookup the navbar uses so localised deployments
   * render localised chrome.
   */
  const { translateString } = useTranslateValue();
  const tx: (value: string) => string = (value: string): string => {
    return translateString(value) ?? value;
  };

  useEffect(() => {
    const open: () => void = (): void => {
      setHasEntered(true);
    };

    const frame: number = requestAnimationFrame(open);

    /*
     * A hidden or throttled tab never runs an animation frame; the timer is
     * the safety net that skips the transition rather than the palette.
     */
    const fallbackTimer: ReturnType<typeof setTimeout> = setTimeout(open, 80);

    return () => {
      cancelAnimationFrame(frame);
      clearTimeout(fallbackTimer);
    };
  }, []);

  // The page behind the palette must not scroll while it is open.
  usePageScrollLock(true);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  /*
   * Escape must dismiss the palette even after focus has escaped the dialog
   * subtree (a click on the backdrop scrollbar, a programmatic blur): the
   * React onKeyDown on the dialog root only hears keys fired inside it, so a
   * document-level listener backs it up while the panel is mounted (Modal's
   * pattern). No double-fire: the React handler preventDefaults AND stops
   * propagation, so an Escape it consumed either never reaches document or
   * arrives flagged defaultPrevented — which is also the flag any other
   * dialog above us would set.
   */
  useEffect(() => {
    const handleDocumentKeyDown: (event: KeyboardEvent) => void = (
      event: KeyboardEvent,
    ): void => {
      if (event.defaultPrevented || event.key !== "Escape") {
        return;
      }

      // Flag the key consumed for listeners after us (window-level ones too).
      event.preventDefault();
      onCloseRef.current();
    };

    document.addEventListener("keydown", handleDocumentKeyDown);

    return () => {
      document.removeEventListener("keydown", handleDocumentKeyDown);
    };
  }, []);

  // Return focus to where it was before the palette opened (Modal's pattern).
  useEffect(() => {
    return () => {
      if (previouslyFocusedElementRef.current?.isConnected) {
        previouslyFocusedElementRef.current.focus();
      }
    };
  }, []);

  const providerSections: Array<ProviderSearchSection> = useProviderSearch(
    props.searchProviders,
    query,
  );

  const normalizedQuery: string = normalizePaletteQuery(query);

  const sections: Array<PaletteSectionView> = useMemo(() => {
    const built: Array<PaletteSectionView> = [];

    type PushSectionFunction = (
      id: string,
      title: string,
      isPending: boolean,
      entries: Array<Omit<FlatEntry, "flatIndex">>,
    ) => void;

    const pushSection: PushSectionFunction = (
      id: string,
      title: string,
      isPending: boolean,
      entries: Array<Omit<FlatEntry, "flatIndex">>,
    ): void => {
      built.push({
        id,
        title,
        isPending,
        // flatIndex is stamped in a single pass after all sections exist.
        entries: entries as Array<FlatEntry>,
      });
    };

    type GroupByCategoryFunction = (
      commands: Array<PaletteCommand>,
    ) => Array<{ category: string; commands: Array<PaletteCommand> }>;

    // Group commands by category, preserving first-seen order.
    const groupByCategory: GroupByCategoryFunction = (
      commands: Array<PaletteCommand>,
    ): Array<{ category: string; commands: Array<PaletteCommand> }> => {
      const order: Array<string> = [];
      const byCategory: Map<string, Array<PaletteCommand>> = new Map();
      commands.forEach((command: PaletteCommand) => {
        const category: string = command.category || "Other";
        if (!byCategory.has(category)) {
          byCategory.set(category, []);
          order.push(category);
        }
        byCategory.get(category)!.push(command);
      });
      return order.map((category: string) => {
        return { category, commands: byCategory.get(category)! };
      });
    };

    if (!normalizedQuery) {
      // Browsing: "Recent" first (when we have any), then the full catalog.
      if (recentCommandIds.length > 0) {
        const commandById: Map<string, PaletteCommand> = new Map();
        props.commands.forEach((command: PaletteCommand) => {
          commandById.set(command.id, command);
        });
        const recentCommands: Array<PaletteCommand> = [];
        recentCommandIds.forEach((commandId: string) => {
          const command: PaletteCommand | undefined =
            commandById.get(commandId);
          if (command) {
            recentCommands.push(command);
          }
        });
        if (recentCommands.length > 0) {
          pushSection(
            "recent",
            "Recent",
            false,
            recentCommands
              .slice(0, RECENT_COMMANDS_LIMIT)
              /*
               * Recents repeat commands that also sit in their category
               * section below — prefix the entry id so option test ids and
               * DOM ids stay unique.
               */
              .map((command: PaletteCommand) => {
                return commandToEntry(command, "recent-");
              }),
          );
        }
      }

      groupByCategory(props.commands).forEach(
        (group: { category: string; commands: Array<PaletteCommand> }) => {
          pushSection(
            getPaletteSectionId(group.category),
            group.category,
            false,
            group.commands.map((command: PaletteCommand) => {
              return commandToEntry(command, "");
            }),
          );
        },
      );
    } else {
      /*
       * Searching: ranked command matches grouped by category — the ranked
       * order decides both row order within a section and which category
       * surfaces first — then one section per async provider.
       */
      const matches: Array<PaletteCommandMatch> = filterPaletteCommands(
        props.commands,
        query,
      );
      groupByCategory(
        matches.map((match: PaletteCommandMatch) => {
          return match.command;
        }),
      ).forEach(
        (group: { category: string; commands: Array<PaletteCommand> }) => {
          pushSection(
            getPaletteSectionId(group.category),
            group.category,
            false,
            group.commands.map((command: PaletteCommand) => {
              return commandToEntry(command, "");
            }),
          );
        },
      );

      providerSections.forEach((providerSection: ProviderSearchSection) => {
        // A provider with nothing to show (or that failed) has no section.
        if (
          !providerSection.isPending &&
          providerSection.results.length === 0
        ) {
          return;
        }
        pushSection(
          providerSection.provider.id,
          providerSection.provider.title,
          providerSection.isPending,
          providerSection.results.map((result: PaletteSearchResult) => {
            return {
              id: `${providerSection.provider.id}-${result.id}`,
              title: result.title,
              description: result.description,
              icon: result.icon,
              iconColor: result.iconColor,
              shortcut: undefined,
              recentCommandId: null,
              onSelect: result.onSelect,
            };
          }),
        );
      });
    }

    // Stamp each entry with its index in the flattened keyboard order.
    let flatIndex: number = 0;
    built.forEach((section: PaletteSectionView) => {
      section.entries.forEach((entry: FlatEntry) => {
        entry.flatIndex = flatIndex;
        flatIndex++;
      });
    });

    return built;
  }, [
    normalizedQuery,
    query,
    props.commands,
    recentCommandIds,
    providerSections,
  ]);

  // Flattened list in render order — the keyboard walks this.
  const flatEntries: Array<FlatEntry> = useMemo(() => {
    return sections.reduce(
      (accumulator: Array<FlatEntry>, section: PaletteSectionView) => {
        section.entries.forEach((entry: FlatEntry) => {
          accumulator.push(entry);
        });
        return accumulator;
      },
      [],
    );
  }, [sections]);

  // A new query snaps the selection back to the best match.
  useEffect(() => {
    setActiveIndex(0);
  }, [query]);

  /*
   * Clamp the selection when async results shrink the list under it. The
   * functional updater matters: on a query change this effect and the reset
   * above run in the same pass, and reading activeIndex from the closure here
   * would clobber the queued reset with a stale clamp.
   */
  useEffect(() => {
    if (flatEntries.length === 0) {
      return;
    }
    setActiveIndex((index: number) => {
      return index > flatEntries.length - 1 ? flatEntries.length - 1 : index;
    });
  }, [flatEntries.length]);

  // Keep the active row scrolled into view as the selection moves.
  useEffect(() => {
    const row: HTMLDivElement | null = rowRefs.current[activeIndex] || null;
    if (row && typeof row.scrollIntoView === "function") {
      row.scrollIntoView({ block: "nearest" });
    }
  }, [activeIndex]);

  const runEntry: (entry: FlatEntry) => void = (entry: FlatEntry): void => {
    if (entry.recentCommandId && props.recentStorageKey) {
      writeRecentCommandId(props.recentStorageKey, entry.recentCommandId);
    }
    entry.onSelect();
    props.onClose();
  };

  /*
   * One handler on the dialog root: keys fired in the input bubble here, and
   * so do keys fired with focus anywhere else inside the palette. Every
   * handled key calls preventDefault so listeners beneath the palette
   * (page shortcuts, scrolling) can see the key was consumed. Escape goes
   * one step further and also stops propagating: the topmost dialog consumes
   * its dismiss key outright, so document/window Escape listeners underneath
   * (the Ask AI slide-over, page-level shortcuts) never see it at all.
   */
  const handleKeyDown: (event: React.KeyboardEvent<HTMLDivElement>) => void = (
    event: React.KeyboardEvent<HTMLDivElement>,
  ): void => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      props.onClose();
      return;
    }
    if (flatEntries.length === 0) {
      return;
    }
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index: number) => {
        return (index + 1) % flatEntries.length;
      });
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index: number) => {
        return (index - 1 + flatEntries.length) % flatEntries.length;
      });
    } else if (event.key === "Home") {
      event.preventDefault();
      setActiveIndex(0);
    } else if (event.key === "End") {
      event.preventDefault();
      setActiveIndex(flatEntries.length - 1);
    } else if (event.key === "Enter") {
      event.preventDefault();
      const entry: FlatEntry | undefined = flatEntries[activeIndex];
      if (entry) {
        runEntry(entry);
      }
    }
  };

  /*
   * A mousedown on non-interactive panel chrome (section headers, the hints
   * footer, the empty state) would move focus to the body and kill arrow-key
   * navigation. preventDefault keeps focus in the input. Interactive targets
   * keep their default: the input (caret/selection), option rows, and the
   * scroll container itself — a scrollbar drag starts as a mousedown on it,
   * and preventDefault would cancel the drag.
   */
  const handlePanelMouseDown: (
    event: React.MouseEvent<HTMLDivElement>,
  ) => void = (event: React.MouseEvent<HTMLDivElement>): void => {
    const target: HTMLElement | null =
      event.target instanceof HTMLElement ? event.target : null;

    if (!target) {
      return;
    }

    if (target.id === "command-palette-listbox") {
      return;
    }

    if (target.closest('input, textarea, select, button, a, [role="option"]')) {
      return;
    }

    event.preventDefault();
  };

  const activeEntry: FlatEntry | undefined = flatEntries[activeIndex];

  /*
   * Once the panel has settled it carries no transform at all — a lingering
   * scale would make it the containing block for position:fixed descendants
   * (the Modal invariant).
   */
  const panelTransitionClassName: string = hasEntered
    ? "opacity-100"
    : "scale-[0.98] opacity-0";

  const resultCount: number = flatEntries.length;

  return (
    <div
      className="relative z-50"
      role="dialog"
      aria-modal="true"
      aria-label={tx("Command palette")}
      data-testid="command-palette"
      onKeyDown={handleKeyDown}
    >
      {/* Backdrop */}
      <div
        className={`fixed inset-0 bg-gray-500/25 backdrop-blur-sm transition-opacity duration-150 ease-out motion-reduce:transition-none ${
          hasEntered ? "opacity-100" : "opacity-0"
        }`}
        data-testid="command-palette-backdrop"
        aria-hidden="true"
      />

      {/* Scroll + click-away container */}
      <div
        className="fixed inset-0 z-50 overflow-y-auto"
        onClick={props.onClose}
      >
        <div className="flex min-h-full items-start justify-center p-4 sm:p-6">
          <div
            className={`relative mt-[15vh] flex w-full max-w-xl flex-col overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-black/5 transition duration-150 ease-out motion-reduce:transition-none ${panelTransitionClassName}`}
            data-testid="command-palette-panel"
            onClick={(event: React.MouseEvent<HTMLDivElement>) => {
              event.stopPropagation();
            }}
            onMouseDown={handlePanelMouseDown}
          >
            {/* Search input */}
            <div className="flex items-center gap-3 border-b border-gray-100 px-4 py-3.5">
              <Icon
                icon={IconProp.Search}
                className="h-5 w-5 flex-shrink-0 text-gray-400"
              />
              <input
                ref={inputRef}
                data-testid="command-palette-input"
                type="text"
                role="combobox"
                aria-expanded={true}
                aria-autocomplete="list"
                aria-controls="command-palette-listbox"
                aria-activedescendant={
                  activeEntry
                    ? `command-palette-option-${activeEntry.id}`
                    : undefined
                }
                aria-label={tx("Search pages, actions…")}
                autoComplete="off"
                autoCorrect="off"
                autoCapitalize="off"
                spellCheck={false}
                value={query}
                onChange={(event: React.ChangeEvent<HTMLInputElement>) => {
                  setQuery(event.target.value);
                }}
                placeholder={tx("Search pages, actions…")}
                className="flex-1 border-0 bg-transparent p-0 text-sm text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-0"
              />
              <KeyboardShortcut
                keys={[KeyboardKey.Mod, "K"]}
                size={KeyboardShortcutSize.Small}
                className="hidden flex-shrink-0 sm:inline-flex"
              />
            </div>

            {/* Screen readers hear how many rows the query produced. */}
            <p
              aria-live="polite"
              data-testid="command-palette-result-count"
              className="sr-only"
            >
              {resultCount} {resultCount === 1 ? tx("result") : tx("results")}
            </p>

            {/* Results */}
            <div
              id="command-palette-listbox"
              role="listbox"
              aria-label={tx("Commands")}
              className="max-h-[55vh] flex-1 overflow-y-auto overscroll-contain p-2"
            >
              {flatEntries.length === 0 && !hasPendingSection(sections) ? (
                <div
                  data-testid="command-palette-empty"
                  className="flex flex-col items-center justify-center py-14 text-center"
                >
                  <div className="mb-3 flex h-10 w-10 items-center justify-center rounded-full bg-gray-50 ring-1 ring-gray-100">
                    <Icon
                      icon={IconProp.Search}
                      className="h-4 w-4 text-gray-400"
                    />
                  </div>
                  <p className="text-sm font-medium text-gray-900">
                    {tx("No results found.")}
                  </p>
                  {query.trim() && (
                    <p className="mt-1 text-xs text-gray-500">
                      &ldquo;{query.trim()}&rdquo;
                    </p>
                  )}
                </div>
              ) : (
                sections.map((section: PaletteSectionView) => {
                  return (
                    <div
                      key={section.id}
                      role="group"
                      aria-label={section.title}
                      data-testid={`command-palette-section-${section.id}`}
                      className="mb-1 last:mb-0"
                    >
                      <div
                        aria-hidden="true"
                        className="flex items-center gap-2 px-3 pb-1 pt-2.5"
                      >
                        <h3 className="text-xs font-semibold uppercase tracking-wider text-gray-400">
                          {section.title}
                        </h3>
                        {section.isPending && (
                          <span
                            data-testid={`command-palette-section-pending-${section.id}`}
                            className="animate-pulse text-[10px] font-normal normal-case tracking-normal text-gray-400"
                          >
                            {tx("Searching…")}
                          </span>
                        )}
                      </div>
                      {section.entries.map((entry: FlatEntry) => {
                        return (
                          <PaletteRow
                            key={entry.id}
                            item={{
                              id: entry.id,
                              title: entry.title,
                              description: entry.description,
                              icon: entry.icon,
                              iconColor: entry.iconColor,
                              shortcut: entry.shortcut,
                            }}
                            query={query}
                            isActive={entry.flatIndex === activeIndex}
                            onActivate={() => {
                              setActiveIndex(entry.flatIndex);
                            }}
                            onSelect={() => {
                              runEntry(entry);
                            }}
                            setRowElement={(element: HTMLDivElement | null) => {
                              rowRefs.current[entry.flatIndex] = element;
                            }}
                          />
                        );
                      })}
                    </div>
                  );
                })
              )}
            </div>

            {/* Keyboard hints */}
            <div
              data-testid="command-palette-footer"
              className="flex items-center gap-4 border-t border-gray-100 px-4 py-2"
            >
              <span className="flex items-center gap-1.5 text-[11px] text-gray-400">
                <KeyboardShortcut
                  keys={[KeyboardKey.ArrowUp, KeyboardKey.ArrowDown]}
                  size={KeyboardShortcutSize.ExtraSmall}
                  variant={KeyboardShortcutVariant.Ghost}
                />
                {tx("to navigate")}
              </span>
              <span className="flex items-center gap-1.5 text-[11px] text-gray-400">
                <KeyboardShortcut
                  keys={[KeyboardKey.Enter]}
                  size={KeyboardShortcutSize.ExtraSmall}
                  variant={KeyboardShortcutVariant.Ghost}
                />
                {tx("to select")}
              </span>
              <span className="flex items-center gap-1.5 text-[11px] text-gray-400">
                <KeyboardShortcut
                  keys={[KeyboardKey.Escape]}
                  size={KeyboardShortcutSize.ExtraSmall}
                  variant={KeyboardShortcutVariant.Ghost}
                />
                {tx("to close")}
              </span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

/**
 * Generic Linear-style command palette. Knows nothing about routes or models:
 * callers pass a static command catalog (grouped by `category`), optional
 * async search providers for entity results, and control open state.
 *
 * Portals to document.body at the modal z-tier (z-50).
 */
const CommandPalette: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  /*
   * No hooks in this component on purpose: the early return below would
   * otherwise change hook order between renders. The panel handles all state
   * and mounts fresh on every open.
   */
  if (!props.isOpen) {
    return <></>;
  }

  return createPortal(
    <CommandPalettePanel
      commands={props.commands}
      searchProviders={props.searchProviders || EMPTY_PROVIDERS}
      onClose={props.onClose}
      recentStorageKey={props.recentStorageKey}
    />,
    document.body,
  );
};

export default CommandPalette;
