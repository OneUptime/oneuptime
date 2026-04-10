import React, {
  FunctionComponent,
  ReactElement,
  ReactNode,
  useEffect,
} from "react";
import Icon from "../../Icon/Icon";
import IconProp from "../../../../Types/Icon/IconProp";

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
  widthClassName?: string;
}

const TelemetryDetailPanel: FunctionComponent<TelemetryDetailPanelProps> = (
  props: TelemetryDetailPanelProps,
): ReactElement | null => {
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

  const variant: "floating" | "embedded" = props.variant || "floating";
  const widthClassName: string = props.widthClassName || "w-[38rem]";

  const activeTab: TelemetryDetailPanelTab | undefined = props.tabs.find(
    (t: TelemetryDetailPanelTab) => {
      return t.id === props.activeTabId;
    },
  );

  const body: ReactElement = (
    <div
      className={`flex h-full flex-col bg-white ${
        variant === "floating"
          ? `fixed right-0 top-0 z-40 ${widthClassName} border-l border-gray-200 shadow-2xl`
          : "rounded-lg border border-gray-200"
      }`}
    >
      {/* Header */}
      <div className="flex items-start justify-between gap-3 border-b border-gray-100 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="truncate text-sm font-semibold text-gray-900">
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
            type="button"
            className="rounded-md p-1 text-gray-400 transition-colors hover:bg-gray-100 hover:text-gray-600"
            onClick={props.onClose}
            title="Close (Esc)"
          >
            <Icon icon={IconProp.Close} className="h-4 w-4" />
          </button>
        </div>
      </div>

      {/* Tabs */}
      {props.tabs.length > 1 && (
        <div className="flex items-center gap-1 border-b border-gray-100 px-2 pt-1.5">
          {props.tabs.map((tab: TelemetryDetailPanelTab) => {
            const isActive: boolean = tab.id === props.activeTabId;
            return (
              <button
                key={tab.id}
                type="button"
                className={`relative inline-flex items-center gap-1.5 rounded-t-md px-3 py-1.5 text-xs font-medium transition-colors ${
                  isActive
                    ? "text-indigo-700"
                    : "text-gray-500 hover:text-gray-700"
                }`}
                onClick={() => {
                  props.onTabChange(tab.id);
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
      <div className="flex-1 overflow-y-auto">{activeTab?.content}</div>
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
