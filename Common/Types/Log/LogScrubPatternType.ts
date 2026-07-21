enum LogScrubPatternType {
  Email = "email",
  CreditCard = "creditCard",
  SSN = "ssn",
  PhoneNumber = "phoneNumber",
  IPAddress = "ipAddress",
  /*
   * Key-targeted: scrubs the WHOLE value of any attribute whose KEY looks
   * sensitive (password, token, apiKey, authorization, cookie, ...) —
   * catches secrets whose values match no shape-based pattern. Applies to
   * attributes only; body text has no keys to match.
   */
  SensitiveKeys = "sensitiveKeys",
  Custom = "custom",
}

export default LogScrubPatternType;
