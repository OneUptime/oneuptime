## Configurando Probes Personalizadas

Você pode configurar probes personalizadas dentro da sua rede para monitorar recursos na sua rede privada ou recursos que estão atrás do seu firewall.

Para começar, você precisa criar uma probe personalizada nas Configurações do Projeto > Probe. Depois de criar a probe personalizada no seu Painel do OneUptime, você deve ter o `PROBE_ID` e `PROBE_KEY`.

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
