#!/usr/bin/env bash
#
# Runs, inside an Iron Bank image of OneUptime that the Iron Bank Preflight
# workflow built, what the service needs before it can serve. A library, a
# binary or a module that did not come across from the release, or that Iron
# Bank's base image lacks, then fails here instead of in a DoD installation.
# The App is booted with its datastores by Tests/Ops/AppImageRuntime.test.js
# instead, so it has nothing here.
#
#   Ingress  nginx loads its configuration and modules (njs links libxml2,
#            which Iron Bank's nginx image does not install), and Node.js, npm,
#            bash, envsubst and openssl run: run.sh needs them all.
#   Runner   the runner's TypeScript loader resolves, kubectl, git, ssh and
#            tini run, and it is the node user.
#   Probe    the checks the release's own Dockerfile ends with (the SQL Server
#            driver and its ODBC registration, isolated-vm, the memory
#            helper), Playwright's Chromium and Firefox render a page, and the
#            network tools run.
#
# Usage:
#   bash Scripts/IronBank/smoke_test.sh <App|Ingress|Runner|Probe> <image>

set -euo pipefail

PROJECT="${1:?Usage: smoke_test.sh <App|Ingress|Runner|Probe> <image>}"
IMAGE="${2:?Usage: smoke_test.sh <App|Ingress|Runner|Probe> <image>}"

# Runs one command in the image, from its WORKDIR, as its user.
run() {
	echo "▶ $*"
	docker run --rm --entrypoint "$1" "$IMAGE" "${@:2}"
}

# Renders a page in each of Playwright's browsers.
BROWSERS_CHECK='
const { chromium, firefox } = require("playwright");
(async () => {
  for (const type of [chromium, firefox]) {
    const browser = await type.launch();
    const page = await browser.newPage();
    await page.setContent("<p>ok</p>");
    const text = await page.textContent("p");
    await browser.close();
    if (text !== "ok") {
      throw new Error(`${type.name()} rendered ${JSON.stringify(text)}`);
    }
    console.log(`${type.name()} renders`);
  }
})().catch((error) => {
  console.error(error);
  process.exit(1);
});'

case "$PROJECT" in
App)
	echo "The App is booted with its datastores by Tests/Ops/AppImageRuntime.test.js."
	;;
Ingress)
	run nginx -t
	run node --version
	run npm --version
	run bash -c 'command -v envsubst && openssl version'
	run sh -c 'test -x /etc/nginx/envsubst-on-templates.sh && test -x /usr/src/app/run.sh'
	;;
Runner)
	run node -e 'require.resolve("ts-node/register"); console.log("ts-node resolves")'
	run kubectl version --client
	run git --version
	run ssh -V
	run tini --version
	run sh -c 'test "$(id -un)" = node && echo "runs as node"'
	;;
Probe)
	run node -e 'require("mssql/msnodesqlv8"); console.log("msnodesqlv8 loads")'
	run odbcinst -q -d -n "ODBC Driver 18 for SQL Server"
	run node -e 'require("/usr/src/Common/node_modules/isolated-vm"); console.log("isolated-vm loads")'
	run sh -c '/usr/lib/oneuptime-probe/synthetic-process-memory 2>/dev/null; test $? -eq 2 && echo "synthetic-process-memory runs"'
	run node -e "$BROWSERS_CHECK"
	run sh -c 'ping -V && traceroute --version && tcpdump --version && dig -v'
	;;
*)
	echo "Unknown Iron Bank project: ${PROJECT}" >&2
	exit 1
	;;
esac

echo "✅ ${IMAGE} (${PROJECT}) passes its smoke test"
