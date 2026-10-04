import React, { FunctionComponent, ReactElement, ReactNode } from "react";
import IconProp from "Common/Types/Icon/IconProp";
import Route from "Common/Types/API/Route";
import CodeBlock from "Common/UI/Components/CodeBlock/CodeBlock";
import TableEmptyState, {
  TableEmptyStateAction,
  TableEmptyStateActionStyle,
  TableEmptyStateKind,
} from "Common/UI/Components/Table/TableEmptyState";
import TranslatedSentence from "Common/UI/Components/TranslatedSentence/TranslatedSentence";
import Navigation from "Common/UI/Utils/Navigation";
import { translationKey } from "Common/UI/Utils/TranslateTemplate";
import {
  CLUSTER_NAME_PLACEHOLDER,
  KubernetesMetricsSetup,
  KubernetesMetricsSource,
  getKubernetesMetricsSetup,
  getKubernetesMetricsSetupCommand,
} from "../../Pages/Kubernetes/Utils/KubernetesMetricsSetup";

/*
 * What a Kubernetes cluster's Control Plane or Service Mesh tab shows in
 * place of its charts once they have loaded and found nothing: what is
 * missing, the Helm value that collects it (or that the agent does not),
 * the `helm upgrade` to copy, a way to check again and the docs.
 *
 * Drawn by an EmbeddedMetricCardGroup, so it never shows while the charts
 * are loading, when a query failed, or next to a chart with data.
 */

export const KUBERNETES_METRICS_SETUP_TEST_ID: string =
  "kubernetes-metrics-setup";

const CHECK_AGAIN: string = translationKey("Check again");
const CHECKING: string = translationKey("Checking…");
const VIEW_DOCUMENTATION: string = translationKey("View Documentation");

export interface ComponentProps {
  source: KubernetesMetricsSource;
  // The cluster's name, as its telemetry reports it (k8s.cluster.name).
  clusterName: string;
  // The charts are running their queries again.
  isChecking: boolean;
  onCheckAgain: () => void;
}

function getCodeElement(text: string): ReactElement {
  return (
    <code className="rounded bg-gray-100 px-1 py-0.5 font-mono text-xs text-gray-700">
      {text}
    </code>
  );
}

const KubernetesMetricsSetupEmptyState: FunctionComponent<ComponentProps> = (
  props: ComponentProps,
): ReactElement => {
  const setup: KubernetesMetricsSetup = getKubernetesMetricsSetup(
    props.source,
  );
  const command: string | null = getKubernetesMetricsSetupCommand(
    props.source,
  );

  const slots: Record<string, ReactNode> = {};
  for (const [placeholder, code] of Object.entries(setup.code)) {
    slots[placeholder] = getCodeElement(code);
  }
  slots[CLUSTER_NAME_PLACEHOLDER] = getCodeElement(props.clusterName);

  const actions: Array<TableEmptyStateAction> = [
    {
      title: props.isChecking ? CHECKING : CHECK_AGAIN,
      icon: IconProp.Refresh,
      isLoading: props.isChecking,
      onClick: props.onCheckAgain,
      dataTestId: `${KUBERNETES_METRICS_SETUP_TEST_ID}-check-again`,
    },
    {
      title: VIEW_DOCUMENTATION,
      icon: IconProp.Book,
      style: TableEmptyStateActionStyle.Link,
      onClick: () => {
        Navigation.navigate(Route.fromString(setup.docsRoute), {
          openInNewTab: true,
        });
      },
      dataTestId: `${KUBERNETES_METRICS_SETUP_TEST_ID}-docs`,
    },
  ];

  return (
    <div
      data-testid={`${KUBERNETES_METRICS_SETUP_TEST_ID}-${setup.source}`}
      data-metrics-source={setup.source}
    >
      <TableEmptyState
        kind={TableEmptyStateKind.Empty}
        icon={IconProp.ChartBar}
        title={setup.title}
        description={
          <TranslatedSentence template={setup.description} slots={slots} />
        }
        body={
          command ? (
            <div data-testid={`${KUBERNETES_METRICS_SETUP_TEST_ID}-command`}>
              <CodeBlock language="bash" code={command} />
            </div>
          ) : undefined
        }
        actions={actions}
        dataTestId={KUBERNETES_METRICS_SETUP_TEST_ID}
      />
    </div>
  );
};

export default KubernetesMetricsSetupEmptyState;
