# Kubernetes og Helm

Kjør OneUptime på din egen Kubernetes-klynge med Helm-chartet. OneUptime-serveren din leverer selv denne siden, så den åpnes uten forbindelse til internett og beskriver chartet for versjonen du kjører. Hver verdi chartet tar, står i chartets egen dokumentasjon på [Artifact Hub](https://artifacthub.io/packages/helm/oneuptime/oneuptime).

:::cards
- [Installer chartet](#installer-chartet): Én verdifil og to kommandoer.
- [Ta sikkerhetskopi av dataene dine](#ta-sikkerhetskopi-av-dataene-dine): PostgreSQL og ClickHouse, til lagring utenfor klyngen.
- [Ta vare på nøklene dine](#ta-vare-på-nøklene-dine): Det sikkerhetskopiene dine ikke kan leses uten.
:::

## Installer chartet

Lag en `values.yaml` med domenenavnet eller IP-adressen folk skal bruke, uten `http://`:

```yaml title="values.yaml"
host: oneuptime.example.com
```

Installer deretter chartet:

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com/
helm install my-oneuptime oneuptime/oneuptime -f values.yaml
```

**Det virket når** `kubectl get pods` viser hver pod som `Running` og adressen åpner OneUptime. [Selv-hosting-veiledning](/docs/installation/self-hosting-guide) fortsetter derfra: HTTPS, administratorkontoen, og e-post, SMS og anrop.

## Ta sikkerhetskopi av dataene dine

OneUptime lagrer dataene sine på klyngens persistente volumer: PostgreSQL har prosjektene, monitorene, hendelsene, statussidene og brukerne dine, og ClickHouse loggene, sporene og målingene dine. Ta sikkerhetskopi av begge til lagring utenfor klyngen, på en av disse måtene:

- **Planlagte sikkerhetskopier i Enterprise Edition.** Sett dem opp i Admin Dashboard under **Innstillinger > Sikkerhetskopier**. Se [Sikkerhetskopier](/docs/installation/backups).
- **Skyleverandørens sikkerhetskopier av de persistente volumene**, for eksempel planlagte øyeblikksbilder av PostgreSQL- og ClickHouse-diskene.
- **CloudNativePGs sikkerhetskopier med volum-øyeblikksbilder**, når PostgreSQL kjører på CloudNativePG-operatoren. Slå dem på i `values.yaml`, og bruk deretter endringen:

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

Med denne tidsplanen tas det sikkerhetskopi av PostgreSQL hver dag kl. 03:00. CloudNativePG sletter ikke gamle volum-øyeblikksbilder, så slett selv dem du ikke lenger trenger.

OneUptime ser ikke sikkerhetskopier som lages utenfor OneUptime. Når dine kjører, klikker du **Denne serveren sikkerhetskopieres** ved punktet Sikkerhetskopier på siden **Serveroppsett** i Admin Dashboard.

## Ta vare på nøklene dine

Det OneUptime krypterer, kan bare leses med den `encryptionSecret` det ble kryptert med. Sett `oneuptimeSecret` og `encryptionSecret` selv i `values.yaml`, så ingen oppgradering erstatter dem, og ta vare på en kopi sammen med sikkerhetskopiene dine, utenfor klyngen:

```yaml title="values.yaml"
oneuptimeSecret: <random string>
encryptionSecret: <random string>
```

## Neste trinn

:::cards
- [Selv-hosting-veiledning](/docs/installation/self-hosting-guide): Fra en tom klynge til en server som varsler deg.
- [Oppgradering](/docs/installation/upgrading): Ta sikkerhetskopi før hver oppgradering.
- [Sikkerhetskopier](/docs/installation/backups): De planlagte sikkerhetskopiene i Enterprise Edition.
:::
