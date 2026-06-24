# Manuell monitor

Manuell overvåking lar deg opprette monitorer hvis status administreres helt for hånd eller via API. OneUptime utfører ingen automatiserte sjekker – du styrer monitorstatusen direkte.

## Oversikt

Manuelle monitorer er plassholdere som du oppdaterer selv. Dette er nyttig for:

- Integrering med eksterne overvåkingsverktøy som oppdaterer status via OneUptime API
- Sporing av tjenester eller systemer som ikke kan overvåkes automatisk
- Håndtering av hendelser for komponenter uten automatiserte helsesjekker
- Representering av tredjeparts avhengigheter hvis status du sporer manuelt

## Opprette en manuell monitor

1. Gå til **Monitors** i OneUptime-dashbordet
2. Klikk **Create Monitor**
3. Velg **Manual** som monitortype
4. Skriv inn et navn og en beskrivelse for monitoren

## Slik fungerer det

Manuelle monitorer har ikke overvåkingsintervaller, prober eller automatisert kriterieevaluering. Monitorstatusen forblir som du setter den til, til du endrer den.

### Oppdatere status

Du kan oppdatere statusen til en manuell monitor på to måter:

- **Dashbord** – Endre monitorstatusen direkte fra OneUptime-dashbordet
- **API** – Oppdater monitorstatusen programmatisk ved hjelp av OneUptime API

### Hendelser og varsler

Du kan opprette hendelser og varsler mot manuelle monitorer akkurat som enhver annen monitortype. Dette lar deg:

- Spore nedetid for eksternt overvåkede tjenester
- Opprette hendelser manuelt når problemer rapporteres
- Bruke manuelle monitorer på statussider for å kommunisere status til brukere

## Når bør du bruke manuelle monitorer?

| Brukstilfelle          | Beskrivelse                                                                          |
| ---------------------- | ------------------------------------------------------------------------------------ |
| Tredjeparts tjenester  | Spore status til eksterne tjenester du er avhengig av, men ikke kan overvåke direkte |
| Fysisk infrastruktur   | Representere maskinvare eller fysiske systemer uten nettverksovervåking              |
| Forretningsprosesser   | Spore ikke-tekniske prosesser som påvirker tjenestestatus                            |
| API-drevet status      | La eksterne verktøy oppdatere monitorstatus via OneUptime API                        |
| Statussideplassholdere | Vis komponenter på statussiden din som administreres utenfor OneUptime               |
