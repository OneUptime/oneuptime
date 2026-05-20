# Condivisione e dashboard pubbliche

La maggior parte delle dashboard è privata al tuo progetto — solo i membri del progetto autenticati possono vederle. Ma OneUptime ti permette anche di pubblicare una dashboard su un URL pubblico, proteggerla opzionalmente con una password, restringerla per IP e ospitarla su un dominio personalizzato. Questa pagina copre tutti e quattro gli aspetti.

## Dashboard private (il default)

Di default, una dashboard è raggiungibile solo da utenti autenticati che sono membri del progetto. L'URL ha l'aspetto `https://oneuptime.com/dashboards/<id>/view`. L'accesso diretto richiede autenticazione e il permesso di lettura appropriato sulla dashboard.

All'interno del progetto, ownership e label controllano chi vede cosa — vedi [Configurazione e permessi](/docs/dashboards/configuration).

## Dashboard pubbliche

In **Dashboard → Settings**, attiva **Public Dashboard**. La dashboard ora ha un secondo URL che non richiede login. Condividila con fornitori, partner, clienti o incollala in un README pubblico.

Una dashboard pubblica:

- Si renderizza solo in modalità **View**. I visitatori pubblici non possono modificare, vedere la palette dei widget o cambiare URL dell'intervallo temporale a parte.
- Include le variabili che hai definito — i visitatori possono scegliere dai drop-down esattamente come gli utenti interni.
- Porta con sé il **branding** che configuri in Settings: titolo della pagina, descrizione della pagina, file del logo, favicon. Sono questi che compaiono nella scheda del browser e nelle anteprime social.

Tratta l'abilitazione di **Public Dashboard** come la pubblicazione di una pagina web. Ogni widget sulla dashboard è ora leggibile da chiunque al mondo. Fai un audit di cosa c'è sul canvas prima di attivare l'interruttore.

## Password master

Per proteggere una dashboard pubblica con una password invece di renderla totalmente aperta:

1. Abilita **Public Dashboard**.
2. Abilita **Master Password**.
3. Imposta la password.

I visitatori atterrano su un prompt per la password prima che la dashboard venga renderizzata. La password viene hashata a riposo; viene memorizzato solo l'hash.

Usa una password master quando:

- Vuoi condividere con un partner o un cliente ma non vuoi che l'URL sia valido se trapela.
- La dashboard è "semi-pubblica" — abbastanza aperta da non voler creare account OneUptime per ogni visualizzatore, ma non così tanto da metterla sull'internet aperta.

Per una protezione di valore più alto (account per ogni visualizzatore, audit trail di chi ha visto cosa), mantieni la dashboard privata e invita i visualizzatori al progetto come membri in sola lettura.

## Allowlist di IP

Sul piano **Scale**, puoi restringere una dashboard pubblica a una lista di IP sorgente o range CIDR. Configura la lista in **Dashboard → Settings → IP Whitelist**.

Usa una allowlist di IP quando:

- La dashboard dovrebbe essere raggiungibile solo dal tuo ufficio o dalla VPN.
- Un portale per fornitori dovrebbe essere raggiungibile solo dagli IP egress pubblicati dal fornitore.
- Vuoi difesa in profondità sopra una password master.

Le richieste da qualsiasi altro IP ricevono un 403.

## Domini personalizzati

Out of the box, una dashboard pubblica viene servita su `oneuptime.com`. Per ospitarla sul tuo sottodominio (es. `dashboard.acme.com`):

1. Aggiungi un record CNAME sul tuo DNS che punti il sottodominio al target pubblicato da OneUptime.
2. In **Dashboard → Settings → Custom Domains**, aggiungi il dominio.
3. Verifica il record DNS (OneUptime lo controlla per te).
4. Una volta verificato, la dashboard è raggiungibile sia sull'URL OneUptime sia sul tuo dominio personalizzato.

I domini personalizzati sono utili per:

- Dashboard rivolte ai clienti con il tuo brand.
- Dashboard partner co-brandizzate.
- SEO su una pagina pubblica di salute.

Puoi associare più domini personalizzati a una sola dashboard se servi lo stesso contenuto a pubblici diversi.

## Branding per le dashboard pubbliche

In **Dashboard → Settings**, configura:

- **Titolo della pagina** — il tag `<title>` e l'intestazione che vedono i visitatori.
- **Descrizione della pagina** — la meta description usata dai motori di ricerca e dalle anteprime social.
- **File del logo** — carica un PNG/SVG; mostrato nell'header della dashboard.
- **Favicon** — caricato; mostrato nella scheda del browser.

Il branding si applica solo al rendering in modalità pubblica. I visualizzatori interni vedono sempre il branding di OneUptime.

## Embedding

Puoi embeddare una dashboard pubblica in un `<iframe>` sul tuo sito:

```html
<iframe src="https://dashboard.acme.com/view"
        width="100%" height="800"
        frameborder="0"></iframe>
```

Se embeddi una dashboard protetta da password master, il visitatore vede comunque il prompt della password dentro l'iframe.

## URL condivisibili con lo stato delle variabili

L'URL della dashboard codifica le selezioni correnti delle variabili e l'intervallo temporale come query parameter. Regola i drop-down, copia l'URL e incollalo in chat — il destinatario vede la dashboard con esattamente la stessa vista, incluso l'intervallo temporale che stavi guardando.

È il modo più rapido per puntare un collega a "la dashboard al momento di inizio dell'incidente" — pinna l'intervallo temporale, copia, incolla.

## Cosa leggere dopo

- [Configurazione e permessi](/docs/dashboards/configuration) — controllo accessi in modalità privata.
- [Variabili e filtri](/docs/dashboards/variables) — variabili con cui i visitatori pubblici possono interagire.
- [Creare una dashboard](/docs/dashboards/authoring) — cosa va sul canvas in primo luogo.
