# OneUptime Terraform Provider

OneUptime Terraform Provider giver dig mulighed for at administrere OneUptime-ressourcer ved hjælp af Infrastructure as Code (IaC). Denne provider giver dig mulighed for at konfigurere overvågning, incident management, statussider og andre OneUptime-funktioner via Terraform.

## Indholdsfortegnelse

- [Installation](#installation)
- [Providerkonfiguration](#providerkonfiguration)
- [Hurtig start](#hurtig-start)
- [Versionskompatibilitet](#versionskompatibilitet)
- [Tilgængelige ressourcer](#tilgaengelige-ressourcer)
- [Eksempler](#eksempler)
- [Bedste praksis](#bedste-praksis)
- [Migrationsvejledning](#migrationsvejledning)

## Installation

### Fra Terraform Registry (anbefalet)

OneUptime Terraform-provideren er tilgængeligt på [Terraform Registry](https://registry.terraform.io/providers/oneuptime/oneuptime).

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # Brug nyeste 7.x-version
    }
  }
  required_version = ">= 1.0"
}
```

### Versionsfastlåsning til selvhostede installationer

⚠️ **Vigtigt for selvhostede kunder**: Fastlås altid Terraform-providerversionen til at matche din OneUptime-installationsversion for at sikre API-kompatibilitet.

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Fastlås til nøjagtig version, der matcher din OneUptime-installation
    }
  }
  required_version = ">= 1.0"
}
```

#### Find din OneUptime-version

Du kan finde din OneUptime-version på flere måder:

1. **Dashboard**: Gå til Indstillinger → Om i dit OneUptime-dashboard
2. **API**: Kald `GET /api/status`-endpointet
3. **Docker**: Kontroller det billedtag, du bruger
4. **Helm**: Kontroller din Helm-chartversion

```bash
# Eksempel: Hvis du kører OneUptime 7.0.123
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"
    }
  }
}
```

## Providerkonfiguration

### Grundlæggende konfiguration

```hcl
provider "oneuptime" {
  oneuptime_url = "https://your-oneuptime-instance.com"  # Eller https://oneuptime.com til sky
  api_key       = var.oneuptime_api_key
}
```

### Miljøvariabler

Du kan konfigurere provideren ved hjælp af miljøvariabler:

```bash
export ONEUPTIME_URL="https://your-oneuptime-instance.com"
export ONEUPTIME_API_KEY="your-api-key-here"
```

Brug derefter provideren uden eksplicit konfiguration:

```hcl
provider "oneuptime" {
  # Konfiguration læses fra miljøvariabler
}
```

### Konfigurationsmuligheder

| Argument        | Miljøvariabel       | Beskrivelse         | Påkrævet |
| --------------- | ------------------- | ------------------- | -------- |
| `oneuptime_url` | `ONEUPTIME_URL`     | OneUptime-URL       | Ja       |
| `api_key`       | `ONEUPTIME_API_KEY` | OneUptime API-nøgle | Ja       |

## Hurtig start

### 1. Opret API-nøgle

Opret først en API-nøgle i dit OneUptime-dashboard:

1. Gå til **Indstillinger** → **API-nøgler**
2. Klik på **Opret API-nøgle**
3. Giv den et beskrivende navn (f.eks. "Terraform Automatisering")
4. Vælg passende tilladelser
5. Kopiér den genererede API-nøgle

### 2. Grundlæggende Terraform-konfiguration

Opret en `main.tf`-fil:

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
  oneuptime_url = "https://oneuptime.com"  # Brug din instans-URL
  api_key       = var.oneuptime_api_key
}

# Bemærk: Projekter skal oprettes manuelt i OneUptime-dashboardet
variable "project_id" {
  description = "OneUptime projekt-ID"
  type        = string
}

# Opret en monitor
resource "oneuptime_monitor" "website" {
  name        = "Website Monitor"
  description = "Monitor til webstedets oppetid"
  data        = jsonencode({
    url = "https://example.com"
    interval = "5m"
    timeout = "30s"
  })
}

# Opret et team
resource "oneuptime_team" "platform" {
  name        = "Platform Team"
  description = "Platform ingeniørteam"
}
    value = "alerts@example.com"
  }
}
```

### 3. Initialisér og anvend

```bash
# Initialisér Terraform
terraform init

# Planlæg ændringerne
terraform plan

# Anvend konfigurationen
terraform apply
```

## Versionskompatibilitet

### Skykunder

Til OneUptime Cloud-kunder skal du bruge den seneste providerversion:

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # Brug altid seneste kompatible version
    }
  }
}
```

### Selvhostede kunder

**Kritisk**: Selvhostede kunder skal fastlåse providerversionen til at matche deres OneUptime-installation nøjagtigt:

| OneUptime-version | Providerversion | Konfiguration          |
| ----------------- | --------------- | ---------------------- |
| 7.0.x             | 7.0.x           | `version = "~> 7.0.0"` |
| 7.1.x             | 7.1.x           | `version = "~> 7.1.0"` |
| 7.2.x             | 7.2.x           | `version = "~> 7.2.0"` |

Eksempel til OneUptime 7.0.123:

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Nøjagtig versionsmatch
    }
  }
}
```

## Tilgængelige ressourcer

OneUptime Terraform-provideren understøtter følgende ressourcer:

### Kerneressourcer

- `oneuptime_team` – Administrer teams

### Overvågning

- `oneuptime_monitor` – Opret og administrer monitorer
- `oneuptime_probe` – Administrer overvågningsprober

### Vagtadministration

- `oneuptime_on_call_duty_policy` – Opsæt vagtplaner

### Statussider

- `oneuptime_status_page` – Opret statussider

### Tjenestekatalog

- `oneuptime_service_catalog` – Administrer tjenestekatalogposter

### Tjenestekatalog

- `oneuptime_service` – Definer tjenester
- `oneuptime_service_dependency` – Kortlæg tjenesteafhængigheder

### Datakilder

Bemærk: Datakilder er ikke i øjeblikket tilgængelige i provideren, da ingen datakilder er defineret i providerskemaet.

## Eksempler

### Komplet overvågningsopsætning

```hcl
# Variabler
variable "oneuptime_api_key" {
  description = "OneUptime API-nøgle"
  type        = string
  sensitive   = true
}

