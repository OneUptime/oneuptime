# Connection label visibility screenshots

These images show the production Service Map and React Flow graph rendered by
the synthetic topology fixture in dark mode at a 1280-pixel viewport. No
customer or local project data is present.

- `before-dark.png` was captured from `master` with Average latency labels.
- `after-dark.png` was captured from this branch with the same fixture, theme,
  viewport, clock, and label setting.

Regenerate the after image from `E2E` with:

```sh
npm run test-topology-ui -- --grep "service map connection labels stay legible"
```

The generated image is written to
`output/playwright/topology/service-map-connection-labels-dark-synthetic.png`.
