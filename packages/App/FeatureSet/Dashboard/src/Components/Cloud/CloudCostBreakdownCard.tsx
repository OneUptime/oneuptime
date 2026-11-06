import Route from "Common/Types/API/Route";
import { CloudCostState, CloudCostTagKey } from "Common/Types/Cloud/CloudCost";
import {
  CloudProvider,
  getManagedCloudPlatformLabel,
} from "Common/Types/Cloud/CloudPlatform";
import OneUptimeDate from "Common/Types/Date";
import IconProp from "Common/Types/Icon/IconProp";
import ObjectID from "Common/Types/ObjectID";
import Card from "Common/UI/Components/Card/Card";
import Dropdown, {
  DropdownOption,
  DropdownValue,
} from "Common/UI/Components/Dropdown/Dropdown";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import FilterButtons from "Common/UI/Components/FilterButtons/FilterButtons";
import Icon from "Common/UI/Components/Icon/Icon";
import API from "Common/UI/Utils/API/API";
import {
  PluralTemplate,
  Translator,
  translationKey,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  FunctionComponent,
  ReactElement,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import RankedBars, { RankedBarItem } from "../SecurityOverview/RankedBars";
import {
  BREAKDOWN_REST_LABELS,
  CLOUD_COST_DIMENSION_OPTIONS,
  CLOUD_COST_PERIOD_OPTIONS,
  CloudCostPeriod,
  CloudCostShareLabel,
  getCloudCostPeriodWindow,
  getCloudCostShareLabel,
} from "./CloudCostBreakdown";
import {
  CloudCostBreakdownResult,
  CloudCostDimension,
  CloudCostPlatformLists,
  CloudCostRest,
  CloudCostScope,
  CloudCostShare,
  fetchCloudCostBreakdown,
  fetchCloudCostPlatformLists,
  mergeCloudCostTagKeys,
} from "./CloudCostReads";
import { READ_THE_GUIDE } from "./CloudCostSetupSteps";
import {
  COST_STATE_LABELS,
  RESOURCE_COSTS_DOCS_PATH,
  formatCloudMoney,
} from "./CloudCostWords";
import { cloudConnectionDocsUrl } from "./Connect/CloudConnectApi";
import { CloudAccountRow } from "./UseCloudAccounts";

/*
 * WHERE THE MONEY GOES: what cost the most in a period - this month, last
 * month or the last 30 days - by service, Region, account or resource; by
 * App Platforms environment or app; or by a tag's value. A breakdown by a
 * column lists the whole period's spend. One by environment, app or tag
 * lists only those, and says under the list what the rest came to - what
 * is in no environment, what an environment is billed that is no one
 * app's, or what does not carry the tag - so its rows never read as the
 * period's whole.
 */

export const BREAKDOWN_TITLE: string = translationKey("Where the money goes");
export const BREAKDOWN_DESCRIPTION: string = translationKey(
  "What cost the most: by service, Region, account or resource, by App Platforms environment or app, or by tag.",
);
// On an account's own Costs, which has no Accounts choice.
export const BREAKDOWN_DESCRIPTION_ONE_ACCOUNT: string = translationKey(
  "What cost the most: by service, Region or resource, by App Platforms environment or app, or by tag.",
);
export const BREAKDOWN_EMPTY: string = translationKey(
  "Nothing cost anything in this period.",
);
export const BREAKDOWN_TOTAL: string = translationKey("{{amount}} in all");
/*
 * Under the breakdown by resource, while an AWS account's costs are read
 * without their resources (its connection's Costs per resource is off):
 * why its spend is not billed to one, and the guide to turning it on.
 */
export const BREAKDOWN_RESOURCES_NOTE: string = translationKey(
  "Azure and Google Cloud name the resource each cost is for. AWS does once Costs per resource is turned on in its connection's settings.",
);
/*
 * The AWS accounts whose costs per resource could not be read, each with
 * its state and why, as its cloud said it.
 */
export const BREAKDOWN_RESOURCES_NOT_READ_TITLE: string = translationKey(
  "Costs per resource are not read for these accounts:",
);
export const BREAKDOWN_RESOURCES_NOT_READ: string = translationKey(
  "{{account}} · {{state}}",
);
export const BREAKDOWN_SHOWN: number = 10;
export const SHOW_ALL_SHARES: PluralTemplate = {
  one: "Show {{count}} more",
  other: "Show {{count}} more",
};
export const SHOW_FEWER_SHARES: string = translationKey("Show less");

// By environment or app, before any is in these accounts.
export const ENVIRONMENTS_EMPTY: string = translationKey(
  "No App Platforms environment is in these accounts yet.",
);
export const ENVIRONMENTS_NONE_COST: string = translationKey(
  "No App Platforms environment cost anything in this period.",
);
export const APPS_NONE_COST: string = translationKey(
  "No app is billed on its own in this period.",
);
export const APPS_NOTE: string = translationKey(
  "An app's cost is what its platform bills it by name. Amazon ECS bills its tasks and App Service its plans, so their apps' costs stay their environment's.",
);

/*
 * By tag: the key whose values the list is by ("team", "env"). "Tag key",
 * not "Tag", which some languages word as a mark or an HTML tag.
 */
export const TAG_PICKER_LABEL: string = translationKey("Tag key");
export const TAGS_EMPTY: string = translationKey("No costs carry tags yet.");
// Under the breakdown by tag: why a cost carries an old value of a tag.
export const TAGS_NOTE: string = translationKey(
  "Each cost keeps the tags it had when it was read.",
);
/*
 * After it, while an AWS account's costs are read without their resources:
 * an AWS cost carries the tags of the resource it is billed to, so none
 * without Costs per resource.
 */
export const TAGS_AWS_NOTE: string = translationKey(
  "AWS costs carry tags once Costs per resource is turned on in their connection's settings.",
);
export const TAG_VALUE_NONE_COST: string = translationKey(
  "Nothing that carries this tag cost anything in this period.",
);

export interface ComponentProps {
  scope: Omit<CloudCostScope, "startDate" | "endDate">;
  accounts: Array<CloudAccountRow>;
  // One account's: the breakdown by account is left out.
  isOneAccount: boolean;
}

/*
 * The environments of the accounts a page is over - by their accounts' ids
 * in their clouds - and every app (an app is found by its environment).
 */
export function scopeCloudCostPlatformLists(data: {
  lists: CloudCostPlatformLists;
  accounts: Array<CloudAccountRow>;
}): CloudCostPlatformLists {
  const accountIds: Set<string> = new Set<string>(
    data.accounts.map((account: CloudAccountRow): string => {
      return account.accountId.trim().toLowerCase();
    }),
  );

  return {
    environments: data.lists.environments.filter(
      (environment: { accountId: string }): boolean => {
        return accountIds.has(environment.accountId.trim().toLowerCase());
      },
    ),
    apps: data.lists.apps,
  };
}

// What a breakdown's empty list says, by what it breaks down by.
export function getCloudCostBreakdownEmptyText(data: {
  dimension: CloudCostDimension;
  hasEnvironments: boolean;
  hasTagKeys: boolean;
}): string {
  if (data.dimension === "environment" || data.dimension === "app") {
    if (!data.hasEnvironments) {
      return ENVIRONMENTS_EMPTY;
    }

    return data.dimension === "app" ? APPS_NONE_COST : ENVIRONMENTS_NONE_COST;
  }

  if (data.dimension === "tag") {
    return data.hasTagKeys ? TAG_VALUE_NONE_COST : TAGS_EMPTY;
  }

  return BREAKDOWN_EMPTY;
}

/*
 * Whether an AWS account's costs are read without their resources: its
 * connection's Costs per resource is off, as a summary with no word on
 * resources says (CloudAccountCostSummary.resources). Only then do the
 * breakdowns by resource and by tag say how AWS names them - an account
 * that reads them, or says why it cannot, needs no such word, and Azure
 * and Google Cloud name every resource anyway.
 */
export function hasAwsCostsWithoutResources(
  accounts: Array<CloudAccountRow>,
): boolean {
  return accounts.some((account: CloudAccountRow): boolean => {
    return (
      account.provider === CloudProvider.AWS &&
      account.costSummary?.state === CloudCostState.Reading &&
      !account.costSummary.resources
    );
  });
}

const CloudCostBreakdownCard: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [dimension, setDimension] = useState<CloudCostDimension>("service");
  const [period, setPeriod] = useState<CloudCostPeriod>(
    CloudCostPeriod.ThisMonth,
  );
  const [tagKey, setTagKey] = useState<string>("");
  const [result, setResult] = useState<CloudCostBreakdownResult | null>(null);
  const [lists, setLists] = useState<CloudCostPlatformLists | null>(null);
  const [error, setError] = useState<string>("");
  const [attempt, setAttempt] = useState<number>(0);
  const [showAll, setShowAll] = useState<boolean>(false);
  const scopeKey: string = JSON.stringify(props.scope);

  const accountNames: Map<string, string> = useMemo((): Map<string, string> => {
    return new Map(
      props.accounts.map((account: CloudAccountRow): [string, string] => {
        return [account.id.toString(), account.name || account.accountId];
      }),
    );
  }, [props.accounts]);

  // The tags the accounts' costs carry, the costliest first.
  const tagKeys: Array<CloudCostTagKey> = useMemo(():
    | Array<CloudCostTagKey>
    | never => {
    return mergeCloudCostTagKeys({
      summaries: props.accounts.map((account: CloudAccountRow) => {
        return account.costSummary;
      }),
      currency: props.scope.currency,
    });
  }, [props.accounts, props.scope.currency]);

  // The tag broken down by: the one picked, else the costliest.
  const activeTagKey: string = tagKeys.some((entry: CloudCostTagKey) => {
    return entry.key === tagKey;
  })
    ? tagKey
    : tagKeys[0]?.key || "";

  // The accounts' environments, by their accounts' ids in their clouds.
  const scopedLists: CloudCostPlatformLists | null =
    useMemo((): CloudCostPlatformLists | null => {
      return lists
        ? scopeCloudCostPlatformLists({ lists, accounts: props.accounts })
        : null;
    }, [lists, props.accounts]);

  const needsLists: boolean =
    dimension === "environment" || dimension === "app";

  useEffect(() => {
    let ignore: boolean = false;
    const window: { start: Date; end: Date } = getCloudCostPeriodWindow(
      period,
      OneUptimeDate.getCurrentDate(),
    );

    setResult(null);
    setError("");
    setShowAll(false);

    const read: () => Promise<CloudCostBreakdownResult> =
      async (): Promise<CloudCostBreakdownResult> => {
        if (dimension === "tag" && !activeTagKey) {
          return { shares: [], rest: [], total: 0 };
        }

        let platformLists: CloudCostPlatformLists | undefined = undefined;

        if (needsLists) {
          const fetched: CloudCostPlatformLists =
            lists || (await fetchCloudCostPlatformLists());

          if (!lists && !ignore) {
            setLists(fetched);
          }

          platformLists = scopeCloudCostPlatformLists({
            lists: fetched,
            accounts: props.accounts,
          });
        }

        return await fetchCloudCostBreakdown({
          scope: {
            ...props.scope,
            startDate: window.start,
            endDate: window.end,
          },
          dimension,
          tagKey: activeTagKey,
          lists: platformLists,
        });
      };

    read()
      .then((found: CloudCostBreakdownResult): void => {
        if (!ignore) {
          setResult(found);
        }
      })
      .catch((err: Error): void => {
        if (!ignore) {
          setError(API.getFriendlyMessage(err));
        }
      });

    return (): void => {
      ignore = true;
    };
  }, [scopeKey, dimension, period, activeTagKey, attempt]);

  const money: (amount: number) => string = useCallback(
    (amount: number): string => {
      return formatCloudMoney({
        amount,
        currency: props.scope.currency,
        translator,
      });
    },
    [props.scope.currency, translator],
  );

  const environmentsById: Map<
    string,
    CloudCostPlatformLists["environments"][number]
  > = useMemo((): Map<
    string,
    CloudCostPlatformLists["environments"][number]
  > => {
    return new Map(
      (scopedLists?.environments || []).map(
        (
          environment: CloudCostPlatformLists["environments"][number],
        ): [string, CloudCostPlatformLists["environments"][number]] => {
          return [environment.id, environment];
        },
      ),
    );
  }, [scopedLists]);

  const appsById: Map<string, CloudCostPlatformLists["apps"][number]> =
    useMemo((): Map<string, CloudCostPlatformLists["apps"][number]> => {
      return new Map(
        (scopedLists?.apps || []).map(
          (
            app: CloudCostPlatformLists["apps"][number],
          ): [string, CloudCostPlatformLists["apps"][number]] => {
            return [app.id, app];
          },
        ),
      );
    }, [scopedLists]);

  const shares: Array<CloudCostShare> = result?.shares || [];
  const hidden: number = shares.length - BREAKDOWN_SHOWN;
  const shown: Array<CloudCostShare> =
    showAll || hidden <= 0 ? shares : shares.slice(0, BREAKDOWN_SHOWN);

  // One row of the list: its name, what it is, and where it opens.
  const toItem: (share: CloudCostShare) => RankedBarItem = (
    share: CloudCostShare,
  ): RankedBarItem => {
    const base: Pick<RankedBarItem, "key" | "count" | "countText"> = {
      key: share.key || "none",
      count: share.amount,
      countText: money(share.amount),
    };

    if (dimension === "environment") {
      const environment:
        | CloudCostPlatformLists["environments"][number]
        | undefined = environmentsById.get(share.key);
      const name: string = environment?.name || share.key;

      return {
        ...base,
        label: <bdi>{name}</bdi>,
        title: name,
        hint: environment
          ? getManagedCloudPlatformLabel(environment.platform)
          : undefined,
        to: environment
          ? RouteUtil.populateRouteParams(
              RouteMap[PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW] as Route,
              { modelId: new ObjectID(environment.id) },
            )
          : undefined,
      };
    }

    if (dimension === "app") {
      const app: CloudCostPlatformLists["apps"][number] | undefined =
        appsById.get(share.key);
      const environment:
        | CloudCostPlatformLists["environments"][number]
        | undefined = app ? environmentsById.get(app.environmentId) : undefined;
      const name: string = app?.name || share.key;

      return {
        ...base,
        label: <bdi>{name}</bdi>,
        title: name,
        hint: environment?.name,
        to:
          app && environment
            ? RouteUtil.populateRouteParams(
                RouteMap[
                  PageMap.APP_PLATFORMS_ENVIRONMENT_VIEW_APP_DETAIL
                ] as Route,
                {
                  modelId: new ObjectID(environment.id),
                  subModelId: new ObjectID(app.id),
                },
              )
            : undefined,
      };
    }

    if (dimension === "tag") {
      // A tag's value as its cloud writes it.
      return { ...base, label: <bdi>{share.key}</bdi>, title: share.key };
    }

    const label: CloudCostShareLabel = getCloudCostShareLabel({
      dimension,
      key: share.key,
      accountNames,
    });
    const text: string = label.isAsWritten
      ? label.label
      : translator.translateText(label.label) || label.label;

    return {
      ...base,
      label: <bdi>{text}</bdi>,
      title: label.title || text,
      to:
        dimension === "cloudAccountId" && accountNames.has(share.key)
          ? RouteUtil.populateRouteParams(
              RouteMap[PageMap.CLOUD_ACCOUNT_VIEW_COSTS] as Route,
              { modelId: new ObjectID(share.key) },
            )
          : undefined,
    };
  };

  // The AWS accounts whose costs per resource could not be read, with why.
  const resourcesNotRead: Array<CloudAccountRow> = props.accounts.filter(
    (account: CloudAccountRow): boolean => {
      const status: { state: CloudCostState } | undefined =
        account.costSummary?.resources;
      return Boolean(status && status.state !== CloudCostState.Reading);
    },
  );

  // An AWS account whose costs are read without their resources: say how.
  const isAwsWithoutResources: boolean = hasAwsCostsWithoutResources(
    props.accounts,
  );

  // Where turning on AWS's costs per resource is explained.
  const guideLink: ReactElement = (
    <a
      href={cloudConnectionDocsUrl(RESOURCE_COSTS_DOCS_PATH).toString()}
      target="_blank"
      rel="noopener noreferrer"
      className="whitespace-nowrap font-medium text-indigo-600 hover:text-indigo-700"
      data-testid="cloud-cost-breakdown-resources-guide"
    >
      {translator.translateText(READ_THE_GUIDE)}
    </a>
  );

  const tagOptions: Array<DropdownOption> = tagKeys.map(
    (entry: CloudCostTagKey): DropdownOption => {
      // A tag's key as its cloud writes it, never looked up as a word.
      return { value: entry.key, label: entry.key, isUserContent: true };
    },
  );

  return (
    <Card
      title={BREAKDOWN_TITLE}
      description={
        props.isOneAccount
          ? BREAKDOWN_DESCRIPTION_ONE_ACCOUNT
          : BREAKDOWN_DESCRIPTION
      }
    >
      <div data-testid="cloud-cost-breakdown" data-dimension={dimension}>
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          {/*
           * Each group wraps inside the card: the choices are wider than a
           * phone, and wider still in German.
           */}
          <FilterButtons
            ariaLabel="Break down by"
            className="flex-wrap"
            dataTestId="cloud-cost-breakdown-dimension"
            options={CLOUD_COST_DIMENSION_OPTIONS.filter(
              (option: { value: CloudCostDimension }): boolean => {
                return !props.isOneAccount || option.value !== "cloudAccountId";
              },
            )}
            selectedValue={dimension}
            onSelect={(value: string) => {
              setDimension(value as CloudCostDimension);
            }}
          />
          <FilterButtons
            ariaLabel="Period"
            className="flex-wrap"
            dataTestId="cloud-cost-breakdown-period"
            options={CLOUD_COST_PERIOD_OPTIONS}
            selectedValue={period}
            onSelect={(value: string) => {
              setPeriod(value as CloudCostPeriod);
            }}
          />
        </div>
        {dimension === "tag" && tagOptions.length > 0 ? (
          <div
            className="mb-4 flex flex-wrap items-center gap-2"
            data-testid="cloud-cost-breakdown-tag"
          >
            <span className="text-xs font-medium text-gray-600">
              {translator.translateText(TAG_PICKER_LABEL)}
            </span>
            <div className="w-full min-w-0 sm:w-72">
              <Dropdown
                ariaLabel={TAG_PICKER_LABEL}
                dataTestId="cloud-cost-breakdown-tag-picker"
                options={tagOptions}
                value={tagOptions.find((option: DropdownOption): boolean => {
                  return option.value === activeTagKey;
                })}
                isClearable={false}
                onChange={(
                  value: DropdownValue | Array<DropdownValue> | null,
                ) => {
                  if (typeof value === "string" && value) {
                    setTagKey(value);
                  }
                }}
              />
            </div>
          </div>
        ) : (
          <></>
        )}
        {error ? (
          <ErrorMessage
            message={error}
            onRefreshClick={() => {
              setAttempt(attempt + 1);
            }}
          />
        ) : result === null ? (
          <div
            className="h-40 w-full animate-pulse rounded-md bg-gray-50"
            data-testid="cloud-cost-breakdown-loading"
          />
        ) : (
          <>
            {result.total !== 0 &&
            (shares.length > 0 || result.rest.length > 0) ? (
              <div
                className="mb-3 text-sm text-gray-600"
                data-testid="cloud-cost-breakdown-total"
              >
                {translator.translateTemplate(BREAKDOWN_TOTAL, {
                  amount: money(result.total),
                })}
              </div>
            ) : (
              <></>
            )}
            <RankedBars
              emptyText={getCloudCostBreakdownEmptyText({
                dimension,
                hasEnvironments: (scopedLists?.environments.length || 0) > 0,
                hasTagKeys: tagKeys.length > 0,
              })}
              items={shown.map(toItem)}
            />
            {hidden > 0 ? (
              <button
                type="button"
                aria-expanded={showAll}
                data-testid="cloud-cost-breakdown-toggle"
                className="-ms-2 mt-3 inline-flex items-center gap-1 rounded-md px-2 py-1 text-xs font-medium text-indigo-600 transition-colors hover:bg-indigo-50 hover:text-indigo-700"
                onClick={() => {
                  setShowAll(!showAll);
                }}
              >
                <Icon
                  icon={showAll ? IconProp.ChevronUp : IconProp.ChevronDown}
                  className="h-3 w-3"
                />
                <span>
                  {showAll
                    ? translator.translateText(SHOW_FEWER_SHARES)
                    : translator.translatePlural(SHOW_ALL_SHARES, hidden)}
                </span>
              </button>
            ) : (
              <></>
            )}
            {result.rest.length > 0 ? (
              <ul
                className="mt-4 space-y-1 border-t border-gray-100 pt-3"
                data-testid="cloud-cost-breakdown-rest"
              >
                {result.rest.map((rest: CloudCostRest): ReactElement => {
                  return (
                    <li
                      key={rest.kind}
                      className="text-xs text-gray-600"
                      data-testid="cloud-cost-breakdown-rest-line"
                      data-kind={rest.kind}
                    >
                      {translator.translateTemplate(
                        BREAKDOWN_REST_LABELS[rest.kind],
                        { amount: money(rest.amount) },
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <></>
            )}
            {dimension === "resourceId" &&
            (isAwsWithoutResources || resourcesNotRead.length > 0) ? (
              <div
                className="mt-4 space-y-3 text-xs text-gray-500"
                data-testid="cloud-cost-breakdown-resources-help"
              >
                {isAwsWithoutResources ? (
                  <p data-testid="cloud-cost-breakdown-resources-note">
                    {translator.translateText(BREAKDOWN_RESOURCES_NOTE)}
                    {resourcesNotRead.length === 0 ? <> {guideLink}</> : <></>}
                  </p>
                ) : (
                  <></>
                )}
                {resourcesNotRead.length > 0 ? (
                  <div data-testid="cloud-cost-breakdown-resources-not-read">
                    <p className="font-medium text-gray-700">
                      {translator.translateText(
                        BREAKDOWN_RESOURCES_NOT_READ_TITLE,
                      )}
                    </p>
                    <ul className="mt-1 space-y-2">
                      {resourcesNotRead.map(
                        (account: CloudAccountRow): ReactElement => {
                          const status: {
                            state: CloudCostState;
                            message?: string | undefined;
                          } = account.costSummary!.resources!;

                          return (
                            <li
                              key={account.id.toString()}
                              className="break-words"
                              data-testid="cloud-cost-breakdown-resources-not-read-account"
                            >
                              <p className="text-gray-700">
                                {translator.translateTemplate(
                                  BREAKDOWN_RESOURCES_NOT_READ,
                                  {
                                    account: account.name || account.accountId,
                                    state:
                                      translator.translateText(
                                        COST_STATE_LABELS[status.state],
                                      ) || COST_STATE_LABELS[status.state],
                                  },
                                )}
                              </p>
                              {status.message ? (
                                /*
                                 * The cloud's own words, as it wrote them:
                                 * a line of their own in their own
                                 * direction, so a page read right to left
                                 * never runs them into the state above.
                                 */
                                <p
                                  dir="auto"
                                  className="line-clamp-3 break-words"
                                  data-testid="cloud-cost-breakdown-resources-not-read-message"
                                >
                                  {status.message}
                                </p>
                              ) : (
                                <></>
                              )}
                            </li>
                          );
                        },
                      )}
                    </ul>
                    <p className="mt-2">{guideLink}</p>
                  </div>
                ) : (
                  <></>
                )}
              </div>
            ) : dimension === "app" ? (
              <p className="mt-4 text-xs text-gray-500">
                {translator.translateText(APPS_NOTE)}
              </p>
            ) : dimension === "tag" ? (
              <p
                className="mt-4 text-xs text-gray-500"
                data-testid="cloud-cost-breakdown-tags-note"
              >
                {translator.translateText(TAGS_NOTE)}
                {isAwsWithoutResources ? (
                  <>
                    {" "}
                    {translator.translateText(TAGS_AWS_NOTE)} {guideLink}
                  </>
                ) : (
                  <></>
                )}
              </p>
            ) : (
              <></>
            )}
          </>
        )}
      </div>
    </Card>
  );
};

export default CloudCostBreakdownCard;
