# Använd Fluentd för att skicka telemetridata till OneUptime

## Översikt

Du kan använda [Fluentd](https://www.fluentd.org/)-plugin:et för att samla in loggar och telemetridata från dina applikationer och tjänster. Plugin:et skickar telemetridata till OneUptime HTTP Source. Du kan använda HTTP-utdataplugin:et för Fluentd för att skicka telemetridata till OneUptime HTTP Source. Det här plugin:et finns här: https://docs.fluentd.org/output/http

## Kom igång

Fluentd stöder hundratals datakällor och du kan mata in loggar från vilken som helst av dessa källor i OneUptime. Några av de populära källorna inkluderar:

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

och många fler. 

Du hittar den fullständiga listan över källor som stöds [här](https://www.fluentd.org/datasources)

## Förutsättningar

- **Steg 1: Installera Fluentd på ditt system** – Du kan installera Fluentd med instruktionerna som finns [här](https://docs.fluentd.org/installation)
- **Steg 2: Registrera dig för OneUptime-konto** – Du kan registrera dig för ett gratis konto [här](https://oneuptime.com). Observera att kontot är gratis, men loggintagning är en betald funktion. Du hittar mer information om prissättning [här](https://oneuptime.com/pricing).
- **Steg 3: Skapa OneUptime-projekt** – När du har kontot kan du skapa ett projekt från OneUptime-instrumentpanelen. Om du behöver hjälp med att skapa ett projekt eller har frågor, kontakta oss på support@oneuptime.com
- **Steg 4: Skapa telemetriintagningstoken** – När du har skapat ett OneUptime-konto kan du skapa en telemetriintagningstoken för att mata in loggar, mätvärden och spårningar från din applikation.

Efter att du registrerat dig på OneUptime och skapat ett projekt, klicka på "Mer" i navigeringsfältet och klicka på "Projektinställningar".

På sidan Telemetriintagningsnyckel, klicka på "Skapa intagningsnyckel" för att skapa en token. 

![Create Service](/docs/static/images/TelemetryIngestionKeys.png)

När du har skapat en token klickar du på "Visa" för att visa token.

![View Service](/docs/static/images/TelemetryIngestionKeyView.png)


## Konfiguration

Du kan använda följande konfiguration för att skicka telemetridata till OneUptime HTTP Source. Du kan lägga till den här konfigurationen i Fluentd-konfigurationsfilen. Konfigurationsfilen finns vanligtvis på `/etc/fluentd/fluent.conf` eller `/etc/td-agent/td-agent.conf`. 

Du måste ersätta `YOUR_SERVICE_TOKEN` med den token du skapade i föregående steg. Du måste också ersätta `YOUR_SERVICE_NAME` med namnet på din tjänst. Tjänstens namn kan vara vilket namn du vill. Om tjänsten inte finns i OneUptime skapas den automatiskt.

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


Ett exempel på en fullständig konfigurationsfil visas nedan:

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

**Om du egeninstallerar OneUptime**: Om du egeninstallerar OneUptime kan du ersätta `endpoint_url` med URL:en för din OneUptime-instans. `http(s)://YOUR_ONEUPTIME_HOST/fluentd/logs`

## Användning

När du har lagt till konfigurationen i Fluentd-konfigurationsfilen kan du starta om Fluentd-tjänsten. När tjänsten har startats om skickas telemetridata till OneUptime HTTP Source. Du kan nu börja se telemetridata i OneUptime-instrumentpanelen. Om du har frågor eller behöver hjälp med konfigurationen, kontakta oss på support@oneuptime.com.
