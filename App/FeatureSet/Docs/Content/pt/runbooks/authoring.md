# Escrever um runbook

Crie um runbook em **Runbooks → Criar runbook**, depois abra-o e vá para a aba **Passos**.

## Anatomia de um passo

Cada passo tem:

| Campo | Função |
| --- | --- |
| **Título** | Rótulo curto mostrado na UI de checklist. Obrigatório. |
| **Descrição** | Contexto opcional para quem responde. Texto Markdown. |
| **Continuar em caso de falha** | Se ligado, um passo que falha não interrompe a execução — o próximo roda mesmo assim. |
| **Configuração específica do tipo** | Script, URL, etc. — veja abaixo. |

Os passos rodam **em ordem**. Reordene com as setas pra cima/baixo no editor de passos.

## Tipos de passo

### Manual

Uma caixinha que quem responde marca. A execução pausa ao chegar em um passo manual e fica em `WaitingForManualStep` até alguém marcar como concluído (ou pular).

Use para o que só um humano consegue verificar: "Tráfego foi para a região secundária no painel do balanceador — confirmado."

### JavaScript

Um trecho de JavaScript rodando em sandbox `isolated-vm` (sem filesystem, sem rede a menos que você traga uma API).

```js
const start = Date.now();
// ... sua lógica ...
return { durationMs: Date.now() - start };
```

O valor retornado é registrado na execução do passo. A saída de `console.log` é capturada como linhas de log. Timeout padrão: 30 segundos.

### Requisição HTTP

Uma chamada HTTP de saída. Configure método (GET/POST/PUT/PATCH/DELETE/HEAD), URL, cabeçalhos JSON opcionais e corpo opcional. Status, cabeçalhos e corpo da resposta são registrados (limitados a 50 KB no total).

Útil para: abrir um incidente no PagerDuty, postar no Slack, chamar sua própria API admin etc.

### Bash

Um script bash que roda em um [Agente de Runbook](/docs/runbooks/agents) — um pequeno processo que você instala em um host dentro da sua própria infraestrutura. Passos Bash nunca são executados no Worker do OneUptime.

Configure duas coisas em um passo Bash:

- **Agent Tag** — o tag que identifica qual(is) agente(s) deve(m) executar este passo. Qualquer agente saudável no projeto que carregue esse tag vai reivindicar e executar o job.
- **Script** — o bash a executar. A saída (stdout + stderr) é capturada até 50 KB; o processo é morto no timeout.

Se nenhum agente com o tag escolhido estiver online quando o runbook chegar a este passo, o passo aguarda até o **claim timeout** (padrão de 2 minutos) e então falha. Adicione um agente em **Runbooks → Agents** antes de depender de um passo Bash.

## Salvar e editar

Aperte **Salvar passos** para persistir. Execuções em andamento de versões antigas do runbook não são afetadas — continuam com seu snapshot.

## Vários passos e tratamento de falha

Por padrão, um passo que falha interrompe a execução e a marca como `Failed`. Se você ativar **Continuar em caso de falha** em um passo, a falha é registrada mas o próximo passo roda. Útil para padrões "tente estas três coisas, depois notifique".

## Um exemplo completo

Um runbook simples para "DB primário inalcançável":

1. **JavaScript** — buscar o host primário atual no serviço de configuração e logar.
2. **Manual** — "Lag de replicação do secundário abaixo de 5 segundos — confirmado."
3. **Requisição HTTP** — POST para a API do seu orquestrador de failover.
4. **Manual** — "Escritas estão indo para o novo primário — confirmado."
5. **Requisição HTTP** — POST no Slack com mensagem de "tudo certo".

Quem responde vê um passo automatizado rodar, marca um manual, vê o próximo automatizado, e por aí vai. A saída de cada passo é guardada para o post-mortem.
