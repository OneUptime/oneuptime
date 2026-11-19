import React, { FunctionComponent, ReactElement } from "react";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import {
  KubernetesCostEngineInfo,
  KubernetesCostPricingSource,
  getKubernetesCostProviderDisplayName,
} from "Common/Types/Kubernetes/KubernetesCostPricing";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import Icon from "Common/UI/Components/Icon/Icon";
import InlineSeparator from "Common/UI/Components/InlineSeparator/InlineSeparator";
import Link from "Common/UI/Components/Link/Link";
import InfoTooltip from "Common/UI/Components/Tooltip/InfoTooltip";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { getKubernetesAgentUpgradeCommand } from "../Utils/DocumentationMarkdown";

/*
 * WHERE A CLUSTER'S PRICES COME FROM (#9634), AND WHICH ENGINE (#9633).
 *
 * One quiet line under a cluster's cost figures, on its overview's Cost
 * card and its Costs page: "Prices: AWS list prices", "Prices: your rate
 * card", or "Prices: OpenCost's default rates. Set your own rates" - the
 * last in amber, because on-premises, on bare metal, on kind or k3s those
 * rates can be far from what the hardware costs. When the cost agent read
 * the cluster's own Kubecost or OpenCost, the line names it.
 *
 * And, only while the chart still bundles an OpenCost the agent does not
 * read (it found the cluster's own), one amber note with the upgrade that
 * stops running it: the one exception here someone has to act on.
 *
 * Nothing renders for a cluster whose agent says nothing (older than this)
 * or whose engine could not say.
 */

export const KUBERNETES_COST_PRICING_TEST_ID: string =
  "kubernetes-cost-pricing";

// The cost docs' section on a rate card of your own.
export const KUBERNETES_COST_RATE_CARD_DOCS_ROUTE: string =
  "/docs/en/telemetry/kubernetes-cost#on-prem-and-bare-metal-pricing";

// The upgrade that stops bundling an engine the cluster does not need.
export const KUBERNETES_COST_ENGINE_AUTO_COMMAND: string =
  getKubernetesAgentUpgradeCommand(["--set cost.engine.url=auto"]);

export const KUBERNETES_COST_PRICING_DESCRIPTIONS: Record<
  "listPrices" | "rateCard" | "defaultRates",
  string
> = {
  listPrices: translationKey(
    "Your cost engine prices the nodes at the cloud's public list prices: your discounts, savings plans and committed use are not in them.",
  ),
  rateCard: translationKey(
    "Your cost engine prices the nodes at rates someone set for it, such as the chart's cost.opencost.customPricing.",
  ),
  defaultRates: translationKey(
    "OpenCost recognised no cloud here, so it prices every node at its built-in default rates, which can be far from what your hardware costs. A rate card of your own replaces them.",
  ),
};

export interface ComponentProps {
  engine: KubernetesCostEngineInfo | null;
  // Spacing from what it sits under, applied only when it draws anything.
  className?: string | undefined;
}

const KubernetesCostPricingNote: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const engine: KubernetesCostEngineInfo | null = props.engine;

  if (!engine) {
    return <></>;
  }

  let prices: ReactElement | null = null;
  let description: string = "";
  let isWarning: boolean = false;

  if (
    engine.pricingSource === KubernetesCostPricingSource.ListPrices &&
    engine.pricingProvider
  ) {
    description = KUBERNETES_COST_PRICING_DESCRIPTIONS.listPrices;
    prices = (
      <span>
        {translator.translateTemplate("Prices: {{provider}} list prices", {
          provider: getKubernetesCostProviderDisplayName(
            engine.pricingProvider,
          ),
        })}
      </span>
    );
  } else if (engine.pricingSource === KubernetesCostPricingSource.RateCard) {
    description = KUBERNETES_COST_PRICING_DESCRIPTIONS.rateCard;
    prices = <span>{translator.translateText("Prices: your rate card")}</span>;
  } else if (
    engine.pricingSource === KubernetesCostPricingSource.DefaultRates
  ) {
    description = KUBERNETES_COST_PRICING_DESCRIPTIONS.defaultRates;
    isWarning = true;
    prices = (
      <TranslatedSentence
        template="Prices: OpenCost's default rates. {{link}}"
        slots={{
          link: (
            <Link
              to={Route.fromString(KUBERNETES_COST_RATE_CARD_DOCS_ROUTE)}
              openInNewTab={true}
              className="font-medium text-indigo-600 hover:text-indigo-800"
              dataTestId={`${KUBERNETES_COST_PRICING_TEST_ID}-rate-card-docs`}
            >
              {translator.translateText("Set your own rates")}
            </Link>
          ),
        }}
      />
    );
  }

  // The cluster's own engine, when the agent found and read one.
  const ownEngine: ReactElement | null =
    engine.service && engine.engine ? (
      <span data-testid={`${KUBERNETES_COST_PRICING_TEST_ID}-engine`}>
        {translator.translateTemplate(
          "Priced by your {{engine}} ({{service}})",
          {
            engine: engine.engine,
            service: engine.service,
          },
        )}
      </span>
    ) : null;

  if (!prices && !ownEngine && !engine.bundledEngineUnused) {
    return <></>;
  }

  return (
    <div
      className={`space-y-3 ${props.className || ""}`}
      data-testid={KUBERNETES_COST_PRICING_TEST_ID}
    >
      {prices || ownEngine ? (
        <div
          className={`flex flex-wrap items-center gap-x-2 gap-y-1 text-sm ${
            isWarning ? "text-amber-700" : "text-gray-600"
          }`}
          data-testid={`${KUBERNETES_COST_PRICING_TEST_ID}-line`}
        >
          <Icon
            icon={IconProp.Tag}
            className={`h-4 w-4 flex-shrink-0 ${
              isWarning ? "text-amber-500" : "text-gray-400"
            }`}
          />
          {prices}
          {prices ? (
            <InfoTooltip
              label="Prices"
              text={description}
              dataTestId={`${KUBERNETES_COST_PRICING_TEST_ID}-about`}
            />
          ) : (
            <></>
          )}
          {prices && ownEngine ? (
            <span aria-hidden="true" className="text-gray-400">
              <InlineSeparator markOnly />
            </span>
          ) : (
            <></>
          )}
          {ownEngine}
        </div>
      ) : (
        <></>
      )}

      {engine.bundledEngineUnused && engine.service ? (
        <div data-testid={`${KUBERNETES_COST_PRICING_TEST_ID}-bundled-unused`}>
          <Alert
            type={AlertType.WARNING}
            strongTitle="The bundled OpenCost is not needed"
            title={
              <div className="space-y-3">
                <p>
                  {translator.translateTemplate(
                    "This cluster runs its own {{engine}} ({{service}}), and the cost agent reads that. Stop running the OpenCost and Prometheus the agent bundled:",
                    {
                      engine: engine.engine || "OpenCost",
                      service: engine.service,
                    },
                  )}
                </p>
                <CodeBlock
                  language="bash"
                  code={KUBERNETES_COST_ENGINE_AUTO_COMMAND}
                  showCopyButton={true}
                />
              </div>
            }
          />
        </div>
      ) : (
        <></>
      )}
    </div>
  );
};

export default KubernetesCostPricingNote;
