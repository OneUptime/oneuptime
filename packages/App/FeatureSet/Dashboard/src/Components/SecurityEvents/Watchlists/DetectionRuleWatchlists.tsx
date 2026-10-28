import {
  CREATE_WATCHLIST_LINK,
  RULE_READS_WATCHLISTS,
  RULE_WATCHLIST_MISSING,
  WATCHLISTS_TEST_IDS,
} from "./WatchlistsCopy";
import { describeWatchlistValues } from "./WatchlistsModel";
import PageMap from "../../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../../Utils/RouteMap";
import SecurityWatchlist from "Common/Models/DatabaseModels/SecurityWatchlist";
import Route from "Common/Types/API/Route";
import ListResult from "Common/Types/BaseDatabase/ListResult";
import { LIMIT_PER_PROJECT } from "Common/Types/Database/LimitMax";
import { getSecurityWatchlistNameKey } from "Common/Types/SecurityEvent/SecurityWatchlist";
import {
  SigmaWatchlistReference,
  readDetectionRuleWatchlistReferences,
} from "Common/Utils/SecurityEvent/Sigma/SigmaWatchlists";
import Link from "Common/UI/Components/Link/Link";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useMemo,
  useState,
} from "react";

export interface ComponentProps {
  // The rule's YAML as the form holds it.
  sigmaRuleYaml: unknown;
}

// The project's lists by name key, as the line reads them.
type WatchlistsByKey = Map<string, SecurityWatchlist>;

/*
 * READS WATCHLISTS, under a rule's YAML: the lists the rule names
 * (`field|expand: '%vip_users%'`) as it is typed, each with what it holds
 * now - "vip_users (12 values)" - and a link to it; a name the project has
 * no list of says so in red, with the way to make it, before the save
 * refuses it. Nothing is drawn for a rule that names none.
 *
 * The project's lists are read once, when the form opens.
 */
const DetectionRuleWatchlists: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [watchlists, setWatchlists] = useState<WatchlistsByKey | null>(null);

  const references: Array<SigmaWatchlistReference> = useMemo(() => {
    return readDetectionRuleWatchlistReferences(props.sigmaRuleYaml);
  }, [props.sigmaRuleYaml]);

  const hasReferences: boolean = references.length > 0;

  useEffect(() => {
    // Read once a rule first names a list; a rule that names none reads nothing.
    if (!hasReferences || watchlists !== null) {
      return () => {};
    }

    let isCurrent: boolean = true;

    const read: () => Promise<void> = async (): Promise<void> => {
      try {
        const result: ListResult<SecurityWatchlist> =
          await ModelAPI.getList<SecurityWatchlist>({
            modelType: SecurityWatchlist,
            query: { projectId: ProjectUtil.getCurrentProjectId()! },
            select: {
              _id: true,
              name: true,
              source: true,
              valueCount: true,
              threatIntelFeedId: true,
            },
            sort: {},
            skip: 0,
            limit: LIMIT_PER_PROJECT,
          });

        if (isCurrent) {
          setWatchlists(
            new Map(
              result.data.map(
                (watchlist: SecurityWatchlist): [string, SecurityWatchlist] => {
                  return [getSecurityWatchlistNameKey(watchlist.name), watchlist];
                },
              ),
            ),
          );
        }
      } catch {
        // Lists that cannot be read are not called missing: the line waits for the save to say.
        if (isCurrent) {
          setWatchlists(null);
        }
      }
    };

    void read();

    return () => {
      isCurrent = false;
    };
  }, [hasReferences]);

  if (!hasReferences || watchlists === null) {
    return <></>;
  }

  const listsRoute: Route = RouteUtil.populateRouteParams(
    RouteMap[PageMap.SECURITY_EVENTS_WATCHLISTS] as Route,
  );

  return (
    <div
      className="mt-2 flex flex-wrap items-baseline gap-x-2 gap-y-1 text-xs text-gray-600"
      data-testid={WATCHLISTS_TEST_IDS.ruleWatchlists}
    >
      <span className="font-medium text-gray-700">
        {translator.translateText(RULE_READS_WATCHLISTS)}
      </span>
      {references.map(
        (reference: SigmaWatchlistReference, index: number): ReactElement => {
          const watchlist: SecurityWatchlist | undefined = watchlists.get(
            reference.key,
          );

          return (
            <Fragment key={reference.key}>
              {index > 0 ? <span aria-hidden="true">·</span> : <></>}
              {watchlist && watchlist.id ? (
                <span
                  data-testid={WATCHLISTS_TEST_IDS.ruleWatchlist}
                  className="inline-flex items-baseline gap-1"
                >
                  <Link
                    to={RouteUtil.populateRouteParams(
                      RouteMap[PageMap.SECURITY_EVENTS_WATCHLIST_VIEW] as Route,
                      { modelId: watchlist.id },
                    )}
                    openInNewTab={true}
                    className="font-medium text-indigo-600 hover:text-indigo-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-indigo-500"
                  >
                    <bdi dir="ltr" className="font-mono">
                      {watchlist.name}
                    </bdi>
                  </Link>
                  <span className="text-gray-500">
                    (
                    {describeWatchlistValues(translator, {
                      source: watchlist.source,
                      valueCount: watchlist.valueCount,
                      threatIntelFeedId: watchlist.threatIntelFeedId,
                    })}
                    )
                  </span>
                </span>
              ) : (
                <span
                  data-testid={WATCHLISTS_TEST_IDS.ruleWatchlist}
                  data-missing="true"
                  className="inline-flex items-baseline gap-1 text-red-600"
                >
                  <span>
                    <TranslatedSentence
                      template={RULE_WATCHLIST_MISSING}
                      slots={{
                        name: (
                          <bdi dir="ltr" className="font-mono">
                            {reference.name}
                          </bdi>
                        ),
                      }}
                    />
                  </span>
                  <Link
                    to={listsRoute}
                    openInNewTab={true}
                    className="font-medium underline hover:text-red-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-red-500"
                  >
                    {translator.translateText(CREATE_WATCHLIST_LINK)}
                  </Link>
                </span>
              )}
            </Fragment>
          );
        },
      )}
    </div>
  );
};

export default DetectionRuleWatchlists;
