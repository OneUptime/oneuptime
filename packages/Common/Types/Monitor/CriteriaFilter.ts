import MetricCriteriaContext from "./MetricMonitor/MetricCriteriaContext";
import MonitorMetricType from "./MonitorMetricType";
import MonitorType from "./MonitorType";

export enum CheckOn {
  ResponseTime = "Response Time (in ms)",
  PacketLossPercent = "Packet Loss (in %)",
  Jitter = "Jitter (in ms)",
  PortDnsLookupTime = "Port DNS Lookup Time (in ms)",
  PortTcpConnectTime = "Port TCP Connect Time (in ms)",
  ResponseStatusCode = "Response Status Code",
  ResponseHeader = "Response Header",
  ResponseHeaderValue = "Response Header Value",
  ResponseBody = "Response Body",
  IsOnline = "Is Online",
  IncomingRequest = "Incoming Request",
  ServerProcessName = "Server Process Name",
  ServerProcessCommand = "Server Process Command",
  ServerProcessPID = "Server Process PID",
  RequestBody = "Request Body",
  RequestHeader = "Request Header",
  RequestHeaderValue = "Request Header Value",
  JavaScriptExpression = "JavaScript Expression",
  DiskUsagePercent = "Disk Usage (in %)",
  CPUUsagePercent = "CPU Usage (in %)",
  MemoryUsagePercent = "Memory Usage (in %)",
  LoadAverage1Min = "Load Average (1 minute)",
  LoadAverage5Min = "Load Average (5 minute)",
  LoadAverage15Min = "Load Average (15 minute)",
  SwapUsagePercent = "Swap Usage (in %)",
  CPUIoWaitPercent = "CPU IO Wait (in %)",
  ExpiresInHours = "Expires In Hours",
  ExpiresInDays = "Expires In Days",
  IsSelfSignedCertificate = "Is Self Signed Certificate",
  IsExpiredCertificate = "Is Expired Certificate",
  IsValidCertificate = "Is Valid Certificate",
  IsNotAValidCertificate = "Is Not A Valid Certificate",
  IsRequestTimeout = "Is Request Timeout",

  // Custom code or synthetic monitor.
  ResultValue = "Result Value",
  Error = "Error",
  ExecutionTime = "Execution Time (in ms)",

  // synthetic monitors

  ScreenSizeType = "Screen Size",
  BrowserType = "Browser Type",

  // Log monitors.
  LogCount = "Log Count",

  // Security event monitors.
  SecurityEventCount = "Security Event Count",

  // Trace monitors.
  SpanCount = "Span Count",

  /*
   * AI / LLM monitors (MonitorStepLlmMonitor says what makes an answer
   * bad). Stored in monitor criteria; never rename one.
   */
  LlmBadAnswerPercent = "Bad AI Answers (in %)",
  LlmBadAnswerCount = "Bad AI Answers",
  LlmAnswerCount = "AI Answers",

  // Exception monitors.
  ExceptionCount = "Exception Count",

  // Profile monitors.
  ProfileCount = "Profile Count",
  /*
   * The share of the window's time (or memory) spent in code whose frame
   * matches the monitor's function (MonitorStepProfileMonitor.functionName):
   * a function's share of CPU that jumps after a deploy. Stored in monitor
   * criteria; never rename it.
   */
  ProfileFunctionShare = "Function Share (in %)",

  // Metric Monitors.
  MetricValue = "Metric Value",

  // Incoming Email monitors.
  EmailSubject = "Email Subject",
  EmailFrom = "Email From Address",
  EmailBody = "Email Body",
  EmailTo = "Email To Address",
  EmailReceivedAt = "Email Received",

