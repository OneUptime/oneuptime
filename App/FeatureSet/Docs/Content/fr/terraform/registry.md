# Guide d'installation et d'utilisation du fournisseur Terraform

## Installation depuis le registre Terraform

Le fournisseur Terraform OneUptime est disponible sur le [Registre Terraform](https://registry.terraform.io/providers/oneuptime/oneuptime) officiel.

### Pour les utilisateurs OneUptime Cloud

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # Utiliser la dernière version compatible
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.com"
  api_key       = var.oneuptime_api_key
}
```

### Pour les utilisateurs OneUptime auto-hébergés

⚠️ **Critique** : Les clients auto-hébergés doivent épingler la version du fournisseur pour qu'elle corresponde exactement à leur installation OneUptime.

```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Remplacez par votre version exacte OneUptime
    }
  }
  required_version = ">= 1.0"
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.votreentreprise.com"  # Votre URL auto-hébergée
  api_key       = var.oneuptime_api_key
}
```

## Pourquoi l'épinglage de version pour l'auto-hébergé ?

Le fournisseur Terraform OneUptime est généré automatiquement à partir de la spécification API OneUptime. Chaque version OneUptime peut avoir :

- Des points d'accès API différents
- Des schémas de ressources mis à jour
- Des fonctionnalités nouvelles ou supprimées
- Des règles de validation modifiées

L'utilisation d'une version de fournisseur qui ne correspond pas à votre installation OneUptime peut entraîner :

- Des erreurs de compatibilité API
- Des échecs de création/mise à jour de ressources
- Un comportement inattendu
- Une dérive d'état des ressources

## Trouver votre version OneUptime

### Méthode 1 : Tableau de bord

1. Connectez-vous à votre tableau de bord OneUptime
2. Allez dans **Paramètres** → **À propos**
3. Notez le numéro de version (ex. : « 7.0.123 »)

### Méthode 2 : API

```bash
curl https://votre-instance-oneuptime.com/api/version | jq '.version'
```

### Méthode 3 : Docker

```bash
docker images | grep oneuptime
# Recherchez le tag, ex. : oneuptime/dashboard:7.0.123
```

## Informations sur le registre du fournisseur

- **URL du registre** : https://registry.terraform.io/providers/oneuptime/oneuptime
- **Dépôt source** : https://github.com/OneUptime/terraform-provider-oneuptime
- **Documentation** : https://registry.terraform.io/providers/oneuptime/oneuptime/latest/docs
- **Versions** : https://github.com/OneUptime/terraform-provider-oneuptime/releases

## Matrice de compatibilité des versions

| Version OneUptime | Version du fournisseur | Configuration Terraform |
| ----------------- | ---------------------- | ----------------------- |
| 7.0.x             | 7.0.x                  | `version = "~> 7.0.0"`  |
| 7.1.x             | 7.1.x                  | `version = "~> 7.1.0"`  |
| Cloud (dernière)  | Dernier fournisseur    | `version = "~> 7.0"`    |

## Exemple de démarrage rapide

```hcl
# Configurer le fournisseur
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "~> 7.0"  # À ajuster pour l'auto-hébergé
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.com"  # À ajuster pour l'auto-hébergé
  api_key       = var.oneuptime_api_key
}

# Créer un projet
resource "oneuptime_project" "example" {
  name        = "Exemple Terraform"
  description = "Créé avec Terraform"
}

# Créer un moniteur de site Web
resource "oneuptime_monitor" "website" {
  name       = "Moniteur de site Web"
  project_id = oneuptime_project.example.id

  monitor_type = "website"
  url          = "https://example.com"
  interval     = "5m"

  tags = {
    managed_by = "terraform"
  }
}
```

## Étapes d'installation

1. **Créez votre configuration Terraform** avec le bloc fournisseur
2. **Initialisez Terraform** : `terraform init`
3. **Définissez votre clé API** : Créez `terraform.tfvars` avec votre clé API
4. **Planifiez votre déploiement** : `terraform plan`
5. **Appliquez votre configuration** : `terraform apply`

## Obtenir de l'aide

- **Documentation complète** : Consultez la [documentation Terraform complète](./README.md)
- **Guide auto-hébergé** : Consultez le [guide de configuration auto-hébergée](./self-hosted.md)
- **Exemples** : Parcourez les [exemples de configuration](./examples.md)
- **Démarrage rapide** : Suivez le [guide de démarrage rapide](./quick-start.md)

## Mises à jour du registre

Le fournisseur est automatiquement publié dans le registre Terraform lorsque de nouvelles versions OneUptime sont publiées. Les clients cloud peuvent utiliser la gestion sémantique des versions (`~> 7.0`) pour obtenir automatiquement des mises à jour compatibles, tandis que les clients auto-hébergés doivent épingler à des versions exactes.
