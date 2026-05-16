# IP-Adressen-Whitelist für OneUptime.com

Wenn Sie OneUptime.com verwenden und unsere IP-Adressen aus Sicherheitsgründen auf eine Whitelist setzen möchten, können Sie dies anhand der nachfolgenden Anweisungen tun.

Bitte setzen Sie die folgenden IP-Adressen in Ihrer Firewall auf die Whitelist, damit oneuptime.com Ihre Ressourcen erreichen kann.

{{IP_WHITELIST}}

Diese IP-Adressen können sich ändern. Wir werden Sie im Voraus informieren, falls dies eintritt.

## IP-Adressen programmgesteuert abrufen

Sie können die Liste der ausgehenden IP-Adressen der Probes auch programmgesteuert über den folgenden API-Endpunkt abrufen:

```
GET https://oneuptime.com/ip-whitelist
```

Dies gibt eine JSON-Antwort zurück:

```json
{
  "ipWhitelist": ["<list of IPs>"]
}
```

Sie können diesen Endpunkt verwenden, um Ihre Firewall-Whitelist automatisch aktuell zu halten.
