<!-- markdownlint-disable MD033 MD041 -->
<p align="center">
  <a href="/README.md">English</a>&nbsp;·
  <a href="/Docs/translations/README.zh-CN.md">简&#8288;体&#8288;中&#8288;文</a>&nbsp;·
  <a href="/Docs/translations/README.zh-TW.md">繁&#8288;體&#8288;中&#8288;文</a>&nbsp;·
  <a href="/Docs/translations/README.ja.md">日&#8288;本&#8288;語</a>&nbsp;·
  <a href="/Docs/translations/README.ko.md">한&#8288;국&#8288;어</a>&nbsp;·
  <a href="/Docs/translations/README.es.md">Español</a>&nbsp;·
  <a href="/Docs/translations/README.fr.md">Français</a>&nbsp;·
  <a href="/Docs/translations/README.de.md">Deutsch</a>&nbsp;·
  <a href="/Docs/translations/README.pt.md">Português</a>&nbsp;·
  <a href="/Docs/translations/README.it.md">Italiano</a>&nbsp;·
  <a href="/Docs/translations/README.ru.md">Русский</a>&nbsp;·
  <a href="/Docs/translations/README.hi.md">हिन्दी</a>&nbsp;·
  <a href="/Docs/translations/README.fa.md">فارسی</a>&nbsp;·
  <a href="/Docs/translations/README.nl.md">Nederlands</a>&nbsp;·
  <a href="/Docs/translations/README.da.md">Dansk</a>&nbsp;·
  <a href="/Docs/translations/README.sv.md">Svenska</a>&nbsp;·
  <a href="/Docs/translations/README.no.md">Norsk</a>
</p>

<p align="center">
  <a href="https://oneuptime.com"><picture><source media="(prefers-color-scheme: dark)" srcset="/packages/App/FeatureSet/Docs/Static/images/logo-dark.svg"><img alt="OneUptime" width="42%" src="/packages/App/FeatureSet/Docs/Static/images/logo-light.svg"></picture></a>
</p>

<p align="center">
  <a href="https://github.com/OneUptime/oneuptime/blob/master/LICENSE"><img src="https://img.shields.io/badge/license-Apache%202.0%20%2B%20Enterprise%20%28ee%2F%29-1a73e8" alt="License"></a>
  <a href="https://github.com/OneUptime/oneuptime/releases"><img src="https://img.shields.io/github/v/release/OneUptime/oneuptime" alt="Release"></a>
</p>

OneUptime é uma plataforma de observabilidade de código aberto. Ela verifica se seus sites, APIs e servidores funcionam, coleta os logs, as métricas e os traces que seus aplicativos enviam, aciona quem está de plantão quando algo quebra e informa seus clientes em uma página de status. Tudo acontece em um só produto: a ferramenta que percebe um problema é a mesma que aciona sua equipe.

