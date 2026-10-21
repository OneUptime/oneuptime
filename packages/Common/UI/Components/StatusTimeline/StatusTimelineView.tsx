import Icon from "../Icon/Icon";
import IconProp from "../../../Types/Icon/IconProp";
import { Translator, translationKey } from "../../Utils/TranslateTemplate";
import useTranslator from "../../Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useState,
} from "react";

/*
 * A status timeline page draws its history as a timeline, or - for what
 * only a table does: selecting rows to delete them together, filters,
 * saved views, a CSV export - as the table it used to be. The timeline is
 * what a page opens on; the choice is the reader's, remembered in their
 * browser for every status timeline, since someone who works in the table
 * works in it everywhere.
 *
 * Browser storage can be missing or refuse writes (a private window,
 * blocked site data), so every access is guarded and the choice still holds
 * for the rest of the session.
 */
export enum StatusTimelineView {
  Timeline = "timeline",
  Table = "table",
}

export const STATUS_TIMELINE_VIEW_STORAGE_KEY: string =
  "oneuptime.status-timeline-view";

const VIEW_CHANGE_EVENT: string = "oneuptime:status-timeline-view-change";

let sessionView: StatusTimelineView | null = null;

const isView: (value: unknown) => value is StatusTimelineView = (
  value: unknown,
): value is StatusTimelineView => {
  return (
    value === StatusTimelineView.Timeline || value === StatusTimelineView.Table
  );
};

export const readStatusTimelineView: () => StatusTimelineView =
  (): StatusTimelineView => {
    try {
      const stored: string | null =
        typeof window !== "undefined" && window.localStorage
          ? window.localStorage.getItem(STATUS_TIMELINE_VIEW_STORAGE_KEY)
          : null;

      if (isView(stored)) {
        return stored;
      }
    } catch {
      // Storage is unavailable; this session's choice still holds.
    }

    return sessionView || StatusTimelineView.Timeline;
  };

export const writeStatusTimelineView: (view: StatusTimelineView) => void = (
  view: StatusTimelineView,
): void => {
  sessionView = view;

  try {
    if (typeof window !== "undefined" && window.localStorage) {
      window.localStorage.setItem(STATUS_TIMELINE_VIEW_STORAGE_KEY, view);
    }
  } catch {
    // Not remembered past this session; the session value above holds.
  }

  if (typeof window !== "undefined") {
    window.dispatchEvent(
      new CustomEvent<StatusTimelineView>(VIEW_CHANGE_EVENT, { detail: view }),
    );
  }
};

// Forget this session's choice. Tests only.
export const resetStatusTimelineViewForTesting: () => void = (): void => {
  sessionView = null;
};

export type UseStatusTimelineViewFunction = () => [
  StatusTimelineView,
  (view: StatusTimelineView) => void,
];

export const useStatusTimelineView: UseStatusTimelineViewFunction = (): [
  StatusTimelineView,
  (view: StatusTimelineView) => void,
] => {
  const [view, setViewState] = useState<StatusTimelineView>(() => {
    return readStatusTimelineView();
  });

  useEffect(() => {
    const onChange: (event: Event) => void = (event: Event): void => {
      const next: unknown = (event as CustomEvent<unknown>).detail;

      if (isView(next)) {
        setViewState(next);
      }
    };

    window.addEventListener(VIEW_CHANGE_EVENT, onChange);

    return () => {
      window.removeEventListener(VIEW_CHANGE_EVENT, onChange);
    };
  }, []);

  const setView: (next: StatusTimelineView) => void = useCallback(
    (next: StatusTimelineView): void => {
      setViewState(next);
      writeStatusTimelineView(next);
    },
    [],
  );

  return [view, setView];
};

interface ViewOption {
  view: StatusTimelineView;
  label: string;
  icon: IconProp;
}

/*
 * Each view's icon is a picture of the view: the timeline's stretches of
 * time stepping along (not a bar chart, which this view is not), the
 * table's grid.
 */
const OPTIONS: ReadonlyArray<ViewOption> = [
  {
    view: StatusTimelineView.Timeline,
    label: translationKey("Timeline"),
    icon: IconProp.Timeline,
  },
  {
    view: StatusTimelineView.Table,
    label: translationKey("Table"),
    icon: IconProp.TableCells,
  },
];

export interface ComponentProps {
  value: StatusTimelineView;
  onChange: (view: StatusTimelineView) => void;
}

/*
 * Each choice's padding. With the track's 2px around it, the switch is as
 * tall as the buttons beside it in a card's header - 42px on a phone, 38px
 * from md up (TABLE_HEADER_CONTROL_HEIGHT_CLASS_NAME): it stood 32px beside
 * the 38px Create and ⋯.
 */
export const STATUS_TIMELINE_VIEW_OPTION_PADDING_CLASS_NAME: string =
  "px-2.5 py-[9px] md:py-[7px]";

// Timeline | Table, in the card's header beside its other actions.
const StatusTimelineViewSwitch: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div
      role="group"
      aria-label={translator.translateText("Show the history as")}
      className="inline-flex shrink-0 items-center rounded-lg bg-gray-100 p-0.5"
      data-testid="status-timeline-view-switch"
    >
      {OPTIONS.map((option: ViewOption): ReactElement => {
        const isActive: boolean = option.view === props.value;

        return (
          <button
            key={option.view}
            type="button"
            aria-pressed={isActive}
            data-testid={`status-timeline-view-${option.view}`}
            className={`inline-flex items-center gap-1.5 rounded-md ${STATUS_TIMELINE_VIEW_OPTION_PADDING_CLASS_NAME} text-sm font-medium leading-5 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500 ${
              isActive
                ? "bg-white text-gray-900 shadow-sm"
                : "text-gray-600 hover:text-gray-900"
            }`}
            onClick={() => {
              if (!isActive) {
                props.onChange(option.view);
              }
            }}
          >
            <Icon
              icon={option.icon}
              className={`h-4 w-4 ${isActive ? "text-indigo-600" : ""}`}
            />
            {translator.translateText(option.label)}
          </button>
        );
      })}
    </div>
  );
};

export default StatusTimelineViewSwitch;
