# Visão geral dos Runbooks

Runbooks são procedimentos de resposta reutilizáveis — listas ordenadas de passos manuais ou automatizados — que você anexa a incidentes, alertas ou eventos de manutenção programada. Eles transformam aquelas threads improvisadas do Slack "e agora, o que a gente faz?" em algo que um colega consegue retomar do zero às 3 da manhã.

## Visão rápida

- **Funcionalidade de primeiro nível** no painel do OneUptime, em **Análise & Automação → Runbooks**.
- **Quatro tipos de passo**: checklist manual, JavaScript (em sandbox) e Bash (ambos rodam em um [Agente de Runbook](/docs/runbooks/agents) dentro da sua própria infraestrutura), requisição HTTP.
- **Três formas de disparo**: regras que casam com incidentes/alertas/manutenção programada, ou o botão manual "Executar runbook" em qualquer evento.
- **Semântica de snapshot**: quando um runbook começa, seus passos são copiados na execução. Editar o modelo depois nunca muda uma execução em andamento.
- **Trilha de auditoria completa**: o status, a saída, a mensagem de erro e a duração de cada passo ficam guardados na execução para sempre.

## Por que usar runbooks?

A resposta a incidentes muitas vezes é a diferença entre um soluço de um minuto e uma queda de várias horas. Runbooks ajudam você a:

- **Codificar conhecimento tribal** — a resposta para "o que fazer quando a fila acumula" mora num lugar onde o time consegue achar.
- **Reduzir o tempo médio de recuperação (MTTR)** — passos automatizados rodam em segundos; passos manuais eliminam a paralisia de decisão.
- **Auditar as ações de resposta** — cada passo executado, cada saída, cada clique do responder fica registrado na execução.
- **Habilitar juniores** — eles podem rodar um runbook com confiança em vez de chamar um sênior às 3 da manhã.
- **Escrever post-mortems com dados, não com memória** — a execução capturada é um registro congelado do que realmente aconteceu.

## Conceitos-chave

Alguns termos aparecem o tempo todo no restante da documentação de runbooks. Vamos deixar claros primeiro:

| Termo | Significado |
| --- | --- |
| **Runbook** | O modelo. Um procedimento nomeado e reutilizável com uma lista ordenada de passos e uma flag `isEnabled`. |
| **Passo** | Um item dentro de um runbook. Tem tipo (Manual / JavaScript / HTTP / Bash), título, descrição e configuração específica do tipo. |
| **Regra de runbook** | Um padrão que anexa automaticamente um ou mais runbooks a incidentes, alertas ou eventos de manutenção quando o título ou descrição casam com uma regex. |
| **Execução** | Uma corrida de um runbook. Criada quando uma regra dispara, quando alguém clica "Executar runbook" em um evento, ou quando alguém clica "Executar agora" no próprio runbook. Contém um snapshot dos passos e o status/saída por passo. |
| **Snapshot** | A cópia congelada dos passos do runbook que mora em cada execução. Permite editar o modelo depois sem reescrever o histórico. |

## O ciclo de vida de um runbook

1. **Escrever** — Crie um runbook, misture passos Manuais, JavaScript, HTTP e Bash. Salve.
2. **(Opcional) Adicionar uma regra** — Nas configurações de Incidentes, Alertas ou Manutenção programada, diga ao OneUptime para iniciar este runbook sempre que o título ou descrição de um evento casar com uma regex.
3. **Disparar** — Ou a regra dispara automaticamente quando um evento correspondente é criado, ou um responder clica em **Executar runbook** manualmente.
4. **Executar** — Uma nova execução é criada com um snapshot dos passos. Os passos automatizados rodam no worker de Runbook; a execução pausa em cada passo manual até alguém marcá-lo.
5. **Auditar** — A execução fica para sempre na aba **Runbooks** do evento e na lista de execuções do runbook. Saída, erros e tempo por passo são preservados para o post-mortem.

## Quando usar cada tipo de passo

Guia rápido de decisão. O detalhamento completo está em [Escrever um runbook](/docs/runbooks/authoring).

| Tipo de passo | Use quando… | Exemplo |
| --- | --- | --- |
| **Manual** | Um humano precisa verificar algo, tomar uma decisão ou fazer uma ação que o OneUptime não consegue observar. | "Confirmar tráfego da região secundária no painel do balanceador." |
| **JavaScript** | Você precisa de um cálculo pequeno e contido — consultar um serviço de configuração, transformar um payload, rodar lógica antes do próximo passo. Roda em sandbox em um [Agente de Runbook](/docs/runbooks/agents) na sua própria infraestrutura. | Calcular o lag de réplica atual e decidir se prossegue. |
| **Requisição HTTP** | Você está chamando uma API existente — seu endpoint admin, um provedor cloud, PagerDuty, Slack. | `POST` para seu orquestrador de failover. |
| **Bash** | Você precisa rodar comandos shell na sua própria infraestrutura — reiniciar um serviço, rodar `kubectl`, chamar um script de deploy. Requer um [Agente de Runbook](/docs/runbooks/agents) instalado no seu ambiente. | Reiniciar um serviço, rodar `kubectl rollout restart`, executar um script de recuperação. |

