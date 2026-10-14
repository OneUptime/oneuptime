# Importer des ressources

Vous n'avez pas à repartir de zéro pour gérer OneUptime avec Terraform. Importez les moniteurs, pages de statut, équipes et autres enregistrements que vous avez déjà, et Terraform les gère dès lors, tels qu'ils sont. Une importation ne fait que lire : rien ne change dans OneUptime tant que vous n'appliquez pas un changement que vous avez planifié.

:::cards
- [Comment fonctionne une importation](#comment-fonctionne-une-importation): Ce qu'une importation lit, et ce que vous écrivez.
- [Importer une ressource](#importer-une-ressource): Depuis sa page dans le tableau de bord, en quatre étapes.
- [Importer de nombreuses ressources](#importer-de-nombreuses-ressources): Des blocs d'importation pour toute une liste, et la configuration que Terraform écrit pour vous.
- [Ne plus gérer une ressource](#ne-plus-gérer-une-ressource): Rendez-la au tableau de bord sans la supprimer.
:::

## Comment fonctionne une importation

Une importation relie un enregistrement qui existe déjà dans OneUptime à un bloc `resource` de votre configuration. Vous écrivez un bloc `import` avec l'ID de l'enregistrement et l'adresse où il va. Le `terraform plan` suivant lit l'enregistrement par son ID et montre qu'il va être importé, avec toute différence entre l'enregistrement et votre configuration. `terraform apply` l'ajoute à l'état de Terraform, et dès lors l'enregistrement est géré comme tout ce que Terraform a créé.

```mermaid title="D'un enregistrement dans OneUptime à une ressource gérée"
flowchart TB
    R["Un enregistrement dans<br/>OneUptime, créé dans<br/>le tableau de bord"] --> I["Un bloc import :<br/>son ID et une adresse"]
    C["Un bloc resource :<br/>ses paramètres"] --> P["terraform plan<br/>lit l'enregistrement"]
    I --> P
    P --> A["terraform apply<br/>l'ajoute à l'état"]
    A --> M["Géré par Terraform"]
```

Écrivez le bloc `resource` de sorte qu'il dise ce qu'est déjà l'enregistrement. Là où ils diffèrent, le plan montre l'importation et un changement, et l'appliquer modifie l'enregistrement dans OneUptime.

### Ce qui peut être importé

Chaque ressource du fournisseur peut être importée par son ID, sauf `oneuptime_file` : l'API de OneUptime ne peut pas relire un fichier, donc le fournisseur répond `Import Not Supported`. Les sources de données ne sont jamais importées. Pour utiliser un enregistrement dans votre configuration sans le gérer, lisez-le plutôt avec une [source de données](/docs/terraform/complete-guide#lire-ce-qui-existe-déjà).

## Avant de commencer

- **Terraform 1.5 ou ultérieur, ou OpenTofu 1.6 ou ultérieur.** Les blocs `import` de cette page nécessitent ces versions. Un Terraform plus ancien importe en [ligne de commande](#importer-en-ligne-de-commande).
- **Une clé API qui peut lire ce que vous importez.** L'importation lit chaque enregistrement avec la clé du fournisseur, et le gérer ensuite demande aussi les permissions de le modifier et de le supprimer. Voir [Créer une clé API de projet](/docs/terraform/quick-start#créer-une-clé-api-du-projet).
- **Le fournisseur dans votre configuration**, configuré comme dans le [Démarrage rapide](/docs/terraform/quick-start#orienter-terraform-vers-oneuptime).

## Importer une ressource

Le tableau de bord écrit la configuration de la ressource que vous regardez, avec son bloc `import`, si bien que vous en écrivez rarement un à la main.

:::steps
### Ouvrir la page Terraform de la ressource

Ouvrez le moniteur, la page de statut ou une autre ressource dans le tableau de bord. Dans son menu latéral, ouvrez **Développeurs**, puis **Terraform**.

### Copier sa configuration

La page écrit le bloc `resource` de la ressource à partir de ses paramètres actuels, et un bloc `import` avec son ID. Placez les deux dans un fichier `.tf` :

```hcl title="status-pages.tf"
resource "oneuptime_status_page" "public_status" {
  name       = "Public Status"
  page_title = "Acme Status"

  # Secrets are not shown here: master_password, embedded_overall_status_token.
  # Terraform leaves them as they are in OneUptime.
}

import {
  to = oneuptime_status_page.public_status
  id = "68a1b2c3-d4e5-4f6a-8b9c-0d1e2f3a4b02"
}
```

Elle écrit les paramètres qui diffèrent de leurs valeurs par défaut, et un commentaire après chaque ID nomme l'enregistrement vers lequel il pointe. Les secrets ne sont jamais affichés : ceux dont la ressource a besoin sont lus dans des variables marquées `sensitive`, et le commentaire nomme ceux qu'elle laisse de côté.

### Planifier

Exécutez `terraform plan`. Il se termine par `Plan: 1 to import, 0 to add, 0 to change, 0 to destroy.` : Terraform a trouvé l'enregistrement, et votre configuration y correspond.

### Appliquer

Exécutez `terraform apply`. La page de statut est maintenant dans l'état de Terraform, et le plan suivant répond `No changes.` Vous pouvez ensuite supprimer le bloc `import`, ou le garder comme note de l'origine de la ressource : il ne fait plus rien une fois la ressource gérée.
:::

### Écrire les blocs vous-même

Sans le tableau de bord, écrivez vous-même les deux blocs. Commencez le bloc `resource` avec les attributs dont la ressource a besoin, et exécutez `terraform plan`. Là où votre configuration diffère de l'enregistrement, le plan montre le changement à côté de l'importation :

```text
  # oneuptime_label.critical will be updated in-place
  # (imported from "68a1b2c3-d4e5-4f6a-8b9c-0d1e2f3a4b03")
  ~ resource "oneuptime_label" "critical" {
      ~ color = "#FF5733" -> "#000000"
    }

Plan: 1 to import, 0 to add, 1 to change, 0 to destroy.
```

Recopiez la valeur de l'enregistrement dans votre configuration (ici `color = "#FF5733"`), et planifiez de nouveau jusqu'à ce que le plan montre l'importation et aucun changement. L'ID de l'enregistrement se trouve à trois endroits :

| Où | Comment |
| --- | --- |
| La page de la ressource | Sa carte de détails se termine par une ligne **ID**. Cliquez sur l'ID, ou sur le bouton de copie à côté, pour copier l'ID entier. |
| La barre d'adresse | L'ID vient après le nom de la liste : `/dashboard/<project-id>/monitors/<monitor-id>`. |
| L'API | Chaque enregistrement porte son ID dans `_id`. |

## Importer de nombreuses ressources

Pour importer chaque moniteur, page de statut ou autre ressource d'un même type, partez de sa liste.

:::steps
### Ouvrir la page Terraform de la liste

Ouvrez la liste, puis **Développeurs** et **Terraform** dans son menu latéral, par exemple **Moniteurs → Développeurs → Terraform**.

### Copier les blocs d'importation

La page écrit un bloc `import` pour chaque enregistrement (les 100 premiers), avec une adresse formée à partir du nom de l'enregistrement. Placez-les dans un fichier à part, comme `imports.tf` :

```hcl title="imports.tf"
import {
  to = oneuptime_monitor.homepage
  id = "68a1b2c3-d4e5-4f6a-8b9c-0d1e2f3a4b01"
}

import {
  to = oneuptime_monitor.checkout_api
  id = "68a1b2c3-d4e5-4f6a-8b9c-0d1e2f3a4b05"
}
```

### Laisser Terraform écrire la configuration

Exécutez le plan avec un nom de fichier pour la configuration que Terraform écrit. Le fichier ne doit pas encore exister : Terraform n'écrit que dans un nouveau fichier.

```bash
terraform plan -generate-config-out=monitors.tf
```

Terraform lit chaque enregistrement et écrit un bloc `resource` pour chaque bloc `import` qui n'en a pas. Il avertit que la génération de configuration est expérimentale, alors relisez ce qu'il a écrit.

### Relire et appliquer

Dans le nouveau fichier, remplacez les ID des autres enregistrements par des références à leurs ressources, comme `labels = [oneuptime_label.critical.id]`, afin que Terraform sache dans quel ordre travailler. Exécutez `terraform plan` jusqu'à ce qu'il ne montre plus que les importations, puis `terraform apply`.
:::

### Un projet entier

Importez un projet liste par liste, en commençant par les enregistrements auxquels d'autres font référence. Chaque bloc de ressource peut alors faire référence à ceux qui le précèdent par leur adresse plutôt que par leur ID :

```mermaid title="Importer d'abord les enregistrements auxquels d'autres font référence"
flowchart TB
    S["Étiquettes, équipes,<br/>statuts de moniteur<br/>et gravités d'incident"] --> M["Moniteurs, pages de statut<br/>et politiques d'astreinte"]
    M --> L["Ce qui les relie :<br/>ressources de page de statut,<br/>règles d'escalade<br/>et membres d'équipe"]
```

Les enregistrements avec lesquels chaque projet démarre, comme ses statuts de moniteur et ses gravités d'incident, gagnent souvent à être lus avec des sources de données plutôt qu'importés : Terraform peut alors y faire référence, mais ne les modifie ni ne les supprime jamais. Le projet est importé quand `terraform plan` répond `No changes.`

## Importer en ligne de commande

`terraform import` importe une ressource à la fois, et fonctionne avec toutes les versions de Terraform et d'OpenTofu. Écrivez d'abord le bloc `resource`, puis exécutez la commande avec l'adresse du bloc et l'ID de l'enregistrement :

```bash
terraform import oneuptime_status_page.public_status 68a1b2c3-d4e5-4f6a-8b9c-0d1e2f3a4b02
terraform import oneuptime_label.critical 68a1b2c3-d4e5-4f6a-8b9c-0d1e2f3a4b03
terraform import oneuptime_team.sre 68a1b2c3-d4e5-4f6a-8b9c-0d1e2f3a4b04
```

Chacune se termine par `Import successful!`. Contrairement à un bloc `import`, la commande écrit l'état immédiatement, sans plan à relire d'abord : exécutez ensuite `terraform plan`, et modifiez votre configuration jusqu'à ce que le plan réponde `No changes.`

## Ne plus gérer une ressource

Pour rendre une ressource au tableau de bord sans la supprimer, remplacez son bloc `resource` par un bloc `removed` qui conserve l'enregistrement :

```hcl
removed {
  from = oneuptime_team.sre

  lifecycle {
    destroy = false
  }
}
```

Le plan indique que l'équipe ne sera plus gérée par Terraform, et ne détruit rien. Appliquez-le, puis supprimez le bloc `removed`. Un bloc `removed` avec `destroy = false` nécessite Terraform 1.7 ou ultérieur, ou OpenTofu 1.10 ou ultérieur. Avec une version plus ancienne, exécutez plutôt `terraform state rm oneuptime_team.sre`.

> [!WARNING]
> Supprimer un bloc `resource` supprime son enregistrement dans OneUptime au prochain apply. Avec Terraform, un bloc `removed` sans `destroy = false` fait de même : écrivez toujours le bloc `lifecycle`.

## Bon à savoir

- **Une importation ne change rien, mais le prochain apply, si.** Appliquer un plan qui montre un changement à côté d'une importation modifie l'enregistrement dans OneUptime. Faites d'abord en sorte que le plan ne montre que l'importation.
- **Les secrets ne sont pas relus.** Un secret que OneUptime ne renvoie jamais, comme le `secret_value` d'un secret de moniteur, n'est pas dans l'état après une importation. Si votre configuration le définit, le premier plan le montre comme un changement, et l'appliquer réécrit le secret.
- **Une configuration par enregistrement.** Un enregistrement importé dans deux configurations est ramené à chaque apply à ce que dit chacune d'elles.
- **Les enregistrements importés sont des enregistrements gérés.** `terraform destroy` les supprime de OneUptime, comme les enregistrements que Terraform a créés.

## Dépannage

:::details Message « Cannot import non-existent remote object »
Aucun enregistrement n'a cet ID, ou la clé API du fournisseur ne peut pas le lire : OneUptime répond de la même façon dans les deux cas. Vérifiez l'ID, et que la clé peut lire ce type d'enregistrement.
:::

:::details Message « Import Not Supported »
`oneuptime_file` est la seule ressource qui ne peut pas être importée. Laissez-la de côté, et laissez Terraform créer plutôt un nouveau fichier.
:::

:::details Message « Invalid ID format »
L'ID n'est pas celui d'un enregistrement, par exemple un nom. Une importation prend l'ID, un UUID comme `68a1b2c3-d4e5-4f6a-8b9c-0d1e2f3a4b02` : copiez-le depuis la page de la ressource.
:::

:::details Message « Target generated file already exists »
`-generate-config-out` nomme un fichier qui existe déjà. Nommez un nouveau fichier, ou déplacez ailleurs ce que contient le fichier et supprimez-le.
:::

:::details Message « Resource already managed by Terraform »
`terraform import` a reçu une adresse qui est déjà dans l'état. Importez l'enregistrement à une autre adresse, ou vérifiez avec `terraform state list` ce que contient l'adresse.
:::

## Étapes suivantes

:::cards
- [Guide complet](/docs/terraform/complete-guide): Les sources de données, les références entre ressources, et l'état.
- [Étapes du moniteur](/docs/terraform/monitor-steps): Lire et modifier ce que vérifie un moniteur importé.
- [Exemples](/docs/terraform/examples): Des configurations prêtes à l'emploi pour les ressources courantes.
- [Dépannage](/docs/terraform/troubleshooting): Les erreurs courantes et comment les corriger.
:::
