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
  /*
   * Key-targeted too: scrubs the WHOLE value of the attributes it names
   * (LogScrubRule.attributeKeys) - by exact key or by a dotted prefix,
   * customer_name, user.full_name, request.headers - whatever the value is
   * (#10366). For a type found by field names alone, which no pattern finds.
   */
  NamedKeys = "namedKeys",
  Custom = "custom",
}

export default LogScrubPatternType;
