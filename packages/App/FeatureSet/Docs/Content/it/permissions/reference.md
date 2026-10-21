# Riferimento autorizzazioni

Tutti i ruoli e le autorizzazioni che OneUptime può concedere, raggruppati come nel selettore delle autorizzazioni della dashboard. Usa questa pagina per trovare il nome o la chiave esatta da assegnare a un team, a una chiave API o a una risorsa Terraform.

Le tabelle vengono generate dal codice sorgente di OneUptime quando la pagina viene servita: è lo stesso elenco usato dalla dashboard, dall'API e dal provider Terraform. Corrispondono quindi sempre alla versione che stai eseguendo. Per capire come si combinano le autorizzazioni (team, ambiti, proprietari e blocchi), parti da [Utenti, team e autorizzazioni](/docs/permissions/index).

## Come leggere le tabelle

Ogni ruolo e ogni autorizzazione ha una riga con queste colonne:

- **Ruolo** o **Autorizzazione**: il nome mostrato dalla dashboard.
- **Chiave autorizzazione**: il valore da usare con l'[API](/docs/api-reference/api-reference), la [CLI](/docs/cli/index) e il [provider Terraform](/docs/terraform/index).
- **Ambito** (solo ruoli): `Tutte, Possedute o Etichette` significa che scegli fin dove arriva il ruolo quando lo concedi. `Solo a livello di progetto` significa che il ruolo vale sempre per l'intero progetto.
- **Limitabile per etichette** (solo autorizzazioni): `Sì` significa che una concessione di questa autorizzazione può essere limitata alle risorse con determinate etichette.
- **Descrizione**: che cosa consente il ruolo o l'autorizzazione.

> [!TIP]
> Scegli prima un ruolo. I ruoli restano corretti quando OneUptime aggiunge funzionalità, mentre un elenco di singole autorizzazioni va tenuto aggiornato a mano.

## Ruoli

{{PERMISSION_ROLE_COUNT}} ruoli. Quattro valgono per l'intero progetto: Project Owner, Project Admin, Project Member e Viewer. Ciascuno degli altri copre un'area del prodotto, come gli incidenti o i monitor, a livello Admin, Member o Viewer. Sono questi i ruoli che offre **Aggiungi ruolo** nella pagina **Autorizzazioni** di un team e nella pagina di una chiave API.

{{PERMISSION_ROLE_TABLES}}

## Autorizzazioni singole

{{PERMISSION_TOTAL_COUNT}} capacità singole suddivise in {{PERMISSION_GROUP_COUNT}} gruppi. Sono quelle che offre **Aggiungi autorizzazione**, per un team o una chiave API, quando un ruolo concede più del necessario.

{{PERMISSION_GRANULAR_TABLES}}

## Passaggi successivi

:::cards
- [Utenti, team e autorizzazioni](/docs/permissions/index): Come team, ambiti, proprietari e blocchi decidono che cosa può fare una persona.
- [Riferimento API](/docs/api-reference/api-reference): Usare le chiavi delle autorizzazioni con le chiavi API.
- [Provider Terraform](/docs/terraform/index): Gestire i team e le loro autorizzazioni come codice.
:::
