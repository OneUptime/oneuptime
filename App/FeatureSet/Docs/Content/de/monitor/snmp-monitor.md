# SNMP-Monitor

Der SNMP-Monitor (Simple Network Management Protocol) ermöglicht die Überwachung von Netzwerkgeräten wie Switches, Routern, Firewalls und anderer Netzwerkinfrastruktur durch Abfragen von SNMP-OIDs (Object Identifiers).

## Übersicht

SNMP-Monitore fragen Netzwerkgeräte nach bestimmten Verwaltungsinformationen mittels OIDs ab. Dies ermöglicht Ihnen:

- Geräteverfügbarkeit und -gesundheit überwachen
- Schnittstellenstatistiken verfolgen (Datenverkehr, Fehler, Status)
- Systemmetriken überwachen (CPU, Arbeitsspeicher, Betriebszeit)
- Benutzerdefinierte anbieterspezifische OIDs prüfen
- Benachrichtigungen basierend auf OID-Werten setzen

## Einen SNMP-Monitor erstellen

1. Gehen Sie zu **Monitore** im OneUptime-Dashboard
2. Klicken Sie auf **Monitor erstellen**
3. Wählen Sie **SNMP** als Monitortyp
4. Konfigurieren Sie die SNMP-Einstellungen wie unten beschrieben

## Konfigurationsoptionen

### Grundeinstellungen

| Feld         | Beschreibung                             | Erforderlich |
| ------------ | ---------------------------------------- | ------------ |
| SNMP-Version | Protokollversion: v1, v2c oder v3        | Ja           |
| Hostname/IP  | Hostname oder IP-Adresse des SNMP-Geräts | Ja           |
| Port         | SNMP-Port (Standard: 161)                | Ja           |

### Authentifizierung

#### SNMP v1/v2c

Für SNMP v1 und v2c benötigen Sie nur einen Community-String:

| Feld             | Beschreibung                               | Erforderlich |
| ---------------- | ------------------------------------------ | ------------ |
| Community-String | Der SNMP-Community-String (z. B. „public") | Ja           |

#### SNMP v3

SNMPv3 bietet erweiterte Sicherheit mit Authentifizierung und Verschlüsselung:

| Feld             | Beschreibung                           | Erforderlich                  |
| ---------------- | -------------------------------------- | ----------------------------- |
| Sicherheitsstufe | noAuthNoPriv, authNoPriv oder authPriv | Ja                            |
| Benutzername     | SNMPv3-Benutzername                    | Ja                            |
| Auth-Protokoll   | MD5, SHA, SHA256 oder SHA512           | Wenn authNoPriv oder authPriv |
| Auth-Schlüssel   | Authentifizierungspasswort             | Wenn authNoPriv oder authPriv |
| Priv-Protokoll   | DES, AES oder AES256                   | Wenn authPriv                 |
| Priv-Schlüssel   | Datenschutz-/Verschlüsselungspasswort  | Wenn authPriv                 |

### Zu überwachende OIDs

Fügen Sie die OIDs hinzu, die Sie vom Gerät abfragen möchten.

### Erweiterte Einstellungen

| Feld                  | Beschreibung                                    | Standard |
| --------------------- | ----------------------------------------------- | -------- |
| Timeout               | Wartezeit auf eine Antwort (ms)                 | 5000     |
| Wiederholungsversuche | Anzahl der Wiederholungsversuche bei Fehlschlag | 3        |

## Überwachungskriterien

### Verfügbare Prüftypen

| Prüftyp               | Beschreibung                                     |
| --------------------- | ------------------------------------------------ |
| SNMP-Gerät ist online | Ob das Gerät auf SNMP-Abfragen antwortet         |
| SNMP-Antwortzeit      | Abfrage-Antwortzeit in Millisekunden             |
| SNMP-OID-Wert         | Der von einer bestimmten OID zurückgegebene Wert |
| SNMP-OID existiert    | Ob eine OID einen Wert zurückgibt (nicht null)   |

## Monitor-Geheimnisse verwenden

Aus Sicherheitsgründen können Sie sensible Informationen wie Community-Strings und SNMPv3-Anmeldedaten als Geheimnisse speichern.

### Geheimnisse in der SNMP-Konfiguration verwenden

Verwenden Sie die Syntax `{{monitorSecrets.SECRET_NAME}}` in jedem sensiblen Feld:

- **Community-String**: `{{monitorSecrets.SnmpCommunity}}`
- **SNMPv3-Auth-Schlüssel**: `{{monitorSecrets.SnmpAuthKey}}`
- **SNMPv3-Priv-Schlüssel**: `{{monitorSecrets.SnmpPrivKey}}`

## Fehlerbehebung

### Gerät antwortet nicht

- Überprüfen Sie, ob die IP/Hostname des Geräts korrekt ist
- Prüfen Sie, ob SNMP auf dem Gerät aktiviert ist
- Überprüfen Sie, ob Firewall-Regeln UDP-Port 161 erlauben
- Sicherstellen, dass der Community-String korrekt ist

### Authentifizierungsfehler (v3)

- Benutzername, Auth-Protokoll und Auth-Schlüssel überprüfen
- Sicherstellen, dass die Sicherheitsstufe der Gerätekonfiguration entspricht

## Best Practices

1. **SNMPv3 verwenden, wenn möglich** — Bietet Authentifizierung und Verschlüsselung für bessere Sicherheit
2. **Anmeldedaten als Geheimnisse speichern** — Community-Strings oder Passwörter niemals fest eincodieren
3. **Nur wesentliche OIDs überwachen** — Nur abfragen, was Sie benötigen, um Netzwerkoverhead zu reduzieren
4. **Angemessene Timeouts setzen** — Netzwerkgeräte können unterschiedliche Antwortzeiten haben
