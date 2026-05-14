# Manuell monitor

Manuell övervakning gör det möjligt att skapa monitorer vars status hanteras helt manuellt eller via API:et. OneUptime utför inga automatiserade kontroller – du styr monitorstatusen direkt.

## Översikt

Manuella monitorer är platshållare som du uppdaterar själv. Detta är användbart för:

- Integration med externa övervakningsverktyg som uppdaterar status via OneUptime API:et
- Spårning av tjänster eller system som inte kan övervakas automatiskt
- Hantering av incidenter för komponenter utan automatiserade hälsokontroller
- Representation av tredjepartsberoenden vars status du spårar manuellt

## Skapa en manuell monitor

1. Gå till **Monitorer** i OneUptime-instrumentpanelen
2. Klicka på **Skapa monitor**
3. Välj **Manuell** som monitortyp
4. Ange ett namn och en beskrivning för monitorn

## Hur det fungerar

Manuella monitorer har inga övervakningsintervall, sonder eller automatiserad kriteriesutvärdering. Monitorstatusen förblir som du angett den tills du ändrar den.

### Uppdatera status

Du kan uppdatera statusen för en manuell monitor på två sätt:

- **Instrumentpanel** – Ändra monitorstatus direkt från OneUptime-instrumentpanelen
- **API** – Uppdatera monitorstatus programmatiskt med OneUptime API:et

### Incidenter och varningar

Du kan skapa incidenter och varningar mot manuella monitorer precis som med vilken annan monitortyp som helst. Detta gör det möjligt att:

- Spåra driftstopp för externt övervakade tjänster
- Skapa incidenter manuellt när problem rapporteras
- Använda manuella monitorer på statussidor för att kommunicera status till användarna

## När du ska använda manuella monitorer

| Användningsfall | Beskrivning |
|----------------|-------------|
| Tredjepartstjänster | Spåra statusen för externa tjänster du är beroende av men inte kan övervaka direkt |
| Fysisk infrastruktur | Representera hårdvara eller fysiska system utan nätverksövervakning |
| Affärsprocesser | Spåra icke-tekniska processer som påverkar tjänststatus |
| API-driven status | Låt externa verktyg uppdatera monitorstatus via OneUptime API:et |
| Statussideplatshållare | Visa komponenter på din statussida som hanteras utanför OneUptime |
