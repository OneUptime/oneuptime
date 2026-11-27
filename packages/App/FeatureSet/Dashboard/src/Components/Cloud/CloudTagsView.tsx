import {
  CloudTagAccountCoverageJSON,
  CloudTagCoverageJSON,
} from "Common/Types/Cloud/CloudTagCoverage";
import ObjectID from "Common/Types/ObjectID";
import AdvancedPageSection from "Common/UI/Components/AdvancedPageSection/AdvancedPageSection";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { foldedSectionItem } from "Common/UI/Components/FoldedSection/FoldedSectionItem";
import PageSkeleton from "Common/UI/Components/Page/PageSkeleton";
import API from "Common/UI/Utils/API/API";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import CloudRequiredTagsCard from "./CloudRequiredTagsCard";
import CloudStatStrip from "./CloudStatStrip";
import {
  CloudTagAccountsCard,
  CloudTagByKeyCard,
  CloudTagTrendCard,
} from "./CloudTagCoverageCards";
import CloudTagFindingsTable from "./CloudTagFindingsTable";
import { fetchCloudTagCoverage } from "./CloudTagReads";
import CloudTagSettingsCards, {
  ALERT_ROUTING_TITLE,
  TAG_SETTINGS_TITLE,
} from "./CloudTagSettingsCards";
import { getCloudTagTiles, getSpendNotMeasuredReason } from "./CloudTagWords";
import { CloudUntaggedResourcesCard } from "./CloudUntaggedResourcesCard";
import { CloudAccountRow } from "./UseCloudAccounts";

/*
 * CLOUD > TAGS, AND AN ACCOUNT'S TAGS (#11012).
 *
 * With no required tag yet: the one thing to do, require one.
 *
 * With some, what most people need first:
 *
 *   - the strip: how much of the spend and of the resources carry them,
 *     and how many resources lack one;
 *   - the resources that lack one, the costliest first, each with the
 *     value OneUptime suggests and the command that applies it;
 *   - each tag's share, the trend over 12 weeks, and - over every account -
 *     each account's share;
 *   - the required tags themselves, and the new resources found without
 *     them;
 *   - under More settings, who is told about a new one and whether an
 *     alert is raised.
 */

export const TAGS_MORE_SETTINGS_DESCRIPTION: string = translationKey(
  "Who is told about a new resource without a required tag, how often, and whether an alert is raised. By default its creator and owners get one email an hour.",
);

export interface ComponentProps {
  projectId: ObjectID;
  accounts: Array<CloudAccountRow>;
  // One account's Tags; every account's when absent.
  cloudAccountId?: ObjectID | undefined;
}

const CloudTagsView: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const [coverage, setCoverage] = useState<CloudTagCoverageJSON | null>(null);
  const [error, setError] = useState<string>("");
  const [attempt, setAttempt] = useState<number>(0);
  const accountKey: string = props.cloudAccountId?.toString() || "";

  useEffect(() => {
    let ignore: boolean = false;

    setError("");

    fetchCloudTagCoverage({ cloudAccountId: props.cloudAccountId })
      .then((found: CloudTagCoverageJSON): void => {
        if (!ignore) {
          setCoverage(found);
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
  }, [accountKey, attempt]);

  const refresh: () => void = (): void => {
    setAttempt(attempt + 1);
  };

  if (error && !coverage) {
    return <ErrorMessage message={error} onRefreshClick={refresh} />;
  }

  if (!coverage) {
    return <PageSkeleton />;
  }

  const requiredTags: ReactElement = (
    <CloudRequiredTagsCard
      projectId={props.projectId}
      cloudAccountId={props.cloudAccountId}
      accounts={props.accounts}
      onChanged={refresh}
    />
  );

  // Nothing to measure yet: the one thing to do.
  if (!coverage.hasRules) {
    return <div data-testid="cloud-tags-no-rules">{requiredTags}</div>;
  }

  const account: CloudTagAccountCoverageJSON | undefined = props.cloudAccountId
    ? coverage.accounts[0]
    : undefined;
  const spendNotMeasured: string | null = account
    ? getSpendNotMeasuredReason(account)
    : null;

  return (
    <Fragment>
      <CloudStatStrip
        testId="cloud-tags-strip"
        tiles={getCloudTagTiles({ coverage, translator })}
      />
      <CloudUntaggedResourcesCard
        resources={coverage.untagged}
        count={coverage.untaggedCount}
        showAccount={!props.cloudAccountId}
      />
      <CloudTagByKeyCard
        requiredTags={coverage.requiredTags}
        spend={account ? account.spend : coverage.total.spend}
        resources={account ? account.resources : coverage.total.resources}
        spendNotMeasured={spendNotMeasured}
      />
      <CloudTagTrendCard trend={coverage.trend} />
      {props.cloudAccountId ? (
        <></>
      ) : (
        <CloudTagAccountsCard accounts={coverage.accounts} />
      )}
      {requiredTags}
      <CloudTagFindingsTable
        projectId={props.projectId}
        cloudAccountId={props.cloudAccountId}
      />
      {props.cloudAccountId ? (
        <></>
      ) : (
        <AdvancedPageSection
          description={TAGS_MORE_SETTINGS_DESCRIPTION}
          items={[
            foldedSectionItem(TAG_SETTINGS_TITLE),
            foldedSectionItem(ALERT_ROUTING_TITLE),
          ]}
          dataTestId="cloud-tags-more-settings"
        >
          <CloudTagSettingsCards projectId={props.projectId} />
        </AdvancedPageSection>
      )}
    </Fragment>
  );
};

export default CloudTagsView;
