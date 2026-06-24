# Manuel monitor

Manuel overvågning giver dig mulighed for at oprette monitorer, hvis status administreres helt manuelt eller via API'en. OneUptime udfører ingen automatiserede tjek – du styrer monitorstatus direkte.

## Oversigt

Manuelle monitorer er pladsholdere, som du opdaterer selv. Dette er nyttigt til:

- Integration med eksterne overvågningsværktøjer, der opdaterer status via OneUptime API
- Sporing af tjenester eller systemer, der ikke kan overvåges automatisk
- Håndtering af incidents til komponenter uden automatiserede sundhedstjek
- Repræsentation af tredjepartsafhængigheder, hvis status du sporer manuelt

## Oprettelse af en Manuel Monitor

1. Gå til **Monitorer** i OneUptime-dashboardet
2. Klik på **Opret monitor**
3. Vælg **Manuel** som monitortype
4. Indtast et navn og en beskrivelse til monitoren

## Sådan fungerer det

Manuelle monitorer har ingen overvågningsintervaller, prober eller automatiseret kriterievaluering. Monitorstatus forbliver, som du har indstillet den, indtil du ændrer den.

### Opdatering af status

Du kan opdatere status for en manuel monitor på to måder:

- **Dashboard** – Skift monitorstatus direkte fra OneUptime-dashboardet
- **API** – Opdater monitorstatus programmatisk ved hjælp af OneUptime API

### Incidents og advarsler

Du kan oprette incidents og advarsler mod manuelle monitorer ligesom med enhver anden monitortype. Dette giver dig mulighed for at:

- Spore nedetid for eksternt overvågede tjenester
- Oprette incidents manuelt, når problemer rapporteres
- Bruge manuelle monitorer på statussider til at kommunikere status til brugere

## Hvornår skal du bruge manuelle monitorer

| Brugsscenarie          | Beskrivelse                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------ |
| Tredjepartstjenester   | Spor status for eksterne tjenester, du er afhængig af, men ikke kan overvåge direkte |
| Fysisk infrastruktur   | Repræsenter hardware eller fysiske systemer uden netværksovervågning                 |
| Forretningsprocesser   | Spor ikke-tekniske processer, der påvirker servicestatus                             |
| API-drevet status      | Lad eksterne værktøjer opdatere monitorstatus via OneUptime API                      |
| Statussideplaceholders | Vis komponenter på din statusside, der administreres uden for OneUptime              |
