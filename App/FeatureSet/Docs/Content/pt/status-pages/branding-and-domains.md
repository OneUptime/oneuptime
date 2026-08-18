# Marca e domínios personalizados

Uma página de status é a única superfície do OneUptime que seus clientes realmente olham, então ela deveria parecer sua e viver no seu próprio domínio. Ambas as coisas são configuradas a partir da seção **Marca** do menu lateral de uma página de status, mais uma configuração que se esconde em **Configurações avançadas**.

O que você precisa saber antes de começar: a marca está dividida em sete telas separadas, e a divisão nem sempre está onde você imaginaria. O logotipo e a imagem de capa não estão em **Marca essencial** — estão em **Cabeçalho**. O favicon está em **Marca essencial**. As cores estão em **Página de visão geral**. Tudo o mais que você pensaria como "tematização" é CSS Personalizado.

Esta página percorre cada tela por vez, e depois leva você pela sequência completa de CNAME e SSL para colocar a página em `status.yourcompany.com`.

## Onde fica cada controle de marca

Abra uma página de status, e a seção **Marca** do menu lateral tem sete itens. Aqui está o mapa, para você parar de caçar.

| Página                        | O que você define ali                                                                          |
| ----------------------------- | ----------------------------------------------------------------------------------------------- |
| **Marca essencial**           | Título da página, descrição da página, indexação por buscadores, favicon.                      |
| **Cabeçalho**                 | Logotipo, imagem de capa, seus textos alternativos e a barra de links do cabeçalho.             |
| **Rodapé**                    | Linha de direitos autorais e a barra de links do rodapé.                                        |
| **Página de visão geral**     | Descrição da visão geral, cores das barras do gráfico de histórico, status de indisponibilidade, percentual de disponibilidade geral. |
| **HTML, CSS e JavaScript**    | HTML do cabeçalho, HTML do rodapé, CSS personalizado, JavaScript personalizado.                |
| **Domínios personalizados**   | Seu próprio domínio, verificação de CNAME e SSL.                                                |
| **Idiomas**                   | Idioma padrão e os idiomas oferecidos no seletor do rodapé.                                     |

## Marca essencial

**Páginas de status → sua página → Marca → Marca essencial** (`{id}/branding`) contém três cartões.

- **Título e descrição** — o cartão observa que isso também é usado para SEO. **Editar** abre **Título da página** (placeholder `Please enter page title here.`) e **Descrição da página**. É isso que os buscadores e as prévias de link mostram, então escreva para um cliente, não para a sua equipe.
- **Search Engine Indexing** — uma única chave, **Allow Search Engines to Index this Status Page**, descrita no produto como controlar se o Google e o Bing podem listar a página em seus resultados. Ela vem ativada por padrão. Desative-a e a página é servida com `noindex, nofollow`.
- **Favicon** — **Edit Favicon** abre o upload de imagem **Favicon**. Este é o pequeno ícone na aba do navegador.

Use quando: a página é apenas interna ou ainda está sendo montada. Desative **Allow Search Engines to Index this Status Page** para que uma página pela metade não comece a ranquear pelo nome da sua marca.

## A tela do cabeçalho

**Páginas de status → sua página → Marca → Cabeçalho** (`{id}/header-style`). Apesar do nome no menu lateral, é aqui que ficam seus dois maiores ativos de marca.

O primeiro cartão é intitulado **Logotipo, Capa e Favicon**, com um botão **Edit Images**:

- **Logotipo** — upload de imagem, placeholder `Upload logo`.
- **Logo Alt Text** — placeholder `Logo of My Company`. Se você deixar em branco, o título da página de status é usado no lugar.
- **Capa** — upload de imagem, placeholder `Upload cover image`. Este é o banner largo atrás do cabeçalho.
- **Cover Image Alt Text** — a mesma ideia para a capa.

Abaixo dele há uma tabela **Links do Cabeçalho** ("Header Links for your status page"). Cada link tem um **Título** e um **Link** (uma URL, placeholder `https://link.com`), e as linhas são reordenadas arrastando. Sem nenhum configurado, a tabela diz "No status header link for this status page."

Bom para: apontar os visitantes de volta ao seu site de marketing, à sua documentação ou a um portal de suporte sem fazê-los adivinhar a URL.

## A tela do rodapé

**Páginas de status → sua página → Marca → Rodapé** (`{id}/footer-style`) tem o mesmo formato do **Cabeçalho**, um cartão e uma tabela.

- **Informações de direitos autorais** — **Edit Copyright** abre um único campo, **Informações de direitos autorais**, com o placeholder `Acme, Inc.`.
- **Links do rodapé** — o mesmo par **Título** mais **Link**, ordenado por arrasto, mensagem de vazio "No status footer link for this status page."

Links jurídicos, de privacidade e de termos pertencem aqui. Links de cabeçalho são para navegação; links de rodapé são para as letras miúdas.

## Marca da página de visão geral

**Páginas de status → sua página → Marca → Página de visão geral** (`{id}/overview-page-branding`) é a única tela em que as cores são configuráveis, e ela também decide o que "fora do ar" significa no gráfico.