variable "project_id" {
  description = "OneUptime projekt-ID (opret projekt manuelt i dashboardet)"
  type        = string
}

variable "oneuptime_url" {
  description = "OneUptime-URL"
  type        = string
  default     = "https://oneuptime.com"
}

# Providerkonfiguration
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"
    }
  }
}

provider "oneuptime" {
  oneuptime_url = var.oneuptime_url
  api_key       = var.oneuptime_api_key
}

# Team
resource "oneuptime_team" "platform" {
  name        = "Platform Team"
  description = "Platform ingeniørteam"
}

# Monitorer
resource "oneuptime_monitor" "api" {
  name        = "API Health Check"
  description = "Monitor til API-sundhedsendpoint"
  data        = jsonencode({
    url = "https://api.mycompany.com/health"
    method = "GET"
    interval = "1m"
    timeout = "30s"
  })
  }
}

resource "oneuptime_monitor" "database" {
  name       = "Database Connection"
  project_id = oneuptime_project.production.id

  monitor_type = "port"
  hostname     = "db.mycompany.com"
  port         = 5432
  interval     = "2m"

  tags = {
    service     = "database"
    environment = "production"
    criticality = "critical"
  }
}

# Vagtpolitik
resource "oneuptime_on_call_policy" "platform_oncall" {
  name       = "Platform On-Call"
  project_id = oneuptime_project.production.id
  team_id    = oneuptime_team.platform.id

  schedules {
    name      = "Business Hours"
    timezone  = "America/New_York"

    layers {
      name = "Primary"
      users = ["user1@mycompany.com", "user2@mycompany.com"]
      rotation_type = "weekly"
      start_time = "09:00"
      end_time = "17:00"
      days = ["monday", "tuesday", "wednesday", "thursday", "friday"]
    }
  }
}

# Advarsels-politik
resource "oneuptime_alert_policy" "critical_alerts" {
  name       = "Critical System Alerts"
  project_id = oneuptime_project.production.id

  conditions {
    monitor_id = oneuptime_monitor.api.id
    threshold  = "down"
  }

  conditions {
    monitor_id = oneuptime_monitor.database.id
    threshold  = "down"
  }

  actions {
    type = "webhook"
    url  = "https://hooks.slack.com/services/YOUR/SLACK/WEBHOOK"
  }

  actions {
    type           = "oncall_escalation"
    oncall_policy_id = oneuptime_on_call_policy.platform_oncall.id
  }
}

