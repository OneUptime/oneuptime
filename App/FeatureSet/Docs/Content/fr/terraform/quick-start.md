# Guide de démarrage rapide du fournisseur Terraform

Ce guide vous aidera à démarrer avec le fournisseur Terraform OneUptime en quelques minutes.

## Prérequis

- Terraform >= 1.0 installé
- Compte OneUptime (Cloud ou Auto-hébergé)
- Clé API OneUptime

## Étape 1 : Créer une clé API

### Pour OneUptime Cloud
1. Allez sur [OneUptime Cloud](https://oneuptime.com) et connectez-vous
2. Accédez à **Paramètres** → **Clés API**
3. Cliquez sur **Créer une clé API**
4. Nommez-la « Fournisseur Terraform »
5. Sélectionnez les permissions requises
6. Copiez la clé API générée

### Pour OneUptime auto-hébergé
1. Accédez à votre instance OneUptime
2. Accédez à **Paramètres** → **Clés API**
3. Cliquez sur **Créer une clé API**
4. Nommez-la « Fournisseur Terraform »
5. Sélectionnez les permissions requises
6. Copiez la clé API générée

## Étape 2 : Créer la configuration Terraform

Créez un nouveau répertoire et un fichier `main.tf` :

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      # Pour les clients cloud
      version = "~> 7.0"
      
      # Pour les clients auto-hébergés - épinglez à votre version exacte
      # version = "= 7.0.123"  # Remplacez par votre version OneUptime
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  # Pour les clients cloud
  oneuptime_url = "https://oneuptime.com"
  
  # Pour les clients auto-hébergés - utilisez l'URL de votre instance
  # oneuptime_url = "https://oneuptime.votreentreprise.com"
  
  api_key = var.oneuptime_api_key
}

variable "oneuptime_api_key" {
  description = "Clé API OneUptime"
  type        = string
  sensitive   = true
}

# Remarque : Les projets doivent être créés manuellement dans le tableau de bord OneUptime
# Utilisez votre ID de projet existant ici
variable "project_id" {
  description = "ID du projet OneUptime"
  type        = string
}

# Créer un moniteur de site Web simple
resource "oneuptime_monitor" "website" {
  name        = "Moniteur de site Web"
  description = "Moniteur pour la disponibilité du site Web"
  data        = jsonencode({
    url = "https://example.com"
    interval = "5m"
    timeout = "30s"
  })
}

# Afficher l'ID du moniteur
output "monitor_id" {
  value = oneuptime_monitor.website.id
}
```

## Étape 3 : Créer le fichier de variables

Créez `terraform.tfvars` :

```hcl
# terraform.tfvars
oneuptime_api_key = "votre-clé-api-ici"
project_id        = "votre-id-projet-ici"  # Obtenez-le depuis le tableau de bord OneUptime
```

**Important** : Ajoutez `terraform.tfvars` à votre `.gitignore` pour garder les clés API secrètes !

## Étape 4 : Initialiser et appliquer

```bash
# Initialiser Terraform
terraform init

# Planifier le déploiement
terraform plan

# Appliquer la configuration
terraform apply
```

## Étape 5 : Vérifier les ressources

1. Vérifiez votre tableau de bord OneUptime
2. Allez dans votre projet existant
3. Vérifiez que le « Moniteur de site Web » est créé et en cours d'exécution

## Prochaines étapes

1. **Explorer plus de ressources** : Consultez la [documentation complète](./README.md) pour toutes les ressources disponibles
2. **Configurer les alertes** : Ajoutez des politiques d'alerte et des canaux de notification
3. **Créer des pages de statut** : Configurez des pages de statut publiques pour vos services
4. **Organiser avec des équipes** : Créez des équipes et attribuez des permissions

## Exemples spécifiques aux versions

### Clients cloud (dernière version)

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # Obtient toujours la dernière version compatible 7.x
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.com"
  api_key       = var.oneuptime_api_key
}
```

### Clients auto-hébergés (version épinglée)

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Doit correspondre exactement à votre version OneUptime
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.maentreprise.com"  # Votre URL auto-hébergée
  api_key       = var.oneuptime_api_key
}
```

## Dépannage du démarrage rapide

### Problème : Fournisseur introuvable
```
Error: Failed to query available provider packages
```
**Solution** : Exécutez `terraform init` pour télécharger le fournisseur

### Problème : Authentification échouée
```
Error: Invalid API key
```
**Solution** :
1. Vérifiez votre clé API dans le tableau de bord OneUptime
2. Vérifiez que la clé API dispose de permissions suffisantes
3. Assurez-vous que `oneuptime_url` est correct pour votre instance

### Problème : Incompatibilité de version (auto-hébergé)
```
Error: API version incompatible
```
**Solution** :
1. Vérifiez votre version OneUptime dans le tableau de bord
2. Mettez à jour la version du fournisseur pour qu'elle corresponde exactement
3. Exécutez `terraform init -upgrade`

## Nettoyage

Pour supprimer toutes les ressources créées dans ce démarrage rapide :

```bash
terraform destroy
```

Cela supprimera le moniteur et le projet créés lors du démarrage rapide.
