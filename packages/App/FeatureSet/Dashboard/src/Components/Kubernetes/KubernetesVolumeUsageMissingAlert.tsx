import React, { FunctionComponent, ReactElement } from "react";
import Alert, { AlertType } from "Common/UI/Components/Alerts/Alert";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import { getKubernetesAgentChartUpgradeCommand } from "../../Pages/Kubernetes/Utils/DocumentationMarkdown";

/*
 * What a cluster's Persistent Volume Claims list says when not one claim
 * reports its usage (#9539): the agent predates the claim names it now
 * sends with each volume's usage, or its volume metrics are off. One amber
 * note above the list, with the upgrade to copy, only while that is so: a
 * cluster with even one claim's usage never shows it.
 */

export const KUBERNETES_VOLUME_USAGE_MISSING_TEST_ID: string =
  "kubernetes-volume-usage-missing";

// The Helm value that sends each volume's usage, as values.yaml names it.
export const KUBERNETES_VOLUME_METRICS_VALUE: string =
  "kubeletstats.volumeMetrics.enabled";

const KubernetesVolumeUsageMissingAlert: FunctionComponent =
  (): ReactElement => {
    return (
      <div
        className="mb-5"
        data-testid={KUBERNETES_VOLUME_USAGE_MISSING_TEST_ID}
      >
        <Alert
          type={AlertType.WARNING}
          strongTitle="No claim reports its usage yet"
          title={
            <div className="space-y-3">
              <p>
                <TranslatedSentence
                  template="Update the kubernetes-agent Helm chart, which reports how much of each claim is used and free while {{setting}} is true, the default:"
                  slots={{
                    setting: (
                      <code className="rounded bg-amber-100 px-1 py-0.5 font-mono text-xs">
                        {KUBERNETES_VOLUME_METRICS_VALUE}
                      </code>
                    ),
                  }}
                />
              </p>
              <CodeBlock
                language="bash"
                code={getKubernetesAgentChartUpgradeCommand()}
                showCopyButton={true}
              />
            </div>
          }
        />
      </div>
    );
  };

export default KubernetesVolumeUsageMissingAlert;
