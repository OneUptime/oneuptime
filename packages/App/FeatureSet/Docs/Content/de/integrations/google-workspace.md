# Google Workspace

Importieren Sie die Audit-Protokolle von [Google Workspace](https://workspace.google.com) in die Sicherheitsereignisse von OneUptime: Anmeldungen und was Google an ihnen aufgefallen ist, Änderungen von Administratoren, Apps, denen Zugriff auf Daten gegeben wurde, Single Sign-on, die eigenen Sicherheitseinstellungen der Konten und, wenn Sie möchten, Dateien, die in Google Drive außerhalb der Organisation geteilt oder heruntergeladen wurden. Dort durchsuchen Sie sie neben Ihren Logs, Traces und Metriken, verknüpfen sie mit jeder anderen Quelle und alarmieren die Bereitschaft für die wichtigen. OneUptime liest sie mit einem Dienstkonto, das als einer Ihrer Administratoren handelt, und ändert nichts in Google Workspace.

:::cards
- [Die Verbindung einrichten](#die-verbindung-einrichten): Ein Dienstkonto, die domainweite Delegierung und das Formular der Verbindung.
- [Was importiert wird](#was-importiert-wird): Welche Aktivitäten, und wie aus jeder ein Sicherheitsereignis wird.
- [So funktioniert das Abfragen](#so-funktioniert-das-abfragen): Das Zeitfenster jeder Abfrage, und warum es sich um 2 Stunden überlappt.
- [Fehlerbehebung](#fehlerbehebung): Was jeder Fehler bedeutet und was zu ändern ist.
:::

## So funktioniert es

```mermaid title="Von einer Google-Workspace-Aktivität zum Sicherheitsereignis"
flowchart TB
    gws["Google Workspace<br/>erfasst eine<br/>Aktivität"] --> poll["OneUptime fragt im<br/>Intervall der<br/>Verbindung ab"]
    poll --> token["Sein Dienstkonto<br/>handelt als Ihr<br/>Administrator"]
    token --> list["Es listet die<br/>Aktivitäten jedes<br/>Protokolls seit dem<br/>letzten Mal"]
    list --> event["Jedes wird als<br/>OCSF-Ereignis seiner<br/>Art gespeichert"]
```

Jede Minute fragt OneUptime jede aktivierte Verbindung ab, deren Abfrageintervall abgelaufen ist. Eine Abfrage meldet sich als Ihr Dienstkonto im Namen des Administrators an, den Sie angeben, und listet die Aktivitäten jedes Audit-Protokolls seit der letzten Abfrage ([Activities: list](https://developers.google.com/admin-sdk/reports/reference/rest/v1/activities/list)): Admin, Anmeldungen, OAuth-Tokens, SAML, Kontosicherheit und, wenn die Option **Drive-Aktivität** eingeschaltet ist, Drive. Jedes Ereignis einer Aktivität wird als [OCSF](https://schema.ocsf.io/)-Ereignis gespeichert: eine Anmeldung als Ereignis Authentication, eine zugewiesene Admin-Rolle als User Access Management, eine von Google markierte Anmeldung als Detection Finding.

## Bevor Sie beginnen

- In OneUptime die Rolle Project Owner, Project Admin oder Security Admin. Security Member und Security Viewer sehen Verbindungen und ihren Laufverlauf, können sie aber nicht ändern.
- Ein Super-Administrator von Google Workspace, um die domainweite Delegierung zu erlauben, und ein Administrator, als der das Dienstkonto handelt, mit der Berechtigung Reports. Ein Super-Administrator hat sie.
- Ein Google Cloud-Projekt, in dem Sie ein Dienstkonto anlegen und die Admin SDK API einschalten können.
- Für die Drive-Aktivität eine Edition mit dem Audit-Protokoll von Drive, etwa Business Standard, Business Plus, Enterprise oder Education.
- Ausgehendes HTTPS von der OneUptime-App und den Workern zu `oauth2.googleapis.com` und `admin.googleapis.com`.

## Die Verbindung einrichten

Die Verbindung meldet sich mit dem Schlüssel eines Dienstkontos und der [domainweiten Delegierung](https://developers.google.com/identity/protocols/oauth2/service-account#delegatingauthority) an, mit einem lesenden Bereich: `https://www.googleapis.com/auth/admin.reports.audit.readonly`.

:::steps
### Ein Dienstkonto und einen Schlüssel anlegen

1. Wählen Sie in der [Google Cloud Console](https://console.cloud.google.com) ein Projekt, öffnen Sie **APIs & Services → Library**, suchen Sie **Admin SDK API** und wählen Sie **Enable**.
2. Öffnen Sie **IAM & Admin → Service accounts → Create service account**, nennen Sie es `oneuptime-security-events` und wählen Sie **Done**. Es braucht keine Rolle im Projekt.
3. Öffnen Sie das Dienstkonto und kopieren Sie seine **Unique ID**, die Client-ID, die die Delegierung nennt. Wählen Sie im Tab **Keys** **Add key → Create new key → JSON** und bewahren Sie die Datei auf: Sie ist der Schlüssel.

### Die domainweite Delegierung erlauben

1. Öffnen Sie in der [Google Admin-Konsole](https://admin.google.com) als Super-Administrator **Security → Access and data control → API controls → Manage domain-wide delegation** und wählen Sie **Add new**.
2. Geben Sie die **Unique ID** des Dienstkontos als **Client ID** ein und `https://www.googleapis.com/auth/admin.reports.audit.readonly` als **OAuth scope**. Wählen Sie **Authorize**. Google kann einige Minuten brauchen, um sie anzuwenden.
3. Damit Playbooks Benutzer sperren, entsperren und abmelden können (siehe [Eindämmung](/docs/telemetry/security-cases#eindämmung)), fügen Sie den Bereichen desselben Clients `https://www.googleapis.com/auth/admin.directory.user` und `https://www.googleapis.com/auth/admin.directory.user.security` hinzu, durch Kommas getrennt. Der Administrator, als der die Verbindung handelt, muss dann einer sein, der diese Benutzer verwaltet.

### Die Verbindung in OneUptime hinzufügen

Öffnen Sie **Produkte → Sicherheitsereignisse → Verbindungen** (`/dashboard/{projectId}/security-events/connections`), klicken Sie auf **Verbindung hinzufügen**, wählen Sie **Google Workspace** unter **Identität** und klicken Sie auf **Weiter**. Geben Sie die **Administrator email** ein, klicken Sie auf **Weiter** und fügen Sie den Inhalt der Schlüsseldatei in **JSON des Dienstkontos** ein. Schalten Sie im Schritt **Abfrage** **Drive-Aktivität** ein, um auch Drive zu lesen.

### Vor dem Speichern testen

Klicken Sie unter **Vor dem Speichern testen** auf **Diese Einstellungen testen**. Der Test meldet sich mit den Werten im Formular an, liest die Anmelde- und Admin-Protokolle und speichert nichts, eine fehlende Delegierung zeigt sich also, bevor die Verbindung existiert. Klicken Sie dann auf **Weiter**, geben Sie der Verbindung einen **Name** und legen Sie sie an.
:::

| Einstellung | Was Sie eintragen |
| --- | --- |
| **Administrator email** | Die Adresse des Administrators, als der das Dienstkonto handelt, etwa `admin@example.com`. Er muss die Berechtigung Reports haben. |
| **Drive-Aktivität** | Optional, standardmäßig aus. Eingeschaltet liest jede Abfrage auch das Teilen und Herunterladen in Drive. |
| **JSON des Dienstkontos** | Die ganze Schlüsseldatei, die `client_email` und `private_key` enthält. Sie wird verschlüsselt, nie von der API zurückgegeben und nie wieder angezeigt. Ersetzen Sie sie mit **Anmeldedaten aktualisieren** an der Verbindung. |

Der Schritt **Abfrage** hat außerdem eine optionale **Beschreibung**, das **Abfrageintervall (Minuten)**, eine ganze Zahl von `1` bis `1440`, die mit `5` beginnt, und **Aktiviert**, das eingeschaltet beginnt.

## Was importiert wird

Jedes Ereignis hat den Anbieter `Google` und das Produkt `Google Workspace`. Eine Aktivität mit mehreren Ereignissen wird zu je einem Sicherheitsereignis, und jedes Ereignis behält die Felder der Aktivität und seine eigenen, als `event.name`, `event.type` und `parameters.<name>`, sodass eine Regel sie unter den Namen von Google liest.

| Protokoll | Ereignisse | OCSF-Klasse | Schweregrad |
| --- | --- | --- | --- |
| Anmeldungen (`login`) | `login_success`, `login_failure` mit seinem Grund, `login_challenge`. Eine Abmeldung wird gelesen, aber nicht importiert. | Authentication (`3002`) | Informational; Low für einen Fehlschlag; Medium, wenn Google sie als `is_suspicious` markiert |
| Erkennungen von Google (`login`) | `suspicious_login` und seine Arten, `gov_attack_warning`, `account_disabled_hijacked` und die anderen Konten, die Google gesperrt hat | Detection Finding (`2004`) | Medium; High für einen staatlich unterstützten Angriff, ein gekapertes Konto oder ein geleaktes Passwort |
| Admin (`admin`) | Erteilte oder entzogene Admin-Rechte und -Rollen, domainweite Delegierung, angelegte, gelöschte oder gesperrte Benutzer, abgeschaltete Bestätigung in zwei Schritten, Gruppenmitglieder, Einstellungen | User Access Management (`3005`), Account Change (`3001`), Group Management (`3006`), Entity Management (`3004`) | Medium für erteilte Macht; Low für einen gelöschten Benutzer oder eine abgeschaltete Bestätigung in zwei Schritten |
| OAuth-Tokens (`token`) | Eine App, der Zugriff auf die Daten einer Person gegeben wurde, mit ihren Bereichen, oder der dieser Zugriff entzogen wurde | Authorize Session (`3003`) | Informational |
| SAML (`saml`) | Single Sign-on in eine App | Authentication (`3002`) | Low für einen Fehlschlag |
| Kontosicherheit (`user_accounts`) | Änderungen an der Bestätigung in zwei Schritten, am Passwort und an der Wiederherstellung | Account Change (`3001`) | Low, wenn sie das Konto schwächt |
| Drive (`drive`), mit eingeschalteter Option | `change_user_access`, `change_document_visibility`, `change_document_access_scope`, `change_acl_editors`, `download` | File Hosting Activity (`6006`) | Low für eine Datei, die außerhalb der Domäne des Eigentümers geteilt oder für einen Link geöffnet wurde |

Die Regeln der Regelbibliothek für Google Workspace lesen sie so, wie sie hier importiert werden, etwa die für eine von Google markierte Anmeldung, erteilte Admin-Rechte und eine in Drive öffentlich gemachte Datei.

## So funktioniert das Abfragen

- **Aktivitäten werden danach gelesen, wann sie geschahen.** Die Reports API hat keine andere Zeit, nach der sie sie listen könnte, und Google dokumentiert, dass seine Protokolle Minuten bis Stunden verspätet ankommen.
- **Die erste Abfrage blickt 24 Stunden zurück**, sodass eine neue Verbindung ihre jüngsten Aktivitäten sofort zeigt.
- **Jede spätere Abfrage beginnt 120 Minuten vor dem gespeicherten Cursor**, sodass eine Aktivität, die Google bis zu 2 Stunden verspätet lesbar macht, bei der nächsten Abfrage gelesen wird, und Duplikate werden innerhalb des Projekts nach der ID jedes Ereignisses verworfen. Eine, die noch später ankommt, liest das Abfragen nicht: Importieren Sie ihren Zeitraum aus **Diagnose**.
- **Eine Abfrage liest höchstens 24 Stunden über den Cursor hinaus.** Eine Verbindung, deren Cursor zurückliegt, holt in einer Reihe von 24-Stunden-Fenstern auf.
- **Drive wird Ereignis für Ereignis gelesen**, da Drive jede Datei erfasst, die jemand öffnet. Lehnt Google das Protokoll von Drive ab, warnt der Lauf, und die anderen Protokolle werden weiterhin importiert.
- **Ein fehlgeschlagener Lauf ändert nichts.** Nach einem Netzwerkfehler oder einem Fehlerstatus von Google bleiben der Cursor und die Fensterlänge, wie sie waren, und die nächste Abfrage liest dasselbe Zeitfenster erneut. Die einzige Ausnahme ist eine Anfrage, deren Zeit abgelaufen ist: Der Cursor bleibt, aber das nächste Zeitfenster ist halb so lang, denn ein Zeitfenster, das zu schwer ist, um rechtzeitig beantwortet zu werden, würde bei jedem Versuch ablaufen.

### Wenn ein Zeitfenster mehr enthält, als eine Abfrage lesen kann

Jedes Protokoll hat ein eigenes Budget, in Seiten mit 1.000 Aktivitäten: 10 für Anmeldungen, je 5 für Admin, OAuth-Tokens und SAML, 3 für Kontosicherheit und 4 für jedes Drive-Ereignis. Eine Abfrage hört nach 4 Minuten auf. Hält ein Budget ein Protokoll vor dem Ende seines Zeitfensters an, ist der Lauf **Teilweise**, und seine Warnung nennt das Protokoll und das Budget. Google listet die neuesten Aktivitäten zuerst, deshalb verkürzt OneUptime das Zeitfenster, statt den Cursor über Aktivitäten hinwegzurücken, die es nie erreicht hat:

1. **Verengen.** Die nächste Abfrage liest ein halb so langes Zeitfenster ab demselben Startpunkt und halbiert erneut, bis ein Zeitfenster vollständig gelesen wird, bis hinunter zu einer Minute. Die Warnung des Laufs sagt es: `This window holds more records than one poll can read; the next poll reads a {n} minute window from the same starting point.` Aus dem längeren Zeitfenster bereits importierte Aktivitäten werden als Duplikate übersprungen.
2. **Wieder wachsen.** Nachdem ein Zeitfenster vollständig gelesen wurde, rückt der Cursor an sein Ende, und das nächste Zeitfenster ist wieder doppelt so lang, bis zu 24 Stunden.
3. **Über eine einzelne Minute hinwegrücken.** Enthält schon eine Minute mehr, als eine Abfrage lesen kann, rückt das Abfragen über sie hinweg, damit neuere Aktivitäten weiter ankommen. Der Lauf bleibt **Teilweise**, und **Letzter Fehler** lautet `More records were created in the one minute from {cursor} to {end} than one poll can read. Polling moved past this minute so newer records keep arriving; use Import this time range in Diagnostics on this minute to recover what one run can read.` Importieren Sie diese Minute mit **Diesen Zeitraum importieren**, um zurückzuholen, was ein Lauf lesen kann.

Ein anderes **Abfrageintervall (Minuten)** ändert nichts davon: Es entscheidet, wie oft eine Abfrage beginnt, nicht, wo ihr Zeitfenster beginnt.

### Bei Bedarf ausführen, ansehen und importieren

Klicken Sie an einer Verbindung auf **Diagnose**, um ihre letzten Läufe zu sehen und von Hand mit ihr zu arbeiten. Wer die Verbindung ändern darf, kann diese starten; wer sie sehen darf, kann den Verlauf lesen.

- **Jetzt ausführen** startet sofort eine Abfrage, mit dem üblichen Cursor, auch wenn die Verbindung nicht **Aktiviert** ist.
- **Preview audit events** liest einen Zeitraum von bis zu 7 Tagen und importiert nichts.
- **Diesen Zeitraum importieren** importiert nach Ihrer Bestätigung einen Zeitraum von bis zu 7 Tagen, ohne den Cursor zu verschieben. Bereits importierte Aktivitäten werden übersprungen. Google bewahrt Audit-Protokolle 6 Monate lang auf.
- **Diagnosen kopieren** an einem Lauf kopiert seinen Bericht für den Support. Er enthält nie Anmeldedaten.

## Verbindung testen

**Verbindung testen** in der Zeile einer Verbindung und **Diese Einstellungen testen** im Formular laufen im API-Prozess, nicht in einem Hintergrund-Worker, sodass ein Test auch dann antwortet, wenn die Worker das Problem sind. Er führt diese Prüfungen der Reihe nach aus:

| Prüfung | Was sie prüft |
| --- | --- |
| **Konfiguration** | Die Adresse des Administrators und der Schlüssel sind gültig. Schlägt das fehl, wird nichts kontaktiert. |
| **Authenticate with Google** | Google lässt das Dienstkonto als den Administrator handeln: Die domainweite Delegierung ist eingerichtet. |
| **Read the audit logs** | Die Anmelde- und Admin-Protokolle der letzten 24 Stunden lassen sich lesen. |
| **Read Drive activity** | Nur mit eingeschalteter Option: Das Protokoll von Drive lässt sich lesen. |
| **Activities available to import** | Wie viele Anmelde- und Admin-Aktivitäten die letzten 24 Stunden enthalten, je höchstens 1.000, `1000+` heißt also mehr. Keine ist eine Warnung. |
| **Background workers**, **Poll scheduler**, **Security event storage** | Die Seite von OneUptime selbst: Ein Prozess nimmt die Aufträge der Worker-Warteschlange an, der Abfrageauftrag läuft jede Minute, und der Speicher der Sicherheitsereignisse antwortet. |
| **Geplante Abfrage** | Für eine gespeicherte Verbindung: Das Abfragen ist eingeschaltet, kein Lauf wartet festgefahren auf einen Worker, und die Abfragen laufen pünktlich. |

Jede Anfrage in einem Test hat eine Frist von 20 Sekunden. Ein Test importiert nie etwas und verschiebt nie den Cursor, und jede fehlgeschlagene Prüfung sagt, was zu ändern ist.

## Fehlerbehebung

Der **Letzter Fehler** der Verbindung bewahrt die vollständige Fehlermeldung, mit geschwärzten Anmeldedaten. Hat eine Verbindung einen Fehler, wählen Sie in ihrer Spalte **Aktionen** die Aktion **Fehler anzeigen**, um ihn zu lesen, und im Dialog **Fehler kopieren**, um ihn zu kopieren. Jede Meldung beginnt mit `Google Workspace`, nennt dann die fehlgeschlagene Anfrage und zitiert den eigenen Grund von Google.

:::details Letzter Fehler sagt `token request failed`
- `unauthorized_client`: Das Dienstkonto hat keine domainweite Delegierung für den Bereich. Fügen Sie seine **Unique ID** mit `https://www.googleapis.com/auth/admin.reports.audit.readonly` unter **Manage domain-wide delegation** hinzu.
- `invalid_grant` mit `Invalid email or User ID`: Die **Administrator email** ist kein Benutzer dieses Google Workspace.
- `invalid_grant` mit `Invalid JWT Signature`: Der Schlüssel wurde gelöscht oder deaktiviert. Legen Sie einen neuen Schlüssel an und speichern Sie ihn mit **Anmeldedaten aktualisieren**.
:::

:::details Letzter Fehler sagt `activities request failed (HTTP 403)`
- Grund `SERVICE_DISABLED` oder `accessNotConfigured`: Die Admin SDK API ist im Projekt des Dienstkontos aus. Schalten Sie sie ein und testen Sie in einigen Minuten erneut.
- Grund `forbidden`: Dem Administrator fehlt die Berechtigung Reports. Weisen Sie sie in der Google Admin-Konsole unter **Account → Admin roles** zu, oder nennen Sie einen Super-Administrator.
:::

:::details Die Drive-Aktivität wird nicht gelesen
Das Protokoll von Drive braucht eine Edition, die es hat, und einen Administrator mit der Berechtigung Reports. Jeder Lauf warnt `Drive activity was not read`, und die anderen Protokolle werden weiterhin importiert. Schalten Sie **Drive-Aktivität** aus, wenn Ihre Edition kein Drive-Protokoll hat.
:::

:::details Letzter Fehler sagt `did not complete`
Die Anfrage bekam keine Antwort: eine Zeitüberschreitung, ein Name, der sich nicht auflösen lässt, oder eine abgelehnte Adresse. Prüfen Sie, dass die OneUptime-App und die Worker `oauth2.googleapis.com` und `admin.googleapis.com` erreichen, über jeden Proxy, den Sie verwenden.
:::

:::details Der Test besteht, aber Zuletzt abgefragt ist Never
Der Abfrageauftrag ist nie gelaufen. Lesen Sie die Prüfungen **Background workers** und **Poll scheduler**. Bei einer selbst gehosteten Installation ist die übliche Ursache `DISABLE_QUEUE_WORKERS=true` an der App, ohne eigene Worker-Bereitstellung, die die Aufträge annimmt: Setzen Sie es auf `false` oder betreiben Sie die Worker-Bereitstellung (Helm: `worker.enabled: true`, das standardmäßig `false` ist).
:::

## Nächste Schritte

:::cards
- [Sicherheitsereignisse](/docs/telemetry/security-events): Durchsuchen, verknüpfen und warnen, was Sie importieren.
- [Microsoft Entra ID](/docs/integrations/microsoft-entra-id): Die Anmeldungen und Verzeichnisänderungen von Microsoft importieren.
- [Google SecOps](/docs/integrations/google-secops): Auch Erkennungen von Google SecOps hereinholen.
- [Integrationsübersicht](/docs/integrations/index): Die anderen Werkzeuge, die Sie verbinden können.
:::
