# Gerenciar recursos

Esta página trata dos recursos do provider depois que os primeiros já estão em execução: como os tipos e os campos são nomeados, como os recursos se referem uns aos outros, como trazer o que o seu projeto já tem, os Secrets que o OneUptime cria, o que acontece com mudanças feitas fora do Kubernetes e o que verificar quando um recurso não está pronto. Para instalar o provider e criar os seus primeiros recursos, comece pela [Visão geral do Crossplane](/docs/crossplane/index).

:::cards
- [Tipos e campos](#tipos-e-campos): Os recursos do Terraform a partir dos quais são gerados, e como são nomeados.
- [Referenciar outros recursos](#referenciar-outros-recursos): Nomes em vez de IDs, em qualquer nível das etapas de um monitor.
- [Importar o que você já tem](#importar-o-que-você-já-tem): Observe um registro pelo ID e depois assuma o controle dele.
- [Solucionar problemas de um recurso](#solucionar-problemas-de-um-recurso): As condições e os eventos dele, e os logs do provider.
:::

## Tipos e campos

Cada recurso do [provider Terraform](/docs/terraform/index) é um tipo, com nome em CamelCase: `oneuptime_status_page` é `StatusPage`, e `oneuptime_on_call_policy` é `OnCallPolicy`. Um nome que terminaria em Spec, Status ou List ganha Definition no final, então `oneuptime_monitor_status` é `MonitorStatusDefinition`. Alguns dos tipos:

| Tipo | Registro que representa | Recurso do Terraform |
| --- | --- | --- |
| `Monitor` | Um monitor | `oneuptime_monitor` |
| `StatusPage` | Uma página de status | `oneuptime_status_page` |
| `OnCallPolicy` | Uma política de plantão | `oneuptime_on_call_policy` |
| `Team` | Uma equipe | `oneuptime_team` |
| `Label` | Um rótulo | `oneuptime_label` |
| `IncidentSeverity` | Uma severidade de incidente | `oneuptime_incident_severity` |
| `MonitorStatusDefinition` | Um status de monitor | `oneuptime_monitor_status` |
| `TelemetryIngestionKey` | Uma chave de ingestão de telemetria | `oneuptime_telemetry_ingestion_key` |

`kubectl api-resources --api-group=crossplane.oneuptime.com` lista todos os tipos que o seu cluster ativou.

Os campos de um tipo são os argumentos do recurso do Terraform, em camelCase, sob `spec.forProvider`: `monitoring_interval` é `monitoringInterval`. Um campo que o Terraform escreve com `jsonencode()` recebe uma string JSON. `kubectl explain` descreve cada campo do mesmo jeito que o provider Terraform, e o [Guia completo do Terraform](/docs/terraform/complete-guide) mostra como eles são usados:

```bash
kubectl explain monitors.spec.forProvider --api-version=crossplane.oneuptime.com/v1alpha1
```

`status.atProvider` mostra o registro como ele está no OneUptime, com o `id` dele. Um campo que você deixa de fora e que o OneUptime preenche, como um valor padrão, é copiado para `spec.forProvider` depois que o registro é criado, para que a próxima verificação não encontre nada a alterar.

## Referenciar outros recursos

Cada campo que guarda o ID de outro registro também aceita uma referência ao recurso que o representa. `<field>Ref` indica um recurso do mesmo namespace, e `<field>Selector` escolhe um pelos labels do Kubernetes dele. Uma lista de IDs, como `labels`, aceita `labelsRefs` e `labelsSelector`. O provider espera até que o recurso referenciado exista no OneUptime, e então preenche o ID dele.

```yaml title="selector.yaml"
spec:
  forProvider:
    labelsSelector:
      matchLabels:
        tier: production
```

As referências também chegam às etapas de um monitor: o status de um critério (`monitorStatusIdRef`), e a severidade, as equipes responsáveis, as políticas de plantão e os rótulos dos incidentes e alertas que ele cria (`incidentSeverityIdRef`, `alertSeverityIdRef`, `ownerTeamIdsRefs`, `onCallPolicyIdsRefs`, `labelIdsRefs`). Não há um tipo para uma pessoa: um campo identifica alguém pelo ID de usuário, como faz `ownerUserIds`, e muitos tipos aceitam também o endereço de e-mail da pessoa, como faz `TeamMember` em `userEmail` ([Pessoas e equipes](/docs/terraform/people-and-teams)).

## Importar o que você já tem

Um recurso que observa um registro o lê pelo ID e nunca o altera nem o exclui. Defina o ID como o nome externo do recurso, e `Observe` como a única política de gerenciamento dele:

```yaml title="team.yaml"
apiVersion: crossplane.oneuptime.com/v1alpha1
kind: Team
metadata:
  name: sre
  namespace: team-a
  annotations:
    crossplane.io/external-name: "<the team's ID>"
spec:
  managementPolicies: ["Observe"]
  providerConfigRef:
    kind: ProviderConfig
    name: default
  forProvider: {}
```

O ID do registro está no bloco `import` que a página **Desenvolvedores → Terraform** dele escreve no painel, e `oneuptime <resource> list` lista os IDs de um tipo de registro com a [CLI do OneUptime](/docs/cli/resource-operations#listar-registros). Quando o recurso estiver pronto, `status.atProvider` mostra o registro. Para gerenciá-lo daí em diante, escreva os campos dele em `spec.forProvider` e defina `managementPolicies` como `["*"]`.

## Secrets

### Secrets que o OneUptime cria

Alguns registros vêm com um segredo que o OneUptime cria, como o de uma chave de ingestão de telemetria. O provider nunca o coloca no recurso: ele o escreve em um Secret no namespace do recurso, com o nome indicado em `writeConnectionSecretToRef`, na chave `attribute.` seguida do nome do atributo do Terraform:

```yaml title="telemetry-key.yaml"
apiVersion: crossplane.oneuptime.com/v1alpha1
kind: TelemetryIngestionKey
metadata:
  name: collector
  namespace: team-a
spec:
  providerConfigRef:
    kind: ProviderConfig
    name: default
  writeConnectionSecretToRef:
    name: collector-telemetry-key
  forProvider:
    name: Collector
```

```bash
kubectl -n team-a get secret collector-telemetry-key -o jsonpath='{.data.attribute\.secret_key}' | base64 -d
```

Excluir o recurso também exclui o Secret.

### Secrets que você fornece

Um campo que guarda um segredo, como a frase secreta da chave de cliente TLS de uma etapa de monitor, aceita um Secret do namespace do recurso em vez de um valor: `tlsClientKeyPassphraseSecretRef`, com o `name` e a `key` do Secret.

## Mudanças feitas fora do Kubernetes

O provider compara cada recurso com o registro dele a cada 10 minutos e desfaz o que alguém tiver mudado no OneUptime. Para verificar com mais frequência, dê ao provider uma configuração de runtime com `--poll`:

```yaml title="runtime-config.yaml"
apiVersion: pkg.crossplane.io/v1beta1
kind: DeploymentRuntimeConfig
metadata:
  name: oneuptime
spec:
  deploymentTemplate:
    spec:
      selector: {}
      template:
        spec:
          containers:
            - name: package-runtime
              args:
                - --poll=1m
---
apiVersion: pkg.crossplane.io/v1
kind: Provider
metadata:
  name: provider-oneuptime
spec:
  package: ghcr.io/oneuptime/provider-oneuptime:{{CROSSPLANE_PROVIDER_VERSION}}
  runtimeConfigRef:
    name: oneuptime
```

Para deixar o painel controlar um campo depois que o registro é criado, escreva-o em `spec.initProvider` em vez de `spec.forProvider`: ele é usado para criar o registro, e o provider nunca o restaura. Para deixar o painel controlar o registro inteiro, deixe `Update` fora das políticas de gerenciamento dele: `["Observe", "Create", "Delete", "LateInitialize"]`.

## Excluir um recurso

Excluir um recurso exclui o registro dele no OneUptime. Para manter o registro, deixe `Delete` fora das políticas de gerenciamento do recurso antes de excluí-lo: `["Observe", "Create", "Update", "LateInitialize"]`. Um recurso que só observa nunca exclui o registro dele.

## Solucionar problemas de um recurso

`kubectl -n team-a get managed` mostra as colunas `SYNCED` e `READY` de cada recurso. Quando uma delas não está `True`, as condições e os eventos do recurso dizem o porquê, com a resposta do OneUptime quando a API recusou uma requisição:

```bash
kubectl -n team-a describe monitors.crossplane.oneuptime.com homepage
```

| O que diz | O que verificar |
| --- | --- |
| `cannot read the API key` | O Secret, ou a chave dentro dele, que o `ProviderConfig` indica. |
| `cannot get referenced ProviderConfig` | O recurso indica um `ProviderConfig` que o namespace dele não tem. Use `kind: ClusterProviderConfig` para um do cluster. |
| Uma referência que não pode ser resolvida | O recurso que ela indica não está no namespace, ou ainda não está pronto. |
| Um erro da API do OneUptime | As permissões da chave de API, e o valor do campo que o erro indica. |

Os logs do provider dão mais detalhes, e mais ainda com `--debug` adicionado aos `args` dele, assim como o `--poll` acima:

```bash
kubectl -n crossplane-system logs -l pkg.crossplane.io/provider=provider-oneuptime
```

## Verificar o pacote

A cada versão, o pacote é assinado sem chave (keyless) com o cosign do Sigstore, como as imagens do OneUptime. Para verificar um pacote antes de instalá-lo:

```bash
cosign verify ghcr.io/oneuptime/provider-oneuptime:{{CROSSPLANE_PROVIDER_VERSION}} \
  --certificate-identity https://github.com/OneUptime/oneuptime/.github/workflows/release.yml@refs/heads/release \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com
```
