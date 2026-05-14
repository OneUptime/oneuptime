# Oppgradering av OneUptime

Denne veiledningen dekker hvordan du trygt oppgraderer din selvhostede OneUptime-installasjon.

## Generell veiledning

- Oppgrader trinn for trinn på tvers av store versjoner (for eksempel 6 → 7 → 8). Ikke hopp over store versjoner.
- Du kan hoppe over mindre/patch-versjoner (for eksempel 8.1 → 8.4) så lenge du følger versjonsnotatene.
- Ta alltid sikkerhetskopier før oppgradering, og valider at du kan gjenopprette dem.

## Oppgradering fra OneUptime 8 → 9

Helm-diagrammet klargjør ikke lenger en Kubernetes Ingress-ressurs. OneUptime leveres med en ingress gateway-container som allerede avslutter TLS, administrerer statusside-domener og ruter trafikk for plattformen, slik at en klynge ingress-kontroller ikke lenger er nødvendig.

- Fjern eventuelle `oneuptimeIngress`-overstyringer fra de egendefinerte `values.yaml`-filene dine før oppgradering. Disse nøklene ignoreres nå og vil forårsake valideringsfeil hvis de etterlates.
- Sørg for at `nginx.service.type` gjenspeiler hvordan du vil eksponere den medfølgende ingress gateway (for eksempel `LoadBalancer`, `NodePort` eller `ClusterIP` med en ekstern lastbalanserer).
- Verifiser at eventuelle DNS-poster for statussider eller primære verter fortsatt peker til tjenesten eller lastbalansereren som er foran OneUptime ingress gateway.
- Etter oppgraderingen, bekreft at TLS-sertifikater fortsetter å fornyes via den innebygde gateway og at statussidedomener løses opp korrekt.


## Oppgradering fra OneUptime 7 → 8

Hvis du kjører på Kubernetes, er det viktige endringer som bryter bakoverkompatibilitet:

- Vi bruker ikke lenger Bitnami-diagrammer for Postgres, Redis og ClickHouse på grunn av [Bitnami-lisensendringer](https://github.com/bitnami/charts/issues/35164)
- Disse endringene er ikke bakoverkompatible. Du må følge den nye strukturen i Helm-diagrammets `values.yaml`.
- Sikkerhetskopier dataene dine (Postgres, ClickHouse og eventuelle vedvarende volumer) før oppgradering.


> Tips: Test oppgraderingen i et stagingmiljø først. Bekreft at arbeidsbelastningene er sunne og at dataene er intakte før du oppgraderer produksjon.
