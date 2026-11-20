import React, { FunctionComponent, ReactElement } from "react";
import {
  SecurityCaseEdgeActivityJson,
  SecurityCaseEdgeAddressJson,
  SecurityCaseEdgeJson,
} from "Common/Types/SecurityCase/SecurityCaseContext";
import { PluralTemplate } from "Common/Types/Translator";
import {
  getAppReachedCount,
  getEdgeLetOnCount,
  getEdgeStoppedCount,
  hasAppRequests,
} from "Common/Utils/SecurityCase/SecurityCaseEdgeFacts";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";

/*
 * THE EDGE AND THE APP, SIDE BY SIDE, FOR EACH OF THE CASE'S ADDRESSES.
 *
 * What Cloudflare (or another edge OneUptime reads) did with an address's
 * requests - blocked, challenged, passed a challenge, logged, let through on
 * a rule of the project's own - beside what OneUptime saw of the same
 * address in the app itself: how many of its requests reached the app, the
 * database, or were turned away there. A sentence leads ("Cloudflare
 * stopped about 400 requests from 35.205.11.131."), and the figures follow.
 *
 * A count from an edge's sampled events is an estimate and says "about".
 * When OneUptime saw none of the address's requests in the app's own logs
 * or traces, it says so rather than "none reached your app": it cannot tell.
 */

export const SECURITY_CASE_EDGE_TEST_IDS: {
  section: string;
  address: string;
  headline: string;
  noAppRequests: string;
} = {
  section: "security-case-edge",
  address: "security-case-edge-address",
  headline: "security-case-edge-headline",
  noAppRequests: "security-case-edge-no-app-requests",
};

export const EDGE_SECTION_HEADING: string = translationKey("At the edge");

// Plural sentences, looked up by their "other" form (the extractor reads them).
export const EDGE_STOPPED: PluralTemplate = {
  one: "{{edge}} stopped {{count}} request from {{address}}.",
  other: "{{edge}} stopped {{count}} requests from {{address}}.",
};

export const EDGE_STOPPED_ABOUT: PluralTemplate = {
  one: "{{edge}} stopped about {{count}} request from {{address}}.",
  other: "{{edge}} stopped about {{count}} requests from {{address}}.",
};

export const EDGE_LET_THROUGH: PluralTemplate = {
  one: "{{edge}} let {{count}} request from {{address}} through.",
  other: "{{edge}} let {{count}} requests from {{address}} through.",
};

export const EDGE_LET_THROUGH_ABOUT: PluralTemplate = {
  one: "{{edge}} let about {{count}} request from {{address}} through.",
  other: "{{edge}} let about {{count}} requests from {{address}} through.",
};

// A figure from sampled events.
export const EDGE_ABOUT_FIGURE: string = translationKey("about {{count}}");

export const EDGE_FIGURE_LABELS: {
  blocked: string;
  challenged: string;
  passedChallenge: string;
  logged: string;
  letThrough: string;
  reachedApp: string;
  reachedDatabase: string;
  rejected: string;
} = {
  blocked: translationKey("Blocked"),
  challenged: translationKey("Challenged"),
  passedChallenge: translationKey("Passed a challenge"),
  logged: translationKey("Logged"),
  letThrough: translationKey("Let through by your rules"),
  reachedApp: translationKey("Reached your app"),
  reachedDatabase: translationKey("Reached the database"),
  rejected: translationKey("Turned away by your app"),
};

export const EDGE_NO_APP_REQUESTS: string = translationKey(
  "OneUptime saw none of this address's requests in your app's logs or traces, so it cannot tell whether any reached the app.",
);

interface Figure {
  key: string;
  label: string;
  value: number;
  isEstimate: boolean;
}

