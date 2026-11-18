# Kubernetes und Helm

Betreiben Sie OneUptime mit dem Helm-Chart auf Ihrem eigenen Kubernetes-Cluster. Ihr OneUptime-Server liefert diese Seite selbst aus: Sie öffnet sich auch ohne Weg ins Internet und beschreibt das Chart der Version, die Sie betreiben. Jeden Wert, den das Chart annimmt, finden Sie in der Dokumentation des Charts auf [Artifact Hub](https://artifacthub.io/packages/helm/oneuptime/oneuptime).

:::cards
- [Das Chart installieren](#das-chart-installieren): Eine Werte-Datei und zwei Befehle.
- [Ihre Daten sichern](#ihre-daten-sichern): PostgreSQL und ClickHouse, in Speicher außerhalb des Clusters.
- [Ihre Schlüssel aufbewahren](#ihre-schlüssel-aufbewahren): Ohne was sich Ihre Backups nicht lesen lassen.
:::

## Das Chart installieren

Legen Sie eine `values.yaml` mit dem Domainnamen oder der IP-Adresse an, die man verwenden wird, ohne `http://`:

```yaml title="values.yaml"
host: oneuptime.example.com
```

Installieren Sie dann das Chart:

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com/
helm install my-oneuptime oneuptime/oneuptime -f values.yaml
```

**Es hat funktioniert, wenn** `kubectl get pods` jeden Pod als `Running` zeigt und die Adresse OneUptime öffnet. Die [Anleitung zum Selbsthosten](/docs/installation/self-hosting-guide) macht von dort aus weiter: HTTPS, das Admin-Konto sowie E-Mail, SMS und Anrufe.

## Ihre Daten sichern

OneUptime legt seine Daten auf den Persistent Volumes des Clusters ab: PostgreSQL enthält Ihre Projekte, Monitore, Vorfälle, Statusseiten und Benutzer, ClickHouse Ihre Logs, Traces und Metriken. Sichern Sie beide in Speicher außerhalb des Clusters, auf eine dieser Arten:

- **Geplante Backups der Enterprise Edition.** Richten Sie sie im Admin Dashboard unter **Einstellungen > Backups** ein. Siehe [Backups](/docs/installation/backups).
- **Die Backups der Persistent Volumes durch Ihren Cloud-Anbieter**, etwa geplante Snapshots der PostgreSQL- und ClickHouse-Datenträger.
- **Die Volume-Snapshot-Backups von CloudNativePG**, wenn PostgreSQL auf dem CloudNativePG-Operator läuft. Schalten Sie sie in der `values.yaml` ein und wenden Sie die Änderung dann an:

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

Mit diesem Zeitplan wird PostgreSQL jeden Tag um 03:00 gesichert. CloudNativePG löscht alte Volume-Snapshots nicht: Löschen Sie die, die Sie nicht mehr brauchen, selbst.

OneUptime sieht keine Backups, die außerhalb von OneUptime entstehen. Sobald Ihre laufen, klicken Sie beim Punkt Backups auf der Seite **Server-Einrichtung** des Admin Dashboard auf **Dieser Server wird gesichert**.

## Ihre Schlüssel aufbewahren

Was OneUptime verschlüsselt, lässt sich nur mit dem `encryptionSecret` lesen, mit dem es verschlüsselt wurde. Setzen Sie `oneuptimeSecret` und `encryptionSecret` selbst in der `values.yaml`, damit kein Upgrade sie ersetzt, und bewahren Sie eine Kopie bei Ihren Backups auf, außerhalb des Clusters:

```yaml title="values.yaml"
oneuptimeSecret: <random string>
encryptionSecret: <random string>
```

## Nächste Schritte

:::cards
- [Anleitung zum Selbsthosten](/docs/installation/self-hosting-guide): Von einem leeren Cluster zu einem Server, der Sie alarmiert.
- [Aktualisierung](/docs/installation/upgrading): Vor jedem Upgrade ein Backup erstellen.
- [Backups](/docs/installation/backups): Die geplanten Backups der Enterprise Edition.
:::
