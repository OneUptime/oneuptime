# Primeiros passos

OneUptime é uma plataforma de observabilidade de código aberto. Ela verifica se seus sites, APIs e servidores funcionam, coleta os logs, as métricas e os traces que seus aplicativos enviam, aciona quem está de plantão quando algo quebra e informa seus clientes em uma página de status. Tudo acontece em um só produto: a ferramenta que percebe um problema é a mesma que aciona sua equipe. Use o OneUptime Cloud ou execute o OneUptime nos seus próprios servidores.

Comece por aqui:

:::cards
- [Início rápido](/docs/introduction/quickstart): Monitorar um site, ser acionado quando ele falhar e publicar uma página de status.
- [Conceitos básicos](/docs/introduction/core-concepts): As poucas ideias sobre as quais todo o resto se apoia, e como elas se conectam.
- [Página inicial e atalhos](/docs/introduction/home): Encontrar o caminho no painel, e as teclas que poupam cliques.
- [Sua conta](/docs/introduction/your-account): Seu perfil, sua senha, suas chaves de acesso e a autenticação em dois fatores.
:::

## Como o OneUptime se encaixa

Tudo começa com algo que você monitora. Um monitor verifica isso em uma programação ou lê a telemetria que ele envia. Quando os critérios do monitor são atendidos, o OneUptime declara um incidente ou cria um alerta, aciona quem está de plantão e mostra o incidente na sua página de status, se você quiser.

```mermaid title="De uma verificação com falha a uma equipe acionada e uma página de status atualizada"
flowchart TB
    probes["As sondas verificam<br/>seus sites e APIs"] --> monitors["Monitores"]
    telemetry["Seus aplicativos e agentes<br/>enviam telemetria"] --> monitors
    monitors -->|"critérios atendidos"| problems["Incidentes e alertas"]
    problems --> oncall["As políticas de plantão<br/>acionam sua equipe"]
    problems --> status["As páginas de status<br/>informam seus clientes"]
```

- Um **incidente** é um problema que afeta seus usuários. Ele pode acionar quem está de plantão e aparecer na sua página de status.
- Um **alerta** é um problema que sua equipe deve investigar antes que os usuários percebam. Ele também pode acionar quem está de plantão, mas nunca aparece em uma página de status.

[Conceitos básicos](/docs/introduction/core-concepts) explica cada peça em poucas frases.

## Explorar a documentação

A documentação está organizada como a barra lateral, em nove seções. Escolha a parte de que você precisa.

### Monitoramento

:::cards
- [Monitores](/docs/monitor/create-monitor): Verificar sites, APIs, portas, DNS, servidores NTP, certificados e mais, a partir de sondas no mundo todo.
- [Monitores de infraestrutura](/docs/monitor/server-monitor): Acompanhar servidores, Kubernetes, Docker, VMware, dispositivos de rede e armazenamento.
- [Monitores de telemetria](/docs/monitor/logs-monitor): Alertar sobre os logs, as métricas, os traces, as exceções e os perfis que você envia.
- [SLOs](/docs/slo/introduction): Acompanhar metas de confiabilidade, orçamentos de erro e taxas de consumo.
- [Sondas](/docs/probe/custom-probe): Executar verificações de dentro da sua própria rede.
- [Quando o OneUptime não está recebendo dados](/docs/monitor/when-oneuptime-is-not-receiving): Por que uma falha do lado do OneUptime nunca conta como indisponibilidade sua.
:::

### Resposta a incidentes

:::cards
- [Incidentes](/docs/incidents/index): Declarar, coordenar e resolver incidentes, com uma linha do tempo completa.
- [Plantão](/docs/on-call/schedules): Rodízios, regras de escalonamento e quem é acionado e quando.
- [Páginas de status](/docs/status-pages/index): Manter os clientes informados em páginas de status públicas ou privadas.
- [Conexões com espaços de trabalho](/docs/workspace-connections/slack): Trabalhar nos incidentes a partir do Slack e do Microsoft Teams.
:::

### Observabilidade

:::cards
- [Telemetria](/docs/telemetry/open-telemetry): Enviar logs, métricas e traces com OpenTelemetry, e pesquisá-los.
- [Agentes de infraestrutura](/docs/telemetry/kubernetes-agent): Instalar os agentes para Kubernetes, hosts, Docker, Proxmox, VMware e mais.
- [Nuvem](/docs/telemetry/cloud-environments): Observar ECS, Cloud Run, Azure Container Apps e outras plataformas gerenciadas.
- [Observabilidade de IA](/docs/telemetry/ai-llm-observability): Acompanhar as conversas da sua IA e saber quando ela responde mal.
- [Segurança](/docs/telemetry/security-events): Coletar eventos de segurança e inteligência de ameaças.
- [Real User Monitoring](/docs/rum/index): Medir o que os usuários reais vivenciam, com Core Web Vitals e replay de sessão.
- [Painéis](/docs/dashboards/index): Montar painéis a partir das suas métricas, logs e monitores.
- [Inventário](/docs/inventory/overview): Ver cada serviço, host e dispositivo que o OneUptime conhece.
:::

### Automação e IA

:::cards
- [Runbooks](/docs/runbooks/index): Transformar procedimentos de resposta em passos que sua equipe pode executar.
- [Formulários](/docs/forms/index): Permitir que qualquer pessoa relate um problema por um formulário que abre um incidente.
- [Fluxos de trabalho](/docs/workflows/index): Automatizar ações quando algo acontece no OneUptime.
- [IA](/docs/ai/ai-sre): Deixar a OneUptime AI investigar incidentes e alertas, e perguntar a ela sobre seus sistemas.
:::