  // SNMP monitors.
  SnmpOidValue = "SNMP OID Value",
  SnmpOidExists = "SNMP OID Exists",
  /*
   * How fast a counter OID (Counter32, Counter64) grew, per second, between
   * the device's last two polls that read it. A counter only ever grows
   * until it wraps or the device restarts, so its value against a threshold
   * stays crossed once crossed: its rate is what says how busy, how lossy
   * or how full of errors something is now. Not evaluated until the device
   * has been polled twice, nor on a poll whose counter went backwards.
   */
  SnmpOidRatePerSecond = "SNMP OID Rate (per second)",
  SnmpResponseTime = "SNMP Response Time (in ms)",
  /*
   * Device reachability: true when the device answered ping OR its SNMP
   * walk succeeded. The label predates ping-first polling; the value is
   * load-bearing (stored in monitor criteria) so it stays as it is.
   */
  SnmpIsOnline = "SNMP Device Is Online",
  /*
   * The SNMP walk itself. Not evaluated at all on a poll that ran no walk
   * (a device without credentials), so "is False" means "the walk was
   * attempted and failed" - credentials, agent, or an ACL - never "there
   * was nothing to walk".
   */
  SnmpWalkIsSucceeding = "SNMP Walk Is Succeeding",
  SnmpInterfaceIsDown = "SNMP Interface Is Down",
  SnmpTrapReceived = "SNMP Trap Received (Trap OID)",
  SnmpInterfaceUtilizationPercent = "SNMP Interface Utilization (in %)",
  SnmpInterfaceErrorsPerSecond = "SNMP Interface Errors (per second)",
  /*
   * A column of a walked SNMP table (snmpMonitorOptions.tableKey and
   * tableColumnOid), compared row by row: met when any in-scope row
   * matches. snmpMonitorOptions.tableRow narrows it to one row, or "*" to
   * raise one alert per row.
   */
  SnmpTableValue = "SNMP Table Value",
  // How many rows a walked SNMP table has (or how many match tableRow).
  SnmpTableRowCount = "SNMP Table Row Count",
  /*
   * True when an in-scope row has a status outside its column's healthy
   * values - the values a table definition (usually a vendor template)
   * declares as "fine". One criteria covers a whole tunnel or fan table
   * without anyone restating which numbers mean up.
   */
  SnmpTableRowIsUnhealthy = "SNMP Table Row Is Unhealthy",
  /*
   * The values carried inside a trap, not its OID. Vendors that send every
   * event under one trap OID - Sophos sends all of them as sfosNotification
   * with the event text in a varbind - can only be told apart this way.
   * snmpMonitorOptions.oid optionally narrows it to one varbind.
   */
  SnmpTrapVarbindValue = "SNMP Trap Varbind Value",
  /*
   * Transceivers (SFP, SFP+, QSFP), judged port by port and scoped like the
   * interface CheckOns: snmpMonitorOptions.interfaceName narrows them to one
   * port by name or alias, and "*" raises one alert per port.
   *
   * Not detected: a port that had an optic no longer reports one, for two
   * polls in a row, while the port is still enabled.
   */
  SnmpTransceiverNotDetected = "SNMP Transceiver Not Detected",
  /*
   * A reading at or past the device's own alarm threshold, or a fault the
   * device flags (loss of signal, transmitter fault).
   */
  SnmpTransceiverPastAlarmThreshold = "SNMP Transceiver Past Alarm Threshold",
  // A reading at or past the device's warning threshold (alarms included).
  SnmpTransceiverPastWarningThreshold = "SNMP Transceiver Past Warning Threshold",
  /*
   * One reading (snmpMonitorOptions.transceiverReading: RX or TX power,
   * temperature, voltage, bias current) against a value of your own - for
   * devices that report no thresholds. Met when any lane of any optic in
   * scope matches.
   */
  SnmpTransceiverReading = "SNMP Transceiver Reading",
  /*
   * How far the received power is below its best daily average of the last
   * 30 days, in dB. Catches a fibre or an optic degrading over weeks, before
   * the link goes down.
   */
  SnmpTransceiverRxPowerDrop = "SNMP Transceiver RX Power Drop (in dB)",

  // DNS monitors.
  DnsResponseTime = "DNS Response Time (in ms)",
  DnsIsOnline = "DNS Is Online",
  DnsRecordValue = "DNS Record Value",
  DnssecIsValid = "DNSSEC Is Valid",
  DnsRecordExists = "DNS Record Exists",

  // Domain monitors.
  DomainExpiresDaysIn = "Domain Expires In Days",
  DomainRegistrar = "Domain Registrar",
  DomainNameServer = "Domain Name Server",
  DomainStatusCode = "Domain Status Code",
  DomainIsExpired = "Domain Is Expired",

  // DNSSEC monitors.
  DnssecChainValid = "DNSSEC Chain Is Valid",
  DnssecDnskeyExists = "DNSSEC DNSKEY Record Exists",
  DnssecDsExists = "DNSSEC DS Record Exists At Parent",
  DnssecSignatureExpiresInDays = "DNSSEC Signature Expires In Days",
  DnssecResolverConsensus = "DNSSEC Resolver Consensus (AD Flag)",
  DnssecNameserverConsistent = "DNSSEC Nameservers Are Consistent",

