/*
 * How the probes' claims - the monitors a probe checks next
 * (MonitorProbeService.claimMonitorProbesForProbing) and the network
 * devices it polls next (NetworkDeviceService.claimDevicesForPolling) -
 * treat a row that is due but that nothing may hand out right now: a
 * paused, archived or in-maintenance monitor, a device with polling off or
 * no address, anything of a suspended, blocked, sample or deleted project.
 *
 * Each claim walks its probe's rows in the order of a (probeId, ...,
 * next-due) index and only ever moves the rows it hands out. A row nothing
 * may hand out therefore kept the next-due time it had when it stopped being
 * claimable - the oldest on the probe - and sat at the head of that index for
 * good, where every claim stepped over it, and over every other one like it,
 * before reaching a row it could hand out: from every worker of every probe
 * replica, every minute. A claim's cost grew with the number of paused
 * monitors and suspended projects, not with its batch - on a probe with
 * 60,000 monitor probes, 24,000 of them paused or in a suspended project,
 * 372 ms and 39,774 buffers to hand out 200 monitors, all from cache - and a
 * fleet whose probes autoscale on their pending count made more of those
 * claims the further behind it fell.
 *
 * So after a claim, the rows it stepped over are set aside: their next-due
 * time moves SET_ASIDE_FOR_MINUTES on, plus up to SET_ASIDE_SPREAD_IN_MINUTES
 * picked per row, so rows set aside together do not all come due again in
 * the same instant. Each is judged again in the statement that moves it, by
 * the same rule the claim hands rows out by, so a row the claim would hand
 * out is never one it moves.
 *
 * Making a row claimable again does not wait for this: turning a monitor
 * back on (MonitorService) or a device's polling back on, its address or
 * its probe (NetworkDeviceService) makes it due at once. A project that is
 * served again - paid, unblocked - has its rows picked up the next time
 * they come due, within SET_ASIDE_FOR_MINUTES plus the spread.
 */
export const SET_ASIDE_FOR_MINUTES: number = 15;
export const SET_ASIDE_SPREAD_IN_MINUTES: number = 5;

/*
 * The most rows one set-aside statement moves, and how many such statements
 * one claim runs while each moves a full batch - so a claim sets aside at
 * most SET_ASIDE_PER_CLAIM x SET_ASIDE_ROUNDS_PER_CLAIM rows.
 *
 * Bounds each statement, and the work a claim does before it answers. A
 * backlog - everything that stopped being claimable before set-aside
 * existed, on a probe's first claims after an upgrade - drains over a few
 * claims. And it keeps the head clean in steady state: rows set aside come
 * due again every SET_ASIDE_FOR_MINUTES plus the spread, and a probe whose
 * workers claim three times a minute can set aside 6,000 a minute, enough
 * for every probe short of one with ~100,000 rows nothing may claim.
 */
export const SET_ASIDE_PER_CLAIM: number = 500;
export const SET_ASIDE_ROUNDS_PER_CLAIM: number = 4;
