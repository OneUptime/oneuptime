# Guide de configuration Terraform pour OneUptime auto-hébergé

Ce guide est spécifiquement destiné aux clients qui exécutent des instances OneUptime auto-hébergées. Il couvre la gestion des versions, la configuration et les meilleures pratiques pour utiliser le fournisseur Terraform avec votre propre déploiement OneUptime.

## Notes importantes

⚠️ **Les projets ne peuvent pas être créés via Terraform** — Les projets doivent être créés manuellement dans le tableau de bord OneUptime en premier. Utilisez l'ID du projet dans vos configurations Terraform.

⚠️ **La règle la plus importante pour les clients auto-hébergés** : Épinglez toujours votre version de fournisseur Terraform pour qu'elle corresponde exactement à votre version d'installation OneUptime.

## Structure des ressources

Toutes les ressources Terraform OneUptime suivent une structure simplifiée :
- `name` (obligatoire) — Nom de la ressource
- `description` (optionnel) — Description de la ressource
- `data` (optionnel) — Configuration complexe en JSON

## Critique : Compatibilité des versions

⚠️ **La règle la plus importante pour les clients auto-hébergés** : Épinglez toujours votre version de fournisseur Terraform pour qu'elle corresponde exactement à votre version d'installation OneUptime.

### Pourquoi l'épinglage de version est critique

- Le fournisseur Terraform est généré automatiquement depuis l'API OneUptime
- Chaque version OneUptime peut avoir des points d'accès API et des schémas différents
- L'utilisation d'une version de fournisseur non correspondante peut entraîner des erreurs ou un comportement inattendu
- L'épinglage de version garantit la compatibilité et un comportement prévisible

## Trouver votre version OneUptime

### Méthode 1 : Tableau de bord
1. Connectez-vous à votre tableau de bord OneUptime
2. Allez dans **Paramètres** → **À propos**
3. Recherchez le numéro de version (ex. : « 7.0.123 »)

### Méthode 2 : Point d'accès API
```bash
curl https://votre-instance-oneuptime.com/api/status
```

### Méthode 3 : Images Docker
Si vous exécutez OneUptime avec Docker :
```bash
docker images | grep oneuptime
# Recherchez le tag, ex. : oneuptime/dashboard:7.0.123
```

### Méthode 4 : Chart Helm
Si vous utilisez Helm :
```bash
helm list -n oneuptime
# Vérifiez la version du chart
```

### Méthode 5 : Variables d'environnement
Vérifiez vos fichiers de configuration pour les variables de version :
```bash
grep -r "APP_VERSION\|IMAGE_TAG" /chemin/vers/votre/config/oneuptime
```

## Modèles de configuration du fournisseur

### Modèle pour la version 7.0.x

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Remplacez 123 par votre numéro de build exact
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.votreentreprise.com"  # Votre URL auto-hébergée
  api_key       = var.oneuptime_api_key
}
```

### Modèle pour la version 7.1.x

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.1.45"  # Remplacez par votre version exacte
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.votreentreprise.com"
  api_key       = var.oneuptime_api_key
}
```

## Exemple complet de configuration auto-hébergée

Voici un exemple complet pour une instance OneUptime auto-hébergée :

