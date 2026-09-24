import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  title: string;
  hint: string;
  count: number;
  /*
   * What the numbers in this section mean, in an (i) beside the title. The
   * site cards carry a unit rollup, two uptime figures and a device count
   * with no labels of their own beyond a word or two; the section title is
   * the one place above all of them where they can be explained once. A
   * section of names alone (the WAN links) passes nothing and gets no (i).
   */
  description?: string | undefined;
  children: ReactElement;
}

/*
 * A labeled band inside the Network Map card. Sections are separated by a
 * rule rather than by margin alone, so the page reads as one designed
 * surface with named parts instead of a stack of loose blocks.
 */
const NetworkMapSection: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div className="mt-6 border-t border-gray-200 pt-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3 className="flex items-center gap-1 text-sm font-semibold text-gray-900">
          <span>{props.title}</span>
          <InfoTooltip label={props.title} text={props.description} />
          <span className="ml-1 text-xs font-normal tabular-nums text-gray-400">
            {props.count}
          </span>
        </h3>
        <p className="text-xs text-gray-500">{props.hint}</p>
      </div>
      <div className="mt-3">{props.children}</div>
    </div>
  );
};

export default NetworkMapSection;
