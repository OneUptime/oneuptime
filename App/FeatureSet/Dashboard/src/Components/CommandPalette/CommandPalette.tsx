import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import Navigation from "Common/UI/Utils/Navigation";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

/**
 * Command Palette (⌘K / Ctrl+K)
 *
 * A keyboard-first launcher — the "spine" of the Linear-like overhaul. It is a
 * self-contained global overlay: press ⌘K anywhere to fuzzy-search navigation
 * targets and quick actions, arrow keys to move, Enter to run, Esc to close.
 *
 * Other components can open it by dispatching the window event
 * `OPEN_COMMAND_PALETTE_EVENT` (e.g. from a header button).
 *
 * Press `?` (outside a text field) for the keyboard shortcut cheat-sheet.
 */

export const OPEN_COMMAND_PALETTE_EVENT: string =
  "oneuptime-open-command-palette";

interface PaletteCommand {
  id: string;
  title: string;
  subtitle?: string | undefined;
  keywords?: string | undefined;
  icon: IconProp;
  group: string;
  perform: () => void;
}

type NavCommandSpec = {
  id: string;
  title: string;
  subtitle?: string | undefined;
  keywords?: string | undefined;
  icon: IconProp;
  group: string;
  pageMapKey: PageMap;
};

// Navigation targets, kept in sync with the dashboard NavBar.
const NAV_COMMANDS: Array<NavCommandSpec> = [
  {
    id: "create-incident",
    title: "Declare incident",
    subtitle: "Start a new incident",
    keywords: "new declare create incident outage",
    icon: IconProp.Add,
    group: "Create",
    pageMapKey: PageMap.INCIDENT_CREATE,
  },
  {
    id: "create-alert",
    title: "Create alert",
    subtitle: "Start a new alert",
    keywords: "new create alert",
    icon: IconProp.Add,
    group: "Create",
    pageMapKey: PageMap.ALERT_CREATE,
  },
  {
    id: "nav-home",
    title: "Home",
    subtitle: "Your on-call overview",
    keywords: "dashboard start overview",
    icon: IconProp.Home,
    group: "Navigate",
    pageMapKey: PageMap.HOME,
  },
  {
    id: "nav-incidents",
    title: "Incidents",
    subtitle: "All incidents",
    keywords: "incident outage sev",
    icon: IconProp.Alert,
    group: "Navigate",
    pageMapKey: PageMap.INCIDENTS,
  },
  {
    id: "nav-incidents-active",
    title: "Active incidents",
    subtitle: "Unresolved incidents",
    keywords: "incident open unresolved active firefighting",
    icon: IconProp.Fire,
    group: "Navigate",
    pageMapKey: PageMap.UNRESOLVED_INCIDENTS,
  },
  {
    id: "nav-incidents-triage",
    title: "Incident triage",
    subtitle: "Fast keyboard triage of active incidents",
    keywords: "incident triage queue keyboard peek acknowledge resolve",
    icon: IconProp.Bolt,
    group: "Navigate",
    pageMapKey: PageMap.INCIDENT_TRIAGE,
  },
  {
    id: "nav-alerts",
    title: "Alerts",
    subtitle: "All alerts",
    keywords: "alert signal noise",
    icon: IconProp.ExclaimationCircle,
    group: "Navigate",
    pageMapKey: PageMap.ALERTS,
  },
  {
    id: "nav-alerts-active",
    title: "Active alerts",
    subtitle: "Unresolved alerts",
    keywords: "alert open unresolved active triage",
    icon: IconProp.Bell,
    group: "Navigate",
    pageMapKey: PageMap.UNRESOLVED_ALERTS,
  },
  {
    id: "nav-maintenance",
    title: "Scheduled maintenance",
    subtitle: "Maintenance windows",
    keywords: "maintenance scheduled window downtime",
    icon: IconProp.Clock,
    group: "Navigate",
    pageMapKey: PageMap.SCHEDULED_MAINTENANCE_EVENTS,
  },
  {
    id: "nav-on-call",
    title: "On-call duty",
    subtitle: "Policies & schedules",
    keywords: "on call escalation policy schedule pager",
    icon: IconProp.Call,
    group: "Navigate",
    pageMapKey: PageMap.ON_CALL_DUTY,
  },
  {
    id: "nav-monitors",
    title: "Monitors",
    subtitle: "Uptime & health checks",
    keywords: "monitor uptime probe check",
    icon: IconProp.AltGlobe,
    group: "Navigate",
    pageMapKey: PageMap.MONITORS,
  },
  {
    id: "nav-status-pages",
    title: "Status pages",
    subtitle: "Public status",
    keywords: "status page public subscribers",
    icon: IconProp.CheckCircle,
    group: "Navigate",
    pageMapKey: PageMap.STATUS_PAGES,
  },
  {
    id: "nav-logs",
    title: "Logs",
    subtitle: "Telemetry logs",
    keywords: "logs telemetry observability",
    icon: IconProp.Logs,
    group: "Telemetry",
    pageMapKey: PageMap.LOGS,
  },
  {
    id: "nav-metrics",
    title: "Metrics",
    subtitle: "Telemetry metrics",
    keywords: "metrics telemetry observability charts",
    icon: IconProp.Heartbeat,
    group: "Telemetry",
    pageMapKey: PageMap.METRICS,
  },
  {
    id: "nav-traces",
    title: "Traces",
    subtitle: "Distributed traces",
    keywords: "traces spans telemetry observability",
    icon: IconProp.Waterfall,
    group: "Telemetry",
    pageMapKey: PageMap.TRACES,
  },
  {
    id: "nav-dashboards",
    title: "Dashboards",
    subtitle: "Custom dashboards",
    keywords: "dashboard charts analytics",
    icon: IconProp.ChartPie,
    group: "Navigate",
    pageMapKey: PageMap.DASHBOARDS,
  },
  {
    id: "nav-runbooks",
    title: "Runbooks",
    subtitle: "Remediation runbooks",
    keywords: "runbook remediation automation",
    icon: IconProp.BookOpen,
    group: "Navigate",
    pageMapKey: PageMap.RUNBOOKS,
  },
  {
    id: "nav-settings",
    title: "Project settings",
    subtitle: "Configure this project",
    keywords: "settings configuration project",
    icon: IconProp.Settings,
    group: "Settings",
    pageMapKey: PageMap.SETTINGS,
  },
  {
    id: "nav-user-settings",
    title: "User settings",
    subtitle: "Your profile & notifications",
    keywords: "user profile me notifications preferences",
    icon: IconProp.User,
    group: "Settings",
    pageMapKey: PageMap.USER_SETTINGS,
  },
];

