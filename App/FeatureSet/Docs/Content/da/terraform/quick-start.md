# Hurtig start-vejledning til Terraform Provider

Denne vejledning hjælper dig med at komme i gang med OneUptime Terraform Provider på få minutter.

## Forudsætninger

- Terraform >= 1.0 installeret
- OneUptime-konto (Sky eller Selvhostet)
- OneUptime API-nøgle

## Trin 1: Opret API-nøgle

### Til OneUptime Cloud
1. Gå til [OneUptime Cloud](https://oneuptime.com) og log ind
2. Naviger til **Indstillinger** → **API-nøgler**
3. Klik på **Opret API-nøgle**
4. Navngiv den "Terraform Provider"
5. Vælg påkrævede tilladelser
6. Kopiér den genererede API-nøgle

### Til selvhostet OneUptime
1. Tilgå din OneUptime-instans
2. Naviger til **Indstillinger** → **API-nøgler**
3. Klik på **Opret API-nøgle**
4. Navngiv den "Terraform Provider"
5. Vælg påkrævede tilladelser
6. Kopiér den genererede API-nøgle

## Trin 2: Opret Terraform-konfiguration

Opret en ny mappe og `main.tf`-fil:

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      # Til skykunder
      version = "~> 7.0"
      
      # Til selvhostede kunder – fastlås til din nøjagtige version
      # version = "= 7.0.123"  # Erstat med din OneUptime-version
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  # Til skykunder
  oneuptime_url = "https://oneuptime.com"
  
  # Til selvhostede kunder – brug din instans-URL
  # oneuptime_url = "https://oneuptime.yourcompany.com"
  
  api_key = var.oneuptime_api_key
}

variable "oneuptime_api_key" {
  description = "OneUptime API-nøgle"
  type        = string
  sensitive   = true
}

# Bemærk: Projekter skal oprettes manuelt i OneUptime-dashboardet
# Brug dit eksisterende projekt-ID her
variable "project_id" {
  description = "OneUptime projekt-ID"
  type        = string
}

# Opret en simpel website-monitor
resource "oneuptime_monitor" "website" {
  name        = "Website Monitor"
  description = "Monitor til webstedets oppetid"
  data        = jsonencode({
    url = "https://example.com"
    interval = "5m"
    timeout = "30s"
  })
}

# Udskriv monitor-ID'et
output "monitor_id" {
  value = oneuptime_monitor.website.id
}
```

## Trin 3: Opret variabelfil

Opret `terraform.tfvars`:

```hcl
# terraform.tfvars
oneuptime_api_key = "your-api-key-here"
project_id        = "your-project-id-here"  # Hent dette fra OneUptime-dashboardet
```

**Vigtigt**: Tilføj `terraform.tfvars` til din `.gitignore` for at holde API-nøgler hemmelige!

## Trin 4: Initialisér og anvend

```bash
# Initialisér Terraform
terraform init

# Planlæg deploymentet
terraform plan

# Anvend konfigurationen
terraform apply
```

## Trin 5: Bekræft ressourcer

1. Kontroller dit OneUptime-dashboard
2. Gå til dit eksisterende projekt
3. Bekræft, at "Website Monitor" er oprettet og kører

## Næste trin

1. **Udforsk flere ressourcer**: Se [den fulde dokumentation](./README.md) for alle tilgængelige ressourcer
2. **Opsæt advarsler**: Tilføj advarsels-politikker og notifikationskanaler
3. **Opret statussider**: Opsæt offentlige statussider til dine tjenester
4. **Organiser med teams**: Opret teams og tildel tilladelser

## Versionsspecifikke eksempler

### Skykunder (seneste version)

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # Henter altid seneste kompatible 7.x-version
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.com"
  api_key       = var.oneuptime_api_key
}
```

### Selvhostede kunder (version fastlåst)

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Skal matche din OneUptime-version nøjagtigt
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.mycompany.com"  # Din selvhostede URL
  api_key       = var.oneuptime_api_key
}
```

## Fejlfinding af hurtig start

### Problem: Provider ikke fundet
```
Error: Failed to query available provider packages
```
**Løsning**: Kør `terraform init` for at downloade provideren

### Problem: Autentificering mislykkedes
```
Error: Invalid API key
```
**Løsning**: 
1. Bekræft din API-nøgle i OneUptime-dashboardet
2. Kontroller, at API-nøglen har tilstrækkelige tilladelser
3. Sørg for, at `oneuptime_url` er korrekt til din instans

### Problem: Versionsmismatch (selvhostet)
```
Error: API version incompatible
```
**Løsning**: 
1. Kontroller din OneUptime-version i dashboardet
2. Opdater providerversionen til at matche nøjagtigt
3. Kør `terraform init -upgrade`

## Oprydning

For at fjerne alle ressourcer oprettet i denne hurtige start:

```bash
terraform destroy
```

Dette sletter den monitor og det projekt, der blev oprettet under den hurtige start.
