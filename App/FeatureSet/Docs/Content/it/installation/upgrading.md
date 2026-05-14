# Aggiornamento di OneUptime

Questa guida descrive come aggiornare in modo sicuro la tua installazione self-hosted di OneUptime.

## Indicazioni Generali

- Aggiorna passo dopo passo tra le versioni principali (ad esempio, da 6 → 7 → 8). Non saltare le versioni principali.
- Puoi saltare le versioni minori/patch (ad esempio, da 8.1 → 8.4) purché tu segua le note di rilascio.
- Esegui sempre dei backup prima di aggiornare e verifica di poterli ripristinare.

## Aggiornamento da OneUptime 8 → 9

Il chart Helm non provvede più a una risorsa Kubernetes Ingress. OneUptime include un container ingress gateway che gestisce già la terminazione TLS, i domini delle pagine di stato e il routing del traffico per la piattaforma, quindi un ingress controller del cluster non è più necessario.

- Rimuovi qualsiasi override di `oneuptimeIngress` dai tuoi file `values.yaml` personalizzati prima dell'aggiornamento. Quelle chiavi vengono ora ignorate e causeranno errori di validazione se lasciate.
- Assicurati che `nginx.service.type` rispecchi come vuoi esporre l'ingress gateway incluso (ad esempio `LoadBalancer`, `NodePort`, o `ClusterIP` con un load balancer esterno).
- Verifica che tutti i record DNS per le pagine di stato o gli host principali puntino ancora al Service o al load balancer che si trova davanti all'ingress gateway di OneUptime.
- Dopo l'aggiornamento, conferma che i certificati TLS continuino a rinnovarsi tramite il gateway integrato e che i domini delle pagine di stato si risolvano correttamente.


## Aggiornamento da OneUptime 7 → 8

Se stai eseguendo su Kubernetes, ci sono importanti cambiamenti che causano interruzioni:

- Non usiamo più i chart Bitnami per Postgres, Redis e ClickHouse a causa delle [Modifiche alla Licenza Bitnami](https://github.com/bitnami/charts/issues/35164)
- Queste modifiche non sono retrocompatibili. Devi seguire la nuova struttura nel `values.yaml` del chart Helm.
- Esegui il backup dei tuoi dati (Postgres, ClickHouse e tutti i volumi persistenti) prima dell'aggiornamento.


> Suggerimento: Testa prima l'aggiornamento in un ambiente di staging. Conferma che i tuoi carichi di lavoro siano integri e i dati intatti prima di aggiornare la produzione.
