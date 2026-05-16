# Installasjons- og bruksguide for Terraform-leverandør

## Installasjon fra Terraform Registry

OneUptime Terraform-leverandøren er tilgjengelig på det offisielle [Terraform Registry](https://registry.terraform.io/providers/oneuptime/oneuptime).

### For OneUptime Cloud-brukere

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # Bruk siste kompatible versjon
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.com"
  api_key       = var.oneuptime_api_key
}
```

### For selvhostede OneUptime-brukere

**Kritisk**: Selvhostede kunder må feste leverandørversjonen til å samsvare nøyaktig med OneUptime-installasjonen.

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Erstatt med din eksakte OneUptime-versjon
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.yourcompany.com"  # Din selvhostede URL
  api_key       = var.oneuptime_api_key
}
```

## Hvorfor versjonsfesting for selvhostede?

OneUptime Terraform-leverandøren genereres automatisk fra OneUptime API-spesifikasjonen. Hver OneUptime-versjon kan ha:

- Ulike API-endepunkter
- Oppdaterte ressursskjemaer
- Nye eller fjernede funksjoner
- Endrede valideringsregler

Bruk av en leverandørversjon som ikke samsvarer med OneUptime-installasjonen kan resultere i:
- API-kompatibilitetsfeil
- Mislykkede ressursoppretting/-oppdateringer
- Uventet atferd
- Ressursstatusavvik

## Finne din OneUptime-versjon

### Metode 1: Dashbord
1. Logg inn på OneUptime-dashbordet ditt
2. Gå til **Settings** → **About**
3. Noter versjonsnummeret (f.eks. "7.0.123")

### Metode 2: API
```bash
curl https://your-oneuptime-instance.com/api/version | jq '.version'
```

### Metode 3: Docker
```bash
docker images | grep oneuptime
# Se etter taggen, f.eks. oneuptime/dashboard:7.0.123
```

## Leverandørregistreringsinformasjon

- **Registry-URL**: https://registry.terraform.io/providers/oneuptime/oneuptime
- **Kilderepositorium**: https://github.com/OneUptime/terraform-provider-oneuptime
- **Dokumentasjon**: https://registry.terraform.io/providers/oneuptime/oneuptime/latest/docs
- **Utgivelser**: https://github.com/OneUptime/terraform-provider-oneuptime/releases

## Versjonkompatibilitetsmatrise

| OneUptime-versjon | Leverandørversjon | Terraform-konfigurasjon |
|-------------------|-------------------|-------------------------|
| 7.0.x | 7.0.x | `version = "~> 7.0.0"` |
| 7.1.x | 7.1.x | `version = "~> 7.1.0"` |
| Siste sky | Siste leverandør | `version = "~> 7.0"` |

## Hurtigstarteksempel

```hcl
# Konfigurer leverandøren
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # Juster for selvhostet
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.com"  # Juster for selvhostet
  api_key       = var.oneuptime_api_key
}

# Opprett et prosjekt
resource "oneuptime_project" "example" {
  name        = "Terraform-eksempel"
  description = "Opprettet med Terraform"
}

# Opprett en nettstedmonitor
resource "oneuptime_monitor" "website" {
  name       = "Nettstedmonitor"
  project_id = oneuptime_project.example.id
  
  monitor_type = "website"
  url          = "https://example.com"
  interval     = "5m"
  
  tags = {
    managed_by = "terraform"
  }
}
```

## Installasjonstrinn

1. **Opprett Terraform-konfigurasjonen** med leverandørblokken
2. **Initialiser Terraform**: `terraform init`
3. **Sett API-nøkkelen din**: Opprett `terraform.tfvars` med API-nøkkelen
4. **Planlegg distribusjonen**: `terraform plan`
5. **Bruk konfigurasjonen**: `terraform apply`

## Få hjelp

- **Fullstendig dokumentasjon**: Se [fullstendig Terraform-dokumentasjon](./README.md)
- **Selvhostet guide**: Sjekk [selvhostet konfigurasjonsguide](./self-hosted.md)
- **Eksempler**: Bla gjennom [konfigurasjonseksempler](./examples.md)
- **Hurtigstart**: Følg [hurtigstartguiden](./quick-start.md)

## Registry-oppdateringer

Leverandøren publiseres automatisk til Terraform Registry når nye OneUptime-versjoner slippes. Sky-brukere kan bruke semantisk versjonering (`~> 7.0`) for automatisk å få kompatible oppdateringer, mens selvhostede brukere bør feste til eksakte versjoner.
