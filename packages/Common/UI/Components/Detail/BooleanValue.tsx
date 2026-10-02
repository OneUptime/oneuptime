import React, { FunctionComponent, ReactElement } from "react";

/*
 * A yes/no value as details and a form's summary step show it: a green "Yes"
 * pill, or a grey "No" one. Detail draws every FieldType.Boolean field with
 * it; a summary element of its own that still needs to say whether a box was
 * ticked uses it too, so the two cannot drift apart.
 */

export interface ComponentProps {
  value: boolean;
  dataTestId?: string | undefined;
}

const BooleanValue: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  if (props.value) {
    return (
      <span
        data-testid={props.dataTestId}
        className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-green-50 text-green-700 text-sm font-medium"
      >
        <span className="w-1.5 h-1.5 rounded-full bg-green-500"></span>
        Yes
      </span>
    );
  }

  return (
    <span
      data-testid={props.dataTestId}
      className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-gray-100 text-gray-600 text-sm font-medium"
    >
      <span className="w-1.5 h-1.5 rounded-full bg-gray-400"></span>
      No
    </span>
  );
};

export default BooleanValue;
