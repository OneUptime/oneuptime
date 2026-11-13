# Guia de auto-hospedagem

Siga esta página de cima para baixo para ir de um servidor vazio ao seu próprio OneUptime, que roda em HTTPS, enviou um e-mail de teste para você e pode alertar você. Cada passo termina com como saber que funcionou, e aponta para as páginas mais longas para os detalhes.

:::cards
- [Instalar o OneUptime](#instalar-o-oneuptime): Docker Compose em um servidor, ou o chart do Helm no Kubernetes.
- [Terminar de configurar o servidor](#terminar-de-configurar-o-servidor): O e-mail, depois SMS e chamadas, cada um com um teste.
- [Verificar a sua instalação](#verificar-a-sua-instalação): Um comando que diz o que está errado.
- [Início rápido](/docs/introduction/quickstart): Seu primeiro monitor, sua primeira política de plantão e sua primeira página de status.
:::

## O que você precisa

- **Um servidor.** Para o Docker Compose, um servidor Linux com 8 GB de memória, 4 núcleos e 20 GB de disco para experimentar o OneUptime, ou 16 GB, 8 núcleos e 400 GB para uma equipe: veja [Dimensionamento e planejamento de capacidade](/docs/installation/sizing). Para o chart do Helm, um cluster Kubernetes.
- **Um nome de domínio** com que as pessoas vão abrir o OneUptime, como `oneuptime.example.com`, com um registro DNS `A` que aponte para o servidor. Você pode começar com o endereço IP do servidor, mas um certificado do Let's Encrypt precisa de um nome de domínio.
- **As portas 80 e 443** acessíveis pela internet, para HTTPS.
- **Uma forma de enviar e-mail**: um servidor de e-mail, como o da sua empresa, o Microsoft 365 ou o Google Workspace, ou uma conta no Amazon SES, SendGrid, Mailgun, Postmark ou Resend.
- **Uma conta do Twilio**, para receber alertas por SMS e por ligação. E-mail e notificações push não precisam de uma.

**Funcionou quando** `dig +short oneuptime.example.com` mostra o endereço IP do servidor.

## Instalar o OneUptime

:::tabs
@tab Docker Compose
Num servidor novo com Ubuntu, Debian ou uma distribuição baseada em RHEL, um único comando instala o Docker, o Git e o Node.js onde faltarem, clona o OneUptime numa pasta `oneuptime`, pergunta o endereço que as pessoas vão usar e o inicia:

```bash
curl -fsSL https://oneuptime.com/install.sh | bash
```

Para fazer o mesmo à mão, com Docker, Git e Node.js instalados:

```bash
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime
cp config.example.env config.env
```

Abra o `config.env` e defina `HOST`, a primeira configuração dele, com seu nome de domínio ou endereço IP, sem `http://`. É a única configuração que você precisa mudar: e-mail, SMS e chamadas são configurados no Admin Dashboard, e tudo abaixo de `ADVANCED` funciona como está. Depois inicie o OneUptime:

```bash
npm start
```

**Funcionou quando** `npm start` termina com **OneUptime is up!** e o endereço a abrir. A primeira inicialização leva alguns minutos, enquanto o Docker baixa as imagens. Se `npm start` parar antes disso, ele diz o que mudar. [Docker Compose](/docs/installation/docker-compose) tem todos os detalhes.
@tab Kubernetes
Crie um `values.yaml` com seu nome de domínio ou endereço IP, sem `http://`:

```yaml title="values.yaml"
host: oneuptime.example.com
```

O chart guarda os dados na storage class padrão do seu cluster. Se `kubectl get storageclass` não marcar nenhuma como `(default)`, adicione `global.storageClass` com o nome de uma delas. Depois instale o chart:

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com/
helm install my-oneuptime oneuptime/oneuptime -f values.yaml
```

**Funcionou quando** `kubectl get pods` mostra todos os pods `Running` e o endereço que o `helm install` mostrou abre o OneUptime. O [guia de instalação do chart](https://github.com/OneUptime/oneuptime/blob/main/HelmChart/Public/oneuptime/docs/installation.md) tem todos os detalhes.
:::

## Ativar o HTTPS

Quando o seu nome de domínio apontar para o servidor, deixe o OneUptime obter um certificado gratuito do Let's Encrypt. Ele renova o certificado sozinho.

:::tabs
@tab Docker Compose
Defina estes valores no `config.env` e execute `npm start` de novo:

```ini title="config.env"
HOST=oneuptime.example.com
PROVISION_SSL=true
HTTP_PROTOCOL=https
```

Já usa um proxy reverso, como Caddy, Nginx ou um balanceador de carga? Mantenha `PROVISION_SSL=false`, defina `HTTP_PROTOCOL=https` e `TRUSTED_PROXY_HOPS=2`, e veja [Usar seu próprio proxy reverso](/docs/installation/docker-compose#usar-seu-próprio-proxy-reverso).
@tab Kubernetes
Defina estes valores no `values.yaml` e aplique-os:

```yaml title="values.yaml"
host: oneuptime.example.com
httpProtocol: https
ssl:
  provision: true
```

```bash
helm upgrade my-oneuptime oneuptime/oneuptime -f values.yaml
```

Para terminar o TLS num ingress controller seu, deixe `ssl.provision` desligado e defina só `httpProtocol: https`.
:::

**Funcionou quando** `https://oneuptime.example.com` abre sem aviso de certificado. O primeiro certificado costuma chegar em poucos minutos. Está experimentando o OneUptime em `localhost`? Pule este passo: um certificado precisa de um nome de domínio.

## Criar a conta de administrador

Abra o seu endereço, como `https://oneuptime.example.com`, e cadastre-se. A primeira conta de um servidor novo passa a ser o administrador principal dele, que pode abrir o Admin Dashboard em `/admin`.

**Funcionou quando** `/admin` abre o Admin Dashboard. Enquanto e-mail, HTTPS ou a escolha sobre cadastros estiverem pendentes, ele abre em **Termine de configurar este servidor**.

## Terminar de configurar o servidor

A página **Configuração do servidor** do Admin Dashboard, em `/admin/setup`, lista o que um servidor novo precisa, o mais importante primeiro. E-mail, HTTPS e quem pode se cadastrar são obrigatórios. SMS e chamadas, uma sonda global, backups e verificações de atualização são recomendados. Cada item tem um botão que abre o lugar onde ele é configurado, e `npm start` termina mostrando o endereço desta página.

:::steps
### Configurar o e-mail

Clique em **Configurar o e-mail**. Ele abre **Configurações > Notificações > E-mails**, onde você informa seu servidor de e-mail (a maioria usa a porta `587`) ou seu provedor de e-mail, e o endereço de onde os e-mails saem. Salve, depois clique em **Enviar e-mail de teste** e envie um para você.

**Funcionou quando** o e-mail chega e a lista marca o e-mail como feito. Quando o teste falha, ele mostra o que o servidor de e-mail respondeu: veja [SMTP](/docs/emails/smtp#solução-de-problemas).

### Escolher quem pode se cadastrar

Qualquer pessoa que consiga abrir seu endereço pode se cadastrar. Quando sua equipe tiver as contas dela, desligue **Permitir cadastro** em **Configurações > Autenticação**: quem você convidar para um projeto ainda pode entrar. Para deixar os cadastros abertos, clique em **Manter os registros abertos**.

**Funcionou quando** a lista marca os cadastros como feitos.

### Configurar SMS e chamadas, ou usar apenas e-mail e push

Para receber alertas por SMS e por ligação, clique em **Configurar SMS e chamadas** e adicione sua conta do Twilio em **Configurações > Notificações > Chamada e SMS**: [Integração do Twilio](/docs/self-hosted/twilio-integration) mostra onde encontrar cada valor. Depois clique em **Enviar SMS de teste** e **Fazer chamada de teste**. Para enviá-los por um gateway seu, veja [Gateway de SMS e chamadas](/docs/self-hosted/sms-and-call-gateway). Se e-mail e notificações push bastam, clique em **Usar apenas e-mail e push**.

**Funcionou quando** o SMS chega e o seu telefone toca, ou a lista mostra a sua escolha.
:::

O item de HTTPS fica feito assim que [Ativar o HTTPS](#ativar-o-https) funciona, e cada item recomendado diz o que fazer.

## Verificar a sua instalação

:::tabs
@tab Docker Compose
Na pasta `oneuptime`, execute o doctor:

```bash
npm run doctor
```

Ele verifica cada contêiner, o `config.env`, se o `HOST` chega a este servidor, o certificado e o espaço livre em disco, e pergunta ao OneUptime o que ele vê de si mesmo, como o e-mail e as sondas. Cada problema vem com a sua correção: veja [Verificar a sua instalação](/docs/installation/docker-compose#verificar-a-sua-instalação).
@tab Kubernetes
Execute o script de diagnóstico do chart no seu cluster, como mostra o [guia de solução de problemas do chart](https://github.com/OneUptime/oneuptime/blob/main/HelmChart/Public/oneuptime/docs/troubleshooting.md#run-it). Ele só lê, e termina com um resumo do que encontrou, o pior primeiro.
:::

**Funcionou quando** o doctor termina com **Everything looks right.** e sai com `0`. Ele sai com `1` quando há algo a corrigir, e com `2` quando não conseguiu fazer as verificações. No Kubernetes, o resumo não tem nenhum achado `CRITICAL`.

## Monitorar algo e receber alertas

Seu servidor agora pode enviar e-mails e alertar pessoas. O [Início rápido](/docs/introduction/quickstart) continua no produto: um monitor para o seu site, uma política de plantão que alerta você quando ele cai e uma página de status, em cerca de quinze minutos. A última parte declara um incidente de teste, para você ver o alerta chegar.

## Solução de problemas

:::details npm start para e diz que HOST ainda não é um endereço
`HOST` no `config.env` ainda tem um marcador, como `<your-address>`. Defina-o com seu nome de domínio ou endereço IP, sem `http://`, e execute `npm start` de novo.
:::

:::details O e-mail de teste falha
A mensagem abaixo do botão é o que o servidor de e-mail respondeu. Verifique o nome do host, a porta, o usuário e a senha, e se o servidor de e-mail deixa você enviar do endereço de onde os e-mails saem. Veja [SMTP](/docs/emails/smtp#solução-de-problemas).
:::

:::details O navegador avisa sobre o certificado
O Let's Encrypt precisa das portas 80 e 443 acessíveis pela internet, e do seu nome de domínio apontando para este servidor. Aguarde alguns minutos e execute `npm run doctor`: ele verifica o certificado e diz o que está errado.
:::

## Próximos passos

:::cards
- [Início rápido](/docs/introduction/quickstart): Um monitor, uma política de plantão e uma página de status em quinze minutos.
- [Docker Compose](/docs/installation/docker-compose): Seu próprio proxy, backups, atualizações e a lista de verificação para produção.
- [Atualização](/docs/installation/upgrading): Passar para uma nova versão, uma versão principal de cada vez.
- [Arquitetura](/docs/self-hosted/architecture): Como as partes do OneUptime se encaixam.
:::