# Statusside
resource "oneuptime_status_page" "public" {
  name       = "MyCompany Status"
  project_id = oneuptime_project.production.id

  domain = "status.mycompany.com"

  components {
    name       = "API"
    monitor_id = oneuptime_monitor.api.id
  }

  components {
    name       = "Database"
    monitor_id = oneuptime_monitor.database.id
  }
}
```

### Eksempel på selvhostet konfiguration

```hcl
# Til selvhostet OneUptime-instans version 7.0.123
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Skal matche din OneUptime-version nøjagtigt
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.mycompany.com"  # Din selvhostede URL
  api_key       = var.oneuptime_api_key
}

# Resten af din konfiguration...
```

## Bedste praksis

### 1. Versionsstyring

**Til skykunder:**

- Brug semantisk versionering med `~>` for at få kompatible opdateringer
- Gennemgå changelog inden større versionopgraderinger

**Til selvhostede kunder:**

- Fastlås altid til nøjagtig version, der matcher din installation
- Opdater providerversionen, når du opgraderer OneUptime
- Test i ikke-produktionsmiljø først

### 2. Tilstandsstyring

```hcl
terraform {
  backend "s3" {
    bucket = "my-terraform-state"
    key    = "oneuptime/terraform.tfstate"
    region = "us-west-2"
  }
}
```

### 3. Miljøadskillelse

Brug arbejdsområder eller separate tilstandsfiler til forskellige miljøer:

```bash
# Brug af arbejdsområder
terraform workspace new production
terraform workspace new staging

# Brug af separate mapper
mkdir -p environments/{staging,production}
```

### 4. Variabelstyring

```hcl
# variables.tf
variable "environment" {
  description = "Miljønavn"
  type        = string
}

variable "monitors" {
  description = "Liste over monitorer der skal oprettes"
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

### 5. Ressourcenavngivning

Brug konsekvente navnekonventioner:

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

## Migrationsvejledning

### Fra manuel konfiguration

1. **Gennemgå eksisterende ressourcer** i OneUptime-dashboardet
2. **Opret Terraform-konfiguration** til eksisterende ressourcer
3. **Importér eksisterende ressourcer** til Terraform-tilstand
4. **Valider konfiguration** matcher aktuel tilstand
5. **Anvend ændringer** trinvist

Eksempel på import:

```bash
# Importér eksisterende monitor
terraform import oneuptime_monitor.website monitor-id-here

# Importér eksisterende projekt
terraform import oneuptime_project.main project-id-here
```

### Versionsopgraderinger

Når du opgraderer OneUptime (selvhostet):

1. **Sikkerhedskopier din aktuelle tilstand**
2. **Kontroller providerkompatibilitet**
3. **Opdater providerversion** i konfigurationen
4. **Test i staging-miljø**
5. **Anvend i produktion**

```bash
# Sikkerhedskopier tilstand
terraform state pull > backup.tfstate

# Opdater providerversion
# Rediger terraform-blokken i din konfiguration

# Planlæg og anvend
terraform init -upgrade
terraform plan
terraform apply
```

## Support og ressourcer

- **Dokumentation**: [OneUptime Docs](https://docs.oneuptime.com)
- **Terraform Registry**: [OneUptime Provider](https://registry.terraform.io/providers/oneuptime/oneuptime)
- **GitHub Issues**: [OneUptime GitHub](https://github.com/OneUptime/oneuptime/issues)
- **Fællesskab**: [OneUptime Community](https://community.oneuptime.com)

## Fejlfinding

### Almindelige problemer

1. **Versionsmismatch (selvhostet)**

   ```
   Error: API version incompatible
   ```

   **Løsning**: Sørg for, at providerversionen matcher OneUptime-installationen

2. **Autentificeringsproblemer**

   ```
   Error: Invalid API key
   ```

   **Løsning**: Bekræft API-nøgle og tilladelser

3. **Ressource ikke fundet**
   ```
   Error: Resource not found
   ```
   **Løsning**: Kontroller ressource-ID'er og sørg for, at ressourcen eksisterer

### Fejlsøgningstilstand

Aktiver detaljeret logning:

```bash
export TF_LOG=DEBUG
terraform apply
```

### Versionstjek

Bekræft din opsætning:

```bash
# Kontroller Terraform-version
terraform version

# Kontroller providerversion
terraform providers

# Valider konfiguration
terraform validate
```
