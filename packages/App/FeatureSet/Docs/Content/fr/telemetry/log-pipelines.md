# Pipelines de journaux

Les pipelines de journaux transforment les journaux pendant que OneUptime les ingère, avant leur stockage. Un pipeline a un **filtre** qui décide à quels journaux il s'applique et une liste ordonnée de **processeurs** qui modifient chacun ces journaux : extraire des champs du message, corriger la gravité, renommer un attribut ou étiqueter le journal avec une catégorie.

Les pipelines se trouvent sous **Journaux → Paramètres → Pipelines**.

:::cards
- [Comment s'exécute un pipeline](#comment-sexécute-un-pipeline): Où se placent les pipelines pendant l'ingestion, et dans quel ordre ils s'exécutent.
- [Créer un pipeline](#créer-un-pipeline): Cibler certains journaux et leur ajouter des processeurs.
- [Key=Value Parser](#keyvalue-parser): Transformer les lignes de pare-feu et logfmt en attributs.
- [Exemple : pare-feu Sophos XGS](#exemple-pare-feu-sophos-xgs): Analyser le syslog d'un pare-feu de bout en bout.
:::

## Comment s'exécute un pipeline

Les pipelines s'exécutent sur chaque journal que OneUptime ingère, qu'il s'agisse de journaux OpenTelemetry, de syslog ou de Fluentd, après les filtres de suppression et les règles de masquage, et avant le stockage du journal :

```mermaid title="Où les pipelines s'exécutent pendant l'ingestion d'un journal"
flowchart TB
    arrive["Le journal arrive"] --> drop{"Correspond à un<br/>filtre de suppression ?"}
    drop -->|"oui"| discarded["Supprimé"]
    drop -->|"non"| scrub["Les règles de masquage<br/>masquent des données"]
    scrub --> filter{"Le filtre du pipeline<br/>suivant correspond ?"}
    filter -->|"oui"| processors["Exécuter ses processeurs dans l'ordre"]
    filter -->|"non"| more{"Encore des pipelines ?"}
    processors --> more
    more -->|"oui"| filter
    more -->|"non"| stored["Le journal est stocké"]
```

- **Les pipelines s'exécutent dans l'ordre** : celui de la liste, que vous modifiez en faisant glisser les lignes. Un pipeline ne touche que les journaux auxquels son filtre correspond, et chaque pipeline dont le filtre correspond s'exécute, pas seulement le premier.
- **Les processeurs s'exécutent aussi dans l'ordre**, et chacun voit ce que le précédent a produit : un parseur doit donc précéder un processeur qui lit les champs qu'il extrait. Le filtre d'un pipeline ultérieur voit aussi ce que les pipelines précédents ont modifié.
- **Le traitement a lieu à l'ingestion.** Modifier un pipeline affecte les journaux qui arrivent ensuite, en une minute environ ; les journaux déjà stockés ne sont pas retraités.
- **Un processeur ne supprime ni ne vide jamais un journal.** Une ligne qu'un parseur ne sait pas lire passe sans changement. Pour écarter des journaux, utilisez **Journaux → Paramètres → Filtres de suppression**.
- **Seuls les pipelines et processeurs activés s'exécutent.** Désactivez-en un sur sa page pour le mettre en pause sans perdre sa configuration.

## Types de processeurs

| Processeur | Ce qu'il fait |
| --- | --- |
| Parseur Grok | Extrait des champs d'une ligne de forme fixe (une ligne d'accès nginx) avec un motif nommé. |
| Key=Value Parser | Découpe une ligne de paires `key=value` (Sophos XGS, Fortinet, logfmt) en attributs, dans n'importe quel ordre. |
| Remappeur de gravité | Associe un niveau brut comme `warn`, lu dans un attribut, à la gravité standard du journal. |
| Remappeur d'attributs | Renomme ou copie un attribut, par exemple `src_ip` vers `source_ip`. |
| Processeur de catégories | Étiquette un journal avec un nom de catégorie quand il correspond à un filtre, par exemple « Payment Error ». |

## Avant de commencer

- Des journaux qui arrivent dans OneUptime, via [OpenTelemetry](/docs/telemetry/open-telemetry), [syslog](/docs/telemetry/syslog), [Fluentd](/docs/telemetry/fluentd) ou une sonde.
- L'autorisation de modifier les pipelines. Les propriétaires et administrateurs du projet l'ont ; les autres ont besoin des autorisations **Create Log Pipeline** et **Create Log Pipeline Processor**.

## Créer un pipeline

:::steps
### Créer le pipeline

Allez dans **Journaux → Paramètres → Pipelines** et cliquez sur **Créer : Pipeline de journaux**. Donnez-lui un **Nom**, par exemple *Analyser les journaux du pare-feu*, et créez-le. La page du pipeline s'ouvre.

### Choisir à quels journaux il s'applique

Sous **Conditions de filtre**, cliquez sur **Modifier** et ajoutez des conditions sur **Gravité**, **Corps du journal**, **ID du service** ou un attribut personnalisé. Reliez-les avec **Toutes les conditions** ou **Au moins une condition**, puis cliquez sur **Enregistrer les modifications**. Un pipeline sans condition s'applique à tous les journaux.

### Ajouter des processeurs

Sous **Processeurs**, cliquez sur **Ajouter un processeur**, saisissez un **Nom du processeur**, choisissez un **Type de processeur** et remplissez ses paramètres. Les parseurs Grok et Key=Value ont un testeur : collez une ligne d'exemple pour voir ce qu'ils extrairaient. Cliquez sur **Créer un processeur**.

### Les mettre dans l'ordre

Faites glisser les processeurs pour changer leur ordre d'exécution, et faites glisser les pipelines de la liste **Pipelines** de la même façon. Les nouveaux journaux sont traités en une minute environ.
:::

### Conditions de filtre

Chaque condition compare un champ à une valeur. Derrière le générateur, le filtre est une requête comme `severityText = 'Error' AND body LIKE 'timeout'`, que **Preview query** affiche.

| Opérateur | Dans la requête | Remarques |
| --- | --- | --- |
| est égal à | `=` | Exact et sensible à la casse. |
| n'est pas égal à | `!=` | Exact et sensible à la casse. |
| contient | `LIKE` | Ignore la casse. `%` dans la valeur est un joker. |
| fait partie de | `IN` | Une liste de valeurs exactes séparées par des virgules. |

Les valeurs de gravité sont `Fatal`, `Error`, `Warning`, `Information`, `Debug`, `Trace` et `Unspecified` : `severityText = 'Error'` correspond donc, et `'ERROR'` jamais. Un attribut personnalisé s'écrit `attributes.<key>`, par exemple `attributes.networkDevice.name = 'hq-firewall'`.

## Key=Value Parser

Les pare-feu et autres équipements réseau journalisent chaque événement sous forme d'une ligne de paires `key=value`. Les champs d'une ligne, et leur ordre, dépendent de l'événement : aucun motif grok unique ne peut donc les décrire. Le Key=Value Parser n'en a pas besoin : il parcourt la ligne et transforme chaque paire trouvée en attribut du journal, quel que soit l'ordre. Une fois en attributs, vous pouvez les chercher et les filtrer, les utiliser dans une [surveillance des journaux](/docs/monitor/logs-monitor) et alerter une fois par tunnel, interface ou utilisateur avec [Regrouper par](/docs/monitor/logs-monitor#alertes-par-groupe-group-by).

### Configuration

| Paramètre | Valeur par défaut | Description |
| --- | --- | --- |
| Source Field | `body` | Le champ à analyser : `body` pour le message du journal, ou un attribut comme `attributes.raw_line`. |
| Target Prefix | aucun | Un espace de noms pour les clés extraites. `sophos` stocke `con_name` sous `sophos.con_name`. Un séparateur est ajouté, sauf si le préfixe se termine déjà par `.`, `_`, `-` ou `:`. |
| Pair Delimiter | n'importe quel blanc | Ce qui sépare une paire de la suivante. Laissez-le vide pour Sophos, Fortinet et logfmt ; indiquez `,`, `;` ou `\|` pour d'autres formats. |
| Key-Value Delimiter | `=` | Ce qui sépare une clé de sa valeur, par exemple `:` pour `status:up`. |
| Remplacer en cas de conflit | désactivé | Si une clé peut remplacer un attribut que le journal a déjà. Désactivé par défaut : les clés viennent de la ligne elle-même, et une ligne pourrait sinon réécrire des attributs fixés à l'ingestion, comme l'équipement dont elle provient. |

Les deux délimiteurs doivent être différents, ne doivent pas se contenir l'un l'autre et ne peuvent contenir ni guillemets ni barres obliques inverses ; chacun fait au plus 8 caractères. Le formulaire du processeur le vérifie avant d'enregistrer, et son testeur, **Test With a Sample Line**, montre exactement les attributs qu'une ligne d'exemple produirait.

### Règles d'analyse

- **Les valeurs entre guillemets** gardent leurs espaces et leurs délimiteurs : `message="IPSec Connection HQ-Branch1 terminated"` est une seule valeur. Les guillemets doubles et simples fonctionnent tous deux, et `\"` dans une valeur est un guillemet littéral. Un guillemet jamais refermé (une ligne coupée par une limite de taille syslog) court jusqu'à la fin de la ligne.
- **Les valeurs sans guillemets** courent jusqu'au délimiteur de paires suivant : `url=https://example.com/?a=b` garde donc son `=`.
- **Les valeurs vides** (`key=` et `key=""`) sont stockées comme des chaînes vides.
- **Les valeurs sont toujours du texte.** `latency=11` est stocké comme `"11"`, comme une capture grok sans type.
- **Les clés** commencent par une lettre ou un trait de soulignement et contiennent des lettres, des chiffres et `. _ - @`. Le texte avant la première paire, comme un en-tête syslog RFC 3164, et les mots isolés sans délimiteur sont ignorés. Une priorité syslog collée à la première clé (`<30>device_name="SFW"`) est retirée et la clé conservée.
- **Une clé répétée garde sa première valeur** ; les suivantes sont ignorées.
- **Limites :** une ligne de plus de 32 KiB n'est pas analysée, au plus 100 paires sont prises dans une ligne, les clés de plus de 256 caractères sont ignorées et les valeurs de plus de 4 096 caractères sont tronquées.

### Exemple : pare-feu Sophos XGS

Quand un pare-feu Sophos XGS envoie du syslog à une [sonde](/docs/monitor/network-device-monitor), chaque message est stocké comme journal de l'équipement réseau, avec le message syslog comme corps. Pour l'analyser :

:::steps
#### Créer un pipeline pour le pare-feu

Allez dans **Journaux → Paramètres → Pipelines** et créez un pipeline. Donnez-lui un filtre qui correspond aux journaux du pare-feu, par exemple l'attribut personnalisé `networkDevice.name` est égal à `hq-firewall` (`attributes.networkDevice.name = 'hq-firewall'`), ou **Corps du journal** contient `log_component=` pour cibler toutes les lignes Sophos.

#### Ajouter le parseur

Ouvrez le pipeline et cliquez sur **Ajouter un processeur**. Choisissez **Key=Value Parser**, laissez **Source Field** sur `body` et réglez **Target Prefix** sur `sophos` (facultatif, mais cela garde ensemble les champs du pare-feu).

#### Le tester et l'enregistrer

Collez une ligne du pare-feu dans **Test With a Sample Line** pour vérifier le résultat, puis cliquez sur **Créer un processeur**.
:::

Un événement IPsec Sophos :

```text
device_name="SFW" timestamp="2024-05-02T11:03:12+0200" device_model="XGS2100" device_serial_id="X1234" log_id="010101600001" log_type="Event" log_component="IPSec" log_subtype="System" severity="Information" con_name="HQ-Branch1" src_ip="10.171.4.117" dst_ip="10.171.4.118" status="Terminated" message="IPSec Connection HQ-Branch1 between 10.171.4.117 and 10.171.4.118 for Child HQ-Branch1 terminated."
```

devient ces attributs (entre autres) :

| Attribut | Valeur |
| --- | --- |
| `sophos.log_component` | `IPSec` |
| `sophos.con_name` | `HQ-Branch1` |
| `sophos.status` | `Terminated` |
| `sophos.src_ip` | `10.171.4.117` |
| `sophos.message` | `IPSec Connection HQ-Branch1 between 10.171.4.117 and 10.171.4.118 for Child HQ-Branch1 terminated.` |

Une ligne SLA SD-WAN a d'autres champs dans un autre ordre, et le même processeur la traite :

```text
log_id=158825619025 log_type="SD-WAN" log_component="SLA" profile_name="Branch-Internet" gw_name="WAN2" latency=11 jitter=2 packet_loss=0 gw_status="up" sla_status="SLA met"
```

donne `sophos.gw_name = WAN2`, `sophos.latency = 11`, `sophos.packet_loss = 0`, `sophos.gw_status = up` et `sophos.sla_status = SLA met`. Les anciennes versions de SFOS journalisent un format historique (`device="SFW" date=2017-01-31 time=18:02:03 timezone="IST" ... connectionname="Tunnel A"`) ; il s'analyse de la même façon, avec le nom du tunnel dans `connectionname` au lieu de `con_name`.

Pour transformer ces lignes SLA en métriques de latence, de gigue et de perte de paquets par passerelle, voyez l'exemple de [Règles d'enregistrement de journaux](/docs/telemetry/log-recording-rules).

### Exemple : Fortinet FortiGate

Les journaux FortiGate suivent le même style :

```text
date=2024-01-01 time=10:00:00 devname="FG100" logid="0100032001" type="event" subtype="vpn" level="notice" action="tunnel-down" vpntunnel="HQ-to-Branch2" msg="IPsec tunnel down"
```

Avec les paramètres par défaut et un préfixe `fortigate`, cela donne `fortigate.devname = FG100`, `fortigate.subtype = vpn`, `fortigate.action = tunnel-down`, `fortigate.vpntunnel = HQ-to-Branch2` et `fortigate.time = 10:00:00` : les deux-points d'une heure font partie de la valeur, ce ne sont pas des délimiteurs.

### Alerter une fois par tunnel

Avec les champs analysés, une [surveillance des journaux](/docs/monitor/logs-monitor) peut compter les échecs et lever une alerte distincte pour chaque tunnel : filtrez sur `sophos.log_component` = `IPSec` avec un corps contenant `terminated`, et regroupez par `sophos.con_name`. Voir [Alertes par groupe](/docs/monitor/logs-monitor#alertes-par-groupe-group-by).

## Parseur Grok

Extrait des champs structurés d'une ligne de forme fixe. Un motif grok est une expression régulière avec des références nommées : `%{IPV4:client_ip}` signifie « trouver une adresse IPv4 et la stocker sous `client_ip` ». Le motif n'a pas à couvrir toute la ligne, et une ligne qui ne correspond pas reste inchangée.

| Paramètre | Valeur par défaut | Description |
| --- | --- | --- |
| **Source Field** | `body` | Le champ à analyser, comme pour le Key=Value Parser. |
| **Target Prefix** | aucun | Un espace de noms pour les champs extraits, ajouté de la même façon. |
| **Motif Grok** | — | Le motif. Le formulaire liste les motifs nommés disponibles. |

Une capture est stockée en texte, sauf si vous lui donnez un type : `%{NUMBER:status:int}` la stocke comme nombre. Les types sont `int`, `long`, `float`, `double`, `boolean` et `string`. Vérifiez un motif sur une ligne d'exemple dans **Test Your Pattern** avant de l'enregistrer.

| Corps du journal | Motif | Attributs ajoutés |
| --- | --- | --- |
| `10.0.1.5 - GET /health 200` | `%{IPV4:client_ip} - %{WORD:method} %{NOTSPACE:path} %{NUMBER:status:int}` | client_ip, method, path, status |

Utilisez plutôt le Key=Value Parser quand la ligne est faite de paires `key=value` dont l'ordre change.

## Remappeur de gravité

Lit une valeur brute dans un attribut et l'associe à une gravité standard. Réglez **Attribut source** sur l'attribut qui contient le niveau (`level` par défaut), puis ajoutez des **Mappages** : chacun associe une valeur émise par votre application, comme `warn`, à une gravité, comme Warning. La correspondance ignore la casse. Une valeur sans mappage laisse la gravité du journal telle quelle.

## Remappeur d'attributs

Déplace la valeur d'un attribut (**Clé source**) vers un autre (**Clé cible**), par exemple `src_ip` vers `source_ip`.

| Paramètre | Valeur par défaut | Effet |
| --- | --- | --- |
| **Préserver la source** | désactivé | Désactivé, l'attribut est renommé : la clé source est retirée. Activé, il est copié et la clé source est conservée. |
| **Remplacer en cas de conflit** | activé | Activé, la cible est remplacée si elle existe déjà. Désactivé, la cible reste intacte et le remappage est ignoré. |

## Processeur de catégories

Évalue une liste de règles dans l'ordre et stocke le nom de la première règle dont le filtre correspond dans un attribut cible, afin que vous trouviez d'un coup tous les journaux « Payment Error ». Réglez **Attribut cible** (`category` par défaut), puis ajoutez des **Règles de catégorie** : un **Nom de la catégorie** et les conditions sous **When logs match**. La première règle qui correspond l'emporte ; un journal qui n'en satisfait aucune reste inchangé.

## Étapes suivantes

:::cards
- [Surveillance des journaux](/docs/monitor/logs-monitor): Alerter sur les attributs que vos pipelines extraient.
- [Règles d'enregistrement de journaux](/docs/telemetry/log-recording-rules): Transformer des champs de journaux analysés en métriques.
- [Syslog](/docs/telemetry/syslog): Envoyer le syslog des pare-feu et des serveurs à OneUptime.
- [Syntaxe de recherche](/docs/telemetry/search-syntax): Chercher sur les nouveaux attributs dans l'explorateur de journaux.
:::
