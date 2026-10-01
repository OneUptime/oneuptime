import CopyTextButton from "../CopyTextButton/CopyTextButton";
import BreakableCode from "./BreakableCode";
import { ReturnValue } from "../../../Types/Workflow/Component";
import { componentReturnValueReference } from "../../../Types/Workflow/TemplateSyntax";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  returnValues: Array<ReturnValue>;
  name: string;
  description: string;
  /*
   * This step's identifier. When given, each return value also shows the exact
   * reference another step would use to read it. That string was previously
   * obtainable only by opening the value picker on some other component, so the
   * syntax had no home on the component that owns the value.
   */
  componentId?: string | undefined;
}

/*
 * One row per value, the full width of the dialog: its name and type, what it
 * holds, and the reference that reads it with a button to copy it. The
 * reference wraps only between its parts (see BreakableCode). In the old narrow
 * sidebar it wrapped wherever it hit a hyphen, three lines to a reference, and
 * there was no way to copy it short of selecting it by hand.
 */
const ComponentReturnValueViewer: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  return (
    <div>
      {props.name && (
        <h2 className="text-sm font-semibold text-gray-600">{props.name}</h2>
      )}
      {props.description && (
        <p className="mb-2 text-xs text-gray-500">{props.description}</p>
      )}
      {props.returnValues && props.returnValues.length === 0 && (
        <p className="text-xs italic text-gray-500">
          This step does not return any data.
        </p>
      )}
      {props.returnValues && props.returnValues.length > 0 && (
        <ul className="space-y-2">
          {props.returnValues.map((returnValue: ReturnValue, i: number) => {
            const reference: string | null = props.componentId
              ? componentReturnValueReference(props.componentId, returnValue.id)
              : null;

            return (
              <li
                key={returnValue.id || i}
                className="rounded-lg border border-gray-200 bg-gray-50 px-3 py-2.5"
                data-testid="workflow-return-value"
              >
                {/*
                 * The type sits right after the name rather than at the far
                 * end of the row: on a phone a pill pinned to the right edge
                 * squeezed the name onto two lines, and on a wide dialog it
                 * was a long way from the name it describes.
                 */}
                <p className="text-sm font-medium text-gray-900">
                  {returnValue.name}
                  <span
                    className="ml-2 inline-block whitespace-nowrap rounded-full border border-indigo-100 bg-indigo-50 px-2 py-0.5 align-middle text-[11px] font-medium leading-4 text-indigo-700"
                    data-testid="workflow-return-value-type"
                  >
                    {returnValue.type}
                  </span>
                </p>
                {returnValue.description && (
                  <p className="mt-0.5 text-xs text-gray-500">
                    {returnValue.description}
                  </p>
                )}
                {reference ? (
                  <div className="mt-2 flex items-start gap-2">
                    <BreakableCode
                      text={reference}
                      breakAfter="."
                      dataTestId="workflow-return-value-reference"
                      className="block min-w-0 overflow-x-auto rounded-md border border-gray-200 bg-white px-2 py-1 text-xs leading-5 text-gray-700"
                    />
                    <CopyTextButton
                      textToBeCopied={reference}
                      iconOnly={true}
                      size="sm"
                      title={`Copy the reference to ${returnValue.name}`}
                      className="mt-0.5 shrink-0"
                    />
                  </div>
                ) : (
                  <BreakableCode
                    text={returnValue.id}
                    breakAfter="-"
                    dataTestId="workflow-return-value-id"
                    className="mt-1 block text-[11px] text-gray-500"
                  />
                )}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
};

export default ComponentReturnValueViewer;
