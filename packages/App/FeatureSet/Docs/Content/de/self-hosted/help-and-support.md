# Hilfe und Support

Richten Sie die Hilfe, die OneUptime anbietet, auf Ihr eigenes Team aus: die Support-Adresse, den Chat und die Hilfeseite, die Personen sehen, wohin **Feedback geben** geht, was Single Sign-On jemandem sagt, der eine Einladung braucht, und die Aufforderungen, die mobile App herunterzuladen. Jede dieser Stellen kann beim Standard von OneUptime bleiben, auf eine eigene Adresse oder einen eigenen Link zeigen oder ausgeblendet werden.

:::cards
- [Ändern, wohin die Hilfe führt](#ändern-wohin-die-hilfe-führt): Eine einzige Seite im Admin Dashboard.
- [Was jede Einstellung ändert](#was-jede-einstellung-ändert): Jede Stelle, ihr Standard und ihre Optionen.
- [Feedback geben](#feedback-geben): Wohin gesendet wird, was Personen schreiben.
- [Die Anmeldenachricht](#die-anmeldenachricht): Wen man um eine Einladung bittet.
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
| **Support-E-Mail** | Hilfe › **Support-E-Mail**, **Support kontaktieren**, wenn eine Seite nicht gefunden wird, und die Adresse, an die Personen auf einem Fehlerbildschirm ein Support-Paket senden sollen | `support@oneuptime.com` | Eine E-Mail-Adresse |
| **Chat** | Hilfe › **Chat auf Slack** | Die OneUptime-Community auf Slack | Ein Link. Ein Link zu Slack oder Microsoft Teams behält seinen Namen; jeder andere heißt **Chat mit dem Support** |
| **Demo anfordern** | Hilfe › **Demo anfordern** | Angezeigt | Nur ausgeblendet |
| **Feedback geben** | Hilfe › **Feedback geben** und **Feedback geben** in der Suche | Die Admins dieses Servers | Eine E-Mail-Adresse oder eine eigene Seite |
| **Hilfe und Support** | **Hilfe und Support** in der Fußzeile und **Kontakt** auf den Anmeldeseiten | `https://oneuptime.com/support` | Ein Link |
| **Fehler melden oder Feature anfordern** | Der untere Rand des Produktmenüs und das öffentliche GitHub-Issue, das nach einem Feedback angeboten wird | Angezeigt | Nur ausgeblendet |
| **Mobile App herunterladen** | **Wie ich erreichbar bin**, die Einrichtung der Bereitschaft, die ersten Schritte eines neuen Mitglieds auf der Startseite und **Mobile Apps** in den **Projekteinstellungen** | Der App Store und Google Play | Eine eigene Seite, etwa das Unternehmensportal Ihrer Geräteverwaltung |
| **Nachricht für Personen, die eine Einladung brauchen** | Die Single-Sign-On-Bildschirme, die „You need to be invited.“ und „No project access.“ sagen | Der Satz von OneUptime | Ihre eigenen Worte |

Jede Einstellung außer der Nachricht lässt sich auch ausblenden. Ein Link beginnt mit `https://`, `http://` oder `mailto:`. Jede andere Art von Link, darunter `javascript:`, wird von der Seite und noch einmal vom Server abgelehnt.

Das eigene Hilfemenü, die Fußzeile und das Produktmenü des Admin Dashboards behalten die Links von OneUptime, denn sie richten sich an die Admins dieses Servers, die Hilfe zum Server von OneUptime bekommen.

### Wer Ihre Links lesen kann

Die Support-Adresse und der Link **Hilfe und Support** erscheinen auch auf den Anmeldeseiten, sodass jeder, der diese Seiten öffnen kann, sie lesen kann. Ein Chat-Link und die Seite der mobilen App werden nur an angemeldete Personen gesendet: Ein Chat-Link ist oft eine Einladung in Ihren Workspace.

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

## Nächste Schritte

:::cards
- [Globales SSO](/docs/identity/global-sso): Das eigene Single Sign-On des Servers.
- [Sitzungsdauer](/docs/self-hosted/session-length): Wie lange Personen angemeldet bleiben.
:::
