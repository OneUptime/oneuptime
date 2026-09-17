# Componentes

Componentes são as peças que você adiciona depois do trigger. Cada um faz uma coisa — envia uma mensagem, chama uma API, verifica uma condição — e se liga ao que vem em seguida.

Esta página é o catálogo. Para saber como adicionar e conectar os componentes no canvas, veja [Criar um workflow](/docs/workflows/authoring).

## API

Faz uma requisição HTTP para qualquer URL.

**Settings**:

- **Method** — `GET`, `POST`, `PUT`, `PATCH` ou `DELETE`.
- **URL** — o endereço a chamar.
- **Headers** — os cabeçalhos a enviar.
- **Body** — o corpo da requisição, para `POST` / `PUT` / `PATCH`.

**Outputs**:

- **Sucesso** — dispara quando a chamada deu certo (resposta 2xx). Repassa status, cabeçalhos e corpo.
- **Erro** — dispara em falha de rede ou resposta fora da faixa 2xx. Repassa a mensagem de erro.

Use para: qualquer API externa, seus próprios endpoints administrativos, ou qualquer integração que não tenha componente próprio.

## AI

### Generate Text with AI

Gera uma resposta de texto a partir de um prompt e de um contexto JSON opcional. O componente usa o provedor de LLM padrão configurado no projeto e recorre ao provedor global da instalação quando houver um. As credenciais e os endpoints do provedor são configurados centralmente; eles não são argumentos do workflow.

**Settings**:

- **System Instructions** — orientação opcional sobre o papel, o tom e as restrições do modelo.
- **Prompt** — a tarefa, obrigatória. Pode incluir variáveis do workflow e saídas de componentes anteriores.
- **Context** — JSON opcional que você inclui deliberadamente na requisição. Ele é acrescentado depois de um marcador explícito de fim de mensagem e tratado como dado não confiável no restante da mensagem.
- **Temperature** — variação de `0` a `1`. O padrão é `0.2`, para automação previsível.
- **Maximum Output Tokens** — de `1` a `4096`. O padrão é `1024`.

Somados, System Instructions, Prompt e o Context serializado têm limite de 50.000 caracteres. A requisição ao provedor tem duração máxima de 60 segundos e é tentada uma única vez. No máximo três requisições de AI de workflow rodam ao mesmo tempo por projeto.

**Outputs**:

- **Response** — o texto gerado.
- **Provedor** e **Model** — a configuração usada na chamada.
- **Total Tokens** e **Completion Tokens** — o uso informado pelo provedor.
- **LLM Log ID** — a entrada de registro de AI tarifada correspondente à chamada.
- **Erro** — o erro de validação, acesso, provedor, orçamento, cobrança ou tempo limite, quando houver.

Ligue **Sucesso** aos componentes que devem usar a resposta. Ligue **Erro** a um caminho explícito de contingência, alerta ou registro. O componente faz uma única requisição ao modelo, sem definições de ferramentas e sem campos nativos de capacidade do provedor: ele não consegue consultar o OneUptime, chamar APIs nem alterar dados do projeto por conta própria. Além das instruções fixas de segurança de componente do OneUptime, só o System Instructions, o Prompt e o Context que você configurar são enviados ao provedor, depois de resolvidas as variáveis de workflow desses campos. O provedor/modelo configurado continua sendo uma fronteira de confiança, porque um modelo pode ter capacidades intrínsecas gerenciadas pelo provedor.

O texto que o modelo devolve é dado não confiável. Revise-o antes de enviar comunicações para clientes, e não use texto livre gerado por AI, sozinho, para autorizar ações destrutivas de workflow. Veja [Configuração e segurança de workflow](/docs/workflows/configuration) para detalhes de provedor, saída de rede, registro e custo.

## Webhook (outbound)

Uma versão mais simples do componente API, para casos de "disparar e esquecer". Envia um corpo JSON para uma URL.

Use **API** se você precisa ler a resposta. Use **Webhook** se só quer mandar uma notificação e seguir em frente.

