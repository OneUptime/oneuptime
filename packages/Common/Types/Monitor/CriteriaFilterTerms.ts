import { CheckOn, EvaluateOverTimeType, FilterType } from "./CriteriaFilter";
import { translationKey } from "../Translator";

/*
 * EVERY CHECK, CONDITION AND EVALUATION OVER TIME, AS A KEY THE DASHBOARD'S
 * LOCALE FILES WORD (issue #6542).
 *
 * A criteria filter's check ("Response Status Code"), its condition
 * ("Greater Than") and how it reads a window ("Average") are stored as
 * their English values, and the Dashboard words them as terms where it
 * shows them: the evaluation log's sentences (EvaluationSentence), its
 * "Check:" and "Condition:" lines, an incident's evaluation details. A term
 * is looked up by its English, so each must be a key; this catalog marks
 * them all (the string extractor reads it as a "keys" root). Keyed by the
 * enums, so a new value does not compile until it is here too.
 */

export const CHECK_ON_TERMS: Readonly<Record<CheckOn, string>> = {
  [CheckOn.ResponseTime]: translationKey("Response Time (in ms)"),
  [CheckOn.PacketLossPercent]: translationKey("Packet Loss (in %)"),
  [CheckOn.Jitter]: translationKey("Jitter (in ms)"),
  [CheckOn.PortDnsLookupTime]: translationKey("Port DNS Lookup Time (in ms)"),
  [CheckOn.PortTcpConnectTime]: translationKey("Port TCP Connect Time (in ms)"),
  [CheckOn.ResponseStatusCode]: translationKey("Response Status Code"),
  [CheckOn.ResponseHeader]: translationKey("Response Header"),
  [CheckOn.ResponseHeaderValue]: translationKey("Response Header Value"),
  [CheckOn.ResponseBody]: translationKey("Response Body"),
  [CheckOn.IsOnline]: translationKey("Is Online"),
  [CheckOn.IncomingRequest]: translationKey("Incoming Request"),
  [CheckOn.ServerProcessName]: translationKey("Server Process Name"),
  [CheckOn.ServerProcessCommand]: translationKey("Server Process Command"),
  [CheckOn.ServerProcessPID]: translationKey("Server Process PID"),
  [CheckOn.RequestBody]: translationKey("Request Body"),
  [CheckOn.RequestHeader]: translationKey("Request Header"),
  [CheckOn.RequestHeaderValue]: translationKey("Request Header Value"),
  [CheckOn.JavaScriptExpression]: translationKey("JavaScript Expression"),
  [CheckOn.DiskUsagePercent]: translationKey("Disk Usage (in %)"),
  [CheckOn.CPUUsagePercent]: translationKey("CPU Usage (in %)"),
  [CheckOn.MemoryUsagePercent]: translationKey("Memory Usage (in %)"),
  [CheckOn.LoadAverage1Min]: translationKey("Load Average (1 minute)"),
  [CheckOn.LoadAverage5Min]: translationKey("Load Average (5 minute)"),
  [CheckOn.LoadAverage15Min]: translationKey("Load Average (15 minute)"),
  [CheckOn.SwapUsagePercent]: translationKey("Swap Usage (in %)"),
  [CheckOn.CPUIoWaitPercent]: translationKey("CPU IO Wait (in %)"),
  [CheckOn.ExpiresInHours]: translationKey("Expires In Hours"),
  [CheckOn.ExpiresInDays]: translationKey("Expires In Days"),
  [CheckOn.IsSelfSignedCertificate]: translationKey(
    "Is Self Signed Certificate",
  ),
  [CheckOn.IsExpiredCertificate]: translationKey("Is Expired Certificate"),
  [CheckOn.IsValidCertificate]: translationKey("Is Valid Certificate"),
  [CheckOn.IsNotAValidCertificate]: translationKey(
    "Is Not A Valid Certificate",
  ),
  [CheckOn.IsRevokedCertificate]: translationKey("Is Revoked Certificate"),
  [CheckOn.IsRequestTimeout]: translationKey("Is Request Timeout"),
  [CheckOn.ResultValue]: translationKey("Result Value"),
  [CheckOn.Error]: translationKey("Error"),
  [CheckOn.ExecutionTime]: translationKey("Execution Time (in ms)"),
  [CheckOn.ScreenSizeType]: translationKey("Screen Size"),
  [CheckOn.BrowserType]: translationKey("Browser Type"),
  [CheckOn.LogCount]: translationKey("Log Count"),
  [CheckOn.SecurityEventCount]: translationKey("Security Event Count"),
  [CheckOn.SpanCount]: translationKey("Span Count"),
  [CheckOn.LlmBadAnswerPercent]: translationKey("Bad AI Answers (in %)"),
  [CheckOn.LlmBadAnswerCount]: translationKey("Bad AI Answers"),
  [CheckOn.LlmAnswerCount]: translationKey("AI Answers"),
  [CheckOn.ExceptionCount]: translationKey("Exception Count"),
  [CheckOn.NewExceptionCount]: translationKey("New Exceptions"),
  [CheckOn.RegressedExceptionCount]: translationKey("Regressed Exceptions"),
  [CheckOn.ExceptionCountIncreasePercent]: translationKey(
    "Exception Increase (in %)",
  ),
  [CheckOn.ProfileCount]: translationKey("Profile Count"),
  [CheckOn.ProfileFunctionShare]: translationKey("Function Share (in %)"),
  [CheckOn.MetricValue]: translationKey("Metric Value"),
  [CheckOn.EmailSubject]: translationKey("Email Subject"),
  [CheckOn.EmailFrom]: translationKey("Email From Address"),
  [CheckOn.EmailBody]: translationKey("Email Body"),
  [CheckOn.EmailTo]: translationKey("Email To Address"),
  [CheckOn.EmailReceivedAt]: translationKey("Email Received"),
  [CheckOn.SnmpOidValue]: translationKey("SNMP OID Value"),
  [CheckOn.SnmpOidExists]: translationKey("SNMP OID Exists"),
  [CheckOn.SnmpOidRatePerSecond]: translationKey("SNMP OID Rate (per second)"),
  [CheckOn.SnmpResponseTime]: translationKey("SNMP Response Time (in ms)"),
  [CheckOn.SnmpIsOnline]: translationKey("SNMP Device Is Online"),
  [CheckOn.SnmpWalkIsSucceeding]: translationKey("SNMP Walk Is Succeeding"),
  [CheckOn.SnmpInterfaceIsDown]: translationKey("SNMP Interface Is Down"),
  [CheckOn.SnmpTrapReceived]: translationKey("SNMP Trap Received (Trap OID)"),
  [CheckOn.SnmpInterfaceUtilizationPercent]: translationKey(
    "SNMP Interface Utilization (in %)",
  ),
  [CheckOn.SnmpInterfaceErrorsPerSecond]: translationKey(
    "SNMP Interface Errors (per second)",
  ),
  [CheckOn.SnmpTableValue]: translationKey("SNMP Table Value"),
  [CheckOn.SnmpTableRowCount]: translationKey("SNMP Table Row Count"),
  [CheckOn.SnmpTableRowIsUnhealthy]: translationKey(
    "SNMP Table Row Is Unhealthy",
  ),
  [CheckOn.SnmpTrapVarbindValue]: translationKey("SNMP Trap Varbind Value"),
  [CheckOn.SnmpTransceiverNotDetected]: translationKey(
    "SNMP Transceiver Not Detected",
  ),
  [CheckOn.SnmpTransceiverPastAlarmThreshold]: translationKey(
    "SNMP Transceiver Past Alarm Threshold",
  ),
  [CheckOn.SnmpTransceiverPastWarningThreshold]: translationKey(
    "SNMP Transceiver Past Warning Threshold",
  ),
  [CheckOn.SnmpTransceiverReading]: translationKey("SNMP Transceiver Reading"),
  [CheckOn.SnmpTransceiverRxPowerDrop]: translationKey(
    "SNMP Transceiver RX Power Drop (in dB)",
  ),
  [CheckOn.DnsResponseTime]: translationKey("DNS Response Time (in ms)"),
  [CheckOn.DnsIsOnline]: translationKey("DNS Is Online"),
  [CheckOn.DnsRecordValue]: translationKey("DNS Record Value"),
  [CheckOn.DnssecIsValid]: translationKey("DNSSEC Is Valid"),
  [CheckOn.DnsRecordExists]: translationKey("DNS Record Exists"),
  [CheckOn.DomainExpiresDaysIn]: translationKey("Domain Expires In Days"),
  [CheckOn.DomainRegistrar]: translationKey("Domain Registrar"),
  [CheckOn.DomainNameServer]: translationKey("Domain Name Server"),
  [CheckOn.DomainStatusCode]: translationKey("Domain Status Code"),
  [CheckOn.DomainIsExpired]: translationKey("Domain Is Expired"),
  [CheckOn.DnssecChainValid]: translationKey("DNSSEC Chain Is Valid"),
  [CheckOn.DnssecDnskeyExists]: translationKey("DNSSEC DNSKEY Record Exists"),
  [CheckOn.DnssecDsExists]: translationKey("DNSSEC DS Record Exists At Parent"),
  [CheckOn.DnssecSignatureExpiresInDays]: translationKey(
    "DNSSEC Signature Expires In Days",
  ),
  [CheckOn.DnssecResolverConsensus]: translationKey(
    "DNSSEC Resolver Consensus (AD Flag)",
  ),
  [CheckOn.DnssecNameserverConsistent]: translationKey(
    "DNSSEC Nameservers Are Consistent",
  ),
  [CheckOn.NtpIsOnline]: translationKey("NTP Is Online"),
  [CheckOn.NtpIsSynchronized]: translationKey("NTP Is Synchronized"),
  [CheckOn.NtpStratum]: translationKey("NTP Stratum"),
  [CheckOn.NtpClockOffset]: translationKey("NTP Clock Offset (in ms)"),
  [CheckOn.NtpResponseTime]: translationKey("NTP Response Time (in ms)"),
  [CheckOn.NtpRootDispersion]: translationKey("NTP Root Dispersion (in ms)"),
  [CheckOn.SqlIsOnline]: translationKey("SQL Is Online"),
  [CheckOn.SqlQueryRowCount]: translationKey("SQL Query Row Count"),
  [CheckOn.SqlQueryScalarValue]: translationKey("SQL Query Scalar Value"),
  [CheckOn.SqlQueryExecutionTime]: translationKey(
    "SQL Query Execution Time (in ms)",
  ),
  [CheckOn.SqlQueryError]: translationKey("SQL Query Error"),
  [CheckOn.DatabaseIsOnline]: translationKey("Database Is Online"),
  [CheckOn.DatabaseMetric]: translationKey("Database Metric"),
  [CheckOn.DatabaseCollectionError]: translationKey(
    "Database Collection Error",
  ),
  [CheckOn.ExternalStatusPageIsOnline]: translationKey(
    "External Status Page Is Online",
  ),
  [CheckOn.ExternalStatusPageOverallStatus]: translationKey(
    "External Status Page Overall Status",
  ),
  [CheckOn.ExternalStatusPageComponentStatus]: translationKey(
    "External Status Page Component Status",
  ),
  [CheckOn.ExternalStatusPageActiveIncidents]: translationKey(
    "External Status Page Active Incidents",
  ),
  [CheckOn.ExternalStatusPageResponseTime]: translationKey(
    "External Status Page Response Time (in ms)",
  ),
  [CheckOn.ConnectedProbes]: translationKey("Connected Probes"),
  [CheckOn.DisconnectedProbes]: translationKey("Disconnected Probes"),
};

