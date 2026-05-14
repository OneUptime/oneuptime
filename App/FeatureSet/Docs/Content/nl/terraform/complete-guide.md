# OneUptime Terraform Provider

Met de OneUptime Terraform Provider kunt u OneUptime-resources beheren via Infrastructure as Code (IaC). Deze provider stelt u in staat monitoring-, incidentbeheer-, statuspagina- en andere OneUptime-functies te configureren via Terraform.

## Inhoudsopgave

- [Installatie](#installatie)
- [Providerconfiguratie](#providerconfiguratie)
- [Snel starten](#snel-starten)
- [Versiecompatibiliteit](#versiecompatibiliteit)
- [Beschikbare resources](#beschikbare-resources)
- [Voorbeelden](#voorbeelden)
- [Best practices](#best-practices)
- [Migratiegids](#migratiegids)

## Installatie

### Vanuit het Terraform Registry (aanbevolen)

De OneUptime Terraform-provider is beschikbaar in het [Terraform Registry](https://registry.terraform.io/providers/oneuptime/oneuptime).

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # Gebruik de nieuwste 7.x-versie
    }
  }
  required_version = ">= 1.0"
}
```

### Versie vastzetten voor zelf-gehoste installaties

⚠️ **Belangrijk voor zelf-gehoste klanten**: Zet de Terraform-providerversie altijd vast zodat deze overeenkomt met uw OneUptime-installatieversie om API-compatibiliteit te garanderen.

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Zet vast op exacte versie die overeenkomt met uw OneUptime-installatie
    }
  }
  required_version = ">= 1.0"
}
```

#### Uw OneUptime-versie vinden

U kunt uw OneUptime-versie op verschillende manieren vinden:

1. **Dashboard**: Ga naar Instellingen → Over in uw OneUptime-dashboard
2. **API**: Roep het eindpunt `GET /api/status` aan
3. **Docker**: Controleer de image-tag die u gebruikt
4. **Helm**: Controleer uw Helm-chartversie

```bash
# Voorbeeld: Als OneUptime 7.0.123 wordt uitgevoerd
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"
    }
  }
}
```

## Providerconfiguratie

### Basisconfiguratie

```hcl
provider "oneuptime" {
  oneuptime_url = "https://your-oneuptime-instance.com"  # Of https://oneuptime.com voor cloud
  api_key       = var.oneuptime_api_key
}
```

### Omgevingsvariabelen

U kunt de provider configureren met omgevingsvariabelen:

```bash
export ONEUPTIME_URL="https://your-oneuptime-instance.com"
export ONEUPTIME_API_KEY="your-api-key-here"
```

Gebruik de provider vervolgens zonder expliciete configuratie:

```hcl
provider "oneuptime" {
  # Configuratie wordt gelezen uit omgevingsvariabelen
}
```

### Configuratie-opties

| Argument | Omgevingsvariabele | Beschrijving | Vereist |
|----------|---------------------|-------------|----------|
| `oneuptime_url` | `ONEUPTIME_URL` | OneUptime-URL | Ja |
| `api_key` | `ONEUPTIME_API_KEY` | OneUptime API-sleutel | Ja |

## Snel starten

### 1. API-sleutel aanmaken

Maak eerst een API-sleutel aan in uw OneUptime-dashboard:

1. Ga naar **Instellingen** → **API-sleutels**
2. Klik op **API-sleutel aanmaken**
3. Geef het een beschrijvende naam (bijv. "Terraform-automatisering")
4. Selecteer de juiste machtigingen
5. Kopieer de gegenereerde API-sleutel

### 2. Basisconfiguratie voor Terraform

Maak een `main.tf`-bestand aan:

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
  oneuptime_url = "https://oneuptime.com"  # Gebruik de URL van uw instantie
  api_key       = var.oneuptime_api_key
}

# Opmerking: Projecten moeten handmatig worden aangemaakt in het OneUptime-dashboard
variable "project_id" {
  description = "OneUptime project-ID"
  type        = string
}

# Een monitor aanmaken
resource "oneuptime_monitor" "website" {
  name        = "Website Monitor"
  description = "Monitor voor website-uptime"
  data        = jsonencode({
    url = "https://example.com"
    interval = "5m"
    timeout = "30s"
  })
}

# Een team aanmaken
resource "oneuptime_team" "platform" {
  name        = "Platform Team"
  description = "Platform engineering team"
}
    value = "alerts@example.com"
  }
}
```

### 3. Initialiseren en toepassen

```bash
# Terraform initialiseren
terraform init

# De wijzigingen plannen
terraform plan

# De configuratie toepassen
terraform apply
```

## Versiecompatibiliteit

### Cloudklanten

Gebruik voor OneUptime Cloud-klanten de nieuwste providerversie:

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # Gebruik altijd de nieuwste compatibele versie
    }
  }
}
```

### Zelf-gehoste klanten

**Kritiek**: Zelf-gehoste klanten moeten de providerversie vastzetten zodat deze overeenkomt met hun OneUptime-installatie:

| OneUptime-versie | Providerversie | Configuratie |
|-------------------|------------------|---------------|
| 7.0.x | 7.0.x | `version = "~> 7.0.0"` |
| 7.1.x | 7.1.x | `version = "~> 7.1.0"` |
| 7.2.x | 7.2.x | `version = "~> 7.2.0"` |

Voorbeeld voor OneUptime 7.0.123:

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Exacte versieovereenkomst
    }
  }
}
```

## Beschikbare resources

De OneUptime Terraform-provider ondersteunt de volgende resources:

### Kernresources
- `oneuptime_team` - Teams beheren

### Monitoring
- `oneuptime_monitor` - Monitors aanmaken en beheren
- `oneuptime_probe` - Monitoringprobes beheren

### Piketbeheer
- `oneuptime_on_call_duty_policy` - Piketschema's instellen

### Statuspagina's
- `oneuptime_status_page` - Statuspagina's aanmaken

### Servicecatalogus
- `oneuptime_service_catalog` - Servicecatalogusitems beheren

### Diensten
- `oneuptime_service` - Diensten definiëren
- `oneuptime_service_dependency` - Dienstafhankelijkheden in kaart brengen

### Gegevensbronnen
Opmerking: Gegevensbronnen zijn momenteel niet beschikbaar in de provider.

## Best practices

### 1. Versiebeheer

**Voor cloudklanten:**
- Gebruik semantisch versiebeheer met `~>` om compatibele updates te ontvangen
- Bekijk het wijzigingenlogboek voor grote versie-upgrades

**Voor zelf-gehoste klanten:**
- Zet altijd vast op de exacte versie die overeenkomt met uw installatie
- Werk de providerversie bij wanneer u OneUptime upgradet
- Test eerst in een niet-productieomgeving

### 2. Statusbeheer

```hcl
terraform {
  backend "s3" {
    bucket = "my-terraform-state"
    key    = "oneuptime/terraform.tfstate"
    region = "us-west-2"
  }
}
```

### 3. Omgevingsscheiding

Gebruik werkruimten of afzonderlijke statusbestanden voor verschillende omgevingen:

```bash
# Met werkruimten
terraform workspace new production
terraform workspace new staging

