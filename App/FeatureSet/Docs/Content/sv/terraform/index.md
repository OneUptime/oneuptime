# Terraform-leverantörsdokumentation

OneUptime Terraform-leverantören möjliggör Infrastructure as Code (IaC)-hantering av dina OneUptime-övervaknings-, varnings- och observabilitetsresurser.

## Dokumentationsavsnitt

### [Kom igång](./quick-start.md)
Snabbinstallationsguide för att komma igång med OneUptime Terraform-leverantören på några minuter.

### [Fullständig leverantörsguide](./complete-guide.md)
Heltäckande dokumentation om installation, konfiguration, resurser och bästa praxis.

### [Konfiguration för egeninstallation](./self-hosted.md)
**Kritiskt för egeninstallerade kunder**: Versionsinlåsning, kompatibilitet och driftsättningsstrategier.

### [Exempel](./examples.md)
Verkliga exempel och mönster för vanliga OneUptime Terraform-konfigurationer.

## Snabblänkar

### För OneUptime Cloud-kunder
```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.com"
  api_key       = var.oneuptime_api_key
}
```

### För egeninstallerade kunder
```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Must match your OneUptime version
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.yourcompany.com"
  api_key       = var.oneuptime_api_key
}
```

## Viktigt för egeninstallerade användare

**Versionskompatibilitet är kritisk**: Lås alltid Terraform-leverantörens version till att exakt matcha din OneUptime-installationsversion. Felmatchade versioner kan orsaka API-kompatibilitetsproblem.

## Externa resurser

- **Terraform Registry**: [OneUptime-leverantör](https://registry.terraform.io/providers/oneuptime/oneuptime)
- **GitHub-repositorie**: [OneUptime källkod](https://github.com/OneUptime/oneuptime)

## Tillgängliga resurser

Leverantören stöder heltäckande OneUptime-resurshantering:

- **Projekt och team**: Organisera din övervakningsstruktur
- **Monitorer**: Webbplats, API, port, hjärtslag och anpassade monitorer
- **Incidenthantering**: Varningspolicyer, jourschemat, eskaleringar
- **Statussidor**: Offentliga och privata statussidor med anpassad märkning
- **Tjänstkatalog**: Tjänstedefinitioner och beroendemappning
- **Arbetsflöden**: Automatiserat svar och saneringsarbetsflöden

## Support

För problem, frågor eller bidrag:

1. **Dokumentationsproblem**: Skapa ett ärende i [OneUptime-repositoriet](https://github.com/OneUptime/oneuptime/issues)
2. **Leverantörsfel**: Rapportera i OneUptime-repositoriet
3. **Funktionsförfrågningar**: Diskutera i OneUptime-communityt

## Nästa steg

1. **Nya användare**: Börja med [snabbstartsguiden](./quick-start.md)
2. **Egeninstallerade**: Granska [konfiguration för egeninstallation](./self-hosted.md)
3. **Avancerade användare**: Utforska [exempel](./examples.md) för komplexa konfigurationer
4. **Fullständig referens**: Se [den fullständiga guiden](./complete-guide.md) för alla funktioner
