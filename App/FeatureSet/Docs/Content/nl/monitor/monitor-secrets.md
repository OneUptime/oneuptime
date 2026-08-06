# Monitor Secrets

U kunt secrets gebruiken om gevoelige informatie op te slaan die u wilt gebruiken in uw monitoringcontroles. Secrets worden versleuteld en veilig opgeslagen.

### Een secret toevoegen

Om een secret toe te voegen, ga naar OneUptime Dashboard -> Monitoren -> Instellingen -> Geheimen -> Monitor Secret aanmaken.

![Secret aanmaken](/docs/static/images/CreateMonitorSecret.png)

U kunt selecteren welke monitors toegang hebben tot het secret. In dit geval hebben we het secret `ApiKey` toegevoegd en monitors geselecteerd die er toegang toe hebben.

**Let op**: Secrets worden versleuteld en veilig opgeslagen. De waarde wordt na het opslaan nooit meer getoond — niet in de tabel, niet in het bewerkformulier en niet via de API. Als u de waarde kwijtraakt, moet u die opnieuw bij de bron ophalen en opnieuw instellen. Gebruik de knop **Geheime waarde bijwerken** op de rij om een secret te roteren; verwijderen en opnieuw aanmaken is niet nodig.

### Een secret gebruiken

U kunt secrets gebruiken in de volgende monitoringtypen:

- API (in verzoekheaders, verzoeklichaam en URL)
- Website, IP, Poort, Ping, SSL-certificaat (in URL)
- Synthetische monitor, Aangepaste code-monitor (in de code)
- SNMP-monitor (in communitystring, SNMPv3 auth-sleutel en priv-sleutel)

![Secret gebruiken](/docs/static/images/UsingMonitorSecret.png)

Om een secret te gebruiken, voegt u `{{monitorSecrets.SECRET_NAME}}` toe in het veld waar u het secret wilt gebruiken. In dit geval hebben we bijvoorbeeld `{{monitorSecrets.ApiKey}}` toegevoegd in het veld Verzoekheader.

Secrets worden op de probe ingespoten voordat Synthetische of Aangepaste code-monitorscripts worden uitgevoerd, zodat verwijzingen zoals `{{monitorSecrets.ApiKey}}` worden omgezet naar de ontsleutelde waarde in het actieve script.

### Monitor Secret-machtigingen

U kunt selecteren welke monitors toegang hebben tot het secret. U kunt de machtigingen ook op elk moment bijwerken. Als u dus een nieuwe monitor toegang wilt verlenen tot het secret, kunt u dit doen door de machtigingen bij te werken.
