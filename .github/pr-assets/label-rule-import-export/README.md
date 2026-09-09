# Label rule import and export screenshots

These images show the production Network Device and Monitor Label Rules pages
and production import/export components, rendered by the Playwright fixture in
`E2E/LabelRules/Fixture`. The **Demo workspace · Synthetic data** banner identifies
the substituted ModelAPI data and permission snapshot. No customer data appears
in the images, and they do not demonstrate database persistence.

- `label-rules-toolbar.png`: import and export in the More options menu.
- `import-json.png`: upload or paste JSON before validation.
- `import-preview.png`: validated rules, enabled state, labels, and expanded conditions.
- `cross-resource-preview.png`: compatible conditions mapped from Network Device to Monitor rules.
- `validation-error.png`: a missing destination label blocks the batch.
- `import-complete.png`: successful completion and refreshed table.

Regenerate with `cd E2E && npm run test-label-rule-transfer-ui`. The separate live
integration suite is documented in `E2E/LabelRules/README.md`.
