# Self-Hosting Guide

Follow this page from top to bottom to go from an empty server to your own OneUptime that runs on HTTPS, has sent you a test email and can page you. Each step ends with how to tell it worked, and links to the longer pages for the detail.

:::cards
- [Install OneUptime](#install-oneuptime): Docker Compose on one server, or the Helm chart on Kubernetes.
- [Finish setting up the server](#finish-setting-up-the-server): Email, then SMS and calls, each with a test.
- [Check your installation](#check-your-installation): One command that names what is wrong.
- [Quickstart](/docs/introduction/quickstart): Your first monitor, on-call policy and status page.
:::

## What you need

- **A server.** For Docker Compose, a Linux server with 8 GB of memory, 4 cores and 20 GB of disk to try OneUptime, or 16 GB, 8 cores and 400 GB for a team: see [Sizing & Capacity Planning](/docs/installation/sizing). For the Helm chart, a Kubernetes cluster.
- **A domain name** people will use to open OneUptime, such as `oneuptime.example.com`, with a DNS `A` record that points at the server. You can start with the server's IP address, but a certificate from Let's Encrypt needs a domain name.
- **Ports 80 and 443** reachable from the internet, for HTTPS.
- **A way to send email**: a mail server, such as your company's, Microsoft 365 or Google Workspace, or an account with Amazon SES, SendGrid, Mailgun, Postmark or Resend.
- **A Twilio account**, to be paged by SMS and phone call. Email and push notifications need none.

**It worked when** `dig +short oneuptime.example.com` prints the server's IP address.

## Install OneUptime

:::tabs
@tab Docker Compose
On a new Ubuntu, Debian or RHEL-based server, one command installs Docker, Git and Node.js where they are missing, clones OneUptime into a `oneuptime` folder, asks for the address people will use and starts it:

```bash
curl -fsSL https://oneuptime.com/install.sh | bash
```

To do the same by hand, with Docker, Git and Node.js installed:

```bash
git clone --depth 1 --single-branch --branch release https://github.com/OneUptime/oneuptime.git
cd oneuptime
cp config.example.env config.env
```

Open `config.env` and set `HOST`, its first setting, to your domain name or IP address, without `http://`. It is the only setting you must change: email, SMS and calls are set up in the Admin Dashboard, and everything under `ADVANCED` works as it is. Then start OneUptime:

```bash
npm start
```

**It worked when** `npm start` ends with **OneUptime is up!** and the address to open. The first start takes several minutes, while Docker downloads the images. If `npm start` stops before that, it says what to change. [Docker Compose](/docs/installation/docker-compose) has every detail.
@tab Kubernetes
Create a `values.yaml` with your domain name or IP address, without `http://`:

```yaml title="values.yaml"
host: oneuptime.example.com
```

The chart keeps its data on your cluster's default storage class. If `kubectl get storageclass` marks none as `(default)`, add `global.storageClass` with the name of one. Then install the chart:

```bash
helm repo add oneuptime https://helm-chart.oneuptime.com/
helm install my-oneuptime oneuptime/oneuptime -f values.yaml
```

**It worked when** `kubectl get pods` shows every pod `Running` and the address `helm install` printed opens OneUptime. The [chart's installation guide](https://github.com/OneUptime/oneuptime/blob/main/HelmChart/Public/oneuptime/docs/installation.md) has every detail.
:::

## Turn on HTTPS

Once your domain name points at the server, let OneUptime get a free certificate from Let's Encrypt. It renews the certificate itself.

:::tabs
@tab Docker Compose
Set these in `config.env`, then run `npm start` again:

```ini title="config.env"
HOST=oneuptime.example.com
PROVISION_SSL=true
HTTP_PROTOCOL=https
```

Already running a reverse proxy, such as Caddy, Nginx or a load balancer? Keep `PROVISION_SSL=false`, set `HTTP_PROTOCOL=https` and `TRUSTED_PROXY_HOPS=2`, and see [Use your own reverse proxy](/docs/installation/docker-compose#use-your-own-reverse-proxy).
@tab Kubernetes
Set these in `values.yaml`, then apply them:

```yaml title="values.yaml"
host: oneuptime.example.com
httpProtocol: https
ssl:
  provision: true
```

```bash
helm upgrade my-oneuptime oneuptime/oneuptime -f values.yaml
```

To end TLS at an ingress controller of your own instead, keep `ssl.provision` off and set only `httpProtocol: https`.
:::

**It worked when** `https://oneuptime.example.com` opens with no certificate warning. The first certificate usually arrives within a few minutes. Trying OneUptime on `localhost`? Skip this step: a certificate needs a domain name.

## Create the admin account

Open your address, such as `https://oneuptime.example.com`, and sign up. The first account on a new server becomes its master admin, who can open the Admin Dashboard at `/admin`.

**It worked when** `/admin` opens the Admin Dashboard. While email, HTTPS or the choice about sign-ups is still open, it opens on **Finish setting up this server**.

## Finish setting up the server

The Admin Dashboard's **Server Setup** page, at `/admin/setup`, lists what a new server needs, most important first. Email, HTTPS and who can sign up are required. SMS and calls, a global probe, backups and update checks are recommended. Each item has a button that opens the place where it is set, and `npm start` ends by printing this page's address.

:::steps
### Set up email

Click **Set up email**. It opens **Settings > Notifications > Emails**, where you enter your mail server (most use port `587`) or your email provider, and the address emails come from. Save, then click **Send test email** and send one to yourself.

**It worked when** the email arrives and the checklist marks Email as done. When the test fails, it shows what the mail server answered: see [SMTP](/docs/emails/smtp#troubleshooting).

### Choose who can sign up

Anyone who can open your address can sign up. Once your team has its accounts, turn off **Let people sign up** under **Settings > Authentication**: people you invite to a project can still join. To leave sign-ups open, click **Keep sign-ups open**.

**It worked when** the checklist marks Sign-ups as done.

### Set up SMS and calls, or use email and push only

To be paged by SMS and phone call, click **Set up SMS and calls** and add your Twilio account under **Settings > Notifications > Call and SMS**: [Twilio Integration](/docs/self-hosted/twilio-integration) shows where to find each value. Then click **Send test SMS** and **Make test call**. To send them through a gateway of your own instead, see [SMS and Call Gateway](/docs/self-hosted/sms-and-call-gateway). If email and push notifications are enough, click **Use email and push only**.

**It worked when** the SMS arrives and your phone rings, or the checklist shows your choice.
:::

The HTTPS item is done once [Turn on HTTPS](#turn-on-https) works, and each recommended item says what to do.

## Check your installation

:::tabs
@tab Docker Compose
In the `oneuptime` folder, run the doctor:

```bash
npm run doctor
```

It checks every container, `config.env`, that `HOST` reaches this server, the certificate and free disk, and asks OneUptime what it sees of itself, such as email and probes. Each problem comes with its fix: see [Check your installation](/docs/installation/docker-compose#check-your-installation).
@tab Kubernetes
Run the chart's diagnostics script against your cluster, as the [chart's troubleshooting guide](https://github.com/OneUptime/oneuptime/blob/main/HelmChart/Public/oneuptime/docs/troubleshooting.md#run-it) shows. It only reads, and it ends with a summary of what it found, worst first.
:::

**It worked when** the doctor ends with **Everything looks right.** and exits with `0`. It exits with `1` when something needs fixing, and with `2` when it could not run its checks. On Kubernetes, the summary has no `CRITICAL` finding.

## Monitor something and get paged

Your server can now email and page people. The [Quickstart](/docs/introduction/quickstart) goes on in the product: a monitor for your website, an on-call policy that pages you when it goes down, and a status page, in about fifteen minutes. Its last part declares a test incident, so you see the page arrive.

## Troubleshooting

:::details npm start stops and says HOST is not an address yet
`HOST` in `config.env` still holds a placeholder, such as `<your-address>`. Set it to your domain name or IP address, without `http://`, and run `npm start` again.
:::

:::details The test email fails
The message under the button is what the mail server answered. Check the host name, the port, the username and the password, and that the mail server lets you send from the address emails come from. See [SMTP](/docs/emails/smtp#troubleshooting).
:::

:::details The browser warns about the certificate
Let's Encrypt needs ports 80 and 443 reachable from the internet, and your domain name pointing at this server. Wait a few minutes, then run `npm run doctor`: it checks the certificate and says what is wrong.
:::

## Next steps

:::cards
- [Quickstart](/docs/introduction/quickstart): A monitor, an on-call policy and a status page in fifteen minutes.
- [Docker Compose](/docs/installation/docker-compose): Your own proxy, backups, updates and the production checklist.
- [Upgrading](/docs/installation/upgrading): Move to a new release, one major version at a time.
- [Architecture](/docs/self-hosted/architecture): How the parts of OneUptime fit together.
:::
