## Haraka - a Node.js Mail Server

Haraka is a highly scalable [node.js][1] email server with a modular
plugin architecture. Haraka can serve thousands of concurrent connections
and deliver thousands of messages per second. Haraka and plugins are written
in asynchronous JS and are very fast.

Haraka has a scalable outbound mail delivery engine built in. Mail
marked as `relaying` (such as via an `auth` plugin) is automatically
queued for outbound delivery.

### Installing Haraka

Haraka requires [node.js][1] to run. Install Haraka with npm:

```sh
# If the second command gives "nobody" errors, uncomment & run the next command
# npm -g config set user root
npm install -g Haraka
```

### Configure Haraka

To choose which plugins run, edit `config/plugins`. Plugins control the
overall behaviour of Haraka. By default, only messages to domains listed
in `config/host_list` will be accepted and then delivered via the
`smtp-forward` plugin. Configure the destination in `config/smtp_forward.ini`.

### Read the Fine Manual

```sh
haraka -h plugins/$name
```

The docs detail how each plugin is configured. After editing
`config/plugins`, restart Haraka and enjoy!

### Running from git

If you are unable to use npm to install Haraka, you can run from git by
following these steps:

    $ cd haraka

Install Haraka's node.js dependencies locally:

    $ npm install

Edit `config/plugins` and `config/smtp.ini` to specify the plugins and
config you want.

Finally run Haraka:

    $ node haraka.js

[1]: http://nodejs.org/
