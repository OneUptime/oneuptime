# Datenprodukte

Die Menschen, die Daten nutzen - Analysten, die Finanzabteilung, Führungskräfte, KI-Agenten - denken in dem, was sie nutzen: „die Tabellen des Umsatz-Dashboards“, nicht in Datenbanken. Ein **Datenprodukt** benennt diese Tabellen, mit seinem Eigentümer, seinen Nutzern und seinem Aktualitäts-SLA, und sagt allen, die davon abhängen, ob die heutigen Daten da sind.

## Ein Datenprodukt anlegen

Legen Sie unter **Data Observability > Datenprodukte** ein Datenprodukt an: Geben Sie ihm einen Namen, wählen Sie seine Tabellen und geben Sie ihm ein SLA mit einer oder beiden dieser Vorgaben:

- **Aktuell bis zu einer Tageszeit (UTC):** Die Daten jedes Tages kommen an diesem Tag bis zu dieser Uhrzeit an. Ab dieser Uhrzeit muss sich jede Tabelle an diesem Tag geändert haben; bis dahin gilt die Ladung von gestern. Eine Ladung, die immer eine halbe Stunde zu spät kommt, ist jeden Tag für diese halbe Stunde verspätet.
- **Ein maximales Alter:** Die letzte Änderung jeder Tabelle darf nicht älter sein als dieser Wert.

Alle fünf Minuten werden die Tabellen jedes Produkts gegen sein SLA geprüft. Das Produkt ist **Late**, sobald eine seiner Tabellen es ist, und seine Daten haben den Stand der ältesten letzten Änderung unter ihnen. Es schreibt `oneuptime.data.product.late_tables` und `oneuptime.data.product.data_age`, sodass Sie die Aktualität aller Produkte nebeneinander darstellen können.

## Auf Statusseiten

Beim Speichern eines Produkts entsteht außerdem ein **Monitor** dafür, in Ihrem Namen und mit Ihren Berechtigungen. Der Monitor steht auf Beeinträchtigt, solange eine Tabelle verspätet ist, und eröffnet einen Vorfall und eine Warnung mit dem niedrigsten Schweregrad Ihres Projekts, die sich von selbst auflösen. Fügen Sie ihn als Ressource einer privaten oder öffentlichen Statusseite hinzu: Nutzer, die sie abonnieren, erfahren, wenn das Produkt verspätet ist und wenn es wieder aktuell ist. Siehe [Ressourcen von Statusseiten](/docs/status-pages/resources-and-groups).

## Als SLO

Beim Speichern eines Produkts entsteht außerdem ein **SLO** über seinem Monitor: der Anteil der Zeit, in der die Daten pünktlich sind, gemessen am Ziel des Produkts über 30 Tage, mit den schnellen und langsamen Burn-Rate-Warnungen, mit denen jedes SLO beginnt. Siehe [SLOs](/docs/slo/introduction). Wenn Sie das Produkt löschen, werden sein Monitor und sein SLO mitgelöscht.

## Das Badge „data as of“

Jedes Produkt hat ein **Badge**, das angibt, welchen Stand seine Daten haben, grün, solange sie pünktlich sind, und gelb mit „late“, sobald sie es nicht mehr sind. Betten Sie es von der **Übersicht** des Produkts aus in ein BI-Dashboard, eine Wiki-Seite oder eine README ein:

```markdown
![Data as of](https://oneuptime.com/api/data-observability/data-products/<data product ID>/badge?token=<badge token>)
```

Sein Link braucht keine Anmeldung, behandeln Sie ihn also wie einen geteilten Link. **Badge-Link zurücksetzen** erstellt einen neuen und macht den alten ungültig.

## Nächste Schritte

:::cards
- [Tabellenzustand](/docs/data-observability/table-health): Wie die Aktualität jeder Tabelle gelernt wird.
- [OneUptime AI und die API](/docs/data-observability/ai-and-api): Lassen Sie KI-Agenten die Tabellen eines Produkts prüfen, bevor sie sie nutzen.
:::
