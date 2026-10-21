# VMware host page fixture

An offline harness for an ESXi host's page inside its vCenter
(`packages/App/FeatureSet/Dashboard/src/Pages/VMware/View/HostDetail.tsx` and
its parts in `Components/VMware/Host`), the page a vCenter's Hosts list opens.
It bundles the production vCenter layout, side menu, host page and
Recommendations page with esbuild, replaces only the `ModelAPI` /
`AnalyticsModelAPI` / `API` / `Realtime` data boundary and the signed-in user,
and serves them on `127.0.0.1:4413` (`VMWARE_HOST_PAGE_FIXTURE_PORT` to change
it). No Docker, no database, no sign-in. Every record is made up, for an "Acme
Virtualization" workspace.

```sh
cd packages/E2E
npm run test-vmware-host-page-ui
```

The suite reads the page the way a person does:

- the hero: the host's name, whether vCenter still reports it (its word, and
  the sentence a screen reader hears after it), where it sits (cluster link,
  datacenter), when it was last seen, its CPU, memory and VM count; the side
  menu keeps Hosts marked;
- the Overview over the picked range: CPU, memory, slowest-disk latency and
  network tiles and charts, every series read with this host's vCenter,
  datacenter and name; what is open on the host, incidents before alerts and
  each newest first, five at most and how many more, never another host's;
  the VMs keeping it busy, with the
  ones waiting for a CPU marked; its network adapters and storage devices,
  errors and slow disks marked; which host alerts are on; its details;
- "Turn on 3 alerts" opening the vCenter's Recommendations with exactly the
  host alerts that are not on selected (`?select=`);
- "View all 7 virtual machines" opening the host's own Virtual Machines tab,
  read by the host's name and datacenter, each VM opening its page;
- the Metrics tab's charts of the host's CPU, memory, network and disk
  series, and the Logs tab: how to turn on the agent's syslog listener and
  point the host at it (`esxcli`, PowerCLI for the host and for its cluster),
  with the host's own log filter - or, for a vCenter a probe collects, why it
  has no syslog;
- the states a host can be in (`?state=not-reporting`, `no-data`, `gone`), a
  standalone host whose vCenter reports no per-device counters
  (`?standalone=1&devices=0`), a host without VMs (`?vms=none`), a role that
  may not read monitors (`?alerts=denied`);
- a phone (390 wide: no part scrolls sideways, each device a short list of its
  own), dark mode (`?theme=dark`) and German (`?lang=de`, a relative time in
  the sentence's language).

`Fixture/Fixture.js` records every read on `window.__vmwareHostPageFixture`
(`listRequests`, `countRequests`, `itemRequests`, `aggregateRequests`,
`apiRequests`) and anything it does not model in `unhandled`, which the suite
keeps empty. No request may leave `127.0.0.1`. Screenshots of each state are
written to `output/playwright/vmware-host-page-ui/`.

`node VMwareHostPage/Fixture/server.js --watch` rebuilds on every change, for
looking at the page while working on it.