```hcl
# versions.tf
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Doit correspondre à votre version OneUptime
    }
  }
  required_version = ">= 1.0"
  
  # Optionnel : Utiliser l'état distant pour la collaboration d'équipe
  backend "s3" {
    bucket = "votre-bucket-état-terraform"
    key    = "oneuptime/terraform.tfstate"
    region = "us-west-2"
  }
}

# variables.tf
variable "oneuptime_url" {
  description = "URL de l'instance OneUptime"
  type        = string
  default     = "https://oneuptime.votreentreprise.com"
}

variable "oneuptime_api_key" {
  description = "Clé API OneUptime"
  type        = string
  sensitive   = true
}

variable "environment" {
  description = "Nom de l'environnement"
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
  description = "ID du projet OneUptime (créer manuellement dans le tableau de bord)"
  type        = string
}

# main.tf
# Créer des équipes
resource "oneuptime_team" "infrastructure" {
  name        = "Équipe Infrastructure"
  description = "Équipe d'infrastructure et d'opérations"
}

resource "oneuptime_team" "development" {
  name        = "Équipe Développement"
  description = "Équipe de développement d'applications"
  project_id = oneuptime_project.main.id
}

# Moniteurs d'infrastructure
resource "oneuptime_monitor" "database" {
  name       = "${var.environment}-database"
  project_id = oneuptime_project.main.id
  
  monitor_type = "port"
  hostname     = "db.interne.votreentreprise.com"
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
  url          = "https://app.votreentreprise.com/health"
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

# Politiques d'astreinte
resource "oneuptime_on_call_policy" "infrastructure_oncall" {
  name       = "Astreinte Infrastructure"
  project_id = oneuptime_project.main.id
  team_id    = oneuptime_team.infrastructure.id
  
  schedules {
    name     = "24x7 Infrastructure"
    timezone = "America/New_York"
    
    layers {
      name          = "Principal"
      users         = ["infra1@votreentreprise.com", "infra2@votreentreprise.com"]
      rotation_type = "weekly"
      start_time    = "00:00"
      end_time      = "23:59"
      days          = ["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"]
    }
  }
}

# Politiques d'alerte
resource "oneuptime_alert_policy" "critical_infrastructure" {
  name       = "Alertes Infrastructure Critique"
  project_id = oneuptime_project.main.id
  
  conditions {
    monitor_id = oneuptime_monitor.database.id
    threshold  = "down"
  }
  
  actions {
    type = "email"
    recipients = ["infrastructure@votreentreprise.com"]
  }
  
  actions {
    type             = "oncall_escalation"
    oncall_policy_id = oneuptime_on_call_policy.infrastructure_oncall.id
  }
}

# Page de statut interne
resource "oneuptime_status_page" "internal" {
  name       = "Statut des services internes"
  project_id = oneuptime_project.main.id
  
  domain = "statut.interne.votreentreprise.com"
  
  components {
    name       = "Base de données"
    monitor_id = oneuptime_monitor.database.id
  }
  
  components {
    name       = "Application"
    monitor_id = oneuptime_monitor.application.id
  }
}

# outputs.tf
output "project_id" {
  description = "ID du projet"
  value       = oneuptime_project.main.id
}

output "status_page_url" {
  description = "URL de la page de statut"
  value       = "https://${oneuptime_status_page.internal.domain}"
}
```

## Configuration spécifique à l'environnement

### Environnement de développement

```hcl
# dev.tfvars
oneuptime_url = "https://oneuptime-dev.votreentreprise.com"
environment = "development"
```

### Environnement de staging

```hcl
# staging.tfvars
oneuptime_url = "https://oneuptime-staging.votreentreprise.com"  
environment = "staging"
```

### Environnement de production

```hcl
# prod.tfvars
oneuptime_url = "https://oneuptime.votreentreprise.com"
environment = "production"
```

## Processus de mise à niveau pour l'auto-hébergé

Lors de la mise à niveau de votre instance OneUptime :

### 1. Liste de contrôle avant la mise à niveau

```bash
# Sauvegarder l'état Terraform actuel
terraform state pull > backup-$(date +%Y%m%d).tfstate

# Noter la version OneUptime actuelle
curl https://oneuptime.votreentreprise.com/api/status | jq '.version'

# Noter la version actuelle du fournisseur
terraform providers | grep oneuptime
```

### 2. Mettre à niveau l'instance OneUptime

Suivez votre processus standard de mise à niveau OneUptime (Docker, Helm, etc.)

### 3. Mettre à jour le fournisseur Terraform

```hcl
# Mettre à jour la version dans le bloc terraform
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.124"  # Nouvelle version après la mise à niveau
    }
  }
}
```

### 4. Tester et appliquer

