# Zelf-gehoste OneUptime Terraform-configuratiegids

Deze gids is specifiek bedoeld voor klanten die zelf-gehoste OneUptime-instanties uitvoeren. Het behandelt versiebeheer, configuratie en best practices voor het gebruik van de Terraform-provider met uw eigen OneUptime-implementatie.

## Belangrijke opmerkingen

⚠️ **Projecten kunnen niet via Terraform worden aangemaakt** — Projecten moeten eerst handmatig worden aangemaakt in het OneUptime-dashboard. Gebruik het project-ID in uw Terraform-configuraties.

⚠️ **De belangrijkste regel voor zelf-gehoste klanten**: Zet uw Terraform-providerversie altijd vast zodat deze exact overeenkomt met uw OneUptime-installatieversie.

## Resourcestructuur

Alle OneUptime Terraform-resources volgen een vereenvoudigde structuur:

- `name` (vereist) - Resourcenaam
- `description` (optioneel) - Resourcebeschrijving
- `data` (optioneel) - Complexe configuratie als JSON

## Kritiek: Versiecompatibiliteit

⚠️ **De belangrijkste regel voor zelf-gehoste klanten**: Zet uw Terraform-providerversie altijd vast zodat deze exact overeenkomt met uw OneUptime-installatieversie.

### Waarom versie vastzetten kritiek is

- De Terraform-provider wordt automatisch gegenereerd vanuit de OneUptime API
- Elke OneUptime-versie kan verschillende API-eindpunten en schema's hebben
- Het gebruik van een niet-overeenkomende providerversie kan fouten of onverwacht gedrag veroorzaken
- Versie vastzetten garandeert compatibiliteit en voorspelbaar gedrag

## Uw OneUptime-versie vinden

### Methode 1: Dashboard

1. Log in op uw OneUptime-dashboard
2. Ga naar **Instellingen** → **Over**
3. Zoek het versienummer (bijv. "7.0.123")

### Methode 2: API-eindpunt

```bash
curl https://your-oneuptime-instance.com/api/status
```

### Methode 3: Docker-images

Als u OneUptime met Docker uitvoert:

```bash
docker images | grep oneuptime
# Zoek naar de tag, bijv. oneuptime/dashboard:7.0.123
```

### Methode 4: Helm-chart

Als u Helm gebruikt:

```bash
helm list -n oneuptime
# Controleer de chartversie
```

### Methode 5: Omgevingsvariabelen

Controleer uw configuratiebestanden op versievariabelen:

```bash
grep -r "APP_VERSION\|IMAGE_TAG" /path/to/your/oneuptime/config
```

## Providerconfiguratie-sjablonen

### Sjabloon voor versie 7.0.x

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Vervang 123 door uw exacte buildnummer
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.yourcompany.com"  # Uw zelf-gehoste URL
  api_key       = var.oneuptime_api_key
}
```

### Sjabloon voor versie 7.1.x

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.1.45"  # Vervang door uw exacte versie
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.yourcompany.com"
  api_key       = var.oneuptime_api_key
}
```

## Volledig voorbeeld van zelf-gehoste configuratie

Hier is een volledig voorbeeld voor een zelf-gehoste OneUptime-instantie:

```hcl
# versions.tf
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Moet overeenkomen met uw OneUptime-versie
    }
  }
  required_version = ">= 1.0"

  # Optioneel: Gebruik externe status voor teamsamenwerking
  backend "s3" {
    bucket = "your-terraform-state-bucket"
    key    = "oneuptime/terraform.tfstate"
    region = "us-west-2"
  }
}

# variables.tf
variable "oneuptime_url" {
  description = "OneUptime-instantie-URL"
  type        = string
  default     = "https://oneuptime.yourcompany.com"
}

variable "oneuptime_api_key" {
  description = "OneUptime API-sleutel"
  type        = string
  sensitive   = true
}

variable "environment" {
  description = "Omgevingsnaam"
  type        = string
  default     = "production"
}

# providers.tf
provider "oneuptime" {
  oneuptime_url = var.oneuptime_url
  api_key       = var.oneuptime_api_key
}

# variables.tf
variable "project_id" {
  description = "OneUptime project-ID (handmatig aanmaken in dashboard)"
  type        = string
}

# main.tf
# Teams aanmaken
resource "oneuptime_team" "infrastructure" {
  name        = "Infrastructuurteam"
  description = "Infrastructuur- en operatieteam"
}

resource "oneuptime_team" "development" {
  name        = "Ontwikkelingsteam"
  description = "Applicatieontwikkelingsteam"
  project_id = oneuptime_project.main.id
}

# Infrastructuurmonitors
resource "oneuptime_monitor" "database" {
  name       = "${var.environment}-database"
  project_id = oneuptime_project.main.id

  monitor_type = "port"
  hostname     = "db.internal.yourcompany.com"
  port         = 5432
  interval     = "2m"
  timeout      = "10s"

  tags = {
    team        = "infrastructure"
    service     = "database"
    environment = var.environment
    criticality = "critical"
  }
}

resource "oneuptime_monitor" "application" {
  name       = "${var.environment}-application"
  project_id = oneuptime_project.main.id

  monitor_type = "website"
  url          = "https://app.yourcompany.com/health"
  interval     = "1m"
  timeout      = "30s"

  expected_status_codes = [200]

  tags = {
    team        = "development"
    service     = "application"
    environment = var.environment
    criticality = "high"
  }
}
```

