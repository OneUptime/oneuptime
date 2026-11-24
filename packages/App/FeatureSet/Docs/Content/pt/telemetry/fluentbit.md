# Fluent Bit

O [Fluent Bit](https://docs.fluentbit.io/manual) é um agente leve que coleta logs de arquivos, systemd, contêineres, syslog, HTTP e muitas outras fontes. A sua [saída OpenTelemetry](https://docs.fluentbit.io/manual/pipeline/outputs/opentelemetry) envia o que ele coleta ao endpoint OpenTelemetry (OTLP) do OneUptime, onde os logs passam a ser pesquisáveis em **Produtos → Registros**.

:::cards
- [Configurar o Fluent Bit](#configurar-o-fluent-bit): Adicione a saída OpenTelemetry e dê nome ao seu serviço.
- [Exemplo completo](#exemplo-completo): Um arquivo de configuração inteiro para começar.
- [OneUptime auto-hospedado](#oneuptime-auto-hospedado): Aponte o Fluent Bit para a sua própria instância.
:::

## Como funciona

```mermaid title="Do Fluent Bit ao OneUptime"
flowchart TB
    sources["Arquivos, contêineres, syslog, HTTP"] --> inputs["Entradas do Fluent Bit"]
    inputs --> envelope["Processador opentelemetry_envelope"]
    envelope --> name["content_modifier define service.name"]
    name --> output["Saída opentelemetry"]
    output -->|"OTLP/HTTP + chave de ingestão"| oneuptime["OneUptime /otlp/v1/logs"]
    oneuptime --> logs["Logs"]
```

O Fluent Bit embrulha cada registro num envelope do OpenTelemetry, para que ele possa levar atributos de recurso como `service.name`. Depois, a saída OpenTelemetry envia os registros ao OneUptime com a sua chave de ingestão no cabeçalho `x-oneuptime-token`. O OneUptime os guarda sob o serviço nomeado por `service.name` e cria esse serviço na primeira vez que ele envia.

## Antes de começar

- **Instalar o Fluent Bit** — veja o [guia de instalação](https://docs.fluentbit.io/manual/installation/getting-started-with-fluent-bit). A configuração desta página usa o formato YAML do Fluent Bit e o processador `opentelemetry_envelope`, então use uma versão atual.
- **Um projeto do OneUptime.** No OneUptime Cloud, a telemetria é cobrada por GB ingerido — veja os [preços](https://oneuptime.com/pricing) — e um projeto no plano Free precisa de um método de pagamento antes de poder enviar telemetria.
- **Uma chave de ingestão de telemetria.** Se você ainda não tem uma:

:::steps
### Abrir as chaves de ingestão

Vá em **Produtos → Configurações do projeto**, abra **Telemetria e APM** no menu lateral e selecione **Chaves de ingestão**.

![A lista "Chaves de ingestão", com "Criar chave de ingestão" destacado](screen:ingestion-keys)

### Criar uma chave

Clique em **Criar chave de ingestão**. A janela já vem com o nome da chave preenchido e **Servidor** escolhido — o tipo de chave com que uma aplicação ou um collector envia —, então clique em **Criar chave de ingestão** para criá-la, ou renomeie-a antes.

### Copiar o segredo

A nova chave abre na própria página. Copie a **Chave secreta** dela: esse é o `YOUR_TELEMETRY_INGESTION_TOKEN` da configuração abaixo.

![A página de uma chave de ingestão de telemetria, com a chave secreta](/docs/static/images/TelemetryIngestionKeyView.png)
:::

## Configurar o Fluent Bit

O Fluent Bit lê a sua configuração YAML de um arquivo como `/etc/fluent-bit/fluent-bit.yaml`.

:::steps
### Adicionar a saída OpenTelemetry

Adicione uma saída `opentelemetry` que envie ao OneUptime. Mantenha a saída `stdout` enquanto testa, se quiser ver os registros localmente:

```yaml title="fluent-bit.yaml"
service:
  # Keep the chunks still to send on disk: a restart of Fluent Bit loses none
  storage.path: /var/lib/fluent-bit/buffer
  storage.sync: normal
  # Try a chunk again about every 30 seconds
  scheduler.base: 30
  scheduler.cap: 30

pipeline:
  outputs:
    - name: stdout
      match: "*"
    - name: opentelemetry
      match: "*"
      host: "oneuptime.com"
      port: 443
      metrics_uri: "/otlp/v1/metrics"
      logs_uri: "/otlp/v1/logs"
      traces_uri: "/otlp/v1/traces"
      tls: On
      header:
        - x-oneuptime-token YOUR_TELEMETRY_INGESTION_TOKEN
      # Send a chunk again when OneUptime is busy or restarting, for about 72 hours
      retry_limit: 8640
      # At most 512 MB on disk: when it is full, the oldest chunks are dropped
      storage.total_limit_size: 512M
```

`retry_limit: 8640` envia de novo um chunk quando o OneUptime está ocupado (`429`) ou reiniciando (`502`, `503`, `504`), mais ou menos a cada 30 segundos (`scheduler.base` e `scheduler.cap`), por cerca de 72 horas; o padrão do Fluent Bit é tentar mais uma vez e descartá-lo. `storage.path` guarda em disco os chunks que ainda faltam enviar, para que um reinício do Fluent Bit não perca nenhum, para cada entrada com `storage.type: filesystem`, como no próximo passo. O Fluent Bit precisa conseguir escrever nessa pasta: o serviço do pacote roda como root, e à mão rode-o com `sudo`. `storage.total_limit_size: 512M` guarda no máximo 512 MB para a saída; quando está cheio, os chunks mais antigos são descartados.

### Embrulhar os logs num envelope do OpenTelemetry e nomear o serviço

Adicione o processador `opentelemetry_envelope` a cada entrada, seguido de um `content_modifier` que define `service.name`. Troque `YOUR_SERVICE_NAME` pelo nome com que os logs devem aparecer no OneUptime:

```yaml title="fluent-bit.yaml"
pipeline:
  inputs:
    - name: tail # or any other input
      path: /var/log/my-app/*.log
      # Keep its place in each file, so a restart reads on from there
      db: /var/lib/fluent-bit/tail.db
      # Keep its chunks on disk until OneUptime takes them
      storage.type: filesystem

      processors:
        logs:
          - name: opentelemetry_envelope

          - name: content_modifier
            context: otel_resource_attributes
            action: upsert
            key: service.name
            value: YOUR_SERVICE_NAME
```

`db` guarda a posição do tail em cada arquivo, para que um reinício continue lendo dali; sem ele, o Fluent Bit recomeça no fim de cada arquivo, e as linhas escritas enquanto estava parado nunca são enviadas. `storage.type: filesystem` guarda os chunks da entrada em `storage.path`.

### Reiniciar o Fluent Bit

O serviço do pacote `fluent-bit` lê `/etc/fluent-bit/fluent-bit.conf`, o exemplo do próprio pacote, não este arquivo. Aponte-o para `/etc/fluent-bit/fluent-bit.yaml` com um drop-in e depois inicie-o agora e a cada inicialização:

```bash
sudo mkdir -p /etc/systemd/system/fluent-bit.service.d
printf '[Service]\nExecStart=\nExecStart=/opt/fluent-bit/bin/fluent-bit -c /etc/fluent-bit/fluent-bit.yaml\n' | sudo tee /etc/systemd/system/fluent-bit.service.d/fluent-bit-yaml.conf
sudo systemctl daemon-reload
sudo systemctl enable fluent-bit
sudo systemctl restart fluent-bit
```

O `ExecStart=` vazio apaga a linha de início do próprio pacote. Para testar o arquivo primeiro em primeiro plano, rode `sudo /opt/fluent-bit/bin/fluent-bit -c /etc/fluent-bit/fluent-bit.yaml`: o pacote coloca o programa em `/opt/fluent-bit/bin`, que não está no `PATH`. Em poucos segundos os logs aparecem em **Produtos → Registros**, e o serviço aparece em **Produtos → Serviços**.
:::

## Exemplo completo

Esta configuração recebe logs por HTTP na porta `8888`, só deste host, e os encaminha ao OneUptime:

```yaml title="fluent-bit.yaml"
service:
  flush: 1
  log_level: info
  # Keep the chunks still to send on disk: a restart of Fluent Bit loses none
  storage.path: /var/lib/fluent-bit/buffer
  storage.sync: normal
  # Try a chunk again about every 30 seconds
  scheduler.base: 30
  scheduler.cap: 30

pipeline:
  inputs:
    - name: http
      # This host alone may send here
      listen: 127.0.0.1
      port: 8888
      storage.type: filesystem

      processors:
        logs:
          - name: opentelemetry_envelope

          - name: content_modifier
            context: otel_resource_attributes
            action: upsert
            key: service.name
            value: YOUR_SERVICE_NAME

  outputs:
    - name: stdout
      match: "*"
    - name: opentelemetry
      match: "*"
      host: "oneuptime.com"
      port: 443
      metrics_uri: "/otlp/v1/metrics"
      logs_uri: "/otlp/v1/logs"
      traces_uri: "/otlp/v1/traces"
      tls: On
      header:
        - x-oneuptime-token YOUR_TELEMETRY_INGESTION_TOKEN
      # Send a chunk again when OneUptime is busy or restarting, for about 72 hours
      retry_limit: 8640
      # At most 512 MB on disk: when it is full, the oldest chunks are dropped
      storage.total_limit_size: 512M
```

`listen: 127.0.0.1` aceita logs só deste host: a entrada `http` não pede nenhuma chave, então com `listen: 0.0.0.0` qualquer pessoa que alcance a porta pode enviar logs ao OneUptime com a sua chave de ingestão. Troque a entrada `http` pelas entradas de que você precisa — por exemplo `tail` para arquivos de log ou `systemd` para o journal — e mantenha os dois processadores e `storage.type: filesystem` em cada uma delas.

## Enviar com a saída HTTP

A [saída HTTP](https://docs.fluentbit.io/manual/pipeline/outputs/http) do Fluent Bit também pode enviar ao endpoint Fluentd do OneUptime, que lê cada registro como descreve a [página do Fluentd](/docs/telemetry/fluentd). Defina `format` como `json_lines`, como abaixo, ou como `json`: o OneUptime lê os dois, comprimidos com `compress: gzip` ou não. O formato padrão do Fluent Bit, `msgpack`, é recusado.

```yaml title="fluent-bit.yaml"
pipeline:
  outputs:
    - name: http
      match: "*"
      host: "oneuptime.com"
      port: 443
      uri: "/fluentd/logs"
      format: json_lines
      # Send each record's time where OneUptime reads it
      json_date_key: timestamp
      tls: On
      header:
        - x-oneuptime-token YOUR_TELEMETRY_INGESTION_TOKEN
        - x-oneuptime-service-name YOUR_SERVICE_NAME
      # Send a chunk again when OneUptime is busy or restarting, for about 72 hours
      retry_limit: 8640
      # At most 512 MB on disk: when it is full, the oldest chunks are dropped
      storage.total_limit_size: 512M
```

## OneUptime auto-hospedado

Defina `host` como o host da sua instância do OneUptime. Se ela for servida por HTTP simples em vez de HTTPS, defina também `port` como a porta em que ela escuta (normalmente `80`) e remova `tls`:

```yaml title="fluent-bit.yaml"
pipeline:
  outputs:
    - name: stdout
      match: "*"
    - name: opentelemetry
      match: "*"
      host: "your-oneuptime-instance.com"
      port: 80
      metrics_uri: "/otlp/v1/metrics"
      logs_uri: "/otlp/v1/logs"
      traces_uri: "/otlp/v1/traces"
      header:
        - x-oneuptime-token YOUR_TELEMETRY_INGESTION_TOKEN
      # Send a chunk again when OneUptime is busy or restarting, for about 72 hours
      retry_limit: 8640
      # At most 512 MB on disk: when it is full, the oldest chunks are dropped
      storage.total_limit_size: 512M
```

## Solução de problemas

:::details O Fluent Bit registra `401` da saída OpenTelemetry
A chave de ingestão está ausente, é desconhecida ou expirou. Confira a linha `header`: é `x-oneuptime-token`, um espaço e depois a **Chave secreta** da chave.
:::

:::details O Fluent Bit registra `402` ou `422`
`402`: no OneUptime Cloud, o projeto está no plano Free e não tem método de pagamento. Adicione um em **Configurações do projeto → Cobrança e faturas → Cobrança**. `422`: a chave está desativada, ou é uma chave de navegador. Ligue de novo **Habilitado** nas configurações da chave, ou crie uma chave **Servidor**.
:::

:::details Os logs chegam a um serviço inesperado
O serviço vem de `service.name`. Verifique se cada entrada tem o processador `opentelemetry_envelope` seguido do `content_modifier` que o define.
:::

:::details Nada chega, e o Fluent Bit registra erros de conexão
Verifique se `tls: On` e `port: 443` estão definidos para um endpoint HTTPS, e se o host que executa o Fluent Bit alcança o seu host do OneUptime nessa porta.
:::

:::details O Fluent Bit registra `cannot be retried`
O Fluent Bit descartou um chunk que não conseguiu enviar. Com `retry_limit: 8640`, como na configuração acima, ele envia de novo um chunk ao qual o OneUptime responde `429`, `502`, `503` ou `504` mais ou menos a cada 30 segundos, por cerca de 72 horas; com o padrão do Fluent Bit, tenta só mais uma vez. Um `400`, `401`, `402`, `413`, `422` ou `500` é descartado na hora, porque a resposta é a mesma toda vez: confira a chave, o plano e o tamanho da requisição.
:::

Se tiver dúvidas ou precisar de ajuda com a configuração, escreva para support@oneuptime.com.

## Próximos passos

:::cards
- [Pipelines de registros](/docs/telemetry/log-pipelines): Analise e enriqueça os logs que o Fluent Bit envia.
- [Sintaxe de pesquisa](/docs/telemetry/search-syntax): Encontre os logs no explorador de registros.
- [OpenTelemetry](/docs/telemetry/open-telemetry): Endpoints, chaves e limites para toda a telemetria.
- [Fluentd](/docs/telemetry/fluentd): Use o Fluentd em vez disso.
:::
