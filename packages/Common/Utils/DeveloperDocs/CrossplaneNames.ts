/*
 * How the OneUptime Crossplane provider names its kinds and their fields,
 * worked out in the browser, so the dashboard's Developer > Crossplane pages
 * write the names the generated provider has.
 *
 * The provider is generated from the Terraform provider with Upjet
 * (Scripts/CrossplaneProvider). Its kinds are named by internal/kinds
 * (StaticFiles/internal/kinds/kinds.go), and its fields by Upjet's
 * pkg/types/name, which this file ports function for function:
 *
 *   - a kind is the Terraform resource's name without `oneuptime_`, in
 *     CamelCase with Upjet's acronyms in capitals (AI, API, SLO, ID and the
 *     rest), and Definition added when it would end in Spec, Status or List:
 *     oneuptime_monitor_status is MonitorStatusDefinition;
 *   - a field is the Terraform attribute in lowerCamelCase, without the
 *     acronyms: monitor_status_id is monitorStatusId;
 *   - a field that holds another record's ID takes a reference as well,
 *     `<field>Ref` (`<field>Refs` for a list of IDs) and `<field>Selector`;
 *   - a secret the manifest gives is read from a Secret, `<field>SecretRef`.
 *
 * Common/Tests/Utils/DeveloperDocs/CrossplaneNames.test.ts holds these to
 * the cases internal/kinds' own Go test pins, and CrossplaneProviderContract
 * to the generator's references and secrets for every resource.
 */

// The API group of every kind, and the version of the managed resources.
export const CROSSPLANE_GROUP: string = "crossplane.oneuptime.com";
export const CROSSPLANE_RESOURCE_VERSION: string = "v1alpha1";
// The version of ProviderConfig and ClusterProviderConfig.
export const CROSSPLANE_PROVIDER_CONFIG_VERSION: string = "v1beta1";

export const CROSSPLANE_RESOURCE_API_VERSION: string = `${CROSSPLANE_GROUP}/${CROSSPLANE_RESOURCE_VERSION}`;
export const CROSSPLANE_PROVIDER_CONFIG_API_VERSION: string = `${CROSSPLANE_GROUP}/${CROSSPLANE_PROVIDER_CONFIG_VERSION}`;

// Every Terraform resource's name starts with it (kinds.ResourcePrefix).
const TERRAFORM_PREFIX: string = "oneuptime_";

/*
 * The endings Upjet gives a kind's own Go types (<Kind>Spec, <Kind>Status,
 * <Kind>List): a kind that ends in one gets Definition added
 * (kinds.reservedEndings).
 */
const RESERVED_KIND_ENDINGS: ReadonlyArray<string> = ["Spec", "Status", "List"];

/*
 * Upjet's lower -> camel exceptions (pkg/types/name/name.go's init), word
 * for word: the words a kind writes in capitals.
 */
const UPJET_ACRONYMS: Readonly<Record<string, string>> = {
  ipv6: "IPv6",
  ipv4: "IPv4",
  acl: "ACL",
  adm: "ADM",
  ai: "AI",
  alb: "ALB",
  ami: "AMI",
  api: "API",
  apns: "APNS",
  ascii: "ASCII",
  bgp: "BGP",
  ca: "CA",
  cloudformation: "CloudFormation",
  cpu: "CPU",
  css: "CSS",
  dhcp: "DHCP",
  dicom: "DICOM",
  dkim: "DKIM",
  dns: "DNS",
  dnssec: "DNSSEC",
  ebs: "EBS",
  ec2: "EC2",
  efs: "EFS",
  eip: "EIP",
  elb: "ELB",
  eof: "EOF",
  fhir: "FHIR",
  fsx: "FSX",
  gcp: "GCP",
  gcm: "GCM",
  graphql: "GraphQL",
  grpc: "GRPC",
  guid: "GUID",
  haproxy: "HAProxy",
  hsm: "HSM",
  ipset: "IPSet",
  iscsi: "ISCSI",
  hl7: "HL7",
  html: "HTML",
  http: "HTTP",
  https: "HTTPS",
  hmac: "HMAC",
  iam: "IAM",
  id: "ID",
  ip: "IP",
  json: "JSON",
  kms: "KMS",
  lb: "LB",
  ml: "ML",
  mysql: "MySQL",
  nat: "NAT",
  nfs: "NFS",
  nodejs: "NodeJS",
  openid: "OpenID",
  php: "PHP",
  qps: "QPS",
  ram: "RAM",
  rds: "RDS",
  rpc: "RPC",
  saml: "SAML",
  sla: "SLA",
  slo: "SLO",
  smb: "SMB",
  sms: "SMS",
  smtp: "SMTP",
  sql: "SQL",
  ssh: "SSH",
  ssl: "SSL",
  tcp: "TCP",
  tls: "TLS",
  ttl: "TTL",
  udp: "UDP",
  ui: "UI",
  gid: "GID",
  uid: "UID",
  uuid: "UUID",
  uri: "URI",
  url: "URL",
  utf8: "UTF8",
  vm: "VM",
  voip: "VoIP",
  vpc: "VPC",
  vpn: "VPN",
  xml: "XML",
  xmpp: "XMPP",
  xsrf: "XSRF",
  xss: "XSS",
  sip: "SIP",
  rtp: "RTP",
  amqp: "AMQP",
  db: "DB",
  ts: "TS",
};

