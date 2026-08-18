# Componentes

Componentes são os blocos de construção que você adiciona depois do gatilho. Cada um faz uma coisa — enviar uma mensagem, chamar uma API, verificar uma condição — e se conecta ao que vem a seguir.

Esta página é o catálogo. Para saber como adicioná-los e conectá-los no canvas, veja [Criar um workflow](/docs/workflows/authoring).

## API

Faz uma requisição HTTP para qualquer URL.

**Configurações**:

- **Method** — `GET`, `POST`, `PUT`, `PATCH` ou `DELETE`.
- **URL** — o endereço a chamar.
- **Headers** — quaisquer cabeçalhos a enviar.
- **Body** — o corpo da requisição para `POST` / `PUT` / `PATCH`.

**Saídas**:

- **Success** — dispara quando a chamada funciona (resposta 2xx). Passa adiante o status, os cabeçalhos e o corpo.
- **Error** — dispara em uma falha de rede ou resposta não-2xx. Passa adiante a mensagem de erro.

Use isto para: qualquer API externa, seus próprios endpoints administrativos, ou qualquer integração que não tenha seu próprio componente.

## AI

### Generate Text with AI

Gera uma resposta em texto a partir de um prompt e um contexto JSON opcional. O componente usa o provedor de LLM padrão configurado do projeto, recorrendo ao provedor global da instalação quando disponível. As credenciais e endpoints do provedor são configurados centralmente; não são argumentos do workflow.

**Configurações**:

- **System Instructions** — orientação opcional para o papel, o tom e as restrições do modelo.
- **Prompt** — a tarefa obrigatória. Pode incluir variáveis de workflow e saídas de componentes anteriores.
- **Context** — JSON opcional que você inclui deliberadamente na requisição. É anexado depois de um marcador explícito de fim de confiança da mensagem e tratado como dado não confiável no restante dela.
- **Temperature** — variação de `0` a `1`. O padrão é `0.2` para automação previsível.
- **Maximum Output Tokens** — de `1` a `4096`. O padrão é `1024`.

A combinação de System Instructions, Prompt e Context serializado é limitada a 50.000 caracteres. A requisição ao provedor tem uma duração máxima de 60 segundos e é tentada uma única vez. No máximo três requisições de AI de workflow podem rodar simultaneamente por projeto.

**Saídas**:

- **Response** — o texto gerado.
- **Provider** e **Model** — a configuração usada na chamada.
- **Total Tokens** e **Completion Tokens** — uso reportado pelo provedor.
- **LLM Log ID** — a entrada de registro de AI medida para a chamada.
- **Error** — o erro de validação, acesso, provedor, orçamento, cobrança ou tempo limite, quando presente.

Conecte **Success** a componentes que devem usar a resposta. Conecte **Error** a um caminho explícito de fallback, alerta ou registro. O componente faz uma única requisição ao modelo sem definições de ferramentas ou campos de capacidade nativos do provedor: ele não pode consultar o OneUptime, chamar APIs nem alterar dados do projeto por conta própria. Além das instruções fixas de segurança de componente do OneUptime, apenas o System Instructions, o Prompt e o Context que você configura são enviados ao provedor, depois que as variáveis de workflow nesses campos são resolvidas. O provedor/modelo configurado continua sendo um limite de confiança, porque um modelo pode ter capacidades intrínsecas gerenciadas pelo provedor.

A saída do modelo é texto não confiável. Revise-a antes de enviar comunicações voltadas ao cliente, e não use texto de AI livre sozinho para autorizar ações destrutivas do workflow. Veja [Configuração e segurança de workflow](/docs/workflows/configuration) para detalhes de provedor, saída de rede, registro e custo.

## Webhook (outbound)

Uma versão mais simples do componente API para casos "disparar e esquecer". Envia (POST) um corpo JSON para uma URL.

Use **API** se você precisa ler a resposta. Use **Webhook** se você só quer enviar uma notificação e seguir em frente.

## Slack

