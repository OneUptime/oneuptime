# Kubernetes e Helm

Esegui OneUptime sul tuo cluster Kubernetes con il chart Helm. Il tuo server OneUptime serve questa pagina da sé, quindi si apre anche senza accesso a internet e descrive il chart della versione che esegui. Ogni valore che il chart accetta è nella documentazione del chart, su [Artifact Hub](https://artifacthub.io/packages/helm/oneuptime/oneuptime).

:::cards
- [Installare il chart](#installare-il-chart): Un file di valori e due comandi.
- [Fare il backup dei tuoi dati](#fare-il-backup-dei-tuoi-dati): PostgreSQL e ClickHouse, su uno storage fuori dal cluster.
- [Conservare le chiavi](#conservare-le-chiavi): Ciò senza cui i tuoi backup non si possono leggere.
:::

## Installare il chart

Crea un `values.yaml` con il nome di dominio o l'indirizzo IP che verrà usato, senza `http://`:

```yaml title="values.yaml"
host: oneuptime.example.com
```

Poi installa il chart:

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com/
helm install my-oneuptime oneuptime/oneuptime -f values.yaml
```

**Ha funzionato quando** `kubectl get pods` mostra ogni pod `Running` e l'indirizzo apre OneUptime. La [Guida al self-hosting](/docs/installation/self-hosting-guide) prosegue da lì: HTTPS, l'account di amministrazione, poi email, SMS e chiamate.

## Fare il backup dei tuoi dati

OneUptime tiene i suoi dati sui volumi persistenti del cluster: PostgreSQL contiene i tuoi progetti, monitor, incidenti, pagine di stato e utenti, e ClickHouse i tuoi log, trace e metriche. Fai il backup di entrambi su uno storage fuori dal cluster, in uno di questi modi:

- **I backup pianificati dell'Enterprise Edition.** Configurali nell'Admin Dashboard, in **Impostazioni > Backup**. Vedi [Backup](/docs/installation/backups).
- **I backup dei volumi persistenti del tuo provider cloud**, come gli snapshot pianificati dei dischi di PostgreSQL e di ClickHouse.
- **I backup con snapshot dei volumi di CloudNativePG**, quando PostgreSQL gira sull'operatore CloudNativePG. Attivali in `values.yaml`, poi applica la modifica:

```yaml title="values.yaml"
postgresOperator:
  cnpg:
    enabled: true
    backup:
      enabled: true
      schedule: "0 0 3 * * *"
```

```bash
helm upgrade my-oneuptime oneuptime/oneuptime -f values.yaml
```

Con questa pianificazione il backup di PostgreSQL si fa ogni giorno alle 03:00. CloudNativePG non elimina i vecchi snapshot dei volumi: elimina tu quelli che non ti servono più.

OneUptime non vede i backup fatti fuori da OneUptime. Quando i tuoi sono attivi, fai clic su **Questo server ha i backup** nella voce Backup della pagina **Configurazione del server** dell'Admin Dashboard.

## Conservare le chiavi

Ciò che OneUptime cifra si può leggere solo con l'`encryptionSecret` con cui è stato cifrato. Imposta tu `oneuptimeSecret` ed `encryptionSecret` in `values.yaml`, così che nessun aggiornamento li sostituisca, e tienine una copia con i tuoi backup, fuori dal cluster:

```yaml title="values.yaml"
oneuptimeSecret: <random string>
encryptionSecret: <random string>
```

## Passi successivi

:::cards
- [Guida al self-hosting](/docs/installation/self-hosting-guide): Da un cluster vuoto a un server che ti avvisa.
- [Aggiornamento](/docs/installation/upgrading): Fai un backup prima di ogni aggiornamento.
- [Backup](/docs/installation/backups): I backup pianificati dell'Enterprise Edition.
:::
