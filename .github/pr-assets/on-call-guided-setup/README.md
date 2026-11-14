# On-call guided setup screenshots (#6805)

Taken from the journeys fixture (`packages/E2E/Journeys`), which draws the real Dashboard built from the
branch as a new project's owner on OneUptime Cloud (`?billing=on`), with the real locale files. Each was
taken by adding `page.screenshot` calls to the `paged-by-phone-guided` journey for one run
(`CI=1 npm run test-journeys-ui -- --grep paged-by-phone-guided` in `packages/E2E`), then taking them out:

- `1280-en-1-reach-off.png`: step 1, SMS and calls off, with the switch for an owner.
- `1280-en-2-no-balance.png`: step 1 on, the balance said before any click, Add balance.
- `1280-en-3-phone.png`: balance added, the number field.
- `1280-en-4-reached.png`: email, SMS and calls verified from one code.
- `1280-en-5-no-answer.png`: step 3, Grace after 30 minutes.
- `1280-en-6-summary.png` and `390-en-summary.png`: the summary.
