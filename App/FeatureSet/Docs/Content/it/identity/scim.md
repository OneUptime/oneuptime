# SCIM (System for Cross-domain Identity Management)

OneUptime supporta il protocollo SCIM v2.0 per il provisioning e il deprovisioning automatizzato degli utenti. SCIM consente ai provider di identità (IdP) come Azure AD, Okta e altri sistemi di identità enterprise di gestire automaticamente l'accesso degli utenti ai progetti e alle pagine di stato di OneUptime.

## Panoramica

L'integrazione SCIM fornisce i seguenti vantaggi:

- **Provisioning Automatico degli Utenti**: Crea automaticamente gli utenti in OneUptime quando vengono assegnati nel tuo IdP
- **Deprovisioning Automatico degli Utenti**: Rimuove automaticamente gli utenti da OneUptime quando vengono disassegnati nel tuo IdP
- **Sincronizzazione degli Attributi Utente**: Mantiene le informazioni degli utenti sincronizzate tra il tuo IdP e OneUptime
- **Gestione Centralizzata degli Accessi**: Gestisce l'accesso a OneUptime dal tuo sistema di gestione delle identità esistente

## SCIM per i Progetti

Il SCIM di Progetto consente ai provider di identità di gestire i membri del team all'interno dei progetti OneUptime.

### Configurazione del SCIM di Progetto

1. **Naviga alle Impostazioni del Progetto**
   - Vai al tuo progetto OneUptime
   - Naviga su **Impostazioni Progetto** > **Team** > **SCIM**

2. **Configura le Impostazioni SCIM**
   - Abilita **Auto Provision Users** per aggiungere automaticamente gli utenti quando vengono assegnati nel tuo IdP
   - Abilita **Auto Deprovision Users** per rimuovere automaticamente gli utenti quando vengono disassegnati nel tuo IdP
   - Seleziona i **Team Predefiniti** a cui i nuovi utenti devono essere aggiunti
   - Copia il **SCIM Base URL** e il **Bearer Token** per la configurazione del tuo IdP