Você pode misturar os quatro num único runbook — a força dos runbooks está em intercalar verificação humana com automação.

## Onde os runbooks ficam no painel

| Página | O que você faz lá |
| --- | --- |
| **Análise & Automação → Runbooks** | Navegar, criar e editar modelos de runbook. |
| **Aba Passos de um runbook** | Escrever e reordenar a lista de passos. |
| **Aba Execuções de um runbook** | Ver cada execução desse runbook com filtros de status. |
| **Botão "Executar agora" de um runbook** | Disparar uma execução ad hoc sem vínculo com nenhum evento. |
| **Incidentes / Alertas / Manutenção programada → Configurações → Regras de runbook** | Criar as regras de auto-disparo por tipo de entidade. |
| **Um incidente / alerta / evento de manutenção → aba Runbooks** | Ver as execuções vinculadas a esse evento e clicar **Executar runbook** para uma corrida manual. |

## Casos de uso comuns

Alguns padrões em que vemos times alcançando os runbooks:

- **Failover de banco de dados** — Capturar estado atual com JavaScript, pedir ao DBA de plantão que confirme a saúde da réplica (Manual), chamar a API do orquestrador (HTTP), marcar "DNS atualizado" (Manual), postar "tudo certo" no Slack (HTTP).
- **Flush de cache** — Um único passo HTTP mais um Manual "confirme que a taxa de acertos do cache está se recuperando no painel".
- **Incidente que afeta cliente** — Manual: "Postar atualização na página de status." HTTP: "Notificar time de CS no #customer-incidents." JavaScript: "Buscar lista de contas afetadas na API interna."
- **Pré-checagem de manutenção programada** — JavaScript: snapshot das métricas atuais. Manual: "Confirmar janela de mudança com os stakeholders." HTTP: ativar modo manutenção no balanceador.
- **Higiene "rode sempre"** — Uma regra com padrão de título vazio que captura o estado do sistema em todo incidente, não importa qual — ótimo para post-mortems.

## Um exemplo trabalhado

Suponha que você queira que todo incidente com "db-primary" no título dispare automaticamente um runbook de failover de DB com cinco passos.

**1. Crie o runbook.** Em **Runbooks → Criar Runbook**, dê o nome "Failover DB primary" e adicione estes passos:

| # | Tipo | Título |
| --- | --- | --- |
| 1 | JavaScript | Capturar lag de réplica pré-failover |
| 2 | Manual | Confirmar que a réplica está saudável no painel do DBA |
| 3 | HTTP | `POST` para o orquestrador de failover |
| 4 | Manual | Verificar que as escritas estão indo para o novo primary |
| 5 | HTTP | Postar "tudo certo" no Slack `#db-incidents` |

**2. Adicione uma regra.** Em **Incidentes → Configurações → Regras de runbook**, crie:

```
Title Pattern:  ^db-primary
Runbooks:       [Failover DB primary]
```

**3. Dispare.** Um alerta de monitor abre o incidente `INC-4821 · db-primary connection timeout`. A regra casa, uma execução é criada e:

- O passo 1 (JavaScript) roda na hora no worker — seu `return { lagMs: 412 }` é capturado.
- O passo 2 (Manual) pausa a execução. O responder vê a pílula "Aguardando você" na página do incidente, abre o painel e marca o passo.
- O passo 3 (HTTP) roda assim que o passo 2 é marcado — o corpo da resposta do `POST` é capturado.
- O passo 4 (Manual) pausa de novo.
- O passo 5 (HTTP) roda e a execução termina.

**4. Audite.** A execução fica na aba **Runbooks** do incidente. A saída de cada passo está a um clique. Quando você escrever o post-mortem na semana seguinte, não precisa perguntar "o que aquele script retornou?" — está bem ali.

## Como os runbooks se encaixam no resto do OneUptime

- **Monitores** abrem incidentes e alertas; **regras de runbook** transformam esses eventos em execuções de runbook. Juntos formam um loop fechado: detectar → disparar → responder → registrar.
- **Conexões de workspace** (Slack, Microsoft Teams) são alvo natural dos passos HTTP de runbook — postar atualizações de status, notificar canais.
- **Páginas de status** costumam ser atualizadas como passo Manual em um runbook que afeta cliente.
- **Escalas de plantão** decidem quem é chamado; runbooks decidem o que essa pessoa faz depois de acordar.

## O que ler a seguir

- [Escrever um runbook](/docs/runbooks/authoring) — criar runbooks, os quatro tipos de passo e o que cada um faz.
- [Regras de runbook](/docs/runbooks/rules) — anexar runbooks automaticamente a incidentes, alertas e manutenções programadas.
- [Executar um runbook](/docs/runbooks/running) — disparos manuais, a visão de execução e como passos manuais interagem com os automatizados.
- [Agentes de runbook](/docs/runbooks/agents) — instalar os agentes que executam passos Bash na sua própria infraestrutura.
- [Configuração e segurança](/docs/runbooks/configuration) — limites de saída, permissões, notas de hardening.
