# Hilfe und Support

Richten Sie die Hilfe, die OneUptime anbietet, auf Ihr eigenes Team aus: die Support-Adresse, den Chat und die Hilfeseite, die Personen sehen, wohin **Feedback geben** geht, was Single Sign-On jemandem sagt, der eine Einladung braucht, und die Aufforderungen, die mobile App herunterzuladen. Jede dieser Stellen kann beim Standard von OneUptime bleiben, auf eine eigene Adresse oder einen eigenen Link zeigen oder ausgeblendet werden.

:::cards
- [Ändern, wohin die Hilfe führt](#ändern-wohin-die-hilfe-führt): Eine einzige Seite im Admin Dashboard.
- [Was jede Einstellung ändert](#was-jede-einstellung-ändert): Jede Stelle, ihr Standard und ihre Optionen.
- [Feedback geben](#feedback-geben): Wohin gesendet wird, was Personen schreiben.
- [Die Anmeldenachricht](#die-anmeldenachricht): Wen man um eine Einladung bittet.
- [Die Einstellungen aus Ihrer Konfiguration festlegen](#die-einstellungen-aus-ihrer-konfiguration-festlegen): Helm-Werte oder `config.env`, für einen neuen Server.
:::

## Ändern, wohin die Hilfe führt

:::steps
### Hilfe und Support öffnen
Öffnen Sie im Admin Dashboard **Einstellungen** und dann im Seitenmenü **Hilfe und Support**.

### Eine Stelle ändern
Wählen Sie daneben **Ändern**, entscheiden Sie sich für **Standard**, eine eigene Adresse oder einen eigenen Link oder **Ausblenden**, und wählen Sie dann **Speichern**. **Demo anfordern** und **Fehler melden oder Feature anfordern** sind Schalter, die gespeichert werden, sobald Sie sie umlegen.

### Prüfen, was Personen sehen
Das Hilfemenü und der Anmeldebildschirm werden neben ihren Einstellungen als Vorschau gezeigt. Personen sehen eine Änderung, wenn sie das nächste Mal eine Seite öffnen.
:::

Solange Sie eine Stelle nicht ändern, zeigt sie, was OneUptime schon immer zeigt, sodass ein Server, auf dem die Seite nie geöffnet wird, genau wie bisher aussieht.

## Was jede Einstellung ändert

| Einstellung | Wo Personen sie sehen | Standard | Eigene Einstellung |
| --- | --- | --- | --- |
| **Support-E-Mail** | Hilfe › **Support-E-Mail**, **Support kontaktieren**, wenn eine Seite nicht gefunden wird, E-Mails zum Konto und die Adresse, an die Personen auf einem Fehlerbildschirm ein Support-Paket senden sollen | `support@oneuptime.com` | Eine E-Mail-Adresse |
| **Chat** | Hilfe › **Chat auf Slack** und der Chat-Link oben in der API-Referenz | Die OneUptime-Community auf Slack | Ein Link. Ein Link zu Slack oder Microsoft Teams behält seinen Namen; jeder andere heißt **Chat mit dem Support** |
| **Demo anfordern** | Hilfe › **Demo anfordern** | Angezeigt | Nur ausgeblendet |
| **Feedback geben** | Hilfe › **Feedback geben** und **Feedback geben** in der Suche | Die Admins dieses Servers | Eine E-Mail-Adresse oder eine eigene Seite |
| **Hilfe und Support** | **Hilfe und Support** in der Fußzeile, **Kontakt** auf den Anmeldeseiten und **Support** oben in der API-Referenz | `https://oneuptime.com/support` | Ein Link |
| **Fehler melden oder Feature anfordern** | Der untere Rand des Produktmenüs, das öffentliche GitHub-Issue, das nach einem Feedback angeboten wird, und die GitHub-Links der Dokumentation und der API-Referenz | Angezeigt | Nur ausgeblendet |
| **Mobile App herunterladen** | **Wie ich erreichbar bin**, die Einrichtung der Bereitschaft, die ersten Schritte eines neuen Mitglieds auf der Startseite und **Mobile Apps** in den **Projekteinstellungen** | Der App Store und Google Play | Eine eigene Seite, etwa das Unternehmensportal Ihrer Geräteverwaltung |
| **Nachricht für Personen, die eine Einladung brauchen** | Die Single-Sign-On-Bildschirme, die „You need to be invited.“ und „No project access.“ sagen | Der Satz von OneUptime | Ihre eigenen Worte |

Jede Einstellung außer der Nachricht lässt sich auch ausblenden. Ein Link beginnt mit `https://`, `http://` oder `mailto:`. Jede andere Art von Link, darunter `javascript:`, wird von der Seite und noch einmal vom Server abgelehnt.

Das eigene Hilfemenü, die Fußzeile und das Produktmenü des Admin Dashboards behalten die Links von OneUptime, denn sie richten sich an die Admins dieses Servers, die Hilfe zum Server von OneUptime bekommen.

### E-Mails zum Konto

Auf einem selbst gehosteten Server verweisen E-Mails zum Konto, etwa zu einer Einladung oder zu einer geänderten E-Mail-Adresse, am Ende an den Admin dieses Servers, nie an den Support von OneUptime. Ist eine eigene Support-Adresse festgelegt, nennen sie diese als Link: „Brauchen Sie Hilfe? Schreiben Sie an it-help@example.com.“ Beim Standard oder wenn die Einstellung ausgeblendet ist, lauten sie wie bisher.

### Die Dokumentation und die API-Referenz

Die Dokumentation und die API-Referenz, die dieser Server ausliefert, folgen denselben Einstellungen. Ist **Fehler melden oder Feature anfordern** ausgeblendet, verlinkt keine Seite auf GitHub, und die Frage **War diese Seite hilfreich?** wird nur dort gestellt, wo ihre Antwort aufbewahrt oder gesendet wird. Die obere Leiste der API-Referenz zeigt den Chat und die Hilfeseite, die Sie gewählt haben, oder keines von beiden, wenn sie ausgeblendet sind.

### Wer Ihre Links lesen kann

Die Support-Adresse und der Link **Hilfe und Support** erscheinen auch auf den Anmeldeseiten, sodass jeder, der diese Seiten öffnen kann, sie lesen kann. Ein Chat-Link und die Seite der mobilen App werden nur an angemeldete Personen gesendet: Ein Chat-Link ist oft eine Einladung in Ihren Workspace. Aus demselben Grund zeigen die Dokumentation und die API-Referenz, die jeder lesen kann, einen eigenen Chat-Link nur jemandem, der bei diesem Server angemeldet ist.

## Feedback geben

| Auswahl | Was passiert |
| --- | --- |
| **Standard** | Wie bisher: per E-Mail an die **Admin-Benachrichtigungs-E-Mail** gesendet, die unter **Einstellungen** › **E-Mails** festgelegt ist, oder für die Admins dieses Servers unter **Feedback** aufbewahrt, wenn keine festgelegt ist. In OneUptime Cloud geht es an das OneUptime-Team. |
| **Eine E-Mail-Adresse** | Per E-Mail dorthin gesendet, über die E-Mail-Einstellungen dieses Servers, mit Namen und E-Mail-Adresse der Person, damit Ihr Team antworten kann. Die Person erhält eine Kopie. |
| **Eine eigene Seite** | **Feedback geben** öffnet sie in einem neuen Tab, etwa das Formular Ihres Helpdesks. Von OneUptime wird nichts gesendet. |
| **„Feedback geben“ ausblenden** | **Feedback geben** wird nirgends angeboten. |

Solange der Server keine E-Mails senden kann, blendet die Wahl einer E-Mail-Adresse **Feedback geben** aus, statt eine Nachricht anzunehmen, die Ihr Team nicht erreichen kann, und die Einstellungsseite weist darauf hin. Richten Sie E-Mail unter **Einstellungen** › **E-Mails** ein, und **Feedback geben** kehrt von selbst zurück.

Die Fragen, die OneUptime stellt, etwa wie einfach eine geführte Einrichtung war, sind nicht **Feedback geben**. Die Antworten darauf bleiben unter **Feedback**, wo der Schalter **Fragen, wie es gelaufen ist** die Fragen ausschaltet.

## Die Anmeldenachricht

Das eigene Single Sign-On des Servers weist zwei Arten von Personen ab: jemanden ohne Konto, solange der Anbieter keines anlegt („You need to be invited.“), und jemanden, dessen Konto in keinem Projekt ist („No project access.“). Beide brauchen eine Einladung, daher zeigen beide Bildschirme Ihre Nachricht, mit der Angabe, wen man fragen soll und wie man diese Person erreicht:

```text
Ask the IT service desk to invite you to OneUptime:
it-help@example.com or https://help.example.com/oneuptime
```

- Die Nachricht ist reiner Text mit bis zu 1000 Zeichen und darf kein `<` oder `>` enthalten.
- Jede Zeile ist ein Absatz, und Links und E-Mail-Adressen darin werden zu Links.
- Der Titel des Bildschirms bleibt, wie er ist, und die mobile App zeigt dieselben Worte.

## Die Aufforderungen zur mobilen App

Mit einer eigenen Seite zeigt jede Aufforderung, die mobile App herunterzuladen, dorthin: ein QR-Code für Ihre Seite, benannt nach ihrer Adresse, und die Schritte nennen weiterhin die Adresse dieses Servers, mit der sich die App verbindet. Ist die Einstellung ausgeblendet, gibt es gar keine Aufforderung:

- **Mobile App herunterladen** verschwindet aus den ersten Schritten eines neuen Mitglieds auf der Startseite, die trotzdem abgeschlossen werden, sobald die Person erreichbar ist und eine Test-Alarmierung sie erreicht hat.
- **Wie ich erreichbar bin** und die Einrichtung der Bereitschaft bieten nur Browser an.
- **Mobile Apps** verschwindet aus den **Projekteinstellungen**.
- Überall, wo OneUptime aufzählt, wie man jemanden erreichen kann, etwa in den geführten Einrichtungen, auf der Startseite, in den Compliance-Regeln eines Teams und in KI fragen, wird die App nicht mehr genannt.

## Die Einstellungen aus Ihrer Konfiguration festlegen

Bei einem Server, der mit Helm oder Docker Compose installiert wird, können diese Einstellungen schon beim Start festgelegt sein. Legen Sie sie im Helm-Chart in den Werten unter `helpAndSupport` fest oder bei Docker Compose in `config.env`:

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

| Helm-Wert | `config.env` | Erlaubte Werte |
| --- | --- | --- |
| `supportEmail` | `HELP_AND_SUPPORT_SUPPORT_EMAIL` | Eine E-Mail-Adresse oder `hidden` |
| `chat` | `HELP_AND_SUPPORT_CHAT` | Ein Link oder `hidden` |
| `requestDemo` | `HELP_AND_SUPPORT_REQUEST_DEMO` | `shown` oder `hidden` |
| `giveFeedback` | `HELP_AND_SUPPORT_GIVE_FEEDBACK` | Eine E-Mail-Adresse, ein Link oder `hidden` |
| `helpLink` | `HELP_AND_SUPPORT_HELP_LINK` | Ein Link oder `hidden` |
| `gitHub` | `HELP_AND_SUPPORT_GITHUB` | `shown` oder `hidden` |
| `mobileApp` | `HELP_AND_SUPPORT_MOBILE_APP` | Ein Link oder `hidden` |
| `inviteMessage` | `HELP_AND_SUPPORT_INVITE_MESSAGE` | Reiner Text |

- Die Werte werden beim Start des Servers gelesen, aber nur, solange unter **Hilfe und Support** noch nichts gespeichert wurde. Von da an gelten die Einstellungen der Seite: Eine dort vorgenommene Änderung bleibt erhalten, und ein Neustart setzt sie nie zurück.
- Ein Wert, der später in der Konfiguration geändert wird, wird nicht übernommen, und das Log des Servers weist darauf hin. Ändern Sie ihn auf der Seite.
- Jeder Wert wird so geprüft, wie die Seite ihn prüft. Ein Wert, der abgelehnt würde, etwa ein `javascript:`-Link, wird ausgelassen, und die Seite und das Log des Servers nennen den Grund. Die übrigen werden trotzdem gesetzt.
- Lassen Sie einen Wert leer, um den Standard von OneUptime zu behalten. Für die beiden Schalter funktionieren auch `true` und `false`.
- Die Seite kennzeichnet jede Einstellung, die aus Ihrer Konfiguration stammt, bis Sie sie ändern.

## Nächste Schritte

:::cards
- [Globales SSO](/docs/identity/global-sso): Das eigene Single Sign-On des Servers.
- [Sitzungsdauer](/docs/self-hosted/session-length): Wie lange Personen angemeldet bleiben.
:::
