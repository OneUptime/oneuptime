# Fournisseur Terraform OneUptime

Le fournisseur Terraform OneUptime vous permet de gérer les ressources OneUptime en utilisant l'Infrastructure as Code (IaC). Ce fournisseur vous permet de configurer la surveillance, la gestion des incidents, les pages de statut et d'autres fonctionnalités OneUptime via Terraform.

## Table des matières

- [Installation](#installation)
- [Configuration du fournisseur](#configuration-du-fournisseur)
- [Démarrage rapide](#démarrage-rapide)
- [Compatibilité des versions](#compatibilité-des-versions)
- [Ressources disponibles](#ressources-disponibles)
- [Exemples](#exemples)
- [Meilleures pratiques](#meilleures-pratiques)
- [Guide de migration](#guide-de-migration)

## Installation

### Depuis le registre Terraform (recommandé)

Le fournisseur Terraform OneUptime est disponible sur le [Registre Terraform](https://registry.terraform.io/providers/oneuptime/oneuptime).

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # Utiliser la dernière version 7.x
    }
  }
  required_version = ">= 1.0"
}
```

### Épinglage de version pour les installations auto-hébergées

⚠️ **Important pour les clients auto-hébergés** : Épinglez toujours la version du fournisseur Terraform pour qu'elle corresponde à votre version d'installation OneUptime afin de garantir la compatibilité API.

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Épingler à la version exacte correspondant à votre installation OneUptime
    }
  }
  required_version = ">= 1.0"
}
```

#### Trouver votre version OneUptime

Vous pouvez trouver votre version OneUptime de plusieurs façons :

1. **Tableau de bord** : Allez dans Paramètres → À propos dans votre tableau de bord OneUptime
2. **API** : Appelez le point d'accès `GET /api/status`
3. **Docker** : Vérifiez le tag d'image que vous utilisez
4. **Helm** : Vérifiez la version de votre chart Helm

```bash
# Exemple : Si vous exécutez OneUptime 7.0.123
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"
    }
  }
}
```

## Configuration du fournisseur

### Configuration de base

```hcl
provider "oneuptime" {
  oneuptime_url = "https://votre-instance-oneuptime.com"  # Ou https://oneuptime.com pour le cloud
  api_key       = var.oneuptime_api_key
}
```

### Variables d'environnement

Vous pouvez configurer le fournisseur en utilisant des variables d'environnement :

```bash
export ONEUPTIME_URL="https://votre-instance-oneuptime.com"
export ONEUPTIME_API_KEY="votre-clé-api-ici"
```

Puis utilisez le fournisseur sans configuration explicite :

```hcl
provider "oneuptime" {
  # La configuration sera lue depuis les variables d'environnement
}
```

### Options de configuration

| Argument        | Variable d'environnement | Description       | Obligatoire |
| --------------- | ------------------------ | ----------------- | ----------- |
| `oneuptime_url` | `ONEUPTIME_URL`          | URL OneUptime     | Oui         |
| `api_key`       | `ONEUPTIME_API_KEY`      | Clé API OneUptime | Oui         |

## Démarrage rapide

### 1. Créer une clé API

D'abord, créez une clé API dans votre tableau de bord OneUptime :

1. Allez dans **Paramètres** → **Clés API**
2. Cliquez sur **Créer une clé API**
3. Donnez-lui un nom descriptif (ex. : « Automatisation Terraform »)
4. Sélectionnez les permissions appropriées
5. Copiez la clé API générée

### 2. Configuration Terraform de base

Créez un fichier `main.tf` :

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
  oneuptime_url = "https://oneuptime.com"  # Utilisez l'URL de votre instance
  api_key       = var.oneuptime_api_key
}

# Remarque : Les projets doivent être créés manuellement dans le tableau de bord OneUptime
variable "project_id" {
  description = "ID du projet OneUptime"
  type        = string
}

# Créer un moniteur
resource "oneuptime_monitor" "website" {
  name        = "Moniteur de site Web"
  description = "Moniteur pour la disponibilité du site Web"
  data        = jsonencode({
    url = "https://example.com"
    interval = "5m"
    timeout = "30s"
  })
}

# Créer une équipe
resource "oneuptime_team" "platform" {
  name        = "Équipe Plateforme"
  description = "Équipe d'ingénierie de la plateforme"
}
```

### 3. Initialiser et appliquer

```bash
# Initialiser Terraform
terraform init

# Planifier les changements
terraform plan

# Appliquer la configuration
terraform apply
```

## Compatibilité des versions

### Clients cloud

Pour les clients OneUptime Cloud, utilisez la dernière version du fournisseur :

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # Toujours utiliser la dernière version compatible
    }
  }
}
```

### Clients auto-hébergés

**Critique** : Les clients auto-hébergés doivent épingler la version du fournisseur pour correspondre à leur installation OneUptime :

| Version OneUptime | Version du fournisseur | Configuration          |
| ----------------- | ---------------------- | ---------------------- |
| 7.0.x             | 7.0.x                  | `version = "~> 7.0.0"` |
| 7.1.x             | 7.1.x                  | `version = "~> 7.1.0"` |
| 7.2.x             | 7.2.x                  | `version = "~> 7.2.0"` |

Exemple pour OneUptime 7.0.123 :

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Correspondance de version exacte
    }
  }
}
```

## Ressources disponibles

Le fournisseur Terraform OneUptime prend en charge les ressources suivantes :

### Ressources principales

- `oneuptime_team` — Gérer les équipes

### Surveillance

- `oneuptime_monitor` — Créer et gérer les moniteurs
- `oneuptime_probe` — Gérer les sondes de surveillance

### Gestion de l'astreinte

- `oneuptime_on_call_duty_policy` — Configurer les plannings d'astreinte

### Pages de statut

- `oneuptime_status_page` — Créer des pages de statut

### Catalogue de services

- `oneuptime_service_catalog` — Gérer les entrées du catalogue de services

### Catalogue de services

- `oneuptime_service` — Définir des services
- `oneuptime_service_dependency` — Cartographier les dépendances de services

### Sources de données

Remarque : Les sources de données ne sont actuellement pas disponibles dans le fournisseur car aucune source de données n'est définie dans le schéma du fournisseur.

## Exemples

### Configuration de surveillance complète

```hcl
# Variables
variable "oneuptime_api_key" {
  description = "Clé API OneUptime"
  type        = string
  sensitive   = true
}

variable "project_id" {
  description = "ID du projet OneUptime (créer le projet manuellement dans le tableau de bord)"
  type        = string
}

variable "oneuptime_url" {
  description = "URL OneUptime"
  type        = string
  default     = "https://oneuptime.com"
}

# Configuration du fournisseur
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

# Équipe
resource "oneuptime_team" "platform" {
  name        = "Équipe Plateforme"
  description = "Équipe d'ingénierie de la plateforme"
}

# Moniteurs
resource "oneuptime_monitor" "api" {
  name        = "Vérification de santé API"
  description = "Moniteur pour le point d'accès de santé de l'API"
  data        = jsonencode({
    url = "https://api.maentreprise.com/health"
    method = "GET"
    interval = "1m"
    timeout = "30s"
  })
}

resource "oneuptime_monitor" "database" {
  name       = "Connexion à la base de données"
  project_id = oneuptime_project.production.id

  monitor_type = "port"
  hostname     = "db.maentreprise.com"
  port         = 5432
  interval     = "2m"

  tags = {
    service     = "database"
    environment = "production"
    criticality = "critical"
  }
}

# Page de statut
resource "oneuptime_status_page" "public" {
  name       = "Statut de MaEntreprise"
  project_id = oneuptime_project.production.id

  domain = "statut.maentreprise.com"

  components {
    name       = "API"
    monitor_id = oneuptime_monitor.api.id
  }

  components {
    name       = "Base de données"
    monitor_id = oneuptime_monitor.database.id
  }
}
```

## Meilleures pratiques

### 1. Gestion des versions

**Pour les clients cloud :**

- Utilisez la gestion sémantique des versions avec `~>` pour obtenir des mises à jour compatibles
- Examinez le journal des modifications avant les mises à niveau majeures

**Pour les clients auto-hébergés :**

- Épinglez toujours à la version exacte correspondant à votre installation
- Mettez à jour la version du fournisseur lorsque vous mettez à niveau OneUptime
- Testez d'abord dans un environnement hors production

### 2. Gestion de l'état

```hcl
terraform {
  backend "s3" {
    bucket = "mon-état-terraform"
    key    = "oneuptime/terraform.tfstate"
    region = "us-west-2"
  }
}
```

### 3. Séparation des environnements

Utilisez des espaces de travail ou des fichiers d'état séparés pour différents environnements :

```bash
# Utiliser des espaces de travail
terraform workspace new production
terraform workspace new staging

# Utiliser des répertoires séparés
mkdir -p environments/{staging,production}
```

### 4. Gestion des variables

```hcl
# variables.tf
variable "environment" {
  description = "Nom de l'environnement"
  type        = string
}

variable "monitors" {
  description = "Liste des moniteurs à créer"
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
    name = "Site Web"
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

### 5. Nommage des ressources

Utilisez des conventions de nommage cohérentes :

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

## Guide de migration

### Depuis la configuration manuelle

1. **Auditer les ressources existantes** dans le tableau de bord OneUptime
2. **Créer la configuration Terraform** pour les ressources existantes
3. **Importer les ressources existantes** dans l'état Terraform
4. **Valider la configuration** correspondant à l'état actuel
5. **Appliquer les changements** de manière incrémentielle

Exemple d'importation :

```bash
# Importer un moniteur existant
terraform import oneuptime_monitor.website monitor-id-ici

# Importer un projet existant
terraform import oneuptime_project.main project-id-ici
```

### Mises à niveau de version

Lors de la mise à niveau OneUptime (auto-hébergé) :

1. **Sauvegardez votre état actuel**
2. **Vérifiez la compatibilité du fournisseur**
3. **Mettez à jour la version du fournisseur** dans la configuration
4. **Testez dans l'environnement de staging**
5. **Appliquez en production**

```bash
# Sauvegarder l'état
terraform state pull > backup.tfstate

# Mettre à jour la version du fournisseur
# Modifiez le bloc terraform dans votre configuration

# Planifier et appliquer
terraform init -upgrade
terraform plan
terraform apply
```

## Support et ressources

- **Documentation** : [Docs OneUptime](https://docs.oneuptime.com)
- **Registre Terraform** : [Fournisseur OneUptime](https://registry.terraform.io/providers/oneuptime/oneuptime)
- **Tickets GitHub** : [GitHub OneUptime](https://github.com/OneUptime/oneuptime/issues)
- **Communauté** : [Communauté OneUptime](https://community.oneuptime.com)

## Dépannage

### Problèmes courants

1. **Incompatibilité de version (auto-hébergé)**

   ```
   Error: API version incompatible
   ```

   **Solution** : Assurez-vous que la version du fournisseur correspond à l'installation OneUptime

2. **Problèmes d'authentification**

   ```
   Error: Invalid API key
   ```

   **Solution** : Vérifiez la clé API et les permissions

3. **Ressource introuvable**
   ```
   Error: Resource not found
   ```
   **Solution** : Vérifiez les ID de ressources et assurez-vous que la ressource existe

### Mode débogage

Activer la journalisation détaillée :

```bash
export TF_LOG=DEBUG
terraform apply
```

### Vérification de version

Vérifiez votre configuration :

```bash
# Vérifier la version Terraform
terraform version

# Vérifier la version du fournisseur
terraform providers

# Valider la configuration
terraform validate
```