export const FILTER_TYPE_TERMS: Readonly<Record<FilterType, string>> = {
  [FilterType.EqualTo]: translationKey("Equal To"),
  [FilterType.NotEqualTo]: translationKey("Not Equal To"),
  [FilterType.GreaterThan]: translationKey("Greater Than"),
  [FilterType.LessThan]: translationKey("Less Than"),
  [FilterType.GreaterThanOrEqualTo]: translationKey("Greater Than Or Equal To"),
  [FilterType.LessThanOrEqualTo]: translationKey("Less Than Or Equal To"),
  [FilterType.Contains]: translationKey("Contains"),
  [FilterType.NotContains]: translationKey("Not Contains"),
  [FilterType.StartsWith]: translationKey("Starts With"),
  [FilterType.EndsWith]: translationKey("Ends With"),
  [FilterType.IsEmpty]: translationKey("Is Empty"),
  [FilterType.IsNotEmpty]: translationKey("Is Not Empty"),
  [FilterType.True]: translationKey("True"),
  [FilterType.False]: translationKey("False"),
  [FilterType.NotRecievedInMinutes]: translationKey("Not Recieved In Minutes"),
  [FilterType.RecievedInMinutes]: translationKey("Recieved In Minutes"),
  [FilterType.EvaluatesToTrue]: translationKey("Evaluates To True"),
  [FilterType.IsExecuting]: translationKey("Is Executing"),
  [FilterType.IsNotExecuting]: translationKey("Is Not Executing"),
  [FilterType.AnomalouslyHigh]: translationKey("Anomalously High"),
  [FilterType.AnomalouslyLow]: translationKey("Anomalously Low"),
  [FilterType.Anomalous]: translationKey("Anomalous"),
  [FilterType.ForecastAbove]: translationKey("Forecast Above"),
  [FilterType.ForecastBelow]: translationKey("Forecast Below"),
};

export const EVALUATE_OVER_TIME_TERMS: Readonly<
  Record<EvaluateOverTimeType, string>
> = {
  [EvaluateOverTimeType.Average]: translationKey("Average"),
  [EvaluateOverTimeType.Sum]: translationKey("Sum"),
  [EvaluateOverTimeType.MaximumValue]: translationKey("Maximum Value"),
  [EvaluateOverTimeType.MunimumValue]: translationKey("Minimum Value"),
  [EvaluateOverTimeType.AllValues]: translationKey("All Values"),
  [EvaluateOverTimeType.AnyValue]: translationKey("Any Value"),
};
