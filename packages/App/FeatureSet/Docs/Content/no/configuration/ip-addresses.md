# IP-adresser

Probene til OneUptime Cloud sjekker nettstedene, API-ene og serverne dine fra et fast sett IP-adresser. Står det en brannmur eller en tillatelsesliste foran det du overvåker, må du tillate disse adressene så sjekkene kommer gjennom.

```mermaid title="Hvor tillatelseslisten gjelder"
flowchart LR
    P["OneUptime-prober"] -->|"sjekker fra de oppførte IP-ene"| F["Brannmuren din"]
    F -->|"tillatt"| S["Nettstedet, API-et eller serveren din"]
```

## IP-adresser som skal tillates

Tillat trafikk fra disse adressene i brannmuren din:

{{IP_WHITELIST}}

> [!NOTE]
> Adressene kan endre seg. OneUptime gir deg beskjed på forhånd når det skjer. For å holde deg oppdatert uten å følge med på kunngjøringer kan du [hente listen](#hent-listen-programmatisk) hver gang du oppdaterer brannmuren.

## Hent listen programmatisk

Den samme listen leveres som JSON, uten API-nøkkel, slik at et skript kan holde brannmurreglene dine oppdatert:

```bash
curl -s https://oneuptime.com/ip-whitelist
```

```json
{
  "ipWhitelist": ["<list of IPs>"]
}
```

`ipWhitelist` er en matrise med én adresse per element. Slik skriver du ut én adresse per linje, for eksempel til et brannmurskript:

```bash
curl -s https://oneuptime.com/ip-whitelist | jq -r '.ipWhitelist[]'
```

## Selvhostet OneUptime

På din egen instans viser denne siden og endepunktet `/ip-whitelist` adressene fra instansens innstilling `IP_WHITELIST`, en kommaseparert liste. Oppgi adressene som dine egne prober sender sjekkene sine fra.

:::tabs
@tab Kubernetes
Angi verdien `ipWhitelist` i Helm-chartet:

```yaml title="values.yaml"
ipWhitelist: "203.0.113.1,203.0.113.2"
```
@tab Docker Compose
`config.env` sender ikke innstillingen videre til appen. Legg den til i miljøet for tjenesten `app` i en `docker-compose.override.yml` ved siden av `docker-compose.yml`, og start deretter OneUptime på nytt:

```yaml title="docker-compose.override.yml"
services:
  app:
    environment:
      IP_WHITELIST: "203.0.113.1,203.0.113.2"
```
:::

Når ingenting er angitt, viser denne siden **No IP addresses configured.**, og endepunktet returnerer en tom `ipWhitelist`-matrise.

## Neste steg

:::cards
- [Egendefinerte probes](/docs/probe/custom-probe): Kjør en probe i ditt eget nettverk i stedet for å åpne brannmuren.
- [Opprett en monitor](/docs/monitor/create-monitor): Begynn å sjekke et nettsted, et API eller en server.
:::
