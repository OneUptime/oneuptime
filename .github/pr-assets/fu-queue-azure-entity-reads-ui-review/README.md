# UI review of reading Azure queues through a cloud connection (#6373)

How these were made: a queue's REAL Overview page and Cloud > Connect page, bundled with the
Dashboard's own esbuild config and rendered in headless Chromium, 2x. The data are fixtures: the
Service Bus queue `orders` of the namespace `acme-orders-prod`, read by the cloud connection
"Contoso production" (and "Contoso staging"), or by the collector's `azure_monitor` receiver.
Queue images are cropped to the Broker metrics card (or the Broker health section); the width in
the name is the viewport's. The builder's images in `../queue-azure-entity-reads` show the card
before this review.

The queue's Broker metrics card:

- `after-connection-open-en-1280.png`: a queue only the connection reads, metrics unfolded. The
  summary's "6 of 12" is now explained under it: the 6 metrics marked Collector only need the
  collector's receiver. Each Collector only row says it once: only the receiver reads it, and the
  line that adds it.
- `after-two-connections-en-1280.png`: two connections read the queue: "your cloud connections".
- `after-both-en-1280.png`: the receiver and the connection read it: the connection skips the
  metrics the receiver reads. Three metrics missing: the receiver's lines.
- `after-connection-one-missing-de-390.png`: one metric the connection reads does not arrive, in
  German on a phone: "this metric", not "these", and an Open Cloud > Connect link.
- `after-connection-stopped-namespace-en-1280.png`: a connection read the namespace and nothing
  arrives now: its last read and the role, no advice to connect what is already connected.
- `after-nothing-fa-768-dark.png`: nothing reads the namespace, in Persian, dark: Connect an Azure
  subscription comes first among the links.
- `after-others-below-cap-en-1280.png`: the connection read 3 other queues, far below its cap of
  1,000: the queue is likely gone or renamed, not cut off.
- `after-totals-connection-en-1280.png`: the connection sent totals only: Open Cloud > Connect,
  and no collector configuration link.
- `after-guidance-en-390.png`: nothing ever arrived: Connect an Azure subscription, the queue's
  setup, then the guide.

Cloud > Connect:

- `after-connect-warnings-en-1280.png`: a read that worked but left something out says how many
  warnings, under when it was read.
- `after-connect-warnings-dialog-en-1280.png`: the warnings, opened.
- `after-connect-warnings-dialog-fa-390-dark.png`: the same in Persian on a phone, dark.
