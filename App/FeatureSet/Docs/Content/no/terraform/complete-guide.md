# OneUptime Terraform-leverandør

OneUptime Terraform-leverandøren lar deg administrere OneUptime-ressurser ved hjelp av Infrastructure as Code (IaC). Denne leverandøren gjør det mulig å konfigurere overvåking, hendelseshåndtering, statussider og andre OneUptime-funksjoner gjennom Terraform.

## Innholdsfortegnelse

- [Installasjon](#installasjon)
- [Leverandørkonfigurasjon](#leverandørkonfigurasjon)
- [Hurtigstart](#hurtigstart)
- [Versjonskompatibilitet](#versjonskompatibilitet)
- [Tilgjengelige ressurser](#tilgjengelige-ressurser)
- [Eksempler](#eksempler)
- [Beste praksis](#beste-praksis)
- [Migrasjonsguide](#migrasjonsguide)

## Installasjon

### Fra Terraform Registry (anbefalt)

OneUptime Terraform-leverandøren er tilgjengelig på [Terraform Registry](https://registry.terraform.io/providers/oneuptime/oneuptime).

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # Bruk siste 7.x-versjon
    }
  }
  required_version = ">= 1.0"
}
```

### Versjonsfesting for selvhostede installasjoner

**Viktig for selvhostede kunder**: Fest alltid Terraform-leverandørversjonen til å samsvare med OneUptime-installasjonsversjonen for å sikre API-kompatibilitet.

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Fest til eksakt versjon som samsvarer med OneUptime-installasjonen
    }
  }
  required_version = ">= 1.0"
}
```

#### Finne din OneUptime-versjon

Du kan finne din OneUptime-versjon på flere måter:

1. **Dashbord**: Gå til Settings → About i OneUptime-dashbordet
2. **API**: Kall `GET /api/status`-endepunktet
3. **Docker**: Sjekk bildets tag du bruker
4. **Helm**: Sjekk Helm-kartversjonen

```bash
# Eksempel: Hvis du kjører OneUptime 7.0.123
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"
    }
  }
}
```

## Leverandørkonfigurasjon

### Grunnleggende konfigurasjon

```hcl
provider "oneuptime" {
  oneuptime_url = "https://your-oneuptime-instance.com"  # Eller https://oneuptime.com for sky
  api_key       = var.oneuptime_api_key
}
```

### Miljøvariabler

Du kan konfigurere leverandøren ved hjelp av miljøvariabler:

```bash
export ONEUPTIME_URL="https://your-oneuptime-instance.com"
export ONEUPTIME_API_KEY="your-api-key-here"
```

Bruk deretter leverandøren uten eksplisitt konfigurasjon:

```hcl
provider "oneuptime" {
  # Konfigurasjon vil bli lest fra miljøvariabler
}
```

### Konfigurasjonsalternativer

| Argument        | Miljøvariabel       | Beskrivelse          | Påkrevd |
| --------------- | ------------------- | -------------------- | ------- |
| `oneuptime_url` | `ONEUPTIME_URL`     | OneUptime-URL        | Ja      |
| `api_key`       | `ONEUPTIME_API_KEY` | OneUptime API-nøkkel | Ja      |

## Hurtigstart

### 1. Opprett API-nøkkel

Opprett først en API-nøkkel i OneUptime-dashbordet:

1. Gå til **Settings** → **API Keys**
2. Klikk **Create API Key**
3. Gi den et beskrivende navn (f.eks. "Terraform-automatisering")
4. Velg passende tillatelser
5. Kopier den genererte API-nøkkelen

### 2. Grunnleggende Terraform-konfigurasjon

Opprett en `main.tf`-fil:

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
  oneuptime_url = "https://oneuptime.com"  # Bruk instans-URL-en din
  api_key       = var.oneuptime_api_key
}

# Merk: Prosjekter må opprettes manuelt i OneUptime-dashbordet
variable "project_id" {
  description = "OneUptime prosjekt-ID"
  type        = string
}

# Opprett en monitor
resource "oneuptime_monitor" "website" {
  name        = "Nettstedmonitor"
  description = "Monitor for nettstedoppetid"
  data        = jsonencode({
    url = "https://example.com"
    interval = "5m"
    timeout = "30s"
  })
}

# Opprett et team
resource "oneuptime_team" "platform" {
  name        = "Plattformteam"
  description = "Plattformingeniørteam"
}
    value = "alerts@example.com"
  }
}
```

### 3. Initialiser og bruk

```bash
# Initialiser Terraform
terraform init

# Planlegg endringene
terraform plan

# Bruk konfigurasjonen
terraform apply
```

## Versjonskompatibilitet

### Sky-kunder

For OneUptime Cloud-kunder, bruk den siste leverandørversjonen:

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # Bruk alltid siste kompatible versjon
    }
  }
}
```

### Selvhostede kunder

**Kritisk**: Selvhostede kunder må feste leverandørversjonen til å samsvare med OneUptime-installasjonen:

| OneUptime-versjon | Leverandørversjon | Konfigurasjon          |
| ----------------- | ----------------- | ---------------------- |
| 7.0.x             | 7.0.x             | `version = "~> 7.0.0"` |
| 7.1.x             | 7.1.x             | `version = "~> 7.1.0"` |
| 7.2.x             | 7.2.x             | `version = "~> 7.2.0"` |

Eksempel for OneUptime 7.0.123:

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Eksakt versjonssamsvaring
    }
  }
}
```

## Tilgjengelige ressurser

OneUptime Terraform-leverandøren støtter følgende ressurser:

### Kjernressurser

- `oneuptime_team` – Administrer team

### Overvåking

- `oneuptime_monitor` – Opprett og administrer monitorer
- `oneuptime_probe` – Administrer overvåkingsprober

### Vakthåndtering

- `oneuptime_on_call_duty_policy` – Sett opp vaktplaner

### Statussider

- `oneuptime_status_page` – Opprett statussider

### Tjenestekatalog

- `oneuptime_service_catalog` – Administrer tjenestekatalogoppføringer

### Tjenestekatalog

- `oneuptime_service` – Definer tjenester
- `oneuptime_service_dependency` – Kart tjenesteavhengigheter

### Datakilder

Merk: Datakilder er for øyeblikket ikke tilgjengelige i leverandøren, da ingen datakilder er definert i leverandørskjemaet.

## Eksempler

### Fullstendig overvåkingsoppsett

```hcl
# Variabler
variable "oneuptime_api_key" {
  description = "OneUptime API-nøkkel"
  type        = string
  sensitive   = true
}

