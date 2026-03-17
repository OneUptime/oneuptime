import PageComponentProps from "../../PageComponentProps";
import ObjectID from "Common/Types/ObjectID";
import Navigation from "Common/UI/Utils/Navigation";
import KubernetesCluster from "Common/Models/DatabaseModels/KubernetesCluster";
import Card from "Common/UI/Components/Card/Card";
import React, {
  Fragment,
  FunctionComponent,
  ReactElement,
  useEffect,
  useState,
} from "react";
import ModelAPI from "Common/UI/Utils/ModelAPI/ModelAPI";
import API from "Common/UI/Utils/API/API";
import PageLoader from "Common/UI/Components/Loader/PageLoader";
import ErrorMessage from "Common/UI/Components/ErrorMessage/ErrorMessage";
import { PromiseVoidFunction } from "Common/Types/FunctionTypes";
import MarkdownViewer from "Common/UI/Components/Markdown.tsx/MarkdownViewer";

const KubernetesClusterDocumentation: FunctionComponent<
  PageComponentProps
> = (): ReactElement => {
  const modelId: ObjectID = Navigation.getLastParamAsObjectID(1);

  const [cluster, setCluster] = useState<KubernetesCluster | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [error, setError] = useState<string>("");

  const fetchCluster: PromiseVoidFunction = async (): Promise<void> => {
    setIsLoading(true);
    try {
      const item: KubernetesCluster | null = await ModelAPI.getItem({
        modelType: KubernetesCluster,
        id: modelId,
        select: {
          name: true,
          clusterIdentifier: true,
        },
      });
      setCluster(item);
    } catch (err) {
      setError(API.getFriendlyMessage(err));
    }
    setIsLoading(false);
  };

  useEffect(() => {
    fetchCluster().catch((err: Error) => {
      setError(API.getFriendlyMessage(err));
    });
  }, []);

  if (isLoading) {
    return <PageLoader isVisible={true} />;
  }

  if (error) {
    return <ErrorMessage message={error} />;
  }

  if (!cluster) {
    return <ErrorMessage message="Cluster not found." />;
  }

  const clusterName: string = cluster.clusterIdentifier || cluster.name || "my-cluster";

  const installationMarkdown: string = `
## Prerequisites

- A running Kubernetes cluster (v1.23+)
- \`kubectl\` configured to access your cluster
- \`helm\` v3 installed
- A OneUptime project API key (found in **Project Settings > API Keys**)

## Step 1: Add the OneUptime Helm Repository

\`\`\`bash
helm repo add oneuptime https://helm.oneuptime.com
helm repo update
\`\`\`

## Step 2: Install the Kubernetes Agent

\`\`\`bash
helm install kubernetes-agent oneuptime/kubernetes-agent \\
  --namespace oneuptime-agent \\
  --create-namespace \\
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \\
  --set oneuptime.apiKey="YOUR_API_KEY" \\
  --set clusterName="${clusterName}"
\`\`\`

Replace the following values:
- **YOUR_ONEUPTIME_URL**: The URL of your OneUptime instance (e.g., \`https://oneuptime.example.com\`)
- **YOUR_API_KEY**: Your project API key from OneUptime

## Step 3: Verify the Installation

Check that the agent pods are running:

\`\`\`bash
kubectl get pods -n oneuptime-agent
\`\`\`

You should see a **Deployment** pod (for metrics and events collection) and **DaemonSet** pods (one per node, for log collection):

\`\`\`
NAME                                          READY   STATUS    RESTARTS   AGE
kubernetes-agent-deployment-xxxxx-xxxxx       1/1     Running   0          1m
kubernetes-agent-daemonset-xxxxx              1/1     Running   0          1m
\`\`\`

## Configuration Options

### Namespace Filtering

By default, \`kube-system\` is excluded. To monitor only specific namespaces:

\`\`\`bash
helm install kubernetes-agent oneuptime/kubernetes-agent \\
  --namespace oneuptime-agent \\
  --create-namespace \\
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \\
  --set oneuptime.apiKey="YOUR_API_KEY" \\
  --set clusterName="${clusterName}" \\
  --set "namespaceFilters.include={default,production,staging}"
\`\`\`

### Disable Log Collection

If you only need metrics and events (no pod logs):

\`\`\`bash
helm install kubernetes-agent oneuptime/kubernetes-agent \\
  --namespace oneuptime-agent \\
  --create-namespace \\
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \\
  --set oneuptime.apiKey="YOUR_API_KEY" \\
  --set clusterName="${clusterName}" \\
  --set logs.enabled=false
\`\`\`

### Enable Control Plane Monitoring

For self-managed clusters (not EKS/GKE/AKS), you can enable control plane metrics:

\`\`\`bash
helm install kubernetes-agent oneuptime/kubernetes-agent \\
  --namespace oneuptime-agent \\
  --create-namespace \\
  --set oneuptime.url="YOUR_ONEUPTIME_URL" \\
  --set oneuptime.apiKey="YOUR_API_KEY" \\
  --set clusterName="${clusterName}" \\
  --set controlPlane.enabled=true
\`\`\`

> **Note:** Managed Kubernetes services (EKS, GKE, AKS) typically do not expose control plane metrics. Only enable this for self-managed clusters.

## Upgrading the Agent

\`\`\`bash
helm repo update
helm upgrade kubernetes-agent oneuptime/kubernetes-agent \\
  --namespace oneuptime-agent
\`\`\`

## Uninstalling the Agent

\`\`\`bash
helm uninstall kubernetes-agent --namespace oneuptime-agent
kubectl delete namespace oneuptime-agent
\`\`\`

## What Gets Collected

The OneUptime Kubernetes Agent collects:

| Category | Data |
|----------|------|
| **Node Metrics** | CPU utilization, memory usage, filesystem usage, network I/O |
| **Pod Metrics** | CPU usage, memory usage, network I/O, restarts |
| **Container Metrics** | CPU usage, memory usage per container |
| **Cluster Metrics** | Node conditions, allocatable resources, pod counts |
| **Kubernetes Events** | Warnings, errors, scheduling events |
| **Pod Logs** | stdout/stderr logs from all containers (via DaemonSet) |

## Troubleshooting

### Agent shows "Disconnected"

1. Check that the agent pods are running: \`kubectl get pods -n oneuptime-agent\`
2. Check the agent logs: \`kubectl logs -n oneuptime-agent deployment/kubernetes-agent-deployment\`
3. Verify your OneUptime URL and API key are correct
4. Ensure your cluster can reach the OneUptime instance over the network

### No metrics appearing

1. Check that the cluster identifier matches: this cluster uses **\`${clusterName}\`**
2. Verify the RBAC permissions: \`kubectl get clusterrolebinding | grep kubernetes-agent\`
3. Check the OTel collector logs for export errors
`;

  return (
    <Fragment>
      <Card
        title="Agent Installation Guide"
        description="Follow these steps to install the OneUptime Kubernetes Agent on your cluster."
      >
        <div className="px-2 pb-4">
          <MarkdownViewer text={installationMarkdown} />
        </div>
      </Card>
    </Fragment>
  );
};

export default KubernetesClusterDocumentation;