function isUpperAscii(character: string): boolean {
  return character >= "A" && character <= "Z";
}

function isLowerAscii(character: string): boolean {
  return character >= "a" && character <= "z";
}

function isDigitAscii(character: string): boolean {
  return character >= "0" && character <= "9";
}

/*
 * iancoleman/strcase's ToCamel (v0.3.0, which Upjet uses), byte for byte:
 * the first letter and every letter after a digit or a separator in
 * capitals, a capital after a capital in lower case, separators dropped.
 */
export function strcaseToCamel(value: string): string {
  const text: string = value.trim();
  let result: string = "";
  let capitalizeNext: boolean = true;
  let previousIsCapital: boolean = false;

  for (let index: number = 0; index < text.length; index++) {
    let character: string = text.charAt(index);
    const isCapital: boolean = isUpperAscii(character);
    const isLower: boolean = isLowerAscii(character);

    if (capitalizeNext) {
      if (isLower) {
        character = character.toUpperCase();
      }
    } else if (index === 0) {
      if (isCapital) {
        character = character.toLowerCase();
      }
    } else if (previousIsCapital && isCapital) {
      character = character.toLowerCase();
    }

    previousIsCapital = isCapital;

    if (isCapital || isLower) {
      result += character;
      capitalizeNext = false;
    } else if (isDigitAscii(character)) {
      result += character;
      capitalizeNext = true;
    } else {
      capitalizeNext =
        character === "_" ||
        character === " " ||
        character === "-" ||
        character === ".";
    }
  }

  return result;
}

// The variants of a name Upjet works with (pkg/types/name.Name).
export interface UpjetName {
  snake: string;
  // With the acronyms: RDSInstance.
  camel: string;
  // Without them: RdsInstance.
  camelComputed: string;
  lowerCamel: string;
  // What a field's JSON name is: rdsInstance.
  lowerCamelComputed: string;
}

function lowerFirst(parts: Array<string>): string {
  if (parts.length === 0) {
    return "";
  }

  return [(parts[0] as string).toLowerCase(), ...parts.slice(1)].join("");
}

// name.NewFromSnake.
export function upjetNameFromSnake(snake: string): UpjetName {
  const originals: Array<string> = snake.split("_");
  const camels: Array<string> = [];
  const computedCamels: Array<string> = [];

  for (const original of originals) {
    const computed: string = strcaseToCamel(original);
    const known: string | undefined = Object.prototype.hasOwnProperty.call(
      UPJET_ACRONYMS,
      original.toLowerCase(),
    )
      ? UPJET_ACRONYMS[original.toLowerCase()]
      : undefined;

    computedCamels.push(computed);
    camels.push(known || computed);
  }

  return {
    snake,
    camel: camels.join(""),
    camelComputed: computedCamels.join(""),
    lowerCamel: lowerFirst(camels),
    lowerCamelComputed: lowerFirst(computedCamels),
  };
}

type CharacterClass = "lower" | "upper" | "digit" | "other";

