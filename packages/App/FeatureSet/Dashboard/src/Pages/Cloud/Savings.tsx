import PageComponentProps from "../PageComponentProps";
import CloudCostGapsCard, {
  CloudCostGapRow,
  getCloudCostGapRows,
} from "../../Components/Cloud/CloudCostGapsCard";
import CloudCostSetupSteps, {
  getCloudProvidersOf,
} from "../../Components/Cloud/CloudCostSetupSteps";
import CloudCommitmentsCard from "../../Components/Cloud/CloudCommitmentsCard";
import { getCloudSavingsTiles } from "../../Components/Cloud/CloudOverviewTiles";
import CloudSavingsTable from "../../Components/Cloud/CloudSavingsTable";
import CloudStatStrip from "../../Components/Cloud/CloudStatStrip";
import CloudConnectCallout, {
  CLOUD_CONNECT_CALLOUT_SPEND_DESCRIPTION,
} from "../../Components/Cloud/Connect/CloudConnectCallout";
import CloudSavingsActionsStrip, {
  hasCloudSavingsActivity,
} from "../../Components/Cloud/Savings/CloudSavingsActionsStrip";
import {
  CloudSavingsActionDialogs,
  CloudSavingsChangesCard,
  CloudSavingsWaitingCard,
  useCloudSavingsActionDialogs,
} from "../../Components/Cloud/Savings/CloudSavingsActionsCards";
import CloudSavingsApi from "../../Components/Cloud/Savings/CloudSavingsApi";
import useCloudAccounts, {
  CloudAccountsRead,
} from "../../Components/Cloud/UseCloudAccounts";
import { CloudSavingsSummary } from "Common/Types/Cloud/CloudSavingsApiTypes";
import OneUptimeDate from "Common/Types/Date";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";

/*
 * Cloud > Savings: how to spend less, from your clouds' own recommenders -
 * AWS Cost Optimization Hub, Azure Advisor, Google Cloud's Recommender.
 * The strip says what could be saved a month and in what way (smaller
 * sizes, idle resources, commitments), and the table under it lists every
 * recommendation, the largest first - what the page is for, so it comes
 * first. A saving OneUptime can make itself has Apply (#11010): once the
 * project has acted on any, a second strip says what the bill showed the
 * changes saved this month, the changes waiting for an owner's approval
 * are listed above the table, and what was done below it, each with Undo
 * where it can be. Commitments follows: how much of the spend the
 * commitments the accounts already have cover, and how much of them is
 * used. The accounts whose recommendations are not read close the page,
 * with why and what to do. Before any are read, it says what each cloud
 * needs.
 */

export const SAVINGS_NOT_READ_TITLE: string = translationKey(
  "Recommendations are not read yet",
);
export const SAVINGS_NOT_READ_DESCRIPTION: string = translationKey(
  "Each cloud's own recommender says how to spend less, once a connection may read it.",
);

const CloudSavings: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const translator: Translator = useTranslator();
  const read: CloudAccountsRead = useCloudAccounts();
  const [summary, setSummary] = useState<CloudSavingsSummary | null>(null);
  const [refreshToggle, setRefreshToggle] = useState<string>(
    OneUptimeDate.getCurrentDate().toString(),
  );
  const refresh: () => void = (): void => {
    setRefreshToggle(OneUptimeDate.getCurrentDate().toString());
  };
  const dialogs: CloudSavingsActionDialogs =
    useCloudSavingsActionDialogs(refresh);

  // What the changes made came to, read again whenever one changes.
  useEffect(() => {
    let ignore: boolean = false;

    CloudSavingsApi.getSummary()
      .then((found: CloudSavingsSummary): void => {
        if (!ignore) {
          setSummary(found);
        }
      })
      .catch((): void => {
        // The strip is an extra: the page stands without it.
        if (!ignore) {
          setSummary(null);
        }
      });

    return (): void => {
      ignore = true;
    };
  }, [refreshToggle]);

  if (read.isLoading && read.accounts.length === 0) {
    return <PageSkeleton />;
  }

  if (read.error && read.accounts.length === 0) {
    return <ErrorMessage message={read.error} onRefreshClick={read.refresh} />;
  }

  if (read.accounts.length === 0) {
    return (
      <CloudConnectCallout
        description={CLOUD_CONNECT_CALLOUT_SPEND_DESCRIPTION}
      />
    );
  }

  const gaps: Array<CloudCostGapRow> = getCloudCostGapRows({
    accounts: read.accounts,
    currency: read.totals.savings.currency,
    kind: "savings",
  });
  const isAnyRead: boolean =
    read.totals.savings.accountsRead > 0 || read.totals.savings.count > 0;

  return (
    <Fragment>
      {isAnyRead ? (
        <CloudStatStrip
          testId="cloud-savings-strip"
          tiles={getCloudSavingsTiles({
            savings: read.totals.savings,
            translator,
          })}
        />
      ) : (
        <Card
          title={SAVINGS_NOT_READ_TITLE}
          description={SAVINGS_NOT_READ_DESCRIPTION}
        >
          <div data-testid="cloud-savings-not-read">
            <CloudCostSetupSteps
              kind="savings"
              providers={getCloudProvidersOf(read.accounts)}
            />
          </div>
        </Card>
      )}
      <CloudSavingsActionsStrip summary={summary} />
      {summary && summary.waitingCount > 0 ? (
        <CloudSavingsWaitingCard
          refreshToggle={refreshToggle}
          dialogs={dialogs}
        />
      ) : (
        <></>
      )}
      <CloudSavingsTable
        id="cloud-savings-table"
        currency={read.totals.savings.currency}
        onChanged={refresh}
      />
      {hasCloudSavingsActivity(summary) ? (
        <CloudSavingsChangesCard
          refreshToggle={refreshToggle}
          dialogs={dialogs}
        />
      ) : (
        <></>
      )}
      <CloudCommitmentsCard accounts={read.accounts} />
      <CloudCostGapsCard
        rows={gaps}
        kind="savings"
        currency={read.totals.savings.currency}
        isNothingRead={!isAnyRead}
      />
      {dialogs.dialogs}
    </Fragment>
  );
};

export default CloudSavings;
