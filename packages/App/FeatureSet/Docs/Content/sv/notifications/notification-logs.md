# Aviseringsloggar

Aviseringsloggar visar varje meddelande som OneUptime har skickat för ditt projekt, med en flik per kanal, och vad som hände med vart och ett: om det gick ut, om det kom fram och, om inte, varför. Öppna dem under **Projektinställningar → Aviseringar → Aviseringsloggar**, eller under **Aviseringsloggar** på en incident, ett larm, en underhållshändelse, en statussida eller en jourpolicy, för det som skickades om den.

:::cards
- [Så läser du en status](#så-läser-du-en-status): Färgen visar var meddelandet är, och pekar du på den säger den vad den betyder.
- [Sms](#sms): Skickar, sedan Skickat, sedan Levererade, så som operatören rapporterar det.
- [Samtal](#samtal): Ringer, och sedan hur samtalet slutade.
- [WhatsApp och Telegram](#whatsapp-och-telegram): Vad varje app rapporterar efter att den tagit emot ett meddelande.
- [E-post, push, webhooks och arbetsytor](#e-post-push-webhooks-och-arbetsytor): Framgång, eller Fel och varför.
- [När ett sms blir kvar på Skickat](#när-ett-sms-blir-kvar-på-skickat): Operatörer som aldrig rapporterar tillbaka, och rapporter som aldrig kommer fram.
:::

## Så läser du en status

Varje status är en etikett vars färg visar var meddelandet är:

| Färg | Var meddelandet är |
| --- | --- |
| Grå | Överlämnat, och inget har kommit tillbaka ännu, som **Skickar**. |
| Blå | Leverantören har det och har ännu inte sagt hur det slutade, som **Skickat** för ett sms eller **Ringer** för ett samtal. |
| Grön | Det nådde personen, som **Levererade**, eller så är detta den sista status det får. |
| Gul | Det nådde telefonen och ingen svarade, som **Missat samtal**, eller så gick det ut med en varning. |
| Röd | Det nådde inte personen, som **Inte levererat**, **Misslyckades**, **Fel** eller **För lågt saldo**. |

Peka på en status, tryck på den eller gå till den med Tabb-tangenten, så säger den vad den betyder och vad som kommer sedan. **Visa statusmeddelande** i radens meny visar vad leverantören svarade, som meddelandets ID eller varför det misslyckades. Filtret **Status** på varje flik listar varje status som fliken kan visa, i den ordning ett meddelande går igenom dem.

Kortet **Vem som fick besked** i översikten för en incident eller ett larm och resultatet av ett testlarm visar varje meddelandes status på samma sätt, i samma färger: ett samtal som fortfarande ringer står som **Ringer** även där, aldrig som **Skickat**.

## Sms

```mermaid title="Ett sms statusar, från OneUptime till telefonen"
flowchart TB
    sending["Skickar:<br/>på väg<br/>till operatören"] --> sent["Skickat:<br/>operatören har det"]
    sent --> delivered["Levererade:<br/>det nådde telefonen"]
    sent --> undelivered["Inte levererat:<br/>operatören kunde<br/>inte leverera det"]
    sending --> failed["Misslyckades:<br/>det kunde inte<br/>skickas"]
```

| Status | Vad det betyder |
| --- | --- |
| **Skickar** | OneUptime lämnade över sms:et till Twilio, som skickar det vidare till operatören. |
| **Skickat** | Operatören tog emot sms:et. Det går till **Levererade** eller **Inte levererat** så snart operatören rapporterar tillbaka. |
| **Levererade** | Operatören bekräftade att sms:et nådde telefonen. Det är den sista statusen för ett sms som kom fram. |
| **Inte levererat** | Operatören kunde inte leverera det. **Felkod** visar varför, och vad koden betyder. |
| **Misslyckades** | Twilio kunde inte skicka det. **Felkod** visar varför. |
| **Fel** | Det skickades inte, till exempel för att sms är avstängt för projektet eller för att Twilio avvisade numret. **Visa statusmeddelande** visar varför. |
| **För lågt saldo** | Det skickades inte: projektets saldo var för lågt för att betala för det. |
| **Framgång** | Det skickades innan OneUptime följde leveransen, och Twilio tog emot det. |

Ett sms som serverns egen sms- och samtalsgateway tog emot blir kvar på **Skickat**, i grönt: gatewayen rapporterar inte leverans, så det är dess sista status.

Twilio rapporterar varje ändring till OneUptime så snart den sker, signerad med auth-token för kontot som sms:et gick ut från, och OneUptime avvisar varje rapport som inte kommer från Twilio. För det måste Twilio kunna nå din server: se [Twilio-integration](/docs/self-hosted/twilio-integration).

### Felkoder

Varje kod under **Felkod** öppnar Twilios sida om koden, som listar vad som kan orsaka den. Under de koder som ett sms oftast misslyckas med säger loggen på en rad vad de betyder:

| Kod | Vad det betyder |
| --- | --- |
| `20003` | Twilio godtog inte kontots inloggningsuppgifter. |
| `21211` | Numret är inte ett giltigt telefonnummer. |
| `21408` | Twilio-kontot får inte skicka sms till det här landet. |
| `21606` | Avsändarnumret kan inte skicka sms för det här Twilio-kontot. |
| `21608` | Ett Twilio-provkonto kan bara skicka till nummer som är verifierade i det. |
| `21610` | Mottagaren svarade STOP, så Twilio skickar inte längre sms till hen från det här numret. |
| `21612` | Avsändarnumret kan inte nå det här numret. |
| `21614` | Numret är inte ett mobilnummer, utan till exempel en fast telefon. |
| `30001` | För många sms skickades på en gång, och Twilios kö svämmade över. |
| `30002` | Twilio-kontot stängdes av innan sms:et gick ut. |
| `30003` | Telefonen är avstängd eller utom räckhåll. |
| `30004` | Numret är blockerat från att ta emot sms:et. |
| `30005` | Numret är okänt och finns kanske inte längre. |
| `30006` | Numret kan inte ta emot sms, till exempel för att det är en fast telefon. |
| `30007` | Twilio eller operatören filtrerade sms:et som spam. |
| `30008` | Operatören kunde inte leverera sms:et och sa inte varför. |
| `30032` | Det avgiftsfria avsändarnumret är inte verifierat än. |
| `30034` | Avsändarnumret är inte registrerat för A2P 10DLC, vilket operatörer i USA kräver. |

En kod som inte är Twilios, som HTTP-statusen som din sms- och samtalsgateway svarade med, visas som den är.

## Samtal

| Status | Vad det betyder |
| --- | --- |
| **Ringer** | Twilio ringde upp. Det ändras så snart Twilio rapporterar hur samtalet slutade. |
| **Framgång** | Samtalet besvarades, och **Visa statusmeddelande** visar hur länge det varade. Ett samtal som serverns egen sms- och samtalsgateway tog emot är **Framgång** så snart gatewayen accepterar det. |
| **Missat samtal** | Samtalet ringde ut: ingen svarade. |
| **Upptagen** | Linjen var upptagen, eller så avvisades samtalet. |
| **Röstbrevlåda** | Röstbrevlådan svarade på ett joursamtal. **Visa statusmeddelande** visar om ett meddelande lämnades. |
| **Fel** | Samtalet kunde inte ringas eller kopplas. |
| **För lågt saldo** | Det ringdes inte: projektets saldo var för lågt för att betala för det. |

## WhatsApp och Telegram

Ett WhatsApp-meddelande är **I kö** medan OneUptime lämnar över det, **Skickat** så snart WhatsApp tar emot det, **Levererade** så snart det når telefonen och **Läst** så snart det öppnas, om personen delar läskvitton. **Misslyckades** är ett meddelande som WhatsApp inte kunde leverera, och **Varning** ett som det skickade med en varning: **Visa statusmeddelande** visar vad WhatsApp rapporterade. **Fel** och **För lågt saldo** betyder att det inte skickades, precis som för ett sms.

Telegram rapporterar inget efter att det tagit emot ett meddelande, så **Skickat** är grönt för ett Telegram-meddelande: Telegram publicerade det i chatten, och det är dess sista status.

## E-post, push, webhooks och arbetsytor

De här flikarna visar **Framgång** eller **Fel**. **Framgång** är den sista statusen: e-postservern tog emot e-postmeddelandet, push-tjänsten aviseringen, webhookens adress svarade att den tagit emot begäran, eller arbetsytan gjorde det som efterfrågades. OneUptime följer inte ett e-postmeddelande efter att e-postservern tagit emot det, och en push-avisering går till **Fel** om push-tjänsten senare rapporterar att den inte levererades. **Visa statusmeddelande** visar varför ett meddelande är **Fel**, så som **Orsak** gör på fliken **Arbetsyta**.

## När ett sms blir kvar på Skickat

**Skickat** betyder att operatören har sms:et och ännu inte har rapporterat tillbaka. De flesta operatörer rapporterar inom sekunder eller minuter, men vissa gör det aldrig: då behåller även Twilio sms:et på `sent`, som dess meddelandeloggar visar, och OneUptime kan inte veta om det kom fram.

Ett sms som blir kvar på **Skickar** är något annat: Twilios rapporter når inte OneUptime. Kontrollera att Twilio kan nå din server, och leta i serverns logg efter rader som börjar med `Twilio callback refused`: se [Twilio-integration](/docs/self-hosted/twilio-integration).

## Nästa steg

:::cards
- [Twilio-integration](/docs/self-hosted/twilio-integration): Anslut Twilio, och låt dess leveransrapporter nå OneUptime.
- [SMS- och samtalsgateway](/docs/self-hosted/sms-and-call-gateway): Skicka sms och samtal genom en egen gateway.
- [Mätvärden för aviseringsleverans](/docs/self-hosted/notification-delivery-metrics): Räkna vad som levererades i hela installationen.
:::
