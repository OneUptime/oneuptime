# Update- und Sicherheitsprüfungen

Einmal am Tag fragt ein selbst gehostetes OneUptime bei GitHub nach, ob ein neueres Release erschienen ist und ob ein von OneUptime veröffentlichter Sicherheitshinweis die Version betrifft, die Sie betreiben. Betrifft ein solcher Hinweis Ihre Version, werden Ihre Master-Admins gebeten, ein Upgrade durchzuführen. Diese Seite beschreibt, was die Prüfung sendet, was Sie sehen und wie Sie sie abschalten.

:::cards
- [Was die Prüfung sendet](#was-die-prüfung-sendet): Zwei öffentliche Fragen und nichts über Ihre Installation.
- [Was Sie sehen](#was-sie-sehen): Die Fußzeile, das Admin Dashboard und eine E-Mail pro Sicherheitshinweis.
- [Die Prüfung abschalten](#die-prüfung-abschalten): Für ein Netzwerk ohne Internetzugang oder um einen Spiegel zu nutzen.
:::

## Was die Prüfung sendet

Der Worker sendet zwei Anfragen an die API von GitHub (`api.github.com`), ohne Token:

| Anfrage | Was sie erfragt |
| --- | --- |
| `GET /repos/OneUptime/oneuptime/releases/latest` | Welches OneUptime-Release das neueste ist |
| `GET /repos/OneUptime/oneuptime/security-advisories?state=published` | Welche Sicherheitshinweise OneUptime veröffentlicht hat, welche Versionen jeder davon betrifft und welches Release ihn behebt |

Darin steht nichts über Ihre Installation: weder die Version, die Sie betreiben, noch ihre Adresse, noch irgendetwas über Ihre Benutzer, Projekte oder Monitoring-Daten. GitHub sieht, wie bei jeder Anfrage, die öffentliche IP-Adresse Ihres Servers und einen `User-Agent`, der OneUptime nennt. Ob ein Sicherheitshinweis Ihre Version betrifft, wird auf Ihrem Server ermittelt, und kein Browser ruft GitHub auf.

Die Prüfung läuft beim Start des Workers und danach einmal am Tag. Sie fragt GitHub höchstens alle 12 Stunden erneut und nach einer fehlgeschlagenen Anfrage höchstens einmal pro Stunde.

## Was Sie sehen

Informiert werden nur Master-Admins. Das sind diejenigen, die ein Upgrade durchführen können, und allen anderen mitzuteilen, dass auf dem Server eine Version mit einer bekannten Sicherheitslücke läuft, würde auf einen ungepatchten Server hinweisen.

- Ein neueres Release fügt der Fußzeile des Dashboards und des Admin Dashboards **Update verfügbar** hinzu. Ein Klick darauf öffnet die Upgrade-Anleitung.
- Ein veröffentlichter Sicherheitshinweis, der die Version betrifft, die Sie betreiben, fügt dort stattdessen **Sicherheitsupdate** in Rot hinzu.
- Die erste Seite des Admin Dashboards listet dann jeden Sicherheitshinweis auf: seinen Schweregrad, die betroffenen Versionen, das Release, das ihn behebt, und einen Link zum Hinweis auf GitHub. Sie zeigt außerdem, wann die Prüfung die Sicherheitshinweise zuletzt gelesen hat und, falls die letzte Prüfung fehlgeschlagen ist, warum.
- Ihre Master-Admins und die Admin-Benachrichtigungs-E-Mail (**Einstellungen** > **E-Mails** im Admin Dashboard) erhalten zu jedem Sicherheitshinweis, der Ihre Version betrifft, eine E-Mail und nie eine zweite.

All das verschwindet, sobald Sie eine Version betreiben, die kein Sicherheitshinweis betrifft. Wie Sie aktualisieren, steht unter [Aktualisierung](/docs/installation/upgrading).

## Die Prüfung abschalten

In einem Netzwerk ohne Internetzugang oder wenn Ihr Server GitHub nicht kontaktieren soll, schalten Sie die Prüfung ab. Dann wird nichts angezeigt und keine E-Mail gesendet.

:::tabs
@tab Kubernetes
```yaml
updateCheck:
  disabled: true
```
@tab Docker Compose
```bash
DISABLE_UPDATE_CHECK=true
```
Tragen Sie das in `config.env` ein und führen Sie dann `npm start` aus.
:::

Um stattdessen gegen einen Spiegel in Ihrem Netzwerk zu prüfen, richten Sie die Prüfung auf ihn. Der Spiegel muss in den Formaten von GitHub antworten.

| Helm-Wert | Docker-Compose-Einstellung | Standard |
| --- | --- | --- |
| `updateCheck.url` | `LATEST_RELEASE_CHECK_URL` | `https://api.github.com/repos/OneUptime/oneuptime/releases/latest` |
| `updateCheck.securityAdvisoriesUrl` | `SECURITY_ADVISORIES_CHECK_URL` | `https://api.github.com/repos/OneUptime/oneuptime/security-advisories` |

## Wenn GitHub nicht erreichbar ist

In einem Netzwerk ohne Internetzugang ist eine fehlgeschlagene Anfrage zu erwarten und kein Fehler. Der Worker protokolliert sie auf Debug-Ebene, behält, was er zuletzt gelesen hat, und versucht es später erneut. Das Admin Dashboard zeigt, wann die Sicherheitshinweise zuletzt gelesen wurden und warum die letzte Prüfung fehlgeschlagen ist: die Ratenbegrenzung von GitHub, keine Route zu GitHub, eine Zeitüberschreitung oder eine Antwort, die nicht von GitHub stammt.

## Nächste Schritte

:::cards
- [Aktualisierung](/docs/installation/upgrading): Auf ein neueres Release aktualisieren, immer nur um eine Hauptversion.
- [Architektur](/docs/self-hosted/architecture): Jede Verbindung, die ein selbst gehostetes OneUptime aufbaut.
- [Hinter einem VPN oder einer Firewall](/docs/self-hosted/behind-a-firewall): Was Ihren Server von außen erreicht.
:::
