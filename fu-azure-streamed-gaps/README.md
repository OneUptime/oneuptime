# Streamed Azure metrics: before and after

Screenshots for the pull request that answers #6409. Each
`<name>-before.png` is main at b7eec1a5891, each `<name>-after.png` this
branch.

- `streaming-*` is the docs page Stream Azure Monitor Metrics and Logs
  (`/docs/<language>/telemetry/cloud-streaming-azure`), and `queues-*` the
  Queues page's Service Bus receiver note
  (`/docs/<language>/telemetry/queues`). Both were rendered by the docs'
  own routes and templates (as RightToLeftDocs does), saved, served
  statically and shot in Chromium at 2x:
  - `streaming-what-arrives-*`: the What arrives section now lists, type by
    type, the key metrics a diagnostic setting cannot send, which the reads
    keep writing, and says a Service Bus or Event Hubs namespace streams no
    metrics. A list, not a table: a table cell cannot break a code name, so
    at 390px a table of them scrolled inside its frame (23px in English,
    54px in German) and cut names off.
  - `streaming-how-it-works-*` and `streaming-choose-step-*`: the bullet and
    the step say the reads keep writing what the stream cannot carry, and
    link to that list.
  - `queues-receiver-note-*`: the receiver note says a streaming
    subscription keeps reading a namespace's metrics, and how the
    namespace's page and its queues each count a message once.
- `dialog-what-to-stream-*` is Cloud > Connect's Stream metrics and logs
  dialog for an Azure connection, its first question, from the repo's
  offline fixture (`packages/E2E/CloudConnect`, `?state=connected`), at 1x:
  the Metrics answer no longer promises every key metric of every resource.

Widths: 1280 (English), 390 in the dark theme (German), 768 (Persian).
