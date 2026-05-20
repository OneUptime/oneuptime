# Compartilhamento e painéis públicos

A maioria dos painéis é privada ao seu projeto — apenas membros logados do projeto conseguem vê-los. Mas o OneUptime também permite publicar um painel em uma URL pública, opcionalmente protegê-lo com senha, restringi-lo por IP e hospedá-lo em um domínio personalizado. Esta página cobre os quatro.

## Painéis privados (o padrão)

Por padrão, um painel é acessível apenas a usuários logados que são membros do projeto. A URL é do tipo `https://oneuptime.com/dashboards/<id>/view`. O acesso direto requer autenticação e a permissão de leitura apropriada no painel.

Dentro do projeto, propriedade e rótulos controlam quem vê o quê — veja [Configuração e permissões](/docs/dashboards/configuration).

## Painéis públicos

Em **Dashboard → Settings**, acione **Public Dashboard**. O painel agora tem uma segunda URL que não requer login. Compartilhe com fornecedores, parceiros, clientes ou cole em um README público.

Um painel público:

- Renderiza apenas no modo **View**. Visitantes públicos não conseguem editar, mudar URLs de intervalo de tempo de lado, ou ver a paleta de widgets.
- Inclui as variáveis que você definiu — visitantes podem escolher das listas suspensas como usuários internos.
- Carrega o **branding** que você configura em Settings: título da página, descrição da página, arquivo de logo, favicon. São esses que aparecem na aba do navegador e nas pré-visualizações sociais.

Trate ativar **Public Dashboard** como publicar uma página da web. Todo widget no painel agora é legível por qualquer um. Audite o que está no canvas antes de acionar a chave.

## Senha mestra

Para proteger um painel público com uma senha em vez de deixá-lo totalmente aberto:

1. Ative **Public Dashboard**.
2. Ative **Master Password**.
3. Defina a senha.

Os visitantes batem em uma tela de senha antes do painel renderizar. A senha tem hash em repouso; apenas o hash é armazenado.

Use uma senha mestra quando:

- Você quer compartilhar com um parceiro ou cliente, mas não quer que a URL seja válida se vazar.
- O painel é "semi-público" — aberto o bastante para você não querer contas do OneUptime para cada visualizador, mas não aberto o bastante para colocar na internet aberta.

Para proteção de maior valor (contas por visualizador, trilha de auditoria de quem viu o quê), mantenha o painel privado e convide os visualizadores ao projeto como membros somente leitura.

## Lista de IPs permitidos

No plano **Scale**, você pode restringir um painel público a uma lista de IPs de origem ou faixas CIDR. Configure a lista em **Dashboard → Settings → IP Whitelist**.

Use uma lista de IPs permitidos quando:

- O painel só deve ser acessível do seu escritório ou VPN.
- Um portal de fornecedor só deve ser acessível dos IPs de saída publicados deles.
- Você quer defesa em profundidade em cima de uma senha mestra.

Requisições de qualquer outro IP recebem um 403.

## Domínios personalizados

Pronto para usar, um painel público é servido em `oneuptime.com`. Para hospedá-lo em seu próprio subdomínio (por exemplo, `dashboard.acme.com`):

1. Adicione um registro CNAME no seu DNS apontando o subdomínio para o alvo publicado do OneUptime.
2. Em **Dashboard → Settings → Custom Domains**, adicione o domínio.
3. Verifique o registro DNS (o OneUptime checa por você).
4. Depois de verificado, o painel fica acessível tanto na URL do OneUptime quanto no seu domínio personalizado.

Domínios personalizados são úteis para:

- Painéis voltados para o cliente com a sua marca.
- Painéis de parceiro com marca compartilhada.
- SEO em uma página de saúde pública.

Você pode anexar múltiplos domínios personalizados a um painel se servir o mesmo conteúdo para múltiplos públicos.

## Branding para painéis públicos

Em **Dashboard → Settings**, configure:

- **Page title** — a tag `<title>` e o cabeçalho que os visitantes veem.
- **Page description** — a meta description usada por mecanismos de busca e pré-visualizações sociais.
- **Logo file** — faça upload de um PNG/SVG; mostrado no cabeçalho do painel.
- **Favicon** — feito upload; mostrado na aba do navegador.

O branding se aplica apenas à renderização em modo público. Visualizadores internos sempre veem o branding do OneUptime.

## Incorporação

Você pode incorporar um painel público em um `<iframe>` no seu próprio site:

```html
<iframe src="https://dashboard.acme.com/view"
        width="100%" height="800"
        frameborder="0"></iframe>
```

Se você incorpora um painel protegido por uma senha mestra, o visitante ainda vê a tela de senha dentro do iframe.

## URLs compartilháveis com estado de variável

A URL do painel codifica as seleções de variável atuais e o intervalo de tempo como parâmetros de consulta. Ajuste as listas suspensas, copie a URL e cole no chat — o destinatário vê o painel com exatamente a mesma visão, incluindo o intervalo de tempo que você estava olhando.

Essa é a forma mais rápida de apontar um colega para "o painel no momento em que o incidente começou" — fixe o intervalo de tempo, copie, cole.

## O que ler a seguir

- [Configuração e permissões](/docs/dashboards/configuration) — controle de acesso em modo privado.
- [Variáveis e filtros](/docs/dashboards/variables) — variáveis com as quais visitantes públicos podem interagir.
- [Criar um painel](/docs/dashboards/authoring) — o que vai no canvas em primeiro lugar.
