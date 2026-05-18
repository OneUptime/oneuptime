# Escrever um runbook

Crie um runbook em **Runbooks → Criar Runbook**, abra-o e vá na aba **Passos**.

## Anatomia de um passo

Todo passo tem:

| Campo | Propósito |
| --- | --- |
| **Título** | Rótulo curto mostrado na UI de checklist. Obrigatório. |
| **Descrição** | Contexto opcional para quem responde. Texto seguro para Markdown. |
| **Continuar em caso de falha** | Se ligado, um passo que falha não interrompe a execução — o próximo roda mesmo assim. |
| **Requer aprovação** | Se ligado, o runbook pausa após este passo e espera um usuário aprovar antes de rodar o próximo. |
| **Config específica do tipo** | Script, URL, agente, etc. — veja abaixo. |

Passos rodam **em ordem**. Reordene com as setas para cima/baixo no editor de Passos.

## Tipos de passo

### Manual

Uma checkbox que quem responde marca. A execução do runbook pausa ao chegar num passo Manual e fica em `WaitingForManualStep` até alguém marcar como concluído (ou pular).

Use para coisas que só um humano pode verificar: "Confirmado que o tráfego foi para a região secundária no painel do balanceador."

### JavaScript

Um trecho de JavaScript rodado em um sandbox `isolated-vm`. O sandbox vive em um [Agente de Runbook](/docs/runbooks/agents) dentro da sua própria infraestrutura — não no Worker do OneUptime.

Configure duas coisas em um passo JavaScript:

- **Agente de Runbook** — escolha no dropdown o agente que deve rodar este passo. Só o agente selecionado pode reivindicar o job.
- **Script** — o JavaScript a ser executado.

```js
const start = Date.now();
// ... sua lógica ...
return { durationMs: Date.now() - start };
```

O valor retornado é capturado na execução do passo. A saída do `console.log` é capturada como linhas de log. Timeout de execução padrão: 30 segundos. Claim timeout padrão (por quanto tempo o Worker espera o agente pegar o job): 2 minutos.

### Requisição HTTP

Faz uma chamada HTTP de saída. Configure método (GET/POST/PUT/PATCH/DELETE/HEAD), URL, cabeçalhos JSON opcionais e corpo opcional. Status, cabeçalhos e corpo da resposta são capturados (até 50KB no total).

Útil para: abrir um incidente no PagerDuty, postar no Slack, chamar sua própria API admin, etc. Passos HTTP rodam direto no Worker do OneUptime; não exigem agente.

### Bash

Um script bash (`bash -c <script>`) rodado em um [Agente de Runbook](/docs/runbooks/agents) na sua própria infraestrutura. Bash nunca roda no Worker do OneUptime.

Configure duas coisas em um passo Bash:

- **Agente de Runbook** — escolha no dropdown o agente que deve rodar este passo. Só o agente selecionado pode reivindicar o job.
- **Script** — o bash a executar. A saída (stdout + stderr) é capturada até 50&nbsp;KB; o processo é morto no timeout.

Se o agente selecionado estiver offline quando o runbook chega neste passo, ele espera até o **claim timeout** (padrão 2 minutos) e depois falha com `TimedOut`. Adicione um agente em **Runbooks → Configurações → Agentes** antes de depender de um passo Bash.

## Salvar e editar

Clique **Salvar passos** para persistir. Execuções em andamento de versões anteriores do runbook não são afetadas — continuam usando seu snapshot.

## Múltiplos passos e tratamento de falhas

Por padrão, um passo que falha interrompe a execução e a marca como `Failed`. Se você ativar **Continuar em caso de falha** em um passo, a falha é registrada mas o próximo passo roda. Útil para padrões "tente estas três coisas, depois notifique".

## Um exemplo trabalhado

Um runbook simples para "DB primary inalcançável":

1. **JavaScript** — busque o host primary atual no seu serviço de configuração e registre.
2. **Manual** — "Confirmar lag de replicação na secundária abaixo de 5 segundos."
3. **Requisição HTTP** — POST para a API do seu orquestrador de failover.
4. **Manual** — "Verificar que as escritas estão indo para o novo primary."
5. **Requisição HTTP** — POST para o Slack com mensagem de "tudo certo".

Quem responde vê um passo automatizado rodando, marca um manual, vê o próximo automatizado rodar, e assim por diante. A saída de cada passo é capturada para o post-mortem.
