# Aiuto e supporto

Indirizza l'aiuto che OneUptime offre verso il tuo team: l'indirizzo di supporto, la chat e la pagina di aiuto che le persone vedono, dove va **Invia un feedback**, cosa dice il single sign-on a chi ha bisogno di un invito, e i suggerimenti per scaricare l'app mobile. Ognuno può restare su quello di OneUptime, puntare a un tuo indirizzo o link, oppure essere nascosto.

:::cards
- [Cambiare dove porta l'aiuto](#cambiare-dove-porta-laiuto): Una sola pagina nell'Admin Dashboard.
- [Cosa cambia ogni impostazione](#cosa-cambia-ogni-impostazione): Ogni punto, il suo valore predefinito e le sue scelte.
- [Invia un feedback](#invia-un-feedback): Dove viene inviato ciò che le persone scrivono.
- [Il messaggio di accesso](#il-messaggio-di-accesso): A chi chiedere un invito.
- [Definire le impostazioni dalla tua configurazione](#definire-le-impostazioni-dalla-tua-configurazione): Valori Helm o `config.env`, per un nuovo server.
:::

## Cambiare dove porta l'aiuto

:::steps
### Aprire Aiuto e supporto
Nell'Admin Dashboard, apri **Impostazioni**, poi **Aiuto e supporto** nel menu laterale.

### Cambiare un punto
Seleziona **Cambia** accanto, scegli **Predefinito**, un tuo indirizzo o link, oppure **Nascondilo**, poi seleziona **Salva**. **Richiedi una demo** e **Segnala un bug o richiedi una funzionalità** sono interruttori, salvati non appena li sposti.

### Controllare cosa vedono le persone
Il menu Aiuto e la schermata di accesso sono mostrati in anteprima accanto alle loro impostazioni. Le persone vedono una modifica la prossima volta che aprono una pagina.
:::

Finché non cambi un punto, mostra ciò che OneUptime ha sempre mostrato, quindi un server che non apre mai la pagina appare esattamente come prima.

## Cosa cambia ogni impostazione

| Impostazione | Dove la vedono le persone | Predefinito | Personalizzato |
| --- | --- | --- | --- |
| **Email di supporto** | Aiuto › **Email di supporto**, **Contatta l'assistenza** nella pagina non trovata, le e-mail dell'account, e l'indirizzo a cui una schermata di errore chiede di inviare un pacchetto di supporto | `support@oneuptime.com` | Un indirizzo e-mail |
| **Chat** | Aiuto › **Chatta su Slack**, e il link di chat in alto nel riferimento API | La community di OneUptime su Slack | Un link. Un link di Slack o Microsoft Teams mantiene il suo nome; qualsiasi altro si chiama **Chatta con l'assistenza** |
| **Richiedi una demo** | Aiuto › **Richiedi una demo** | Mostrato | Solo nascosto |
| **Invia un feedback** | Aiuto › **Invia un feedback**, e **Invia un feedback** nella ricerca | Gli amministratori di questo server | Un indirizzo e-mail, o una pagina tua |
| **Aiuto e supporto** | **Aiuto e supporto** nel piè di pagina, **Contatto** nelle pagine di accesso, e **Supporto** in alto nel riferimento API | `https://oneuptime.com/support` | Un link |
| **Segnala un bug o richiedi una funzionalità** | Il fondo del menu dei prodotti, la issue pubblica su GitHub proposta dopo un feedback, e i link a GitHub della documentazione e del riferimento API | Mostrato | Solo nascosto |
| **Scarica l'app mobile** | **Come contattarmi**, la configurazione della reperibilità, i primi passi di un nuovo membro nella Home, e **App mobili** in **Impostazioni del progetto** | L'App Store e Google Play | Una pagina tua, ad esempio il portale aziendale del tuo gestore dei dispositivi |
| **Messaggio per chi ha bisogno di un invito** | Le schermate del single sign-on che dicono «You need to be invited.» e «No project access.» | La frase di OneUptime | Le tue parole |

Ogni impostazione tranne il messaggio può anche essere nascosta. Un link inizia con `https://`, `http://` o `mailto:`. Qualsiasi altro tipo di link, tra cui `javascript:`, viene rifiutato dalla pagina e di nuovo dal server.

Il menu Aiuto, il piè di pagina e il menu dei prodotti dell'Admin Dashboard stesso mantengono i link di OneUptime: sono per gli amministratori di questo server, che ricevono aiuto sul server da OneUptime.

### Le e-mail dell'account

Su un server self-hosted, le e-mail dell'account, come un invito o un cambio di indirizzo e-mail, si chiudono rimandando le persone all'amministratore di questo server, mai al supporto di OneUptime. Con un tuo indirizzo di supporto, lo riportano come link: «Serve aiuto? Scrivi a it-help@example.com.» Con il valore predefinito, o se l'impostazione è nascosta, restano come sono sempre state.

### La documentazione e il riferimento API

La documentazione e il riferimento API offerti da questo server seguono le stesse impostazioni. Con **Segnala un bug o richiedi una funzionalità** nascosto, nessuna pagina rimanda a GitHub, e la domanda **Questa pagina ti è stata utile?** compare solo dove la risposta viene conservata o inviata. La barra in alto del riferimento API mostra la chat e la pagina di aiuto che hai scelto, oppure nessuna delle due quando sono nascoste.

### Chi può leggere i tuoi link

L'indirizzo di supporto e il link **Aiuto e supporto** compaiono anche nelle pagine di accesso, quindi chiunque possa aprire quelle pagine può leggerli. Un link di chat e la pagina dell'app mobile vengono inviati solo alle persone che hanno effettuato l'accesso: un link di chat è spesso un invito nel tuo workspace. Per lo stesso motivo, la documentazione e il riferimento API, che chiunque può leggere, mostrano un tuo link di chat solo a chi ha effettuato l'accesso a questo server.

## Invia un feedback

| Scelta | Cosa succede |
| --- | --- |
| **Predefinito** | Come sempre: inviato via e-mail all'**E-mail di notifica admin** impostata in **Impostazioni** › **E-mail**, o conservato per gli amministratori di questo server in **Feedback** se non ce n'è una. Su OneUptime Cloud va al team di OneUptime. |
| **Un indirizzo e-mail** | Inviato via e-mail a quell'indirizzo tramite le impostazioni e-mail di questo server, con il nome e l'indirizzo e-mail della persona, così il tuo team può rispondere. La persona riceve una copia. |
| **Una pagina tua** | **Invia un feedback** la apre in una nuova scheda, ad esempio il modulo del tuo help desk. Da OneUptime non viene inviato nulla. |
| **Nascondi «Invia un feedback»** | **Invia un feedback** non viene offerto da nessuna parte. |

Finché il server non può inviare e-mail, scegliere un indirizzo e-mail nasconde **Invia un feedback** invece di accettare un messaggio che non può raggiungere il tuo team, e la pagina delle impostazioni lo segnala. Configura l'e-mail in **Impostazioni** › **E-mail**, e **Invia un feedback** torna da solo.

Le domande che OneUptime pone, come quanto è stata facile una configurazione guidata, non sono **Invia un feedback**: le loro risposte restano in **Feedback**, dove **Chiedi com'è andata** le disattiva.

## Il messaggio di accesso

Il single sign-on proprio del server respinge due tipi di persone: chi non ha un account, finché il provider non ne crea uno («You need to be invited.»), e chi ha un account che non fa parte di alcun progetto («No project access.»). Entrambi hanno bisogno di un invito, quindi entrambe le schermate mostrano il tuo messaggio, indicando a chi chiedere e come raggiungerlo:

```text
Ask the IT service desk to invite you to OneUptime:
it-help@example.com or https://help.example.com/oneuptime
```

- Il messaggio è testo semplice di al massimo 1000 caratteri, e non può contenere `<` o `>`.
- Ogni riga è un paragrafo, e link e indirizzi e-mail al suo interno diventano link.
- Il titolo della schermata resta com'è, e l'app mobile mostra le stesse parole.

## I suggerimenti per scaricare l'app mobile

Con una pagina tua, ogni suggerimento per scaricare l'app mobile punta lì: un solo codice QR per la tua pagina, con il suo indirizzo come nome, e i passaggi continuano a indicare l'indirizzo di questo server a cui l'app si collega. Se l'impostazione è nascosta, non c'è alcun suggerimento:

- **Scarica l'app mobile** scompare dai primi passi di un nuovo membro nella Home, che si completano comunque quando la persona è raggiungibile e una chiamata di test l'ha raggiunta.
- **Come contattarmi** e la configurazione della reperibilità offrono solo i browser.
- **App mobili** scompare da **Impostazioni del progetto**.
- Ovunque OneUptime elenchi i modi per raggiungere qualcuno, come le configurazioni guidate, la Home, le regole di conformità di un team e Chiedi all'IA, l'app non compare più tra questi.

## Definire le impostazioni dalla tua configurazione

Un server installato con Helm o Docker Compose può avviarsi con queste impostazioni già configurate. Impostale nei valori `helpAndSupport` del chart Helm, oppure in `config.env` per Docker Compose:

```yaml
helpAndSupport:
  supportEmail: it-help@example.com
  chat: https://example.slack.com/archives/C024BE91L
  requestDemo: hidden
  gitHub: hidden
  inviteMessage: |
    Ask the IT service desk to invite you to OneUptime:
    it-help@example.com
```

| Valore Helm | `config.env` | Che cosa accetta |
| --- | --- | --- |
| `supportEmail` | `HELP_AND_SUPPORT_SUPPORT_EMAIL` | Un indirizzo e-mail, o `hidden` |
| `chat` | `HELP_AND_SUPPORT_CHAT` | Un link, o `hidden` |
| `requestDemo` | `HELP_AND_SUPPORT_REQUEST_DEMO` | `shown` o `hidden` |
| `giveFeedback` | `HELP_AND_SUPPORT_GIVE_FEEDBACK` | Un indirizzo e-mail, un link o `hidden` |
| `helpLink` | `HELP_AND_SUPPORT_HELP_LINK` | Un link, o `hidden` |
| `gitHub` | `HELP_AND_SUPPORT_GITHUB` | `shown` o `hidden` |
| `mobileApp` | `HELP_AND_SUPPORT_MOBILE_APP` | Un link, o `hidden` |
| `inviteMessage` | `HELP_AND_SUPPORT_INVITE_MESSAGE` | Testo semplice |

- I valori vengono letti all'avvio del server, e solo finché in **Aiuto e supporto** non è stato salvato nulla. Da quel momento le impostazioni sono quelle della pagina: una modifica fatta lì viene mantenuta, e un riavvio non la annulla mai.
- Un valore cambiato in seguito nella configurazione non viene applicato, e il log del server lo segnala. Cambialo nella pagina.
- Ogni valore viene verificato come lo verifica la pagina. Uno che verrebbe rifiutato, come un link `javascript:`, viene escluso, e la pagina e il log del server ne spiegano il motivo. Gli altri vengono impostati comunque.
- Lascia un valore vuoto per mantenere il valore predefinito di OneUptime. Per i due interruttori funzionano anche `true` e `false`.
- La pagina segnala ogni impostazione che proviene dalla tua configurazione, finché non la cambi.

## Passaggi successivi

:::cards
- [SSO globale](/docs/identity/global-sso): Il single sign-on proprio del server.
- [Durata della sessione](/docs/self-hosted/session-length): Per quanto tempo le persone restano connesse.
:::
