import {
  CLIENT_ADDRESS_LABELS,
  CLOUD_WAF_STATUS_LABELS,
  CLOUD_WAF_TEST_IDS,
  LEFT_IN_CLOUD_ITEMS,
  WEB_ACL_WHERE,
} from "./CloudWafCopy";
import SecurityBlockCloudWaf from "Common/Models/DatabaseModels/SecurityBlockCloudWaf";
import {
  AwsWafArn,
  AwsWafScope,
  parseAwsWafArn,
} from "Common/Types/CloudConnection/AwsWafBlocklist";
import {
  SECURITY_BLOCK_DEFAULT_CLIENT_ADDRESS,
  SecurityBlockClientAddress,
  SecurityBlockClientAddressHeader,
  SecurityBlockCloudWafLeftItem,
  SecurityBlockCloudWafLeftKind,
  SecurityBlockCloudWafStatus,
  getSecurityBlockClientAddressHeader,
  isSecurityBlockClientAddress,
  isSecurityBlockCloudWafStatus,
} from "Common/Types/SecurityBlocklist/SecurityBlockCloudWaf";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The cells of the Blocklist's Cloud WAFs card (#10344): a web ACL by its
 * name and where it is, where it reads the client's address, and where it
 * stands - a chip, and the server's sentence of why when it is not
 * enforcing.
 */

// CloudFront's web ACLs are global: named by the service, not its Region.
const CLOUDFRONT: string = "CloudFront";

export function readCloudWafStatus(
  row: SecurityBlockCloudWaf,
): SecurityBlockCloudWafStatus {
  return isSecurityBlockCloudWafStatus(row.status)
    ? row.status
    : SecurityBlockCloudWafStatus.Checking;
}

export function readClientAddress(value: unknown): SecurityBlockClientAddress {
  return isSecurityBlockClientAddress(value)
    ? value
    : SECURITY_BLOCK_DEFAULT_CLIENT_ADDRESS;
}

export function getCloudWafStatusTone(
  status: SecurityBlockCloudWafStatus,
): PillTone {
  switch (status) {
    case SecurityBlockCloudWafStatus.Enforcing:
      return PillTone.Success;
    case SecurityBlockCloudWafStatus.WaitingForRule:
    case SecurityBlockCloudWafStatus.NoFreePriority:
      return PillTone.Warning;
    case SecurityBlockCloudWafStatus.Failed:
      return PillTone.Danger;
    default:
      return PillTone.Info;
  }
}

// Where a web ACL is: "eu-west-1, account 123456789012", "CloudFront, account ...".
export function writeWebAclWhere(
  translator: Translator,
  wafId: string | undefined,
): string {
  const arn: AwsWafArn | null = parseAwsWafArn(wafId);

  if (!arn) {
    return "";
  }

  return translator.translateTemplate(WEB_ACL_WHERE, {
    where: arn.scope === AwsWafScope.CloudFront ? CLOUDFRONT : arn.region,
    account: arn.accountId,
  });
}

// Where the client's address is read, in the reader's words, its header as written.
export function writeClientAddress(
  translator: Translator,
  value: SecurityBlockClientAddress,
): string {
  const header: SecurityBlockClientAddressHeader | null =
    getSecurityBlockClientAddressHeader(value);

  return translator.translateTemplate(CLIENT_ADDRESS_LABELS[value], {
    header: header?.header || "",
  });
}

export function getClientAddressOptions(
  translator: Translator,
): Array<DropdownOption> {
  return Object.values(SecurityBlockClientAddress).map(
    (value: SecurityBlockClientAddress): DropdownOption => {
      return { label: writeClientAddress(translator, value), value };
    },
  );
}

// What stays in AWS WAF once a web ACL is removed: "Rule OneUptime-Blocklist-1a2b in prod-alb".
export function writeLeftInCloud(
  translator: Translator,
  item: SecurityBlockCloudWafLeftItem,
): string {
  return translator.translateTemplate(LEFT_IN_CLOUD_ITEMS[item.kind], {
    name: item.name,
    webAcl:
      item.kind === SecurityBlockCloudWafLeftKind.Rule ? item.webAcl || "" : "",
  });
}

export interface RowProps {
  row: SecurityBlockCloudWaf;
}

export const CloudWafWebAclCell: FunctionComponent<RowProps> = (
  props: RowProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const where: string = writeWebAclWhere(translator, props.row.wafId);

  return (
    <div data-testid={CLOUD_WAF_TEST_IDS.webAclCell}>
      <span className="break-all text-sm font-medium text-gray-900">
        {props.row.name || ""}
      </span>
      {where ? (
        <span className="mt-0.5 block text-xs text-gray-500">{where}</span>
      ) : (
        <></>
      )}
    </div>
  );
};

export const CloudWafClientAddressCell: FunctionComponent<RowProps> = (
  props: RowProps,
): ReactElement => {
  const translator: Translator = useTranslator();

  return (
    <span className="text-sm text-gray-700">
      {writeClientAddress(
        translator,
        readClientAddress(props.row.clientAddress),
      )}
    </span>
  );
};

export const CloudWafStatusCell: FunctionComponent<RowProps> = (
  props: RowProps,
): ReactElement => {
  const status: SecurityBlockCloudWafStatus = readCloudWafStatus(props.row);
  const message: string = (props.row.statusMessage || "").trim();

  return (
    <div className="space-y-1" data-testid={CLOUD_WAF_TEST_IDS.statusCell}>
      <Pill
        text={CLOUD_WAF_STATUS_LABELS[status]}
        tone={getCloudWafStatusTone(status)}
      />
      {/* The server's own sentence: what to do about it, in English. */}
      {message && status !== SecurityBlockCloudWafStatus.Enforcing ? (
        <p
          className="text-sm text-gray-600"
          data-testid={CLOUD_WAF_TEST_IDS.statusMessage}
        >
          {message}
        </p>
      ) : (
        <></>
      )}
    </div>
  );
};
