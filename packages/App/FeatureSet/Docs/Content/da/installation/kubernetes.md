# Kubernetes og Helm

Kør OneUptime på din egen Kubernetes-klynge med Helm-chartet. Din OneUptime-server leverer selv denne side, så den åbner uden forbindelse til internettet og beskriver chartet til den version, du kører. Hver værdi, chartet tager, står i chartets egen dokumentation på [Artifact Hub](https://artifacthub.io/packages/helm/oneuptime/oneuptime).

:::cards
- [Installér chartet](#installér-chartet): Én værdifil og to kommandoer.
- [Tag backup af dine data](#tag-backup-af-dine-data): PostgreSQL og ClickHouse, til lager uden for klyngen.
- [Gem dine nøgler](#gem-dine-nøgler): Det, dine sikkerhedskopier ikke kan læses uden.
:::

## Installér chartet

Opret en `values.yaml` med det domænenavn eller den IP-adresse, folk skal bruge, uden `http://`:

```yaml title="values.yaml"
host: oneuptime.example.com
```

Installér derefter chartet:

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com/
helm install my-oneuptime oneuptime/oneuptime -f values.yaml
```

**Det virkede, når** `kubectl get pods` viser hver pod som `Running`, og adressen åbner OneUptime. [Selv-hosting-guide](/docs/installation/self-hosting-guide) fortsætter derfra: HTTPS, administratorkontoen samt e-mail, SMS og opkald.

## Tag backup af dine data

OneUptime gemmer sine data på klyngens persistente volumener: PostgreSQL rummer dine projekter, monitorer, hændelser, statussider og brugere, og ClickHouse dine logs, traces og metrikker. Tag backup af begge til lager uden for klyngen, på en af disse måder:

- **Planlagte sikkerhedskopier i Enterprise Edition.** Sæt dem op i Admin Dashboard under **Indstillinger > Sikkerhedskopier**. Se [Sikkerhedskopier](/docs/installation/backups).
- **Din cloududbyders backup af de persistente volumener**, for eksempel planlagte snapshots af PostgreSQL- og ClickHouse-diskene.
- **CloudNativePG's backup med volume-snapshots**, når PostgreSQL kører på CloudNativePG-operatoren. Slå den til i `values.yaml`, og anvend så ændringen:

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

Med denne tidsplan tages der backup af PostgreSQL hver dag kl. 03:00. CloudNativePG sletter ikke gamle volume-snapshots, så slet selv dem, du ikke længere har brug for.

OneUptime kan ikke se sikkerhedskopier, der laves uden for OneUptime. Når dine kører, så klik på **Denne server bliver taget backup af** ved punktet Sikkerhedskopier på siden **Serveropsætning** i Admin Dashboard.

## Gem dine nøgler

Det, OneUptime krypterer, kan kun læses med den `encryptionSecret`, det blev krypteret med. Sæt selv `oneuptimeSecret` og `encryptionSecret` i `values.yaml`, så ingen opgradering erstatter dem, og gem en kopi sammen med dine sikkerhedskopier, uden for klyngen:

```yaml title="values.yaml"
oneuptimeSecret: <random string>
encryptionSecret: <random string>
```

## Næste trin

:::cards
- [Selv-hosting-guide](/docs/installation/self-hosting-guide): Fra en tom klynge til en server, der tilkalder dig.
- [Opgradering](/docs/installation/upgrading): Tag backup før hver opgradering.
- [Sikkerhedskopier](/docs/installation/backups): Enterprise Editions planlagte sikkerhedskopier.
:::
