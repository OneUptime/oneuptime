#!/bin/bash
# The App as its production image runs it, for memory measurements: the
# image's Node on Alpine (musl), its npm ci, its user and its CMD
# (image/App.Dockerfile). stack.sh runs the App on this machine's own libc, and
# native memory - zlib, sockets, the allocator's free lists - is a large part
# of the App's resident memory under load and differs between glibc and musl;
# the V8 heap does not.
#
#   app-image.sh build [commit]   images "$PERF_PREFIX-app:branch" (this
#                                 checkout) and ":base" (commit, default the
#                                 merge base with origin/master); both serve
#                                 this checkout's built Dashboard
#   app-image.sh run <tag>        stops the App stack.sh runs (or a running
#                                 image), runs this one on the host network
#                                 with $PERF_DIR/app.env and the inspector on
#                                 127.0.0.1:9371, and writes its PID to
#                                 $PERF_DIR/app.pid, so cpu-sample.py and
#                                 memory-sample.py measure it
#   app-image.sh stop
#
# Settings: PERF_DIR, PERF_PREFIX, PERF_APP_PORT (see stack.sh),
# PERF_APP_INSPECTOR (9371).
set -uo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO="$(cd "$HERE/../.." && pwd)"
PERF_DIR="${PERF_DIR:-/tmp/oneuptime-perf}"
PERF_PREFIX="${PERF_PREFIX:-oneuptime-perf}"
PERF_APP_PORT="${PERF_APP_PORT:-3371}"
PERF_APP_INSPECTOR="${PERF_APP_INSPECTOR:-9371}"
NAME="$PERF_PREFIX-app"
DASHBOARD=packages/App/FeatureSet/Dashboard/public

context() {
  # A build context of packages/Common and packages/App, sources only.
  local out="$1"
  rm -rf "$out"
  mkdir -p "$out"
  cp "$HERE/image/App.Dockerfile" "$out/Dockerfile"
  printf 'node_modules\n**/node_modules\n' >"$out/.dockerignore"
  if [ -d "$REPO/$DASHBOARD/dist" ]; then
    mkdir -p "$out/$DASHBOARD/assets/js"
    cp -R "$REPO/$DASHBOARD/dist" "$out/$DASHBOARD/dist"
    cp "$REPO/$DASHBOARD/sw.js" "$out/$DASHBOARD/sw.js" 2>/dev/null || true
    cp "$REPO/$DASHBOARD/assets/js"/tailwind*.js "$out/$DASHBOARD/assets/js/" 2>/dev/null || true
  fi
}

stop_app() {
  if [ -f "$PERF_DIR/app.pid" ]; then
    local pid
    pid=$(cat "$PERF_DIR/app.pid")
    if [ "$(docker inspect -f '{{.State.Pid}}' "$NAME" 2>/dev/null)" != "$pid" ]; then
      kill -INT "$pid" 2>/dev/null
      for _ in $(seq 1 60); do
        if ! ps -p "$pid" >/dev/null 2>&1; then break; fi
        sleep 1
      done
      kill -9 "$pid" 2>/dev/null
    fi
    rm -f "$PERF_DIR/app.pid"
  fi
  docker rm -f -v "$NAME" >/dev/null 2>&1
}

case "${1:-}" in
  build)
    commit="${2:-$(git -C "$REPO" merge-base HEAD origin/master)}"
    context "$PERF_DIR/image/ctx-branch"
    tar -C "$REPO" --exclude node_modules --exclude packages/App/build --exclude packages/Common/build -cf - packages/Common packages/App \
      | tar -x -C "$PERF_DIR/image/ctx-branch"
    context "$PERF_DIR/image/ctx-base"
    git -C "$REPO" archive "$commit" packages/App packages/Common | tar -x -C "$PERF_DIR/image/ctx-base"
    docker build -q -t "$NAME:base" "$PERF_DIR/image/ctx-base"
    docker build -q -t "$NAME:branch" "$PERF_DIR/image/ctx-branch"
    echo "built $NAME:base ($commit) and $NAME:branch"
    ;;
  run)
    tag="$2"
    if [ ! -f "$PERF_DIR/app.env" ]; then
      python3 -I "$HERE/make_env.py"
    fi
    stop_app
    docker run -d --rm --name "$NAME" --network host \
      --env-file "$PERF_DIR/app.env" \
      -e "NODE_OPTIONS=--inspect=127.0.0.1:$PERF_APP_INSPECTOR" \
      "$NAME:$tag" >/dev/null
    for _ in $(seq 1 200); do
      if [ "$(curl -s -o /dev/null -w '%{http_code}' "http://localhost:$PERF_APP_PORT/api/status/ready")" = "200" ]; then
        docker inspect -f '{{.State.Pid}}' "$NAME" >"$PERF_DIR/app.pid"
        echo "$NAME:$tag ready, pid $(cat "$PERF_DIR/app.pid")"
        exit 0
      fi
      sleep 3
    done
    echo "$NAME:$tag not ready; see docker logs $NAME"
    exit 1
    ;;
  stop)
    stop_app
    echo "stopped"
    ;;
  *)
    sed -n '2,24p' "${BASH_SOURCE[0]}"
    exit 1
    ;;
esac