  /*
   * NTP monitors. Online is "answered this probe's request with an NTP
   * reply"; synchronized is "and the time it serves is usable" (stratum 1 to
   * 15, no leap alarm). The offset is compared whichever way the clock is
   * off, and the stratum is the effective one - a kiss-o'-death's 0 counts
   * as 16 (NtpMonitorUtil.getEffectiveStratum).
   */
  NtpIsOnline = "NTP Is Online",
  NtpIsSynchronized = "NTP Is Synchronized",
  NtpStratum = "NTP Stratum",
  NtpClockOffset = "NTP Clock Offset (in ms)",
  NtpResponseTime = "NTP Response Time (in ms)",
  /*
   * The server's own estimate of how far its time could be from the true
   * time. ntpd stops trusting a server once half its root delay plus this
   * passes 1.5 seconds, however good its stratum looks.
   */
  NtpRootDispersion = "NTP Root Dispersion (in ms)",

  // SQL Query monitors.
  SqlIsOnline = "SQL Is Online",
  SqlQueryRowCount = "SQL Query Row Count",
  SqlQueryScalarValue = "SQL Query Scalar Value",
  SqlQueryExecutionTime = "SQL Query Execution Time (in ms)",
  SqlQueryError = "SQL Query Error",

  /*
   * Database Health monitors.
   *
   * Deliberately three CheckOns rather than one per metric. The catalog
   * carries ~40 series and grows with every engine we add; putting each in
   * this enum would flood a dropdown shared with every other monitor type
   * and force a new case in five switch statements per metric. Instead
   * DatabaseMetric names the series in databaseMonitorOptions.metricType,
   * the same way Server monitors name a disk in serverMonitorOptions and
   * SNMP monitors name an OID in snmpMonitorOptions.
   */
  DatabaseIsOnline = "Database Is Online",
  DatabaseMetric = "Database Metric",
  DatabaseCollectionError = "Database Collection Error",

  // External Status Page monitors.
  ExternalStatusPageIsOnline = "External Status Page Is Online",
  ExternalStatusPageOverallStatus = "External Status Page Overall Status",
  ExternalStatusPageComponentStatus = "External Status Page Component Status",
  ExternalStatusPageActiveIncidents = "External Status Page Active Incidents",
  ExternalStatusPageResponseTime = "External Status Page Response Time (in ms)",

  /*
   * Probe Status monitors: how many of the probes a monitor watches are
   * Connected, and how many are Disconnected - nothing heard from them for
   * three minutes (Probe:UpdateConnectionStatus). Counts rather than a
   * yes/no, so one monitor can watch several probes and alert when any of
   * them, or more than you can spare, is gone. Stored in monitor criteria;
   * never rename one.
   */
  ConnectedProbes = "Connected Probes",
  DisconnectedProbes = "Disconnected Probes",
}

export interface ServerMonitorOptions {
  diskPath?: string | undefined;
}

export interface SnmpMonitorOptions {
  oid?: string | undefined;
  /*
   * Optional interface scope for the interface CheckOns (down /
   * utilization / errors). When set, only interfaces whose name or alias
   * equals this value (case-insensitive) are evaluated — so "uplink Gi0/1
   * above 80%" does not fire because an access port got busy. Empty =
   * every monitored interface, the historical behavior.
   */
  interfaceName?: string | undefined;
  /*
   * For the SNMP table CheckOns: which table (its key), which column (its
   * OID), and which rows. An empty row scope means every row, combined into
   * one alert; "*" means every row with one alert per row; anything else is
   * a row name or index.
   */
  tableKey?: string | undefined;
  tableColumnOid?: string | undefined;
  tableRow?: string | undefined;
  /*
   * For CheckOn.SnmpTransceiverReading: which reading - a
   * TransceiverReadingKind value ("rxPower", "txPower", "temperature",
   * "voltage", "biasCurrent").
   */
  transceiverReading?: string | undefined;
}

export interface DatabaseMonitorOptions {
  /*
   * Which collected series this filter compares against, e.g.
   * MonitorMetricType.DatabaseConnectionsUsedPercent. Required whenever
   * checkOn is CheckOn.DatabaseMetric; a filter without it can never be
   * met and is reported as misconfigured rather than silently ignored.
   */
  metricType?: MonitorMetricType | undefined;
}

export interface CustomCodeMonitorOptions {
  /*
   * For CheckOn.ResultValue (custom code / synthetic monitors): the field
   * inside an object/array result the filter compares against. Supports dot
   * notation and [index] array brackets (e.g. "status", "cpu_busy_percent",
   * "data.items[0].value", "results[2].status"). Object keys containing a
   * literal dot are not addressable - only "[index]" reaches into arrays.
   * Empty/undefined means "compare the whole result value" - the historical
   * behavior for primitive results, so this stays backward compatible.
   */
  resultValuePath?: string | undefined;
}

export enum EvaluateOverTimeType {
  Average = "Average",
  Sum = "Sum",
  MaximumValue = "Maximum Value",
  MunimumValue = "Minimum Value",
  AllValues = "All Values",
  AnyValue = "Any Value",
}

