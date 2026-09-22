import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useEffect,
  useId,
  useRef,
} from "react";

export interface TelemetryDetailPanelTab {
  id: string;
  label: string;
  content: ReactNode;
  badge?: string | number | undefined;
}

export interface TelemetryDetailPanelProps {
  isOpen: boolean;
  title: ReactNode;
  subtitle?: ReactNode;
  onClose: () => void;
  tabs: Array<TelemetryDetailPanelTab>;
  activeTabId: string;
  onTabChange: (tabId: string) => void;
  headerActions?: ReactNode;
  variant?: "floating" | "embedded";
  /*
   * Replaces the floating drawer's default width classes, including their
   * cap at the viewport width, so a custom width should bring its own
   * max-width (e.g. "w-[64rem] max-w-[95vw]").
   */
  widthClassName?: string;
}

const TelemetryDetailPanel: FunctionComponent<TelemetryDetailPanelProps> = (
  props: TelemetryDetailPanelProps,
): ReactElement | null => {
  const panelId: string = useId();
  const titleId: string = `${panelId}-title`;
  const panelRef: React.MutableRefObject<HTMLDivElement | null> =
    useRef<HTMLDivElement | null>(null);
  const closeButtonRef: React.MutableRefObject<HTMLButtonElement | null> =
    useRef<HTMLButtonElement | null>(null);
  const previousFocusRef: React.MutableRefObject<HTMLElement | null> =
    useRef<HTMLElement | null>(null);
  const tabRefs: React.MutableRefObject<Map<string, HTMLButtonElement>> =
    useRef<Map<string, HTMLButtonElement>>(new Map());

  const variant: "floating" | "embedded" = props.variant || "floating";

  /*
   * A floating drawer is modal: put keyboard focus inside it on open and
   * return focus to the control that launched it on close. Querying the
   * selected tab keeps this effect independent of controlled tab changes.
   */
  useEffect(() => {
    if (!props.isOpen || variant !== "floating") {
      return;
    }

    previousFocusRef.current =
      document.activeElement instanceof HTMLElement
        ? document.activeElement
        : null;

    const selectedTab: HTMLElement | null =
      panelRef.current?.querySelector<HTMLElement>(
        '[role="tab"][aria-selected="true"]',
      ) || null;

    (selectedTab || closeButtonRef.current || panelRef.current)?.focus();

    return () => {
      const previousFocus: HTMLElement | null = previousFocusRef.current;
      previousFocusRef.current = null;

      if (previousFocus?.isConnected) {
        previousFocus.focus();
      }
    };
  }, [props.isOpen, variant]);

  // Close on Escape
  useEffect(() => {
    if (!props.isOpen) {
      return;
    }
    const handler: (e: KeyboardEvent) => void = (e: KeyboardEvent): void => {
      if (e.key === "Escape") {
        props.onClose();
      }
    };
    document.addEventListener("keydown", handler);
    return () => {
      document.removeEventListener("keydown", handler);
    };
  }, [props.isOpen, props.onClose]);

  if (!props.isOpen) {
    return null;
  }

  /*
   * The drawer is pinned to the right edge, so on a viewport narrower than
   * its width the overflow runs off the left edge and takes the header and
   * content with it. max-w-full keeps it within the viewport on phones and
   * leaves the 38rem width untouched wherever that fits.
   */
  const widthClassName: string = props.widthClassName || "w-[38rem] max-w-full";

  const activeTab: TelemetryDetailPanelTab | undefined = props.tabs.find(
    (t: TelemetryDetailPanelTab) => {
      return t.id === props.activeTabId;
    },
  );

  const handleTabKeyDown: (
    event: React.KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ) => void = (
    event: React.KeyboardEvent<HTMLButtonElement>,
    currentIndex: number,
  ): void => {
    let nextIndex: number | null = null;

    if (event.key === "ArrowRight") {
      nextIndex = (currentIndex + 1) % props.tabs.length;
    } else if (event.key === "ArrowLeft") {
      nextIndex = (currentIndex - 1 + props.tabs.length) % props.tabs.length;
    } else if (event.key === "Home") {
      nextIndex = 0;
    } else if (event.key === "End") {
      nextIndex = props.tabs.length - 1;
    }

    if (nextIndex === null) {
      return;
    }

    event.preventDefault();
    const nextTab: TelemetryDetailPanelTab | undefined = props.tabs[nextIndex];

    if (!nextTab) {
      return;
    }

    props.onTabChange(nextTab.id);
    tabRefs.current.get(nextTab.id)?.focus();
  };

  const handlePanelKeyDown: (
    event: React.KeyboardEvent<HTMLDivElement>,
  ) => void = (event: React.KeyboardEvent<HTMLDivElement>): void => {
    if (variant !== "floating" || event.key !== "Tab") {
      return;
    }

    const panel: HTMLDivElement | null = panelRef.current;

    if (!panel) {
      return;
    }

    const focusableElements: Array<HTMLElement> = Array.from(
      panel.querySelectorAll<HTMLElement>(
        'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ).filter((element: HTMLElement): boolean => {
      return element.tabIndex >= 0 && !element.closest("[hidden]");
    });

    const firstElement: HTMLElement | undefined = focusableElements[0];
    const lastElement: HTMLElement | undefined =
      focusableElements[focusableElements.length - 1];

    if (!firstElement || !lastElement) {
      event.preventDefault();
      panel.focus();
      return;
    }

    const activeElement: Element | null = document.activeElement;

    if (
      event.shiftKey &&
      (activeElement === firstElement || !panel.contains(activeElement))
    ) {
      event.preventDefault();
      lastElement.focus();
    } else if (
      !event.shiftKey &&
      (activeElement === lastElement || !panel.contains(activeElement))
    ) {
      event.preventDefault();
      firstElement.focus();
    }
  };

  const body: ReactElement = (
    <div
      ref={panelRef}
      className={`flex h-full flex-col bg-white ${
        variant === "floating"
          ? `fixed right-0 top-0 z-40 ${widthClassName} border-l border-gray-200 shadow-2xl`
          : "rounded-lg border border-gray-200"
      }`}
      role={variant === "floating" ? "dialog" : "region"}
      aria-modal={variant === "floating" ? true : undefined}
      aria-labelledby={titleId}
      tabIndex={-1}
      onKeyDown={handlePanelKeyDown}
      data-testid="telemetry-detail-panel"
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div
            id={titleId}
            className="truncate text-sm font-semibold text-gray-900"
          >
            {props.title}
          </div>
          {props.subtitle && (
            <div className="mt-0.5 truncate text-xs text-gray-500">
              {props.subtitle}
            </div>
          )}
        </div>
        <div className="flex items-center gap-1">
          {props.headerActions}
          <button
            ref={closeButtonRef}
            type="button"
            className="rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:ring-offset-2"
            onClick={props.onClose}
            title="Close (Esc)"
            aria-label="Close details panel"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              fill="none"
              viewBox="0 0 24 24"
              strokeWidth="1.5"
              stroke="currentColor"
              className="h-4 w-4"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>
      </div>

      {/* Tabs */}
      {props.tabs.length > 1 && (
        <div
          className="flex items-center gap-1 border-b border-gray-100 px-2 pt-1.5"
          role="tablist"
          aria-label="Detail sections"
        >
          {props.tabs.map((tab: TelemetryDetailPanelTab, index: number) => {
            const isActive: boolean = tab.id === props.activeTabId;
            return (
              <button
                key={tab.id}
                type="button"
                id={`${panelId}-tab-${tab.id}`}
                role="tab"
                aria-selected={isActive}
                aria-controls={`${panelId}-panel-${tab.id}`}
                tabIndex={isActive ? 0 : -1}
                ref={(element: HTMLButtonElement | null): void => {
                  if (element) {
                    tabRefs.current.set(tab.id, element);
                  } else {
                    tabRefs.current.delete(tab.id);
                  }
                }}
                className={`relative inline-flex items-center gap-1.5 rounded-t-md px-3 py-1.5 text-xs font-medium transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500 ${
                  isActive
                    ? "text-indigo-700"
                    : "text-gray-500 hover:text-gray-700"
                }`}
                onClick={() => {
                  props.onTabChange(tab.id);
                }}
                onKeyDown={(
                  event: React.KeyboardEvent<HTMLButtonElement>,
                ): void => {
                  handleTabKeyDown(event, index);
                }}
              >
                {tab.label}
                {tab.badge !== undefined && tab.badge !== null && (
                  <span
                    className={`inline-flex h-4 min-w-[1rem] items-center justify-center rounded-full px-1 text-[10px] font-semibold ${
                      isActive
                        ? "bg-indigo-100 text-indigo-700"
                        : "bg-gray-100 text-gray-500"
                    }`}
                  >
                    {tab.badge}
                  </span>
                )}
                {isActive && (
                  <span className="absolute inset-x-2 bottom-0 h-0.5 rounded-t bg-indigo-500" />
                )}
              </button>
            );
          })}
        </div>
      )}

      {/* Body */}
      <div className="flex-1 overflow-y-auto">
        {props.tabs.length > 1
          ? props.tabs.map((tab: TelemetryDetailPanelTab): ReactElement => {
              const isActive: boolean = tab.id === props.activeTabId;

              return (
                <div
                  key={tab.id}
                  id={`${panelId}-panel-${tab.id}`}
                  role="tabpanel"
                  aria-labelledby={`${panelId}-tab-${tab.id}`}
                  tabIndex={isActive ? 0 : -1}
                  hidden={!isActive}
                  className="min-h-full outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-indigo-500"
                >
                  {isActive ? tab.content : null}
                </div>
              );
            })
          : activeTab && <div className="min-h-full">{activeTab.content}</div>}
      </div>
    </div>
  );

  if (variant === "floating") {
    return (
      <>
        {/* Click-outside backdrop (transparent) */}
        <div
          className="fixed inset-0 z-30"
          onClick={props.onClose}
          aria-hidden="true"
        />
        {body}
      </>
    );
  }

  return body;
};

export default TelemetryDetailPanel;
