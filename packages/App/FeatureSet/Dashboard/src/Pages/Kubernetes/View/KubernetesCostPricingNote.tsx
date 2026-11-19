import React, { FunctionComponent, ReactElement } from "react";
import Route from "Common/Types/API/Route";
import IconProp from "Common/Types/Icon/IconProp";
import {
  KubernetesCostMemoryPeaksSource,
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
import { writeReaderMoment } from "Common/UI/Utils/ReaderMoments";
import { Translator, translationKey } from "Common/UI/Utils/TranslateTemplate";
import useTranslator from "Common/UI/Utils/UseTranslator";
import { getKubernetesAgentUpgradeCommand } from "../Utils/DocumentationMarkdown";
import { KubernetesCostEngineView } from "../Utils/KubernetesCostEngine";

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
 * A Kubecost that reads the cloud's bill (#9851) reconciles its prices with
 * what was paid about two days after each hour, and the cost agent ships
 * each hour as it closes, then brings the reconciled figures in (#9969).
 * Before any reconciled hour has arrived the line says "Prices: AWS list
 * prices, before Kubecost reconciles them with your bill"; after, "Prices:
 * reconciled with your AWS bill up to Nov 17, 2026, 3:00 PM, list prices
 * after", or, when every hour of the window is, just "reconciled with your
 * AWS bill".
 *
 * And, only while the chart still bundles an OpenCost the agent does not
 * read (it found the cluster's own), one amber note with the upgrade that
 * stops running it: the one exception here someone has to act on. When
 * memory right-sizing reads its peaks from the bundled Prometheus (Kubecost 3
 * reads none, #9970), the upgrade names another Prometheus too, and the note
 * says to keep the bundled engine without one.
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

/*
 * The same upgrade when memory right-sizing reads its peaks from the bundled
 * Prometheus (#9970): it names another, or the peaks stop with it.
 */
export const KUBERNETES_COST_ENGINE_AUTO_WITH_PROMETHEUS_COMMAND: string =
  getKubernetesAgentUpgradeCommand([
    "--set cost.engine.url=auto",
    "--set cost.engine.prometheusUrl=<prometheus-url>",
  ]);

export const KUBERNETES_COST_PRICING_DESCRIPTIONS: Record<
  | "listPrices"
  | "billingIntegration"
  | "billingReconciled"
  | "rateCard"
  | "defaultRates",
  string
> = {
  listPrices: translationKey(
    "Your cost engine prices the nodes at the cloud's public list prices: your discounts, savings plans and committed use are not in them.",
  ),
  billingIntegration: translationKey(
    "Your Kubecost reads your cloud bill and reconciles its prices with what you paid, about two days after each hour. No reconciled hour has reached OneUptime yet: these are the cloud's public list prices.",
  ),
  billingReconciled: translationKey(
    "Your Kubecost reads your cloud bill and reconciles its prices with what you paid, about two days after each hour, and OneUptime brings each reconciled hour in. Later hours are at the cloud's public list prices until then.",
  ),
  rateCard: translationKey(
    "Your cost engine prices the nodes at rates someone set for it, such as the chart's cost.opencost.customPricing.",
  ),
  defaultRates: translationKey(
    "OpenCost recognised no cloud here, so it prices every node at its built-in default rates, which can be far from what your hardware costs. A rate card of your own replaces them.",
  ),
};

export interface ComponentProps {
  engine: KubernetesCostEngineView | null;
  // Spacing from what it sits under, applied only when it draws anything.
  className?: string | undefined;
}

/*
 * How far a Kubecost that reads the cloud's bill has reconciled the window's
 * figures (#9969): all of them, up to a time, or none yet.
 */
export const getKubernetesCostReconciliation: (
  engine: KubernetesCostEngineView,
) =>
  | { reconciled: "all" }
  | { reconciled: "upTo"; through: Date }
  | { reconciled: "none" } = (
  engine: KubernetesCostEngineView,
):
  | { reconciled: "all" }
  | { reconciled: "upTo"; through: Date }
  | { reconciled: "none" } => {
  const through: Date | null | undefined = engine.reconciledThrough;

  if (!through) {
    return { reconciled: "none" };
  }

  if (
    engine.pricedThrough &&
    through.getTime() >= engine.pricedThrough.getTime()
  ) {
    return { reconciled: "all" };
  }

  return { reconciled: "upTo", through };
};

const KubernetesCostPricingNote: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const translator: Translator = useTranslator();
  const engine: KubernetesCostEngineView | null = props.engine;

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
  } else if (
    engine.pricingSource === KubernetesCostPricingSource.BillingIntegration &&
    engine.pricingProvider
  ) {
    const provider: string = getKubernetesCostProviderDisplayName(
      engine.pricingProvider,
    );
    const reconciliation:
      | { reconciled: "all" }
      | { reconciled: "upTo"; through: Date }
      | { reconciled: "none" } = getKubernetesCostReconciliation(engine);

    if (reconciliation.reconciled === "all") {
      description = KUBERNETES_COST_PRICING_DESCRIPTIONS.billingReconciled;
      prices = (
        <span data-testid={`${KUBERNETES_COST_PRICING_TEST_ID}-reconciled`}>
          {translator.translateTemplate(
            "Prices: reconciled with your {{provider}} bill",
            { provider },
          )}
        </span>
      );
    } else if (reconciliation.reconciled === "upTo") {
      description = KUBERNETES_COST_PRICING_DESCRIPTIONS.billingReconciled;
      prices = (
        <span data-testid={`${KUBERNETES_COST_PRICING_TEST_ID}-reconciled`}>
          {translator.translateTemplate(
            "Prices: reconciled with your {{provider}} bill up to {{time}}, list prices after",
            {
              provider,
              time: writeReaderMoment(reconciliation.through),
            },
          )}
        </span>
      );
    } else {
      description = KUBERNETES_COST_PRICING_DESCRIPTIONS.billingIntegration;
      prices = (
        <span>
          {translator.translateTemplate(
            "Prices: {{provider}} list prices, before Kubecost reconciles them with your bill",
            { provider },
          )}
        </span>
      );
    }
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
              engine.memoryPeaksFrom ===
              KubernetesCostMemoryPeaksSource.Bundled ? (
                /*
                 * #9970: memory right-sizing reads its peaks from the
                 * bundled Prometheus (Kubecost 3 reads none), so the upgrade
                 * that stops it names another, or the peaks stop with it.
                 */
                <div
                  className="space-y-3"
                  data-testid={`${KUBERNETES_COST_PRICING_TEST_ID}-bundled-peaks`}
                >
                  <p>
                    {translator.translateTemplate(
                      "This cluster runs its own {{engine}} ({{service}}), and the cost agent reads that. Memory right-sizing still reads its peaks from the bundled Prometheus, as the agent found none your {{engine}} reads. To stop running both, name a Prometheus that scrapes cAdvisor in the same upgrade:",
                      {
                        engine: engine.engine || "OpenCost",
                        service: engine.service,
                      },
                    )}
                  </p>
                  <CodeBlock
                    language="bash"
                    code={KUBERNETES_COST_ENGINE_AUTO_WITH_PROMETHEUS_COMMAND}
                    showCopyButton={true}
                  />
                  <p>
                    {translator.translateText(
                      "Without another Prometheus, keep the bundled engine: memory recommendations need it.",
                    )}
                  </p>
                </div>
              ) : (
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
              )
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
