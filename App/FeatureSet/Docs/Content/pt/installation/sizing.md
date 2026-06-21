# Dimensionamento e Planejamento de Capacidade

Este guia ajuda você a dimensionar uma implantação OneUptime auto-hospedada no Kubernetes (Helm). Ele cobre os três armazenamentos de dados dos quais o OneUptime depende — **PostgreSQL**, **Redis** e **ClickHouse** — além da computação da aplicação, e fornece níveis iniciais que você pode ajustar assim que tiver números reais.

> **Leia isto primeiro:** o chart do Helm vem **sem nenhuma requisição ou limite de CPU/memória definidos** e com volumes padrão pequenos de **25 Gi** para PostgreSQL e ClickHouse. Esses padrões existem para que o chart instale e funcione em qualquer cluster — eles **não** representam um dimensionamento de produção. Para qualquer coisa além de um teste rápido, defina recursos e armazenamento explicitamente usando os números abaixo.

Se em vez disso você estiver executando a instalação de servidor único com Docker Compose, o dimensionamento é mais simples — veja [Docker Compose](/docs/installation/docker-compose) (recomendado: 16 GB RAM, 8 núcleos, 400 GB de disco).

## O que determina cada armazenamento de dados

O OneUptime requer três armazenamentos de dados em produção. Eles escalam com base em entradas completamente diferentes, então dimensione-os de forma independente.

| Armazenamento de dados | O que ele armazena | O que determina seu tamanho |
| --- | --- | --- |
| **ClickHouse** | Toda a telemetria — logs, métricas, traces, exceções, profiles | **Taxa de ingestão × retenção** da telemetria. Isso representa ~95% do seu armazenamento e o custo dominante. |
| **PostgreSQL** | Configuração e estado — monitores, incidentes, alertas, usuários, equipes, projetos, workflows, páginas de status, dashboards | **Quantidade de entidades e histórico**, não o volume de telemetria. Cresce lentamente. |
| **Redis** | Cache, filas de trabalho e sessões | **Profundidade das filas e sessões ativas**. Limitado por memória e modesto. Não é uma fonte de verdade. |

O armazenamento de objetos (S3/MinIO) **não** é necessário para o OneUptime funcionar. Ele é usado apenas opcionalmente para **backups** do banco de dados (via o plugin Barman do CloudNativePG para PostgreSQL, ou `clickhouse-backup` para ClickHouse). O OneUptime não move a telemetria em camadas para o armazenamento de objetos — veja a seção "Retenção e como ela afeta o armazenamento" abaixo.

## ClickHouse — o fator dominante

Quase todo o seu armazenamento e uma grande parte da sua RAM irão para o ClickHouse, porque cada linha de log, ponto de métrica, span de trace e exceção reside ali.

### Fórmula de armazenamento

```
ClickHouse disk ≈ (daily raw telemetry GB ÷ compression) × retention days × replicas × 1.3 (headroom)
```

A compressão depende do sinal:

- **Logs** comprimem bem — aproximadamente **5:1**.
- **Métricas** comprimem menos — aproximadamente **2:1** — e uma alta **cardinalidade** de rótulos infla tanto o disco quanto a RAM mais rápido do que o volume bruto. Mantenha os rótulos com baixa cardinalidade.
- **Traces** ficam no meio-termo, dependendo dos atributos do span.

### Exemplo prático

Uma frota de **10 clusters**, cada um com ~10 nós / ~100 pods em verbosidade de nível INFO, produz aproximadamente **50–150 GB de logs brutos por cluster ao longo de 30 dias** (≈ 1.7–5 GB/dia por cluster). Em toda a frota, com métricas e traces adicionados e após a compressão, considere um orçamento de aproximadamente **5–15 GB/dia de telemetria comprimida**.

| Retenção | Réplica única | 2 réplicas + 30% de folga |
| --- | --- | --- |
| 30 days | ~150–450 GB | **~0.4–1.2 TB** |
| 90 days | ~0.45–1.35 TB | **~1.2–3.5 TB** |

O armazenamento escala **linearmente com a retenção** — uma janela de 90 dias custa ~3× uma janela de 30 dias.

### RAM e tipo de disco

- **Use NVMe/SSD.** A telemetria é intensiva em escrita com leituras de agregação em rajadas; o ClickHouse em disco mecânico terá dificuldades.
- **Forneça RAM generosa ao ClickHouse.** As consultas de agregação são intensivas em memória. Como regra geral, dimensione a RAM para uma fração significativa (25–50%) do seu conjunto de dados comprimido *quente* (consultado recentemente), com um piso prático de 16 GB para qualquer frota de produção real.
- **Controle a cardinalidade das métricas.** Ela é a maior alavanca individual tanto sobre a RAM quanto sobre o disco do ClickHouse. Imponha convenções de rótulos de baixa cardinalidade na camada de coleta e monitore as contagens de séries ativas.

## PostgreSQL — configuração e estado

O PostgreSQL armazena sua configuração e estado operacional, não a telemetria, então ele cresce lentamente e permanece pequeno em relação ao ClickHouse. Mesmo implantações grandes geralmente ficam na casa das dezenas de GB. O volume padrão de **25 Gi** é suficiente para instalações pequenas; planeje 50–100 GB para as maiores, com folga para o histórico de incidentes/alertas.