Publica uma mensagem em um canal do Slack.

**Configurações**:

- **Channel** — o nome do canal. O bot já precisa estar naquele canal.
- **Message** — o texto a enviar. Suporta a formatação do Slack.

Conecte o Slack ao seu projeto primeiro em **Project Settings → Workspace → Slack**. Veja [Conexão do workspace do Slack](/docs/workspace-connections/slack).

## Microsoft Teams

Publica uma mensagem em um canal do Microsoft Teams.

**Configurações**:

- **Team and channel** — onde publicar.
- **Message** — o texto a enviar.

Veja [Conexão do workspace do Microsoft Teams](/docs/workspace-connections/microsoft-teams) para a configuração.

## Discord

Publica uma mensagem em um canal do Discord através de uma URL de webhook de entrada.

## Telegram

Envia uma mensagem para um chat do Telegram usando um token de bot e um chat ID.

## Email

Envia um e-mail através do OneUptime.

**Configurações**:

- **To** — o endereço de e-mail do destinatário.
- **Subject** — a linha de assunto.
- **Body** — a mensagem em Markdown ou HTML.

O e-mail sai do remetente configurado do seu projeto — veja [SMTP](/docs/emails/smtp).

## Custom Code

Roda um pequeno trecho de JavaScript quando você precisa de algo que os outros blocos não conseguem fazer.

**Configurações**:

- **Code** — o seu JavaScript. O último valor (ou o que você retorna de uma função async) se torna a saída do bloco.
- **Arguments** — valores nomeados que você pode passar.

**Saídas**: sucesso (o valor que você retorna) e erro (qualquer exceção).

Use isto para: remodelar dados entre dois sistemas, fazer um pequeno cálculo, qualquer coisa que não mereça seu próprio bloco. Para scripting mais pesado, use um [Runbook](/docs/runbooks/index) em vez disso.

## JSON

Converte entre texto e JSON.

- **JSON → Text** — transforma um objeto JSON em uma string. Útil quando o próximo bloco espera texto.
- **Text → JSON** — converte uma string em um objeto JSON. Útil quando algo chegou como texto e você precisa ler um campo.

## Conditions

Ramifica com base em uma comparação. No painel **Add Component** este bloco é chamado de **If / Else**, na categoria Conditions.

**Configurações**:

- **Left value** — geralmente um valor de um bloco anterior.
- **Operator** — `==`, `!=`, `>`, `>=`, `<`, `<=`, `contains`, `starts with`, `ends with`.
- **Right value** — com o que comparar.

**Saídas**: **Yes** e **No**. Conecte os próximos blocos ao ramo que você quiser.

## Delay

Pausa o workflow por um período de tempo definido antes de continuar. Útil quando você precisa dar a outro sistema um momento para se atualizar.

## Log

Escreve uma linha no registro da execução. Sem efeito externo — apenas aparece nos registros do workflow para você ler. Útil para depuração.

## Execute Workflow

Chama outro workflow a partir deste. O workflow chamado roda por conta própria — seu workflow continua sem esperar que ele termine.

Use isto para compartilhar lógica comum. Construa um workflow "postar no canal do incidente" uma vez e depois o chame de qualquer outro workflow que precise notificar o canal.

Há um limite de segurança para que workflows não fiquem se chamando em loop. Veja [Configuração e segurança de workflow](/docs/workflows/configuration).

## Componentes de dados do OneUptime

Para todo tipo de registro no OneUptime (monitores, incidentes, alertas, páginas de status, políticas de plantão e muitos outros), o painel **Add Component** tem estes componentes — busque pelo nome do tipo. Cada título é gerado a partir do tipo de registro, então o conjunto de Monitor mostra:

