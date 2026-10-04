# Opret et workflow

For at oprette et workflow åbner du **Arbejdsgange** og klikker **Opret arbejdsgang**. Dialogen **Opret en arbejdsgang** spørger først, hvordan du vil begynde, og derefter om et navn. En skabelon, der selv har brug for indstillinger, fx en Slack-webhook-URL, spørger om dem i et trin mere.

Vælg, hvordan du vil begynde:

- **Start fra bunden**, øverst i dialogen, giver dig et tomt lærred. Det er her, de fleste workflows begynder.
- **Eller start fra en skabelon** viser nogle få skabeloner under **Anbefalet**. Til resten vælger du en kategori ved siden af søgefeltet, fx **Hændelser**, **Monitorer** eller **Jira**, eller **Alle skabeloner**, eller du skriver i **Søg i skabeloner…**. Hvert ord, du skriver, skal passe.

Klik på en skabelon for at se, hvad den gør: dens trigger, de blokke, den består af, og de indstillinger, den vil spørge om. Klik derefter på **Brug denne skabelon**, eller dobbeltklik på skabelonen. I søgefeltet vælger piletasterne en skabelon, og **Enter** bruger den. `/` fører dig tilbage til søgefeltet.

Arbejdsgange oprettes slået fra, så intet kører, før du slår dem til. Et nyt workflow åbner i **Bygger**, lærredet hvor du designer det.

## Lærredet

Et workflow bygget fra bunden åbner med én stiplet blok, hvor der står **Choose what starts this workflow**. Den blok er startpunktet — klik på den for at vælge en trigger. Et workflow oprettet fra en skabelon åbner med sine blokke allerede på plads.

Hvert workflow har præcis én **trigger** øverst. Alt andet er en **komponent**, der gør noget. Tilføjer du en trigger nummer to, erstatter den den første, og sletter du den sidste, kommer den stiplede pladsholder tilbage.

Sådan tilføjer du blokke:

- **Triggeren** — klik på den stiplede pladsholderblok. Et panel med titlen **Add Trigger** åbner.
- **Alt andet** — klik **Tilføj komponent** i værktøjslinjen over lærredet. Det samme panel åbner, nu med titlen **Tilføj komponent**.

Begge paneler åbner med de blokke, de fleste workflows bruger, under **Popular**, efterfulgt af de øvrige indbyggede blokke. Under **OneUptime resources** klikker du på en ressource som **Incident** for at se, hvad du kan gøre med den; **Browse all resources** viser dem alle. Eller søg: skriv et par ord, fx `create incident`, så kommer det bedste match først. Tryk `/` for at hoppe til søgefeltet, piletasterne for at bevæge dig gennem resultaterne og **Enter** for at tilføje den fremhævede blok. Et klik på en blok tilføjer den.

En ny blok lander under den nederste blok på lærredet, og en ny trigger tager den gamles plads øverst. Den nye blok er markeret, og lander den uden for synsfeltet, ruller lærredet lige præcis langt nok til at vise den. Dens indstillinger åbner ikke af sig selv: klik på blokken, når du er klar til at sætte den op. Indtil dens påkrævede indstillinger er udfyldt, står der **Click to set up** på den. Træk blokkene, hvorhen du vil; lærredet snapper til et gitter undervejs. Blokkenes placering gemmes, så den næste, der kigger, ser den opstilling, du efterlod.

Ændringer gemmes automatisk. En pille i værktøjslinjen holder styr på det: **Saving…**, mens ændringen er undervejs, derefter **Gemt** — eller **Kunne ikke gemme**, hvis det ikke lykkedes. Der er ingen gem-knap og intet særskilt udgivelsestrin.

## Hvad der er på en blok

