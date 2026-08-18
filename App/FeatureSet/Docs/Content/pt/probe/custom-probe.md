## Configurando Probes Personalizadas

Você pode configurar probes personalizadas dentro da sua rede para monitorar recursos na sua rede privada ou recursos que estão atrás do seu firewall.

Para começar, você precisa criar uma probe personalizada no seu Painel do OneUptime, em Monitores > Configurações > Sondas. Depois de criar a probe personalizada no seu Painel do OneUptime, você deve ter o `PROBE_ID` e `PROBE_KEY`.

### Implantar Probe

#### Docker

Para executar uma probe, certifique-se de ter o Docker instalado. Você pode executar a probe personalizada com:

```
docker run --name oneuptime-probe --network host -e PROBE_KEY=<probe-key> -e PROBE_ID=<probe-id> -e ONEUPTIME_URL=https://oneuptime.com -d oneuptime/probe:release
```

Se você estiver auto-hospedando o OneUptime, pode alterar `ONEUPTIME_URL` para sua instância auto-hospedada personalizada.

##### Configuração de Proxy

Se sua probe precisa passar por um servidor proxy para alcançar o OneUptime ou monitorar recursos externos, você pode configurar as definições de proxy usando estas variáveis de ambiente:

```
# For HTTP proxy
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e HTTP_PROXY_URL=http://proxy.example.com:8080 \
  -e NO_PROXY=localhost,.internal.example.com \
  -d oneuptime/probe:release

# For HTTPS proxy
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e HTTPS_PROXY_URL=http://proxy.example.com:8080 \
  -e NO_PROXY=localhost,.internal.example.com \
  -d oneuptime/probe:release

# With proxy authentication
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e HTTP_PROXY_URL=http://username:password@proxy.example.com:8080 \
  -e HTTPS_PROXY_URL=http://username:password@proxy.example.com:8080 \
  -e NO_PROXY=localhost,.internal.example.com \
  -d oneuptime/probe:release
```

#### Docker Compose

Você também pode executar a probe usando docker-compose. Crie um arquivo `docker-compose.yml` com o seguinte conteúdo:

```yaml
version: "3"

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

##### Com Configuração de Proxy

Se você precisar usar um servidor proxy, pode adicionar variáveis de ambiente de proxy:

```yaml
version: "3"

services:
  oneuptime-probe:
    image: oneuptime/probe:release
    container_name: oneuptime-probe
    environment:
      - PROBE_KEY=<probe-key>
      - PROBE_ID=<probe-id>
      - ONEUPTIME_URL=https://oneuptime.com
      # Proxy configuration (optional)
      - HTTP_PROXY_URL=http://proxy.example.com:8080
      - HTTPS_PROXY_URL=http://proxy.example.com:8080
      - NO_PROXY=localhost,.internal.example.com
      # For proxy with authentication:
      # - HTTP_PROXY_URL=http://username:password@proxy.example.com:8080
      # - HTTPS_PROXY_URL=http://username:password@proxy.example.com:8080
      # - NO_PROXY=localhost,.internal.example.com
    network_mode: host
    restart: always
```

Em seguida, execute o seguinte comando:

```
docker compose up -d
```

Se você estiver auto-hospedando o OneUptime, pode alterar `ONEUPTIME_URL` para sua instância auto-hospedada personalizada.

#### Kubernetes

Você também pode executar a probe usando Kubernetes. Crie um arquivo `oneuptime-probe.yaml` com o seguinte conteúdo:

```yaml
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

##### Com Configuração de Proxy

Se você precisar usar um servidor proxy, pode adicionar variáveis de ambiente de proxy:

```yaml
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
            # Proxy configuration (optional)
            - name: HTTP_PROXY_URL
              value: "http://proxy.example.com:8080"
            - name: HTTPS_PROXY_URL
              value: "http://proxy.example.com:8080"
            - name: NO_PROXY
              value: "localhost,.internal.example.com"
            # For proxy with authentication, use:
            # - name: HTTP_PROXY_URL
            #   value: "http://username:password@proxy.example.com:8080"
            # - name: HTTPS_PROXY_URL
            #   value: "http://username:password@proxy.example.com:8080"
            # - name: NO_PROXY
            #   value: "localhost,.internal.example.com"
```

Em seguida, execute o seguinte comando:

```bash
kubectl apply -f oneuptime-probe.yaml
```

Se você estiver auto-hospedando o OneUptime, pode alterar `ONEUPTIME_URL` para sua instância auto-hospedada personalizada.

### Variáveis de Ambiente

A probe suporta as seguintes variáveis de ambiente:

#### Variáveis Obrigatórias

