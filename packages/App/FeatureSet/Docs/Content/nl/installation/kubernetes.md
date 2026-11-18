# Kubernetes en Helm

Draai OneUptime op uw eigen Kubernetes-cluster met de Helm-chart. Uw OneUptime-server serveert deze pagina zelf, dus hij opent ook zonder verbinding met internet en beschrijft de chart van de versie die u draait. Elke waarde die de chart aanneemt, staat in de documentatie van de chart zelf, op [Artifact Hub](https://artifacthub.io/packages/helm/oneuptime/oneuptime).

:::cards
- [De chart installeren](#de-chart-installeren): Eén waardenbestand en twee opdrachten.
- [Een back-up van uw gegevens maken](#een-back-up-van-uw-gegevens-maken): PostgreSQL en ClickHouse, naar opslag buiten het cluster.
- [Uw sleutels bewaren](#uw-sleutels-bewaren): Waarzonder uw back-ups niet te lezen zijn.
:::

## De chart installeren

Maak een `values.yaml` met de domeinnaam of het IP-adres dat men gaat gebruiken, zonder `http://`:

```yaml title="values.yaml"
host: oneuptime.example.com
```

Installeer daarna de chart:

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com/
helm install my-oneuptime oneuptime/oneuptime -f values.yaml
```

**Het is gelukt als** `kubectl get pods` elke pod als `Running` toont en het adres OneUptime opent. De [Handleiding zelf hosten](/docs/installation/self-hosting-guide) gaat vanaf daar verder: HTTPS, het beheerdersaccount, en e-mail, sms en oproepen.

## Een back-up van uw gegevens maken

OneUptime bewaart zijn gegevens op de persistent volumes van het cluster: PostgreSQL bevat uw projecten, monitors, incidenten, statuspagina's en gebruikers, en ClickHouse uw logs, traces en metrics. Maak van beide een back-up naar opslag buiten het cluster, op een van deze manieren:

- **Geplande back-ups van de Enterprise Edition.** Stel ze in het Admin Dashboard in onder **Instellingen > Back-ups**. Zie [Back-ups](/docs/installation/backups).
- **De back-ups van de persistent volumes door uw cloudprovider**, zoals geplande snapshots van de schijven van PostgreSQL en ClickHouse.
- **De volume-snapshotback-ups van CloudNativePG**, als PostgreSQL op de CloudNativePG-operator draait. Zet ze aan in `values.yaml` en pas de wijziging daarna toe:

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

Met dit schema wordt er elke dag om 03:00 een back-up van PostgreSQL gemaakt. CloudNativePG verwijdert oude volume-snapshots niet, dus verwijder zelf de snapshots die u niet meer nodig hebt.

OneUptime ziet geen back-ups die buiten OneUptime worden gemaakt. Zodra de uwe lopen, klikt u bij het onderdeel Back-ups op de pagina **Serverinstelling** van het Admin Dashboard op **Van deze server wordt een back-up gemaakt**.

## Uw sleutels bewaren

Wat OneUptime versleutelt, is alleen te lezen met het `encryptionSecret` waarmee het is versleuteld. Stel `oneuptimeSecret` en `encryptionSecret` zelf in `values.yaml` in, zodat geen upgrade ze vervangt, en bewaar een kopie bij uw back-ups, buiten het cluster:

```yaml title="values.yaml"
oneuptimeSecret: <random string>
encryptionSecret: <random string>
```

## Volgende stappen

:::cards
- [Handleiding zelf hosten](/docs/installation/self-hosting-guide): Van een leeg cluster naar een server die u oproept.
- [Upgraden](/docs/installation/upgrading): Maak een back-up vóór elke upgrade.
- [Back-ups](/docs/installation/backups): De geplande back-ups van de Enterprise Edition.
:::