export enum NoDataPolicy {
  /*
   * Do not treat missing data as a breach. The criterion simply does
   * not fire. This is the safest default and matches most SaaS tooling.
   */
  Ignore = "Ignore",
  /*
   * Treat missing data points as zero. Preserves the original behavior
   * prior to this policy being configurable — useful for counters where
   * "no events" genuinely means zero.
   */
  TreatAsZero = "Treat As Zero",
  /*
   * Trigger the criterion as a breach regardless of threshold. Use for
   * heartbeat-style metrics where the absence of data is itself the
   * problem.
   */
  Trigger = "Trigger",
}

export enum AnomalyDetectionSensitivity {
  Low = "Low",
  Medium = "Medium",
  High = "High",
}

export enum AnomalyDetectionMethod {
  /** Rolling mean ± N × population standard deviation. Default. */
  MeanStddev = "Mean & Std Dev",
  /**
   * Rolling median ± N × MAD (Median Absolute Deviation × 1.4826).
   * Robust to skew (latency tails). Phase E — schema is already ready
   * but the evaluator wires it up later.
   */
  MedianMad = "Median & MAD",
}

export interface MetricAnomalyDetectionOptions {
  sensitivity?: AnomalyDetectionSensitivity | undefined;
  method?: AnomalyDetectionMethod | undefined;
  /** Days of history to compute the baseline over. Defaults to 14. */
  windowDays?: number | undefined;
  /** Minimum samples per (hour-of-week) cell to trust the baseline. */
  minSamples?: number | undefined;
}

export interface MetricMonitorOptions {
  metricAlias?: string | undefined;
  metricAggregationType?: EvaluateOverTimeType | undefined;
  /*
   * Governs how the evaluator handles the case where the metric query
   * returned zero samples in the evaluation window. Defaults to Ignore
   * when unset.
   */
  onNoDataPolicy?: NoDataPolicy | undefined;
  /*
   * Unit the user entered the threshold value in (e.g. "MB", "sec").
   * The evaluator converts the threshold into the metric's native unit
   * before comparison. When unset, the threshold is assumed to already
   * be in the metric's native unit (backward compatible).
   */
  thresholdUnit?: string | undefined;
  /*
   * Configuration for anomaly-based filter types (AnomalouslyHigh /
   * AnomalouslyLow / Anomalous). Ignored for static-threshold filters.
   */
  anomalyDetection?: MetricAnomalyDetectionOptions | undefined;
}

export enum EvaluateOverTimeMinutes {
  TwoMinutes = "2",
  ThreeMinutes = "3",
  FiveMinutes = "5",
  TenMinutes = "10",
  FifteenMinutes = "15",
  TwentyMinutes = "20",
  ThirtyMinutes = "30",
  FortyFiveMinutes = "45",
  SixtyMinutes = "60",
}

export interface EvaluateOverTimeOptions {
  timeValueInMinutes: number | undefined;
  evaluateOverTimeType: EvaluateOverTimeType | undefined;
  /*
   * Governs what happens when the evaluation window cannot back the filter -
   * either nothing was recorded in it, or the monitor has not been running
   * long enough to cover it yet. Defaults to Ignore when unset, so a filter
   * asked to look at the last N minutes waits for N minutes of data instead
   * of firing off the reading that happens to have just arrived.
   */
  onNoDataPolicy?: NoDataPolicy | undefined;
}

export interface CriteriaFilter {
  checkOn: CheckOn;
  serverMonitorOptions?: ServerMonitorOptions | undefined;
  metricMonitorOptions?: MetricMonitorOptions | undefined;
  snmpMonitorOptions?: SnmpMonitorOptions | undefined;
  databaseMonitorOptions?: DatabaseMonitorOptions | undefined;
  customCodeMonitorOptions?: CustomCodeMonitorOptions | undefined;
  filterType: FilterType | undefined;
  value: string | number | undefined;
  evaluateOverTime?: boolean | undefined;
  evaluateOverTimeOptions?: EvaluateOverTimeOptions | undefined;
  /*
   * Populated at evaluation time for metric monitors so downstream code
   * (e.g. the root cause builder) can include metric-specific context
   * like metric name, unit, filter/group-by attributes, and the series
   * that actually breached. Not persisted.
   */
  metricCriteriaContext?: MetricCriteriaContext | undefined;
}