# Met afzonderlijke mappen
mkdir -p environments/{staging,production}
```

### 4. Variabelenbeheer

```hcl
# variables.tf
variable "environment" {
  description = "Omgevingsnaam"
  type        = string
}

variable "monitors" {
  description = "Lijst van aan te maken monitors"
  type = list(object({
    name = string
    url  = string
    type = string
  }))
}

# terraform.tfvars
environment = "production"
monitors = [
  {
    name = "Website"
    url  = "https://example.com"
    type = "website"
  },
  {
    name = "API"
    url  = "https://api.example.com/health"
    type = "api"
  }
]
```

### 5. Resource-naamgeving

Gebruik consistente naamgevingsconventies:

```hcl
resource "oneuptime_monitor" "website_production" {
  name = "${var.environment}-website-monitor"
  # ...
}

resource "oneuptime_alert_policy" "critical_production" {
  name = "${var.environment}-critical-alerts"
  # ...
}
```

## Migratiegids

### Vanuit handmatige configuratie

1. **Bestaande resources controleren** in het OneUptime-dashboard
2. **Terraform-configuratie aanmaken** voor bestaande resources
3. **Bestaande resources importeren** in de Terraform-status
4. **Configuratie valideren** ten opzichte van de huidige status
5. **Wijzigingen incrementeel toepassen**

Voorbeeld van importeren:

```bash
# Bestaande monitor importeren
terraform import oneuptime_monitor.website monitor-id-here

# Bestaand project importeren
terraform import oneuptime_project.main project-id-here
```

### Versie-upgrades

Bij het upgraden van OneUptime (zelf-gehost):

1. **Maak een back-up van de huidige status**
2. **Controleer providercompatibiliteit**
3. **Werk de providerversie bij** in de configuratie
4. **Test in een stagingomgeving**
5. **Toepassen op productie**

```bash
# Back-up van status
terraform state pull > backup.tfstate

# Providerversie bijwerken
# Bewerk het terraform-blok in uw configuratie

# Plannen en toepassen
terraform init -upgrade
terraform plan
terraform apply
```

## Ondersteuning en resources

- **Documentatie**: [OneUptime Docs](https://docs.oneuptime.com)
- **Terraform Registry**: [OneUptime Provider](https://registry.terraform.io/providers/oneuptime/oneuptime)
- **GitHub Issues**: [OneUptime GitHub](https://github.com/OneUptime/oneuptime/issues)
- **Community**: [OneUptime Community](https://community.oneuptime.com)

## Probleemoplossing

### Veelgebruikte problemen

1. **Versie-mismatch (zelf-gehost)**
   ```
   Error: API version incompatible
   ```
   **Oplossing**: Zorg dat de providerversie overeenkomt met de OneUptime-installatie

2. **Authenticatieproblemen**
   ```
   Error: Invalid API key
   ```
   **Oplossing**: Verifieer de API-sleutel en machtigingen

3. **Resource niet gevonden**
   ```
   Error: Resource not found
   ```
   **Oplossing**: Controleer resource-ID's en zorg dat de resource bestaat

### Foutopsporingsmodus

Schakel gedetailleerde logboekregistratie in:

```bash
export TF_LOG=DEBUG
terraform apply
```

### Versiecontrole

Verifieer uw instelling:

```bash
# Terraform-versie controleren
terraform version

# Providerversie controleren
terraform providers

# Configuratie valideren
terraform validate
```