Se você executar muitas réplicas de aplicação, worker e probe, o número de conexões com o banco de dados pode se tornar o gargalo antes do armazenamento. O chart do Helm do OneUptime inclui um pooler de conexões **PgBouncer** opcional (`pgbouncer.enabled`) exatamente para isso — habilite-o para implantações com muitas réplicas.

## Redis — cache, filas e sessões

O Redis é usado como cache, fila de trabalho e armazenamento de sessões. Ele é **limitado por memória** e a persistência está **desabilitada por padrão** (o Redis aqui não é uma fonte de verdade — ele pode ser reconstruído). Dimensione-o pela profundidade esperada das filas e pelas sessões simultâneas; 2–8 GB de memória cobrem a maioria das implantações. Observe que a política de despejo padrão é `noeviction`, então se as filas se acumularem sob sobrecarga sustentada, monitore a memória do Redis.

## Computação da aplicação

Além dos armazenamentos de dados, dimensione as cargas de trabalho sem estado (ingress, web/API, workers e probes). Todos têm como padrão **1 réplica** sem limites de recursos — defina-os explicitamente. O chart inclui o **KEDA** para que workers e probes possam escalar automaticamente com base na profundidade das filas; habilite-o para cargas variáveis. Os workers escalam com o volume de processamento de telemetria/ingestão, e os probes escalam com o número de monitores ativos.

## Níveis iniciais

Escolha o nível mais próximo do seu ambiente como ponto de partida, depois observe o uso real (`kubectl top pods`, crescimento de disco do ClickHouse/Postgres) e ajuste.

- **Pequeno / PoC** — 1–3 clusters, ≤30 nós, ≤5 GB/dia de telemetria bruta, retenção de 30 dias.
- **Médio / Frota de produção** — ~10 clusters, ~100 nós, 10–30 GB/dia de telemetria bruta, retenção de 30–90 dias.
- **Grande / Multifrota** — 50+ clusters, 500+ nós, 100+ GB/dia de telemetria bruta, retenção de 90 dias.

| | Pequeno / PoC | Médio / Frota de produção | Grande / Multifrota |
| --- | --- | --- | --- |
| **ClickHouse** | 4 vCPU / 16 GB / 200 GB NVMe | 8 vCPU / 32 GB / 1–3 TB NVMe | 16+ vCPU / 64–128 GB / 5–15 TB NVMe, **fragmentado** |
| **PostgreSQL** | 2 vCPU / 4 GB / 50 GB SSD | 4 vCPU / 8 GB / 100 GB SSD | 8 vCPU / 16–32 GB / 250 GB SSD (+ PgBouncer) |
| **Redis** | 1 vCPU / 2 GB | 2 vCPU / 4 GB | 4 vCPU / 8–16 GB |
| **Retention assumed** | 30 days | 30–90 days | 90 days |

Esses valores dimensionam o **backend** do OneUptime. Os coletores do OneUptime que rodam em cada cluster monitorado são dimensionados separadamente — veja os níveis de dimensionamento do [Agente Kubernetes](/docs/telemetry/kubernetes-agent).

## Alta disponibilidade

Os armazenamentos de dados integrados ao chart rodam como **instâncias únicas** por padrão. Para HA em produção:

- **PostgreSQL** — habilite o operador [CloudNativePG](https://cloudnative-pg.io) incluído (`postgresOperator.cnpg.enabled`) com **3 instâncias** (1 primária + 2 hot standbys) para failover automático.
- **ClickHouse** — habilite o operador [Altinity](https://github.com/Altinity/clickhouse-operator) incluído (`clickhouseOperator.altinity.enabled`) com **≥2 réplicas por shard** e **3 nós ClickHouse Keeper** para quórum. Adicione shards assim que o disco ou a RAM de um único nó se tornar o limite.
- **Redis** — o chart não possui replicação interna. Para HA, aponte o OneUptime para um **Redis gerenciado externo** (ou uma implantação Sentinel/cluster).

## Retenção e como ela afeta o armazenamento

A retenção da telemetria é imposta como um **TTL do ClickHouse configurado em dias**, definido **por projeto** e refinável **por sinal** (logs, métricas, traces, profiles) e por bucket (por exemplo, por severidade de log). O padrão fixo no código é de 15 dias.

Como a retenção multiplica diretamente o armazenamento do ClickHouse, decida-a antes de dimensionar o disco. O OneUptime **não** arquiva nem move automaticamente a telemetria antiga em camadas para o armazenamento de objetos — para retenção de conformidade de vários anos, estenda a janela de retenção e dimensione o armazenamento do ClickHouse para corresponder (ou exporte para um arquivo externo de sua escolha).

## Meça antes de se comprometer

O volume de telemetria varia enormemente conforme a verbosidade dos logs da aplicação, a quantidade de namespaces, o intervalo de scrape e se o logging DEBUG está habilitado em algum lugar. Trate os níveis acima como pontos de partida: **instrumente seu ambiente por pelo menos quatro semanas**, meça os GB/dia reais por sinal e, então, dimensione a retenção e o armazenamento a partir de dados reais.

## Relacionados

- [Docker Compose](/docs/installation/docker-compose) — dimensionamento de servidor único
- [Arquitetura Auto-Hospedada](/docs/self-hosted/architecture) — como os componentes se encaixam
- [Agente Kubernetes](/docs/telemetry/kubernetes-agent) — dimensionamento do coletor (plano de dados)
- [Chart do Helm no Artifact Hub](https://artifacthub.io/packages/helm/oneuptime/oneuptime)
