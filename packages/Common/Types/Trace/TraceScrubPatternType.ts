enum TraceScrubPatternType {
  Email = "email",
  CreditCard = "creditCard",
  SSN = "ssn",
  PhoneNumber = "phoneNumber",
  IPAddress = "ipAddress",
  /*
   * Key-targeted: scrubs the WHOLE value of any attribute whose KEY looks
   * sensitive (password, token, apiKey, authorization, cookie, ...) —
   * catches secrets whose values match no shape-based pattern. Applies to
   * span, event and link attributes only - the keys inside a list or map
   * value included; span names have no keys to match.
   */
  SensitiveKeys = "sensitiveKeys",
  Custom = "custom",
}

export default TraceScrubPatternType;
