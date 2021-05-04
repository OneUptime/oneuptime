# fyipe-gl-manager

Manages SSL Certificate issuance and renewal for [Greenlock](https://git.rootprojects.org/root/greenlock-manager.js) on [Fyipe](https://fyipe.com) platform.

Saves global and per-site config to a local File Sytem (current).

## Install

```bash
npm install --save fyipe-gl-manager
```

# Usage

## Initialize the Manager

```js
Greenlock.create({
    ...
    manager: "@greenlock/manager",
    configDir: "./greenlock.d",
    packageRoot: __dirname
    ...
});
```

# Site Management

By "site" we mean a primary domain and, optionally, secondary domains, to be listed on an ssl certificate,
along with any configuration that is necessary for getting and renewing those certificates.

## Add a sites - domains and SSL certificates

```js
greenlock.add({
    subject: 'example.com',
    altnames: ['example.com', 'www.example.com'],
});
```

## View site config

```js
greenlock.get({
    servername: 'www.example.com',
    wildname: '*.example.com',
});
```

## Update site config

```js
greenlock.update({
    subject: 'www.example.com',
    challenges: {
        'dns-01': {
            module: 'acme-dns-01-ovh',
            token: 'xxxx',
        },
    },
});
```

## Remove a site

To stop automatic renewal of SSL certificates for a particular site.
You to restart renewal you must use `add()`.

```js
greenlock.remove({
    subject: 'example.com',
});
```
