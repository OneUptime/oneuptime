# Ingress de Requisição de Entrada

Uma Probe Personalizada pode opcionalmente executar um **listener HTTP de entrada** que aceita chamadas de `heartbeat` e `incoming-request` de dentro da sua rede privada e as encaminha para o OneUptime. Isso permite que serviços sem **acesso à internet de saída** ainda se reportem a um [Monitor de Requisição de Entrada](/docs/monitor/incoming-request-monitor) enviando a requisição para uma probe na rede local em vez de `oneuptime.com` diretamente.

## Visão Geral

Quando `PROBE_INGRESS_PORT` está definido, a probe vincula um listener HTTP adicional nessa porta. O listener aceita os mesmos caminhos de URL de `secretkey` dos endpoints públicos do OneUptime:

- `POST /heartbeat/:secretkey`
- `GET /heartbeat/:secretkey`
- `POST /incoming-request/:secretkey`
- `GET /incoming-request/:secretkey`

A probe então faz proxy da requisição para a sua instância do OneUptime, preservando o método, o corpo e os cabeçalhos de requisição (menos cabeçalhos hop-by-hop como `Host`, `Connection`, `Content-Length`, etc.). A probe anexa automaticamente um cabeçalho `OneUptime-Probe-Id` para que a requisição seja atribuída à probe de encaminhamento.

O listener é executado em uma **porta dedicada**, separada dos endpoints internos de status/métricas da probe, para que você possa expô-lo à sua rede privada sem expor mais nada.

## Quando usar isso

Use o listener de ingress quando:

- Seus serviços executam em um segmento de rede isolado sem acesso HTTPS de saída
- Você precisa manter todo o tráfego de monitoramento dentro do seu VPC / rede on-premises
- Você quer um único ponto de egress — a probe — que tenha permissão para alcançar o OneUptime
- Você já implantou uma [Probe Personalizada](/docs/probe/custom-probe) e quer reutilizá-la para heartbeats de entrada

Se seus serviços já podem alcançar `https://oneuptime.com` (ou sua URL auto-hospedada) diretamente, você **não** precisa deste recurso — chame a URL de heartbeat diretamente do serviço.

## Habilitando o listener de ingress

Defina `PROBE_INGRESS_PORT` para a porta à qual você quer que o listener seja vinculado. Qualquer valor maior que `0` habilita o listener; deixar não definido (ou `0`) o desabilita.

### Docker

```bash
docker run --name oneuptime-probe --network host \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e PROBE_INGRESS_PORT=3875 \
  -d oneuptime/probe:release
```

Se você não estiver usando `--network host`, publique a porta de ingress explicitamente:

```bash
docker run --name oneuptime-probe \
  -e PROBE_KEY=<probe-key> \
  -e PROBE_ID=<probe-id> \
  -e ONEUPTIME_URL=https://oneuptime.com \
  -e PROBE_INGRESS_PORT=3875 \
  -p 3875:3875 \
  -d oneuptime/probe:release
```

### Docker Compose

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
      - PROBE_INGRESS_PORT=3875
    ports:
      - "3875:3875"
    restart: always
```

### Kubernetes

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
            - name: PROBE_INGRESS_PORT
              value: "3875"
          ports:
            - name: ingress
              containerPort: 3875
---
apiVersion: v1
kind: Service
metadata:
  name: oneuptime-probe-ingress
spec:
  selector:
    app: oneuptime-probe
  ports:
    - name: ingress
      port: 3875
      targetPort: 3875
  type: ClusterIP
```

Os serviços internos podem então enviar heartbeats para `http://oneuptime-probe-ingress.<namespace>.svc.cluster.local:3875/heartbeat/<secret-key>`.

## Enviando requisições para a probe

Substitua a URL de heartbeat pública:

```
https://oneuptime.com/heartbeat/<secret-key>
```

pela URL de ingress da probe:

```
http://<probe-host>:<PROBE_INGRESS_PORT>/heartbeat/<secret-key>
```

O caminho, método, corpo e cabeçalhos são idênticos, portanto, qualquer código de cliente existente só precisa alterar a URL base.

### Exemplos

```bash
# GET heartbeat
curl http://probe.internal:3875/heartbeat/YOUR_SECRET_KEY

# POST heartbeat with JSON body
curl -X POST http://probe.internal:3875/heartbeat/YOUR_SECRET_KEY \
  -H "Content-Type: application/json" \
  -d '{"status": "healthy", "version": "1.2.3"}'

# Cron job
*/5 * * * * curl -s http://probe.internal:3875/heartbeat/YOUR_SECRET_KEY > /dev/null
```

