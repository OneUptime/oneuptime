# API-monitor

API-overvåking lar deg overvåke tilgjengelighet, ytelse og korrekthet for dine HTTP/REST API-er. OneUptime sender periodisk HTTP-forespørsler til API-endepunktene dine og evaluerer svarene basert på konfigurerte kriterier.

## Oversikt

API-monitorer sender HTTP-forespørsler til endepunktene dine og sjekker svarene. Dette gjør det mulig å:

- Overvåke oppetid og tilgjengelighet for API-er
- Spore svartider og ytelse
- Verifisere HTTP-statuskoder og svarkropper
- Validere svarhoder
- Teste ulike HTTP-metoder (GET, POST, PUT, DELETE, osv.)
- Sende egendefinerte forespørselshoder og kropper

## Opprette en API-monitor

1. Gå til **Monitors** i OneUptime-dashbordet
2. Klikk **Create Monitor**
3. Velg **API** som monitortype
4. Skriv inn API-URL og konfigurer forespørselsinnstillingene
5. Konfigurer overvåkingskriterier etter behov

## Konfigurasjonsalternativer

### API-URL

Skriv inn den fullstendige URL-en til API-endepunktet du ønsker å overvåke (f.eks. `https://api.example.com/v1/health`).

### Dynamiske URL-plassholdere

Når du overvåker API-er bak CDN-er eller mellomlagrende mellomvare (caching proxies), kan monitoren motta et hurtigbufret svar i stedet for å treffe opprinnelsesserveren. For å omgå hurtigbufferen ved hvert sjekk kan du bruke dynamiske URL-plassholdere som erstattes med en unik verdi ved hver overvåkingsforespørsel.

#### Støttede plassholdere

| Plassholder | Beskrivelse | Eksempelverdi |
|-------------|-------------|---------------|
| `{{timestamp}}` | Erstattes med gjeldende Unix-tidsstempel (sekunder) | `1719500000` |
| `{{random}}` | Erstattes med en tilfeldig unik streng | `a3f8b2c1d4e5f6a7b8c9d0e1f2a3b4c5` |

#### Eksempel

Konfigurer monitor-URL-en med en plassholder:

```
https://api.example.com/health?cb={{timestamp}}
```

Ved hvert overvåkingssjekk blir URL-en:

```
https://api.example.com/health?cb=1719500000
https://api.example.com/health?cb=1719500005
...
```

Du kan også bruke `{{random}}` for en unik streng ved hver forespørsel:

```
https://api.example.com/health?nocache={{random}}
```

### API-forespørselstype

Velg HTTP-metoden for forespørselen:

- **GET** (standard)
- **POST**
- **PUT**
- **DELETE**
- **PATCH**
- **HEAD**

### Avanserte alternativer

#### Forespørselshoder

Legg til egendefinerte HTTP-hoder i forespørselen. Dette er nyttig for autentiseringstokener, innholdstypespesifikasjoner og andre API-spesifikke hoder.

Du kan bruke [Monitor Secrets](/docs/monitor/monitor-secrets) i hoderverdier for å lagre sensitiv informasjon som API-nøkler på en sikker måte.

#### Forespørselskropp (JSON)

For POST-, PUT- og PATCH-forespørsler kan du angi en JSON-forespørselskropp. Du kan også bruke [Monitor Secrets](/docs/monitor/monitor-secrets) i forespørselskroppen.

#### Følg ikke omdirigeringer

Som standard følger OneUptime HTTP-omdirigeringer (301, 302, osv.). Aktiver dette alternativet hvis du ønsker å overvåke selve omdirigeringssvaret i stedet for det endelige målet.

#### Allow Self-Signed Certificates

Enable this option to skip TLS certificate validation. Useful when the target server uses a self-signed or otherwise untrusted TLS certificate (for example, an internal staging environment).

#### Client Certificate (mTLS)

If your endpoint requires mutual TLS authentication, enable **Use client certificate (mTLS)** and provide:

- **Client Certificate (PEM)** — the PEM-encoded client certificate to present.
- **Client Private Key (PEM)** — the matching PEM-encoded private key.
- **Client Private Key Passphrase** *(optional)* — required only if the private key is encrypted.

This is the OneUptime equivalent of the `--cert` and `--key` flags in curl:

```bash
curl --cert client.crt --key client.key https://api.example.com/health
```

For sensitive values, store the certificate and key as [Monitor Secrets](/docs/monitor/monitor-secrets) and reference them with `{{monitorSecrets.name}}`. Monitor Secrets are resolved server-side and the rendered values never appear in the dashboard.

## Overvåkingskriterier

Du kan konfigurere kriterier for å bestemme når API-et anses som tilgjengelig, degradert eller utilgjengelig basert på:

- **Svarstatuskode** – Sjekk om HTTP-statuskoden samsvarer med forventede verdier (f.eks. 200, 201)
- **Svartid** – Overvåk om svartiden overskrider en terskelverdi
- **Svarkropp** – Sjekk om svarkroppen inneholder eller samsvarer med spesifikt innhold
- **Svarhoder** – Verifiser at spesifikke svarhoder er til stede eller samsvarer med forventede verdier
- **JavaScript-uttrykk** – Skriv egendefinerte uttrykk for å evaluere svaret. Se [JavaScript-uttrykk](/docs/monitor/javascript-expression) for detaljer.
