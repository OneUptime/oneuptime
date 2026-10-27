# Retenção de dados

O OneUptime mantém os seus registros, traços, métricas e perfis por um número de dias e depois os exclui: 15 dias, a menos que você mude isso. Esta página mostra como esse número é calculado, como mudá-lo para o projeto inteiro e como manter parte da telemetria por mais ou menos tempo que o resto.

:::cards
- [Por quanto tempo a telemetria é mantida](#por-quanto-tempo-a-telemetria-é-mantida): A ordem em que o OneUptime lê as configurações.
- [Mudar a retenção do projeto](#mudar-a-retenção-do-projeto): Um único número para toda a sua telemetria.
- [Manter parte da telemetria por mais ou menos tempo](#manter-parte-da-telemetria-por-mais-ou-menos-tempo): Por tipo, gravidade, status ou serviço.
- [Quanto custa a retenção](#quanto-custa-a-retenção): A cobrança no OneUptime Cloud, o disco na hospedagem própria.
:::

## Por quanto tempo a telemetria é mantida

Cada registro, span, ponto de métrica e amostra de perfil recebe a sua retenção quando chega. O OneUptime calcula por quantos dias mantê-lo, marca a data em que ele expira e o exclui depois dessa data. A configuração mais específica vence:

```mermaid title="Qual configuração decide por quanto tempo uma entrada é mantida"
flowchart TB
    arrive["Chega um registro,<br/>um span ou um<br/>ponto de métrica"] --> resource{"Definida no seu<br/>serviço ou recurso?"}
    resource -->|"Não"| byType{"Definida no projeto<br/>para este tipo?"}
    byType -->|"Não"| projectDefault["Padrão do projeto:<br/>15 dias, salvo<br/>alteração"]
    resource -->|"Sim"| stamped["Marcado com uma<br/>expiração: chegada<br/>mais os dias"]
    byType -->|"Sim"| stamped
    projectDefault --> stamped
    stamped --> deleted["Excluído depois<br/>dessa data"]
```

Em detalhe, o OneUptime lê estas configurações nesta ordem, e a primeira definida decide:

| Ordem | Configuração | Onde é definida |
| --- | --- | --- |
| 1 | Dias para uma gravidade de registro ou um status de span, para um serviço ou recurso | **Retenção por tipo de telemetria**, em **Mais configurações** na sua página **Configurações** |
| 2 | Dias para um tipo de telemetria, para um serviço ou recurso | O mesmo cartão |
| 3 | Dias para tudo o que vem de um serviço ou recurso | **Retenção de Dados de Telemetria**, em **Mais configurações** na mesma página |
| 4 | Dias para uma gravidade de registro ou um status de span, para o projeto | **Retenção por tipo de telemetria**, em **Mais configurações** de **Retenção de dados** |
| 5 | Dias para um tipo de telemetria, para o projeto | O mesmo cartão |
| 6 | Dias para todo o resto | **Retenção Padrão (Dias)**, em **Retenção de dados** |

- **As configurações 1 a 5 são substituições de retenção.** Elas fazem parte da [Edição Enterprise](/docs/self-hosted/enterprise), e do plano Scale no OneUptime Cloud. Sem elas, cada entrada é mantida pelo padrão do projeto.
- **Uma mudança vale para a telemetria nova.** Uma entrada mantém a data que recebeu: uma retenção mais curta não a exclui antes, e uma mais longa não a mantém por mais tempo. As entradas novas seguem uma mudança em cerca de cinco minutos.
- **As exceções seguem aquilo em que foram encontradas.** Uma exceção é mantida pelo mesmo tempo que o span ou o registro de onde veio. As Session Replays têm uma retenção própria: veja [Outros dados com retenção própria](#outros-dados-com-retenção-própria).

## Antes de começar

- **Uma função que altere o projeto.** Project Owner ou Project Admin mudam a retenção do projeto. A retenção de um serviço ou recurso exige a função que altera as outras configurações dele.
- **Para as substituições, a Edição Enterprise ou o plano Scale.** Uma instalação de hospedagem própria precisa de uma licença Enterprise, e um projeto do OneUptime Cloud do plano Scale ou superior. A retenção padrão do projeto existe em todas as edições e planos.

## Mudar a retenção do projeto

:::steps
### Abrir a retenção de dados

Acesse **Configurações do projeto → Telemetria e APM → Retenção de dados**. **Telemetria e APM** começa recolhido no menu lateral: clique nele para abri-lo. O cartão **Retenção de Dados de Telemetria** mostra a **Retenção Padrão (Dias)**.

### Definir o número de dias

Clique em **Edit Retention Settings**, digite o número de dias, pelo menos 1, e clique em **Salvar alterações**.
:::

O novo número vale para cada entrada que chega a partir de então e não tem uma substituição própria.

## Manter parte da telemetria por mais ou menos tempo

As substituições mantêm por mais tempo o que você precisa e por menos tempo o resto: registros de erro por um trimestre, por exemplo, e registros de depuração por alguns dias.

### Para o projeto inteiro

Abaixo do padrão, recolhido em **Mais configurações**, o cartão **Retenção por tipo de telemetria** define dias para cada tipo de telemetria. Clique em **Edit Overrides**, preencha os campos de que precisa e deixe os outros em branco:

| Tipo | Campos |
| --- | --- |
| Registros | **Logs default (days)**, e um campo para cada gravidade de registro |
| Traços | **Traces default (days)**, e um campo para cada status de span: Erro, Ok e Não definido |
| Métricas | **Metrics default (days)** |
| Perfis | **Profiles default (days)** |

Um campo deixado em branco recorre à configuração seguinte da ordem acima, então uma gravidade sem dias próprios mantém os seus registros pelo padrão dos registros.

### Para um serviço ou recurso

Abra a página **Configurações** do serviço ou do recurso e depois **Mais configurações**. O seu cartão **Retenção de Dados de Telemetria** tem **Reter dados de telemetria por (dias)**, um único número para tudo o que ele envia, e o seu cartão **Retenção por tipo de telemetria** tem os mesmos campos que o do projeto. Deixe um campo em branco para usar as configurações do projeto.

Serviços, hosts, clusters Kubernetes, hosts Docker e Podman, clusters Docker Swarm, Proxmox e Ceph, storage arrays, vCenters, bancos de dados, funções serverless, recursos de nuvem, aplicações RUM e frotas IoT têm todos esses cartões. Veja o [Catálogo de serviços](/docs/telemetry/services#alterar-um-serviço) para a página **Configurações** de um serviço.

### Quando o plano ou a licença não inclui mais as substituições

- **Em uma instalação de hospedagem própria**, as substituições deixam de valer quando o teste Enterprise ou o período de carência termina sem uma licença. A telemetria nova é mantida pelo padrão do projeto, os cartões ficam somente leitura e nada do que você definiu é excluído: ative uma licença e elas voltam a valer. Veja [Edição Enterprise](/docs/self-hosted/enterprise#quando-uma-licença-expira-ou-está-ausente).
- **No OneUptime Cloud**, uma substituição que um teste deixou definida continua valendo abaixo do plano Scale. A página dela a mostra sob o cartão de upgrade, com um botão **Remover substituição** que funciona em todos os planos. Definir uma substituição de novo exige o plano Scale.

## Outros dados com retenção própria

| Dados | Mantidos por | Onde mudar |
| --- | --- | --- |
| Session Replays | 7 dias, salvo alteração | A política de gravação da aplicação RUM: veja [Gerenciar aplicações](/docs/rum/applications#retenção-da-reprodução-de-sessões). |
| Registros de monitores, uma linha por verificação | 1 dia, salvo alteração | Em uma instalação de hospedagem própria, **Retenção de Registros do Monitor (Dias)** no Admin Dashboard |
| Métricas de monitores, e as métricas que os SLOs registram | 30 dias, salvo alteração | Em uma instalação de hospedagem própria, **Retenção de Métricas do Monitor (Dias)** no Admin Dashboard |

## Quanto custa a retenção

- **No OneUptime Cloud**, a telemetria é cobrada por GB ingerido, e o preço por GB inclui 15 dias de retenção. Uma retenção mais longa custa proporcionalmente mais: 30 dias custam o dobro por GB que 15. Uma retenção mais curta custa proporcionalmente menos, mas uma retenção de menos de 7 dias é cobrada como 7 dias. **Configurações do projeto → Cobrança e faturas → Histórico de uso** mostra, dia a dia, quanto cada serviço enviou e por quanto tempo isso é mantido.
- **Na hospedagem própria**, a telemetria fica no ClickHouse, e a retenção multiplica o disco dele. Veja [Dimensionamento](/docs/installation/sizing#a-retenção-e-como-ela-afeta-o-armazenamento).

A telemetria de que você não precisa não custa nada se nunca for armazenada: os [Filtros de descarte e regras de mascaramento](/docs/telemetry/drop-filters-and-scrub-rules) a descartam quando ela chega.

## Solução de problemas

:::details Reduzi a retenção, mas os dados antigos continuam lá
Uma entrada mantém a data de expiração que recebeu quando chegou. As entradas armazenadas antes da mudança são excluídas nas suas próprias datas, e só as entradas novas seguem a nova retenção.
:::

:::details Os cartões de substituição mostram um convite para upgrade
As substituições de retenção exigem a Edição Enterprise em uma instalação de hospedagem própria, e o plano Scale no OneUptime Cloud. Até lá, tudo é mantido pelo padrão do projeto.
:::

:::details O espaço em disco volta um dia depois que os dados expiram
As entradas expiradas deixam de aparecer em pesquisas, gráficos e listas assim que expiram. No disco, os registros e as métricas são excluídos na primeira meia-noite depois disso, então o espaço deles volta até um dia depois.
:::

## Próximos passos

:::cards
- [Chaves de ingestão](/docs/telemetry/ingestion-keys): Envie telemetria para o seu projeto.
- [Filtros de descarte e regras de mascaramento](/docs/telemetry/drop-filters-and-scrub-rules): Mantenha só a telemetria de que você precisa.
- [Catálogo de serviços](/docs/telemetry/services): Defina a retenção própria de um serviço.
- [Edição Enterprise](/docs/self-hosted/enterprise): O que as substituições de retenção trazem.
:::