| Felt                            | Hvad det gør                                                                                                                                                                                                |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Identifier** (under **ID**)   | Det korte id, der står på blokken, for eksempel `log-1`. Det er sådan, andre blokke henviser til denne, så omdøber du det, ødelægger du alle de `{{local.components.…}}`-henvisninger, der peger på den. Blokkens overskrift er komponentens eget navn og kan ikke ændres. |
| **Indstillinger**               | Det, blokken skal bruge for at gøre sit arbejde — en URL, en Slack-kanal, en beskedtekst. Valgfrie felter er mærket **(Optional)**; alt andet er påkrævet. Indstillinger, der bruges sjældnere, er klappet sammen under **Flere felter**, hvis overskrift nævner dem og viser dem, der er udfyldt. |
| **Input**                       | Prikken på den øverste kant, hvor linjerne kommer ind fra tidligere blokke. Triggere har ingen — der kører ikke noget før dem.                                                                              |
| **Outputs**                     | Prikkerne langs den nederste kant, mærket lige over dem, hvor linjerne går ud til de næste blokke. Mange blokke har hver sit **Succes**- og **Fejl**-output, så du kan håndtere begge tilfælde.             |

## At forbinde blokke

Træk fra en prik i bunden af én blok ned til prikken øverst på den næste. Den linje, du tegner, afgør, hvad der kører bagefter.

- Forbinder du fra **Succes**, kører den næste blok kun, når den foregående lykkedes.
- Forbinder du fra **Fejl**, kører den næste blok kun, når den foregående fejlede.
- Forbinder du slet ikke et output, stopper den vej bare der.

Du kan forbinde ét output til flere blokke. De kører alle sammen — men én ad gangen, i én kø, ikke parallelt. Regn ikke med rækkefølgen mellem grenene, og gå ikke ud fra, at de overlapper i tid. Hver blok kører højst én gang pr. kørsel, så en løkke tilbage til en tidligere blok kører den ikke to gange.

## Konfiguration af en blok

Klik på en blok for at åbne dens indstillinger i en dialog (eller gå til den med **Tab**, og tryk **Enter**). Hver indstilling har den rigtige slags felt — tekstfelter, dropdowns, kodeeditorer, kontakter og så videre. Udfyld det, og klik **Gem**.

I den samme dialog finder du også:

- **Slet** — fjern denne blok.
- **Run just this step** — kør denne ene blok for sig selv, uden resten af workflowet. Værdier, den ellers ville have læst fra andre trin, kommer tomme igennem, og alt, hvad den sender, skriver eller sletter, sker for alvor.
- **Dokumentation**, **Inputs**, **Outputs** og **Returns** — referencekort over, hvad blokken forventer, og hvad den producerer.

De fleste tekstfelter tager imod variabler — det er sådan, data flyder fra én blok til den næste. I stedet for at skrive syntaksen i hånden kan du bruge værdivælgeren i editoren: den bygger en korrekt henvisning ud fra den blok og det felt, du vælger. Se [Workflow-variabler](/docs/workflows/variables).

## Tjek, mens du bygger

**Bygger** kontrollerer hele grafen, hver gang du ændrer noget, og melder tilbage i en pille i værktøjslinjen. Klik på pillen for at åbne **Problems with this workflow**, som lister hvert problem og hopper dig hen til den blok, der er skyld i det. På lærredet står der **Click to set up** på en blok, hvis påkrævede indstillinger stadig er tomme, og en blok med et andet problem får et mærke i hjørnet: rødt for en fejl, ravgult for en advarsel. Hold musen over mærket for at læse, hvad der er galt.

Den fanger de fejl, der ellers er usynlige, indtil en kørsel går galt — ingen trigger, to blokke der deler id, et punktum inde i et id, en blok som intet forbinder til, en påkrævet indstilling der står tom, ugyldig JSON, mellemrum inde i `{{ }}` og henvisninger til et trin eller en returværdi, der ikke findes.

Én ting kan den ikke tjekke: om et variabelnavn findes. En omdøbt variabel dukker først op i kørselsloggen.

## Dit første workflow

Den hurtigste måde at få fornemmelse for lærredet på:

