import AppLink from "../AppLink/AppLink";
import { ResourceOwnerEntry } from "../ResourceOwners/OwnerEntry";
import { formatOverdue } from "./DataObservabilityFormat";
import {
  AttentionKindCopy,
  AttentionTone,
  DATA_ATTENTION_COPY,
  getAlertRoute,
  getAttentionOwnersRoute,
  getAttentionRoute,
  getStoreAlertsRoute,
  isLateKind,
} from "./OverviewAttention";
import useAttentionOwners, {
  AttentionOwners,
  getAttentionOwnerKey,
} from "./useAttentionOwners";
import OneUptimeDate from "Common/Types/Date";
import { DataAttentionItem } from "Common/Types/DataObservability/DataObservabilityAttention";
import { DataObservabilityStoreSummary } from "Common/Types/DataObservability/DataObservabilityApiTypes";
import IconProp from "Common/Types/Icon/IconProp";
import Card from "Common/UI/Components/Card/Card";
import Icon from "Common/UI/Components/Icon/Icon";
import IsolatedText from "Common/UI/Components/IsolatedText/IsolatedText";
import IsolatedTextList from "Common/UI/Components/IsolatedText/IsolatedTextList";
import {
  Translator,
  getInlineSeparator,
} from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * NEEDS ATTENTION: THE STATE OF THE DATA, FIRST.
 *
 * What is broken, late or drifting now, worst first, each with what it
 * means for the data in a sentence, the error its run gave, who owns it,
 * whether anyone has been told (its open alert) - or that nobody will be,
 * as its database's alerts are off - and the one page where it is put
 * right. With nothing to say, it says what was looked at and found well.
 */

export const NEEDS_ATTENTION_TEST_ID: string =
  "data-observability-needs-attention";
export const ATTENTION_ITEM_TEST_ID: string =
  "data-observability-attention-item";
export const ATTENTION_OWNERS_TEST_ID: string =
  "data-observability-attention-owners";

// The most owners named on one item: the rest are counted.
export const MAX_OWNER_NAMES: number = 3;

// An owner as a person reads them: a name, written out - who to ask, at a glance.
function getOwnerName(
  entry: ResourceOwnerEntry,
  translator: Translator,
): string {
  if (entry.kind === "user") {
    return (
      entry.user.name?.toString() ||
      entry.user.email?.toString() ||
      translator.translateText("User") ||
      "User"
    );
  }

  return (
    entry.team.name?.toString() || translator.translateText("Team") || "Team"
  );
}

export interface ComponentProps {
  items: Array<DataAttentionItem>;
  // How many there are in all: more than are listed, on a busy project.
  totalCount: number;
  stores: Array<DataObservabilityStoreSummary>;
}

function toneClasses(tone: AttentionTone): { icon: string; pill: string } {
  return tone === AttentionTone.Danger
    ? {
        icon: "bg-red-50 text-red-600",
        pill: "bg-red-50 text-red-700 ring-red-600/20",
      }
    : {
        icon: "bg-amber-50 text-amber-600",
        pill: "bg-amber-50 text-amber-800 ring-amber-600/20",
      };
}

