# Opgradering af OneUptime

Denne guide beskriver, hvordan du sikkert opgraderer din selvhostede OneUptime-installation.

## Generel vejledning

- Opgrader trin for trin på tværs af større versioner (f.eks. 6 → 7 → 8). Spring ikke større versioner over.
- Du kan springe mindre/patch-versioner over (f.eks. 8.1 → 8.4), så længe du følger udgivelsesnoterne.
- Tag altid sikkerhedskopier inden opgradering, og valider, at du kan gendanne dem.

## Opgradering fra OneUptime 8 → 9

Helm-chartet klargører ikke længere en Kubernetes Ingress-ressource. OneUptime leverer en ingress gateway-container, der allerede afslutter TLS, administrerer statusside-domæner og dirigerer trafik til platformen, så en klynge-ingress-controller er ikke længere nødvendig.

- Fjern eventuelle `oneuptimeIngress`-tilsidesættelser fra dine brugerdefinerede `values.yaml`-filer inden opgradering. Disse nøgler ignoreres nu og vil forårsage valideringsfejl, hvis de efterlades.
- Sørg for, at `nginx.service.type` afspejler, hvordan du vil eksponere den medfølgende ingress gateway (f.eks. `LoadBalancer`, `NodePort` eller `ClusterIP` med en ekstern load balancer).
- Bekræft, at eventuelle DNS-poster til statussider eller primære hosts stadig peger på den service eller load balancer, der er foran OneUptime-ingress-gatewayen.
- Efter opgraderingen skal du bekræfte, at TLS-certifikater fortsat fornyes via den indlejrede gateway, og at statusside-domæner løses korrekt.


## Opgradering fra OneUptime 7 → 8

Hvis du kører på Kubernetes, er der vigtige ændringer der bryder bagudkompatibilitet:

- Vi bruger ikke længere Bitnami-charts til Postgres, Redis og ClickHouse på grund af [Bitnami-licensændringer](https://github.com/bitnami/charts/issues/35164)
- Disse ændringer er ikke bagudkompatible. Du skal følge den nye struktur i Helm-chartets `values.yaml`.
- Sikkerhedskopier dine data (Postgres, ClickHouse og alle persistente volumes) inden opgradering.


> Tip: Test opgraderingen i et staging-miljø først. Bekræft, at dine arbejdsbelastninger er sunde og dataene intakte, inden du opgraderer produktionen.
