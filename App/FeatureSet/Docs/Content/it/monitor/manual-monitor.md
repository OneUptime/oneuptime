# Monitor Manuale

Il monitoraggio manuale consente di creare monitor il cui stato è gestito interamente a mano o tramite API. OneUptime non esegue controlli automatizzati — si controlla direttamente lo stato del monitor.

## Panoramica

I monitor manuali sono segnaposto che si aggiornano autonomamente. Questo è utile per:

- Integrarsi con strumenti di monitoraggio esterni che aggiornano lo stato tramite l'API di OneUptime
- Tracciare servizi o sistemi che non possono essere monitorati automaticamente
- Gestire incidenti per componenti privi di controlli automatici di salute
- Rappresentare dipendenze di terze parti il cui stato si traccia manualmente

## Creazione di un Monitor Manuale

1. Accedere a **Monitor** nel Dashboard di OneUptime
2. Fare clic su **Crea Monitor**
3. Selezionare **Manuale** come tipo di monitor
4. Inserire un nome e una descrizione per il monitor

## Come Funziona

I monitor manuali non hanno intervalli di monitoraggio, probe o valutazione automatica dei criteri. Lo stato del monitor rimane come impostato finché non viene modificato.

### Aggiornamento dello Stato

È possibile aggiornare lo stato di un monitor manuale in due modi:

- **Dashboard** — Modificare lo stato del monitor direttamente dal Dashboard di OneUptime
- **API** — Aggiornare lo stato del monitor a livello programmatico usando l'API di OneUptime

### Incidenti e Avvisi

È possibile creare incidenti e avvisi per i monitor manuali esattamente come per qualsiasi altro tipo di monitor. Questo consente di:

- Tracciare i tempi di inattività per servizi monitorati esternamente
- Creare incidenti manualmente quando vengono segnalati problemi
- Usare monitor manuali nelle pagine di stato per comunicare lo stato agli utenti

## Quando Usare i Monitor Manuali

| Caso d'Uso                 | Descrizione                                                                                           |
| -------------------------- | ----------------------------------------------------------------------------------------------------- |
| Servizi di terze parti     | Tracciare lo stato di servizi esterni da cui si dipende ma che non si possono monitorare direttamente |
| Infrastruttura fisica      | Rappresentare hardware o sistemi fisici senza monitoraggio di rete                                    |
| Processi aziendali         | Tracciare processi non tecnici che influenzano lo stato del servizio                                  |
| Stato gestito via API      | Permettere a strumenti esterni di aggiornare lo stato del monitor tramite l'API di OneUptime          |
| Segnaposto pagina di stato | Mostrare componenti nella pagina di stato gestiti al di fuori di OneUptime                            |
