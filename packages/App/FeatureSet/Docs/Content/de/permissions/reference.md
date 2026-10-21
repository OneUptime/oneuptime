# Berechtigungsreferenz

Jede Rolle und jede Berechtigung, die OneUptime vergeben kann, gruppiert wie in der Berechtigungsauswahl des Dashboards. Auf dieser Seite finden Sie den genauen Namen oder Schlüssel, den Sie einem Team, einem API-Schlüssel oder einer Terraform-Ressource geben.

Die Tabellen werden beim Ausliefern der Seite aus dem Quellcode von OneUptime erzeugt: dieselbe Liste, die das Dashboard, die API und der Terraform-Provider verwenden. Sie passen also immer zu der Version, die Sie betreiben. Wie Berechtigungen zusammenwirken (Teams, Geltungsbereiche, Eigentümer und Sperren), erklärt [Benutzer, Teams & Berechtigungen](/docs/permissions/index).

## So lesen Sie die Tabellen

Jede Rolle und jede Berechtigung hat eine Zeile mit diesen Spalten:

- **Rolle** oder **Berechtigung**: der Name, den das Dashboard anzeigt.
- **Berechtigungsschlüssel**: der Wert für die [API](/docs/api-reference/api-reference), die [CLI](/docs/cli/index) und den [Terraform-Provider](/docs/terraform/index).
- **Geltungsbereich** (nur Rollen): `Alle, Eigene oder Labels` bedeutet, dass Sie beim Vergeben der Rolle wählen, wie weit sie reicht. `Nur projektweit` bedeutet, dass die Rolle immer im ganzen Projekt gilt.
- **Nach Labels einschränkbar** (nur Berechtigungen): `Ja` bedeutet, dass sich eine Vergabe dieser Berechtigung auf Ressourcen mit bestimmten Labels beschränken lässt.
- **Beschreibung**: was die Rolle oder Berechtigung erlaubt.

> [!TIP]
> Greifen Sie zuerst zu einer Rolle. Rollen bleiben richtig, wenn OneUptime neue Funktionen bekommt, während Sie eine Liste einzelner Berechtigungen von Hand aktuell halten müssen.

## Rollen

{{PERMISSION_ROLE_COUNT}} Rollen. Vier davon gelten im ganzen Projekt: Project Owner, Project Admin, Project Member und Viewer. Jede der anderen deckt einen Produktbereich ab, etwa Vorfälle oder Monitore, auf der Stufe Admin, Member oder Viewer. Diese Rollen bietet **Rolle hinzufügen** auf der Seite **Berechtigungen** eines Teams und auf der Seite eines API-Schlüssels an.

{{PERMISSION_ROLE_TABLES}}

## Einzelne Berechtigungen

{{PERMISSION_TOTAL_COUNT}} einzelne Fähigkeiten in {{PERMISSION_GROUP_COUNT}} Gruppen. Diese bietet **Berechtigung hinzufügen** für ein Team oder einen API-Schlüssel an, wenn eine Rolle mehr erlaubt, als Sie brauchen.

{{PERMISSION_GRANULAR_TABLES}}

## Nächste Schritte

:::cards
- [Benutzer, Teams & Berechtigungen](/docs/permissions/index): Wie Teams, Geltungsbereiche, Eigentümer und Sperren bestimmen, was jemand tun darf.
- [API-Referenz](/docs/api-reference/api-reference): Berechtigungsschlüssel mit API-Schlüsseln verwenden.
- [Terraform-Provider](/docs/terraform/index): Teams und ihre Berechtigungen als Code verwalten.
:::