export enum FilterType {
  EqualTo = "Equal To",
  NotEqualTo = "Not Equal To",
  GreaterThan = "Greater Than",
  LessThan = "Less Than",
  GreaterThanOrEqualTo = "Greater Than Or Equal To",
  LessThanOrEqualTo = "Less Than Or Equal To",
  Contains = "Contains",
  NotContains = "Not Contains",
  StartsWith = "Starts With",
  EndsWith = "Ends With",
  IsEmpty = "Is Empty",
  IsNotEmpty = "Is Not Empty",
  True = "True",
  False = "False",
  NotRecievedInMinutes = "Not Recieved In Minutes",
  RecievedInMinutes = "Recieved In Minutes",
  EvaluatesToTrue = "Evaluates To True",
  IsExecuting = "Is Executing",
  IsNotExecuting = "Is Not Executing",
  /*
   * Anomaly-detection filter types. The "value" field is unused —
   * sensitivity and method live in metricMonitorOptions.anomalyDetection.
   * The evaluator compares the aggregated metric to the same-hour-of-
   * week baseline computed by the MetricBaselineHourly MV.
   */
  AnomalouslyHigh = "Anomalously High",
  AnomalouslyLow = "Anomalously Low",
  Anomalous = "Anomalous",
}

export class CriteriaFilterUtil {
  /**
   * Whether the filter is anomaly-based. Anomaly filters skip the
   * static threshold value/unit fields and instead read sensitivity
   * from metricMonitorOptions.anomalyDetection.
   */
  public static isAnomalyFilterType(
    filterType: FilterType | undefined,
  ): boolean {
    return (
      filterType === FilterType.AnomalouslyHigh ||
      filterType === FilterType.AnomalouslyLow ||
      filterType === FilterType.Anomalous
    );
  }

  public static hasValueField(data: {
    checkOn: CheckOn;
    filterType: FilterType | undefined;
  }): boolean {
    const { checkOn } = data;

    /*
     * Anomaly filters carry sensitivity in metricMonitorOptions
     * (not in `value`), so suppress the threshold input.
     */
    if (CriteriaFilterUtil.isAnomalyFilterType(data.filterType)) {
      return false;
    }

    if (
      checkOn === CheckOn.IsOnline ||
      checkOn === CheckOn.SnmpIsOnline ||
      checkOn === CheckOn.SnmpWalkIsSucceeding ||
      checkOn === CheckOn.SnmpInterfaceIsDown ||
      checkOn === CheckOn.SnmpTableRowIsUnhealthy ||
      checkOn === CheckOn.SnmpTransceiverNotDetected ||
      checkOn === CheckOn.SnmpTransceiverPastAlarmThreshold ||
      checkOn === CheckOn.SnmpTransceiverPastWarningThreshold ||
      checkOn === CheckOn.DnsIsOnline ||
      checkOn === CheckOn.DomainIsExpired ||
      checkOn === CheckOn.DnssecChainValid ||
      checkOn === CheckOn.DnssecDnskeyExists ||
      checkOn === CheckOn.DnssecDsExists ||
      checkOn === CheckOn.DnssecResolverConsensus ||
      checkOn === CheckOn.DnssecNameserverConsistent ||
      checkOn === CheckOn.NtpIsOnline ||
      checkOn === CheckOn.NtpIsSynchronized ||
      checkOn === CheckOn.SqlIsOnline ||
      checkOn === CheckOn.DatabaseIsOnline ||
      checkOn === CheckOn.ExternalStatusPageIsOnline
    ) {
      return false;
    }

    if (checkOn === CheckOn.IsRequestTimeout) {
      return false;
    }

    if (
      checkOn === CheckOn.SnmpOidExists ||
      checkOn === CheckOn.DnssecIsValid ||
      checkOn === CheckOn.DnsRecordExists
    ) {
      return false;
    }

    if (
      checkOn === CheckOn.IsValidCertificate ||
      checkOn === CheckOn.IsSelfSignedCertificate ||
      checkOn === CheckOn.IsExpiredCertificate ||
      checkOn === CheckOn.IsNotAValidCertificate
    ) {
      return false;
    }

    if (
      FilterType.IsEmpty === data.filterType ||
      FilterType.IsNotEmpty === data.filterType ||
      FilterType.True === data.filterType ||
      FilterType.False === data.filterType
    ) {
      return false;
    }

    return true;
  }

