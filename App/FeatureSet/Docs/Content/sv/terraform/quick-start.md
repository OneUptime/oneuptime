# Snabbstartsguide för Terraform-leverantör

Den här guiden hjälper dig att komma igång med OneUptime Terraform-leverantören på bara några minuter.

## Förutsättningar

- Terraform >= 1.0 installerat
- OneUptime-konto (moln eller egeninstallerat)
- OneUptime API-nyckel

## Steg 1: Skapa API-nyckel

### För OneUptime Cloud

1. Gå till [OneUptime Cloud](https://oneuptime.com) och logga in
2. Navigera till **Inställningar** → **API-nycklar**
3. Klicka på **Skapa API-nyckel**
4. Namnge den "Terraform-leverantör"
5. Välj obligatoriska behörigheter
6. Kopiera den genererade API-nyckeln

### För egeninstallerad OneUptime

1. Gå till din OneUptime-instans
2. Navigera till **Inställningar** → **API-nycklar**
3. Klicka på **Skapa API-nyckel**
4. Namnge den "Terraform-leverantör"
5. Välj obligatoriska behörigheter
6. Kopiera den genererade API-nyckeln

## Steg 2: Skapa Terraform-konfiguration

Skapa en ny katalog och `main.tf`-fil:

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      # For Cloud customers
      version = "~> 7.0"

      # For Self-Hosted customers - pin to your exact version
      # version = "= 7.0.123"  # Replace with your OneUptime version
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  # For Cloud customers
  oneuptime_url = "https://oneuptime.com"

  # For Self-Hosted customers - use your instance URL
  # oneuptime_url = "https://oneuptime.yourcompany.com"

  api_key = var.oneuptime_api_key
}

variable "oneuptime_api_key" {
  description = "OneUptime API Key"
  type        = string
  sensitive   = true
}

variable "project_id" {
  description = "OneUptime project ID"
  type        = string
}

# Create a simple website monitor
resource "oneuptime_monitor" "website" {
  name        = "Website Monitor"
  description = "Monitor for website uptime"
  data        = jsonencode({
    url = "https://example.com"
    interval = "5m"
    timeout = "30s"
  })
}

# Output the monitor ID
output "monitor_id" {
  value = oneuptime_monitor.website.id
}
```

## Steg 3: Skapa variabelfil

Skapa `terraform.tfvars`:

```hcl
# terraform.tfvars
oneuptime_api_key = "your-api-key-here"
project_id        = "your-project-id-here"  # Get this from OneUptime dashboard
```

**Viktigt**: Lägg till `terraform.tfvars` i din `.gitignore` för att hålla API-nycklar hemliga!

## Steg 4: Initiera och tillämpa

```bash
# Initialize Terraform
terraform init

# Plan the deployment
terraform plan

# Apply the configuration
terraform apply
```

## Steg 5: Verifiera resurser

1. Kontrollera din OneUptime-instrumentpanel
2. Gå till ditt befintliga projekt
3. Verifiera att "Website Monitor" skapats och körs

## Nästa steg

1. **Utforska fler resurser**: Se [den fullständiga dokumentationen](./complete-guide.md) för alla tillgängliga resurser
2. **Konfigurera varningar**: Lägg till varningspolicyer och aviseringskanaler
3. **Skapa statussidor**: Konfigurera offentliga statussidor för dina tjänster
4. **Organisera med team**: Skapa team och tilldela behörigheter

## Versionspecifika exempel

### Molnkunder (senaste versionen)

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # Always gets latest compatible 7.x version
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.com"
  api_key       = var.oneuptime_api_key
}
```

### Egeninstallerade kunder (versionslåst)

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Must match your OneUptime version exactly
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.mycompany.com"  # Your self-hosted URL
  api_key       = var.oneuptime_api_key
}
```

## Felsökning av snabbstart

### Problem: Leverantören hittades inte

```
Error: Failed to query available provider packages
```

**Lösning**: Kör `terraform init` för att ladda ner leverantören

### Problem: Autentisering misslyckades

```
Error: Invalid API key
```

**Lösning**:

1. Verifiera din API-nyckel i OneUptime-instrumentpanelen
2. Kontrollera att API-nyckeln har tillräckliga behörigheter
3. Se till att `oneuptime_url` är korrekt för din instans

### Problem: Versionsmismatch (egeninstallerad)

```
Error: API version incompatible
```

**Lösning**:

1. Kontrollera din OneUptime-version i instrumentpanelen
2. Uppdatera leverantörens version för att matcha exakt
3. Kör `terraform init -upgrade`

## Rensning

För att ta bort alla resurser som skapades i den här snabbstarten:

```bash
terraform destroy
```

Detta tar bort monitorn och projektet som skapades under snabbstarten.
