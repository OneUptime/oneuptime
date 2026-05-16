# Moniteur manuel

La surveillance manuelle vous permet de créer des moniteurs dont le statut est géré entièrement à la main ou via l'API. OneUptime n'effectue aucune vérification automatisée — vous contrôlez directement le statut du moniteur.

## Vue d'ensemble

Les moniteurs manuels sont des espaces réservés que vous mettez à jour vous-même. Cela est utile pour :

- Intégrer avec des outils de surveillance externes qui mettent à jour le statut via l'API OneUptime
- Suivre des services ou des systèmes qui ne peuvent pas être surveillés automatiquement
- Gérer des incidents pour des composants sans vérifications de santé automatisées
- Représenter des dépendances tierces dont vous suivez le statut manuellement

## Création d'un moniteur manuel

1. Allez dans **Moniteurs** dans le tableau de bord OneUptime
2. Cliquez sur **Créer un moniteur**
3. Sélectionnez **Manuel** comme type de moniteur
4. Entrez un nom et une description pour le moniteur

## Fonctionnement

Les moniteurs manuels n'ont pas d'intervalles de surveillance, de sondes ni d'évaluation automatisée des critères. Le statut du moniteur reste tel que vous l'avez défini jusqu'à ce que vous le modifiiez.

### Mise à jour du statut

Vous pouvez mettre à jour le statut d'un moniteur manuel de deux manières :

- **Tableau de bord** — Changez le statut du moniteur directement depuis le tableau de bord OneUptime
- **API** — Mettez à jour le statut du moniteur par programmation en utilisant l'API OneUptime

### Incidents et alertes

Vous pouvez créer des incidents et des alertes contre des moniteurs manuels comme n'importe quel autre type de moniteur. Cela vous permet de :

- Suivre les temps d'arrêt pour les services surveillés en externe
- Créer des incidents manuellement lorsque des problèmes sont signalés
- Utiliser des moniteurs manuels sur les pages de statut pour communiquer l'état aux utilisateurs

## Quand utiliser les moniteurs manuels

| Cas d'utilisation | Description |
|-------------------|-------------|
| Services tiers | Suivre le statut de services externes dont vous dépendez mais que vous ne pouvez pas surveiller directement |
| Infrastructure physique | Représenter du matériel ou des systèmes physiques sans surveillance réseau |
| Processus métier | Suivre des processus non techniques qui affectent le statut du service |
| Statut piloté par API | Permettre à des outils externes de mettre à jour le statut du moniteur via l'API OneUptime |
| Espaces réservés de page de statut | Afficher des composants sur votre page de statut qui sont gérés en dehors de OneUptime |
