import NextNumberCard from "./NextNumberCard";
import { NextNumberPage } from "./NextNumberSettings";
import NumberPrefixCard from "../NumberPrefix/NumberPrefixCard";
import { NumberPrefixPage } from "../NumberPrefix/NumberPrefixSettings";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useState,
} from "react";

export interface ComponentProps {
  prefixes: NumberPrefixPage;
  nextNumbers: NextNumberPage;
}

/*
 * What each product's Numbering page holds (Incidents, Alerts and Scheduled
 * Maintenance → Settings → Numbering): the Number Prefix card - the text in
 * front of the numbers - then the Next Number card under it - the number the
 * next record gets.
 *
 * The Next Number card shows every number with its prefix, so it reads the
 * numbers again as soon as the prefixes are saved: INC-2346 becomes OPS-2346
 * when INC- becomes OPS-, rather than after the page is reloaded.
 */
const NumberingCards: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const [prefixSaves, setPrefixSaves] = useState<number>(0);

  return (
    <Fragment>
      <NumberPrefixCard
        page={props.prefixes}
        onSaveSuccess={() => {
          setPrefixSaves((count: number): number => {
            return count + 1;
          });
        }}
      />
      <NextNumberCard page={props.nextNumbers} refreshToken={prefixSaves} />
    </Fragment>
  );
};

export default NumberingCards;
