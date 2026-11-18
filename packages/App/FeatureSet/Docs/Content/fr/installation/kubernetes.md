# Kubernetes et Helm

Faites tourner OneUptime sur votre propre cluster Kubernetes avec le chart Helm. Votre serveur OneUptime sert lui-même cette page : elle s'ouvre sans accès à Internet et décrit le chart de la version que vous utilisez. Chaque valeur que le chart accepte se trouve dans la documentation du chart, sur [Artifact Hub](https://artifacthub.io/packages/helm/oneuptime/oneuptime).

:::cards
- [Installer le chart](#installer-le-chart): Un fichier de valeurs et deux commandes.
- [Sauvegarder vos données](#sauvegarder-vos-données): PostgreSQL et ClickHouse, vers un stockage hors du cluster.
- [Garder vos clés](#garder-vos-clés): Ce sans quoi vos sauvegardes sont illisibles.
:::

## Installer le chart

Créez un `values.yaml` avec le nom de domaine ou l'adresse IP que l'on utilisera, sans `http://` :

```yaml title="values.yaml"
host: oneuptime.example.com
```

Installez ensuite le chart :

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com/
helm install my-oneuptime oneuptime/oneuptime -f values.yaml
```

**Cela a fonctionné quand** `kubectl get pods` montre chaque pod `Running` et que l'adresse ouvre OneUptime. Le [Guide de l'auto-hébergement](/docs/installation/self-hosting-guide) continue à partir de là : HTTPS, le compte d'administration, puis l'e-mail, les SMS et les appels.

## Sauvegarder vos données

OneUptime garde ses données sur les volumes persistants du cluster : PostgreSQL contient vos projets, moniteurs, incidents, pages de statut et utilisateurs, et ClickHouse vos logs, traces et métriques. Sauvegardez les deux vers un stockage hors du cluster, de l'une de ces façons :

- **Les sauvegardes planifiées de l'Enterprise Edition.** Configurez-les dans l'Admin Dashboard sous **Paramètres > Sauvegardes**. Voir [Sauvegardes](/docs/installation/backups).
- **Les sauvegardes des volumes persistants par votre fournisseur cloud**, comme des instantanés planifiés des disques de PostgreSQL et de ClickHouse.
- **Les sauvegardes par instantané de volume de CloudNativePG**, quand PostgreSQL tourne sur l'opérateur CloudNativePG. Activez-les dans `values.yaml`, puis appliquez la modification :

```yaml title="values.yaml"
postgresOperator:
  cnpg:
    enabled: true
    backup:
      enabled: true
      schedule: "0 0 3 * * *"
```

```bash
helm upgrade my-oneuptime oneuptime/oneuptime -f values.yaml
```

Ce planning sauvegarde PostgreSQL chaque jour à 03:00. CloudNativePG ne supprime pas les anciens instantanés de volume : supprimez vous-même ceux dont vous n'avez plus besoin.

OneUptime ne voit pas les sauvegardes faites en dehors de lui. Une fois les vôtres en place, cliquez sur **Ce serveur est sauvegardé** dans l'élément Sauvegardes de la page **Configuration du serveur** de l'Admin Dashboard.

## Garder vos clés

Ce que OneUptime chiffre ne peut être lu qu'avec l'`encryptionSecret` qui a servi à le chiffrer. Définissez vous-même `oneuptimeSecret` et `encryptionSecret` dans `values.yaml`, pour qu'aucune mise à niveau ne les remplace, et gardez-en une copie avec vos sauvegardes, hors du cluster :

```yaml title="values.yaml"
oneuptimeSecret: <random string>
encryptionSecret: <random string>
```

## Étapes suivantes

:::cards
- [Guide de l'auto-hébergement](/docs/installation/self-hosting-guide): D'un cluster vide à un serveur qui vous alerte.
- [Mise à niveau](/docs/installation/upgrading): Sauvegarder avant chaque mise à niveau.
- [Sauvegardes](/docs/installation/backups): Les sauvegardes planifiées de l'Enterprise Edition.
:::
