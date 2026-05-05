export function getHostInstallationMarkdown(data: {
  oneuptimeUrl: string;
  apiKey: string;
}): string {
  return `
## Prerequisites

- A Linux, macOS or Windows host you want to monitor
- The OpenTelemetry Collector binary or container image (e.g. \`otel/opentelemetry-collector-contrib\`)

## What gets reported

Hosts are auto-discovered from the OTel \`host.name\` resource attribute. Once your collector forwards any of:

- \`hostmetrics\` receiver metrics (CPU, memory, disk, filesystem, network, load, processes), OR
- \`process\` scraper metrics (per-process CPU/memory/threads), OR
- Logs / traces tagged with \`host.id\`, \`host.arch\`, \`os.type\`, \`container.runtime\`, or \`k8s.cluster.name\`

…OneUptime will register the host automatically and start populating the Overview, Metrics, Processes, and Logs tabs.

## Quick Start

Drop this into \`config.yaml\` for your collector:

\`\`\`yaml
receivers:
  hostmetrics:
    collection_interval: 30s
    scrapers:
      cpu:
        metrics:
          system.cpu.utilization:
            enabled: true
      memory:
        metrics:
          system.memory.utilization:
            enabled: true
      disk:
      filesystem:
        metrics:
          system.filesystem.utilization:
            enabled: true
      load:
      network:
      processes:
      paging:
      process:
        mute_process_name_error: true
        mute_process_exe_error: true
        mute_process_io_error: true
        metrics:
          process.cpu.utilization:
            enabled: true
          process.memory.utilization:
            enabled: true

processors:
  resourcedetection:
    detectors: [system, env]
    system:
      hostname_sources: [os]
      resource_attributes:
        host.name:
          enabled: true
        host.id:
          enabled: true
        host.arch:
          enabled: true
        os.type:
          enabled: true
        os.description:
          enabled: true
  batch:

exporters:
  otlphttp/oneuptime:
    endpoint: ${data.oneuptimeUrl}/otlp
    headers:
      x-oneuptime-token: ${data.apiKey}

service:
  pipelines:
    metrics:
      receivers: [hostmetrics]
      processors: [resourcedetection, batch]
      exporters: [otlphttp/oneuptime]
\`\`\`

## Run the collector

\`\`\`bash
docker run -d \\
  --name otel-collector \\
  --restart unless-stopped \\
  --network host \\
  --pid host \\
  -v $(pwd)/config.yaml:/etc/otelcol-contrib/config.yaml:ro \\
  --volume /:/hostfs:ro,rslave \\
  -e HOST_PROC=/hostfs/proc \\
  -e HOST_SYS=/hostfs/sys \\
  -e HOST_ETC=/hostfs/etc \\
  -e HOST_VAR=/hostfs/var \\
  -e HOST_RUN=/hostfs/run \\
  -e HOST_DEV=/hostfs/dev \\
  otel/opentelemetry-collector-contrib:latest \\
  --config /etc/otelcol-contrib/config.yaml
\`\`\`

\`--network host\` and the \`/hostfs\` bind mount let the \`hostmetrics\` receiver read CPU, memory, disk, and process information from the host kernel rather than the container.

## What you can do next

- Open the Hosts list in OneUptime — your host appears automatically once the first metric batch lands.
- The **Metrics** tab visualizes \`system.*\` series time-series.
- The **Processes** tab lists processes ordered by CPU once the \`process\` scraper is enabled.
- The **Logs** tab streams any logs whose resource attributes include \`host.name\`.
`;
}
