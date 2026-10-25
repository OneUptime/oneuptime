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

## After the UI review

The shots above are the pages as first built. `review-*.png` are the same
pages after the UI review, from the same fixture at production widths (1x,
light unless `-dark`):

- `review-entity-risk-1280.png`: the list opens on the riskiest, How entity
  risk works folded to its title row; each entity drawn as the chip Security
  Events draws an entity with. `review-entity-risk-390.png`: a phone's cards,
  the risk under each entity.
- `review-entity-1280.png`, `review-entity-1280-dark.png`,
  `review-entity-1024.png`, `review-entity-390.png`: an entity's page laid out
  as a case's - its kind and criticality, the entity as the title, Open in
  Correlate and Search Its Events at the right, the trail naming the entity;
  its activity in three figures of the week. `review-entity-more-1280.png`:
  Reset Risk under the header's ⋯.
- `review-risk-case-1280.png`: the case an entity's risk opened, in plainer
  words. `review-not-named-1280.png`: a page that names no entity, with its
  way to Entity Risk. `review-criticality-edit.png`: Entity Criticality's
  form, its optional fields without a second "Optional.".
