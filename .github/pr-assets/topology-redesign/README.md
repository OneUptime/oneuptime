# Topology redesign screenshots

These images show the production topology page and components rendered with
synthetic inventory, service, and network data. The preview's API boundary is
stubbed; it does not use a customer project or test account. A banner identifies
the demo workspace.

Regenerate them from `E2E` with `npm run test-topology-ui`. The reproducible
fixture and browser workflows live in `E2E/Topology`; generated images are saved
to `output/playwright/topology` at the repository root. Copy the reviewed
`*-synthetic.png` files into this directory when updating the PR screenshots.

Desktop captures use a 1440-pixel viewport. The mobile capture uses a 390-pixel
viewport and follows the keyboard navigation and overflow regression checks.

The screenshots cover the infrastructure overview, resource drilldown and map,
service directory and direct dependencies, network site navigation and map
options, resource connection drawers, and the phone layout.
