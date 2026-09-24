# OneUptime aktualisieren

Diese Anleitung beschreibt, wie Sie Ihre selbst gehostete OneUptime-Installation sicher aktualisieren können.

## Allgemeine Hinweise

- Führen Sie Upgrades schrittweise über Hauptversionen durch (z. B. 6 → 7 → 8). Überspringen Sie keine Hauptversionen.
- Sie können Neben-/Patch-Versionen überspringen (z. B. 8.1 → 8.4), sofern Sie die Release-Notes beachten.
- Erstellen Sie immer Backups vor dem Upgrade und überprüfen Sie, ob Sie diese wiederherstellen können.

<!-- TODO(i18n): Translate this section. English source: en/installation/upgrading.md (added for the Community/Enterprise image split). -->

## Community and Enterprise Edition images

OneUptime now ships the app as two images. The **Community Edition** is open
source under the Apache License 2.0. The **Enterprise Edition** adds the
enterprise modules from the repository's `ee/` directory: SAML SSO, OIDC, SCIM,
team compliance, audit logs and the enterprise Health dashboards in the Admin
Dashboard. Before this change both editions ran the same code, and
`IS_ENTERPRISE_EDITION` decided which features were switched on. Now the image
decides, and the Community image does not contain the `ee/` directory.

The [Enterprise Edition](/docs/self-hosted/enterprise) page has the full
feature comparison, licensing details and what happens when you switch
editions.

### What to do before you upgrade

- **Community Edition without SSO, OIDC or SCIM:** nothing. Upgrade as usual.
- **Helm with `image.type: enterprise-edition`:** nothing. The chart already
  pulls the `enterprise-` images, which now contain the enterprise modules.
- **Docker Compose with `IS_ENTERPRISE_EDITION=true`:** switch to the
  Enterprise image when you upgrade by setting `APP_TAG=enterprise-release`
  (or `enterprise-<version>`) in `config.env`. `APP_TAG=release` is the
  Community image, and `IS_ENTERPRISE_EDITION=true` no longer switches anything
  on. `npm run update` makes this change for you while
  `IS_ENTERPRISE_EDITION=true` (`release` becomes `enterprise-release`, a
  pinned `13.0.7` becomes `enterprise-13.0.7`) and prints what it changed.
  The App now **refuses to start** when `IS_ENTERPRISE_EDITION=true` is set on
  the Community image, instead of silently no longer enforcing "Require SSO",
  SSO, SCIM and audit logging. The error says what to set:
  `APP_TAG=enterprise-<version>` to keep the Enterprise Edition, or
  `IS_ENTERPRISE_EDITION=false` to run the Community Edition.
