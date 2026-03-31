enum ProfileMetricType {
  CpuProfileDuration = "oneuptime.profile.cpu.duration",
  CpuProfileSampleCount = "oneuptime.profile.cpu.sample.count",
  WallClockDuration = "oneuptime.profile.wall.duration",
  MemoryAllocationSize = "oneuptime.profile.memory.allocation.size",
  MemoryAllocationCount = "oneuptime.profile.memory.allocation.count",
  HeapUsage = "oneuptime.profile.heap.usage",
  GoroutineCount = "oneuptime.profile.goroutine.count",
  ThreadCount = "oneuptime.profile.thread.count",
  ProfileSampleRate = "oneuptime.profile.sample.rate",
  ProfileCount = "oneuptime.profile.count",
  TopFunctionCpuTime = "oneuptime.profile.top.function.cpu.time",
  TopFunctionAllocations = "oneuptime.profile.top.function.allocations",
}

export default ProfileMetricType;
