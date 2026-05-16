# OneUptime upgraden

Deze handleiding beschrijft hoe u uw zelf-gehoste OneUptime-installatie veilig kunt upgraden.

## Algemene richtlijnen

- Upgrade stap voor stap door hoofdversies (bijvoorbeeld 6 → 7 → 8). Sla geen hoofdversies over.
- U kunt kleine/patch-versies overslaan (bijvoorbeeld 8.1 → 8.4) zolang u de release-opmerkingen volgt.
- Maak altijd back-ups voordat u upgradet en valideer of u deze kunt herstellen.

## Upgraden van OneUptime 8 → 9

De Helm-chart provisioneert niet langer een Kubernetes Ingress-resource. OneUptime wordt geleverd met een ingress gateway-container die al TLS beëindigt, statuspaginadomeinen beheert en verkeer voor het platform routeert, zodat een cluster ingress controller niet langer nodig is.

- Verwijder eventuele `oneuptimeIngress`-overschrijvingen uit uw aangepaste `values.yaml`-bestanden voordat u upgradet. Deze sleutels worden nu genegeerd en veroorzaken validatiefouten als ze aanwezig zijn.
- Zorg dat `nginx.service.type` weergeeft hoe u de gebundelde ingress gateway wilt blootstellen (bijvoorbeeld `LoadBalancer`, `NodePort` of `ClusterIP` met een externe load balancer).
- Controleer of eventuele DNS-records voor statuspagina's of primaire hosts nog steeds verwijzen naar de Service of load balancer die de OneUptime ingress gateway beheert.
- Bevestig na de upgrade dat TLS-certificaten blijven verlengen via de ingebedde gateway en dat statuspaginadomeinen correct worden omgezet.


## Upgraden van OneUptime 7 → 8

Als u op Kubernetes draait, zijn er belangrijke ingrijpende wijzigingen:

- We gebruiken de Bitnami-charts voor Postgres, Redis en ClickHouse niet langer vanwege [Bitnami-licentiewijzigingen](https://github.com/bitnami/charts/issues/35164)
- Deze wijzigingen zijn niet achterwaarts compatibel. U moet de nieuwe structuur in de Helm-chart `values.yaml` volgen.
- Maak een back-up van uw gegevens (Postgres, ClickHouse en alle permanente volumes) voordat u upgradet.


> Tip: Test de upgrade eerst in een stagingomgeving. Bevestig dat uw workloads gezond zijn en gegevens intact zijn voordat u productie upgradet.
