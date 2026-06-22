# Monitor DNSSEC

Il monitoraggio DNSSEC ti consente di validare l'integrità crittografica delle risposte DNS per le tue zone. OneUptime esegue periodicamente una validazione DNSSEC completa: controlla i record DNSKEY, la delegazione DS nella zona padre, la validità delle firme RRSIG, il consenso dei resolver sul flag AD e la coerenza tra i nameserver autoritativi.

## Panoramica

I monitor DNSSEC validano l'intera catena di fiducia dalla zona radice fino al tuo dominio. Questo ti consente di:

- Rilevare catene DNSSEC interrotte prima che i resolver inizino a restituire SERVFAIL ai tuoi utenti
- Ricevere avvisi prima della scadenza delle chiavi di firma di zona
- Verificare che i tuoi record DS siano pubblicati correttamente nella zona padre
- Rilevare divergenze tra i nameserver autoritativi (primario/secondario non sincronizzati)
- Confermare che i resolver validatori impostino effettivamente il flag AD per la tua zona

## Creazione di un Monitor DNSSEC

1. Vai su **Monitor** nella Dashboard di OneUptime
2. Clicca su **Crea Monitor**
3. Seleziona **DNSSEC** come tipo di monitor
4. Inserisci la zona (dominio) che vuoi validare
5. Configura i resolver e i criteri di monitoraggio secondo necessità

## Opzioni di Configurazione

### Impostazioni di Base

| Campo                        | Descrizione                                                                                                       | Obbligatorio |
| ---------------------------- | ----------------------------------------------------------------------------------------------------------------- | ------------ |
| Zona (Nome Dominio)          | La zona da validare tramite DNSSEC (es. `example.com`)                                                            | Sì           |
| Resolver                     | Elenco separato da virgole di resolver validatori da interrogare (es. `1.1.1.1, 8.8.8.8, 9.9.9.9`)                | Sì           |
| Verifica Coerenza Nameserver | Interroga direttamente ciascun nameserver autoritativo e verifica che restituiscano lo stesso numero di serie SOA | No           |

### Impostazioni Avanzate

| Campo                          | Descrizione                                        | Predefinito |
| ------------------------------ | -------------------------------------------------- | ----------- |
| Avviso Scadenza Firma (giorni) | Soglia predefinita per il filtro di scadenza RRSIG | 7           |
| Timeout (ms)                   | Tempo di attesa per ogni query DNS                 | 10000       |
| Tentativi                      | Numero di tentativi in caso di fallimento          | 3           |

## Criteri di Monitoraggio

Puoi configurare criteri per determinare quando la tua zona è considerata online, degradata o offline in base a:

### Tipi di Controllo Disponibili

| Tipo di Controllo                   | Descrizione                                                                   |
| ----------------------------------- | ----------------------------------------------------------------------------- |
| DNSSEC Chain Is Valid               | L'intera catena di validazione (radice → TLD → zona) si risolve correttamente |
| DNSSEC DNSKEY Record Exists         | La zona pubblica almeno un record DNSKEY                                      |
| DNSSEC DS Record Exists At Parent   | La zona padre pubblica un record DS corrispondente alla KSK della zona        |
| DNSSEC Signature Expires In Days    | Giorni rimanenti alla scadenza della prossima firma RRSIG                     |
| DNSSEC Resolver Consensus (AD Flag) | Ogni resolver interrogato restituisce il flag AD (Authenticated Data)         |
| DNSSEC Nameservers Are Consistent   | Tutti i nameserver autoritativi restituiscono lo stesso numero di serie SOA   |
| DNSSEC Is Valid                     | Risultato aggregato passa/fallisce su tutti i controlli di validazione        |

### Tipi di Filtro

Per **DNSSEC Chain Is Valid**, **DNSSEC DNSKEY Record Exists**, **DNSSEC DS Record Exists At Parent**, **DNSSEC Resolver Consensus (AD Flag)**, **DNSSEC Nameservers Are Consistent** e **DNSSEC Is Valid**:

- **True** — La condizione è vera
- **False** — La condizione è falsa

Per **DNSSEC Signature Expires In Days**:

- **Greater Than**, **Less Than**, **Greater Than or Equal To**, **Less Than or Equal To**, **Equal To**, **Not Equal To**

### Esempi di Criteri

#### Avvisa se la catena DNSSEC è interrotta

- **Controlla Su**: DNSSEC Chain Is Valid
- **Tipo di Filtro**: False

#### Avvisa prima della scadenza delle firme

- **Controlla Su**: DNSSEC Signature Expires In Days
- **Tipo di Filtro**: Less Than
- **Valore**: 7

#### Rileva DS mancante nella zona padre (delegazione interrotta)

- **Controlla Su**: DNSSEC DS Record Exists At Parent
- **Tipo di Filtro**: False

#### Rileva disaccordo tra resolver

- **Controlla Su**: DNSSEC Resolver Consensus (AD Flag)
- **Tipo di Filtro**: False

#### Rileva incoerenza tra nameserver

- **Controlla Su**: DNSSEC Nameservers Are Consistent
- **Tipo di Filtro**: False

## Best Practice

1. **Usa più resolver pubblici** — Per impostazione predefinita `1.1.1.1`, `8.8.8.8` e `9.9.9.9`, in modo che il guasto di un singolo resolver non causi falsi positivi
2. **Avvisa con largo anticipo rispetto alla scadenza** — Configura avvisi degradati a 7 giorni e avvisi offline a 2 giorni prima della scadenza della firma; le rotazioni delle chiavi possono fallire silenziosamente
3. **Monitora ogni zona firmata** — Includi domini apex, sottodomini firmati e qualsiasi zona delegata a un operatore diverso
4. **Abilita i controlli di coerenza dei nameserver** — Rilevano problemi di sincronizzazione primario/secondario che la sola validazione DNSSEC non noterebbe, a meno che la tua rete non blocchi il traffico DNS in uscita verso IP arbitrari
