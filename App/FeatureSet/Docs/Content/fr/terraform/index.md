# Documentation du fournisseur Terraform

Le fournisseur Terraform OneUptime permet la gestion en tant qu'infrastructure as code (IaC) de vos ressources de surveillance, d'alerte et d'observabilité OneUptime.

## Sections de documentation

### [Démarrage rapide](./quick-start.md)
Guide de configuration rapide pour vous aider à démarrer avec le fournisseur Terraform OneUptime en quelques minutes.

### [Guide complet du fournisseur](./README.md)
Documentation complète couvrant l'installation, la configuration, les ressources et les meilleures pratiques.

### [Configuration auto-hébergée](./self-hosted.md)
**Critique pour les clients auto-hébergés** : Épinglage de version, compatibilité et stratégies de déploiement.

### [Exemples](./examples.md)
Exemples concrets et modèles pour les configurations Terraform OneUptime courantes.

## Liens rapides

### Pour les clients cloud OneUptime
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
  oneuptime_url = "https://oneuptime.com"
  api_key       = var.oneuptime_api_key
}
```

### Pour les clients auto-hébergés
```hcl
terraform {
  required_providers {
    oneuptime = {
      source  = "oneuptime/oneuptime"
      version = "= 7.0.123"  # Doit correspondre à votre version OneUptime
    }
  }
}

provider "oneuptime" {
  oneuptime_url = "https://oneuptime.votreentreprise.com"
  api_key       = var.oneuptime_api_key
}
```

## Important pour les utilisateurs auto-hébergés

**La compatibilité des versions est critique** : Épinglez toujours la version du fournisseur Terraform pour qu'elle corresponde exactement à votre version d'installation OneUptime. Des versions non correspondantes peuvent entraîner des problèmes de compatibilité API.

## Ressources externes

- **Registre Terraform** : [Fournisseur OneUptime](https://registry.terraform.io/providers/oneuptime/oneuptime)
- **Dépôt GitHub** : [Code source OneUptime](https://github.com/OneUptime/oneuptime)
- **Support communautaire** : [Communauté OneUptime](https://community.oneuptime.com)

## Ressources disponibles

Le fournisseur prend en charge la gestion complète des ressources OneUptime :

- **Projets & Équipes** : Organisez votre structure de surveillance
- **Moniteurs** : Moniteurs de site Web, API, port, signal de vie et personnalisés
- **Gestion des incidents** : Politiques d'alerte, plannings d'astreinte, escalades
- **Pages de statut** : Pages de statut publiques et privées avec branding personnalisé
- **Catalogue de services** : Définitions de services et cartographie des dépendances
- **Workflows** : Workflows de réponse et de remédiation automatisés

## Support

Pour les problèmes, questions ou contributions :

1. **Problèmes de documentation** : Créez un ticket dans le [dépôt OneUptime](https://github.com/OneUptime/oneuptime/issues)
2. **Bugs du fournisseur** : Signalez dans le dépôt principal OneUptime
3. **Demandes de fonctionnalités** : Discutez dans la communauté OneUptime
4. **Questions générales** : Utilisez les forums communautaires

## Prochaines étapes

1. **Nouveaux utilisateurs** : Commencez avec le [Guide de démarrage rapide](./quick-start.md)
2. **Auto-hébergé** : Consultez la [Configuration auto-hébergée](./self-hosted.md)
3. **Utilisateurs avancés** : Explorez les [Exemples](./examples.md) pour des configurations complexes
4. **Référence complète** : Consultez le [Guide complet](./README.md) pour toutes les fonctionnalités
