# Monitorhemligheter

Du kan använda hemligheter för att lagra känslig information som du vill använda i dina övervakningskontroller. Hemligheter krypteras och lagras säkert.

### Lägga till en hemlighet

För att lägga till en hemlighet, gå till OneUptime-instrumentpanelen -> Övervakare -> Inställningar -> Hemligheter -> Create Monitor Secret.

![Create Secret](/docs/static/images/CreateMonitorSecret.png)

Du kan välja vilka monitorer som har åtkomst till hemligheten. I det här fallet lade vi till `ApiKey`-hemligheten och valde monitorer som ska ha åtkomst till den.

**Observera**: Hemligheter krypteras och lagras säkert. Värdet visas aldrig igen efter att det sparats — varken i tabellen, i redigeringsformuläret eller via API:et. Om du tappar bort värdet måste du hämta det från källan och ange det på nytt. Använd knappen **Uppdatera hemligt värde** på raden för att rotera en hemlighet; du behöver inte ta bort den och skapa den igen.

### Använda en hemlighet

Du kan använda hemligheter i följande monitortyper:

- API (i förfrågningshuvuden, förfrågningsinnehåll och URL)
- Webbplats, IP, Port, Ping, SSL-certifikat (i URL)
- Syntetisk monitor, Anpassad kodmonitor (i koden)
- SNMP-monitor (i community string, SNMPv3-autentiseringsnyckel och priv-nyckel)

![Using Secret](/docs/static/images/UsingMonitorSecret.png)

För att använda en hemlighet, lägg till `{{monitorSecrets.SECRET_NAME}}` i fältet där du vill använda hemligheten. I det här fallet lade vi till `{{monitorSecrets.ApiKey}}` i fältet för förfrågningshuvudet.

Hemligheter injiceras i sonden innan Syntetiska eller Anpassade kodmonitorskript exekveras, så referenser som `{{monitorSecrets.ApiKey}}` löser upp till det dekrypterade värdet inuti det körande skriptet.

### Behörigheter för monitorhemligheter

Du kan välja vilka monitorer som har åtkomst till hemligheten. Du kan också uppdatera behörigheterna när som helst. Så om du vill lägga till en ny monitor som ska ha åtkomst till hemligheten kan du göra det genom att uppdatera behörigheterna.
