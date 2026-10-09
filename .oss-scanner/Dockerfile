#
# OneUptime, built for Anthropic's OSS Scanner
# (https://github.com/anthropics/oss-scanner).
#
# The scanner builds this file with a fresh clone of this repository as the
# build context, on a machine with network access, and then studies the
# finished image with NO network. So everything the code, its tests and the
# running product need is fetched and built here:
#
#   - every Node project's dependencies, from its lockfile (npm ci), the
#     frontends' production bundles and every service's TypeScript build;
#   - the Probe's browsers and native helpers, as the Probe image has them;
#   - the Go toolchain and modules of the Infrastructure Agent;
#   - Postgres, Valkey (Redis) and ClickHouse, the three datastores the App
#     runs against, so the suites that need them and the App itself run
#     offline (.oss-scanner/start-services.sh, .oss-scanner/start-app.sh).
#
# .oss-scanner/threat_model.md says what matters and how to exercise it, and
# .oss-scanner/README.md how to check this build the way the scanner runs it.
# Tests/Ops/OssScannerImage.test.js keeps this file in step with the
# repository: the base images, every project with a lockfile, and the paths
# and settings below.

# Pinned by digest, so the image is reproducible. The tags are the ones the
# repository itself runs: node:26-bookworm-slim is the Probe image's base (the
# one image that can run every part of OneUptime: the Probe's browsers need
# glibc), ClickHouse 26.7 is docker-compose.base.yml's, and Go 1.25.0 is the
# Infrastructure Agent's go.mod.
FROM clickhouse/clickhouse-server:26.7@sha256:8397e27eebf1adf972fcd3728b37682c66fbf969ba675782a1d0ab22119a6986 AS clickhouse
FROM public.ecr.aws/docker/library/golang:1.25.0-bookworm@sha256:81dc45d05a7444ead8c92a389621fafabc8e40f8fd1a19d7e5df14e61e98bc1a AS go
FROM public.ecr.aws/docker/library/node:26-bookworm-slim@sha256:86f07bc9c5dce4578cf37e5a418b7bfc7f817cda25cde66e2b66e95ed86c4567

ENV DEBIAN_FRONTEND=noninteractive
SHELL ["/bin/bash", "-o", "pipefail", "-c"]

