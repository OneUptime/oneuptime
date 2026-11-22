import {
  AZURE_WAF_WHERE,
  CLIENT_ADDRESS_LABELS,
  CLOUD_ARMOR_GLOBAL,
  CLOUD_ARMOR_WHERE,
  CLOUD_WAF_STATUS_LABELS,
  CLOUD_WAF_TEST_IDS,
  LEFT_IN_CLOUD_ITEMS,
  SOURCE_ADDRESS_LABELS,
  WEB_ACL_WHERE,
} from "./CloudWafCopy";
import SecurityBlockCloudWaf from "Common/Models/DatabaseModels/SecurityBlockCloudWaf";
import {
  AwsWafArn,
  AwsWafScope,
  parseAwsWafArn,
} from "Common/Types/CloudConnection/AwsWafBlocklist";
import {
  AZURE_WAF_KIND_TITLES,
  AzureWafPolicyRef,
  parseAzureWafPolicyId,
} from "Common/Types/CloudConnection/AzureWafBlocklist";
import {
  CloudArmorPolicyRef,
  parseCloudArmorPolicyId,
  readCloudArmorRuleDetails,
} from "Common/Types/CloudConnection/CloudArmorBlocklist";
import {
  SECURITY_BLOCK_DEFAULT_CLIENT_ADDRESS,
  SecurityBlockClientAddress,
  SecurityBlockClientAddressHeader,
  SecurityBlockCloudWafLeftItem,
  SecurityBlockCloudWafStatus,
  getSecurityBlockClientAddressHeader,
  isSecurityBlockClientAddress,
  isSecurityBlockCloudWafStatus,
} from "Common/Types/SecurityBlocklist/SecurityBlockCloudWaf";
import {
  SecurityBlockCloudWafKind,
  getSecurityBlockCloudWafClientAddresses,
  getSecurityBlockCloudWafKind,
} from "Common/Types/SecurityBlocklist/SecurityBlockCloudWafKind";
import {
  SecurityBlockReason,
  readSecurityBlockReason,
  wordSecurityBlockReason,
} from "Common/Types/SecurityBlocklist/SecurityBlockReason";
import { DropdownOption } from "Common/UI/Components/Dropdown/Dropdown";
import Pill from "Common/UI/Components/Pill/Pill";
import { PillTone } from "Common/UI/Components/Pill/PillTone";
import { Translator } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * The cells of the Blocklist's Cloud WAFs card (#10344, #10348, #10349): a
 * WAF by its name and where it is, where it reads the client's address,
 * and where it stands - a chip, and why when it is not enforcing: Azure
 * WAF's and Cloud Armor's reasons in the reader's language (#10629), AWS
 * WAF's in the server's English.
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

export function readCloudWafKind(
  row: Pick<SecurityBlockCloudWaf, "cloudProvider" | "wafId">,
): SecurityBlockCloudWafKind | null {
  return getSecurityBlockCloudWafKind({
    cloudProvider: row.cloudProvider,
    wafId: row.wafId,
  });
}

// The client addresses a row's WAF can read, its default first.
export function getRowClientAddresses(
  row: Pick<SecurityBlockCloudWaf, "cloudProvider" | "wafId" | "ruleDetails">,
): ReadonlyArray<SecurityBlockClientAddress> {
  return getSecurityBlockCloudWafClientAddresses({
    kind: readCloudWafKind(row),
    cloudArmorPolicyType: readCloudArmorRuleDetails(row.ruleDetails)
      ?.policyType,
  });
}

export function getCloudWafStatusTone(
  status: SecurityBlockCloudWafStatus,
): PillTone {
  switch (status) {
    case SecurityBlockCloudWafStatus.Enforcing:
      return PillTone.Success;
    case SecurityBlockCloudWafStatus.WaitingForRule:
    case SecurityBlockCloudWafStatus.NoFreePriority:
    case SecurityBlockCloudWafStatus.Drifted:
      return PillTone.Warning;
    case SecurityBlockCloudWafStatus.Failed:
      return PillTone.Danger;
    default:
      return PillTone.Info;
  }
}

/*
 * Where a WAF is: "eu-west-1, account 123456789012", "CloudFront, account
 * ...", "Front Door, resource group rg-prod", "Cloud Armor, global,
 * project acme-prod".
 */
