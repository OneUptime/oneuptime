# Riferimento autorizzazioni

Tutte le autorizzazioni che OneUptime può concedere, raggruppate esattamente come le raggruppa il selettore di autorizzazioni della dashboard.

Questa pagina è generata dal codice sorgente di OneUptime al momento della richiesta, dalla stessa lista usata dalla dashboard, dall'API e dal provider Terraform. Non può divergere dal prodotto e riflette la versione che state eseguendo.

Se cercate come si incastrano i pezzi — team, ambiti, proprietari, blocchi — partite da [Utenti, team e autorizzazioni](/docs/permissions/index).

La colonna **Chiave autorizzazione** contiene il valore da usare con l'[API](/docs/api-reference/api-reference), la [CLI](/docs/cli/index) e il [provider Terraform](/docs/terraform/index). I titoli sono quelli che vedete nella dashboard.

## Ruoli

{{PERMISSION_ROLE_COUNT}} ruoli, ciascuno raggruppa un'area del prodotto al livello Admin, Member o Viewer. Sono quelli che il selettore **Ruolo** propone quando aggiungete un'autorizzazione a un team.

La colonna **Ambito** indica se il ruolo può essere ristretto al momento della concessione. `Tutte, Possedute o Etichette` significa che potete scegliere; `Solo a livello di progetto` significa che il ruolo vale sempre per l'intero progetto.

{{PERMISSION_ROLE_TABLES}}

## Autorizzazioni granulari

{{PERMISSION_TOTAL_COUNT}} capacità individuali distribuite in {{PERMISSION_GROUP_COUNT}} gruppi. Sono quelle che il selettore **Granulare** propone e quelle che assegnate alle chiavi API.

La colonna **Limitabile per etichette** indica se una concessione di questa autorizzazione può essere limitata alle risorse che portano determinate etichette.

{{PERMISSION_GRANULAR_TABLES}}
