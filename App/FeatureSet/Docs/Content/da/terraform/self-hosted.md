# Selvhostet OneUptime Terraform-konfigurationsvejledning

Denne vejledning er specifikt til kunder, der kører selvhostede OneUptime-instanser. Den dækker versionsstyring, konfiguration og bedste praksis for brug af Terraform-provideren med din egen OneUptime-deployment.

## Vigtige noter

⚠️ **Projekter kan ikke oprettes via Terraform** – Projekter skal oprettes manuelt i OneUptime-dashboardet først. Brug projekt-ID'et i dine Terraform-konfigurationer.

⚠️ **Den vigtigste regel for selvhostede kunder**: Fastlås altid din Terraform-providerversion til nøjagtigt at matche din OneUptime-installationsversion.

## Ressourcestruktur

Alle OneUptime Terraform-ressourcer følger en forenklet struktur:
- `name` (påkrævet) – Ressourcenavn
- `description` (valgfrit) – Ressourcebeskrivelse  
- `data` (valgfrit) – Kompleks konfiguration som JSON

## Kritisk: Versionskompatibilitet

⚠️ **Den vigtigste regel for selvhostede kunder**: Fastlås altid din Terraform-providerversion til nøjagtigt at matche din OneUptime-installationsversion.

### Hvorfor versionsfastlåsning er kritisk

- Terraform-provideren genereres automatisk fra OneUptime API
- Hver OneUptime-version kan have forskellige API-endpoints og skemaer
- Brug af en uoverensstemmende providerversion kan forårsage fejl eller uventet adfærd
- Versionsfastlåsning sikrer kompatibilitet og forudsigelig adfærd

## Find din OneUptime-version

### Metode 1: Dashboard
1. Log ind på dit OneUptime-dashboard
2. Gå til **Indstillinger** → **Om**
3. Se efter versionsnummeret (f.eks. "7.0.123")

### Metode 2: API-endpoint
```bash
curl https://your-oneuptime-instance.com/api/status
```

### Metode 3: Docker-billeder
Hvis du kører OneUptime med Docker:
```bash
docker images | grep oneuptime
# Se efter tagget, f.eks. oneuptime/dashboard:7.0.123
```

### Metode 4: Helm-chart
Hvis du bruger Helm:
```bash
helm list -n oneuptime
# Kontroller chartversionen
```

### Metode 5: Miljøvariabler
Kontroller dine konfigurationsfiler for versionsvariabler:
```bash
grep -r "APP_VERSION\|IMAGE_TAG" /path/to/your/oneuptime/config
```

## Providerkonfigurationsskabeloner

### Skabelon til version 7.0.x

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Erstat 123 med dit nøjagtige build-nummer
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.yourcompany.com"  # Din selvhostede URL
  api_key       = var.oneuptime_api_key
}
```

### Skabelon til version 7.1.x

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.1.45"  # Erstat med din nøjagtige version
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.yourcompany.com"
  api_key       = var.oneuptime_api_key
}
```

## Komplet selvhostet konfigurationseksempel

Her er et komplet eksempel til en selvhostet OneUptime-instans:

```hcl
# versions.tf
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Skal matche din OneUptime-version
    }
  }
  required_version = ">= 1.0"
  
  # Valgfrit: Brug fjernlager til teamsamarbejde
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
  description = "OneUptime API-nøgle"
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
  description = "OneUptime projekt-ID (opret manuelt i dashboardet)"
  type        = string
}

# main.tf
# Opret teams
resource "oneuptime_team" "infrastructure" {
  name        = "Infrastructure Team"
  description = "Infrastruktur- og driftsteam"
}

resource "oneuptime_team" "development" {
  name        = "Development Team"
  description = "Applikationsudviklingsteam"  
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

# Vagtpolitikker
resource "oneuptime_on_call_policy" "infrastructure_oncall" {
  name       = "Infrastructure On-Call"
  project_id = oneuptime_project.main.id
  team_id    = oneuptime_team.infrastructure.id
  
  schedules {
    name     = "24x7 Infrastructure"
    timezone = "America/New_York"
    
    layers {
      name          = "Primary"
      users         = ["infra1@yourcompany.com", "infra2@yourcompany.com"]
      rotation_type = "weekly"
      start_time    = "00:00"
      end_time      = "23:59"
      days          = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
    }
  }
}

# Advarsels-politikker
resource "oneuptime_alert_policy" "critical_infrastructure" {
  name       = "Critical Infrastructure Alerts"
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
  name       = "Internal Services Status"
  project_id = oneuptime_project.main.id
  
  domain = "status.internal.yourcompany.com"
  
  components {
    name       = "Database"
    monitor_id = oneuptime_monitor.database.id
  }
  
  components {
    name       = "Application"
    monitor_id = oneuptime_monitor.application.id
  }
}

# outputs.tf
output "project_id" {
  description = "Projekt-ID"
  value       = oneuptime_project.main.id
}

output "status_page_url" {
  description = "Statusside-URL"
  value       = "https://${oneuptime_status_page.internal.domain}"
}
```

## Miljøspecifik konfiguration

### Udviklingsmiljø

```hcl
# dev.tfvars
oneuptime_url = "https://oneuptime-dev.yourcompany.com"
environment = "development"
```

