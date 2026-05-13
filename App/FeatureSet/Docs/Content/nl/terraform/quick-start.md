# Terraform Provider Snelstartgids

Deze gids helpt u binnen enkele minuten aan de slag te gaan met de OneUptime Terraform Provider.

## Vereisten

- Terraform >= 1.0 geïnstalleerd
- OneUptime-account (Cloud of Zelf-gehost)
- OneUptime API-sleutel

## Stap 1: API-sleutel aanmaken

### Voor OneUptime Cloud
1. Ga naar [OneUptime Cloud](https://oneuptime.com) en log in
2. Navigeer naar **Instellingen** → **API-sleutels**
3. Klik op **API-sleutel aanmaken**
4. Noem het "Terraform Provider"
5. Selecteer de vereiste machtigingen
6. Kopieer de gegenereerde API-sleutel

### Voor zelf-gehoste OneUptime
1. Ga naar uw OneUptime-instantie
2. Navigeer naar **Instellingen** → **API-sleutels**
3. Klik op **API-sleutel aanmaken**
4. Noem het "Terraform Provider"
5. Selecteer de vereiste machtigingen
6. Kopieer de gegenereerde API-sleutel

## Stap 2: Terraform-configuratie aanmaken

Maak een nieuwe map en een `main.tf`-bestand aan:

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      # Voor cloudklanten
      version = "~> 7.0"
      
      # Voor zelf-gehoste klanten - zet vast op uw exacte versie
      # version = "= 7.0.123"  # Vervang door uw OneUptime-versie
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  # Voor cloudklanten
  oneuptime_url = "https://oneuptime.com"
  
  # Voor zelf-gehoste klanten - gebruik de URL van uw instantie
  # oneuptime_url = "https://oneuptime.yourcompany.com"
  
  api_key = var.oneuptime_api_key
}

variable "oneuptime_api_key" {
  description = "OneUptime API-sleutel"
  type        = string
  sensitive   = true
}

# Opmerking: Projecten moeten handmatig worden aangemaakt in het OneUptime-dashboard
# Gebruik hier uw bestaande project-ID
variable "project_id" {
  description = "OneUptime project-ID"
  type        = string
}

# Een eenvoudige website-monitor aanmaken
resource "oneuptime_monitor" "website" {
  name        = "Website Monitor"
  description = "Monitor voor website-uptime"
  data        = jsonencode({
    url = "https://example.com"
    interval = "5m"
    timeout = "30s"
  })
}

# Het monitor-ID uitvoeren
output "monitor_id" {
  value = oneuptime_monitor.website.id
}
```

## Stap 3: Variabelenbestand aanmaken

Maak `terraform.tfvars` aan:

```hcl
# terraform.tfvars
oneuptime_api_key = "your-api-key-here"
project_id        = "your-project-id-here"  # Haal dit op uit het OneUptime-dashboard
```

**Belangrijk**: Voeg `terraform.tfvars` toe aan uw `.gitignore` om API-sleutels geheim te houden!

## Stap 4: Initialiseren en toepassen

```bash
# Terraform initialiseren
terraform init

# De implementatie plannen
terraform plan

# De configuratie toepassen
terraform apply
```

## Stap 5: Resources verifiëren

1. Controleer uw OneUptime-dashboard
2. Ga naar uw bestaande project
3. Verifieer dat de "Website Monitor" is aangemaakt en actief is

## Volgende stappen

1. **Meer resources verkennen**: Bekijk de [volledige documentatie](./README.md) voor alle beschikbare resources
2. **Meldingen instellen**: Voeg meldingsbeleid en meldingskanalen toe
3. **Statuspagina's aanmaken**: Stel openbare statuspagina's in voor uw diensten
4. **Organiseren met teams**: Maak teams aan en wijs machtigingen toe

## Versiespecifieke voorbeelden

### Cloudklanten (nieuwste versie)

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # Haalt altijd de nieuwste compatibele 7.x-versie op
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.com"
  api_key       = var.oneuptime_api_key
}
```

### Zelf-gehoste klanten (versie vastgezet)

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Moet exact overeenkomen met uw OneUptime-versie
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.mycompany.com"  # Uw zelf-gehoste URL
  api_key       = var.oneuptime_api_key
}
```

## Probleemoplossing voor snelstart

### Probleem: Provider niet gevonden
```
Error: Failed to query available provider packages
```
**Oplossing**: Voer `terraform init` uit om de provider te downloaden

### Probleem: Authenticatie mislukt
```
Error: Invalid API key
```
**Oplossing**:
1. Verifieer uw API-sleutel in het OneUptime-dashboard
2. Controleer of de API-sleutel voldoende machtigingen heeft
3. Zorg dat `oneuptime_url` correct is voor uw instantie

### Probleem: Versie-mismatch (zelf-gehost)
```
Error: API version incompatible
```
**Oplossing**:
1. Controleer uw OneUptime-versie in het dashboard
2. Werk de providerversie bij zodat deze exact overeenkomt
3. Voer `terraform init -upgrade` uit

## Opschonen

Om alle resources te verwijderen die in deze snelstart zijn aangemaakt:

```bash
terraform destroy
```

Hiermee worden de monitor en het project verwijderd die tijdens de snelstart zijn aangemaakt.