variable "project_id" {
  description = "OneUptime prosjekt-ID (opprett prosjekt manuelt i dashbordet)"
  type        = string
}

variable "oneuptime_url" {
  description = "OneUptime-URL"
  type        = string
  default     = "https://oneuptime.com"
}

# Leverandørkonfigurasjon
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
  name        = "Plattformteam"
  description = "Plattformingeniørteam"
}

# Monitorer
resource "oneuptime_monitor" "api" {
  name        = "API-helsesjekk"
  description = "Monitor for API-helseendepunkt"
  data        = jsonencode({
    url = "https://api.mycompany.com/health"
    method = "GET"
    interval = "1m"
    timeout = "30s"
  })
  }
}

resource "oneuptime_monitor" "database" {
  name       = "Databasetilkobling"
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

# Vakttpolicy
resource "oneuptime_on_call_policy" "platform_oncall" {
  name       = "Plattform vakt"
  project_id = oneuptime_project.production.id
  team_id    = oneuptime_team.platform.id

  schedules {
    name      = "Arbeidstid"
    timezone  = "Europe/Oslo"

    layers {
      name = "Primær"
      users = ["user1@mycompany.com", "user2@mycompany.com"]
      rotation_type = "weekly"
      start_time = "09:00"
      end_time = "17:00"
      days = ["monday", "tuesday", "wednesday", "thursday", "friday"]
    }
  }
}

# Varselspolicy
resource "oneuptime_alert_policy" "critical_alerts" {
  name       = "Kritiske systemvarsler"
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
  name       = "MinBedrift Status"
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

### Selvhostet konfigurasjonseksempel

```hcl
# For selvhostet OneUptime-instans versjon 7.0.123
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Må samsvare nøyaktig med din OneUptime-versjon
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.mycompany.com"  # Din selvhostede URL
  api_key       = var.oneuptime_api_key
}

# Resten av konfigurasjonen...
```

## Beste praksis

### 1. Versjonshåndtering

**For Sky-kunder:**

- Bruk semantisk versjonering med `~>` for å få kompatible oppdateringer
- Se gjennom endringsloggen før store versjonsoppgraderinger

**For selvhostede kunder:**

- Fest alltid til eksakt versjon som samsvarer med installasjonen
- Oppdater leverandørversjon når du oppgraderer OneUptime
- Test i ikke-produksjonsmiljø først

### 2. Tilstandshåndtering

```hcl
terraform {
  backend "s3" {
    bucket = "my-terraform-state"
    key    = "oneuptime/terraform.tfstate"
    region = "us-west-2"
  }
}
```

### 3. Miljøseparasjon

Bruk arbeidsområder eller separate tilstandsfiler for ulike miljøer:

```bash
# Bruke arbeidsområder
terraform workspace new production
terraform workspace new staging

# Bruke separate kataloger
mkdir -p environments/{staging,production}
```

### 4. Variabelhåndtering

```hcl
# variables.tf
variable "environment" {
  description = "Miljønavn"
  type        = string
}

variable "monitors" {
  description = "Liste over monitorer som skal opprettes"
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
    name = "Nettsted"
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

### 5. Ressursnavngiving

Bruk konsistente navngivingskonvensjoner:

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

## Migrasjonsguide

### Fra manuell konfigurasjon

1. **Revisjon av eksisterende ressurser** i OneUptime-dashbordet
2. **Opprett Terraform-konfigurasjon** for eksisterende ressurser
3. **Importer eksisterende ressurser** til Terraform-tilstand
4. **Valider konfigurasjon** samsvarer med gjeldende tilstand
5. **Bruk endringer** trinnvis

Eksempelimport:

```bash
# Importer eksisterende monitor
terraform import oneuptime_monitor.website monitor-id-here

# Importer eksisterende prosjekt
terraform import oneuptime_project.main project-id-here
```

### Versjonsoppgraderinger

Når du oppgraderer OneUptime (selvhostet):

1. **Sikkerhetskopier gjeldende tilstand**
2. **Sjekk leverandørkompatibilitet**
3. **Oppdater leverandørversjon** i konfigurasjon
4. **Test i testmiljø**
5. **Bruk i produksjon**

```bash
# Sikkerhetskopier tilstand
terraform state pull > backup.tfstate

# Oppdater leverandørversjon
# Rediger terraform-blokken i konfigurasjonen

# Planlegg og bruk
terraform init -upgrade
terraform plan
terraform apply
```

## Støtte og ressurser

- **Dokumentasjon**: [OneUptime-dokumenter](https://docs.oneuptime.com)
- **Terraform Registry**: [OneUptime-leverandør](https://registry.terraform.io/providers/oneuptime/oneuptime)
- **GitHub-saker**: [OneUptime GitHub](https://github.com/OneUptime/oneuptime/issues)
- **Community**: [OneUptime Community](https://community.oneuptime.com)

## Feilsøking

### Vanlige problemer

1. **Versjonskonflikt (selvhostet)**

   ```
   Error: API version incompatible
   ```

   **Løsning**: Sørg for at leverandørversjon samsvarer med OneUptime-installasjonen

2. **Autentiseringsproblemer**

   ```
   Error: Invalid API key
   ```

   **Løsning**: Verifiser API-nøkkel og tillatelser

3. **Ressurs ikke funnet**
   ```
   Error: Resource not found
   ```
   **Løsning**: Sjekk ressurs-ID-er og sørg for at ressursen eksisterer

### Feilsøkingsmodus

Aktiver detaljert logging:

```bash
export TF_LOG=DEBUG
terraform apply
```

### Versjonssjekk

Verifiser oppsettet ditt:

```bash
# Sjekk Terraform-versjon
terraform version

# Sjekk leverandørversjon
terraform providers

# Valider konfigurasjon
terraform validate
```
