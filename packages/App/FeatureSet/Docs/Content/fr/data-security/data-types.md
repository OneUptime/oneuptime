# Types de données sensibles

Sécurité des données connaît 143 sortes de données sensibles : numéros de carte, comptes bancaires, identifiants nationaux de 43 pays, identifiants de santé, clés API et jetons, et les catégories particulières de données personnelles. Chacune a une catégorie, une sensibilité et, quand elle appartient à un pays, ce pays. Cette page indique comment une valeur est trouvée et liste chaque type de données, pour que vous puissiez comprendre pourquoi quelque chose a été trouvé et décider quoi en faire.

:::cards
- [Comment une valeur est trouvée](#comment-une-valeur-est-trouvée): Forme, validateur, contexte, valeurs de test, confiance.
- [Champs et colonnes](#champs-et-colonnes): Comment une colonne ou un attribut est jugé dans son ensemble.
- [Chaque type de données](#types-de-données-intégrés): Les 143, par catégorie.
- [Vos propres types de données](#vos-propres-types-de-données): Identifiants d'employé, numéros de police, et la zone Tester.
- [Les verdicts d'OneUptime AI](#les-verdicts-doneuptime-ai): Un verdict sur chaque détection qui vous attend, avec les décisions de votre équipe comme précédents.
:::

## Comment une valeur est trouvée

```mermaid title="D'un candidat à une détection"
flowchart TB
    shape["Forme : un motif<br/>trouve un candidat"] --> valid{"Passe-t-il<br/>son validateur ?"}
    valid -->|"Non"| none["Aucune détection"]
    valid -->|"Oui"| context["Contexte : mots proches,<br/>ou nom du champ"]
    context --> test{"Une valeur de test<br/>connue ?"}
    test -->|"Oui"| apart["Comptée à part,<br/>jamais une détection"]
    test -->|"Non"| finding["Détection, avec<br/>sa confiance"]
```

Chaque analyse - une ligne de journal, une cellule CSV, une ligne de base de données, les premiers octets d'un objet - suit les mêmes étapes :

1. **Forme.** Chaque type de données a des motifs qui trouvent des candidats : seize chiffres, `AKIA` et seize lettres, un mot, un `@` et un domaine. Un motif ne correspond jamais à l'intérieur d'une séquence plus longue, donc un numéro de carte n'est pas trouvé dans une suite de chiffres plus longue.
2. **Validateur.** Un candidat doit respecter les règles propres à son type : une somme de contrôle (Luhn pour les cartes, mod 97 pour les IBAN, Verhoeff pour les numéros Aadhaar, le chiffre de contrôle de la plupart des identifiants nationaux), une date réelle, un préfixe connu, assez d'aléa pour un secret. Un candidat qui échoue n'est pas du tout une détection. Les valeurs fictives comme `000000000` et `123456789` échouent pour chaque type numérique.
3. **Contexte.** Les mots proches d'un candidat - par défaut jusqu'à 64 caractères avant et 32 après - qui disent ce qu'il est relèvent sa confiance d'un niveau, tout comme un champ dont le nom désigne le type. Les mots qui disent qu'il s'agit d'autre chose, comme un numéro de commande ou de suivi, l'abaissent d'un niveau. Un numéro sans somme de contrôle et de forme courante, comme un numéro de passeport ou un compte bancaire, ne compte qu'à côté de mots qui le nomment.
4. **Valeurs de test connues.** Les numéros de carte de test publiés (comme `4242 4242 4242 4242` de Stripe), les IBAN d'exemple, les adresses sur `example.com` et d'autres domaines réservés, les adresses IP de documentation, les identifiants d'exemple qu'imprime la documentation des administrations, les clés en mode test comme `sk_test_` et les clés fictives sont comptés à part. Ils ne produisent jamais de détection, donc un magasin de données qui en est plein se lit comme un environnement de test, pas comme une fuite.
5. **Confiance.** Ce qui reste est une détection, aussi sûre que ses preuves le permettent.

| Confiance | Ce que cela signifie |
| --- | --- |
| **Élevé** | La valeur a passé son validateur, et les mots autour d'elle ou le champ où elle se trouve disent ce qu'elle est - ou, pour un champ, la plupart de ses valeurs sont de ce type. |
| **Moyen** | La valeur a passé son validateur sans rien autour pour la confirmer, ou le nom du champ dit ce qu'il contient et certaines valeurs concordent. |
| **Faible** | La forme correspond, mais rien ne la confirme. |

Seules les détections de confiance Élevé ou Moyen comptent : elles rendent un magasin de données sensible et peuvent ouvrir un problème. Les détections de confiance Faible sont listées sur le magasin de données, repliées, pour qu'une personne en juge : **Confirmer** sur une détection juste la fait passer à Élevé, et elle reste Élevé lors des analyses suivantes.

Quand deux types de données revendiquent les mêmes caractères, la détection la plus sûre l'emporte : la confiance la plus élevée, puis le détecteur dont les propres règles prouvent le plus, puis la correspondance la plus longue.

Une valeur longue est lue par fenêtres de 64 Ko qui se chevauchent de 4 Ko, donc une valeur est trouvée entière où qu'elle se trouve, et au plus 4 Mo d'une même valeur sont lus.

## Champs et colonnes

Une colonne, un champ JSON ou un attribut de journal est jugé dans son ensemble. Son nom suggère un type de données, et ses valeurs échantillonnées en prouvent un. La part de ses valeurs qui contiennent le type décide de la certitude de la détection :

| Valeurs qui contiennent le type | Confiance |
| --- | --- |
| 60 % ou plus | Élevé |
| 25 % ou plus | Élevé quand le nom du champ désigne le type, Moyen sinon |
| Moins | Moyen quand le nom du champ désigne le type, Faible sinon : quelques e-mails dans une colonne d'autre chose |

Un champ dont les valeurs dépassent 80 caractères en moyenne est du texte libre - notes, messages, descriptions - et n'est pas censé contenir un seul type. Ses détections gardent la confiance que chaque correspondance a obtenue seule, et indiquent qu'elles ont été trouvées dans du texte libre. Jusqu'à 1 000 valeurs d'un champ sont classifiées, et jusqu'à 16 Ko de chacune.

Le nom d'un champ est découpé en mots - `customerEmail`, `customer_email` et `customer-email` donnent tous « customer email » - et l'indice de nom d'un type correspond quand ses mots apparaissent dans cet ordre, côte à côte : « date of birth » correspond à `customer_date_of_birth`, pas à `birth_city`. Seule la dernière partie d'un chemin à points est le nom propre du champ, avec la partie qui la précède quand la dernière est un mot générique comme `number`, `id` ou `value` : `customer.address.city` n'est pas une adresse postale, et `card.number` est bien un numéro de carte.

Certains types de données ne se reconnaissent pas à leurs valeurs : aucun motif ne distingue le nom d'une personne d'une rue, ni une religion de n'importe quel autre mot. Ils sont trouvés d'après le seul nom du champ, quand le champ a des valeurs : Nom de personne, Nom d'utilisateur, Genre, Nationalité, Informations de santé, Origine raciale ou ethnique, Croyance religieuse, Orientation sexuelle, Opinion politique, Appartenance syndicale, Données biométriques, Données génétiques et Casier judiciaire. Un nom, un nom d'utilisateur, un genre ou une nationalité a alors une confiance Élevé quand 60 % ou plus des valeurs y ressemblent, et Moyen sinon.

Un champ dont le nom dit qu'il contient un mot de passe - `password`, `passwordHash`, `pwd`, mais pas `password_changed_at` - devrait contenir un hachage : bcrypt, argon2, scrypt, PBKDF2 ou un autre schéma qu'un magasin de données est susceptible d'utiliser. Les valeurs vides, les valeurs fictives comme `********` et les valeurs chiffrées sont mises de côté. Quand le reste compte plus de valeurs qui ne sont pas des hachages que de valeurs qui en sont, le champ contient les mots de passe eux-mêmes, qu'aucun motif ne peut voir, et le magasin de données échoue au contrôle [Les mots de passe sont stockés en clair](/docs/data-security/checks-and-issues#hygiène-des-données).

### Les champs qu'aucun détecteur n'a pu classer

Une colonne ou un champ dont le nom n'évoque aucun type de données, et dont les valeurs ne correspondent à aucun détecteur, n'est pas connu comme sûr : ce peut être votre propre numéro de client, ou une colonne nommée dans une autre langue. Avec **Activer l'IA** activé pour le projet, une analyse du contenu conserve ces champs, 200 au plus par analyse, et OneUptime AI est interrogé sur le type de données du projet que contient chacun, 40 champs au plus d'un magasin de données à la fois. On lui donne le nom du champ, les noms des champs voisins et les formes de ses valeurs - chaque lettre écrite `a` ou `A` et chaque chiffre `9`, donc `AB-1234` devient `AA-9999` - jamais une valeur. Le texte libre, les champs de moins de 5 valeurs, les petits nombres entiers et les champs nommés comme un identifiant, une date ou un statut ne sont pas soumis.

Chaque type que nomme OneUptime AI est une détection de confiance Faible, marquée **Suggéré par OneUptime AI**, avec sa raison, rédigée dans la langue de votre projet et affichée sur toute la largeur de la ligne de la détection. Comme toute détection de confiance Faible, elle ne compte pour rien tant qu'une personne ne choisit pas **Confirmer** sur la page **Contenu** du magasin de données ; **Marquer comme non sensible** la refuse. Un champ qui a reçu une réponse n'est pas soumis de nouveau pendant 30 jours, et un champ qu'une personne a jugé ne l'est plus jamais.

## Sensibilité

| Sensibilité | Ce que cela signifie |
| --- | --- |
| **Restreint** | Une fuite cause un préjudice : secrets, numéros de carte, dossiers médicaux, identifiants officiels. |
| **Confidentiel** | Les données personnelles, et les documents marqués confidentiels. |
| **Interne** | Les données propres à l'entreprise, non destinées à l'extérieur. |
| **Public** | Rien de sensible n'a été trouvé. |

Un magasin de données est aussi sensible que le type de données le plus sensible qui y a été trouvé avec une confiance d'au moins Moyen. Les valeurs de test et les détections marquées comme non sensibles ne comptent pour rien, et un magasin de données où rien n'a été trouvé est Public. Pour traiter un magasin de données comme plus ou moins sensible que ne le disent ses détections, réglez vous-même sa sensibilité dans les **Paramètres** du magasin de données : les contrôles utilisent alors celle-ci.

## Catégories

| Catégorie | Ce qu'elle couvre | Données personnelles |
| --- | --- | --- |
| Secrets et identifiants de connexion | Mots de passe, clés API, jetons et clés privées qui ouvrent d'autres systèmes. | Non |
| Financier | Numéros de carte, comptes bancaires, IBAN et portefeuilles crypto. | Oui |
| Santé | Numéros de dossier médical, identifiants de santé, diagnostics et prescriptions. | Oui |
| Identifiant officiel | Numéros d'identité nationale, fiscaux, de passeport et de sécurité sociale. | Oui |
| Catégorie particulière | Ce que l'article 9 du RGPD protège le plus : origine ethnique, religion, orientation sexuelle, opinions politiques, appartenance syndicale, données biométriques et génétiques. | Oui |
| Contact et identité | Qui est quelqu'un et comment le joindre : e-mail, téléphone, adresse, date de naissance, adresse IP. | Oui |
| Confidentiel d'entreprise | Documents marqués confidentiels, à usage interne uniquement ou couverts par le secret professionnel. | Non |

Les données personnelles sont des données sur une personne, au sens du RGPD, du CCPA, de la LGPD et du DPDP. Un magasin de données qui ne contient que des secrets et des documents d'entreprise sort du périmètre d'un référentiel de protection de la vie privée, jamais de celui d'un référentiel de sécurité (voir [Conformité de Sécurité des données](/docs/data-security/compliance)).

## Types de données intégrés

Un type de données qui appartient à un pays nomme ce pays, sous forme de code ISO 3166-1 : les règles de résidence et les référentiels liés à un pays le lisent (voir [Résidence](/docs/data-security/flows-access-residency#règles-de-résidence)). L'ID est le nom par lequel l'API et les détections désignent le type.

### Contact et identité

| Type de données | ID | Ce que c'est | Sensibilité | Pays |
| --- | --- | --- | --- | --- |
| Adresse e-mail | `email-address` | L'adresse e-mail d'une personne. | Confidentiel | — |
| Numéro de téléphone | `phone-number` | Un numéro de téléphone au format international ou national. | Confidentiel | — |
| Nom de personne | `person-name` | Le prénom, le nom de famille ou le nom complet d'une personne, trouvé d'après le nom du champ. | Confidentiel | — |
| Adresse postale | `postal-address` | Une adresse postale : un numéro, un nom de rue et un type de voie. | Confidentiel | — |
| Code postal | `postal-code` | Un code postal. À lui seul, il restreint le lieu où vit quelqu'un. | Interne | — |
| Date de naissance | `date-of-birth` | Une date à côté de mots qui disent qu'il s'agit de la date de naissance de quelqu'un. | Confidentiel | — |
| Adresse IP | `ip-address` | Une adresse IPv4 ou IPv6 publique, que le RGPD traite comme une donnée personnelle. | Confidentiel | — |
| Adresse MAC | `mac-address` | L'adresse matérielle d'une carte réseau, qui identifie un appareil. | Confidentiel | — |
| ID publicitaire | `advertising-id` | Un identifiant publicitaire mobile (IDFA, GAID, AAID) qui suit un appareil. | Confidentiel | — |
| Localisation précise | `geolocation` | Une latitude et une longitude assez précises pour trouver un bâtiment. | Confidentiel | — |
| Nom d'utilisateur | `username` | Le nom de connexion ou de compte d'une personne, trouvé d'après le nom du champ. | Confidentiel | — |
| Genre | `gender` | Le genre ou le sexe d'une personne, trouvé d'après le nom du champ. | Confidentiel | — |
| Nationalité | `nationality` | La nationalité ou la citoyenneté d'une personne, trouvée d'après le nom du champ. | Confidentiel | — |
| Numéro d'identification du véhicule | `vehicle-identification-number` | Un VIN de 17 caractères avec un chiffre de contrôle valide. | Confidentiel | — |

### Identifiant officiel

| Type de données | ID | Ce que c'est | Sensibilité | Pays |
| --- | --- | --- | --- | --- |
| Numéro de sécurité sociale américain | `us-ssn` | Un numéro de sécurité sociale américain. | Restreint | US |
| Numéro de contribuable américain (ITIN) | `us-itin` | Un Individual Taxpayer Identification Number américain. | Restreint | US |
| Numéro d'employeur américain (EIN) | `us-ein` | Un Employer Identification Number américain, à côté de mots qui l'indiquent. | Confidentiel | US |
| Numéro de passeport américain | `us-passport` | Un numéro de passeport américain, à côté de mots qui l'indiquent. | Restreint | US |
| Numéro de permis de conduire américain | `us-drivers-license` | Un numéro de permis de conduire américain, à côté de mots qui l'indiquent. | Restreint | US |
| Numéro National Insurance britannique | `uk-nino` | Un numéro National Insurance britannique. | Restreint | GB |
| Numéro de passeport britannique | `uk-passport` | Un numéro de passeport britannique, à côté de mots qui l'indiquent. | Restreint | GB |
| Numéro de permis de conduire britannique | `uk-driving-licence` | Un numéro de permis de conduire britannique de 16 caractères. | Restreint | GB |
| Numéro d'assurance sociale canadien | `ca-sin` | Un numéro d'assurance sociale canadien avec un chiffre de contrôle valide. | Restreint | CA |
| CURP mexicain | `mx-curp` | Une Clave Única de Registro de Población mexicaine. | Restreint | MX |
| RFC mexicain | `mx-rfc` | Un identifiant fiscal Registro Federal de Contribuyentes mexicain. | Restreint | MX |
| CPF brésilien | `br-cpf` | Un numéro Cadastro de Pessoas Físicas brésilien. | Restreint | BR |
| CNPJ brésilien | `br-cnpj` | Un numéro d'immatriculation d'entreprise brésilien (CNPJ). | Confidentiel | BR |
| CUIT / CUIL argentin | `ar-cuit` | Un code d'identification fiscale ou professionnelle argentin. | Restreint | AR |
| RUT chilien | `cl-rut` | Un Rol Único Tributario chilien avec un chiffre de contrôle valide. | Restreint | CL |
| DNI espagnol | `es-dni` | Un numéro de document national d'identité espagnol avec sa lettre de contrôle. | Restreint | ES |
| NIE espagnol | `es-nie` | Un numéro d'identité d'étranger espagnol avec sa lettre de contrôle. | Restreint | ES |
| NIF portugais | `pt-nif` | Un numéro d'identification fiscale portugais. | Restreint | PT |
| Numéro de sécurité sociale français (NIR) | `fr-nir` | Un numéro INSEE français avec sa clé à deux chiffres. | Restreint | FR |
| Identifiant fiscal allemand | `de-tax-id` | Une Steuerliche Identifikationsnummer allemande. | Restreint | DE |
| Codice fiscale italien | `it-codice-fiscale` | Un code fiscal italien avec un caractère de contrôle valide. | Restreint | IT |
| BSN néerlandais | `nl-bsn` | Un numéro de service au citoyen néerlandais qui passe le test des onze. | Restreint | NL |
| Numéro national belge | `be-national-number` | Un numéro de registre national belge. | Restreint | BE |
| PESEL polonais | `pl-pesel` | Un numéro d'identification national polonais. | Restreint | PL |
| Numéro d'identité personnel suédois | `se-personnummer` | Un personnummer suédois avec un chiffre de contrôle valide. | Restreint | SE |
| Numéro d'identité national norvégien | `no-fodselsnummer` | Un fødselsnummer norvégien avec ses deux chiffres de contrôle. | Restreint | NO |
| Numéro CPR danois | `dk-cpr` | Un numéro d'état civil danois, à côté de mots qui l'indiquent. | Restreint | DK |
| Code d'identité personnel finlandais | `fi-hetu` | Un henkilötunnus finlandais avec son caractère de contrôle. | Restreint | FI |
| Numéro PPS irlandais | `ie-ppsn` | Un Personal Public Service Number irlandais. | Restreint | IE |
| Numéro AVS suisse | `ch-ahv` | Un numéro de sécurité sociale suisse (AHV / AVS). | Restreint | CH |
| CNP roumain | `ro-cnp` | Un code numérique personnel roumain. | Restreint | RO |
| EGN bulgare | `bg-egn` | Un numéro civil unifié bulgare. | Restreint | BG |
| OIB croate | `hr-oib` | Un numéro d'identification personnel croate. | Restreint | HR |
| AMKA grec | `gr-amka` | Un numéro de sécurité sociale grec. | Restreint | GR |
| Numéro d'identité turc | `tr-tckn` | Un numéro T.C. Kimlik turc. | Restreint | TR |
| Numéro d'identité israélien | `il-teudat-zehut` | Un numéro Teudat Zehut israélien. | Restreint | IL |
| Numéro d'identité sud-africain | `za-id` | Un numéro d'identité sud-africain avec une date et un chiffre de contrôle valides. | Restreint | ZA |
| Emirates ID des Émirats arabes unis | `ae-emirates-id` | Un numéro de carte d'identité des Émirats arabes unis. | Restreint | AE |
| Identifiant national saoudien | `sa-national-id` | Un numéro d'identité nationale ou d'iqama saoudien. | Restreint | SA |
| Numéro Aadhaar indien | `in-aadhaar` | Un numéro Aadhaar à 12 chiffres qui passe le contrôle de Verhoeff. | Restreint | IN |
| PAN indien | `in-pan` | Un Permanent Account Number indien. | Restreint | IN |
| Numéro d'identité de résident chinois | `cn-resident-id` | Un numéro de carte d'identité de résident chinois de 18 caractères. | Restreint | CN |
| My Number japonais | `jp-my-number` | Un numéro individuel japonais avec un chiffre de contrôle valide. | Restreint | JP |
| Numéro d'enregistrement de résident sud-coréen | `kr-rrn` | Un numéro d'enregistrement de résident coréen. | Restreint | KR |
| NRIC / FIN singapourien | `sg-nric` | Un numéro de carte d'identité ou d'identification d'étranger de Singapour. | Restreint | SG |
| Numéro de carte d'identité de Hong Kong | `hk-hkid` | Un numéro de carte d'identité de Hong Kong avec son chiffre de contrôle. | Restreint | HK |
| Identifiant national taïwanais | `tw-national-id` | Un numéro d'identification national taïwanais. | Restreint | TW |
| Identifiant national thaïlandais | `th-national-id` | Un numéro d'identification de citoyen thaïlandais. | Restreint | TH |
| Numéro MyKad malaisien | `my-mykad` | Un numéro de carte d'identité malaisien. | Restreint | MY |
| NIK indonésien | `id-nik` | Un numéro d'identité de population indonésien. | Restreint | ID |
| Numéro de dossier fiscal australien | `au-tfn` | Un tax file number australien avec un contrôle valide. | Restreint | AU |
| Numéro IRD néo-zélandais | `nz-ird` | Un numéro Inland Revenue néo-zélandais avec un chiffre de contrôle valide. | Restreint | NZ |
| SNILS russe | `ru-snils` | Un numéro de compte d'assurance russe avec son numéro de contrôle. | Restreint | RU |
| INN russe | `ru-inn` | Un numéro d'identification de contribuable russe. | Restreint | RU |
| Numéro de passeport | `passport-number` | Un numéro de passeport de n'importe quel pays, à côté de mots qui l'indiquent. | Restreint | — |

### Financier

| Type de données | ID | Ce que c'est | Sensibilité | Pays |
| --- | --- | --- | --- | --- |
| Numéro de carte | `credit-card-number` | Un numéro de carte de paiement qui passe le contrôle de Luhn et appartient à une marque de carte. | Restreint | — |
| Code de sécurité de carte | `card-verification-code` | Un CVV ou CVC, que PCI DSS interdit de conserver après l'autorisation d'un paiement. | Restreint | — |
| Date d'expiration de carte | `card-expiration-date` | La date d'expiration d'une carte, à côté de mots qui l'indiquent. | Confidentiel | — |
| IBAN | `iban` | Un numéro de compte bancaire international qui passe le contrôle mod-97. | Restreint | — |
| Numéro de compte bancaire | `bank-account-number` | Un numéro de compte bancaire, à côté de mots qui l'indiquent. | Restreint | — |
| Code SWIFT / BIC | `swift-bic` | Le code SWIFT ou BIC d'une banque, à côté de mots qui l'indiquent. | Interne | — |
| Numéro de routage bancaire américain | `us-bank-routing-number` | Un numéro de routage ABA avec une somme de contrôle valide, à côté de mots qui l'indiquent. | Interne | US |
| Sort code britannique | `uk-sort-code` | Un sort code bancaire britannique, à côté de mots qui l'indiquent. | Interne | GB |
| IFSC indien | `in-ifsc` | Un Indian Financial System Code qui désigne une agence bancaire. | Interne | IN |
| BSB australien | `au-bsb` | Un numéro bank-state-branch australien, à côté de mots qui l'indiquent. | Interne | AU |
| Adresse Bitcoin | `bitcoin-address` | Une adresse Bitcoin avec une somme de contrôle valide. | Confidentiel | — |
| Adresse Ethereum | `ethereum-address` | Une adresse Ethereum, à côté de mots qui l'indiquent. | Confidentiel | — |

### Santé

| Type de données | ID | Ce que c'est | Sensibilité | Pays |
| --- | --- | --- | --- | --- |
| Numéro NHS britannique | `uk-nhs-number` | Un numéro du National Health Service britannique avec un chiffre de contrôle valide. | Restreint | GB |
| Identifiant de bénéficiaire Medicare américain | `us-medicare-mbi` | Un Medicare Beneficiary Identifier américain. | Restreint | US |
| Numéro Medicare australien | `au-medicare-number` | Un numéro de carte Medicare australien avec un chiffre de contrôle valide. | Restreint | AU |
| Numéro d'assurance maladie allemand | `de-health-insurance-number` | Une Krankenversichertennummer allemande avec un chiffre de contrôle valide. | Restreint | DE |
| Numéro de dossier médical | `medical-record-number` | Le numéro de dossier médical d'un patient, à côté de mots qui l'indiquent. | Restreint | — |
| Identifiant d'adhérent à une assurance santé | `health-plan-id` | Un numéro d'adhérent ou de police d'assurance santé, à côté de mots qui l'indiquent. | Restreint | — |
| Code de diagnostic (ICD-10) | `diagnosis-code` | Un code de diagnostic ICD-10, à côté de mots qui l'indiquent. | Restreint | — |
| Code de médicament (NDC) | `drug-code` | Un National Drug Code américain, à côté de mots qui l'indiquent. | Confidentiel | — |
| Numéro DEA américain | `us-dea-number` | Le numéro Drug Enforcement Administration d'un prescripteur, avec un chiffre de contrôle valide. | Confidentiel | US |
| Identifiant de prestataire américain (NPI) | `us-npi` | Un National Provider Identifier. Il désigne un prestataire de soins, pas un patient. | Interne | US |
| Informations de santé | `health-information` | Diagnostics, pathologies, médicaments et autres détails de santé, trouvés d'après le nom du champ. | Restreint | — |

### Secrets et identifiants de connexion

| Type de données | ID | Ce que c'est | Sensibilité | Pays |
| --- | --- | --- | --- | --- |
| ID de clé d'accès AWS | `aws-access-key-id` | La moitié publique d'une clé d'accès AWS. Avec son secret, elle signe des requêtes AWS. | Restreint | — |
| Clé d'accès secrète AWS | `aws-secret-access-key` | La moitié secrète d'une clé d'accès AWS, à côté de mots qui l'indiquent. | Restreint | — |
| Clé API Google | `google-api-key` | Une clé API Google Cloud ou Maps. | Restreint | — |
| Clé de compte de service Google | `google-service-account-key` | Un fichier de clé de compte de service Google Cloud avec sa clé privée. | Restreint | — |
| Secret client OAuth Google | `google-oauth-client-secret` | Un secret client OAuth Google. | Restreint | — |
| Clé de compte de stockage Azure | `azure-storage-account-key` | Une clé de compte de stockage Azure ou une chaîne de connexion qui en contient une. | Restreint | — |
| Jeton SAS Azure | `azure-sas-token` | Une signature d'accès partagé Azure, qui accorde l'accès sans connexion. | Restreint | — |
| Secret client Azure | `azure-client-secret` | Un secret client d'application Microsoft Entra ID. | Restreint | — |
| Jeton GitHub | `github-token` | Un jeton GitHub d'accès personnel, OAuth, d'application ou à granularité fine. | Restreint | — |
| Jeton GitLab | `gitlab-token` | Un jeton d'accès personnel GitLab. | Restreint | — |
| Jeton Slack | `slack-token` | Un jeton Slack de bot, d'utilisateur ou d'application. | Restreint | — |
| URL de webhook Slack | `slack-webhook-url` | Un webhook entrant Slack, qui permet à n'importe qui de publier dans un canal. | Restreint | — |
| Clé secrète Stripe | `stripe-secret-key` | Une clé secrète ou restreinte Stripe en mode live, qui peut déplacer de l'argent. | Restreint | — |
| Clé API Twilio | `twilio-api-key` | Un SID de clé API Twilio avec son secret. | Restreint | — |
| Clé API SendGrid | `sendgrid-api-key` | Une clé API SendGrid. | Restreint | — |
| Clé API Mailgun | `mailgun-api-key` | Une clé API Mailgun. | Restreint | — |
| Clé API Mailchimp | `mailchimp-api-key` | Une clé API Mailchimp. | Restreint | — |
| Clé API OpenAI | `openai-api-key` | Une clé API OpenAI, qui dépense le crédit du compte. | Restreint | — |
| Clé API Anthropic | `anthropic-api-key` | Une clé API Anthropic. | Restreint | — |
| Jeton Hugging Face | `huggingface-token` | Un jeton Hugging Face. | Restreint | — |
| Jeton npm | `npm-token` | Un jeton d'accès npm, qui peut publier des paquets. | Restreint | — |
| Jeton PyPI | `pypi-token` | Un jeton d'envoi PyPI. | Restreint | — |
| Jeton Docker Hub | `docker-hub-token` | Un jeton d'accès personnel Docker Hub. | Restreint | — |
| Jeton Shopify | `shopify-token` | Un jeton d'accès ou d'application Shopify. | Restreint | — |
| Jeton Square | `square-token` | Un jeton d'accès ou un secret Square. | Restreint | — |
| Jeton d'accès Braintree | `braintree-access-token` | Un jeton d'accès de production Braintree. | Restreint | — |
| Jeton DigitalOcean | `digitalocean-token` | Un jeton d'accès personnel DigitalOcean. | Restreint | — |
| Clé API New Relic | `new-relic-api-key` | Une clé API utilisateur New Relic. | Restreint | — |
| Clé API Datadog | `datadog-api-key` | Une clé d'API ou d'application Datadog, à côté de mots qui l'indiquent. | Restreint | — |
| Jeton HashiCorp Vault | `vault-token` | Un jeton de service HashiCorp Vault. | Restreint | — |
| Jeton Terraform Cloud | `terraform-cloud-token` | Un jeton API Terraform Cloud ou Enterprise. | Restreint | — |
| Jeton API Atlassian | `atlassian-api-token` | Un jeton API Atlassian. | Restreint | — |
| Clé API Linear | `linear-api-key` | Une clé API Linear. | Restreint | — |
| JSON Web Token | `json-web-token` | Un JWT signé, souvent un jeton de session ou d'accès. | Restreint | — |
| Clé privée | `private-key` | Un bloc de clé privée PEM, OpenSSH ou PGP. | Restreint | — |
| Mot de passe dans une URL | `password-in-url` | Une URL qui porte un nom d'utilisateur et un mot de passe, comme une chaîne de connexion à une base de données. | Restreint | — |
| Mot de passe dans une chaîne de connexion | `connection-string-password` | Une valeur Password= ou Pwd= dans une chaîne de connexion. | Restreint | — |
| En-tête Authorization | `authorization-header` | Un identifiant Basic ou Bearer copié d'un en-tête HTTP Authorization. | Restreint | — |
| Mot de passe ou secret | `generic-secret` | Une valeur affectée à un mot de passe, un secret, une clé API ou un jeton, qui semble assez aléatoire pour être réelle. | Restreint | — |
| Clé privée Bitcoin | `bitcoin-private-key` | Une clé privée Bitcoin au format d'import de portefeuille, avec une somme de contrôle valide. | Restreint | — |

### Catégorie particulière

| Type de données | ID | Ce que c'est | Sensibilité | Pays |
| --- | --- | --- | --- | --- |
| Origine raciale ou ethnique | `racial-or-ethnic-origin` | La race ou l'origine ethnique, trouvée d'après le nom du champ. | Restreint | — |
| Croyance religieuse | `religious-belief` | La religion ou les convictions, trouvées d'après le nom du champ. | Restreint | — |
| Orientation sexuelle | `sexual-orientation` | L'orientation sexuelle, trouvée d'après le nom du champ. | Restreint | — |
| Opinion politique | `political-opinion` | Les opinions politiques ou l'appartenance à un parti, trouvées d'après le nom du champ. | Restreint | — |
| Appartenance syndicale | `trade-union-membership` | L'appartenance syndicale, trouvée d'après le nom du champ. | Restreint | — |
| Données biométriques | `biometric-data` | Empreintes digitales, modèles faciaux, empreintes vocales et autres données biométriques, trouvés d'après le nom du champ. | Restreint | — |
| Données génétiques | `genetic-data` | Données ADN et génomiques, trouvées d'après le nom du champ. | Restreint | — |
| Casier judiciaire | `criminal-record` | Condamnations pénales et infractions (article 10 du RGPD), trouvées d'après le nom du champ. | Restreint | — |

### Confidentiel d'entreprise

| Type de données | ID | Ce que c'est | Sensibilité | Pays |
| --- | --- | --- | --- | --- |
| Document protégé par le secret professionnel | `privileged-document` | Un document marqué comme couvert par le secret avocat-client ou le secret professionnel. | Restreint | — |
| Document marqué confidentiel | `confidential-document` | Un document marqué confidentiel, strictement confidentiel ou secret d'affaires. | Confidentiel | — |
| Document marqué interne | `internal-document` | Un document marqué à usage interne uniquement ou à ne pas diffuser. | Interne | — |

## Vos propres types de données

Ajoutez un type de données pour ce que seule votre entreprise possède : un identifiant d'employé, un numéro de police, un code de projet. Allez dans **Sécurité des données → Paramètres → Types de données** et ajoutez-le sous **Vos types de données**. Il est recherché exactement comme les types intégrés, dans les buckets, les bases de données et la télémétrie, dès la prochaine analyse.

:::steps
### Dire ce que c'est

Donnez-lui un **Nom**, comme Identifiant d'employé, une **Catégorie** et une **Sensibilité** : la sensibilité d'un magasin de données qui le contient. Une **Description** dit ce qu'il est, pour quiconque lit une détection de ce type.

### Dire comment il est trouvé

Saisissez un **Motif** : une expression régulière JavaScript pour une valeur, comme `EMP-\d{6}`. Ajoutez les **Noms de champs** qui le contiennent, comme `employee id`, et les **Mots-clés** qui, près d'une valeur, confirment qu'elle est de ce type. Laissez le motif vide pour trouver le type d'après les seuls noms de champs.

### Le tester

Collez un texte d'exemple dans **Tester** pour voir ce que votre type de données y trouve. La zone exécute le code même du scanner sur le texte, dans votre navigateur : le texte n'est jamais envoyé à OneUptime, et seuls ses 64 premiers Ko sont testés.
:::

Sous **Plus de champs**, **Ignorer la casse** fait correspondre le motif quelle que soit la casse de ses lettres, **Nécessite un mot-clé** ne compte une valeur que lorsqu'un mot-clé est proche ou que le nom du champ dit qu'elle est de ce type, et **Somme de contrôle** demande à une valeur de passer un contrôle : **Aucun**, **Luhn** (le chiffre de contrôle que portent les numéros de carte), **Mod97** (les chiffres de contrôle d'un IBAN) ou **Verhoeff** (le chiffre de contrôle d'un numéro Aadhaar).

Un motif est vérifié à l'enregistrement : il doit compiler, ne correspondre à aucun texte vide et s'exécuter en un temps proportionnel au texte. Il est exécuté par un moteur qui ne fait jamais de retour arrière, donc aucun motif ne peut bloquer une analyse, quelle que soit la façon dont il est écrit. Un type accepte au plus 50 mots-clés et 50 noms de champs.

Une valeur de votre type a une confiance Moyen seule et Élevé avec un mot-clé proche quand elle passe une somme de contrôle, et Faible seule et Moyen avec un mot-clé quand il n'y en a pas. Dans une colonne, c'est la part des valeurs qui correspondent qui décide, comme pour chaque type.

## Non sensible, et jamais sensible

Une analyse peut trouver quelque chose qui n'est pas ce qu'il paraît : une colonne de numéros de commande qui passent le contrôle de Luhn, votre propre adresse de support dans chaque ligne de journal. Dites-le à OneUptime, et il cesse de compter :

- **Marquez la détection comme non sensible.** Sur la page **Contenu** du magasin de données, choisissez **Marquer comme non sensible** sur la détection et dites pourquoi. Elle ne compte plus pour la sensibilité du magasin de données ni pour ses contrôles, et le magasin de données est aussitôt contrôlé à nouveau. La détection reste sur le magasin de données, marquée, avec votre motif, pour que la personne suivante voie ce qui a été décidé.
- **Ajoutez la valeur à Jamais sensible**, dans les paramètres de Sécurité des données, pour une valeur qui n'est jamais une détection, nulle part, comme `support@yourcompany.com`. Les valeurs sont comparées après que le scanner les a normalisées, sans tenir compte de la casse.
- **Désactivez un type de données intégré.** Sous **Types de données intégrés**, sur **Sécurité des données → Paramètres → Types de données**, chaque type de données a un interrupteur, qui s'enregistre dès qu'il est basculé. Aucune analyse du projet ne recherche un type désactivé.

## Les verdicts d'OneUptime AI

Avec **Activer l'IA** activé pour le projet et **Travailler sur les nouveaux problèmes** activé sous **Sécurité des données → IA**, OneUptime AI donne son verdict sur chaque détection qui attend la décision d'une personne, après chaque analyse de son magasin de données. Une détection attend quand l'analyse n'en était pas sûre - une détection de confiance Faible, ou l'une des suggestions d'OneUptime AI - ou quand une détection de confiance Moyen ou Élevé montre un signe de fausse correspondance :

- la plupart des correspondances étaient des valeurs de test connues ;
- le nom du champ désigne un autre type de données, et pas celui-ci ;
- un champ d'identifiant, comme `order_number`, `invoice_no` ou `ref_id`, contient un type vérifié par l'algorithme de Luhn, que passe une suite de chiffres quelconque sur dix, et son nom ne désigne pas ce type.

Le verdict est **Confirmer**, **Non sensible** ou **Impossible à dire**, avec une raison dans la langue de votre projet. Il est affiché sur toute la largeur de la ligne de la détection, sur la page **Contenu** du magasin de données et sur la page **Dans votre télémétrie**, avec les décisions de votre équipe sur lesquelles il repose, comme « Votre équipe a marqué `order_number` comme non sensible dans 4 magasins de données ». **Afficher les décisions** liste chacune d'elles : son magasin de données, son champ et le motif donné par votre équipe.

### Les décisions de votre équipe comme précédents

On indique à OneUptime AI les décisions antérieures de votre équipe sur des détections du même type de données, dix au plus. D'abord viennent celles d'un champ du même nom, sur n'importe quel magasin de données : `order_number`, `orderNumber` et `public.orders.order_number` donnent tous « order number ». Le même emplacement vient en premier, puis la décision la plus récente. Viennent ensuite les champs dont les noms, ou les motifs donnés pour eux, disent la même chose, comme `order_ref` avec le motif « Shopify order numbers ». On lui indique où se trouvait chaque détection, ce qui a été décidé et le motif donné, sans aucune valeur citée dans un motif. On ne lui donne jamais une valeur, un échantillon masqué ou un enregistrement.

Une détection dans du texte libre, comme un corps de log ou un message, n'a pas de nom de champ par lequel la rapprocher. Son précédent est le même emplacement sur un autre magasin de données, comme le corps de log d'un autre service.

### Ce qu'OneUptime AI décide de lui-même

- **Il ne marque jamais une détection comme non sensible**, quoi que dise une règle. C'est une personne qui le fait, avec son propre motif. Quand le verdict est **Non sensible**, **Marquer comme non sensible** part du motif rédigé par OneUptime AI, que vous pouvez modifier.
- **Il ne confirme une détection de lui-même que là où une règle IA le prévoit** : une règle IA de Sécurité des données où **Juger** est sur **Automatiquement**, pour le magasin de données et le type de données. Il lui faut aussi la confirmation par votre équipe d'une détection semblable, ou un champ nommé d'après le type. La confirmation figure dans la **Chronologie** du magasin de données et sous **Fait par l'IA** dans **Sécurité des données → IA**, et **Annuler** la retire.

Sinon, le verdict attend sur la ligne de la détection. Là où le projet a des règles IA, une détection ne reçoit un verdict que si une règle pour son magasin de données et son type de données a **Juger** activé ; une règle limitée à certains contrôles ou à certaines gravités porte sur les problèmes, et ne juge aucune détection. OneUptime AI juge au plus 40 des détections d'un magasin de données après une analyse, d'abord celles qu'il n'a jamais jugées, et le reste après l'analyse suivante. Après une analyse ultérieure, une détection n'est soumise à nouveau que si ce sur quoi repose son verdict a changé, comme une nouvelle décision sur une détection semblable.

## Détections similaires

Après que vous avez confirmé une détection ou l'avez marquée comme non sensible, **Appliquer aux détections similaires** liste les détections semblables que personne n'a encore tranchées : le même type de données, dans un champ du même nom, dans ce magasin de données et dans tout autre magasin que vous pouvez lire. Chacune est cochée. Décochez celles que vous voulez juger à part, et les autres reçoivent la même décision, avec votre motif, comme votre propre modification ; une détection que vous ne pouvez pas modifier est laissée telle quelle. **Pas maintenant** les laisse toutes telles qu'elles sont. Une détection dans du texte libre n'a jamais de détections similaires : ce que contient un texte ne dit rien d'un autre.

## Ce que vos décisions disent des analyses

Quand votre équipe marque des détections comme non sensibles, OneUptime AI propose des modifications des analyses sous **En attente de votre part** dans **Sécurité des données → IA** :

- **Désactiver un type de données intégré** quand chacune de ses détections a été marquée comme non sensible : au moins 3 détections, dans au moins 2 magasins de données. Une détection qu'OneUptime AI n'a fait que suggérer ne compte pas.
- **Exclure un emplacement des analyses d'un magasin de données** quand chaque détection qui s'y trouve a été marquée comme non sensible, au moins 2 d'entre elles. C'est proposé pour une colonne de base de données ou un attribut de télémétrie, qu'une analyse peut exclure individuellement.

Chaque proposition attend toujours qu'une personne l'approuve : une analyse qui cesse de chercher manque les vraies données qui arrivent plus tard. **Jamais sensible** n'est jamais proposé, car il contient des valeurs, et OneUptime AI n'en voit jamais.

## Prochaines étapes

:::cards
- [Contrôles et problèmes de Sécurité des données](/docs/data-security/checks-and-issues): Ce que la sensibilité d'un magasin de données change à ses problèmes.
- [Données sensibles dans la télémétrie](/docs/data-security/telemetry): Les types de données trouvés dans vos journaux, traces et prompts.
- [Conformité de Sécurité des données](/docs/data-security/compliance): Les référentiels que chaque type de données fait entrer dans le périmètre.
:::
