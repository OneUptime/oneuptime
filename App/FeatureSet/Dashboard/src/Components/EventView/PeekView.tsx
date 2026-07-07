import Icon from "Common/UI/Components/Icon/Icon";
import IconProp from "Common/Types/Icon/IconProp";
import React, { FunctionComponent, ReactElement } from "react";

/**
 * PeekView
 *
 * The split-pane detail panel for the dense triage list — select a row and its
 * detail "peeks" in beside the list instead of navigating away. Presentational:
 * a bordered panel with a header (eyebrow + title + close), a scrollable body,
 * and an optional sticky footer for quick actions.
 */

export interface ComponentProps {
  eyebrow?: string | undefined;
  title: ReactElement | string;
  onClose: () => void;
  children: ReactElement | Array<ReactElement>;
  footer?: ReactElement | undefined;
}

const PeekView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div className="flex h-full flex-col overflow-hidden rounded-lg border border-gray-200 bg-white shadow-sm">
      <div className="flex items-start justify-between gap-3 border-b border-gray-100 p-4">
        <div className="min-w-0">
          {props.eyebrow && (
            <div className="mb-1 text-xs font-medium text-gray-400">
              {props.eyebrow}
            </div>
          )}
          <div className="text-sm font-semibold text-gray-900">
            {props.title}
          </div>
        </div>
        <button
          type="button"
          onClick={props.onClose}
          aria-label="Close peek"
          className="flex-shrink-0 text-gray-400 hover:text-gray-600"
        >
          <Icon icon={IconProp.Close} className="h-5 w-5" />
        </button>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">{props.children}</div>
      {props.footer && (
        <div className="border-t border-gray-100 p-3">{props.footer}</div>
      )}
    </div>
  );
};

export default PeekView;
