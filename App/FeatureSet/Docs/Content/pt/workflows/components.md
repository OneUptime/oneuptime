# Componentes

Componentes são os blocos de construção que você adiciona depois do gatilho. Cada um faz uma coisa — enviar uma mensagem, chamar uma API, verificar uma condição — e se conecta ao que vier em seguida.

Esta página é o catálogo. Para saber como arrastar, soltar e conectá-los no canvas, veja [Criando um Workflow](/docs/workflows/authoring).

## API

Faça uma requisição HTTP para qualquer URL.

**Configurações**:

- **Método** — `GET`, `POST`, `PUT`, `PATCH` ou `DELETE`.
- **URL** — o endereço a ser chamado.
- **Cabeçalhos** — quaisquer cabeçalhos a enviar.
- **Corpo** — o corpo da requisição para `POST` / `PUT` / `PATCH`.

**Saídas**:

- **Sucesso** — dispara quando a chamada funcionou (resposta 2xx). Repassa o status, cabeçalhos e corpo.
- **Erro** — dispara em falha de rede ou resposta não 2xx. Repassa a mensagem de erro.

Use para: qualquer API externa, seus próprios endpoints administrativos ou qualquer integração que não tenha um componente próprio.

## Webhook (saída)

Uma versão mais simples do componente API para casos do tipo "dispare e esqueça". Faz um POST com um corpo JSON em uma URL.

Use **API** se você precisa ler a resposta. Use **Webhook** se você só quer enviar uma notificação e seguir em frente.

## Slack

Posta uma mensagem em um canal do Slack.

**Configurações**:

- **Canal** — o nome do canal. O bot precisa já estar nesse canal.
- **Mensagem** — o texto a enviar. Aceita formatação do Slack.

Primeiro conecte o Slack ao seu projeto em **Configurações do Projeto → Conexões de Workspace → Slack**. Veja [Conexão de Workspace do Slack](/docs/workspace-connections/slack).

## Microsoft Teams

Posta uma mensagem em um canal do Microsoft Teams.

**Configurações**:

- **Equipe e canal** — onde postar.
- **Mensagem** — o texto a enviar.

Veja [Conexão de Workspace do Microsoft Teams](/docs/workspace-connections/microsoft-teams) para a configuração.

## Discord

Posta uma mensagem em um canal do Discord através de uma URL de webhook de entrada.

## Telegram

Envia uma mensagem para um chat do Telegram usando um token de bot e um ID de chat.

## E-mail

Envia um e-mail através do OneUptime.

**Configurações**:

- **Para** — o endereço de e-mail do destinatário.
- **Assunto** — a linha de assunto.
- **Corpo** — a mensagem em Markdown ou HTML.

O e-mail é enviado a partir do remetente configurado no seu projeto — veja [SMTP](/docs/emails/smtp).

## Código Customizado

Execute um pequeno trecho de JavaScript quando precisar de algo que os outros blocos não fazem.

**Configurações**:

- **Código** — seu JavaScript. O último valor (ou o que você retornar de uma função assíncrona) se torna a saída do bloco.
- **Argumentos** — valores nomeados que você pode passar.

**Saídas**: sucesso (seu valor de retorno) e erro (qualquer exceção).

Use para: ajustar a forma dos dados entre dois sistemas, fazer um pequeno cálculo, qualquer coisa que não merece um bloco próprio. Para scripts mais pesados, use um [Runbook](/docs/runbooks/index).

## JSON

Converte entre texto e JSON.

- **JSON → Texto** — transforma um objeto JSON em uma string. Útil quando o próximo bloco espera texto.
- **Texto → JSON** — analisa uma string em um objeto JSON. Útil quando algo chegou como texto e você precisa ler um campo.

## Condições

Ramifica com base em uma comparação.

**Configurações**:

- **Valor à esquerda** — geralmente um valor de um bloco anterior.
- **Operador** — `==`, `!=`, `>`, `>=`, `<`, `<=`, `contém`, `começa com`, `termina com`.
- **Valor à direita** — com o que comparar.

**Saídas**: **Sim** e **Não**. Conecte os próximos blocos ao ramo que você quiser.

## Atraso

Pausa o workflow por um tempo definido antes de continuar. Útil quando você precisa dar um momento para outro sistema acompanhar.

## Log

Escreve uma linha no log da execução. Sem efeito externo — só aparece nos logs do workflow para você ler. Bom para depuração.

## Executar Workflow

Chama outro workflow a partir deste. O workflow chamado roda por conta própria — o seu workflow continua sem esperar que ele termine.

Use para compartilhar lógica comum. Construa um workflow "postar no canal de incidentes" uma vez e chame-o de qualquer outro workflow que precise notificar o canal.

Existe um limite de segurança para que workflows não fiquem se chamando em loop. Veja [Configuração e Segurança](/docs/workflows/configuration).

## Componentes de dados do OneUptime

Para cada tipo de registro no OneUptime (monitores, incidentes, alertas, páginas de status, políticas de plantão e muitos outros), a paleta tem estes componentes — busque pelo nome do tipo:

- **Buscar Um** — obtém um registro por ID ou filtro.
- **Buscar** — obtém uma lista de registros.
- **Criar** — adiciona um novo registro.
- **Atualizar** — altera um registro.
- **Excluir** — remove um registro.
- **Contar** — conta registros que correspondem a um filtro.

É assim que um workflow pode ler e alterar dados do OneUptime. Por exemplo: um webhook da sua ferramenta de CI pode usar **Criar Incidente** para abrir um incidente com os detalhes da falha.

## Qual componente devo usar?

Algumas regras rápidas:

- Se houver um bloco dedicado para o que você quer (Slack, E-mail, um registro do OneUptime), use-o — você ganha um tratamento de erros mais elegante e logs mais claros.
- Para qualquer outra API externa, use **API**.
- Para ajustar a forma dos dados entre blocos, use **Código Customizado** ou **JSON**.
- Para tomar ações diferentes com base em um valor, use **Condições**.

## O que ler em seguida

- [Variáveis](/docs/workflows/variables) — passando dados entre blocos.
- [Execuções e Registros](/docs/workflows/runs-and-logs) — verificando o que cada bloco fez em uma execução.
- [Configuração e Segurança](/docs/workflows/configuration) — limites, donos e segredos.
