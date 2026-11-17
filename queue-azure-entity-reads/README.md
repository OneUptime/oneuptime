# A queue's Broker metrics card, read through an Azure cloud connection (#6373)

How these were made: the REAL Broker health section of a queue's Overview
(`MessageQueueBrokerHealthSection`, with its Broker metrics card), bundled with the
Dashboard's own esbuild config and rendered in headless Chromium with Inter, 2x. The props are
fixtures: a Service Bus queue `orders` (or an event hub `telemetry-ingest`) of the namespace
`contoso-prod`, read by the cloud connection "Contoso production". Each image is cropped to the
card. The width in the name is the viewport's.

- `after-connection-de-1280.png`: a Service Bus queue only the cloud connection reads, in German,
  with the supported metrics unfolded. The six metrics the connection reads arrive; the six only
  the collector's receiver reads are **Nur Collector** (Collector only), each with the line that
  adds it to the receiver, and the card stays healthy. The summary names what read the metrics,
  with the connection linked to Cloud > Connect.
- `after-connection-fa-390-dark.png`: the same in Persian on a phone, dark.
- `after-both-en-1280.png`: read by the collector's receiver and the connection: where both read a
  metric, the receiver's is kept.
- `after-eventhubs-de-1024-dark.png`: an event hub only the connection reads: four of seven arrive,
  three are Collector only.
- `after-totals-en-1280.png`: the connection sent only the namespace's totals; the fix points at the
  connection's last read on Cloud > Connect.
- `after-cap-de-768-dark.png`: other queues of the namespace arrive, not this one, all from the
  connection: its cap of 1,000 queues and topics a namespace, and what to do past it.
- `after-nothing-fa-1280-dark.png`: nothing from the namespace, in Persian: connect the
  subscription or run the receiver, the Monitoring Reader role, and where to look.
- `after-guidance-en-1280.png`: nothing ever arrived and nothing says why: the setup guidance,
  with Connect an Azure subscription beside the guide and the queue's setup.
