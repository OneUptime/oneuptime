# Conservazione dei dati

OneUptime conserva i vostri log, tracce, metriche e profili per un certo numero di giorni, poi li elimina: 15 giorni, a meno che non lo cambiate. Questa pagina mostra come viene calcolato quel numero, come cambiarlo per l'intero progetto e come conservare parte della telemetria più o meno a lungo del resto.

:::cards
- [Per quanto tempo viene conservata la telemetria](#per-quanto-tempo-viene-conservata-la-telemetria): L'ordine in cui OneUptime legge le impostazioni.
- [Cambiare la conservazione del progetto](#cambiare-la-conservazione-del-progetto): Un solo numero per tutta la vostra telemetria.
- [Conservare parte della telemetria più o meno a lungo](#conservare-parte-della-telemetria-più-o-meno-a-lungo): Per tipo, gravità, stato o servizio.
- [Quanto costa la conservazione](#quanto-costa-la-conservazione): La fatturazione su OneUptime Cloud, il disco in self-hosting.
:::

## Per quanto tempo viene conservata la telemetria

Ogni log, span, punto di metrica e campione di profilo riceve la sua conservazione all'arrivo. OneUptime calcola per quanti giorni conservarlo, gli assegna la data di scadenza e lo elimina dopo quella data. Vince l'impostazione più specifica:

```mermaid title="Quale impostazione decide per quanto tempo si conserva un record"
flowchart TB
    arrive["Arriva un log, uno<br/>span o un punto<br/>di metrica"] --> resource{"Impostata sul suo<br/>servizio o risorsa?"}
    resource -->|"No"| byType{"Impostata sul<br/>progetto per<br/>questo tipo?"}
    byType -->|"No"| projectDefault["Predefinito del<br/>progetto: 15 giorni<br/>salvo modifiche"]
    resource -->|"Sì"| stamped["Marcato con una<br/>scadenza: arrivo<br/>più i giorni"]
    byType -->|"Sì"| stamped
    projectDefault --> stamped
    stamped --> deleted["Eliminato dopo<br/>quella data"]
```

Nel dettaglio, OneUptime legge queste impostazioni in quest'ordine, e decide la prima impostata:

| Ordine | Impostazione | Dove si imposta |
| --- | --- | --- |
| 1 | Giorni per una gravità dei log o uno stato degli span, per un servizio o una risorsa | **Conservazione per tipo di telemetria**, in **Altre impostazioni** nella sua pagina **Impostazioni** |
| 2 | Giorni per un tipo di telemetria, per un servizio o una risorsa | La stessa scheda |
| 3 | Giorni per tutto ciò che arriva da un servizio o da una risorsa | **Conservazione dei dati di telemetria**, in **Altre impostazioni** nella stessa pagina |
| 4 | Giorni per una gravità dei log o uno stato degli span, per il progetto | **Conservazione per tipo di telemetria**, in **Altre impostazioni** su **Conservazione dei dati** |
| 5 | Giorni per un tipo di telemetria, per il progetto | La stessa scheda |
| 6 | Giorni per tutto il resto | **Conservazione predefinita (giorni)**, in **Conservazione dei dati** |

- **Le impostazioni da 1 a 5 sono sostituzioni della conservazione.** Fanno parte dell'[Edizione Enterprise](/docs/self-hosted/enterprise), e del piano Scale su OneUptime Cloud. Senza di esse, ogni record viene conservato secondo il predefinito del progetto.
- **Una modifica si applica alla nuova telemetria.** Un record mantiene la data che gli è stata assegnata: una conservazione più breve non lo elimina prima, e una più lunga non lo conserva più a lungo. I nuovi record seguono una modifica entro circa cinque minuti.
- **Le eccezioni seguono ciò in cui sono state trovate.** Un'eccezione viene conservata quanto lo span o il log da cui proviene. Le Session Replay hanno una conservazione propria: vedete [Altri dati con una conservazione propria](#altri-dati-con-una-conservazione-propria).

## Prima di iniziare

- **Un ruolo che modifica il progetto.** Project Owner o Project Admin cambiano la conservazione del progetto. La conservazione di un servizio o di una risorsa richiede il ruolo che ne modifica le altre impostazioni.
- **Per le sostituzioni, l'Edizione Enterprise o il piano Scale.** Un'installazione self-hosted ha bisogno di una licenza Enterprise, e un progetto OneUptime Cloud del piano Scale o superiore. La conservazione predefinita del progetto c'è in ogni edizione e piano.

## Cambiare la conservazione del progetto

:::steps
### Aprire la conservazione dei dati

Andate in **Impostazioni del progetto → Telemetria e APM → Conservazione dei dati**. **Telemetria e APM** parte compresso nel menu laterale: fateci clic per aprirlo. La scheda **Conservazione dei dati di telemetria** mostra la **Conservazione predefinita (giorni)**.

### Impostare il numero di giorni

Fate clic su **Edit Retention Settings**, inserite il numero di giorni, almeno 1, e fate clic su **Salva modifiche**.
:::

Il nuovo numero si applica a ogni record che arriva da quel momento e che non ha una sostituzione propria.

## Conservare parte della telemetria più o meno a lungo

Le sostituzioni conservano più a lungo ciò che vi serve e meno a lungo il resto: i log di errore per un trimestre, ad esempio, e i log di debug per pochi giorni.

### Per l'intero progetto

Sotto il predefinito, chiusa in **Altre impostazioni**, la scheda **Conservazione per tipo di telemetria** imposta i giorni per ogni tipo di telemetria. Fate clic su **Edit Overrides**, compilate i campi che vi servono e lasciate vuoti gli altri:

| Tipo | Campi |
| --- | --- |
| Log | **Logs default (days)**, e un campo per ogni gravità dei log |
| Tracce | **Traces default (days)**, e un campo per ogni stato degli span: Errore, Ok e Non impostato |
| Metriche | **Metrics default (days)** |
| Profili | **Profiles default (days)** |

Un campo lasciato vuoto ricade sull'impostazione successiva nell'ordine sopra, quindi una gravità senza giorni propri conserva i suoi log secondo il predefinito dei log.

### Per un servizio o una risorsa

Aprite la pagina **Impostazioni** del servizio o della risorsa, poi **Altre impostazioni**. La sua scheda **Conservazione dei dati di telemetria** contiene **Conserva i dati di telemetria per (giorni)**, un solo numero per tutto ciò che invia, e la sua scheda **Conservazione per tipo di telemetria** ha gli stessi campi di quella del progetto. Lasciate un campo vuoto per usare le impostazioni del progetto.

Servizi, host, cluster Kubernetes, host Docker e Podman, cluster Docker Swarm, Proxmox e Ceph, storage array, vCenter, database, funzioni serverless, risorse cloud, applicazioni RUM e flotte IoT hanno tutti queste schede. Vedete il [Catalogo servizi](/docs/telemetry/services#modificare-un-servizio) per la pagina **Impostazioni** di un servizio.

### Quando il piano o la licenza non include più le sostituzioni

- **Su un'installazione self-hosted**, le sostituzioni smettono di applicarsi quando la prova Enterprise o il periodo di tolleranza finiscono senza una licenza. La nuova telemetria viene conservata secondo il predefinito del progetto, le schede diventano di sola lettura e nulla di ciò che avete impostato viene eliminato: attivate una licenza e tornano ad applicarsi. Vedete [Edizione Enterprise](/docs/self-hosted/enterprise#quando-una-licenza-scade-o-manca).
- **Su OneUptime Cloud**, una sostituzione rimasta impostata da una prova continua ad applicarsi sotto il piano Scale. La sua pagina la mostra sotto la scheda di upgrade, con un pulsante **Rimuovi sostituzione** che funziona su ogni piano. Impostare di nuovo una sostituzione richiede il piano Scale.

## Altri dati con una conservazione propria

| Dati | Conservati per | Dove cambiarla |
| --- | --- | --- |
| Session Replay | 7 giorni, salvo modifiche | La policy di registrazione dell'applicazione RUM: vedete [Gestire le applicazioni](/docs/rum/applications#conservazione-della-riproduzione-delle-sessioni). |
| Log dei monitor, una riga per controllo | 1 giorno, salvo modifiche | Su un'installazione self-hosted, **Conservazione dei log del monitor (giorni)** nell'Admin Dashboard |
| Metriche dei monitor, e le metriche che registrano gli SLO | 30 giorni, salvo modifiche | Su un'installazione self-hosted, **Conservazione delle metriche del monitor (giorni)** nell'Admin Dashboard |

## Quanto costa la conservazione

- **Su OneUptime Cloud**, la telemetria si paga per GB acquisito, e il prezzo per GB include 15 giorni di conservazione. Una conservazione più lunga costa proporzionalmente di più: 30 giorni costano il doppio per GB rispetto a 15. Una conservazione più breve costa proporzionalmente di meno, ma una conservazione inferiore a 7 giorni si paga come 7 giorni. **Impostazioni del progetto → Fatturazione e fatture → Cronologia utilizzo** mostra, giorno per giorno, quanto ha inviato ogni servizio e per quanto tempo viene conservato.
- **In self-hosting**, la telemetria vive in ClickHouse, e la conservazione moltiplica il suo disco. Vedete [Dimensionamento](/docs/installation/sizing#la-conservazione-e-il-suo-effetto-sullo-storage).

La telemetria che non vi serve non costa nulla se non viene mai salvata: i [Filtri di scarto e regole di mascheramento](/docs/telemetry/drop-filters-and-scrub-rules) la scartano all'arrivo.

## Risoluzione dei problemi

:::details Ho ridotto la conservazione, ma i dati vecchi sono ancora lì
Un record mantiene la data di scadenza che gli è stata assegnata all'arrivo. I record salvati prima della modifica vengono eliminati alle loro date, e solo i nuovi record seguono la nuova conservazione.
:::

:::details Le schede delle sostituzioni mostrano un invito all'upgrade
Le sostituzioni della conservazione richiedono l'Edizione Enterprise su un'installazione self-hosted, e il piano Scale su OneUptime Cloud. Fino ad allora, tutto viene conservato secondo il predefinito del progetto.
:::

:::details Lo spazio su disco torna un giorno dopo la scadenza dei dati
I record scaduti smettono di comparire in ricerche, grafici ed elenchi appena scadono. Sul disco, log e metriche vengono eliminati alla prima mezzanotte successiva, quindi il loro spazio torna fino a un giorno dopo.
:::

## Passaggi successivi

:::cards
- [Chiavi di acquisizione](/docs/telemetry/ingestion-keys): Inviate telemetria al vostro progetto.
- [Filtri di scarto e regole di mascheramento](/docs/telemetry/drop-filters-and-scrub-rules): Conservate solo la telemetria che vi serve.
- [Catalogo servizi](/docs/telemetry/services): Impostate la conservazione propria di un servizio.
- [Edizione Enterprise](/docs/self-hosted/enterprise): Che cosa portano le sostituzioni della conservazione.
:::
