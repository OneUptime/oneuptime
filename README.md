Monitor template optional target screenshots

Captured from the actual local Docker application with synthetic E2E project data. A temporary loopback proxy served built frontend assets and forwarded requests directly to the primary app, avoiding a duplicate Docker service alias. No API responses were mocked.

All seven Chromium scenarios passed: Website, API, SSL Certificate, Ping, IP, Port, and Domain.

PR source: b477dfe335d56baf32fc90035c6ba4322c954659
