# Usar o Fluentd para enviar dados de telemetria para o OneUptime

## Visão Geral

Você pode usar o plugin [Fluentd](https://www.fluentd.org/) para coletar logs e dados de telemetria dos seus aplicativos e serviços. O plugin envia os dados de telemetria para a Fonte HTTP do OneUptime. Você pode usar o plugin de saída http do fluentd para enviar os dados de telemetria para a Fonte HTTP do OneUptime. Este plugin pode ser encontrado aqui: https://docs.fluentd.org/output/http

## Primeiros Passos

O Fluentd suporta centenas de fontes de dados e você pode ingerir logs de qualquer uma dessas fontes no OneUptime. Algumas das fontes populares incluem:

- Docker
- Syslog
- Apache
- Nginx
- MySQL
- PostgreSQL
- MongoDB
- NodeJS
- Ruby
- Python
- Java
- PHP
- Go
- Rust

e muitas mais.

Você pode encontrar a lista completa de fontes suportadas [aqui](https://www.fluentd.org/datasources)

## Pré-requisitos

- **Passo 1: Instalar o Fluentd no seu sistema** - Você pode instalar o Fluentd usando as instruções fornecidas [aqui](https://docs.fluentd.org/installation)
- **Passo 2: Registrar-se para uma conta do OneUptime** - Você pode se registrar para uma conta gratuita [aqui](https://oneuptime.com). Observe que enquanto a conta é gratuita, a ingestão de logs é um recurso pago. Você pode encontrar mais detalhes sobre os preços [aqui](https://oneuptime.com/pricing).
- **Passo 3: Criar Projeto do OneUptime** - Depois de ter a conta, você pode criar um projeto no painel do OneUptime. Se precisar de ajuda para criar um projeto ou tiver alguma dúvida, entre em contato conosco em support@oneuptime.com
- **Passo 4: Criar Token de Ingestão de Telemetria** - Depois de criar uma conta do OneUptime, você pode criar um token de ingestão de telemetria para ingerir logs, métricas e rastreamentos do seu aplicativo.

Depois de se registrar no OneUptime e criar um projeto. Clique em "More" na barra de navegação e clique em "Project Settings".

Na página de Chaves de Ingestão de Telemetria, clique em "Create Ingestion Key" para criar um token.

![Create Service](/docs/static/images/TelemetryIngestionKeys.png)

Depois de criar um token, clique em "View" para visualizá-lo.

![View Service](/docs/static/images/TelemetryIngestionKeyView.png)


## Configuração

Você pode usar a seguinte configuração para enviar os dados de telemetria para a Fonte HTTP do OneUptime. Você pode adicionar esta configuração ao arquivo de configuração do fluentd. O arquivo de configuração geralmente está localizado em `/etc/fluentd/fluent.conf` ou `/etc/td-agent/td-agent.conf`.

Você precisa substituir `YOUR_SERVICE_TOKEN` pelo token que você criou na etapa anterior. Você também precisa substituir `YOUR_SERVICE_NAME` pelo nome do seu serviço. O nome do serviço pode ser qualquer nome que você quiser. Se o serviço não existir no OneUptime, ele será criado automaticamente.

```yaml
# Match all patterns 
<match **>
  @type http

  endpoint https://oneuptime.com/fluentd/logs
  open_timeout 2

  headers {"x-oneuptime-token":"YOUR_SERVICE_TOKEN", "x-oneuptime-service-name":"YOUR_SERVICE_NAME"}

  content_type application/json
  json_array true

  <format>
    @type json
  </format>
  <buffer>
    flush_interval 10s
  </buffer>
</match>
```


Um exemplo de arquivo de configuração completo é mostrado abaixo:

```yaml
####
## Source descriptions:
##

## built-in TCP input
## @see https://docs.fluentd.org/input/forward
<source>
  @type forward
  port 24224
  bind 0.0.0.0
</source>

<match **>
  @type http

  endpoint https://oneuptime.com/fluentd/logs
  open_timeout 2

  headers {"x-oneuptime-token":"YOUR_SERVICE_TOKEN", "x-oneuptime-service-name":"YOUR_SERVICE_NAME"}

  content_type application/json
  json_array true

  <format>
    @type json
  </format>
  <buffer>
    flush_interval 10s
  </buffer>
</match>
```

**Se você estiver auto-hospedando o OneUptime**: Se você estiver auto-hospedando o OneUptime, pode substituir o `endpoint_url` pela URL da sua instância do OneUptime. `http(s)://SEU_HOST_ONEUPTIME/fluentd/logs`

## Uso

Depois de adicionar a configuração ao arquivo de configuração do fluentd, você pode reiniciar o serviço fluentd. Depois que o serviço for reiniciado, os dados de telemetria serão enviados para a Fonte HTTP do OneUptime. Agora você pode começar a ver os dados de telemetria no painel do OneUptime. Se tiver alguma dúvida ou precisar de ajuda com a configuração, entre em contato conosco em support@oneuptime.com
