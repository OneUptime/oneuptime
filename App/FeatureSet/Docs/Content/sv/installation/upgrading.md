# Uppgradera OneUptime

Den här guiden beskriver hur du säkert uppgraderar din egeninstallerade OneUptime-installation.

## Allmän vägledning

- Uppgradera steg för steg mellan huvudversioner (till exempel 6 → 7 → 8). Hoppa inte över huvudversioner.
- Du kan hoppa över minor/patch-versioner (till exempel 8.1 → 8.4) så länge du följer versionsnoteringarna.
- Ta alltid säkerhetskopior innan du uppgraderar och validera att du kan återställa dem.

## Uppgradera från OneUptime 8 → 9

Helm-diagrammet tillhandahåller inte längre en Kubernetes Ingress-resurs. OneUptime levereras med en ingress gateway-container som redan avslutar TLS, hanterar statussidadomäner och dirigerar trafik för plattformen, så en kluster-ingress-kontroller är inte längre nödvändig.

- Ta bort eventuella `oneuptimeIngress`-åsidosättningar från dina anpassade `values.yaml`-filer innan uppgraderingen. Dessa nycklar ignoreras nu och orsakar valideringsfel om de lämnas kvar.
- Se till att `nginx.service.type` återspeglar hur du vill exponera den medföljande ingress-gatewayen (till exempel `LoadBalancer`, `NodePort` eller `ClusterIP` med en extern lastbalanserare).
- Verifiera att eventuella DNS-poster för statussidor eller primära värdar fortfarande pekar på den tjänst eller lastbalanserare som befinner sig framför OneUptime ingress gateway.
- Efter uppgraderingen, bekräfta att TLS-certifikat fortsätter att förnyas via den inbäddade gatewayen och att statussidadomäner löser sig korrekt.


## Uppgradera från OneUptime 7 → 8

Om du kör på Kubernetes finns det viktiga brytande ändringar:

- Vi använder inte längre Bitnami-diagram för Postgres, Redis och ClickHouse på grund av [Bitnami-licensändringar](https://github.com/bitnami/charts/issues/35164)
- Dessa ändringar är inte bakåtkompatibla. Du måste följa den nya strukturen i Helm-diagrammets `values.yaml`.
- Säkerhetskopiera dina data (Postgres, ClickHouse och eventuella persistenta volymer) innan uppgraderingen.


> Tips: Testa uppgraderingen i en staging-miljö först. Bekräfta att dina arbetsbelastningar är friska och att data är intakt innan du uppgraderar produktionen.
