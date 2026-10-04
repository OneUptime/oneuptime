# Eskaleringsregler

En jourpolicy larmar personer i nivåer. Varje eskaleringsregel är ett nivå: vem som larmas och hur länge man väntar på att någon kvitterar innan nästa nivå larmas. En policys regler står i ordning på dess sida **Eskaleringsregler**.

## Vem som larmas först

När du skapar en jourpolicy på sidan **Jourpolicyer** frågar formuläret efter dess **Namn** och **Vem larmas först?**. Frågan använder samma väljare som **Avisera**: jourscheman, team och personer, så många du behöver. De du väljer blir policyns första eskaleringsregel, **Level 1**, som väntar **30 minuter** på en kvittering innan nästa nivå larmas. Den nya policyn öppnas sedan på sin sida **Eskaleringsregler**, där du kan lägga till fler nivåer.

**Vem larmas först?** är valfritt. Lämnar du det tomt startar policyn utan eskaleringsregler: den larmar ingen förrän du lägger till en, och dess översikt säger det. Beskrivningen och etiketterna finns under **Avancerad**. Frågan ställs bara till den som får lägga till eskaleringsregler.

## Lägg till en eskaleringsregel

Öppna jourpolicyn, välj **Eskaleringsregler** i sidomenyn och klicka på **Lägg till eskaleringsregel**. Dialogen är en kort sida med två frågor:

- **Avisera** — vem som larmas på den här nivån. En väljare omfattar jourscheman, team och personer: klicka på **Lägg till mottagare**, sök och välj så många du behöver. Minst en krävs.
  - Ett **jourschema** larmar den som har jour när nivån körs, inte en fast person.
  - Ett **team** larmar varje medlem i teamet.
  - En **person** larmas direkt.
- **Eskalera efter (i minuter)** — hur länge man väntar på en kvittering innan nästa nivå larmas. Den börjar på **30 minuter**; ändra den så att den passar nivån.

Allt annat ligger under **Avancerad**, hopfällt tills du öppnar det:

- **Namn** — valfritt. En regel utan namn heter som sin nivå: den första regeln i en policy är **Level 1**, den andra **Level 2** och så vidare. Namnfältet visar namnet regeln får.
- **Beskrivning** — valfria anteckningar, till exempel vem nivån larmar och varför.

Rubriken för **Avancerad** visar **Konfigurerat** när regeln har en beskrivning eller ett eget namn.

## Så larmar nivåerna personer

När en incident eller ett larm når policyn larmar **Level 1** sina mottagare direkt. Om ingen kvitterar inom väntetiden larmas **Level 2**, och så vidare nedåt i listan. När den sista nivåns väntetid har gått utan kvittering börjar policyn om från **Level 1** om dess **Upprepningspolicy** (under reglerna) säger att den ska upprepas, så många gånger den tillåter, och annars slutar den.

Översikten högst upp på sidan **Eskaleringsregler** visar hela stegen: när varje nivå larmas, vem den larmar och vad som händer efter den sista. En nivå där inte alla mottagare kan larmas säger det på sitt kort; klicka på etiketten för att se vem och varför.

## Redigera, ordna om och ta bort regler

- **Edit rule** öppnar samma dialog på en sida, ifylld med regeln som den är: dess mottagare, dess väntetid och dess namn och beskrivning under **Avancerad**. Lägg till eller ta bort mottagare och spara. Tömmer du namnet får regeln sin nivås namn igen.
- **Move up** och **Move down** i en regels **⋯**-meny ändrar dess nivå. En regel som heter som sin nivå behåller ett namn som passar dess plats: när **Level 3** flyttas upp förbi **Level 2** byter de två namn. Ett namn du själv valt, som **Managers**, förblir detsamma vart regeln än flyttas.
- **Delete rule** frågar först och berättar vem nivån larmar. Tar du bort en nivå flyttas nivåerna under den upp, och regler som heter som sin nivå byter namn så att de stämmer.

## Skapa regler med API:et eller Terraform

Eskaleringsregler är resursen `/api/on-call-duty-policy-escalation-rule`; de personer, team och scheman som en regel larmar är resurserna `/api/on-call-duty-policy-escalation-rule-user`, `-team` och `-schedule`.

- En regel som skapas utan `name` får namn efter sin nivå, precis som i instrumentpanelen: **Level 3** för en regel som blir den tredje nivån i sin policy. Terraform-resursen för eskaleringsregler kräver fortfarande ett namn.
- `escalateAfterInMinutes` har inget standardvärde utanför instrumentpanelen. En regel som skapas utan det väntar inte: nästa nivå larmas så snart den här har körts. Ange det uttryckligen — instrumentpanelen föreslår 30.
- Regler som heter som sin nivå byter namn när du flyttar eller tar bort regler i instrumentpanelen. Att ändra `order` via API:et eller Terraform ändrar bara ordningen.
- Skapas en jourpolicy via `/api/on-call-duty-policy` med `onCallSchedules`, `teams` eller `users` (listor med id:n) i dess `miscDataProps` får den sin första eskaleringsregel, precis som i instrumentpanelen: **Level 1**, som larmar dem, med en `escalateAfterInMinutes` på 30. Varje id måste höra till projektet och anroparen måste få skapa eskaleringsregler, annars skapas inte policyn. En policy som skapas utan dem har inga regler, som tidigare; Terraform-resursen för policyer skickar dem inte.