# OS packages:
#   - the toolchain native npm modules build with (isolated-vm, the SQL
#     Server ODBC binding) and the Probe's C helpers: python3 make g++
#     pkg-config unixodbc-dev;
#   - what the Probe's monitors run: ping, traceroute, dig, netstat;
#   - Postgres 15, the major docker-compose.base.yml runs, and Redis 7.0 in
#     place of Valkey 9.1, which has no build for Debian 12 (Valkey is a fork
#     of Redis 7.2 and speaks the same protocol);
#   - git, curl, procps and ca-certificates for whoever studies the image.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
        bash ca-certificates curl git procps \
        python3 make g++ pkg-config unixodbc-dev \
        iputils-ping net-tools dnsutils traceroute \
        postgresql-15 redis-server \
    && rm -rf /var/lib/apt/lists/*

# ClickHouse is one static binary, copied with the stock server and user
# configuration it ships with. The repository's own drop-ins are added below,
# once the source is in.
COPY --from=clickhouse /usr/bin/clickhouse /usr/bin/clickhouse
COPY --from=clickhouse /etc/clickhouse-server/config.xml /etc/clickhouse-server/config.xml
COPY --from=clickhouse /etc/clickhouse-server/users.xml /etc/clickhouse-server/users.xml
RUN ln -s clickhouse /usr/bin/clickhouse-server \
    && ln -s clickhouse /usr/bin/clickhouse-client \
    && useradd --system --home-dir /var/lib/clickhouse --shell /usr/sbin/nologin clickhouse \
    && mkdir -p /var/lib/clickhouse /var/log/clickhouse-server \
        /etc/clickhouse-server/config.d /etc/clickhouse-server/users.d \
    && chown clickhouse:clickhouse /var/lib/clickhouse /var/log/clickhouse-server

# The Go toolchain, for the Infrastructure Agent. GOTOOLCHAIN=local keeps go
# from fetching another toolchain.
COPY --from=go /usr/local/go /usr/local/go
ENV PATH=/usr/local/go/bin:/root/go/bin:${PATH} \
    GOTOOLCHAIN=local

# npm as the repository's images configure it: retry a dropped download,
# serialise install scripts (esbuild's postinstall races extraction on
# overlayfs otherwise), and keep file: dependencies as links, so every
# project shares one copy of Common. No audit or update checks: nothing reads
# them here.
RUN npm config set fetch-retries 5 --global \
    && npm config set fetch-retry-mintimeout 20000 --global \
    && npm config set fetch-retry-maxtimeout 60000 --global \
    && npm config set foreground-scripts true --global \
    && npm config set install-links false --global \
    && npm config set audit false --global \
    && npm config set fund false --global \
    && npm config set update-notifier false --global

# The scanner's contract: the checkout lives inside the image, at /src.
COPY . /src
WORKDIR /src

# The repository's own .dockerignore is written for the product images and
# leaves out Scripts/, HelmChart/, ee/Tests and more. BuildKit reads
# .oss-scanner/Dockerfile.dockerignore for this Dockerfile instead, which
# keeps the whole tree; stop here if a builder used the other one.
RUN test -f Scripts/Install/MergeEnvTemplate.js \
    && test -d ee/Tests \
    && test -d HelmChart \
    && test -f .oss-scanner/start-services.sh \
    || { echo "The build context is missing parts of the repository: build this with BuildKit, which reads .oss-scanner/Dockerfile.dockerignore instead of the root .dockerignore." >&2; exit 1; }

# The App reads its views, static files and docs at the release image's
# paths (/usr/src/app, /usr/src/Common). These links give it those paths over
# the checkout, so it runs from /src unchanged; it finds ee/ next to itself.
RUN mkdir -p /usr/src \
    && ln -s /src/packages/App /usr/src/app \
    && ln -s /src/packages/Common /usr/src/Common

# --- Dependencies ------------------------------------------------------------
#
# Every Node project, from its lockfile. The root and Common go first, since
# every other project links Common (file:../Common); ee/ goes last, since it
# links App too. ee/ installs without lifecycle scripts, as the Enterprise
# image does: they would run the linked Common's and App's a second time.
#
# Not installed, on purpose (Tests/Ops/OssScannerImage.test.js reads these
# lines, and fails on a project with a lockfile that is in neither list):
# not built: packages/E2E - browser end-to-end tests that drive a running stack; test code, not shipped
# not built: packages/TestServer - the fixture server the end-to-end tests monitor; never deployed
# not built: packages/MobileApp - the on-call app, built for the app stores by Expo's cloud toolchain, which cannot run offline; a client of the same API, whose server enforces every permission
# not built: Scripts - developer and release tooling (OpenAPI, Terraform and docs generators); never deployed
# not built: Scripts/TerraformProvider - generates the Terraform provider, which is published from its own repository and runs with its user's own API key
# not built: Tests/Ops - tests of this repository's operations config, including the one that checks this file
# not built: Tests/Ops/agent-ebpf-e2e/apps - a demo app the Kubernetes agent's eBPF test instruments
# not built: Examples/fluentd - an example log shipper configuration
RUN --mount=type=cache,target=/root/.npm bash .oss-scanner/run-in-parallel.sh 2 <<'EOF'
. npm ci
packages/Common npm ci
EOF

RUN --mount=type=cache,target=/root/.npm bash .oss-scanner/run-in-parallel.sh 8 <<'EOF'
packages/App npm ci
packages/App/FeatureSet/Accounts npm ci
packages/App/FeatureSet/AdminDashboard npm ci
packages/App/FeatureSet/BrowserRecorder npm ci
packages/App/FeatureSet/Dashboard npm ci
packages/App/FeatureSet/MobileRecorder npm ci
packages/App/FeatureSet/PublicDashboard npm ci
packages/App/FeatureSet/StatusPage npm ci
packages/CLI npm ci
packages/Home npm ci
packages/Nginx npm ci
packages/Probe npm ci
packages/Runner npm ci
agents/KubernetesAIAgent npm ci
agents/KubernetesCostAgent npm ci
agents/KubernetesLogTailer npm ci
agents/ResourceAIAgent npm ci
EOF

RUN --mount=type=cache,target=/root/.npm bash .oss-scanner/run-in-parallel.sh 1 <<'EOF'
ee npm ci --ignore-scripts
EOF

# aedes (the MQTT broker) publishes its examples/, whose package.json carries
# the name of a known malware package; nothing loads it. The App image deletes
# it for the same reason: so that nobody chases it.
RUN rm -rf packages/App/node_modules/aedes/examples

# The Infrastructure Agent's modules, and its packages and tests compiled
# once, so `go build` and `go test` start from a warm cache offline.
RUN cd agents/InfrastructureAgent \
    && go mod download \
    && go build ./... \
    && go vet ./... \
    && go test -count=1 -run '^$' ./...

# --- Build -------------------------------------------------------------------
#
# What the release images build: the mermaid bundle the docs serve, every
# frontend's production bundle (with the Enterprise UI, since ee/ is in the
# tree: Common/UI/esbuild-enterprise.js), the React Native recorder, and every
# TypeScript project's compile, which is also its type check.
RUN bash .oss-scanner/run-in-parallel.sh 8 <<'EOF'
packages/Common node Scripts/build-mermaid-browser.js
packages/Common npm run compile
packages/App npm run build-frontends:prod
packages/App npm run compile
packages/App/FeatureSet/MobileRecorder npm run build
packages/CLI npm run compile
packages/Home npm run compile
packages/Nginx npm run compile
packages/Probe npm run compile
packages/Runner npm run compile
ee npm run compile
agents/KubernetesAIAgent npm run compile
agents/KubernetesCostAgent npm run compile
agents/KubernetesLogTailer npm run compile
agents/ResourceAIAgent npm run compile
EOF

# The Probe's synthetic monitors, as the Probe image runs them: Chromium and
# Firefox where the Probe looks for them, the Firefox no-sync library the
# synthetic runtime preloads, and the root-only helper that reads a check's
# memory (packages/Probe/Dockerfile.tpl explains each).
ENV PLAYWRIGHT_BROWSERS_PATH=/ms-playwright-browsers
RUN apt-get update \
    && (cd packages/Probe && npx playwright install --with-deps chromium firefox) \
    && rm -rf /var/lib/apt/lists/* \
    && chmod -R a+rX /ms-playwright-browsers \
    && mkdir -p /usr/lib/oneuptime-probe \
    && gcc -shared -fPIC -O2 -Wall -Wextra -Werror \
        -o /usr/lib/oneuptime-probe/libsynthetic-no-sync.so \
        packages/Probe/Utils/Monitors/SyntheticRuntime/Native/synthetic-no-sync.c \
    && gcc -O2 -Wall -Wextra -Werror \
        -o /usr/lib/oneuptime-probe/synthetic-process-memory \
        packages/Probe/Utils/Monitors/SyntheticRuntime/Native/synthetic-process-memory.c \
    && chmod 0755 /usr/lib/oneuptime-probe \
    && chmod 0644 /usr/lib/oneuptime-probe/libsynthetic-no-sync.so \
    && chmod 0700 /usr/lib/oneuptime-probe/synthetic-process-memory

# --- Datastores and settings ---------------------------------------------------
#
# config.env at the repository root, which every package's `npm test` exports:
# the settings CI's suites run with (packages/Common/test-setup.sh), pointed at
# the datastores below and at this one machine (the App calls itself by
# SERVER_APP_HOSTNAME, "app" in Docker Compose), with every other setting from
# config.example.env. The secrets are random for each build, never the
# placeholders config.example.env ships. start-app.sh switches billing off for
# the running App.
#
# Postgres listens on localhost:5400, Valkey (Redis) on localhost:6310 and
# ClickHouse on localhost:8123 (HTTP) and 9000 (native), as CI's and the dev
# stack's are. Postgres trusts local connections, so any suite's credentials
# work. ClickHouse runs the repository's own drop-ins (the one-node
# "oneuptime" cluster with its embedded Keeper) and takes at most half of the
# memory, because the scanner's agents get 8 GB for everything.
RUN set -e \
    && secret() { node -e 'process.stdout.write(require("crypto").randomBytes(24).toString("hex"))'; } \
    && clickhouse_password="$(secret)" \
    && { \
        echo "NODE_ENV=test"; \
        echo "BILLING_ENABLED=true"; \
        echo "HOST=localhost"; \
        echo "SERVER_APP_HOSTNAME=localhost"; \
        echo "SERVER_HOME_HOSTNAME=localhost"; \
        echo "DATABASE_HOST=localhost"; \
        echo "DATABASE_PORT=5400"; \
        echo "DATABASE_MIGRATIONS_HOST=localhost"; \
        echo "DATABASE_MIGRATIONS_PORT=5400"; \
        echo "DATABASE_PASSWORD=$(secret)"; \
        echo "VALKEY_HOST=localhost"; \
        echo "VALKEY_PORT=6310"; \
        echo "VALKEY_DB=0"; \
        echo "VALKEY_USERNAME=default"; \
        echo "VALKEY_PASSWORD=$(secret)"; \
        echo "CLICKHOUSE_HOST=localhost"; \
        echo "CLICKHOUSE_PORT=8123"; \
        echo "CLICKHOUSE_PASSWORD=${clickhouse_password}"; \
        echo "TEST_CLICKHOUSE_URL=http://default:${clickhouse_password}@localhost:8123"; \
        echo "ONEUPTIME_SECRET=$(secret)"; \
        echo "ENCRYPTION_SECRET=$(secret)"; \
        echo "REGISTER_PROBE_KEY=$(secret)"; \
        echo "GLOBAL_PROBE_1_KEY=$(secret)"; \
        grep -E '^(SUBSCRIPTION_PLAN_[A-Z]+|BILLING_PUBLIC_KEY)=' packages/Common/test-setup.sh; \
    } > config.env \
    && node Scripts/Install/SyncPackageVersions.js \
    && node Scripts/Install/MergeEnvTemplate.js \
    && cp Clickhouse/config.d/*.xml /etc/clickhouse-server/config.d/ \
    && cp Clickhouse/users.d/*.xml /etc/clickhouse-server/users.d/ \
    && printf '%s\n' \
        '<clickhouse>' \
        '    <max_server_memory_usage_to_ram_ratio>0.5</max_server_memory_usage_to_ram_ratio>' \
        '</clickhouse>' > /etc/clickhouse-server/config.d/oss-scanner-memory.xml \
    && printf '%s\n' \
        '<clickhouse>' \
        '    <users>' \
        '        <default>' \
        "            <password replace=\"replace\">${clickhouse_password}</password>" \
        '            <access_management>1</access_management>' \
        '        </default>' \
        '    </users>' \
        '</clickhouse>' > /etc/clickhouse-server/users.d/oss-scanner-default-user.xml \
    && chown -R clickhouse:clickhouse /etc/clickhouse-server \
    && pg_conftool 15 main set port 5400 \
    && pg_conftool 15 main set listen_addresses localhost \
    && printf '%s\n' \
        'local all all trust' \
        'host all all 127.0.0.1/32 trust' \
        'host all all ::1/128 trust' > /etc/postgresql/15/main/pg_hba.conf \
    && pg_ctlcluster 15 main start \
    && su postgres -c "createdb --port 5400 $(sed -n 's/^DATABASE_NAME=//p' config.env | head -n 1)" \
    && pg_ctlcluster 15 main stop

# Offline from here on: npm and go fail at once instead of retrying a network
# that is not there.
RUN npm config set offline true --global
ENV GOPROXY=off \
    GOFLAGS=-mod=readonly

WORKDIR /src
CMD ["bash"]
