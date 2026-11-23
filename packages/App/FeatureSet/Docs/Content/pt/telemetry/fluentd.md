# Fluentd

O [Fluentd](https://www.fluentd.org/) coleta logs de arquivos, contêineres, syslog, aplicações e [muitas outras fontes](https://www.fluentd.org/datasources). A sua [saída HTTP](https://docs.fluentd.org/output/http) embutida os envia ao endpoint Fluentd do OneUptime, onde passam a ser pesquisáveis em **Produtos → Registros**.

:::cards
- [Configurar o Fluentd](#configurar-o-fluentd): Adicione uma saída HTTP que aponte para o OneUptime.
- [Como os registros são lidos](#como-os-registros-são-lidos): Quais campos viram a mensagem, a severidade e os atributos.
- [OneUptime auto-hospedado](#oneuptime-auto-hospedado): Aponte o Fluentd para a sua própria instância.
:::

## Como funciona

```mermaid title="Do Fluentd ao OneUptime"
flowchart TB
    sources["Arquivos, contêineres, syslog, aplicações"] --> fluentd["Fluentd"]
    fluentd -->|"Saída HTTP, JSON + chave de ingestão"| ingest["OneUptime /fluentd/logs"]
    ingest --> service["Serviço indicado na requisição"]
    service --> logs["Logs"]
```

O Fluentd envia os registros em lotes como JSON, com a sua chave de ingestão no cabeçalho `x-oneuptime-token` e o nome do serviço em `x-oneuptime-service-name`. O OneUptime transforma cada registro num log desse serviço e cria o serviço na primeira vez que ele envia.

## Antes de começar

- **Instalar o Fluentd** — veja o [guia de instalação](https://docs.fluentd.org/installation).
- **Um projeto do OneUptime.** No OneUptime Cloud, a telemetria é cobrada por GB ingerido — veja os [preços](https://oneuptime.com/pricing) — e um projeto no plano Free precisa de um método de pagamento antes de poder enviar telemetria.
- **Uma chave de ingestão de telemetria.** Se você ainda não tem uma:

:::steps
### Abrir as chaves de ingestão

Vá em **Produtos → Configurações do projeto**, abra **Telemetria e APM** no menu lateral e selecione **Chaves de ingestão**.

![A lista "Chaves de ingestão", com "Criar chave de ingestão" destacado](screen:ingestion-keys)

### Criar uma chave

Clique em **Criar chave de ingestão**. A janela já vem com o nome da chave preenchido e **Servidor** escolhido — o tipo de chave com que uma aplicação ou um collector envia —, então clique em **Criar chave de ingestão** para criá-la, ou renomeie-a antes.

### Copiar o segredo

A nova chave abre na própria página. Copie a **Chave secreta** dela: esse é o `YOUR_SERVICE_TOKEN` da configuração abaixo.

![A página de uma chave de ingestão de telemetria, com a chave secreta](/docs/static/images/TelemetryIngestionKeyView.png)
:::

## Configurar o Fluentd

O arquivo de configuração do Fluentd costuma ser `/etc/fluent/fluentd.conf`, ou `/etc/td-agent/td-agent.conf` no antigo pacote td-agent.

:::steps
### Adicionar uma saída HTTP

Adicione uma seção `<match>` que envie os registros ao OneUptime. Troque `YOUR_SERVICE_TOKEN` pela sua chave de ingestão e `YOUR_SERVICE_NAME` pelo nome com que os logs devem aparecer — qualquer nome que quiser:

```text title="fluentd.conf"
# Send the time Fluentd gave each event: the HTTP output sends only the record
<filter **>
  @type record_transformer
  enable_ruby true
  <record>
    fluentd_time ${time.utc.strftime("%Y-%m-%dT%H:%M:%S.%NZ")}
  </record>
</filter>

# Match all patterns
<match **>
  @type http

  endpoint https://oneuptime.com/fluentd/logs
  open_timeout 2

  headers {"x-oneuptime-token":"YOUR_SERVICE_TOKEN", "x-oneuptime-service-name":"YOUR_SERVICE_NAME"}

  content_type application/json
  json_array true

  # Send a batch again when OneUptime is busy (429) or restarting (502, 503, 504)
  retryable_response_codes 429,502,503,504

  <format>
    @type json
  </format>
  <buffer>
    # Keep the batches on disk until OneUptime takes them: a restart of Fluentd loses none
    @type file
    path /var/log/fluent/buffer/oneuptime
    total_limit_size 512m
    flush_interval 10s
    chunk_limit_size 900k
    # Try again at least every 30 seconds, for up to 72 hours
    retry_max_interval 30s
    retry_timeout 72h
  </buffer>
</match>

# Keep Fluentd's own logs out of OneUptime
<label @FLUENT_LOG>
  <match **>
    @type null
  </match>
</label>
```

`json_array true` envia cada bloco do buffer como um único array JSON, e `flush_interval 10s` envia o buffer a cada 10 segundos. `chunk_limit_size 900k` mantém cada requisição abaixo de 1 MB, o máximo que o OneUptime aceita neste endpoint.

O padrão do próprio Fluentd também funciona: sem `content_type` e `json_array true`, o Fluentd envia JSON delimitado por quebras de linha, um registro por linha, e o OneUptime lê cada linha como o registro que ela é, com `compress gzip` ou sem.

`@type file` guarda os lotes que ainda faltam enviar na pasta indicada por `path`, para que um reinício do Fluentd não perca nenhum deles; um buffer em memória, o padrão do Fluentd, perde o que guarda. O usuário do Fluentd precisa conseguir escrever nessa pasta: `/var/log/fluent` é a do fluent-package, `/var/log/td-agent` a do td-agent e `/fluentd/log` a da imagem `fluent/fluentd`. `total_limit_size 512m` guarda no máximo 512 MB ali; quando está cheio, o Fluentd não aceita mais registros até que um lote seja enviado.

`retryable_response_codes 429,502,503,504` envia um lote de novo quando o OneUptime está ocupado (`429`) ou reiniciando (`502`, `503`, `504`); sem essa configuração, o Fluentd descarta um lote diante de qualquer resposta que não seja `503`. `retry_max_interval 30s` espera no máximo 30 segundos entre as tentativas, e `retry_timeout 72h` descarta um lote que ainda não conseguiu enviar depois de 72 horas. O filtro `record_transformer` adiciona a hora que o Fluentd deu a cada registro, como `fluentd_time`: a saída HTTP envia só o registro, e o OneUptime lê dele a hora de um log.

### Reiniciar o Fluentd

Reinicie o serviço do Fluentd para que ele carregue a nova saída.

### Verificar se os logs chegam

Poucos segundos depois da próxima descarga, os logs aparecem em **Produtos → Registros**. O serviço aparece em **Produtos → Serviços** — se ainda não existia, o OneUptime o cria.
:::

## Exemplo completo

Esta configuração recebe registros pelo protocolo forward do Fluentd na porta `24224`, só deste host, e envia todos ao OneUptime:

```text title="fluentd.conf"
####
## Source descriptions:
##

## built-in TCP input
## @see https://docs.fluentd.org/input/forward
<source>
  @type forward
  port 24224
  # This host alone: see "Take records from other hosts" to open it
  bind 127.0.0.1
</source>

# Send the time Fluentd gave each event: the HTTP output sends only the record
<filter **>
  @type record_transformer
  enable_ruby true
  <record>
    fluentd_time ${time.utc.strftime("%Y-%m-%dT%H:%M:%S.%NZ")}
  </record>
</filter>

<match **>
  @type http

  endpoint https://oneuptime.com/fluentd/logs
  open_timeout 2

  headers {"x-oneuptime-token":"YOUR_SERVICE_TOKEN", "x-oneuptime-service-name":"YOUR_SERVICE_NAME"}

  content_type application/json
  json_array true

  # Send a batch again when OneUptime is busy (429) or restarting (502, 503, 504)
  retryable_response_codes 429,502,503,504

  <format>
    @type json
  </format>
  <buffer>
    # Keep the batches on disk until OneUptime takes them: a restart of Fluentd loses none
    @type file
    path /var/log/fluent/buffer/oneuptime
    total_limit_size 512m
    flush_interval 10s
    chunk_limit_size 900k
    # Try again at least every 30 seconds, for up to 72 hours
    retry_max_interval 30s
    retry_timeout 72h
  </buffer>
</match>

# Keep Fluentd's own logs out of OneUptime
<label @FLUENT_LOG>
  <match **>
    @type null
  </match>
</label>
```

`bind 127.0.0.1` aceita registros só deste host, como os do driver de logs `fluentd` do Docker, que envia para `localhost:24224`. Para enviar fontes diferentes como serviços diferentes, use uma seção `<match>` por tag, cada uma com o seu próprio `x-oneuptime-service-name` e o seu próprio `path` de buffer: o Fluentd não inicia com dois buffers no mesmo caminho.

## Receber registros de outros hosts

Com `bind 0.0.0.0` e sem seção `<security>`, qualquer pessoa que alcance a porta `24224` pode enviar logs ao OneUptime com a sua chave de ingestão. Para receber registros do Fluentd ou do Fluent Bit em outros hosts, escute em todos os endereços, peça a cada remetente uma chave compartilhada e use TLS. Substitua a seção `<source>` do exemplo completo por:

```text title="fluentd.conf on this host"
<source>
  @type forward
  port 24224
  bind 0.0.0.0
  <transport tls>
    cert_path /etc/fluent/certs/fluentd.crt
    private_key_path /etc/fluent/certs/fluentd.key
  </transport>
  <security>
    self_hostname fluentd.example.com
    shared_key YOUR_SHARED_KEY
  </security>
</source>
```

`cert_path` e `private_key_path` são um certificado para o nome deste host, aqui `fluentd.example.com`, e a sua chave, que o usuário do Fluentd precisa conseguir ler. O Fluentd avisa quando a chave não tem frase secreta; `private_key_passphrase` define uma. Substitua `YOUR_SHARED_KEY` por um segredo longo e aleatório, como um gerado por `openssl rand -base64 32`, e dê o mesmo a cada remetente:

```text title="fluentd.conf on each sender"
<match **>
  @type forward
  transport tls
  # The certificate of the authority that signed this host's; not needed for a public one
  tls_cert_path /etc/fluent/certs/ca.crt
  <security>
    self_hostname app-1.example.com
    shared_key YOUR_SHARED_KEY
  </security>
  <server>
    host fluentd.example.com
    port 24224
  </server>
  <buffer>
    @type file
    path /var/log/fluent/buffer/forward
  </buffer>
</match>

# Keep Fluentd's own logs out of OneUptime
<label @FLUENT_LOG>
  <match **>
    @type null
  </match>
</label>
```

A saída `forward` do Fluent Bit aceita as mesmas configurações: `Shared_Key`, `Self_Hostname`, `tls On` e `tls.ca_file`.

Um remetente sem a chave, ou sem TLS, é recusado. A chave nunca atravessa a rede: cada lado prova que a tem. Sem TLS, qualquer pessoa na rede entre os hosts pode ler os registros. Abra a porta `24224` no firewall do host só para os hosts que enviam. Se o Fluentd roda a partir do arquivo Docker Compose do guia de logs, publique também ali a porta em todos os endereços, `"24224:24224"`, e monte a pasta do certificado no contêiner.

## Como os registros são lidos

O OneUptime lê estes campos de cada registro:

| Campo do log | Lido do primeiro campo presente entre | Observações |
| --- | --- | --- |
| Corpo | `message`, `log`, `msg`, `body`, `text` | A linha de log. Um registro sem nenhum deles é guardado inteiro, como JSON. |
| Severidade | `level`, `severity`, `loglevel`, `log_level`, `priority`, `severityText`, `severity_text` | Nomes como `trace`, `debug`, `info`, `notice`, `warn`, `error`, `critical` e `fatal`, em maiúsculas ou minúsculas. Qualquer outro valor é guardado como `Unspecified`. |
| ID do trace | `trace_id`, `traceId`, `traceid` | Liga o log ao seu trace. |
| ID do span | `span_id`, `spanId`, `spanid` | Liga o log ao seu span. |
| Serviço | o cabeçalho `x-oneuptime-service-name` | `Fluentd` quando o cabeçalho não está definido. |
| Hora | `time`, `timestamp`, `@timestamp`, `ts`, `fluentd_time` | Uma hora ISO 8601, como `2026-11-14T08:00:00.123Z`, ou segundos, milissegundos, microssegundos ou nanossegundos desde a época Unix; uma hora sem fuso horário é UTC. Uma hora anterior a 2000, ou mais de um dia à frente, não é lida. O campo de onde a hora é lida não é guardado como atributo. Um registro sem hora é armazenado na hora em que o OneUptime o recebe. |

Qualquer outro campo vira um atributo chamado `fluentd.` seguido do nome do campo, pelo qual você pode pesquisar e filtrar: um campo `container_name` é `@fluentd.container_name` no explorador de registros. Um objeto aninhado é achatado com pontos, como `fluentd.kubernetes.pod_name`, e uma lista é guardada como JSON.

Os logs do Fluentd passam pelos seus [pipelines de registros](/docs/telemetry/log-pipelines), filtros de descarte e regras de mascaramento como qualquer outro log.

## OneUptime auto-hospedado

Troque `https://oneuptime.com` em `endpoint` pela URL da sua instância do OneUptime: `http(s)://YOUR_ONEUPTIME_HOST/fluentd/logs`.

## Solução de problemas

:::details O Fluentd registra `401` da saída HTTP
A chave de ingestão está ausente, é desconhecida ou expirou. Confira o valor de `x-oneuptime-token` em `headers`.
:::

:::details O Fluentd registra `402` ou `422`
`402`: no OneUptime Cloud, o projeto está no plano Free e não tem método de pagamento. Adicione um em **Configurações do projeto → Cobrança e faturas → Cobrança**. `422`: a chave está desativada, ou é uma chave de navegador. Ligue de novo **Habilitado** nas configurações da chave, ou crie uma chave **Servidor**.
:::

:::details O Fluentd registra `413`
A requisição passa de 1 MB, o máximo que o OneUptime aceita neste endpoint. Defina `chunk_limit_size 900k` na seção `<buffer>`, como na configuração acima.
:::

:::details O Fluentd registra `429`, `502`, `503` ou `504`
O OneUptime está ocupado ou reiniciando. Com `retryable_response_codes 429,502,503,504` na seção `<match>`, como na configuração acima, o Fluentd guarda o lote e o envia de novo; sem essa configuração, o Fluentd descarta o lote. Com `@type file` na seção `<buffer>`, o Fluentd também guarda o lote quando reinicia.
:::

:::details Os logs mostram a hora em que o OneUptime os recebeu, não a deles
O OneUptime lê a hora de um log do seu registro, e a saída HTTP do Fluentd envia só o registro. Uma seção `<parse>` tira o campo `time` do registro, como a hora do evento: adicione `time_key fluentd_time` a ela, para que não leia a hora de nenhum registro e deixe `time` como está. Adicione também o filtro `record_transformer` da configuração acima: ele adiciona a hora que o Fluentd deu a cada registro, como `fluentd_time`.
:::

:::details Uma linha JSON cujo `time` é `null`, `true`, uma lista ou um objeto nunca chega
O parser `json` do Fluentd lê o campo `time` de uma linha como a hora do evento, e descarta sem aviso uma linha cujo `time` não é nem texto nem um número. Adicione `time_key fluentd_time` à sua seção `<parse>`, como acima: o Fluentd deixa então `time` no registro como está. Com o filtro `record_transformer` acima, o OneUptime guarda o log na hora em que o Fluentd o leu, `fluentd_time`; sem ele, na hora em que o OneUptime o recebe.
:::

:::details Os logs chegam ao serviço `Fluentd`
Falta o cabeçalho `x-oneuptime-service-name`. Adicione-o a `headers` em cada seção `<match>`.
:::

:::details O corpo do log mostra o registro inteiro como JSON
O OneUptime pega o corpo do primeiro campo presente entre `message`, `log`, `msg`, `body` ou `text`, e guarda o registro inteiro quando ele não tem nenhum deles. Renomeie o campo que contém a sua linha de log para um desses, por exemplo com o filtro `record_transformer` do Fluentd.
:::

Se tiver dúvidas ou precisar de ajuda com a configuração, escreva para support@oneuptime.com.

## Próximos passos

:::cards
- [Pipelines de registros](/docs/telemetry/log-pipelines): Analise e enriqueça os logs que o Fluentd envia.
- [Sintaxe de pesquisa](/docs/telemetry/search-syntax): Encontre os logs no explorador de registros.
- [Fluent Bit](/docs/telemetry/fluentbit): Um agente mais leve que envia por OpenTelemetry.
- [Monitor de logs](/docs/monitor/logs-monitor): Alerte quando aparecerem logs correspondentes.
:::
