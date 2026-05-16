# Konfigurasjonsguide for selvhostet OneUptime Terraform

Denne guiden er spesifikt for kunder som kjører selvhostede OneUptime-instanser. Den dekker versjonshåndtering, konfigurasjon og beste praksis for bruk av Terraform-leverandøren med ditt eget OneUptime-oppsett.

## Viktige merknader

**Prosjekter kan ikke opprettes via Terraform** – Prosjekter må opprettes manuelt i OneUptime-dashbordet først. Bruk prosjekt-ID-en i Terraform-konfigurasjonene dine.

**Den viktigste regelen for selvhostede kunder**: Fest alltid Terraform-leverandørversjonen til å samsvare nøyaktig med OneUptime-installasjonsversjonen.

## Ressursstruktur

Alle OneUptime Terraform-ressurser følger en forenklet struktur:
- `name` (påkrevd) – Ressursnavn
- `description` (valgfritt) – Ressursbeskrivelse
- `data` (valgfritt) – Kompleks konfigurasjon som JSON

## Kritisk: Versjonskompatibilitet

**Den viktigste regelen for selvhostede kunder**: Fest alltid Terraform-leverandørversjonen til å samsvare nøyaktig med OneUptime-installasjonsversjonen.

### Hvorfor versjonsfesting er kritisk

- Terraform-leverandøren genereres automatisk fra OneUptime API
- Hver OneUptime-versjon kan ha ulike API-endepunkter og skjemaer
- Bruk av en feilaktig leverandørversjon kan forårsake feil eller uventet atferd
- Versjonsfesting sikrer kompatibilitet og forutsigbar atferd

## Finne din OneUptime-versjon

### Metode 1: Dashbord
1. Logg inn på OneUptime-dashbordet ditt
2. Gå til **Settings** → **About**
3. Se etter versjonsnummeret (f.eks. "7.0.123")

### Metode 2: API-endepunkt
```bash
curl https://your-oneuptime-instance.com/api/status
```

### Metode 3: Docker-bilder
Hvis du kjører OneUptime med Docker:
```bash
docker images | grep oneuptime
# Se etter taggen, f.eks. oneuptime/dashboard:7.0.123
```

### Metode 4: Helm-kart
Hvis du bruker Helm:
```bash
helm list -n oneuptime
# Sjekk kartet-versjonen
```

### Metode 5: Miljøvariabler
Sjekk konfigurasjonsfiler for versjonsvariabler:
```bash
grep -r "APP_VERSION\|IMAGE_TAG" /path/to/your/oneuptime/config
```

## Maler for leverandørkonfigurasjon

### Mal for versjon 7.0.x

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Erstatt 123 med ditt eksakte byggnummer
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.yourcompany.com"  # Din selvhostede URL
  api_key       = var.oneuptime_api_key
}
```

### Mal for versjon 7.1.x

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.1.45"  # Erstatt med din eksakte versjon
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.yourcompany.com"
  api_key       = var.oneuptime_api_key
}
```

## Fullstendig selvhostet konfigurasjonseksempel

Her er et fullstendig eksempel for en selvhostet OneUptime-instans:

