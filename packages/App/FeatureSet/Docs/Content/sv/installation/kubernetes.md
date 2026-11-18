# Kubernetes och Helm

Kör OneUptime på ditt eget Kubernetes-kluster med Helm-diagrammet. Din OneUptime-server levererar själv den här sidan, så den öppnas utan anslutning till internet och beskriver diagrammet för den version du kör. Varje värde som diagrammet tar finns i diagrammets egen dokumentation på [Artifact Hub](https://artifacthub.io/packages/helm/oneuptime/oneuptime).

:::cards
- [Installera diagrammet](#installera-diagrammet): En värdefil och två kommandon.
- [Säkerhetskopiera dina data](#säkerhetskopiera-dina-data): PostgreSQL och ClickHouse, till lagring utanför klustret.
- [Spara dina nycklar](#spara-dina-nycklar): Det som dina säkerhetskopior inte kan läsas utan.
:::

## Installera diagrammet

Skapa en `values.yaml` med domännamnet eller IP-adressen som man kommer att använda, utan `http://`:

```yaml title="values.yaml"
host: oneuptime.example.com
```

Installera sedan diagrammet:

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com/
helm install my-oneuptime oneuptime/oneuptime -f values.yaml
```

**Det fungerade när** `kubectl get pods` visar varje pod som `Running` och adressen öppnar OneUptime. [Guide för självhosting](/docs/installation/self-hosting-guide) fortsätter därifrån: HTTPS, administratörskontot, och e-post, sms och samtal.

## Säkerhetskopiera dina data

OneUptime sparar sina data på klustrets beständiga volymer: PostgreSQL innehåller dina projekt, monitorer, incidenter, statussidor och användare, och ClickHouse dina loggar, spårningar och mätvärden. Säkerhetskopiera båda till lagring utanför klustret, på något av dessa sätt:

- **Schemalagda säkerhetskopior i Enterprise Edition.** Ställ in dem i Admin Dashboard under **Inställningar > Säkerhetskopior**. Se [Säkerhetskopior](/docs/installation/backups).
- **Din molnleverantörs säkerhetskopior av de beständiga volymerna**, till exempel schemalagda ögonblicksbilder av PostgreSQL- och ClickHouse-diskarna.
- **CloudNativePG:s säkerhetskopior med volymögonblicksbilder**, när PostgreSQL körs på CloudNativePG-operatorn. Slå på dem i `values.yaml` och tillämpa sedan ändringen:

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

Med det här schemat säkerhetskopieras PostgreSQL varje dag kl. 03:00. CloudNativePG tar inte bort gamla volymögonblicksbilder, så ta själv bort dem du inte längre behöver.

OneUptime ser inte säkerhetskopior som görs utanför OneUptime. När dina körs klickar du på **Den här servern säkerhetskopieras** vid punkten Säkerhetskopior på sidan **Serverkonfiguration** i Admin Dashboard.

## Spara dina nycklar

Det som OneUptime krypterar kan bara läsas med den `encryptionSecret` det krypterades med. Ställ själv in `oneuptimeSecret` och `encryptionSecret` i `values.yaml`, så att ingen uppgradering ersätter dem, och spara en kopia med dina säkerhetskopior, utanför klustret:

```yaml title="values.yaml"
oneuptimeSecret: <random string>
encryptionSecret: <random string>
```

## Nästa steg

:::cards
- [Guide för självhosting](/docs/installation/self-hosting-guide): Från ett tomt kluster till en server som larmar dig.
- [Uppgradering](/docs/installation/upgrading): Säkerhetskopiera före varje uppgradering.
- [Säkerhetskopior](/docs/installation/backups): Enterprise Editions schemalagda säkerhetskopior.
:::
