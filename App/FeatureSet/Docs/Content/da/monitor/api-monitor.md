# API Monitor

API-overvågning giver dig mulighed for at overvåge tilgængelighed, ydeevne og korrekthed af dine HTTP/REST API'er. OneUptime sender periodisk HTTP-anmodninger til dine API-endpoints og evaluerer svarene baseret på dine konfigurerede kriterier.

## Oversigt

API-monitorer sender HTTP-anmodninger til dine endpoints og kontrollerer svarene. Dette giver dig mulighed for at:

- Overvåge API-oppetid og -tilgængelighed
- Spore svartider og ydeevne
- Bekræfte HTTP-statuskoder og svarindhold
- Validere svarheadere
- Teste forskellige HTTP-metoder (GET, POST, PUT, DELETE osv.)
- Sende brugerdefinerede anmodningsheadere og -indhold

## Oprettelse af en API Monitor

1. Gå til **Monitorer** i OneUptime-dashboardet
2. Klik på **Opret monitor**
3. Vælg **API** som monitortype
4. Indtast API-URL'en og konfigurer anmodningsindstillingerne
5. Konfigurer overvågningskriterier efter behov

## Konfigurationsindstillinger

### API URL

Indtast den fulde URL til det API-endpoint, du vil overvåge (f.eks. `https://api.example.com/v1/health`).

### Dynamiske URL-pladsholdere

Når du overvåger API'er bag CDN'er eller cachingproxyer, kan monitoren modtage et cachelagret svar frem for at ramme origin-serveren. For at omgå cachen ved hvert tjek kan du bruge dynamiske URL-pladsholdere, der erstattes med en unik værdi ved hver overvågningsanmodning.

#### Understøttede pladsholdere

| Pladsholder     | Beskrivelse                                            | Eksempelværdi                      |
| --------------- | ------------------------------------------------------ | ---------------------------------- |
| `{{timestamp}}` | Erstattes med det aktuelle Unix-tidsstempel (sekunder) | `1719500000`                       |
| `{{random}}`    | Erstattes med en tilfældig unik streng                 | `a3f8b2c1d4e5f6a7b8c9d0e1f2a3b4c5` |

#### Eksempel

Konfigurer din monitor-URL med en pladsholder:

```
https://api.example.com/health?cb={{timestamp}}
```

Ved hvert overvågningsskjek bliver URL'en:

```
https://api.example.com/health?cb=1719500000
https://api.example.com/health?cb=1719500005
...
```

Du kan også bruge `{{random}}` til en unik streng ved hver anmodning:

```
https://api.example.com/health?nocache={{random}}
```

### API-anmodningstype

Vælg HTTP-metoden for anmodningen:

- **GET** (standard)
- **POST**
- **PUT**
- **DELETE**
- **PATCH**
- **HEAD**

### Avancerede indstillinger

#### Anmodningsheadere

Tilføj brugerdefinerede HTTP-headere til anmodningen. Dette er nyttigt til autentificeringstokens, angivelse af indholdstype og andre API-specifikke headere.

Du kan bruge [Monitor Secrets](/docs/monitor/monitor-secrets) i headerværdier til sikkert at gemme følsomme data som API-nøgler.

#### Anmodningsindhold (JSON)

Til POST-, PUT- og PATCH-anmodninger kan du angive et JSON-anmodningsindhold. Du kan også bruge [Monitor Secrets](/docs/monitor/monitor-secrets) i anmodningsindholdet.

#### Følg ikke omdirigeringer

Som standard følger OneUptime HTTP-omdirigeringer (301, 302 osv.). Aktiver denne indstilling, hvis du vil overvåge omdirigeringssvaret selv frem for den endelige destination.

#### Allow Self-Signed Certificates

Enable this option to skip TLS certificate validation. Useful when the target server uses a self-signed or otherwise untrusted TLS certificate (for example, an internal staging environment).

#### Client Certificate (mTLS)

If your endpoint requires mutual TLS authentication, enable **Use client certificate (mTLS)** and provide:

- **Client Certificate (PEM)** — the PEM-encoded client certificate to present.
- **Client Private Key (PEM)** — the matching PEM-encoded private key.
- **Client Private Key Passphrase** _(optional)_ — required only if the private key is encrypted.

This is the OneUptime equivalent of the `--cert` and `--key` flags in curl:

```bash
curl --cert client.crt --key client.key https://api.example.com/health
```

For sensitive values, store the certificate and key as [Monitor Secrets](/docs/monitor/monitor-secrets) and reference them with `{{monitorSecrets.name}}`. Monitor Secrets are resolved server-side and the rendered values never appear in the dashboard.

## Overvågningskriterier

Du kan konfigurere kriterier til at afgøre, hvornår din API betragtes som online, forringet eller offline baseret på:

- **Svarstatuskode** – Kontroller, om HTTP-statuskoden matcher forventede værdier (f.eks. 200, 201)
- **Svartid** – Overvåg, om svartiden overskrider en grænseværdi
- **Svarindhold** – Kontroller, om svarindholdet indeholder eller matcher specifikt indhold
- **Svarheadere** – Bekræft, at specifikke svarheadere er til stede eller matcher forventede værdier
- **JavaScript-udtryk** – Skriv brugerdefinerede udtryk til at evaluere svaret. Se [JavaScript-udtryk](/docs/monitor/javascript-expression) for detaljer.
