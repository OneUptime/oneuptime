# Konfigurationsguide för egeninstallerad OneUptime Terraform

Den här guiden är specifikt för kunder som kör egeninstallerade OneUptime-instanser. Den täcker versionshantering, konfiguration och bästa praxis för att använda Terraform-leverantören med din egen OneUptime-driftsättning.

## Viktiga noteringar

⚠️ **Projekt kan inte skapas via Terraform** – Projekt måste skapas manuellt i OneUptime-instrumentpanelen först. Använd projekt-ID:t i dina Terraform-konfigurationer.

⚠️ **Den viktigaste regeln för egeninstallerade kunder**: Lås alltid din Terraform-leverantörs version till att exakt matcha din OneUptime-installationsversion.

## Resursstruktur

Alla OneUptime Terraform-resurser följer en förenklad struktur:

- `name` (obligatorisk) – Resursnamn
- `description` (valfritt) – Resursbeskrivning
- `data` (valfritt) – Komplex konfiguration som JSON

## Kritiskt: Versionskompatibilitet

⚠️ **Den viktigaste regeln för egeninstallerade kunder**: Lås alltid din Terraform-leverantörs version till att exakt matcha din OneUptime-installationsversion.

### Varför versionsinlåsning är kritisk

- Terraform-leverantören genereras automatiskt från OneUptime API:et
- Varje OneUptime-version kan ha olika API-slutpunkter och scheman
- Att använda en felmatchad leverantörsversion kan orsaka fel eller oväntat beteende
- Versionsinlåsning säkerställer kompatibilitet och förutsägbart beteende

## Hitta din OneUptime-version

### Metod 1: Instrumentpanel

1. Logga in på din OneUptime-instrumentpanel
2. Gå till **Inställningar** → **Om**
3. Leta efter versionsnumret (t.ex. "7.0.123")

### Metod 2: API-slutpunkt

```bash
curl https://your-oneuptime-instance.com/api/status
```

### Metod 3: Docker-bilder

Om du kör OneUptime med Docker:

```bash
docker images | grep oneuptime
# Look for the tag, e.g., oneuptime/dashboard:7.0.123
```

### Metod 4: Helm Chart

Om du använder Helm:

```bash
helm list -n oneuptime
# Check the chart version
```

## Leverantörskonfigurationsmallar

### Mall för version 7.0.x

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Replace 123 with your exact build number
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.yourcompany.com"  # Your self-hosted URL
  api_key       = var.oneuptime_api_key
}
```

## Uppgraderingsprocess för egeninstallerade

När du uppgraderar din OneUptime-instans:

### 1. Checklista före uppgradering

```bash
# Backup current Terraform state
terraform state pull > backup-$(date +%Y%m%d).tfstate

# Note current OneUptime version
curl https://oneuptime.yourcompany.com/api/status | jq '.version'

# Note current provider version
terraform providers | grep oneuptime
```

### 2. Uppgradera OneUptime-instansen

Följ din standardmässiga OneUptime-uppgraderingsprocess (Docker, Helm etc.)

### 3. Uppdatera Terraform-leverantör

```hcl
# Update version in terraform block
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.124"  # New version after upgrade
    }
  }
}
```

### 4. Testa och tillämpa

```bash
# Update provider
terraform init -upgrade

# Plan to see any changes
terraform plan

# Apply if everything looks good
terraform apply
```

## Säkerhetsbästa praxis

### 1. API-nyckelhantering

```bash
# Use environment variables
export ONEUPTIME_API_KEY="your-api-key"

# Or use a secret management system
export ONEUPTIME_API_KEY=$(vault kv get -field=api_key secret/oneuptime)
```

### 2. API-nycklar med minsta privilegium

Skapa API-nycklar med minimala obligatoriska behörigheter:

- Monitorhantering
- Varningspolicyhantering
- Teamhantering (om nödvändigt)

## Hantering av flera miljöer

### Använda arbetsytor

```bash
# Create environments
terraform workspace new dev
terraform workspace new staging
terraform workspace new prod

# Switch between environments
terraform workspace select prod
terraform apply -var-file="prod.tfvars"
```

### Använda separata kataloger

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

Det här tillvägagångssättet ger bättre isolering och enklare versionshantering per miljö.
