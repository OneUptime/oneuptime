# Data Observability layout screenshots

Before and after frames for three Data Observability issues:

- #6555: a card's body was padded again inside the card's own padding, so what
  a card holds started 24px in from its title (and 24px short of its right
  edge, 24px over its bottom).
- #6851: on a Lineage drawing's card, the second chip ran past the card's edge
  and was cut in the middle of a word in German, Dutch, Russian and Japanese.
- #6779: pressing Tab onto a Lineage card outside the drawing scrolled the
  drawing's pane instead of moving the drawing, so the card stayed cut off.

Rendered from the real pages and components in headless Chromium at a 2x
device pixel ratio, with the Dashboard's Tailwind build, `Theme.css` and
Inter. The "before" frames come from an untouched copy of main served the same
way, not re-implemented. The Overview is the product onboarding fixture
(`packages/E2E/ProductOnboarding`, the busy project). The alert's cards and
every Lineage drawing are the event overview fixture
(`packages/E2E/EventOverview`, alert #311, `?data=table`, with
`&check=column`, `&cause=pipeline` or `&state=ongoing` where named). A
database's and a table's page are the real `View/Overview` and
`TableView/Overview` pages mounted with the outlet context their layouts hand
them. Every record in them is made up.

| File | Shows |
| --- | --- |
| `overview-1280-before.png` | The Overview at 1280px: Needs Attention's rows, Recent Schema Changes' row and the Databases list start 24px right of their card's title. |
| `overview-1280-after.png` | The same: every row starts under its title's first letter and reaches the card's right padding, so the Databases list has room for its table counts beside the names. |
| `overview-390-before.png` | The Overview on a phone: each list 48px narrower than its card leaves room for. |
| `overview-390-after.png` | The same rows under their titles, as wide as the card leaves them. |
| `database-1280-before.png` | A database's page: Collection's status and Alerts' two sentences start 24px right of their titles, over 24px of empty card at the bottom. |
| `database-1280-after.png` | Both flush with their titles. The facts card at the top was already right and is unchanged. |
| `database-390-before.png` | The same page on a phone: Collection and Alerts 24px in from their titles and 24px taller than they need. |
| `database-390-after.png` | Flush with the titles, each card 24px shorter. |
| `table-1280-before.png` | A table's page: Details, dbt and Description hold their facts 24px in from their titles. |
| `table-1280-after.png` | Every body under its title's first letter. |
| `alert-data-390-before.png` | An alert's Data card on a phone: About, Caused Upstream, Written By and Changes Around It start 24px right of "Data". |
| `alert-data-390-after.png` | The same, flush with "Data", and the card 44px shorter. |
| `alert-lineage-1280-before.png` / `-after.png` | An alert's Lineage card at 1280px (`&check=column`): the summary, column picker, notes, drawing and key move under "Lineage". |
| `alert-lineage-390-before.png` | The Lineage card on a phone: the column picker cuts "provider_reference" ("provider_referen..."). |
| `alert-lineage-390-after.png` | The picker 48px wider shows the whole name; the drawing is 48px wider too. |
| `lineage-chips-de-1280-before.png` | The alert's Lineage drawing in German (`&cause=pipeline&lang=de`): "1 offener Alarm" on the alert's own card runs 8px past the card and is cut at its edge. |
| `lineage-chips-de-1280-after.png` | The chip ends in "..." inside the card; the whole words are under the pointer and in the card's name read aloud. |
| `lineage-chips-nl-1280-before.png` / `-after.png` | Dutch: "1 open waarschuwing" ran 62px past the card; now "1 open ..." inside it. |
| `lineage-chips-ru-1280-before.png` / `-after.png` | Russian: both cards' second chips ran past (68px and 24px); now both end in "..." inside their cards. |
| `lineage-chips-ja-1280-before.png` / `-after.png` | Japanese: 17px past the card; now inside it. |
| `lineage-chips-nl-390-before.png` / `-after.png` | Dutch on a phone, at the drawing's least zoom: the same chip, cut before, inside the card after. |
| `lineage-chips-nl-open-alert-1280-before.png` | While alert #311 is open (`&state=ongoing`), its own card says "Deze waarschuwing" and "1 open waarschuwing" - the one open alert is the alert itself - and the second chip is cut. |
| `lineage-chips-nl-open-alert-1280-after.png` | The count that is only the alert itself is left out, so the card says "Deze waarschuwing" and "Vers" (fresh), both whole. |
| `lineage-chips-ru-open-alert-1280-before.png` / `-after.png` | The same in Russian: "Это оповещение" and "Свежая", both whole. |
| `lineage-keyboard-390-tab1-before.png` | On a phone, Tab onto the alert's own card: the card stays cut at the drawing's right edge. |
| `lineage-keyboard-390-tab1-after.png` | The drawing moves until the focused card is inside it, with its focus ring. |
| `lineage-keyboard-390-tab2-before.png` | Tab again, onto the cause's card: it is outside the drawing, only its right border showing. |
| `lineage-keyboard-390-tab2-after.png` | The drawing moves the other way and the cause's card is whole; the zoom buttons stay where they were. |
