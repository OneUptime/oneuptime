import React, { FunctionComponent, ReactElement } from "react";
import BreakableName from "Common/UI/Components/BreakableName/BreakableName";
import Card from "Common/UI/Components/Card/Card";
import { useCardRuledBodyClassName } from "Common/UI/Components/Card/CardSurface";
import CopyableButton from "Common/UI/Components/CopyableButton/CopyableButton";
import { DETAIL_VALUE_CLASS_NAME } from "Common/UI/Components/Detail/Detail";
import { DETAIL_FIELD_LABEL_CLASS_NAME } from "Common/UI/Components/Detail/DetailFieldLabel";
import {
  getDetailCellClassNames,
  getDetailGridClassName,
} from "Common/UI/Components/Detail/DetailGridLayout";
import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";

/*
 * A part's details - what its product knows about it - laid out the way
 * every detail card in the product is (Detail's grid: each name over its
 * value, three columns on a wide screen, rules between the rows), with the
 * values a reader pastes elsewhere one copy away. Nothing to edit: the
 * product that reports the part owns these. The ESXi host page's card,
 * generalized for every resource product's parts. A value breaks as the
 * resource overviews' Details values do: after its own dots and slashes
 * first (BreakableName), anywhere only where a part is still too long for
 * the line - never break-all, which split dates and words mid-letter.
 */

// The card's columns on a wide screen (two from sm, one on a phone).
export const RESOURCE_PART_DETAIL_COLUMNS: number = 3;

export interface ResourcePartDetailRow {
  key: string;
  // English.
  label: string;
  value: ReactElement | string;
  // What the value means, in an (i) beside the label.
  description?: string | undefined;
  mono?: boolean | undefined;
  // What the value's copy button copies; no button without it.
  copyText?: string | undefined;
}

export interface ComponentProps {
  testId: string;
  // Defaults to "Details".
  title?: string | undefined;
  description: string;
  rows: Array<ResourcePartDetailRow>;
}

const ResourcePartDetailsCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  const tx: (text: string) => string = (text: string): string => {
    return translator.translateText(text) || text;
  };
  const bodyClassName: string = useCardRuledBodyClassName();

  if (props.rows.length === 0) {
    return <></>;
  }

  // Where each field sits in the grid, as Detail places its fields.
  const cellClassNames: Array<string> = getDetailCellClassNames(
    props.rows.map((): undefined => {
      return undefined;
    }),
    RESOURCE_PART_DETAIL_COLUMNS,
  );

  return (
    <div className="mb-6" data-testid={props.testId}>
      <Card title={props.title || "Details"} description={props.description}>
        <div className={`${bodyClassName} px-5 py-5 md:px-6`}>
          <dl className={getDetailGridClassName(RESOURCE_PART_DETAIL_COLUMNS)}>
            {props.rows.map(
              (row: ResourcePartDetailRow, index: number): ReactElement => {
                return (
                  <div
                    key={row.key}
                    data-testid={`${props.testId}-${row.key}`}
                    className={cellClassNames[index]}
                  >
                    <dt
                      className={`flex justify-start ${DETAIL_FIELD_LABEL_CLASS_NAME}`}
                    >
                      <span className="inline-flex items-center gap-1">
                        {tx(row.label)}
                        {row.description ? (
                          <InfoTooltip
                            label={row.label}
                            text={row.description}
                          />
                        ) : (
                          <></>
                        )}
                      </span>
                    </dt>
                    <dd
                      className={`${DETAIL_VALUE_CLASS_NAME} flex items-start gap-2`}
                    >
                      <div
                        className={`min-w-0 [overflow-wrap:anywhere]${row.mono ? " font-mono" : ""}`}
                      >
                        {typeof row.value === "string" ? (
                          <BreakableName text={row.value} />
                        ) : (
                          row.value
                        )}
                      </div>
                      {/*
                       * Beside the value and always in view, as on every
                       * detail card: a keyboard, a touch screen or a reader
                       * who would not think to hover still finds it.
                       */}
                      {row.copyText ? (
                        <div
                          className="flex h-6 flex-none items-center"
                          data-testid={`${props.testId}-copy`}
                        >
                          <CopyableButton textToBeCopied={row.copyText} />
                        </div>
                      ) : (
                        <></>
                      )}
                    </dd>
                  </div>
                );
              },
            )}
          </dl>
        </div>
      </Card>
    </div>
  );
};

export default ResourcePartDetailsCard;
