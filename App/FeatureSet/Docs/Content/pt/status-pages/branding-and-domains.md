# Marca e domínios personalizados

A página de status é a única superfície do OneUptime que seus clientes realmente olham, então ela deveria parecer sua e viver no seu próprio domínio. As duas coisas são configuradas na seção **Marca** do menu lateral da página de status, mais uma configuração escondida nas **Configurações avançadas**.

O que você precisa saber antes de começar: a marca está espalhada por sete telas separadas, e a divisão nem sempre é onde você imaginaria. O logotipo e a imagem de capa não estão em **Marca essencial** — estão em **Cabeçalho**. O favicon está em **Marca essencial**. As cores estão em **Página de visão geral**. Todo o resto que você chamaria de "tema" é CSS personalizado.

Esta página percorre cada tela na ordem e depois leva você pela sequência completa de CNAME e SSL para colocar a página em `status.suaempresa.com`.

## Onde fica cada controle de marca

Abra uma página de status: a seção **Marca** do menu lateral tem sete itens. Aqui está o mapa, para você parar de caçar.

| Tela                       | O que você define ali                                                                         |
| -------------------------- | ------------------------------------------------------------------------------------------ |
| **Marca essencial**     | Título da página, descrição da página, indexação por buscadores, favicon.                             |
| **Cabeçalho**                 | Logotipo, imagem de capa, seus textos alternativos e a barra de links do cabeçalho.                                |
| **Rodapé**                 | Linha de direitos autorais e a barra de links do rodapé.                                                    |
| **Página de visão geral**          | Descrição da visão geral, cores das barras do gráfico de histórico, status de indisponibilidade, percentual geral de disponibilidade. |
| **HTML, CSS e JavaScript** | HTML do cabeçalho, HTML do rodapé, CSS personalizado, JavaScript personalizado.                                   |
| **Domínios personalizados**         | Seu próprio domínio, verificação de CNAME e SSL.                                            |
| **Idiomas**              | Idioma padrão e os idiomas oferecidos no seletor do rodapé.                         |

## Marca essencial

**Páginas de status → sua página → Marca → Marca essencial** (`{id}/branding`) tem três cartões.

- **Título e descrição** — o cartão observa que isso também é usado para SEO. **Editar** abre **Título da página** (placeholder `Please enter page title here.`) e **Descrição da página**. É o que os buscadores e as prévias de link mostram, então escreva pensando no cliente, não na sua equipe.
- **Search Engine Indexing** — uma única chave, **Allow Search Engines to Index this Status Page**, descrita no produto como quem controla se o Google e o Bing podem listar a página nos resultados. Vem ativada por padrão. Desative e a página passa a ser servida com `noindex, nofollow`.
- **Favicon** — **Edit Favicon** abre o upload de imagem do **Favicon**. É o iconezinho da aba do navegador.

Use quando: a página for só interna ou ainda estiver sendo montada. Desative **Allow Search Engines to Index this Status Page** para que uma página pela metade não comece a ranquear com o nome da sua marca.

## A tela Cabeçalho

**Páginas de status → sua página → Marca → Cabeçalho** (`{id}/header-style`). Apesar do nome no menu lateral, é aqui que ficam os seus dois maiores ativos de marca.

O primeiro cartão se chama **Logotipo, Capa e Favicon** e tem um botão **Edit Images**:

- **Logotipo** — upload de imagem, placeholder `Upload logo`.
- **Logo Alt Text** — placeholder `Logo of My Company`. Se você deixar em branco, o título da página de status é usado no lugar.
- **Capa** — upload de imagem, placeholder `Upload cover image`. É o banner largo atrás do cabeçalho.
- **Cover Image Alt Text** — a mesma ideia para a capa.

Abaixo dele há uma tabela **Links do Cabeçalho** ("Header Links for your status page"). Cada link tem um **Título** e um **Link** (uma URL, placeholder `https://link.com`), e as linhas são reordenadas por arrasto. Sem nenhum configurado, a tabela diz "No status header link for this status page."

Bom para: levar os visitantes de volta ao seu site de marketing, à sua documentação ou a um portal de suporte sem que precisem adivinhar a URL.

## A tela Rodapé

**Páginas de status → sua página → Marca → Rodapé** (`{id}/footer-style`) tem o mesmo formato do **Cabeçalho**: um cartão e uma tabela.

- **Informações de direitos autorais** — **Edit Copyright** abre um único campo, **Informações de direitos autorais**, com o placeholder `Acme, Inc.`.
- **Links do rodapé** — o mesmo par **Título** e **Link**, ordenado por arrasto, com a mensagem de vazio "No status footer link for this status page."

Links jurídicos, de privacidade e de termos pertencem aqui. Links de cabeçalho são para navegação; links de rodapé são para as letras miúdas.

## Marca da página de visão geral

**Páginas de status → sua página → Marca → Página de visão geral** (`{id}/overview-page-branding`) é a única tela em que há cores configuráveis, e é ela também que decide o que significa "fora do ar" no gráfico.

