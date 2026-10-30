/*
 * THE KINDS OF SENSITIVE DATA, AS A PRIVACY OR SECURITY TEAM GROUPS THEM.
 *
 * Every built-in data type belongs to one (DataTypeCatalog.ts), and so does
 * every custom one a project defines. The Overview counts stores by these,
 * the Sensitive Data page groups by them, and residency rules name them.
 */
enum DataCategory {
  ContactAndIdentity = "Contact and identity",
  GovernmentId = "Government ID",
  Financial = "Financial",
  Health = "Health",
  SecretsAndCredentials = "Secrets and credentials",
  SpecialCategory = "Special category",
  BusinessConfidential = "Business confidential",
}

export default DataCategory;

export const ALL_DATA_CATEGORIES: ReadonlyArray<DataCategory> = [
  DataCategory.SecretsAndCredentials,
  DataCategory.Financial,
  DataCategory.Health,
  DataCategory.GovernmentId,
  DataCategory.SpecialCategory,
  DataCategory.ContactAndIdentity,
  DataCategory.BusinessConfidential,
];

export const DATA_CATEGORY_DESCRIPTION: Readonly<Record<DataCategory, string>> =
  {
    [DataCategory.ContactAndIdentity]:
      "Who someone is and how to reach them: email, phone, address, date of birth, IP address.",
    [DataCategory.GovernmentId]:
      "National identity, tax, passport and social security numbers.",
    [DataCategory.Financial]:
      "Card numbers, bank accounts, IBANs and crypto wallets.",
    [DataCategory.Health]:
      "Medical record numbers, health identifiers, diagnoses and prescriptions.",
    [DataCategory.SecretsAndCredentials]:
      "Passwords, API keys, tokens and private keys that unlock other systems.",
    [DataCategory.SpecialCategory]:
      "What GDPR Article 9 protects most: ethnicity, religion, sexual orientation, politics, union membership, biometric and genetic data.",
    [DataCategory.BusinessConfidential]:
      "Documents marked confidential, internal only or privileged.",
  };

/*
 * Whether data of this category is personal data - about a person - in the
 * sense GDPR, CCPA, LGPD and DPDP use. Secrets and business documents are not
 * about anyone, so a store holding only those is out of a privacy
 * framework's scope (but never out of a security one's).
 */
export const PERSONAL_DATA_CATEGORIES: ReadonlyArray<DataCategory> = [
  DataCategory.ContactAndIdentity,
  DataCategory.GovernmentId,
  DataCategory.Financial,
  DataCategory.Health,
  DataCategory.SpecialCategory,
];

export function isDataCategory(value: unknown): value is DataCategory {
  return (
    typeof value === "string" &&
    (ALL_DATA_CATEGORIES as ReadonlyArray<string>).includes(value)
  );
}

export function isPersonalDataCategory(category: DataCategory): boolean {
  return PERSONAL_DATA_CATEGORIES.includes(category);
}