1. Klik på den stiplede pladsholderblok, og klik derefter **Manual** i panelet **Add Trigger**.
2. Klik **Tilføj komponent**, og klik derefter **Log** under **Popular**. Den nye blok lander under triggeren. Forbind triggerens **Execute**-prik ned til Log-blokkens input-prik.
3. Klik på Log-blokken, hvor der står **Click to set up**, og sæt dens **Værdi** til `Hello from {{local.components.manual-1.returnValues.value.name}}`. `manual-1` er triggerens **Identifier**, som står på trigger-blokken — tjek, at det passer.
4. Slå **Aktiveret** til øverst i Bygger. Et deaktiveret workflow kan slet ikke køres, heller ikke i hånden; springer du dette trin over, spørger **Kør arbejdsgang** først, om det skal slås til.
5. Tilbage på **Bygger** klikker du **Kør arbejdsgang**, skriver `{ "name": "Ada" }` i feltet **JSON**, klikker **Run Workflow Manually** og bekræfter med **Run**.
6. Et **Workflow Run**-panel åbner af sig selv og følger kørslen. Loggen viser `Value:` efterfulgt af `Hello from Ada`.

Den cyklus — tilføj, forbind, konfigurer, kør, læs loggen — er sådan, du bygger hvert eneste workflow.

## Sådan slår du det til

Nye workflows starter deaktiveret, og det samme gør ethvert workflow, du duplikerer eller importerer. Så længe et workflow er slået fra, siger Bygger det over lærredet, med en knap **Slå arbejdsgang til**.

Kontakten **Aktiveret** sidder øverst i **Bygger**, ved siden af **Tilføj komponent** og **Kør arbejdsgang**. Den findes også på workflowets side **Oversigt**: klik **Rediger arbejdsgang** på kortet **Arbejdsgangsdetaljer**, som viser den aktuelle tilstand som en grøn **Aktiveret**- eller rød **Deaktiveret**-pille. Kun dem, der må redigere workflowet, kan slå det til eller fra; alle andre ser kontakten nedtonet.

Et deaktiveret workflow kan slet ikke køre: dets trigger ignoreres, og det samme gør **Kør arbejdsgang** og **Run just this step**. Kører du det, eller en af dets blokke, mens det er slået fra, spørger Bygger i stedet **Slå denne arbejdsgang til?**. **Slå til og kør** (eller **Slå til og kør trin**) slår workflowet til og kører derefter det, du bad om, med de værdier, du gav. Så rækkefølgen er: byg det, test det med **Kør arbejdsgang**, læs kørselsloggen, og slå **Aktiveret** fra igen, hvis du ikke er klar til, at triggeren fyrer. Vil du teste en enkelt blok uden at køre det hele, bruger du **Run just this step** i den bloks indstillinger.

Alt andet, der starter et deaktiveret workflow, afvises med samme råd. Et kald til dets webhook-URL får HTTP 400 og "This workflow is turned off, so it can't run. Turn it on with the Enabled switch at the top of its Builder, then try again." En **Execute Workflow**-blok, der kalder det, tager sin **Error**-vej, og fejlen nævner det workflow, den kaldte.

Vil du sætte et workflow på pause uden at slette det, slår du **Aktiveret** fra. Der starter ingen nye kørsler. En kørsel, der er midt i det, gør sig færdig, men en, der er parkeret på en **Sleep**-blok, bliver annulleret, når den vågner, og registreret som en fejl.

## Ryd op

- Træk i blokkene for at flytte dem. Layoutet gemmes.
- En linje sletter du ved at trække en af dens ender af prikken og slippe den på tomt lærred.
- En blok sletter du ved at klikke på den og bruge **Slet** nederst i dens indstillingsdialog. Du kan også markere en blok eller en linje og trykke Backspace.
- Der er ingen måde at duplikere en enkelt blok på. **Duplicate Workflow** på workflowets side **Indstillinger** kopierer det hele, og kopien lander deaktiveret.
- Stabl blokkene fra top til bund, så de læses i den retning, de kører — input sidder på den øverste kant, output på den nederste, så flowet naturligt går nedad.

## Hvor du kan læse videre

- [Workflow-triggere](/docs/workflows/triggers) — de fire måder et workflow kan starte på.
- [Workflow-komponenter](/docs/workflows/components) — alle de blokke, du kan tilføje.
- [Workflow-variabler](/docs/workflows/variables) — sådan flytter du data mellem blokke.
- [Workflow-kørsler](/docs/workflows/runs-and-logs) — sådan tjekker du, hvad der skete.
