# Sondas personalizadas

Uma sonda personalizada é um pequeno agente que você executa dentro da sua própria rede. Ela verifica os monitores aos quais você a adiciona, como sites internos, APIs e servidores atrás do seu firewall, e envia os resultados ao OneUptime. Ela só abre conexões de saída, por HTTPS, então nada na sua rede precisa aceitar conexões vindas da internet.

:::cards
- [Como funciona](#como-funciona): O que a sonda faz e como o OneUptime sabe que ela está rodando.
- [Instalar uma sonda](#instalar-uma-sonda): Criá-la no OneUptime, executá-la com Docker, Docker Compose ou Kubernetes e adicioná-la a monitores.
- [Variáveis de ambiente](#variáveis-de-ambiente): Cada configuração que a sonda lê, com seu valor padrão.
- [Diagnosticar uma sonda desconectada](#diagnosticar-uma-sonda-desconectada): Descobrir onde param as requisições da sonda ao OneUptime.
:::

## Como funciona

```mermaid title="O que uma sonda personalizada faz"
sequenceDiagram
    participant P as Sonda personalizada
    participant S as Seus serviços
    participant O as OneUptime
    P->>O: Estou rodando (a cada minuto)
    P->>O: Quais dos meus monitores estão na hora?
    O-->>P: Os monitores a verificar
    P->>S: Verificar cada um
    P->>O: Enviar os resultados
    O->>O: Atualizar o status, abrir incidentes ou alertas
```

- **A sonda se conecta para fora.** Cada requisição vai da sonda para `ONEUPTIME_URL` por HTTPS. Nada precisa alcançar a sonda de fora da sua rede.
- **Ela verifica só os próprios monitores.** A sonda pede ao OneUptime os monitores aos quais foi adicionada, verifica cada um quando chega a hora e devolve o resultado. O OneUptime decide pelos resultados se o status de um monitor muda.
- **O OneUptime acompanha se ela está rodando.** Cada requisição da sonda conta como sinal de vida, e a sonda envia pelo menos uma por minuto. Depois de cerca de três minutos sem nenhuma, a sonda mostra **Desconectado** e seus proprietários são avisados. Uma sonda sem proprietários avisa os proprietários do projeto.

## Antes de começar

- **O plano Growth, no OneUptime Cloud.** Criar uma sonda exige esse plano. Uma instalação auto-hospedada não tem limites de plano.
- **Permissão para criar sondas.** Os proprietários e administradores do projeto têm, assim como os membros cuja função permite criar sondas.
- **Uma máquina na rede que você quer monitorar.** Ela precisa de Docker, Docker Compose ou Kubernetes, de uma rota até os serviços que a sonda vai verificar e de HTTPS de saída para `ONEUPTIME_URL`.

## Instalar uma sonda

:::steps
### Criar a sonda

Abra **Monitores → Configurações → Sondas** e clique em **Criar: Sonda**. Dê a ela um **Nome** e uma **Descrição**: ambos são obrigatórios. **Mais campos** contém o **Logotipo da sonda**, **Habilitar monitoramento automaticamente em novos monitores**, que escolhe esta sonda para cada novo monitor que você criar, e os **Rótulos**.

### Copiar o ID e a chave

A sonda precisa do seu ID e da sua chave para se conectar. Para copiá-los, abra o menu da sonda na tabela **Sondas personalizadas** e escolha **Mostrar ID e chave**. Qualquer pessoa que vê a tabela pode copiar o ID de uma sonda; a chave só é mostrada aos proprietários e administradores do projeto, que veem **Mostrar ID e chave** onde os demais veem **Mostrar ID**.

Os proprietários e administradores do projeto também podem clicar na sonda: o cartão **Set up your Custom Probe** da página dela mostra o comando Docker com o ID e a chave já preenchidos.

### Executar a sonda

Execute-a na máquina escolhida, com o ID e a chave da sonda. Se você hospeda o OneUptime por conta própria, defina `ONEUPTIME_URL` com a URL da sua instalação em vez de `https://oneuptime.com`.

:::tabs
@tab Docker
```bash
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -d oneuptime/probe:release
```
@tab Docker Compose
```yaml title="docker-compose.yml"
services:
  oneuptime-probe:
    image: oneuptime/probe:release
    container_name: oneuptime-probe
    environment:
      - PROBE_KEY=<probe-key>
      - PROBE_ID=<probe-id>
      - ONEUPTIME_URL=https://oneuptime.com
    network_mode: host
    restart: always
```

Depois inicie-a com `docker compose up -d`.
@tab Kubernetes
```yaml title="oneuptime-probe.yaml"
apiVersion: apps/v1
kind: Deployment
metadata:
  name: oneuptime-probe
spec:
  selector:
    matchLabels:
      app: oneuptime-probe
  template:
    metadata:
      labels:
        app: oneuptime-probe
    spec:
      containers:
        - name: oneuptime-probe
          image: oneuptime/probe:release
          env:
            - name: PROBE_KEY
              value: "<probe-key>"
            - name: PROBE_ID
              value: "<probe-id>"
            - name: ONEUPTIME_URL
              value: "https://oneuptime.com"
```

Depois aplique-a com `kubectl apply -f oneuptime-probe.yaml`.
:::

A rede do host (`--network host`, `network_mode: host`) permite que a sonda use a própria rede do host, IPv6 incluído. Leia [Monitorar destinos IPv6](#monitorar-destinos-ipv6) antes de executá-la sem a rede do host.

### Verificar se ela se conecta

Em um ou dois minutos, o **Status** da sonda na tabela **Sondas personalizadas** mostra **Conectado**. Se continuar mostrando **Desconectado**, o log da sonda diz por quê: veja [Diagnosticar uma sonda desconectada](#diagnosticar-uma-sonda-desconectada).

### Verificar um monitor a partir da sonda

Uma sonda só verifica os monitores aos quais foi adicionada. Um novo monitor escolhe suas sondas na etapa **Sondas e intervalo** de **Criar monitor**. Para um monitor que já existe, abra-o e vá em **Configuração → Sondas e intervalo**. A página tem três cartões:

- **Intervalo de monitoramento**: com que frequência cada uma das sondas do monitor o verifica. Escolha um intervalo e ele é salvo na hora. Monitores sintéticos, Custom Code e de certificado SSL são oferecidos a cada 5 minutos ou mais; um que já está num intervalo menor, ou num agendamento definido pela API, mantém esse valor e o mostra na lista.
- **Sondas**: clique em **Adicionar sonda** e escolha sua sonda personalizada. Para que uma sonda pare de verificar este monitor, desative-a com **Editar** no menu da linha, ou exclua a linha.
- **Concordância de sondas**: quantas sondas do monitor precisam ver o mesmo resultado antes que seu status mude, digitado na frase "Alterar o status deste monitor quando ... sondas concordarem". Deixe a caixa vazia para todas. Só participam as sondas ativadas e conectadas, então um número maior também significa todas. O número é salvo quando você sai da caixa ou pressiona **Enter**.

Os monitores que as sondas não verificam (Manual, Requisição recebida, E-mail recebido, Servidor, Dispositivo de rede e os monitores de telemetria) não têm a página Sondas e intervalo.
:::

> [!TIP]
> Uma sonda que deve verificar endereços privados, como `http://10.0.0.5/health`, precisa de `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true`. As sondas recusam endereços privados até que você os permita: veja [Acesso à rede privada](/docs/self-hosted/private-network-access).

## Conectar através de um proxy

Se a sonda precisa passar por um proxy para alcançar o OneUptime ou os sites que verifica, informe o endereço do proxy:

| Variável | O que faz |
| --- | --- |
| `HTTPS_PROXY_URL` | O proxy para endereços HTTPS, entre eles o próprio OneUptime e a maioria dos sites. |
| `HTTP_PROXY_URL` | O proxy para endereços HTTP simples. |
| `NO_PROXY` | Hosts que a sonda alcança diretamente, separados por vírgulas. |

Escreva o endereço de um proxy como `http://proxy.example.com:8080`, ou `http://username:password@proxy.example.com:8080` quando ele pedir usuário e senha. A maioria dos proxies atende os dois tipos de endereço, então defina as duas variáveis com a mesma URL.

:::tabs
@tab Docker
```bash
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e HTTP_PROXY_URL=http://proxy.example.com:8080 \
  -e HTTPS_PROXY_URL=http://proxy.example.com:8080 \
  -e NO_PROXY=localhost,.internal.example.com \
  -d oneuptime/probe:release
```
@tab Docker Compose
```yaml title="docker-compose.yml"
services:
  oneuptime-probe:
    image: oneuptime/probe:release
    container_name: oneuptime-probe
    environment:
      - PROBE_KEY=<probe-key>
      - PROBE_ID=<probe-id>
      - ONEUPTIME_URL=https://oneuptime.com
      - HTTP_PROXY_URL=http://proxy.example.com:8080
      - HTTPS_PROXY_URL=http://proxy.example.com:8080
      - NO_PROXY=localhost,.internal.example.com
    network_mode: host
    restart: always
```
@tab Kubernetes
```yaml title="oneuptime-probe.yaml"
apiVersion: apps/v1
kind: Deployment
metadata:
  name: oneuptime-probe
spec:
  selector:
    matchLabels:
      app: oneuptime-probe
  template:
    metadata:
      labels:
        app: oneuptime-probe
    spec:
      containers:
        - name: oneuptime-probe
          image: oneuptime/probe:release
          env:
            - name: PROBE_KEY
              value: "<probe-key>"
            - name: PROBE_ID
              value: "<probe-id>"
            - name: ONEUPTIME_URL
              value: "https://oneuptime.com"
            - name: HTTP_PROXY_URL
              value: "http://proxy.example.com:8080"
            - name: HTTPS_PROXY_URL
              value: "http://proxy.example.com:8080"
            - name: NO_PROXY
              value: "localhost,.internal.example.com"
```
:::

O que passa pelo proxy:

- **As próprias requisições da sonda ao OneUptime.**
- **As verificações HTTP dos monitores**: monitores Website, API, External Status Page, Custom Code, de certificado SSL, sintéticos e de domínio. Os monitores de certificado SSL e sintéticos usam `HTTPS_PROXY_URL`, ou `HTTP_PROXY_URL` quando só essa está definida.
- **Não as outras verificações.** Ping, Port, DNS, SNMP e as demais verificações que não são HTTP se conectam diretamente.

Uma entrada de `NO_PROXY` é um nome de host (`api.internal`), um domínio com um ponto inicial ou `*.` para todos os nomes abaixo dele (`.internal.example.com`), qualquer um deles com uma `:port`, ou `*` para tudo. Faixas de IP não são lidas: liste cada endereço. Os nomes em minúsculas `http_proxy`, `https_proxy` e `no_proxy`, e também `HTTP_PROXY` e `HTTPS_PROXY`, funcionam igualmente.

## Monitorar destinos IPv6

Uma sonda só consegue monitorar um destino IPv6 se a rede da própria sonda tiver IPv6:

- **Docker com `--network host`, ou Compose com `network_mode: host`** (as configurações acima): a sonda compartilha a rede do host, então tem IPv6 exatamente quando o host tem.
- **Uma rede bridge do Docker** (o que você obtém sem a rede do host): sem IPv6, a menos que o IPv6 esteja ativado para essa rede (veja abaixo).
- **Kubernetes**: os pods só têm IPv6 num cluster dual-stack ou somente IPv6.

Para verificar, faça ping num endereço IPv6 público de dentro da sonda:

:::tabs
@tab Docker
```bash
docker exec oneuptime-probe ping -6 -c 1 2001:4860:4860::8888
```
@tab Kubernetes
```bash
kubectl exec deploy/oneuptime-probe -- ping -6 -c 1 2001:4860:4860::8888
```
:::

`1 received` significa que a sonda consegue alcançar destinos IPv6. Se a sonda não tem IPv6 utilizável, o `ping` falha na hora e o erro diz por quê:

| Erro | O que significa |
| --- | --- |
| `Network is unreachable` | A rede da sonda não tem rota IPv6: uma rede bridge do Docker sem IPv6, um cluster Kubernetes somente IPv4 ou um host sem conectividade IPv6. |
| `Cannot assign requested address` | O IPv6 está desativado no namespace de rede da sonda. Verifique `net.ipv6.conf.all.disable_ipv6` e `net.ipv6.conf.lo.disable_ipv6`: `cat /proc/sys/net/ipv6/conf/all/disable_ipv6` dentro da sonda imprime `1` quando está desativado. Com a rede do host, essas são as configurações do host. |
| `Address family not supported by protocol` | O kernel foi iniciado com `ipv6.disable=1`, então a máquina não tem IPv6 nenhum. Remova isso da linha de comando do kernel e reinicie, ou execute a sonda em outra máquina. |

Em cada caso nada foi enviado ao destino, então a sonda não consegue saber se ele está no ar. A verificação falha mesmo assim, mas o motivo da falha de um monitor Ping aponta a sonda em vez de dizer que o destino não respondeu:

```text
This probe cannot send IPv6 traffic (ping6: connect: Cannot assign requested address), so 2001:db8::1 was never contacted. The probe has no usable IPv6 address or route; this says nothing about whether 2001:db8::1 is up. Monitor IPv6 destinations from a probe that has IPv6 connectivity.
```

O caminho de rede registrado com a falha diz `Traceroute could not run: this probe cannot send IPv6 traffic (...)`. Corrija a rede da sonda ou mova o monitor para uma sonda que tenha IPv6.

### IPv6 sem a rede do host

Se você não pode usar a rede do host, conecte a sonda a uma rede Docker com IPv6 ativado. O próprio host continua precisando de IPv6.

```bash
docker network create --ipv6 oneuptime-probe-ipv6
docker run --name oneuptime-probe --network oneuptime-probe-ipv6 -e PROBE_KEY=<probe-key> -e PROBE_ID=<probe-id> -e ONEUPTIME_URL=https://oneuptime.com -d oneuptime/probe:release
```

O Docker Engine 27 e posteriores escolhem uma sub-rede IPv6 para a rede e mascaram o IPv6 de saída da sonda atrás do endereço do host. Versões mais antigas precisam de uma sub-rede IPv6 explícita (por exemplo `docker network create --ipv6 --subnet fd00:0:0:1::/64 oneuptime-probe-ipv6`) e de `"ip6tables": true` com `"experimental": true` em `/etc/docker/daemon.json`. Com Docker Compose, remova `network_mode: host` e defina `enable_ipv6: true` na rede da sonda.

## Consultas de nomes NetBIOS nas varreduras de descoberta

Uma [varredura de descoberta de rede](/docs/monitor/network-device-monitor) com **Consultar nomes do Windows (NetBIOS)** ativado envia da sonda consultas de nome NetBIOS (NBSTAT) a cada host que não tem nome de sistema SNMP. Para as varreduras que usam isso, permita este tráfego:

- **Quais hosts são consultados:** hosts descobertos que não têm nem nome de sistema SNMP nem nome de DNS reverso (PTR), e só em endereços privados (`10.0.0.0/8`, `172.16.0.0/12`, `192.168.0.0/16`) ou de NAT de nível de operadora (`100.64.0.0/10`). Endereços públicos nunca são consultados, e um host cuja consulta de DNS reverso a partir da sonda retornou um nome nunca recebe uma consulta. Um host cuja consulta falhou, expirou ou foi pulada quando o orçamento de tempo das consultas acabou ainda pode ser consultado, mesmo que tenha um registro PTR.
- **Saída:** UDP de uma porta de origem efêmera (aleatória, alta) da sonda para a porta UDP 137 desses hosts. As configurações de proxy acima não se aplicam a ele.
- **Entrada:** as respostas, da porta UDP 137 de cada host de volta para essa porta efêmera. Um firewall com estado as permite automaticamente. Sem elas, os hosts continuam sendo nomeados pelo endereço IP.

A consulta não precisa de nenhuma capability extra do contêiner e funciona a partir da rede de pods do Kubernetes. Ela consulta no máximo 2.000 hosts por varredura (`PROBE_DISCOVERY_NETBIOS_MAX_HOSTS` eleva isso para 4.000), envia mais uma consulta a cada host que não respondeu, espaça as consultas a cerca de 100 por segundo e para num limite de tempo dimensionado para esse trabalho - cerca de 54 segundos para uma consulta completa de 2.000 hosts, e nunca mais de dois minutos. Sondas globais nunca enviam consultas NetBIOS, diga o que disser a varredura, então execute a partir de uma sonda personalizada as varreduras que precisam de nomes NetBIOS. A opção vem ativada nas novas varreduras. Consultas NBSTAT para muitos hosts podem disparar regras de detecção de intrusão, então desative-a nas varreduras de redes onde isso importa, ou avise antes sua equipe de segurança.

## Variáveis de ambiente

A sonda lê suas configurações do próprio ambiente ao iniciar: altere uma e reinicie a sonda. Um número que a sonda não consegue ler, ou fora da faixa que uma variável aceita, é ignorado e o valor padrão é usado; os limites de captura de pacotes são trazidos para dentro da faixa em vez disso.

### Obrigatórias

| Variável | O que é |
| --- | --- |
| `PROBE_KEY` | A chave da sonda, de **Mostrar ID e chave**. Sem ela, a sonda para ao iniciar. |
| `PROBE_ID` | O ID da sonda, de **Mostrar ID e chave**. Sem ele, a sonda para ao iniciar. |
| `ONEUPTIME_URL` | Onde fica o OneUptime: `https://oneuptime.com`, ou a URL da sua própria instalação. Sem ela, a sonda para ao iniciar. |

### Verificação de monitores

| Variável | Padrão | O que faz |
| --- | --- | --- |
| `PROBE_MONITORING_WORKERS` | `1` | Quantos lotes de monitores a sonda verifica ao mesmo tempo. |
| `PROBE_MONITOR_FETCH_LIMIT` | `10` | Quantos monitores há em um lote. |
| `PROBE_MONITOR_RETRY_LIMIT` | `3` | Novas tentativas depois da primeira tentativa de uma verificação que falhou, usadas quando uma etapa não define o próprio número, ou seja, até 4 tentativas. `0` desativa as novas tentativas. |
| `PROBE_MONITOR_CHECK_TIMEOUT_IN_MS` | `900000` | Prazo para verificar um monitor, após o qual a verificação é abandonada e repetida no próximo ciclo. O padrão aumenta quando o tempo limite dos scripts sintéticos é elevado, para que um script nunca seja interrompido. |
| `PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS` | `60000` | Tempo limite dos scripts de monitores sintéticos, em milissegundos. |
| `PROBE_SYNTHETIC_MONITOR_CHROMIUM_SANDBOX_ENABLED` | `false` | Defina como `true` para executar o Chromium, nos monitores sintéticos, dentro do seu próprio sandbox. Ative-a só quando o contêiner da sonda rodar com um perfil seccomp que permita o sandbox, como o do Playwright: sem um, o Chromium não consegue iniciar. Enquanto estiver desativada, a sonda registra um aviso ao iniciar. |
| `PROBE_CUSTOM_CODE_MONITOR_SCRIPT_TIMEOUT_IN_MS` | `60000` | Tempo limite dos scripts de monitores Custom Code, em milissegundos. |
| `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS` | `false` | Defina como `true` para que os monitores Website, API, External Status Page e Custom Code desta sonda possam alcançar endereços privados. Veja [Acesso à rede privada](/docs/self-hosted/private-network-access). |
| `PROBE_NETWORK_DEVICE_POLL_CONCURRENCY` | `25` | Quantos dispositivos de rede a sonda consulta ao mesmo tempo. Aumente-a para uma sonda que consulta muitos dispositivos. |

Os limites dentro dos quais um monitor sintético roda (quantos ao mesmo tempo, sua memória e seu disco) estão na página [Monitor sintético](/docs/monitor/synthetic-monitor).

### Comunicação com o OneUptime

| Variável | Padrão | O que faz |
| --- | --- | --- |
| `HTTP_PROXY_URL`, `HTTPS_PROXY_URL`, `NO_PROXY` | nenhum | As configurações de proxy: veja [Conectar através de um proxy](#conectar-através-de-um-proxy). |
| `PROBE_API_REQUEST_TIMEOUT_IN_MS` | `45000` | Prazo de cada requisição que a sonda envia ao OneUptime. |
| `PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS` | `10000` | Registrar um aviso para as requisições ao OneUptime mais lentas que isso. |

### Descoberta de rede

| Variável | Padrão | O que faz |
| --- | --- | --- |
| `PROBE_DISCOVERY_SCAN_TIMEOUT_IN_MS` | `5400000` (90 minutos) | Prazo de uma varredura de descoberta de rede, após o qual ela é abandonada e a varredura é relatada como falha. |
| `PROBE_DISCOVERY_PROGRESS_INTERVAL_IN_MS` | `30000` | Com que frequência uma varredura de descoberta em andamento envia os hosts encontrados até ali, para que uma varredura longa mostre o progresso e seus dispositivos possam ser importados antes do fim. Mínimo `5000`. |
| `PROBE_DISCOVERY_SCAN_CONCURRENCY` | `0` | Número fixo de endereços que uma varredura de descoberta sonda ao mesmo tempo. Deixe sem definir (ou `0`) para dimensioná-lo pelo alvo da varredura, que é o que você quer, a menos que o contêiner da sonda seja incomumente pequeno ou incomumente grande. |
| `PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS` | `0` | Limite de tempo, em milissegundos, para buscar os nomes de DNS reverso (PTR) dos hosts que uma varredura encontrou. Veja abaixo. |
| `PROBE_DISCOVERY_NETBIOS_MAX_HOSTS` | `0` | Quantos hosts a consulta NetBIOS de uma varredura pode consultar. Veja abaixo. |
| `PROBE_DISCOVERY_MAX_CONCURRENT_SCANS` | `4` | Máximo de varreduras de descoberta independentes rodando ao mesmo tempo nesta sonda, de 1 a 16. Veja abaixo. |

`PROBE_DISCOVERY_REVERSE_DNS_BUDGET_IN_MS`: deixe sem definir (ou `0`) para dimensionar o limite pelo número de hosts: 60 segundos para até cerca de 860 hosts, crescendo até no máximo 10 minutos. Você pode defini-la de 1000 a 1200000. Os hosts que as consultas não alcançam a tempo ficam sem nome de DNS reverso (são listados pelo endereço IP, a menos que SNMP ou NetBIOS os nomeie), e a mensagem de status da varredura diz quantos ficaram de fora. Uma consulta que expira ou falha é repetida uma vez enquanto o limite durar, perguntando a cada um dos servidores de nomes da sonda por vez. Aumente-a para uma rede grande atrás de um servidor DNS lento.

`PROBE_DISCOVERY_NETBIOS_MAX_HOSTS`: nas varreduras com nomes NetBIOS ativados, a consulta pergunta a cada host sem nome de sistema SNMP, primeiro aos que não têm nome de DNS reverso. Deixe sem definir (ou `0`) para manter o teto embutido de 2.000; você pode defini-la de 1 a 4000. Os hosts acima do teto não são consultados, e a mensagem de status da varredura diz quantos. Aumentá-la também alonga a consulta (o limite de tempo é dimensionado por ela: cerca de 104 segundos com 4.000 hosts) e coloca mais datagramas NBSTAT na rede, que as regras de detecção de intrusão observam.

`PROBE_DISCOVERY_MAX_CONCURRENT_SCANS`: a sonda procura outra varredura pendente a cada minuto enquanto houver capacidade, para que uma varredura longa não bloqueie todas as outras. Quando todos os espaços estão ocupados, as varreduras adicionais ficam pendentes até um espaço ser liberado. Cada varredura tem a própria concorrência de hosts, então o uso de recursos cresce com as duas configurações; reduza qualquer um dos limites em contêineres pequenos. Defina como 1 para executar as varreduras uma após a outra.

Atualize o servidor do OneUptime antes de atualizar as sondas personalizadas para usar a descoberta concorrente. O servidor precisa conseguir excluir as varreduras que a sonda ainda está executando, para que editar uma varredura em andamento coloque a nova configuração na fila com segurança. Ao conectar uma sonda atualizada a um servidor mais antigo, defina `PROBE_DISCOVERY_MAX_CONCURRENT_SCANS=1` até o servidor ser atualizado.

### Captura de pacotes

| Variável | Padrão | O que faz |
| --- | --- | --- |
| `PROBE_PACKET_CAPTURE_ENABLED` | desativada | Defina como `true` para que pessoas com a permissão iniciem capturas de pacotes nesta sonda pelo painel. As capturas também precisam da rede do host e da capability `NET_RAW`. Veja [Captura de pacotes](/docs/probe/packet-capture). |
| `PROBE_PACKET_CAPTURE_MAX_DURATION_IN_SECONDS` | `1800` | A captura de pacotes mais longa que esta sonda executa, de 5 a 1800. |
| `PROBE_PACKET_CAPTURE_MAX_FILE_SIZE_IN_MB` | `25` | O maior arquivo de captura que esta sonda cria, de 1 a 25. |

### Onde a sonda escuta

Uma sonda só abre conexões de saída, a menos que você ative um listener, ou mantenha um que vem ativado por padrão:

| Listener | Configuração | Padrão | Saiba mais |
| --- | --- | --- | --- |
| Requisições recebidas e heartbeats | `PROBE_INGRESS_PORT` | Desativado | [Ingress de requisições recebidas](/docs/probe/incoming-request-ingress) |
| Traps SNMP | `PROBE_SNMP_TRAP_RECEIVER_ENABLED` | Ativado, UDP 162 | [Monitor de dispositivos de rede](/docs/monitor/network-device-monitor) |
| Syslog | `PROBE_SYSLOG_RECEIVER_ENABLED` | Desativado, UDP 5140 | [Guias por fornecedor de rede](/docs/monitor/network-vendor-guides) |
| NetFlow, IPFIX e sFlow | `PROBE_NETFLOW_RECEIVER_ENABLED` | Ativado, UDP 2055, 4739 e 6343 | [Tráfego de rede](/docs/monitor/network-traffic) |
| Verificações de saúde | `PORT` | Ativado, TCP 3874 | `/status/live` e `/status/ready` |

Dentro de um contêiner, uma porta só é alcançável de outras máquinas com a rede do host ou quando você a publica.

O receptor de syslog encaminha no máximo `PROBE_SYSLOG_RATE_LIMIT_PER_MINUTE` mensagens por minuto, `600` por padrão, descarta o resto e registra quantas descartou.

`PROBE_NAME` e `PROBE_DESCRIPTION` só são lidas pelas sondas que se registram sozinhas com `REGISTER_PROBE_KEY`, como as sondas que uma instalação auto-hospedada executa para todos os projetos. Uma sonda personalizada pega o nome e a descrição do painel.

## Solução de problemas

### Diagnosticar uma sonda desconectada

Uma sonda é marcada como `Disconnected` quando suas requisições ao OneUptime deixam de ter sucesso. O log da sonda diz onde cada requisição que falhou ficou presa, então raramente você precisa adivinhar.

:::steps
#### Ler o bloco de ambiente impresso na inicialização

Toda sonda imprime na inicialização um bloco JSON com a URL do OneUptime que está usando, o prazo das requisições, as configurações de proxy, os resolvedores DNS que herdou, a versão do Node e do sistema operacional, e se a verificação TLS foi desativada. Inclua esse bloco sempre que relatar um problema.

#### Encontrar o relatório de falha

Cada requisição ao OneUptime que falha registra um bloco com `stalledAt` e `whatThisMeans`. `stalledAt` é a fase que a requisição nunca passou:

| `stalledAt` | O que significa |
| --- | --- |
| `SocketAssignment` | Nada saiu da máquina. O pool de sockets estava saturado, ou um proxy configurado nunca concluiu seu túnel CONNECT. |
| `TcpConnect` | A máquina enviou SYN e não recebeu nada de volta: um firewall ou equipamento de segurança está descartando pacotes, ou o host está inalcançável. |
| `TlsHandshake` | O TCP conectou, o TLS nunca terminou. Geralmente um equipamento intermediário que inspeciona TLS. |
| `RequestSend` | Conectou, mas a requisição nunca foi escrita por inteiro: o outro lado parou de ler. |
| `WaitingForServerResponse` | A requisição foi entregue e o servidor não devolveu nada. **A rede da sonda está bem**: verifique o servidor do OneUptime, seu balanceador de carga e seu proxy reverso. |
| `ResponseBody` | O servidor começou a responder e travou no meio. |

O mesmo bloco também informa `deadlineOverrunInMs`. Se um prazo de 45000ms levou muito mais que 45000ms de tempo real, o próprio processo da sonda estava bloqueado: verifique `probeProcess.eventLoopMaxDriftInMs` no bloco antes de investigar a rede.

#### Ler o autoteste de conectividade

Depois de três falhas consecutivas, a sonda testa o mesmo servidor uma camada por vez (DNS, depois TCP, depois TLS, depois uma ida e volta HTTP real) e registra cada etapa com seu tempo. A primeira etapa que falha é a sua resposta. Quando há um proxy configurado, a sonda testa o trecho até o proxy, porque é o único trecho que ela realmente faz. O teste roda no máximo uma vez a cada cinco minutos.

#### Ficar de olho nas requisições lentas antes que falhem

As requisições que têm sucesso mas levam mais que `PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS` são registradas com o tempo decorrido. Uma sonda que começa a registrar requisições de 20 segundos está a caminho de ultrapassar o prazo de 45 segundos.
:::

No lado do servidor do OneUptime, uma requisição de sonda respondida devagar, ou que a sonda abandonou antes de uma resposta ser enviada, também é registrada, com o id da sonda. Esses dois logs juntos dizem de que lado da conexão está o problema.

### Outros problemas

:::details A sonda para logo depois de iniciar
O log dela diz o que falta: `PROBE_KEY is not set`, `PROBE_INGEST_URL or ONEUPTIME_URL is not set` ou `PROBE_ID or REGISTER_PROBE_KEY should be set`. Quando as três estão definidas mas o ID e a chave não correspondem a nenhuma sonda, a sonda tenta 10 vezes, com 30 segundos de intervalo, e então para com `Unable to register probe after 10 attempts`. Copie o ID e a chave de novo com **Mostrar ID e chave**.
:::

:::details A sonda funcionava até alguém redefinir a chave dela
**Redefinir chave da Sonda**, na página da sonda, cria uma chave nova e a antiga para de funcionar na hora. Copie a chave nova com **Mostrar ID e chave**, defina-a como `PROBE_KEY` e reinicie a sonda.
:::

:::details Um monitor diz que não consegue alcançar um endereço privado
As sondas recusam endereços privados até que você os permita. Defina `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS=true` na sonda e reinicie-a: veja [Acesso à rede privada](/docs/self-hosted/private-network-access).
:::

Se o problema continuar, abra uma issue no [GitHub](https://github.com/oneuptime/oneuptime) ou [fale com o suporte](https://oneuptime.com/support).

## Próximos passos

:::cards
- [Criar um monitor](/docs/monitor/create-monitor): Escolher o que verificar e quais sondas o verificam.
- [Ingress de requisições recebidas](/docs/probe/incoming-request-ingress): Deixar serviços sem acesso à internet enviarem heartbeats pela sonda.
- [Captura de pacotes](/docs/probe/packet-capture): Capturar pelo painel o tráfego que a sonda vê.
- [Acesso à rede privada](/docs/self-hosted/private-network-access): Deixar uma sonda verificar endereços privados.
:::