Você pode usar o [OneUptime Cloud](https://oneuptime.com) ou executar o OneUptime nos seus próprios servidores.

<p align="center">
  <img alt="OneUptime durante um incidente: a linha do tempo, quem está de plantão, a página de status e a investigação da OneUptime AI" width="100%" src="/packages/Home/Static/img/readme/hero-command-center.png">
</p>

## O que ele faz

- **[Monitoramento](https://oneuptime.com/docs/pt/monitor/create-monitor)**: Verificar sites, APIs, portas, DNS e certificados a partir de sondas no mundo todo ou de dentro da sua própria rede. O OneUptime também acompanha servidores, Kubernetes, Docker, VMware, bancos de dados e dispositivos de rede.
- **[Incidentes e plantão](https://oneuptime.com/docs/pt/incidents/index)**: Trabalhar cada incidente em uma única linha do tempo. Acionar quem está de plantão por ligação, SMS, e-mail, push, Slack ou Microsoft Teams, e escalar até alguém responder.
- **[Páginas de status](https://oneuptime.com/docs/pt/status-pages/index)**: Manter os clientes informados em páginas de status públicas ou privadas, e anunciar nelas a manutenção programada.
- **[Logs, métricas e traces](https://oneuptime.com/docs/pt/telemetry/open-telemetry)**: Enviá-los com OpenTelemetry, pesquisá-los e montar painéis. Exceções, perfis, Real User Monitoring e eventos de segurança ficam no mesmo lugar.
- **[Fluxos de trabalho e runbooks](https://oneuptime.com/docs/pt/workflows/index)**: Automatizar o trabalho de rotina e conectar o Jira, o ServiceNow e as outras ferramentas que sua equipe já usa.
- **[OneUptime AI](https://oneuptime.com/docs/pt/ai/ai-sre)**: Investiga novos incidentes e alertas e publica uma análise de causa raiz com citações. Quando você ativa a correção, ela pode abrir um pull request com uma correção para sua equipe revisar.
- **[API, CLI e Terraform](https://oneuptime.com/docs/pt/api-reference/api-reference)**: Automatizar o OneUptime a partir dos seus scripts e da sua CI, e gerenciar monitores, páginas de status e plantão como código.

Todo o resto está na [documentação](https://oneuptime.com/docs/pt/introduction/getting-started).

## Primeiros passos

### OneUptime Cloud

[Cadastre-se](https://oneuptime.com/accounts/register) e crie um projeto. O plano gratuito não precisa de cartão de crédito.

### Hospedar por conta própria com Docker Compose

Você precisa de um servidor Linux com pelo menos 8 GB de memória, e de Docker, Docker Compose, Git e Node.js.

Antes do passo 3, defina `HOST` no `config.env` com o nome de domínio ou o endereço IP que as pessoas vão usar para acessar o OneUptime, sem `http://`. Mantenha `localhost` só para experimentar o OneUptime no seu próprio computador.

```bash
# 1. Clone the release branch
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime

# 2. Create your config
cp config.example.env config.env

# 3. Start everything
npm start
```

O `npm start` verifica o servidor, dá a cada segredo do `config.env` o seu próprio valor aleatório e inicia o OneUptime. Quando o `npm start` mostrar **OneUptime is up!**, abra `http://localhost`, ou o endereço do seu servidor, e cadastre-se. A primeira conta passa a ser a administradora da instância.

O [guia do Docker Compose](https://oneuptime.com/docs/pt/installation/docker-compose) cobre o tamanho do servidor, HTTPS, backups e atualizações.

### Kubernetes com Helm

Para produção em grande escala, ou alta disponibilidade, instale o chart do Helm. Defina `host` com o nome de domínio ou o endereço IP pelo qual as pessoas vão acessar o OneUptime:

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com/
helm install my-oneuptime oneuptime/oneuptime --set host=oneuptime.example.com
```

O [README do chart](/HelmChart/Public/oneuptime/README.md) cobre armazenamento, HTTPS, bancos de dados e atualizações.

## Community e Enterprise

- **Community Edition**: Gratuita e de código aberto, com tudo o que está acima, incluindo o login único SAML e OIDC.
- **Enterprise Edition**: Acrescenta o provisionamento SCIM, os logs de auditoria, a conformidade de equipes e os painéis de saúde da instância, com suporte prioritário. O uso em produção exige uma licença: [fale com vendas](mailto:sales@oneuptime.com).

A documentação [compara as duas edições](https://oneuptime.com/docs/pt/self-hosted/enterprise).

## Obter ajuda

- Tire dúvidas na [comunidade do OneUptime no Slack](https://join.slack.com/t/oneuptimesupport/shared_invite/zt-2pz5p1uhe-Fpmc7bv5ZE5xRMe7qJnwmA).
- Relate bugs e peça recursos nas [issues do GitHub](https://github.com/OneUptime/oneuptime/issues).
- Relate uma vulnerabilidade de segurança em particular, como explica o [SECURITY.md](/.github/SECURITY.md).
- Para todo o resto, escreva para [support@oneuptime.com](mailto:support@oneuptime.com).

## Contribuindo

Correções de bugs, recursos, documentação e testes são bem-vindos. O [guia de desenvolvimento local](https://oneuptime.com/docs/pt/installation/local-development) mostra como executar o OneUptime a partir do código-fonte, e as [diretrizes de contribuição](/.github/CONTRIBUTING.md) explicam como funcionam os pull requests e as licenças. As issues com o rótulo [good first issue](https://github.com/OneUptime/oneuptime/labels/good%20first%20issue) são um bom ponto de partida.

Se o OneUptime for útil para você, dê uma estrela a este repositório ou [patrocine o projeto](https://github.com/sponsors/OneUptime).

## Licença

O OneUptime é open source sob a [Apache License 2.0](/LICENSE), exceto o diretório [`ee/`](/ee). Esse diretório contém a Enterprise Edition e é licenciado sob a [OneUptime Enterprise License](/ee/LICENSE). A imagem da Community Edition não contém nenhum código de `ee/`. O arquivo [`LICENSE`](/LICENSE) na raiz do repositório define essa divisão.