// unicode.IsLower, IsUpper and IsDigit, which fatih/camelcase classes by.
const LOWER_CASE_LETTER: RegExp = /\p{Ll}/u;
const UPPER_CASE_LETTER: RegExp = /\p{Lu}/u;
const DECIMAL_DIGIT: RegExp = /\p{Nd}/u;

function characterClass(character: string): CharacterClass {
  if (LOWER_CASE_LETTER.test(character)) {
    return "lower";
  }

  if (UPPER_CASE_LETTER.test(character)) {
    return "upper";
  }

  if (DECIMAL_DIGIT.test(character)) {
    return "digit";
  }

  return "other";
}

/*
 * fatih/camelcase's Split, which Upjet's NewFromCamel splits a Go name with:
 * a word wherever the kind of character changes, and the last capital of a
 * run of them given to the lower case word after it ("PDFLoader" is PDF,
 * Loader).
 */
export function splitCamelCase(value: string): Array<string> {
  const runs: Array<Array<string>> = [];
  let lastClass: CharacterClass | null = null;

  for (const character of Array.from(value)) {
    const currentClass: CharacterClass = characterClass(character);

    if (currentClass === lastClass && runs.length > 0) {
      (runs[runs.length - 1] as Array<string>).push(character);
    } else {
      runs.push([character]);
    }

    lastClass = currentClass;
  }

  for (let index: number = 0; index < runs.length - 1; index++) {
    const current: Array<string> = runs[index] as Array<string>;
    const next: Array<string> = runs[index + 1] as Array<string>;

    if (
      characterClass(current[0] as string) === "upper" &&
      characterClass(next[0] as string) === "lower"
    ) {
      next.unshift(current.pop() as string);
    }
  }

  return runs
    .filter((run: Array<string>): boolean => {
      return run.length > 0;
    })
    .map((run: Array<string>): string => {
      return run.join("");
    });
}

// name.NewFromCamel.
export function upjetNameFromCamel(camel: string): UpjetName {
  return upjetNameFromSnake(
    splitCamelCase(camel)
      .map((word: string): string => {
        return word.toLowerCase();
      })
      .join("_"),
  );
}

/*
 * The kind of a Terraform resource (kinds.Of): oneuptime_status_page is
 * StatusPage, oneuptime_api_key APIKey, oneuptime_monitor_status
 * MonitorStatusDefinition.
 */
export function getCrossplaneKind(terraformTypeName: string): string {
  const kind: string = upjetNameFromSnake(
    terraformTypeName.startsWith(TERRAFORM_PREFIX)
      ? terraformTypeName.slice(TERRAFORM_PREFIX.length)
      : terraformTypeName,
  ).camel;

  return RESERVED_KIND_ENDINGS.some((ending: string): boolean => {
    return kind.endsWith(ending);
  })
    ? `${kind}Definition`
    : kind;
}

/*
 * The name a Terraform attribute has in a managed resource's spec or status
 * (kinds.FieldName): monitor_status_id is monitorStatusId.
 */
export function getCrossplaneFieldName(attribute: string): string {
  return upjetNameFromSnake(attribute).lowerCamelComputed;
}

/*
 * The field that refers to the resource whose ID an attribute holds
 * (name.ReferenceFieldName): incident_severity_id takes
 * incidentSeverityIdRef, a list of IDs such as labels takes labelsRefs.
 */
export function getCrossplaneReferenceFieldName(
  attribute: string,
  isList: boolean,
): string {
  return getCrossplaneFieldName(`${attribute}_ref${isList ? "s" : ""}`);
}

// The field that picks it by its labels instead (name.SelectorFieldName).
export function getCrossplaneSelectorFieldName(attribute: string): string {
  return getCrossplaneFieldName(`${attribute}_selector`);
}

/*
 * The field that names the Secret a secret attribute is read from
 * (types.NewSensitiveField): the attribute's Go name with SecretRef added,
 * split back into words: tls_client_key_passphrase is
 * tlsClientKeyPassphraseSecretRef.
 */
export function getCrossplaneSecretRefFieldName(attribute: string): string {
  return upjetNameFromCamel(`${upjetNameFromSnake(attribute).camel}SecretRef`)
    .lowerCamelComputed;
}
