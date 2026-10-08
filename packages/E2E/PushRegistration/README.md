# Push registration fixture

An offline harness for Register Device (User Settings > Notification Methods >
Push Notifications) in Chromium. No app server, database or Docker.

The browser gets the real thing wherever it decides the outcome:

- the `Push` component from this branch
  (`packages/App/FeatureSet/Dashboard/src/Components/NotificationMethods/Push.tsx`),
  bundled with esbuild;
- the Dashboard's service worker, generated from `sw.js.template` by the build's
  own generator and served at `/dashboard/sw.js`, with the files it precaches;
- the service worker script from `views/index.ejs`, copied into the page verbatim,
  so the page reloads, or does not, exactly as the Dashboard does.

`Fixture/server.js` answers the routes Register Device calls and records every
request body as it crossed the wire. Its register route refuses a project id that
is not a string id with "Project ID is invalid", as the real route did before it
learned to read the serialized ObjectID the Dashboard used to send. Only the
table's list read is replaced in the page, by the devices the server holds, so a
device the page failed to register is missing after a reload, as it would be.

Chromium here has no push service, and it refuses push in a Playwright context as
it does in an incognito window, so `PushManager.subscribe` and `getSubscription`
are stood in for, in the page and in the worker alike
(`Fixture/PushServiceStandIn.js`: the spec adds it to every page, and the server
appends it to the worker it serves). The fixture server holds the one
subscription the browser has, which the page and the worker share as they do in
a real browser, and a test can have the push service replace or drop it. The
permission prompt, the service worker, the session cookies and the requests are
real.

The route the worker reports a replaced subscription to,
`/api/user-push/subscription-change`, answers only a signed-in session: the
access token cookie, refreshed through `/identity/refresh-token` with the
refresh token cookie, which rotates both - or, without a valid one, clears them
and answers 401.

The suite covers what a customer reported - Register Device, allow notifications,
the page refreshed and no device was listed; after a hard refresh, "Project ID is
invalid" - and what the dialog does now:

- the first registration installs the worker, which takes control of the page
  without reloading it, sends the project as a plain id, and lists the new device
  as "This browser" (also after a reload);
- the dialog that follows sends a test notification to the device it registered;
- registering the same browser again says it is already registered and adds no
  device;
- after a hard refresh, which loads the page past its worker, registering works;
- a prompt closed without an answer, and notifications blocked for the site, are
  each explained in the dialog, and nothing is registered;
- a newer worker taking over from the one that served the page still reloads it,
  so an open tab picks up a deployment.

And when the browser replaces its push subscription (`pushsubscriptionchange`),
which the worker used to answer by subscribing without the server's key - refused
by every browser - and sending the result to a route that never existed:

- an event that names both subscriptions (Chrome 138+, Safari, Firefox 137+): the
  worker reports them, and the device carries the new one;
- an event that names neither, as before Firefox 137: the worker subscribes again
  with the key Register Device gave it, and renews the device it registered;
- the access token has expired, as it has whenever no Dashboard is open: the
  worker's request carries the Dashboard's cookies, and the worker refreshes the
  session under the lock the Dashboard refreshes under, after a tab's refresh;
- signed out at the time: the change is reported when the Dashboard is next
  opened, signed in;
- lost while notifications are blocked: the device is reported as no longer
  receiving notifications, and the list says so;
- a subscription the push service stopped accepting (a send came back 410) while
  the browser still holds it: the list says so, and Register Device replaces it
  and renews the device instead of answering "already registered".

## Run it

```
cd packages/E2E
npm install
CI=1 npm run test-push-registration-ui
```

Screenshots land in `output/playwright/push-registration-ui/`, named
`*-synthetic.png` because every record in them is fabricated.

## Poke at it by hand

```
cd packages/E2E
node PushRegistration/Fixture/server.js
```

then open
`http://127.0.0.1:4281/dashboard/10000000-0000-4000-8000-000000000001/user-settings/notification-methods`.
The page there gets no stand-in, and a real browser has a push service, so
registering from it asks the browser for a real subscription. The worker the
fixture serves carries the stand-in all the same, so it sees the fixture's
subscription rather than the browser's. `GET /__fixture/state` shows what was sent, and
`POST /__fixture/reset` starts over. Set `PUSH_REGISTRATION_FIXTURE_PORT` to run a
second checkout beside this one.
