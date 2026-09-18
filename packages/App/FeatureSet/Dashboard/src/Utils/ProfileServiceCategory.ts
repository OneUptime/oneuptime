/**
 * Classifies a service name into one of four buckets, used by the
 * Performance Profiles dashboard to group the (often very long) service
 * list into something a developer can scan: application code first, then
 * system daemons, then host-fallback synthetic services, with kernel
 * threads pushed to a collapsible group at the bottom.
 *
 * The classification only ever consumes the service *name* — no DB
 * lookup, no resource attributes — so it's safe to call from React
 * render code.
 */
export enum ProfileServiceCategory {
  /** Real application workloads: kubelet, cilium-agent, nginx, … */
  Application = "application",
  /** Distro / OS daemons: systemd, dbus-daemon, sshd, cron … */
  System = "system",
  /** Synthesised "host/{name}" fallback when no executable is known. */
  Host = "host",
  /** Kernel threads — almost always noise for app developers. */
  Kernel = "kernel",
}

/*
 * Kernel-thread patterns. The Linux kernel re-uses a stable set of
 * thread-name prefixes; anything starting with one of these is a
 * kernel-internal worker and not something an application developer
 * cares about in a flame graph.
 *
 * We intentionally avoid the naive "starts with k" rule because real
 * userspace daemons (kubelet, ksm-server) start with k.
 */
const KERNEL_THREAD_PATTERNS: ReadonlyArray<RegExp> = [
  /^kworker\//,
  /^ksoftirqd\//,
  /^migration\//,
  /^rcu_/,
  /^cpuhp\//,
  /^idle_inject\//,
  /^irq\//,
  /^scsi_eh_/,
  /^jbd2\//,
  /^kintegrityd/,
  /^kthreadd$/,
  /^kswapd\d*$/,
  /^kcompactd\d*$/,
  /^khugepaged$/,
  /^kdevtmpfs$/,
  /^khungtaskd$/,
  /^ksmd$/,
  /^kauditd$/,
  /^kdamond$/,
  /^kthread$/,
  /^ecryptfs-kthread$/,
  /^oom_reaper$/,
  /^pool_workqueue_release$/,
  /^psimon$/,
  /^watchdogd$/,
  /^writeback$/,
  /^netns$/,
  /^cryptd$/,
];

/*
 * Userspace system daemons we generally don't want to highlight as
 * application code, but which are still meaningful when a developer
 * goes looking for them (e.g. "is systemd-journald hot?"). These stay
 * above kernel threads in the grouping order.
 */
const SYSTEM_DAEMON_PATTERNS: ReadonlyArray<RegExp> = [
  /^systemd($|-)/,
  /^dbus-daemon$/,
  /^cron$/,
  /^sshd$/,
  /^rsyslogd$/,
  /^polkitd$/,
  /^udisksd$/,
  /^multipathd$/,
  /^ModemManager$/,
  /^agetty$/,
  /^atopacctd$/,
  /^unattended-upgr/,
  /^do-(agent|node-agent|csi-plugin)$/,
  /^droplet-agent$/,
  /^containerd($|-shim)/,
  /^runc$/,
  /^cri-o$/,
  /^dockerd$/,
];

export function categorizeProfileService(name: string): ProfileServiceCategory {
  if (!name) {
    return ProfileServiceCategory.Application;
  }

  if (name.startsWith("host/")) {
    return ProfileServiceCategory.Host;
  }

  for (const re of KERNEL_THREAD_PATTERNS) {
    if (re.test(name)) {
      return ProfileServiceCategory.Kernel;
    }
  }

  for (const re of SYSTEM_DAEMON_PATTERNS) {
    if (re.test(name)) {
      return ProfileServiceCategory.System;
    }
  }

  return ProfileServiceCategory.Application;
}

/**
 * Stable display order across the four categories. Lower number = shown
 * first.
 */
export function profileServiceCategoryOrder(
  category: ProfileServiceCategory,
): number {
  switch (category) {
    case ProfileServiceCategory.Application:
      return 0;
    case ProfileServiceCategory.System:
      return 1;
    case ProfileServiceCategory.Host:
      return 2;
    case ProfileServiceCategory.Kernel:
      return 3;
    default:
      return 99;
  }
}

export function profileServiceCategoryLabel(
  category: ProfileServiceCategory,
): string {
  switch (category) {
    case ProfileServiceCategory.Application:
      return "Applications";
    case ProfileServiceCategory.System:
      return "System daemons";
    case ProfileServiceCategory.Host:
      return "Host fallbacks";
    case ProfileServiceCategory.Kernel:
      return "Kernel threads";
    default:
      return "Other";
  }
}
