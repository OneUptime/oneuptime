# Telefonnummern-Whitelist

In OneUptime Cloud kommen SMS und Anrufe der Bereitschaft von den Nummern unten. Setzen Sie sie auf die Zulassungsliste Ihres Telefons, damit eine Alarmierung nie blockiert, stummgeschaltet oder als Spam einsortiert wird.

## Nummern von OneUptime Cloud

| Nummer | Land |
| --- | --- |
| +13022917020 | Vereinigte Staaten (US) |
| +447427817020 | Vereinigtes Königreich (UK) |

## Die Nummern auf Ihrem Telefon zulassen

:::steps
1. Speichern Sie beide Nummern in den Kontakten Ihres Telefons als einen Kontakt, zum Beispiel „OneUptime“.
2. Wenn Sie „Nicht stören“, einen Fokus oder einen anderen Ruhemodus nutzen, lassen Sie Anrufe und Nachrichten von diesem Kontakt zu.
3. Ist eine App zum Filtern von Anrufen oder Spam oder der Spamschutz Ihres Mobilfunkanbieters aktiv, markieren Sie beide Nummern auch dort als vertrauenswürdig.
:::

> [!TIP]
> Wenn Sie Ihre Telefonnummer unter **Benutzereinstellungen** > **Benachrichtigungsmethoden** hinzufügen oder verifizieren, bekommen Sie einen Code von diesen Nummern. So prüfen Sie schnell, ob sie durchkommen.

## Wenn Alarmierungen von anderen Nummern kommen

Ihre Alarmierungen kommen von anderen als den oben genannten Nummern, wenn:

- **Ihr Projekt ein eigenes Twilio-Konto nutzt.** Hat ein Projekt eine Twilio-Konfiguration als Projektstandard (**Projekteinstellungen** > **Benachrichtigungen** > **Benachrichtigungseinstellungen** > **Twilio-Konfiguration**), gehen SMS und Anrufe an die Mitglieder des Projekts über dieses Konto, von dessen Telefonnummern. Setzen Sie stattdessen diese Nummern auf die Whitelist.
- **Sie eine selbst gehostete Installation nutzen.** SMS und Anrufe kommen von den Twilio-Nummern, die Ihr Administrator eingerichtet hat: der Standard-Twilio-Konfiguration des Projekts oder der installationsweiten unter **Admin Dashboard** > **Einstellungen** > **Anrufe und SMS**. Fragen Sie Ihren Administrator, welche Nummern Sie auf die Whitelist setzen sollen.

## Nächste Schritte

:::cards
- [Eskalationsregeln](/docs/on-call/escalation-rules): Wie jede Person erreicht wird, die eine Stufe alarmiert, und in welcher Reihenfolge.
- [Bereitschaftspläne](/docs/on-call/schedules): Festlegen, wer wann Bereitschaft hat.
- [Twilio-Integration für SMS und Anrufe](/docs/self-hosted/twilio-integration): Ihr eigenes Twilio-Konto und eigene Nummern in einer selbst gehosteten Installation nutzen.
:::