export function writeCloudWafWhere(
  translator: Translator,
  row: Pick<SecurityBlockCloudWaf, "cloudProvider" | "wafId">,
): string {
  const kind: SecurityBlockCloudWafKind | null = readCloudWafKind(row);

  if (kind === SecurityBlockCloudWafKind.AwsWebAcl) {
    const arn: AwsWafArn | null = parseAwsWafArn(row.wafId);

    return arn
      ? translator.translateTemplate(WEB_ACL_WHERE, {
          where: arn.scope === AwsWafScope.CloudFront ? CLOUDFRONT : arn.region,
          account: arn.accountId,
        })
      : "";
  }

  if (
    kind === SecurityBlockCloudWafKind.AzureApplicationGateway ||
    kind === SecurityBlockCloudWafKind.AzureFrontDoor
  ) {
    const policy: AzureWafPolicyRef | null = parseAzureWafPolicyId(row.wafId);

    return policy
      ? translator.translateTemplate(AZURE_WAF_WHERE, {
          kind: AZURE_WAF_KIND_TITLES[policy.kind],
          group: policy.resourceGroup,
        })
      : "";
  }

  if (kind === SecurityBlockCloudWafKind.CloudArmor) {
    const policy: CloudArmorPolicyRef | null = parseCloudArmorPolicyId(
      row.wafId,
    );

    return policy
      ? translator.translateTemplate(CLOUD_ARMOR_WHERE, {
          place:
            policy.region ||
            translator.translateText(CLOUD_ARMOR_GLOBAL) ||
            CLOUD_ARMOR_GLOBAL,
          project: policy.project,
        })
      : "";
  }

  return "";
}

/*
 * Where the client's address is read, in the reader's words, a header as
 * written. The source address is named as the WAF's own cloud names it.
 */
export function writeClientAddress(
  translator: Translator,
  value: SecurityBlockClientAddress,
  kind?: SecurityBlockCloudWafKind | null | undefined,
): string {
  if (value === SecurityBlockClientAddress.SourceIp) {
    const label: string | undefined =
      kind === SecurityBlockCloudWafKind.AzureFrontDoor
        ? SOURCE_ADDRESS_LABELS.frontDoor
        : kind === SecurityBlockCloudWafKind.AzureApplicationGateway
          ? SOURCE_ADDRESS_LABELS.applicationGateway
          : kind === SecurityBlockCloudWafKind.CloudArmor
            ? SOURCE_ADDRESS_LABELS.cloudArmor
            : undefined;

    if (label) {
      return translator.translateText(label) || label;
    }
  }

  const header: SecurityBlockClientAddressHeader | null =
    getSecurityBlockClientAddressHeader(value);

  return translator.translateTemplate(CLIENT_ADDRESS_LABELS[value], {
    header: header?.header || "",
  });
}

// The choices of where a WAF of a kind reads the client's address.
export function getClientAddressOptions(
  translator: Translator,
  choices: ReadonlyArray<SecurityBlockClientAddress> = getSecurityBlockCloudWafClientAddresses(
    { kind: SecurityBlockCloudWafKind.AwsWebAcl },
  ),
  kind: SecurityBlockCloudWafKind | null = SecurityBlockCloudWafKind.AwsWebAcl,
): Array<DropdownOption> {
  return choices.map((value: SecurityBlockClientAddress): DropdownOption => {
    return { label: writeClientAddress(translator, value, kind), value };
  });
}

// What stays in the cloud once a WAF is removed: "Rule OneUptime-Blocklist-1a2b in prod-alb".
export function writeLeftInCloud(
  translator: Translator,
  item: SecurityBlockCloudWafLeftItem,
): string {
  return translator.translateTemplate(LEFT_IN_CLOUD_ITEMS[item.kind], {
    name: item.name,
    webAcl: item.webAcl || "",
    priority: item.priority !== undefined ? String(item.priority) : "",
  });
}

// Why a WAF is not enforcing: its reason in the reader's words, else the server's English.
export function writeCloudWafStatusMessage(
  translator: Translator,
  row: Pick<SecurityBlockCloudWaf, "statusReason" | "statusMessage">,
): string {
  const reason: SecurityBlockReason | null = readSecurityBlockReason(
    row.statusReason,
  );

  return reason
    ? wordSecurityBlockReason(reason, translator)
    : (row.statusMessage || "").trim();
}

export interface RowProps {
  row: SecurityBlockCloudWaf;
}

export const CloudWafWebAclCell: FunctionComponent<RowProps> = (
  props: RowProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const where: string = writeCloudWafWhere(translator, props.row);

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
        readCloudWafKind(props.row),
      )}
    </span>
  );
};

export const CloudWafStatusCell: FunctionComponent<RowProps> = (
  props: RowProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const status: SecurityBlockCloudWafStatus = readCloudWafStatus(props.row);
  const message: string = writeCloudWafStatusMessage(translator, props.row);

  return (
    <div className="space-y-1" data-testid={CLOUD_WAF_TEST_IDS.statusCell}>
      <Pill
        text={CLOUD_WAF_STATUS_LABELS[status]}
        tone={getCloudWafStatusTone(status)}
      />
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
