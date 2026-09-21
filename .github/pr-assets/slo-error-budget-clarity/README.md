# SLO error budget clarity

These screenshots render the real `SloKpiStrip` component with repository Tailwind, Inter, and theme styles in a local fixture. They are not screenshots of a live SLO or an end-to-end server test.

The reported case uses a 99.9% target, a rolling 30-day window, a remaining budget of -99,882.8%, and an overage of 4 days and 23 minutes. It now reads **Budget exceeded** and **4d 23m over budget · 5m 47s allowed · window 13% full**.

Browser verification covered exceeded, healthy, exactly exhausted, and unevaluated budgets at 1440px, 768px, and 390px. No page or tile overflow was found.

- [Desktop](desktop-reported-case.png)
- [Mobile](mobile-reported-case.png)
