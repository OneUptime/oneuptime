# Kubernetes Agent Install करें

OneUptime Kubernetes agent आपके Kubernetes cluster से cluster metrics, events और pod logs एकत्र करता है और उन्हें OneUptime को ship करता है। यह एक Helm chart के रूप में वितरित है।

## Quick start

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com
helm repo update

helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<YOUR_API_KEY> \
  --set clusterName=<A_UNIQUE_NAME_FOR_THIS_CLUSTER>
```

कुछ मिनटों के भीतर आपका cluster OneUptime में दिखाई देगा।

## अपने cluster के लिए सही preset चुनें

विभिन्न Kubernetes distributions के अलग-अलग constraints हैं — सबसे notably, workloads `hostPath` volumes mount कर सकते हैं या नहीं। आपको security docs पढ़वाने के बजाय, chart एक single top-level option expose करता है: `preset`।

| Preset | किसके लिए उपयोग करें | Log collection | Notes |
| --- | --- | --- | --- |
| `standard` (default) | Self-managed, **EKS on EC2**, **GKE Standard**, **AKS**, minikube, kind, k3s | DaemonSet जो hostPath के माध्यम से `/var/log/pods` पढ़ता है | सबसे कम overhead। इन platforms पर hostPath उपलब्ध है। |
| `gke-autopilot` | **GKE Autopilot** | Kubernetes API tailer (Deployment) | Autopilot पर hostPath blocked है। Autopilot के Pod Security Standards pass करने वाला hardened security context सेट करता है। |
| `eks-fargate` | **EKS Fargate** | Kubernetes API tailer (Deployment) | `gke-autopilot` के समान। Fargate hostPath और DaemonSets को block करता है। |

यदि आप सुनिश्चित नहीं हैं, तो `preset` unset छोड़ दें — आपको `standard` defaults मिलेंगे। यदि आपका cluster `hostPath` mention करने वाले Pod Security policy error के साथ install reject कर दे, तो `gke-autopilot` (या EKS Fargate पर `eks-fargate`) पर switch करें और re-install करें।

### उदाहरण

**GKE Standard, EKS on EC2, self-managed, या AKS:**

```bash
helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<YOUR_API_KEY> \
  --set clusterName=prod
```

**GKE Autopilot:**

```bash
helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<YOUR_API_KEY> \
  --set clusterName=prod-gke-autopilot \
  --set preset=gke-autopilot
```

**EKS Fargate:**

```bash
helm install oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent --create-namespace \
  --set oneuptime.url=https://oneuptime.com \
  --set oneuptime.apiKey=<YOUR_API_KEY> \
  --set clusterName=prod-eks-fargate \
  --set preset=eks-fargate
