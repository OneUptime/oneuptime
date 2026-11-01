# Verificações de atualização e segurança

Uma vez por dia, um OneUptime auto-hospedado pergunta ao GitHub se saiu uma versão mais nova e se um aviso de segurança publicado pelo OneUptime afeta a versão que você executa. Quando é o caso, os seus administradores master são orientados a atualizar. Esta página explica o que a verificação envia, o que você vê e como desligá-la.

:::cards
- [O que a verificação envia](#o-que-a-verificação-envia): Duas perguntas públicas, e nada sobre a sua instalação.
- [O que você vê](#o-que-você-vê): O rodapé, o painel do administrador e um e-mail por aviso.
- [Desligar a verificação](#desligar-a-verificação): Para uma rede sem acesso à internet, ou para usar um espelho.
:::

## O que a verificação envia

O worker envia duas requisições à API do GitHub (`api.github.com`), sem token:

| Requisição | O que ela pergunta |
| --- | --- |
| `GET /repos/OneUptime/oneuptime/releases/latest` | Qual versão do OneUptime é a mais recente |
| `GET /repos/OneUptime/oneuptime/security-advisories?state=published` | Quais avisos de segurança o OneUptime publicou, as versões que cada um afeta e a versão que o corrige |

Nada sobre a sua instalação vai nelas: nem a versão que você executa, nem o endereço dela, e nada sobre os seus usuários, projetos ou dados de monitoramento. O GitHub vê o endereço IP público do seu servidor, como em qualquer requisição, e um `User-Agent` que traz o nome do OneUptime. É o seu servidor que determina se um aviso afeta a sua versão, e nenhum navegador chama o GitHub.

A verificação roda quando o worker inicia e, depois disso, uma vez por dia. Ela não volta a consultar o GitHub mais de uma vez a cada 12 horas, nem mais de uma vez por hora depois de uma requisição que falhou.

## O que você vê

Só os administradores master são avisados. São eles que podem atualizar, e contar a qualquer outra pessoa que o servidor executa uma versão com uma falha de segurança conhecida seria apontar para um servidor sem correção.

- Uma versão mais nova acrescenta **Atualização disponível** ao rodapé do Dashboard e do painel do administrador. O rótulo abre o guia de atualização.
- Um aviso de segurança publicado que afeta a versão que você executa mostra ali **Atualização de segurança** em vez disso, em vermelho.
- A primeira página do painel do administrador lista então cada aviso: a gravidade, as versões que ele afeta, a versão que o corrige e um link para ele no GitHub. Ela também informa quando a verificação leu os avisos pela última vez e por que a verificação mais recente falhou, se tiver falhado.
- Os seus administradores master e o E-mail de notificação do admin (**Configurações** > **E-mails** no painel do administrador) recebem um e-mail sobre cada aviso que afeta a sua versão, e nunca um segundo.

Tudo isso desaparece assim que você executa uma versão que nenhum aviso afeta. Para atualizar, veja [Atualização](/docs/installation/upgrading).

## Desligar a verificação

Em uma rede sem acesso à internet, ou se o seu servidor não deve contatar o GitHub, desligue a verificação. Então nada é mostrado nem enviado por e-mail.

:::tabs
@tab Kubernetes
```yaml
updateCheck:
  disabled: true
```
@tab Docker Compose
```bash
DISABLE_UPDATE_CHECK=true
```
Defina isso no `config.env` e depois execute `npm start`.
:::

Para verificar com um espelho dentro da sua rede em vez do GitHub, aponte a verificação para ele. O espelho precisa responder nos mesmos formatos do GitHub.

| Valor do Helm | Configuração do Docker Compose | Padrão |
| --- | --- | --- |
| `updateCheck.url` | `LATEST_RELEASE_CHECK_URL` | `https://api.github.com/repos/OneUptime/oneuptime/releases/latest` |
| `updateCheck.securityAdvisoriesUrl` | `SECURITY_ADVISORIES_CHECK_URL` | `https://api.github.com/repos/OneUptime/oneuptime/security-advisories` |

## Quando o GitHub não está acessível

Em uma rede sem acesso à internet, uma requisição que falha é esperada, não um erro. O worker a registra no nível debug, mantém o que leu por último e tenta de novo mais tarde. O painel do administrador informa quando os avisos foram lidos pela última vez e por que a verificação mais recente falhou: o limite de taxa do GitHub, nenhuma rota até o GitHub, um tempo limite esgotado ou uma resposta que não é do GitHub.

## Próximos passos

:::cards
- [Atualização](/docs/installation/upgrading): Atualize para uma versão mais recente, uma versão principal de cada vez.
- [Arquitetura](/docs/self-hosted/architecture): Cada conexão que um OneUptime auto-hospedado faz.
- [Atrás de uma VPN ou firewall](/docs/self-hosted/behind-a-firewall): O que chega ao seu servidor vindo de fora.
:::