### Integrações

:::cards
- [Integrações](/docs/integrations/index): Conectar Jira, ServiceNow, Grafana, Datadog, Huntress, ferramentas SIEM, Discord, Telegram, IRC e mais.
:::

### Desenvolvedores

:::cards
- [Referência da API](/docs/api-reference/api-reference): Automatizar o OneUptime com sua API REST.
- [CLI](/docs/cli/index): Gerenciar o OneUptime pelo terminal e pela sua CI.
- [Provedor Terraform](/docs/terraform/index): Gerenciar monitores, páginas de status e plantão como código.
:::

### Administração

:::cards
- [Usuários e permissões](/docs/permissions/index): Convidar pessoas, organizar equipes e controlar o que elas podem fazer.
- [Identidade](/docs/identity/sso): Entrar com single sign-on SAML ou OIDC, e provisionar usuários com SCIM.
- [Configuração](/docs/configuration/label-and-owner-rules): Rotular recursos e atribuir proprietários automaticamente.
- [E-mails](/docs/emails/smtp): Enviar os e-mails do OneUptime pelo seu próprio servidor SMTP.
- [Aplicativos móveis e para desktop](/docs/mobile-desktop-apps/index): Ser acionado e responder no iOS, Android, macOS, Windows e Linux.
:::

### Auto-hospedagem

:::cards
- [Instalação](/docs/installation/docker-compose): Instalar, dimensionar e atualizar o seu próprio OneUptime.
- [Configuração auto-hospedada](/docs/self-hosted/architecture): Arquitetura, integrações e recursos Enterprise para a sua instalação.
:::

## Vindo de outra ferramenta

### Traga sua configuração

**Configurações do projeto → Importar de outra ferramenta** lê sua configuração em outra ferramenta, com uma chave de API ou, no caso do Uptime Kuma, um arquivo. Ela mostra o que encontrou e cria o que você marcar. Nada muda na outra ferramenta, e executar a importação de novo nunca cria nada em dobro.

| Vindo de | O que o OneUptime lê |
| --- | --- |
| [Opsgenie](/docs/moving-to-oneuptime/opsgenie) | Usuários, equipes, escalas, escalonamentos e serviços |
| [PagerDuty](/docs/moving-to-oneuptime/pagerduty) | Usuários, equipes, escalas, políticas de escalonamento e serviços |
| [incident.io](/docs/moving-to-oneuptime/incident-io) | Usuários, equipes, escalas, caminhos de escalonamento, serviços e configurações de incidentes |
| [Splunk On-Call](/docs/moving-to-oneuptime/splunk-on-call) | Usuários, equipes, rodízios e políticas de escalonamento |
| [Grafana OnCall](/docs/moving-to-oneuptime/grafana-oncall) | Usuários, equipes, escalas e cadeias de escalonamento |
| [UptimeRobot](/docs/moving-to-oneuptime/uptimerobot) | Monitores e páginas de status públicas |
| [Atlassian Statuspage](/docs/moving-to-oneuptime/atlassian-statuspage) | Páginas, seus componentes e grupos, e assinantes por e-mail |
| [Better Stack](/docs/moving-to-oneuptime/better-stack) | Monitores, heartbeats, páginas de status e assinantes por e-mail |
| [Pingdom](/docs/moving-to-oneuptime/pingdom) | Verificações de disponibilidade |
| [StatusCake](/docs/moving-to-oneuptime/statuscake) | Verificações de disponibilidade, SSL e heartbeat |
| [Uptime Kuma](/docs/moving-to-oneuptime/uptime-kuma) | Monitores, de um backup ou da página de métricas |

### O que o OneUptime substitui

| Recurso | O que faz | Substitui ferramentas como |
| --- | --- | --- |
| Monitoramento de disponibilidade | Verifica disponibilidade e tempo de resposta a partir de locais no mundo todo. | Pingdom, UptimeRobot |
| Páginas de status | Mostra aos clientes o status atual e o histórico dos seus serviços. | Atlassian Statuspage |
| Gestão de incidentes | Conduz incidentes do início ao fim, com notas, proprietários e uma linha do tempo. | incident.io |
| Plantão e alertas | Agenda os turnos de plantão e escala até alguém responder. | PagerDuty, Opsgenie |
| Gestão de logs | Coleta, pesquisa e visualiza logs. | Loggly |
| Fluxos de trabalho | Automatiza ações e conecta o OneUptime às ferramentas que você já usa. | Zapier |
| Monitoramento de desempenho de aplicações | Acompanha traces, tempos de resposta, vazão e taxas de erro. | New Relic, Datadog |
| Rastreamento de erros | Agrupa exceções com stack traces e contexto. | Sentry |

## Próximos passos

:::cards
- [Início rápido](/docs/introduction/quickstart): Configurar seu primeiro monitor, sua primeira política de plantão e sua primeira página de status.
- [Conceitos básicos](/docs/introduction/core-concepts): Aprender as palavras que todas as outras páginas usam.
- [Página inicial e atalhos](/docs/introduction/home): Encontrar qualquer página, configuração ou ação no painel.
- [Docker Compose](/docs/installation/docker-compose): Executar o OneUptime no seu próprio servidor.
:::