### Staging-miljø

```hcl
# staging.tfvars
oneuptime_url = "https://oneuptime-staging.yourcompany.com"  
environment = "staging"
```

### Produktionsmiljø

```hcl
# prod.tfvars
oneuptime_url = "https://oneuptime.yourcompany.com"
environment = "production"
```

## Opgraderingsproces til selvhostet

Når du opgraderer din OneUptime-instans:

### 1. Tjekliste før opgradering

```bash
# Sikkerhedskopier nuværende Terraform-tilstand
terraform state pull > backup-$(date +%Y%m%d).tfstate

# Notér aktuel OneUptime-version
curl https://oneuptime.yourcompany.com/api/status | jq '.version'

# Notér aktuel providerversion
terraform providers | grep oneuptime
```

### 2. Opgrader OneUptime-instansen

Følg din standardopgraderingsproces til OneUptime (Docker, Helm osv.)

### 3. Opdater Terraform-provideren

```hcl
# Opdater version i terraform-blokken
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.124"  # Ny version efter opgradering
    }
  }
}
```

### 4. Test og anvend

```bash
# Opdater provideren
terraform init -upgrade

# Planlæg for at se eventuelle ændringer
terraform plan

# Anvend, hvis alt ser godt ud
terraform apply
```

## Netværkskonfiguration

### Firewallregler

Sørg for, at din Terraform-runner kan tilgå:
- OneUptime API-endpoint (normalt port 443/HTTPS)
- Eventuelle interne ressourcer der overvåges

### VPN/Private netværk

Hvis OneUptime er på et privat netværk:

```hcl
provider "oneuptime" {
  oneuptime_url = "https://10.0.1.100:443"  # Intern IP
  api_key       = var.oneuptime_api_key
}
```

## Bedste sikkerhedspraksis

### 1. API-nøglestyring

```bash
# Brug miljøvariabler
export ONEUPTIME_API_KEY="your-api-key"

# Eller brug et hemmeligheds-styringssystem
export ONEUPTIME_API_KEY=$(vault kv get -field=api_key secret/oneuptime)
```

### 2. API-nøgler med mindste privilegium

Opret API-nøgler med minimale påkrævede tilladelser:
- Monitoradministration
- Advarsels-politikadministration
- Teamadministration (hvis nødvendigt)

### 3. Netværkssikkerhed

```hcl
# Eksempel med TLS-verifikation
provider "oneuptime" {
  oneuptime_url = "https://oneuptime.yourcompany.com"
  api_key       = var.oneuptime_api_key
  
  # Yderligere sikkerhedsmuligheder, hvis understøttet
  verify_ssl = true
  timeout    = "30s"
}
```

## Overvågning af din Terraform-automatisering

Opret monitorer til din Terraform-automatisering:

```hcl
resource "oneuptime_monitor" "terraform_runner" {
  name       = "Terraform Runner Health"
  project_id = oneuptime_project.main.id
  
  monitor_type = "heartbeat"
  interval     = "15m"
  
  tags = {
    automation = "terraform"
    criticality = "medium"
  }
}
```

## Fejlfinding af selvhostede problemer

### Problem: Forbindelsen nægtet

```
Error: connection refused
```

**Løsninger**:
1. Kontroller, at OneUptime-instansen kører
2. Bekræft, at API-URL'en er korrekt
3. Kontroller firewall-/netværksforbindelsen
4. Bekræft, at TLS-certifikater er gyldige

### Problem: API-versionsmismatch

```
Error: API version incompatible
```

**Løsninger**:
1. Kontroller OneUptime-version: `curl https://your-instance/api/status`
2. Opdater providerversion til at matche
3. Kør `terraform init -upgrade`

### Problem: Selvsignerede certifikater

Hvis du bruger selvsignerede certifikater:

```bash
# Spring TLS-verifikation over midlertidigt (ikke anbefalet til produktion)
export ONEUPTIME_SKIP_TLS_VERIFY=true
```

Bedre løsning: Tilføj dit CA-certifikat til systemets tillidslagring.

## Sikkerhedskopiering og gendannelse

### Tilstandssikkerhedskopiering

```bash
# Regelmæssige tilstandssikkerhedskopier
terraform state pull > backup-$(date +%Y%m%d-%H%M%S).tfstate

# Automatiseret sikkerhedskopieringsscript
#!/bin/bash
DATE=$(date +%Y%m%d-%H%M%S)
terraform state pull > "backups/terraform-state-${DATE}.tfstate"
find backups/ -name "terraform-state-*.tfstate" -mtime +30 -delete
```

### Konfigurationssikkerhedskopiering

```bash
# Sikkerhedskopier Terraform-konfiguration
tar -czf terraform-config-$(date +%Y%m%d).tar.gz *.tf *.tfvars
```

## Multi-miljøadministration

### Brug af arbejdsområder

```bash
# Opret miljøer
terraform workspace new dev
terraform workspace new staging  
terraform workspace new prod

# Skift mellem miljøer
terraform workspace select prod
terraform apply -var-file="prod.tfvars"
```

### Brug af separate mapper

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

Denne tilgang giver bedre isolation og nemmere versionsstyring pr. miljø.