## Omgevingsspecifieke configuratie

### Ontwikkelomgeving

```hcl
# dev.tfvars
oneuptime_url = "https://oneuptime-dev.yourcompany.com"
environment = "development"
```

### Stagingomgeving

```hcl
# staging.tfvars
oneuptime_url = "https://oneuptime-staging.yourcompany.com"
environment = "staging"
```

### Productieomgeving

```hcl
# prod.tfvars
oneuptime_url = "https://oneuptime.yourcompany.com"
environment = "production"
```

## Upgradeproces voor zelf-gehost

Bij het upgraden van uw OneUptime-instantie:

### 1. Controlelijst voor upgrade

```bash
# Back-up van huidige Terraform-status
terraform state pull > backup-$(date +%Y%m%d).tfstate

# Huidige OneUptime-versie noteren
curl https://oneuptime.yourcompany.com/api/status | jq '.version'

# Huidige providerversie noteren
terraform providers | grep oneuptime
```

### 2. OneUptime-instantie upgraden

Volg uw standaard OneUptime-upgradeproces (Docker, Helm, enz.)

### 3. Terraform-provider bijwerken

```hcl
# Versie bijwerken in terraform-blok
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.124"  # Nieuwe versie na upgrade
    }
  }
}
```

### 4. Testen en toepassen

```bash
# Provider bijwerken
terraform init -upgrade

# Plannen om eventuele wijzigingen te zien
terraform plan

# Toepassen als alles er goed uitziet
terraform apply
```

## Netwerkconfiguratie

### Firewallregels

Zorg dat uw Terraform-runner toegang heeft tot:

- OneUptime API-eindpunt (doorgaans poort 443/HTTPS)
- Interne resources die worden bewaakt

### VPN/Privénetwerken

Als OneUptime op een privénetwerk staat:

```hcl
provider "oneuptime" {
  oneuptime_url = "https://10.0.1.100:443"  # Intern IP
  api_key       = var.oneuptime_api_key
}
```

## Beveiligingsbest practices

### 1. API-sleutelbeheer

```bash
# Omgevingsvariabelen gebruiken
export ONEUPTIME_API_KEY="your-api-key"

# Of gebruik een geheimbeheersysteem
export ONEUPTIME_API_KEY=$(vault kv get -field=api_key secret/oneuptime)
```

### 2. Principe van minimale bevoegdheden voor API-sleutels

Maak API-sleutels aan met minimale vereiste machtigingen:

- Monitorbeheer
- Meldingsbeleidbeheer
- Teambeheer (indien nodig)

## Back-up en herstel na rampen

### Status back-up

```bash
# Regelmatige statusback-ups
terraform state pull > backup-$(date +%Y%m%d-%H%M%S).tfstate

# Geautomatiseerd back-upscript
#!/bin/bash
DATE=$(date +%Y%m%d-%H%M%S)
terraform state pull > "backups/terraform-state-${DATE}.tfstate"
find backups/ -name "terraform-state-*.tfstate" -mtime +30 -delete
```

## Beheer van meerdere omgevingen

### Werkruimten gebruiken

```bash
# Omgevingen aanmaken
terraform workspace new dev
terraform workspace new staging
terraform workspace new prod

# Schakelen tussen omgevingen
terraform workspace select prod
terraform apply -var-file="prod.tfvars"
```

### Afzonderlijke mappen gebruiken

```
terraform/
├── environments/
│   ├── dev/
│   │   ├── main.tf
│   │   └── terraform.tfvars
│   ├── staging/
│   │   ├── main.tf
│   │   └── terraform.tfvars
│   └── prod/
│       ├── main.tf
│       └── terraform.tfvars
└── modules/
    └── oneuptime/
        ├── main.tf
        ├── variables.tf
        └── outputs.tf
```

Deze aanpak biedt betere isolatie en eenvoudiger versiebeheer per omgeving.

## Probleemoplossing voor zelf-gehoste problemen

### Probleem: Verbinding geweigerd

```
Error: connection refused
```

**Oplossingen**:

1. Controleer of de OneUptime-instantie actief is
2. Verifieer of de API-URL correct is
3. Controleer firewall-/netwerkconnectiviteit
4. Verifieer of TLS-certificaten geldig zijn

### Probleem: API-versie-mismatch

```
Error: API version incompatible
```

**Oplossingen**:

1. Controleer de OneUptime-versie: `curl https://your-instance/api/status`
2. Werk de providerversie bij zodat deze overeenkomt
3. Voer `terraform init -upgrade` uit

### Probleem: Zelfondertekende certificaten

Als u zelfondertekende certificaten gebruikt:

```bash
# TLS-verificatie tijdelijk overslaan (niet aanbevolen voor productie)
export ONEUPTIME_SKIP_TLS_VERIFY=true
```

Betere oplossing: Voeg uw CA-certificaat toe aan de systeemvertrouwensopslag.
