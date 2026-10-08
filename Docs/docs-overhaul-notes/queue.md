# Work queue (orchestrator)

## Running (English rewrite, wave 1+2)
- monitor-core-a (a50c3dc4a5e60a327)
- monitor-core-b (a90f12bc32f65cfad)
- incidents (ae8de6a636b47e64f)
- oncall-workspace (a5bc092626e5de1e8)
- status-pages (acb9ea865f7e4b29e)
- telemetry-core (a24353f8455a13bc5)
- installation (a5042224035bff66f)
- self-hosted (aa876f133aa0aaa7e)
- admin (aba8a02578ce55021)
- infra-monitors-a (af549f6e225676929)
- infra-monitors-b (a90898c3412b4b492)
- telemetry-monitors-slo-probe (aec087083685b3998)
- workflows (aa64361567e7fa8db)
- runbooks-forms (a175815835f8290d9)
- NEW alerts (ad05ad648cbb9088d)

## Queued — new pages (prompts drafted in conversation; brief-newpages.md)
- NP-notifications (P2)
- NP-oncall (P3)
- NP-maintenance (P4)
- NP-monitor-incidents (P5, P11, P17)
- NP-explorers (P6, P7–P9)
- NP-telemetry-admin (P10, P12, P14)
- NP-admin (P13, P15)
- NP-intro (quickstart, core-concepts, home, your-account)
- Locale: new nav titles (i18n/new-navlinks.json)

## Queued — English rewrite
agents-a, agents-b, agents-c, cloud, ai-observability-security, rum, dashboards-inventory, ai, integrations-a, integrations-b, api-cli, terraform, apps
(extra notes: dashboards/index "left navigation"; telemetry/ai-agent-circuit-breaker "left navigation"; ai/ai-agent Tasks menu path is Code → Tasks)

## Then
- translations per batch (brief-translate.md), language pairs: [de,nl] [fr,es] [it,pt] [da,no] [sv,ru] [ja,ko] [zh-CN,zh-TW] [hi,fa]
- uncommitted: Nav.ts new entries + On Call reorder + 3 order tests + Notifications icon + en.json new keys + DocsNavSections change -> commit together with the new pages
- uncommitted: getting-started.md (needs quickstart/core-concepts), DocsContentIntegrity/DocsTranslations tests (commit when green)
