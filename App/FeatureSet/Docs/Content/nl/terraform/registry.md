# Terraform Provider Installatie- en gebruiksgids

## Installatie vanuit het Terraform Registry

De OneUptime Terraform Provider is beschikbaar in het officiële [Terraform Registry](https://registry.terraform.io/providers/oneuptime/oneuptime).

### Voor OneUptime Cloud-gebruikers

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # Gebruik de nieuwste compatibele versie
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.com"
  api_key       = var.oneuptime_api_key
}
```

### Voor zelf-gehoste OneUptime-gebruikers

⚠️ **Kritiek**: Zelf-gehoste klanten moeten de providerversie vastzetten zodat deze exact overeenkomt met hun OneUptime-installatie.

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Vervang door uw exacte OneUptime-versie
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.yourcompany.com"  # Uw zelf-gehoste URL
  api_key       = var.oneuptime_api_key
}
```

## Waarom versie vastzetten voor zelf-gehost?

De OneUptime Terraform-provider wordt automatisch gegenereerd vanuit de OneUptime API-specificatie. Elke OneUptime-versie kan hebben:

- Verschillende API-eindpunten
- Bijgewerkte resource-schema's
- Nieuwe of verwijderde functies
- Gewijzigde validatieregels

Het gebruik van een providerversie die niet overeenkomt met uw OneUptime-installatie kan leiden tot:

- API-compatibiliteitsfouten
- Mislukte resource-aanmaak/-updates
- Onverwacht gedrag
- Statusdrift van resources

## Uw OneUptime-versie vinden

### Methode 1: Dashboard

1. Log in op uw OneUptime-dashboard
2. Ga naar **Instellingen** → **Over**
3. Noteer het versienummer (bijv. "7.0.123")

### Methode 2: API

```bash
curl https://your-oneuptime-instance.com/api/version | jq '.version'
```

### Methode 3: Docker

```bash
docker images | grep oneuptime
# Zoek naar de tag, bijv. oneuptime/dashboard:7.0.123
```

## Provider Registry-informatie

- **Registry-URL**: https://registry.terraform.io/providers/oneuptime/oneuptime
- **Bronrepository**: https://github.com/OneUptime/terraform-provider-oneuptime
- **Documentatie**: https://registry.terraform.io/providers/oneuptime/oneuptime/latest/docs
- **Releases**: https://github.com/OneUptime/terraform-provider-oneuptime/releases

## Versiecompatibiliteitsmatrix

| OneUptime-versie | Providerversie    | Terraform-configuratie |
| ---------------- | ----------------- | ---------------------- |
| 7.0.x            | 7.0.x             | `version = "~> 7.0.0"` |
| 7.1.x            | 7.1.x             | `version = "~> 7.1.0"` |
| Nieuwste Cloud   | Nieuwste Provider | `version = "~> 7.0"`   |

## Snelstartvoorbeeld

```hcl
# De provider configureren
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # Aanpassen voor zelf-gehost
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.com"  # Aanpassen voor zelf-gehost
  api_key       = var.oneuptime_api_key
}

# Een project aanmaken
resource "oneuptime_project" "example" {
  name        = "Terraform Voorbeeld"
  description = "Aangemaakt met Terraform"
}

# Een website-monitor aanmaken
resource "oneuptime_monitor" "website" {
  name       = "Website Monitor"
  project_id = oneuptime_project.example.id

  monitor_type = "website"
  url          = "https://example.com"
  interval     = "5m"

  tags = {
    managed_by = "terraform"
  }
}
```

## Installatiestappen

1. **Maak uw Terraform-configuratie aan** met het providerblok
2. **Initialiseer Terraform**: `terraform init`
3. **Stel uw API-sleutel in**: Maak `terraform.tfvars` aan met uw API-sleutel
4. **Plan uw implementatie**: `terraform plan`
5. **Pas uw configuratie toe**: `terraform apply`

## Hulp krijgen

- **Volledige documentatie**: Zie de [volledige Terraform-documentatie](./README.md)
- **Zelf-gehoste gids**: Bekijk de [zelf-gehoste configuratiegids](./self-hosted.md)
- **Voorbeelden**: Blader door [configuratievoorbeelden](./examples.md)
- **Snelstart**: Volg de [snelstartgids](./quick-start.md)

## Registry-updates

De provider wordt automatisch gepubliceerd naar het Terraform Registry wanneer nieuwe OneUptime-versies worden uitgebracht. Cloudgebruikers kunnen semantisch versiebeheer (`~> 7.0`) gebruiken om automatisch compatibele updates te ontvangen, terwijl zelf-gehoste gebruikers op exacte versies moeten vastzetten.