```hcl
# versions.tf
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Må samsvare med din OneUptime-versjon
    }
  }
  required_version = ">= 1.0"
  
  # Valgfritt: Bruk ekstern tilstand for teamsamarbeid
  backend "s3" {
    bucket = "your-terraform-state-bucket"
    key    = "oneuptime/terraform.tfstate"
    region = "us-west-2"
  }
}

# variables.tf
variable "oneuptime_url" {
  description = "OneUptime-instans-URL"
  type        = string
  default     = "https://oneuptime.yourcompany.com"
}

variable "oneuptime_api_key" {
  description = "OneUptime API-nøkkel"
  type        = string
  sensitive   = true
}

variable "environment" {
  description = "Miljønavn"
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
  description = "OneUptime prosjekt-ID (opprett manuelt i dashbordet)"
  type        = string
}

# main.tf
# Opprett team
resource "oneuptime_team" "infrastructure" {
  name        = "Infrastrukturteam"
  description = "Infrastruktur- og driftsteam"
}

resource "oneuptime_team" "development" {
  name        = "Utviklingsteam"
  description = "Applikasjonsutviklingsteam"
  project_id = oneuptime_project.main.id
}

# Infrastrukturmonitorer
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

# Vakttpolicyer
resource "oneuptime_on_call_policy" "infrastructure_oncall" {
  name       = "Infrastruktur vakt"
  project_id = oneuptime_project.main.id
  team_id    = oneuptime_team.infrastructure.id
  
  schedules {
    name     = "24x7 Infrastruktur"
    timezone = "Europe/Oslo"
    
    layers {
      name          = "Primær"
      users         = ["infra1@yourcompany.com", "infra2@yourcompany.com"]
      rotation_type = "weekly"
      start_time    = "00:00"
      end_time      = "23:59"
      days          = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
    }
  }
}

# Varselspolicyer
resource "oneuptime_alert_policy" "critical_infrastructure" {
  name       = "Kritiske infrastrukturvarsler"
  project_id = oneuptime_project.main.id
  
  conditions {
    monitor_id = oneuptime_monitor.database.id
    threshold  = "down"
  }
  
  actions {
    type = "email"
    recipients = ["infrastructure@yourcompany.com"]
  }
  
  actions {
    type             = "oncall_escalation"
    oncall_policy_id = oneuptime_on_call_policy.infrastructure_oncall.id
  }
}

# Intern statusside
resource "oneuptime_status_page" "internal" {
  name       = "Interne tjenesterstatus"
  project_id = oneuptime_project.main.id
  
  domain = "status.internal.yourcompany.com"
  
  components {
    name       = "Database"
    monitor_id = oneuptime_monitor.database.id
  }
  
  components {
    name       = "Applikasjon"
    monitor_id = oneuptime_monitor.application.id
  }
}

# outputs.tf
output "project_id" {
  description = "Prosjekt-ID"
  value       = oneuptime_project.main.id
}

output "status_page_url" {
  description = "Statusside-URL"
  value       = "https://${oneuptime_status_page.internal.domain}"
}
```

## Miljøspesifikk konfigurasjon

### Utviklingsmiljø

```hcl
# dev.tfvars
oneuptime_url = "https://oneuptime-dev.yourcompany.com"
environment = "development"
```

### Testmiljø

```hcl
# staging.tfvars
oneuptime_url = "https://oneuptime-staging.yourcompany.com"  
environment = "staging"
```

### Produksjonsmiljø

```hcl
# prod.tfvars
oneuptime_url = "https://oneuptime.yourcompany.com"
environment = "production"
```

## Oppgraderingsprosess for selvhostet

Når du oppgraderer OneUptime-instansen:

### 1. Sjekkliste før oppgradering

```bash
# Sikkerhetskopier gjeldende Terraform-tilstand
terraform state pull > backup-$(date +%Y%m%d).tfstate

# Noter gjeldende OneUptime-versjon
curl https://oneuptime.yourcompany.com/api/status | jq '.version'

# Noter gjeldende leverandørversjon
terraform providers | grep oneuptime
```

### 2. Oppgrader OneUptime-instansen

Følg den standard OneUptime-oppgraderingsprosessen (Docker, Helm, osv.)

### 3. Oppdater Terraform-leverandøren

```hcl
# Oppdater versjon i terraform-blokken
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.124"  # Ny versjon etter oppgradering
    }
  }
}
```

### 4. Test og bruk

```bash
# Oppdater leverandøren
terraform init -upgrade

# Planlegg for å se eventuelle endringer
terraform plan

# Bruk hvis alt ser bra ut
terraform apply
```

## Nettverkskonfigurasjon

### Brannmurregler

