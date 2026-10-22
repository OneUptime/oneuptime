import ThreatIntelFeed from "Common/Models/DatabaseModels/ThreatIntelFeed";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import IconProp from "Common/Types/Icon/IconProp";
import URL from "Common/Types/API/URL";
import ThreatIntelFeedType, {
  RecommendedThreatIntelList,
} from "Common/Types/SecurityEvent/ThreatIntelFeedType";
import Button, {
  ButtonSize,
  ButtonStyleType,
} from "Common/UI/Components/Button/Button";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import Icon from "Common/UI/Components/Icon/Icon";
import Link from "Common/UI/Components/Link/Link";
import API from "Common/UI/Utils/API/API";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import {
  RECOMMENDED_THREAT_INTEL_LISTS,
  ThreatIntelSourceText,
  getRecommendedThreatIntelListText,
} from "./ThreatIntelSourcesCopy";

export const THREAT_INTEL_RECOMMENDED_LISTS_ID: string =
  "threat-intel-recommended-lists";

/*
 * A list as a feed of the project: polled as often as its provider asks,
 * its indicators as sure as the list is, a match opening a case - and an
 * alert too, unless the list is worth a look rather than a page.
 */
export function buildFeedFromRecommendedList(
  list: RecommendedThreatIntelList,
): ThreatIntelFeed {
  const feed: ThreatIntelFeed = new ThreatIntelFeed();
  feed.projectId = ProjectUtil.getCurrentProjectId()!;
  feed.name = list.title;
  feed.feedType = ThreatIntelFeedType.List;
  feed.listUrl = list.url;
  feed.indicatorConfidence = list.indicatorConfidence;
  feed.pollIntervalInMinutes = list.pollIntervalInMinutes;
  feed.isEnabled = true;
  feed.shouldCreateCase = true;
  feed.shouldCreateAlert = list.raisesAlerts;
  feed.shouldCreateIncident = false;
  feed.shouldWriteDetectionFinding = true;
  return feed;
}

// Whether the project has a feed of this list already: one reading the same address.
export function isRecommendedListAdded(
  list: RecommendedThreatIntelList,
  listUrls: Array<string>,
): boolean {
  return listUrls.some((url: string): boolean => {
    return url.trim().toLowerCase() === list.url.toLowerCase();
  });
}

export interface ComponentProps {
  /*
   * Changes whenever the feeds table changes - a feed added, edited or
   * deleted there - so the tiles read which lists are added again.
   */
  refreshToggle?: string | undefined;
  onAdded: () => void;
}

/*
 * Whether the card has anything left to offer: a project that reads every
 * free list already has no use for it. One added from the card a moment ago
 * keeps it, so the tile says Added rather than the card vanishing under the
 * click.
 */
export function shouldShowRecommendedLists(data: {
  listUrls: Array<string>;
  hasAddedHere: boolean;
  hasError: boolean;
}): boolean {
  if (data.hasAddedHere || data.hasError) {
    return true;
  }

  return RECOMMENDED_THREAT_INTEL_LISTS.some(
    (list: RecommendedThreatIntelList): boolean => {
      return !isRecommendedListAdded(list, data.listUrls);
    },
  );
}

/*
 * The free lists a project starts with, one click each: abuse.ch's Feodo
 * Tracker, the Emerging Threats compromised hosts and the Tor exit nodes.
 * Each tile says who publishes the list, how often it is read and where its
 * terms are; a list the project reads already says Added. Adding one creates
 * a list feed the feeds table below shows and edits like any other. The
 * card shows once the project's feeds are read, and only while a list is
 * left to add.
 */