/*
 * "Go to" navigation chords: press `g` then one of these keys to jump.
 * e.g. g i = incidents, g a = alerts.
 */
const G_NAV_MAP: Record<string, PageMap> = {
  h: PageMap.HOME,
  i: PageMap.INCIDENTS,
  a: PageMap.ALERTS,
  m: PageMap.SCHEDULED_MAINTENANCE_EVENTS,
  o: PageMap.ON_CALL_DUTY,
  s: PageMap.STATUS_PAGES,
};

// How long after pressing `g` a follow-up key still counts as a chord.
const G_CHORD_WINDOW_MS: number = 1200;

type IsTypingTarget = (target: EventTarget | null) => boolean;

const isTypingTarget: IsTypingTarget = (
  target: EventTarget | null,
): boolean => {
  if (!target || !(target instanceof HTMLElement)) {
    return false;
  }
  const tag: string = target.tagName.toLowerCase();
  return (
    tag === "input" ||
    tag === "textarea" ||
    tag === "select" ||
    target.isContentEditable
  );
};

const CommandPalette: FunctionComponent = (): ReactElement | null => {
  const [isOpen, setIsOpen] = useState<boolean>(false);
  const [isHelpOpen, setIsHelpOpen] = useState<boolean>(false);
  const [query, setQuery] = useState<string>("");
  const [activeIndex, setActiveIndex] = useState<number>(0);

  const inputRef: React.RefObject<HTMLInputElement> =
    useRef<HTMLInputElement>(null);
  const listRef: React.RefObject<HTMLDivElement> = useRef<HTMLDivElement>(null);
  // Timestamp of the last `g` press, for the "go to" navigation chord.
  const gChordRef: React.MutableRefObject<number> = useRef<number>(0);

  const commands: Array<PaletteCommand> = useMemo(() => {
    return NAV_COMMANDS.map((spec: NavCommandSpec): PaletteCommand => {
      return {
        id: spec.id,
        title: spec.title,
        subtitle: spec.subtitle,
        keywords: spec.keywords,
        icon: spec.icon,
        group: spec.group,
        perform: (): void => {
          const route: Route | undefined = RouteMap[spec.pageMapKey];
          if (route) {
            Navigation.navigate(RouteUtil.populateRouteParams(route));
          }
        },
      };
    });
  }, []);

  const filtered: Array<PaletteCommand> = useMemo(() => {
    const q: string = query.trim().toLowerCase();
    if (!q) {
      return commands;
    }
    return commands.filter((command: PaletteCommand): boolean => {
      const haystack: string =
        `${command.title} ${command.subtitle || ""} ${command.keywords || ""} ${command.group}`.toLowerCase();
      // Every whitespace-separated token in the query must match somewhere.
      return q.split(/\s+/).every((token: string): boolean => {
        return haystack.includes(token);
      });
    });
  }, [query, commands]);

  const closePalette: () => void = (): void => {
    setIsOpen(false);
    setQuery("");
    setActiveIndex(0);
  };

  const runCommand: (command: PaletteCommand | undefined) => void = (
    command: PaletteCommand | undefined,
  ): void => {
    if (!command) {
      return;
    }
    closePalette();
    command.perform();
  };

  // Global hotkeys: open palette, open help, close.
  useEffect(() => {
    const onKeyDown: (event: KeyboardEvent) => void = (
      event: KeyboardEvent,
    ): void => {
      const isMetaK: boolean =
        (event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k";

      if (isMetaK) {
        event.preventDefault();
        setIsHelpOpen(false);
        setIsOpen((open: boolean): boolean => {
          return !open;
        });
        return;
      }

      // "?" opens the keyboard cheat-sheet (Shift + / on most layouts).
      if (
        event.key === "?" &&
        !isTypingTarget(event.target) &&
        !isOpen &&
        !event.metaKey &&
        !event.ctrlKey
      ) {
        event.preventDefault();
        setIsHelpOpen((open: boolean): boolean => {
          return !open;
        });
        return;
      }

      // "g" then a key = go to (navigation chord). Only on page chrome.
      if (
        !isTypingTarget(event.target) &&
        !isOpen &&
        !isHelpOpen &&
        !event.metaKey &&
        !event.ctrlKey &&
        !event.altKey
      ) {
        const key: string = event.key.toLowerCase();
        const now: number = Date.now();

        if (
          gChordRef.current &&
          now - gChordRef.current < G_CHORD_WINDOW_MS &&
          G_NAV_MAP[key]
        ) {
          gChordRef.current = 0;
          event.preventDefault();
          const route: Route | undefined = RouteMap[G_NAV_MAP[key]!];
          if (route) {
            Navigation.navigate(RouteUtil.populateRouteParams(route));
          }
          return;
        }

        gChordRef.current = key === "g" ? now : 0;
      }
    };

    const onOpenEvent: () => void = (): void => {
      setIsHelpOpen(false);
      setIsOpen(true);
    };

    document.addEventListener("keydown", onKeyDown);
    window.addEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpenEvent);
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      window.removeEventListener(OPEN_COMMAND_PALETTE_EVENT, onOpenEvent);
    };
  }, [isOpen, isHelpOpen]);

  // Focus the input when the palette opens; reset selection.
  useEffect(() => {
    if (isOpen) {
      setActiveIndex(0);
      // Focus after the element mounts.
      const id: ReturnType<typeof setTimeout> = setTimeout(() => {
        inputRef.current?.focus();
      }, 0);
      return () => {
        return clearTimeout(id);
      };
    }
    return undefined;
  }, [isOpen]);

  // Keep the active index in range as the filtered list shrinks.
  useEffect(() => {
    setActiveIndex((index: number): number => {
      if (index > filtered.length - 1) {
        return Math.max(0, filtered.length - 1);
      }
      return index;
    });
  }, [filtered.length]);

  // Scroll the active row into view.
  useEffect(() => {
    if (!isOpen || !listRef.current) {
      return;
    }
    const activeEl: HTMLElement | null = listRef.current.querySelector(
      `[data-cmd-index="${activeIndex}"]`,
    );
    activeEl?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, isOpen]);

  const onInputKeyDown: (
    event: React.KeyboardEvent<HTMLInputElement>,
  ) => void = (event: React.KeyboardEvent<HTMLInputElement>): void => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveIndex((index: number): number => {
        return Math.min(index + 1, filtered.length - 1);
      });
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveIndex((index: number): number => {
        return Math.max(index - 1, 0);
      });
    } else if (event.key === "Enter") {
      event.preventDefault();
      runCommand(filtered[activeIndex]);
    } else if (event.key === "Escape") {
      event.preventDefault();
      closePalette();
    }
  };

  if (isHelpOpen) {
    return (
      <KeyboardShortcutsHelp
        onClose={() => {
          return setIsHelpOpen(false);
        }}
      />
    );
  }

  if (!isOpen) {
    return null;
  }

  // Group the filtered results for display while keeping a flat index.
  let runningIndex: number = -1;
  const groups: Array<string> = [];
  for (const command of filtered) {
    if (!groups.includes(command.group)) {
      groups.push(command.group);
    }
  }

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center px-4 pt-[12vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm"
        onClick={closePalette}
        aria-hidden="true"
      />
      <div className="relative w-full max-w-xl overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-black/10">
        <div className="flex items-center gap-3 border-b border-gray-100 px-4">
          <Icon
            icon={IconProp.Search}
            className="h-5 w-5 shrink-0 text-gray-400"
          />
          <input
            ref={inputRef}
            value={query}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) => {
              setQuery(e.target.value);
              setActiveIndex(0);
            }}
            onKeyDown={onInputKeyDown}
            placeholder="Search for a page or action…"
            className="w-full border-0 bg-transparent py-4 text-base text-gray-900 placeholder-gray-400 focus:outline-none focus:ring-0"
            aria-label="Search commands"
            autoComplete="off"
            spellCheck={false}
          />
          <kbd className="hidden shrink-0 rounded border border-gray-200 bg-gray-50 px-1.5 py-0.5 text-xs text-gray-400 sm:inline-block">
            esc
          </kbd>
        </div>

        <div ref={listRef} className="max-h-[50vh] overflow-y-auto py-2">
          {filtered.length === 0 && (
            <div className="px-4 py-8 text-center text-sm text-gray-400">
              No matching commands.
            </div>
          )}

          {groups.map((group: string): ReactElement => {
            return (
              <div key={group} className="mb-1">
                <div className="px-4 pb-1 pt-2 text-xs font-medium uppercase tracking-wider text-gray-400">
                  {group}
                </div>
                {filtered
                  .filter((command: PaletteCommand): boolean => {
                    return command.group === group;
                  })
                  .map((command: PaletteCommand): ReactElement => {
                    runningIndex += 1;
                    const index: number = runningIndex;
                    const isActive: boolean = index === activeIndex;
                    return (
                      <button
                        key={command.id}
                        type="button"
                        data-cmd-index={index}
                        onMouseEnter={() => {
                          return setActiveIndex(index);
                        }}
                        onClick={() => {
                          return runCommand(command);
                        }}
                        className={`flex w-full items-center gap-3 px-4 py-2.5 text-left transition-colors ${
                          isActive ? "bg-indigo-50" : "bg-transparent"
                        }`}
                      >
                        <Icon
                          icon={command.icon}
                          className={`h-5 w-5 shrink-0 ${
                            isActive ? "text-indigo-600" : "text-gray-400"
                          }`}
                        />
                        <span className="flex min-w-0 flex-col">
                          <span className="truncate text-sm font-medium text-gray-900">
                            {command.title}
                          </span>
                          {command.subtitle && (
                            <span className="truncate text-xs text-gray-400">
                              {command.subtitle}
                            </span>
                          )}
                        </span>
                        {isActive && (
                          <Icon
                            icon={IconProp.ArrowRight}
                            className="ml-auto h-4 w-4 shrink-0 text-indigo-400"
                          />
                        )}
                      </button>
                    );
                  })}
              </div>
            );
          })}
        </div>

        <div className="flex items-center justify-between border-t border-gray-100 px-4 py-2 text-xs text-gray-400">
          <span>
            <kbd className="rounded border border-gray-200 bg-gray-50 px-1 py-0.5">
              ↑
            </kbd>{" "}
            <kbd className="rounded border border-gray-200 bg-gray-50 px-1 py-0.5">
              ↓
            </kbd>{" "}
            to navigate ·{" "}
            <kbd className="rounded border border-gray-200 bg-gray-50 px-1 py-0.5">
              ↵
            </kbd>{" "}
            to open
          </span>
          <span>
            Press{" "}
            <kbd className="rounded border border-gray-200 bg-gray-50 px-1 py-0.5">
              ?
            </kbd>{" "}
            for shortcuts
          </span>
        </div>
      </div>
    </div>
  );
};

