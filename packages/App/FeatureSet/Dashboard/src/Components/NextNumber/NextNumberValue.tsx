import { HIGHEST_SO_FAR_LABEL, NONE_USED_YET } from "./NextNumberSettings";
import useTranslateValue from "Common/UI/Utils/Translation";
import NextNumberUtil, {
  RecordNumbering,
} from "Common/Utils/Project/NextNumber";
import NumberPrefixUtil from "Common/Utils/Project/NumberPrefix";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A kind's next number as the Next Number card shows it: the number the
 * next record gets, with its prefix - built by the same function the server
 * numbers records with, so it is what people will see - then the highest
 * number used so far, or that none has been: "INC-2346   Highest so far:
 * INC-2345". The same chip, label and value as the Number Prefix card's
 * rows above it ("INC-   Example: INC-42"): a label and its value, never a
 * sentence glued together, so it reads the same in every language.
 *
 * font-mono sits on each element that holds code text itself: index.ejs
 * gives every element Inter (`* { font-family }`), which beats a font
 * inherited from a parent.
 */

export interface NextNumberValueProps {
  numbering: RecordNumbering;
  dataTestId?: string | undefined;
}

export const NextNumberValue: FunctionComponent<NextNumberValueProps> = (
  props: NextNumberValueProps,
): ReactElement => {
  const { translateString } = useTranslateValue();

  return (
    <div
      data-testid={props.dataTestId}
      className="flex flex-wrap items-center gap-x-3 gap-y-1"
    >
      <code
        data-testid="next-number-value"
        className="rounded-md bg-gray-100 px-2 py-0.5 font-mono text-sm font-semibold text-gray-900"
      >
        {NumberPrefixUtil.formatNumber(
          props.numbering.prefix,
          props.numbering.nextNumber,
        )}
      </code>
      {props.numbering.highestNumber > 0 ? (
        <>
          <span className="text-sm text-gray-500">
            {translateString(HIGHEST_SO_FAR_LABEL)}
          </span>
          <span
            data-testid="next-number-highest"
            className="font-mono text-sm text-gray-900"
          >
            {NumberPrefixUtil.formatNumber(
              props.numbering.prefix,
              props.numbering.highestNumber,
            )}
          </span>
        </>
      ) : (
        <span
          data-testid="next-number-highest"
          className="text-sm text-gray-500"
        >
          {translateString(NONE_USED_YET)}
        </span>
      )}
    </div>
  );
};

export interface NextNumberPreviewProps {
  // What the field holds right now, as typed.
  value: unknown;
  prefix: string | null;
  highestNumber: number;
  dataTestId?: string | undefined;
}

/*
 * Under a next number field while it is edited: the number the next record
 * will get, with its prefix. Nothing while the number breaks a rule - the
 * field's error says why instead.
 */
export const NextNumberPreview: FunctionComponent<NextNumberPreviewProps> = (
  props: NextNumberPreviewProps,
): ReactElement => {
  const { translateString } = useTranslateValue();

  if (NextNumberUtil.getProblem(props.value, props.highestNumber)) {
    return <></>;
  }

  return (
    <p
      data-testid={props.dataTestId}
      className="mt-2 flex flex-wrap items-center gap-x-2 text-sm text-gray-500"
    >
      <span>{translateString("Preview:")}</span>
      <span data-testid="next-number-preview" className="font-mono text-gray-900">
        {NumberPrefixUtil.formatNumber(
          props.prefix,
          NextNumberUtil.parse(props.value),
        )}
      </span>
    </p>
  );
};