## Slack

Publica uma mensagem em um canal do Slack.

**Settings**:

- **Canal** — o nome do canal. O bot já precisa estar nele.
- **Mensagem** — o texto a enviar. Aceita a formatação do Slack.

Conecte o Slack ao seu projeto primeiro em **Configurações do projeto → Espaço de trabalho → Slack**. Veja [Conexão do workspace do Slack](/docs/workspace-connections/slack).

## Microsoft Teams

Publica uma mensagem em um canal do Microsoft Teams.

**Settings**:

- **Team and channel** — onde publicar.
- **Mensagem** — o texto a enviar.

Veja [Conexão do workspace do Microsoft Teams](/docs/workspace-connections/microsoft-teams) para a configuração.

## Discord

Publica uma mensagem em um canal do Discord por meio de uma URL de webhook de entrada.

## Telegram

Envia uma mensagem para um chat do Telegram usando um token de bot e o ID do chat.

## Email

Envia um e-mail pelo OneUptime.

**Settings**:

- **Para** — o endereço de e-mail de quem recebe.
- **Assunto** — a linha de assunto.
- **Body** — a mensagem em Markdown ou HTML.

O e-mail sai do remetente configurado do seu projeto — veja [SMTP](/docs/emails/smtp).

## Custom Code

Roda um trecho pequeno de JavaScript quando você precisa de algo que os outros blocos não fazem.

**Settings**:

- **Código** — o seu JavaScript. O último valor (ou o que você retornar de uma função assíncrona) vira a saída do bloco.
- **Arguments** — valores nomeados que você pode passar para dentro.

**Outputs**: sucesso (o seu valor de retorno) e erro (qualquer exceção).

Use para: remodelar dados entre dois sistemas, fazer um cálculo pequeno, qualquer coisa que não mereça um bloco próprio. Para scripts mais pesados, use um [Runbook](/docs/runbooks/index).

## JSON

Converte entre texto e JSON.

- **JSON → Text** — transforma um objeto JSON em texto. Útil quando o bloco seguinte espera texto.
- **Text → JSON** — interpreta um texto como objeto JSON. Útil quando algo chegou como texto e você precisa ler um campo.

## Conditions

Ramifica com base em uma comparação. No painel **Add Component**, este bloco se chama **If / Else**, na categoria Conditions.

**Settings**:

- **Left value** — normalmente um valor vindo de um bloco anterior.
- **Operator** — `==`, `!=`, `>`, `>=`, `<`, `<=`, `contains`, `starts with`, `ends with`.
- **Right value** — com o que comparar.

**Outputs**: **Sim** e **Não**. Conecte os próximos blocos à ramificação que você quiser.

## Delay

Pausa o workflow por um tempo determinado antes de continuar. Útil quando você precisa dar um instante para outro sistema se acertar.

## Log

Escreve uma linha no registro da execução. Nenhum efeito externo — apenas aparece nos registros do workflow para você ler. Bom para depurar.

## Execute Workflow

Chama outro workflow a partir deste. O workflow chamado roda por conta própria — o seu segue em frente sem esperar que ele termine.

Use para compartilhar lógica comum. Monte uma vez um workflow do tipo "publicar no canal do incidente" e chame-o de qualquer outro workflow que precise avisar o canal.

Existe um limite de segurança para que os workflows não fiquem se chamando em loop. Veja [Configuração e segurança de workflow](/docs/workflows/configuration).

## Componentes de dados do OneUptime

Para cada tipo de registro do OneUptime (monitores, incidentes, alertas, páginas de status, políticas de plantão e muitos outros), o painel **Add Component** traz estes componentes — busque pelo nome do tipo. Cada título é gerado a partir do tipo de registro, então o conjunto de Monitor fica assim:

- **Find One Monitor** — lê um registro que corresponda à consulta.
- **Find Many Monitors** — lê uma lista de registros que correspondam à consulta.
- **Create One Monitor** — adiciona um registro a partir de um objeto JSON.
- **Create Many Monitors** — adiciona vários registros a partir de um array JSON.
- **Update One Monitor** — aplica o payload de escrita a um registro correspondente.
- **Update Many Monitors** — aplica o payload de escrita aos registros correspondentes, até o Limit.
- **Delete One Monitor** — exclui um registro correspondente.
- **Delete Many Monitors** — exclui os registros correspondentes, até o Limit.

O mesmo conjunto entrega três triggers — **On Create Monitor**, **On Update Monitor** e **On Delete Monitor**. Veja [Gatilhos de workflow](/docs/workflows/triggers).

Um tipo só oferece os componentes que o modelo dele permite. Um tipo somente leitura tem os dois componentes Find e nada mais, então, se você não acha **Delete One Monitor** no painel, é porque aquele tipo não permite.

É assim que um workflow lê e altera dados do OneUptime. Por exemplo: um webhook da sua ferramenta de CI pode usar **Create One Incident** para abrir um incidente com os detalhes da falha.

## Trabalhando com registros

Todo campo de um componente de dados é indexado pelos nomes de **coluna** do próprio registro — os mesmos nomes que a API usa, não os rótulos do formulário no painel. A coluna de ID é `_id`. A grafia `id` é aceita como apelido em qualquer lugar onde você digita um nome de coluna, mas o que um registro devolve é `_id`, então é isso que você lê na saída:

```json
{ "_id": "00000000-0000-0000-0000-000000000000" }
```

O **Query** decide sobre quais registros o componente age. As chaves são colunas e os valores são o que deve corresponder:

```json
{ "monitorType": "Website", "isEnabled": true }
```

Uma consulta é sempre restrita ao projeto em que o workflow roda. Você não alcança registros de outro projeto e não precisa incluir o projeto na consulta.

O **JSON Object** do Create One, o **JSON Array** do Create Many e o **Data (JSON Object)** dos componentes de Update carregam os campos a gravar, indexados do mesmo jeito:

```json
{ "name": "Checkout API", "monitorType": "Website" }
```

Uma chave que não é coluna é ignorada, não recusada — o registro da execução nomeia as que foram descartadas, então confira lá quando um campo não chegar. O **Select Fields**, presente nos componentes Find e nos triggers, usa as mesmas chaves de coluna com valores `true`: `{"_id": true, "name": true}`.

**Pular** e **Limit** são dois campos numéricos em Find Many, Update Many e Delete Many — `Skip: 0` com `Limit: 100` pega as primeiras cem correspondências. O Limit tem padrão `10`, e em Update Many e Delete Many ele limita quantos registros são de fato alterados, não só quantos voltam. Ou seja, `Items Deleted: 10` significa que dez registros foram excluídos, não que dez corresponderam. Aumente o Limit quando a intenção for mexer em mais de dez.

**Sucesso** e **Erro** dizem se a consulta rodou, não o que ela encontrou. Uma consulta que não corresponde a nada devolve `0` e ainda assim sai pelo Sucesso — isso não é falha. Para ramificar conforme houve ou não correspondência, leia a contagem retornada em um bloco **If / Else**.

## Qual componente devo usar?

Algumas regras rápidas:

- Se existe um bloco dedicado ao que você quer (Slack, Email, um registro do OneUptime), use-o — o tratamento de erro é melhor e os registros ficam mais claros.
- Para qualquer outra API externa, use **API**.
- Para resumir, classificar ou redigir texto a partir de dados do workflow que você selecionou explicitamente, use **Generate Text with AI**.
- Para remodelar dados entre blocos, use **Custom Code** ou **JSON**.
- Para tomar caminhos diferentes conforme um valor, use **Conditions**.

## Onde ler em seguida

- [Variáveis de workflow](/docs/workflows/variables) — passando dados entre blocos.
- [Execuções e registros de workflow](/docs/workflows/runs-and-logs) — conferindo o que cada bloco fez em uma execução.
- [Configuração e segurança de workflow](/docs/workflows/configuration) — limites, proprietários e segredos.
