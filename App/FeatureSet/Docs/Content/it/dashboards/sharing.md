# Condivisione e dashboard pubbliche

Per impostazione predefinita, le dashboard sono private al tuo progetto — solo i membri del team autenticati possono vederle. Ma OneUptime ti permette anche di condividere una dashboard pubblicamente, proteggerla con una password, limitarla a determinati IP e ospitarla sul tuo dominio. Questa pagina copre tutti e quattro gli aspetti.

## Dashboard private (il default)

Una dashboard e raggiungibile solo dai membri autenticati del tuo progetto. L'URL e simile a `https://oneuptime.com/dashboards/<id>/view` e richiede l'accesso.

All'interno del progetto, proprietari ed etichette controllano chi vede cosa — vedi [Configurazione e permessi](/docs/dashboards/configuration).

## Dashboard pubbliche

Sotto **Dashboard → Settings**, attiva **Public Dashboard**. La dashboard ora ha un secondo URL che non richiede l'accesso. Condividilo con fornitori, partner, clienti o incollalo in un README pubblico.

Una dashboard pubblica:

- Si apre sempre in modalita **View**. I visitatori pubblici non possono modificare ne vedere la palette dei widget.
- Include le variabili che hai aggiunto. I visitatori scelgono dagli stessi menu a tendina che usa il tuo team.
- Usa il **branding** impostato in Settings — titolo della pagina, descrizione, logo, favicon.

Tratta l'attivazione di una dashboard pubblica come la pubblicazione di una pagina web. Ogni widget al suo interno diventa leggibile da chiunque. Controlla cosa c'e sul canvas prima di attivare l'interruttore.

## Password master

Per mettere una password su una dashboard pubblica:

1. Attiva **Public Dashboard**.
2. Attiva **Master Password**.
3. Imposta la password.

I visitatori vedono un prompt per la password prima che la dashboard appaia. La password e memorizzata come hash — non vediamo mai la password reale.

Usa una password master quando:

- Vuoi condividere con un partner o cliente ma non vuoi che l'URL sia utile in caso di fuga.
- La dashboard e "semi-pubblica" — abbastanza aperta da non voler invitare ogni visitatore come membro del team, ma non abbastanza aperta da metterla sull'internet pubblica.

Per un controllo piu stringente (account separati per ogni visitatore, una traccia di audit di chi ha visualizzato cosa), mantieni la dashboard privata e invita i visitatori come membri del team in sola lettura.

## Allowlist di IP

Sul piano **Scale**, puoi limitare una dashboard pubblica a un elenco di indirizzi IP o intervalli. Configuralo sotto **Dashboard → Settings → IP Whitelist**.

Usalo quando:

- La dashboard deve essere raggiungibile solo dal tuo ufficio o dalla VPN.
- Un portale fornitore dovrebbe essere raggiungibile solo dai loro IP noti.
- Vuoi una protezione extra in aggiunta a una password master.

Le richieste da qualsiasi altro IP vengono rifiutate.

## Domini personalizzati

Out of the box, una dashboard pubblica viene servita su `oneuptime.com`. Per ospitarla sul tuo sottodominio come `dashboard.acme.com`:

1. Aggiungi un record CNAME sul tuo DNS che punti il sottodominio al target di OneUptime.
2. Sotto **Dashboard → Settings → Custom Domains**, aggiungi il dominio.
3. Verificalo. OneUptime controlla il record DNS per te.
4. Una volta verificata, la dashboard e raggiungibile sia sul tuo dominio personalizzato sia sull'URL originale.

I domini personalizzati sono utili per:

- Dashboard rivolte ai clienti con il tuo brand.
- Dashboard partner co-brandizzate.
- Pagine di salute pubbliche con il proprio URL.

Puoi associare piu di un dominio personalizzato a una singola dashboard se servi lo stesso contenuto a piu pubblici.

## Branding

Sotto **Dashboard → Settings**, puoi configurare:

- **Titolo della pagina** — cosa appare nella scheda del browser e in cima alla pagina.
- **Descrizione della pagina** — la descrizione utilizzata dai motori di ricerca e dalle anteprime social.
- **Logo** — carica un PNG o SVG da mostrare nell'intestazione.
- **Favicon** — la piccola icona nella scheda del browser.

Il branding si applica solo quando la dashboard viene visualizzata pubblicamente. I visitatori interni vedono sempre il branding di OneUptime.

## Embedding

Puoi incorporare una dashboard pubblica nel tuo sito con un iframe:

```html
<iframe
  src="https://dashboard.acme.com/view"
  width="100%"
  height="800"
  frameborder="0"
></iframe>
```

Se la dashboard ha una password master, i visitatori vedranno il prompt per la password all'interno dell'iframe.

## URL condivisibili

L'URL della dashboard include le selezioni correnti delle variabili e l'intervallo temporale come parametri di query. Regola i menu a tendina, copia l'URL, incollalo in chat — la persona che apre il link vede la dashboard con esattamente la stessa vista.

E il modo piu veloce per puntare un collega a "la dashboard al momento dell'inizio dell'incidente." Blocca l'intervallo temporale, copia, incolla.

## Letture successive

- [Configurazione e permessi](/docs/dashboards/configuration) — controllo accessi in modalita privata.
- [Variabili e filtri](/docs/dashboards/variables) — variabili con cui i visitatori possono interagire.
- [Creazione di una dashboard](/docs/dashboards/authoring) — cosa va sul canvas.
