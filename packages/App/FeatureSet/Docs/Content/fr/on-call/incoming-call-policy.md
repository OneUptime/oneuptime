# Politique d'appels entrants (intégration Twilio)

Les politiques d'appels entrants permettent aux appelants externes de joindre vos ingénieurs d'astreinte en composant un numéro de téléphone dédié. Lorsque quelqu'un appelle, OneUptime achemine l'appel via vos règles d'escalade configurées jusqu'à ce qu'un ingénieur réponde.

## Fonctionnement

```mermaid
flowchart TD
    A[L'appelant compose<br/>le numéro d'appel entrant] --> B[Twilio reçoit l'appel]
    B --> C[Twilio envoie un webhook<br/>à OneUptime]
    C --> D[OneUptime joue<br/>le message d'accueil]
    D --> E[Charger les règles d'escalade]
    E --> F{Règle 1:<br/>Essayer l'utilisateur d'astreinte}
    F -->|Sans réponse| G{Règle 2:<br/>Essayer l'ingénieur de secours}
    F -->|Répondu| H[Connecter l'appelant<br/>à l'ingénieur]
    G -->|Sans réponse| I{Règle 3:<br/>Essayer le responsable}
    G -->|Répondu| H
    I -->|Sans réponse| J[Jouer le message<br/>sans réponse et raccrocher]
    I -->|Répondu| H
    H --> K[Appel connecté]
    K --> L[Fin de l'appel]
    L --> M[Journaliser les détails de l'appel]
```

## Flux d'acheminement des appels

```mermaid
sequenceDiagram
    participant Appelant
    participant Twilio
    participant OneUptime
    participant IngenieurdAstreinte

    Appelant->>Twilio: Compose le numéro d'appel entrant
    Twilio->>OneUptime: POST /incoming-call/voice
    OneUptime->>Twilio: TwiML : Jouer l'accueil
    Twilio->>Appelant: "Veuillez patienter pendant que nous vous connectons..."

    loop Règles d'escalade
        OneUptime->>OneUptime: Obtenir la prochaine règle d'escalade
        OneUptime->>Twilio: TwiML : Appeler l'utilisateur d'astreinte
        Twilio->>IngenieurdAstreinte: Faire sonner le téléphone
        alt L'ingénieur répond
            IngenieurdAstreinte->>Twilio: Décroche
            Twilio->>OneUptime: Statut de la numérotation : terminé
            Twilio->>Appelant: Connecter à l'ingénieur
            Note over Appelant,IngenieurdAstreinte: Appel en cours
        else Sans réponse (délai d'attente)
            Twilio->>OneUptime: Statut de la numérotation : sans réponse
            OneUptime->>OneUptime: Essayer la règle suivante
        end
    end

    alt Toutes les règles épuisées
        OneUptime->>Twilio: TwiML : Jouer le message sans réponse
        Twilio->>Appelant: "Personne n'est disponible..."
        Twilio->>Appelant: Raccrocher
    end
```

## Prérequis

