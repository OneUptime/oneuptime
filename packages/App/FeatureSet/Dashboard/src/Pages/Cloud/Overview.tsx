import PageComponentProps from "../PageComponentProps";
import PageMap from "../../Utils/PageMap";
import RouteMap, { RouteUtil } from "../../Utils/RouteMap";
import CloudAccountsCard from "../../Components/Cloud/CloudAccountsCard";
import CloudAppPlatformsCard from "../../Components/Cloud/CloudAppPlatformsCard";
import CloudAttentionCard, {
  CLOUD_ATTENTION_READ_LIMIT,
  CloudAttention,
} from "../../Components/Cloud/CloudAttentionCard";
import {
  CloudAttentionCounts,
  getCloudOverviewTiles,
} from "../../Components/Cloud/CloudOverviewTiles";
import CloudSavingsCard from "../../Components/Cloud/CloudSavingsCard";
import CLOUD_SHOWCASE from "../../Components/Cloud/CloudShowcase";
import CloudSpendCard from "../../Components/Cloud/CloudSpendCard";
import CloudStatStrip from "../../Components/Cloud/CloudStatStrip";
import useCloudAccounts, {
  CloudAccountsRead,
} from "../../Components/Cloud/UseCloudAccounts";
import {
  ResourceAttentionCounts,
  countResourceAttention,
} from "../../Components/ResourcePart/ResourceAttention";
import ResourceShowcaseCard from "../../Components/ResourceShowcase/ResourceShowcaseCard";
import CloudConnection from "Common/Models/DatabaseModels/CloudConnection";
import CloudResource from "Common/Models/DatabaseModels/CloudResource";
import Route from "Common/Types/API/Route";
import Query from "Common/Types/BaseDatabase/Query";
import OneUptimeDate from "Common/Types/Date";
import ObjectID from "Common/Types/ObjectID";
import CardGrid from "Common/UI/Components/Card/CardGrid";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import Navigation from "Common/UI/Utils/Navigation";
import PermissionGate, {
  ModelAction,
  PermissionGateResult,
} from "Common/UI/Utils/PermissionGate";
import ProjectUtil from "Common/UI/Utils/Project";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useCallback,
  useMemo,
  useState,
} from "react";

/*
 * Cloud's Overview, the page Cloud opens on: every connected account at a
 * glance, as Kubernetes' Overview shows every cluster.
 *
 *   - The strip on top: the accounts and whether they are read, the
 *     resources in them, how many need attention now, and the month's
 *     spend against last month's by now - each a click from its list.
 *   - Needs attention: the resources whose key metrics show something
 *     wrong - failing status checks, failed requests, throttling, a disk
 *     filling up - the most urgent first, each one step from its page.
 *   - Spend and Ways to spend less, side by side: the month so far, where
 *     it is heading and the services that cost the most; what the clouds'
 *     own recommenders say could be saved, the largest first.
 *   - Accounts: each account, read or not, its resources and its spend.
 *   - App Platforms: the environments and apps that run in these accounts,
 *     one click from App Platforms, where they are.
 *
 * A project with no account yet sees what Cloud gives and the way to
 * connect one.
 */

export const CONNECT_A_CLOUD_ACCOUNT: string = translationKey(
  "Connect a cloud account",
);

const CloudOverview: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const projectId: ObjectID | null = ProjectUtil.getCurrentProjectId();
  const read: CloudAccountsRead = useCloudAccounts();
  const [attention, setAttention] = useState<CloudAttentionCounts | null>(null);
  const [attentionFailed, setAttentionFailed] = useState<boolean>(false);

  const route: (page: PageMap) => Route = (page: PageMap): Route => {
    return RouteUtil.populateRouteParams(RouteMap[page] as Route);
  };

  const attentionQuery: Query<CloudResource> =
    useMemo((): Query<CloudResource> => {
      return { projectId: projectId || undefined } as Query<CloudResource>;
    }, [projectId?.toString()]);

  const onAttentionLoaded: (found: CloudAttention) => void = useCallback(
    (found: CloudAttention): void => {
      const counts: ResourceAttentionCounts = countResourceAttention(
        found.items,
      );
      setAttention({
        unhealthy: counts.critical,
        degraded: counts.warning,
        isMore: found.total > CLOUD_ATTENTION_READ_LIMIT,
      });
      setAttentionFailed(false);
    },
    [],
  );

  const onAttentionFailed: () => void = useCallback((): void => {
    setAttentionFailed(true);
  }, []);

  if (read.isLoading && read.accounts.length === 0) {
    return <PageLoader isVisible={true} />;
  }

  if (read.error && read.accounts.length === 0) {
    return <ErrorMessage message={read.error} onRefreshClick={read.refresh} />;
  }

  // No account yet: what Cloud gives, and the way to connect one.
  if (read.accounts.length === 0) {
    const gate: PermissionGateResult = PermissionGate.check(
      new CloudConnection(),
      ModelAction.Create,
    );

    return (
      <ResourceShowcaseCard
        showcase={CLOUD_SHOWCASE}
        addButton={{
          title: CONNECT_A_CLOUD_ACCOUNT,
          disabled: !gate.isAllowed,
          tooltip: gate.disabledReason,
          onClick: () => {
            Navigation.navigate(route(PageMap.CLOUD_CONNECT));
          },
        }}
      />
    );
  }

  return (
    <Fragment>
      <CloudStatStrip
        testId="cloud-overview-strip"
        tiles={getCloudOverviewTiles({
          accounts: read.accounts,
          resources: read.totals.resources,
          costs: read.totals.costs,
          attention,
          attentionFailed,
          now: OneUptimeDate.getCurrentDate(),
          translator,
          routes: {
            accounts: route(PageMap.CLOUD_ACCOUNTS),
            resources: route(PageMap.CLOUD_MONITORED_RESOURCES),
            costs: route(PageMap.CLOUD_COSTS),
          },
        })}
      />

      {projectId ? (
        <CloudAttentionCard
          testId="cloud-overview-attention"
          query={attentionQuery}
          showAccount={true}
          onLoaded={onAttentionLoaded}
          onFailed={onAttentionFailed}
        />
      ) : (
        <></>
      )}

      <CardGrid columns={2} dataTestId="cloud-overview-money">
        <CloudSpendCard
          accounts={read.accounts}
          costs={read.totals.costs}
          costsRoute={route(PageMap.CLOUD_COSTS)}
        />
        {projectId ? (
          <CloudSavingsCard
            projectId={projectId}
            accounts={read.accounts}
            savings={read.totals.savings}
            savingsRoute={route(PageMap.CLOUD_SAVINGS)}
          />
        ) : (
          <></>
        )}
      </CardGrid>

      <CloudAccountsCard
        accounts={read.accounts}
        currency={read.totals.costs.currency}
        accountsRoute={route(PageMap.CLOUD_ACCOUNTS)}
      />

      <CloudAppPlatformsCard accounts={read.accounts} />
    </Fragment>
  );
};

export default CloudOverview;