## Comportamento de encaminhamento

- **Resposta síncrona, encaminhamento assíncrono.** A probe reconhece a requisição de entrada imediatamente com um `200` e encaminha para o OneUptime em segundo plano. Seu serviço não precisa aguardar a conclusão do encaminhamento.
- **Cabeçalhos são preservados.** Todos os cabeçalhos exceto os hop-by-hop (`Host`, `Connection`, `Content-Length`, `Transfer-Encoding`, `Keep-Alive`, `Proxy-Authenticate`, `Proxy-Authorization`, `TE`, `Trailer`, `Upgrade`) são passados. A probe adiciona um cabeçalho `OneUptime-Probe-Id` se identificando.
- **O corpo é preservado.** Payloads JSON, URL-encoded e `application/octet-stream` bruto até **50 MB** são aceitos.
- **Tentativas com backoff.** Se o encaminhamento falhar, a probe tenta novamente até `PROBE_INGRESS_FORWARD_RETRY_LIMIT` vezes com backoff exponencial (2s, 4s, 8s, limitado a 15s).
- **Ciente de proxy.** Se a própria probe estiver configurada com `HTTP_PROXY_URL` / `HTTPS_PROXY_URL`, as requisições encaminhadas passarão pelo proxy.

## Variáveis de ambiente

| Variável | Padrão | Descrição |
|---|---|---|
| `PROBE_INGRESS_PORT` | _não definido_ (desabilitado) | Porta à qual o listener de entrada é vinculado. Qualquer valor `> 0` habilita o ingress. |
| `PROBE_INGRESS_FORWARD_TIMEOUT_MS` | `10000` | Timeout (ms) para cada tentativa de encaminhamento para o OneUptime. Mínimo `1000`. |
| `PROBE_INGRESS_FORWARD_RETRY_LIMIT` | `3` | Número de tentativas antes de a probe desistir de um encaminhamento. Defina como `0` para desabilitar tentativas. |

As variáveis padrão de probe (`PROBE_KEY`, `PROBE_ID`, `ONEUPTIME_URL`, variáveis de proxy) todas se aplicam — consulte [Probes Personalizadas](/docs/probe/custom-probe) para a lista completa.

## Considerações de segurança

- **O endpoint não tem autenticação por design** — a chave secreta no caminho da URL *é* a autenticação, assim como no endpoint público `oneuptime.com`. Trate a chave secreta como uma credencial.
- **Vincule apenas a uma interface privada.** O listener de ingress não deve ser acessível pela internet pública. Use uma política de rede, regra de firewall ou serviço `ClusterIP` para restringir o acesso.
- **Use terminação HTTPS se precisar de criptografia em trânsito.** O listener da probe fala HTTP simples. Coloque-o atrás de um balanceador de carga interno / controlador de ingress se precisar de TLS na conexão de entrada. A etapa de encaminhamento da probe → OneUptime sempre usa HTTPS (assumindo que `ONEUPTIME_URL` seja `https://`).
- **Limites de recursos.** O listener aceita corpos de requisição de até 50 MB. Se precisar de um limite mais restrito, coloque um proxy reverso na frente.

## Solução de Problemas

- **Probe registra `Probe ingress listener started on port <port>` na inicialização** — confirma que o listener está ativo. Se você não ver esta linha, `PROBE_INGRESS_PORT` está não definido, é `0` ou é inválido.
- **`Probe ingress: failed to forward to <url> after N attempts`** — a probe não conseguiu alcançar o OneUptime. Verifique a conectividade de saída da probe, as configurações de proxy e o valor de `ONEUPTIME_URL`.
- **`Probe ingress: probe ID not available, forwarding without it`** — a probe ainda não se registrou. O encaminhamento ainda é bem-sucedido; o heartbeat simplesmente não será atribuído a uma probe.
- **Heartbeat aparece no OneUptime mas não via a probe** — confirme se seu serviço está atingindo `http://<probe-host>:<port>/...` e não a URL pública. Uma entrada mal configurada de DNS ou `/etc/hosts` é a causa usual.

## Relacionado

- [Probes Personalizadas](/docs/probe/custom-probe)
- [Monitor de Requisição de Entrada](/docs/monitor/incoming-request-monitor)
