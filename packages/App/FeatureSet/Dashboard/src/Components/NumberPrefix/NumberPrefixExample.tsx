import NumberPrefixUtil from "Common/Utils/Project/NumberPrefix";
import useTranslateValue from "Common/UI/Utils/Translation";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A number prefix as the Number Prefix card shows it: the prefix itself,
 * then the number it makes - "INC-   Example: INC-42", or "No prefix
 * Example: #42" for a project without one. The example is built by the same
 * function the server numbers new incidents with, so it is what people will
 * see. A label and its value, never a sentence glued together, so it reads
 * the same in every language.
 *
 * font-mono sits on each element that holds code text itself: index.ejs
 * gives every element Inter (`* { font-family }`), which beats a font
 * inherited from a parent.
 */

export interface NumberPrefixExampleProps {
  prefix: string | null | undefined;
  dataTestId?: string | undefined;
}

export const NumberPrefixExample: FunctionComponent<
  NumberPrefixExampleProps
> = (props: NumberPrefixExampleProps): ReactElement => {
  const { translateString } = useTranslateValue();

  const prefix: string = props.prefix || "";

  return (
    <div
      data-testid={props.dataTestId}
      className="flex flex-wrap items-center gap-x-3 gap-y-1"
    >
      {prefix ? (
        <code
          data-testid="number-prefix-value"
          className="rounded-md bg-gray-100 px-2 py-0.5 font-mono text-sm font-semibold text-gray-900"
        >
          {prefix}
        </code>
      ) : (
        <span
          data-testid="number-prefix-value"
          className="text-sm text-gray-500"
        >
          {translateString("No prefix")}
        </span>
      )}
      <span className="text-sm text-gray-500">
        {translateString("Example:")}
      </span>
      <span
        data-testid="number-prefix-example"
        className="font-mono text-sm text-gray-900"
      >
        {NumberPrefixUtil.getExample(prefix)}
      </span>
    </div>
  );
};

export interface NumberPrefixPreviewProps {
  // What the field holds right now, as typed.
  value: unknown;
  dataTestId?: string | undefined;
}

/*
 * Under a prefix field while it is edited: the number the typed prefix
 * makes, as it will be stored (trimmed). Nothing while the prefix breaks a
 * rule - the field's error says why instead.
 */
export const NumberPrefixPreview: FunctionComponent<
  NumberPrefixPreviewProps
> = (props: NumberPrefixPreviewProps): ReactElement => {
  const { translateString } = useTranslateValue();

  if (NumberPrefixUtil.getProblem(props.value)) {
    return <></>;
  }

  const prefix: string =
    typeof props.value === "string" ? props.value.trim() : "";

  return (
    <p
      data-testid={props.dataTestId}
      className="mt-2 flex flex-wrap items-center gap-x-2 text-sm text-gray-500"
    >
      <span>{translateString("Preview:")}</span>
      <span
        data-testid="number-prefix-preview"
        className="font-mono text-gray-900"
      >
        {NumberPrefixUtil.getExample(prefix)}
      </span>
    </p>
  );
};
