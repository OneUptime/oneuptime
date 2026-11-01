import {
  CheckRemediation,
  DataSecurityCheckInfo,
  fillRemediationText,
  getCheckRemediation,
} from "Common/Types/DataSecurity/DataSecurityCheckCatalog";
import {
  DataStoreKind,
  isDataStoreKind,
} from "Common/Types/DataSecurity/DataStoreKind";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import { Tab } from "Common/UI/Components/Tabs/Tab";
import Tabs from "Common/UI/Components/Tabs/Tabs";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";

export interface ComponentProps {
  check: DataSecurityCheckInfo;
  // The store's kind: which cloud's steps, command and Terraform to show.
  kind: string | undefined;
  storeName: string;
  region?: string | undefined;
}

export const REMEDIATION_UNKNOWN: string = translationKey(
  "There are no steps for this kind of store yet. The check's description says what has to change.",
);

// The tabs' names, in their order.
export const REMEDIATION_TAB_STEPS: string = translationKey("Console steps");
export const REMEDIATION_TAB_CLI: string = "CLI";
export const REMEDIATION_TAB_TERRAFORM: string = "Terraform";

/*
 * How to fix a failing check on this store: the console steps, the CLI
 * command and the Terraform, for the store's own kind (then its cloud,
 * then any store - getCheckRemediation), with the store's name and region
 * filled in. The command and the Terraform are code, each with its copy
 * button; the store's name is placed as text, never as markup.
 */
const IssueRemediation: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const kind: DataStoreKind | undefined = isDataStoreKind(props.kind)
    ? props.kind
    : undefined;
  const remediation: CheckRemediation | undefined = kind
    ? getCheckRemediation(props.check, kind)
    : props.check.remediation.default;

  if (!remediation) {
    return (
      <p className="text-sm text-gray-600">
        {translator.translateText(REMEDIATION_UNKNOWN)}
      </p>
    );
  }

  const fill: (text: string) => string = (text: string): string => {
    return fillRemediationText(text, {
      name: props.storeName,
      region: props.region,
    });
  };

  const tabs: Array<Tab> = [
    {
      name: REMEDIATION_TAB_STEPS,
      children: (
        <ol
          className="list-decimal space-y-2 ps-5 text-sm leading-6 text-gray-700"
          data-testid="data-security-remediation-steps"
        >
          {remediation.steps.map(
            (step: string, index: number): ReactElement => {
              return (
                <li key={index} className="[overflow-wrap:anywhere]">
                  {fill(translator.translateText(step) || step)}
                </li>
              );
            },
          )}
        </ol>
      ),
    },
  ];

  if (remediation.cli) {
    tabs.push({
      name: REMEDIATION_TAB_CLI,
      isName: true,
      children: (
        <CodeBlock
          code={fill(remediation.cli)}
          language="bash"
          wrapLongLines={true}
        />
      ),
    });
  }

  if (remediation.terraform) {
    tabs.push({
      name: REMEDIATION_TAB_TERRAFORM,
      isName: true,
      children: (
        <CodeBlock code={fill(remediation.terraform)} language="plaintext" />
      ),
    });
  }

  return (
    <Tabs
      tabs={tabs}
      wrap={true}
      onTabChange={() => {
        // Each tab draws its own panel.
      }}
    />
  );
};

export default IssueRemediation;
