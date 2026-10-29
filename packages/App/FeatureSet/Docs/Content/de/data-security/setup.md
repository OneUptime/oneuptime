# Datensicherheit einrichten

Datensicherheit liest nur, was Sie ihr erlauben. Jede Cloud-Verbindung wird auf einer von drei Stufen gelesen, eine Datenbank, die Sie betreiben, mit einer Verbindungszeichenfolge, die Sie ihr geben, und Telemetrie braucht nichts. Diese Seite sagt, was OneUptime mit jeder Wahl lesen darf, welche Berechtigungen sie genau gewährt und was OneUptime von dem behält, was es liest.

:::cards
- [Eine Stufe wählen](#eine-stufe-für-jede-verbindung-wählen): Aus, Nur Konfiguration oder Konfiguration und Inhaltsstichproben.
- [Was jede Stufe gewährt](#was-jede-stufe-gewährt): Die AWS-Aktionen und die Rollen in Azure und Google Cloud.
- [Eine Datenbank scannen, die Sie betreiben](#eine-datenbank-scannen-die-sie-betreiben): Eine schreibgeschützte Verbindungszeichenfolge oder eine Sonde in Ihrem Netzwerk.
- [Was OneUptime behält](#was-oneuptime-behält): Zählungen, Orte und maskierte Stichproben, nie einen Wert.
- [Datensicherheit eine Exponierung schließen lassen](#datensicherheit-eine-exponierung-schließen-lassen): Der eine Schreibzugriff, den eine Verbindung erhalten kann, aus, bis Sie ihn einschalten.
:::

## Eine Stufe für jede Verbindung wählen

| Stufe | Im Formular | Was OneUptime liest |
| --- | --- | --- |
| Aus | **Aus** | Weder Konfiguration noch Inhalt eines Datenspeichers. Datensicherheit führt trotzdem die Datenspeicher auf, die Ihr Cloud-Inventar kennt, mit dem, was das Inventar über sie sagt: ob eine RDS-Datenbank verschlüsselt, öffentlich, vor dem Löschen geschützt und gesichert ist, und ob sich eine DynamoDB-Tabelle auf einen Zeitpunkt wiederherstellen lässt. |
| Konfiguration | **Nur Konfiguration** | Wie jeder Datenspeicher eingerichtet ist: wer ihn erreichen kann und wie er verschlüsselt, gesichert, versioniert, protokolliert, repliziert und getaggt ist. Nie Daten und nie ein Geheimnis. |
| Inhalt | **Konfiguration und Inhaltsstichproben** | Das, und Stichproben dessen, was S3-Buckets, Azure-Speicherkonten, Cloud-Storage-Buckets und BigQuery-Datasets enthalten. |

Jede Verbindung beginnt bei **Aus**. [Ein Cloud-Konto verbinden](/docs/telemetry/cloud-accounts#datensicherheit) zeigt den Befehl, den jede Stufe in jeder Cloud ausführt, Wort für Wort. So ändern Sie die Stufe einer Verbindung:

:::steps
### Die Verbindung öffnen

Öffnen Sie **Cloud → Verbinden**. Wählen Sie **Bearbeiten** an der Verbindung, oder verbinden Sie ein neues Konto.

### Die Stufe auswählen

Setzen Sie unter **Weitere Felder** die Option **Datensicherheit** auf die gewünschte Stufe.

### Den Befehl erneut ausführen

Der Befehl, den das Formular zeigt, ändert sich mit der Stufe. Führen Sie ihn in der Shell Ihrer Cloud aus, wie beim Verbinden: Er gewährt, was die neue Stufe braucht, und nichts weiter. Wählen Sie dann **Änderungen speichern**, oder **Verbinden** bei einer neuen Verbindung.
:::

Lesevorgänge auf der neuen Stufe beginnen innerhalb einer Stunde, und **Jetzt prüfen** oder **Jetzt scannen** an einem Datenspeicher startet sofort einen. OneUptime liest nur, was die Stufe der Verbindung sagt, egal was die Rolle noch erlaubt: Senken Sie die Stufe, und die Lesevorgänge hören sofort auf. Um auch den Zugriff zu entziehen, führen Sie den neuen Befehl aus: In AWS ersetzt er die Richtlinie durch die der niedrigeren Stufe. **Aus** fügt nichts hinzu und lässt daher stehen, was ein früherer Befehl gewährt hat. Entfernen Sie das selbst: in AWS mit `aws iam delete-role-policy --role-name <your role> --policy-name OneUptimeDataSecurity`, und in Azure und Google Cloud, indem Sie die Rollen entfernen, die die Inhaltsstufe hinzugefügt hat.

## Was jede Stufe gewährt

### Amazon Web Services

Die Konfigurationsstufe legt eine zweite Inline-Richtlinie, `OneUptimeDataSecurity`, auf die Rolle, neben die Nur-Lese-Richtlinie. Sie enthält genau die Leseaktionen, die der Leser der Datensicherheit aufruft. Jede liest eine Einstellung; keine liest Daten oder schreibt etwas:

| Wofür OneUptime sie nutzt | Aktionen |
| --- | --- |
| Die Buckets auflisten und lesen, wer jeden erreichen kann und wie er verschlüsselt, versioniert, protokolliert, kopiert und getaggt ist | `s3:ListAllMyBuckets`, `s3:GetBucketLocation`, `s3:GetBucketPolicyStatus`, `s3:GetBucketPublicAccessBlock`, `s3:GetAccountPublicAccessBlock`, `s3:GetBucketAcl`, `s3:GetBucketPolicy`, `s3:GetEncryptionConfiguration`, `s3:GetBucketVersioning`, `s3:GetBucketLogging`, `s3:GetBucketOwnershipControls`, `s3:GetReplicationConfiguration`, `s3:GetBucketTagging` |
| Lesen, wie die Datenbanken erreicht, verschlüsselt und gesichert werden und mit wem ihre manuellen Snapshots geteilt sind | `rds:DescribeDBInstances`, `rds:DescribeDBClusters`, `rds:DescribeDBSnapshots`, `rds:DescribeDBSnapshotAttributes`, `rds:DescribeDBClusterSnapshots`, `rds:DescribeDBClusterSnapshotAttributes`, `dynamodb:ListTables`, `dynamodb:DescribeTable`, `dynamodb:DescribeContinuousBackups`, `redshift:DescribeClusters`, `redshift:DescribeLoggingStatus` |
| Lesen, wie die Suchdomains, Caches und Dateisysteme eingerichtet sind | `es:ListDomainNames`, `es:DescribeDomains`, `elasticache:DescribeReplicationGroups`, `elasticfilesystem:DescribeFileSystems` |
| Die eigenen Schlüssel von AWS (alias/aws/...) von den Schlüsseln unterscheiden, die Sie verwalten | `kms:ListAliases` |

Die Inhaltsstufe fügt derselben Richtlinie drei Aktionen hinzu, jede auf ihren eigenen Ressourcen:

| Aktion | Erlaubt auf | Wofür sie da ist |
| --- | --- | --- |
| `s3:ListBucket` | `arn:aws:s3:::*` | Die Objektnamen eines Buckets auflisten |
| `s3:GetObject` | `arn:aws:s3:::*/*` | Die ersten Bytes eines Objekts aus der Stichprobe lesen |
| `kms:Decrypt` | `*`, nur wenn `kms:ViaService` gleich `s3.*.amazonaws.com` ist | Ein mit einem KMS-Schlüssel verschlüsseltes Objekt lesen, nur über S3: nie ein direktes Entschlüsseln von etwas anderem, das der Schlüssel schützt |

Mit einem **Zugriffsschlüssel** statt einer Rolle kommt die Richtlinie auf eine Gruppe, `OneUptimeDataSecurity`, zu der der Benutzer des Schlüssels hinzugefügt wird: IAM begrenzt die eigenen Inline-Richtlinien eines Benutzers auf insgesamt 2.048 Zeichen, und die Nur-Lese-Richtlinie belegt die meisten davon. Eine Verbindung, die eine ganze AWS Organization liest, legt dieselbe Richtlinie in die Rolle jedes Kontos.

:::details Die ganze Richtlinie auf der Inhaltsstufe
```json
{
  "Version": "2012-10-17",
  "Statement": [
    {
      "Effect": "Allow",
      "Action": [
        "s3:ListAllMyBuckets",
        "s3:GetBucketLocation",
        "s3:GetBucketPolicyStatus",
        "s3:GetBucketPublicAccessBlock",
        "s3:GetAccountPublicAccessBlock",
        "s3:GetBucketAcl",
        "s3:GetBucketPolicy",
        "s3:GetEncryptionConfiguration",
        "s3:GetBucketVersioning",
        "s3:GetBucketLogging",
        "s3:GetBucketOwnershipControls",
        "s3:GetReplicationConfiguration",
        "s3:GetBucketTagging",
        "rds:DescribeDBInstances",
        "rds:DescribeDBClusters",
        "rds:DescribeDBSnapshots",
        "rds:DescribeDBSnapshotAttributes",
        "rds:DescribeDBClusterSnapshots",
        "rds:DescribeDBClusterSnapshotAttributes",
        "dynamodb:ListTables",
        "dynamodb:DescribeTable",
        "dynamodb:DescribeContinuousBackups",
        "redshift:DescribeClusters",
        "redshift:DescribeLoggingStatus",
        "es:ListDomainNames",
        "es:DescribeDomains",
        "elasticache:DescribeReplicationGroups",
        "elasticfilesystem:DescribeFileSystems",
        "kms:ListAliases"
      ],
      "Resource": "*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:ListBucket"
      ],
      "Resource": "arn:aws:s3:::*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "s3:GetObject"
      ],
      "Resource": "arn:aws:s3:::*/*"
    },
    {
      "Effect": "Allow",
      "Action": [
        "kms:Decrypt"
      ],
      "Resource": "*",
      "Condition": {
        "StringLike": {
          "kms:ViaService": "s3.*.amazonaws.com"
        }
      }
    }
  ]
}
```
:::

### Microsoft Azure

Die Konfigurationsstufe fügt nichts hinzu: Die Rolle **Monitoring Reader** der Verbindung liest bereits die Konfiguration jeder Ressource über Azure Resource Manager. Die Inhaltsstufe fügt die integrierte Rolle **Storage Blob Data Reader** hinzu, im selben Bereich wie die Verbindung: dem Abonnement oder der Stammverwaltungsgruppe des Mandanten.

### Google Cloud

Die Konfigurationsstufe fügt nichts hinzu: Die Rolle **Cloud Asset Viewer** der Verbindung liest bereits die Konfiguration und die IAM-Richtlinie jeder Ressource. Die Inhaltsstufe fügt zwei Rollen hinzu, `roles/storage.objectViewer` und `roles/bigquery.dataViewer`, im Projekt oder in der Organisation, und schaltet die BigQuery API ein, `bigquery.googleapis.com`.

## Datensicherheit eine Exponierung schließen lassen

Lesen ist alles, was eine Verbindung tut, bis Sie etwas anderes wählen. **Datensicherheitsreaktion**, unter **Weitere Felder** neben **Datensicherheit**, lässt Datensicherheit zusätzlich den öffentlichen Zugriff auf einen Datenspeicher sperren und die Freigabe seiner Snapshots beenden: aus dem Problem des Datenspeichers, mit **Hier beheben** (siehe [Prüfungen und Probleme der Datensicherheit](/docs/data-security/checks-and-issues#hier-beheben)), und aus Playbooks von Security Operations. Sie steht auf **Aus**, bis Sie **Öffentlichen Zugriff und Freigabe sperren** wählen, und der Befehl, den das Formular dann zeigt, gewährt einen einzigen, engen Schreibzugriff, für sich allein:

| Cloud | Was der Befehl hinzufügt | Was er tun darf |
| --- | --- | --- |
| AWS | Eine dritte Inline-Richtlinie, `OneUptimeDataSecurityResponse` | `s3:GetBucketPublicAccessBlock`, `s3:PutBucketPublicAccessBlock`, `rds:DescribeDBSnapshotAttributes`, `rds:DescribeDBClusterSnapshotAttributes`, `rds:ModifyDBSnapshotAttribute` und `rds:ModifyDBClusterSnapshotAttribute`: die Einstellung Block Public Access eines Buckets und mit wem ein manueller Snapshot geteilt ist |
| Azure | Eine benutzerdefinierte Rolle, `OneUptime Data Security Response`, im Bereich der Verbindung | `Microsoft.Storage/storageAccounts/read` und `Microsoft.Storage/storageAccounts/write`: die Einstellungen eines Speicherkontos, etwa den anonymen Blobzugriff, nie seine Schlüssel |
| Google Cloud | Eine benutzerdefinierte Rolle, `oneuptimeDataSecurityResponse` | `storage.buckets.get` und `storage.buckets.update`: die Einstellungen eines Buckets, etwa die Verhinderung des öffentlichen Zugriffs |

Nichts, was sie gewährt, liest Daten, löscht etwas oder ändert, wer sich anmelden darf. Stellen Sie sie zurück auf **Aus**, und Datensicherheit nutzt sie sofort nicht mehr. Um in AWS auch den Zugriff zu entziehen, löschen Sie die Richtlinie mit `aws iam delete-role-policy --role-name <your role> --policy-name OneUptimeDataSecurityResponse`.

## Warum Inhaltsstichproben optional sind

Die Konfigurationsstufe findet, was exponiert ist: einen öffentlichen Bucket, eine aus dem Internet offene Datenbank, fehlende Verschlüsselung, Backups oder Zugriffsprotokolle. Sie kann nicht sagen, was ein Datenspeicher enthält, also zählt ein Datenspeicher, in dem nichts gefunden wurde, als Öffentlich, die niedrigste Sensibilität, und seine Probleme sind so schwer, wie sie es für öffentliche Daten wären. Ein öffentlicher Bucket mit Website-Bildern ist kein Notfall; ein öffentlicher Bucket mit Kartennummern schon.

Inhaltsstichproben unterscheiden die beiden. Sie setzen die Sensibilität jedes Datenspeichers anhand dessen, was er enthält, sodass dasselbe Problem bei Kartennummern Kritisch ist und bei Bildern Niedrig. Sie finden auch, was nur der Inhalt zeigt: Geheimnisse, Kartenprüfnummern, Passwörter, die so gespeichert sind, wie sie eingegeben wurden, und Kopien von Produktionsdaten in einem Testdatenspeicher.

Die meisten Teams gehen deshalb in dieser Reihenfolge vor: überall die Konfigurationsstufe, dann Inhaltsstichproben dort, wo Sie wissen müssen, was ein Datenspeicher enthält. Das Scannen von Inhalten lässt sich auch für einen einzelnen Datenspeicher ausschalten, mit **Inhalt scannen** in den **Einstellungen** des Datenspeichers, oder für das ganze Projekt.

## Was ein Inhaltsscan liest

Ein Scan liest ein wenig von einem Datenspeicher, innerhalb der Grenzen des Projekts, und hört nach 8 Minuten auf, egal was übrig ist. Der nächste macht dort weiter: Er überspringt ein Objekt, das sich seit dem Lesen nicht geändert hat, es sei denn, das ist 7 oder mehr Tage her.

- **Buckets und Container** werden nach Art beprobt, nicht nach Anzahl. Zuerst werden Objektnamen aufgelistet, höchstens zehnmal so viele, wie der Scan lesen darf, und nie mehr als 200.000. Jeder Name wird zu seinem Muster, wobei Datumsangaben, UUIDs, lange Hex-Folgen und Zahlen zu `*` werden, sodass aus `exports/2026-10-27/users-0001.csv` das Muster `exports/*/users-*.csv` wird. Die neuesten Objekte jedes Musters werden gelesen, eines von jedem, bevor ein zweites von irgendeinem gelesen wird, und höchstens 5 eines Musters. Jedes Objekt wird von seinem Anfang an gelesen: höchstens **Bytes pro Objekt** davon und insgesamt **Bytes pro Scan**. Ein Scan nimmt Stichproben aus höchstens 10 Containern eines Azure-Speicherkontos.
- **Dateien werden als das gelesen, was sie sind.** CSV und TSV nach Spalte, JSON und JSON Lines nach Pfad, `.env`, `.ini`, `.properties`, TOML und YAML nach Schlüssel, XML und HTML als ihr Text, Word-, Excel- und PowerPoint-Dateien nach ihrem Text und ihren Zellen und alles andere als Freitext. Eine gzip-Datei wird zuerst entpackt. Bilder, Parquet, Avro, PDF und andere Binärformate werden nicht gelesen, und der Scan sagt das.
- **Datasets und Datenbanken** werden Tabelle für Tabelle gelesen: höchstens **Tabellen pro Scan** Tabellen und **Zeilen pro Tabelle** Zeilen aus jeder.

Jeder Scan hält fest, was er gelesen hat, nach Namen: die Objekte, Tabellen oder Dienste, nie ihren Inhalt. Was er nicht lesen konnte - eine Anfrage, die die Cloud abgelehnt hat, die Frist, das Byte-Budget - ist ein Warnhinweis am Scan, und der Scan wird als **Teilweise erfolgreich** markiert.

## Eine Datenbank scannen, die Sie betreiben

Datensicherheit nimmt Stichproben aus PostgreSQL- und MySQL-Datenbanken, auf eine von zwei Arten. Eine Datenbank, die das Produkt Database überwacht, oder eine, mit der Ihre Dienste laut Dienstkarte sprechen, ist bereits ein Datenspeicher. Eine Datenbank, die kein Scan findet, fügen Sie selbst als Datenspeicher hinzu.

- **Von den Workern von OneUptime.** Setzen Sie in den **Einstellungen** des Datenspeichers die **Verbindungszeichenfolge** auf eine, die nur lesen kann, etwa `postgresql://reader:password@db.internal:5432/app`. Sie wird im Ruhezustand verschlüsselt und nie von der API zurückgegeben. Geben Sie ihr einen Datenbankbenutzer, der lesen kann und sonst nichts.
- **Von einer Sonde in Ihrem Netzwerk.** Wählen Sie die Sonde unter **Von Sonde scannen**, und geben Sie unter **Verbindungsvariable der Sonde** den Namen der Umgebungsvariable auf dieser Sonde ein, die die Verbindungszeichenfolge enthält. Die Sonde liest die Datenbank von innerhalb Ihres Netzwerks und sendet nur zurück, was sie gefunden hat: Die Verbindungszeichenfolge erreicht OneUptime nie. Siehe [Eigene Sonden](/docs/probe/custom-probe), um eine Sonde zu betreiben.

## Was OneUptime behält

Für jeden Datentyp, der an jedem Ort gefunden wird - einer Spalte, einem Feld, einem Objektmuster, einem Telemetrieattribut - behält ein Fund:

- wie viele Werte der Stichprobe ihn enthielten, von wie vielen, und wie viele davon bekannte Testwerte waren;
- wie viele verschiedene Werte passten, geschätzt aus Hashes, die im Speicher des Scanners bleiben und mit dem Scan verworfen werden;
- die Konfidenz und ob der Name des Orts auf den Datentyp hinwies;
- höchstens drei maskierte Stichproben, maskiert im Scanner, bevor irgendetwas ihn verlässt.

Einen Rohwert behält er nie. Jede Art von Wert wird so maskiert, dass ein Mensch ihn erkennen, aber nie verwenden kann:

| Wert | Maskierte Stichprobe |
| --- | --- |
| Eine E-Mail-Adresse | `j***@e******.com`: der erste Buchstabe des Namens und der Domain sowie das Top-Level-Label |
| Eine Kartennummer | `**** **** **** 4242`: die letzten vier Ziffern, so wie PCI DSS die Anzeige einer Karte erlaubt |
| Ein Geheimnis | Seine ersten vier und letzten vier Zeichen, wenn es lang ist, seine ersten zwei, wenn es kurz ist, und nur der Header eines privaten Schlüssels |
| Eine URL oder Verbindungszeichenfolge | Alles außer dem Passwort |
| Eine IP-Adresse | Ihr erster Teil, das Netzwerk, und der Rest verborgen |
| Ein über den Namen gefundener Wert | Sein erstes Zeichen, dann `****` |
| Eine Dokumentkennzeichnung | Die Kennzeichnung, wie sie geschrieben ist, etwa „Vertraulich“: Sie sagt, was das Dokument ist |
| Alles andere | Seine letzten zwei bis vier Zeichen, mit erhaltenen Trennzeichen, etwa `***-**-6789` |

Schalten Sie **Maskierte Stichproben behalten** in den Einstellungen des Projekts aus, um nur Zählungen zu behalten: Ab dem nächsten Scan jedes Datenspeichers behalten die Funde, die er schreibt, keine Stichproben.

Kopien von Daten zwischen Datenspeichern werden anhand von Fingerabdrücken gefunden, nicht anhand von Werten: 128 Zahlen zu je 16 Bit für jeden Datentyp, gehasht mit einem eigenen Schlüssel des Projekts (siehe [Wie Fingerabdrücke privat bleiben](/docs/data-security/flows-access-residency#wie-fingerabdrücke-privat-bleiben)).

Ein Fund zählt noch 30 Tage, nachdem ein Scan ihn zuletzt gesehen hat, für seinen Datenspeicher, da eine Stichprobe verfehlen kann, was noch da ist. Einer, der 90 Tage lang nicht gesehen wurde, wird gelöscht. Ein Datenspeicher behält höchstens 2.000 Funde.

## Einstellungen

Die Einstellungen der Datensicherheit gibt es einmal pro Projekt, im Abschnitt **Einstellungen** des Menüs der Datensicherheit. Sie beginnen mit diesen Standardwerten:

| Einstellung | Standard | Was sie tut |
| --- | --- | --- |
| **Konfiguration prüfen** | An | Führt die Prüfungen an jedem Datenspeicher aus. Ist sie aus, öffnet, ändert oder schließt sich kein Problem. |
| **Inhalt scannen** | An | Nimmt Stichproben vom Inhalt der Datenspeicher, wo die Inhaltsberechtigung gewährt wurde. |
| **Telemetrie scannen** | An | Nimmt Stichproben von Logs, Traces, Ausnahmen, Wiedergaben und KI-Unterhaltungen des Projekts. |
| **Maskierte Stichproben behalten** | An | Behält bis zu drei maskierte Stichproben bei jedem Fund. Aus behält nur Zählungen. |
| **Sicherheitsfälle eröffnen** | An | Eröffnet einen Sicherheitsfall, gruppiert nach Datenspeicher, wenn sich ein kritisches Problem öffnet. |
| **Warnungen auslösen** | Aus | Löst eine Warnung aus, die alarmiert, wer gerade Bereitschaft hat, wenn sich ein kritisches Problem öffnet. |
| **Warnungsschweregrad** | Leer | Der Schweregrad dieser Warnungen. Leer ist der höchste des Projekts. |
| **Eigentümer benachrichtigen** | An | Schickt den Eigentümern eines Datenspeichers eine E-Mail, wenn sich an ihm ein Problem öffnet. |
| **Objekte pro Scan** | 2.000 | Höchstzahl der Objekte, die ein Scan eines Buckets liest, von 10 bis 50.000. |
| **Bytes pro Objekt** | 65.536 (64 KB) | Höchstzahl der Bytes, die aus einem Objekt gelesen werden, von 1.024 bis 4.194.304. |
| **Bytes pro Scan** | 52.428.800 (50 MB) | Höchstzahl der Bytes, die ein Inhaltsscan insgesamt liest, von 65.536 bis 1.073.741.824. |
| **Zeilen pro Tabelle** | 1.000 | Höchstzahl der Zeilen, die aus einer Tabelle gelesen werden, von 10 bis 100.000. |
| **Tabellen pro Scan** | 200 | Höchstzahl der Tabellen, die ein Scan liest, von 1 bis 5.000. |
| **Stichprobengröße der Telemetrie** | 500 | Wie viele aktuelle Datensätze jedes Dienstes und Signals ein Telemetriescan liest, von 10 bis 10.000. |
| **Scan-Intervall (Stunden)** | 24 | Wie oft erneut Stichproben vom Inhalt eines Datenspeichers genommen werden, von 1 bis 720. |
| **Nie sensibel** | Leer | Werte, die nie Funde sind, etwa Ihre eigene Support-Adresse. |
| **Ausgeschaltete Datentypen** | Leer | Integrierte Datentypen, nach denen die Scans des Projekts nicht suchen: die Schalter unter **Integrierte Datentypen**. |

## Fehlerbehebung

:::details Ein Datenspeicher meldet, dass sein Inhalt nicht gescannt wurde
Der Scan sagt, warum: „Das Scannen von Inhalten erfordert die Inhaltsberechtigung der Verbindung oder eine Verbindungszeichenfolge für eine Datenbank.“ Setzen Sie die Verbindung des Datenspeichers auf **Konfiguration und Inhaltsstichproben** und führen Sie ihren Befehl erneut aus, oder geben Sie der Datenbank eine Verbindungszeichenfolge. Prüfen Sie auch, ob **Inhalt scannen** für den Datenspeicher und in den Einstellungen des Projekts eingeschaltet ist.
:::

:::details Eine Prüfung meldet, dass sie es nicht sagen kann
Eine Tatsache, die der Leser nicht lesen konnte - eine Berechtigung, die die Rolle nicht hat, eine API, die nicht eingeschaltet ist - ist unbekannt, nie geraten. Ihre Prüfung meldet, dass sie es nicht sagen kann, und ein Problem, das sie eröffnet hat, bleibt offen: Niemand darf schließen, ein Mangel sei behoben, nur weil OneUptime nicht nachsehen konnte. Die Warnhinweise beim Lesen der Konfiguration sagen, was nicht gelesen werden konnte. Führen Sie den Befehl der Verbindung erneut aus, um zu gewähren, was fehlt.
:::

:::details Es erscheinen keine S3-Buckets oder BigQuery-Datasets
Sie stammen aus dem Lesen der Konfiguration, nicht aus dem Cloud-Inventar. Setzen Sie die Verbindung auf **Nur Konfiguration** oder höher, und führen Sie ihren Befehl erneut aus.
:::

:::details Ein Scan ist als „Teilweise erfolgreich“ markiert
Er hat eine Grenze erreicht, bevor er alles gelesen hat: die 8 Minuten, **Bytes pro Scan** oder **Objekte pro Scan**, oder eine Anfrage, die die Cloud abgelehnt hat. Seine Warnhinweise sagen, welche. Der nächste Scan macht weiter und überspringt, was sich nicht geändert hat, oder Sie heben die Grenze an.
:::

## Nächste Schritte

:::cards
- [Sensible Datentypen](/docs/data-security/data-types): Wonach der Scanner in dem sucht, was er liest.
- [Prüfungen und Probleme der Datensicherheit](/docs/data-security/checks-and-issues): Worauf das Lesen der Konfiguration geprüft wird.
- [Sensible Daten in der Telemetrie](/docs/data-security/telemetry): Ihre Logs, Traces und KI-Unterhaltungen, die keine Einrichtung brauchen.
- [Ein Cloud-Konto verbinden](/docs/telemetry/cloud-accounts): AWS, Azure oder Google Cloud überhaupt erst verbinden.
:::
