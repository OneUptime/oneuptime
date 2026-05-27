# Compartilhamento e Painéis Públicos

Por padrão, os painéis são privados ao seu projeto — apenas membros logados da equipe podem vê-los. Mas o OneUptime também permite compartilhar um painel publicamente, protegê-lo com uma senha, restringi-lo a determinados IPs e hospedá-lo no seu próprio domínio. Esta página cobre os quatro.

## Painéis privados (o padrão)

Um painel é acessível apenas a membros logados do seu projeto. A URL se parece com `https://oneuptime.com/dashboards/<id>/view` e exige um login.

Dentro do projeto, donos e etiquetas controlam quem vê o quê — veja [Configuração e Permissões](/docs/dashboards/configuration).

## Painéis públicos

Em **Painel → Configurações**, ligue **Painel Público**. O painel agora tem uma segunda URL que não exige login. Compartilhe com fornecedores, parceiros, clientes ou cole em um README público.

Um painel público:

- Sempre abre no modo **Visualização**. Visitantes públicos não podem editar nem ver a paleta de widgets.
- Inclui as variáveis que você adicionou. Os visitantes escolhem nos mesmos dropdowns que sua equipe usa.
- Usa a **marca** que você definiu nas Configurações — título da página, descrição, logotipo, favicon.

Trate ativar um painel público como publicar uma página web. Todo widget nele se torna legível por qualquer pessoa. Veja o que está no canvas antes de ligar o interruptor.

## Senha mestra

Para colocar uma senha em um painel público:

1. Ligue **Painel Público**.
2. Ligue **Senha Mestra**.
3. Defina a senha.

Os visitantes veem um prompt de senha antes do painel aparecer. A senha é armazenada como um hash — nunca vemos a senha real.

Use uma senha mestra quando:

- Você quer compartilhar com um parceiro ou cliente, mas não quer que a URL seja útil se vazar.
- O painel é "semi-público" — aberto o suficiente para você não querer convidar cada visualizador como membro da equipe, mas não aberto o bastante para deixar na internet aberta.

Para um controle mais forte (contas separadas por visualizador, um registro de auditoria de quem viu o quê), mantenha o painel privado e convide os visualizadores como membros da equipe somente leitura.

## Lista de IPs permitidos

No plano **Scale**, você pode restringir um painel público a uma lista de endereços ou faixas de IP. Configure em **Painel → Configurações → Lista de IPs Permitidos**.

Use isso quando:

- O painel só deve ser acessível do seu escritório ou VPN.
- Um portal de fornecedor só deve ser acessível dos IPs conhecidos dele.
- Você quer proteção extra além de uma senha mestra.

Requisições de qualquer outro IP são rejeitadas.

## Domínios personalizados

Por padrão, um painel público é servido em `oneuptime.com`. Para hospedá-lo no seu próprio subdomínio como `dashboard.acme.com`:

1. Adicione um registro CNAME no seu DNS apontando o subdomínio para o destino do OneUptime.
2. Em **Painel → Configurações → Domínios Personalizados**, adicione o domínio.
3. Verifique-o. O OneUptime checa o registro DNS para você.
4. Uma vez verificado, o painel fica acessível tanto no seu domínio personalizado quanto na URL original.

Domínios personalizados são úteis para:

- Painéis voltados ao cliente com sua própria marca.
- Painéis com marca compartilhada com parceiros.
- Páginas de saúde públicas com sua própria URL.

Você pode anexar mais de um domínio personalizado a um único painel se servir o mesmo conteúdo para várias audiências.

## Marca

Em **Painel → Configurações**, você pode configurar:

- **Título da página** — o que aparece na aba do navegador e no topo da página.
- **Descrição da página** — a descrição usada por mecanismos de busca e prévias sociais.
- **Logotipo** — envie um PNG ou SVG para mostrar no cabeçalho.
- **Favicon** — o pequeno ícone na aba do navegador.

A marca só se aplica quando o painel é visualizado publicamente. Visualizadores internos sempre veem a marca do OneUptime.

## Incorporação

Você pode incorporar um painel público no seu próprio site com um iframe:

```html
<iframe src="https://dashboard.acme.com/view"
        width="100%" height="800"
        frameborder="0"></iframe>
```

Se o painel tem uma senha mestra, os visitantes verão o prompt de senha dentro do iframe.

## URLs compartilháveis

A URL do painel inclui as seleções de variáveis atuais e o intervalo de tempo como parâmetros de consulta. Ajuste os dropdowns, copie a URL, cole no chat — quem abrir o link vê o painel com a mesma visualização.

Essa é a forma mais rápida de apontar um colega para "o painel no momento em que o incidente começou". Fixe o intervalo de tempo, copie, cole.

## O que ler em seguida

- [Configuração e Permissões](/docs/dashboards/configuration) — controle de acesso em modo privado.
- [Variáveis e Filtros](/docs/dashboards/variables) — variáveis com as quais os visitantes podem interagir.
- [Criando um Painel](/docs/dashboards/authoring) — o que vai no canvas.
