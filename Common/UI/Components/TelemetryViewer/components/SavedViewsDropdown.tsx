import React, { FunctionComponent, ReactElement } from "react";
import { SavedViewOption } from "../types";
import useComponentOutsideClick from "../../../Types/UseComponentOutsideClick";
import Icon from "../../Icon/Icon";
import IconProp from "../../../../Types/Icon/IconProp";

export interface SavedViewsDropdownProps {
  savedViews: Array<SavedViewOption>;
  selectedSavedViewId?: string | null | undefined;
  onSelect: (viewId: string) => void;
  onCreate?: (() => void) | undefined;
  onEdit?: ((viewId: string) => void) | undefined;
  onDelete?: ((viewId: string) => void) | undefined;
  onUpdateCurrent?: (() => void) | undefined;
  triggerClassName?: string | undefined;
  showTriggerIcon?: boolean | undefined;
  dropdownAlignment?: "left" | "right" | undefined;
}

const triggerButtonClassName: string =
  "inline-flex items-center gap-1.5 rounded-md border border-gray-200 bg-white px-2.5 py-1.5 text-xs font-medium text-gray-700 shadow-sm transition-colors hover:border-gray-300 hover:bg-gray-50 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-400";

const SavedViewsDropdown: FunctionComponent<SavedViewsDropdownProps> = (
  props: SavedViewsDropdownProps,
): ReactElement => {
  const { ref, isComponentVisible, setIsComponentVisible } =
    useComponentOutsideClick(false);

  const selectedView: SavedViewOption | undefined = props.savedViews.find(
    (view: SavedViewOption) => {
      return view.id === props.selectedSavedViewId;
    },
  );

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        className={`${triggerButtonClassName} ${props.triggerClassName || ""}`}
        onClick={() => {
          setIsComponentVisible(!isComponentVisible);
        }}
        aria-haspopup="dialog"
        aria-expanded={isComponentVisible}
      >
        {props.showTriggerIcon ? (
          <Icon
            icon={IconProp.Bookmark}
            className="h-3.5 w-3.5 text-gray-500"
          />
        ) : null}
        <span className="max-w-40 truncate">
          {selectedView?.name || "Saved Views"}
        </span>
        <span
          className={`text-xs text-gray-400 ${
            props.showTriggerIcon
              ? "rounded-md bg-gray-100 px-1.5 py-0.5 text-[10px] font-semibold"
              : ""
          }`}
        >
          {props.savedViews.length.toLocaleString()}
        </span>
        {props.showTriggerIcon ? (
          <Icon
            icon={IconProp.ChevronDown}
            className={`h-3 w-3 text-gray-400 transition-transform ${
              isComponentVisible ? "rotate-180" : ""
            }`}
          />
        ) : null}
      </button>

      {isComponentVisible && (
        <div
          className={`absolute z-20 mt-2 w-72 rounded-lg border border-gray-200 bg-white shadow-xl ${
            props.dropdownAlignment === "right" ? "right-0" : "left-0"
          }`}
        >
          {/* View list */}
          <div className="max-h-72 overflow-y-auto py-1">
            {props.savedViews.length === 0 && (
              <div className="px-3 py-6 text-center text-xs text-gray-400">
                No saved views yet.
              </div>
            )}

            {props.savedViews.map((view: SavedViewOption) => {
              const isSelected: boolean = view.id === props.selectedSavedViewId;

              return (
                <div
                  key={view.id}
                  className={`group flex items-center justify-between gap-2 px-3 py-1.5 ${
                    isSelected ? "bg-indigo-50" : "hover:bg-gray-50"
                  }`}
                >
                  <button
                    type="button"
                    className="flex min-w-0 flex-1 items-center gap-2 text-left"
                    onClick={() => {
                      props.onSelect(view.id);
                      setIsComponentVisible(false);
                    }}
                  >
                    {/* Checkmark for selected */}
                    <span className="w-4 shrink-0 text-center text-xs">
                      {isSelected ? (
                        <span className="text-indigo-600">✓</span>
                      ) : (
                        ""
                      )}
                    </span>
                    <span
                      className={`truncate text-sm ${
                        isSelected
                          ? "font-medium text-indigo-700"
                          : "text-gray-700"
                      }`}
                    >
                      {view.name}
                    </span>
                    {view.isDefault && (
                      <span className="shrink-0 text-[10px] text-gray-400">
                        default
                      </span>
                    )}
                  </button>

                  {/* Actions — visible on hover */}
                  <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100">
                    {isSelected && props.onUpdateCurrent && (
                      <button
                        type="button"
                        className="rounded px-1.5 py-0.5 text-[11px] text-indigo-600 transition-colors hover:bg-indigo-100"
                        onClick={(
                          event: React.MouseEvent<HTMLButtonElement>,
                        ) => {
                          event.stopPropagation();
                          props.onUpdateCurrent?.();
                          setIsComponentVisible(false);
                        }}
                      >
                        Update
                      </button>
                    )}
                    {props.onEdit && (
                      <button
                        type="button"
                        className="rounded px-1.5 py-0.5 text-[11px] text-gray-500 transition-colors hover:bg-gray-100 hover:text-gray-700"
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
                        className="rounded px-1.5 py-0.5 text-[11px] text-red-500 transition-colors hover:bg-red-50 hover:text-red-600"
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
              );
            })}
          </div>

          {/* Footer action */}
          {props.onCreate && (
            <div className="border-t border-gray-100 px-3 py-2">
              <button
                type="button"
                className="w-full rounded-md px-2 py-1.5 text-left text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-50"
                onClick={() => {
                  props.onCreate?.();
                  setIsComponentVisible(false);
                }}
              >
                + Save Current View
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SavedViewsDropdown;