// The sentence that leads an address: what the edge did with most of its requests.
export function edgeHeadline(
  activity: SecurityCaseEdgeActivityJson,
  address: string,
  translator: Translator,
): string {
  const stopped: number = getEdgeStoppedCount(activity);
  const values: { edge: string; address: string } = {
    edge: activity.edge,
    address,
  };

  if (stopped > 0) {
    return translator.translatePlural(
      activity.isEstimate ? EDGE_STOPPED_ABOUT : EDGE_STOPPED,
      stopped,
      values,
    );
  }

  return translator.translatePlural(
    activity.isEstimate ? EDGE_LET_THROUGH_ABOUT : EDGE_LET_THROUGH,
    getEdgeLetOnCount(activity) + activity.other,
    values,
  );
}

// The figures of one address, the edge's first, those that are not zero.
export function edgeFigures(
  entry: SecurityCaseEdgeAddressJson,
): Array<Figure> {
  const figures: Array<Figure> = [];

  for (const activity of entry.edges) {
    const edgeFigures: Array<[keyof typeof EDGE_FIGURE_LABELS, number]> = [
      ["blocked", activity.blocked],
      ["challenged", activity.challenged],
      ["passedChallenge", activity.passedChallenge],
      ["logged", activity.logged],
      ["letThrough", activity.letThrough],
    ];

    for (const [key, value] of edgeFigures) {
      if (value > 0) {
        figures.push({
          key: `${activity.edge}-${key}`,
          label: EDGE_FIGURE_LABELS[key],
          value,
          isEstimate: activity.isEstimate,
        });
      }
    }
  }

  const appFigures: Array<[keyof typeof EDGE_FIGURE_LABELS, number]> = [
    ["reachedApp", getAppReachedCount(entry)],
    ["reachedDatabase", entry.app.reachedDatabase],
    ["rejected", entry.app.rejected],
  ];

  for (const [key, value] of appFigures) {
    if (value > 0) {
      figures.push({
        key: `app-${key}`,
        label: EDGE_FIGURE_LABELS[key],
        value,
        isEstimate: false,
      });
    }
  }

  return figures;
}

export interface ComponentProps {
  edge: SecurityCaseEdgeJson | null | undefined;
}

const SecurityCaseEdgeSection: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const addresses: Array<SecurityCaseEdgeAddressJson> =
    props.edge?.addresses || [];

  if (addresses.length === 0) {
    return <></>;
  }

  return (
    <section data-testid={SECURITY_CASE_EDGE_TEST_IDS.section}>
      <h3 className="mb-2 text-xs font-medium uppercase tracking-wide text-gray-500">
        {translator.translateText(EDGE_SECTION_HEADING)}
      </h3>
      <ul className="space-y-3">
        {addresses.map((entry: SecurityCaseEdgeAddressJson): ReactElement => {
          return (
            <li
              key={entry.address}
              data-testid={SECURITY_CASE_EDGE_TEST_IDS.address}
              className="space-y-1.5"
            >
              {entry.edges.map(
                (activity: SecurityCaseEdgeActivityJson): ReactElement => {
                  return (
                    <p
                      key={activity.edge}
                      className="text-sm text-gray-700 [overflow-wrap:anywhere]"
                      data-testid={SECURITY_CASE_EDGE_TEST_IDS.headline}
                    >
                      {edgeHeadline(activity, entry.address, translator)}
                    </p>
                  );
                },
              )}
              <dl className="flex flex-wrap gap-x-4 gap-y-1">
                {edgeFigures(entry).map((figure: Figure): ReactElement => {
                  const value: string = translator.formatNumber(figure.value);

                  return (
                    <div key={figure.key} className="flex gap-1.5 text-sm">
                      <dt className="text-gray-500">
                        {translator.translateText(figure.label)}
                      </dt>
                      <dd className="font-medium text-gray-900">
                        {figure.isEstimate
                          ? translator.translateTemplate(EDGE_ABOUT_FIGURE, {
                              count: value,
                            })
                          : value}
                      </dd>
                    </div>
                  );
                })}
              </dl>
              {hasAppRequests(entry) ? (
                <></>
              ) : (
                <p
                  className="text-sm text-gray-500"
                  data-testid={SECURITY_CASE_EDGE_TEST_IDS.noAppRequests}
                >
                  {translator.translateText(EDGE_NO_APP_REQUESTS)}
                </p>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
};

export default SecurityCaseEdgeSection;
