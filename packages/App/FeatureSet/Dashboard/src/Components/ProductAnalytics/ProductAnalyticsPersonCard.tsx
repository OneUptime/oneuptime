import OneUptimeDate from "Common/Types/Date";
import { ProductAnalyticsPersonDto } from "Common/Types/Rum/ProductAnalytics";
import Card from "Common/UI/Components/Card/Card";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import React, { Fragment, FunctionComponent, ReactElement } from "react";
import SessionReplayUserAvatar from "../SessionReplay/SessionReplayUserAvatar";
import {
  initialsOf,
  stableHue,
} from "../SessionReplay/SessionReplayUserIdentity";
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

/*
 * The person's monogram, as Session Replay draws the same person: the
 * colour from their key, so a signed-in user or a browser keeps one colour
 * on every page; their initials when they have a name, "?" when they have
 * none to show.
 */
export const ProductAnalyticsPersonAvatar: FunctionComponent<{
  person: ProductAnalyticsPersonDto;
  words: ProductAnalyticsPersonWords;
  size: "sm" | "md";
}> = (props: {
  person: ProductAnalyticsPersonDto;
  words: ProductAnalyticsPersonWords;
  size: "sm" | "md";
}): ReactElement => {
  const key: string = (
    props.person.kind === "identified"
      ? props.person.identifiedUserKey
      : props.person.visitorId
  ).trim();

  return (
    <SessionReplayUserAvatar
      initials={props.words.isLabel ? initialsOf(props.words.primary) : "?"}
      hue={key ? stableHue(key) : null}
      size={props.size}
    />
  );
};

/*
 * The line under a person's name: what they are, in the reader's words,
 * or the start of their id - written left to right in any page, so its
 * "..." stays at its end.
 */
export const ProductAnalyticsPersonSecondary: FunctionComponent<{
  words: ProductAnalyticsPersonWords;
}> = (props: { words: ProductAnalyticsPersonWords }): ReactElement => {
  if (props.words.isLabel) {
    return <span>{props.words.secondary}</span>;
  }

  return (
    <span dir="ltr" className="font-mono">
      {props.words.secondary}
    </span>
  );
};

interface PersonFact {
  label: string;
  value: string;
  // A second, quieter line: how long ago, or what the number covers.
  detail?: string | undefined;
  // The whole of it, under the pointer.
  title?: string | undefined;
}

export const ProductAnalyticsPersonFacts: FunctionComponent<{
  person: ProductAnalyticsPersonDto;
}> = (props: { person: ProductAnalyticsPersonDto }): ReactElement => {
  const translator: Translator = useTranslator();
  const firstSeen: Date = new Date(props.person.firstSeenAt);
  const lastSeen: Date = new Date(props.person.lastSeenAt);
  const facts: Array<PersonFact> = [
    {
      label: "First seen",
      value: OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
        firstSeen,
        true,
      ),
      detail: OneUptimeDate.fromNow(firstSeen),
      title: OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(firstSeen),
    },
    {
      label: "Last seen",
      value: OneUptimeDate.fromNow(lastSeen),
      detail: OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(
        lastSeen,
        true,
      ),
      title: OneUptimeDate.getDateAsUserFriendlyLocalFormattedString(lastSeen),
    },
    {
      label: "All sessions",
      value: formatProductAnalyticsCount(
        props.person.totalSessions,
        translator,
      ),
      detail: translator.translateText("In the last 13 months"),
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

  /*
   * Five across where the card is wide enough for five, else three, else
   * two: by the card's own width, which a side menu beside it takes from.
   */
  return (
    <div className="[container-type:inline-size]">
      <dl
        className="grid grid-cols-2 gap-x-6 gap-y-4 [@container(min-width:30rem)]:grid-cols-3 [@container(min-width:46rem)]:grid-cols-5"
        data-testid="product-analytics-person-facts"
      >
        {facts.map((fact: PersonFact): ReactElement => {
          return (
            <div key={fact.label} className="min-w-0">
              <dt className="text-xs font-medium uppercase tracking-wider text-gray-500">
                {translator.translateText(fact.label)}
              </dt>
              <dd
                className="mt-1 break-words text-sm font-medium text-gray-900"
                title={fact.title}
              >
                {fact.value}
              </dd>
              {fact.detail ? (
                <dd className="mt-0.5 break-words text-xs text-gray-500">
                  {fact.detail}
                </dd>
              ) : (
                <></>
              )}
            </div>
          );
        })}
      </dl>
    </div>
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
        <span className="flex min-w-0 items-center gap-3">
          <ProductAnalyticsPersonAvatar
            person={props.person}
            words={words}
            size="md"
          />
          <span
            className="min-w-0 break-words"
            dir={words.isLabel ? "auto" : undefined}
          >
            {words.primary}
          </span>
        </span>
      }
      description={<ProductAnalyticsPersonSecondary words={words} />}
      buttons={[<Fragment key="back">{props.backLink}</Fragment>]}
    >
      <div className="space-y-4">
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
