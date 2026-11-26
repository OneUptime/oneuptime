import {
  ALLOWLIST_FIELD_DESCRIPTION,
  ALLOWLIST_FIELD_TITLE,
  ALLOWLIST_PLACEHOLDER,
  FAMILY_FIELD_DESCRIPTION,
  FAMILY_FIELD_TITLE,
  FAMILY_LABELS,
  FIREWALL_FIELD_DESCRIPTION,
  FIREWALL_FIELD_TITLE,
  LAST_FETCHED_FROM,
  NAME_FIELD_DESCRIPTION,
  NAME_FIELD_TITLE,
  NEVER_FETCHED,
  STATUS_LABELS,
} from "./BlocklistFeedsCopy";
import { getFirewallOptions } from "./BlocklistFeedSetupCard";
import SecurityBlocklistFeed from "Common/Models/DatabaseModels/SecurityBlocklistFeed";
import OneUptimeDate from "Common/Types/Date";
import {
  SECURITY_BLOCKLIST_FEED_FAMILIES,
  SecurityBlocklistFeedAllowlist,
  SecurityBlocklistFeedFamily,
  SecurityBlocklistFeedStatus,
  getSecurityBlocklistFeedStatus,
  readSecurityBlocklistFeedAllowlist,
} from "Common/Types/SecurityBlocklist/SecurityBlocklistFeed";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import { ModelField } from "Common/UI/Components/Forms/ModelForm";
import FormFieldSchemaType from "Common/UI/Components/Forms/Types/FormFieldSchemaType";
import { FormFieldCollapsibleSection } from "Common/UI/Components/Forms/Types/Field";
import FormValues from "Common/UI/Components/Forms/Types/FormValues";
import { getAdvancedFormSection } from "Common/UI/Components/Forms/Utils/AdvancedFormSection";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import TableEmptyValue from "Common/UI/Components/Table/TableEmptyValue";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * A blocklist feed's form and cells (#10345): Create Blocklist Feed asks
 * which firewall reads it - its name, and what it serves, follow from that
 * - with what it serves and who may read it folded under More fields; and
 * a feed's status, from the rules the server reads it by
 * (getSecurityBlocklistFeedStatus).
 */

const moreFieldsSection: FormFieldCollapsibleSection<SecurityBlocklistFeed> =
  getAdvancedFormSection<SecurityBlocklistFeed>({
    id: "blocklist-feed-more-fields",
  });

export function getFamilyOptions(): Array<DropdownOption> {
  return SECURITY_BLOCKLIST_FEED_FAMILIES.map(
    (family: SecurityBlocklistFeedFamily): DropdownOption => {
      return { value: family, label: FAMILY_LABELS[family] };
    },
  );
}

// What is wrong with an allowlist, in the reader's language - the server's own sentence.
export function getAllowlistProblem(
  translator: Translator,
): (values: FormValues<SecurityBlocklistFeed>) => string | null {
  return (values: FormValues<SecurityBlocklistFeed>): string | null => {
    const allowlist: SecurityBlocklistFeedAllowlist =
      readSecurityBlocklistFeedAllowlist(
        (values as Record<string, unknown>)["allowedSourceAddresses"] as
          | string
          | undefined,
      );

    return allowlist.problem
      ? translator.translateTemplate(
          allowlist.problem.template,
          allowlist.problem.values,
        )
      : null;
  };
}

