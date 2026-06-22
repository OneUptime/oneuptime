# Installerings- och användningsguide för Terraform-leverantör

## Installation från Terraform Registry

OneUptime Terraform-leverantören finns tillgänglig på det officiella [Terraform Registry](https://registry.terraform.io/providers/oneuptime/oneuptime).

### För OneUptime Cloud-användare

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # Use latest compatible version
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.com"
  api_key       = var.oneuptime_api_key
}
```

### För egeninstallerade OneUptime-användare

⚠️ **Kritiskt**: Egeninstallerade kunder måste låsa leverantörens version till att exakt matcha sin OneUptime-installation.

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Replace with your exact OneUptime version
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.yourcompany.com"  # Your self-hosted URL
  api_key       = var.oneuptime_api_key
}
```

## Varför versionsinlåsning för egeninstallerade?

OneUptime Terraform-leverantören genereras automatiskt från OneUptime API-specifikationen. Varje OneUptime-version kan ha:

- Olika API-slutpunkter
- Uppdaterade resursscheman
- Nya eller borttagna funktioner
- Ändrade valideringsregler

Att använda en leverantörsversion som inte matchar din OneUptime-installation kan resultera i:

- API-kompatibilitetsfel
- Misslyckad resursskapande/uppdatering
- Oväntat beteende
- Resursstatusdrift

## Hitta din OneUptime-version

### Metod 1: Instrumentpanel

1. Logga in på din OneUptime-instrumentpanel
2. Gå till **Inställningar** → **Om**
3. Notera versionsnumret (t.ex. "7.0.123")

### Metod 2: API

```bash
curl https://your-oneuptime-instance.com/api/version | jq '.version'
```

### Metod 3: Docker

```bash
docker images | grep oneuptime
# Look for the tag, e.g., oneuptime/dashboard:7.0.123
```

## Leverantörsregistreringsinformation

- **Registry-URL**: https://registry.terraform.io/providers/oneuptime/oneuptime
- **Källrepositorie**: https://github.com/OneUptime/terraform-provider-oneuptime
- **Dokumentation**: https://registry.terraform.io/providers/oneuptime/oneuptime/latest/docs
- **Versioner**: https://github.com/OneUptime/terraform-provider-oneuptime/releases

## Versionskompatibilitetsmatris

| OneUptime-version | Leverantörsversion | Terraform-konfiguration |
| ----------------- | ------------------ | ----------------------- |
| 7.0.x             | 7.0.x              | `version = "~> 7.0.0"`  |
| 7.1.x             | 7.1.x              | `version = "~> 7.1.0"`  |
| Senaste Cloud     | Senaste leverantör | `version = "~> 7.0"`    |

## Installationssteg

1. **Skapa din Terraform-konfiguration** med leverantörsblocket
2. **Initiera Terraform**: `terraform init`
3. **Ange din API-nyckel**: Skapa `terraform.tfvars` med din API-nyckel
4. **Planera din driftsättning**: `terraform plan`
5. **Tillämpa din konfiguration**: `terraform apply`

## Registreruppdateringar

Leverantören publiceras automatiskt till Terraform Registry när nya OneUptime-versioner lanseras. Molnanvändare kan använda semantisk versionshantering (`~> 7.0`) för att automatiskt få kompatibla uppdateringar, medan egeninstallerade användare bör låsa till exakta versioner.
