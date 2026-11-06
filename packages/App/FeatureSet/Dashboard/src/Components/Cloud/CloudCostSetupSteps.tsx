import {
  CloudProvider,
  getCloudProviderLabel,
} from "Common/Types/Cloud/CloudPlatform";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import React, { FunctionComponent, ReactElement } from "react";
import { cloudConnectionDocsUrl } from "./Connect/CloudConnectApi";
import CloudConnectionLogo from "./Connect/CloudConnectionLogo";
import {
  COST_SETUP_DOCS_PATHS,
  COST_SETUP_STEPS,
  SAVINGS_SETUP_DOCS_PATHS,
  SAVINGS_SETUP_STEPS,
} from "./CloudCostWords";

/*
 * What to do so a cloud's costs - or its ways to spend less - are read: one
 * line per cloud the project has accounts in, with the step in a sentence
 * and the guide's section for it. Before any account's costs come in it is
 * what Cloud's Spend card, Costs and Savings show.
 */

export const READ_THE_GUIDE: string = translationKey("Read the guide");

// The clouds of a set of accounts, in one order; every cloud for none.
export function getCloudProvidersOf(
  accounts: Array<{ provider: string }>,
): Array<CloudProvider> {
  const order: Array<CloudProvider> = [
    CloudProvider.AWS,
    CloudProvider.Azure,
    CloudProvider.GCP,
  ];
  const present: Set<string> = new Set(
    accounts.map((account: { provider: string }): string => {
      return account.provider;
    }),
  );
  const found: Array<CloudProvider> = order.filter(
    (provider: CloudProvider): boolean => {
      return present.has(provider);
    },
  );

  return found.length > 0 ? found : order;
}

export interface ComponentProps {
  providers: Array<CloudProvider>;
  kind: "costs" | "savings";
  testId?: string | undefined;
}

const CloudCostSetupSteps: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const steps: Readonly<Record<CloudProvider, string>> =
    props.kind === "costs" ? COST_SETUP_STEPS : SAVINGS_SETUP_STEPS;
  const docs: Readonly<Record<CloudProvider, string>> =
    props.kind === "costs" ? COST_SETUP_DOCS_PATHS : SAVINGS_SETUP_DOCS_PATHS;

  return (
    <ul
      className="space-y-4"
      data-testid={props.testId || "cloud-cost-setup-steps"}
    >
      {props.providers.map((provider: CloudProvider): ReactElement => {
        return (
          <li
            key={provider}
            className="flex items-start gap-3"
            data-testid="cloud-cost-setup-step"
            data-provider={provider}
          >
            <CloudConnectionLogo provider={provider} size="sm" />
            <div className="min-w-0 text-sm">
              <div className="font-medium text-gray-900">
                <bdi>{getCloudProviderLabel(provider)}</bdi>
              </div>
              <p className="mt-0.5 text-gray-600">
                {translator.translateText(steps[provider])}
              </p>
              <a
                href={cloudConnectionDocsUrl(docs[provider]).toString()}
                target="_blank"
                rel="noopener noreferrer"
                className="mt-1 inline-flex text-xs font-medium text-indigo-600 hover:text-indigo-700"
              >
                {translator.translateText(READ_THE_GUIDE)}
              </a>
            </div>
          </li>
        );
      })}
    </ul>
  );
};

export default CloudCostSetupSteps;