3. **Configura il tuo Provider di Identità**
   - Usa il SCIM Base URL: `https://oneuptime.com/scim/v2/{scimId}`
   - Configura l'autenticazione con bearer token con il token fornito
   - Mappa gli attributi degli utenti (l'email è obbligatoria)

### Endpoint SCIM di Progetto

- **Configurazione del Service Provider**: `GET /scim/v2/{scimId}/ServiceProviderConfig`
- **Schemi**: `GET /scim/v2/{scimId}/Schemas`
- **Tipi di Risorsa**: `GET /scim/v2/{scimId}/ResourceTypes`
- **Elenca Utenti**: `GET /scim/v2/{scimId}/Users`
- **Ottieni Utente**: `GET /scim/v2/{scimId}/Users/{userId}`
- **Crea Utente**: `POST /scim/v2/{scimId}/Users`
- **Aggiorna Utente**: `PUT /scim/v2/{scimId}/Users/{userId}` o `PATCH /scim/v2/{scimId}/Users/{userId}`
- **Elimina Utente**: `DELETE /scim/v2/{scimId}/Users/{userId}`
- **Elenca Gruppi**: `GET /scim/v2/{scimId}/Groups`
- **Ottieni Gruppo**: `GET /scim/v2/{scimId}/Groups/{groupId}`
- **Crea Gruppo**: `POST /scim/v2/{scimId}/Groups`
- **Aggiorna Gruppo**: `PUT /scim/v2/{scimId}/Groups/{groupId}` o `PATCH /scim/v2/{scimId}/Groups/{groupId}`
- **Elimina Gruppo**: `DELETE /scim/v2/{scimId}/Groups/{groupId}`

### Ciclo di Vita degli Utenti nel SCIM di Progetto

1. **Assegnazione Utente nell'IdP**: Quando un utente viene assegnato a OneUptime nel tuo IdP
2. **Provisioning SCIM**: L'IdP chiama l'API SCIM di OneUptime per creare l'utente
3. **Membership del Team**: L'utente viene automaticamente aggiunto ai team predefiniti configurati
4. **Accesso Concesso**: L'utente può ora accedere al progetto OneUptime
5. **Disassegnazione dell'Utente**: Quando l'utente viene disassegnato nell'IdP
6. **Deprovisioning SCIM**: L'IdP chiama l'API SCIM di OneUptime per rimuovere l'utente
7. **Accesso Revocato**: L'utente perde l'accesso al progetto

## SCIM per le Pagine di Stato

Il SCIM della Pagina di Stato consente ai provider di identità di gestire i subscriber alle pagine di stato private.

### Configurazione del SCIM della Pagina di Stato

1. **Naviga alle Impostazioni della Pagina di Stato**
   - Vai alla tua pagina di stato OneUptime
   - Naviga su **Impostazioni Pagina di Stato** > **Utenti Privati** > **SCIM**

2. **Configura le Impostazioni SCIM**
   - Abilita **Auto Provision Users** per aggiungere automaticamente i subscriber quando vengono assegnati nel tuo IdP
   - Abilita **Auto Deprovision Users** per rimuovere automaticamente i subscriber quando vengono disassegnati nel tuo IdP
   - Copia il **SCIM Base URL** e il **Bearer Token** per la configurazione del tuo IdP

3. **Configura il tuo Provider di Identità**
   - Usa il SCIM Base URL: `https://oneuptime.com/status-page-scim/v2/{scimId}`
   - Configura l'autenticazione con bearer token con il token fornito
   - Mappa gli attributi degli utenti (l'email è obbligatoria)

### Endpoint SCIM della Pagina di Stato

- **Configurazione del Service Provider**: `GET /status-page-scim/v2/{scimId}/ServiceProviderConfig`
- **Schemi**: `GET /status-page-scim/v2/{scimId}/Schemas`
- **Tipi di Risorsa**: `GET /status-page-scim/v2/{scimId}/ResourceTypes`
- **Elenca Utenti**: `GET /status-page-scim/v2/{scimId}/Users`
- **Ottieni Utente**: `GET /status-page-scim/v2/{scimId}/Users/{userId}`
- **Crea Utente**: `POST /status-page-scim/v2/{scimId}/Users`
- **Aggiorna Utente**: `PUT /status-page-scim/v2/{scimId}/Users/{userId}` o `PATCH /status-page-scim/v2/{scimId}/Users/{userId}`
- **Elimina Utente**: `DELETE /status-page-scim/v2/{scimId}/Users/{userId}`

### Ciclo di Vita degli Utenti nel SCIM della Pagina di Stato

1. **Assegnazione Utente nell'IdP**: Quando un utente viene assegnato alla Pagina di Stato OneUptime nel tuo IdP
2. **Provisioning SCIM**: L'IdP chiama l'API SCIM di OneUptime per creare il subscriber
3. **Accesso Concesso**: L'utente può ora accedere alla pagina di stato privata
4. **Disassegnazione dell'Utente**: Quando l'utente viene disassegnato nell'IdP
5. **Deprovisioning SCIM**: L'IdP chiama l'API SCIM di OneUptime per rimuovere il subscriber
6. **Accesso Revocato**: L'utente perde l'accesso alla pagina di stato

## Configurazione del Provider di Identità

### Microsoft Entra ID (precedentemente Azure AD)

Microsoft Entra ID fornisce gestione delle identità enterprise con robuste capacità di provisioning SCIM. Segui questi passaggi dettagliati per configurare il provisioning SCIM con OneUptime.

#### Prerequisiti

- Tenant Microsoft Entra ID con licenza Premium P1 o P2 (richiesta per il provisioning automatico)
- Account OneUptime con piano Scale o superiore
- Accesso amministrativo sia a Microsoft Entra ID sia a OneUptime

#### Passo 1: Ottieni la Configurazione SCIM da OneUptime

1. Accedi alla dashboard di OneUptime
2. Naviga su **Impostazioni Progetto** > **Team** > **SCIM**
3. Clicca su **Crea Configurazione SCIM**
4. Inserisci un nome descrittivo (es. "Provisioning Microsoft Entra ID")
5. Configura le seguenti opzioni:
   - **Auto Provision Users**: Abilita per creare automaticamente gli utenti
   - **Auto Deprovision Users**: Abilita per rimuovere automaticamente gli utenti
   - **Team Predefiniti**: Seleziona i team a cui i nuovi utenti devono essere aggiunti
   - **Abilita Push Groups**: Abilita se vuoi gestire la membership del team tramite i gruppi di Entra ID
6. Salva la configurazione
7. Copia il **SCIM Base URL** e il **Bearer Token** - ne avrai bisogno per Entra ID

#### Passo 2: Crea un'Applicazione Enterprise in Microsoft Entra ID

1. Accedi al [centro di amministrazione Microsoft Entra](https://entra.microsoft.com)
2. Naviga su **Identità** > **Applicazioni** > **Applicazioni Enterprise**
3. Clicca su **+ Nuova applicazione**
4. Clicca su **+ Crea la tua applicazione**
5. Inserisci un nome (es. "OneUptime")
6. Seleziona **Integra qualsiasi altra applicazione che non trovi nella galleria (Non-gallery)**
7. Clicca su **Crea**

#### Passo 3: Configura il Provisioning SCIM

1. Nella tua applicazione enterprise OneUptime, vai su **Provisioning**
2. Clicca su **Inizia**
3. Imposta la **Modalità di Provisioning** su **Automatico**
4. In **Credenziali Amministratore**:
   - **URL Tenant**: Inserisci il SCIM Base URL da OneUptime (es. `https://oneuptime.com/api/identity/scim/v2/{your-scim-id}`)
   - **Token Segreto**: Inserisci il Bearer Token da OneUptime
5. Clicca su **Test Connessione** per verificare la configurazione
6. Clicca su **Salva**

#### Passo 4: Configura le Mappature degli Attributi

1. Nella sezione Provisioning, clicca su **Mappature**
2. Clicca su **Provision Azure Active Directory Users**
3. Configura le seguenti mappature degli attributi:

| Attributo Azure AD | Attributo SCIM OneUptime | Obbligatorio |
|-------------------|-------------------------|----------|
| `userPrincipalName` | `userName` | Sì |
| `mail` | `emails[type eq "work"].value` | Consigliato |
| `displayName` | `displayName` | Consigliato |
| `givenName` | `name.givenName` | Opzionale |
| `surname` | `name.familyName` | Opzionale |
| `Switch([IsSoftDeleted], , "False", "True", "True", "False")` | `active` | Consigliato |

4. Rimuovi le mappature non necessarie per semplificare il provisioning
5. Clicca su **Salva**

#### Passo 5: Configura il Provisioning dei Gruppi (Opzionale)

Se hai abilitato **Push Groups** in OneUptime:

1. Torna a **Mappature**
2. Clicca su **Provision Azure Active Directory Groups**
3. Abilita il provisioning dei gruppi impostando **Abilitato** su **Sì**
4. Configura le seguenti mappature degli attributi:

| Attributo Azure AD | Attributo SCIM OneUptime |
|-------------------|-------------------------|
| `displayName` | `displayName` |
| `members` | `members` |

5. Clicca su **Salva**

#### Passo 6: Assegna Utenti e Gruppi

1. Nella tua applicazione enterprise OneUptime, vai su **Utenti e gruppi**
2. Clicca su **+ Aggiungi utente/gruppo**
3. Seleziona gli utenti e/o i gruppi che vuoi provisionare in OneUptime
4. Clicca su **Assegna**

#### Passo 7: Avvia il Provisioning

1. Vai su **Provisioning** > **Panoramica**
2. Clicca su **Avvia provisioning**
3. Il ciclo di provisioning iniziale avrà inizio (potrebbe richiedere fino a 40 minuti per la prima sincronizzazione)
4. Monitora i **Log di Provisioning** per eventuali errori

#### Risoluzione dei Problemi con Microsoft Entra ID

- **Test Connessione Fallito**: Verifica che il SCIM Base URL includa il prefisso `/api/identity` e che il Bearer Token sia corretto
- **Utenti Non Provisionati**: Controlla che gli utenti siano assegnati all'applicazione e che le mappature degli attributi siano corrette
- **Errori di Provisioning**: Esamina i log di provisioning in Entra ID per messaggi di errore specifici
- **Ritardi di Sincronizzazione**: Il provisioning iniziale può richiedere fino a 40 minuti; le sincronizzazioni successive avvengono ogni 40 minuti

---

### Okta

Okta fornisce una gestione delle identità flessibile con un eccellente supporto SCIM. Segui questi passaggi dettagliati per configurare il provisioning SCIM con OneUptime.

#### Prerequisiti

- Tenant Okta con capacità di provisioning (funzionalità Lifecycle Management)
- Account OneUptime con piano Scale o superiore
- Accesso amministrativo sia a Okta sia a OneUptime

#### Passo 1: Ottieni la Configurazione SCIM da OneUptime

1. Accedi alla dashboard di OneUptime
2. Naviga su **Impostazioni Progetto** > **Team** > **SCIM**
3. Clicca su **Crea Configurazione SCIM**
4. Inserisci un nome descrittivo (es. "Provisioning Okta")
5. Configura le seguenti opzioni:
   - **Auto Provision Users**: Abilita per creare automaticamente gli utenti
   - **Auto Deprovision Users**: Abilita per rimuovere automaticamente gli utenti
   - **Team Predefiniti**: Seleziona i team a cui i nuovi utenti devono essere aggiunti
   - **Abilita Push Groups**: Abilita se vuoi gestire la membership del team tramite i gruppi Okta
6. Salva la configurazione
7. Copia il **SCIM Base URL** e il **Bearer Token** - ne avrai bisogno per Okta

#### Passo 2: Crea o Configura l'Applicazione Okta

**Se hai un'applicazione SSO esistente:**
1. Accedi alla tua Console di Amministrazione Okta
2. Naviga su **Applicazioni** > **Applicazioni**
3. Trova e seleziona la tua applicazione OneUptime esistente

**Se stai creando una nuova applicazione:**
1. Accedi alla tua Console di Amministrazione Okta
2. Naviga su **Applicazioni** > **Applicazioni**
3. Clicca su **Crea integrazione app**
4. Seleziona **SAML 2.0** e clicca su **Avanti**
5. Inserisci "OneUptime" come nome dell'app
6. Completa la configurazione SAML (consulta la documentazione SSO)
7. Clicca su **Fine**

#### Passo 3: Abilita il Provisioning SCIM

1. Nella tua applicazione OneUptime, vai alla scheda **Generale**
2. Nella sezione **Impostazioni App**, clicca su **Modifica**
3. In **Provisioning**, seleziona **SCIM**
4. Clicca su **Salva**
5. Apparirà una nuova scheda **Provisioning**

#### Passo 4: Configura la Connessione SCIM

1. Vai alla scheda **Provisioning**
2. Clicca su **Integrazione** nella barra laterale sinistra
3. Clicca su **Configura integrazione API**
4. Seleziona **Abilita integrazione API**
5. Configura quanto segue:
   - **URL base connettore SCIM**: Inserisci il SCIM Base URL da OneUptime (es. `https://oneuptime.com/api/identity/scim/v2/{your-scim-id}`)
   - **Campo identificatore univoco per gli utenti**: Inserisci `userName`
   - **Azioni di provisioning supportate**: Seleziona le azioni che vuoi abilitare:
     - Importa nuovi utenti e aggiornamenti del profilo
     - Push nuovi utenti
     - Push aggiornamenti del profilo
     - Push gruppi (se si usa il provisioning basato su gruppi)
   - **Modalità di autenticazione**: Seleziona **HTTP Header**
   - **Autorizzazione**: Inserisci `Bearer {your-bearer-token}` (sostituisci con il token effettivo)
6. Clicca su **Test credenziali API** per verificare la connessione
7. Clicca su **Salva**

#### Passo 5: Configura il Provisioning verso l'App

1. Nella scheda **Provisioning**, clicca su **Verso l'App** nella barra laterale sinistra
2. Clicca su **Modifica**
3. Abilita le seguenti opzioni:
   - **Crea utenti**: Abilita per provisionare i nuovi utenti
   - **Aggiorna attributi utente**: Abilita per sincronizzare le modifiche agli attributi
   - **Disattiva utenti**: Abilita per deprovisionare gli utenti quando vengono disassegnati
4. Clicca su **Salva**

#### Passo 6: Configura le Mappature degli Attributi

1. Scorri fino a **Mappature degli Attributi**
2. Verifica o configura le seguenti mappature:

| Attributo Okta | Attributo SCIM OneUptime | Direzione |
|---------------|-------------------------|-----------|
| `userName` | `userName` | Okta verso App |
| `user.email` | `emails[primary eq true].value` | Okta verso App |
| `user.firstName` | `name.givenName` | Okta verso App |
| `user.lastName` | `name.familyName` | Okta verso App |
| `user.displayName` | `displayName` | Okta verso App |

3. Rimuovi le mappature non necessarie
4. Clicca su **Salva** se hai apportato modifiche

#### Passo 7: Configura Push Groups (Opzionale)

Se hai abilitato **Push Groups** in OneUptime:

1. Vai alla scheda **Push Groups**
2. Clicca su **+ Push Groups**
3. Seleziona **Trova gruppi per nome** o **Trova gruppi per regola**
4. Cerca e seleziona i gruppi che vuoi pushare
5. Clicca su **Salva**

#### Passo 8: Assegna gli Utenti

1. Vai alla scheda **Assegnazioni**
2. Clicca su **Assegna** > **Assegna alle Persone** o **Assegna ai Gruppi**
3. Seleziona gli utenti o i gruppi che vuoi provisionare
4. Clicca su **Assegna** per ogni selezione
5. Clicca su **Fine**

#### Passo 9: Verifica il Provisioning

1. Vai su **Report** > **Log di Sistema** nella Console di Amministrazione Okta
2. Filtra per eventi relativi alla tua applicazione OneUptime
3. Verifica che gli eventi di provisioning abbiano successo
4. Controlla OneUptime per confermare che gli utenti siano stati creati

#### Risoluzione dei Problemi con Okta

- **Test Credenziali API Fallito**: Verifica che il SCIM Base URL e il Bearer Token siano corretti
- **Utenti Non Provisionati**: Assicurati che gli utenti siano assegnati all'applicazione e che il provisioning sia abilitato
- **Utenti Duplicati**: Assicurati che l'attributo `userName` sia univoco e si mappi correttamente all'email
- **Fallimenti Push Gruppi**: Verifica che i gruppi esistano e abbiano la membership corretta
- **Errore: 401 Unauthorized**: Rigenera il Bearer Token in OneUptime e aggiorna Okta

---

### Altri Provider di Identità

L'implementazione SCIM di OneUptime segue la specifica SCIM v2.0 e dovrebbe funzionare con qualsiasi provider di identità conforme. Passaggi generali di configurazione:

1. **SCIM Base URL**: `https://oneuptime.com/api/identity/scim/v2/{scim-id}` (per i progetti) o `https://oneuptime.com/api/identity/status-page-scim/v2/{scim-id}` (per le pagine di stato)
2. **Autenticazione**: HTTP Bearer Token
3. **Attributo Utente Obbligatorio**: `userName` (deve essere un indirizzo email valido)
4. **Operazioni Supportate**: GET, POST, PUT, PATCH, DELETE per Utenti e Gruppi

#### Endpoint SCIM Supportati

| Endpoint | Metodi | Descrizione |
|----------|---------|-------------|
| `/ServiceProviderConfig` | GET | Capacità del server SCIM |
| `/Schemas` | GET | Schemi delle risorse disponibili |
| `/ResourceTypes` | GET | Tipi di risorse disponibili |
| `/Users` | GET, POST | Elenca e crea utenti |
| `/Users/{id}` | GET, PUT, PATCH, DELETE | Gestisce i singoli utenti |
| `/Groups` | GET, POST | Elenca e crea gruppi/team (solo SCIM di Progetto) |
| `/Groups/{id}` | GET, PUT, PATCH, DELETE | Gestisce i singoli gruppi (solo SCIM di Progetto) |

#### Schema Utente SCIM

```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:User"],
  "userName": "user@example.com",
  "name": {
    "givenName": "John",
    "familyName": "Doe",
    "formatted": "John Doe"
  },
  "displayName": "John Doe",
  "emails": [
    {
      "value": "user@example.com",
      "type": "work",
      "primary": true
    }
  ],
  "active": true
}
```

#### Schema Gruppo SCIM

```json
{
  "schemas": ["urn:ietf:params:scim:schemas:core:2.0:Group"],
  "displayName": "Engineering Team",
  "members": [
    {
      "value": "user-id-here",
      "display": "user@example.com"
    }
  ]
}
```

## Domande Frequenti

### Cosa succede quando un utente viene deprovisionato?

Quando un utente viene deprovisionato (tramite richiesta DELETE o impostando `active: false`), viene rimosso dai team configurati nelle impostazioni SCIM. L'account utente rimane in OneUptime ma perde l'accesso al progetto.

### Posso usare SCIM senza SSO?

Sì, SCIM e SSO sono funzionalità indipendenti. Puoi usare SCIM per il provisioning degli utenti consentendo loro di accedere con le password OneUptime o qualsiasi altro metodo di autenticazione.

### Come gestisco gli utenti che già esistono in OneUptime?

Quando SCIM tenta di creare un utente che già esiste (corrispondenza per email), OneUptime li aggiungerà semplicemente ai team predefiniti configurati invece di creare un utente duplicato.

### Qual è la differenza tra team predefiniti e push groups?

- **Team Predefiniti**: Tutti gli utenti provisionati tramite SCIM vengono aggiunti agli stessi team predefiniti
- **Push Groups**: La membership del team è gestita dal tuo provider di identità, consentendo a diversi utenti di essere in team diversi in base alla membership del gruppo IdP

### Con quale frequenza avviene la sincronizzazione del provisioning?

Dipende dal tuo provider di identità:
- **Microsoft Entra ID**: La sincronizzazione iniziale può richiedere fino a 40 minuti; le sincronizzazioni successive ogni 40 minuti
- **Okta**: Quasi in tempo reale per la maggior parte delle operazioni, con sincronizzazioni complete periodiche
