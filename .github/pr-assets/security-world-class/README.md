# Entity risk: screenshots

Shots for the pull request that adds entity risk (risk-based alerting) to
Security Events, from the offline SecurityOperations fixture
(`packages/E2E/SecurityOperations`, `Fixture/EntityRiskFixture.js`) on its
synthetic week, at 1x and 1280 pixels wide unless named otherwise (390 for a
phone, 1344 for a case's Entities with its Risk column), light unless
`-dark`.

- `entity-risk-*.png`: Security Events > Events > Entity Risk, the riskiest
  first, with the How it works card open; `entity-risk-cases-off-1280.png` is
  a project that opens no case from risk (`?riskcases=off`), with the note
  above the list.
- `entity-*.png`: an entity's page. `entity-1280.png` and `entity-390.png`
  are k.morgan, marked Extreme (100 from its sources × 2 = 200, Critical);
  `entity-1280-dark.png` is 203.0.113.47 (125, High).
- `risk-scoring-*.png`: Settings > Risk Scoring, the Risk Cases switch, the
  Risk Threshold and Entity Criticality. The 1280 shot is 1200 pixels tall,
  so the side menu shows Risk Scoring without scrolling it.
- `case-entities-*.png`: a case's Entities with each entity's risk.
- `risk-case-*.png`: the case a.ng's risk opened (`?riskcase=1`), and its
  detection from Entity Risk, rule "Risk threshold".
- `rule-risk-points-1280.png`: a detection rule's Risk Points, under More
  fields on its On Match step.

The offline suite takes the same pages at 2x, at 1280, 1024, 768 and 390 in
both themes (`entity-risk-*` and `risk-scoring-*`).