```

## दो log-collection modes कैसे अलग हैं

Under the hood, `preset` `logs.mode` सेट करता है — और यदि आपको preset default override करने की आवश्यकता हो तो आप इसे directly भी सेट कर सकते हैं।

### DaemonSet mode (`logs.mode: daemonset`)

एक DaemonSet प्रति node एक OpenTelemetry Collector pod चलाता है। यह hostPath volume के माध्यम से `/var/log/pods/` के अंतर्गत log files tail करता है और उन्हें OTLP पर forward करता है।

- **Pros:** सबसे कम overhead, nodes के साथ linearly scale होता है, Kubernetes API server पर कोई load नहीं, log rotation handle करता है।
- **Cons:** hostPath आवश्यक है, DaemonSets schedule करने की क्षमता आवश्यक है — दोनों GKE Autopilot और EKS Fargate पर उपलब्ध नहीं।

### API mode (`logs.mode: api`)

एक single-replica Deployment (`oneuptime/kubernetes-log-tailer` image) container logs stream करने के लिए Kubernetes API उपयोग करता है — वही endpoint जो `kubectl logs -f` उपयोग करता है। कोई hostPath नहीं, कोई host access नहीं, कोई DaemonSet नहीं।

- **Pros:** GKE Autopilot, EKS Fargate और किसी भी cluster पर काम करता है जो hostPath block करता है या `restricted` Pod Security Standard enforce करता है।
- **Cons:** हर container stream `kube-apiserver` से एक long-lived connection है। practice में एक replica कुछ हजार containers आराम से handle करता है। बहुत large clusters के लिए, प्रत्येक replica पर `logs.api.replicas` plus `namespaceFilters.include` का उपयोग करके namespace से shard करें।

### आपको कौन सा उपयोग करना चाहिए?

यदि hostPath काम करता है, तो DaemonSet उपयोग करें। बाकी सब जगह, API mode उपयोग करें। `preset` setting आपके लिए सही चुनती है।

आप `--set logs.enabled=false` से log collection पूरी तरह अक्षम भी कर सकते हैं और इसके बजाय OpenTelemetry SDKs के माध्यम से application logs ship कर सकते हैं। [OpenTelemetry](/docs/telemetry/open-telemetry) docs देखें।

## Common options

| Option | Default | विवरण |
| --- | --- | --- |
| `preset` | (empty — `standard` के रूप में treated) | ऊपर table देखें। |
| `oneuptime.url` | *(आवश्यक)* | आपके OneUptime instance का URL। |
| `oneuptime.apiKey` | *(आवश्यक)* | Project API key (Settings → API Keys)। |
| `clusterName` | *(आवश्यक)* | इस cluster के लिए unique name। हर record पर `k8s.cluster.name` के रूप में stamped। |
| `namespaceFilters.include` | `[]` | यदि सेट है, तो केवल इन namespaces को monitor किया जाता है। |
| `namespaceFilters.exclude` | `["kube-system"]` | skip करने के लिए Namespaces। |
| `logs.enabled` | `true` | log collection on या off करें। |
| `logs.mode` | (`preset` से derived) | `daemonset`, `api`, या `disabled`। preset को override करता है। |
| `logs.api.replicas` | `1` | log-tailer Deployment replicas की संख्या (केवल API mode में)। |
| `controlPlane.enabled` | `false` | etcd/api-server/scheduler/controller-manager scrape करें। केवल self-managed clusters — managed offerings (EKS/GKE/AKS) आमतौर पर इन endpoints को expose नहीं करते। |

पूरी list के लिए [chart का `values.yaml`](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/kubernetes-agent/values.yaml) देखें।

## Upgrading

```bash
helm repo update
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values
```

`--reuse-values` आपकी existing configuration रखता है; इसके ऊपर कोई भी नए `--set` overrides pass करें।

## Uninstalling

```bash
helm uninstall oneuptime-agent --namespace oneuptime-kubernetes-agent
kubectl delete namespace oneuptime-kubernetes-agent
```

## समस्या निवारण

### Install "hostPath volumes are not allowed" के साथ fail होता है

आपका cluster hostPath block करता है। एक API-mode preset पर switch करें:

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values \
  --set preset=gke-autopilot   # या eks-fargate
```

### OneUptime में कोई logs नहीं दिखते

agent pods जांचें:

```bash
kubectl get pods -n oneuptime-kubernetes-agent
kubectl logs -n oneuptime-kubernetes-agent -l app.kubernetes.io/part-of=oneuptime --tail=200
```

API mode में, log-tailer pod port 13133 पर `/healthz` expose करता है — export status snapshot के लिए `kubectl port-forward` के माध्यम से इसे hit करें।

### मेरे cluster में एक log-tailer replica के लिए बहुत अधिक pods हैं (केवल API mode)

namespaces shard करके horizontally scale करें। प्रति namespace group एक बार deploy करें:

```bash
helm install oneuptime-agent-ns-a oneuptime/kubernetes-agent \
  --set preset=gke-autopilot \
  --set namespaceFilters.include={app-a,app-b} \
  ...
```

वैकल्पिक रूप से, `logs.api.replicas` बढ़ाएं — लेकिन ध्यान दें कि प्रत्येक replica सभी allowed namespaces process करता है, इसलिए deduplication के लिए आपको अभी भी namespace sharding की आवश्यकता है।