- `PROBE_KEY` - A chave da probe do seu painel do OneUptime
- `PROBE_ID` - O ID da probe do seu painel do OneUptime
- `ONEUPTIME_URL` - A URL da sua instância do OneUptime (padrão: https://oneuptime.com)

#### Variáveis Opcionais

- `HTTP_PROXY_URL` - URL do servidor proxy HTTP para requisições HTTP
- `HTTPS_PROXY_URL` - URL do servidor proxy HTTP para requisições HTTPS
- `NO_PROXY` - Hosts ou domínios separados por vírgula que devem ignorar o proxy
- `PROBE_NAME` - Nome personalizado para a probe
- `PROBE_DESCRIPTION` - Descrição para a probe
- `PROBE_MONITORING_WORKERS` - Número de workers de monitoramento (padrão: 1)
- `PROBE_MONITOR_FETCH_LIMIT` - Número de monitores para buscar de uma vez (padrão: 10)
- `PROBE_MONITOR_RETRY_LIMIT` - Número de tentativas para monitores com falha (padrão: 3)
- `PROBE_SYNTHETIC_MONITOR_SCRIPT_TIMEOUT_IN_MS` - Timeout para scripts de monitor sintético em milissegundos (padrão: 60000)
- `PROBE_CUSTOM_CODE_MONITOR_SCRIPT_TIMEOUT_IN_MS` - Timeout para scripts de monitor de código personalizado em milissegundos (padrão: 60000)
- `PROBE_API_REQUEST_TIMEOUT_IN_MS` - Prazo limite para cada requisição que a probe envia ao OneUptime (padrão: 45000)
- `PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS` - Registra um aviso para requisições ao OneUptime mais lentas que este valor (padrão: 10000)
- `PROBE_MONITOR_CHECK_TIMEOUT_IN_MS` - Prazo para verificar um monitor, após o qual a verificação é abandonada e repetida no próximo ciclo (padrão: 900000)

#### Configuração de Proxy

A probe suporta servidores proxy HTTP e HTTPS. Quando configurada, a probe roteará todo o tráfego de monitoramento através dos servidores proxy especificados. Você também pode fornecer uma lista `NO_PROXY` separada por vírgula para ignorar o proxy para hosts ou redes internas.

**Formato da URL do Proxy:**

```
http://[username:password@]proxy.server.com:port
```

**Exemplos:**

- Proxy básico: `http://proxy.example.com:8080`
- Com autenticação: `http://username:password@proxy.example.com:8080`

**Recursos Suportados:**

- Suporte a proxy HTTP e HTTPS
- Autenticação de proxy (nome de usuário/senha)
- Fallback automático entre proxies HTTP e HTTPS
- Bypass seletivo de proxy usando `NO_PROXY`
- Funciona com todos os tipos de monitor (Site, API, SSL, Sintético, etc.)

**Nota:** Tanto as variáveis de ambiente padrão (`HTTP_PROXY_URL`, `HTTPS_PROXY_URL`, `NO_PROXY`) quanto as variantes em minúsculas (`http_proxy`, `https_proxy`, `no_proxy`) são suportadas para compatibilidade.

### Verificar

Se a probe estiver em execução com sucesso, ela deve aparecer como `Connected` no seu painel do OneUptime. Se não aparecer como conectada, você precisa verificar os logs do contêiner. Se ainda tiver problemas, crie um problema no [GitHub](https://github.com/oneuptime/oneuptime) ou [entre em contato com o suporte](https://oneuptime.com/support).

### Diagnosticando uma Probe Desconectada

Uma probe é marcada como `Disconnected` quando suas requisições ao OneUptime deixam de ser bem-sucedidas. O log da probe indica onde cada requisição com falha travou, então raramente você precisa adivinhar.

**1. Leia o bloco de ambiente impresso na inicialização.** Toda probe imprime um bloco JSON na inicialização com a URL do OneUptime que está usando, seu prazo limite de requisição, suas configurações de proxy, os resolvedores DNS que herdou, a versão do Node/SO e se a verificação TLS foi desabilitada. Inclua este bloco sempre que você relatar um problema.

**2. Encontre o relatório de falha.** Toda requisição com falha ao OneUptime registra um bloco contendo `stalledAt` e `whatThisMeans`. `stalledAt` é a fase da qual a requisição nunca passou:

| `stalledAt` | O que significa |
| --- | --- |
| `SocketAssignment` | Nada saiu da máquina. O pool de sockets estava saturado, ou um proxy configurado nunca completou seu túnel CONNECT. |
| `TcpConnect` | A máquina enviou SYN e não recebeu nada de volta — um firewall ou appliance de segurança está descartando pacotes, ou o host está inacessível. |
| `TlsHandshake` | O TCP conectou, mas o TLS nunca terminou. Normalmente um middlebox que inspeciona TLS. |
| `RequestSend` | Conectou, mas a requisição nunca foi totalmente escrita — a outra ponta parou de ler. |
| `WaitingForServerResponse` | A requisição foi entregue e o servidor não respondeu nada. **A rede da probe está bem** — verifique o servidor do OneUptime, seu balanceador de carga e seu proxy reverso. |
| `ResponseBody` | O servidor começou a responder e travou no meio do caminho. |

O mesmo bloco também informa `deadlineOverrunInMs`. Se um prazo limite de 45000ms levou muito mais que 45000ms de tempo real, o próprio processo da probe estava bloqueado — verifique `probeProcess.eventLoopMaxDriftInMs` no bloco antes de investigar a rede.

**3. Leia o autoteste de conectividade.** Após três falhas consecutivas, a probe testa o mesmo servidor uma camada por vez — DNS, depois TCP, depois TLS e, por fim, uma requisição HTTP real de ida e volta — e registra cada etapa com seus tempos. A primeira etapa que falhar é a sua resposta. Quando um proxy está configurado, a probe testa o salto até o proxy, porque esse é o único salto que ela realmente faz.

**4. Fique atento a requisições lentas antes que elas se tornem falhas.** Requisições que têm sucesso, mas demoram mais que `PROBE_API_SLOW_REQUEST_THRESHOLD_IN_MS`, são registradas com o tempo decorrido. Uma probe que começa a registrar requisições de 20 segundos está a caminho de ultrapassar o prazo limite de 45 segundos.

No lado do servidor do OneUptime, uma requisição de probe que é respondida lentamente — ou que a probe abandonou antes que uma resposta fosse enviada — também é registrada lá, com o id da probe. Esses dois logs em conjunto dizem qual lado da conexão é o responsável.
