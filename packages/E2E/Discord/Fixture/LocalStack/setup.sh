#!/bin/bash
set -euo pipefail
fixture_dir=$(cd -- "$(dirname -- "$0")" && pwd)
repo_dir=$(git -C "$fixture_dir" rev-parse --show-toplevel)
cd "$repo_dir"
node "$fixture_dir/prepare.cjs"
source_sha=$(node -p "require('$fixture_dir/source.json').head")
docker_root=$(docker info --format '{{.DockerRootDir}}')
test "$docker_root" = /var/lib/docker
test "$(df -Pk "$docker_root" | awk 'NR==2 {print $4}')" -gt 20971520
docker volume create --label com.docker.compose.project=oneuptime-discord-e2e oneuptime-discord-e2e_source >/dev/null
docker volume create --label com.docker.compose.project=oneuptime-discord-e2e --label com.docker.compose.volume=evidence oneuptime-discord-e2e_evidence >/dev/null
prior_sha=$(docker run --rm --network none -v oneuptime-discord-e2e_source:/source:ro redis:7-bookworm sh -c 'cat /source/.fixture/source-sha 2>/dev/null || true')
if [[ -n "$prior_sha" && "$prior_sha" != "$source_sha" ]]; then
  echo "Source volume belongs to another revision; use a new isolated project." >&2
  exit 1
fi
if [[ -z "$prior_sha" ]]; then
  git archive "$source_sha" | docker run --rm -i --network none -v oneuptime-discord-e2e_source:/source redis:7-bookworm tar -C /source -xf -
fi
docker run --rm --network none -v "$fixture_dir:/input:ro" -v oneuptime-discord-e2e_source:/source -v oneuptime-discord-e2e_evidence:/evidence redis:7-bookworm sh -c '
 mkdir -p /source/.fixture
 cp /input/App.Dockerfile /input/E2E.Dockerfile /source/.fixture/
 cp /input/source.json /input/FAILURES.md /evidence/
 printf "%s\n" "$1" > /source/.fixture/source-sha
' sh "$source_sha"
bash "$fixture_dir/compose.sh" config --quiet
bash "$fixture_dir/compose.sh" config --format json | node -e '
let text="";process.stdin.on("data",x=>text+=x);process.stdin.on("end",()=>{
 const c=JSON.parse(text);
 if(c.name!=="oneuptime-discord-e2e" || !c.networks.oneuptime.internal)throw Error("Wrong project or network");
 for(const [name,s]of Object.entries(c.services)){
  if(s.ports?.length || s.network_mode || s.container_name || s.image?.includes("alpine"))throw Error("Unsafe service: "+name);
  for(const v of s.volumes||[])if(v.type==="bind"&&!v.source.includes("/.scratch/discord-e2e/Clickhouse/")&&!v.source.includes("/packages/E2E/Discord")&&!v.source.endsWith("/packages/E2E/playwright.discord.config.ts"))throw Error("Unexpected bind: "+name);
 }
 for(const v of Object.values(c.volumes||{}))if(v.external)throw Error("External volume");
 console.log("Verified isolated project, internal network, zero published ports, dedicated volumes");
});'
printf 'Prepared source %s. Build commands: bash %s/build.sh App and E2E.\n' "$source_sha" "$fixture_dir"
