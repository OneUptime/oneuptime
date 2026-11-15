import WordsWithInfoTooltip from "Common/UI/Components/Tooltip/WordsWithInfoTooltip";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  // English, drawn in the reader's language.
  title: string;
  // English, drawn in the reader's language.
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
 *
 * Its title, hint and count in the reader's language and digits. The (i)
 * follows the title's last word (WordsWithInfoTooltip, issue #7348), and
 * the count follows the (i), on the line the title ends on - after the
 * title in either reading direction.
 */
const NetworkMapSection: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <div className="mt-6 border-t border-gray-200 pt-5">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <h3
          className="text-sm font-semibold text-gray-900"
          data-testid="network-map-section-title"
        >
          <WordsWithInfoTooltip
            text={translator.translateText(props.title) || props.title}
            label={props.title}
            description={props.description}
          />
          {/*
           * The count is a box of its own (inline-block): in a right-to-left
           * page a title that ends in Latin letters ("WAN") would otherwise
           * take the digits into its own run and draw them between its
           * words. As a box it keeps the page's direction, so its gap is
           * on the title's side.
           */}
          <span
            className="ms-1.5 inline-block text-xs font-normal tabular-nums text-gray-400"
            data-testid="network-map-section-count"
          >
            {translator.formatNumber(props.count)}
          </span>
        </h3>
        <p className="text-xs text-gray-500">
          {translator.translateText(props.hint) || props.hint}
        </p>
      </div>
      <div className="mt-3">{props.children}</div>
    </div>
  );
};

export default NetworkMapSection;