```bash
# Mettre à jour le fournisseur
terraform init -upgrade

# Planifier pour voir les changements
terraform plan

# Appliquer si tout semble correct
terraform apply
```

## Configuration réseau

### Règles de pare-feu

Assurez-vous que votre exécuteur Terraform peut accéder à :
- Point d'accès API OneUptime (généralement port 443/HTTPS)
- Toutes les ressources internes surveillées

### VPN/Réseaux privés

Si OneUptime est sur un réseau privé :

```hcl
provider "oneuptime" {
  oneuptime_url = "https://10.0.1.100:443"  # IP interne
  api_key       = var.oneuptime_api_key
}
```

## Meilleures pratiques de sécurité

### 1. Gestion des clés API

```bash
# Utiliser des variables d'environnement
export ONEUPTIME_API_KEY="votre-clé-api"

# Ou utiliser un système de gestion des secrets
export ONEUPTIME_API_KEY=$(vault kv get -field=api_key secret/oneuptime)
```

### 2. Clés API avec moindres privilèges

Créez des clés API avec des permissions minimales requises :
- Gestion des moniteurs
- Gestion des politiques d'alerte
- Gestion des équipes (si nécessaire)

### 3. Sécurité réseau

```hcl
# Exemple avec vérification TLS
provider "oneuptime" {
  oneuptime_url = "https://oneuptime.votreentreprise.com"
  api_key       = var.oneuptime_api_key
  
  # Options de sécurité supplémentaires si prises en charge
  verify_ssl = true
  timeout    = "30s"
}
```

## Surveillance de votre automatisation Terraform

Créez des moniteurs pour votre automatisation Terraform :

```hcl
resource "oneuptime_monitor" "terraform_runner" {
  name       = "Santé de l'exécuteur Terraform"
  project_id = oneuptime_project.main.id
  
  monitor_type = "heartbeat"
  interval     = "15m"
  
  tags = {
    automation = "terraform"
    criticality = "medium"
  }
}
```

## Dépannage des problèmes auto-hébergés

### Problème : Connexion refusée

```
Error: connection refused
```

**Solutions** :
1. Vérifiez que l'instance OneUptime est en cours d'exécution
2. Vérifiez que l'URL de l'API est correcte
3. Vérifiez la connectivité pare-feu/réseau
4. Vérifiez que les certificats TLS sont valides

### Problème : Incompatibilité de version API

```
Error: API version incompatible
```

**Solutions** :
1. Vérifiez la version OneUptime : `curl https://votre-instance/api/status`
2. Mettez à jour la version du fournisseur pour correspondre
3. Exécutez `terraform init -upgrade`

### Problème : Certificats auto-signés

Si vous utilisez des certificats auto-signés :

```bash
# Ignorer temporairement la vérification TLS (non recommandé pour la production)
export ONEUPTIME_SKIP_TLS_VERIFY=true
```

Meilleure solution : Ajoutez votre certificat CA au magasin de confiance du système.

## Sauvegarde et reprise après sinistre

### Sauvegarde de l'état

```bash
# Sauvegardes régulières de l'état
terraform state pull > backup-$(date +%Y%m%d-%H%M%S).tfstate

# Script de sauvegarde automatisé
#!/bin/bash
DATE=$(date +%Y%m%d-%H%M%S)
terraform state pull > "backups/terraform-state-${DATE}.tfstate"
find backups/ -name "terraform-state-*.tfstate" -mtime +30 -delete
```

### Sauvegarde de la configuration

```bash
# Sauvegarder la configuration Terraform
tar -czf terraform-config-$(date +%Y%m%d).tar.gz *.tf *.tfvars
```

## Gestion multi-environnement

### Utilisation des espaces de travail

```bash
# Créer des environnements
terraform workspace new dev
terraform workspace new staging  
terraform workspace new prod

# Basculer entre les environnements
terraform workspace select prod
terraform apply -var-file="prod.tfvars"
```

### Utilisation de répertoires séparés

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

Cette approche offre une meilleure isolation et une gestion des versions plus facile par environnement.
