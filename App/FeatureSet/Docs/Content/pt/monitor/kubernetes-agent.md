# Instalar o Agente Kubernetes

O agente Kubernetes do OneUptime coleta métricas, eventos e logs de pods do seu cluster Kubernetes e os envia para o OneUptime. Ele é distribuído como um Helm chart.

## Início Rápido

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

Seu cluster aparecerá no OneUptime em alguns minutos.

## Escolha a Predefinição Certa para Seu Cluster

Diferentes distribuições do Kubernetes têm restrições diferentes — principalmente se as cargas de trabalho podem montar volumes `hostPath`. Em vez de fazer você ler documentos de segurança, o chart expõe uma única opção de nível superior: `preset`.

| Predefinição | Use para | Coleta de logs | Notas |
| --- | --- | --- | --- |
| `standard` (padrão) | Auto-gerenciado, **EKS no EC2**, **GKE Standard**, **AKS**, minikube, kind, k3s | DaemonSet lendo `/var/log/pods` via hostPath | Menor overhead. hostPath está disponível nessas plataformas. |
| `gke-autopilot` | **GKE Autopilot** | Tailer da API Kubernetes (Deployment) | hostPath está bloqueado no Autopilot. Define um contexto de segurança reforçado que passa nos Padrões de Segurança de Pod do Autopilot. |
| `eks-fargate` | **EKS Fargate** | Tailer da API Kubernetes (Deployment) | O mesmo que `gke-autopilot`. O Fargate bloqueia hostPath e DaemonSets. |

Se não tiver certeza, deixe `preset` sem definir — você obtém os padrões `standard`. Se o seu cluster rejeitar a instalação com um erro de política de segurança de Pod mencionando `hostPath`, mude para `gke-autopilot` (ou `eks-fargate` no EKS Fargate) e reinstale.

### Exemplos

**GKE Standard, EKS no EC2, auto-gerenciado ou AKS:**

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

## Como os Dois Modos de Coleta de Logs Diferem

Por baixo, `preset` define `logs.mode` — e você também pode defini-lo diretamente se precisar substituir o padrão da predefinição.

### Modo DaemonSet (`logs.mode: daemonset`)

Um DaemonSet executa um pod do Coletor OpenTelemetry por nó. Ele acompanha arquivos de log em `/var/log/pods/` via um volume hostPath e os encaminha via OTLP.

- **Vantagens:** menor overhead, escala linearmente com os nós, sem carga no servidor de API do Kubernetes, lida com rotação de logs.
- **Desvantagens:** requer hostPath, requer a capacidade de agendar DaemonSets — ambos indisponíveis no GKE Autopilot e EKS Fargate.

### Modo API (`logs.mode: api`)

Um Deployment de réplica única (a imagem `oneuptime/kubernetes-log-tailer`) usa a API do Kubernetes para transmitir logs de contêineres — o mesmo endpoint que `kubectl logs -f` usa. Sem hostPath, sem acesso ao host, sem DaemonSet.

- **Vantagens:** funciona no GKE Autopilot, EKS Fargate e qualquer cluster que bloqueie hostPath ou imponha o Padrão de Segurança de Pod `restricted`.
- **Desvantagens:** cada stream de contêiner é uma conexão de longa duração com `kube-apiserver`. Na prática, uma réplica lida confortavelmente com alguns milhares de contêineres. Para clusters muito grandes, distribua por namespace usando `logs.api.replicas` mais `namespaceFilters.include` em cada réplica.

### Qual deve ser usado?

Se hostPath funcionar, use DaemonSet. Em todos os outros lugares, use o modo API. A configuração `preset` escolhe o certo para você.

Você também pode desabilitar a coleta de logs completamente com `--set logs.enabled=false` e enviar logs de aplicativos via SDKs do OpenTelemetry. Consulte a documentação do [OpenTelemetry](/docs/telemetry/open-telemetry).

## Opções Comuns

| Opção | Padrão | Descrição |
| --- | --- | --- |
| `preset` | (vazio — tratado como `standard`) | Consulte a tabela acima. |
| `oneuptime.url` | *(obrigatório)* | URL da sua instância do OneUptime. |
| `oneuptime.apiKey` | *(obrigatório)* | Chave de API do projeto (Configurações → Chaves de API). |
| `clusterName` | *(obrigatório)* | Nome único para este cluster. Estampado como `k8s.cluster.name` em cada registro. |
| `namespaceFilters.include` | `[]` | Se definido, apenas esses namespaces são monitorados. |
| `namespaceFilters.exclude` | `["kube-system"]` | Namespaces a ignorar. |
| `logs.enabled` | `true` | Ativar ou desativar a coleta de logs. |
| `logs.mode` | (derivado de `preset`) | `daemonset`, `api` ou `disabled`. Substitui a predefinição. |
| `logs.api.replicas` | `1` | Número de réplicas do Deployment do log-tailer (somente no modo API). |
| `controlPlane.enabled` | `false` | Scrape de etcd / api-server / scheduler / controller-manager. Somente clusters auto-gerenciados — as ofertas gerenciadas (EKS/GKE/AKS) normalmente não expõem esses endpoints. |

Consulte o [`values.yaml` do chart](https://github.com/OneUptime/oneuptime/blob/master/HelmChart/Public/kubernetes-agent/values.yaml) para a lista completa.

## Atualizando

```bash
helm repo update
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values
```

`--reuse-values` mantém sua configuração existente; passe quaisquer novas substituições `--set` além disso.

## Desinstalando

```bash
helm uninstall oneuptime-agent --namespace oneuptime-kubernetes-agent
kubectl delete namespace oneuptime-kubernetes-agent
```

## Solução de Problemas

### A instalação falha com "hostPath volumes are not allowed"

Seu cluster bloqueia hostPath. Mude para uma predefinição de modo API:

```bash
helm upgrade oneuptime-agent oneuptime/kubernetes-agent \
  --namespace oneuptime-kubernetes-agent \
  --reuse-values \
  --set preset=gke-autopilot   # or eks-fargate
```

### Nenhum log aparece no OneUptime

Verifique os pods do agente:

```bash
kubectl get pods -n oneuptime-kubernetes-agent
kubectl logs -n oneuptime-kubernetes-agent -l app.kubernetes.io/part-of=oneuptime --tail=200
```

No modo API, o pod log-tailer expõe `/healthz` na porta 13133 — acesse-o via `kubectl port-forward` para um snapshot do status de exportação.

### Meu cluster tem pods demais para uma réplica de log-tailer (somente modo API)

Escale horizontalmente distribuindo namespaces. Implante uma vez por grupo de namespace:

```bash
helm install oneuptime-agent-ns-a oneuptime/kubernetes-agent \
  --set preset=gke-autopilot \
  --set namespaceFilters.include={app-a,app-b} \
  ...
```

Como alternativa, aumente `logs.api.replicas` — mas observe que cada réplica processa todos os namespaces permitidos, portanto, para deduplicação você ainda precisa da distribuição de namespaces.
