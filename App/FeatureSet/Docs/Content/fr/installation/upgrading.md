# Mise à niveau de OneUptime

Ce guide explique comment mettre à niveau en toute sécurité votre installation auto-hébergée de OneUptime.

## Conseils généraux

- Mettez à niveau étape par étape pour les versions majeures (par exemple, 6 → 7 → 8). Ne sautez pas les versions majeures.
- Vous pouvez passer directement d'une version mineure/corrective à une autre (par exemple, 8.1 → 8.4) tant que vous suivez les notes de version.
- Effectuez toujours des sauvegardes avant la mise à niveau et vérifiez que vous pouvez les restaurer.

## Mise à niveau de OneUptime 8 → 9

Le chart Helm ne provisionne plus de ressource Kubernetes Ingress. OneUptime inclut un conteneur de passerelle d'entrée qui termine déjà le TLS, gère les domaines des pages de statut et achemine le trafic pour la plateforme, de sorte qu'un contrôleur d'entrée de cluster n'est plus nécessaire.

- Supprimez les remplacements `oneuptimeIngress` de vos fichiers `values.yaml` personnalisés avant la mise à niveau. Ces clés sont désormais ignorées et provoqueront des erreurs de validation si elles sont laissées en place.
- Assurez-vous que `nginx.service.type` reflète la façon dont vous souhaitez exposer la passerelle d'entrée intégrée (par exemple `LoadBalancer`, `NodePort` ou `ClusterIP` avec un équilibreur de charge externe).
- Vérifiez que les enregistrements DNS pour les pages de statut ou les hôtes primaires pointent toujours vers le Service ou l'équilibreur de charge qui protège la passerelle d'entrée OneUptime.
- Après la mise à niveau, confirmez que les certificats TLS continuent d'être renouvelés via la passerelle intégrée et que les domaines des pages de statut se résolvent correctement.


## Mise à niveau de OneUptime 7 → 8

Si vous exécutez sur Kubernetes, il y a des changements importants avec rupture de compatibilité :

- Nous n'utilisons plus les charts Bitnami pour Postgres, Redis et ClickHouse en raison des [changements de licence Bitnami](https://github.com/bitnami/charts/issues/35164)
- Ces changements ne sont pas rétrocompatibles. Vous devez suivre la nouvelle structure dans le fichier `values.yaml` du chart Helm.
- Sauvegardez vos données (Postgres, ClickHouse et tout volume persistant) avant la mise à niveau.


> Conseil : Testez d'abord la mise à niveau dans un environnement de staging. Vérifiez que vos charges de travail sont saines et que les données sont intactes avant de mettre à niveau la production.
