enum MetricDashboardMetricType {
  // HTTP metrics
  HttpRequestDuration = "http.server.request.duration",
  HttpRequestCount = "http.server.request.count",
  HttpRequestErrorRate = "http.server.request.error.rate",
  HttpResponseSize = "http.server.response.body.size",
  HttpRequestSize = "http.server.request.body.size",
  HttpActiveRequests = "http.server.active_requests",

  // System metrics
  SystemCpuUtilization = "system.cpu.utilization",
  SystemMemoryUsage = "system.memory.usage",
  SystemDiskIo = "system.disk.io",
  SystemNetworkIo = "system.network.io",

  // Runtime metrics
  ProcessCpuUtilization = "process.cpu.utilization",
  ProcessMemoryUsage = "process.runtime.jvm.memory.usage",
  GcDuration = "process.runtime.jvm.gc.duration",
  ThreadCount = "process.runtime.jvm.threads.count",

  // Custom application metrics
  CustomCounter = "custom.counter",
  CustomGauge = "custom.gauge",
  CustomHistogram = "custom.histogram",
}

export default MetricDashboardMetricType;
