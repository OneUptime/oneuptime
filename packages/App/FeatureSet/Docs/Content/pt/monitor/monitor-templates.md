# Modelos de monitor

Um modelo de monitor é uma configuração de monitor salva (um tipo, critérios, um intervalo, rótulos e padrões de campos personalizados) a partir da qual você cria monitores com um clique. Os monitores criados a partir dele, ou vinculados a ele, continuam conectados: altere o modelo e depois sincronize a alteração com todos. Use modelos quando muitos monitores devem se comportar da mesma forma, como a mesma verificação de saúde em cada serviço, ou as mesmas verificações de API em produção e em staging.

:::cards
- [Criar um modelo](#criar-um-modelo): Quatro etapas, como em Criar monitor.
- [Criar monitores a partir dele](#criar-monitores-a-partir-de-um-modelo): Um clique, ou vincule monitores que você já tem.
- [Sincronizar alterações](#sincronizar-alterações-com-os-monitores-vinculados): O que cada botão de sincronização copia.
- [Mover monitores para outro modelo](#mover-monitores-para-outro-modelo): Um modelo melhor, e cada monitor mantém o seu histórico.
- [Manter valores próprios de cada monitor](#manter-valores-próprios-de-cada-monitor): Proteger um destino ou cabeçalhos de uma sincronização.
:::

## Como os modelos funcionam

Um modelo não vigia nada sozinho. Monitores são criados a partir dele, ou vinculados a ele, e a página do modelo os lista como **Monitores Vinculados**. Quando você altera o modelo, nada muda nesses monitores até você sincronizar: cada botão de sincronização copia uma parte do modelo para cada monitor vinculado, e os campos que você protege mantêm o valor próprio de cada monitor.

```mermaid title="Um modelo e seus monitores vinculados"
flowchart TB
    template["Modelo de monitor"] -->|"Criar monitor"| created["Monitor criado<br/>a partir do modelo"]
    existing["Monitor que você<br/>já tinha"] -->|"Vincular Monitores<br/>Existentes"| template
    template -.->|"Botões de<br/>sincronização"| linked
    subgraph linked["Monitores Vinculados"]
        direction LR
        created
        existing
    end
```

## Antes de começar

- **Uma função que possa criar modelos**: Proprietário do projeto, Administrador do projeto, Membro do projeto, Administrador de monitores ou Membro de monitores, ou uma função personalizada com a permissão Create Monitor Template. Alterar um modelo exige as mesmas funções, ou a permissão Edit Monitor Template.
- **Permissão para atualizar os monitores vinculados.** Uma sincronização grava em cada monitor vinculado em seu nome, e ignora os monitores que as suas permissões não cobrem.

## Criar um modelo

:::steps
### Abrir Modelos

Acesse **Monitores → Configurações → Modelos** e clique em **Criar: Modelo de monitor**.

### Dar um nome ao modelo

Em **Informações do modelo**, informe um **Nome do modelo**, como `Production API Health`. A **Descrição do modelo** é opcional. Então clique em **Próximo**.

### Definir os padrões do monitor

Em **Padrões do Monitor**, escolha o **Tipo de monitor**, com o mesmo seletor de Criar monitor. Opcionalmente, informe um **Nome Padrão do Monitor**; se ficar em branco, cada monitor recebe o nome do recurso que vigia. **Descrição Padrão do Monitor** e **Rótulos** ficam em **Mais campos**. Clique em **Próximo**.

### Definir os critérios e o intervalo

Em **Critérios**, preencha o que verificar e os critérios, como em [Criar monitor](/docs/monitor/create-monitor#critérios). O cartão **Configurações de sincronização do modelo** no topo permite proteger campos das sincronizações (veja [Manter valores próprios de cada monitor](#manter-valores-próprios-de-cada-monitor)). Para um tipo de monitor que as sondas verificam, a última etapa, **Intervalo**, pede o **Intervalo de monitoramento**. Clique em **Criar: Modelo de monitor** na última etapa.
:::

O modelo é adicionado à lista. Abra-o para ver a página dele, com um cartão para cada parte: **Informações do modelo**, **Padrões do Monitor**, **Critérios**, **Intervalo de monitoramento** (com **Concordância Mínima de Sondas**), **Rótulos**, **Valores padrão de campos personalizados** (quando o projeto tem campos personalizados de monitor) e **Monitores Vinculados**. Você altera cada parte no próprio cartão, por exemplo com **Editar critérios** ou **Editar intervalo**.

## Criar monitores a partir de um modelo

- **Monitor novo.** Clique em **Criar monitor** na linha do modelo na lista, ou em **Criar Monitor a partir de Modelo** na página dele. **Criar monitor** abre com o tipo e as configurações do modelo preenchidos; altere o que precisar e crie. O monitor novo fica vinculado ao modelo.
- **Monitores que você já tem.** Em **Monitores Vinculados**, clique em **Vincular Monitores Existentes** e escolha-os. Com **Usar os critérios e o intervalo do modelo** ligado, eles recebem os critérios, o intervalo e a concordância de sondas do modelo ao serem vinculados; desligado, eles mantêm as configurações até você sincronizar. Um monitor vinculado a outro modelo passa para este.

Os valores definidos em **Valores padrão de campos personalizados** são gravados em cada monitor criado a partir do modelo, inclusive nos monitores que as regras de importação automática e as políticas de alerta criam a partir dele.

## Sincronizar alterações com os monitores vinculados

Editar um modelo altera apenas o modelo. Para copiar uma alteração para os monitores vinculados, use o botão de sincronização do cartão que você alterou. Cada botão mostra quantos monitores alcança, como **Sincronizar Critérios com 3 Monitores Vinculados**, e fica esmaecido enquanto nada estiver vinculado. Uma sincronização não pode ser desfeita.

| Botão | Copia para cada monitor vinculado | Deixa como está |
| --- | --- | --- |
| **Sincronizar Critérios com Monitores Vinculados** | Os critérios e as configurações da etapa, como destinos e opções de requisição, exceto os campos protegidos | O intervalo de monitoramento, a concordância mínima de sondas, o nome, a descrição, os rótulos e os valores dos campos personalizados |
| **Sincronizar Intervalo com Monitores Vinculados** | O intervalo de monitoramento e a concordância mínima de sondas | Os critérios, o nome, a descrição, os rótulos e os valores dos campos personalizados |
| **Sincronizar Rótulos com Monitores Vinculados** | Os rótulos, e nada mais | Todo o resto |
| **Sincronizar campos personalizados com os monitores vinculados** | Os campos personalizados para os quais o modelo tem um padrão, substituindo o que cada monitor tinha | Os campos personalizados que o modelo deixa em branco, e todo o resto |

Para sincronizar um único monitor, clique em **Sincronizar a partir do Modelo** na linha dele em **Monitores Vinculados**. Isso copia os critérios e as configurações da etapa (exceto os campos protegidos), o intervalo de monitoramento, a concordância mínima de sondas e os rótulos, e deixa como estão o nome, a descrição e os valores dos campos personalizados do monitor. Para desconectar um monitor, veja [Desvincular monitores de um modelo](#desvincular-monitores-de-um-modelo).

Depois de uma sincronização, um resumo informa quantos monitores foram atualizados. **Sincronizado parcialmente** significa que alguns monitores vinculados ainda têm a configuração anterior, geralmente porque as suas permissões não os cobrem.

## Mover monitores para outro modelo

Quando um modelo melhor substitui outro, mova os monitores dele para o novo em vez de excluí-los. Cada monitor mantém o nome, o histórico de status, os rótulos, os proprietários e os incidentes, e recebe os critérios do novo modelo.

:::steps
### Selecionar os monitores

Abra o modelo ao qual eles estão vinculados agora. Em **Monitores Vinculados**, selecione os monitores, ou todos eles. Você também pode selecionar monitores na lista de monitores, filtrada por qualquer coluna.

### Movê-los

Em **Ações em massa**, clique em **Mover para Outro Modelo** (na lista de monitores, **Vincular a um Modelo**). Escolha o modelo.

### Manter ligadas as configurações do modelo

Deixe **Usar os critérios e o intervalo do modelo** ligado, para que cada monitor receba agora os critérios, as configurações da etapa, o intervalo e a concordância de sondas do modelo. Desligado, cada um mantém os seus até você sincronizar. Depois confirme.
:::

O que a movimentação faz:

- Os critérios, o intervalo e a concordância de sondas dos monitores são substituídos pelos do modelo. Um incidente ou alerta aberto que os critérios antigos deles configuraram para se resolver sozinho é resolvido, e os novos critérios abrem um novo se o problema persistir. Cada monitor de dispositivo de rede continua observando o próprio dispositivo, e cada monitor de endereço ou URL continua verificando o endereço do próprio dispositivo.
- Nomes, descrições, histórico de status, rótulos, proprietários, valores dos campos personalizados e vínculos com incidentes continuam como estão.
- Um monitor que uma importação, uma regra de importação automática ou uma política de alertas de rede criou mantém o modelo a partir do qual foi criado. Essa regra nunca volta a criá-lo, e uma política de alertas o libera: ela não o exclui nem o substitui mais.
- Um dispositivo tem um monitor de cada modelo. Quando um dispositivo já tem um monitor criado para ele a partir do novo modelo, o outro monitor dele fica de fora, e a alteração indica o que está atrapalhando: exclua um dos dois e mova de novo.
- Um monitor de um tipo diferente do tipo do modelo fica de fora.

A alteração é executada no servidor, até 10.000 monitores por vez, e mostra o progresso: o que foi movido, o que ficou de fora e por quê, e os incidentes e alertas abertos que ela resolveu. Fechar a caixa de diálogo não a interrompe, e a página do modelo mostra uma alteração que ainda está em andamento. **Parar** a interrompe antes do próximo monitor, e **Tentar novamente** tenta de novo os monitores que falharam ou não foram alcançados.

> [!TIP]
> Vai mover os dispositivos de uma regra de importação automática para um novo modelo? Mova os monitores primeiro e depois aponte a regra para o novo modelo. Na ordem inversa, a regra dá a cada dispositivo um segundo monitor, do novo modelo, ao lado do que ele já tem.

## Desvincular monitores de um modelo

Clique em **Desvincular do Modelo** na linha de um monitor em **Monitores Vinculados**, ou selecione monitores ali ou na lista de monitores e use **Desvincular do Modelo** em **Ações em massa**. Escolha o que os monitores mantêm:

| Opção | O que os monitores fazem depois |
| --- | --- |
| **Manter as configurações deles** | Eles continuam verificando e alertando com os critérios que têm agora, como monitores independentes, e não recebem mais as atualizações do modelo. |
| **Remover deles os critérios do modelo** | Eles continuam verificando, mas não abrem incidentes nem alertas e não definem nenhum status até você vinculá-los a um modelo novamente. Um incidente ou alerta aberto que os critérios deles configuraram para se resolver sozinho é resolvido. |

Em ambos os casos eles mantêm os nomes, o histórico de status, os rótulos, os proprietários e os incidentes, e uma regra que os criou nunca volta a criá-los.

## Excluir um modelo

Um modelo a partir do qual uma política de alertas de rede ou uma regra de importação automática provisiona monitores não pode ser excluído: aponte primeiro a política ou a regra para outro modelo. Quando há monitores vinculados ao modelo, a exclusão pergunta o que acontece com eles:

- **Manter as configurações deles** (o padrão): a exclusão os desvincula, e eles continuam verificando e alertando com os critérios que têm.
- **Remover deles os critérios deste modelo**: cada um é desvinculado com os critérios removidos, como acima, e depois o modelo é excluído. Quando um monitor continua vinculado, como um que as suas permissões não cobrem, o modelo é mantido, e a caixa de diálogo diz quantos.

Para mover os monitores para outro modelo em vez disso, use **Mover para Outro Modelo** antes de excluí-lo.

## Manter valores próprios de cada monitor

Uma sincronização de critérios também copia configurações da etapa, como destinos, cabeçalhos de requisição e tempos limite, a menos que você proteja esses campos. Proteja um campo para que cada monitor vinculado mantenha o próprio valor.

:::steps
### Abrir o modelo

Acesse **Monitores → Configurações → Modelos** e abra o modelo.

### Editar os critérios dele

No cartão **Critérios**, clique em **Editar critérios**.

### Proteger os campos

Em **Configurações de sincronização do modelo**, marque **Não sincronizar este campo** ao lado de cada campo que você quer manter nos monitores vinculados.

### Salvar

Salve as alterações. O cartão **Critérios**, e a confirmação das duas sincronizações abaixo, listam os campos protegidos.

### Sincronizar

Use **Sincronizar Critérios com Monitores Vinculados**, ou **Sincronizar a partir do Modelo** em um monitor vinculado específico.
:::

Por exemplo, proteja **Alvo do monitor** e **Cabeçalhos da requisição** em um modelo de API. Os monitores de produção e de staging mantêm as próprias URLs e cabeçalhos, enquanto ambos recebem os critérios atualizados do modelo e as demais configurações não protegidas.

As opções disponíveis dependem do tipo de monitor. Elas incluem destinos e portas, opções de requisição HTTP, conexões de banco de dados, configurações de DNS, seletores de infraestrutura e consultas de telemetria. Credenciais relacionadas, como um certificado de cliente e a sua chave privada, são mantidas juntas.

### Como as exclusões se comportam

- Os campos marcados mantêm o valor atual de cada monitor existente, inclusive um valor vazio ou não definido. Cabeçalhos de requisição e outras coleções são preservados por inteiro.
- Os campos desmarcados continuam sendo sincronizados a partir do modelo. Desmarque um campo protegido e salve para copiar o valor do modelo na próxima sincronização.
- As exclusões valem para sincronizações em massa e individuais. Elas são salvas no modelo, não escolhidas separadamente a cada sincronização.
- Monitores novos continuam começando com os valores de campo do modelo. As exclusões afetam apenas a sincronização de monitores existentes.
- Os critérios sempre são sincronizados. Uma sincronização só de critérios deixa como estão o intervalo de monitoramento, os rótulos e outras configurações no nível do monitor.
- Modelos existentes não têm exclusões de campo até você configurá-las. Monitores de dispositivo de rede continuam mantendo automaticamente a própria vinculação ao dispositivo, e os monitores Ping, IP, Porta e NTP que uma importação da descoberta de rede criou para dispositivos continuam verificando o endereço de cada dispositivo. Os monitores de Site, API e Certificado SSL que ela criou mantêm o endereço de cada dispositivo como host da URL e usam o esquema, a porta e o caminho do modelo.

Em modelos com várias etapas, os valores protegidos são associados pelos IDs das etapas. Monitores de etapa única criados de forma independente também podem receber um modelo de etapa única. Se uma etapa protegida não puder ser associada, a sincronização é rejeitada antes de qualquer monitor ser atualizado, para que uma etapa nova ou reordenada não copie por engano o destino ou as credenciais de outra etapa.

> [!IMPORTANT]
> Antes de alterar o tipo de monitor de um modelo salvo (com **Editar padrões do monitor**), remova em **Editar critérios** as exclusões que não se aplicam ao novo tipo. Todas as exclusões de um modelo precisam existir para o tipo de monitor dele.

## Configuração por API

Cada etapa de modelo aceita um array `doNotSyncFields` no seu objeto `MonitorStep.value`. Para um monitor de API, proteja o destino e toda a coleção de cabeçalhos com:

```json title="monitorSteps (excerpt)"
{
  "_type": "MonitorSteps",
  "value": {
    "monitorStepsInstanceArray": [
      {
        "_type": "MonitorStep",
        "value": {
          "id": "<step id>",
          "doNotSyncFields": ["monitorDestination", "requestHeaders"]
        }
      }
    ]
  }
}
```

Omita o array ou defina-o como `[]` para sincronizar todas as configurações de etapa compatíveis. Nomes de campo incompatíveis e campos que não se aplicam ao tipo de monitor do modelo são rejeitados. O array do modelo controla a sincronização; metadados desse tipo em um monitor vinculado não o substituem.

:::details Nomes de campo para doNotSyncFields, por tipo de monitor
| Tipo de monitor | Nomes de campo |
| --- | --- |
| Site, API, Ping, IP, Porta, Certificado SSL, NTP | `monitorDestination`, `requestTimeoutInMs`, `retryCount` |
| Somente API | `requestHeaders`, `requestType`, `requestBody` |
| Site e API | `doNotFollowRedirects`, `allowSelfSignedCertificates`, `tlsClientAuthentication` (o certificado de cliente, a chave e a senha juntos) |
| Porta, NTP | `monitorDestinationPort` |
| Monitor sintético, Código JavaScript personalizado | `customCode` |
| Monitor sintético | `browserTypes`, `screenSizeTypes`, `retryCountOnError` |
| DNS | `dnsMonitor.queryName`, `dnsMonitor.recordType`, `dnsMonitor.resolver` (o servidor DNS e a porta juntos), `dnsMonitor.timeout`, `dnsMonitor.retries` |
| Domínio | `domainMonitor.domainName`, `domainMonitor.lookupMethod`, `domainMonitor.timeout`, `domainMonitor.retries` |
| DNSSEC | `dnssecMonitor.domainName`, `dnssecMonitor.resolvers`, `dnssecMonitor.checkNameserverConsistency`, `dnssecMonitor.signatureExpiryWarningDays`, `dnssecMonitor.timeout`, `dnssecMonitor.retries` |
| Consulta SQL | `sqlMonitor.connection`, `sqlMonitor.connectionTimeoutInMs`, `sqlMonitor.statementTimeoutInMs`, `sqlMonitor.query`, `sqlMonitor.maxRows` |
| Integridade do banco de dados | `databaseMonitor.connection`, `databaseMonitor.connectionTimeoutInMs`, `databaseMonitor.statementTimeoutInMs`, `databaseMonitor.enabledMetricGroups` |
| Página de status externa | `externalStatusPageMonitor.statusPageUrl`, `externalStatusPageMonitor.provider`, `externalStatusPageMonitor.components`, `externalStatusPageMonitor.timeout`, `externalStatusPageMonitor.retries` |
| Registros, Eventos de segurança, Traços, IA / LLM, Métricas, Exceções, Perfis | `logMonitor`, `securityEventsMonitor`, `traceMonitor`, `llmMonitor`, `metricMonitor`, `exceptionMonitor`, `profileMonitor` (toda a configuração do monitor) |
| Status da sonda | `probeStatusMonitor.probeIds` |

Os monitores de infraestrutura (Kubernetes, Contêiner Docker, Host, Contêiner Podman, Proxmox, Docker Swarm, Ceph, Array de armazenamento, Dispositivo IoT) oferecem o seu seletor de recursos, filtros (todos exceto Host), consultas de métricas e janela de tempo da consulta. Os nomes deles aparecem em **Configurações de sincronização do modelo** em um modelo desse tipo.
:::

## Solução de problemas

:::details Uma sincronização diz "Sincronizado parcialmente"
Alguns monitores vinculados não foram atualizados, geralmente porque as suas permissões não os cobrem. Peça a alguém que possa atualizar todos os monitores vinculados que execute a sincronização de novo.
:::

:::details Uma sincronização falha com "a template step cannot be matched to an existing monitor step"
Um campo protegido não pôde ser associado a uma etapa de um dos monitores, então a sincronização parou antes de alterar qualquer um deles. Dê às etapas do modelo os mesmos IDs das etapas dos monitores, ou use um modelo de etapa única com monitores de etapa única.
:::

:::details Os botões de sincronização estão esmaecidos
Nenhum monitor está vinculado ao modelo ainda. Crie um monitor a partir dele, ou clique em **Vincular Monitores Existentes** em **Monitores Vinculados**.
:::

:::details Uma movimentação deixa um monitor de fora: "O dispositivo para o qual este monitor foi criado já tem um monitor vinculado a este modelo"
O dispositivo tem um monitor criado para ele a partir do modelo para o qual você está movendo, geralmente porque uma regra de importação automática foi apontada para esse modelo antes da movimentação. Exclua o que você não precisa (o mais novo é o que tem menos histórico) e depois mova de novo.
:::

:::details Depois que uma regra de importação automática passou para um novo modelo, os dispositivos têm dois monitores
A regra deu a cada dispositivo o monitor do novo modelo ao lado do que ele tinha. Exclua os monitores novos e depois mova os antigos para o novo modelo: eles mantêm o histórico, e a regra não cria nenhum de novo.
:::

:::details Salvar falha com "Unsupported do not sync field"
Um nome em `doNotSyncFields` não é um campo do tipo de monitor do modelo. Confira-o com os nomes de campo acima.
:::

## Próximos passos

:::cards
- [Criar um monitor](/docs/monitor/create-monitor): O formulário que um modelo preenche.
- [Monitor de API](/docs/monitor/api-monitor): As configurações que um modelo de API leva.
- [Segredos do monitor](/docs/monitor/monitor-secrets): Compartilhar credenciais entre monitores sem copiá-las.
- [Etapas de monitor no Terraform](/docs/terraform/monitor-steps): Gerenciar monitores e as suas etapas como código.
:::
