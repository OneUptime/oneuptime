# Replay Health page visual QA

Production UI rendered by the offline session replay fixture
(`npm run test-session-replay-ui` in `E2E`) with synthetic ingest-status data.

## Healthy

![Healthy application](./health-healthy.png)

## Uploads being refused

The hero names the top refusal reason and its fix; the pipeline marks the
Chunks received stage amber; the storage meter turns amber past 80%.

![Refusing uploads](./health-refusing.png)

## Recorder never loaded

Counters the server could not read say "unknown" instead of zero.

![Never loaded](./health-never-loaded.png)

## Narrow viewport

![Mobile](./health-mobile.png)

## Session list, without the health strip

![Session list](./session-list-without-strip.png)
