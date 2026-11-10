# Visão geral do Crossplane

O provider Crossplane do OneUptime gerencia o seu projeto do OneUptime a partir do Kubernetes. Declare monitores, páginas de status, políticas de plantão, equipes, rótulos e os outros registros do seu projeto como recursos do Kubernetes, e o Crossplane mantém o seu projeto do jeito que eles descrevem: cria o que é novo, altera o que você edita, desfaz o que alguém mudou em outro lugar e exclui o que você remove. O Argo CD, o Flux e qualquer outra ferramenta que aplique manifestos também os aplicam. Ele funciona com o OneUptime Cloud e com um OneUptime auto-hospedado.

:::cards
- [Como o provider funciona](#como-o-provider-funciona): Tipos, namespaces e a chave de API por trás deles.
- [Instalar o provider](#instalar-o-provider): O pacote e a versão a escolher.
- [Dar ao provider a sua chave de API](#dar-ao-provider-a-sua-chave-de-api): Um Secret e um ProviderConfig no seu namespace.
- [Criar os seus primeiros recursos](#criar-os-seus-primeiros-recursos): Um monitor, o rótulo que ele leva e os status que ele define.
:::

## Como o provider funciona

O provider é um pacote do Crossplane. Depois de instalado, ele adiciona ao grupo de API `crossplane.oneuptime.com` um tipo de recurso para cada tipo de registro da API do OneUptime: `Monitor`, `StatusPage`, `OnCallPolicy`, `Team`, `Label` e mais de 400 outros. Cada recurso desses tipos fica em um namespace e representa um registro do seu projeto. O provider lê e altera o registro pela API REST do OneUptime, com uma chave de API do seu projeto, e escreve o que encontra no status do recurso.

O provider é gerado a partir do [provider Terraform](/docs/terraform/index) a cada versão: os tipos dele são os recursos do provider Terraform, com os mesmos campos e as mesmas requisições à API por trás deles.

## Antes de começar

- **Crossplane 2.0 ou posterior.** Os recursos do provider ficam em namespaces, que chegaram com o Crossplane 2. A própria documentação do Crossplane mostra como instalá-lo no seu cluster.
- **Uma chave de API do seu projeto.** O [Início rápido](/docs/terraform/quick-start#criar-uma-chave-de-api-do-projeto) do Terraform mostra como criar uma em **Configurações do projeto → Avançado → Chaves de API**. A chave decide a qual projeto os recursos pertencem e o que o provider pode alterar nele.
- **No OneUptime Cloud, o plano Growth ou superior.** As chaves de API de um projeto só funcionam nele.

## Instalar o provider

Instale o pacote com um `Provider`:

```yaml title="provider.yaml"
apiVersion: pkg.crossplane.io/v1
kind: Provider
metadata:
  name: provider-oneuptime
spec:
  package: ghcr.io/oneuptime/provider-oneuptime:{{CROSSPLANE_PROVIDER_VERSION}}
```

```bash
kubectl apply -f provider.yaml
kubectl get providers.pkg.crossplane.io provider-oneuptime
```

Quando `INSTALLED` e `HEALTHY` mostram `True`, o provider está em execução. O mesmo pacote está no Docker Hub, como `docker.io/oneuptime/provider-oneuptime`.

### Escolher uma versão

As versões do pacote são as do OneUptime: `{{CROSSPLANE_PROVIDER_VERSION}}` é gerada a partir dessa versão do OneUptime, a que serve esta página. No OneUptime Cloud, use a mais recente. Em um OneUptime auto-hospedado, use a versão do seu OneUptime, para que o provider conheça os campos que a API do seu OneUptime conhece.

### Ativar só os tipos que você usa

O chart do Helm do Crossplane ativa por padrão todos os tipos de todos os providers (o valor `provider.defaultActivations` dele), o que, para este provider, são mais de 400 definições de recursos personalizados. Para ativar só os tipos que você usa, instale o Crossplane com `--set provider.defaultActivations={}` e liste os tipos em uma política:

```yaml title="activation-policy.yaml"
apiVersion: apiextensions.crossplane.io/v1alpha1
kind: ManagedResourceActivationPolicy
metadata:
  name: oneuptime
spec:
  activate:
    - monitors.crossplane.oneuptime.com
    - monitorstatusdefinitions.crossplane.oneuptime.com
    - labels.crossplane.oneuptime.com
    - statuspages.crossplane.oneuptime.com
```

## Dar ao provider a sua chave de API

Coloque a chave em um Secret do namespace em que os seus recursos vão ficar, e aponte para ele um `ProviderConfig` desse namespace. Criar o Secret com `kubectl` mantém a chave fora dos seus arquivos:

```bash
kubectl create namespace team-a
kubectl -n team-a create secret generic oneuptime --from-literal=api-key="<your-api-key>"
```

```yaml title="provider-config.yaml"
apiVersion: crossplane.oneuptime.com/v1beta1
kind: ProviderConfig
metadata:
  name: default
  namespace: team-a
spec:
  credentials:
    secretRef:
      name: oneuptime
      key: api-key
```

Um `ProviderConfig` só lê Secrets do próprio namespace, então a chave de um namespace não pode ser usada a partir de outro. Cada recurso indica o seu `ProviderConfig` em `spec.providerConfigRef`.

### Usar um OneUptime auto-hospedado

Defina no `ProviderConfig` o endereço do seu OneUptime como `url`, sem `/api`:

```yaml title="provider-config.yaml"
apiVersion: crossplane.oneuptime.com/v1beta1
kind: ProviderConfig
metadata:
  name: default
  namespace: team-a
spec:
  url: https://oneuptime.example.com
  credentials:
    secretRef:
      name: oneuptime
      key: api-key
```

### Compartilhar uma chave entre namespaces

Um `ClusterProviderConfig` lê um Secret de qualquer namespace, e recursos de todos os namespaces podem indicá-lo. Use um quando uma única equipe cuidar da chave do cluster inteiro:

```yaml title="cluster-provider-config.yaml"
apiVersion: crossplane.oneuptime.com/v1beta1
kind: ClusterProviderConfig
metadata:
  name: oneuptime
spec:
  credentials:
    source: Secret
    secretRef:
      namespace: crossplane-system
      name: oneuptime
      key: credentials
```

Um recurso o indica com `kind: ClusterProviderConfig` no seu `providerConfigRef`. O Secret guarda só a chave, ou um JSON que também informa o endereço: `{"api_key": "<your-api-key>", "oneuptime_url": "https://oneuptime.example.com"}`. Uma `url` no `ClusterProviderConfig` tem prioridade sobre a do JSON. Um `ClusterProviderConfig` também pode ler a chave de uma variável de ambiente ou de um arquivo do pod do provider, com `source: Environment` ou `source: Filesystem`.

## Criar os seus primeiros recursos

Um monitor da sua página inicial, com um rótulo, que define os status **Offline** e **Operacional** do seu projeto.

:::steps
### Observar os status que ele define

O OneUptime criou os status do seu projeto junto com o projeto, então eles são observados em vez de criados: o provider os lê pelos IDs e nunca os altera nem os exclui. Com a [CLI do OneUptime](/docs/cli/resource-operations#listar-registros), `oneuptime monitor-status list --fields _id,name` lista os IDs.

```yaml title="statuses.yaml"
apiVersion: crossplane.oneuptime.com/v1alpha1
kind: MonitorStatusDefinition
metadata:
  name: offline
  namespace: team-a
  annotations:
    crossplane.io/external-name: "<the Offline status's ID>"
spec:
  managementPolicies: ["Observe"]
  providerConfigRef:
    kind: ProviderConfig
    name: default
  forProvider: {}
---
apiVersion: crossplane.oneuptime.com/v1alpha1
kind: MonitorStatusDefinition
metadata:
  name: operational
  namespace: team-a
  annotations:
    crossplane.io/external-name: "<the Operational status's ID>"
spec:
  managementPolicies: ["Observe"]
  providerConfigRef:
    kind: ProviderConfig
    name: default
  forProvider: {}
```

### Criar o rótulo e o monitor

O monitor se refere ao rótulo e aos status pelos nomes deles no Kubernetes, e o provider preenche os IDs:

```yaml title="homepage.yaml"
apiVersion: crossplane.oneuptime.com/v1alpha1
kind: Label
metadata:
  name: production
  namespace: team-a
spec:
  providerConfigRef:
    kind: ProviderConfig
    name: default
  forProvider:
    name: Production
    color: "#16a34a"
---
apiVersion: crossplane.oneuptime.com/v1alpha1
kind: Monitor
metadata:
  name: homepage
  namespace: team-a
spec:
  providerConfigRef:
    kind: ProviderConfig
    name: default
  forProvider:
    name: Homepage
    description: Checks that the homepage responds
    monitorType: Website
    monitoringInterval: "*/5 * * * *"
    labelsRefs:
      - name: production
    monitorSteps:
      - monitorDestination: https://example.com
        monitorDestinationType: URL
        requestType: GET
        criteria:
          - name: Offline
            description: The homepage does not respond
            filterCondition: Any
            changeMonitorStatus: true
            monitorStatusIdRef:
              name: offline
            filters:
              - checkOn: Is Online
                filterType: "False"
          - name: Online
            description: The homepage responds
            filterCondition: All
            changeMonitorStatus: true
            monitorStatusIdRef:
              name: operational
            filters:
              - checkOn: Is Online
                filterType: "True"
```

### Vê-los no OneUptime

```bash
kubectl apply -f statuses.yaml -f homepage.yaml
kubectl -n team-a get managed
```

Quando `SYNCED` e `READY` mostram `True`, o registro está no seu projeto. `EXTERNAL-NAME` é o ID dele no OneUptime.
:::

## Próximos passos

- [Gerenciar recursos](/docs/crossplane/managing-resources) explica os tipos e os campos deles, as referências, como importar o que você já tem, os Secrets que o OneUptime cria e o que verificar quando um recurso não está pronto.
- O [Guia completo do Terraform](/docs/terraform/complete-guide) descreve os recursos e os campos deles, que são os mesmos dos tipos do provider.