  /**
   * Whether this CheckOn reads a series whose samples are 1 (true) or
   * 0 (false), such as the online series every probe writes.
   *
   * Such a series can only be judged one sample at a time. Its average, sum,
   * maximum or minimum is a number (0.6, say), and the True / False
   * comparators never match a number, so EvaluateOverTime turns its samples
   * and its Treat As Zero substitute into booleans instead.
   *
   * Keep this the only list. The dashboard dropdown and the server evaluator
   * both read it; separate copies drifted before, which left Database Is
   * Online samples as raw numbers and aggregates on offer for DNS, SNMP and
   * External Status Page.
   */
  public static isBooleanSeries(checkOn: CheckOn | undefined): boolean {
    return (
      checkOn === CheckOn.IsOnline ||
      // No series records this one yet, but it is a true/false value too.
      checkOn === CheckOn.IsRequestTimeout ||
      checkOn === CheckOn.DnsIsOnline ||
      checkOn === CheckOn.SnmpIsOnline ||
      checkOn === CheckOn.ExternalStatusPageIsOnline ||
      checkOn === CheckOn.DatabaseIsOnline ||
      checkOn === CheckOn.NtpIsOnline ||
      checkOn === CheckOn.NtpIsSynchronized
    );
  }

  // The checks of a response a Website or an API monitor gets, alike.
  private static readonly HTTP_MATCH_HISTORY_CHECK_ONS: ReadonlyArray<CheckOn> =
    [
      CheckOn.ResponseBody,
      CheckOn.ResponseHeader,
      CheckOn.ResponseHeaderValue,
      CheckOn.JavaScriptExpression,
      CheckOn.IsRequestTimeout,
    ];

  /*
   * The checks that keep a match history, per monitor type - see
   * hasMatchHistory. Read through getMatchHistoryCheckOns, never directly,
   * so a copy cannot drift from it.
   */
  private static readonly MATCH_HISTORY_CHECK_ONS: Partial<
    Record<MonitorType, ReadonlyArray<CheckOn>>
  > = {
    [MonitorType.Website]: CriteriaFilterUtil.HTTP_MATCH_HISTORY_CHECK_ONS,
    [MonitorType.API]: CriteriaFilterUtil.HTTP_MATCH_HISTORY_CHECK_ONS,
    [MonitorType.Ping]: [CheckOn.IsRequestTimeout],
    [MonitorType.IP]: [CheckOn.IsRequestTimeout],
    [MonitorType.Port]: [CheckOn.IsRequestTimeout],
  };

  /**
   * Whether this filter, evaluated over a period of time, is judged from
   * its match history: whether it matched, check by check.
   *
   * Nothing records a response body, a header or a JavaScript expression as
   * a series, so there is no value to look back over the way Response Time
   * has one. What can be recorded is whether the filter matched: on every
   * check of such a filter OneUptime writes 1 or 0 for it
   * (CriteriaFilterMatchHistory on the server), and All Values / Any Value
   * then judge the window from that record. That is how "the body has not
   * contained 'App Title' for 5 minutes" is told apart from a restarting
   * app's one placeholder page (issue #4686).
   *
   * Per monitor type, because "every check over the last N minutes" needs a
   * schedule to measure against: these are monitors a probe checks on their
   * monitoring interval. The criteria form offers the checkbox from this and
   * the evaluator decides how to judge the filter from it, so the two cannot
   * disagree.
   */
  public static hasMatchHistory(data: {
    checkOn: CheckOn | undefined;
    monitorType: MonitorType | undefined;
  }): boolean {
    if (!data.checkOn) {
      return false;
    }

    return CriteriaFilterUtil.getMatchHistoryCheckOns(
      data.monitorType,
    ).includes(data.checkOn);
  }

  // The checks of a monitor type that keep a match history, in form order.
  public static getMatchHistoryCheckOns(
    monitorType: MonitorType | undefined,
  ): Array<CheckOn> {
    if (!monitorType) {
      return [];
    }

    return [...(CriteriaFilterUtil.MATCH_HISTORY_CHECK_ONS[monitorType] || [])];
  }

  /**
   * Whether an over-time window of this check is judged one check at a
   * time: a 1 / 0 series (isBooleanSeries), or a check judged from its
   * match history (hasMatchHistory). Either way every check is a yes or a
   * no, so the window is offered All Values and Any Value only - an average
   * of "contained the text" means nothing - and an aggregate saved on it
   * through the API or Terraform is judged as All Values
   * (getEffectiveEvaluateOverTimeType).
   *
   * Pass the monitor type whenever it is known: a JavaScript Expression
   * keeps a match history on an API monitor but not on a SQL Query monitor,
   * whose window the server does not judge check by check. Without one, a
   * check that keeps a match history on any monitor type counts.
   */
  public static isJudgedCheckByCheck(
    checkOn: CheckOn | undefined,
    monitorType?: MonitorType | undefined,
  ): boolean {
    return (
      CriteriaFilterUtil.isBooleanSeries(checkOn) ||
      CriteriaFilterUtil.keepsMatchHistory(checkOn, monitorType)
    );
  }

