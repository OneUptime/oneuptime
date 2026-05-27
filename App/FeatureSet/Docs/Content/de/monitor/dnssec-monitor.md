# DNSSEC-Monitor

Die DNSSEC-Überwachung ermöglicht es Ihnen, die kryptografische Integrität von DNS-Antworten für Ihre Zonen zu validieren. OneUptime führt regelmäßig eine vollständige DNSSEC-Validierung durch — es prüft DNSKEY-Einträge, die DS-Delegierung in der übergeordneten Zone, die Gültigkeit von RRSIG-Signaturen, den Resolver-Konsens beim AD-Flag sowie die Konsistenz zwischen autoritativen Nameservern.

## Übersicht

DNSSEC-Monitore validieren die gesamte Vertrauenskette von der Root-Zone bis zu Ihrer Domain. Dies ermöglicht Ihnen:

- Defekte DNSSEC-Ketten erkennen, bevor Resolver Ihren Nutzern SERVFAIL zurückgeben
- Vor dem Ablauf von Zonen-Signierschlüsseln gewarnt werden
- Überprüfen, ob Ihre DS-Einträge in der übergeordneten Zone korrekt veröffentlicht sind
- Abweichungen zwischen autoritativen Nameservern erkennen (Primär/Sekundär nicht synchron)
- Bestätigen, dass validierende Resolver tatsächlich das AD-Flag für Ihre Zone setzen

## Einen DNSSEC-Monitor erstellen

1. Gehen Sie zu **Monitore** im OneUptime-Dashboard
2. Klicken Sie auf **Monitor erstellen**
3. Wählen Sie **DNSSEC** als Monitortyp
4. Geben Sie die Zone (Domain) ein, die Sie validieren möchten
5. Konfigurieren Sie bei Bedarf Resolver und Überwachungskriterien

## Konfigurationsoptionen

### Grundeinstellungen

| Feld | Beschreibung | Erforderlich |
|-------|-------------|----------|
| Zone (Domainname) | Die per DNSSEC zu validierende Zone (z. B. `example.com`) | Ja |
| Resolver | Kommagetrennte Liste validierender Resolver für Abfragen (z. B. `1.1.1.1, 8.8.8.8, 9.9.9.9`) | Ja |
| Nameserver-Konsistenz prüfen | Jeden autoritativen Nameserver direkt abfragen und überprüfen, ob sie dieselbe SOA-Seriennummer zurückgeben | Nein |

### Erweiterte Einstellungen

| Feld | Beschreibung | Standard |
|-------|-------------|---------|
| Signatur-Ablaufwarnung (Tage) | Standardschwellenwert für den RRSIG-Ablauffilter | 7 |
| Timeout (ms) | Wartezeit für jede DNS-Abfrage | 10000 |
| Wiederholungsversuche | Anzahl der Wiederholungsversuche bei Fehlschlag | 3 |

## Überwachungskriterien

Sie können Kriterien konfigurieren, um zu bestimmen, wann Ihre Zone als online, eingeschränkt oder offline gilt, basierend auf:

### Verfügbare Prüftypen

| Prüftyp | Beschreibung |
|------------|-------------|
| DNSSEC-Kette ist gültig | Die gesamte Validierungskette (Root → TLD → Zone) wird korrekt aufgelöst |
| DNSSEC-DNSKEY-Eintrag existiert | Die Zone veröffentlicht mindestens einen DNSKEY-Eintrag |
| DNSSEC-DS-Eintrag existiert in übergeordneter Zone | Die übergeordnete Zone veröffentlicht einen DS-Eintrag, der mit dem KSK der Zone übereinstimmt |
| DNSSEC-Signatur läuft ab in Tagen | Tage bis die nächste RRSIG-Signatur abläuft |
| DNSSEC-Resolver-Konsens (AD-Flag) | Jeder abgefragte Resolver gibt das AD-Flag (Authenticated Data) zurück |
| DNSSEC-Nameserver sind konsistent | Alle autoritativen Nameserver geben dieselbe SOA-Seriennummer zurück |
| DNSSEC ist gültig | Gesamtergebnis bestanden/nicht bestanden über alle Validierungsprüfungen |

### Filtertypen

Für **DNSSEC-Kette ist gültig**, **DNSSEC-DNSKEY-Eintrag existiert**, **DNSSEC-DS-Eintrag existiert in übergeordneter Zone**, **DNSSEC-Resolver-Konsens (AD-Flag)**, **DNSSEC-Nameserver sind konsistent** und **DNSSEC ist gültig**:

- **Wahr** — Bedingung ist wahr
- **Falsch** — Bedingung ist falsch

Für **DNSSEC-Signatur läuft ab in Tagen**:

- **Größer als**, **Kleiner als**, **Größer oder gleich**, **Kleiner oder gleich**, **Gleich**, **Ungleich**

### Beispielkriterien

#### Alarm bei defekter DNSSEC-Kette

- **Prüfen auf**: DNSSEC-Kette ist gültig
- **Filtertyp**: Falsch

#### Warnung vor Ablauf der Signaturen

- **Prüfen auf**: DNSSEC-Signatur läuft ab in Tagen
- **Filtertyp**: Kleiner als
- **Wert**: 7

#### Fehlenden DS-Eintrag in übergeordneter Zone erkennen (defekte Delegierung)

- **Prüfen auf**: DNSSEC-DS-Eintrag existiert in übergeordneter Zone
- **Filtertyp**: Falsch

#### Resolver-Unstimmigkeit erkennen

- **Prüfen auf**: DNSSEC-Resolver-Konsens (AD-Flag)
- **Filtertyp**: Falsch

#### Nameserver-Split-Brain erkennen

- **Prüfen auf**: DNSSEC-Nameserver sind konsistent
- **Filtertyp**: Falsch

## Best Practices

1. **Verwenden Sie mehrere öffentliche Resolver** — Standardmäßig `1.1.1.1`, `8.8.8.8` und `9.9.9.9`, damit der Ausfall eines einzelnen Resolvers keine Fehlalarme verursacht
2. **Warnen Sie frühzeitig vor Ablauf** — Konfigurieren Sie eingeschränkte Alarme 7 Tage und Offline-Alarme 2 Tage vor Ablauf der Signatur; Schlüsselwechsel können stillschweigend fehlschlagen
3. **Überwachen Sie jede signierte Zone** — Schließen Sie Apex-Domains, signierte Subdomains und jede an einen anderen Betreiber delegierte Zone ein
4. **Aktivieren Sie Nameserver-Konsistenzprüfungen** — Diese erkennen Synchronisierungsprobleme zwischen Primär- und Sekundärservern, die eine reine DNSSEC-Validierung übersehen würde, sofern Ihr Netzwerk ausgehendes DNS zu beliebigen IPs nicht blockiert
