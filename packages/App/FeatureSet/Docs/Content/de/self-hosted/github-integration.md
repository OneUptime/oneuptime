# GitHub-Integration

Verbinden Sie Ihr selbst gehostetes OneUptime über eine eigene GitHub App mit GitHub. Sobald die App aus OneUptime heraus installiert ist, werden die Repositories der Installation in Ihr Projekt importiert und synchron gehalten, KI-Fix-Aufgaben öffnen Pull Requests, und Ihr Team kann der App in GitHub Arbeit übergeben, indem es sie erwähnt.

Diese Seite richtet sich an alle, die den OneUptime-Server betreiben: Sie erstellen die App einmal, und jedes Projekt verbindet sie danach unter **Code-Repositories**.

:::cards
- [Die GitHub App erstellen](#die-github-app-erstellen): Die App mit den richtigen URLs, Berechtigungen und Ereignissen registrieren.
- [OneUptime konfigurieren](#oneuptime-konfigurieren): Dem Server die sechs Werte der App geben.
- [Repositories verbinden](#repositories-verbinden): Die App aus OneUptime heraus installieren.
- [Fehlerbehebung](#fehlerbehebung): Was die Meldungen unter Code-Repositories bedeuten.
:::

## So funktioniert es

Die Installation beginnt in OneUptime, nicht auf GitHub: Der Link, mit dem OneUptime Sie zu GitHub schickt, verknüpft die Installation mit Ihrem Projekt.

```mermaid title="Eine Installation der GitHub App mit einem Projekt verbinden"
sequenceDiagram
    participant B as Ihr Browser
    participant O as OneUptime
    participant G as GitHub
    B->>O: Mit GitHub-App verbinden
    O-->>B: Weiterleitung zur Installationsseite der App
    B->>G: Die App installieren und autorisieren
    G-->>B: Weiterleitung zu /api/github/auth/callback
    B->>O: installation_id und ein einmaliger Code
    O->>G: Code tauschen, Installation prüfen
    O->>G: Repositories der Installation importieren
    G->>O: Webhooks an /api/github/webhook
```

- Die Weiterleitung im Browser trägt die Installation und einen einmaligen OAuth-Code. OneUptime tauscht den Code ein, um zu bestätigen, dass das GitHub-Konto, das die App installiert hat, diese Installation verwaltet, und importiert dann ihre Repositories.
- Webhooks halten die Liste der Repositories synchron und übergeben der App Arbeit: Erwähnungen, Zuweisungen, Trigger-Labels und Review-Anfragen. GitHub signiert jeden mit dem Webhook-Secret, und OneUptime lehnt jeden ab, den es nicht verifizieren kann.

## Bevor Sie beginnen

- Ein GitHub-Konto, das GitHub Apps für die Organisation oder den Benutzer erstellen kann, bei dem die App installiert wird. Um sie in einer Organisation zu installieren, müssen Sie deren Inhaber sein oder die Anfrage von einem Inhaber genehmigen lassen.
- Ein öffentlicher HTTPS-Hostname für OneUptime, den GitHub für Webhooks erreichen kann. Siehe [Netzwerkzugriff](#netzwerkzugriff-für-selbst-gehostete-installationen).
- Zugriff auf die Konfiguration des Servers: `config.env` bei Docker Compose oder Ihre Helm-Values bei Kubernetes.

## Die GitHub App erstellen

:::steps
### Die Einstellungen für GitHub Apps öffnen

- **Für eine Organisation:** `https://github.com/organizations/YOUR_ORG/settings/apps`
- **Für ein persönliches Konto:** `https://github.com/settings/apps`

Wählen Sie **New GitHub App**.

### Das Registrierungsformular ausfüllen

| Feld | Wert |
| --- | --- |
| **GitHub App name** | Ein beliebiger eindeutiger Name, zum Beispiel `OneUptime`. Notieren Sie ihn genau: Er ist `GITHUB_APP_NAME`. |
| **Homepage URL** | `https://your-oneuptime-domain.com` |
| **Callback URL** | `https://your-oneuptime-domain.com/api/github/auth/callback` |
| **Request user authorization (OAuth) during installation** | Ein. **Sie ist erforderlich**: Siehe den Hinweis unten. |
| **Setup URL** | `https://your-oneuptime-domain.com/api/github/auth/callback`, falls GitHub Sie eine eingeben lässt (siehe unten). |
| **Redirect on update** | Optional. Nachdem jemand eine Installation auf GitHub geändert hat, bringt OneUptime die Person zu **Code-Repositories**. |
| **Webhook URL** | `https://your-oneuptime-domain.com/api/github/webhook`, mit dem Webhook auf **Active**. |
| **Webhook secret** | Eine lange zufällige Zeichenfolge. Notieren Sie sie: Sie ist `GITHUB_APP_WEBHOOK_SECRET`. **Erforderlich**: OneUptime lehnt unsignierte Webhooks ab; bleibt `GITHUB_APP_WEBHOOK_SECRET` leer, stoppt das also die Synchronisierung der Repositories, statt unverifizierte Payloads anzunehmen. |

Laut der Dokumentation von GitHub können Sie mit eingeschaltetem **Request user authorization (OAuth) during installation** [keine Setup URL eingeben](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-setup-url): Nutzer werden nach der Installation stattdessen zur Callback URL geschickt. Beide zeigen auf dieselbe OneUptime-Adresse, die Weiterleitung landet also in jedem Fall an der richtigen Stelle.

> [!IMPORTANT]
> **Warum „Request user authorization (OAuth) during installation“ erforderlich ist.** Nach einer Installation leitet GitHub mit einer `installation_id` in der URL zurück. Diese Zahl allein beweist nichts darüber, wem die Installation gehört — jeder kann eine andere eintippen. Mit dieser Option liefert GitHub außerdem einen einmalig verwendbaren OAuth-`code`, der an das GitHub-Konto gebunden ist, das die Installation ausgeführt hat. OneUptime tauscht ihn ein, um zu bestätigen, dass dieses Konto die Installation wirklich verwaltet, bevor es sie mit Ihrem Projekt verbindet.
>
> Ohne sie weigert sich OneUptime, die Installation zu verbinden, und das Dashboard zeigt einen Fehler, der Sie bittet, diese Einstellung zu aktivieren. Das ist Absicht: Die Installations-ID unverifiziert zu übernehmen, würde einem OneUptime-Projekt erlauben, die Repositories einer anderen Organisation zu beanspruchen.

### Die Berechtigungen festlegen

Legen Sie unter **Permissions & events** diese **Repository permissions** fest:

| Berechtigung | Zugriff | Wofür OneUptime sie nutzt |
| --- | --- | --- |
| Contents | Read and write | Dateien des Repositorys lesen und die Branches von KI-Fix-Pull-Requests pushen |
| Pull requests | Read and write | Pull Requests öffnen und aktualisieren und Reviews veröffentlichen |
| Issues | Read and write | Die Kommentare der App veröffentlichen — **auch in Pull Requests**, deren Unterhaltung GitHub über die Issues-API leitet |
| Checks | Read-only | Optional. Das CI-Ergebnis von Fix-Pull-Requests lesen. Ohne sie bleibt deren CI-Status unverifiziert |
| Metadata | Read-only | Grundlegende Metadaten des Repositorys (von GitHub vorgeschrieben) |

**Erst Issues: Read and write macht die App interaktiv.** Ohne sie werden Erwähnungen empfangen und scheitern dann still, wenn die App antworten will — GitHub liefert Kommentare in Pull-Request-Unterhaltungen über die Issues-API aus, diese eine Berechtigung entscheidet also über jede Antwort der App. Siehe [Mit OneUptime aus GitHub arbeiten](/docs/ai/github-app).

OneUptime braucht keine Berechtigungen für Organisation oder Konto.

### Webhook-Ereignisse abonnieren

OneUptime nutzt zwei Gruppen von Ereignissen, und sie erfüllen verschiedene Aufgaben.

**Repository-Synchronisierung** — `installation` und `installation_repositories`. GitHub Apps erhalten sie automatisch; sie halten die Menge der verbundenen Repositories im Einklang damit, wo die App installiert ist.

**Die interaktive App** — diese Ereignisse müssen ausdrücklich abonniert werden, und jedes ermöglicht einen bestimmten Weg, der App Arbeit zu übergeben:

| Ereignis | Was es ermöglicht |
| --- | --- |
| **Issue comment** | `@mention`-Befehle in Issues **und** in Pull Requests |
| **Issues** | einem Issue die App zuweisen, und das Trigger-Label des Repositorys |
| **Pull request** | ein Review von der App anfordern |
| **Pull request review** | eine Erwähnung im Text eines abgeschickten Reviews |
| **Pull request review comment** | eine Erwähnung in einem Inline-Kommentar im Diff |

Ist keines davon abonniert, verbindet die GitHub App trotzdem Repositories und öffnet trotzdem Fix-Pull-Requests aus OneUptime — sie reagiert nur nie auf etwas, das in GitHub geschrieben wird. Das ist die häufigste Ursache für „der Bot ignoriert mich“. Siehe [Mit OneUptime aus GitHub arbeiten](/docs/ai/github-app), welche Befehle es gibt und wer sie geben darf.

Andere Ereignisse (**Push**, **Workflow run**) werden quittiert und ignoriert; sie zu abonnieren, aktiviert weder Benachrichtigungen noch CI/CD-Automatisierung.

### Festlegen, wo die App installiert werden kann

Wählen Sie unter **Where can this GitHub App be installed?**:

- **Only on this account** - Für die private/interne Nutzung
- **Any account** - Wenn andere Ihre App installieren sollen

### Die App erstellen und ihre IDs notieren

Wählen Sie **Create GitHub App**. GitHub öffnet die Einstellungsseite der App. Notieren Sie die **App ID** oben auf der Seite und die **Client ID** im Abschnitt **About**.

### Ein Client Secret erzeugen

Wählen Sie unter **Client secrets** die Option **Generate a new client secret**. Kopieren Sie es sofort: GitHub zeigt es nur einmal.

### Einen privaten Schlüssel erzeugen

Wählen Sie unter **Private keys** die Option **Generate a private key**. GitHub lädt eine `.pem`-Datei herunter. Bewahren Sie sie sicher auf: Mit ihr authentifiziert sich OneUptime als die App.
:::

## OneUptime konfigurieren

:::tabs
@tab Docker Compose
`config.env` enthält einen Wert pro Zeile, geben Sie den privaten Schlüssel also base64-kodiert in einer einzigen Zeile an. OneUptime dekodiert ihn:

```bash
base64 < private-key.pem | tr -d '\n'
```

```bash title="config.env"
GITHUB_APP_ID=YOUR_APP_ID
GITHUB_APP_NAME=YOUR_APP_NAME
GITHUB_APP_CLIENT_ID=YOUR_CLIENT_ID
GITHUB_APP_CLIENT_SECRET=YOUR_CLIENT_SECRET
GITHUB_APP_PRIVATE_KEY=YOUR_BASE64_ENCODED_PRIVATE_KEY
GITHUB_APP_WEBHOOK_SECRET=YOUR_WEBHOOK_SECRET
```

Wenden Sie die Änderung mit `npm run start` an, das die Container neu erstellt. `docker compose restart` liest `config.env` nicht neu ein.
@tab Kubernetes
```yaml title="values.yaml"
gitHubApp:
  id: "YOUR_APP_ID"
  name: "YOUR_APP_NAME" # The exact name of your GitHub App
  clientId: "YOUR_CLIENT_ID"
  clientSecret: "YOUR_CLIENT_SECRET"
  privateKey: "<BASE64_ENCODED_PRIVATE_KEY_CONTENT>"
  webhookSecret: "YOUR_WEBHOOK_SECRET"
```

`privateKey` nimmt auch das PEM selbst an, als mehrzeiligen Block (`privateKey: |`). Wenden Sie die Änderung mit `helm upgrade` an.
:::

Sobald OneUptime wieder läuft, zeigt **Code-Repositories** statt **Die GitHub-App ist auf diesem Server nicht konfiguriert** die Schaltfläche **Mit GitHub-App verbinden**.

### Referenz der Umgebungsvariablen

| Docker Compose (`config.env`) | Helm (`values.yaml`) | Wert |
| --- | --- | --- |
| `GITHUB_APP_ID` | `gitHubApp.id` | Die **App ID**. Dient der Authentifizierung als App. |
| `GITHUB_APP_NAME` | `gitHubApp.name` | Der genaue Name der App. Der Installationslink und das `@mention`-Handle der App (kleingeschrieben, Leerzeichen als Bindestriche) werden daraus gebildet. Ohne ihn kann **Code-Repositories** nicht verbinden. |
| `GITHUB_APP_CLIENT_ID` | `gitHubApp.clientId` | Die **Client ID**. Nötig, um zu prüfen, wer die App installiert hat. |
| `GITHUB_APP_CLIENT_SECRET` | `gitHubApp.clientSecret` | Das erzeugte Client Secret. Nötig zusammen mit der Client ID. |
| `GITHUB_APP_PRIVATE_KEY` | `gitHubApp.privateKey` | Der private Schlüssel: das PEM oder das PEM base64-kodiert. |
| `GITHUB_APP_WEBHOOK_SECRET` | `gitHubApp.webhookSecret` | Das Webhook-Secret. Jeder Webhook wird damit verifiziert, und ohne es wird keiner angenommen. |

Alle sechs sind erforderlich.

## Repositories verbinden

Starten Sie die Verbindung in OneUptime, nicht auf der Seite der App auf GitHub: Der Link, mit dem OneUptime Sie zu GitHub schickt, verknüpft die Installation mit Ihrem Projekt.

:::steps
1. Melden Sie sich bei Ihrem OneUptime-Dashboard an
2. Gehen Sie zu **Produkte** > **Aufgaben** > **Code-Repositories**
3. Klicken Sie auf **Mit GitHub-App verbinden**. OneUptime bringt Sie zu GitHub
4. Wählen Sie die Organisation oder das Konto, in dem die App installiert werden soll, und legen Sie fest, auf welche Repositories sie zugreifen darf: **All repositories** (alle aktuellen und künftigen Repositories) oder **Only select repositories**
5. Klicken Sie auf **Install** (oder **Save**, wenn die App dort bereits installiert ist)
6. GitHub schickt Sie zu **Code-Repositories** zurück, und jedes Repository der Installation wird importiert. Repositories, die später zur Installation hinzugefügt oder aus ihr entfernt werden, werden automatisch synchron gehalten.
:::

**Wer verbinden kann.** Das Verbinden importiert die Repositories der Installation in das Projekt und braucht deshalb die Berechtigung, Code-Repositories hinzuzufügen: **Project Owner**, **Project Admin**, **Project Member**, **Settings Admin**, **Settings Member** oder ein Team mit **Create Code Repository**. Ein Team, das die Berechtigung sperrt, entzieht sie. Auf OneUptime Cloud brauchen Code-Repositories den Growth-Tarif oder höher. Für alle anderen ist die Karte gesperrt und sagt, was nötig ist.

**Schließen Sie innerhalb von 15 Minuten im selben Browser ab.** Der Link funktioniert einmal, 15 Minuten lang, in dem Browser, in dem er gestartet wurde. Wenn GitHub Sie zurückschickt, prüft OneUptime die Berechtigung erneut, bevor es etwas importiert.

## Netzwerkzugriff für selbst gehostete Installationen

### Verkehrsrichtung und Endpunkte

| Verkehr | Erforderlicher Zugriff |
| --- | --- |
| OneUptime zu GitHub | DNS und ausgehendes HTTPS über TCP 443 zu `api.github.com` für Tokens der GitHub App und API-Aufrufe zu Repositories sowie zu `github.com` für den OAuth-Tokentausch und Git-Operationen über HTTPS |
| GitHub zu OneUptime | Öffentliches HTTPS über TCP 443 zu `POST /api/github/webhook` für die Synchronisierung von Installationen und Repository-Zugriff und für die interaktive App |
| Browser der Nutzer zu OneUptime | Dashboard-Zugriff und `GET /api/github/auth/callback` für Weiterleitungen bei Installation und Autorisierung; diese können über das VPN der Nutzer erreichbar bleiben |

Der Callback ist eine [Weiterleitung im Browser](https://docs.github.com/en/apps/creating-github-apps/registering-a-github-app/about-the-user-authorization-callback-url), der Webhook dagegen eine Anfrage von den Servern von GitHub. Die VPN-Verbindung eines Nutzers gibt GitHub keinen Zugriff auf den Webhook. Die Domains oben decken die Kernanfragen der Integration ab; zusätzliche Repository-Werkzeuge, Downloads, LFS oder Pakete können weitere Ziele erfordern. Diese Einstellungen beschreiben GitHub.com; eine Änderung der Firewall richtet keine Unterstützung für den Hostnamen eines GitHub Enterprise Server ein.

### Private Installationen und Callback-Sicherheit

Stellen Sie `/api/github/webhook` über ein öffentliches Gateway bereit, mit öffentlichem DNS, einem öffentlich vertrauenswürdigen HTTPS-Zertifikat samt vollständiger Kette und einer privaten Route zum Ingress von OneUptime. Erlauben Sie eingehendes TCP 443 zum Gateway und beschränken Sie die öffentliche Weiterleitung auf diese POST-Route. Lassen Sie das Dashboard und den Browser-Callback auf dem privaten Ingress, wenn Nutzer sie über VPN erreichen; Split-DNS kann denselben Hostnamen intern und extern ausliefern.

Setzen Sie `HOST=oneuptime.example.com` und `HTTP_PROTOCOL=https` in `config.env` oder `host: oneuptime.example.com` und `httpProtocol: https` in Helm. Wenden Sie die Konfiguration an und warten Sie, bis OneUptime neu gestartet ist. Diese Werte erzeugen URLs; sie stellen weder DNS noch TLS noch Netzwerkzugriff bereit. Ändert sich der Hostname, aktualisieren Sie die Webhook-, Callback-, Setup- und Homepage-URLs der GitHub App.

Erhalten Sie Methode, ursprünglichen Pfad, Query-String, Body, `Content-Type`, `X-Hub-Signature-256`, `X-GitHub-Event` und `X-GitHub-Delivery`. Erhalten Sie den öffentlichen Host und das HTTPS-Schema über vertrauenswürdige Proxy-Header. Nehmen Sie den Webhook von Browser-SSO, CAPTCHA und Proxy-Anmeldeseiten aus. Lassen Sie die SSL-Prüfung von GitHub eingeschaltet und konfigurieren Sie in beiden Systemen dasselbe `GITHUB_APP_WEBHOOK_SECRET`: OneUptime lehnt unsignierte Anfragen ab und kann Webhooks ohne dieses Secret nicht validieren. Siehe die [Hinweise von GitHub zur Validierung von Webhooks](https://docs.github.com/en/webhooks/using-webhooks/validating-webhook-deliveries).

Wenn Sie zusätzlich die Quell-IPs der Webhooks beschränken, verwenden Sie die aktuellen `hooks`-Bereiche aus der Meta API von GitHub und aktualisieren Sie sie regelmäßig; ersetzen Sie sie nicht durch die Bereiche der GitHub-Actions-Runner und verzichten Sie nicht auf die Signaturprüfung. GitHub warnt, dass sich [seine Adressen ändern und die veröffentlichte Liste nicht vollständig ist](https://docs.github.com/en/authentication/keeping-your-account-and-data-secure/about-githubs-ip-addresses).

### Zugriff prüfen und Grenzen verstehen

:::steps
1. Verbinden Sie eine Installation unter **Code-Repositories**.
2. Öffnen Sie in den Einstellungen der GitHub App **Advanced** und sehen Sie sich **Recent Deliveries** an. Stellen Sie eine Zustellung erneut zu und bestätigen Sie, dass das Gateway sie weiterleitet und OneUptime sie annimmt.
3. Fügen Sie der Installation ein Test-Repository hinzu oder entfernen Sie eines, und prüfen Sie, dass die Liste der Repositories in OneUptime folgt.
:::

GitHub dokumentiert die [Diagnose von Zustellungen](https://docs.github.com/en/webhooks/testing-and-troubleshooting-webhooks/viewing-webhook-deliveries) und verlangt [eine 2xx-Bestätigung innerhalb von zehn Sekunden](https://docs.github.com/en/webhooks/using-webhooks/best-practices-for-using-webhooks). Ein GET im Browser an den Webhook testet keinen signierten POST.

> [!WARNING]
> Ohne eingehenden Zugriff können die Autorisierung im Browser sowie ausgehende API- und Git-Operationen funktionieren, aber Webhooks erreichen OneUptime nicht: Gelöschte Installationen und Änderungen am Repository-Zugriff werden nicht synchronisiert, und die App reagiert nie auf Erwähnungen, Zuweisungen oder Review-Anfragen.

Die [Einstellung für den Zugriff auf private Netzwerke](/docs/self-hosted/private-network-access) steuert ausgehende Anfragen an private Ziele und macht den Webhook nicht für GitHub erreichbar.

## Fehlerbehebung

### Das Verbinden wurde nicht abgeschlossen

Wenn GitHub Sie zurückschickt und die Installation nicht verbunden wurde, zeigt die Seite **Code-Repositories** die Meldung **GitHub wurde nicht verbunden** mit einem Satz in Ihrer Sprache, der den Grund nennt. Der Rest der Seite lädt wie gewohnt, sodass Sie gleich dort erneut verbinden können. Was GitHub selbst geantwortet hat, zeigt sie nie: Das steht mit dem Grund im Log des OneUptime-Servers.

| Die Seite sagt | Was zu tun ist |
| --- | --- |
| **"Dieser Verbindungslink ist ungültig, abgelaufen oder wurde bereits verwendet. Bitte beginnen Sie erneut."** | Der Link funktioniert einmal, 15 Minuten lang, in dem Browser, in dem er gestartet wurde. Beginnen Sie unter **Code-Repositories** erneut und schließen Sie auf GitHub innerhalb von 15 Minuten im selben Browser ab. Die App von ihrer Seite auf GitHub aus zu installieren, verbindet sie mit keinem Projekt. |
| **"Sie haben keine Berechtigung, diesem Projekt Code-Repositorys hinzuzufügen."** | Das Verbinden braucht die Berechtigung, Code-Repositories hinzuzufügen (siehe [Repositories verbinden](#repositories-verbinden)). Bitten Sie einen Projektadministrator, sie zu erteilen. Sie wird erneut geprüft, wenn GitHub Sie zurückschickt; eine Berechtigung, die Ihnen inzwischen entzogen wurde, beendet die Verbindung also auch hier. |
| **"Zum Verbinden mit GitHub brauchen Sie den ...-Tarif."** | Auf OneUptime Cloud brauchen Code-Repositories den Tarif, den der Satz nennt. Stufen Sie den Tarif des Projekts hoch und verbinden Sie dann erneut. |
| **"GitHub hat nicht bestätigt, wer die App installiert hat, daher konnte die Installation nicht geprüft werden."** | Schalten Sie in den Einstellungen der GitHub App **Request user authorization (OAuth) during installation** ein (siehe [Die GitHub App erstellen](#die-github-app-erstellen)) und verbinden Sie dann erneut. |
| **"OneUptime konnte nicht bestätigen, dass Ihr GitHub-Konto diese Installation verwalten kann."** | Das GitHub-Konto, das die Installation abgeschlossen hat, verwaltet sie nicht. Installieren Sie die App mit einem Konto, dem die Organisation oder der Benutzer gehört, bei dem sie installiert wird, oder bitten Sie einen Inhaber darum. |
| **"GitHub hat keine Installation zurückgesendet."** | Wenn ein Mitglied der Organisation die App anfragt, statt sie zu installieren, muss ein Inhaber der Organisation die Anfrage zuerst genehmigen. Verbinden Sie erneut, sobald das geschehen ist. |
| **"Die GitHub App ist auf diesem OneUptime-Server nicht eingerichtet."** | Setzen Sie sowohl `GITHUB_APP_CLIENT_ID` als auch `GITHUB_APP_CLIENT_SECRET` (siehe [OneUptime konfigurieren](#oneuptime-konfigurieren)) und starten Sie OneUptime neu. |
| **"OneUptime konnte die Verbindung nicht abschließen. Bitte versuchen Sie es erneut."** | GitHub hat mit einem Fehler geantwortet, oder eine Anfrage oder ein Schreibvorgang ist beim Abschließen fehlgeschlagen. Das Log des OneUptime-Servers sagt, was davon. Versuchen Sie es erneut; passiert es weiterhin, prüfen Sie das Log und die Einstellungen der GitHub App. |

### Weitere Probleme

:::details Code-Repositories meldet „Die GitHub-App ist auf diesem Server nicht konfiguriert“
`GITHUB_APP_NAME` ist nicht gesetzt. Setzen Sie es auf den genauen Namen der App, zusammen mit den anderen fünf Werten, und starten Sie OneUptime neu.
:::

:::details Nach der Installation der App werde ich nicht zu OneUptime zurückgeschickt
Prüfen Sie, dass die **Callback URL** der App `https://your-oneuptime-domain.com/api/github/auth/callback` ist, und ebenso die **Setup URL**, falls eine gesetzt ist. Beide müssen auf denselben Endpunkt `/api/github/auth/callback` zeigen, auf dem Hostnamen aus `HOST`.
:::

:::details Die Recent Deliveries von GitHub zeigen "Invalid webhook signature"
Das Webhook-Secret in der GitHub App und `GITHUB_APP_WEBHOOK_SECRET` unterscheiden sich, `GITHUB_APP_WEBHOOK_SECRET` ist nicht gesetzt, oder ein Proxy hat den Body der Anfrage verändert. Setzen Sie in beiden dasselbe Secret, starten Sie OneUptime neu und stellen Sie sicher, dass das Gateway den Body unverändert weiterleitet.
:::

:::details Webhook-Ereignisse kommen nicht an
Prüfen Sie, dass die Webhook-URL öffentlich über HTTPS erreichbar ist, und sehen Sie sich dann in den Einstellungen der GitHub App unter **Advanced > Recent Deliveries** jeden Versuch und seine Antwort an. Webhooks werden abgelehnt, solange `GITHUB_APP_WEBHOOK_SECRET` nicht gesetzt ist.
:::

:::details Repositories oder Fix-Aufgaben scheitern mit einem Authentifizierungsfehler
OneUptime authentifiziert sich als die App mit `GITHUB_APP_ID` und `GITHUB_APP_PRIVATE_KEY`. Prüfen Sie, dass die App ID stimmt und der Schlüssel das vollständige PEM ist, einschließlich seiner `BEGIN`- und `END`-Zeilen, oder dieses PEM base64-kodiert. Wurde die App auf GitHub deinstalliert, verbinden Sie sie erneut unter **Code-Repositories**.
:::

:::details Nach der Installation fehlen Repositories
Prüfen Sie in den Einstellungen der Installation auf GitHub, auf welche Repositories sie zugreifen kann. Repositories, die Sie dort hinzufügen, werden automatisch importiert, solange Webhooks OneUptime erreichen.
:::

:::details Die App ignoriert Erwähnungen in GitHub
Geben Sie der App **Issues: Read and write** und abonnieren Sie die interaktiven Ereignisse aus [Webhook-Ereignisse abonnieren](#webhook-ereignisse-abonnieren). Erwähnungen passen außerdem nur auf das aus `GITHUB_APP_NAME` gebildete Handle, setzen Sie es also auf den echten Namen der App.
:::

## Bewährte Sicherheitspraktiken

- **Rotieren Sie Geheimnisse regelmäßig.** Erzeugen Sie in regelmäßigen Abständen neue Client Secrets und private Schlüssel.
- **Lassen Sie das Webhook-Secret gesetzt.** OneUptime lehnt Webhooks ab, die es nicht verifizieren kann.
- **Beschränken Sie den Repository-Zugriff.** Geben Sie der Installation nur die Repositories, die verbunden werden müssen.
- **Beobachten Sie die Webhook-Zustellungen.** Prüfen Sie regelmäßig auf fehlgeschlagene Zustellungen oder verdächtige Aktivität.
- **Halten Sie private Schlüssel aus der Versionsverwaltung heraus.**

## Nächste Schritte

:::cards
- [Mit OneUptime aus GitHub arbeiten](/docs/ai/github-app): Die Befehle, die man der App geben kann, und wer sie geben darf.
- [Fix-Aufgaben](/docs/ai/ai-agent): Wie der KI-Agent Fix-Pull-Requests öffnet.
- [Zugriff auf private Netzwerke](/docs/self-hosted/private-network-access): Workflows und Webhooks interne Tools erreichen lassen.
:::
