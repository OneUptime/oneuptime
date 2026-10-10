# Workflow-Konfiguration & Sicherheit

Was Sie wissen sollten, bevor Sie einen Workflow auf echten Betrieb loslassen: wie Sie ihn sicher einschalten, wer was tun darf, wie Geheimnisse und URLs privat bleiben, was die Schritte eines Workflows ändern dürfen und innerhalb welcher Grenzen jede Ausführung arbeitet.

:::cards
- [Live gehen](#einen-workflow-ein-oder-ausschalten): Mit Arbeitsablauf ausführen testen, dann den Workflow eingeschaltet lassen.
- [Berechtigungen](#berechtigungen): Die Workflow-Rollen und die einzelnen Berechtigungen dahinter.
- [Was Schritte tun dürfen](#was-workflow-schritte-dürfen): Schritte handeln als Project Admin des Projekts des Workflows.
- [Grenzen](#plan-grenzen): Ausführungen pro Plan, Laufzeit und Aufrufe zwischen Workflows.
:::

## Einen Workflow ein- oder ausschalten

Jeder Workflow hat einen Schalter **Aktiviert** oben in seinem **Editor** und auf seiner Seite **Übersicht**. Ist er aus, läuft der Workflow nicht – Webhook-Aufrufe, eingehende E-Mails, geplante Zeiten und OneUptime-Ereignisse werden alle ignoriert, ebenso **Arbeitsablauf ausführen** und **Nur diesen Schritt ausführen**. Neue Workflows beginnen deaktiviert.

Verwenden Sie diesen Schalter als Ihr "startklar"-Tor:

:::steps
1. Bauen Sie den Workflow.
2. Klicken Sie im **Editor** mit realistischen Werten auf **Arbeitsablauf ausführen**. Ein deaktivierter Workflow kann nicht einmal von Hand laufen, daher bittet der Editor zuerst darum, ihn einzuschalten: Klicken Sie auf **Einschalten und ausführen**.
3. Öffnen Sie die Ausführung und prüfen Sie, dass jeder Baustein dorthin ging, wo Sie es erwartet haben. Siehe [Ausführungen](/docs/workflows/runs-and-logs).
4. Lassen Sie **Aktiviert** eingeschaltet, wenn er bereit ist. Ist er es nicht, schalten Sie ihn aus, bis er es ist: Solange er an ist, löst sein Trigger bei echten Ereignissen aus.
:::

Einen Workflow auszuschalten verhindert, dass neue Ausführungen starten. Eine laufende Ausführung wird zu Ende geführt, aber eine Ausführung, die an einem **Sleep**-Baustein wartet, wird beim Aufwachen abgebrochen.

## Einen Workflow archivieren

Archivieren Sie einen Workflow, den Sie nicht mehr brauchen, aber behalten möchten. Ein archivierter Workflow:

- **Läuft nie**, durch keinen Trigger. Manuelle Ausführungen und **Nur diesen Schritt ausführen**, Webhook-Aufrufe, Zeitpläne, OneUptime-Ereignisse, eingehende E-Mails und die **Execute Workflow**-Schritte anderer Workflows werden alle abgelehnt. Ein Webhook-Aufruf an einen archivierten Workflow bekommt einen Fehler, der sagt, dass der Workflow archiviert ist.
- **Stoppt wartende Ausführungen.** Eine Ausführung, die in einem **Sleep**-Schritt schläft, wird beim Aufwachen abgebrochen, und eine eingereihte Ausführung, die noch nicht begonnen hatte, endet mit "Workflow was archived before this run started, so it did not run."
- **Verlässt die Liste der Workflows.** Sie finden ihn unter **Arbeitsabläufe → Erweitert → Archiviert**.
- **Behält alles.** Seine Schritte, Variablen, Eigentümer, Beschriftungen und sein Ausführungsverlauf bleiben, wie sie waren.

Um einen Workflow zu archivieren, öffnen Sie ihn, gehen Sie zu **Einstellungen** und klicken Sie auf **Archivieren**. Um mehrere zu archivieren, wählen Sie sie in der Liste **Arbeitsabläufe** aus und wählen **Archivieren**.

Um einen Workflow zurückzuholen, öffnen Sie **Arbeitsabläufe → Erweitert → Archiviert**, wählen ihn aus und wählen **Aus Archiv entfernen**, oder Sie öffnen ihn und klicken im Banner oben auf seinen Seiten auf **Aus Archiv entfernen**.

Archivieren und der Schalter **Aktiviert** sind voneinander getrennt. Archivieren berührt den Schalter nicht, daher läuft ein Workflow, der an war, wieder, sobald die Archivierung aufgehoben ist, und einer, der aus war, bleibt aus. Die Seite **Archiviert** zeigt in ihrer Spalte **Bei Aufhebung der Archivierung**, welcher welcher ist.

Ein exportierter Workflow trägt nie seinen Archivierungszustand mit, daher ist eine importierte Kopie nie archiviert.

## Eigentümer und Beschriftungen

| Was                     | Wo                                                       | Was es tut                                                                                                                                      |
| ----------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| **Eigentümer**          | Die Seite **Eigentümer** des Workflows                   | Die Benutzer und Teams, die für den Workflow verantwortlich sind. Eine Rolle, die auf das beschränkt ist, was ihrem Team gehört, erreicht die Workflows, die diesem Team gehören. |
| **Beschriftungen**      | Die Seite **Übersicht** des Workflows                    | Schlagworte zum Gruppieren von Workflows, nach Team, Integration oder Umgebung. Filtern Sie die Liste **Arbeitsabläufe** nach Beschriftung und beschränken Sie eine Rolle auf einige Beschriftungen. |
| **Beschriftungsregeln** | **Arbeitsabläufe → Einstellungen → Beschriftungsregeln** | Neue Workflows automatisch beschriften, nach Mustern in ihrem Namen oder ihrer Beschreibung.                                                    |
| **Eigentümerregeln**    | **Arbeitsabläufe → Einstellungen → Eigentümerregeln**    | Neuen Workflows automatisch Eigentümer zuweisen.                                                                                                |

Wie die Regeln greifen, steht unter [Beschriftungs- und Eigentümerregeln](/docs/configuration/label-and-owner-rules).

## Geheimnisse

Markieren Sie eine Variable als **Geheimnis**, wenn sie etwas Sensibles enthält: Ihr Wert wird dann aus den Protokollen der Ausführungen und den Schrittspuren entfernt. Kein Variablenwert lässt sich nach dem Speichern wieder auslesen, ob geheim oder nicht, weder im Dashboard noch über die API, und eine geheime Variable bleibt geheim.

Verwenden Sie geheime Variablen für:

- API-Schlüssel für externe Dienste.
- Authentifizierungstoken.
- Webhook-Signaturschlüssel.
- Alles, was jemand mit Lesezugriff nicht sehen soll.

Fügen Sie ein Geheimnis nicht direkt in einen Baustein ein – Werte wie `Authorization: Bearer eyJh...` werden im Workflow und in den Protokollen sichtbar. Verwenden Sie stattdessen `{{global.variables.MY_SECRET}}`.

Ist das Geheimnis ein OAuth-Zugriffstoken, das abläuft, machen Sie die Variable zu einer [OAuth-2.0-Variable](/docs/workflows/variables#oauth-20-variablen-token-die-sich-selbst-erneuern). OneUptime ruft das Token dann bei Ihrem Identitätsanbieter ab und erneuert es, sobald ein Workflow ein abgelaufenes verwenden würde. OAuth-2.0-Variablen sind immer geheim, und ihre Anmeldedaten sind in der Datenbank verschlüsselt.

## Workflows exportieren und importieren

Sie können einen Workflow als JSON-Datei zwischen Projekten verschieben oder zwischen einer selbst gehosteten Installation und OneUptime Cloud.

:::tabs
@tab Exportieren
Öffnen Sie den Workflow, gehen Sie zu **Einstellungen** und klicken Sie auf **Arbeitsablauf exportieren**. Um mehrere Workflows in eine Datei zu packen, wählen Sie sie in der Liste **Arbeitsabläufe** aus und wählen **JSON exportieren**.
@tab Importieren
Klicken Sie in der Liste **Arbeitsabläufe** auf **JSON importieren** und wählen Sie eine Datei, die aus einem beliebigen OneUptime-Projekt exportiert wurde. Ein Workflow, dessen Namen das Projekt schon hat, wird mit "(Imported)" hinter seinem Namen importiert.
:::

Die Datei enthält Name, Beschreibung und Aktivierungszustand des Workflows sowie seinen Graphen. Sie enthält bewusst nicht:

- **Den geheimen Webhook-Schlüssel.** Beim Anlegen des Workflows wird ein neuer erzeugt, daher hat ein importierter Workflow eine andere Webhook-URL – kopieren Sie sie aus dem Webhook-Trigger des neuen Workflows. Alles, was das Original aufruft, muss umgestellt werden.
- **Die Adresse für eingehende E-Mails.** Ein importierter Workflow mit einem Incoming-Email-Trigger bekommt eine eigene Adresse – kopieren Sie sie aus dem Trigger des neuen Workflows. Allem, was dem Original E-Mails sendet, muss die neue Adresse gegeben werden.
- **Globale Variablen.** Ein Baustein, der `{{global.variables.MY_SECRET}}` liest, behält diesen Verweis, aber der Wert steht nicht in der Datei. Legen Sie die Variablen im Zielprojekt an, bevor Sie den importierten Workflow ausführen.
- **Eigentümer und Beschriftungen.** Die eigenen Beschriftungs- und Eigentümerregeln Ihres Projekts laufen für den importierten Workflow, genauso, als hätten Sie ihn von Hand angelegt.

Ein importierter Workflow wird immer **deaktiviert** angelegt, auch wenn er dort, wo er exportiert wurde, aktiviert war – sein Graph kann auf Monitore, Bereitschaftsrichtlinien oder andere Workflows zeigen, die es im Zielprojekt nicht gibt. Prüfen Sie ihn, aktivieren Sie ihn, testen Sie ihn mit **Arbeitsablauf ausführen** und lassen Sie ihn dann eingeschaltet. Einen Workflow zu duplizieren verhält sich genauso, damit eine Kopie nie neben dem Original zu feuern beginnt, bevor Sie sie bearbeitet haben.

Weil der Graph unverändert mitreist, reist alles, was direkt in einen Baustein getippt wurde, mit. Das ist der praktische Grund, Anmeldedaten in geheimen Variablen aufzubewahren: Einen Workflow mit einem fest eingetragenen Token zu exportieren, übergibt dieses Token jedem, der die Datei bekommt.

## Webhook-Sicherheit

Webhook-Trigger geben Ihnen eine eindeutige URL. Jeder, der die URL kennt, kann sie aufrufen. Zum Schutz vor versehentlichen oder unerwünschten Aufrufern:

- Behandeln Sie die URL wie ein Passwort. Teilen Sie sie nicht öffentlich und committen Sie sie nicht in ein öffentliches Repository. Der Webhook-Trigger verbirgt den geheimen Schlüssel der URL, bis Sie auf **Anzeigen** klicken, und **URL kopieren** kopiert die URL, ohne sie anzuzeigen.
- Gelangt die URL nach außen, klicken Sie im **Editor** auf den Webhook-Trigger und auf **URL zurücksetzen**. Der Workflow bekommt eine neue URL, und die alte hört sofort auf zu funktionieren.
- Sagt der Trigger, dass seine URL auf die ID des Workflows endet, setzen Sie sie zurück. Workflows, die angelegt wurden, bevor Webhook-URLs einen eigenen geheimen Schlüssel hatten, verwenden stattdessen die ID des Workflows, und die kann jeder sehen, der den Workflow öffnen kann.
- Bei sensiblen Workflows bitten Sie das aufrufende System, ein gemeinsames Token als Header zu senden (etwa `X-Webhook-Token`), und prüfen Sie es mit einem **If / Else**-Baustein, bevor etwas Wichtiges passiert. Speichern Sie das erwartete Token als geheime Variable.
- Bei sehr sensiblen Workflows ziehen Sie einen OneUptime-Ereignis-Trigger und einen manuellen Importschritt einem öffentlichen Webhook vor.

Nur Personen, die den Workflow bearbeiten dürfen – **Project Owner**, **Project Admin**, **Workflow Admin** oder **Edit Workflow** –, können seine Webhook-URL sehen oder zurücksetzen. Jeder mit der URL kann den Workflow von überall starten, ohne sich anzumelden, daher sehen alle anderen einen Hinweis, wen sie fragen sollen. Das schließt einen **Workflow Member** ein, der den Workflow aus dem **Editor** von Hand ausführt.

## Sicherheit eingehender E-Mails

Der Incoming-Email-Trigger gibt dem Workflow eine eigene Adresse, und jeder, der die Adresse kennt, kann ihr E-Mails senden. Der Teil vor dem `@` ist der geheime Schlüssel des Workflows, behandeln Sie die Adresse also wie ein Passwort:

- Veröffentlichen Sie sie nicht und legen Sie sie nicht in ein öffentliches Repository. Der Trigger verbirgt den Schlüssel, bis Sie auf **Anzeigen** klicken, und **Adresse kopieren** kopiert die Adresse, ohne sie anzuzeigen.
- Gelangt die Adresse nach außen, klicken Sie im **Editor** auf den Incoming-Email-Trigger und auf **Adresse zurücksetzen**. Der Workflow bekommt eine neue Adresse, und E-Mails an die alte werden ab dann ignoriert.
- Jeder kann einen beliebigen Absender in eine E-Mail schreiben, daher beweist **From** nicht, wer sie gesendet hat. Bevor ein Workflow etwas Wichtiges tut, prüfen Sie mit einem **If / Else**-Baustein etwas, das nur der echte Absender weiß – ein Token im Betreff oder in einem Header. Speichern Sie das erwartete Token als geheime Variable.
- Der Schlüssel ist in allem, was die Ausführung empfängt, verborgen – **To**, **CC**, den Headern und den Bodys –, weil das Protokoll der Ausführung für jeden sichtbar ist, der die Ausführungen des Workflows lesen kann.

Nur Personen, die den Workflow bearbeiten dürfen – **Project Owner**, **Project Admin**, **Workflow Admin** oder **Edit Workflow** –, können seine Adresse sehen oder zurücksetzen. Alle anderen sehen einen Hinweis, wen sie fragen sollen.

## Ausgehender Netzwerkzugriff

API- und andere HTTP-Bausteine stellen ihre Anfragen von OneUptime aus, und der IRC-Baustein verbindet sich von OneUptime aus mit dem Port des IRC-Servers. Hosten Sie selbst, stellen Sie sicher, dass Ihre Installation die aufgerufenen Dienste erreicht. Verwenden Sie OneUptime Cloud, stehen unsere ausgehenden IP-Bereiche unter [IP-Adressen](/docs/configuration/ip-addresses), damit Sie sie auf der anderen Seite erlauben können.

Welche Adressen ein Baustein erreichen darf, hängt vom Baustein ab:

| Bausteine                                                  | Loopback, Link-Local, Cloud-Metadaten                                  | Private Netzwerkadressen                                                                                                              |
| ---------------------------------------------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| **API**-Bausteine und Anfragen von **Run Custom JavaScript** | Abgelehnt, es sei denn, der genaue Host steht in `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST` | Abgelehnt, es sei denn, ein Administrator einer selbst gehosteten Installation erlaubt sie mit `ALLOW_PRIVATE_NETWORK_WEBHOOKS` oder `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST` |
| **Send Email**, **IRC** und Token-URLs von OAuth 2.0       | Abgelehnt                                                              | In OneUptime Cloud abgelehnt. Auf einer selbst gehosteten Installation erlaubt, es sei denn, `DATA_SOURCE_BLOCK_PRIVATE_ADDRESSES` ist `true` |
| Slack, Microsoft Teams, Discord und Telegram               | Abgelehnt                                                              | Abgelehnt: Jeder sendet nur an die Adressen seines eigenen Dienstes                                                                    |

Wie ein Administrator einer selbst gehosteten Installation diese öffnet, steht unter [Zugriff auf private Netzwerke](/docs/self-hosted/private-network-access).

## KI-Komponenten

**Generate Text with AI** sendet eine Anfrage an ein LLM: den Standard-LLM-Anbieter des Projekts oder den globalen Anbieter der Installation, wenn das Projekt keinen hat. Richten Sie Anbieter unter **Projekteinstellungen → KI → LLM-Anbieter** ein, und tragen Sie nie den API-Schlüssel eines Anbieters oder einen eigenen Endpunkt in einen Workflow ein.

Was der Anbieter erhält und was das Modell damit tun kann:

- **Nur, was Sie in den Baustein schreiben.** OneUptime sendet eine feste Sicherheitsanweisung und danach **System Instructions**, **Prompt** und **Context** des Bausteins, mit eingesetzten Verweisen. **Context** kommt zuletzt, nach einer Markierung, und die Sicherheitsanweisung sagt dem Modell, dass alles nach der Markierung nicht vertrauenswürdige Daten sind, auch Text, der wie Anweisungen aussieht.
- **Sonst nichts.** Die Daten des Triggers, der Verlauf des Workflows, die Ausgaben anderer Bausteine, Projektdatensätze, Telemetrie und Geheimnisse werden nie angehängt. Sie verlassen OneUptime nur, wenn Sie in einer dieser drei Einstellungen auf sie verweisen.
- **Text, keine Tools.** Das Modell kann OneUptime nicht abfragen, keine HTTP-Anfragen stellen und keine Daten ändern. Zusätzliche Parameter eines Anbieters lassen nur eine Positivliste reiner Generierungsfelder durch: Sie können die Nachrichten nicht ersetzen, keine Tools, Websuche oder anderen Datenquellen hinzufügen, nichts außer Text und nicht mehrere Antworten anfordern, nicht streamen, die Anfrage nicht beim Anbieter aufbewahren lassen und die Ausgabegrenze des Bausteins nicht anheben. Felder, die OneUptime nicht kennt, werden verworfen.
- **Das Modell wählt Ihr Administrator.** Muss die Generierung offline bleiben, wählen Sie ein Modell, das beim Anbieter nichts von selbst abruft.

Was protokolliert wird:

- Das Protokoll der Ausführung verbirgt **System Instructions**, **Prompt**, **Context** und **Response** des Bausteins. Spätere Bausteine können sie während der Ausführung trotzdem verwenden, und ein Baustein, in den Sie einen davon einsetzen, protokolliert ihn nach seinen eigenen Regeln: Wer einen einsetzt, entscheidet sich, ihn dort zu zeigen.
- Anbieter, Modell, Token-Zahlen, **LLM Log ID** und eine sichere Fehlermeldung bleiben für Betrieb und Abrechnung sichtbar. Der rohe Fehlertext eines Anbieters bleibt aus jedem Protokoll heraus, weil ein Anbieter darin die Anfrage wiederholen kann.
- Jeder Aufruf steht unter **Projekteinstellungen → KI → KI-Protokolle**, mit Anbieter, Modell, Status, Token, Kosten und Abrechnung, aber ohne Prompt, Antwort und rohen Fehler.

Was der Baustein braucht und was er kostet:

- **KI aktivieren** muss eingeschaltet sein, unter **Projekteinstellungen → KI → KI-Funktionen**. In OneUptime Cloud braucht das Projekt außerdem den Plan Growth oder höher und ein bezahltes Abonnement. Selbst gehostete Installationen ohne Abrechnung haben keine Plan-Sperre.
- Aufrufe über einen kostenpflichtigen globalen Anbieter verbrauchen das KI-Guthaben des Projekts.
- Jeder Aufruf zählt zu den [eigenen täglichen KI-Grenzen des Projekts](/docs/ai/ai-sre#the-projects-own-daily-limits), wenn ein Projektinhaber sie festlegt. Ist eine Grenze erreicht, nimmt der Baustein bis Mitternacht UTC **Error**, ohne das Modell anzufragen.

| Grenze                                                         | Wert                                                                                       |
| -------------------------------------------------------------- | ------------------------------------------------------------------------------------------ |
| **System Instructions**, **Prompt** und **Context** zusammen   | 50.000 Zeichen                                                                             |
| **Temperature**                                                | Von `0` bis `1`                                                                            |
| **Maximum Output Tokens**                                      | Von `1` bis `4096`, standardmäßig `1024`                                                   |
| Eine Anfrage                                                   | Ein Versuch, höchstens 60 Sekunden                                                         |
| Gleichzeitige Aufrufe                                          | 3 pro Projekt. Weitere nehmen **Error**, und eine spätere Ausführung kann es erneut versuchen. |

Validierungs-, Konfigurations-, Zugriffs-, Grenz-, Guthaben-, Gleichzeitigkeits-, Anbieter- und Zeitüberschreitungsfehler nehmen alle den Pfad **Error**, mit dem Grund in **Error**. Verbinden Sie diesen Pfad, bevor der Workflow live geht.

> [!WARNING]
> Jeder Wert, auf den Sie verweisen, sind Daten, die Sie an den Anbieter senden. Setzen Sie keine geheime Variable in den Prompt oder den Kontext, es sei denn, der Anbieter ist für ihren Empfang freigegeben. Ein selbst gehosteter lokaler Anbieter wie Ollama hält Anfragen in Ihrer eigenen Infrastruktur; ein gehosteter Anbieter erhält sie zu seinen eigenen Datenverarbeitungsbedingungen.

## Berechtigungen

Workflows beachten die rollenbasierte Zugriffskontrolle Ihres Projekts. Die drei Workflow-Rollen:

- **Workflow Admin** – baut Workflows: legt sie an, ändert sie, führt sie aus und löscht sie und verwaltet die Variablen, die sie verwenden.
- **Workflow Member** – nutzt sie: öffnet Workflows und ihre Ausführungen und führt einen Workflow mit **Arbeitsablauf ausführen** von Hand aus. Ein Mitglied kann keinen Workflow anlegen, ändern oder löschen und keinen seiner Schritte einzeln ausführen.
- **Workflow Viewer** – liest Workflows und ihre Ausführungen.

**Project Owner** und **Project Admin** können alles, was ein Workflow Admin kann. **Project Member** kann Workflows anlegen und löschen, aber nicht ändern oder ausführen.

Die einzelnen Berechtigungen, für ein Team oder einen API-Schlüssel, die genau eine Sache brauchen:

- **Create / Read / Edit / Delete Workflow** – die grundlegenden Berechtigungen für den Workflow selbst. Einen Workflow zu ändern, auch ihn ein- oder auszuschalten und zu archivieren, erfordert **Edit Workflow**; **Delete Workflow** löscht nur.
- **Edit Workflow** – ist auch das, was es braucht, um einen einzelnen Schritt mit **Nur diesen Schritt ausführen** auszuführen und die Webhook-URL und die Adresse für eingehende E-Mails eines Workflows zu sehen oder zurückzusetzen. Einen ganzen Workflow von Hand auszuführen erfordert **Edit Workflow**, **Workflow Admin** oder **Workflow Member**.
- **Read Workflow Log** – nötig, um Ausführungen anzusehen.
- **Create / Read / Edit / Delete Workflow Variables** – globale und Workflow-Variablen verwalten.

Eine Ausführung von Hand erreicht nur Workflows, die Sie öffnen können: Eine Rolle, die auf einige Beschriftungen oder auf die Workflows Ihres Teams beschränkt ist, führt nur diese aus. Wer einen Workflow nicht ausführen darf, sieht **Arbeitsablauf ausführen** ausgegraut, mit dem Grund im Tooltip.

Geben Sie den Personen, die Automatisierungen bauen, **Workflow Admin** und denen, die sie nur starten, **Workflow Member**. Behalten Sie den Bearbeitungszugriff auf Variablen den Personen vor, die die Geheimnisse Ihres Projekts verwalten. Wie Rollen vergeben werden, steht unter [Benutzer, Teams und Berechtigungen](/docs/permissions/index).

## Was Workflow-Schritte dürfen

Die Schritte, die OneUptime-Datensätze lesen und ändern – die Find-, Create-, Update- und Delete-Komponenten sowie die Trigger On Create, On Update und On Delete –, handeln als **Project Admin** des Projekts des Workflows. Wer den Workflow auch gebaut hat, ein Schritt unterliegt denselben Prüfungen wie ein Project Admin im Dashboard und in der API:

- **Nur das eigene Projekt des Workflows.** Ein Schritt liest und schreibt die Datensätze des Projekts, zu dem der Workflow gehört, und keines anderen, und ein Update verschiebt nie einen Datensatz in ein anderes Projekt.
- **Nur, was ein Project Admin darf.** Ein Schritt kann nur die Team- und API-Schlüssel-Berechtigungen vergeben, die ein Project Admin selbst hat, daher kann er weder **Project Owner** noch Abrechnungs- oder Projektlöschungs-Berechtigungen vergeben, und er kann niemanden zu einem Team hinzufügen, dessen Berechtigungen über die eines Project Admin hinausgehen, etwa zum Team der Eigentümer. Ein Schritt kann nicht lesen, wer eine Probe oder einen KI-Agenten angelegt hat; das sehen nur Projekteigentümer.
- **Nicht das Lesen von Runbook-Anmeldedaten.** Ein Project Admin darf Runbook-Anmeldedaten lesen, aber einem Schritt wird das nicht geliehen. Wo eine Änderung dieses Lesen erfordert – OneUptime AI seine Befehle ausführen lassen, ohne zu fragen, **Führt KI-Behebungsbefehle aus** für einen Runner einschalten, einem Runner, der die Befehle von OneUptime AI ausführt, SSH-Anmeldedaten zuweisen, oder Runbook-Anmeldedaten benennen, etwa in den Schritten eines Runbooks –, wird für einen Schritt stattdessen die Person geprüft, die die Schritte des Workflows zuletzt gespeichert hat, und er wird abgelehnt, es sei denn, sie darf Runbook-Anmeldedaten lesen (**Read Runbook Credential** oder ein Project Owner oder Project Admin). OneUptime hält diese Person fest, wenn jemand den Workflow anlegt und jedes Mal, wenn jemand seine Schritte speichert; den Workflow umzubenennen, seine Beschriftungen zu ändern oder ihn ein- oder auszuschalten, behält bei, wer seine Schritte zuletzt gespeichert hat. Ein Speichern seiner Schritte mit einem API-Schlüssel hält niemanden fest, daher können die Schritte des Workflows diese Änderungen erst machen, wenn eine Person sie speichert.
- **Nur, was Ihr Plan enthält.** In OneUptime Cloud wird ein Schritt, der etwas anlegt oder ändert, das Ihr Plan nicht enthält, mit dem Plan abgelehnt, den er braucht, genau wie das Dashboard. Selbst gehostete Installationen ohne Abrechnung haben keine Plan-Grenzen.
- **Nichts, was OneUptime für sich behält.** Diese werden allen verweigert, Workflows eingeschlossen:
  - einen Feed-Eintrag bearbeiten oder löschen (Feeds von Vorfällen, Warnungen, Episoden, Monitoren, Bereitschaftsrichtlinien und geplanten Wartungen);
  - ein Benachrichtigungsprotokoll schreiben (Protokolle von SMS, Anrufen, E-Mails, WhatsApp, Telegram, Push, Webhooks und Arbeitsbereich-Nachrichten);
  - Werte, die OneUptime setzt, während Dinge geschehen: ob der CNAME einer benutzerdefinierten Domain bestätigt ist, die Schutzschalter eines Teams (**Is Team Editable**, **Is Team Deleteable**, **Is Permissions Editable**, **Should Have At Least One Member**), welche Vorfallrolle die primäre ist und ob sie gelöscht werden kann, ob ein Eigentümer oder Mitglied benachrichtigt wurde, Erinnerungszeiten und -zähler, wer in einem Dienstplan jetzt und als Nächstes Bereitschaft hat, der Fortschritt eines Bereitschaftslaufs, die aktuelle Burn Rate und das Fehlerbudget eines SLO, ein Monitor, der von einem Vorfall oder einer Wartung pausiert wurde, das Token zum Zurücksetzen des Passworts und die letzte Anmeldung eines privaten Benutzers einer Statusseite, die Angaben, die ein Dienst über sich selbst meldet (Version, Laufzeit, Cloud), und der letzte Lauf einer Erkennungsregel oder eines Bedrohungsfeeds;
  - einen Vorfall aus einer Vorlage melden, indem `createdIncidentTemplateId` an **Create One Incident** gesendet wird – wählen Sie die Vorlage stattdessen in der Einstellung **Incident Template** des Schritts: Der Schritt meldet den Vorfall dann daraus, als Project Admin, und hält die Vorlage fest;
  - nach dem Anlegen ändern, zu welchem Datensatz ein Datensatz gehört, etwa für welchen Monitor eine Eigentümerzeile gilt oder an welchem Vorfall eine Notiz hängt.
- **Als keine Person.** Ein Datensatz, den ein Workflow anlegt, nennt keinen Ersteller, und das Audit-Protokoll nennt den Workflow, mit seinem damaligen Namen, als den, der die Änderung gemacht hat.

Lehnt eine Prüfung einen Schritt ab, nimmt der Schritt seinen Ausgang **Error**, ohne die abgelehnte Änderung zu machen, und das Protokoll der Ausführung nennt den Schritt und den Grund in klaren Worten, zum Beispiel *"Create One Team Permission" was refused. Workflow steps can do only what a Project Admin of this project can do: …*. Lesen Sie es unter den [Ausführungen](/docs/workflows/runs-and-logs) des Workflows. Ein Create-Many-Schritt legt seine Datensätze einzeln an und stoppt beim ersten abgelehnten: Die Datensätze, die er davor angelegt hat, bleiben erhalten.

Schritte, die mit anderen Systemen sprechen – API, Email, Slack, Microsoft Teams, Discord, Telegram, IRC, Custom Code und Generate Text with AI –, lesen oder ändern keine OneUptime-Datensätze, daher ändert all das an ihnen nichts.

## Plan-Grenzen

In OneUptime Cloud brauchen Workflows den Growth-Plan oder höher, und jeder Plan erlaubt eine bestimmte Zahl von Ausführungen in beliebigen 30 Tagen:

| Plan       | Ausführungen in den letzten 30 Tagen |
| ---------- | ------------------------------------ |
| Growth     | 500                                  |
| Scale      | 2.000                                |
| Enterprise | Praktisch unbegrenzt                 |

Das Fenster rollt: Jede Ausführung, die das Projekt aufzeichnet, von Hand oder durch einen Trigger, zählt 30 Tage lang. In den Plänen Growth und Scale zeigt die Seite **Arbeitsabläufe** eine Karte **Arbeitsablauf-Ausführungen** mit dem, was das Projekt verbraucht hat. Ist die Grenze erreicht, werden neue Ausführungen mit dem Status **Execution Exceeded Current Plan** aufgezeichnet und nicht ausgeführt, und dasselbe passiert, solange das Abonnement unbezahlt ist. Selbst gehostete Installationen ohne Abrechnung haben keine Grenze.

## Wie lange eine Ausführung dauern darf

| Grenze                          | Standard           | Einstellung beim Selbsthosten   |
| ------------------------------- | ------------------ | ------------------------------- |
| Eine Ausführung, ab ihrem Start oder ab dem Aufwachen nach einem **Sleep** | 2 Minuten | `WORKFLOW_TIMEOUT_IN_MS` |
| Ein **Run Custom JavaScript**-Baustein | 5 Sekunden  | `WORKFLOW_SCRIPT_TIMEOUT_IN_MS` |
| Ein **Sleep**-Baustein          | höchstens 30 Tage  | —                               |

Der Runner prüft die Frist vor und nach jedem Baustein und markiert eine überfällige Ausführung als **Timeout**, sobald er wieder die Kontrolle hat. Er kann einen Baustein nicht mittendrin unterbrechen, daher haben Bausteine, die auf das Netz warten, eigene Zeitgrenzen: Eine Anfrage von Generate Text with AI gibt nach höchstens 60 Sekunden auf, eine OAuth-2.0-Token-Anfrage nach 20. Das Warten an einem **Sleep**-Baustein zählt nicht zur Zeit einer Ausführung: Die Ausführung wird beiseitegelegt und bekommt beim Aufwachen frische 2 Minuten.

## Grenze beim Aufrufen anderer Workflows

Mit der Komponente **Execute Workflow** startet ein Workflow einen anderen. Um Schleifen zu verhindern, in denen Workflow A B startet, der wieder A startet, wird eine Kette von Workflows, die einander starten, abgelehnt, wenn sie zu einem Workflow zurückführen würde, der schon in ihr ist, oder tiefer als 10 Workflows ginge. Der **Execute Workflow**-Baustein nimmt dann seinen Ausgang **Error**, und der Fehler zeigt die Kette.

Brauchen Sie wirklich eine lange Kette (etwa einen Job, der pro Ausführung ein Element verarbeitet), ist es meist einfacher, mit **Run Custom JavaScript** innerhalb eines einzigen Workflows zu iterieren.

## Wann Workflows nicht das richtige Werkzeug sind

Ein paar Fälle, in denen Sie zu etwas anderem greifen sollten:

- **Schwere Berechnungen oder große Datenmengen** – Workflows sind für leichte Verbindungsarbeit gedacht, nicht für Zahlenkolonnen. Lassen Sie schwere Arbeit in Ihrer eigenen Infrastruktur laufen und einen Workflow sie anstoßen.
- **Lang laufende aktive Berechnungen** – eine Ausführung hat standardmäßig 2 Minuten. Für eine passive Verzögerung wie "tu A, warte zwei Stunden, tu B" verwenden Sie die Komponente **Sleep**; sie legt die Ausführung beiseite und setzt sie später fort, ohne einen Worker zu belegen.
- **Schrittweise Reaktion auf Vorfälle mit Menschen in der Schleife** – dafür sind [Runbooks](/docs/runbooks/index) da. Workflows sind für unbeaufsichtigte Automatisierung.

## Nächste Schritte

:::cards
- [Workflows – Übersicht](/docs/workflows/index): Das große Ganze und ein erster Workflow von Anfang bis Ende.
- [Komponenten](/docs/workflows/components): Was jeder Baustein braucht, zurückgibt und erreichen darf.
- [Runbooks](/docs/runbooks/index): Wenn Menschen unterwegs die Entscheidungen treffen müssen.
:::
