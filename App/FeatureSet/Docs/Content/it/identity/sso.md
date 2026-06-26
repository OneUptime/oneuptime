# SSO (Single Sign-On)

OneUptime supporta il Single Sign-On (SSO) basato su SAML 2.0 per l'autenticazione enterprise. SSO consente ai membri del tuo team di accedere a OneUptime usando le credenziali aziendali della tua organizzazione, fornendo gestione centralizzata degli accessi e sicurezza migliorata.

## Panoramica

L'integrazione SSO fornisce i seguenti vantaggi:

- **Autenticazione Centralizzata**: Gli utenti accedono con le loro credenziali aziendali esistenti
- **Sicurezza Migliorata**: Sfrutta l'autenticazione a più fattori e le policy di sicurezza del tuo IdP
- **Gestione Utenti Semplificata**: Gestisce l'accesso dal tuo sistema di gestione delle identità esistente
- **Riduzione dell'Affaticamento da Password**: Gli utenti non devono ricordare una password separata per OneUptime

## Configurazione dell'SSO

1. **Naviga alle Impostazioni del Progetto**

   - Vai al tuo progetto OneUptime
   - Naviga su **Impostazioni Progetto** > **Autenticazione** > **SSO**

2. **Crea la Configurazione SSO**

   - Clicca su **Crea SSO**
   - Inserisci un **Nome** per la configurazione SSO (es. "Keycloak SAML" o "Okta SAML")
   - Inserisci il **Sign On URL** dal tuo provider di identità
   - Inserisci l'**Issuer** (Entity ID) dal tuo provider di identità
   - Incolla il **Certificato Pubblico** dal tuo provider di identità
   - Seleziona l'**Algoritmo di Firma** (es. `RSA-SHA-256`)
   - Seleziona l'**Algoritmo Digest** (es. `SHA256`)

3. **Ottieni i Metadati SSO di OneUptime**
   - Dopo il salvataggio, clicca sul pulsante **Visualizza Config SSO**
   - Copia l'**Identifier (Entity ID)** — è necessario nella configurazione del tuo IdP
   - Copia il **Reply URL (Assertion Consumer Service URL)** — è necessario nella configurazione del tuo IdP

## Configurazione SAML di Keycloak

Keycloak è una soluzione popolare open-source per la gestione delle identità e degli accessi. Segui questi passaggi per configurare Keycloak come provider di identità SAML per OneUptime.

### Prerequisiti

- Un'istanza Keycloak in esecuzione con un realm configurato
- Accesso amministrativo sia a Keycloak sia a OneUptime
- Account OneUptime con supporto SSO

### Passo 1: Configura l'SSO di OneUptime

