import React, { FunctionComponent, ReactElement } from "react";
import { LogsSavedViewOption } from "../types";
import useComponentOutsideClick from "../../../Types/UseComponentOutsideClick";

export interface SavedViewsDropdownProps {
  savedViews: Array<LogsSavedViewOption>;
  selectedSavedViewId?: string | null;
  onSelect: (viewId: string) => void;
  onCreate?: (() => void) | undefined;
  onEdit?: ((viewId: string) => void) | undefined;
  onDelete?: ((viewId: string) => void) | undefined;
  onUpdateCurrent?: (() => void) | undefined;
}

const triggerButtonClassName: string =
  "inline-flex items-center gap-2 rounded-md border border-gray-200 bg-white px-3 py-2 text-sm font-medium text-gray-700 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50";

const SavedViewsDropdown: FunctionComponent<SavedViewsDropdownProps> = (
  props: SavedViewsDropdownProps,
): ReactElement => {
  const { ref, isComponentVisible, setIsComponentVisible } =
    useComponentOutsideClick(false);

  const selectedView: LogsSavedViewOption | undefined = props.savedViews.find(
    (view: LogsSavedViewOption) => {
      return view.id === props.selectedSavedViewId;
    },
  );

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className={triggerButtonClassName}
        onClick={() => {
          setIsComponentVisible(!isComponentVisible);
        }}
        aria-haspopup="dialog"
        aria-expanded={isComponentVisible}
      >
        <span className="max-w-40 truncate">
          {selectedView?.name || "Saved Views"}
        </span>
        <span className="text-xs text-gray-400">
          {props.savedViews.length.toLocaleString()}
        </span>
      </button>

      {isComponentVisible && (
        <div className="absolute right-0 z-20 mt-2 w-96 rounded-lg border border-gray-200 bg-white p-4 shadow-xl">
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-gray-900">Saved Views</h3>
              <p className="text-xs text-gray-500">
                Load a saved log view or update the currently selected one.
              </p>
            </div>
            {props.onCreate && (
              <button
                type="button"
                className="inline-flex shrink-0 items-center rounded-md border border-indigo-200 bg-indigo-50 px-3 py-1.5 text-sm font-medium text-indigo-700 transition-colors hover:bg-indigo-100"
                onClick={() => {
                  props.onCreate?.();
                  setIsComponentVisible(false);
                }}
              >
                + Save View
              </button>
            )}
          </div>

          {selectedView && props.onUpdateCurrent && (
            <button
              type="button"
              className="mt-4 w-full rounded-md border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-700 transition-colors hover:bg-indigo-100"
              onClick={() => {
                props.onUpdateCurrent?.();
                setIsComponentVisible(false);
              }}
            >
              Update Current View
            </button>
          )}

          <div className="mt-4 max-h-80 space-y-2 overflow-y-auto pr-1">
            {props.savedViews.length === 0 && (
              <div className="rounded-md border border-dashed border-gray-200 px-3 py-4 text-sm text-gray-500">
                No saved views yet.
              </div>
            )}

            {props.savedViews.map((view: LogsSavedViewOption) => {
              const isSelected: boolean = view.id === props.selectedSavedViewId;

              return (
                <div
                  key={view.id}
                  className={`rounded-md border px-3 py-2 transition-colors ${
                    isSelected
                      ? "border-indigo-200 bg-indigo-50"
                      : "border-gray-200 bg-white hover:border-gray-300 hover:bg-gray-50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-3">
                    <button
                      type="button"
                      className="min-w-0 flex-1 text-left"
                      onClick={() => {
                        props.onSelect(view.id);
                        setIsComponentVisible(false);
                      }}
                    >
                      <div className="flex items-center gap-2">
                        <span className="truncate text-sm font-medium text-gray-800">
                          {view.name}
                        </span>
                        {view.isDefault && (
                          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-amber-700">
                            Default
                          </span>
                        )}
                        {isSelected && (
                          <span className="rounded-full bg-indigo-100 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-indigo-700">
                            Selected
                          </span>
                        )}
                      </div>
                    </button>

                    <div className="flex items-center gap-1">
                      {props.onEdit && (
                        <button
                          type="button"
                          className="rounded-md px-2 py-1 text-xs font-medium text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
                          onClick={(
                            event: React.MouseEvent<HTMLButtonElement>,
                          ) => {
                            event.stopPropagation();
                            props.onEdit?.(view.id);
                            setIsComponentVisible(false);
                          }}
                        >
                          Edit
                        </button>
                      )}

                      {props.onDelete && (
                        <button
                          type="button"
                          className="rounded-md px-2 py-1 text-xs font-medium text-red-500 transition-colors hover:bg-red-50 hover:text-red-600"
                          onClick={(
                            event: React.MouseEvent<HTMLButtonElement>,
                          ) => {
                            event.stopPropagation();
                            props.onDelete?.(view.id);
                            setIsComponentVisible(false);
                          }}
                        >
                          Delete
                        </button>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};

export default SavedViewsDropdown;