interface HelpProps {
  onClose: () => void;
}

const HELP_SHORTCUTS: Array<{ keys: Array<string>; label: string }> = [
  { keys: ["⌘", "K"], label: "Open the command palette" },
  { keys: ["⌘", "/"], label: "Switch products (menu)" },
  { keys: ["G", "I"], label: "Go to incidents" },
  { keys: ["G", "A"], label: "Go to alerts" },
  { keys: ["G", "M"], label: "Go to scheduled maintenance" },
  { keys: ["G", "O"], label: "Go to on-call duty" },
  { keys: ["G", "H"], label: "Go to home" },
  { keys: ["/"], label: "Focus search on any list" },
  { keys: ["?"], label: "Show this shortcut sheet" },
  { keys: ["Esc"], label: "Close a dialog, menu or peek" },
];

const KeyboardShortcutsHelp: FunctionComponent<HelpProps> = (
  props: HelpProps,
): ReactElement => {
  useEffect(() => {
    const onKeyDown: (event: KeyboardEvent) => void = (
      event: KeyboardEvent,
    ): void => {
      if (event.key === "Escape") {
        props.onClose();
      }
    };
    document.addEventListener("keydown", onKeyDown);
    return () => {
      return document.removeEventListener("keydown", onKeyDown);
    };
  }, []);

  return (
    <div
      className="fixed inset-0 z-[100] flex items-start justify-center px-4 pt-[15vh]"
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
    >
      <div
        className="fixed inset-0 bg-gray-900/40 backdrop-blur-sm"
        onClick={props.onClose}
        aria-hidden="true"
      />
      <div className="relative w-full max-w-md overflow-hidden rounded-xl bg-white shadow-2xl ring-1 ring-black/10">
        <div className="flex items-center justify-between border-b border-gray-100 px-5 py-4">
          <h2 className="text-sm font-semibold text-gray-900">
            Keyboard shortcuts
          </h2>
          <button
            type="button"
            onClick={props.onClose}
            className="text-gray-400 hover:text-gray-600"
            aria-label="Close"
          >
            <Icon icon={IconProp.Close} className="h-5 w-5" />
          </button>
        </div>
        <div className="divide-y divide-gray-50 px-5 py-2">
          {HELP_SHORTCUTS.map(
            (
              shortcut: { keys: Array<string>; label: string },
              i: number,
            ): ReactElement => {
              return (
                <div
                  key={i}
                  className="flex items-center justify-between py-2.5"
                >
                  <span className="text-sm text-gray-600">
                    {shortcut.label}
                  </span>
                  <span className="flex gap-1">
                    {shortcut.keys.map(
                      (key: string, j: number): ReactElement => {
                        return (
                          <kbd
                            key={j}
                            className="min-w-[1.5rem] rounded-md border border-gray-200 border-b-2 bg-gray-50 px-2 py-1 text-center text-xs font-medium text-gray-700"
                          >
                            {key}
                          </kbd>
                        );
                      },
                    )}
                  </span>
                </div>
              );
            },
          )}
        </div>
        <div className="border-t border-gray-100 px-5 py-3 text-xs text-gray-400">
          More triage shortcuts (acknowledge, resolve, assign) arrive with the
          new incident triage view.
        </div>
      </div>
    </div>
  );
};

export default CommandPalette;
