# Stream Azure Monitor metrics and logs, and Google Cloud logs

How these were made: the offline Cloud Connect suite (`packages/E2E/CloudConnect`,
`npm run test-cloud-connect-ui`) renders the real Cloud > Connect page, the real streaming dialogs
and the real cloud resource pages, bundled with the Dashboard's esbuild config, Tailwind, theme and
Inter, with the API answered from an in-page store. `?https=1` serves the page as a OneUptime on
`https://oneuptime.example.com` (Pub/Sub pushes to HTTPS only); `?azurestream=` and `?gcpstream=`
set the Azure and Google Cloud connections streaming, as `?stream=` does AWS's. Chromium,
1280x900 (two at 390px, 2x). They are not screenshots of a running stack. There is no "before":
streaming Azure and Google Cloud is new.

- `stream-clouds-list-desktop.png`: Cloud > Connect with all three clouds streaming. Each row's
  Status says how its stream is doing in its own cloud's words: AWS's is streaming, Azure's event
  hubs could not be read ("Stream failing"), and Google Cloud's waits for its first push.
- `stream-azure-dialog-desktop.png`: Stream metrics and logs, from the Azure row. One question
  (what to stream), then three steps: turn on reading, run one command in Azure Cloud Shell, wait
  for the first events. Its last read reached no subscription, so the subscriptions were typed
  under More fields; the first holds the event hubs.
- `stream-azure-reading-desktop.png`: reading turned on: OneUptime reads the event hubs in that
  subscription every minute, and waits for them until the command has made them.
- `stream-azure-receiving-desktop.png`: the first events: metrics of three resource types from
  westeurope, logs of two categories from northeurope, and Done.
- `stream-azure-failing-desktop.png`: event hubs the connection's app may not read, and what to do.
- `stream-azure-stop-desktop.png`: Stop streaming asks first, and hands over the command that
  deletes every diagnostic setting, then the event hubs' resource group.
- `stream-gcp-dialog-desktop.png`: Stream logs, from the Google Cloud row: which logs (warnings
  and errors at first), then three steps: make a stream key, run one command in Google Cloud Shell,
  wait for the first push. The connection is turned off, and the dialog says what that means.
- `stream-gcp-key-made-desktop.png`: the key made, in the command; More fields gives the push
  endpoint, the push service account and the key as the token's audience, for setting it up
  another way.
- `stream-gcp-filter-desktop.png`: a filter of one's own, in the Cloud Logging query language.
- `stream-gcp-receiving-desktop.png`: the first push: entries of three logs from europe-west1, of
  project acme-prod.
- `stream-gcp-refused-desktop.png`: a push whose token Google did not sign for the connection's
  push service account, and what to do.
- `stream-gcp-stop-desktop.png`: Stop streaming, with the command that deletes the sinks, the
  subscription, the topic and the push service account.
- `stream-azure-web-app-menu-desktop.png`: an Azure web app's page gains Logs after Metrics (a
  virtual machine's and an instance group's do not).
- `stream-azure-dialog-phone.png`, `stream-gcp-key-made-phone.png`: the dialogs at 390px.
- `stream-azure-dialog-dark-de-desktop.png`, `stream-gcp-dialog-fa-desktop.png`: the Azure dialog
  dark in German, and the Google Cloud dialog in Persian, laid out right to left with the command
  and the filter left to right.