- **Find One Monitor** — lê um registro que corresponde à consulta.
- **Find Many Monitors** — lê uma lista de registros que correspondem à consulta.
- **Create One Monitor** — adiciona um registro a partir de um objeto JSON.
- **Create Many Monitors** — adiciona vários registros a partir de um array JSON.
- **Update One Monitor** — aplica o payload de escrita a um registro correspondente.
- **Update Many Monitors** — aplica o payload de escrita a registros correspondentes, até o Limit.
- **Delete One Monitor** — exclui um registro correspondente.
- **Delete Many Monitors** — exclui registros correspondentes, até o Limit.

O mesmo conjunto fornece três gatilhos — **On Create Monitor**, **On Update Monitor** e **On Delete Monitor**. Veja [Triggers](/docs/workflows/triggers).

Um tipo só oferece os componentes que seu modelo permite. Um tipo somente leitura tem apenas os dois componentes Find e nada mais, então, se você não conseguir encontrar **Delete One Monitor** no painel, esse tipo não permite isso.

É assim que um workflow consegue ler e alterar dados do OneUptime. Por exemplo: um webhook da sua ferramenta de CI pode usar **Create One Incident** para abrir um incidente com os detalhes da falha.

## Trabalhando com registros

Todo campo em um componente de dados é indexado pelos próprios nomes de **coluna** do registro — os mesmos nomes que a API usa, não os rótulos do formulário do painel. A coluna do ID é `_id`. A grafia `id` é aceita como um apelido em qualquer lugar em que você possa digitar um nome de coluna, mas `_id` é o que um registro devolve, então é isso que se lê na saída:

```json
{ "_id": "00000000-0000-0000-0000-000000000000" }
```

**Query** decide quais registros o componente afeta. As chaves são colunas, os valores são o que corresponder:

```json
{ "monitorType": "Website", "isEnabled": true }
```

Uma consulta é sempre restrita ao projeto em que o workflow roda. Você não consegue alcançar os registros de outro projeto, e não precisa adicionar o projeto à consulta você mesmo.

**JSON Object** no Create One, **JSON Array** no Create Many, e **Data (JSON Object)** nos componentes Update carregam os campos a escrever, indexados da mesma forma:

```json
{ "name": "Checkout API", "monitorType": "Website" }
```

Uma chave que não é uma coluna é ignorada em vez de rejeitada — o registro da execução nomeia as que descartou, então verifique lá quando um campo não for aplicado. **Select Fields**, nos componentes Find e nos gatilhos, usa as mesmas chaves de coluna com valores `true`: `{"_id": true, "name": true}`.

**Skip** e **Limit** são dois campos numéricos em Find Many, Update Many e Delete Many — `Skip: 0` com `Limit: 100` pega as cem primeiras correspondências. Limit tem o padrão `10`, e em Update Many e Delete Many ele limita quantos registros são de fato escritos, não apenas quantos são retornados. Então `Items Deleted: 10` significa que dez registros foram excluídos, não que dez corresponderam. Aumente o Limit quando pretender alterar mais de dez.

**Success** e **Error** reportam se a consulta rodou, não o que ela encontrou. Uma consulta que não corresponde a nada retorna `0` e ainda segue por Success — isso não é uma falha. Para ramificar com base em se algo correspondeu, leia a contagem retornada em um bloco **If / Else**.

## Qual componente devo usar?

Algumas regras rápidas:

- Se há um bloco dedicado para o que você quer (Slack, Email, um registro do OneUptime), use-o — você ganha tratamento de erro mais agradável e registros mais claros.
- Para qualquer outra API externa, use **API**.
- Para resumir, classificar ou redigir texto a partir de dados de workflow explicitamente selecionados, use **Generate Text with AI**.
- Para remodelar dados entre blocos, use **Custom Code** ou **JSON**.
- Para tomar ações diferentes com base em um valor, use **Conditions**.

## Onde ler a seguir

- [Variáveis de workflow](/docs/workflows/variables) — passando dados entre blocos.
- [Execuções e registros de workflow](/docs/workflows/runs-and-logs) — verificando o que cada bloco fez em uma execução.
- [Configuração e segurança de workflow](/docs/workflows/configuration) — limites, proprietários e segredos.
