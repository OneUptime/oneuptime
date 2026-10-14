# Ressourcen importieren

Sie müssen nicht von vorn anfangen, um OneUptime mit Terraform zu verwalten. Importieren Sie die Monitore, Statusseiten, Teams und anderen Datensätze, die Sie schon haben, und Terraform verwaltet sie von da an, so wie sie sind. Ein Import liest nur: In OneUptime ändert sich nichts, bis Sie eine Änderung anwenden, die Sie geplant haben.

:::cards
- [Wie ein Import funktioniert](#wie-ein-import-funktioniert): Was ein Import liest, und was Sie schreiben.
- [Eine Ressource importieren](#eine-ressource-importieren): Von ihrer Seite im Dashboard aus, in vier Schritten.
- [Viele Ressourcen importieren](#viele-ressourcen-importieren): Import-Blöcke für eine ganze Liste, und Konfiguration, die Terraform für Sie schreibt.
- [Eine Ressource nicht mehr verwalten](#eine-ressource-nicht-mehr-verwalten): Geben Sie sie an das Dashboard zurück, ohne sie zu löschen.
:::

## Wie ein Import funktioniert

Ein Import verbindet einen Datensatz, der in OneUptime schon existiert, mit einem `resource`-Block Ihrer Konfiguration. Sie schreiben einen `import`-Block mit der ID des Datensatzes und der Adresse, unter der er landet. Der nächste `terraform plan` liest den Datensatz über seine ID und zeigt, dass er importiert wird, zusammen mit jedem Unterschied zwischen dem Datensatz und Ihrer Konfiguration. `terraform apply` nimmt ihn in den State von Terraform auf, und von da an wird der Datensatz verwaltet wie alles, was Terraform angelegt hat.

```mermaid title="Von einem Datensatz in OneUptime zu einer verwalteten Ressource"
flowchart TB
    R["Ein Datensatz in OneUptime,<br/>im Dashboard angelegt"] --> I["Ein import-Block:<br/>seine ID und eine Adresse"]
    C["Ein resource-Block:<br/>seine Einstellungen"] --> P["terraform plan<br/>liest den Datensatz"]
    I --> P
    P --> A["terraform apply<br/>nimmt ihn in den State auf"]
    A --> M["Von Terraform verwaltet"]
```

Schreiben Sie den `resource`-Block so, dass er sagt, was der Datensatz bereits ist. Wo beide sich unterscheiden, zeigt der Plan den Import und eine Änderung, und wenn Sie ihn anwenden, ändert sich der Datensatz in OneUptime.

### Was sich importieren lässt

Jede Ressource des Providers lässt sich über ihre ID importieren, außer `oneuptime_file`: Die OneUptime-API kann eine Datei nicht zurücklesen, also antwortet der Provider mit `Import Not Supported`. Datenquellen werden nie importiert. Um einen Datensatz in Ihrer Konfiguration zu verwenden, ohne ihn zu verwalten, lesen Sie ihn stattdessen mit einer [Datenquelle](/docs/terraform/complete-guide#lesen-was-schon-existiert).

## Bevor Sie beginnen

- **Terraform 1.5 oder neuer, oder OpenTofu 1.6 oder neuer.** Die `import`-Blöcke auf dieser Seite brauchen diese Versionen. Ein älteres Terraform importiert über die [Befehlszeile](#über-die-befehlszeile-importieren).
- **Ein API-Schlüssel, der lesen darf, was Sie importieren.** Der Import liest jeden Datensatz mit dem Schlüssel des Providers, und um ihn danach zu verwalten, braucht der Schlüssel auch die Berechtigungen, ihn zu ändern und zu löschen. Siehe [Einen API-Schlüssel des Projekts anlegen](/docs/terraform/quick-start#einen-api-schlüssel-des-projekts-anlegen).
- **Der Provider in Ihrer Konfiguration**, eingerichtet wie im [Schnellstart](/docs/terraform/quick-start#terraform-auf-oneuptime-ausrichten).

## Eine Ressource importieren

Das Dashboard schreibt die Konfiguration der Ressource, die Sie gerade ansehen, mit ihrem `import`-Block, sodass Sie selten einen von Hand schreiben.

:::steps
### Die Terraform-Seite der Ressource öffnen

Öffnen Sie den Monitor, die Statusseite oder die andere Ressource im Dashboard. Öffnen Sie in ihrem Seitenmenü **Entwickler** und dann **Terraform**.

### Ihre Konfiguration kopieren

Die Seite schreibt den `resource`-Block der Ressource aus ihren aktuellen Einstellungen, und einen `import`-Block mit ihrer ID. Legen Sie beide in eine `.tf`-Datei:

```hcl title="status-pages.tf"
resource "oneuptime_status_page" "public_status" {
  name       = "Public Status"
  page_title = "Acme Status"

  # Secrets are not shown here: master_password, embedded_overall_status_token.
  # Terraform leaves them as they are in OneUptime.
}

import {
  to = oneuptime_status_page.public_status
  id = "68a1b2c3-d4e5-4f6a-8b9c-0d1e2f3a4b02"
}
```

Sie schreibt die Einstellungen, die von ihren Standardwerten abweichen, und ein Kommentar nach jeder ID nennt den Datensatz, auf den sie zeigt. Geheimnisse werden nie angezeigt: Die, die die Ressource braucht, werden aus Variablen gelesen, die als `sensitive` markiert sind, und der Kommentar nennt die, die sie weglässt.

### Planen

Führen Sie `terraform plan` aus. Er endet mit `Plan: 1 to import, 0 to add, 0 to change, 0 to destroy.`: Terraform hat den Datensatz gefunden, und Ihre Konfiguration stimmt mit ihm überein.

### Anwenden

Führen Sie `terraform apply` aus. Die Statusseite ist jetzt im State von Terraform, und der nächste Plan antwortet `No changes.` Danach können Sie den `import`-Block löschen, oder ihn als Notiz behalten, woher die Ressource kam: Er bewirkt nichts mehr, sobald die Ressource verwaltet wird.
:::

### Die Blöcke selbst schreiben

Ohne das Dashboard schreiben Sie beide Blöcke selbst. Beginnen Sie den `resource`-Block mit den Attributen, die die Ressource braucht, und führen Sie `terraform plan` aus. Wo Ihre Konfiguration vom Datensatz abweicht, zeigt der Plan die Änderung neben dem Import:

```text
  # oneuptime_label.critical will be updated in-place
  # (imported from "68a1b2c3-d4e5-4f6a-8b9c-0d1e2f3a4b03")
  ~ resource "oneuptime_label" "critical" {
      ~ color = "#FF5733" -> "#000000"
    }

Plan: 1 to import, 0 to add, 1 to change, 0 to destroy.
```

Übernehmen Sie den Wert des Datensatzes in Ihre Konfiguration (hier `color = "#FF5733"`), und planen Sie erneut, bis der Plan den Import und keine Änderung zeigt. Die ID des Datensatzes steht an drei Stellen:

| Wo | Wie |
| --- | --- |
| Die Seite der Ressource | Ihre Detailkarte endet mit einer Zeile **ID**. Klicken Sie auf die ID oder auf die Kopierschaltfläche daneben, um die ganze ID zu kopieren. |
| Die Adressleiste | Die ID folgt auf den Namen der Liste: `/dashboard/<project-id>/monitors/<monitor-id>`. |
| Die API | Jeder Datensatz trägt seine ID in `_id`. |

## Viele Ressourcen importieren

Um jeden Monitor, jede Statusseite oder jede andere Ressource einer Art zu importieren, beginnen Sie bei ihrer Liste.

:::steps
### Die Terraform-Seite der Liste öffnen

Öffnen Sie die Liste, dann **Entwickler** und **Terraform** in ihrem Seitenmenü, zum Beispiel **Monitore → Entwickler → Terraform**.

### Die Import-Blöcke kopieren

Die Seite schreibt einen `import`-Block für jeden Datensatz (die ersten 100), mit einer Adresse aus dem Namen des Datensatzes. Legen Sie sie in eine eigene Datei, etwa `imports.tf`:

```hcl title="imports.tf"
import {
  to = oneuptime_monitor.homepage
  id = "68a1b2c3-d4e5-4f6a-8b9c-0d1e2f3a4b01"
}

import {
  to = oneuptime_monitor.checkout_api
  id = "68a1b2c3-d4e5-4f6a-8b9c-0d1e2f3a4b05"
}
```

### Terraform die Konfiguration schreiben lassen

Führen Sie den Plan mit einem Dateinamen für die Konfiguration aus, die Terraform schreibt. Die Datei darf noch nicht existieren: Terraform schreibt nur in eine neue Datei.

```bash
terraform plan -generate-config-out=monitors.tf
```

Terraform liest jeden Datensatz und schreibt einen `resource`-Block für jeden `import`-Block, der noch keinen hat. Es warnt, dass das Erzeugen von Konfiguration experimentell ist, also lesen Sie, was es geschrieben hat.

### Prüfen und anwenden

Ersetzen Sie in der neuen Datei die IDs anderer Datensätze durch Verweise auf ihre Ressourcen, etwa `labels = [oneuptime_label.critical.id]`, damit Terraform weiß, in welcher Reihenfolge es arbeiten muss. Führen Sie `terraform plan` aus, bis er nur noch die Importe zeigt, dann `terraform apply`.
:::

### Ein ganzes Projekt

Importieren Sie ein Projekt Liste für Liste, beginnend mit den Datensätzen, auf die andere verweisen. Dann kann jeder Ressourcen-Block auf die vor ihm über ihre Adresse verweisen statt über ihre ID:

```mermaid title="Zuerst die Datensätze importieren, auf die andere verweisen"
flowchart TB
    S["Beschriftungen, Teams,<br/>Monitorstatus<br/>und Vorfallsschweregrade"] --> M["Monitore, Statusseiten<br/>und Bereitschaftsrichtlinien"]
    M --> L["Was sie verbindet:<br/>Statusseiten-Ressourcen,<br/>Eskalationsregeln<br/>und Teammitglieder"]
```

Datensätze, mit denen jedes Projekt beginnt, etwa seine Monitorstatus und Vorfallsschweregrade, liest man oft besser mit Datenquellen, als sie zu importieren: Terraform kann dann auf sie verweisen, ändert oder löscht sie aber nie. Das Projekt ist importiert, wenn `terraform plan` mit `No changes.` antwortet.

## Über die Befehlszeile importieren

`terraform import` importiert eine Ressource nach der anderen und funktioniert mit jeder Version von Terraform und OpenTofu. Schreiben Sie zuerst den `resource`-Block, dann führen Sie den Befehl mit der Adresse des Blocks und der ID des Datensatzes aus:

```bash
terraform import oneuptime_status_page.public_status 68a1b2c3-d4e5-4f6a-8b9c-0d1e2f3a4b02
terraform import oneuptime_label.critical 68a1b2c3-d4e5-4f6a-8b9c-0d1e2f3a4b03
terraform import oneuptime_team.sre 68a1b2c3-d4e5-4f6a-8b9c-0d1e2f3a4b04
```

Jeder endet mit `Import successful!`. Anders als ein `import`-Block schreibt der Befehl den State sofort, ohne einen Plan, den Sie vorher prüfen: Führen Sie danach `terraform plan` aus, und ändern Sie Ihre Konfiguration, bis der Plan mit `No changes.` antwortet.

## Eine Ressource nicht mehr verwalten

Um eine Ressource an das Dashboard zurückzugeben, ohne sie zu löschen, ersetzen Sie ihren `resource`-Block durch einen `removed`-Block, der den Datensatz behält:

```hcl
removed {
  from = oneuptime_team.sre

  lifecycle {
    destroy = false
  }
}
```

Der Plan sagt, dass das Team nicht mehr von Terraform verwaltet wird, und zerstört nichts. Wenden Sie ihn an, dann löschen Sie den `removed`-Block. Ein `removed`-Block mit `destroy = false` braucht Terraform 1.7 oder neuer, oder OpenTofu 1.10 oder neuer. Mit einer älteren Version führen Sie stattdessen `terraform state rm oneuptime_team.sre` aus.

> [!WARNING]
> Wer einen `resource`-Block löscht, löscht beim nächsten Apply seinen Datensatz in OneUptime. Unter Terraform tut das auch ein `removed`-Block ohne `destroy = false`: Schreiben Sie immer den `lifecycle`-Block.

## Gut zu wissen

- **Ein Import ändert nichts, das nächste Apply aber schon.** Wer einen Plan anwendet, der neben einem Import eine Änderung zeigt, ändert den Datensatz in OneUptime. Sorgen Sie zuerst dafür, dass der Plan nur den Import zeigt.
- **Geheimnisse werden nicht zurückgelesen.** Ein Geheimnis, das OneUptime nie zurücksendet, etwa das `secret_value` eines Monitorgeheimnisses, ist nach einem Import nicht im State. Setzt Ihre Konfiguration es, zeigt der erste Plan es als Änderung, und das Anwenden schreibt das Geheimnis erneut.
- **Eine Konfiguration für jeden Datensatz.** Ein Datensatz, der in zwei Konfigurationen importiert wurde, wird bei jedem Apply auf das zurückgesetzt, was die jeweilige sagt.
- **Importierte Datensätze sind verwaltete Datensätze.** `terraform destroy` löscht sie aus OneUptime, wie die Datensätze, die Terraform angelegt hat.

## Fehlerbehebung

:::details Meldung „Cannot import non-existent remote object“
Kein Datensatz hat diese ID, oder der API-Schlüssel des Providers darf ihn nicht lesen: OneUptime antwortet auf beides gleich. Prüfen Sie die ID, und ob der Schlüssel diese Art von Datensatz lesen darf.
:::

:::details Meldung „Import Not Supported“
`oneuptime_file` ist die einzige Ressource, die sich nicht importieren lässt. Lassen Sie sie weg, und lassen Sie Terraform stattdessen eine neue Datei anlegen.
:::

:::details Meldung „Invalid ID format“
Die ID ist nicht die ID eines Datensatzes, zum Beispiel ein Name. Ein Import nimmt die ID, eine UUID wie `68a1b2c3-d4e5-4f6a-8b9c-0d1e2f3a4b02`: Kopieren Sie sie von der Seite der Ressource.
:::

:::details Meldung „Target generated file already exists“
`-generate-config-out` nennt eine Datei, die schon da ist. Nennen Sie eine neue Datei, oder verschieben Sie den Inhalt der Datei woandershin und löschen Sie sie.
:::

:::details Meldung „Resource already managed by Terraform“
`terraform import` hat eine Adresse bekommen, die schon im State steht. Importieren Sie den Datensatz unter einer anderen Adresse, oder prüfen Sie mit `terraform state list`, was unter der Adresse steht.
:::

## Nächste Schritte

:::cards
- [Vollständige Anleitung](/docs/terraform/complete-guide): Datenquellen, Verweise zwischen Ressourcen und der State.
- [Monitorschritte](/docs/terraform/monitor-steps): Lesen und ändern, was ein importierter Monitor prüft.
- [Beispiele](/docs/terraform/examples): Fertige Konfigurationen für die gängigen Ressourcen.
- [Fehlerbehebung](/docs/terraform/troubleshooting): Häufige Fehler und wie Sie sie beheben.
:::
