# Domain-Monitor

Der Domain-Monitor ermöglicht die Überwachung des Registrierungsstatus und des Ablaufs Ihrer Domainnamen. OneUptime führt regelmäßig WHOIS-Abfragen durch, um die Gesundheit Ihrer Domain zu verfolgen und Sie vor dem Ablauf zu benachrichtigen.

## Übersicht

Domain-Monitore fragen WHOIS-Daten für Ihre Domains ab, um Registrierungsdetails zu verfolgen. Dies ermöglicht Ihnen:

- Domainablaufdaten überwachen
- Abgelaufene oder bald ablaufende Domains erkennen
- Registrar-Informationen der Domain verfolgen
- Nameserver-Konfiguration überprüfen
- Domain-Statuscodes überwachen

## Einen Domain-Monitor erstellen

1. Gehen Sie zu **Monitore** im OneUptime-Dashboard
2. Klicken Sie auf **Monitor erstellen**
3. Wählen Sie **Domain** als Monitortyp
4. Geben Sie den zu überwachenden Domainnamen ein
5. Konfigurieren Sie bei Bedarf Überwachungskriterien

## Konfigurationsoptionen

### Grundeinstellungen

| Feld | Beschreibung | Erforderlich |
|-------|-------------|----------|
| Domainname | Die zu überwachende Domain (z. B. `example.com`) | Ja |

### Erweiterte Einstellungen

| Feld | Beschreibung | Standard |
|-------|-------------|---------|
| Timeout (ms) | Wartezeit auf eine WHOIS-Antwort | 10000 |
| Wiederholungsversuche | Anzahl der Wiederholungsversuche bei Fehlschlag | 3 |

## Überwachungskriterien

Sie können Kriterien konfigurieren, um zu bestimmen, wann Ihre Domain als online, eingeschränkt oder offline gilt, basierend auf:

### Verfügbare Prüftypen

| Prüftyp | Beschreibung |
|------------|-------------|
| Domain läuft ab in Tagen | Anzahl der Tage bis zum Ablauf der Domainregistrierung |
| Domain-Registrar | Der Name des Domain-Registrars |
| Domain-Nameserver | Nameserver-Hostnamen für die Domain |
| Domain-Statuscode | WHOIS-Domain-Statuscodes |
| Domain ist abgelaufen | Ob die Domain abgelaufen ist |

### Filtertypen

Für **Domain ist abgelaufen**:

- **Wahr** — Domain ist abgelaufen
- **Falsch** — Domain ist nicht abgelaufen

Für **Domain läuft ab in Tagen**:

- **Größer als**, **Kleiner als**, **Größer oder gleich**, **Kleiner oder gleich**, **Gleich**, **Ungleich**

Für **Domain-Registrar**, **Domain-Nameserver** und **Domain-Statuscode**:

- **Enthält** — Wert enthält den angegebenen Text
- **Enthält nicht** — Wert enthält den angegebenen Text nicht
- **Beginnt mit** — Wert beginnt mit dem angegebenen Text
- **Endet mit** — Wert endet mit dem angegebenen Text
- **Gleich** — Wert stimmt exakt überein
- **Ungleich** — Wert stimmt nicht überein

### Beispielkriterien

#### Benachrichtigung wenn Domain in 30 Tagen abläuft

- **Prüfen auf**: Domain läuft ab in Tagen
- **Filtertyp**: Kleiner als
- **Wert**: 30

#### Als offline markieren, wenn Domain abgelaufen ist

- **Prüfen auf**: Domain ist abgelaufen
- **Filtertyp**: Wahr

#### Nameserver überprüfen

- **Prüfen auf**: Domain-Nameserver
- **Filtertyp**: Enthält
- **Wert**: `ns1.example.com`

## Best Practices

1. **Frühe Warnungen einrichten** — Eingeschränkte Benachrichtigungen bei 60 Tagen und Offline-Benachrichtigungen bei 14 Tagen vor Ablauf konfigurieren
2. **Alle kritischen Domains überwachen** — Primäre Domains, separat registrierte Subdomains und alle für E-Mail oder APIs genutzten Domains einschließen
3. **Registrar-Änderungen verfolgen** — Das Registrar-Feld überwachen, um unbefugte Domain-Übertragungen zu erkennen
