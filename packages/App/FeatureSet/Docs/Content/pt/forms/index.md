# Visão geral dos formulários

Um formulário é uma página que qualquer pessoa com o link pode preencher, sem uma conta do OneUptime. Cada envio cria algo no seu projeto: um **incidente**, para relatos de problemas, ou um **evento de manutenção programada**, para pedidos de mudança e de manutenção. Você monta as perguntas do formulário num editor de arrastar e soltar, decide como as respostas viram o registro e compartilha o link com as pessoas que devem usá-lo.

Use um formulário quando quem percebe um problema, ou precisa de uma mudança, não é quem cuida dos seus incidentes e manutenções: agentes de suporte, colegas de outro departamento, o gerente de uma loja, a equipe de operações de um cliente. Eles abrem o link, respondem às suas perguntas e clicam em **Enviar**. Sua equipe recebe um incidente ou evento comum, com as respostas nos campos e uma nota privada que registra quem o enviou.

:::cards
- [Criar seu primeiro formulário](#criar-seu-primeiro-formulário): De um formulário em branco a um link que você pode compartilhar.
- [Criar um formulário](/docs/forms/building): Perguntas, tipos de resposta, perguntas ocultas, modelos e marca.
- [O que um envio cria](/docs/forms/on-submit): Como as respostas e as configurações viram um incidente ou um evento de manutenção.
- [Partilha e segurança](/docs/forms/sharing-and-security): O link, a lista de IPs permitidos, os limites de taxa e a solução de problemas.
:::

## Como um formulário funciona

```mermaid title="De um formulário preenchido a um incidente ou evento de manutenção"
flowchart TB
    submitter["Alguém com o link,<br/>sem conta"] --> page["A página do formulário"]
    page -->|Enviar| checks["Proteções e<br/>verificação das respostas"]
    checks --> submission["Envio, guardado<br/>com o formulário"]
    submission --> target{"Cada envio cria"}
    target -->|Incidente| incident["Incidente, oculto<br/>nas páginas de status"]
    target -->|Manutenção programada| event["Evento de manutenção,<br/>oculto salvo indicação"]
    incident --> response["Políticas de plantão<br/>e regras são executadas"]
    incident --> note["Nota privada: quem enviou,<br/>outras respostas"]
    event --> note
```

Cada solicitação passa primeiro pelas proteções do formulário: a página dele, os limites de taxa, a lista de IPs permitidos e o captcha. Um envio cujas respostas são válidas é guardado e cria um registro, preenchido com as respostas, com as configurações de **Ao enviar** do formulário e, num incidente, com o modelo de incidente dele. Nada do que ele cria chega a uma página de status até a sua equipe decidir.

## Em resumo

- **Um produto próprio**: **Formulários** fica no menu de produtos, em `/dashboard/{projectId}/forms`. Cada formulário tem um link próprio, como `https://oneuptime.com/accounts/form/<share-key>` no OneUptime Cloud.
- **Sem conta**: qualquer pessoa com o link pode abrir o formulário e enviá-lo, sem fazer login.
- **Um editor, não uma página de configurações**: adicione suas próprias perguntas (respostas curtas, parágrafos, listas suspensas, datas, caixas de seleção e mais), os campos do que o formulário cria (título, descrição, severidade, monitores, rótulos, início e fim), seus campos personalizados e o nome e o e-mail de quem envia. Arraste para ordenar, pré-visualize o formulário e salve.
- **Você decide de onde vem cada valor**: a página **Ao enviar** lista cada campo do novo incidente ou evento ao lado da origem: uma resposta, um valor padrão, uma configuração que sempre vale ou o modelo de incidente.
- **Oculto até alguém publicar**: os incidentes de um formulário nunca aparecem nas páginas de status nem são enviados aos assinantes quando são declarados; os eventos de manutenção também não, a menos que o formulário diga o contrário.
- **Protegido em camadas**: um interruptor **Aceita envios**, uma **Lista de IPs permitidos** opcional, a recusa de solicitações vindas de outros sites, limites de taxa, o captcha da instância e limites de tamanho em cada resposta.
- **Cada envio guardado**: a página **Envios** de cada formulário, e **Formulários → Envios** para todos eles, listam as respostas e apontam para o que cada envio criou.
- **Sua própria marca**: envie um logotipo para o topo da página do formulário e um favicon para a aba do navegador, na seção **Marca** da página **Construir**. Até lá, o formulário mostra os do OneUptime.
- **Modelos para os casos comuns**: salve conjuntos de respostas com nome, como **Falha da aplicação** ou **Manutenção planejada**, e as pessoas escolhem um no topo do formulário para preenchê-lo, ou abrem o link próprio dele. Cada modelo também pode deixar uma pergunta obrigatória, opcional ou oculta para o seu caso. Um único formulário, e um único favorito, atende uma equipe inteira.
- **Perguntas ocultas**: oculte uma pergunta que ninguém deveria ter de responder, como a descrição do incidente, e deixe cada modelo respondê-la, ou fazê-la, nos casos que precisam dela.
- **Duplicar formulário**: comece um formulário para outra equipe a partir de um que funciona, com as perguntas, os modelos e as configurações dele.

## O que um formulário pode criar

Ao criar um formulário, você escolhe o que **Cada envio cria**. Dá para mudar depois na página **Ao enviar** do formulário.

| Cada envio cria | Use para | O que acontece |
| --- | --- | --- |
| **Incidente** | Relatos de problemas | Um incidente é declarado na hora, então suas políticas de plantão e suas regras são executadas e as pessoas de plantão são avisadas. Ele fica fora das páginas de status até alguém da resposta publicá-lo. |
| **Manutenção programada** | Pedidos de mudança e de manutenção | Um evento de manutenção é programado para a janela que quem envia pede. Salvo indicação contrária do formulário, ele fica fora das páginas de status e não avisa nenhum assinante. |

Os formulários começam com esses dois, e mais tipos de registro virão.

## Antes de começar

- **Um plano que inclua formulários.** No OneUptime Cloud, os formulários exigem o plano **Growth** ou superior. Veja [Plano](#plano).
- **Permissão para criar formulários.** **Create Form** pertence aos proprietários e administradores do projeto, e às funções a que você a der. Veja [Permissões](#permissões).
- **Num formulário de incidentes, uma severidade.** Todo incidente precisa de uma: de uma pergunta, das configurações do formulário ou do modelo de incidente dele. Sem ela, todo envio é recusado. Veja [O que um envio cria](/docs/forms/on-submit#how-a-submission-becomes-an-incident).

## Criar seu primeiro formulário

:::steps
### Criar o formulário

Abra **Formulários** no menu de produtos e clique em **Criar formulário**. Dê um nome ao formulário (o título da página pública, único no projeto), escolha o que **Cada envio cria** e, se quiser, uma descrição em Markdown, mostrada no topo da página pública.

### Montar as perguntas

O formulário abre na página **Construir**, já perguntando um título, uma descrição e quem está enviando (e, num formulário de manutenção, quando a manutenção começa e termina). Adicione, remova e reordene perguntas e depois clique em **Salvar alterações**. Veja [Criar um formulário](/docs/forms/building).

### Decidir o que um envio cria

Em **Ao enviar**, confira como um envio vira um incidente ou evento e clique em **Editar definições** para dar valores padrão: uma severidade, um modelo de incidente, monitores e rótulos para anexar sempre, proprietários a avisar. Veja [O que um envio cria](/docs/forms/on-submit).

### Adicionar modelos se as pessoas relatam os mesmos casos

Em **Modelos**, salve um modelo para cada caso relatado com frequência: o formulário os lista acima das perguntas, se preenche a partir do escolhido e faz as perguntas como esse modelo manda; uma pergunta que um caso precisa pode ser obrigatória no modelo dele e oculta nos outros. Veja [Modelos](/docs/forms/building#templates).

### Compartilhar o link

Em **Partilhar**, copie o link e envie para as pessoas que devem usar o formulário. Veja [Partilha e segurança](/docs/forms/sharing-and-security).
:::

> [!IMPORTANT]
> Um formulário novo **Aceita envios** assim que é criado, mas ninguém consegue chegar a ele até você compartilhar o link. Configure antes as perguntas e as proteções.

## As páginas de um formulário

| Página | O que contém |
| --- | --- |
| **Construir** | O nome e a descrição do formulário, a **Marca** dele (logotipo e favicon, recolhidos) e o editor: as perguntas, a paleta de perguntas e **Pré-visualização**. |
| **Modelos** | Conjuntos de respostas com nome a partir dos quais se pode começar o formulário, como cada um faz as perguntas, aquele com que o formulário abre e o link próprio de cada um. |
| **Ao enviar** | O que cada envio cria e como cada campo dele é preenchido. **Editar definições** muda os valores padrão e o que sempre vale. |
| **Partilhar** | **Aceita envios**, o **Link de compartilhamento**, a mensagem mostrada depois do envio e a **Lista de IPs permitidos**. |
| **Envios** | Cada envio feito pelo formulário, o mais recente primeiro, com as respostas e o que ele criou. |
| **Duplicar formulário** | Em **Avançado**: uma cópia do formulário, com nome dado para você, com as perguntas, os modelos, as configurações de Ao enviar, a marca, a mensagem de agradecimento e a lista de IPs permitidos, e um link próprio. A cópia começa desligada e abre no editor. |
| **Eliminar formulário** | A exclusão do formulário, em **Avançado**. Os envios são excluídos junto; os incidentes e eventos que ele criou, não. |

A seção **Desenvolvedores** do menu do formulário contém as páginas de Terraform, API e assistente de IA dele, como em qualquer outro recurso.

## Formulários e modelos de incidente

Um modelo e um formulário evitam que você digite o mesmo incidente duas vezes, mas atendem pessoas diferentes:

| | Modelo de incidente | Formulário |
| --- | --- | --- |
| Quem usa | Sua equipe, com login no OneUptime | Qualquer pessoa com o link, sem conta |
| Onde | **Criar a partir de modelo** na lista de incidentes | Uma página própria, no link do formulário |
| O que dá para mudar | Cada campo do incidente, antes de declará-lo | Só as respostas às perguntas que você escolheu |
| O que se vê | Seus monitores, políticas, proprietários e cada campo | O nome, a descrição e as perguntas do formulário, e só as opções que você escolheu oferecer |
| Páginas de status | O que disserem o modelo e o formulário de declaração | Oculto até alguém da resposta publicar o incidente |

Eles funcionam juntos. Dê a um formulário de incidentes um **Incidente Modelo** na página **Ao enviar** dele, e cada incidente que ele declara é declarado a partir desse modelo: monte o modelo com o que sua equipe precisa no incidente, e o formulário com o que você quer perguntar a quem envia.

## Envios

A página **Envios** de um formulário lista cada envio feito por ele, o mais recente primeiro, com **Enviado em**, **Enviado por** (o nome e o e-mail que quem envia informou, ou **Anónimo**) e **Criado**, um link para o incidente ou evento criado. **Ver respostas** mostra cada resposta como quem envia a deu. **Formulários → Envios** lista os envios de todos os formulários do projeto.

Os envios são escritos pelo formulário, nunca à mão, e não podem ser editados. Excluir um envio tira da lista as respostas e o nome e o e-mail de quem enviou; o incidente ou evento criado fica, assim como a nota privada nele, que repete os dados de quem enviou e as respostas. Quando o incidente ou o evento é excluído, o envio fica, e a coluna **Criado** dele mostra **Eliminado entretanto**.

> [!WARNING]
> Ao remover os dados pessoais de alguém, excluir o envio não basta: edite ou exclua também a nota privada no incidente ou evento que ele criou.

## Permissões

Os formulários deixam pessoas de fora da sua equipe criar incidentes e eventos de manutenção no seu projeto, por isso são gerenciados pelos proprietários e administradores do projeto, e pelas funções a que você der as permissões **Form**. Elas ficam no grupo **Form** da [Referência de permissões](/docs/permissions/reference):

| Permissão | O que permite | Quem tem por padrão |
| --- | --- | --- |
| **Create Form** | Criar formulários e duplicá-los. | Project Owner, Project Admin |
| **Edit Form** | Mudar um formulário: as perguntas, a marca, os modelos, as configurações de Ao enviar, **Aceita envios**, o link e a **Lista de IPs permitidos**. | Project Owner, Project Admin |
| **Delete Form** | Excluir um formulário e, com ele, os envios. | Project Owner, Project Admin |
| **Read Form** | Ver os formulários, as perguntas, as configurações e os links. | Os acima, mais Project Member, Viewer e as funções de incidentes e de manutenção programada |
| **Read Form Submission** | Ver os envios e as respostas. | Project Owner, Project Admin |
| **Delete Form Submission** | Excluir envios. | Project Owner, Project Admin |

Os envios contêm o que desconhecidos digitaram (nomes, endereços de e-mail e respostas que talvez nunca cheguem ao registro), então só os proprietários e administradores do projeto os veem, a menos que você conceda **Read Form Submission**. Quem pode ler um formulário pode ver e compartilhar o link dele. Enviar um formulário não exige permissão nenhuma. Para saber como funções e permissões granulares se combinam, veja [Usuários, equipes e permissões](/docs/permissions/index).

## Plano

No OneUptime Cloud, os formulários exigem o plano **Growth** ou superior, e a **Lista de IPs permitidos** de um formulário exige **Scale**, seja definida ao criar o formulário ou editada depois. Os links de um projeto abaixo do plano **Growth**, ou com a assinatura não paga, mostram a mensagem de indisponível, e nada é criado.

## Formulários pela API

Os formulários são um recurso comum da API em `/api/form`, e os envios em `/api/form-submission`, que você pode ler e excluir, mas não criar nem editar. A [referência da API](/reference) traz o formato completo das solicitações e respostas.

### Perguntas e configurações

As perguntas de um formulário são a coluna `fields` dele, uma lista JSON na ordem em que o formulário as faz, e as configurações de Ao enviar são os `targetSettings`:

```json
{
  "data": {
    "targetType": "Incident",
    "fields": [
      {
        "id": "what",
        "source": "TargetField",
        "targetField": "title",
        "label": "What is wrong?",
        "isRequired": true
      },
      {
        "id": "office",
        "source": "Question",
        "type": "Dropdown",
        "label": "Which office are you in?",
        "dropdownOptions": "Berlin\nLondon",
        "isRequired": false
      },
      {
        "id": "email",
        "source": "Submitter",
        "submitterField": "Email",
        "label": "Your Email",
        "isRequired": true
      }
    ],
    "targetSettings": {
      "incidentSeverityId": "<severity-id>",
      "labelIds": ["<label-id>"]
    }
  }
}
```

Cada pergunta tem um `id` próprio (letras, dígitos, `-` e `_`), uma `source`, um `label` e, opcionalmente, `helpText` e `isRequired`:

| `source` | O que pergunta |
| --- | --- |
| `Question` | Uma pergunta própria do formulário, respondida conforme o `type`: `Text`, `LongText`, `Markdown`, `Number`, `Dropdown`, `MultiSelectDropdown`, `Boolean`, `Date` ou `DateTime`. Uma lista suspensa lista as `dropdownOptions` dela, uma por linha. |
| `TargetField` | Um campo do que o formulário cria, indicado por `targetField`: `title`, `description`, `incidentSeverityId`, `monitors`, `labels` e `impactStartedAt` para um incidente; `title`, `description`, `startsAt`, `endsAt`, `monitors`, `statusPages` e `labels` para um evento de manutenção. Um campo respondido por escolha lista os registros que oferece em `allowedOptionIds`. |
| `TargetCustomField` | Um dos campos personalizados do incidente ou do evento, indicado por `customFieldId`. |
| `Submitter` | O `Name` ou o `Email` de quem envia, indicado por `submitterField`. |

Uma pergunta com `isHidden` como `true` não aparece na página pública, nunca é obrigatória e só é respondida a partir do modelo que um envio indica, a menos que esse modelo a faça. `isRequired` e `isHidden` são o padrão do formulário; cada modelo pode fazer uma pergunta do seu jeito.

### Modelos na API

Os modelos de um formulário são a coluna `templates` dele, uma lista JSON na ordem em que o formulário os lista. Cada modelo tem um `id` próprio (letras, dígitos, `-` e `_`), um `name` de até 100 caracteres, único no formulário, e `answers` indexadas pelo id da pergunta, cada uma como um envio a manda: texto, um número, `true` ou `false`, o valor de uma opção ou uma lista de valores numa seleção múltipla. `isDefault` como `true` faz dele o modelo com que o formulário abre; um formulário tem no máximo um, e até 50 modelos.

`fieldSettings`, também indexado pelo id da pergunta, diz como o modelo faz uma pergunta: `Required`, `Optional` ou `Hidden`. Uma pergunta que ele não lista (ou lista como `null`) é feita como o formulário a faz, e as perguntas `startsAt` e `endsAt` de um evento de manutenção só podem ser `Required`:

```json
{
  "data": {
    "templates": [
      {
        "id": "outage",
        "name": "Application Outage",
        "isDefault": true,
        "answers": {
          "what": "The application is down",
          "office": "Berlin"
        },
        "fieldSettings": {
          "office": "Required",
          "email": "Optional"
        }
      }
    ]
  }
}
```

As perguntas, os modelos e as configurações são verificados sempre que são salvos (pelo dashboard, pela API, pelo Terraform ou por um workflow), e uma lista que viola uma regra é recusada com uma mensagem que diz o que está errado. `shareKey`, a chave no link do formulário, é definida pelo OneUptime quando o formulário é criado, e mudá-la é o que **Redefinir link** faz.

### Marca na API

A marca de um formulário são os `logoFileId`, `logoAltText` e `faviconFileId` dele. Envie primeiro a imagem com `POST /api/file`, no projeto do formulário (com uma chave de API desse projeto, ou com login como membro dele e o id dele no cabeçalho `tenantid`), mandando o `name`, o `fileType`, como `image/png`, e os bytes em base64 em `file`, e defina o `_id` devolvido. Um envio para um projeto do qual você não é membro é recusado com "You can upload files only to a project you are a member of." Todo envio é privado: `isPublic` é definido pelo OneUptime, diga a solicitação o que disser. Cada imagem é verificada quando o formulário é salvo: precisa ter sido enviada no projeto do formulário, e um logotipo precisa ser uma imagem PNG, JPEG, GIF, WebP ou SVG de até 512 KB, e um favicon uma dessas ou um ICO de até 128 KB. Defina um id como `null` para voltar aos do OneUptime. Veja [Marca](/docs/forms/building#branding).

### Ler os envios

Para listar os envios de um formulário:

```bash
curl -X POST https://oneuptime.com/api/form-submission/get-list \
  -H "apikey: $ONEUPTIME_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{
    "query": { "formId": "<form-id>" },
    "select": { "submitterName": true, "submitterEmail": true, "answers": true, "incidentId": true, "scheduledMaintenanceId": true, "createdAt": true },
    "limit": 50,
    "skip": 0
  }'
```

### Workflows

Os formulários têm os componentes de workflow gerados: **On Create Form**, **On Update Form** e assim por diante. Para agir sobre o que um formulário criou, use **On Create Incident** ou **On Create Scheduled Maintenance**.

### Os endpoints próprios da página pública

A página pública conversa com duas rotas que não exigem chave de API: `GET /api/form/public/<shareKey>`, que devolve o nome, a descrição e as perguntas do formulário (e o logotipo, o texto alternativo do logotipo e o favicon, as imagens em base64, quando os tem, e os modelos, com as respostas deles às perguntas que a página faz), e `POST /api/form/public/<shareKey>/submit`, que envia o formulário, indicando em `templateId` o modelo a partir do qual quem envia começou. São os endpoints próprios da página, não uma API sobre a qual construir: cada chamada passa pelas proteções do formulário (veja [Partilha e segurança](/docs/forms/sharing-and-security)) e eles mudam junto com a página. Para criar incidentes a partir do seu próprio código, use `POST /api/incident` com uma chave de API: veja [Declarar um incidente](/docs/incidents/declaring-incidents).

## Para onde foram seus formulários de incidente

Os formulários substituem os **Incident Forms** que ficavam em **Incidentes → Configurações → Formulários**. Cada formulário de incidente foi transferido na atualização, com o mesmo link e os mesmos envios:

- As perguntas dele viraram as do editor: o título, a descrição se não estava oculta, a severidade quando quem enviava podia escolhê-la, cada campo personalizado que ele pedia (na ordem dos campos personalizados) e **Your Name** e **Your Email**, obrigatórios a menos que o formulário permitisse relatos anônimos.
- A severidade e o modelo de incidente dele viraram os valores padrão de **Ao enviar**.
- O interruptor **Habilitado**, a mensagem de sucesso e a **Lista de IPs permitidos** dele não mudaram, nem o link: os links antigos `/accounts/incident-form/<share-key>` abrem o formulário no novo endereço.
- As permissões **Incident Form** viraram as permissões **Form**, para cada equipe e chave de API que as tinha.

As páginas antigas do dashboard redirecionam para as novas.

## Próximos passos

:::cards
- [Criar um formulário](/docs/forms/building): Perguntas, tipos de resposta, campos vinculados, campos personalizados e a pré-visualização.
- [O que um envio cria](/docs/forms/on-submit): Como as respostas e as configurações de Ao enviar viram um incidente ou um evento de manutenção.
- [Partilha e segurança](/docs/forms/sharing-and-security): O link, a lista de IPs permitidos, os limites de taxa, o captcha e a solução de problemas.
- [Declarar um incidente](/docs/incidents/declaring-incidents): As outras formas de declarar incidentes.
:::
