# Jourscheman

Ett jourschema avgör vem som har jour vid varje tidpunkt. Personerna i det turas om: var och en har jour en tid, sedan tar nästa över. Lägg till ett schema i eskaleringsreglerna i en jourpolicy, så larmar policyn den som har jour i schemat när den nivån körs.

## Vilka som turas om

När du skapar ett schema på sidan **Jourscheman** frågar formuläret efter **Namn** och **Vilka turas om?**. Klicka på **Lägg till användare** och välj personerna i den ordning de turas om: de har jour en i taget, och den första har jour så snart schemat har skapats. De blir schemats första lager, **Layer 1**, med jour dygnet runt. Det nya schemat öppnas sedan på sidan **Lager**, där du kan ändra rotationen eller lägga till fler lager.

**Vilka turas om?** är valfritt. Lämnar du det tomt börjar schemat utan lager: det sätter ingen på jour förrän du lägger till ett lager på sidan **Lager**. Frågan ställs bara till den som får lägga till lager.

Allt annat ligger under **Avancerad**, hopfällt tills du öppnar det:

- **Varje pass varar**: **1 dag**, **1 vecka**, **2 veckor** eller **1 månad**, och **1 vecka** om du inte ändrar det. Det frågas efter så snart någon har valts. Varje person har jour så länge, sedan tar nästa över, vid den tid på dygnet då schemat skapades.
- **Tidszon**: den tidszon som överlämningstider och jourtimmar gäller i. Den börjar som din egen.
- **Beskrivning** och **Etiketter**.

Så länge någon har valts och inget under **Avancerad** har ändrats säger den hopfällda rubriken vad som kommer att hända: varje person har jour i en vecka, sedan tar nästa över.

## Lager

Ett schemas rotation består av lager, på sidan **Lager**. Lagren läses uppifrån och ned: det översta lagret med någon på jour är det som larmar, så lägg huvudrotationen överst och reservtäckningen under.

**Lägg till lager** lägger till ett lager som börjar som det första: jour från och med nu, varje person i en vecka, dygnet runt. Fäll ut ett lager för att lägga till personer och ändra när det börjar, hur ofta det lämnar över, när det lämnar över första gången och vilka timmar det har jour.

## Skapa scheman med API:et eller Terraform

Jourscheman är resursen `/api/on-call-duty-policy-schedule`; deras lager och personerna i dem är resurserna `/api/on-call-duty-schedule-layer` och `/api/on-call-duty-schedule-layer-user`.

- Att skapa ett schema med `firstLayerUsers` (en lista med användar-id:n i den ordning de turas om) i dess `miscDataProps` ger det sitt första lager, som instrumentpanelen gör: **Layer 1**, jour från och med nu, dygnet runt. `firstLayerRotation` anger hur länge varje pass varar, som en rotation som `{"_type": "Recurring", "value": {"intervalType": "Week", "intervalCount": 1}}`; utan den en vecka. Varje användare måste vara medlem i projektet och anroparen måste få skapa lager, annars skapas inte schemat.
- Ett schema som skapas utan dem har inga lager, som tidigare; Terraforms schemaresurs skickar dem inte.
- Ett lager som skapas utan `rotation` lämnar över dagligen, som det alltid har gjort.
