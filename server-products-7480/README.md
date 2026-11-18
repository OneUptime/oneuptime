# Products switched off on the server, in a browser (#7480)

The offline suite `test-server-products-ui` (packages/E2E/ServerProducts) draws each page from the branch over answers kept in the page, at 1280 and 390 pixels wide, light and dark, in German and Persian. None of them scrolls sideways.

## Admin Dashboard > Settings > Products, on a fresh server

| | Light | Dark |
| --- | --- | --- |
| German, 1280 | <img src="admin-fresh-de-light-1280.png" width="320"> | <img src="admin-fresh-de-dark-1280.png" width="320"> |
| German, 390 | <img src="admin-fresh-de-light-390.png" width="180"> | <img src="admin-fresh-de-dark-390.png" width="180"> |
| Persian, 1280 | <img src="admin-fresh-fa-light-1280.png" width="320"> | <img src="admin-fresh-fa-dark-1280.png" width="320"> |
| Persian, 390 | <img src="admin-fresh-fa-light-390.png" width="180"> | <img src="admin-fresh-fa-dark-390.png" width="180"> |

## Admin Dashboard > Settings > Products, after the Monitoring and status pages preset

| | Light | Dark |
| --- | --- | --- |
| German, 1280 | <img src="admin-after-preset-de-light-1280.png" width="320"> | <img src="admin-after-preset-de-dark-1280.png" width="320"> |
| German, 390 | <img src="admin-after-preset-de-light-390.png" width="180"> | <img src="admin-after-preset-de-dark-390.png" width="180"> |
| Persian, 1280 | <img src="admin-after-preset-fa-light-1280.png" width="320"> | <img src="admin-after-preset-fa-dark-1280.png" width="320"> |
| Persian, 390 | <img src="admin-after-preset-fa-light-390.png" width="180"> | <img src="admin-after-preset-fa-dark-390.png" width="180"> |

## Admin Dashboard > Settings > Products, the profile with ingestion stopped

| | Light | Dark |
| --- | --- | --- |
| German, 1280 | <img src="admin-ingestion-stopped-de-light-1280.png" width="320"> | <img src="admin-ingestion-stopped-de-dark-1280.png" width="320"> |
| German, 390 | <img src="admin-ingestion-stopped-de-light-390.png" width="180"> | <img src="admin-ingestion-stopped-de-dark-390.png" width="180"> |
| Persian, 1280 | <img src="admin-ingestion-stopped-fa-light-1280.png" width="320"> | <img src="admin-ingestion-stopped-fa-dark-1280.png" width="320"> |
| Persian, 390 | <img src="admin-ingestion-stopped-fa-light-390.png" width="180"> | <img src="admin-ingestion-stopped-fa-dark-390.png" width="180"> |

## Admin Dashboard > Settings > Products, the switch per product open

| | Light | Dark |
| --- | --- | --- |
| German, 1280 | <img src="admin-one-by-one-de-light-1280.png" width="320"> | <img src="admin-one-by-one-de-dark-1280.png" width="320"> |
| German, 390 | <img src="admin-one-by-one-de-light-390.png" width="180"> | <img src="admin-one-by-one-de-dark-390.png" width="180"> |
| Persian, 1280 | <img src="admin-one-by-one-fa-light-1280.png" width="320"> | <img src="admin-one-by-one-fa-dark-1280.png" width="320"> |
| Persian, 390 | <img src="admin-one-by-one-fa-light-390.png" width="180"> | <img src="admin-one-by-one-fa-dark-390.png" width="180"> |

## A Status Pages address, switched off, for a member

| | Light | Dark |
| --- | --- | --- |
| German, 1280 | <img src="off-status-pages-member-de-light-1280.png" width="320"> | <img src="off-status-pages-member-de-dark-1280.png" width="320"> |
| German, 390 | <img src="off-status-pages-member-de-light-390.png" width="180"> | <img src="off-status-pages-member-de-dark-390.png" width="180"> |
| Persian, 1280 | <img src="off-status-pages-member-fa-light-1280.png" width="320"> | <img src="off-status-pages-member-fa-dark-1280.png" width="320"> |
| Persian, 390 | <img src="off-status-pages-member-fa-light-390.png" width="180"> | <img src="off-status-pages-member-fa-dark-390.png" width="180"> |

## A Status Pages address, switched off, for a master admin

| | Light | Dark |
| --- | --- | --- |
| German, 1280 | <img src="off-status-pages-master-admin-de-light-1280.png" width="320"> | <img src="off-status-pages-master-admin-de-dark-1280.png" width="320"> |
| German, 390 | <img src="off-status-pages-master-admin-de-light-390.png" width="180"> | <img src="off-status-pages-master-admin-de-dark-390.png" width="180"> |
| Persian, 1280 | <img src="off-status-pages-master-admin-fa-light-1280.png" width="320"> | <img src="off-status-pages-master-admin-fa-dark-1280.png" width="320"> |
| Persian, 390 | <img src="off-status-pages-master-admin-fa-light-390.png" width="180"> | <img src="off-status-pages-master-admin-fa-dark-390.png" width="180"> |

## A Logs address while telemetry ingestion is stopped

| | Light | Dark |
| --- | --- | --- |
| German, 1280 | <img src="off-logs-ingestion-stopped-de-light-1280.png" width="320"> | <img src="off-logs-ingestion-stopped-de-dark-1280.png" width="320"> |
| German, 390 | <img src="off-logs-ingestion-stopped-de-light-390.png" width="180"> | <img src="off-logs-ingestion-stopped-de-dark-390.png" width="180"> |
| Persian, 1280 | <img src="off-logs-ingestion-stopped-fa-light-1280.png" width="320"> | <img src="off-logs-ingestion-stopped-fa-dark-1280.png" width="320"> |
| Persian, 390 | <img src="off-logs-ingestion-stopped-fa-light-390.png" width="180"> | <img src="off-logs-ingestion-stopped-fa-dark-390.png" width="180"> |

## Project Settings > Products with Status Pages and Kubernetes switched off

| | Light | Dark |
| --- | --- | --- |
| German, 1280 | <img src="project-settings-products-two-off-de-light-1280.png" width="320"> | <img src="project-settings-products-two-off-de-dark-1280.png" width="320"> |
| German, 390 | <img src="project-settings-products-two-off-de-light-390.png" width="180"> | <img src="project-settings-products-two-off-de-dark-390.png" width="180"> |
| Persian, 1280 | <img src="project-settings-products-two-off-fa-light-1280.png" width="320"> | <img src="project-settings-products-two-off-fa-dark-1280.png" width="320"> |
| Persian, 390 | <img src="project-settings-products-two-off-fa-light-390.png" width="180"> | <img src="project-settings-products-two-off-fa-dark-390.png" width="180"> |
