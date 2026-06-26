# Terraform Provider-documentatie

De OneUptime Terraform Provider maakt Infrastructure as Code (IaC)-beheer mogelijk van uw OneUptime-monitoring-, meldings- en observabiliteitsresources.

## Documentatiesecties

### [Aan de slag](./quick-start.md)

Snelle installatiegids om u binnen enkele minuten aan de slag te krijgen met de OneUptime Terraform Provider.

### [Volledige providergids](./README.md)

Uitgebreide documentatie over installatie, configuratie, resources en best practices.

### [Zelf-gehoste configuratie](./self-hosted.md)

**Kritiek voor zelf-gehoste klanten**: Versie vastzetten, compatibiliteit en implementatiestrategieën.

### [Voorbeelden](./examples.md)

Praktijkvoorbeelden en -patronen voor veelgebruikte OneUptime Terraform-configuraties.

## Snelkoppelingen

### Voor OneUptime Cloud-klanten

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

### Voor zelf-gehoste klanten

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Moet overeenkomen met uw OneUptime-versie
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.yourcompany.com"
  api_key       = var.oneuptime_api_key
}
```

## Belangrijk voor zelf-gehoste gebruikers

**Versiecompatibiliteit is kritiek**: Zet de Terraform-providerversie altijd vast zodat deze exact overeenkomt met uw OneUptime-installatieversie. Niet-overeenkomende versies kunnen API-compatibiliteitsproblemen veroorzaken.

## Externe resources

- **Terraform Registry**: [OneUptime Provider](https://registry.terraform.io/providers/oneuptime/oneuptime)
- **GitHub Repository**: [OneUptime Source Code](https://github.com/OneUptime/oneuptime)
- **Community-ondersteuning**: [OneUptime Community](https://community.oneuptime.com)

## Beschikbare resources

De provider ondersteunt uitgebreid OneUptime-resourcebeheer:

- **Projecten en teams**: Organiseer uw monitoringstructuur
- **Monitors**: Website-, API-, poort-, heartbeat- en aangepaste monitors
- **Incidentbeheer**: Meldingsbeleid, piketschema's, escalaties
- **Statuspagina's**: Openbare en privéstatuspagina's met aangepaste branding
- **Servicecatalogus**: Servicedefinities en afhankelijkheidskaarten
- **Workflows**: Geautomatiseerde respons- en herstelworkflows

## Ondersteuning

Voor problemen, vragen of bijdragen:

1. **Documentatieproblemen**: Maak een issue aan in de [OneUptime-repository](https://github.com/OneUptime/oneuptime/issues)
2. **Providerfouten**: Meld in de hoofd-OneUptime-repository
3. **Functieverzoeken**: Bespreek in de OneUptime-community
4. **Algemene vragen**: Gebruik de communityforums

## Volgende stappen

1. **Nieuwe gebruikers**: Begin met de [Snelstartgids](./quick-start.md)
2. **Zelf-gehost**: Bekijk de [Zelf-gehoste configuratie](./self-hosted.md)
3. **Gevorderde gebruikers**: Verken [Voorbeelden](./examples.md) voor complexe instellingen
4. **Volledige referentie**: Bekijk de [Volledige gids](./README.md) voor alle functies