const OverviewNeedsAttention: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  // What sets one fact off from the next in the reader's language: "·", or "•" in Persian.
  const separator: string = getInlineSeparator(translator.language).trim();
  const owners: AttentionOwners = useAttentionOwners(props.items);
  const storeById: Map<string, DataObservabilityStoreSummary> = new Map(
    props.stores.map(
      (
        store: DataObservabilityStoreSummary,
      ): [string, DataObservabilityStoreSummary] => {
        return [store.dataStoreId, store];
      },
    ),
  );

  const description: string | undefined =
    props.totalCount === 0
      ? translator.translateText("Nothing is broken or late right now.")
      : props.totalCount > props.items.length
        ? translator.translateTemplate(
            "The {{shown}} most urgent of {{count}}, worst first: what failed, then what is late.",
            {
              shown: translator.formatNumber(props.items.length),
              count: translator.formatNumber(props.totalCount),
            },
          )
        : translator.translateText(
            "Worst first: what failed, then what is late.",
          );

  const renderOwners: (item: DataAttentionItem) => ReactElement = (
    item: DataAttentionItem,
  ): ReactElement => {
    const key: string | null = getAttentionOwnerKey(item);

    if (!key || !owners.isKnown) {
      return <></>;
    }

    const list: Array<ResourceOwnerEntry> = owners.byKey.get(key) || [];

    if (list.length > 0) {
      const names: Array<string> = list.map(
        (entry: ResourceOwnerEntry): string => {
          return getOwnerName(entry, translator);
        },
      );
      const moreCount: number = names.length - MAX_OWNER_NAMES;

      return (
        <span
          className="inline-flex min-w-0 flex-wrap items-center gap-x-1"
          data-testid={ATTENTION_OWNERS_TEST_ID}
        >
          <span className="text-gray-500">
            {translator.translateText("Owners")}
          </span>
          <IsolatedTextList
            texts={names.slice(0, MAX_OWNER_NAMES)}
            className="font-medium text-gray-700 [overflow-wrap:anywhere]"
          />
          {moreCount > 0 ? (
            <span className="text-gray-500">
              {translator.translatePlural(
                { one: "and {{count}} more", other: "and {{count}} more" },
                moreCount,
              )}
            </span>
          ) : (
            <></>
          )}
        </span>
      );
    }

    const ownersRoute: ReturnType<typeof getAttentionOwnersRoute> =
      getAttentionOwnersRoute(item);

    return (
      <span
        className="inline-flex items-center gap-1 text-gray-500"
        data-testid={ATTENTION_OWNERS_TEST_ID}
      >
        <span>{translator.translateText("No owner")}</span>
        {ownersRoute && !item.dataProductId ? (
          <>
            <span aria-hidden="true">{separator}</span>
            <AppLink
              to={ownersRoute}
              className="font-medium text-indigo-600 hover:text-indigo-700"
            >
              <span>{translator.translateText("Add one")}</span>
            </AppLink>
          </>
        ) : (
          <></>
        )}
      </span>
    );
  };

  const renderAlert: (item: DataAttentionItem) => ReactElement = (
    item: DataAttentionItem,
  ): ReactElement => {
    if (item.alert) {
      return (
        <AppLink
          to={getAlertRoute(item.alert.alertId)}
          className="inline-flex min-w-0 items-center gap-1 font-medium text-gray-700 hover:underline"
        >
          <>
            <Icon icon={IconProp.Alert} className="h-3.5 w-3.5 text-red-500" />
            <span className="truncate">
              {item.alert.number
                ? translator.translateTemplate("Alert {{number}} is open", {
                    number: item.alert.number,
                  })
                : translator.translateText("An alert is open")}
            </span>
          </>
        </AppLink>
      );
    }

    // Nobody is told of it: its database has no alert on.
    const store: DataObservabilityStoreSummary | undefined = item.dataStoreId
      ? storeById.get(item.dataStoreId)
      : undefined;

    if (store && store.alertMonitorCount === 0) {
      return (
        <span className="inline-flex flex-wrap items-center gap-1 text-gray-500">
          <span>
            {translator.translateText("Nobody is told: its alerts are off")}
          </span>
          <span aria-hidden="true">{separator}</span>
          <AppLink
            to={getStoreAlertsRoute(store.dataStoreId)}
            className="font-medium text-indigo-600 hover:text-indigo-700"
          >
            <span>{translator.translateText("Set Up Alerts")}</span>
          </AppLink>
        </span>
      );
    }

    return <></>;
  };

  return (
    <div data-testid={NEEDS_ATTENTION_TEST_ID}>
      <Card title="Needs Attention" description={description}>
        {props.items.length === 0 ? (
          <div className="flex items-start gap-3 px-6 pb-6">
            <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg bg-emerald-50 text-emerald-600">
              <Icon icon={IconProp.CheckCircle} className="h-4 w-4" />
            </div>
            <p className="text-sm text-gray-600">
              {translator.translateText(
                "Every database was read, no pipeline run failed, no check is failing, and every table is changing as often as it usually does.",
              )}
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-gray-100 px-4 pb-2 sm:px-6">
            {props.items.map(
              (item: DataAttentionItem, index: number): ReactElement => {
                const copy: AttentionKindCopy = DATA_ATTENTION_COPY[item.kind];

                // A kind a newer server sends: not told of until the page knows its words.
                if (!copy) {
                  return <React.Fragment key={index}></React.Fragment>;
                }

                const tone: { icon: string; pill: string } = toneClasses(
                  copy.tone,
                );
                const route: ReturnType<typeof getAttentionRoute> =
                  getAttentionRoute(item);
                const since: string = item.since
                  ? translator.translateTemplate(copy.caption, {
                      time: OneUptimeDate.fromNow(
                        OneUptimeDate.fromString(item.since),
                      ),
                    })
                  : "";
                return (
                  <li
                    key={`${item.kind}-${item.dataStoreId || ""}-${item.dataAssetId || ""}-${item.dataPipelineId || ""}-${item.dataCheckId || ""}-${item.dataProductId || ""}-${item.dataReconciliationId || ""}-${index}`}
                    data-testid={ATTENTION_ITEM_TEST_ID}
                    data-kind={item.kind}
                    className="flex gap-3 py-3"
                  >
                    <div
                      className={`mt-0.5 flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-lg ${tone.icon}`}
                      aria-hidden="true"
                    >
                      <Icon icon={copy.icon} className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <AppLink
                          to={route}
                          className="min-w-0 max-w-full font-medium text-gray-900 [overflow-wrap:anywhere] hover:underline"
                        >
                          <span>
                            {item.name ? (
                              <IsolatedText
                                text={item.name}
                                breaksLikeAName={true}
                              />
                            ) : (
                              translator.translateText("Unnamed")
                            )}
                          </span>
                        </AppLink>
                        <span
                          className={`inline-flex flex-shrink-0 items-center rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset ${tone.pill}`}
                        >
                          {isLateKind(item.kind) && item.overdueBySeconds > 0
                            ? formatOverdue(translator, item.overdueBySeconds)
                            : translator.translateText(copy.label)}
                        </span>
                      </div>
                      {item.where || since ? (
                        <p className="mt-0.5 text-xs text-gray-500 [overflow-wrap:anywhere]">
                          {item.where ? (
                            <IsolatedText
                              text={item.where}
                              breaksLikeAName={true}
                            />
                          ) : (
                            <></>
                          )}
                          {item.where && since ? ` ${separator} ` : ""}
                          {since}
                        </p>
                      ) : (
                        <></>
                      )}
                      <p className="mt-1 text-sm text-gray-700">
                        {translator.translateText(copy.sentence)}
                      </p>
                      {item.message ? (
                        <p className="mt-1 line-clamp-3 whitespace-pre-line font-mono text-xs text-red-700 [overflow-wrap:anywhere]">
                          <IsolatedText text={item.message} />
                        </p>
                      ) : (
                        <></>
                      )}
                      <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
                        {renderOwners(item)}
                        {renderAlert(item)}
                        <AppLink
                          to={route}
                          className="inline-flex items-center gap-1 font-medium text-indigo-600 hover:text-indigo-700"
                        >
                          <>
                            <span>
                              {translator.translateText(copy.actionTitle)}
                            </span>
                            <Icon
                              icon={IconProp.ChevronRight}
                              className="h-3.5 w-3.5"
                            />
                          </>
                        </AppLink>
                      </div>
                    </div>
                  </li>
                );
              },
            )}
          </ul>
        )}
      </Card>
    </div>
  );
};

export default OverviewNeedsAttention;