Sørg for at Terraform-kjøreren kan få tilgang til:
- OneUptime API-endepunkt (vanligvis port 443/HTTPS)
- Eventuelle interne ressurser som overvåkes

### VPN/private nettverk

Hvis OneUptime er på et privat nettverk:

```hcl
provider "oneuptime" {
  oneuptime_url = "https://10.0.1.100:443"  # Intern IP
  api_key       = var.oneuptime_api_key
}
```

## Beste sikkerhetspraksis

### 1. API-nøkkelhåndtering

```bash
# Bruk miljøvariabler
export ONEUPTIME_API_KEY="your-api-key"

# Eller bruk et hemmelighetsstyringssystem
export ONEUPTIME_API_KEY=$(vault kv get -field=api_key secret/oneuptime)
```

### 2. API-nøkler med minste privilegium

Opprett API-nøkler med minimale nødvendige tillatelser:
- Monitoradministrasjon
- Varselspolicyadministrasjon
- Teamadministrasjon (om nødvendig)

### 3. Nettverkssikkerhet

```hcl
# Eksempel med TLS-verifisering
provider "oneuptime" {
  oneuptime_url = "https://oneuptime.yourcompany.com"
  api_key       = var.oneuptime_api_key
  
  # Ytterligere sikkerhetsalternativer hvis støttet
  verify_ssl = true
  timeout    = "30s"
}
```

## Overvåking av Terraform-automatiseringen

Opprett monitorer for Terraform-automatiseringen:

```hcl
resource "oneuptime_monitor" "terraform_runner" {
  name       = "Terraform Runner-helse"
  project_id = oneuptime_project.main.id
  
  monitor_type = "heartbeat"
  interval     = "15m"
  
  tags = {
    automation = "terraform"
    criticality = "medium"
  }
}
```

## Feilsøking av selvhostede problemer

### Problem: Tilkobling avslått

```
Error: connection refused
```

**Løsninger**:
1. Sjekk at OneUptime-instansen kjører
2. Verifiser at API-URL-en er korrekt
3. Sjekk brannmur/nettverkstilkobling
4. Verifiser at TLS-sertifikater er gyldige

### Problem: API-versjonskonflikt

```
Error: API version incompatible
```

**Løsninger**:
1. Sjekk OneUptime-versjon: `curl https://your-instance/api/status`
2. Oppdater leverandørversjon til å samsvare
3. Kjør `terraform init -upgrade`

### Problem: Selvsignerte sertifikater

Hvis du bruker selvsignerte sertifikater:

```bash
# Hopp midlertidig over TLS-verifisering (ikke anbefalt for produksjon)
export ONEUPTIME_SKIP_TLS_VERIFY=true
```

Bedre løsning: Legg til CA-sertifikatet i systemets tillitslager.

## Sikkerhetskopiering og katastrofegjenoppretting

### Tilstandssikkerhetskopiering

```bash
# Regelmessige tilstandssikkerhetskopier
terraform state pull > backup-$(date +%Y%m%d-%H%M%S).tfstate

# Automatisert sikkerhetskopieringsskript
#!/bin/bash
DATE=$(date +%Y%m%d-%H%M%S)
terraform state pull > "backups/terraform-state-${DATE}.tfstate"
find backups/ -name "terraform-state-*.tfstate" -mtime +30 -delete
```

### Konfigurasjonssikkerhetskopiering

```bash
# Sikkerhetskopier Terraform-konfigurasjon
tar -czf terraform-config-$(date +%Y%m%d).tar.gz *.tf *.tfvars
```

## Multi-miljøhåndtering

### Bruke arbeidsområder

```bash
# Opprett miljøer
terraform workspace new dev
terraform workspace new staging  
terraform workspace new prod

# Bytt mellom miljøer
terraform workspace select prod
terraform apply -var-file="prod.tfvars"
```

### Bruke separate kataloger

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

Denne tilnærmingen gir bedre isolasjon og enklere versjonshåndtering per miljø.
