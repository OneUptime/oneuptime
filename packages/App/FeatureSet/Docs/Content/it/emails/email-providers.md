# Provider email

Invia la posta di OneUptime tramite l'API HTTPS di un provider email invece che tramite un server SMTP: Amazon SES, SendGrid, Mailgun, Postmark o Resend. Un progetto ne sceglie uno per una configurazione SMTP, e un'installazione self-hosted può inviare tutta la propria posta tramite uno di essi. L'API si raggiunge tramite HTTPS sulla porta 443, quindi la posta parte anche dalle reti che bloccano le porte SMTP, e la chiave di ogni provider viene memorizzata cifrata.

:::cards
- [Amazon SES](#amazon-ses): Una chiave di accesso IAM e la regione in cui è verificato il tuo mittente.
- [SendGrid](#sendgrid): Una chiave API con accesso a Mail Send.
- [Mailgun](#mailgun): Una chiave API, il dominio di invio e la sua regione.
- [Postmark](#postmark): Il token API del server.
- [Resend](#resend): Una chiave API con accesso all'invio.
- [Risoluzione dei problemi](#risoluzione-dei-problemi): Cosa significa il rifiuto di ciascun provider.
:::

## Scegliere un provider

:::tabs
@tab Progetto
In **Impostazioni del progetto > Notifiche > Impostazioni notifiche**, apri **Altre impostazioni** e fai clic su **Crea: SMTP Configurazione** nella scheda **Configurazioni SMTP personalizzate**. Nel passaggio **Provider**, inserisci un **Nome** e scegli il provider. Il passaggio successivo chiede le impostazioni di quel provider, e il passaggio **Mittente** l'**Email mittente** e il **Nome mittente**. Una volta salvata la configurazione, **Invia e-mail di prova** sulla sua riga verifica che funzioni.
@tab Istanza self-hosted
Nell'Admin Dashboard, apri **Impostazioni**, poi **Notifiche > E-mail**. Nella scheda **Impostazioni del server e-mail**, fai clic su **Modifica server** e scegli il provider come **Tipo di server email**. Sotto compare la scheda del provider, ad esempio **Impostazioni Amazon SES**: fai clic sul suo pulsante di modifica, ad esempio **Modifica Amazon SES**, e compila le impostazioni del provider e il passaggio **Mittente**. Finché manca qualcosa, la scheda dice cosa manca, e ogni e-mail viene rifiutata indicando l'impostazione da compilare.
:::

| Provider | Cosa chiede | Dove invia OneUptime |
| --- | --- | --- |
| Amazon SES | ID chiave di accesso, Chiave di accesso segreta, Regione | `https://email.<region>.amazonaws.com` (API SES v2) |
| SendGrid | Chiave API | `https://api.sendgrid.com/v3/mail/send` |
| Mailgun | Chiave API, Dominio, Regione | `https://api.mailgun.net` o `https://api.eu.mailgun.net` |
| Postmark | Token API del server | `https://api.postmarkapp.com/email` |
| Resend | Chiave API | `https://api.resend.com/emails` |

Ogni e-mail viene inviata con la sua parte di testo, e le sue immagini (il logo di OneUptime, gli screenshot) come allegati inline. Quando un provider limita la velocità con cui invii, o ha un errore dalla sua parte, OneUptime riprova dopo l'attesa richiesta dal provider; qualsiasi altro rifiuto viene conservato nei registri di notifica, con la risposta del provider.

## Amazon SES

:::steps
### Verificare il mittente

Nella [console di Amazon SES](https://console.aws.amazon.com/ses/), nella regione da cui invierai, verifica in **Identities** l'indirizzo da cui invii o il suo dominio. Finché il tuo account è nella sandbox di SES, verifica anche ogni destinatario, oppure richiedi l'accesso in produzione.

### Creare una chiave di accesso

Crea un utente IAM per OneUptime con una policy che consenta `ses:SendEmail` sulla tua identità, poi crea una chiave di accesso per quell'utente:

```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": "ses:SendEmail",
      "Resource": "arn:aws:ses:us-east-1:123456789012:identity/example.com"
    }
  ]
}
```

### Compilare il passaggio Amazon SES

Inserisci l'**ID chiave di accesso** e la **Chiave di accesso segreta**, e la **Regione** in cui è verificata la tua identità, ad esempio `us-east-1`.
:::

## SendGrid

In SendGrid, apri **Settings > API Keys**, crea una chiave con accesso a **Mail Send** e verifica l'indirizzo da cui invii (Single Sender Verification) o il suo dominio (Domain Authentication). Inserisci la chiave come **Chiave API** nel passaggio **SendGrid**.

## Mailgun

In Mailgun, aggiungi e verifica il tuo dominio di invio, ad esempio `mg.example.com`, poi crea una chiave di invio per quel dominio, oppure usa la chiave API del tuo account. Nel passaggio **Mailgun**, inserisci la **Chiave API** e il **Dominio**, e scegli la **Regione** in cui è stato creato il dominio: `EU` per un dominio nella regione UE di Mailgun, `US` per gli altri. L'**Email mittente** deve essere un indirizzo di quel dominio. Un dominio sandbox invia solo ai suoi destinatari autorizzati.

## Postmark

In Postmark, apri il server che invia, poi la sua scheda **API Tokens**, e copia il token API del server: un token dell'account non invia. Inseriscilo come **Token API del server** nel passaggio **Postmark**. L'**Email mittente** deve essere una firma mittente confermata, oppure un indirizzo di un dominio verificato. Finché Postmark non approva il tuo account, invia solo a indirizzi del tuo dominio.

## Resend

In Resend, aggiungi e verifica il tuo dominio in **Domains**, poi crea in **API Keys** una chiave API con accesso all'invio. Inseriscila come **Chiave API** nel passaggio **Resend**, con un'**Email mittente** del tuo dominio verificato. Il dominio di test di Resend invia solo al tuo indirizzo.

## Risoluzione dei problemi

Un'e-mail di prova che non parte dice perché. Per qualsiasi altra e-mail, apri la scheda **E-mail** di **Impostazioni del progetto > Notifiche > Registri di notifica** e seleziona **Visualizza messaggio di stato** sulla sua riga.

:::details "Amazon SES needs a verified identity in …"
L'**Email mittente**, o il suo dominio, non è verificato nella regione impostata nella configurazione, oppure l'account è nella sandbox di SES e il destinatario non è verificato. Verificalo in quella regione, oppure richiedi l'accesso in produzione.
:::

:::details "Amazon SES does not recognize the access key" o "did not accept the request's signature"
Controlla l'**ID chiave di accesso**, che la chiave sia attiva in IAM e che la **Chiave di accesso segreta** sia quella creata insieme a essa. Una firma viene rifiutata anche quando l'orologio del server non è corretto.
:::

:::details "The access key may not send with Amazon SES"
La policy dell'utente IAM non consente `ses:SendEmail` sulla tua identità. Aggiungi la policy indicata sopra.
:::

:::details "Mailgun has no domain … in its US region"
Il dominio non è nella regione a cui invia la configurazione. Controlla il **Dominio**, e imposta la **Regione** su `EU` se il dominio è stato creato lì.
:::

:::details "is not a confirmed sender signature in Postmark" o "is not a verified domain in Resend"
Conferma l'**Email mittente** come mittente, oppure verifica il suo dominio, nella dashboard del provider.
:::

:::details "did not accept the API key" o "did not accept the server API token"
Controlla la chiave nella configurazione: quella di SendGrid richiede l'accesso a Mail Send, la chiave di invio di Mailgun funziona solo per il proprio dominio, Postmark richiede il token del server, e quella di Resend richiede l'accesso all'invio.
:::

## Passaggi successivi

:::cards
- [SMTP](/docs/emails/smtp): Inviare invece tramite il tuo server di posta o Microsoft 365.
- [Iscritti e annunci](/docs/status-pages/subscribers): Inviare la posta agli iscritti di una pagina di stato con una configurazione SMTP del progetto.
:::