  /*
   * A window's length in minutes, 0 when it has none. The dashboard has
   * saved it as a string, the API and Terraform send a number.
   */
  public static getEvaluateOverTimeMinutes(
    criteriaFilter: CriteriaFilter | undefined,
  ): number {
    const minutes: number = Number(
      criteriaFilter?.evaluateOverTimeOptions?.timeValueInMinutes,
    );

    return Number.isFinite(minutes) && minutes > 0 ? minutes : 0;
  }

  /**
   * Whether a filter is judged over a window, for everything that describes
   * it. A check that keeps a match history (keepsMatchHistory) is judged
   * from it only with a window of some minutes; with the box ticked and no
   * minutes - through the API, or a cleared dropdown - it is judged on the
   * latest check, as it always was, so nothing should describe a window for
   * it. Every other filter is evaluated over time whenever its box is
   * ticked.
   */
  public static isEvaluatedOverTime(
    criteriaFilter: CriteriaFilter | undefined,
    monitorType?: MonitorType | undefined,
  ): boolean {
    if (!criteriaFilter?.evaluateOverTime) {
      return false;
    }

    if (
      CriteriaFilterUtil.keepsMatchHistory(criteriaFilter.checkOn, monitorType)
    ) {
      return CriteriaFilterUtil.getEvaluateOverTimeMinutes(criteriaFilter) > 0;
    }

    return true;
  }

  /**
   * hasMatchHistory for a caller that may not know the monitor type: with
   * one, whether the check keeps a match history on that monitor; without
   * one, whether it does on any.
   */
  public static keepsMatchHistory(
    checkOn: CheckOn | undefined,
    monitorType?: MonitorType | undefined,
  ): boolean {
    if (!checkOn) {
      return false;
    }

    if (monitorType) {
      return CriteriaFilterUtil.hasMatchHistory({
        checkOn: checkOn,
        monitorType: monitorType,
      });
    }

    return Object.values(CriteriaFilterUtil.MATCH_HISTORY_CHECK_ONS).some(
      (checkOns: ReadonlyArray<CheckOn> | undefined): boolean => {
        return Boolean(checkOns?.includes(checkOn));
      },
    );
  }

  /**
   * The evaluation type a filter is actually judged with.
   *
   * This only differs from the saved type on a check judged check by check
   * (isJudgedCheckByCheck) that was saved with Average, Sum, Maximum Value
   * or Minimum Value. The dashboard does not offer those there, but older
   * filters, and filters sent through the API or Terraform, can still carry
   * them. They are judged as All Values: the stricter of the two choices, so
   * the filter fires only when the whole window agrees rather than off a
   * single sample.
   */
  public static getEffectiveEvaluateOverTimeType(
    criteriaFilter: CriteriaFilter | undefined,
    monitorType?: MonitorType | undefined,
  ): EvaluateOverTimeType | undefined {
    const evaluateOverTimeType: EvaluateOverTimeType | undefined =
      criteriaFilter?.evaluateOverTimeOptions?.evaluateOverTimeType;

    if (
      !evaluateOverTimeType ||
      evaluateOverTimeType === EvaluateOverTimeType.AllValues ||
      evaluateOverTimeType === EvaluateOverTimeType.AnyValue ||
      !CriteriaFilterUtil.isJudgedCheckByCheck(
        criteriaFilter?.checkOn,
        monitorType,
      )
    ) {
      return evaluateOverTimeType;
    }

    return EvaluateOverTimeType.AllValues;
  }

  public static getEvaluateOverTimeTypeByCriteriaFilter(
    criteriaFilter: CriteriaFilter | undefined,
    monitorType?: MonitorType | undefined,
  ): Array<EvaluateOverTimeType> {
    if (!criteriaFilter) {
      return [];
    }

    if (
      CriteriaFilterUtil.isJudgedCheckByCheck(
        criteriaFilter.checkOn,
        monitorType,
      )
    ) {
      return [EvaluateOverTimeType.AllValues, EvaluateOverTimeType.AnyValue];
    }

    return [
      EvaluateOverTimeType.Average,
      EvaluateOverTimeType.Sum,
      EvaluateOverTimeType.MaximumValue,
      EvaluateOverTimeType.MunimumValue,
      EvaluateOverTimeType.AllValues,
      EvaluateOverTimeType.AnyValue,
    ];
  }

