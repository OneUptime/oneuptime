// This type holds detailed error context for when a request fails
// This helps users understand exactly where and why a request failed

export enum RequestFailedPhase {
  // DNS resolution failed - could not resolve hostname to IP
  DNSResolution = "DNS Resolution",
  // TCP connection failed - could not establish connection to server
  TCPConnection = "TCP Connection",
  // TLS/SSL handshake failed
  TLSHandshake = "TLS Handshake",
  // Request was sent but timed out waiting for response
  RequestTimeout = "Request Timeout",
  // Server responded with an error status code
  ServerResponse = "Server Response",
  // Request was aborted
  RequestAborted = "Request Aborted",
  // Network error - general network failure
  NetworkError = "Network Error",
  // Certificate error
  CertificateError = "Certificate Error",
  // Unknown error
  Unknown = "Unknown",
}

export default interface RequestFailedDetails {
  // The phase at which the request failed
  failedPhase: RequestFailedPhase;
  // The error code from axios/node (e.g., ECONNREFUSED, ETIMEDOUT, ENOTFOUND, etc.)
  errorCode?: string | undefined;
  // A detailed, user-friendly explanation of what went wrong
  errorDescription: string;
  // The raw error message (for debugging purposes)
  rawErrorMessage?: string | undefined;
}
