# Exemples du fournisseur Terraform

Ce document fournit des exemples complets pour les configurations Terraform OneUptime courantes.

## Exemples de base

### Projet simple

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # Utilisez "= 7.0.123" pour l'auto-hébergé
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.com"  # Modifiez pour l'auto-hébergé
  api_key       = var.oneuptime_api_key
}

```

### Moniteur de base

```hcl
resource "oneuptime_monitor" "manual_monitor" {
  name        = "Moniteur de la page d'accueil"
  description = "Moniteur pour la page d'accueil principale du site Web"
  monitor_type = "Manual"
}
```

### Pages de statut

```hcl
# Page de statut publique
resource "oneuptime_status_page" "public" {
  name        = "Page de statut publique"
  description = "Page de statut publique pour les services orientés clients"
}
```
