# Security Events sources: Your logs, Your OneUptime data, the Entra ID form - UI review

These images show the UI review of the Security Events sources follow-ups (PR #5709). Each one is
the real production Connections page or Add connection dialog, rendered offline by the Security
Events empty states fixture in `packages/E2E`, on synthetic data for a made-up "Acme Commerce"
workspace: every name, domain and address is fabricated. Captured with the fixture's clock
(2026-09-22 12:00 UTC), in Inter, as production draws it; the 1280 images of the two cards at 2x,
the rest at 1x.

## Before and after

The `-before` images are the branch before the review, the `-after` images after it, on the same
page, size and data.

- `your-logs-1280-before.png` / `-after.png`: the Your logs card with Your logs on. Before, the
  four groups sat in a grid's rows, and Security devices' five kinds left half a card of nothing
  beside Applications' two. After, they flow down two columns, each whole, ending near each
  other; Open cases from is described in one line, in the same size as the switch's description.
- `your-logs-390-before.png` / `-after.png`: the same card on a phone. Open cases from's
  description is three lines instead of five.
- `your-logs-dark-1280-after.png`: the card in the dark theme, every kind in its state of health.
- `open-cases-from-fr-1280-before.png` / `-after.png` and `open-cases-from-ru-390-before.png` /
  `-after.png`: Open cases from with Never picked, in French and in Russian. Before, "Never - keep
  them as events only" was cut after its second word ("Jamais - les garder comme...",
  "Никогда - хранить только..."), and the description listed the formats in a dashed aside.
  After, "Never - events only" reads whole in every language, and the description names the
  Security devices group listed under it.
- `your-oneuptime-data-1280-before.png` / `-after.png`: Your OneUptime data with no cloud account
  connected. The Cloud audit logs row says so in one sentence before the Connect a cloud account
  link ("Connect one under Cloud" said it twice), and its description is shorter.
- `cloud-audit-on-no-account-before.png` / `-after.png`: Cloud audit logs turned on with no cloud
  account. Before, the row promised a first read with the cloud accounts' next read, which has
  nothing to read; after, it only says what is missing.
- `your-oneuptime-data-de-1280-before.png` / `-after.png` and
  `your-oneuptime-data-fa-390-before.png` / `-after.png`: the card in German and in Persian.
  Before, its title, the Audit log row and four rows' descriptions were English in every
  language (right-aligned English in Persian); after, all of it is translated.
- `your-oneuptime-data-dark-1280-after.png`: Cloud audit logs read in the dark theme: when, what
  the last read found, and the count read aloud as a sentence of its own.
- `entra-id-polling-step-before.png` / `-after.png`: the Microsoft Entra ID connection's last
  step. Background and app sign-ins names the two lists by the Entra admin center's own words.

## Looked at and kept

- `entra-id-connection-step-cloud.png`: Cloud under More fields on the Connection step, as the
  SIEM destination form folds it.
- `entra-id-test-checklist.png`: Test these settings with the new Read risk detections check.
- `check-a-log-line-examples-1280.png`: the wide examples menu, every kind on one line.
