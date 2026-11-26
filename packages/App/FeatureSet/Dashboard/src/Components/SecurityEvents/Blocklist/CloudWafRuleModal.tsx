import { readClientAddress } from "./CloudWafCells";
import {
  CLOUD_WAF_TEST_IDS,
  RULE_ADDED_DESCRIPTION,
  RULE_IN_CODE_DESCRIPTION,
  RULE_SETS_NOT_MADE,
  RULE_TABS_LABEL,
  RULE_TITLE,
} from "./CloudWafCopy";
import SecurityBlockCloudWaf from "Common/Models/DatabaseModels/SecurityBlockCloudWaf";
import {
  AwsWafBlocklistCodeRule,
  getAwsWafBlocklistCloudFormation,
  getAwsWafBlocklistTerraform,
} from "Common/Types/CloudConnection/AwsWafBlocklist";
import { JSONObject, JSONValue } from "Common/Types/JSON";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import Modal from "Common/UI/Components/Modal/Modal";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

/*
 * Show Rule (#10344): OneUptime's two rules for a web ACL - one blocks, one
 * challenges, each through the IP sets of its kind - as Terraform and as
 * CloudFormation, with the sets' ARNs and the header the web ACL reads the
 * client's address from. A web ACL kept in code gets them pasted in by its
 * team; one OneUptime writes shows what it added. Until the sets are made
 * there is no ARN to name, and it says so.
 */

const SET_KEYS: ReadonlyArray<string> = [
  "block-ipv4",
  "block-ipv6",
  "challenge-ipv4",
  "challenge-ipv6",
];

const CLOSE: string = translationKey("Close");

function readObject(value: JSONValue | undefined): JSONObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JSONObject)
    : {};
}

function readPriority(value: JSONValue | undefined, fallback: number): number {
  return typeof value === "number" && Number.isInteger(value) && value >= 0
    ? value
    : fallback;
}

/*
 * The rule a web ACL's row describes, or null while its sets are not all
 * made. A team adding it in code puts it first: priorities 0 and 1 unless
 * OneUptime found it, or placed it, elsewhere.
 */
export function readCloudWafCodeRule(
  row: SecurityBlockCloudWaf,
): AwsWafBlocklistCodeRule | null {
  const details: JSONObject = readObject(row.ruleDetails as JSONValue);
  const setArns: JSONObject = readObject(details["setArns"]);
  const ruleNames: JSONObject = readObject(details["ruleNames"]);
  const priorities: JSONObject = readObject(details["priorities"]);
  const arns: Record<string, string> = {};

  for (const key of SET_KEYS) {
    const arn: JSONValue | undefined = setArns[key];

    if (typeof arn !== "string" || !arn) {
      return null;
    }

    arns[key] = arn;
  }

  if (
    typeof ruleNames["block"] !== "string" ||
    typeof ruleNames["challenge"] !== "string"
  ) {
    return null;
  }

  return {
    ruleNames: {
      block: ruleNames["block"] as string,
      challenge: ruleNames["challenge"] as string,
    },
    setArns: arns,
    clientAddress: readClientAddress(row.clientAddress),
    priorities: {
      block: readPriority(priorities["block"], 0),
      challenge: readPriority(priorities["challenge"], 1),
    },
  };
}

export function isCloudWafRuleAddedByOneUptime(
  row: SecurityBlockCloudWaf,
): boolean {
  return readObject(row.ruleDetails as JSONValue)["addsRule"] !== false;
}

export interface ComponentProps {
  row: SecurityBlockCloudWaf;
  onClose: () => void;
}

const CloudWafRuleModal: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const rule: AwsWafBlocklistCodeRule | null = readCloudWafCodeRule(props.row);
  const name: string = props.row.name || "";

  return (
    <Modal
      title={RULE_TITLE}
      description={translator.translateTemplate(
        isCloudWafRuleAddedByOneUptime(props.row)
          ? RULE_ADDED_DESCRIPTION
          : RULE_IN_CODE_DESCRIPTION,
        { name },
      )}
      submitButtonText={CLOSE}
      onSubmit={props.onClose}
      onClose={props.onClose}
    >
      {rule ? (
        <div data-testid={CLOUD_WAF_TEST_IDS.ruleCode}>
          <Tabs
            label={RULE_TABS_LABEL}
            wrap={true}
            onTabChange={() => {}}
            tabs={[
              {
                name: "Terraform",
                isName: true,
                children: (
                  <CodeBlock
                    code={getAwsWafBlocklistTerraform(rule)}
                    language="plaintext"
                    maxHeight="420px"
                  />
                ),
              },
              {
                name: "CloudFormation",
                isName: true,
                children: (
                  <CodeBlock
                    code={getAwsWafBlocklistCloudFormation(rule)}
                    language="yaml"
                    maxHeight="420px"
                  />
                ),
              },
            ]}
          />
        </div>
      ) : (
        <p className="text-sm text-gray-700">
          {translator.translateText(RULE_SETS_NOT_MADE)}
        </p>
      )}
    </Modal>
  );
};

export default CloudWafRuleModal;
