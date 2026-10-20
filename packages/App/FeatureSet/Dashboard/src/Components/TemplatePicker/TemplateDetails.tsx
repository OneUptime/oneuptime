/*
 * What a picked template's row opens to show, drawn the same way for every
 * template picker (Components/TemplatePicker/TemplatePicker): a short list
 * of labelled rows - a workflow's How It Works and What you'll need, a
 * dashboard's Widgets and Variables - under the template's description.
 *
 * A row's label sits beside what it holds where there is room, and above it
 * on a phone. What it holds is either chips - an icon and a name each, the
 * way the product names the thing elsewhere (a block on the workflow
 * canvas, a widget in Add Widget) - or a few words.
 */

import React, { ReactElement, ReactNode } from "react";
import IconProp from "Common/Types/Icon/IconProp";
import Icon from "Common/UI/Components/Icon/Icon";

export interface TemplateDetailsProps {
  dataTestId: string;
  children: ReactNode;
}

/** The details of a picked template: one or more TemplateDetailsRow. */
export const TemplateDetails: (props: TemplateDetailsProps) => ReactElement = (
  props: TemplateDetailsProps,
): ReactElement => {
  return (
    <dl className="mt-3 space-y-2.5" data-testid={props.dataTestId}>
      {props.children}
    </dl>
  );
};

export enum TemplateDetailsRowHolds {
  // Chips, which stand a little taller than a line of text.
  Chips = "chips",
  Text = "text",
}

export interface TemplateDetailsRowProps {
  // Translated by the caller.
  label: string;
  holds: TemplateDetailsRowHolds;
  children: ReactNode;
}

/** One labelled row of a picked template's details. */
export const TemplateDetailsRow: (
  props: TemplateDetailsRowProps,
) => ReactElement = (props: TemplateDetailsRowProps): ReactElement => {
  return (
    <div className="flex flex-col gap-1.5 sm:flex-row sm:items-start sm:gap-3">
      <dt
        className={`text-xs font-semibold uppercase tracking-wide text-gray-500 sm:w-36 sm:flex-shrink-0 ${
          // The label lines up with the middle of the first line beside it.
          props.holds === TemplateDetailsRowHolds.Chips
            ? "sm:pt-1"
            : "sm:pt-0.5"
        }`}
      >
        {props.label}
      </dt>
      <dd className="min-w-0 flex-1 space-y-1">{props.children}</dd>
    </div>
  );
};

export interface TemplateDetailsChipProps {
  icon: IconProp;
  label: string;
  dataTestId: string;
  /*
   * In the brand's colour: the one chip that leads the others, such as a
   * workflow's trigger.
   */
  isAccent?: boolean | undefined;
  /*
   * Read before the label by a screen reader only, such as "Trigger: ".
   * Translated by the caller.
   */
  screenReaderPrefix?: string | undefined;
}

/** A thing a template is made of, named as the product names it elsewhere. */
export const TemplateDetailsChip: (
  props: TemplateDetailsChipProps,
) => ReactElement = (props: TemplateDetailsChipProps): ReactElement => {
  return (
    <div
      className="inline-flex max-w-full items-center gap-1.5 rounded-md bg-white px-2 py-0.5 text-xs font-medium text-gray-700 ring-1 ring-inset ring-gray-200"
      data-testid={props.dataTestId}
    >
      <Icon
        icon={props.icon}
        className={`h-3.5 w-3.5 flex-shrink-0 ${
          props.isAccent ? "text-indigo-600" : "text-gray-400"
        }`}
      />
      <span className="min-w-0 truncate">
        {props.screenReaderPrefix ? (
          <span className="sr-only">{props.screenReaderPrefix}</span>
        ) : (
          <></>
        )}
        {props.label}
      </span>
    </div>
  );
};
