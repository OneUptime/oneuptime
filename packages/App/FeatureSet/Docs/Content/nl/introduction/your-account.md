# Uw account

Uw account is hoe OneUptime u kent: het e-mailadres en wachtwoord waarmee u inlogt, uw naam en tijdzone, en wat uw aanmelding beschermt. Eén account kan bij veel projecten horen, en deze instellingen gaan met u mee naar elk ervan. Hoe OneUptime u bereikt, en wanneer het u oproept, stelt u per project in, onder **Gebruikersinstellingen**.

```mermaid title="Wat bij uw account hoort, en wat elk project voor u bewaart"
flowchart TB
    account["Uw account:<br/>aanmelding en profiel"] --> projectA["Project A"]
    account --> projectB["Project B"]
    projectA --> settingsA["Gebruikersinstellingen in A:<br/>hoe u wordt opgeroepen"]
    projectB --> settingsB["Gebruikersinstellingen in B:<br/>hoe u wordt opgeroepen"]
```

:::cards
- [Uw profiel](#uw-profiel): Uw naam, e-mailadres, tijdzone en foto.
- [Veilig inloggen](#veilig-inloggen): Uw wachtwoord, passkeys en tweestapsverificatie.
- [Uw projecten](#uw-projecten): Van project wisselen, er een aanmaken en uitnodigingen accepteren.
- [Gebruikersinstellingen](#wat-elk-project-voor-u-bewaart): Hoe OneUptime u in elk project bereikt.
:::

## Het gebruikersmenu

Klik op uw foto rechtsboven in het dashboard.

| Item | Wat het doet |
| --- | --- |
| **Profiel** | Opent **Gebruikersprofiel**: uw naam, e-mailadres, tijdzone, foto en de beveiliging van uw aanmelding. |
| **Beheerdersinstellingen** | Opent het Admin Dashboard. Alleen hoofdbeheerders van een zelf-gehoste installatie zien dit. |
| **Donker thema** | Zet het dashboard in het donkere thema. In het donkere thema heet het item **Licht thema**. |
| **Uitloggen** | Meldt u af. |

**Gebruikersprofiel** heeft een eigen zijmenu. **Basis** bevat **Overzicht** en **Profielfoto**. **Beveiliging** en **Gevarenzone** zijn ingeklapt: klik op de titel van een sectie om die te openen.

## Uw profiel

:::steps
### Uw profiel openen

Klik rechtsboven op uw foto en kies **Profiel**. De pagina **Overzicht** opent met de kaart **Basisinformatie**: uw naam, e-mailadres en tijdzone.

### Uw gegevens bewerken

Klik op **Gebruiker bewerken** en wijzig wat u nodig hebt:

- **E-mail**: het adres waarmee u inlogt. Als u het wijzigt, verifieert u het nieuwe adres opnieuw.
- **Volledige naam**: de naam die uw team overal in OneUptime ziet.
- **Tijdzone**: de tijdzone waarin het dashboard tijden toont en leest, en die van de tijden in meldingen aan u.

Klik op **Wijzigingen opslaan**.

### Een foto toevoegen

Kies **Profielfoto**, klik op **Update Profile Picture** en upload een afbeelding. Die verschijnt in uw gebruikersmenu, en naast uw naam in lijsten met mensen.
:::

> [!NOTE]
> De eerste keer dat u in een browser inlogt, slaat OneUptime de tijdzone van die browser op in uw profiel. Logt u later in waar de browser een andere tijdzone heeft, dan vraagt het dashboard of het de **Tijdzone bijwerken** moet. Sluit de vraag, en voor die tijdzone wordt hij niet meer gesteld.

## Veilig inloggen

Klap **Beveiliging** open in het zijmenu van **Gebruikersprofiel**. De sectie heeft drie pagina's.

| Pagina | Waarvoor ze dient |
| --- | --- |
| **Wachtwoordbeheer** | Een nieuw wachtwoord instellen. |
| **Passkeys** | Zonder wachtwoord inloggen, met uw vingerafdruk, gezicht, schermvergrendeling of een beveiligingssleutel. |
| **Two-factor authentication** | Na uw wachtwoord om een tweede stap vragen: een code uit een app, of een beveiligingssleutel. |

### Uw wachtwoord wijzigen

:::steps
1. Open **Beveiliging → Wachtwoordbeheer**.
2. Voer het nieuwe wachtwoord in bij **Wachtwoord** en nogmaals bij **Wachtwoord bevestigen**. Het moet minstens 6 tekens lang zijn.
3. Klik op **Wachtwoord bijwerken**.
:::

### Een passkey toevoegen

:::steps
1. Open **Beveiliging → Passkeys** en klik op **Add Passkey**.
2. Geef hem een naam die u herkent, zoals uw apparaat of wachtwoordbeheerder, en klik op **Create Passkey**.
3. Volg de melding van uw browser om de passkey op te slaan.
:::

Kies de volgende keer **Inloggen met een passkey** op de inlogpagina.

### Tweestapsverificatie inschakelen

Tweestapsverificatie geldt wanneer u met uw wachtwoord inlogt. Voeg eerst een tweede stap toe, en schakel haar dan in.

:::steps
### Een authenticator-app toevoegen

Open **Beveiliging → Two-factor authentication**. Voeg onder **Authenticator apps** een app toe en geef die een naam. Scan de QR-code met een app zoals 1Password, Google Authenticator of Microsoft Authenticator, voer de 6-cijferige code in die ze toont, en klik op **Verify and finish**. Wilt u liever een USB- of NFC-sleutel gebruiken, voeg die dan toe onder **Security keys**.

### Uw back-upcodes bewaren

De eerste keer dat u een app, een sleutel of een passkey toevoegt, toont OneUptime **Your backup codes**. Elke code laat u één keer inloggen als u uw app of sleutel kwijtraakt. Kopieer of download ze, vink het vakje aan dat u ze hebt bewaard, en klik op **Klaar**.

### Haar inschakelen

Klik bovenaan de pagina op **Enable two-factor authentication** en bevestig. De kaart toont nu **Ingeschakeld**. Vanaf uw volgende aanmelding met wachtwoord vraagt OneUptime om uw tweede stap.
:::

> [!TIP]
> Raken uw back-upcodes op? **Regenerate codes** op dezelfde pagina geeft u een nieuwe set, en de oude codes werken meteen niet meer.

## Uw projecten

U kunt bij zoveel projecten horen als u wilt. De projectkiezer linksboven in het dashboard toont ze: kies er een om ernaar te wisselen.

- **Een project aanmaken**: open de projectkiezer en klik op **Nieuw project aanmaken**. Op een zelf-gehoste installatie kan de beheerder het aanmaken van projecten voorbehouden aan beheerders.
- **Een uitnodiging accepteren**: wanneer iemand u uitnodigt, toont de bel rechtsboven de openstaande uitnodiging en opent die **Projectuitnodigingen**. Daar kiest u **Accepteren** of **Reject**.
- **Een project verlaten**: vraag iemand die de gebruikers van het project beheert om u te verwijderen, met **Verwijderen uit project** op de pagina **Gebruikers**.

## Wat elk project voor u bewaart

**Gebruikersinstellingen**, rechts in de balk onder de bovenste balk, zijn alleen van u, en elk project heeft zijn eigen. Open ze in elk project waarin u bereikbaarheidsdienst hebt.

| Pagina | Waarvoor ze dient | Meer weten |
| --- | --- | --- |
| **Instellingschecklist** | Leidt u door alles hieronder, en toont wat er nog te doen is. | |
| **Meldingsmethoden** | De e-mailadressen, telefoonnummers, apps en webhooks waarop OneUptime u kan bereiken. Uw inlog-e-mail wordt voor u toegevoegd. | |
| **Bereikbaarheidsregels** | Welke methode wordt gebruikt, en na hoe lang, wanneer een bereikbaarheidsbeleid u oproept. | [Escalatieregels](/docs/on-call/escalation-rules) |
| **Meldingsinstellingen** | Welke updates over incidenten, waarschuwingen, monitoren en meer u krijgt, en via welk kanaal. | |
| **E-mailvoorkeuren** | Hoeveel e-mails u krijgt: één voor één, of gebundeld. | [Meldingsoverzicht](/docs/emails/notification-rollup) |
| **Bereikbaarheidslogboeken** | Elke oproep die naar u is gestuurd, en wat ermee gebeurde. | |
| **Inkomende telefoonnummers** | Het nummer waarop een beleid voor inkomende oproepen u belt. | [Beleid voor inkomende oproepen](/docs/on-call/incoming-call-policy) |
| **Agendafeed** | Uw bereikbaarheidsdiensten in Google Calendar, Apple Calendar of Outlook. | [Agendafeeds](/docs/on-call/calendar-feeds) |

## Taal en thema

Beide worden in uw browser opgeslagen, niet in uw account, dus stel ze opnieuw in op een andere browser of een ander apparaat.

- **Taal**: het dashboard start in de taal van uw browser. Om die te wijzigen, gebruikt u het taalmenu onderaan elke pagina. Deze documentatie heeft bovenaan een eigen taalmenu.
- **Thema**: kies **Donker thema** in het gebruikersmenu. Het dashboard start in het lichte thema.

## Uw account verwijderen

Open **Gevarenzone → Account verwijderen**. U kunt uw account pas verwijderen als u in geen enkel project meer zit: de pagina toont de projecten waarin u nog zit. Verlaat die eerst, klik dan op **Account verwijderen** en bevestig. Het verwijderen van uw account is definitief en kan niet ongedaan worden gemaakt.

## Problemen oplossen

:::details Ik heb de e-mail om mijn adres te verifiëren niet ontvangen
Opnieuw inloggen stuurt een nieuwe link: kijk ook in uw spammap. Kunt u niet inloggen, gebruik dan **Wachtwoord vergeten?** op de inlogpagina. De resetlink verifieert uw adres ook.
:::

:::details Ik ben mijn authenticator-app kwijt
Kies bij de tweede stap van het inloggen **Geen toegang meer tot uw authenticator-app?** en voer een van uw back-upcodes in. Open daarna **Beveiliging → Two-factor authentication** en voeg uw nieuwe app toe. Zonder back-upcodes vraagt u een beheerder van uw OneUptime-installatie om de tweestapsverificatie van uw account te resetten.
:::

:::details Tijden in het dashboard wijken een uur af
Het dashboard toont tijden in de **Tijdzone** van uw profiel, niet in die van uw computer. Controleer die onder **Gebruikersprofiel → Overzicht**.
:::

## Volgende stappen

:::cards
- [Startpagina en sneltoetsen](/docs/introduction/home): Uw weg vinden in het dashboard.
- [Escalatieregels](/docs/on-call/escalation-rules): Hoe een bereikbaarheidsbeleid u oproept.
- [Gebruikers, teams en machtigingen](/docs/permissions/index): Wat bepaalt wat u in een project mag doen.
- [SSO](/docs/identity/sso): Inloggen via de identiteitsprovider van uw bedrijf.
:::
