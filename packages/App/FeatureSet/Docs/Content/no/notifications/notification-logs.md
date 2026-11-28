# Varslingslogger

Varslingslogger viser hver melding OneUptime har sendt for prosjektet ditt, med én fane per kanal, og hva som ble av hver: om den gikk ut, om den kom frem og, hvis ikke, hvorfor. Åpne dem under **Prosjektinnstillinger → Varslinger → Varslingslogger**, eller under **Varslingslogger** på en hendelse, et varsel, en vedlikeholdshendelse, en statusside eller en vaktpolicy, for det som ble sendt om den.

:::cards
- [Slik leser du en status](#slik-leser-du-en-status): Fargen viser hvor meldingen er, og peker du på den, sier den hva den betyr.
- [SMS](#sms): Sender, så Sendt, så Levert, slik operatøren melder det.
- [Anrop](#anrop): Ringer, og så hvordan anropet endte.
- [WhatsApp og Telegram](#whatsapp-og-telegram): Hva hver app melder etter at den har tatt imot en melding.
- [E-post, push, webhooks og arbeidsområder](#e-post-push-webhooks-og-arbeidsområder): Suksess, eller Feil og hvorfor.
- [Når en SMS blir stående på Sendt](#når-en-sms-blir-stående-på-sendt): Operatører som aldri melder tilbake, og meldinger som aldri kommer frem.
:::

## Slik leser du en status

Hver status er et merke der fargen viser hvor meldingen er:

| Farge | Hvor meldingen er |
| --- | --- |
| Grå | Overlevert, og ingenting har kommet tilbake ennå, som **Sender**. |
| Blå | Leverandøren har den og skal ennå si hvordan det endte, som **Sendt** for en SMS eller **Ringer** for et anrop. |
| Grønn | Den nådde personen, som **Levert**, eller dette er den siste statusen den får. |
| Gul | Den nådde telefonen og ingen svarte, som **Tapt anrop**, eller den gikk ut med en advarsel. |
| Rød | Den nådde ikke personen, som **Ikke levert**, **Mislyktes**, **Feil** eller **For lav saldo**. |

Pek på en status, trykk på den, eller gå til den med Tab-tasten, så sier den hva den betyr og hva som kommer etterpå. **Vis statusmelding** i radens meny viser hva leverandøren svarte, som meldingens ID eller hvorfor den mislyktes. Filteret **Status** på hver fane viser hver status fanen kan vise, i den rekkefølgen en melding går gjennom dem.

Kortet **Hvem fikk beskjed** i oversikten for en hendelse eller et varsel og resultatet av et testoppkall viser statusen til hver melding på samme måte, i de samme fargene: Et anrop som fortsatt ringer, står også der som **Ringer**, aldri som **Sendt**.

## SMS

```mermaid title="Statusene til en SMS, fra OneUptime til telefonen"
flowchart TB
    sending["Sender:<br/>på vei<br/>til operatøren"] --> sent["Sendt:<br/>operatøren har den"]
    sent --> delivered["Levert:<br/>den nådde telefonen"]
    sent --> undelivered["Ikke levert:<br/>operatøren kunne<br/>ikke levere den"]
    sending --> failed["Mislyktes:<br/>den kunne ikke<br/>sendes"]
```

| Status | Hva det betyr |
| --- | --- |
| **Sender** | OneUptime har gitt SMS-en til Twilio, som sender den videre til operatøren. |
| **Sendt** | Operatøren har godtatt SMS-en. Den går til **Levert** eller **Ikke levert** så snart operatøren melder tilbake. |
| **Levert** | Operatøren har bekreftet at SMS-en nådde telefonen. Det er den siste statusen for en SMS som kom frem. |
| **Ikke levert** | Operatøren kunne ikke levere den. **Feilkode** forteller hvorfor, og hva koden betyr. |
| **Mislyktes** | Twilio kunne ikke sende den. **Feilkode** forteller hvorfor. |
| **Feil** | Den ble ikke sendt, for eksempel fordi SMS er slått av for prosjektet, eller fordi Twilio avviste nummeret. **Vis statusmelding** forteller hvorfor. |
| **For lav saldo** | Den ble ikke sendt: Prosjektets saldo var for lav til å betale for den. |
| **Suksess** | Den ble sendt før OneUptime fulgte leveringen, og Twilio godtok den. |

En SMS som serverens egen SMS- og anropsgateway tok imot, blir stående på **Sendt**, i grønt: Gatewayen melder ikke om levering, så det er dens siste status.

Twilio melder hver endring til OneUptime så snart den skjer, signert med auth-tokenet til kontoen SMS-en gikk ut fra, og OneUptime avviser enhver melding som ikke kommer fra Twilio. Derfor må Twilio kunne nå serveren din: se [Twilio-integrasjon](/docs/self-hosted/twilio-integration).

### Feilkoder

Hver kode under **Feilkode** åpner Twilios side om koden, som viser hva som kan forårsake den. Under kodene en SMS oftest mislykkes med, forteller loggen på én linje hva de betyr:

| Kode | Hva det betyr |
| --- | --- |
| `20003` | Twilio godtok ikke påloggingsinformasjonen til kontoen. |
| `21211` | Nummeret er ikke et gyldig telefonnummer. |
| `21408` | Twilio-kontoen har ikke lov til å sende SMS til dette landet. |
| `21606` | Avsendernummeret kan ikke sende SMS for denne Twilio-kontoen. |
| `21608` | En Twilio-prøvekonto kan bare sende til numre som er verifisert i den. |
| `21610` | Mottakeren svarte STOP, så Twilio sender ikke lenger SMS til vedkommende fra dette nummeret. |
| `21612` | Avsendernummeret kan ikke nå dette nummeret. |
| `21614` | Nummeret er ikke et mobilnummer, men for eksempel en fasttelefon. |
| `30001` | For mange SMS-er ble sendt på én gang, og køen hos Twilio ble overfylt. |
| `30002` | Twilio-kontoen ble suspendert før SMS-en gikk ut. |
| `30003` | Telefonen er avslått eller utenfor dekning. |
| `30004` | Nummeret er blokkert fra å motta SMS-en. |
| `30005` | Nummeret er ukjent og finnes kanskje ikke lenger. |
| `30006` | Nummeret kan ikke motta SMS, for eksempel fordi det er en fasttelefon. |
| `30007` | Twilio eller operatøren filtrerte SMS-en som spam. |
| `30008` | Operatøren kunne ikke levere SMS-en og sa ikke hvorfor. |
| `30032` | Det avsendende gratisnummeret er ikke verifisert ennå. |
| `30034` | Avsendernummeret er ikke registrert for A2P 10DLC, som operatører i USA krever. |

En kode som ikke er Twilios, som HTTP-statusen SMS- og anropsgatewayen din svarte med, vises som den er.

## Anrop

| Status | Hva det betyr |
| --- | --- |
| **Ringer** | Twilio har ringt opp. Dette endres så snart Twilio melder hvordan anropet endte. |
| **Suksess** | Anropet ble besvart, og **Vis statusmelding** forteller hvor lenge det varte. Et anrop som serverens egen SMS- og anropsgateway tok imot, er **Suksess** så snart gatewayen godtar det. |
| **Tapt anrop** | Anropet ringte ut: Ingen svarte. |
| **Opptatt** | Linjen var opptatt, eller anropet ble avvist. |
| **Talepost** | Talepost svarte på et vaktanrop. **Vis statusmelding** forteller om det ble lagt igjen en beskjed. |
| **Feil** | Anropet kunne ikke utføres eller kobles til. |
| **For lav saldo** | Det ble ikke utført: Prosjektets saldo var for lav til å betale for det. |

## WhatsApp og Telegram

En WhatsApp-melding er **I kø** mens OneUptime overleverer den, **Sendt** så snart WhatsApp godtar den, **Levert** så snart den når telefonen, og **Lest** så snart den åpnes, hvis personen deler lesebekreftelser. **Mislyktes** er en melding WhatsApp ikke kunne levere, og **Advarsel** en den sendte med en advarsel: **Vis statusmelding** forteller hva WhatsApp meldte. **Feil** og **For lav saldo** betyr at den ikke ble sendt, slik som for en SMS.

Telegram melder ingenting etter at det har tatt imot en melding, så **Sendt** er grønn for en Telegram-melding: Telegram har lagt den i chatten, og det er dens siste status.

## E-post, push, webhooks og arbeidsområder

Disse fanene viser **Suksess** eller **Feil**. **Suksess** er den siste statusen: E-postserveren har godtatt e-posten, push-tjenesten varslingen, webhookens adresse har svart at den tok imot forespørselen, eller arbeidsområdet har gjort det som ble bedt om. OneUptime følger ikke en e-post etter at e-postserveren har godtatt den, og en push-varsling går til **Feil** hvis push-tjenesten senere melder at det ikke ble levert. **Vis statusmelding** forteller hvorfor en melding er **Feil**, slik **Årsak** gjør på fanen **Arbeidsområde**.

## Når en SMS blir stående på Sendt

**Sendt** betyr at operatøren har SMS-en og ennå ikke har meldt tilbake. De fleste operatører melder tilbake innen sekunder eller minutter, men noen gjør det aldri: Da holder også Twilio SMS-en på `sent`, slik meldingsloggene viser, og OneUptime kan ikke vite om den kom frem.

En SMS som blir stående på **Sender**, er noe annet: Meldingene fra Twilio når ikke frem til OneUptime. Sjekk at Twilio kan nå serveren din, og se i serverens logg etter linjer som begynner med `Twilio callback refused`: se [Twilio-integrasjon](/docs/self-hosted/twilio-integration).

## Neste steg

:::cards
- [Twilio-integrasjon](/docs/self-hosted/twilio-integration): Koble til Twilio, og la leveringsmeldingene nå frem til OneUptime.
- [SMS- og anropsgateway](/docs/self-hosted/sms-and-call-gateway): Send SMS og anrop gjennom en egen gateway.
- [Målinger for varslingslevering](/docs/self-hosted/notification-delivery-metrics): Tell hva som ble levert i hele installasjonen.
:::
