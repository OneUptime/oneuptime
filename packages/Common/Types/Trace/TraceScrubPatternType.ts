enum TraceScrubPatternType {
  Email = "email",
  CreditCard = "creditCard",
  SSN = "ssn",
  PhoneNumber = "phoneNumber",
  IPAddress = "ipAddress",
  /*
   * What Data Security calls a postal code (#11502): a UK postcode and a
   * Canadian postal code, and a US ZIP code beside a word that names it or
   * alone under a key that names it, such as `address.zip`.
   */
  PostalCode = "postalCode",
  /*
   * What Data Security calls a precise location (#11502): a latitude and
   * longitude pair, and one coordinate beside a word that names it or
   * alone under a key that names it, such as `location.lat`.
   */
  Coordinates = "coordinates",
  /*
   * Key-targeted: scrubs the WHOLE value of any attribute whose KEY looks
   * sensitive (password, token, apiKey, authorization, cookie, ...) —
   * catches secrets whose values match no shape-based pattern. Applies to
   * span, event and link attributes only - the keys inside a list or map
   * value included; span names have no keys to match.
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

export default TraceScrubPatternType;
