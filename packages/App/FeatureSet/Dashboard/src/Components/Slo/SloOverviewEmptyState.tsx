import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";
import React, { FunctionComponent, ReactElement } from "react";

export type SloOverviewEmptyStateTone = "neutral" | "good" | "warning";

const TONE_CLASS_NAMES: Record<SloOverviewEmptyStateTone, string> = {
  neutral: "bg-gray-50 text-gray-500 ring-gray-200",
  good: "bg-emerald-50 text-emerald-600 ring-emerald-200",
  warning: "bg-amber-50 text-amber-600 ring-amber-200",
};

export interface ComponentProps {
  icon: IconProp;
  title: string;
  description: string;
  tone?: SloOverviewEmptyStateTone | undefined;
  actions?: ReactElement | undefined;
  dataTestId?: string | undefined;
}

/*
 * The empty and all-clear states inside the SLO overview's cards.
 *
 * EmptyState is sized for a whole page (13rem of padding), which inside a
 * sidebar card pushes everything below it off screen, and it has no way to
 * say "all clear" as distinct from "nothing here". This is the compact,
 * in-card version: an icon, one line of what is true, one of what to do,
 * and the actions that do it.
 */
const SloOverviewEmptyState: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const tone: SloOverviewEmptyStateTone = props.tone || "neutral";

  return (
    <div
      data-testid={props.dataTestId}
      className="flex flex-col items-center px-4 py-6 text-center"
    >
      <div
        className={`flex h-10 w-10 items-center justify-center rounded-full ring-1 ring-inset ${TONE_CLASS_NAMES[tone]}`}
      >
        <Icon icon={props.icon} className="h-5 w-5" />
      </div>
      <p className="mt-3 text-sm font-semibold text-gray-900">{props.title}</p>
      <p className="mt-1 max-w-md text-sm text-gray-500">{props.description}</p>
      {props.actions ? (
        <div className="mt-4 flex flex-wrap items-center justify-center gap-2">
          {props.actions}
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default SloOverviewEmptyState;
