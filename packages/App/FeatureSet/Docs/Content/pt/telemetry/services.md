# Serviços

Serviços lista as aplicações e os microsserviços que você executa. O OneUptime adiciona um serviço na primeira vez que a telemetria dele chega e, em seguida, reúne os registros, traços, métricas, exceções, incidentes e proprietários dele em uma única página, para que qualquer pessoa saiba o que um serviço faz, de quem ele é e como ele está. Para escolher entre um serviço, um grupo de monitores e um rótulo, veja [Qual devo usar?](/docs/introduction/which-one#grupo-de-monitores-serviço-ou-rótulo).

:::cards
- [Como um serviço entra no catálogo](#como-um-serviço-entra-no-catálogo): Seu `service.name`, na primeira telemetria.
- [Encontrar um serviço](#encontrar-um-serviço): A lista, seus filtros e suas colunas.
- [As páginas de um serviço](#as-páginas-de-um-serviço): Tudo sobre um serviço.
- [Arquivar ou excluir um serviço](#arquivar-ou-excluir-um-serviço): Manter o histórico ou removê-lo.
:::

## Como um serviço entra no catálogo

Você não precisa criar serviços. Cada lote de telemetria nomeia o serviço que o enviou no atributo de recurso `service.name`. O OneUptime arquiva o lote sob o serviço com esse nome e cria o serviço quando o projeto ainda não tem nenhum.

```mermaid title="Para onde vai um lote de telemetria"
flowchart TB
    batch["Telemetria com<br/>um service.name"] --> find{"Existe um serviço<br/>com esse nome?"}
    find -->|"Sim"| known["Arquivado nesse<br/>serviço"]
    find -->|"Não"| create["Serviço criado,<br/>com esse nome"]
    create --> rules["Regras de rótulos e<br/>proprietários aplicadas"]
    known --> update["Visto pela última vez<br/>e detalhes atualizados"]
    rules --> update
```

- **O nome é a identidade do serviço.** A comparação ignora maiúsculas e minúsculas, então `Checkout-API` e `checkout-api` são um único serviço. Um novo `service.name` inicia um novo serviço.
- **Os contêineres se nomeiam sozinhos.** A telemetria dos agentes Docker e Podman nomeia um serviço com o nome do contêiner quando ela não tem `service.name`.
- **Uma chave de ingestão pode fixar o serviço.** Os dados do OpenTelemetry enviados com uma chave que tem um **Nome do serviço fixado** são arquivados sob esse nome, seja qual for o seu `service.name`. Veja [Chaves de ingestão](/docs/telemetry/ingestion-keys#proteger-uma-chave-de-navegador).
- **Navegadores e celulares não são serviços.** A telemetria de um navegador ou de um aplicativo móvel pertence a uma [aplicação RUM](/docs/rum/applications).
- **Os rótulos podem vir com a telemetria.** Um atributo de recurso chamado `oneuptime.label.<name>` adiciona o rótulo `<name>:<value>` ao serviço, como `oneuptime.label.team=payments` para `team:payments`.

Cada vez que a telemetria chega, o **Visto pela última vez** do serviço avança, e os detalhes dele são atualizados a partir dos atributos de recurso que vêm junto:

| Detalhe | A partir do atributo |
| --- | --- |
| Versão do serviço | `service.version` |
| Ambiente de implantação | `deployment.environment.name`, ou `deployment.environment` |
| Namespace do serviço | `service.namespace` |
| Runtime | `process.runtime.name` e `process.runtime.version` |
| Tecnologia | `telemetry.sdk.language`, ou o runtime |
| Nuvem | `cloud.provider`, `cloud.platform`, `cloud.region` e `cloud.account.id` |

## Antes de começar

- **Telemetria chegando** com um `service.name`. Veja [OpenTelemetry](/docs/telemetry/open-telemetry): `OTEL_SERVICE_NAME` define esse valor.
- **Uma função que possa ler serviços.** Proprietário do projeto, Administrador do projeto, Membro do projeto, Visualizador, Administrador de configurações, Membro de configurações ou Visualizador de configurações, ou uma função personalizada com a permissão Read Service. Criar, alterar e excluir serviços exige Proprietário do projeto, Administrador do projeto, Membro do projeto, Administrador de configurações ou Membro de configurações, ou as permissões de serviço correspondentes.

## Encontrar um serviço

Acesse **Produtos → Recursos → Serviços**. **Todos os serviços** lista cada serviço com **Nome**, **Descrição**, **Tecnologia**, **Visto pela última vez**, **Rótulos** e **Proprietários**.

- Pesquise por nome ou descrição, e filtre por proprietário ou rótulo com a barra acima da lista.
- Selecione vários serviços para adicionar rótulos ou proprietários a todos de uma vez, ou para arquivá-los.
- Clique em um serviço para abrir as páginas dele.

Para adicionar um serviço antes de a telemetria dele chegar, por exemplo para definir primeiro os proprietários, clique em **Criar: Serviço** e informe o **Nome** exatamente como será o `service.name` dele. As regras de rótulos e de proprietários se aplicam a ele como a um serviço descoberto. Depois de salvo, o guia de configuração do OpenTelemetry se abre com esse nome em todos os trechos, e a última etapa dele, **Aguardar a conexão**, avisa quando chegam os primeiros dados do serviço.

## As páginas de um serviço

O menu lateral de um serviço tem seis seções:

| Seção | Páginas |
| --- | --- |
| **Básico** | **Visão geral**: requisições, taxa de erros e latência p95 dos spans dele, gráficos e detalhes. **Recomendações**: monitores prontos para o serviço, escolhidos de acordo com a linguagem dele. **SLOs**: os SLOs que medem as requisições dele, onde você pode criar um que já mede o serviço. **Proprietários**: as pessoas e as equipes responsáveis por ele. **Feed**: tudo o que aconteceu com ele, desde como foi criado até cada mudança desde então. |
| **Telemetria** | Os **Registros**, **Traços**, **Métricas**, **Perfis**, **Exceções** e **Source maps** dele, já filtrados para este serviço. |
| **Atividade** | Os **Incidentes**, os **Alertas** e os eventos de **Manutenção programada** que o afetam. |
| **Segurança** | **Segurança de dados**: os dados sensíveis que os logs, traces e exceções do serviço carregam, e o que corrigir ([Dados sensíveis na telemetria](/docs/data-security/telemetry)). **Conformidade**: como esses dados estão diante de cada estrutura, com um interruptor que desativa uma estrutura ou um requisito para este serviço ([Conformidade da Segurança de dados](/docs/data-security/compliance#na-página-de-um-recurso)). Aparece quando a Segurança de dados tiver varrido a telemetria do serviço, e começa recolhida. |
| **Desenvolvedores** | **Terraform**, **API**, **CLI** e **Assistentes de IA**: o serviço gerenciado por código. Começa recolhida. |
| **Avançado** | **Configurações**, **Registros de auditoria** e **Excluir serviço**. **Avançado** começa recolhido: expanda-o primeiro. |

Ao lado do nome, a **Visão geral** de um serviço mostra se a telemetria dele está chegando: **Recebendo dados** enquanto algo chegou nos últimos 30 minutos, **Sem dados recentes** quando nada mais chega e **Aguardando dados** antes da primeira telemetria. Um serviço que só envia spans enquanto atende requisições mostra **Sem dados recentes** sempre que ninguém o chama, então isso sozinho não é uma falha.

Os proprietários importam além da página: uma função cujo escopo é Owned lê a telemetria dos serviços que pertencem a você ou às suas equipes. Veja [Telemetria](/docs/permissions/index#telemetria).

A **Visão geral** de um serviço tem um cartão **Usado por**: os monitores que observam o serviço e os SLOs que os medem. Arquivar ou excluir o serviço, em suas páginas ou pela lista, diz isso primeiro. O que você não pode abrir é contado, não nomeado.

## Alterar um serviço

:::steps
### Abrir as configurações dele

Abra o serviço, expanda **Avançado** no menu lateral e clique em **Configurações**.

### Renomeá-lo ou descrevê-lo

Em **Detalhes do serviço**, clique em **Editar detalhes** para mudar o **Nome**, a **Descrição** ou os **Rótulos**. O nome precisa continuar igual ao `service.name` que a telemetria dele informa: altere-o também na sua configuração do OpenTelemetry, senão a próxima telemetria cria um novo serviço.

### Escolher a cor e o stack de tecnologia

Em **Configurações do serviço**, clique em **Editar definições**. A **Cor do serviço** marca o serviço em gráficos e listas; um serviço novo recebe uma cor própria. **Stack de Tecnologia** é opcional: deixe em branco para mostrar a linguagem detectada na telemetria dele.
:::

A mesma página traz a retenção do serviço, recolhida em **Mais configurações**. Os cartões **Retenção de Dados de Telemetria** e **Retenção por tipo de telemetria** guardam a telemetria dele por mais ou menos tempo que a retenção padrão do projeto. Eles fazem parte da [Enterprise Edition](/docs/self-hosted/enterprise), e do plano Scale no OneUptime Cloud; sem eles, a página mostra o que eles acrescentam, e o serviço mantém a retenção do projeto.

## Definir rótulos e proprietários automaticamente

As regras dão aos serviços novos seus rótulos e proprietários quando eles são criados, inclusive os descobertos. Encontre-as em **Serviços → Configurações → Regras de proprietário** e **Serviços → Configurações → Regras de Rótulos**; **Configurações** começa recolhido no menu lateral. Veja [Regras de rótulos e proprietários](/docs/configuration/label-and-owner-rules).

## Arquivar ou excluir um serviço

Arquive um serviço que você não acompanha mais, mas cujo histórico quer manter. Um serviço arquivado fica oculto em **Todos os serviços**, mas continua recebendo telemetria. Arquive-o pela página **Configurações** dele, ou selecione vários na lista. Para trazer um de volta, abra **Serviços → Avançado → Arquivado**.

> [!WARNING]
> Excluir um serviço também exclui os source maps dele, e as regras de pipeline de métricas e os orçamentos de custo de LLM definidos para ele. Se o OneUptime ainda receber a telemetria dele, o serviço é criado de novo, sem os rótulos, os proprietários e as configurações que você deu a ele. Para tirá-lo da lista e manter tudo, arquive-o em vez disso.

## Solução de problemas

:::details Um serviço aparece duas vezes
Dois valores de `service.name` chegaram ao OneUptime, por exemplo de duas versões da sua configuração, ou depois de uma renomeação feita só de um lado. A telemetria é associada pelo nome: faça cada instância informar o mesmo `service.name` e, depois, arquive ou exclua o serviço de que não precisa mais.
:::

:::details Meu serviço não está no catálogo
Verifique se a telemetria dele traz um `service.name`. A telemetria de um navegador ou de um aplicativo móvel vai para o Real User Monitoring, e um host ou cluster sem nome de serviço é arquivado sob esse host ou cluster.
:::

:::details Visto pela última vez está atrasado
**Visto pela última vez** é atualizado cerca de uma vez por minuto, não a cada lote, então pode ficar cerca de um minuto atrás da telemetria em tempo real.
:::

:::details Um serviço mostra "Sem dados recentes"
Nada chegou dele nos últimos 30 minutos. Isso é esperado para um serviço que só envia telemetria enquanto atende requisições, quando ninguém o chama. Se ele deveria estar atendendo requisições, verifique se está em execução, se o exportador do OpenTelemetry dele alcança o OneUptime e se ele ainda informa o mesmo `service.name`: um nome novo cria um serviço novo.
:::

## Próximos passos

:::cards
- [Explorador de registros](/docs/telemetry/logs-explorer): Pesquisar os registros de um serviço.
- [Explorador de traços](/docs/telemetry/traces-explorer): Acompanhar as requisições dele.
- [Exceções](/docs/telemetry/exceptions): Fazer a triagem dos erros que ele lança.
- [Regras de rótulos e proprietários](/docs/configuration/label-and-owner-rules): Dar rótulos e proprietários aos serviços novos.
:::
