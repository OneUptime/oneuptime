# Berechtigungsreferenz

Jede Berechtigung, die OneUptime vergeben kann — gruppiert genau so, wie sie auch die Berechtigungsauswahl im Dashboard gruppiert.

Diese Seite wird zur Laufzeit aus dem OneUptime-Quellcode erzeugt — aus derselben Liste, die auch das Dashboard, die API und der Terraform-Provider verwenden. Sie kann nicht vom Produkt abweichen und zeigt genau die Version, die Sie einsetzen.

Wenn Sie wissen möchten, wie die Teile zusammenspielen — Teams, Geltungsbereiche, Eigentümer, Sperren —, beginnen Sie mit [Benutzer, Teams & Berechtigungen](/docs/permissions/index).

Die Spalte **Berechtigungsschlüssel** enthält den Wert für die [API](/docs/api-reference/api-reference), die [CLI](/docs/cli/index) und den [Terraform-Provider](/docs/terraform/index). Die Titel sind das, was Sie im Dashboard sehen.

## Rollen

{{PERMISSION_ROLE_COUNT}} Rollen, die jeweils einen Produktbereich auf der Stufe Admin, Member oder Viewer bündeln. Diese bietet die Auswahl **Rolle** an, wenn Sie einem Team eine Berechtigung hinzufügen.

Die Spalte **Geltungsbereich** gibt an, ob die Rolle beim Zuweisen eingegrenzt werden kann. `Alle, Eigene oder Labels` bedeutet, dass Sie wählen können; `Nur projektweit` bedeutet, dass die Rolle immer für das gesamte Projekt gilt.

{{PERMISSION_ROLE_TABLES}}

## Granulare Berechtigungen

{{PERMISSION_TOTAL_COUNT}} einzelne Fähigkeiten in {{PERMISSION_GROUP_COUNT}} Gruppen. Diese bietet die Auswahl **Granular** an, und diese weisen Sie API-Schlüsseln zu.

Die Spalte **Nach Labels einschränkbar** gibt an, ob eine Zuweisung dieser Berechtigung auf Ressourcen mit bestimmten Labels begrenzt werden kann.

{{PERMISSION_GRANULAR_TABLES}}
