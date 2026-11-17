# Stream CloudWatch metrics and logs

How these were made: the offline Cloud Connect suite (`packages/E2E/CloudConnect`,
`npm run test-cloud-connect-ui`) renders the real Cloud > Connect page, the real streaming dialog
and the real cloud resource pages, bundled with the Dashboard's esbuild config, Tailwind, theme and
Inter, with the API answered from an in-page store. `?https=1` serves the page as a OneUptime on
`https://oneuptime.example.com` (Firehose delivers to HTTPS only), and `?stream=` sets the AWS
connection streaming. Chromium, 1280x900 (one at 390px, 2x). They are not screenshots of a running
stack. There is no "before": streaming is new.

- `stream-list-desktop.png`: Cloud > Connect with the AWS account streaming. Its row's Status says
  "Streaming" under how it is read; the tooltip says when the last delivery came.
- `stream-dialog-desktop.png`: Stream metrics and logs, from the row's menu. One question (what to
  stream), then the guide's three steps: make a stream key, run one command in AWS CloudShell, wait
  for the first delivery. The command waits for its key.
- `stream-key-made-desktop.png`: the key made. The command now holds it, and it is shown only here.
- `stream-logs-desktop.png`: Metrics and logs, with two log groups named in the Region beside.
- `stream-more-fields-desktop.png`: More fields: every metric (and what it costs), the Regions, and
  the endpoints for setting the streams up another way.
- `stream-receiving-desktop.png`: the first delivery arrived: what came from where, and Done.
- `stream-refused-desktop.png`: a delivery refused for a wrong key, with what to do.
- `stream-stop-desktop.png`: Stop streaming asks first and hands over the command that deletes the
  stacks.
- `stream-function-menu-desktop.png`: a Lambda function's page in Cloud gains Logs after Metrics.
- `stream-dialog-phone.png`, `stream-dialog-dark-de-desktop.png`, `stream-dialog-fa-desktop.png`:
  the dialog at 390px, dark in German, and in Persian, laid out right to left.