- **Página de visão geral** — **Edit Branding** abre um campo markdown, **Descrição da página de visão geral.**, que é renderizado acima da lista de recursos. Use-o para uma frase de contexto: o que esta página cobre e para onde ir em busca de suporte.
- **Rules for Bar Colors of History Chart** — uma tabela ordenada e reordenável por arrasto de regras. Cada regra tem **Quando a % de tempo de atividade for maior ou igual a** e **Então, use esta cor de barra**; as colunas da tabela dizem `When Uptime Percent >=` e `Then, Bar Color is`. A ordem importa, então organize-as do jeito que você quer que sejam avaliadas.
- **Status de monitor de indisponibilidade** — **Edit Statuses** abre uma seleção múltipla descrita como "These monitor statuses are considered as down". É assim que você decide se, digamos, um status degradado conta contra a disponibilidade nesta página.
- **Cor Padrão da Barra do Gráfico de Histórico** — **Edit Default Bar Color** abre o seletor **Cor Padrão da Barra**, a cor usada quando nenhuma regra corresponde.
- **Porcentagem de tempo de atividade geral** — **Edit Settings** abre a chave **Mostrar percentual geral de tempo de atividade** e um menu **Selecionar Precisão de Disponibilidade**, que tem padrão de duas casas decimais (`99.99% (Two Decimal)`).

**Quantos dias o gráfico cobre não é definido aqui.** Isso é **Mostrar histórico de tempo de atividade (em dias)** em **Páginas de status → sua página → Avançado → Configurações avançadas** (`{id}/settings`), válido de 1 a 90.

## HTML, CSS e JavaScript personalizados

**Páginas de status → sua página → Marca → HTML, CSS e JavaScript** (`{id}/custom-code`) tem quatro cartões editáveis independentemente, sustentados pelas colunas `headerHTML`, `footerHTML`, `customCSS` e `customJavaScript` na página de status:

- **HTML do Cabeçalho** — placeholder `Insert Custom HTML here.`, injetado no cabeçalho da página.
- **HTML do rodapé** — o mesmo, para o rodapé.
- **CSS Personalizado** — placeholder `Insert Custom CSS here.`
- **JavaScript Personalizado** — placeholder `Insert Custom JavaScript here.`

**Não há um seletor de tema.** As páginas de status do OneUptime não têm configuração de tema ou de cor de marca: os únicos controles de cor embutidos em qualquer lugar são a **Cor Padrão da Barra** e as regras de cor de barra do gráfico de histórico na tela **Página de visão geral**. Fontes, cores de fundo, cores de destaque e ajustes de layout passam todos pelo **CSS Personalizado** aqui. Se você andava procurando um campo de "cor da marca", esta é a resposta — ele não existe, e esta caixa é a saída de emergência.

> JavaScript personalizado roda nos navegadores dos seus visitantes em uma página que as pessoas carregam precisamente quando estão preocupadas que algo esteja quebrado. Mantenha-o pequeno, mantenha-o auto-hospedado quando puder, e teste-o antes de depender dele.

## Configurações de idioma

**Páginas de status → sua página → Marca → Idiomas** (`{id}/languages`) tem dois cartões, e ambos são sobre o seletor de idioma que os visitantes recebem no rodapé da página.

- **Idioma Padrão** — **Edit Default Language** abre um menu listando cada idioma suportado pelo nome nativo e pelo nome em inglês (`Deutsch (German)`). O cartão o descreve como o idioma que visitantes de primeira viagem veem; os visitantes sempre podem trocar pelo rodapé. O padrão é inglês.
- **Idiomas habilitados** — **Edit Enabled Languages** abre uma seleção múltipla, placeholder `All languages`. Deixe vazia e todo idioma suportado é oferecido. Escolha alguns e o seletor do rodapé lista apenas esses.

Dezesseis idiomas acompanham o OneUptime: inglês, alemão, francês, espanhol, italiano, português, holandês, dinamarquês, norueguês, sueco, russo, japonês, coreano, chinês (simplificado), chinês (tradicional) e híndi.

## Domínios personalizados

Por padrão, uma página de status é acessível na URL de prévia exibida em sua tela **Visão geral**. Para colocá-la no seu próprio nome de host, vá a **Páginas de status → sua página → Marca → Domínios personalizados** (`{id}/domains`).

O cartão é intitulado **Domínios personalizados** e sua descrição explicita o requisito diretamente: adicione o registro CNAME de página de status da sua instalação como o CNAME desses domínios para que isso funcione. Sem nada configurado, a tabela diz "No custom domains found." A tabela tem duas colunas, **Domínio** e **Status**, e filtros para **Domínio**, **CNAME válido** e **SSL provisionado**.

### Antes de começar

Dois pré-requisitos, e pular qualquer um deles é o motivo habitual de isso não funcionar:

- **O domínio pai já precisa estar verificado.** O menu **Domínio** lista apenas domínios verificados das configurações do projeto — o texto de ajuda do próprio campo aponta para **Mais → Configurações do projeto → Domínios personalizados** para adicionar um antes.
- **A instalação precisa ter um registro CNAME de página de status configurado.** Em implantações auto-hospedadas isso é a variável de ambiente `STATUS_PAGE_CNAME_RECORD` no Docker Compose, ou `statusPage.cnameRecord` no `values.yaml` do Helm. Sem ele, tanto o modal **Adicionar CNAME** quanto o **Solicitar SSL gratuito** mostram uma mensagem "Custom Domains not enabled for this OneUptime installation" em vez de instruções.

### Adicionar o domínio

Clique em **Create Status Page Domain**. O modal (**Create New Status Page Domain**) tem duas etapas:

**Básico**

- **Subdomínio** — apenas o rótulo, placeholder `status (leave blank for root)`. Digite só `status`, não o nome de host inteiro. Deixe em branco ou digite `@` para usar o domínio raiz/apex.
- **Domínio** — um menu de domínios verificados, placeholder `Select domain`.

**Mais**

- **Carregar Certificado Personalizado** — uma chave, desativada por padrão. Deixe desativada e o OneUptime solicita um certificado gratuito para você. Ative-a e você recebe os campos **Certificado** e **Chave privada do certificado** para o seu próprio material PEM.

## Verificar o CNAME

Enquanto o domínio não estiver verificado, a linha mostra uma ação **Adicionar CNAME**. Ela abre um modal intitulado **Adicionar CNAME** que dá exatamente o que colar no seu provedor de DNS:

- **Tipo de Registro** — `CNAME`
- **Nome** — o domínio completo que você acabou de criar, por exemplo `status.yourcompany.com`
- **Conteúdo** — o registro CNAME de página de status da sua instalação

O modal observa que, uma vez que o registro esteja no lugar, a verificação automática pode levar até 24 horas. Você não precisa esperar por isso: o botão de envio do modal é **Verificar CNAME**, que checa o registro sob demanda.

Crie o registro DNS primeiro, depois clique em **Verificar CNAME**. Clicar antes de o registro existir simplesmente falha.

## Solicitar um certificado SSL

Uma vez que o CNAME esteja verificado — e apenas se você não carregou seu próprio certificado — uma ação **Solicitar SSL gratuito** aparece na linha. Seu modal, **Order Free SSL Certificate for this Status Page**, explica que o OneUptime usa o LetsEncrypt, que o processo é seguro e gratuito, e que o provisionamento leva algumas horas depois que o pedido é feito. O botão de envio é **Solicitar SSL gratuito**.

**Os prazos declarados divergem entre as telas**, então não leia muito em nenhum número isolado: o modal do pedido diz três horas, a coluna **Status** diz uma hora, e um certificado personalizado diz trinta minutos. Trate todos como "volte mais tarde hoje" e contate o suporte se nada tiver acontecido até lá.

Uma vez provisionado, a renovação é automática. Não há nada recorrente para você fazer.

## Ler a coluna Status do domínio

A coluna **Status** é toda a máquina de estados da configuração em uma célula. Cada mensagem diz a você ou o que fazer em seguida ou que está tudo pronto.

| O que a coluna Status diz                                | O que significa                                                                              |
| -------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Action Required: Please add your CNAME record.           | O CNAME ainda não está verificado. Adicione o registro, depois **Verificar CNAME**.          |
| Action Required: Please order SSL certificate.           | O CNAME está verificado mas nenhum certificado foi solicitado. Clique em **Solicitar SSL gratuito**. |
| No action is required, allow 30 minutes to provision.    | Você carregou um certificado personalizado e ele está sendo instalado.                       |
| No action is required, this will be provisioned soon.    | O certificado gratuito foi solicitado e está a caminho. Contate o suporte se ele nunca chegar.|
| Certificate Provisioned. No action required.             | Pronto. O OneUptime renova o certificado automaticamente.                                    |

Se uma linha ficar em "Action Required: Please add your CNAME record." muito depois de você ter criado a entrada de DNS, verifique se o nome do registro é o domínio completo e se seu conteúdo corresponde exatamente ao registro CNAME da sua instalação.

## Powered by OneUptime

A linha "Powered by OneUptime" não é uma configuração da seção de marca. Ela fica em **Páginas de status → sua página → Avançado → Configurações avançadas** (`{id}/settings`), no cartão **Marca "Powered By OneUptime"**, como uma única chave: **Ocultar a marca Powered By OneUptime**. **Edit Settings** a abre, como todo outro cartão daquela página.

## Onde ler a seguir

- [Visão geral das páginas de status](/docs/status-pages/index) — o que é uma página de status e como as peças se encaixam.
- [Recursos e grupos da página de status](/docs/status-pages/resources-and-groups) — escolher o que os visitantes de fato veem na página.
- [Assinantes e comunicados](/docs/status-pages/subscribers) — assinantes por e-mail, SMS, Slack e webhook, além dos anúncios.
- [API pública](/docs/status-pages/public-api) — ler dados da página de status programaticamente.
- [Estados e severidades de incidentes](/docs/incidents/states-and-severities) — o que faz um incidente aparecer na página e desaparecer dela.