- **Community image with SSO, OIDC or SCIM already configured:** SSO sign-in
  and SCIM provisioning stop with this upgrade, and "Require SSO for login" is
  no longer enforced. Switch to the Enterprise image to keep them. Otherwise,
  read [Switching from Enterprise to Community](/docs/self-hosted/enterprise#switching-from-enterprise-to-community)
  before you upgrade. It explains how users sign in afterwards and who to
  remove first. To run the Community Edition, also set
  `IS_ENTERPRISE_EDITION=false`.

Your configuration is never deleted, and no migration is needed to switch
editions in either direction.

### Licensing after the upgrade

The Enterprise Edition now checks its license:

- **An install with a license key** keeps working. It checks the license with
  OneUptime when it starts and once a day. If the license expires, everything
  keeps working for a 30-day grace period, and after that the same happens as
  for an install with no license.
- **An install with no license**, for example one that ran the Enterprise
  Edition on `IS_ENTERPRISE_EDITION=true` alone, gets a 14-day trial from the
  first start of this release. **If you use SSO, OIDC, SCIM or audit logging,
  activate a license before the trial ends.** After the trial, SSO and OIDC
  sign-in stop, "Require SSO for login" is no longer enforced (users sign in
  with their password), SCIM provisioning stops and audit logging stops
  recording. Enterprise configuration also becomes read-only and the
  enterprise Health dashboards are locked. Everything resumes, without a
  restart, as soon as you activate a license. The trial is for evaluation:
  production use of the Enterprise Edition requires a OneUptime Enterprise
  subscription. See
  [When a license expires or is missing](/docs/self-hosted/enterprise#when-a-license-expires-or-is-missing).
- **Air-gapped installs** can activate with a signed license token instead of
  a key. See [Offline activation](/docs/self-hosted/enterprise#offline-activation-air-gapped-installs).

### OneUptime Cloud customers

Nothing changes for you. OneUptime Cloud runs the Enterprise Edition, and your
plan still decides which features you get: SSO, OIDC, SCIM and team
compliance on the Scale plan and above, and audit logs on the Enterprise plan.
Projects on the Scale plan now see the SSO, OIDC, SCIM and team compliance
settings that used to show an upgrade prompt.

### API and endpoint changes

- `GET /api/global-config/license` returns the license key, the license token,
  the instance list, the instance ID and version details only to master
  admins. Other callers get the edition and the license status.
- Self-hosted installs no longer serve the license-server endpoints under
  `/api/enterprise-license/`. Only oneuptime.com uses them.
- The SSO, OIDC and SCIM endpoints keep their exact paths on the Enterprise
  Edition, so identity provider configuration does not change. On the
  Community Edition they return `404`. On the Enterprise Edition they refuse
  requests while the license is lapsed (after the trial or grace period), and
  answer again as soon as a license is activated.

## Upgrade von OneUptime 13 → 14

OneUptime 14 teilt die Anwendung in zwei Editionen, und das Image, das Sie ziehen, entscheidet, welche davon läuft. Die **Community Edition** (Apache-2.0, die Tags `release` und `<version>`) enthält das Verzeichnis `ee/` des Repositorys nicht — SAML SSO, OpenID Connect, SCIM-Provisionierung, Team-Compliance-Einstellungen, Audit-Logs, die **Health**-Dashboards im Admin-Bereich und die **Query Console** sind in diesem Image überhaupt nicht vorhanden. Die **Enterprise Edition** (die Tags `enterprise-release` und `enterprise-<version>`) enthält sie und prüft im Betrieb eine Enterprise-Lizenz — das hat OneUptime 13 nie getan.

[Community and Enterprise Edition images](#community-and-enterprise-edition-images) oben ist die Referenz zu dieser Änderung: was jede Edition enthält, was auf welchem Installationsweg zu setzen ist und was die Lizenz bewirkt. Dieser Abschnitt beschreibt das Upgrade selbst. Aktualisieren Sie von 13 aus — wenn Sie noch auf 12 sind, führen Sie zuerst 12 → 13 durch.

In keiner Edition wird etwas gelöscht. Ihre SSO-, OIDC- und SCIM-Konfiguration, Ihre Einstellungen für „Require SSO for login“ und die bisher aufgezeichneten Audit-Logs bleiben in der Datenbank. Die Community Edition stellt sie lediglich nicht bereit und erzwingt sie nicht, und ein Editionswechsel erfordert in keiner Richtung eine Migration.

### Was Sie tun müssen

1. **Entscheiden Sie, welche Edition diese Installation betreibt.** Wenn Sie SAML SSO, OpenID Connect, SCIM-Provisionierung, Team-Compliance-Einstellungen oder Audit-Logs nutzen oder die **Health**-Dashboards im Admin-Bereich möchten, ist das die Enterprise Edition. Andernfalls ist hier nichts zu entscheiden: die Community Edition ist das, was Sie schon haben.
2. **Setzen Sie bei Helm die Edition in Ihrer Wertedatei:** `image.type: enterprise-edition` (Standard ist `community-edition`). Lassen Sie `image.tag` unverändert — das Chart setzt das Präfix `enterprise-` selbst, `image.tag: release` zieht also `oneuptime/app:enterprise-release`. Dieser Wert ist nicht neu: Wenn Sie bereits `enterprise-edition` betreiben, ist nichts zu ändern, denn das Tag, das Sie ohnehin ziehen, enthält jetzt `ee/`.
3. **Setzen Sie bei Docker Compose `APP_TAG=enterprise-release`** (oder `enterprise-<version>`, um eine Version festzupinnen) in `config.env`. `APP_TAG=release` ist das Community-Image. Das ist der eine Punkt, der eine 13er-Installation stoppt: Unter 13 war eine Compose-Enterprise-Installation `APP_TAG=release` plus `IS_ENTERPRISE_EDITION=true`, und diese Kombination **verweigert jetzt den Start**, statt als Community Edition hochzukommen, ohne Ihre SSO-Konfiguration weiter zu erzwingen. `npm run update` schreibt `APP_TAG` für Sie um, solange `IS_ENTERPRISE_EDITION=true` gesetzt ist (`release` wird `enterprise-release`, ein festgepinntes `13.0.8` wird `enterprise-13.0.8`), und gibt aus, was es geändert hat. Wenn Sie die Images von Hand ziehen, setzen Sie `APP_TAG` vorher selbst.
4. **Aktivieren Sie in der Enterprise Edition eine Lizenz.** Eine Installation ohne Lizenz erhält eine 14-tägige Testphase, gerechnet ab ihrem ersten Start der Enterprise Edition — bei einem Upgrade ist das der Tag des Upgrades, nicht der Tag Ihrer ursprünglichen Installation. Ein Master-Admin aktiviert sie über das Editions-Label in der Kopfzeile des Admin-Bereichs; Installationen ohne Internetzugang aktivieren stattdessen mit einem signierten Token. Siehe [Licensing](/docs/self-hosted/enterprise#licensing).
5. **Wenn diese Installation die Community Edition betreiben wird, während SSO-Zwang konfiguriert ist, prüfen Sie vor dem Upgrade, wer Zugriff hat.** „Require SSO for login“ wird dann nicht mehr erzwungen, Anmeldung per Passwort ist wieder möglich, und jede Person, die noch ein Konto und Zugriff auf dessen Postfach hat, kann sich über „Passwort vergessen“ ein Passwort setzen — auch Personen, die Ihr Identity Provider entfernt hat, denn die SCIM-Deprovisionierung endet ebenfalls. Entfernen Sie diese Benutzer zuerst: [Switching from Enterprise to Community](/docs/self-hosted/enterprise#switching-from-enterprise-to-community).
6. **Wenn Sie IPv6-Adressen mit Ping-, Port- oder SSL-Monitoren überwachen, speichern Sie diese Monitore nach dem Upgrade erneut.** Vor 14 gespeicherte Ziele können abgeschnitten abgelegt worden sein — siehe unten.

### Editionen: was sich geändert hat und was nicht

| | Bis 13 | Ab 14 |
| --- | --- | --- |
| Enterprise-Code | in jedem Image; `IS_ENTERPRISE_EDITION=true` schaltete ihn ein | in `ee/`, und nur in den `enterprise-`-Images |
| Auswahl bei Helm | `image.type` | `image.type` — unverändert, aber die Images unterscheiden sich jetzt wirklich |
| Auswahl bei Compose | `IS_ENTERPRISE_EDITION=true` | `APP_TAG=enterprise-release` |
| Enterprise-Lizenz | im Betrieb nie geprüft | beim Start und einmal täglich geprüft |
| SSO-, OIDC- und SCIM-Endpunkte | dieselben Pfade in beiden Editionen | dieselben Pfade in der Enterprise Edition; `404` in der Community Edition |
| Ihre Enterprise-Konfiguration | gespeichert, erzwungen | in beiden Editionen gespeichert, in der Enterprise Edition erzwungen |

Es läuft eine Migration: eine nullable Spalte `enterpriseEditionFirstSeenAt` in der einzeiligen Tabelle `GlobalConfig`, die sofort durchläuft. Es gibt keine ClickHouse-Migration, es wird nichts verworfen, und für einen Editionswechsel ist in keiner Richtung eine Migration nötig.

### Der Lizenz-Zeitplan in der Enterprise Edition

- **Eine Installation ohne Lizenz** läuft 14 Tage als Testphase, gerechnet ab dem ersten Start der Enterprise Edition. Währenddessen funktioniert jede Enterprise-Funktion, und das Editions-Label warnt, bevor die Phase endet. Die Testphase dient der Evaluierung: Der Produktivbetrieb der Enterprise Edition erfordert ein Abonnement unter der OneUptime Enterprise License.
- **Eine ablaufende Lizenz** erhält ab ihrem Ablaufdatum 30 Tage Kulanzfrist, in der jede Enterprise-Funktion funktioniert und das Editions-Label warnt.
- **Nach der Testphase bzw. nach dieser Kulanzfrist** gilt bis zur Aktivierung einer Lizenz: Anmeldungen über SSO und OIDC werden abgewiesen, „Require SSO for login“ wird nicht mehr erzwungen (Benutzer melden sich mit ihrem Passwort an), die SCIM-Anfragen Ihres Identity Providers werden abgewiesen, und die Audit-Protokollierung zeichnet nichts mehr auf. Die Enterprise-Konfiguration wird schreibgeschützt — Sie können sie weiterhin einsehen und löschen, einen SSO- oder OIDC-Provider deaktivieren und ein SCIM-Bearer-Token zurücksetzen, also genau das, was ein Sicherheitsvorfall erfordert — und die Health-Dashboards sowie die Query Console sind gesperrt.
- **Es wird nichts gelöscht, und das Kern-Monitoring ist nie betroffen.** Monitore, Alarme, Incidents, Bereitschaftsdienste, Statusseiten und Telemetrie liegen außerhalb der Lizenz, und die Anmeldung per Passwort bleibt für alle Benutzer, auch Master-Admins, unverändert möglich. Das Aktivieren einer Lizenz stellt SSO-Anmeldung, SSO-Zwang, SCIM-Provisionierung und Audit-Protokollierung mit der Konfiguration wieder her, die Sie bereits haben — ohne Neustart.
- **Ein bereits vorhandener Lizenzschlüssel wird akzeptiert**, als „unverified“ eingestufte Lizenz: Ablaufdatum und Sitzplatzgrenze stammen aus dem, was der Lizenzserver dieser Installation bereits mitgeteilt hat, und nach diesem Ablauf gilt dieselbe Kulanzfrist von 30 Tagen. Ab jetzt ausgestellte Lizenzen sind signiert und werden von der Anwendung selbst geprüft. Für dieses Upgrade brauchen Sie keinen neuen Schlüssel.
- **Ein Schlüssel, zu dem diese Installation nie ein Ablaufdatum aufgezeichnet hat**, funktioniert die Testphase über weiter, statt alles zu stoppen. Der Lizenzserver schreibt den Schlüssel und das Ablaufdatum getrennt, sodass eine Installation einen Schlüssel besitzen kann, zu dem ihr nie ein Ablaufdatum mitgeteilt wurde. Eine solche Installation wird genau wie eine ohne Lizenz behandelt: Während der Testphase von 14 Tagen, gerechnet ab dem ersten Start der Enterprise Edition, funktioniert jede Enterprise-Funktion, und nach der Testphase gilt dasselbe wie oben. Die Sitzplatzgrenze wird in diesem Zustand nicht durchgesetzt, weil der Lizenzeintrag dieser Installation bereits unvollständig ist. Aktiviert ein Master-Admin die Lizenz über das Editions-Label neu, oder holt der tägliche Lizenzabgleich das Ablaufdatum von oneuptime.com, ist ohne Neustart alles wiederhergestellt.

Die vollständige Zustandstabelle steht unter [When a license expires or is missing](/docs/self-hosted/enterprise#when-a-license-expires-or-is-missing).

### Docker Compose: das Image-Tag wählen

```
git checkout release # Bitte stellen Sie sicher, dass Sie auf dem release-Branch sind.
git pull
npm run update
```

- **`npm run update` verschiebt `APP_TAG`, solange `IS_ENTERPRISE_EDITION=true` gesetzt ist**, auf das Enterprise-Image derselben Version, und gibt aus, was es geändert hat. Ihre Kommentare und Anführungszeichen bleiben erhalten, ein `APP_TAG`, das bereits ein `enterprise-`-Tag ist, wird nicht angetastet, und ein zweiter Lauf ändert nichts.
- **Wer die Images von Hand zieht, überspringt das.** Die Anwendung beendet sich dann beim Start mit einem Fehler, der genau nennt, was zu setzen ist: `APP_TAG=enterprise-<version>`, um die Enterprise Edition zu behalten, oder `IS_ENTERPRISE_EDITION=false`, um die Community Edition zu betreiben.
- **Um bewusst auf die Community Edition zu wechseln**, setzen Sie `APP_TAG=release` und `IS_ENTERPRISE_EDITION=false`. Lesen Sie vorher Punkt 5, wenn diese Installation SSO erzwingt.
- Sonst muss für dieses Release nichts in `config.env` geändert werden.

### Helm: den Image-Typ wählen

```
helm repo update
helm upgrade my-oneuptime oneuptime/oneuptime -f values.yaml
```

- **Eine Installation, die schon auf `image.type: enterprise-edition` läuft, braucht keine Wertänderung.** Das Chart setzt das Tag-Präfix schon lange; neu ist, dass die `enterprise-`-Images `ee/` enthalten. Ab diesem Release gilt für sie der oben beschriebene Lizenz-Zeitplan.
- **`image.tag: release` ist der Standard**, ein Chart auf diesem gleitenden Tag wechselt also beim nächsten Upgrade ohne jede Wertänderung auf 14. Hat diese Installation unter `community-edition` SSO, OIDC oder SCIM konfiguriert, setzen Sie im selben Upgrade `image.type: enterprise-edition`.
- **`IS_ENTERPRISE_EDITION` wird weiterhin vom Chart gesetzt**, abgeleitet aus `image.type`, damit beide nie widersprüchlich sein können. Es steuert nichts. Es über `extraEnv` auf einem Community-Image auf `true` zu erzwingen bewirkt nur, dass die Anwendung den Start verweigert. Setzen Sie `ONEUPTIME_EDITION` niemals über das Chart.
- **Chart-Probes berücksichtigen `probes.<key>.allowPrivateNetworkMonitors` wieder** ([#3879](https://github.com/OneUptime/oneuptime/issues/3879)). Ohne diesen Wert ändert sich nichts — er steht weiterhin auf `false` —, und er gilt für Monitore **aller Projekte** der Instanz, weil Chart-Probes globale Probes sind. Loopback, Link-Local und `169.254.169.254` bleiben unabhängig davon blockiert.

### Weitere Änderungen in 14

- **Die OTLP-Aufnahme bestätigt ein Batch erst, wenn die Warteschlange es annimmt.** 13 antwortete zuerst mit `200` und stellte danach ein, sodass ein von der Warteschlange abgelehntes Batch unbemerkt verloren ging. 14 antwortet stattdessen mit `503` und `Telemetry queue unavailable. Please retry.`, der gRPC-Endpunkt mit `UNAVAILABLE`; beides ist wiederholbar, und Exporter wiederholen. Das betrifft Logs, Metriken, Traces und Profile. Zu tun ist nichts, aber Wiederholungen der Exporter und Rückstau in der Warteschlange werden jetzt sichtbar, wo Daten früher verschwanden — relevant, wenn Sie die Aufnahmekapazität planen.
- **Die Health-Dashboards und die Query Console im Admin-Bereich erfordern die Enterprise Edition**, ebenso die Health-Alarme für PostgreSQL und Valkey. Unter 13 gab es sie allein mit `IS_ENTERPRISE_EDITION=true`, für eine Community-Installation, die sie genutzt hat, ist das also ein sichtbarer Verlust. Die ClickHouse-Kapazitätsansicht samt Pruning, der Migrationsstatus, globale Probes und das Support-Bundle sind in beiden Editionen enthalten.
- **HTTPS-Monitore, die eine IP-Adresse über den Proxy einer Probe erreichen, funktionieren wieder.** Die Probe übergab die IP als TLS-Servernamen; eine IP ist kein gültiger Servername, und Node lehnt sie strikt ab, sodass ein Monitor auf `https://<private IP>` von einer globalen Probe mit `PROBE_ALLOW_PRIVATE_NETWORK_MONITORS` beim Handshake scheiterte. Die Probe lässt den Servernamen bei einem IP-Ziel jetzt weg und prüft das Zertifikat gegen die IP selbst. Bei Hostnamen-Zielen ändert sich nichts.
- **Die `oneuptime`-CLI meldet bei `--version` ihre echte Version** statt eines Platzhalters.
- Welche Endpunkte verschoben oder eingeschränkt wurden, einschließlich `GET /api/global-config/license` und der Lizenzserver-Endpunkte, die selbst gehostete Installationen nicht mehr bereitstellen, steht oben unter [API and endpoint changes](#api-and-endpoint-changes).

### IPv6-Monitore: Ping, Port und SSL

Ein Ping- oder Port-Ziel, das mit umgebenden Leerzeichen eingefügt wurde — genau das liefert das Kopieren einer Adresse aus einem Looking Glass oder einer Router-Konfiguration —, wurde bisher abgeschnitten gespeichert: aus `2001:518:2800:9::2 ` wurde der Host `2001` mit Port `518`. Beide Hälften sind zulässig, deshalb schlug nichts fehl und es wurde kein Fehler angezeigt; der Monitor überwachte einfach einen Host, den niemand eingegeben hatte. IPv4-Adressen waren nie betroffen, weil es dort keinen Doppelpunkt zum Trennen gibt. 14 korrigiert das Parsen und behebt außerdem, dass IPv6-Ping-Monitore auf macOS- und FreeBSD-Probes sofort und dauerhaft fehlschlugen (und als echte Ausfälle gemeldet wurden) und dass IPv6-SSL-Monitore mit `ENOTFOUND` scheiterten.

Für bereits gespeicherte Ziele gibt es keine Migration. **Öffnen Sie daher nach dem Upgrade jeden IPv6-Monitor für Ping, Port und SSL erneut und speichern Sie ihn**, und prüfen Sie das angezeigte Ziel. Rechnen Sie damit, dass Monitore, die auf macOS- oder FreeBSD-Probes dauerhaft fehlschlugen, ab jetzt die Wahrheit melden — das kann Incidents schließen oder neue auslösen.

### Edition und Lizenz überprüfen

- Das **Editions-Label in der Kopfzeile des Admin-Bereichs** nennt die laufende Edition und in der Enterprise Edition zusätzlich den Lizenzstatus.
- **Compose:** `docker compose images` listet die laufenden Tags — in der Enterprise Edition trägt jedes OneUptime-Image das Präfix `enterprise-`.
- **Helm:** `kubectl get pods -n <namespace> -o jsonpath='{..image}'` gibt die Images der Pods aus; es gilt dieselbe Präfix-Regel.
- Die SSO-, OIDC- und SCIM-Endpunkte unterscheiden die beiden Fälle: `404` bedeutet, dass dieses Image kein `ee/` enthält (Community Edition), `402` oder `403` bedeutet, dass die Enterprise Edition läuft und ihre Lizenz Aufmerksamkeit braucht.

### Rollback auf 13

- Beide Editionen und beide Releases lesen dieselben Daten, und die einzige Schemaänderung ist eine nullable Spalte, die 13 ignoriert — ein Rollback der Images erfordert also keine Datenbankarbeit.
- **Docker Compose:** Setzen Sie `APP_TAG` zurück auf das 13er-Tag, das Sie betrieben haben (`13.0.8` oder `enterprise-13.0.8`), und führen Sie `npm run update` aus. Unter 13 schaltet `IS_ENTERPRISE_EDITION=true` die Enterprise-Funktionen ein, setzen Sie es also wieder, wenn Sie es hatten.
- **Helm:** `helm rollback my-oneuptime`, oder pinnen Sie `image.tag` auf `13.0.8`.
- Ihre Enterprise-Konfiguration wird vom Betrieb unter 14 nicht angetastet, ein Rollback findet sie also unverändert vor.

> Tipp: Aktivieren Sie die Lizenz in der Enterprise Edition am Tag des Upgrades und nicht erst am Ende der Testphase. Die Aktivierung ist es, die den SSO-Zwang aufrechterhält, und die Testphase zählt ab diesem Upgrade, nicht ab dem Datum Ihrer ursprünglichen Installation.

## Upgrade von OneUptime 12 → 13

OneUptime 13 ersetzt Redis durch [Valkey](https://valkey.io) als mitgelieferte Cache- und Warteschlangen-Engine. Redis 7.4 hat die BSD-Lizenz verlassen, und der Großteil der ursprünglichen Redis-Mitwirkenden ist zu Valkey gewechselt — einem Fork von Redis 7.2, der dasselbe Wire-Protokoll spricht. Oberhalb des Sockets hat sich nichts geändert, und Sie können OneUptime weiterhin auf ein echtes Redis oder einen verwalteten Redis-kompatiblen Dienst verweisen, wenn Sie das bevorzugen.

Alles, was Sie konfigurieren, ist jetzt danach benannt: Die Einstellungen heißen `VALKEY_*`, die Helm-Werte `valkey:` / `externalValkey:` und die Kubernetes-Objekte `<release>-valkey*`. **Alle alten Namen funktionieren weiterhin**, eine unveränderte `config.env` oder `values.yaml` lässt sich also aktualisieren und läuft weiter. Sie müssen nichts an Ihrer Konfiguration ändern, und es sind keine Daten zu migrieren — der Cache ist keine Datenquelle der Wahrheit, und Postgres und ClickHouse bleiben unberührt.

Was zu tun ist, hängt von Ihrer Installationsart ab:

- **Docker Compose:** wie gewohnt aktualisieren, mit einer wichtigen Option — siehe [Upgrade mit Docker Compose](#upgrade-mit-docker-compose).
- **Helm:** keine Wertänderung nötig, aber der Cache-Pod wird neu erstellt und kommt leer zurück — siehe [Upgrade mit Helm](#upgrade-mit-helm).
- **Sie verweisen OneUptime auf einen selbst betriebenen Cache** (verwaltetes Redis, ElastiCache, Memorystore, Ihr eigenes Valkey): lesen Sie [Wenn Sie Ihren eigenen Cache betreiben](#wenn-sie-ihren-eigenen-cache-betreiben). Das ist die eine Konstellation, die Ihren Server unbemerkt nicht mehr erreicht.
- **Sie haben Dashboards, Alarme, Netzwerkrichtlinien oder Skripte, die auf den Kubernetes-Objektnamen aufsetzen:** diese Namen ändern sich — siehe [Upgrade mit Helm](#upgrade-mit-helm).

### Was sich geändert hat und was nicht

| | Bis 12 | Ab 13 |
| --- | --- | --- |
| Engine | `redis:7.0.12` | `valkey/valkey:9.1-alpine` |
| Einstellungen | `REDIS_*` | `VALKEY_*` — `REDIS_*` wird weiterhin gelesen |
| Compose-Service | `redis` | `valkey` — antwortet weiterhin auf den Hostnamen `redis` |
| Helm-Werte | `redis:`, `externalRedis:` | `valkey:`, `externalValkey:` — alte Schlüssel greifen weiterhin |
| Kubernetes-Objekte | `<release>-redis`, `<release>-redis-master` | `<release>-valkey`, `<release>-valkey-master` |
| Erzeugtes Secret | `redis-password` in `<release>-redis` | `valkey-password` in `<release>-valkey` |
| Secret für externen Cache | `<release>-external-redis` | `<release>-external-valkey` |

Die zehn umbenannten Einstellungen sind `VALKEY_HOST`, `VALKEY_PORT`, `VALKEY_DB`, `VALKEY_USERNAME`, `VALKEY_PASSWORD`, `VALKEY_IP_FAMILY`, `VALKEY_TLS_CA`, `VALKEY_TLS_CERT`, `VALKEY_TLS_KEY` und `VALKEY_TLS_SENTINEL_MODE`. Ist eine Einstellung unter beiden Schreibweisen vorhanden, bevorzugt die Anwendung die `VALKEY_*`-Variante. Das Helm-Chart löst den Konflikt umgekehrt auf: Ein veralteter `redis:`-Schlüssel gewinnt gegen den neuen Standardwert, sodass eine nie angefasste Wertedatei sich exakt so verhält wie zuvor.

**Der Cache startet einmalig neu**, auf beiden Installationswegen, weil der Container ersetzt wird. Er hält nichts auf der Festplatte (`appendonly no`, `save ""`) und kommt deshalb kalt zurück: Zwischengespeicherte Werte sind weg, und BullMQ-Jobs, die wartend, verzögert oder im Backoff waren, gehen verloren. Wiederholbare Jobs und Cron-Jobs registrieren sich beim erneuten Verbinden selbst wieder. Führen Sie das Upgrade zu einem ruhigen Zeitpunkt durch, wenn Ihnen gerade laufende Telemetrie oder Workflow-Wiederholungen wichtig sind.

### Upgrade mit Docker Compose

Das normale Update genügt:

```
git checkout release # Bitte stellen Sie sicher, dass Sie auf dem release-Branch sind.
git pull
npm run update
```

- **Verwenden Sie `--remove-orphans`, wenn Sie Compose von Hand aufrufen.** `npm run update` und `npm run start` übergeben die Option bereits, und sie ist es, die den alten `redis`-Container entfernt. Lassen Sie ihn laufen, antworten zwei Container auf den Hostnamen `redis` — Verbindungen landen zufällig auf dem veralteten.
- **Ihre `config.env` wird nicht umgeschrieben.** `npm run update` ergänzt normalerweise jede Einstellung, die es in `config.example.env` findet und die Ihrer Datei fehlt, erkennt diese zehn aber als Umbenennungen und lässt Ihre Werte — einschließlich Ihres `REDIS_PASSWORD` — genau dort, wo sie sind. Es gibt aus, welche es beibehalten hat.
- Ihre eigenen Schlüssel auf `VALKEY_*` umzubenennen ist optional und kann gefahrlos später erfolgen. Setzen Sie pro Einstellung nur eine Schreibweise.
- **Wenn Sie Cache-Variablen in einer `docker-compose.override.yml` setzen, benennen Sie sie in `VALKEY_*` um.** Die Basisdatei setzt `VALKEY_HOST` jetzt aus Ihrem `REDIS_HOST`, und die Anwendung liest zuerst `VALKEY_HOST` — eine Überschreibung, die nur `REDIS_HOST` setzt, hat daher keinen Vorrang mehr.

### Upgrade mit Helm

```
helm repo update
helm upgrade my-oneuptime oneuptime/oneuptime -f values.yaml
```

- **Es ist keine Wertänderung nötig.** `redis:` und `externalRedis:` funktionieren weiterhin — was Sie darunter setzen, wird über die neuen Standardwerte von `valkey:` / `externalValkey:` gelegt — und `helm upgrade` gibt einen `DEPRECATED VALUES`-Hinweis mit den gefundenen alten Schlüsseln aus. Benennen Sie sie um, wenn es Ihnen passt.
- **Es wird nichts rotiert.** Das Chart liest das Passwort aus Ihrem vorhandenen `<release>-redis`-Secret und überträgt es nach `<release>-valkey`, statt ein neues zu erzeugen.
- **Beide alten Secrets bleiben erhalten.** `<release>-redis` und — falls Sie Ihren eigenen Cache mitbringen — `<release>-external-redis` sind mit `helm.sh/resource-policy: keep` annotiert und bleiben daher mit nun ungenutzten Kopien zurück. Löschen Sie sie, sobald das Upgrade stabil läuft — lesen Sie aber zuerst [Rollback auf 12](#rollback-auf-12).
- **Objektnamen ändern sich.** Passen Sie alles an, was auf `<release>-redis` oder `<release>-redis-master` aufsetzt: Grafana-Dashboards, Alarmregeln, NetworkPolicies, ServiceMonitors, Backup-Jobs.
- Der Service wird zusätzlich unter seinem alten Namen `<release>-redis-master` veröffentlicht, damit Pods, die noch nicht neu ausgerollt wurden, sich von selbst wieder verbinden, statt für die Dauer des Rollouts ins Leere aufzulösen. Setzen Sie `valkey.legacyServiceAlias: false`, um ihn zu entfernen, sobald alle Workloads neu ausgerollt sind.
- **Falls Sie `persistence.enabled: true` gesetzt hatten**, fordert das neue StatefulSet ein frisches Volume `data-<release>-valkey-0` an. Das alte `data-<release>-redis-0` hat nie etwas enthalten — löschen Sie es, damit es keine Kosten mehr verursacht.

### Wenn Sie Ihren eigenen Cache betreiben

OneUptime auf einen Cache zu verweisen, den es nicht selbst betreibt, wird weiterhin vollständig unterstützt, und der Server am anderen Ende darf Valkey, Redis oder ein verwalteter Redis-kompatibler Dienst sein. Geändert hat sich nur der Name des Blocks, der ihn konfiguriert.

- Benennen Sie `externalRedis:` in Ihrer Wertedatei in `externalValkey:` um. Optional — der alte Schlüssel greift weiterhin — aber es ist die Schreibweise, die das Chart jetzt dokumentiert.
- Das Chart rendert das Secret unter dem neuen Namen `<release>-external-valkey`. Das alte `<release>-external-redis` bleibt erhalten und wird nicht mehr aktualisiert; verweisen Sie eigene Manifeste, die es namentlich referenzieren, auf das neue.
- **`extraEnv`-Überschreibungen erreichen den Cache nicht mehr — und zwar unbemerkt.** Wenn Sie mit `extraEnv: [{name: REDIS_HOST, ...}]` statt über den Block `externalValkey:` auf einen verwalteten Cache verweisen, gewinnt Ihr Eintrag zwar weiterhin den `REDIS_HOST`-Slot, aber die Anwendung liest zuerst `VALKEY_HOST` — und das setzt das Chart auf seinen eigenen Cache im Cluster. Ihre Überschreibung steht in der Pod-Spezifikation und wird ignoriert. Benennen Sie diese Einträge in `VALKEY_*` um oder verschieben Sie die Einstellungen nach `externalValkey:`, dem unterstützten Weg. `helm upgrade` warnt bei chart-weiten `extraEnv`-Einträgen; die Listen `<service>.extraEnv` einzelner Dienste sieht es nicht, prüfen Sie diese also selbst. Das Compose-Gegenstück ist eine Override-Datei, die nur `REDIS_HOST` setzt.

### Das Upgrade überprüfen

- **Admin-Dashboard → Health → Valkey** sollte „Connected“ mit einem Speicherwert anzeigen. Das ist dieselbe Erreichbarkeitsprüfung, die auch die Health-Warn-E-Mails verwenden.
- **Compose:** `docker compose ps` listet einen `valkey`-Service und keinen `redis`-Container mehr.
- **Helm:** `kubectl get pods,svc -n <namespace>` zeigt `<release>-valkey-0` im Zustand Running und den Service `<release>-valkey-master`. Mit `helm get notes my-oneuptime` lassen sich die Hinweise des Upgrades erneut anzeigen.
- Für einen tieferen Blick meldet `HelmChart/Public/diagnose.sh` Cache-Speicher, Verdrängungen und Erreichbarkeit und versteht sowohl die alten als auch die neuen Objektnamen.

### Rollback auf 12

- **Helm:** `helm rollback` funktioniert, weil das Chart der Version 12 das von ihm erstellte Secret `<release>-redis` noch vorfindet und dessen Passwort wiederverwendet. Genau deshalb bleiben die alten Secrets erhalten — löschen Sie sie erst, wenn Sie sicher sind, bei 13 zu bleiben.
- **Docker Compose:** Behalten Sie die Schreibweise `REDIS_*` in `config.env`, bis Sie sicher sind. OneUptime 12 liest ausschließlich `REDIS_*`; ein Rollback mit einer `config.env`, deren Schlüssel Sie umbenannt haben, lässt den Cache ohne konfiguriertes Passwort starten — er steht dann offen im Compose-Netz, während die Anwendung sich nicht authentifizieren kann. Beide Schreibweisen mit identischen Werten zu behalten funktioniert ebenfalls.
- Ein Rollback startet den Cache erneut neu, mit denselben Kosten eines kalten Starts.

### Namen, die bewusst Redis geblieben sind

Das sind keine Versäumnisse, und keiner davon erfordert eine Aktion:

- **Die API behält ihre Form.** `components.redis` und `summary.redis` in der Instanz-Health-Antwort, die Route `/api/admin/health/redis` und der Engine-Wert `redis` in der Query-Konsole des Admin-Bereichs sind Wire-Schlüssel, kein Anzeigetext. Alles, was Sie dagegen skriptet haben, funktioniert weiter.
- **Vokabular des Redis-Protokolls:** `redis-cli`, das Feld `redis_version` in `INFO` und der gespeicherte Speicher-Referenzwert, gegen den die Health-Benachrichtigungen vergleichen. Diesen Schlüssel umzubenennen würde die Historie jeder Instanz verwerfen.
- **Der Standard-Hostname bleibt `redis`**, für handgeschriebene Manifeste und einfache `docker run`-Setups. Er wird nur verwendet, wenn weder `VALKEY_HOST` noch `REDIS_HOST` gesetzt ist, was in unserem eigenen Compose oder Helm nie vorkommt.
- Interne Klassennamen und Postgres-Spaltennamen, die niemand zu sehen bekommt und deren Umbenennung eine Migration kosten würde.

## Upgrade von OneUptime 11 → 12

<!-- TODO(i18n): Translate this section. English source: en/installation/upgrading.md (added for the v12 Runner merge). -->

OneUptime 12 merges two components into one. The **Runbook Agent** (the
container you installed on your own hosts to execute runbook steps) and the
**AI Agent** (the service that worked on AI code fixes) are now a single
component: the **OneUptime Runner**, shipped as the `oneuptime/runner`
Docker image. The old `oneuptime/runbook-agent` and `oneuptime/ai-agent`
images are no longer built or published — existing tags remain pullable,
but they will never receive another update.

A Runner is one installed container that can hold several **capabilities**,
toggled per Runner in the dashboard: **Führt Runbooks aus** (on by default),
**Führt KI-Codekorrekturen aus** (off by default), and **Führt KI-Behebungsbefehle aus** (off by
default). Capability changes are adopted on the Runner's next heartbeat —
no restart needed. See [Runners](/docs/runbooks/agents) for how the
component works day to day.

What you need to do depends on how you deployed:

- **Everyone:** read [What happens automatically](#what-happens-automatically)
  and [Dashboard pages moved](#dashboard-pages-moved).
- **You installed Runbook Agents on your hosts:** redeploy them onto the new
  image — see [Redeploy your Runbook Agents](#redeploy-your-runbook-agents).
- **Docker Compose:** environment variable renames plus **one
  security-relevant step** — see [Docker Compose deployments](#docker-compose-deployments).
- **Helm:** a values-file rename that fails validation if skipped — see
  [Helm deployments](#helm-deployments).
- **API keys that were granted agent permissions directly:** re-grant them —
  see [Permissions: teams migrate, API keys do not](#permissions-teams-migrate-api-keys-do-not).

### What happens automatically

No manual database work. On first boot, v12 runs a migration that:

- Renames the Postgres tables and columns (`RunbookAgent` → `Runner`,
  `RunbookAgentJob` → `RunnerJob`, plus the owner, label, and join tables to
  match). Runner ids, keys, and job history are untouched — this is a
  rename, not a re-registration.
- Migrates every **team** permission grant from the old `…RunbookAgent…`
  permission names to the new `…Runner…` names, so team roles keep working
  without reassignment. (Direct API-key grants are the exception — see below.)

The API stays compatible too:

- Requests to `/api/runbook-agent`, `/api/runbook-agent-job`,
  `/api/runbook-agent-owner-team`, and `/api/runbook-agent-owner-user` are
  rewritten server-side onto their `/runner…` equivalents, so existing
  scripts keep working.
- The agent-facing ingest path `/runbook-agent-ingest` is still served
  alongside the new `/runner-ingest`, so **Runbook Agent containers you have
  not redeployed yet keep heartbeating and executing Bash and JavaScript
  steps** against a v12 server. Each one logs a deprecation warning on the
  server naming the agent that should be redeployed.

### Redeploy your Runbook Agents

Your existing agents keep running Bash and JavaScript steps unchanged, so
this does not block the upgrade — but do it soon after:

- **SSH and Kubernetes steps (new in v12) fail on old agents.** The server
  does not exclude old agents from claiming them: an agent still on the
  `runbook-agent` image will claim an SSH or Kubernetes job and fail it with
  `Unsupported step type` — typically mid-incident, when the runbook runs.
  Redeploy the agent **before** authoring SSH or Kubernetes steps that
  target it.
- The old image receives no further updates of any kind.

Redeploying means re-running the install command with the new image and
variable names. The agent's id and key are **unchanged** (same database
row) — swap the names, keep the values:

```bash
docker rm -f oneuptime-runbook-agent

docker run --name oneuptime-runner --restart unless-stopped \
  -e ONEUPTIME_RUNNER_ID=<agent-id> \
  -e ONEUPTIME_RUNNER_KEY=<agent-key> \
  -e ONEUPTIME_URL=https://oneuptime.yourdomain.com \
  -d oneuptime/runner:release
```

(Or open the Runner in **Einstellungen → Runbook-Agents** and use **Einrichtungsanweisungen
anzeigen** for a pre-filled command.)

If you tuned the agent with environment variables, rename them — the old
names are **silently ignored** by the new image:

| Old (Runbook Agent)                     | New (Runner)                              |
| --------------------------------------- | ----------------------------------------- |
| `RUNBOOK_AGENT_ID`                       | `ONEUPTIME_RUNNER_ID`                     |
| `RUNBOOK_AGENT_KEY`                      | `ONEUPTIME_RUNNER_KEY`                    |
| `RUNBOOK_AGENT_POLL_INTERVAL_MS`         | `ONEUPTIME_RUNNER_POLL_INTERVAL_MS`       |
| `RUNBOOK_AGENT_HEARTBEAT_INTERVAL_MS`    | `ONEUPTIME_RUNNER_HEARTBEAT_INTERVAL_MS`  |
| `RUNBOOK_AGENT_JOB_HEARTBEAT_INTERVAL_MS`| `ONEUPTIME_RUNNER_JOB_HEARTBEAT_INTERVAL_MS` |
| `RUNBOOK_AGENT_CONCURRENCY`              | `ONEUPTIME_RUNNER_CONCURRENCY`            |

### If you ran the standalone AI Agent

The **Einstellungen → KI → KI-Agenten** page is gone and the `oneuptime/ai-agent`
image is no longer built. If you had installed an AI Agent container
yourself, replace it with a Runner:

1. Create a Runner under **Einstellungen → Runbook-Agents** and install it with the
   command from **Einrichtungsanweisungen anzeigen**.
2. Enable **Führt KI-Codekorrekturen aus** on it. The change is picked up on the next
   heartbeat.

Old AI Agent credentials still boot the new `oneuptime/runner` image
through a legacy fallback (code fixes only, with a logged warning telling
you to create a real Runner) — treat that as a bridge during the migration,
not a destination.

### Docker Compose deployments

The compose service `ai-agent` is now `runner`. If you upgrade with the
standard `npm run update` flow, the new variables are appended to your
`config.env` automatically and the stack boots — but read the key warning
below. The renames, if you manage `config.env` or overrides by hand:

| Old                              | New                                |
| -------------------------------- | ---------------------------------- |
| `AI_AGENT_KEY`                   | `ONEUPTIME_RUNNER_KEY`             |
| `AI_AGENT_ONEUPTIME_URL`         | `ONEUPTIME_RUNNER_ONEUPTIME_URL`   |
| `AI_AGENT_PORT`                  | `ONEUPTIME_RUNNER_PORT`            |
| `DISABLE_TELEMETRY_FOR_AI_AGENT` | `DISABLE_TELEMETRY_FOR_RUNNER`     |
| `ENABLE_PROFILING_FOR_AI_AGENT`  | `ENABLE_PROFILING_FOR_RUNNER`      |

The old `AI_AGENT_*` lines can stay in `config.env`; nothing reads them
anymore.

**Important — set `ONEUPTIME_RUNNER_KEY` to a random value.** The template
merge appends it with the literal placeholder
`please-change-this-to-random-value`; your old `AI_AGENT_KEY` value is
**not** carried over. This key registers the instance-wide Runner and
authenticates the AI code-fix protocol — including minting repository
access tokens — so leaving the publicly known placeholder in place is a
security hole. Before starting v12, set it to a long random value (reusing
your old `AI_AGENT_KEY` value is fine).

**Remove the orphaned `ai-agent` container.** `npm start` runs compose with
`--remove-orphans` and cleans it up. If you run `docker compose up -d` by
hand, add `--remove-orphans` (or `docker rm -f` the old container) —
otherwise the old AI Agent keeps running and keeps claiming code-fix work
alongside the new Runner.

### Helm deployments

- Rename the `aiAgent:` block in your values overrides to `runner:`. All
  subkeys (`enabled`, `replicaCount`, `resources`, `keda`, and so on) are
  unchanged. This is a hard break: the chart schema rejects unknown keys,
  so `helm upgrade` **fails validation** while an `aiAgent:` block remains.
- Workload names change from `<release>-ai-agent` to `<release>-runner` —
  update anything keyed on the old names (dashboards, alerts, network
  policies).
- The release secret key changes from `ai-agent-key` to `runner-key`. A
  fresh key is generated on upgrade and the in-cluster Runner re-registers
  itself automatically, so there is nothing to do unless something external
  referenced the old secret value.
- Deliberately unchanged: the KEDA scaling metric is still named
  `oneuptime_ai_agent_queue_size` — do not rename it in custom scalers.

### Permissions: teams migrate, API keys do not

Twelve permissions were renamed (`CreateRunbookAgent` → `CreateRunner`,
`EditRunbookAgent` → `EditRunner`, `DeleteRunbookAgent` → `DeleteRunner`,
`ReadRunbookAgent` → `ReadRunner`, and the same four verbs for
`…RunbookAgentOwnerTeam` → `…RunnerOwnerTeam` and
`…RunbookAgentOwnerUser` → `…RunnerOwnerUser`). Grants held through
**teams** are migrated automatically. Grants attached **directly to an API
key** are not — a key that held one of these twelve permissions loses that
access after the upgrade. Re-grant the new `…Runner…` permissions on those
keys in the dashboard. The `RunbookSecret`, `RunbookCredential`, and
`RunbookExecution` permission families kept their names.

Separately, v12 closes a hole: starting a runbook execution now requires
an authenticated caller with `ProjectOwner`, `ProjectAdmin`,
`ProjectMember`, `CreateRunbookExecution`, `RunbookAdmin`, or
`RunbookMember` — advancing or cancelling one also accepts
`EditRunbookExecution`. Unauthenticated triggering no longer works, and
read-only roles (for example `RunbookViewer`) can no longer start runs —
API automation that triggers runbooks needs `CreateRunbookExecution`.

### Dashboard pages moved

There are no redirects from the old URLs — update bookmarks and internal
wiki links:

| Page                    | Old location                             | New location                              |
| ----------------------- | ---------------------------------------- | ----------------------------------------- |
| Runners (was "Agents")  | Runbooks → Einstellungen → Agents (`…/runbooks/settings/agents`) | Einstellungen → Runbook-Agents (`…/settings/runners`) |
| Runner Credentials      | Runbooks → Einstellungen → Anmeldedaten (`…/runbooks/settings/credentials`) | Einstellungen → Runner Credentials (`…/settings/runner-credentials`) |
| AI Agents               | Einstellungen → KI → KI-Agenten (`…/settings/ai-agents`) | Removed — Runners with the **Führt KI-Codekorrekturen aus** capability replace it |

Runbook Secrets stays where it was, under Runbooks → Einstellungen → Geheimnisse.

### New in 12, nothing to enable by accident

v12 adds AI-composed remediation commands: the AI can propose a command
plan and hand it to a Runner for execution. Everything about it is off by
default and stays off until you opt in twice — the project-level **AI
command execution** setting and the per-Runner **Führt KI-Behebungsbefehle aus**
capability must both be enabled, and only runbooks/rules you configure for
it participate. Upgrading changes nothing here.

> Tip: as with every major upgrade, back up Postgres before upgrading (a
> rollback to v11 means restoring that backup), test in staging first, and
> upgrade step-by-step — 11 → 12, do not skip from older majors.

## Upgrade von OneUptime 10 → 11

<!-- TODO(i18n): Translate this section. English source: en/installation/upgrading.md (added for v11 SSO->Enterprise change). -->

### Identity features (SSO, OIDC, SCIM) now require the Enterprise Edition

In v11, the following authentication and access-management features moved to
the **OneUptime Enterprise Edition** and are no longer part of the free,
open-source (Community) build:

- **SAML SSO** — both project login and status-page login
- **OpenID Connect (OIDC)** — both project login and status-page login
- **SCIM user provisioning** — project and status page
- **Global (instance-wide) SSO / OIDC**
- **Team compliance settings**

**What you'll see after upgrading:** if you configured any of these on a
Community Edition build, the settings pages show an upgrade prompt instead of
the configuration form, and the configuration can no longer be changed. Until
the Community and Enterprise images were split, providers you had already
configured could keep signing users in on a Community build, because it still
contained the sign-in code. The Community image no longer contains any SSO,
OIDC or SCIM code, so sign-in through them stops once you upgrade to it — see
[Community and Enterprise Edition images](#community-and-enterprise-edition-images).
Your existing provider records are **preserved in the database** — nothing is
deleted — and they work again as soon as the instance runs the Enterprise
Edition.

**Availability:**

- **Self-hosted:** requires the **Enterprise Edition** build.
- **OneUptime Cloud:** requires the **Scale** plan (or above).

**If you rely on SSO and self-host**, email
[support@oneuptime.com](mailto:support@oneuptime.com) for an Enterprise Edition
license so you can restore SSO/OIDC/SCIM. Mention that you upgraded from v10 to
v11 and we'll help you get it back online. If your team is mid-upgrade and this
is blocking sign-in, contact us before upgrading production so we can plan it
with you.

OneUptime 11 baut den ClickHouse-Telemetrie-Speicher neu auf. Diese Seite erklärt, was sich ändert, wer handeln muss und – für Installationen, die historische Telemetriedaten übernehmen möchten – jede dafür benötigte Abfrage.

### Was sich in v11 ändert

Telemetriedaten (Logs, Traces, Metriken, Exceptions, Profile, Monitor-Logs, Audit-Logs) werden in neue ClickHouse-Tabellen mit zeitbasierter Partitionierung, spaltenweisen Kompressions-Codecs und den neuen Entity-Modell-Spalten verschoben:

| Alte Tabelle          | Neue Tabelle          |
| --------------------- | --------------------- |
| `LogItemV2`           | `LogItemV3`           |
| `MetricItemV2`        | `MetricItemV3`        |
| `SpanItemV2`          | `SpanItemV3`          |
| `ExceptionItemV2`     | `ExceptionItemV3`     |
| `ProfileItemV2`       | `ProfileItemV3`       |
| `ProfileSampleItemV2` | `ProfileSampleItemV3` |
| `MonitorLogV2`        | `MonitorLogV3`        |
| `AuditLogV1`          | `AuditLogV2`          |

In jeder Telemetrie-Tabelle werden zwei Spalten umbenannt: `serviceId` → `primaryEntityId` und `serviceType` → `primaryEntityType`. Dies ist eine harte Umbenennung – **wenn Sie die OneUptime-Analytics-API direkt mit `serviceId`-/`serviceType`-Filtern abfragen, stellen Sie diese auf die neuen Namen um.** Dashboards, Monitore und Alerts innerhalb von OneUptime werden automatisch migriert.

Der Umstieg erfolgt **ausschließlich vorwärtsgerichtet**: Die neuen Tabellen starten leer, alle nach dem Upgrade eingelieferten Telemetriedaten landen sofort darin, und die Historie füllt sich mit der Zeit auf natürliche Weise wieder auf. Die alten Tabellen werden während des Upgrades **automatisch gelöscht**, um ihren Speicherplatz freizugeben – wenn Sie sich die Möglichkeit offenhalten möchten, die Historie zu übernehmen, benennen Sie sie **vor** dem Upgrade um (Schritt 0 unten).

> **Bereits auf 11.0.0 oder 11.0.1?** Diese Releases behielten die alten Tabellen bei (sie leerten sich über die TTL, und die Kopie konnte „jederzeit nach dem Upgrade" ausgeführt werden). Jedes spätere Update **löscht sie beim Start**. Wenn Sie die Historien-Kopie noch durchführen möchten und dies bisher nicht getan haben, führen Sie Schritt 0 unten aus, bevor Sie das Update einspielen.

### Wer handeln muss

- **Neuinstallationen:** keine Maßnahmen erforderlich.
- **Upgrades, die keine Telemetriedaten aus der Zeit vor dem Upgrade in der Benutzeroberfläche benötigen:** keine Maßnahmen erforderlich. Die Telemetrie-Seiten zeigen einfach Daten ab dem Zeitpunkt des Upgrades; die alten Tabellen werden während des Upgrades gelöscht.
- **Upgrades, bei denen Telemetriedaten aus der Zeit vor dem Upgrade sichtbar sein sollen:** Benennen Sie die alten Tabellen **vor** dem Upgrade um (Schritt 0 unten) und führen Sie die manuelle Kopie dann jederzeit nach dem Upgrade aus.

Wie immer gilt: Führen Sie Upgrades über Hauptversionen schrittweise durch (10 → 11, nicht überspringen) und erstellen Sie vor dem Upgrade Backups von Postgres und ClickHouse.

### Optional: Telemetrie-Historie übernehmen

Schritt 0 erfolgt **vor dem Upgrade**; alles ab Schritt 1 erfolgt, **nachdem das Upgrade vollständig hochgefahren ist** (die neuen Tabellen und ihre Materialized Views müssen existieren). Verbinden Sie sich direkt auf Ihrem ClickHouse-Host – das native Protokoll kennt keine HTTP-Timeouts, daher sind mehrstündige Statements unproblematisch:

```bash
clickhouse-client --database oneuptime
```

Gut zu wissen, bevor Sie beginnen:

- Die Kopie kann sicher ausgeführt werden, während OneUptime live ist. Neue Telemetriedaten werden unabhängig davon in die neuen Tabellen geschrieben; die kopierte Historie füllt sich dahinter auf.
- Rechnen Sie bei großem Datenvolumen (Hunderte von GB) mit mehreren Stunden.
- Jedes Statement unten trägt ein `insert_deduplication_token`, und die neuen Tabellen werden mit einem Deduplizierungsfenster ausgeliefert – daher ist es **sicher, ein teilweise fehlgeschlagenes Statement erneut auszuführen** (bereits eingefügte Blöcke werden übersprungen, auch in den Metrik-Rollups), sofern die Wiederholung zeitnah erfolgt. Bei starkem laufendem Ingest verdrängt das Fenster (die letzten 10.000 Insert-Blöcke pro Tabelle) irgendwann alte Tokens.
- Das Kopieren der Metriken baut außerdem die voraggregierten Dashboard-Rollups automatisch neu auf (jede kopierte Zeile speist die Rollup-Materialized-Views erneut) – dadurch ist die Metrik-Kopie langsamer als die anderen; führen Sie sie zuletzt aus.

#### Schritt 0 – Vor dem Upgrade: alte Tabellen umbenennen

Das Upgrade löscht die alten Tabellen beim Start. Bringen Sie die Tabellen, aus denen Sie kopieren möchten, daher zuerst außer Reichweite. Stoppen Sie OneUptime (skalieren Sie das Deployment herunter), damit nichts mehr in die Tabellen schreibt oder sie neu anlegen kann, und benennen Sie sie dann um – `RENAME TABLE` ist eine sofortige Metadaten-Operation, und `IF EXISTS` lässt den Block Tabellen überspringen, die Ihre Installation nie hatte (Deployments älter als Mitte 10.0.x fehlen möglicherweise `AuditLogV1` oder einzelne `…V2`-Tabellen – es gibt dann keine Historie dieses Typs zu kopieren):

```sql
RENAME TABLE IF EXISTS LogItemV2 TO LogItemV2_backup;
RENAME TABLE IF EXISTS MetricItemV2 TO MetricItemV2_backup;
RENAME TABLE IF EXISTS SpanItemV2 TO SpanItemV2_backup;
RENAME TABLE IF EXISTS ExceptionItemV2 TO ExceptionItemV2_backup;
RENAME TABLE IF EXISTS ProfileItemV2 TO ProfileItemV2_backup;
RENAME TABLE IF EXISTS ProfileSampleItemV2 TO ProfileSampleItemV2_backup;
RENAME TABLE IF EXISTS MonitorLogV2 TO MonitorLogV2_backup;
RENAME TABLE IF EXISTS AuditLogV1 TO AuditLogV1_backup;
RENAME TABLE IF EXISTS MetricItemAggMV1mByHost TO MetricItemAggMV1mByHost_backup;
```

Führen Sie anschließend das Upgrade durch und lassen Sie OneUptime vollständig hochfahren, bevor Sie fortfahren.

> Wenn Sie nach dem Umbenennen auf v10 zurückrollen (v10 legt beim Start leere Tabellen mit den alten Namen neu an), benennen Sie die `_backup`-Tabellen wieder auf ihre ursprünglichen Namen zurück, bevor Sie v10 neu starten – andernfalls landen während des Rollbacks eingelieferte Telemetriedaten in den neu angelegten Tabellen und werden beim späteren Upgrade gelöscht.

#### Schritt 1 – Quellpartitionen auflisten

Jede alte Tabelle hat höchstens 16 Partitionen. Für jede Quelltabelle:

```sql
SELECT DISTINCT _partition_id FROM LogItemV2_backup ORDER BY _partition_id;
```

#### Schritt 2 – Kopier-Statement generieren

Die Spaltensätze können sich zwischen Installationen leicht unterscheiden (älteren Deployments können kürzlich hinzugefügte Spalten fehlen). Generieren Sie das Statement daher aus Ihrem Live-Schema, statt ein festes Statement zu kopieren. Setzen Sie `src` und `dst` in der `WITH`-Klausel auf eines der Tabellenpaare aus der obigen Tabelle (die Quelle trägt das `_backup`-Suffix aus Schritt 0) und führen Sie aus:

```sql
WITH 'LogItemV2_backup' AS src, 'LogItemV3' AS dst
SELECT concat(
  'INSERT INTO ', dst, ' (`', arrayStringConcat(groupArray(name), '`, `'), '`)',
  ' SELECT ', arrayStringConcat(groupArray(selectExpr), ', '),
  ' FROM ', src,
  ' WHERE _partition_id = ''{PARTITION}''',
  ' ORDER BY ', (SELECT sorting_key FROM system.tables WHERE database = currentDatabase() AND name = dst), ', _id',
  ' SETTINGS max_execution_time = 0, max_partitions_per_insert_block = 0, insert_deduplication_token = ''v3copy:', dst, ':{PARTITION}'', deduplicate_blocks_in_dependent_materialized_views = 1'
) AS copy_sql
FROM (
  SELECT name,
    multiIf(name = 'primaryEntityId', 'serviceId', name = 'primaryEntityType', 'serviceType', name) AS srcName,
    if(srcName = name, concat('`', name, '`'), concat('`', srcName, '` AS `', name, '`')) AS selectExpr,
    position
  FROM system.columns
  WHERE database = currentDatabase() AND table = dst
    AND srcName IN (SELECT name FROM system.columns WHERE database = currentDatabase() AND table = src)
  ORDER BY position
);
```

Das generierte Statement kopiert nur die Spalten, die beide Tabellen gemeinsam haben (neue Spalten erhalten ihre Standardwerte), benennt `serviceId`/`serviceType` direkt beim Kopieren um, sortiert die Zeilen deterministisch, sodass eine Wiederholung identische, deduplizierbare Blöcke erzeugt, und hebt die Limits für Ausführungszeit und Partitionsanzahl auf, die ein Statement dieser Größe benötigt.

#### Schritt 3 – Ausführen, Partition für Partition

Nehmen Sie das generierte Statement und ersetzen Sie `{PARTITION}` (es kommt zweimal vor – im `WHERE` und im Token) durch jede Partitions-ID aus Schritt 1. Führen Sie die Statements nacheinander aus und wiederholen Sie dann die Schritte 1–3 für jedes Tabellenpaar.

> Hinweis: Wurde eine Quelltabelle in Schritt 0 übersprungen, weil sie auf Ihrer Installation nicht existierte, schlägt Schritt 1 für dieses Paar mit `UNKNOWN_TABLE` fehl – überspringen Sie das Paar einfach; es gibt keine Historie dieses Typs zu kopieren.

Wenn ein Statement teilweise fehlschlägt, führen Sie zeitnah **dasselbe** Statement erneut aus – bereits committete Blöcke werden dedupliziert. Wenn die Wiederholung deutlich später erfolgt, vergleichen Sie zuerst die Zeilenanzahlen (Schritt 5).

#### Schritt 4 (optional) – Historie der Pro-Host-Metrik-Rollups

Kopierte rohe Metrikzeilen bauen die Rollups auf Service-Ebene automatisch neu auf, nicht jedoch das **Pro-Host**-Rollup (alte Zeilen haben keinen Host-Entity-Key). Die in Schritt 0 umbenannte alte Rollup-Tabelle ist die einzige Quelle für diese Historie; übernehmen Sie sie, indem der neue Schlüssel aus dem Hostnamen berechnet wird:

```sql
INSERT INTO MetricItemAggMV1mByHostV2 (projectId, name, hostEntityKey, bucketTime, valueSumState, valueCountState, valueMinState, valueMaxState, retentionDate)
SELECT
  projectId,
  name,
  substring(lower(hex(SHA256(concat(projectId, '|host|host.name=', lower(trimBoth(hostIdentifier)))))), 1, 16) AS hostEntityKey,
  bucketTime,
  valueSumState,
  valueCountState,
  valueMinState,
  valueMaxState,
  retentionDate
FROM MetricItemAggMV1mByHost_backup
ORDER BY projectId, name, hostIdentifier, bucketTime, _id
SETTINGS max_execution_time = 0, insert_deduplication_token = 'v3copy:MetricItemAggMV1mByHostV2:all';
```

Das `ORDER BY` ist wichtig: Es sorgt dafür, dass eine Wiederholung identische Insert-Blöcke erzeugt, die das Deduplizierungs-Token wiedererkennen kann. Ohne `ORDER BY` könnte eine Wiederholung stillschweigend übersprungen oder doppelt gezählt werden. (Randfall: Hostnamen mit `\`, `|` oder `=` – keine gültigen RFC-1123-Hostnamen-Zeichen – würden einen anderen Schlüssel berechnen als die Anwendung; ignorieren Sie dies, sofern Sie nicht wissen, dass Sie solche Hosts haben.)

#### Schritt 5 – Überprüfen

Vergleichen Sie die Gesamtzahlen pro Tabellenpaar (die neue Tabelle enthält auch Zeilen aus der Zeit nach dem Upgrade, sie sollte daher größer oder gleich der alten sein):

```sql
SELECT
  (SELECT count() FROM LogItemV2_backup) AS old_rows,
  (SELECT count() FROM LogItemV3) AS new_rows;
```

#### Schritt 6 – Backups löschen

Die umbenannten Tabellen behalten ihre Aufbewahrungs-TTL, leeren sich also von selbst und schrumpfen – aber sobald Sie mit der Kopie zufrieden sind, löschen Sie sie, um den Speicherplatz sofort freizugeben:

```sql
DROP TABLE IF EXISTS LogItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS MetricItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS SpanItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS ExceptionItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS ProfileItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS ProfileSampleItemV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS MonitorLogV2_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS AuditLogV1_backup SETTINGS max_table_size_to_drop = 0;
DROP TABLE IF EXISTS MetricItemAggMV1mByHost_backup SETTINGS max_table_size_to_drop = 0;
```

(`max_table_size_to_drop = 0` hebt den 50-GB-Löschschutz des Servers für genau dieses Statement auf.)

> Tipp: Testen Sie wie bei jedem Major-Upgrade zuerst in einer Staging-Umgebung und bestätigen Sie, dass Telemetriedaten in die neuen Tabellen fließen, bevor Sie sich in der Produktion auf die Kopie verlassen.

## Upgrade von OneUptime 9 → 10

Keine Änderungen, die manuelle Eingriffe erfordern. Folgen Sie einfach dem Standard-Upgrade-Prozess.

## Upgrade von OneUptime 8 → 9

Das Helm-Chart stellt keine Kubernetes Ingress-Ressource mehr bereit. OneUptime enthält einen Ingress-Gateway-Container, der bereits TLS terminiert, Status-Seiten-Domains verwaltet und den Datenverkehr für die Plattform routed – ein Cluster-Ingress-Controller ist daher nicht mehr erforderlich.

- Entfernen Sie alle `oneuptimeIngress`-Überschreibungen aus Ihren benutzerdefinierten `values.yaml`-Dateien vor dem Upgrade. Diese Schlüssel werden jetzt ignoriert und verursachen Validierungsfehler, wenn sie vorhanden bleiben.
- Stellen Sie sicher, dass `nginx.service.type` widerspiegelt, wie Sie das enthaltene Ingress-Gateway bereitstellen möchten (z. B. `LoadBalancer`, `NodePort` oder `ClusterIP` mit einem externen Load Balancer).
- Überprüfen Sie, ob DNS-Einträge für Status-Seiten oder primäre Hosts weiterhin auf den Service oder Load Balancer verweisen, der das OneUptime Ingress-Gateway bedient.
- Bestätigen Sie nach dem Upgrade, dass TLS-Zertifikate über das eingebettete Gateway weiterhin erneuert werden und dass Status-Seiten-Domains korrekt aufgelöst werden.

## Upgrade von OneUptime 7 → 8

Wenn Sie auf Kubernetes betreiben, gibt es wichtige Breaking Changes:

- Wir verwenden keine Bitnami-Charts mehr für Postgres, Redis und ClickHouse aufgrund von [Bitnami-Lizenzänderungen](https://github.com/bitnami/charts/issues/35164)
- Diese Änderungen sind nicht rückwärtskompatibel. Sie müssen die neue Struktur im Helm-Chart `values.yaml` befolgen.
- Sichern Sie Ihre Daten (Postgres, ClickHouse und alle persistenten Volumes) vor dem Upgrade.

> Tipp: Testen Sie das Upgrade zuerst in einer Staging-Umgebung. Bestätigen Sie, dass Ihre Workloads fehlerfrei sind und die Daten intakt sind, bevor Sie die Produktion upgraden.
