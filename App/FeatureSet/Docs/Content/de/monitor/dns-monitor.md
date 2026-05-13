# DNS-Monitor

Der DNS-Monitor ermöglicht die Überwachung der Gesundheit und Korrektheit der DNS-Auflösung für Ihre Domains. OneUptime fragt regelmäßig DNS-Einträge ab und validiert die Antworten anhand Ihrer konfigurierten Kriterien.

## Übersicht

DNS-Monitore fragen DNS-Server für bestimmte Eintragstypen ab und werten die Ergebnisse aus. Dies ermöglicht Ihnen:

- DNS-Dienstverfügbarkeit überwachen
- Überprüfen, ob DNS-Einträge korrekte Werte zurückgeben
- DNS-Auflösungs-Antwortzeiten verfolgen
- DNSSEC-Konfiguration validieren
- DNS-Propagierungsprobleme oder Hijacking erkennen

## Einen DNS-Monitor erstellen

1. Gehen Sie zu **Monitore** im OneUptime-Dashboard
2. Klicken Sie auf **Monitor erstellen**
3. Wählen Sie **DNS** als Monitortyp
4. Geben Sie den Domainnamen und den abzufragenden Eintragstyp ein
5. Konfigurieren Sie bei Bedarf Überwachungskriterien

## Konfigurationsoptionen

### Grundeinstellungen

| Feld | Beschreibung | Erforderlich |
|-------|-------------|----------|
| Domainname | Die abzufragende Domain (z. B. `example.com`) | Ja |
| Eintragstyp | Der abzufragende DNS-Eintragstyp | Ja |
| DNS-Server | Zu verwendender benutzerdefinierter DNS-Server (z. B. `8.8.8.8`). Leer lassen für Systemstandard | Nein |

### Unterstützte Eintragstypen

| Eintragstyp | Beschreibung |
|-------------|-------------|
| A | IPv4-Adresseinträge |
| AAAA | IPv6-Adresseinträge |
| CNAME | Canonical-Name-(Alias-)Einträge |
| MX | Mail-Exchange-Einträge |
| NS | Nameserver-Einträge |
| TXT | Texteinträge (SPF, DKIM usw.) |
| SOA | Start-of-Authority-Einträge |
| PTR | Pointer-Einträge (Reverse-DNS) |
| SRV | Service-Locator-Einträge |
| CAA | Certificate-Authority-Authorization-Einträge |

### Erweiterte Einstellungen

| Feld | Beschreibung | Standard |
|-------|-------------|---------|
| Port | DNS-Portnummer | 53 |
| Timeout (ms) | Wartezeit auf eine Antwort | 5000 |
| Wiederholungsversuche | Anzahl der Wiederholungsversuche bei Fehlschlag | 3 |

## Überwachungskriterien

Sie können Kriterien konfigurieren, um zu bestimmen, wann Ihr DNS als online, eingeschränkt oder offline gilt, basierend auf:

### Verfügbare Prüftypen

| Prüftyp | Beschreibung |
|------------|-------------|
| DNS ist online | Ob der DNS-Server auf Abfragen antwortet |
| DNS-Antwortzeit (in ms) | Abfrage-Antwortzeit in Millisekunden |
| DNS-Eintrag existiert | Ob DNS-Einträge für die Abfrage existieren |
| DNS-Eintragswert | Der von einem DNS-Eintrag zurückgegebene Wert |
| DNSSEC ist gültig | Ob die DNSSEC-Validierung erfolgreich ist |

### Filtertypen

Für **DNS ist online**, **DNS-Eintrag existiert** und **DNSSEC ist gültig**:

- **Wahr** — Bedingung ist wahr
- **Falsch** — Bedingung ist falsch

Für **DNS-Antwortzeit**:

- **Größer als**, **Kleiner als**, **Größer oder gleich**, **Kleiner oder gleich**, **Gleich**, **Ungleich**

Für **DNS-Eintragswert**:

- **Enthält** — Eintragswert enthält den angegebenen Text
- **Enthält nicht** — Eintragswert enthält den angegebenen Text nicht
- **Beginnt mit** — Eintragswert beginnt mit dem angegebenen Text
- **Endet mit** — Eintragswert endet mit dem angegebenen Text
- **Gleich** — Eintragswert stimmt exakt überein
- **Ungleich** — Eintragswert stimmt nicht überein

### Beispielkriterien

#### Prüfen, ob DNS aufgelöst wird

- **Prüfen auf**: DNS ist online
- **Filtertyp**: Wahr

#### Überprüfen, ob A-Eintrag auf korrekte IP zeigt

- **Prüfen auf**: DNS-Eintragswert
- **Filtertyp**: Gleich
- **Wert**: `93.184.216.34`

#### Benachrichtigung wenn DNS-Antwort langsam ist

- **Prüfen auf**: DNS-Antwortzeit (in ms)
- **Filtertyp**: Größer als
- **Wert**: 500

#### Überprüfen, ob DNSSEC gültig ist

- **Prüfen auf**: DNSSEC ist gültig
- **Filtertyp**: Wahr
