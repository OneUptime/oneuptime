# Partilha e segurança

Um formulário está aberto a qualquer pessoa que tenha o link dele, e cada envio pode acionar a sua equipe de plantão ou colocar uma janela de manutenção no seu calendário. Esta página trata da página **Partilhar** do formulário — o link, desativar o formulário, a mensagem depois do envio e a lista de IPs permitidos — e de todas as outras verificações pelas quais uma solicitação passa no caminho.

:::cards
- [Partilhar o link](#partilhar-o-link): Copie-o, abra-o e redefina-o quando ele se espalhar demais.
- [Um link para cada modelo](#um-link-para-cada-modelo): Um favorito por caso, um único formulário por trás de todos.
- [O que protege um formulário](#o-que-protege-um-formulário): Cada verificação pela qual uma solicitação passa, em ordem.
- [Solução de problemas](#solução-de-problemas): O que cada mensagem na página do formulário significa, e o que fazer.
:::

## A página Partilhar

| Cartão | O que ele contém |
| --- | --- |
| **Status** | **Aceita envios** — se o link do formulário funciona. |
| **Link de compartilhamento** | O link, com **Copiar link**, **Abrir formulário** e **Redefinir link**. |
| **Depois de enviar** | A **Mensagem de agradecimento** que as pessoas veem depois de enviar, abaixo do número do que o formulário criou. |
| **Acesso** | A **Lista de IPs permitidos**. |

## Partilhar o link

O cartão **Link de compartilhamento** mostra o link do formulário, como `https://oneuptime.com/accounts/form/<share-key>`:

- **Copiar link** o copia.
- **Abrir formulário** abre o formulário em uma nova aba, do jeito que as pessoas o veem.
- **Redefinir link** dá ao formulário um novo link, depois que você confirma. O link antigo para de funcionar na hora e mostra a mensagem de indisponível, então todos com quem você o partilhou precisam do novo. Use-o quando um link se espalhou mais do que devia.

Qualquer pessoa com o link pode abrir o formulário e enviá-lo, sem uma conta do OneUptime e sem fazer login. Estar com a sessão iniciada não muda nada: o OneUptime só sabe quem enviou pelo nome e pelo e-mail digitados no formulário. Então trate o link como um número de telefone da sua equipe de plantão. Partilhe-o onde as pessoas que devem usá-lo vão encontrá-lo — uma página da intranet, um runbook de suporte, uma mensagem fixada em um chat — e não em um site público, a menos que você queira envios de qualquer pessoa.

O link traz uma chave aleatória própria, não o ID do formulário. Em uma instalação auto-hospedada, ele é servido pelo seu próprio host do OneUptime, e só funciona no endereço que `HTTP_PROTOCOL` e `HOST` configuram: aberto com outro nome do servidor, ou pelo endereço IP dele, as solicitações do formulário são recusadas como vindas de outro site.

Links para os antigos formulários de incidente, `/accounts/incident-form/<share-key>`, abrem o mesmo formulário no novo endereço dele.

### Um link para cada modelo

Cada um dos [modelos](/docs/forms/building#modelos) do formulário tem um link próprio: o link do formulário com `?template=` e o id do modelo, como `https://oneuptime.com/accounts/form/<share-key>?template=<template-id>`. **Copiar link** na página **Modelos** do formulário o copia. Ele abre o formulário com esse modelo preenchido, então uma equipe pode salvar um favorito por caso enquanto você mantém um único formulário. Quando o remetente escolhe outro modelo, o endereço no navegador dele acompanha, então o link que ele copia é o formulário como ele o vê.

O link de um modelo é o link do formulário: funciona enquanto o formulário estiver em **Aceita envios**, e **Redefinir link** o retira junto com o resto. Um link que indica um modelo que você excluiu abre o formulário como se não indicasse nenhum — com o modelo padrão, se houver um.

### Desativar um formulário

Para parar de aceitar envios sem excluir o formulário, desative **Aceita envios**. O link passa a mostrar "Este formulário não está disponível. Ele pode ter sido desativado ou o link pode estar desatualizado.", e o cartão **Link de compartilhamento** lembra você de que o formulário está desativado. Ative-o de novo e o mesmo link volta a funcionar.

### A mensagem de agradecimento

Depois de um envio, a página diz "Obrigado — sua resposta foi enviada." e dá o número do que foi criado, e depois a sua **Mensagem de agradecimento**, em Markdown. Use-a para dizer o que acontece a seguir, e a quem recorrer quando algo for urgente. Sem ela, a página mostra só a mensagem padrão.

Uma imagem na descrição ou na mensagem de agradecimento do formulário é mostrada a todos que abrem o link enquanto o formulário estiver em **Aceita envios**. Desative o formulário, ou tire a imagem, e a imagem volta a ser privada, a menos que outra coisa que todos veem ainda a contenha.

## O que protege um formulário

```mermaid title="Abrir um formulário e enviá-lo"
sequenceDiagram
    participant V as Navegador do visitante
    participant O as OneUptime
    V->>O: Abrir o formulário, pela própria página dele
    O-->>V: Perguntas, modelos e marca
    V->>O: Enviar as respostas
    O->>O: Cada verificação abaixo, em ordem
    O-->>V: O número do que foi criado
```

Cada solicitação passa por estas verificações, nesta ordem:

1. A solicitação precisa vir da própria página do formulário, não de outro site — consulte [Solicitações de outros sites](#solicitações-de-outros-sites).
2. Ela precisa estar dentro dos limites de taxa.
3. O formulário precisa existir, estar em **Aceita envios** e pertencer a um projeto em um plano que inclua formulários.
4. Ela precisa vir de um endereço da **Lista de IPs permitidos**, quando o formulário tiver uma.
5. Um envio precisa passar pelo captcha, quando a instância tiver o captcha ativado.
6. Cada resposta precisa estar dentro dos limites de tamanho e se encaixar na pergunta — consulte [Criar um formulário](/docs/forms/building#limites-de-tamanho).
7. O que as respostas e as configurações formam precisa poder ser criado: um incidente precisa de uma gravidade, um evento de um fim depois do início.
8. Um envio precisa caber na cota por hora do formulário — consulte [Limites de taxa](#limites-de-taxa).

O logotipo e o favicon de um formulário fazem parte do formulário: eles são enviados dentro da resposta que o abre, em base64, só depois de ela passar pelas quatro primeiras verificações, e nunca a partir de um endereço próprio. Ninguém consegue obtê-los sem o formulário, e nenhum arquivo pode ser obtido pelo id dele por meio de um formulário; os próprios arquivos continuam privados. Um formulário só mostra imagens enviadas no próprio projeto dele: um arquivo de outro projeto é recusado quando o formulário é salvo, e nunca é enviado à página dele.

### Lista de IPs permitidos

Para limitar um formulário às suas próprias redes:

:::steps
1. Abra a página **Partilhar** do formulário.
2. No cartão **Acesso**, clique em **Editar lista de IPs permitidos**.
3. Informe uma rede por linha e salve. O cartão então as lista sob **Lista de IPs permitidos**.
:::

Cada linha é uma destas:

| Entrada | Exemplo | Observação |
| --- | --- | --- |
| Um endereço IPv4 | `203.0.113.7` | |
| Um endereço IPv6 | `2001:db8::7` | Corresponde não importa como esteja escrito, em maiúsculas ou com os zeros por extenso. |
| Um intervalo IPv4, em notação CIDR | `10.0.0.0/8` | Intervalos IPv6 não são suportados — liste cada endereço IPv6 em uma linha própria. |

Um endereço IPv4 precisa ser escrito como tal: escrito do jeito IPv6, como `::ffff:203.0.113.7`, ele é recusado. A lista é verificada sempre que é salva — pelo painel, pela API, pelo Terraform ou por um fluxo de trabalho —, e uma linha que nunca poderia corresponder é recusada com uma mensagem que a indica. Deixe a lista vazia para permitir todas as redes. Assim que ela tiver uma entrada, uma solicitação cujo endereço não possa ser determinado é recusada.

No OneUptime Cloud, definir a lista de IPs permitidos requer o plano **Scale** — tanto quando um formulário é criado com uma pela API como quando é editado —, assim como a lista de IPs permitidos de um [painel público](/docs/dashboards/sharing). Esvaziá-la funciona em todos os planos.

### Solicitações de outros sites

Um navegador diz a um servidor qual página enviou uma solicitação. Quando a página de outro site faz o navegador de um visitante abrir ou enviar um formulário, a solicitação é recusada com "This form can only be used from its own page." — antes que qualquer limite de taxa a conte, e seja qual for o link, então a resposta não diz nada sobre quais formulários existem.

Uma solicitação é recusada quando o cabeçalho `Sec-Fetch-Site` dela está presente e diz algo diferente de `same-origin` ou `none`, ou quando o cabeçalho `Origin` dela está presente e não é o seu endereço do OneUptime — `HTTP_PROTOCOL` e `HOST`, com a porta quando `HOST` tem uma. Um envio também precisa ser enviado como JSON (`application/json`); um enviado como campos de formulário de uma página web, ou como texto simples, é recusado com "The request must be a JSON object holding the form's answers in "data".". Ler um formulário também requer o cabeçalho que a página do formulário adiciona a cada solicitação que faz, `X-OneUptime-Form: 1`: uma página não consegue fazer um navegador adicionar um cabeçalho sem um script, e o script de outro site que adiciona um se denuncia pelo `Origin` dele.

### Limites de taxa

Abrir um formulário e enviá-lo são limitados por endereço de rede, e o envio também é limitado por formulário:

- **Abrir um formulário** — por formulário a partir de um endereço, e por endereço em todos os formulários, com folga para um escritório inteiro abrir o link ao mesmo tempo. Passando de qualquer um deles, a página mostra "Muitas solicitações. Tente novamente mais tarde." Se o limitador de taxa não puder ser alcançado, os formulários ainda abrem.
- **Enviar, por endereço** — por formulário a partir de um endereço, e por endereço em todos os formulários. Passando de qualquer um deles, o remetente vê "Muitos relatos enviados da sua rede. Aguarde alguns minutos e tente novamente." Todos atrás de um mesmo endereço — uma rede de escritório, um gateway de VPN — compartilham esses limites, e todo envio conta, mesmo um que depois é recusado por uma resposta errada.
- **Enviar, por formulário** — quantos registros um formulário pode criar em uma hora, de todos os endereços juntos, então mesmo envios de muitos endereços ao mesmo tempo só podem acionar você um número limitado de vezes por hora. Só conta um envio que passou por todas as outras verificações, logo antes de o registro dele ser criado. Passando desse limite, todos veem "Este formulário está recebendo envios demais no momento. Tente novamente mais tarde." até a janela acabar. **Redefinir link** começa o novo link com uma cota nova.

Todo limite responde `429` com um cabeçalho `Retry-After`, em segundos, e a página diz ao remetente quando tentar de novo. As janelas são fixas, não móveis. Se o limitador de taxa não puder ser alcançado, os envios são recusados em vez de passarem sem contagem: a API responde `503`, e o remetente vê "Não é possível aceitar envios no momento. Tente novamente em alguns minutos."

Em uma instalação auto-hospedada, estas variáveis de ambiente do app do OneUptime alteram os limites:

| Variável | Padrão | O que define |
| --- | --- | --- |
| `FORM_RATE_LIMIT_WINDOW_SECONDS` | `60` | A janela para abrir formulários, em segundos. |
| `FORM_RATE_LIMIT_PER_FORM_AND_IP_PER_WINDOW` | `120` | Quantas vezes um endereço pode abrir um formulário por janela. |
| `FORM_RATE_LIMIT_PER_IP_PER_WINDOW` | `600` | Quantas vezes um endereço pode abrir formulários por janela, em todos os formulários. |
| `FORM_SUBMIT_RATE_LIMIT_WINDOW_SECONDS` | `900` | A janela para os limites de envio por endereço, em segundos. |
| `FORM_SUBMIT_RATE_LIMIT_PER_FORM_AND_IP_PER_WINDOW` | `10` | Envios a um formulário a partir de um endereço por janela. |
| `FORM_SUBMIT_RATE_LIMIT_PER_IP_PER_WINDOW` | `30` | Envios a partir de um endereço por janela, em todos os formulários. |
| `FORM_SUBMIT_RATE_LIMIT_PER_FORM_WINDOW_SECONDS` | `3600` | A janela para o limite por formulário, em segundos. |
| `FORM_SUBMIT_RATE_LIMIT_PER_FORM_PER_WINDOW` | `60` | Registros que um formulário pode criar por janela, de todos os endereços juntos. |

Cada variável também lê o seu nome antigo, com `INCIDENT_FORM_` na frente em vez de `FORM_` — como `INCIDENT_FORM_SUBMIT_RATE_LIMIT_PER_FORM_PER_WINDOW` —, então uma instalação que ajustou os formulários de incidente mantém os seus limites; o novo nome prevalece quando os dois estão definidos. Nem o `config.env` nem os valores do chart do Helm os repassam: adicione-os você mesmo ao ambiente do contêiner `app` — com `app.extraEnv`, ou o `extraEnv` do chart inteiro, no chart do Helm, ou em um `docker-compose.override.yml` para o Docker Compose. `TRUSTED_PROXY_HOPS` decide qual endereço os limites por endereço contam.

### Captcha

Quando a sua instância do OneUptime tem o hCaptcha ativado, o formulário mostra um captcha, e um envio que não passou por ele é recusado. Não existe uma configuração por formulário. Uma instalação auto-hospedada ativa o captcha com `CAPTCHA_ENABLED`, `CAPTCHA_SITE_KEY` e `CAPTCHA_SECRET_KEY` — as mesmas configurações que protegem o cadastro. Sem ele, os limites de taxa e a lista de IPs permitidos seguram a carga.

## Solução de problemas

:::details O link diz que o formulário não está disponível
"Este formulário não está disponível. Ele pode ter sido desativado ou o link pode estar desatualizado." A página dá a mesma resposta seja qual for o motivo, então nunca diz a um desconhecido se um formulário existe:

- **Aceita envios** está desativado na página **Partilhar**.
- O link foi substituído com **Redefinir link**. Partilhe o novo.
- O formulário foi excluído.
- No OneUptime Cloud, o projeto está abaixo do plano **Growth**, ou a assinatura dele não foi paga.
- O link foi cortado quando foi copiado.
:::

:::details O formulário só pode ser aberto a partir de uma rede permitida
"Este formulário só pode ser aberto a partir de uma rede permitida." O endereço do remetente não está na **Lista de IPs permitidos** do formulário: adicione a rede dele, ou esvazie a lista. Em uma instalação auto-hospedada atrás de um proxy ou de um balanceador de carga, verifique o `TRUSTED_PROXY_HOPS` — quando ele está baixo demais, o OneUptime vê o endereço do seu proxy em vez do endereço do remetente. A página diz o mesmo quando o formulário foi aberto em um endereço diferente do do seu próprio OneUptime: abra o link exatamente como o cartão **Link de compartilhamento** o mostra.
:::

:::details Envios demais
"Muitos relatos enviados da sua rede. Aguarde alguns minutos e tente novamente." Todos atrás de um mesmo endereço compartilham os limites por endereço, o que importa durante uma grande queda, quando muitas pessoas relatam ao mesmo tempo. A página diz quando tentar de novo. "Este formulário está recebendo envios demais no momento. Tente novamente mais tarde." é, em vez disso, a cota por formulário: não tem a ver com a rede do remetente, e os relatos voltam a ser aceitos quando a janela acaba. Se os envios não forem genuínos porque o link se espalhou mais do que devia, **Redefinir link** interrompe o link antigo na hora.
:::

:::details Os envios não podem ser aceitos agora
"Não é possível aceitar envios no momento. Tente novamente em alguns minutos." O limitador de taxa não pôde ser alcançado, então os envios são recusados em vez de passarem sem contagem. Abrir o formulário continua funcionando. Em uma instalação auto-hospedada, verifique se o Valkey, o cache em que o limitador de taxa conta, está no ar e acessível a partir do app do OneUptime.
:::

:::details Este formulário não pode criar um incidente porque não tem gravidade
O formulário não pede uma gravidade, as configurações dele não indicam nenhuma — ou a que indicavam foi excluída — e o modelo de incidente dele também não define nenhuma. Escolha uma gravidade na página **Ao enviar** do formulário. Consulte [Sem gravidade, sem incidente](/docs/forms/on-submit#como-um-envio-se-torna-um-incidente).
:::

:::details Um envio é recusado
A mensagem diz o que está errado: falta uma resposta obrigatória ou ela só tem espaços, uma resposta é longa demais ou não se encaixa na pergunta, o endereço de e-mail não é um único endereço comum, ou uma janela de manutenção termina antes de começar. "A verificação do captcha falhou. Tente novamente." significa que o captcha não foi resolvido, ou expirou: resolva-o de novo. Em uma instalação auto-hospedada em que todo envio falha no captcha, verifique se `CAPTCHA_SITE_KEY` e `CAPTCHA_SECRET_KEY` estão ambos definidos.
:::

:::details Uma pergunta não está no formulário
O editor sinaliza as perguntas que deixa fora do formulário público — um campo personalizado que foi excluído, por exemplo —, e **Pré-visualização** diz quando deixa uma de fora. Consulte [Quando o editor sinaliza uma pergunta](/docs/forms/building#quando-o-editor-sinaliza-uma-pergunta). Uma pergunta com o selo **Oculto** fica de fora de propósito: só os modelos a respondem. Consulte [Perguntas ocultas](/docs/forms/building#perguntas-ocultas). Uma pergunta também pode estar no formulário para um modelo e fora dele para outro: cada modelo pode ocultar uma pergunta, ou fazer uma que o formulário oculta. Abra **Editar** do modelo e confira as **Perguntas** dele. Consulte [Como um modelo pergunta cada pergunta](/docs/forms/building#como-um-modelo-pergunta-cada-pergunta).
:::

:::details Um modelo não preenche uma pergunta
A resposta de um modelo só é usada enquanto ainda se encaixa na pergunta: uma opção que a pergunta ainda oferece, um registro que o formulário ainda oferece, um texto que não é longo demais. Edite o modelo, responda à pergunta de novo e salve-o. Consulte [Modelos](/docs/forms/building#modelos).
:::

:::details O incidente ou evento não está na página de status
É de propósito: os incidentes de um formulário são declarados ocultos, e os eventos de manutenção ficam ocultos a menos que as configurações de **Publicação** do formulário digam o contrário. Consulte [O que um envio cria](/docs/forms/on-submit).
:::

:::details Ninguém foi acionado
O incidente de um formulário executa as políticas de plantão que as configurações e o modelo dele indicam, e o que as suas regras de plantão adicionam, como qualquer outro incidente. Sem nenhuma delas, ninguém é acionado. Adicione uma política de plantão na página **Ao enviar** do formulário, ou escreva uma regra de plantão que corresponda aos incidentes dele — por um rótulo que o formulário sempre adiciona, por exemplo.
:::

## Próximos passos

:::cards
- [Visão geral dos formulários](/docs/forms/index): Para que servem os formulários, as permissões e a API.
- [Criar um formulário](/docs/forms/building): As perguntas, as perguntas ocultas e os modelos.
- [O que um envio cria](/docs/forms/on-submit): O incidente ou evento que cada envio cria.
:::