const ThreatIntelRecommendedLists: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [listUrls, setListUrls] = useState<Array<string>>([]);
  /*
   * Until the project's feeds are read, a list it has already would offer
   * Add for a moment, and a project with every list would see the card
   * come and go: the card waits for the read.
   */
  const [isLoaded, setIsLoaded] = useState<boolean>(false);
  const [hasAddedHere, setHasAddedHere] = useState<boolean>(false);
  const [addingId, setAddingId] = useState<string | null>(null);
  const [error, setError] = useState<string>("");

  const createGate: PermissionGateResult = PermissionGate.check(
    new ThreatIntelFeed(),
    ModelAction.Create,
  );

  useEffect(() => {
    const load: () => Promise<void> = async (): Promise<void> => {
      try {
        const result: ListResult<ThreatIntelFeed> =
          await ModelAPI.getList<ThreatIntelFeed>({
            modelType: ThreatIntelFeed,
            query: { feedType: ThreatIntelFeedType.List },
            select: { _id: true, listUrl: true },
            sort: {},
            skip: 0,
            limit: LIMIT_PER_PROJECT,
          });

        setListUrls(
          result.data.map((feed: ThreatIntelFeed): string => {
            return feed.listUrl || "";
          }),
        );
      } catch (err) {
        setError(API.getFriendlyMessage(err));
      }

      setIsLoaded(true);
    };

    void load();
  }, [props.refreshToggle]);

  const addList: (list: RecommendedThreatIntelList) => Promise<void> = async (
    list: RecommendedThreatIntelList,
  ): Promise<void> => {
    setError("");
    setAddingId(list.id);

    try {
      await ModelAPI.create<ThreatIntelFeed>({
        model: buildFeedFromRecommendedList(list),
        modelType: ThreatIntelFeed,
      });

      setListUrls((current: Array<string>): Array<string> => {
        return [...current, list.url];
      });
      setHasAddedHere(true);
      props.onAdded();
    } catch (err) {
      setError(
        translator.translateTemplate("Could not add {{list}}: {{reason}}", {
          list: list.title,
          reason: API.getFriendlyMessage(err),
        }),
      );
    }

    setAddingId(null);
  };

  const everyHour: (minutes: number) => string = (minutes: number): string => {
    if (minutes >= 1440 && minutes % 1440 === 0) {
      return translator.translatePlural(
        { one: "Read every day", other: "Read every {{count}} days" },
        minutes / 1440,
      );
    }

    if (minutes >= 60 && minutes % 60 === 0) {
      return translator.translatePlural(
        { one: "Read every hour", other: "Read every {{count}} hours" },
        minutes / 60,
      );
    }

    return translator.translatePlural(
      { one: "Read every minute", other: "Read every {{count}} minutes" },
      minutes,
    );
  };

  if (
    !isLoaded ||
    !shouldShowRecommendedLists({
      listUrls,
      hasAddedHere,
      hasError: Boolean(error),
    })
  ) {
    return <></>;
  }

  return (
    <Card
      title="Free Lists"
      description="Start with a free blocklist. Adding one creates a list feed: OneUptime downloads the list on its schedule and watches your security events for what it holds."
    >
      <div
        className="space-y-4"
        data-testid={THREAT_INTEL_RECOMMENDED_LISTS_ID}
        data-loaded={isLoaded ? "true" : "false"}
      >
        {error ? <ErrorMessage message={error} /> : <></>}

        <ul className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          {RECOMMENDED_THREAT_INTEL_LISTS.map(
            (list: RecommendedThreatIntelList): ReactElement => {
              const text: ThreatIntelSourceText =
                getRecommendedThreatIntelListText(list);
              const isAdded: boolean = isRecommendedListAdded(list, listUrls);
              const isAdding: boolean = addingId === list.id;

              return (
                <li
                  key={list.id}
                  className="flex min-w-0 flex-col rounded-lg border border-gray-200 bg-white p-4"
                  data-testid={`threat-intel-list-${list.id}`}
                >
                  <div className="flex min-w-0 items-start gap-2.5">
                    <div
                      aria-hidden="true"
                      className="mt-0.5 flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-md bg-gray-100 text-gray-500"
                    >
                      <Icon icon={IconProp.ShieldCheck} className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <p className="text-sm font-semibold text-gray-900">
                        {translator.translateText(text.title)}
                      </p>
                      {/*
                       * Who publishes it, how often it is read and its terms,
                       * on one line that wraps as text: the tile's foot holds
                       * only its one action, so every tile ends alike in
                       * every language.
                       */}
                      <div
                        className="text-xs text-gray-500"
                        data-testid={`threat-intel-list-about-${list.id}`}
                      >
                        {/* A publisher's name is a name, never translated. */}
                        {list.provider}
                        {" · "}
                        {everyHour(list.pollIntervalInMinutes)}
                        {" · "}
                        <Link
                          to={URL.fromString(list.termsUrl)}
                          openInNewTab={true}
                          className="inline-flex items-center gap-0.5 rounded font-medium text-gray-600 hover:text-indigo-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                        >
                          {translator.translateText("Terms")}
                          <Icon
                            icon={IconProp.ExternalLink}
                            className="h-3 w-3"
                          />
                          <span className="sr-only">
                            {" "}
                            {translator.translateText("(opens in a new tab)")}
                          </span>
                        </Link>
                      </div>
                    </div>
                  </div>
                  <p className="mt-2 flex-1 text-sm text-gray-600">
                    {translator.translateText(text.description)}
                  </p>
                  {/* As a Rule Library card ends: Added on the left, the action on the right. */}
                  <div className="mt-4 flex min-h-[2rem] flex-wrap items-center justify-end gap-2">
                    {isAdded ? (
                      <div
                        className="mr-auto inline-flex items-center gap-1 text-sm font-medium text-emerald-700"
                        data-testid={`threat-intel-list-added-${list.id}`}
                      >
                        <Icon icon={IconProp.Check} className="h-4 w-4" />
                        {translator.translateText("Added")}
                      </div>
                    ) : (
                      <Button
                        title="Add List"
                        icon={IconProp.Add}
                        buttonStyle={ButtonStyleType.NORMAL}
                        buttonSize={ButtonSize.Small}
                        isLoading={isAdding}
                        disabled={!createGate.isAllowed || addingId !== null}
                        tooltip={
                          createGate.isAllowed
                            ? undefined
                            : createGate.disabledReason
                        }
                        dataTestId={`threat-intel-list-add-${list.id}`}
                        onClick={() => {
                          void addList(list);
                        }}
                      />
                    )}
                  </div>
                </li>
              );
            },
          )}
        </ul>
      </div>
    </Card>
  );
};

export default ThreatIntelRecommendedLists;