// Create Blocklist Feed, and a feed's Edit: the firewall and a name, then More fields.
export function getBlocklistFeedFormFields(data: {
  translator: Translator;
}): Array<ModelField<SecurityBlocklistFeed>> {
  return [
    {
      field: { firewall: true },
      title: FIREWALL_FIELD_TITLE,
      description: FIREWALL_FIELD_DESCRIPTION,
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownOptions: getFirewallOptions(),
      required: true,
      dataTestId: "blocklist-feed-firewall",
    },
    {
      field: { name: true },
      title: NAME_FIELD_TITLE,
      description: NAME_FIELD_DESCRIPTION,
      fieldType: FormFieldSchemaType.Text,
      hideColumnDescription: true,
      required: false,
      dataTestId: "blocklist-feed-name",
    },
    {
      field: { family: true },
      title: FAMILY_FIELD_TITLE,
      description: FAMILY_FIELD_DESCRIPTION,
      fieldType: FormFieldSchemaType.Dropdown,
      dropdownOptions: getFamilyOptions(),
      hideColumnDescription: true,
      required: false,
      collapsibleSection: moreFieldsSection,
      dataTestId: "blocklist-feed-family",
    },
    {
      field: { allowedSourceAddresses: true },
      title: ALLOWLIST_FIELD_TITLE,
      description: ALLOWLIST_FIELD_DESCRIPTION,
      fieldType: FormFieldSchemaType.LongText,
      placeholder: ALLOWLIST_PLACEHOLDER,
      // Addresses, as written in every language.
      isPlaceholderTranslated: true,
      hideColumnDescription: true,
      required: false,
      disableSpellCheck: true,
      customValidation: getAllowlistProblem(data.translator),
      collapsibleSection: moreFieldsSection,
      dataTestId: "blocklist-feed-allowlist",
    },
  ];
}

// Where a feed stands at `now`, as its row, its page and the Blocklist say it.
export function getFeedStatus(
  feed: Pick<
    SecurityBlocklistFeed,
    "secretHint" | "lastFetchedAt" | "usualFetchIntervalInSeconds" | "firewall"
  >,
  now: Date,
): SecurityBlocklistFeedStatus {
  return getSecurityBlocklistFeedStatus({
    // Readers never see the secret; its hint is there exactly while it is.
    hasSecret: Boolean(feed.secretHint),
    lastFetchedAt: feed.lastFetchedAt,
    usualIntervalInMs:
      typeof feed.usualFetchIntervalInSeconds === "number"
        ? feed.usualFetchIntervalInSeconds * 1000
        : null,
    firewall: feed.firewall,
    now,
  });
}

/*
 * A feed's status as a chip: reading in green, not fetched yet as a fact,
 * stopped in red - it broke - and revoked in grey: someone chose it.
 */
export function getFeedStatusTone(
  status: SecurityBlocklistFeedStatus,
): PillTone {
  switch (status) {
    case SecurityBlocklistFeedStatus.Reading:
      return PillTone.Success;
    case SecurityBlocklistFeedStatus.StoppedReading:
      return PillTone.Danger;
    case SecurityBlocklistFeedStatus.Revoked:
      return PillTone.Paused;
    default:
      return PillTone.Neutral;
  }
}

export interface FeedCellProps {
  feed: SecurityBlocklistFeed;
  now: Date;
}

export const BlocklistFeedStatusCell: FunctionComponent<FeedCellProps> = (
  props: FeedCellProps,
): ReactElement => {
  const status: SecurityBlocklistFeedStatus = getFeedStatus(
    props.feed,
    props.now,
  );

  return <Pill text={STATUS_LABELS[status]} tone={getFeedStatusTone(status)} />;
};

// When a firewall last fetched the feed, and from where; "Never" before the first fetch.
export const BlocklistFeedLastFetchedCell: FunctionComponent<FeedCellProps> = (
  props: FeedCellProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  if (!props.feed.lastFetchedAt) {
    return (
      <span className="text-sm text-gray-500">
        {translator.translateText(NEVER_FETCHED)}
      </span>
    );
  }

  const time: string = OneUptimeDate.fromNow(
    new Date(props.feed.lastFetchedAt),
    props.now,
  );

  if (!props.feed.lastFetchSourceIp) {
    return <span className="text-sm text-gray-700">{time}</span>;
  }

  return (
    <span className="text-sm text-gray-700">
      {translator.translateTemplate(LAST_FETCHED_FROM, {
        time,
        address: props.feed.lastFetchSourceIp,
      })}
    </span>
  );
};

// How many addresses and ranges the firewall holds from it.
export interface FeedEntriesCellProps {
  feed: SecurityBlocklistFeed;
}

export const BlocklistFeedEntriesCell: FunctionComponent<
  FeedEntriesCellProps
> = (props: FeedEntriesCellProps): ReactElement => {
  const translator: Translator = useTranslator();

  if (typeof props.feed.servedCount !== "number") {
    return <TableEmptyValue />;
  }

  return (
    <span className="text-sm text-gray-700">
      {translator.formatNumber(props.feed.servedCount)}
    </span>
  );
};
