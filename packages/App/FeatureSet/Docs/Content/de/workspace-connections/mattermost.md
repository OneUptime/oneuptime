# Mattermost

Verbinden Sie OneUptime mit Ihrem Mattermost-Server, um Vorfälle, Warnungen, Episoden, geplante Wartungen, Monitore und Bereitschafts-Updates in Ihren Kanälen zu posten, jedem Vorfall einen eigenen Kanal zu geben und Responder bestätigen, beheben, Notizen hinzufügen und den Status ändern zu lassen, ohne Mattermost zu verlassen.

:::cards
- [Mattermost verbinden](#mattermost-verbinden): Erstellen Sie ein Bot-Konto für OneUptime und verbinden Sie dann das Projekt mit seinem Token.
- [Ihr eigenes Konto verbinden](#ihr-eigenes-mattermost-konto-verbinden): Verknüpfen Sie Ihr Mattermost-Konto mit Ihrem OneUptime-Konto.
- [Benachrichtigungsregeln](#benachrichtigungsregeln): Legen Sie fest, welche Ereignisse wohin posten und welche einen eigenen Kanal bekommen.
- [Wer im Kanal eines Datensatzes ist](#wer-im-kanal-eines-datensatzes-ist): Sehen Sie, wer darin ist, treten Sie bei und fügen Sie Personen hinzu, direkt auf der Seite des Datensatzes.
- [Aus Mattermost reagieren](#aus-mattermost-auf-vorfälle-warnungen-und-ereignisse-reagieren): Die Schaltflächen in den Nachrichten von OneUptime.
- [Netzwerk und Selbsthosting](#netzwerk-und-selbsthosting): Was jeder Server erreichen können muss.
:::

## So funktioniert es

```mermaid title="Von einem Ereignis in OneUptime zu einer Nachricht in Mattermost"
flowchart TB
    event["Ein Vorfall, eine Warnung oder ein Ereignis<br/>entsteht oder ändert sich"] --> rules{"Benachrichtigungsregeln,<br/>deren Bedingungen passen"}
    rules -->|"Ein Kanal<br/>für jeden"| own["Ein eigener Kanal,<br/>seine Personen hinzugefügt, sobald sie dazukommen"]
    rules -->|"In vorhandenen Kanälen posten"| existing["Ihre bestehenden Kanäle"]
    own --> message["Eine Nachricht mit Schaltflächen"]
    existing --> message
    message -->|"Ein Responder drückt eine"| change["Die Änderung erfolgt in OneUptime,<br/>als diese Person"]
```

Zwei Verbindungen machen das möglich:

- **Die Verbindung des Projekts**, einmal hergestellt: ein Bot-Konto auf Ihrem Mattermost-Server, in den Teams, in denen OneUptime postet. Es postet die Nachrichten, legt die Kanäle an und fügt ihnen Personen hinzu.
- **Die eigene Verbindung jeder Person**: ihr Mattermost-Konto, verknüpft mit ihrem OneUptime-Konto. Schaltflächen handeln als diese Person, mit ihren Berechtigungen im Projekt.

Ein Mattermost-Team kann mit mehr als einem Projekt verbunden sein, etwa mit Produktion und Staging. Eine Schaltfläche handelt im Projekt des Datensatzes, um den es in ihrer Nachricht geht.

## Bevor Sie beginnen

- **Eine Rolle, die das Projekt verbinden darf:** **Projektinhaber**, **Projektadministrator** oder **Projektmitglied**. Zum Trennen braucht es **Projektinhaber** oder **Projektadministrator**.
- **Einen Mattermost-Server**, auf dem Sie ein Bot-Konto erstellen dürfen, oder einen Mattermost-Admin, der eines für Sie erstellen kann. Mattermost Cloud und selbst gehostetes Mattermost funktionieren beide.
- **Den Growth-Tarif in OneUptime Cloud** für Benachrichtigungsregeln und Zusammenfassungen.

Auf dem Server von OneUptime selbst muss für Mattermost nichts eingerichtet werden: Jedes Projekt bringt seinen eigenen Mattermost-Server und sein eigenes Bot-Konto mit.

## Mattermost verbinden

:::steps
### Ein Bot-Konto in Mattermost erstellen

Öffnen Sie in Mattermost **System Console** > **Integrations** > **Bot Accounts** und stellen Sie sicher, dass **Enable Bot Account Creation** eingeschaltet ist. Gehen Sie dann zu **Integrations** > **Bot Accounts** > **Add Bot Account**, nennen Sie es `oneuptime` und speichern Sie. Mattermost zeigt das Zugriffstoken des Bots ein einziges Mal an: Kopieren Sie es.

### Den Bot Ihrem Team hinzufügen

Fügen Sie den Bot jedem Team hinzu, in dem OneUptime posten soll, so wie Sie eine Person hinzufügen würden: **Main Menu** > **Invite People**, und laden Sie `@oneuptime` ein. OneUptime legt Kanäle nur in den Teams an, in denen der Bot Mitglied ist, und postet nur dort.

### Das Projekt verbinden

Gehen Sie in OneUptime zu **Projekteinstellungen** > **Arbeitsbereich** > **Mattermost** und klicken Sie auf **Mit Mattermost verbinden**. Geben Sie die Adresse Ihres Servers ein, etwa `https://chat.example.com`, und das Zugriffstoken des Bots. OneUptime prüft das Token bei Ihrem Server, bevor es irgendetwas speichert. Ist der Bot in mehr als einem Team, fragt OneUptime, welches davon das Standard-Team ist: das Team, in dem eine Benachrichtigungsregel, die kein Team nennt, ihre Kanäle anlegt. Solange kein Workspace verbunden ist, enthält der Abschnitt **Arbeitsbereich** der Menüs Vorfälle, Warnungen, Geplante Wartung, Monitore und Bereitschaft den Eintrag **Arbeitsbereich verbinden**, der ebenfalls hierher führt.

### Eine Benachrichtigungsregel hinzufügen

Gehen Sie zu **Vorfälle** > **Arbeitsbereich** > **Mattermost** und legen Sie eine Regel an. Zum Beispiel eine, die für jeden neuen Vorfall einen Mattermost-Kanal mit allen erstellt, die daran arbeiten. Siehe [Benachrichtigungsregeln](#benachrichtigungsregeln).
:::

Das Zugriffstoken des Bots wird nur auf dem OneUptime-Server aufbewahrt, verschlüsselt zusammen mit den übrigen Geheimnissen des Projekts, und nie wieder angezeigt. Die Serveradresse, die Teams und der Benutzername des Bots werden allen im Projekt angezeigt, auf der Mattermost-Einstellungsseite.

Ein Projekt ist mit einem einzigen Mattermost-Server verbunden. Um es auf einen anderen Server zu verlegen, trennen Sie es zuerst: **Projekteinstellungen** > **Arbeitsbereich** > **Mattermost**, dann **⋯** > **Mattermost trennen**. Das Trennen trennt auch das eigene Mattermost-Konto jedes Mitglieds und entfernt dessen Mattermost-Benachrichtigungsmethoden und die Bereitschaftsregeln, die sie verwenden. Ihre Benachrichtigungsregeln und Zusammenfassungen bleiben für eine spätere neue Verbindung erhalten.

## Mehr als ein Team

OneUptime funktioniert in jedem Team Ihres Mattermost-Servers, in dem sein Bot Mitglied ist:

1. Fügen Sie den Bot in Mattermost jedem Team hinzu, das OneUptime nutzen soll, so wie Sie eine Person hinzufügen würden: Öffnen Sie das Team, dann **Main Menu** > **Invite People**.
2. Die Karte **Mattermost-Teams** unter **Projekteinstellungen** > **Arbeitsbereich** > **Mattermost** listet diese Teams auf, das Standard-Team zuerst. Klicken Sie auf **Aktualisieren**, nachdem Sie den Bot einem weiteren Team hinzugefügt haben.

- **Welches Team eine Regel nutzt.** Benachrichtigungsregeln wählen das **Mattermost-Team**, in dem ihre Kanäle liegen. Bleibt das Feld leer, legt eine Regel ihren Kanal im Standard-Team an und sucht die Kanäle, die sie nennt, zuerst dort und dann in den anderen Teams des Bots.
- **Welches Team eine Zusammenfassung nutzt.** Zusammenfassungen, auf der Registerkarte **Zusammenfassung** von **Vorfälle** und **Warnungen**, wählen ebenso das **Mattermost-Team**, in dem ihre Kanäle liegen. Bleibt das Feld leer, sucht eine Zusammenfassung ihre Kanäle zuerst im Standard-Team und dann in den anderen Teams des Bots.
- **Das Standard-Team.** Es ist das Team, mit dem Sie das Projekt verbunden haben. **Als Standard festlegen** auf der Karte macht ein anderes Team zum Standard, für eine Rolle, die das Projekt verbinden darf.
- **Wo OneUptime funktioniert.** Die Schaltflächen in den Nachrichten von OneUptime und die Formulare, die sie öffnen, funktionieren in jedem dieser Teams. In einem Team, aus dem der Bot entfernt wurde, meldet eine Schaltfläche nur, dass das Team nicht mehr verbunden ist.
- **Ein Standard-Team, aus dem der Bot entfernt wurde.** Die Karte weist darauf hin. Fügen Sie den Bot in Mattermost wieder hinzu oder machen Sie ein anderes Team zum Standard.
- **Ein Team, das eine Regel nennt und aus dem der Bot entfernt wurde.** Die Karte der Regel weist darauf hin, und die Regel nutzt stattdessen kein anderes Team. Fügen Sie den Bot in Mattermost wieder dem Team hinzu oder wählen Sie in der Regel ein anderes Team: Ihr Formular zeigt die alte Auswahl weiterhin an, damit Sie sie ändern können.

## Ihr eigenes Mattermost-Konto verbinden

Mattermost hat keine Anmeldeseite, zu der OneUptime Sie schicken könnte, daher schickt der Bot von OneUptime Ihrem Mattermost-Konto stattdessen eine Direktnachricht mit einem Link:

:::steps
1. Gehen Sie zu **Benutzereinstellungen** > **Arbeitsbereich** > **Mattermost**. OneUptime sucht das Mattermost-Konto mit Ihrer E-Mail-Adresse. Findet es eines, klicken Sie auf **Link an @your-username senden**. Wenn nicht, klicken Sie auf **Link an mich senden** und geben Sie Ihren Mattermost-Benutzernamen ein.
2. Öffnen Sie in Mattermost die Direktnachricht vom OneUptime-Bot und klicken Sie auf **Connect my account**.
3. Der Link öffnet OneUptime, das Ihr Konto verbindet.
:::

Öffnen Sie den Link im selben Browser, in dem Sie ihn angefordert haben: Er funktioniert nur dort, nur einmal und nur 15 Minuten lang. Das beweist, dass die Person, die ihn angefordert hat, beide Konten besitzt, sodass niemand das Mattermost-Konto einer anderen Person verbinden kann. Haben Sie keinen Link angefordert, ignorieren Sie ihn: Es wird nichts verbunden, solange er nicht in dem Browser geöffnet wird, der ihn angefordert hat.

Die Verbindung Ihres Kontos gehört zu diesem Projekt. In einem anderen Projekt, das mit demselben Mattermost-Team verbunden ist, verbinden Sie es dort ebenfalls.

## In Mattermost alarmiert werden

Um per Direktnachricht alarmiert zu werden, wenn Sie Bereitschaft haben, fügen Sie Mattermost als eine Ihrer Benachrichtigungsmethoden hinzu:

:::steps
1. Verbinden Sie Ihr eigenes Mattermost-Konto (siehe [Ihr eigenes Mattermost-Konto verbinden](#ihr-eigenes-mattermost-konto-verbinden)).
2. Gehen Sie zu **Benutzereinstellungen** > **Benachrichtigungsmethoden**, öffnen Sie die Registerkarte **Workspace-Apps** und klicken Sie auf **Mattermost-Konto hinzufügen**.
3. Klicken Sie in seiner Zeile auf **Testnachricht senden**. Die Nachricht kommt als Direktnachricht vom Bot des Projekts an.
:::

Durch das Hinzufügen landet es sofort in Ihren Bereitschaftsregeln, sodass Alarme Sie ab dann in Mattermost erreichen. Welche Alarme es bekommt, ändern Sie unter **Benutzereinstellungen** > **Wie ich erreichbar bin**. Jeder Alarm enthält einen Link zum Bestätigen und einen zum Eskalieren. Wenn Sie Ihr Mattermost-Konto trennen, werden diese Methode und die Bereitschaftsregeln entfernt, die sie verwenden.

## Benachrichtigungsregeln

Eine Benachrichtigungsregel legt fest, welche Ereignisse in Mattermost gepostet werden, und wohin. Jedes Produkt hat eigene Regeln, unter **Arbeitsbereich** > **Mattermost** in seinem Menü: **Vorfälle** (mit **Vorfallsepisoden** und einer Registerkarte **Zusammenfassung**), **Warnungen** (mit **Warnungsepisoden** und **Zusammenfassung**), **Geplante Wartung**, **Monitore**, **Bereitschaft**, **Sicherheitsereignisse** und **SLOs**. Sie funktionieren wie die von Slack: Bedingungen, Ziele und wer einem Kanal beitritt, stehen unter [Benachrichtigungsregeln](/docs/workspace-connections/slack#benachrichtigungsregeln).

Ein Kanal, den eine Regel anlegt, wird nach seinem Datensatz benannt: Vorfall INC-42 bekommt `inc-42`. Mattermost nimmt Kleinbuchstaben, Ziffern, `-` und `_`, bis zu 64 Zeichen, mit einem Buchstaben oder einer Ziffer am Anfang und am Ende, und das Regelformular zeigt den Namen schon beim Tippen. Gibt es schon einen Kanal mit diesem Namen, etwa einen archivierten, hängt OneUptime `-2`, `-3` und so weiter an. Ein privater Vorfall, eine private Warnung oder Episode bekommt einen privaten Kanal.

Um in einem bestehenden Kanal zu posten, geben Sie seinen Namen so ein, wie er in seiner Adresse steht, etwa `incidents` für `chat.example.com/team/channels/incidents`, oder seinen Anzeigenamen. Einem öffentlichen Kanal tritt OneUptime beim ersten Posten selbst bei. Fügen Sie den Bot in Mattermost einem privaten Kanal hinzu, bevor eine Regel dorthin postet. Ist der Bot in mehr als einem Team, wählt eine Regel außerdem das Team, in dem ihre Kanäle liegen: siehe [Mehr als ein Team](#mehr-als-ein-team).

Personen treten dem Kanal einer Regel über das Mattermost-Konto bei, das sie verbunden haben, oder sonst über das Mattermost-Konto mit ihrer E-Mail-Adresse, wenn Ihr Server dem Bot E-Mail-Adressen zeigt (**System Console** > **Site Configuration** > **Users and Teams** > **Show Email Address**). Wen OneUptime nicht hinzufügen konnte, nennt es in einer einzigen Nachricht im Kanal, mit einem Link, um das eigene Konto zu verbinden.

Ein Vorfall, eine Warnung, eine Episode oder ein geplantes Wartungsereignis mit einem eigenen Kanal hat im Kopf seiner Seite in OneUptime, neben den Statusschaltflächen, **In Mattermost öffnen**. Das öffnet diesen Kanal in einem neuen Tab, auf Ihrem Mattermost-Server. Ein Datensatz mit zwei eigenen Kanälen listet beide unter der Schaltfläche. Ein Datensatz, der auch Kanäle in Slack oder Microsoft Teams hat, hat stattdessen eine Schaltfläche **Kanal öffnen**, die sie alle auflistet. Die bestehenden Kanäle, in die Ihre Regeln posten, werden nicht angeboten.

**Regel testen** in der Zeile einer Regel postet eine Testnachricht für diese Regel in die Kanäle, die sie nennt, wie bei Slack.

Die Nachrichten von OneUptime benachrichtigen niemanden durch das, was sie zitieren: Ein Name oder eine Beschreibung mit `@channel`, `@here` oder `@someone` erscheint so, wie sie geschrieben ist, und benachrichtigt niemanden.

## Wer im Kanal eines Datensatzes ist

Ein Vorfall, eine Warnung, eine Episode oder ein geplantes Wartungsereignis mit einem eigenen Mattermost-Kanal hat auf seiner Seite in OneUptime eine Karte **Mattermost-Kanal**. Die Karte zeigt den Kanal als Link, der ihn auf Ihrem Mattermost-Server öffnet, ob er privat ist und wer darin ist, Sie zuerst. Auf der Karte, ohne einen Mattermost-Admin:

- **Kanal beitreten** fügt Sie hinzu, wenn Sie nicht im Kanal sind.
- **Personen hinzufügen** öffnet eine Liste der Personen und Teams des Projekts: Wählen Sie eine Person, um sie hinzuzufügen, oder ein Team, um alle darin hinzuzufügen.

Der Bot von OneUptime fügt sie hinzu, so wie er die Personen des Kanals einer Regel hinzufügt. Der Bot bleibt in den Kanälen, die er erstellt, daher klappt das auch bei einem privaten Kanal, den alle verlassen haben. Ein Datensatz, der auch Kanäle in Slack oder Microsoft Teams hat, listet sie alle auf einer Karte **Chat-Kanäle**.

- **Wer Personen hinzufügen darf.** Wer den Datensatz bearbeiten darf: **Projektinhaber**, **Projektadministrator**, **Projektmitglied**, **Vorfall-Administrator** und **Vorfall-Mitglied** bei einem Vorfall oder **Edit Incident** in einer benutzerdefinierten Rolle, und dieselbe Berechtigung bei einer Warnung, einer Episode oder einem Ereignis (zum Beispiel **Edit Alert**). Alle anderen sehen, wer im Kanal ist und wie sie hineinkommen.
- **Wer hinzugefügt werden kann.** Jemand, den OneUptime in Mattermost findet, über das verbundene Konto oder sonst über die E-Mail-Adresse, wenn Ihr Server dem Bot E-Mail-Adressen zeigt, und der im Team des Kanals ist. Auch ein Gastkonto in diesem Team kann hinzugefügt werden: Mattermost erlaubt den Mitgliedern eines Kanals, Gäste hinzuzufügen. Die Karte nennt, wen sie nicht hinzufügen konnte, und warum.
- **Was festgehalten wird.** Wer hinzugefügt wurde und von wem, im Feed des Datensatzes (**Kanalmitglied hinzugefügt**) und unter **Projekteinstellungen** > **Benachrichtigungen** > **Benachrichtigungsprotokolle** auf der Registerkarte **Arbeitsbereich**.
- **Ein archivierter Kanal.** Die Karte listet weiter, wer darin ist, und fügt niemanden hinzu, bis die Archivierung des Kanals in Mattermost aufgehoben wird.
- **Ein Kanal, aus dem der Bot entfernt wurde.** Mattermost zeigt die Personen eines Kanals nur jemandem, der darin ist, auch bei einem öffentlichen Kanal, daher sagt die Karte, dass sie den Kanal nicht sehen kann. Jemand darin kann den Bot in Mattermost wieder hinzufügen. Einem öffentlichen Kanal tritt OneUptime außerdem selbst wieder bei, wenn es das nächste Mal dort postet.
- **Jemanden entfernen.** OneUptime fügt nur hinzu: Entfernen Sie jemanden in Mattermost aus dem Kanal.

## Aus Mattermost auf Vorfälle, Warnungen und Ereignisse reagieren

Die Nachrichten von OneUptime tragen Schaltflächen und ein Menü **More actions** für das, was weniger Personen brauchen. Jede handelt als Sie, mit Ihren Berechtigungen im Projekt, und antwortet in einer Nachricht, die nur Sie sehen.

| Datensatz | Schaltflächen und Menü |
| --- | --- |
| **Vorfall** | **Acknowledge**, **Resolve**, **Add Note** und im Menü **Change Severity** und **Change State** |
| **Warnung** | **Acknowledge**, **Resolve**, **Add Note**, **Change State**, **Execute On-Call Policy** |
| **Vorfallsepisode, Warnungsepisode** | **Acknowledge**, **Resolve**, **Add Note**, **Change State**, **Execute On-Call Policy** |
| **Geplante Wartung** | **Mark as Ongoing**, **Mark as Complete**, **Add Note**, **Change State** |

**Add Note**, **Change State**, **Change Severity** und **Execute On-Call Policy** öffnen ein Formular in Mattermost. Eine Notiz zu einem Vorfall oder einem geplanten Wartungsereignis kann öffentlich sein, also auf der Statusseite erscheinen, oder privat; eine Notiz zu einem privaten Vorfall ist immer privat, und eine zu einer Warnung ebenfalls immer. Jede Nachricht hat außerdem einen Link, der ihren Datensatz in OneUptime öffnet, für alles andere. Wenn öffentliche Notizen im Projekt eine Genehmigung brauchen, wartet eine öffentliche Notiz aus dem Formular darauf, und eine Nachricht, die nur Sie sehen, sagt, auf wen sie wartet: siehe [Genehmigung öffentlicher Notizen](/docs/incidents/notes-owners-and-feed#genehmigung-öffentlicher-notizen).

Ist Ihr Mattermost-Konto noch nicht verbunden, sagt Ihnen eine Schaltfläche das, mit einem Link zu **Benutzereinstellungen** > **Arbeitsbereich** > **Mattermost**. Verbinden Sie Ihr Konto und drücken Sie die Schaltfläche dann erneut.

Jeder Druck auf eine Schaltfläche wird unter **Projekteinstellungen** > **Benachrichtigungen** > **Benachrichtigungsprotokolle** auf der Registerkarte **Arbeitsbereich** festgehalten, mit der Person, die gedrückt hat.

## Eine öffentliche Notiz genehmigen

Wenn die öffentlichen Notizen Ihres Projekts genehmigt werden müssen und Sie Mattermost für **Genehmigung öffentlicher Notizen** in Ihren Benachrichtigungseinstellungen einschalten, kommt jede öffentliche Notiz, die auf einen Schritt wartet, den Sie genehmigen, in Ihre Direktnachrichten mit dem Bot von OneUptime: wer sie gesendet hat, auf welchen Schritt sie wartet, die Notiz, **Approve**, **Reject** und ein Link zur Notiz in OneUptime. **Approve** genehmigt sie für diesen Schritt; beim letzten Schritt heißt die Schaltfläche **Approve and publish**, und die Notiz wird sofort veröffentlicht. **Reject** öffnet ein Formular, das nach dem Grund fragt: Ein Grund ist erforderlich, und wer die Notiz geschrieben hat, sieht ihn. Die Schaltflächen handeln als Sie, nach denselben Regeln wie in OneUptime, und antworten in einer Nachricht, die nur Sie sehen. Ein Klick, nachdem jemand anderes entschieden hat oder sich die Notiz oder ihre Schritte geändert haben, entscheidet nichts und sagt, was geschehen ist. Sobald über die Notiz entschieden ist, ändert sich die Nachricht jedes Genehmigenden dazu, auch Ihre, und sagt, was geschehen ist: für ihren Schritt genehmigt und auf wen sie jetzt wartet, veröffentlicht, abgelehnt, geändert oder erneut zur Genehmigung gesendet, ohne Genehmigung veröffentlicht oder gelöscht. Sie behält ihren Link zur Notiz in OneUptime, und **Approve** und **Reject** sind verschwunden. Ist Ihr Mattermost-Konto nicht verbunden, verbinden Sie es unter **Benutzereinstellungen** > **Arbeitsbereich** > **Mattermost** und klicken Sie die Schaltfläche dann erneut. Ändern sich die Genehmigungsschritte, während eine Notiz wartet, ändert sich auch Ihre Nachricht dazu, wenn die Notiz nicht mehr auf Ihren Schritt wartet oder Sie nicht mehr gefragt werden, und wer jetzt an der Reihe ist, bekommt eine eigene Nachricht. Siehe [Genehmigung öffentlicher Notizen](/docs/incidents/notes-owners-and-feed#genehmigung-öffentlicher-notizen).

## Netzwerk und Selbsthosting

Zwei Server sprechen miteinander:

- **OneUptime ruft Ihren Mattermost-Server auf**, um zu posten, Kanäle anzulegen und Personen hinzuzufügen. In OneUptime Cloud muss Ihr Mattermost-Server aus dem Internet erreichbar sein. Ein selbst gehostetes OneUptime kann einen Mattermost-Server in einem privaten Netzwerk erreichen, sobald sein Betreiber private Adressen mit `ALLOW_PRIVATE_NETWORK_WEBHOOKS` oder `PRIVATE_NETWORK_WEBHOOK_ALLOWLIST` erlaubt. OneUptime ruft nie eine Adresse auf seinem eigenen Rechner oder eine Cloud-Metadatenadresse auf und folgt nie einer Weiterleitung.
- **Ihr Mattermost-Server ruft OneUptime auf**, wenn jemand eine Schaltfläche drückt oder ein Formular absendet: `https://<your OneUptime>/api/mattermost/interactive` und `/api/mattermost/dialog`. Ist die Adresse von OneUptime eine private, tragen Sie ihren Host in Mattermost unter **System Console** > **Environment** > **Developer** > **Allow untrusted internal connections to** ein, sonst funktionieren die Schaltflächen nicht.

Jede Schaltfläche, die OneUptime postet, trägt eine Signatur für das Mattermost-Team, in dem sie gepostet wurde, und diese wird beim Drücken geprüft: Ein Druck, den OneUptime nicht signiert hat, oder einer aus einem anderen Team bewirkt nichts.

## Fehlerbehebung

| Was Sie sehen | Was zu tun ist |
| --- | --- |
| **Mattermost did not accept the access token** | Kopieren Sie das Token des Bots erneut. Mattermost zeigt es nur einmal: Erstellen Sie bei Bedarf unter **Integrations** > **Bot Accounts** ein neues. |
| **The bot account is not a member of any team** | Fügen Sie den Bot in Mattermost Ihrem Team hinzu und verbinden Sie das Projekt dann erneut. |
| Ein Team, dem Sie den Bot hinzugefügt haben, fehlt auf der Karte **Mattermost-Teams** | Klicken Sie auf der Karte auf **Aktualisieren**. |
| **OneUptime's bot is not a member of this Mattermost team** | Sie haben ein Team gewählt, das der Bot verlassen hat. Fügen Sie den Bot in Mattermost diesem Team hinzu und klicken Sie dann auf **Aktualisieren**. |
| **OneUptime's bot may not create channels in the Mattermost team this rule names** | Fügen Sie den Bot in Mattermost diesem Team hinzu oder wählen Sie für die Regel ein anderes Team. |
| **OneUptime's bot is not a member of the Mattermost team chosen for the channel** | Fügen Sie den Bot in Mattermost diesem Team hinzu oder wählen Sie für die Regel ein anderes Team. |
| **OneUptime's bot is no longer a member of the project's default Mattermost team** | Fügen Sie den Bot in Mattermost wieder diesem Team hinzu oder machen Sie ein anderes Team zum Standard. |
| **OneUptime could not reach the Mattermost server** | Prüfen Sie die Adresse und ob OneUptime sie erreichen kann. Siehe [Netzwerk und Selbsthosting](#netzwerk-und-selbsthosting). |
| **The bot is not a member of the private Mattermost channel** | Fügen Sie den Bot in Mattermost dem Kanal hinzu. |
| Eine Schaltfläche tut nichts, oder Mattermost sagt, die Aktion habe nicht abgeschlossen werden können | Mattermost kann OneUptime nicht erreichen. Siehe [Netzwerk und Selbsthosting](#netzwerk-und-selbsthosting). |
| Es kommt keine Direktnachricht mit Ihrem Link an | Prüfen Sie den Benutzernamen und ob der Bot in einem Team ist, in dem Sie Mitglied sind. |
| Die Kanalkarte sagt, dass OneUptime den Kanal nicht sehen kann | Der Kanal wurde gelöscht, oder der Bot wurde daraus entfernt. Falls er noch existiert, kann jemand darin den Bot in Mattermost wieder hinzufügen. |
| Die Kanalkarte sagt, dass jemand nicht im Mattermost-Team ist | Fügen Sie die Person in Mattermost dem Team des Kanals hinzu und fügen Sie sie dann erneut hinzu. |
