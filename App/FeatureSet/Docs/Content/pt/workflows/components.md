# Componentes

Componentes são os nós de ação que você coloca depois de um gatilho. Cada um faz uma única coisa — uma requisição HTTP, uma mensagem no Slack, uma ramificação por condição, um trecho de JavaScript — e expõe uma ou mais portas de saída para o próximo nó se conectar.

Esta página é um catálogo. Para regras de conexão e o canvas em si, consulte [Criar um workflow](/docs/workflows/authoring).

## API

Faz uma requisição HTTP de saída para qualquer URL.

**Argumentos**:

- **Method** — `GET`, `POST`, `PUT`, `PATCH`, `DELETE`.
- **URL** — a URL da requisição. Interpolada.
- **Request Headers** — objeto JSON com cabeçalhos.
- **Request Body** — corpo JSON ou texto para `POST` / `PUT` / `PATCH`.

**Portas de saída**:

- `success` — dispara quando o status da resposta é 2xx. Valores de retorno: `response-status`, `response-headers`, `response-body`.
- `error` — dispara em falha de rede ou resposta não-2xx. Valor de retorno: a mensagem de `error`.

Use para: qualquer API REST de terceiros, seus próprios endpoints administrativos, integrações leves que não têm um componente dedicado.

## Webhook (saída)

Um wrapper enxuto em torno do componente API para o caso comum de "disparar e esquecer". Faz um `POST` de um corpo JSON em uma URL e expõe um único par `success` / `error`.

Prefira **API** se precisar ler o corpo da resposta a jusante; prefira **Webhook** se quiser apenas notificar outro sistema.

## Slack

Posta uma mensagem em um canal do Slack usando a conexão de workspace do Slack do seu projeto.

**Argumentos**:

- **Channel name** — o canal onde postar. O bot já deve ser membro desse canal.
- **Message text** — o corpo. Interpolado; suporta o mrkdwn do Slack.

Configure a conexão de workspace em **Project Settings → Workspace Connections → Slack** primeiro. Veja [Slack Workspace Connection](/docs/workspace-connections/slack).

## Microsoft Teams

Posta uma mensagem em um canal do Microsoft Teams usando a conexão do Teams do seu projeto.

**Argumentos**:

- **Team & channel** — o destino.
- **Message text** — o corpo.

Veja [Microsoft Teams Workspace Connection](/docs/workspace-connections/microsoft-teams) para configuração da conexão.

## Discord

Posta uma mensagem em um canal do Discord via uma URL de webhook de entrada configurada no componente.

## Telegram

Envia uma mensagem para um chat do Telegram via um token de bot e ID de chat configurados no componente.

## Email

Envia um e-mail pela configuração de SMTP do OneUptime.

**Argumentos**:

- **To** — endereço de e-mail do destinatário.
- **Subject** — interpolado.
- **Body** — Markdown ou HTML.

O e-mail é enviado a partir do endereço de remetente configurado no projeto (veja [SMTP](/docs/emails/smtp)).

## Custom Code

Roda um trecho de JavaScript com acesso às variáveis do workflow e aos valores de retorno do nó a montante.

**Argumentos**:

- **Code** — o corpo do JavaScript. O valor da última expressão (ou qualquer coisa retornada de `(async () => { ... })()`) se torna o valor de retorno do componente.
- **Arguments** — valores nomeados opcionais passados como `args`.

**Portas de saída**: `success` (valor de retorno), `error` (exceção capturada).

Use para: transformar um payload entre dois sistemas, fazer um pequeno cálculo que não merece um componente próprio, chamar lógica exclusiva de JS. Scripts mais pesados que precisam rodar dentro da sua própria infraestrutura pertencem a um passo Bash ou JavaScript de [Runbook](/docs/runbooks/index).

## JSON

Converte entre texto e JSON.

- **JSON → Text** — serializa um objeto JSON para uma string (útil para alimentar o argumento `body` de um componente de saída que espera texto).
- **Text → JSON** — parseia uma string em um objeto JSON. Útil quando uma API a montante retornou seu corpo como texto, mas você precisa ler um campo.

## Conditions

Ramifica em uma comparação. Configure:

- **Left value** — tipicamente uma referência interpolada como `{{Incident.title}}`.
- **Operator** — `==`, `!=`, `>`, `>=`, `<`, `<=`, `contains`, `starts with`, `ends with`.
- **Right value** — o valor com o qual comparar.

**Portas de saída**: `yes` e `no`. Conecte o resto do workflow ao ramo que casar com sua intenção.

## Schedule (atraso)

Pausa um workflow por uma duração configurada antes de continuar. Útil quando você precisa dar a um sistema externo um momento para estabilizar antes de checar o estado dele.

## Log

Escreve uma linha no log de execução do workflow. Pura ajuda de depuração; a linha é capturada na execução e fica visível em **Logs**. Sem efeito colateral externo.

## Execute Workflow

Chama outro workflow como sub-passo. O workflow chamado roda de forma independente (fire-and-forget) — o controle volta para quem chamou assim que a chamada é despachada.

Use para fatorar lógica compartilhada entre múltiplos workflows: construa um workflow "post-to-incident-channel" uma vez e o chame em todos os outros workflows que precisam notificar o canal.

Um limite de recursão impede que workflows chamem uns aos outros em loop infinito. Veja [Configuração e segurança](/docs/workflows/configuration).

## Componentes de modelo (CRUD em entidades do OneUptime)

Para toda entidade do OneUptime que suporta workflows (monitores, incidentes, alertas, páginas de status, políticas de plantão etc.), a paleta expõe automaticamente os seguintes componentes — pesquisáveis pelo nome da entidade:

- **Find One {Entity}** — busca um único registro por consulta.
- **Find {Entity}** — busca uma lista de registros por consulta (paginada).
- **Create {Entity}** — insere um novo registro.
- **Update {Entity}** — atualiza um registro por ID.
- **Delete {Entity}** — exclui um registro por ID.
- **Count {Entity}** — conta registros que casam com uma consulta.

É assim que um workflow consegue ler e escrever o estado do OneUptime sem sair da plataforma. Por exemplo: um webhook da sua ferramenta de CI chama **Create Incident** com a mensagem de falha do build; ou um workflow agendado roda **Find Incident** a cada cinco minutos e envia por e-mail um resumo.

## Escolhendo o componente certo

Algumas regras práticas:

- Se existe um componente dedicado para o que você quer fazer (Slack, Email, um CRUD em uma entidade do OneUptime), use-o — ele dá um tratamento de erro mais agradável e logs mais claros do que rolar o seu próprio.
- Se você precisa chamar uma API HTTP externa que não tem um componente dedicado, use **API**.
- Se você precisa *formatar* dados entre dois componentes, use **Custom Code** ou **JSON**.
- Se você precisa tomar ações diferentes com base em um valor, use **Conditions**.

## O que ler a seguir

- [Variáveis](/docs/workflows/variables) — como alimentar dados de um componente para o próximo.
- [Execuções e registros](/docs/workflows/runs-and-logs) — como inspecionar o que cada componente retornou durante uma execução.
- [Configuração e segurança](/docs/workflows/configuration) — limites, propriedade e segredos.
