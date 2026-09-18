# Contextual AI insights

Open **Ask AI** from the dashboard header, or press **Cmd/Ctrl + I**, while
viewing a module. The assistant displays the current page in its context chip
and offers questions for that page. You can also type your own question.

Page context is available for Real User Monitoring applications, services,
monitors, incidents, alerts, scheduled maintenance, logs, traces, metrics and
exceptions. Application and resource detail pages include the selected resource;
list pages provide context for the whole area. Context follows navigation.

## Real User Monitoring

From an application's page, try:

- “Compare this application's web vitals with the previous 24 hours.”
- “Chart LCP, INP and CLS over the last day.”
- “Which browser requests are slow or returning errors?”
- “When did this application last send telemetry?”

The assistant can discover applications, inspect connection health, and compare
LCP, INP, CLS, FCP and TTFB with the preceding equal-duration window. It uses the
same metric aliases and thresholds as the RUM overview. Results include the
measured averages, units, ratings and percentage changes, with citations linking
back to RUM. Trend charts use the discovered metric names.

Missing measurements remain missing. A zero previous average has no percentage
change. Ratings describe the returned averages, rather than a p75 field
assessment. An observed regression does not by itself establish a statistical
anomaly or root cause. Browser span counts describe recorded operations, not
unique visitors or page views. The assistant's RUM tools do not read session
recordings or visitor identities.

## Context and access

Remove the context chip to ask without the current page attached. This clears
the conversation's saved page context on your next message. A conversation
expanded into the full-page workspace keeps its subject until it is changed or
explicitly removed.

The project must have AI enabled and an available model provider, and cloud
projects need a plan that includes AI chat. Queries use the caller's existing
project and resource permissions. Web-vital summaries require access to the
application and its metrics; trace and metric charts use their existing telemetry
permissions. The assistant reports queries and cites evidence rather than
inventing answers when data is unavailable.