- Un compte Twilio — Créez-en un sur [https://www.twilio.com](https://www.twilio.com)
- Votre SID de compte Twilio et votre jeton d'authentification
- Accès à votre instance auto-hébergée OneUptime

## Vue d'ensemble

La fonctionnalité de politique d'appels entrants fonctionne en :

1. Recevant les appels entrants sur un numéro de téléphone Twilio
2. Jouant un message d'accueil personnalisable
3. Acheminant l'appel via des règles d'escalade (plannings d'astreinte ou personnes)
4. Connectant l'appelant au premier ingénieur d'astreinte disponible
5. Escaladant à la règle suivante si personne ne répond

Comme vous auto-hébergez OneUptime, vous devrez configurer votre propre compte Twilio. Cela vous donne un contrôle total sur vos numéros de téléphone et votre facturation.

## Étape 1 : Créer un compte Twilio

1. Allez sur [https://www.twilio.com](https://www.twilio.com) et créez un compte
2. Complétez le processus de vérification
3. Notez votre **SID de compte** et votre **jeton d'authentification** depuis le tableau de bord de la console Twilio

## Étape 2 : Configurer la configuration d'appel/SMS dans OneUptime

1. Connectez-vous à votre tableau de bord OneUptime
2. Allez dans **Paramètres du projet** > **Notifications** > **Paramètres de notification**
3. Dans **Configuration Twilio**, cliquez sur **Créer une configuration Twilio**
4. Remplissez les champs suivants :
   - **Nom** : Un nom convivial (ex. : « Configuration Twilio de production »)
   - **Description** : Description optionnelle
   - **SID de compte Twilio** : Votre SID de compte Twilio (commence par `AC`)
   - **Jeton d'authentification Twilio** : Votre jeton d'authentification Twilio
   - **Numéro de téléphone principal Twilio** : Un numéro de téléphone de votre compte Twilio pour les appels sortants
   - **Définir par défaut pour le projet** : activé pour la première configuration Twilio du projet, de sorte que les SMS et appels destinés aux membres du projet passent aussi par ce compte. Désactivez-le si ce compte sert uniquement aux appels entrants.
5. Cliquez sur **Enregistrer**

## Étape 3 : Créer une politique d'appels entrants

1. Allez dans **Astreinte** > **Politiques d'appels entrants**
2. Cliquez sur **Créer une politique d'appels entrants**
3. Remplissez les champs suivants :
   - **Nom** : Un nom convivial (ex. : « Hotline de support »)
   - **Description** : Description optionnelle
4. Cliquez sur **Enregistrer**

## Étape 4 : Lier la configuration Twilio à la politique

1. Ouvrez votre politique d'appels entrants nouvellement créée
2. Dans la carte **Routage de numéro de téléphone**, trouvez **Étape 2 : Lier la configuration Twilio**
3. Cliquez sur **Sélectionner la configuration Twilio** et choisissez la configuration créée à l'étape 2
4. Enregistrez la sélection

## Étape 5 : Configurer un numéro de téléphone

Vous avez deux options pour configurer un numéro de téléphone :

### Option A : Utiliser un numéro de téléphone Twilio existant

Si vous avez déjà des numéros de téléphone dans votre compte Twilio :

1. Dans la carte **Numéro de téléphone**, cliquez sur **Utiliser un numéro existant**
2. OneUptime récupérera tous les numéros de téléphone de votre compte Twilio
3. Sélectionnez le numéro de téléphone que vous souhaitez utiliser
4. Cliquez sur **Utiliser ce numéro** pour l'assigner à la politique

> **Remarque** : Si le numéro de téléphone a déjà un webhook configuré, il sera mis à jour pour pointer vers OneUptime.

### Option B : Acheter un nouveau numéro de téléphone

Pour acheter un nouveau numéro de téléphone directement depuis OneUptime :

1. Dans la carte **Numéro de téléphone**, cliquez sur **Acheter un nouveau numéro**
2. Sélectionnez un **Pays** dans la liste déroulante
3. Entrez optionnellement un **Code de région** (ex. : 415 pour San Francisco)
4. Entrez optionnellement les chiffres que le numéro doit **Contenir** (ex. : 555)
5. Cliquez sur **Rechercher** pour trouver les numéros disponibles
6. Sélectionnez un numéro de téléphone dans les résultats
7. Cliquez sur **Acheter** pour acquérir le numéro

Le numéro de téléphone sera acheté depuis votre compte Twilio et le webhook sera **automatiquement configuré** — aucune configuration manuelle requise !

```mermaid
flowchart LR
    A[Créer la politique] --> B[Lier la config Twilio]
    B --> C{Choisir l'option<br/>de numéro de téléphone}
    C -->|Existant| D[Sélectionner depuis<br/>le compte Twilio]
    C -->|Nouveau| E[Rechercher et acheter<br/>un nouveau numéro]
    D --> F[Webhook configuré automatiquement]
    E --> F
    F --> G[Ajouter des règles d'escalade]
    G --> H[Politique prête !]
```

## Étape 6 : Configurer les règles d'escalade

Les règles d'escalade décident qui est appelé quand quelqu'un compose le numéro de la politique, du haut de la liste vers le bas :

1. Ouvrez votre politique d'appels entrants
2. Allez dans l'onglet **Règles d'escalade**
3. Cliquez sur **Ajouter une règle d'escalade**
4. Remplissez la règle. C'est une seule étape :
   - **Qui appeler** : un planning d'astreinte ou une personne. Un planning fait sonner la personne d'astreinte dans ce planning au moment de l'appel. Les personnes sont les membres de votre projet.
   - **Durée de sonnerie (en secondes)** : combien de temps leur téléphone sonne avant que l'appel passe à la règle suivante. Elle commence à 20 secondes, et Twilio accepte de 5 à 600.
   - **Nom** et **Description** sont facultatifs, sous **Plus de champs**. Une règle sans nom est affichée selon sa place dans la liste : **Level 1**, **Level 2**.
5. Enregistrez-la, puis ajoutez une règle pour chaque planning ou personne à essayer ensuite

Les règles sont appelées du haut de la liste vers le bas, et une nouvelle règle est ajoutée à la fin. Pour changer l'ordre, faites glisser une règle par la poignée en haut à gauche ; au clavier, placez le focus sur la poignée, appuyez sur Espace, déplacez-la avec les flèches, puis appuyez de nouveau sur Espace.

> **Attention à la messagerie** : gardez la **Durée de sonnerie** plus courte que le délai au bout duquel le téléphone de la personne renvoie un appel sans réponse vers sa messagerie. Si la messagerie répond d'abord, l'appelant y est connecté et l'appel ne passe pas à la règle suivante. Twilio ajoute quelques secondes à chaque sonnerie. C'est pourquoi une nouvelle règle commence à 20 secondes. Les règles ajoutées quand la valeur par défaut était de 30 secondes gardent leurs 30 : si leurs appels aboutissent sur la messagerie, réduisez la **Durée de sonnerie** de ces règles.

### Exemple de règle d'escalade

```mermaid
flowchart TD
    subgraph "Chaîne d'escalade"
        A[Level 1 : planning d'astreinte principal<br/>Sonner 20 secondes] --> B[Level 2 : planning d'astreinte secondaire<br/>Sonner 20 secondes]
        B --> C[Level 3 : responsable de l'ingénierie<br/>Sonner 20 secondes]
        C --> D[Message sans réponse]
    end
```

| Niveau  | Qui appeler                                | Durée de sonnerie |
| ------- | ------------------------------------------ | ----------------- |
| Level 1 | Planning d'astreinte principal             | 20 secondes       |
| Level 2 | Planning d'astreinte secondaire            | 20 secondes       |
| Level 3 | Responsable de l'ingénierie (une personne) | 20 secondes       |

## Étape 7 : Configurer les messages vocaux (optionnel)

Personnalisez les messages entendus par les appelants :

1. Ouvrez votre politique d'appels entrants
2. Allez dans **Paramètres**
3. Configurez :
   - **Message d'accueil** : Joué lorsque l'appel est répondu
   - **Message en cas de non-réponse** : Joué lorsque toutes les règles d'escalade échouent
   - **Message lorsque personne n'est disponible** : Joué lorsque personne n'est d'astreinte

## Options de configuration

### Paramètres de la politique

| Paramètre                                  | Description                                            | Par défaut                                                                                     |
| ------------------------------------------ | ------------------------------------------------------ | ---------------------------------------------------------------------------------------------- |
| Message d'accueil                          | Message TTS joué lors de la réponse à l'appel          | « Veuillez patienter pendant que nous vous mettons en relation avec l'ingénieur d'astreinte. » |
| Message sans réponse                       | Message quand toutes les règles d'escalade échouent    | « Personne n'est disponible. Veuillez réessayer plus tard. »                                   |
| Message aucune personne disponible         | Message quand personne n'est d'astreinte               | « Nous sommes désolés, mais aucun ingénieur d'astreinte n'est actuellement disponible. »       |
| Répéter la politique si personne ne répond | Redémarrer depuis la première règle si toutes échouent | Désactivé                                                                                      |
| Nombre de répétitions de la politique      | Nombre maximum de tentatives de répétition             | 1                                                                                              |

### Paramètres des règles d'escalade

| Paramètre                       | Description                                                                                                                                                              |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Qui appeler                     | Un planning d'astreinte, qui appelle la personne d'astreinte, ou une personne. Chaque règle appelle l'un des deux                                                        |
| Durée de sonnerie (en secondes) | Combien de temps le téléphone sonne avant que l'appel passe à la règle suivante (par défaut : 20 ; de 5 à 600)                                                          |
| Nom et Description              | Facultatifs, sous Plus de champs. Une règle sans nom est affichée comme Level 1, Level 2 et ainsi de suite, selon sa place dans la liste                                       |
| Ordre                           | La place de la règle dans la liste : les règles sont appelées de haut en bas. Se règle en faisant glisser les règles ; via l'API, une nouvelle règle sans ordre va à la fin |

Via l'API, une règle définit `onCallDutyPolicyScheduleId` ou `userId` (l'un des deux, jamais les deux) et `escalateAfterSeconds` : la durée de sonnerie, 20 si elle est omise.

## Consultation des journaux d'appels

Pour consulter l'historique des appels entrants :

1. Allez dans **Astreinte** > **Politiques d'appels entrants**
2. Cliquez sur votre politique
3. Allez dans l'onglet **Journaux d'appels**

Les journaux affichent :

- Numéro de téléphone de l'appelant
- Statut de l'appel (Terminé, Sans réponse, Échoué, etc.)
- Qui a répondu à l'appel
- Durée de l'appel
- Horodatage

## Configuration du numéro de téléphone de l'utilisateur

Pour que les utilisateurs reçoivent des appels entrants, ils doivent avoir un numéro de téléphone vérifié :

1. Les utilisateurs vont dans **Paramètres utilisateur** > **Méthodes de notification**
2. Ajoutent un numéro de téléphone sous **Numéros d'appels entrants**
3. Vérifient le numéro de téléphone via un code SMS

Seuls les utilisateurs avec des numéros de téléphone vérifiés peuvent être appelés via les règles d'escalade.

## Libérer un numéro de téléphone

Si vous n'avez plus besoin d'un numéro de téléphone :

1. Ouvrez votre politique d'appels entrants
2. Dans la carte **Numéro de téléphone**, cliquez sur **Libérer le numéro**
3. Confirmez la libération

> **Avertissement** : Les numéros libérés sont retournés à Twilio et peuvent ne pas être disponibles pour un rachat.

## Dépannage

### Les appels ne sont pas reçus

- Vérifiez que la configuration Twilio est correctement liée à la politique
- Vérifiez que votre instance OneUptime est accessible depuis Internet
- Vérifiez que le SID de compte Twilio et le jeton d'authentification sont corrects
- Consultez la console Twilio pour les journaux d'erreurs

### Les appels ne se connectent pas aux ingénieurs

- Vérifiez que les utilisateurs ont des numéros de téléphone vérifiés dans leurs paramètres de notification
- Vérifiez que les règles d'escalade sont correctement configurées
- Assurez-vous que les plannings d'astreinte ont des utilisateurs assignés pour l'heure actuelle
- Vérifiez que la politique est activée
- Si les appels aboutissent sur la messagerie d'un ingénieur, réglez la **Durée de sonnerie** de la règle sous le délai au bout duquel son téléphone bascule sur la messagerie

### Problèmes de qualité audio

- Assurez-vous que votre serveur dispose d'une connectivité Internet stable
- Consultez la page de statut de Twilio pour tout problème en cours
- Vérifiez que les numéros de téléphone sont au bon format (format E.164 : +15551234567)

## Considérations de sécurité

- Gardez votre jeton d'authentification Twilio sécurisé et ne l'exposez jamais publiquement
- Utilisez HTTPS pour votre instance OneUptime
- OneUptime valide les signatures de webhook pour s'assurer que les requêtes proviennent de Twilio
- Envisagez de restreindre les numéros de téléphone pouvant appeler vos politiques d'appels entrants

## Aperçu de l'architecture

```mermaid
graph TB
    subgraph "Externe"
        A[Appelant]
        B[Cloud Twilio]
    end

    subgraph "OneUptime"
        C[API d'appels entrants]
        D[Routeur d'appels]
        E[Moteur d'escalade]
        F[Base de données]
    end

    subgraph "Équipe d'astreinte"
        G[Ingénieur 1]
        H[Ingénieur 2]
        I[Responsable]
    end

    A -->|1. Compose le numéro| B
    B -->|2. Webhook| C
    C -->|3. Charger la politique| F
    C -->|4. Obtenir les règles| D
    D -->|5. Traiter les règles| E
    E -->|6. Réponse TwiML| B
    B -->|7. Appeler| G
    B -->|8. Escalader| H
    B -->|9. Escalader| I
```

## Support

Pour les problèmes avec la fonctionnalité de politique d'appels entrants, veuillez :

1. Consulter la console Twilio pour les journaux d'erreurs
2. Examiner les journaux du serveur OneUptime
3. Contacter le support à [hello@oneuptime.com](mailto:hello@oneuptime.com)
