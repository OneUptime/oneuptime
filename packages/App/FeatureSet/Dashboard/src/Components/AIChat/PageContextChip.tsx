import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import React, { FunctionComponent, ReactElement } from "react";
import { DashboardPageContext } from "./PageContext";

export interface ComponentProps {
  context: DashboardPageContext;
  isAttached: boolean;
  onAttach: () => void;
  onDetach: () => void;
}

/*
 * The composer's page-context pill. Attached, it shows what the answer will be
 * grounded in ("This incident · #42 Payment API down") with a remove button;
 * detached, it becomes a quiet re-attach affordance so a misclick is never
 * final.
 */
const PageContextChip: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const { context } = props;

  if (!props.isAttached) {
    return (
      <button
        type="button"
        title="Attach this page as context for your questions"
        onClick={props.onAttach}
        className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-dashed border-gray-300 px-2.5 py-1 text-xs font-medium text-gray-500 transition-colors hover:border-gray-400 hover:bg-gray-50 hover:text-gray-700"
      >
        <Icon icon={IconProp.Add} className="h-3 w-3 flex-shrink-0" />
        <span className="truncate">
          {context.isEntity
            ? `Ask about this ${context.noun}`
            : `Ask about ${context.noun}`}
        </span>
      </button>
    );
  }

  const label: string = context.entityTitle
    ? `${context.chipLabel} · ${context.entityTitle}`
    : context.chipLabel;

  return (
    <div
      title="Your questions will use this page as context"
      className="inline-flex max-w-full items-center gap-1.5 rounded-full border border-indigo-200 bg-indigo-50 py-1 pl-2.5 pr-1 text-xs font-medium text-indigo-700"
    >
      <Icon
        icon={context.icon}
        className="h-3.5 w-3.5 flex-shrink-0 text-indigo-500"
      />
      <span className="truncate">{label}</span>
      <button
        type="button"
        title="Remove page context"
        onClick={props.onDetach}
        className="flex-shrink-0 rounded-full p-0.5 text-indigo-400 transition-colors hover:bg-indigo-100 hover:text-indigo-700"
      >
        <Icon icon={IconProp.Close} className="h-3 w-3" />
      </button>
    </div>
  );
};

export default PageContextChip;
