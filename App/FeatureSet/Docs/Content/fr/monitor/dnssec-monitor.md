# Moniteur DNSSEC

La surveillance DNSSEC vous permet de valider l'intégrité cryptographique des réponses DNS pour vos zones. OneUptime effectue périodiquement une validation DNSSEC complète — il vérifie les enregistrements DNKEY, la délégation DS dans la zone parente, la validité des signatures RRSIG, le consensus des résolveurs sur le drapeau AD et la cohérence entre les serveurs de noms autoritaires.

## Vue d'ensemble

Les moniteurs DNSSEC valident l'ensemble de la chaîne de confiance, de la zone racine jusqu'à votre domaine. Cela vous permet de :

- Détecter les chaînes DNSSEC rompues avant que les résolveurs ne commencent à renvoyer SERVFAIL à vos utilisateurs
- Être averti avant l'expiration des clés de signature de zone
- Vérifier que vos enregistrements DS sont correctement publiés dans la zone parente
- Détecter les divergences entre serveurs de noms autoritaires (primaire/secondaire désynchronisés)
- Confirmer que les résolveurs validateurs activent effectivement le drapeau AD pour votre zone

## Création d'un moniteur DNSSEC

1. Allez dans **Moniteurs** dans le tableau de bord OneUptime
2. Cliquez sur **Créer un moniteur**
3. Sélectionnez **DNSSEC** comme type de moniteur
4. Entrez la zone (domaine) que vous souhaitez valider
5. Configurez les résolveurs et les critères de surveillance selon vos besoins

## Options de configuration

### Paramètres de base

| Champ | Description | Obligatoire |
|-------|-------------|-------------|
| Zone (Nom de domaine) | La zone à valider via DNSSEC (ex. : `example.com`) | Oui |
| Résolveurs | Liste séparée par des virgules de résolveurs validateurs à interroger (ex. : `1.1.1.1, 8.8.8.8, 9.9.9.9`) | Oui |
| Vérifier la cohérence des serveurs de noms | Interroger chaque serveur de noms autoritaire directement et vérifier qu'ils retournent le même numéro de série SOA | Non |

### Paramètres avancés

| Champ | Description | Par défaut |
|-------|-------------|------------|
| Avertissement d'expiration de signature (jours) | Seuil par défaut pour le filtre d'expiration RRSIG | 7 |
| Délai d'attente (ms) | Durée d'attente pour chaque requête DNS | 10000 |
| Tentatives | Nombre de tentatives en cas d'échec | 3 |

## Critères de surveillance

Vous pouvez configurer des critères pour déterminer quand votre zone est considérée comme en ligne, dégradée ou hors ligne en fonction de :

### Types de vérifications disponibles

| Type de vérification | Description |
|----------------------|-------------|
| Chaîne DNSSEC valide | L'ensemble de la chaîne de validation (racine → TLD → zone) se résout correctement |
| Enregistrement DNSKEY DNSSEC existant | La zone publie au moins un enregistrement DNSKEY |
| Enregistrement DS DNSSEC existant dans la zone parente | La zone parente publie un enregistrement DS correspondant à la KSK de la zone |
| Expiration de la signature DNSSEC en jours | Nombre de jours avant l'expiration de la prochaine signature RRSIG |
| Consensus des résolveurs DNSSEC (drapeau AD) | Chaque résolveur interrogé retourne le drapeau AD (Authenticated Data) |
| Serveurs de noms DNSSEC cohérents | Tous les serveurs de noms autoritaires retournent le même numéro de série SOA |
| DNSSEC valide | Résultat global de réussite/échec sur toutes les vérifications de validation |

### Types de filtres

Pour **Chaîne DNSSEC valide**, **Enregistrement DNSKEY DNSSEC existant**, **Enregistrement DS DNSSEC existant dans la zone parente**, **Consensus des résolveurs DNSSEC (drapeau AD)**, **Serveurs de noms DNSSEC cohérents** et **DNSSEC valide** :

- **Vrai** — La condition est vraie
- **Faux** — La condition est fausse

Pour **Expiration de la signature DNSSEC en jours** :

- **Supérieur à**, **Inférieur à**, **Supérieur ou égal à**, **Inférieur ou égal à**, **Égal à**, **Différent de**

### Exemples de critères

#### Alerter si la chaîne DNSSEC est rompue

- **Vérifier sur** : Chaîne DNSSEC valide
- **Type de filtre** : Faux

#### Avertir avant l'expiration des signatures

- **Vérifier sur** : Expiration de la signature DNSSEC en jours
- **Type de filtre** : Inférieur à
- **Valeur** : 7

#### Détecter un DS manquant dans la zone parente (délégation rompue)

- **Vérifier sur** : Enregistrement DS DNSSEC existant dans la zone parente
- **Type de filtre** : Faux

#### Détecter un désaccord entre résolveurs

- **Vérifier sur** : Consensus des résolveurs DNSSEC (drapeau AD)
- **Type de filtre** : Faux

#### Détecter une incohérence entre serveurs de noms

- **Vérifier sur** : Serveurs de noms DNSSEC cohérents
- **Type de filtre** : Faux

## Bonnes pratiques

1. **Utilisez plusieurs résolveurs publics** — Par défaut, `1.1.1.1`, `8.8.8.8` et `9.9.9.9` afin qu'une panne d'un seul résolveur ne provoque pas de faux positifs
2. **Avertissez bien avant l'expiration** — Configurez des alertes dégradées 7 jours avant et des alertes hors ligne 2 jours avant l'expiration de la signature ; les rotations de clés peuvent échouer silencieusement
3. **Surveillez chaque zone signée** — Incluez les domaines apex, les sous-domaines signés et toute zone déléguée à un opérateur différent
4. **Activez les vérifications de cohérence des serveurs de noms** — Elles détectent les problèmes de synchronisation primaire/secondaire que la validation DNSSEC seule manquerait, sauf si votre réseau bloque le trafic DNS sortant vers des IP arbitraires
