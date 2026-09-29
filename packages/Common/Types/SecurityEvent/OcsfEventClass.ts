/*
 * OCSF event classes and categories — the curated subset OneUptime maps
 * ingested security events onto.
 *
 * OCSF groups event classes into categories (System Activity, Findings,
 * IAM, Network Activity, Discovery, Application Activity). Each class has a
 * stable uid; category uid is floor(class_uid / 1000). Events whose source
 * dialect has no OCSF equivalent keep class uid 0 with a source-derived
 * class name, so nothing is dropped just because it does not map.
 *
 * https://schema.ocsf.io/classes
 */
export enum OcsfCategory {
  Uncategorized = "Uncategorized",
  SystemActivity = "System Activity",
  Findings = "Findings",
  IdentityAndAccessManagement = "Identity & Access Management",
  NetworkActivity = "Network Activity",
  Discovery = "Discovery",
  ApplicationActivity = "Application Activity",
}

export const OcsfCategoryId: Record<OcsfCategory, number> = {
  [OcsfCategory.Uncategorized]: 0,
  [OcsfCategory.SystemActivity]: 1,
  [OcsfCategory.Findings]: 2,
  [OcsfCategory.IdentityAndAccessManagement]: 3,
  [OcsfCategory.NetworkActivity]: 4,
  [OcsfCategory.Discovery]: 5,
  [OcsfCategory.ApplicationActivity]: 6,
};

export interface OcsfEventClassProps {
  uid: number;
  name: string;
  category: OcsfCategory;
}

/*
 * Class uids come from the OCSF schema. The Windows extension's Registry
 * Key Activity (201001) is included because Google SecOps UDM registry
 * events are common in the wild.
 */
export const OcsfEventClasses: Array<OcsfEventClassProps> = [
  { uid: 0, name: "Base Event", category: OcsfCategory.Uncategorized },

  // System Activity (1xxx)
  {
    uid: 1001,
    name: "File System Activity",
    category: OcsfCategory.SystemActivity,
  },
  {
    uid: 1005,
    name: "Module Activity",
    category: OcsfCategory.SystemActivity,
  },
  {
    uid: 1006,
    name: "Scheduled Job Activity",
    category: OcsfCategory.SystemActivity,
  },
  {
    uid: 1007,
    name: "Process Activity",
    category: OcsfCategory.SystemActivity,
  },

  // Findings (2xxx)
  {
    uid: 2002,
    name: "Vulnerability Finding",
    category: OcsfCategory.Findings,
  },
  { uid: 2003, name: "Compliance Finding", category: OcsfCategory.Findings },
  { uid: 2004, name: "Detection Finding", category: OcsfCategory.Findings },
  { uid: 2005, name: "Incident Finding", category: OcsfCategory.Findings },

  // Identity & Access Management (3xxx)
  {
    uid: 3001,
    name: "Account Change",
    category: OcsfCategory.IdentityAndAccessManagement,
  },
  {
    uid: 3002,
    name: "Authentication",
    category: OcsfCategory.IdentityAndAccessManagement,
  },
  {
    uid: 3003,
    name: "Authorize Session",
    category: OcsfCategory.IdentityAndAccessManagement,
  },
  {
    uid: 3004,
    name: "Entity Management",
    category: OcsfCategory.IdentityAndAccessManagement,
  },
  {
    uid: 3005,
    name: "User Access Management",
    category: OcsfCategory.IdentityAndAccessManagement,
  },
  {
    uid: 3006,
    name: "Group Management",
    category: OcsfCategory.IdentityAndAccessManagement,
  },

  // Network Activity (4xxx)
  {
    uid: 4001,
    name: "Network Activity",
    category: OcsfCategory.NetworkActivity,
  },
  { uid: 4002, name: "HTTP Activity", category: OcsfCategory.NetworkActivity },
  { uid: 4003, name: "DNS Activity", category: OcsfCategory.NetworkActivity },
  { uid: 4004, name: "DHCP Activity", category: OcsfCategory.NetworkActivity },
  { uid: 4005, name: "RDP Activity", category: OcsfCategory.NetworkActivity },
  { uid: 4006, name: "SMB Activity", category: OcsfCategory.NetworkActivity },
  { uid: 4007, name: "SSH Activity", category: OcsfCategory.NetworkActivity },
  { uid: 4008, name: "FTP Activity", category: OcsfCategory.NetworkActivity },
  {
    uid: 4009,
    name: "Email Activity",
    category: OcsfCategory.NetworkActivity,
  },

  // Discovery (5xxx)
  {
    uid: 5001,
    name: "Device Inventory Info",
    category: OcsfCategory.Discovery,
  },
  {
    uid: 5002,
    name: "Device Config State",
    category: OcsfCategory.Discovery,
  },

  // Application Activity (6xxx)
  {
    uid: 6001,
    name: "Web Resources Activity",
    category: OcsfCategory.ApplicationActivity,
  },
  {
    uid: 6002,
    name: "Application Lifecycle",
    category: OcsfCategory.ApplicationActivity,
  },
  {
    uid: 6003,
    name: "API Activity",
    category: OcsfCategory.ApplicationActivity,
  },

  // Windows extension.
  {
    uid: 201001,
    name: "Registry Key Activity",
    category: OcsfCategory.SystemActivity,
  },
];

export function ocsfEventClassByUid(
  uid: number,
): OcsfEventClassProps | undefined {
  return OcsfEventClasses.find((cls: OcsfEventClassProps): boolean => {
    return cls.uid === uid;
  });
}

export function ocsfCategoryForClassUid(uid: number): {
  categoryUid: number;
  categoryName: string;
} {
  const cls: OcsfEventClassProps | undefined = ocsfEventClassByUid(uid);

  if (cls) {
    return {
      categoryUid: OcsfCategoryId[cls.category],
      categoryName: cls.category,
    };
  }

  /*
   * Unknown class uid — derive the category from the uid's thousands digit
   * when it lands on a known category, otherwise Uncategorized.
   */
  const derived: number = Math.floor(uid / 1000);
  const entries: Array<[string, number]> = Object.entries(OcsfCategoryId);

  for (const [name, value] of entries) {
    if (value === derived && value !== 0) {
      return { categoryUid: value, categoryName: name };
    }
  }

  return {
    categoryUid: OcsfCategoryId[OcsfCategory.Uncategorized],
    categoryName: OcsfCategory.Uncategorized,
  };
}
