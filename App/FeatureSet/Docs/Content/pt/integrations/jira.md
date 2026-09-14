# Integração com o Jira

Abra um issue no [Jira](https://www.atlassian.com/software/jira) sempre que um incidente do OneUptime for declarado, mantenha-o em dia conforme o incidente avança e deixe o Jira empurrar mudanças de status de volta para o OneUptime — tudo com um [Workflow](/docs/workflows/index). Não há bloco específico do Jira para instalar: o OneUptime chama a REST API do Jira com o [componente API](/docs/workflows/components#api), e o Jira chama de volta um [gatilho Webhook](/docs/workflows/triggers#webhook).

```text
OneUptime Incident → On Create  ──►  API Post (POST /rest/api/3/issue)  ──►  Jira issue

Jira issue transitioned  ──►  Automation rule (Send web request)  ──►  OneUptime Webhook trigger  ──►  Update One Incident
```

Esta página constrói as duas direções. Tudo até a seção de entrada foi escrito para o **Jira Cloud**; uma seção perto do fim lista o que muda no **Jira Data Center**.

> A Atlassian vem renomeando coisas no Jira Cloud: um **project** agora é um **space** em boa parte da interface, e um **issue** é um **work item**. Há tenants nos dois vocabulários, então, onde a nomenclatura importa, você encontrará ambos abaixo.

## Pré-requisitos

- Um site do Jira Cloud (`https://your-domain.atlassian.net`) e um projeto onde registrar os issues. Anote a **chave de projeto** — o `OPS` em `OPS-1234`.
- Uma conta do Jira que possa criar issues nesse projeto e um **token de API** para ela, gerado em [id.atlassian.com/manage-profile/security/api-tokens](https://id.atlassian.com/manage-profile/security/api-tokens). Use uma conta de serviço em vez da conta de uma pessoa — os issues criados assim são atribuídos ao dono do token.
- Permissão para criar automation rules nesse projeto, para a metade de entrada.
- Um projeto no OneUptime onde você possa criar workflows e variáveis globais.

## Passo 1 — Armazene as credenciais do Jira como segredo

A REST API do Jira Cloud aceita **Basic auth**, montada a partir do e-mail da sua conta Atlassian e de um token de API, codificados juntos em base64.

1. Codifique `email:api_token` uma única vez:

   ```bash
   printf '%s' 'you@example.com:your_api_token' | base64
   ```

   Use `printf`, não `echo`. O `echo` acrescenta uma quebra de linha, essa quebra de linha é codificada junto com todo o resto, e o Jira responde `401` por motivos invisíveis na string que você colou.

2. No OneUptime, vá em **Fluxos de trabalho → Variáveis globais → Criar**. Nomeie como `JIRA_AUTH`, cole a string base64 em **Conteúdo** e ative **Segredo**.
3. Adicione uma segunda variável, não secreta, `JIRA_URL`, contendo `https://your-domain.atlassian.net` sem barra no final.

Qualquer bloco pode agora usar `Basic {{global.variables.JIRA_AUTH}}` como cabeçalho `Authorization`, e o token nunca aparece no workflow nem em seus registros de execução. Veja [Variáveis](/docs/workflows/variables).

Duas coisas sobre os tokens de API da Atlassian que mais cedo ou mais tarde vão morder uma integração que ninguém está olhando:

- **Eles expiram.** Os tokens são criados com uma validade de um dia a um ano, um ano por padrão, e não há renovação — um token expirado precisa ser substituído à mão na mesma página e recodificado em `JIRA_AUTH`. Coloque a data de expiração em algum calendário. Quando um workflow que funcionou por meses começa a responder `401`, é por isso.
- **Um token com escopos precisa de uma URL base diferente.** A página de tokens oferece **Create API token with scopes** além do clássico **Create API token**. Tokens com escopos são a escolha mais segura, mas não são endereçados ao seu site: eles vão para `https://api.atlassian.com/ex/jira/<cloudId>`, então `JIRA_URL` passa a ser isso, e todos os caminhos abaixo penduram-se nela sem mudança. O seu `cloudId` está no JSON em `https://your-domain.atlassian.net/_edge/tenant_info`. Um token com escopos enviado para `your-domain.atlassian.net` simplesmente falha.

Se a sua organização usa a gestão centralizada de usuários da Atlassian, há uma terceira opção que contorna o problema da expiração: uma [credencial OAuth 2.0 para uma conta de serviço](https://support.atlassian.com/user-management/docs/create-oauth-2-0-credential-for-service-accounts/). Ela dá a você um client id e um secret em vez de um token, e um workflow os troca por um access token de vida curta no início de cada execução — o mesmo formato de dois blocos que a página do [Microsoft Dynamics 365](/docs/integrations/microsoft-dynamics-365) usa, com um bloco **API Post (JSON)** buscando o token e tudo depois dele enviando `Bearer <token>`. Nada precisa ser substituído à mão um ano depois. A página da Atlassian traz a requisição de token exata; a URL base da API é `https://api.atlassian.com`.

## Passo 2 — Abra um issue no Jira para cada incidente

1. Abra **Fluxos de trabalho → Criar fluxo de trabalho**, nomeie-o `Incidents → Jira` e abra o **Construtor**.
2. Clique no bloco tracejado de espaço reservado e adicione o gatilho **On Create Incident**. Em **Select Fields**, peça as colunas que você quer enviar:

   ```json
   {
     "_id": true,
     "title": true,
     "description": true,
     "incidentNumber": true,
     "incidentSeverity": { "name": true }
   }
   ```

   Deixe o **Identifier** como `incident-on-create-1` — é por esse nome que os blocos seguintes se referem a ele.

3. Clique em **Adicionar componente**, adicione um bloco **API Post (JSON)** e arraste do conector **Sucesso** do gatilho até o conector de entrada do novo bloco. Abra-o, defina seu **Identifier** como `create-issue` e preencha:

   - **URL**: `{{global.variables.JIRA_URL}}/rest/api/3/issue`
   - **Request Headers**:

     ```json
     {
       "Authorization": "Basic {{global.variables.JIRA_AUTH}}",
       "Accept": "application/json"
     }
     ```

   - **Request Body**:

     ```json
     {
       "fields": {
         "project": { "key": "OPS" },
         "issuetype": { "name": "Bug" },
         "summary": "OneUptime #{{local.components.incident-on-create-1.returnValues.model.incidentNumber}}: {{local.components.incident-on-create-1.returnValues.model.title}}",
         "labels": ["oneuptime"],
         "description": {
           "type": "doc",
           "version": 1,
           "content": [
             {
               "type": "paragraph",
               "content": [
                 {
                   "type": "text",
                   "text": "{{local.components.incident-on-create-1.returnValues.model.description}}"
                 }
               ]
             }
           ]
         }
       }
     }
     ```

   Substitua `OPS` pela sua chave de projeto e `Bug` por um tipo de issue que exista nesse projeto. Os dois também podem ser informados por id — `{"id": "10000"}` —, que é o que os próprios exemplos da Atlassian usam e o que você deve preferir se dois tipos de issue no seu site tiverem o mesmo nome. As chamadas de `createmeta` mais adiante entregam esses ids.

A descrição parece pesada porque a API v3 do Jira Cloud recebe rich text como **Atlassian Document Format** — uma árvore de documento, não uma string. O formato acima é o documento válido mínimo: um parágrafo contendo um nó de texto. O mesmo vale para `environment` e para qualquer campo personalizado de texto de várias linhas; campos personalizados de texto de uma linha ainda aceitam uma string simples.

Agora ligue o workflow em **Visão geral → Editar fluxo de trabalho → Habilitado**, declare um incidente de teste e abra **Execuções e registros**. O bloco `create-issue` deve exibir um `201` e um corpo contendo o `id`, a `key` e o `self` do novo issue. As mudanças no canvas se salvam sozinhas — não há botão de salvar, e um workflow desabilitado não roda de jeito nenhum, nem à mão.

A chave do novo issue fica disponível para qualquer bloco depois deste:

```text
{{local.components.create-issue.returnValues.response-body.key}}
```

### Preenchendo mais campos

Algumas adições comuns dentro de `fields`:

- **Priority** — `"priority": { "id": "20000" }`, usando um id de prioridade do seu site. Para mapear as severidades do OneUptime nas prioridades do Jira, coloque um bloco **If / Else** entre o gatilho e o bloco de API e ramifique em `{{local.components.incident-on-create-1.returnValues.model.incidentSeverity.name}}`.
- **Assignee** — `"assignee": { "id": "<accountId>" }`. O Jira Cloud identifica pessoas pelo account id da Atlassian; `username` e `userKey` foram removidos da API do Cloud anos atrás.
- **Labels** — `"labels": ["oneuptime", "sev1"]`, um array plano de strings. Labels não podem conter espaços.
- **Components** — `"components": [{ "id": "10000" }]`.
- **Campos personalizados** — `"customfield_10034": "..."`, usando o id do próprio campo. O formato do valor segue o tipo do campo: um single-select recebe `{"value": "red"}`, um multi-select um array de ids, e um campo de texto de várias linhas um documento em Atlassian Document Format.

Para descobrir o que um projeto realmente exige, pergunte ao Jira em vez de adivinhar. Liste os tipos de issue de um projeto e depois os campos de um deles:

```bash
curl -u 'you@example.com:your_api_token' \
  'https://your-domain.atlassian.net/rest/api/3/issue/createmeta/OPS/issuetypes'

curl -u 'you@example.com:your_api_token' \
  'https://your-domain.atlassian.net/rest/api/3/issue/createmeta/OPS/issuetypes/10001'
```

A segunda chamada lista todos os campos que aquele tipo de issue aceita, quais deles são obrigatórios e os ids `customfield_NNNNN` exatos. Para ler os ids de um issue que você já tem, busque-o com `?expand=names`.

## Passo 3 — Leve o id do incidente para dentro do Jira

As duas metades de uma sincronização bidirecional precisam que um dos sistemas guarde o identificador do outro, e o Jira é o melhor lugar para mantê-lo: a coluna `customFields` do OneUptime é um único blob JSON, então gravar um valor a partir de um workflow substitui todos os campos personalizados daquele incidente.

**Com um admin do Jira.** Adicione um campo personalizado de texto curto — chame-o de *OneUptime Incident ID* — à tela de criação do projeto, descubra o id dele com `createmeta` e defina-o junto com todo o resto:

```json
"customfield_10050": "{{local.components.incident-on-create-1.returnValues.model._id}}"
```

**Sem um admin.** Coloque-o em uma label. Labels não aceitam espaços, e um id do OneUptime é um UUID simples, então `oneuptime-<id>` é uma label válida:

```json
"labels": ["oneuptime", "oneuptime-{{local.components.incident-on-create-1.returnValues.model._id}}"]
```

O workflow de entrada então precisa pescar essa label na lista, o que são duas linhas em um bloco **Run Custom JavaScript**. O campo personalizado é mais limpo, se você puder ter um.

Já que você está por aqui, vale a pena adicionar no issue do Jira um link de volta para o incidente. Um bloco **API Post (JSON)** depois de `create-issue`, apontado para `{{global.variables.JIRA_URL}}/rest/api/3/issue/{{local.components.create-issue.returnValues.response-body.key}}/remotelink`, com:

```json
{
  "globalId": "system=https://oneuptime.com&id={{local.components.incident-on-create-1.returnValues.model._id}}",
  "object": {
    "url": "https://oneuptime.com/dashboard/{{local.components.incident-on-create-1.returnValues.model.projectId}}/incidents/{{local.components.incident-on-create-1.returnValues.model._id}}",
    "title": "OneUptime incident #{{local.components.incident-on-create-1.returnValues.model.incidentNumber}}"
  }
}
```

dá a todo mundo no Jira um caminho de volta em um clique. Adicione `projectId` ao **Select Fields** do gatilho para isso. O `globalId` é o que torna a chamada segura para repetir: o Jira atualiza o link que já carrega esse id em vez de adicionar um segundo. E como uma atualização também zera qualquer coisa que você deixe de fora, envie sempre o `object` inteiro, e não um trecho dele.

## Passo 4 — Comente e faça a transição conforme o incidente avança

Construa isso como um **segundo** workflow, para que uma falha aqui nunca impeça a abertura dos issues.

1. **Criar fluxo de trabalho**, nomeie-o `Incident updates → Jira` e adicione o gatilho **On Update Incident**.
2. Em **Listen on**, coloque `{"currentIncidentStateId": true}`. O gatilho passa então a disparar apenas em mudanças de estado, em vez de a cada edição. Em **Select Fields**, peça `{"_id": true, "currentIncidentState": {"name": true}}`.
3. Adicione um bloco **If / Else**: **Input 1** `{{local.components.incident-on-update-1.returnValues.model.currentIncidentState.name}}`, **Operator** `==`, **Input 2** `Resolved` — ou como quer que o estado resolvido se chame no seu projeto. Veja [Estados e severidades](/docs/incidents/states-and-severities).

A partir da ramificação **Sim**, você primeiro precisa encontrar o issue que abriu no Passo 2. Peça-o ao Jira pelo id que você guardou no Passo 3, com um bloco **API Post (JSON)** cujo **Identifier** seja `find-issue`:

- **URL**: `{{global.variables.JIRA_URL}}/rest/api/3/search/jql`
- **Request Body**:

  ```json
  {
    "jql": "project = OPS AND labels = \"oneuptime-{{local.components.incident-on-update-1.returnValues.model._id}}\"",
    "maxResults": 1
  }
  ```

  Se você usou um campo personalizado em vez de uma label, a cláusula passa a ser `cf[10050] ~ \"...\"` com o id do seu próprio campo.

O id do issue é então `{{local.components.find-issue.returnValues.response-body.issues[0].id}}`, e todos os endpoints abaixo aceitam um id tão bem quanto uma key.

Três coisas sobre esse endpoint valem a pena saber. **Poste o JQL, não o coloque na URL** — uma query string contendo `=` dentro de um valor é truncada na saída de um workflow, e JQL é só sinal de `=`. **A consulta precisa ser delimitada**: um `order by key desc` sozinho é recusado com `400`, e é por isso que a cláusula `project =` está ali. E `/rest/api/3/search/jql` é o endpoint atual — o mais antigo `/rest/api/3/search` está descontinuado e a caminho da aposentadoria, então não recorra a ele.

**Deixar um comentário** é um único bloco **API Post (JSON)** para `{{global.variables.JIRA_URL}}/rest/api/3/issue/<id>/comment`, com um corpo em Atlassian Document Format, igual ao da descrição:

```json
{
  "body": {
    "type": "doc",
    "version": 1,
    "content": [
      {
        "type": "paragraph",
        "content": [{ "type": "text", "text": "Resolved in OneUptime." }]
      }
    ]
  }
}
```

**Mover o issue** exige duas chamadas, porque uma transição é identificada por um id que varia entre workflows e, em alguns boards, entre issues.

1. Um bloco **API Get (JSON)** em `{{global.variables.JIRA_URL}}/rest/api/3/issue/<id>/transitions` devolve as transições disponíveis *a partir do status atual do issue*, cada uma com um `id` e um `name`, e um objeto `to` nomeando o status ao qual ela leva.
2. Um bloco **API Post (JSON)** para a mesma URL executa uma delas:

   ```json
   { "transition": { "id": "31" } }
   ```

Uma transição bem-sucedida responde `204` sem corpo. Se você preferir não ler a lista em tempo de execução, chame-a uma vez à mão para um issue no status certo e fixe o id no código — só lembre que ele está atrelado àquele workflow, então um admin editando o workflow do Jira pode quebrá-lo silenciosamente.

## Entrada — do Jira para o OneUptime

Agora a outra direção: alguém move o issue para Done, e o incidente do OneUptime deve acompanhar.

### Construa primeiro o workflow que recebe

1. **Criar fluxo de trabalho**, nomeie-o `Jira → OneUptime` e adicione o gatilho **Webhook**.
2. Abra as **Configurações** desse workflow e copie a **Chave secreta do webhook**. Sua URL é:

   ```text
   https://oneuptime.com/workflow/trigger/<webhook secret key>
   ```

   Instalações auto-hospedadas usam o próprio host. Trate a URL como uma senha — quem a tiver pode iniciar o workflow — e redefina a chave nessa mesma página se ela vazar.

3. Adicione um bloco **If / Else** que verifica um segredo compartilhado antes que qualquer outra coisa rode. **Input 1** é `{{local.components.webhook-1.returnValues.request-headers.x-oneuptime-secret}}`, **Operator** `==`, **Input 2** é `{{global.variables.JIRA_WEBHOOK_SECRET}}` — um valor que você inventa e salva como variável global secreta.
4. Da ramificação **Sim**, adicione um bloco **Update One Incident**:

   - **Query**: `{"_id": "{{local.components.webhook-1.returnValues.request-body.oneuptimeIncidentId}}"}`
   - **Data (JSON Object)**: o que a mudança no Jira deve significar aqui — normalmente uma mudança de estado.

   Mover um incidente exige o id do estado de destino, que um bloco **Find One Incident State** com a consulta `{"name": "Resolved"}` entrega em `{{local.components.incident-state-find-one-1.returnValues.model._id}}`. Escreva isso em `currentIncidentStateId`.

Deixe o workflow habilitado. Agora dê ao Jira algo para chamar.

### Envie o evento a partir de uma automation rule do Jira

1. No Jira, abra as automation rules do projeto: **Space settings → Automation** nos tenants mais novos, **Project settings → Automation** nos mais antigos. Para uma regra que abranja vários projetos, use **Settings → System → Global automation**, que exige a permissão global *Administer Jira*.
2. **Create rule** e escolha o gatilho **Work item transitioned** — **Issue transitioned** nos tenants mais antigos. Configure-o para rodar quando o status mudar *para* **Done**.

   Use esse gatilho, não o *Work item updated*: o gatilho de atualização exclui deliberadamente as mudanças de status.

3. Adicione a ação **Send web request** (enviar requisição web) e configure-a:

   - **Web request URL**: a URL de webhook do OneUptime obtida acima.
   - **HTTP method**: `POST`
   - **Headers**: `Content-Type` / `application/json`, e `X-OneUptime-Secret` / o seu segredo compartilhado. Use a opção **Hide** no valor do segredo para que outros editores da regra não consigam lê-lo — note que ocultar é irreversível para aquele valor, e valores ocultos são perdidos se a regra for exportada ou duplicada.
   - **Web request body**: **Custom format**, para que você controle o formato:

     ```json
     {
       "oneuptimeIncidentId": "{{issue.customfield_10050}}",
       "issueKey": "{{issue.key}}",
       "summary": "{{issue.summary}}",
       "status": "{{issue.status.name}}"
     }
     ```

     Se você usou uma label em vez de um campo personalizado no Passo 3, envie `"labels": "{{issue.labels}}"` e extraia o id com um bloco **Run Custom JavaScript** do lado do OneUptime.

4. Ligue a regra, mova um issue de teste para Done e confira os dois lados: o audit log da própria regra no Jira e as **Execuções e registros** no OneUptime.

Coisas que vale saber antes de depender disso:

- **A porta de destino é restrita.** O Send web request só alcança as portas 80, 8080, 443, 6017, 8443, 8444, 7990, 8090, 8085, 8060, 8900 e 9900. O OneUptime Cloud está na 443; uma instalação auto-hospedada em uma porta incomum não pode ser chamada por esse caminho.
- **Não há assinatura da requisição.** A ação não tem opção de HMAC, então um segredo compartilhado em um cabeçalho sobre HTTPS é o mecanismo que a Atlassian documenta. A verificação com **If / Else** no passo 3 do workflow que recebe é o que faz isso valer a pena.
- **As execuções de regra são medidas.** O Jira Cloud conta as execuções bem-sucedidas de regras contra uma cota mensal que depende do seu plano — 100 no Free, 1.700 no Standard, 1.000 × usuários no Premium, ilimitado no Enterprise. Uma regra que dispara a cada transição em um projeto movimentado soma rápido.
- **Os valores não são codificados para URL** por você. Isso só importa se você enviar um corpo form-encoded; o JSON acima está de bom tamanho.
- **A Atlassian publica suas faixas de saída** em [ip-ranges.atlassian.com](https://ip-ranges.atlassian.com), caso a sua instalação do OneUptime esteja atrás de uma lista de permissões. Elas mudam, então consulte o feed em vez de fixar endereços.

### Ou use um webhook do Jira

Um admin do Jira pode registrar um webhook diretamente em **Settings → System → Advanced → WebHooks**, escolhendo os eventos a enviar e, opcionalmente, uma consulta JQL que restringe quais issues o disparam. Comparado com uma automation rule:

- O payload é o do próprio Jira, não o seu: `webhookEvent`, `issue_event_type_name`, o `issue` completo e um `changelog` cujo array `items` guarda o antes e o depois de cada campo alterado. Para uma mudança de status, você quer a entrada em que `field` é `status`. Ler isso dentro de um workflow costuma significar um bloco **Run Custom JavaScript**.
- Webhooks **podem** ser assinados — dê um segredo ao webhook e o Jira envia um cabeçalho `X-Hub-Signature` com um HMAC do corpo da requisição —, mas um workflow não consegue verificá-lo. A assinatura cobre exatamente os bytes que o Jira enviou, e o gatilho Webhook entrega ao workflow um corpo que já foi interpretado como JSON, então não sobra nada para gerar o hash. Se você quer a requisição autenticada, use uma automation rule com um cabeçalho de segredo compartilhado.
- A URL precisa ser HTTPS em uma porta da lista do próprio Jira, que *não* é a mesma lista usada pela ação de automation — a porta 80 não é permitida aqui.
- A entrega é retentada até cinco vezes com um backoff de cinco a quinze minutos, então o seu workflow precisa tolerar o mesmo evento chegando duas vezes.

Webhooks registrados por um app através de `/rest/api/3/webhook` são outra coisa ainda: eles expiram 30 dias depois do registro, a menos que sejam renovados. Os registrados por um admin, acima, não expiram.

## Jira Data Center

O Jira auto-gerenciado funciona da mesma forma, com um punhado de substituições. O **Jira Server** chegou ao fim do suporte em fevereiro de 2024 e não recebe correções, então trate o Data Center como o alvo auto-gerenciado.

| Cloud                                             | Data Center                                                                  |
| ------------------------------------------------- | ---------------------------------------------------------------------------- |
| `/rest/api/3/...`                                 | `/rest/api/2/...` — não existe v3 no Data Center                             |
| `description` como documento em Atlassian Document Format | `description` como string simples em wiki markup                     |
| `Authorization: Basic base64(email:api_token)`    | `Authorization: Bearer <personal access token>`                              |
| Token de API em id.atlassian.com                  | **Profile → Personal access tokens → Create token** na sua própria conta do Jira |
| Ação de automation **Send web request**           | Ação de automation **Send outgoing web request**                             |

Assim, o bloco de criação do issue vira um `POST` para `/rest/api/2/issue` com:

```json
{
  "fields": {
    "project": { "key": "OPS" },
    "issuetype": { "name": "Bug" },
    "summary": "OneUptime #123: Checkout is down",
    "description": "Plain text goes straight in here."
  }
}
```

que é mais simples de templatizar — sem árvore de documento.

Outras diferenças com que contar:

- **Personal access tokens** existem a partir do Jira Core e do Jira Software 8.14 e do Jira Service Management 4.15. Eles expiram — 365 dias por padrão — e a interface marca um como *Expires soon* cinco dias antes. Basic auth com usuário e senha ainda funciona no Data Center, mas alguns logins malsucedidos disparam um CAPTCHA que bloqueia a conta inteiramente na REST API até que uma pessoa o resolva em um navegador, o que é uma péssima maneira de descobrir um erro de digitação. Prefira um token.
- **A automation vem embutida** a partir do Jira Data Center 10.0. Antes disso, era o app Automation for Jira, instalado à parte. A requisição de saída dela tem um timeout padrão de 3000 ms, ajustável com a propriedade `outgoing.webhook.timeout.ms`.
- **Os webhooks** são registrados em **Administration → System → Advanced → WebHooks**, e há suporte a delimitação por JQL. Mantenha esses filtros estreitos: o Jira avalia o JQL de todo webhook registrado na thread que levantou o evento, então uma dúzia de filtros frouxos deixa lenta a ação do usuário que os disparou.
- **A partir do Data Center 10.0 a entrega de webhooks é assíncrona** e não há opção síncrona, então os eventos podem chegar fora de ordem. Faça o workflow que recebe ser idempotente.
- **O Jira 10 removeu o `$` nas variáveis de URL de webhook** — `${issue.id}` virou `{issue.id}` — e moveu o recurso REST de webhook de `/rest/webhooks/1.0/webhook` para `/rest/jira-webhook/1.0/webhooks`.

## Fazendo o mesmo para alertas

Tudo acima foi escrito em torno de incidentes porque esse é o caso comum, mas os alertas funcionam de forma idêntica — troque o tipo de registro e nada mais muda:

| Incidente                                | Alerta                                      |
| ---------------------------------------- | ------------------------------------------- |
| **On Create Incident** (`incident-on-create-1`) | **On Create Alert** (`alert-on-create-1`)   |
| **On Update Incident** (`incident-on-update-1`) | **On Update Alert** (`alert-on-update-1`)   |
| `incidentNumber`, `currentIncidentState`, `incidentSeverity` | `alertNumber`, `currentAlertState`, `alertSeverity` |
| **Find One Incident State**              | **Find One Alert State**                    |
| **Update One Incident**                  | **Update One Alert**                        |

Um workflow tem exatamente um gatilho, então incidentes e alertas precisam de um workflow cada. Se os dois fossem fazer o mesmo trabalho, construa a metade do Jira uma vez e chame-a a partir dos dois com o componente **Execute Workflow**.

## Solução de problemas

Abra primeiro o bloco que falhou em **Execuções e registros**. O Jira devolve um corpo JSON nomeando exatamente o que ele recusou, e o componente API o mantém em `response-body`.

**`401 Unauthorized`.** Recodifique `email:api_token` com `printf` e atualize `JIRA_AUTH`; uma quebra de linha no final, vinda do `echo`, é a causa habitual. Depois confirme que a conta dona do token pode criar issues naquele projeto. No Data Center, verifique se você está enviando `Bearer`, e não `Basic`.

**`400 Bad Request` nomeando um campo.** O tipo de issue não existe no projeto, ou o projeto tem um campo obrigatório que você não está enviando. Rode as chamadas de `createmeta` acima contra aquele projeto e tipo de issue e compare.

**`400` reclamando de `description`.** Na v3 do Cloud, a descrição precisa ser um documento em Atlassian Document Format, não uma string. Ou envie o documento mostrado acima, ou troque aquele bloco para `/rest/api/2/issue` e envie texto puro.

**`404 Not Found`.** Verifique a URL base e a versão da API — `/rest/api/3/...` no Cloud, `/rest/api/2/...` no Data Center.

**`429 Too Many Requests`.** O Jira está limitando a taxa. A resposta traz `Retry-After` em segundos e um `RateLimit-Reason` nomeando qual limite você atingiu. As escritas contra um único issue têm um teto apertado — da ordem de vinte em dois segundos —, então um workflow que comenta e faz a transição em rápida sucessão pode esbarrar nele em um único issue. Coloque um bloco **Delay** entre as chamadas, ou mova o trabalho em lote para um workflow agendado.

**A chamada de transição devolve `400`.** O id da transição não é válido a partir do status *atual* do issue. Busque `/transitions` para aquele issue e use um id da resposta.

**A automation rule aparece como bem-sucedida, mas nada chega ao OneUptime.** Verifique primeiro a porta — veja a lista de restrições acima. Depois envie você mesmo uma requisição para a URL do webhook com `curl` e veja se ela aparece em **Execuções e registros**; se a sua chega e a do Jira não, o problema está do lado do Jira.

**O workflow roda, mas o incidente não muda.** Um bloco **Update One Incident** reporta `Items Updated: 0` quando a consulta dele não correspondeu a nada, e isso conta como sucesso, não erro. Confira se o id no payload é mesmo o id do incidente no OneUptime e se você está consultando `_id`.

**Uma referência `{{...}}` aparece literalmente em um issue do Jira.** Uma referência não resolvida é repassada como texto, em vez de ser esvaziada. O registro da execução nomeia qualquer referência que não resolveu — normalmente um identificador de bloco digitado errado ou uma variável renomeada.

## O que ler em seguida

- [Visão geral das integrações](/docs/integrations/index) — os padrões de entrada e saída e o guia rápido de autenticação.
- [Microsoft Dynamics 365](/docs/integrations/microsoft-dynamics-365) — a mesma construção em duas direções, contra o Dynamics.
- [Visão geral dos workflows](/docs/workflows/index) e [Criar um workflow](/docs/workflows/authoring) — o canvas, os identificadores e como ligar um workflow.
- [Componentes](/docs/workflows/components) — os blocos de API, o If / Else e os componentes de dados do OneUptime.
- [Variáveis](/docs/workflows/variables) — segredos e a leitura da saída de um bloco no seguinte.
- [Configuração e segurança](/docs/workflows/configuration) — segurança de webhook e acesso de rede de saída.
- [ServiceNow](/docs/integrations/servicenow) e [PagerDuty](/docs/integrations/pagerduty) — o mesmo padrão de saída para outras ferramentas.
