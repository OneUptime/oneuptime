import PageComponentProps from "../PageComponentProps";
import CloudCostGapsCard, {
  CloudCostGapRow,
  getCloudCostGapRows,
} from "../../Components/Cloud/CloudCostGapsCard";
import CloudCostSetupSteps, {
  getCloudProvidersOf,
} from "../../Components/Cloud/CloudCostSetupSteps";
import { getCloudSavingsTiles } from "../../Components/Cloud/CloudOverviewTiles";
import CloudSavingsTable from "../../Components/Cloud/CloudSavingsTable";
import CloudStatStrip from "../../Components/Cloud/CloudStatStrip";
import CloudConnectCallout, {
  CLOUD_CONNECT_CALLOUT_SPEND_DESCRIPTION,
} from "../../Components/Cloud/Connect/CloudConnectCallout";
import useCloudAccounts, {
  CloudAccountsRead,
} from "../../Components/Cloud/UseCloudAccounts";
import Card from "Common/UI/Components/Card/Card";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { Fragment, FunctionComponent, ReactElement } from "react";

/*
 * Cloud > Savings: how to spend less, from your clouds' own recommenders -
 * AWS Cost Optimization Hub, Azure Advisor, Google Cloud's Recommender.
 * The strip says what could be saved a month and in what way (smaller
 * sizes, idle resources, commitments); the table lists every
 * recommendation, the largest first; the accounts whose recommendations
 * are not read follow, with why and what to do. Before any are read, it
 * says what each cloud needs.
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

  if (read.isLoading && read.accounts.length === 0) {
    return <PageLoader isVisible={true} />;
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
      <CloudSavingsTable
        id="cloud-savings-table"
        currency={read.totals.savings.currency}
      />
      <CloudCostGapsCard
        rows={gaps}
        kind="savings"
        currency={read.totals.savings.currency}
        isNothingRead={!isAnyRead}
      />
    </Fragment>
  );
};

export default CloudSavings;
