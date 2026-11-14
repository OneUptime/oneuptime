import { Gray500, Green, Red, Yellow } from "Common/Types/BrandColors";
import {
  CloudRightSizing,
  RIGHT_SIZING_TITLE,
} from "Common/Types/Cloud/CloudRightSizing";
import Color from "Common/Types/Color";
import IconProp from "Common/Types/Icon/IconProp";
import Card from "Common/UI/Components/Card/Card";
import DirectionArrow from "Common/UI/Components/DirectionArrow/DirectionArrow";
import Icon from "Common/UI/Components/Icon/Icon";
import Pill from "Common/UI/Components/Pill/Pill";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import {
  CloudRightSizingFact,
  CloudRightSizingSavingTone,
  CloudRightSizingText,
  CloudRightSizingTone,
  RIGHT_SIZING_DESCRIPTION,
  getCloudRightSizingText,
} from "./CloudRightSizingText";
import { CloudCostFigure } from "./CloudSpendCard";

/*
 * A resource's right-sizing, on its Overview: how its size fits what it
 * uses, from OneUptime's own readings of its CPU and memory over the last
 * two weeks (Types/Cloud/CloudRightSizing) - its verdict, the size to
 * change to and what that saves or costs a month once its cost is known,
 * the readings it was judged from, what they would be at the new size,
 * and, sized by CPU only, what to check first. Drawn only for a resource
 * no recommender of its cloud speaks for (CloudResourceSpendCards
 * decides): its cloud's own word is the "What it costs" card's.
 */

export const CLOUD_RIGHT_SIZING_TONE_COLORS: Readonly<
  Record<CloudRightSizingTone, Color>
> = {
  warning: Yellow,
  danger: Red,
  positive: Green,
  neutral: Gray500,
};

/*
 * A saving's amount stands out from the words around it: green for money
 * back, amber for a larger size that costs more - never green for that.
 */
export const CLOUD_RIGHT_SIZING_SAVING_AMOUNT_CLASS_NAMES: Readonly<
  Record<CloudRightSizingSavingTone, string>
> = {
  positive: "font-semibold text-emerald-700",
  warning: "font-semibold text-amber-700",
  neutral: "",
};

export interface ComponentProps {
  sizing: CloudRightSizing;
}

const CloudResourceRightSizingCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const text: CloudRightSizingText = getCloudRightSizingText({
    sizing: props.sizing,
    translator,
  });

  return (
    <Card title={RIGHT_SIZING_TITLE} description={RIGHT_SIZING_DESCRIPTION}>
      <div data-testid="cloud-right-sizing" data-verdict={props.sizing.verdict}>
        <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
          <span data-testid="cloud-right-sizing-verdict" data-tone={text.tone}>
            <Pill
              text={text.verdict}
              color={CLOUD_RIGHT_SIZING_TONE_COLORS[text.tone]}
            />
          </span>
          {text.change ? (
            /*
             * The cloud's own size names, each set apart in its own
             * direction, and the arrow the page's: "m5.2xlarge →
             * m5.xlarge", and on a page read right to left the same names
             * read from the right with "←" between them.
             */
            <span
              className="break-words font-mono text-sm font-semibold text-gray-900"
              data-testid="cloud-right-sizing-change"
            >
              <bdi>{text.change.from}</bdi> <DirectionArrow />{" "}
              <bdi>{text.change.to}</bdi>
            </span>
          ) : (
            <></>
          )}
        </div>

        <p
          className="mt-2 text-sm text-gray-700"
          data-testid="cloud-right-sizing-headline"
        >
          {text.headline}
        </p>

        {text.saving ? (
          <p
            className={`mt-1 text-sm ${
              text.savingSentence ? "text-gray-700" : "text-gray-500"
            }`}
            data-testid="cloud-right-sizing-saving"
            data-known={text.isSavingKnown ? "true" : "false"}
            data-tone={text.savingTone || "neutral"}
          >
            {text.savingSentence ? (
              <TranslatedSentence
                template={text.savingSentence.template}
                slots={{
                  amount: (
                    <span
                      className={`tabular-nums ${
                        CLOUD_RIGHT_SIZING_SAVING_AMOUNT_CLASS_NAMES[
                          text.savingTone || "neutral"
                        ]
                      }`}
                      data-testid="cloud-right-sizing-saving-amount"
                    >
                      <bdi>{text.savingSentence.amount}</bdi>
                    </span>
                  ),
                }}
              />
            ) : (
              text.saving
            )}
          </p>
        ) : (
          <></>
        )}

        {text.facts.length > 0 ? (
          <div className="mt-5 [container-type:inline-size]">
            <dl className="grid grid-cols-2 gap-4 [@container(min-width:32rem)]:grid-cols-4">
              {text.facts.map((fact: CloudRightSizingFact): ReactElement => {
                return (
                  <CloudCostFigure
                    key={fact.testId}
                    label={fact.label}
                    value={fact.value}
                    testId={fact.testId}
                  />
                );
              })}
            </dl>
          </div>
        ) : (
          <></>
        )}

        {/*
         * Why the change works: its readings at the new size, under the
         * readings now.
         */}
        {text.why.length > 0 ? (
          <div
            className="mt-5 space-y-1 border-t border-gray-100 pt-4 text-sm text-gray-600"
            data-testid="cloud-right-sizing-why"
          >
            {text.why.map((line: string): ReactElement => {
              return <p key={line}>{line}</p>;
            })}
          </div>
        ) : (
          <></>
        )}

        {/*
         * A div, not a p: Icon draws a div, which a paragraph may not hold
         * (React says so in the console, and the browser closes the p).
         */}
        {text.caveat ? (
          <div
            className={`flex items-start gap-2 text-xs text-gray-600 ${
              text.why.length > 0 ? "mt-3" : "mt-5"
            }`}
            data-testid="cloud-right-sizing-caveat"
          >
            <Icon
              icon={IconProp.InformationCircle}
              className="mt-px h-4 w-4 flex-none text-amber-500"
            />
            <span className="min-w-0">{text.caveat}</span>
          </div>
        ) : (
          <></>
        )}
      </div>
    </Card>
  );
};

export default CloudResourceRightSizingCard;