- **Página de visão geral** — **Edit Branding** abre um campo markdown, **Descrição da página de visão geral.**, que é renderizado acima da lista de recursos. Use para uma frase de contexto: o que esta página cobre e para onde ir em busca de suporte.
- **Rules for Bar Colors of History Chart** — uma tabela ordenada e reordenável por arrasto. Cada regra tem **Quando a % de tempo de atividade for maior ou igual a** e **Então, use esta cor de barra**; as colunas da tabela aparecem como `When Uptime Percent >=` e `Then, Bar Color is`. A ordem importa, então organize as regras na sequência em que quer que sejam avaliadas.
- **Status de monitor de indisponibilidade** — **Edit Statuses** abre uma seleção múltipla descrita como "These monitor statuses are considered as down". É assim que você decide se, por exemplo, um status degradado conta contra a disponibilidade nesta página.
- **Cor Padrão da Barra do Gráfico de Histórico** — **Edit Default Bar Color** abre o seletor **Cor Padrão da Barra**, a cor usada quando nenhuma regra corresponde.
- **Porcentagem de tempo de atividade geral** — **Edit Settings** abre a chave **Mostrar percentual geral de tempo de atividade** e um menu **Selecionar Precisão de Disponibilidade**, que vem com duas casas decimais por padrão (`99.99% (Two Decimal)`).

**Quantos dias o gráfico cobre não se define aqui.** Isso é **Mostrar histórico de tempo de atividade (em dias)**, em **Páginas de status → sua página → Avançado → Configurações avançadas** (`{id}/settings`), válido de 1 a 90.

## HTML, CSS e JavaScript personalizados

**Páginas de status → sua página → Marca → HTML, CSS e JavaScript** (`{id}/custom-code`) tem quatro cartões editáveis de forma independente, apoiados nas colunas `headerHTML`, `footerHTML`, `customCSS` e `customJavaScript` da página de status:

> O HTML, CSS e JavaScript personalizados ativos só são servidos em um domínio personalizado verificado. Eles ficam desativados na URL padrão `/status-page/:id` porque ela compartilha a mesma origem da área autenticada do OneUptime.

- **HTML do Cabeçalho** — placeholder `Insert Custom HTML here.`, injetado no cabeçalho da página.
- **HTML do rodapé** — o mesmo, para o rodapé.
- **CSS Personalizado** — placeholder `Insert Custom CSS here.`
- **JavaScript Personalizado** — placeholder `Insert Custom JavaScript here.`

**Não existe seletor de tema.** As páginas de status do OneUptime não têm configuração de tema nem de cor de marca: os únicos controles de cor embutidos em qualquer lugar são a **Cor Padrão da Barra** e as regras de cor das barras do gráfico de histórico, na tela **Página de visão geral**. Fontes, cores de fundo, cores de destaque e ajustes de layout passam todos pelo **CSS Personalizado** daqui. Se você andava procurando um campo de "cor da marca", esta é a resposta — ele não existe, e esta caixa é a saída de emergência.

> O JavaScript personalizado roda no navegador dos seus visitantes, numa página que as pessoas abrem justamente quando estão preocupadas que algo esteja quebrado. Mantenha-o pequeno, hospede-o você mesmo sempre que possível e teste antes de depender dele.

## Configurações de idioma

**Páginas de status → sua página → Marca → Idiomas** (`{id}/languages`) tem dois cartões, e ambos tratam do seletor de idioma que os visitantes veem no rodapé da página.

- **Idioma Padrão** — **Edit Default Language** abre um menu que lista cada idioma suportado pelo nome nativo e pelo nome em inglês (`Deutsch (German)`). O cartão o descreve como o idioma que os visitantes de primeira viagem veem; eles sempre podem trocar pelo rodapé. O padrão é inglês.
- **Idiomas habilitados** — **Edit Enabled Languages** abre uma seleção múltipla, placeholder `All languages`. Deixe vazio e todos os idiomas suportados são oferecidos. Escolha alguns e o seletor do rodapé lista apenas esses.

O OneUptime vem com dezesseis idiomas: inglês, alemão, francês, espanhol, italiano, português, holandês, dinamarquês, norueguês, sueco, russo, japonês, coreano, chinês (simplificado), chinês (tradicional) e híndi.

## Domínios personalizados

Por padrão, uma página de status fica acessível na URL de prévia mostrada na tela **Visão geral** dela. Para colocá-la em um nome de host seu, vá a **Páginas de status → sua página → Marca → Domínios personalizados** (`{id}/domains`).

O cartão se chama **Domínios personalizados** e sua descrição enuncia o requisito sem rodeios: adicione o registro CNAME de página de status da sua instalação como CNAME desses domínios para que isso funcione. Sem nada configurado, a tabela diz "No custom domains found." A tabela tem duas colunas, **Domínio** e **Status**, e filtros por **Domínio**, **CNAME válido** e **SSL provisionado**.

### Antes de começar

Dois pré-requisitos, e pular qualquer um deles é o motivo de sempre para isso não funcionar:

- **O domínio pai precisa já estar verificado.** O menu **Domínio** só lista domínios verificados nas configurações do projeto — o próprio texto de ajuda do campo aponta para **Mais → Configurações do projeto → Domínios personalizados** para você adicionar um antes.
- **A instalação precisa ter um registro CNAME de página de status configurado.** Em implantações auto-hospedadas, isso é a variável de ambiente `STATUS_PAGE_CNAME_RECORD` no Docker Compose, ou `statusPage.cnameRecord` no `values.yaml` do Helm. Sem ele, os modais **Adicionar CNAME** e **Solicitar SSL gratuito** mostram a mensagem "Custom Domains not enabled for this OneUptime installation" em vez das instruções.

### Adicionar o domínio

Clique em **Create Status Page Domain**. O modal (**Create New Status Page Domain**) tem dois passos:

**Básico**

- **Subdomínio** — apenas o rótulo, placeholder `status (leave blank for root)`. Digite só `status`, não o nome de host inteiro. Deixe em branco ou digite `@` para usar o domínio raiz.
- **Domínio** — um menu com os domínios verificados, placeholder `Select domain`.

**Mais**

- **Carregar Certificado Personalizado** — uma chave, desativada por padrão. Deixe desativada e o OneUptime solicita um certificado gratuito para você. Ative e aparecem os campos **Certificado** e **Chave privada do certificado** para o seu próprio material PEM.

## Verificar o CNAME

Enquanto o domínio não está verificado, a linha mostra uma ação **Adicionar CNAME**. Ela abre um modal chamado **Adicionar CNAME** que entrega exatamente o que colar no seu provedor de DNS:

- **Tipo de Registro** — `CNAME`
- **Nome** — o domínio completo que você acabou de criar, por exemplo `status.suaempresa.com`
- **Conteúdo** — o registro CNAME de página de status da sua instalação

O modal avisa que, uma vez publicado o registro, a verificação automática pode levar até 24 horas. Você não precisa esperar tudo isso: o botão de envio do modal é **Verificar CNAME**, que checa o registro na hora.

Crie o registro DNS primeiro e só então clique em **Verificar CNAME**. Clicar antes de o registro existir simplesmente falha.

## Solicitar um certificado SSL

Depois que o CNAME está verificado — e só se você não tiver enviado seu próprio certificado — uma ação **Solicitar SSL gratuito** aparece na linha. Seu modal, **Order Free SSL Certificate for this Status Page**, explica que o OneUptime usa o LetsEncrypt, que o processo é seguro e gratuito e que o provisionamento leva algumas horas depois do pedido. O botão de envio é **Solicitar SSL gratuito**.

**Os prazos informados não batem entre as telas**, então não leve nenhum número ao pé da letra: o modal do pedido fala em três horas, a coluna **Status** fala em uma hora, e um certificado personalizado fala em trinta minutos. Trate todos como "volte mais tarde hoje" e procure o suporte se nada tiver acontecido até lá.

Uma vez provisionado, a renovação é automática. Não sobra nada recorrente para você fazer.

## Ler a coluna Status do domínio

A coluna **Status** é toda a máquina de estados da configuração em uma célula só. Cada mensagem diz o que fazer em seguida ou avisa que está tudo pronto.

| O que a coluna Status diz                           | O que significa                                                                     |
| ----------------------------------------------------- | --------------------------------------------------------------------------------- |
| Action Required: Please add your CNAME record.        | O CNAME ainda não foi verificado. Publique o registro e clique em **Verificar CNAME**.             |
| Action Required: Please order SSL certificate.        | O CNAME está verificado, mas não há certificado pedido. Clique em **Solicitar SSL gratuito**.       |
| No action is required, allow 30 minutes to provision. | Você enviou um certificado personalizado e ele está sendo instalado.                      |
| No action is required, this will be provisioned soon. | O certificado gratuito foi pedido e está a caminho. Fale com o suporte se ele nunca chegar. |
| Certificate Provisioned. No action required.          | Pronto. O OneUptime renova o certificado automaticamente.                                     |

Se uma linha ficar parada em "Action Required: Please add your CNAME record." muito depois de você ter criado a entrada de DNS, confira se o nome do registro é o domínio completo e se o conteúdo dele bate exatamente com o registro CNAME da sua instalação.

## Powered by OneUptime

A linha "Powered by OneUptime" não é uma configuração da seção de marca. Ela fica em **Páginas de status → sua página → Avançado → Configurações avançadas** (`{id}/settings`), no cartão **Marca "Powered By OneUptime"**, como uma única chave: **Ocultar a marca Powered By OneUptime**. **Edit Settings** a abre, como em todos os outros cartões daquela tela.

## Onde ler a seguir

- [Visão geral das páginas de status](/docs/status-pages/index) — o que é uma página de status e como as peças se encaixam.
- [Recursos e grupos da página de status](/docs/status-pages/resources-and-groups) — escolher o que os visitantes de fato veem na página.
- [Assinantes e comunicados](/docs/status-pages/subscribers) — assinantes por e-mail, SMS, Slack e webhook, além dos comunicados.
- [API pública](/docs/status-pages/public-api) — ler os dados da página de status de forma programática.
- [Estados e severidades de incidentes](/docs/incidents/states-and-severities) — o que faz um incidente aparecer na página e sumir dela.
