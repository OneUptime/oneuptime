# Provider email

Invia la posta di OneUptime tramite l'API HTTPS di un provider email invece che tramite un server SMTP: Amazon SES, SendGrid, Mailgun, Postmark o Resend. Un progetto ne sceglie uno per una configurazione SMTP, e un'installazione self-hosted può inviare tutta la propria posta tramite uno di essi. L'API si raggiunge tramite HTTPS sulla porta 443, quindi la posta parte anche dalle reti che bloccano le porte SMTP, e la chiave di ogni provider viene memorizzata cifrata.

:::cards
- [Amazon SES](#amazon-ses): Una chiave di accesso IAM, o il ruolo IAM del server stesso, e la regione in cui è verificato il tuo mittente.
- [SendGrid](#sendgrid): Una chiave API con accesso a Mail Send.
- [Mailgun](#mailgun): Una chiave API, il dominio di invio e la sua regione.
- [Postmark](#postmark): Il token API del server.
- [Resend](#resend): Una chiave API con accesso all'invio.
- [Variabili d'ambiente](#impostare-le-mail-del-server-con-variabili-dambiente): Imposta l'e-mail di un server self-hosted dai values di Helm o da `config.env`.
- [Risoluzione dei problemi](#risoluzione-dei-problemi): Cosa significa il rifiuto di ciascun provider.
:::

## Scegliere un provider

:::tabs
@tab Progetto
In **Impostazioni del progetto > Notifiche > Canali di notifica**, apri **Altre impostazioni** e fai clic su **Crea: Configurazione SMTP** nella scheda **Configurazioni SMTP personalizzate**. Nel passaggio **Provider**, inserisci un **Nome** e scegli il provider. Il passaggio successivo chiede le impostazioni di quel provider, e il passaggio **Mittente** l'**Email mittente** e il **Nome mittente**. Una volta salvata la configurazione, **Invia e-mail di prova** sulla sua riga verifica che funzioni.
@tab Istanza self-hosted
Nell'Admin Dashboard, apri **Impostazioni**, poi **Notifiche > E-mail**. Nella scheda **Impostazioni del server e-mail**, fai clic su **Modifica server** e scegli il provider come **Tipo di server email**. Sotto compare la scheda del provider, ad esempio **Impostazioni Amazon SES**: fai clic sul suo pulsante di modifica, ad esempio **Modifica Amazon SES**, e compila le impostazioni del provider e il passaggio **Mittente**. Finché manca qualcosa, la scheda dice cosa manca, e ogni e-mail viene rifiutata indicando l'impostazione da compilare. Un server distribuito da codice può invece impostarle con variabili d'ambiente: vedi [Impostare l'e-mail del server con variabili d'ambiente](#impostare-le-mail-del-server-con-variabili-dambiente).
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

Un'installazione self-hosted su AWS può fare a meno della chiave e [accedere con il ruolo IAM del server](#accedere-con-il-ruolo-iam-del-server), con la stessa policy.

### Compilare il passaggio Amazon SES

Inserisci l'**ID chiave di accesso** e la **Chiave di accesso segreta**, e la **Regione** in cui è verificata la tua identità, ad esempio `us-east-1`.
:::

### Accedere con il ruolo IAM del server

Un'installazione self-hosted su AWS può inviare le proprie e-mail come il ruolo IAM che AWS assegna al server, senza alcuna chiave di accesso memorizzata in OneUptime: le credenziali che AWS fornisce scadono nel giro di ore, e OneUptime ne ottiene di nuove prima che scadano. Vale solo per le e-mail del server stesso. La configurazione Amazon SES di un progetto accede sempre con una chiave di accesso, perché il ruolo del server è l'identità AWS del server stesso, non quella di un progetto.

Assegna al ruolo la policy indicata sopra, poi esegui OneUptime con quel ruolo:

:::tabs
@tab Amazon EKS
Con i ruoli IAM per gli account di servizio, crea il ruolo con una policy di attendibilità per il provider OIDC del tuo cluster, e fai creare al chart Helm un account di servizio con l'ARN del ruolo. I pod app e worker di OneUptime vengono eseguiti con quell'account:

```yaml title="values.yaml"
serviceAccount:
  create: true
  annotations:
    eks.amazonaws.com/role-arn: arn:aws:iam::123456789012:role/oneuptime-ses
```

Con EKS Pod Identity, crea invece un'associazione Pod Identity tra il ruolo e quell'account di servizio, e ometti l'annotazione.
@tab Amazon ECS
Imposta il ruolo come **Task role** della definizione di task di OneUptime.
@tab Amazon EC2
Collega il ruolo all'istanza come suo profilo dell'istanza. Con OneUptime in Docker sull'istanza, porta a 2 il limite di hop dei metadati dell'istanza, così che i container possano raggiungerli:

```bash
aws ec2 modify-instance-metadata-options --instance-id <instance-id> --http-put-response-hop-limit 2 --http-endpoint enabled
```
:::

Poi, nell'Admin Dashboard, fai clic su **Modifica Amazon SES**, scegli **Ruolo IAM di questo server** come **Tipo di autenticazione** e inserisci la **Regione**. Il salvataggio rimuove qualsiasi chiave di accesso memorizzata prima.

OneUptime cerca le credenziali del server dove le cercano gli SDK di AWS, in quest'ordine: `AWS_ACCESS_KEY_ID` e `AWS_SECRET_ACCESS_KEY` nel suo ambiente, un token di identità web (`AWS_ROLE_ARN` e `AWS_WEB_IDENTITY_TOKEN_FILE`), l'endpoint delle credenziali dei container di Amazon ECS ed EKS Pod Identity, poi il servizio di metadati dell'istanza di EC2 (IMDSv2).

## SendGrid

In SendGrid, apri **Settings > API Keys**, crea una chiave con accesso a **Mail Send** e verifica l'indirizzo da cui invii (Single Sender Verification) o il suo dominio (Domain Authentication). Inserisci la chiave come **Chiave API** nel passaggio **SendGrid**.

## Mailgun

In Mailgun, aggiungi e verifica il tuo dominio di invio, ad esempio `mg.example.com`, poi crea una chiave di invio per quel dominio, oppure usa la chiave API del tuo account. Nel passaggio **Mailgun**, inserisci la **Chiave API** e il **Dominio**, e scegli la **Regione** in cui è stato creato il dominio: `EU` per un dominio nella regione UE di Mailgun, `US` per gli altri. L'**Email mittente** deve essere un indirizzo di quel dominio. Un dominio sandbox invia solo ai suoi destinatari autorizzati.

## Postmark

In Postmark, apri il server che invia, poi la sua scheda **API Tokens**, e copia il token API del server: un token dell'account non invia. Inseriscilo come **Token API del server** nel passaggio **Postmark**. L'**Email mittente** deve essere una firma mittente confermata, oppure un indirizzo di un dominio verificato. Finché Postmark non approva il tuo account, invia solo a indirizzi del tuo dominio.

## Resend

In Resend, aggiungi e verifica il tuo dominio in **Domains**, poi crea in **API Keys** una chiave API con accesso all'invio. Inseriscila come **Chiave API** nel passaggio **Resend**, con un'**Email mittente** del tuo dominio verificato. Il dominio di test di Resend invia solo al tuo indirizzo.

## Impostare l'e-mail del server con variabili d'ambiente

Un server self-hosted distribuito da codice può partire inviando già e-mail, senza nulla da configurare a mano: imposta le sue impostazioni e-mail con variabili d'ambiente, da Terraform o da ciò che distribuisce OneUptime. Non appena `GLOBAL_EMAIL_SERVER_TYPE` è impostata, il server invia le proprie e-mail come descrivono le variabili. Le impostazioni salvate nell'Admin Dashboard in **Impostazioni**, poi **Notifiche > E-mail**, non vengono usate, e quella pagina mostra queste in sola lettura, ogni campo con la variabile che lo imposta. Lascia vuota `GLOBAL_EMAIL_SERVER_TYPE` per configurare invece l'e-mail nell'Admin Dashboard. Le configurazioni SMTP dei progetti non cambiano.

| Variabile | Valore Helm | Che cosa contiene |
| --- | --- | --- |
| `GLOBAL_EMAIL_SERVER_TYPE` | `email.serverType` | `custom-smtp`, `sendgrid`, `amazon-ses`, `mailgun`, `postmark` o `resend`. Solo quando è impostata OneUptime legge le altre variabili |
| `GLOBAL_EMAIL_FROM_EMAIL` | `email.fromEmail` | L'indirizzo da cui parte ogni e-mail |
| `GLOBAL_EMAIL_FROM_NAME` | `email.fromName` | Il nome con cui parte ogni e-mail. Obbligatorio per `custom-smtp` e `sendgrid` |
| `GLOBAL_EMAIL_SMTP_TRANSPORT` | `email.smtp.transport` | `smtp` (anche quando è vuota), oppure `microsoft-graph` per inviare tramite Microsoft Graph con l'app OAuth |
| `GLOBAL_EMAIL_SMTP_HOST` | `email.smtp.host` | Il server di posta, ad esempio `smtp.example.com` |
| `GLOBAL_EMAIL_SMTP_PORT` | `email.smtp.port` | La sua porta, ad esempio `587` |
| `GLOBAL_EMAIL_SMTP_REQUIRE_TLS` | `email.smtp.requireTls` | `true` per inviare solo su una connessione cifrata con un certificato valido, oppure `false` (anche quando è vuota) |
| `GLOBAL_EMAIL_SMTP_AUTH_TYPE` | `email.smtp.authType` | `username-and-password` (anche quando è vuota), `oauth` o `none` |
| `GLOBAL_EMAIL_SMTP_USERNAME` | `email.smtp.username` | La casella con cui accedere, anche per `oauth`. Lasciala vuota insieme alla password per inviare senza accedere |
| `GLOBAL_EMAIL_SMTP_PASSWORD` | `email.smtp.password`, oppure un Secret indicato in `email.existingSecret.name` | La sua password |
| `GLOBAL_EMAIL_SMTP_OAUTH_PROVIDER_TYPE` | `email.smtp.oauth.providerType` | `client-credentials` (anche quando è vuota) o `jwt-bearer` |
| `GLOBAL_EMAIL_SMTP_OAUTH_CLIENT_ID` | `email.smtp.oauth.clientId` | Il client ID dell'app OAuth |
| `GLOBAL_EMAIL_SMTP_OAUTH_CLIENT_SECRET` | `email.smtp.oauth.clientSecret`, oppure un Secret indicato in `email.existingSecret.name` | Il suo client secret; per `jwt-bearer`, la sua chiave privata in formato PEM |
| `GLOBAL_EMAIL_SMTP_OAUTH_TOKEN_URL` | `email.smtp.oauth.tokenUrl` | Il suo URL del token |
| `GLOBAL_EMAIL_SMTP_OAUTH_SCOPE` | `email.smtp.oauth.scope` | Il suo scope |
| `GLOBAL_EMAIL_SENDGRID_API_KEY` | `email.sendgrid.apiKey`, oppure un Secret indicato in `email.existingSecret.name` | La chiave API di SendGrid |
| `GLOBAL_EMAIL_AMAZON_SES_AUTHENTICATION_TYPE` | `email.amazonSes.authenticationType` | `access-key` (anche quando è vuota), oppure `server-iam-role` per accedere con il ruolo IAM del server |
| `GLOBAL_EMAIL_AMAZON_SES_ACCESS_KEY_ID` | `email.amazonSes.accessKeyId` | L'ID della chiave di accesso |
| `GLOBAL_EMAIL_AMAZON_SES_SECRET_ACCESS_KEY` | `email.amazonSes.secretAccessKey`, oppure un Secret indicato in `email.existingSecret.name` | La sua chiave di accesso segreta |
| `GLOBAL_EMAIL_AMAZON_SES_REGION` | `email.amazonSes.region` | La regione in cui è verificato il tuo mittente, ad esempio `us-east-1` |
| `GLOBAL_EMAIL_MAILGUN_API_KEY` | `email.mailgun.apiKey`, oppure un Secret indicato in `email.existingSecret.name` | La chiave API di Mailgun |
| `GLOBAL_EMAIL_MAILGUN_DOMAIN` | `email.mailgun.domain` | Il dominio di invio, ad esempio `mg.example.com` |
| `GLOBAL_EMAIL_MAILGUN_REGION` | `email.mailgun.region` | `us` (anche quando è vuota) o `eu` |
| `GLOBAL_EMAIL_POSTMARK_SERVER_TOKEN` | `email.postmark.serverToken`, oppure un Secret indicato in `email.existingSecret.name` | Il token API del server di Postmark |
| `GLOBAL_EMAIL_RESEND_API_KEY` | `email.resend.apiKey`, oppure un Secret indicato in `email.existingSecret.name` | La chiave API di Resend |

Vengono usate solo le variabili che il tipo di server legge: le `GLOBAL_EMAIL_SMTP_` per `custom-smtp`, e quelle proprie di un provider per quel provider. Il log del server e l'Admin Dashboard indicano ogni altra variabile impostata, come non usata.

Con Helm, impostale sotto `email` nei tuoi values. Per tenere la password o la chiave fuori dai values che Helm salva con ogni release, mettila in un Secret tuo e indica quel Secret in `email.existingSecret.name`. Il chart la legge dalla chiave indicata in `email.existingSecret.key`, altrimenti dalla chiave che porta il suo nome: `smtpPassword`, `smtpOAuthClientSecret`, `sendgridApiKey`, `amazonSesSecretAccessKey`, `mailgunApiKey`, `postmarkServerToken` o `resendApiKey`.

```bash
kubectl create secret generic oneuptime-email --namespace oneuptime \
  --from-literal=smtpPassword=YOUR_SMTP_PASSWORD
```

```yaml
email:
  serverType: custom-smtp
  fromEmail: alerts@example.com
  fromName: OneUptime
  smtp:
    host: smtp.example.com
    port: 587
    requireTls: true
    username: alerts@example.com
  existingSecret:
    name: oneuptime-email
```

Il chart rifiuta altri valori di `email` senza `email.serverType`, impostazioni senza la password o la chiave che leggono, una password o una chiave indicata sia nei values sia in un Secret, e un Secret da cui le impostazioni non leggono nulla. Con Terraform, imposta gli stessi valori su un `helm_release`, con la password o la chiave come valore sensibile.

Con Docker Compose, imposta le voci `GLOBAL_EMAIL_` in `config.env`, poi esegui `npm run start` per ricreare i container.

OneUptime legge le variabili all'avvio. Se una è errata, per esempio una porta che non è un numero o una password mancante, il server non invia e-mail finché non viene corretta; il log del server, le impostazioni e-mail dell'Admin Dashboard e la checklist in `/admin/setup` indicano la variabile. Password e chiavi non vengono mai mostrate. Per cambiare le impostazioni, modifica le variabili e riavvia OneUptime: l'Admin Dashboard non le modifica.

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

:::details "This server has no AWS credentials"
Il server accede con il suo ruolo IAM, ma AWS non gli dà credenziali. Eseguilo con il ruolo, come mostra [Accedere con il ruolo IAM del server](#accedere-con-il-ruolo-iam-del-server), poi riavvia i pod o i task di OneUptime: un pod riceve le impostazioni del suo ruolo all'avvio. In Docker su Amazon EC2, il messaggio dice anche quando il limite di hop dei metadati dell'istanza è troppo basso.
:::

:::details "This server's IAM role may not send with Amazon SES" o "did not let this server assume the role"
La policy del ruolo non consente `ses:SendEmail` sulla tua identità: aggiungi la policy indicata sopra. Oppure, su Amazon EKS, la policy di attendibilità del ruolo non consente `sts:AssumeRoleWithWebIdentity` per il provider OIDC del tuo cluster e l'account di servizio di OneUptime.
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