1. Accedi alla dashboard di OneUptime
2. Naviga su **Impostazioni Progetto** > **Autenticazione** > **SSO**
3. Clicca su **Crea SSO** e compila quanto segue:
   - **Nome**: Un nome descrittivo (es. `my-project-oneuptime`)
   - **Sign On URL**: `https://<your-keycloak-domain>/auth/realms/<your-realm>/protocol/saml`
   - **Issuer**: `https://<your-keycloak-domain>/auth/realms/<your-realm>`
   - **Certificato**: Vedi [Passo 2](#passo-2-ottieni-il-certificato-keycloak) qui sotto
   - **Algoritmo di Firma**: `RSA-SHA-256`
   - **Algoritmo Digest**: `SHA256`
4. Salva la configurazione

### Passo 2: Ottieni il Certificato Keycloak

1. In Keycloak, naviga alla configurazione del tuo client
2. Clicca su **Esporta** (o vai alla scheda **Chiavi** a seconda della tua versione di Keycloak)
3. Nel file JSON esportato, trova la chiave con `certificate` nel nome
4. Copia il valore del certificato e incollalo in OneUptime nel seguente formato:

```
-----BEGIN CERTIFICATE-----
MIICnzCCAYcCBgFyPZ8QFzANBgkqhkiG.......
-----END CERTIFICATE-----
```

### Passo 3: Configura il Client Keycloak

1. In Keycloak, naviga su **Client** nel tuo realm
2. Crea un nuovo client o modifica uno esistente
3. Imposta il **Protocollo Client** su `saml`
4. Imposta il **Client ID** sul valore **Identifier (Entity ID)** di OneUptime dalla **Visualizza Config SSO**
5. Imposta i **Valid Redirect URIs** sull'URL di OneUptime
6. Imposta il **Root URL** sull'URL base di OneUptime
7. Incolla il **Reply URL (Assertion Consumer Service URL)** di OneUptime nel campo **Assertion Consumer Service POST Binding URL**

### Passo 4: Configura le Impostazioni del Client Keycloak

1. Disabilita la **configurazione delle chiavi di firma** (nella scheda Chiavi)
2. Imposta il **Formato Name ID** su `email`
3. Assicurati che l'opzione **Force Name ID Format** sia abilitata affinché Keycloak invii sempre l'email come Name ID

### Passo 5: Verifica la Configurazione

1. Salva tutte le impostazioni sia in Keycloak sia in OneUptime
2. Prova ad accedere a OneUptime usando SSO
3. Dovresti essere reindirizzato alla pagina di login di Keycloak e di nuovo a OneUptime dopo l'autenticazione riuscita

### Risoluzione dei Problemi con Keycloak

- **Accesso Fallisce con Errore di Firma**: Assicurati che il certificato sia copiato correttamente, incluse le righe `BEGIN CERTIFICATE` e `END CERTIFICATE`
- **Errore Name ID**: Verifica che il **Formato Name ID** sia impostato su `email` in Keycloak
- **Loop di Reindirizzamento**: Controlla che i **Valid Redirect URIs** e l'**Assertion Consumer Service POST Binding URL** siano configurati correttamente
- **Certificato Non Trovato**: Assicurati di esportare dal client corretto nel realm corretto

---

## Configurazione SAML di Microsoft Entra ID (precedentemente Azure AD / Active Directory)

Microsoft Entra ID è il servizio di gestione delle identità e degli accessi cloud di Microsoft. Segui questi passaggi per configurare Entra ID come provider di identità SAML per OneUptime.

### Prerequisiti

- Tenant Microsoft Entra ID (qualsiasi livello che supporta applicazioni enterprise con SSO SAML)
- Accesso amministrativo sia a Microsoft Entra ID sia a OneUptime
- Account OneUptime con supporto SSO

### Passo 1: Configura l'SSO di OneUptime

1. Accedi alla dashboard di OneUptime
2. Naviga su **Impostazioni Progetto** > **Autenticazione** > **SSO**
3. Clicca su **Crea SSO** e compila quanto segue:
   - **Nome**: Un nome descrittivo (es. `Azure AD SAML`)
   - **Sign On URL**: Lo otterrai da Entra ID nel [Passo 3](#passo-3-copia-i-metadati-saml-di-entra-id-in-oneuptime)
   - **Issuer**: Lo otterrai da Entra ID nel [Passo 3](#passo-3-copia-i-metadati-saml-di-entra-id-in-oneuptime)
   - **Certificato**: Lo otterrai da Entra ID nel [Passo 3](#passo-3-copia-i-metadati-saml-di-entra-id-in-oneuptime)
   - **Algoritmo di Firma**: `RSA-SHA-256`
   - **Algoritmo Digest**: `SHA256`
4. Clicca su **Visualizza Config SSO** e copia l'**Identifier (Entity ID)** e il **Reply URL (Assertion Consumer Service URL)** — ne avrai bisogno per Entra ID

### Passo 2: Crea un'Applicazione Enterprise in Microsoft Entra ID

1. Accedi al [centro di amministrazione Microsoft Entra](https://entra.microsoft.com)
2. Naviga su **Identità** > **Applicazioni** > **Applicazioni Enterprise**
3. Clicca su **+ Nuova applicazione**
4. Clicca su **+ Crea la tua applicazione**
5. Inserisci un nome (es. "OneUptime")
6. Seleziona **Integra qualsiasi altra applicazione che non trovi nella galleria (Non-gallery)**
7. Clicca su **Crea**

### Passo 3: Configura SSO SAML in Entra ID

1. Nella tua nuova applicazione enterprise, vai su **Single sign-on**
2. Seleziona **SAML** come metodo di single sign-on
3. In **Configurazione SAML di base**, clicca su **Modifica** e imposta:
   - **Identifier (Entity ID)**: Incolla l'**Identifier (Entity ID)** dalla **Visualizza Config SSO** di OneUptime
   - **Reply URL (Assertion Consumer Service URL)**: Incolla il **Reply URL** dalla **Visualizza Config SSO** di OneUptime
4. Clicca su **Salva**
5. Nella sezione **Certificati SAML**:
   - Scarica il **Certificato (Base64)**
   - Apri il file del certificato scaricato in un editor di testo e copia i contenuti
6. Nella sezione **Configura OneUptime**, copia:
   - **URL di accesso** — incollalo come **Sign On URL** in OneUptime
   - **Identificatore Azure AD** — incollalo come **Issuer** in OneUptime
7. Torna a OneUptime e incolla il certificato e gli URL, poi salva

### Passo 4: Configura gli Attributi e le Attestazioni dell'Utente

1. Nella pagina di configurazione SAML, clicca su **Modifica** in **Attributi e attestazioni**
2. Assicurati che siano configurate le seguenti attestazioni:

| Nome Attestazione                                                    | Valore                                 |
| -------------------------------------------------------------------- | -------------------------------------- |
| `Unique User Identifier (Name ID)`                                   | `user.userprincipalname` o `user.mail` |
| `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress` | `user.mail`                            |
| `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname`    | `user.givenname`                       |
| `http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname`      | `user.surname`                         |

3. Imposta il **Formato identificatore nome** su `Email address`
4. Clicca su **Salva**

### Passo 5: Assegna Utenti e Gruppi

1. Nella tua applicazione enterprise, vai su **Utenti e gruppi**
2. Clicca su **+ Aggiungi utente/gruppo**
3. Seleziona gli utenti e/o i gruppi a cui vuoi concedere l'accesso SSO
4. Clicca su **Assegna**

### Passo 6: Verifica la Configurazione

1. Salva tutte le impostazioni sia in Entra ID sia in OneUptime
2. Prova ad accedere a OneUptime usando SSO
3. Dovresti essere reindirizzato alla pagina di login Microsoft e di nuovo a OneUptime dopo l'autenticazione riuscita

### Risoluzione dei Problemi con Microsoft Entra ID

- **Errore AADSTS700016**: L'Identifier (Entity ID) in Entra ID non corrisponde a OneUptime — verifica che entrambi i valori siano identici
- **Errore Certificato**: Assicurati di aver scaricato il certificato **Base64** (non il formato raw/binario) e di aver incluso le righe `BEGIN CERTIFICATE` / `END CERTIFICATE`
- **Utente Non Assegnato**: Gli utenti devono essere esplicitamente assegnati all'applicazione enterprise prima di poter accedere tramite SSO
- **Mancata Corrispondenza Name ID**: Assicurati che l'attestazione Name ID sia impostata su un indirizzo email che corrisponda all'email dell'utente in OneUptime

---

## Configurazione SAML di Okta

Okta è una piattaforma di identità ampiamente utilizzata che fornisce robuste capacità SSO SAML. Segui questi passaggi per configurare Okta come provider di identità SAML per OneUptime.

### Prerequisiti

- Organizzazione Okta con accesso amministrativo
- Account OneUptime con supporto SSO

### Passo 1: Configura l'SSO di OneUptime

1. Accedi alla dashboard di OneUptime
2. Naviga su **Impostazioni Progetto** > **Autenticazione** > **SSO**
3. Clicca su **Crea SSO** e compila quanto segue:
   - **Nome**: Un nome descrittivo (es. `Okta SAML`)
   - **Sign On URL**: Lo otterrai da Okta nel [Passo 3](#passo-3-copia-i-metadati-saml-di-okta-in-oneuptime)
   - **Issuer**: Lo otterrai da Okta nel [Passo 3](#passo-3-copia-i-metadati-saml-di-okta-in-oneuptime)
   - **Certificato**: Lo otterrai da Okta nel [Passo 3](#passo-3-copia-i-metadati-saml-di-okta-in-oneuptime)
   - **Algoritmo di Firma**: `RSA-SHA-256`
   - **Algoritmo Digest**: `SHA256`
4. Clicca su **Visualizza Config SSO** e copia l'**Identifier (Entity ID)** e il **Reply URL (Assertion Consumer Service URL)** — ne avrai bisogno per Okta

### Passo 2: Crea un'Applicazione SAML in Okta

1. Accedi alla tua Console di Amministrazione Okta
2. Naviga su **Applicazioni** > **Applicazioni**
3. Clicca su **Crea integrazione app**
4. Seleziona **SAML 2.0** e clicca su **Avanti**
5. Inserisci "OneUptime" come **Nome app** e clicca su **Avanti**
6. Nella sezione **Impostazioni SAML**, configura:
   - **URL single sign-on**: Incolla il **Reply URL (Assertion Consumer Service URL)** dalla **Visualizza Config SSO** di OneUptime
   - **Audience URI (SP Entity ID)**: Incolla l'**Identifier (Entity ID)** dalla **Visualizza Config SSO** di OneUptime
   - **Formato Name ID**: Seleziona `EmailAddress`
   - **Nome utente applicazione**: Seleziona `Email`
7. Clicca su **Avanti**, poi seleziona **Sono un cliente Okta che aggiunge un'app interna** e clicca su **Fine**

### Passo 3: Copia i Metadati SAML di Okta in OneUptime

1. Nella tua applicazione Okta, vai alla scheda **Sign On**
2. Nella sezione **Certificati di firma SAML**, trova il certificato attivo e clicca su **Azioni** > **Visualizza metadati IdP**
3. Dai metadati XML, o dai dettagli della scheda **Sign On**:
   - Copia il **Sign On URL** (chiamato anche **URL Single Sign-On del provider di identità**) — incollalo come **Sign On URL** in OneUptime
   - Copia l'**Issuer** (chiamato anche **Issuer del provider di identità**) — incollalo come **Issuer** in OneUptime
4. Scarica il certificato di firma:
   - Nella sezione **Certificati di firma SAML**, clicca su **Azioni** > **Scarica certificato** per il certificato attivo
   - Apri il file `.cert` scaricato in un editor di testo e copia i contenuti
   - Incolla il certificato in OneUptime (incluse le righe `BEGIN CERTIFICATE` e `END CERTIFICATE`)
5. Salva la configurazione SSO di OneUptime

### Passo 4: Configura le Dichiarazioni degli Attributi (Opzionale)

1. Nell'applicazione Okta, vai alla scheda **Generale**
2. Clicca su **Modifica** nella sezione **Impostazioni SAML** e clicca su **Avanti** per arrivare alle impostazioni SAML
3. Nella sezione **Dichiarazioni degli Attributi**, aggiungi:

| Nome        | Valore           |
| ----------- | ---------------- |
| `email`     | `user.email`     |
| `firstName` | `user.firstName` |
| `lastName`  | `user.lastName`  |

4. Clicca su **Avanti** e poi su **Fine**

### Passo 5: Assegna Utenti e Gruppi

1. Nella tua applicazione Okta, vai alla scheda **Assegnazioni**
2. Clicca su **Assegna** > **Assegna alle Persone** o **Assegna ai Gruppi**
3. Seleziona gli utenti o i gruppi a cui vuoi concedere l'accesso SSO
4. Clicca su **Assegna** per ogni selezione, poi clicca su **Fine**

### Passo 6: Verifica la Configurazione

1. Salva tutte le impostazioni sia in Okta sia in OneUptime
2. Prova ad accedere a OneUptime usando SSO
3. Dovresti essere reindirizzato alla pagina di login Okta e di nuovo a OneUptime dopo l'autenticazione riuscita

### Risoluzione dei Problemi con Okta

- **404 o URL SSO Non Valido**: Verifica che il **Single sign-on URL** in Okta corrisponda esattamente al **Reply URL** di OneUptime
- **Mancata Corrispondenza Audience**: Assicurati che l'**Audience URI** in Okta corrisponda esattamente all'**Identifier (Entity ID)** di OneUptime
- **Errore Certificato**: Assicurati di aver scaricato il certificato per il certificato di firma **attivo**, non uno inattivo
- **Utente Non Assegnato**: Gli utenti devono essere assegnati all'applicazione Okta prima di poter accedere tramite SSO
- **Errore Name ID**: Verifica che il **Formato Name ID** sia impostato su `EmailAddress` e che il **Nome utente applicazione** sia impostato su `Email`

---

## Altri Provider di Identità

L'implementazione SSO di OneUptime usa il protocollo SAML 2.0 e dovrebbe funzionare con qualsiasi provider di identità conforme. I passaggi generali di configurazione sono:

1. In OneUptime, crea una configurazione SSO e nota l'**Identifier (Entity ID)** e il **Reply URL (Assertion Consumer Service URL)** dal pulsante **Visualizza Config SSO**
2. Nel tuo provider di identità, crea un'applicazione SAML usando:
   - **Assertion Consumer Service URL / Reply URL**: Dalla configurazione SSO di OneUptime
   - **Entity ID / Audience URI**: Dalla configurazione SSO di OneUptime
   - **Formato Name ID**: Indirizzo email
3. Dal tuo provider di identità, copia i seguenti dati in OneUptime:
   - **Sign On URL** (endpoint SSO)
   - **Issuer** (Entity ID dell'IdP)
   - **Certificato Pubblico** (certificato di firma X.509)
4. Imposta l'**Algoritmo di Firma** su `RSA-SHA-256` e l'**Algoritmo Digest** su `SHA256`

## Note su SSO e Ruoli

OneUptime attualmente non supporta il mapping dei ruoli SAML dal tuo provider di identità. L'accesso basato sui ruoli deve essere configurato separatamente all'interno delle **Impostazioni Progetto** > **SSO** di OneUptime, dove puoi assegnare ruoli predefiniti per gli utenti SSO.