  public static getInverseFilterType(filterType: FilterType): FilterType {
    switch (filterType) {
      case FilterType.GreaterThan:
        return FilterType.LessThanOrEqualTo;
      case FilterType.LessThan:
        return FilterType.GreaterThanOrEqualTo;
      case FilterType.GreaterThanOrEqualTo:
        return FilterType.LessThan;
      case FilterType.LessThanOrEqualTo:
        return FilterType.GreaterThan;
      case FilterType.EqualTo:
        return FilterType.NotEqualTo;
      case FilterType.NotEqualTo:
        return FilterType.EqualTo;
      default:
        return filterType;
    }
  }

  // The transceiver CheckOns.
  public static isTransceiverCheckOn(checkOn: CheckOn | undefined): boolean {
    return (
      checkOn === CheckOn.SnmpTransceiverNotDetected ||
      checkOn === CheckOn.SnmpTransceiverPastAlarmThreshold ||
      checkOn === CheckOn.SnmpTransceiverPastWarningThreshold ||
      checkOn === CheckOn.SnmpTransceiverReading ||
      checkOn === CheckOn.SnmpTransceiverRxPowerDrop
    );
  }

  /*
   * The CheckOns scoped by snmpMonitorOptions.interfaceName - a name, an
   * alias, empty for every interface as one alert, or "*" for one alert per
   * interface. One list, read by the criteria form and the evaluator alike.
   */
  public static isInterfaceScopedCheckOn(
    checkOn: CheckOn | undefined,
  ): boolean {
    return (
      checkOn === CheckOn.SnmpInterfaceIsDown ||
      checkOn === CheckOn.SnmpInterfaceUtilizationPercent ||
      checkOn === CheckOn.SnmpInterfaceErrorsPerSecond ||
      CriteriaFilterUtil.isTransceiverCheckOn(checkOn)
    );
  }

  /**
   * Whether the criteria form offers "Evaluate this criteria over a period
   * of time" for this check.
   *
   * Every check with a recorded series is offered it, whatever the monitor.
   * The checks judged from their match history (hasMatchHistory) are
   * offered it only when the monitor type is known and keeps that history,
   * so a caller that does not pass one sees the series-backed list alone.
   */
  public static isEvaluateOverTimeFilter(
    checkOn: CheckOn,
    monitorType?: MonitorType | undefined,
  ): boolean {
    if (
      CriteriaFilterUtil.hasMatchHistory({
        checkOn: checkOn,
        monitorType: monitorType,
      })
    ) {
      return true;
    }

    return (
      checkOn === CheckOn.ResponseStatusCode ||
      checkOn === CheckOn.ResponseTime ||
      checkOn === CheckOn.PacketLossPercent ||
      checkOn === CheckOn.Jitter ||
      checkOn === CheckOn.PortDnsLookupTime ||
      checkOn === CheckOn.PortTcpConnectTime ||
      checkOn === CheckOn.DiskUsagePercent ||
      checkOn === CheckOn.CPUUsagePercent ||
      checkOn === CheckOn.MemoryUsagePercent ||
      checkOn === CheckOn.LoadAverage1Min ||
      checkOn === CheckOn.LoadAverage5Min ||
      checkOn === CheckOn.LoadAverage15Min ||
      checkOn === CheckOn.SwapUsagePercent ||
      checkOn === CheckOn.CPUIoWaitPercent ||
      checkOn === CheckOn.IsOnline ||
      checkOn === CheckOn.SnmpResponseTime ||
      checkOn === CheckOn.SnmpIsOnline ||
      checkOn === CheckOn.DnsResponseTime ||
      checkOn === CheckOn.DnsIsOnline ||
      checkOn === CheckOn.ExternalStatusPageResponseTime ||
      checkOn === CheckOn.ExternalStatusPageIsOnline ||
      /*
       * Each NTP check is one sample, and a clock that is off for one check
       * is often a slow path rather than a bad server: an offset averaged
       * over five minutes is the steadier alert.
       */
      checkOn === CheckOn.NtpIsOnline ||
      checkOn === CheckOn.NtpIsSynchronized ||
      checkOn === CheckOn.NtpStratum ||
      checkOn === CheckOn.NtpClockOffset ||
      checkOn === CheckOn.NtpResponseTime ||
      checkOn === CheckOn.NtpRootDispersion ||
      /*
       * Over time is the most useful shape for database thresholds: a single
       * sample of "connections above 90%" is a spike, five minutes of it is
       * an incident.
       */
      checkOn === CheckOn.DatabaseIsOnline ||
      checkOn === CheckOn.DatabaseMetric ||
      /*
       * Recorded every minute, so a window is the hold-down: "a probe has
       * been disconnected for 5 minutes" rides out a slow restart that the
       * three-minute connection cutoff alone would call an outage.
       */
      checkOn === CheckOn.ConnectedProbes ||
      checkOn === CheckOn.DisconnectedProbes
    );
  }
}
