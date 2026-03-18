export function getKubernetesInstallationMarkdown(
  clusterName: string,
): string {
  return `
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
- **clusterName**: A unique identifier for your cluster (e.g., \`production-us-east\`)

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

Once the agent connects, your cluster will appear automatically in the Kubernetes section.

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
}
