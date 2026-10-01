# Monitor Secrets

U kunt secrets gebruiken om gevoelige informatie op te slaan die u wilt gebruiken in uw monitoringcontroles. Secrets worden versleuteld en veilig opgeslagen.

### Een secret toevoegen

Om een secret toe te voegen, ga naar OneUptime Dashboard -> Monitoren -> Instellingen -> Geheimen -> Monitor Secret aanmaken.

![Secret aanmaken](/docs/static/images/CreateMonitorSecret.png)

Geef het geheim een naam en een waarde en kies vervolgens bij de stap **Toegang** welke monitoren het mogen gebruiken. In dit voorbeeld hebben we een `ApiKey`-geheim toegevoegd.

**Let op**: Secrets worden versleuteld en veilig opgeslagen. De waarde wordt na het opslaan nooit meer getoond — niet in de tabel, niet in het bewerkformulier en niet via de API. Als u de waarde kwijtraakt, moet u die opnieuw bij de bron ophalen en opnieuw instellen. Gebruik de knop **Geheime waarde bijwerken** op de rij om een secret te roteren; verwijderen en opnieuw aanmaken is niet nodig.

### Kiezen welke monitoren een geheim mogen gebruiken

Elk geheim heeft een van deze drie toegangsopties:

- **Alle monitoren**: elke monitor in het project mag het geheim gebruiken, ook monitoren die u later aanmaakt. Gebruik dit voor inloggegevens die veel monitoren delen.
- **Specifieke monitoren**: alleen de monitoren die u kiest mogen het geheim gebruiken. Dit is de standaardinstelling, en geheimen die zijn aangemaakt voordat deze opties bestonden, werken zo.
- **Monitoren met labels**: monitoren met ten minste één van de gekozen labels mogen het geheim gebruiken. Als u een van die labels aan een monitor toevoegt, krijgt die toegang; als u het label verwijdert, verliest de monitor de toegang bij de volgende uitvoering.

U kunt de optie op elk moment wijzigen met **Bewerken** op de rij van het geheim. Alleen de lijst van de gekozen optie blijft bewaard: overschakelen naar **Alle monitoren** maakt de monitor- en labellijst van het geheim leeg, en wisselen tussen **Specifieke monitoren** en **Monitoren met labels** maakt de lijst leeg die u verlaat.

Een geheim is nooit beschikbaar voor monitoren in een ander project.

Iedereen die een monitor kan bewerken die een geheim mag gebruiken, kan dat geheim naar elke bestemming sturen waarmee de monitor verbinding maakt. Bij **Alle monitoren** is dat iedereen die monitoren in het project kan aanmaken of bewerken. Bij **Monitoren met labels** hoort daar ook iedereen bij die een van die labels aan een monitor kan toevoegen.

In de API is de toegangsoptie het veld `monitorAccess`: `All Monitors`, `Specific Monitors` of `Monitors With Labels`. De velden `monitors` en `labels` bevatten de lijsten. Een geheim dat zonder `monitorAccess` wordt aangemaakt, krijgt `Specific Monitors`.

### Een secret gebruiken

U kunt secrets gebruiken in de volgende monitoringtypen:

- API (in verzoekheaders, verzoeklichaam en URL)
- Website, IP, Poort, Ping, SSL-certificaat (in URL)
- Synthetische monitor, Aangepaste code-monitor (in de code)
- SNMP-monitor (in communitystring, SNMPv3 auth-sleutel en priv-sleutel)

![Secret gebruiken](/docs/static/images/UsingMonitorSecret.png)

Om een secret te gebruiken, voegt u `{{monitorSecrets.SECRET_NAME}}` toe in het veld waar u het secret wilt gebruiken. In dit geval hebben we bijvoorbeeld `{{monitorSecrets.ApiKey}}` toegevoegd in het veld Verzoekheader.

Secrets worden op de probe ingespoten voordat Synthetische of Aangepaste code-monitorscripts worden uitgevoerd, zodat verwijzingen zoals `{{monitorSecrets.ApiKey}}` worden omgezet naar de ontsleutelde waarde in het actieve script.

Als een monitor verwijst naar een geheim dat hij niet mag gebruiken, blijft de verwijzing ongewijzigd en wordt die niet door de waarde vervangen.

Als u een monitor test voordat u hem opslaat, worden alleen geheimen met **Alle monitoren** ingevuld, omdat een nieuwe monitor in geen enkele lijst staat en nog geen labels heeft. Nadat u de monitor hebt opgeslagen, gebruiken tests alle geheimen die de monitor mag gebruiken.
