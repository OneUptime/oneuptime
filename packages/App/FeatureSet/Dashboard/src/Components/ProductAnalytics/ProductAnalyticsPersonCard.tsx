import OneUptimeDate from "Common/Types/Date";
import { ProductAnalyticsPersonDto } from "Common/Types/Rum/ProductAnalytics";
import Card from "Common/UI/Components/Card/Card";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import {
  ProductAnalyticsPersonWords,
  describeProductAnalyticsCountry,
  describeProductAnalyticsDevice,
  describeProductAnalyticsPerson,
  formatProductAnalyticsCount,
} from "./ProductAnalyticsFormat";

/*
 * Who one person of Product Analytics > Users is (issue #6444): their name
 * or kind as the card's title, their key under it, and when they first and
 * last came, how many sessions the last 13 months hold, their device and
 * their country. The way back to the list sits in the card's header.
 *
 * A card of facts, not a list: the person page's sessions are a table of
 * their own, in a card of their own below this one.
 */

export const ProductAnalyticsPersonFacts: FunctionComponent<{
  person: ProductAnalyticsPersonDto;
}> = (props: { person: ProductAnalyticsPersonDto }): ReactElement => {
  const translator: Translator = useTranslator();
  const facts: Array<{ label: string; value: string }> = [
    {
      label: "First seen",
      value: OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
        new Date(props.person.firstSeenAt),
      ),
    },
    {
      label: "Last seen",
      value: OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
        new Date(props.person.lastSeenAt),
      ),
    },
    {
      label: "All sessions",
      value: formatProductAnalyticsCount(
        props.person.totalSessions,
        translator,
      ),
    },
    {
      label: "Device",
      value: describeProductAnalyticsDevice(
        props.person.deviceType,
        translator,
      ),
    },
    {
      label: "Country",
      value: props.person.countryCode
        ? describeProductAnalyticsCountry(
            props.person.countryCode,
            translator.language,
          )
        : "-",
    },
  ];

  return (
    <dl
      className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-5"
      data-testid="product-analytics-person-facts"
    >
      {facts.map((fact: { label: string; value: string }): ReactElement => {
        return (
          <div key={fact.label} className="min-w-0">
            <dt className="text-xs font-medium uppercase tracking-wider text-gray-500">
              {translator.translateText(fact.label)}
            </dt>
            <dd className="mt-1 break-words text-sm text-gray-900">
              {fact.value}
            </dd>
          </div>
        );
      })}
    </dl>
  );
};

export interface ProductAnalyticsPersonCardProps {
  person: ProductAnalyticsPersonDto;
  // Whether the read named signed-in users: false for a role that may not.
  includesLabels: boolean;
  // Back to the people list, at the range and filter it was opened from.
  backLink: ReactElement;
}

const ProductAnalyticsPersonCard: FunctionComponent<
  ProductAnalyticsPersonCardProps
> = (props: ProductAnalyticsPersonCardProps): ReactElement => {
  const translator: Translator = useTranslator();
  const words: ProductAnalyticsPersonWords = describeProductAnalyticsPerson(
    props.person,
    translator,
  );

  return (
    <Card
      title={
        <span dir={words.isLabel ? "auto" : undefined}>{words.primary}</span>
      }
      description={<span className="font-mono text-xs">{words.secondary}</span>}
      buttons={[<Fragment key="back">{props.backLink}</Fragment>]}
    >
      <div className="space-y-3">
        <ProductAnalyticsPersonFacts person={props.person} />
        {props.person.kind === "identified" && !props.includesLabels ? (
          <p
            className="text-xs text-gray-500"
            data-testid="product-analytics-person-hidden-name"
          >
            {translator.translateText(
              "Your role cannot see who signed-in users are, so this person is shown without a name.",
            )}
          </p>
        ) : (
          <></>
        )}
      </div>
    </Card>
  );
};

export default ProductAnalyticsPersonCard;
