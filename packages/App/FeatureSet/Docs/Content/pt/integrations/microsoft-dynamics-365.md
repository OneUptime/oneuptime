# Integração com o Microsoft Dynamics 365

Abra um **Case** no [Microsoft Dynamics 365](https://www.microsoft.com/dynamics-365) sempre que um incidente do OneUptime for declarado, mantenha esse case em dia conforme o incidente avança e deixe o Dynamics empurrar mudanças do case de volta para o OneUptime — tudo com um [Workflow](/docs/workflows/index). Não há bloco específico do Dynamics para instalar: o OneUptime conversa com a **Dataverse Web API** através do [componente API](/docs/workflows/components#api), e o Dynamics responde por um [gatilho Webhook](/docs/workflows/triggers#webhook).

```text
OneUptime Incident → On Create  ──►  API Post (token)  ──►  API Post (POST /api/data/v9.2/incidents)  ──►  Dynamics 365 Case

Dynamics 365 Case changed  ──►  Power Automate flow (HTTP)  ──►  OneUptime Webhook trigger  ──►  Update One Incident
```

Esta página cobre as duas direções. Construa primeiro a metade de saída — é a que precisa da configuração no Microsoft Entra ID, e, quando ela funciona, a metade de entrada é um único flow.

## Pré-requisitos

- Um ambiente do **Dynamics 365** que contenha a tabela **Case**. Os cases vêm do Dynamics 365 Customer Service; um ambiente do Dataverse sem ele não tem tabela `incident` para gravar.
- O **Web API endpoint** do ambiente. Encontre-o no [Power Platform admin center](https://admin.powerplatform.microsoft.com/), em **Settings → Developer resources** do seu ambiente, ou em **make.powerapps.com → Settings → Developer resources**. Ele se parece com `https://yourorg.crm.dynamics.com/api/data/v9.2/` — o segmento de região varia (`crm` para a América do Norte, `crm2` para a América do Sul, `crm7` para o Japão, e assim por diante).
- Direitos para registrar um aplicativo no **Microsoft Entra ID** e para criar um **application user** no ambiente do Dynamics. Normalmente são dois administradores diferentes.
- Um projeto no OneUptime onde você possa criar workflows e variáveis globais.

> Tudo abaixo usa os nomes de tabela do Dataverse, não os rótulos dos formulários do Dynamics. Um case é a tabela **`incident`**, sua coleção em uma URL é **`incidents`**, sua chave primária é **`incidentid`** e sua coluna de título é **`title`**. O número do case que você vê na interface é **`ticketnumber`**.

## Passo 1 — Registre um aplicativo no Microsoft Entra ID

O OneUptime se autentica como um aplicativo, não como uma pessoa, então ele usa o fluxo **client credentials** do OAuth 2.0.

1. Entre no [portal do Azure](https://portal.azure.com) como administrador do mesmo tenant do seu ambiente do Dynamics e abra o **Microsoft Entra ID**.
2. Vá em **App registrations → New registration**. Dê a ele um nome como `OneUptime Integration`, deixe **Supported account types** em **Accounts in this organizational directory only** e selecione **Register**.
3. Na página **Overview** do app, copie o **Application (client) ID** e o **Directory (tenant) ID**.
4. Vá em **Certificates & secrets → Client secrets → New client secret**. Copie o **Value** do secret — não o ID dele — antes de sair da página. Ele nunca é mostrado de novo. Um client secret pode viver no máximo 24 meses, então anote a expiração em algum lugar que você vá ver.

Duas coisas que as pessoas adicionam aqui e que você não precisa:

- **Nenhuma API permission.** No fluxo client credentials não há usuário conectado, então permissões delegadas não fazem nada. `user_impersonation` sob **Dataverse** é uma permissão delegada e só serve para aplicativos interativos. O Microsoft Entra ID emite tranquilamente um token para o Dataverse sem nenhuma permissão configurada — o acesso é decidido do lado do Dynamics, no Passo 2.
- **Nenhum passo de admin consent.** Pelo mesmo motivo.

A Microsoft prefere um certificado a um client secret para aplicativos em produção. Essa opção exige que o chamador monte e assine ele mesmo uma asserção JWT, o que um workflow não consegue fazer, então um client secret é a escolha prática aqui — trate-o de acordo: mantenha-o em uma variável secreta e rotacione-o antes que expire.

## Passo 2 — Crie o application user no Dynamics

Este é o passo que costuma ser pulado, e pulá-lo produz a falha mais confusa desta integração inteira: a requisição do token dá certo, e toda chamada ao Dataverse falha em seguida com `403 Forbidden` e o código de erro `0x80072560` — *"The user isn't a member of the organization."* O Entra ID emite o token sem saber nada sobre o Dynamics; o Dynamics então procura uma linha de usuário correspondente ao aplicativo, e não há nenhuma.

1. Abra o [Power Platform admin center](https://admin.powerplatform.microsoft.com/) e selecione **Manage → Environments**, depois o seu ambiente.
2. Selecione **Settings → Users + permissions → Application users**.
3. Selecione **+ New app user**, depois **+ Add an app**, escolha o registro do Passo 1 e selecione **Add**.
4. Escolha uma **Business unit**, informe um **Email address** e use o ícone de edição ao lado de **Security roles**.
5. Atribua um security role **personalizado** com privilégios de criação, leitura e escrita na tabela **Case**. Um application user não pode receber um dos papéis integrados — a Microsoft exige um personalizado. Se você não tiver um papel adequado, copie um existente e reduza-o.
6. Selecione **Save** e depois **Create**.

Você só pode ter um application user por aplicativo registrado em um ambiente. Application users não são licenciados e estão isentos das regras de participação em security groups do ambiente.

## Passo 3 — Armazene as credenciais no OneUptime

Vá em **Fluxos de trabalho → Variáveis globais → Criar** e adicione estas, ativando **Segredo** nas marcadas:

| Nome                     | Valor                                                       | Segredo |
| ------------------------ | ----------------------------------------------------------- | ------- |
| `DYNAMICS_TENANT_ID`     | O Directory (tenant) ID do Passo 1                          | Não     |
| `DYNAMICS_CLIENT_ID`     | O Application (client) ID do Passo 1                        | Não     |
| `DYNAMICS_CLIENT_SECRET` | O **Value** do client secret do Passo 1                     | Sim     |
| `DYNAMICS_URL`           | `https://yourorg.crm.dynamics.com` — sem barra no final     | Não     |

Cole o client secret exatamente como o Entra ID o entregou. O OneUptime codifica o corpo do formulário para você, então não faça a codificação de URL à mão.

Referencie qualquer uma delas em um bloco com `{{global.variables.DYNAMICS_CLIENT_ID}}`. Veja [Variáveis](/docs/workflows/variables) para saber como os segredos são removidos dos registros de execução.

## Passo 4 — Obtenha um access token

Cada execução busca o próprio token. Os tokens duram de 60 a 90 minutos e o fluxo client credentials nunca emite um refresh token, então não há nada para armazenar em cache e nada para renovar — uma chamada HTTP extra por execução é todo o custo.

1. Abra **Fluxos de trabalho → Criar fluxo de trabalho**, nomeie-o `Incidents → Dynamics 365` e abra o **Construtor**.
2. Clique no espaço reservado tracejado, adicione o gatilho **On Create Incident** e, em **Select Fields**, peça as colunas que você quer enviar:

   ```json
   {
     "_id": true,
     "title": true,
     "description": true,
     "incidentNumber": true,
     "incidentSeverity": { "name": true }
   }
   ```

   Deixe o **Identifier** como `incident-on-create-1`.

3. Clique em **Adicionar componente**, adicione um bloco **API Post (JSON)**, conecte o conector **Sucesso** do gatilho a ele e abra suas configurações. Defina o **Identifier** como `get-token` e então:

   - **URL**: `https://login.microsoftonline.com/{{global.variables.DYNAMICS_TENANT_ID}}/oauth2/v2.0/token`
   - **Request Headers**:

     ```json
     { "Content-Type": "application/x-www-form-urlencoded" }
     ```

   - **Request Body**:

     ```json
     {
       "client_id": "{{global.variables.DYNAMICS_CLIENT_ID}}",
       "client_secret": "{{global.variables.DYNAMICS_CLIENT_SECRET}}",
       "scope": "{{global.variables.DYNAMICS_URL}}/.default",
       "grant_type": "client_credentials"
     }
     ```

**Digite o nome do cabeçalho como `Content-Type`, com exatamente essa capitalização.** É isso que diz ao OneUptime para enviar o corpo como um form post em vez de JSON, que é o único formato que o endpoint de token da Microsoft aceita. `content-type` em minúsculas não corresponde, a requisição sai como JSON e volta `400`.

O `scope` precisa ser a URL do seu ambiente seguida de `/.default` — essa é a forma de cliente confidencial. Uma URL de ambiente errada aqui é a causa habitual de `AADSTS70011: The provided value for the input parameter 'scope' is not valid`.

O token fica agora disponível para os blocos seguintes como:

```text
{{local.components.get-token.returnValues.response-body.access_token}}
```

## Passo 5 — Crie o case

Adicione um segundo bloco **API Post (JSON)**, conecte o conector **Sucesso** de `get-token` a ele e defina seu **Identifier** como `create-case`.

- **URL**: `{{global.variables.DYNAMICS_URL}}/api/data/v9.2/incidents?$select=incidentid,ticketnumber`
- **Request Headers**:

  ```json
  {
    "Authorization": "Bearer {{local.components.get-token.returnValues.response-body.access_token}}",
    "OData-MaxVersion": "4.0",
    "OData-Version": "4.0",
    "Accept": "application/json",
    "If-None-Match": "null",
    "Prefer": "return=representation"
  }
  ```

- **Request Body**:

  ```json
  {
    "title": "OneUptime #{{local.components.incident-on-create-1.returnValues.model.incidentNumber}}: {{local.components.incident-on-create-1.returnValues.model.title}}",
    "description": "{{local.components.incident-on-create-1.returnValues.model.description}}",
    "caseorigincode": 3,
    "prioritycode": 1,
    "customerid_account@odata.bind": "/accounts(00000000-0000-0000-0000-000000000000)"
  }
  ```

Substitua o GUID da conta pela account à qual esses cases pertencem. **`customerid` é genuinamente obrigatório em um case** — é uma das colunas que o Dataverse impõe em qualquer escrita programática, então uma criação sem ela é recusada. Como ela pode apontar tanto para uma account quanto para um contact, você nunca escreve `customerid@odata.bind`; você escreve `customerid_account@odata.bind` ou `customerid_contact@odata.bind`, e esses nomes diferenciam maiúsculas de minúsculas. `title` é obrigatório de outra natureza: os formulários do Dynamics insistem nele, a API não — envie-o mesmo assim.

`Prefer: return=representation` é o que torna isso utilizável a partir de um workflow. Sem ele, uma criação bem-sucedida responde `204 No Content` e coloca a URI do novo registro em um cabeçalho de resposta `OData-EntityId`, do qual você teria então de extrair um GUID. Com ele, a resposta é `201 Created` e traz o próprio registro, de forma que o bloco seguinte pode ler:

```text
{{local.components.create-case.returnValues.response-body.incidentid}}
{{local.components.create-case.returnValues.response-body.ticketnumber}}
```

Agora ligue o workflow — **Visão geral → Editar fluxo de trabalho → Habilitado** —, declare um incidente de teste e leia a execução em **Execuções e registros**. O bloco `create-case` deve exibir um `201` e um corpo contendo o novo `incidentid`. As mudanças no canvas se salvam sozinhas; não há botão de salvar.

### Mapeando severidade e status

O Dynamics vem com `severitycode` com uma única opção, "Default Value", então não há uma escala de severidade pronta para mapear. Use **`prioritycode`** no lugar e ramifique com um bloco **If / Else** em `{{local.components.incident-on-create-1.returnValues.model.incidentSeverity.name}}` se você quiser prioridades por severidade.

| Coluna           | Valores                                                                                                                           |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `prioritycode`   | `1` High, `2` Normal, `3` Low                                                                                                     |
| `caseorigincode` | `1` Phone, `2` Email, `3` Web, `2483` Facebook, `3986` Twitter, `700610000` IoT                                                   |
| `casetypecode`   | `1` Question, `2` Problem, `3` Request                                                                                            |
| `statecode`      | `0` Active, `1` Resolved, `2` Cancelled                                                                                           |
| `statuscode`     | `1` In Progress, `2` On Hold, `3` Waiting for Details, `4` Researching, `5` Problem Solved, `6` Cancelled, `1000` Information Provided, `2000` Merged |

`statuscode` é personalizável, então um tenant pode ter acrescentado valores próprios. Envie inteiros, não rótulos.

## Passo 6 — Mantenha o incidente e o case localizáveis um a partir do outro

O que quer que você faça depois — comentar, resolver, sincronizar de volta — exige que um dos dois sistemas guarde o identificador do outro. Coloque-o do lado do Dynamics.

Adicione uma coluna do tipo **single line of text** à tabela Case, por exemplo `new_oneuptimeincidentid`, e defina-a ao criar o case:

```json
"new_oneuptimeincidentid": "{{local.components.incident-on-create-1.returnValues.model._id}}"
```

Qualquer workflow posterior pode então encontrar o case com um filtro:

```text
{{global.variables.DYNAMICS_URL}}/api/data/v9.2/incidents?$select=incidentid,ticketnumber&$filter=new_oneuptimeincidentid eq '<the incident id>'
```

Se você definir essa coluna como uma **alternate key** na tabela Case, pode pular a busca inteiramente e fazer `PATCH` direto em `incidents(new_oneuptimeincidentid='<id>')` — um upsert que cria o case se ele não existir e o atualiza se existir. A chave precisa terminar de ser construída (seu estado passa a **Active**) antes de poder ser usada, e valores de alternate key não podem conter `/ < > * % & : \ ? + #`. Um id do OneUptime é um UUID simples, então é seguro.

A direção inversa — guardar o id do case do Dynamics no incidente do OneUptime — também funciona, usando um bloco **Update One Incident** que grava em `customFields`. Tenha cuidado com isso: `customFields` é uma única coluna JSON, então gravá-la substitui todos os valores de campos personalizados daquele incidente, não só o seu. Manter o vínculo do lado do Dynamics evita isso por completo.

## Passo 7 — Resolva o case quando o incidente for resolvido

Construa isso como um **segundo** workflow, para que uma falha aqui não impeça a abertura dos cases.

1. **Criar fluxo de trabalho**, nomeie-o `Incident resolved → Close Dynamics case` e adicione o gatilho **On Update Incident**.
2. Em **Listen on**, no gatilho, coloque `{"currentIncidentStateId": true}` para que o workflow só acorde em mudanças de estado, em vez de a cada edição. Em **Select Fields**, peça `{"_id": true, "currentIncidentState": {"name": true}}`.
3. Adicione um bloco **If / Else**. **Input 1** é `{{local.components.incident-on-update-1.returnValues.model.currentIncidentState.name}}`, **Operator** é `==` e **Input 2** é `Resolved` — ou como quer que o estado resolvido se chame no seu projeto. Veja [Estados e severidades](/docs/incidents/states-and-severities).
4. Da ramificação **Sim**, repita o bloco `get-token` do Passo 4.
5. Adicione um bloco **API Get (JSON)**, defina seu **Identifier** como `find-case` e dê a ele a URL com `$filter` do Passo 6. Uma consulta ao Dataverse responde com um array `value`, e uma referência de workflow consegue indexar um array com colchetes, então o id do case é `{{local.components.find-case.returnValues.response-body.value[0].incidentid}}`.
6. Adicione um bloco **API Post (JSON)** que fecha o case:

   - **URL**: `{{global.variables.DYNAMICS_URL}}/api/data/v9.2/CloseIncident`
   - **Request Headers**: os mesmos do Passo 5, menos o `Prefer`.
   - **Request Body**:

     ```json
     {
       "IncidentResolution": {
         "@odata.type": "Microsoft.Dynamics.CRM.incidentresolution",
         "subject": "Resolved in OneUptime",
         "incidentid@odata.bind": "/incidents(<the case id>)"
       },
       "Status": 5
     }
     ```

     `Status` é um valor de `statuscode` no estado Resolved — `5` é *Problem Solved*.

     **Teste este corpo contra o seu próprio ambiente antes de depender dele.** `CloseIncident` recebe dois parâmetros, `IncidentResolution` e `Status`, mas a Microsoft não publica nenhum exemplo HTTP para ele — todos os exemplos oficiais são em C#. O formato acima é a tradução convencional. Se o seu ambiente o recusar, tente identificar o case com uma propriedade `"incidentid": "<the case id>"` simples em vez da forma `@odata.bind`, que é como os outros exemplos de action da Microsoft referenciam um registro existente.

**Por que não simplesmente fazer `PATCH` do case para `statecode: 1`?** Você pode — a Microsoft documenta um `PATCH` de `statecode` e `statuscode` como o equivalente na Web API da antiga mensagem SetState, e é a ferramenta certa para mover um case entre status ativos. O que isso não faz é criar a atividade **Case Resolution** que se espera de um case resolvido no Dynamics 365 Customer Service, e será recusado de saída em um ambiente onde um administrador tenha configurado transições de status personalizadas. Use `CloseIncident` para resolver; use `PATCH` para todo o resto. E sempre que você gravar `statecode`, defina `statuscode` na mesma requisição — caso contrário o Dynamics aplica silenciosamente o status padrão daquele estado.

`CloseIncident` vem do Dynamics 365 Customer Service, e não do Dataverse básico, e não está listado na referência de actions do Dataverse. Se ele devolver `404`, confirme que existe no seu ambiente buscando `{{global.variables.DYNAMICS_URL}}/api/data/v9.2/$metadata` e procurando por `CloseIncident`.

Para qualquer coisa aquém de fechar o case — uma nota, um aumento de prioridade, uma mudança de título — use um bloco **API Patch (JSON)** contra `{{global.variables.DYNAMICS_URL}}/api/data/v9.2/incidents(<the case id>)` com um cabeçalho `If-Match: *`, que impede que um upsert acidental crie um case novo. Envie apenas as colunas que você está alterando.

## Entrada — do Dynamics 365 para o OneUptime

Agora a outra direção: alguém fecha o case no Dynamics, ou um agente adiciona uma nota, e o OneUptime deveria saber.

### Construa primeiro o workflow que recebe

1. **Criar fluxo de trabalho**, nomeie-o `Dynamics 365 → OneUptime` e adicione o gatilho **Webhook**.
2. Abra as **Configurações** desse workflow e copie a **Chave secreta do webhook**. Sua URL é:

   ```text
   https://oneuptime.com/workflow/trigger/<webhook secret key>
   ```

   Em uma instalação auto-hospedada, troque pelo seu próprio host. Trate a URL como uma senha — quem a tiver pode iniciar o workflow. Você pode redefinir a chave na mesma página.

3. Adicione um bloco **If / Else** que verifica um segredo compartilhado antes que qualquer outra coisa aconteça. **Input 1** é `{{local.components.webhook-1.returnValues.request-headers.x-oneuptime-secret}}`, **Operator** `==`, **Input 2** `{{global.variables.DYNAMICS_WEBHOOK_SECRET}}` — um valor que você inventa e salva como variável global secreta.
4. Da ramificação **Sim**, adicione um bloco **Update One Incident**:

   - **Query**: `{"_id": "{{local.components.webhook-1.returnValues.request-body.oneuptimeIncidentId}}"}`
   - **Data (JSON Object)**: o que quer que a mudança no case deva significar no OneUptime — uma mudança de estado, uma nota, um rótulo.

   Para mover o incidente para um estado, você vai precisar do id desse estado: um bloco **Find One Incident State** com a consulta `{"name": "Resolved"}` entrega `{{local.components.incident-state-find-one-1.returnValues.model._id}}` para você escrever em `currentIncidentStateId`.

Deixe-o habilitado e pronto. Agora dê ao Dynamics algo para chamar.

### Opção A — um flow do Power Automate (recomendado)

Este é o caminho que a maioria dos times deveria seguir: você controla o payload e não há nada para instalar.

1. No [Power Automate](https://make.powerautomate.com), crie um **Automated cloud flow**.
2. Gatilho: **Microsoft Dataverse → When a row is added, modified or deleted** (quando uma linha é adicionada, modificada ou excluída).

   - **Change type**: `Modified`
   - **Table name**: `Cases`
   - **Scope**: `Organization` — qualquer coisa mais estreita só dispara para linhas pertencentes a você ou à sua business unit.
   - **Select columns**: `statecode,statuscode`. Este é um filtro que vale só para Update e vale a pena acertá-lo. Colunas de lookup não são suportadas aqui, e nunca liste uma coluna presente em toda atualização (como a chave primária) ou o flow dispara a cada salvamento.

3. Adicione **Microsoft Dataverse → Get a row by ID**, tabela `Cases`, id da linha vindo do gatilho, e um **Select columns** de `incidentid,ticketnumber,title,statecode,statuscode,new_oneuptimeincidentid`.

   Essa segunda chamada vale o que custa. Em uma atualização, o gatilho só carrega as colunas que mudaram, então os identificadores de que você precisa para correspondência podem simplesmente não estar lá.

4. Adicione a ação integrada **HTTP**:

   - **Method**: `POST`
   - **URI**: a URL de webhook do OneUptime obtida acima
   - **Headers**: `Content-Type: application/json` e `X-OneUptime-Secret: <the same secret>`
   - **Body**: monte-o a partir das saídas do *Get a row by ID*, por exemplo

     ```json
     {
       "oneuptimeIncidentId": "<new_oneuptimeincidentid>",
       "caseId": "<incidentid>",
       "caseNumber": "<ticketnumber>",
       "statecode": "<statecode>",
       "statuscode": "<statuscode>"
     }
     ```

5. Salve e ligue o flow.

Vale saber antes de se comprometer com este caminho:

- O **Microsoft Dataverse connector é premium.** Em um flow automatizado, só o dono do flow precisa da licença, não todo mundo que toca no case — mas a licença do dono expirando interrompe o flow silenciosamente.
- Os gatilhos do Dataverse são **push, não polling** — o Dynamics registra um callback e o dispara. A entrega normalmente acontece em segundos; qualquer coisa além de cinco minutos significa que o serviço assíncrono está acumulando fila, o que você pode ver em **Settings → System Jobs** no admin center.
- Cabeçalhos personalizados sobrevivem. O Power Automate remove várias famílias de cabeçalhos padrão das ações HTTP (a maior parte dos cabeçalhos `Accept-*` e `Content-*`, `Host`, `Origin`, `Cookie`), mas um cabeçalho seu, como `X-OneUptime-Secret`, é repassado.
- O flow precisa viver no mesmo ambiente da tabela que ele observa.
- As requisições contam contra a alocação de requisições do Power Platform do seu tenant, e o throttling de connector aparece como `429` dentro da execução do flow.

### Opção B — um webhook nativo do Dataverse

Se o Power Automate não estiver disponível, o Dataverse pode chamar o OneUptime diretamente. Registre o endpoint com a [Plug-in Registration Tool](https://learn.microsoft.com/en-us/power-apps/developer/data-platform/register-web-hook): **Register New WebHook**, informe a URL do OneUptime, escolha a autenticação **HttpHeader** e adicione `X-OneUptime-Secret` com o seu segredo. Depois registre um step na tabela **incident** para a mensagem **Update**, com **Filtering Attributes** limitados às colunas que lhe interessam, stage **PostOperation**, modo de execução **Asynchronous**.

Siga este caminho de olhos abertos:

- **Somente as portas 80 e 443.** Um OneUptime auto-hospedado em qualquer outra porta não pode ser registrado.
- **O Dataverse não verifica o seu segredo.** Ele envia o cabeçalho; recusar uma requisição que não o carregue é inteiramente tarefa do seu workflow — que é para isso que serve o bloco **If / Else** no workflow que recebe.
- **O payload não é um objeto JSON amigável.** É um `RemoteExecutionContext` serializado, no qual `InputParameters` é um *array* de pares `{key, value}` e a linha alterada fica sob a chave `Target`, com suas colunas em mais um array `Attributes`. Espere ter de adicionar um bloco **Run Custom JavaScript** para achatá-lo antes que qualquer outra coisa consiga lê-lo.
- **Só as colunas alteradas são incluídas** em uma atualização, então registre um **Post Image** se você precisar de `ticketnumber` ou da sua coluna de id do OneUptime.
- **Acima de 256 KB as partes interessantes são removidas** — `InputParameters`, `PreEntityImages` e `PostEntityImages` vão embora, e a requisição traz um cabeçalho `x-ms-dynamics-msg-size-exceeded`. `PrimaryEntityId` e `PrimaryEntityName` sobrevivem, então a saída é reler a linha pela Web API.
- **A entrega é quase implacável.** O Dataverse espera 60 segundos por um `2xx` e faz exatamente uma retentativa, apenas para `502`, `503` e `504`. Qualquer outra coisa — incluindo um `500` do seu lado — não é retentada; ela vira um System Job com falha.
- Escolha **Asynchronous**. Um step síncrono bloqueia o salvamento do agente no seu endpoint e, se a transação for revertida depois, a requisição já saiu e não pode ser cancelada.

Os workflows clássicos de segundo plano do Dynamics não têm nenhum step de HTTP ou webhook, então não são uma terceira opção aqui.

## Fazendo o mesmo para alertas

Tudo acima foi escrito em torno de incidentes porque esse é o caso comum, mas os alertas funcionam de forma idêntica — troque o tipo de registro e nada mais muda:

| Incidente                                                     | Alerta                                              |
| ------------------------------------------------------------- | --------------------------------------------------- |
| **On Create Incident** (`incident-on-create-1`)               | **On Create Alert** (`alert-on-create-1`)           |
| **On Update Incident** (`incident-on-update-1`)               | **On Update Alert** (`alert-on-update-1`)           |
| `incidentNumber`, `currentIncidentState`, `incidentSeverity`  | `alertNumber`, `currentAlertState`, `alertSeverity` |
| **Find One Incident State**                                   | **Find One Alert State**                            |
| **Update One Incident**                                       | **Update One Alert**                                |

Um workflow tem exatamente um gatilho, então incidentes e alertas precisam de um workflow cada. Se os dois fossem fazer o mesmo trabalho, construa a metade do Dynamics uma vez e chame-a a partir dos dois com o componente **Execute Workflow**.

## Solução de problemas

Leia primeiro o bloco que falhou em **Execuções e registros** — os dois endpoints da Microsoft devolvem um corpo JSON explicativo, e o componente API o mantém em `response-body`.

**A requisição de token falha com `400` e `invalid_request` ou um grant type não suportado.** O cabeçalho `Content-Type` não é exatamente `Content-Type: application/x-www-form-urlencoded`, então o corpo saiu como JSON. Verifique a capitalização.

**`400` com `AADSTS70011: The provided value for the input parameter 'scope' is not valid`.** O `scope` não é a URL do seu ambiente mais `/.default`. Copie a URL de **Developer resources** e remova qualquer barra final e qualquer caminho `/api/data/...`.

**`401 Unauthorized` vindo do Dynamics.** O cabeçalho `Authorization` está faltando, malformado, ou o token expirou no meio da execução. Ele precisa ser `Bearer <token>` com um único espaço.

**`403 Forbidden` com `0x80072560`, "The user isn't a member of the organization".** O Passo 2 foi pulado, ou o application user está vinculado a outro registro de aplicativo. O token está certo; o usuário do lado do Dynamics é que não existe.

**`403 Forbidden` com um erro de privilégio.** O application user existe, mas o security role personalizado dele não tem Create, Read ou Write em **Case**.

**`400 Bad Request` mencionando o customer.** `customerid` é obrigatório. Defina `customerid_account@odata.bind` ou `customerid_contact@odata.bind`, escrito exatamente assim, com uma URI iniciada por barra, como `/accounts(<guid>)`.

**`404 Not Found` em `/CloseIncident`.** A action é uma action do Dynamics 365 Customer Service. Procure por ela no `$metadata` do seu ambiente antes de supor que está disponível.

**`412 Precondition Failed` com `DuplicateRecord`.** Uma regra de detecção de duplicidade correspondeu. Ou restrinja a regra, ou pare de enviar o campo em que ela casa.

**`429 Too Many Requests`.** São os limites de proteção de serviço do Dataverse — aproximadamente 6.000 requisições e 20 minutos de tempo de execução por usuário em qualquer janela de cinco minutos, por servidor web. A resposta traz um `Retry-After` em segundos. Se um workflow está estourando em rajadas, coloque um bloco **Delay** nele ou mova o trabalho para um workflow agendado que processe em lotes.

**Nada chega do lado do OneUptime.** Envie você mesmo uma requisição para a URL do webhook com `curl` e confira as **Execuções e registros** do workflow. Se a sua própria requisição aparecer e a do Dynamics não, o problema está a montante: para o Power Automate, olhe o histórico de execuções do próprio flow; para um webhook nativo, olhe **Settings → System Jobs** filtrado por falhas.

**O workflow roda, mas o incidente não muda.** Um bloco **Update One Incident** reporta `Items Updated: 0` quando a consulta não correspondeu a nada — isso é sucesso, não erro. Confira se o id no payload é o id do incidente no OneUptime e se você está consultando `_id`.

## O que ler em seguida

- [Visão geral das integrações](/docs/integrations/index) — os padrões de entrada e saída e o guia rápido de autenticação.
- [Jira](/docs/integrations/jira) — a mesma construção em duas direções, contra o Jira.
- [Visão geral dos workflows](/docs/workflows/index) e [Criar um workflow](/docs/workflows/authoring) — o canvas, os identificadores e como ligar um workflow.
- [Componentes](/docs/workflows/components) — os blocos de API, o If / Else e os componentes de dados do OneUptime.
- [Variáveis](/docs/workflows/variables) — segredos e a leitura da saída de um bloco no seguinte.
- [Configuração e segurança](/docs/workflows/configuration) — segurança de webhook e acesso de rede de saída.
- [Endereços IP](/docs/configuration/ip-addresses) — as faixas de saída do OneUptime, caso o Dynamics esteja atrás de uma lista de permissões.
