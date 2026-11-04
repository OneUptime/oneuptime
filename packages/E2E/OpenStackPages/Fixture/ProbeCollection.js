/*
 * A cloud a probe collects, as the fixture holds it: the probes it can pick, the rows the
 * server keeps of how a collection went, and what each connection test answers. Every word the
 * probe writes here is the one it writes for that failure (Probe/Utils/OpenStack), and every
 * value is made up: the credentials, addresses and fingerprints are nobody's.
 */
import BaseModel from "Common/Models/DatabaseModels/DatabaseBaseModel/DatabaseBaseModel";
import OpenStackAuthUrl from "Common/Utils/OpenStack/OpenStackAuthUrl";
import { MINUTE, uuid } from "./Data";

export const NOVA_FINGERPRINT =
  "AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89";
export const KEYSTONE_FINGERPRINT =
  "01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF:01:23:45:67:89:AB:CD:EF";

export const PROBES = [
  { _id: uuid("75000000", 1), name: "acme-dc-probe" },
  { _id: uuid("75000000", 2), name: "acme-eu-probe" },
];

export const SHARED_PROBES = [
  { _id: uuid("75000000", 3), name: "this-instance-probe" },
];

const UNTRUSTED_CERTIFICATE = {
  fingerprint256: NOVA_FINGERPRINT,
  subject: "CN=nova.acme-cloud.example",
  issuer: "CN=Acme Cloud CA",
  isSelfSigned: false,
  validTo: "2028-01-01T00:00:00.000Z",
  host: "nova.acme-cloud.example",
  port: 8774,
};

const SUMMARY = {
  credentialKind: "applicationCredential",
  regionNames: ["RegionOne"],
  services: [
    {
      service: "compute",
      regionName: "RegionOne",
      outcome: "Succeeded",
      requestCount: 12,
    },
    {
      service: "network",
      regionName: "RegionOne",
      outcome: "Succeeded",
      requestCount: 8,
    },
  ],
  hypervisorCount: 12,
  instanceCount: 240,
  networkCount: 18,
  volumeCount: 96,
  projectCount: 7,
  warnings: [],
};

const PLAIN_HTTP_MESSAGE =
  "The catalog puts Compute (Nova), Networking (Neutron) on plain HTTP, such as http://nova.acme-cloud.example:8774/v2.1. A credential's token is never sent unencrypted, so the probe read none of them. Turn on TLS for these APIs, pick another endpoint interface, or use the OpenStack agent for this cloud.";

// How a collection went, as the server keeps it on the cloud's row.
export function collectionOf(name, at) {
  const collected = {
    lastCollectionAt: new Date(at - MINUTE),
    lastSuccessfulCollectionAt: new Date(at - MINUTE),
    collectionError: undefined,
    collectionErrorCode: undefined,
    presentedCertificate: undefined,
  };

  switch (name) {
    case "checking":
      return {
        ...collected,
        collectionStatus: "Pending",
        lastCollectionAt: undefined,
        lastSuccessfulCollectionAt: undefined,
        collectionSummary: undefined,
      };
    case "partial":
      return {
        ...collected,
        collectionStatus: "PartiallySucceeded",
        collectionErrorCode: "ServiceOverloaded",
        collectionError:
          "Networking (Neutron) kept answering HTTP 503, so the probe stopped asking for a while.",
        collectionSummary: {
          ...SUMMARY,
          services: [
            SUMMARY.services[0],
            {
              service: "network",
              regionName: "RegionOne",
              outcome: "BackingOff",
              errorMessage: "Neutron kept answering HTTP 503.",
              requestCount: 3,
            },
            {
              service: "volume",
              regionName: "RegionOne",
              outcome: "Refused",
              errorMessage: "Cinder answered HTTP 403 to volumes.",
              requestCount: 1,
            },
            {
              service: "image",
              regionName: "RegionOne",
              outcome: "NotDeployed",
              requestCount: 0,
            },
          ],
          warnings: ["Keystone's list_limit cut the project list at 100."],
        },
      };
    case "untrusted":
      return {
        ...collected,
        collectionStatus: "Failed",
        lastSuccessfulCollectionAt: undefined,
        collectionErrorCode: "UntrustedCertificate",
        collectionError:
          "nova.acme-cloud.example's certificate is not trusted by the probe, so nothing was sent to it.",
        presentedCertificate: UNTRUSTED_CERTIFICATE,
        collectionSummary: undefined,
      };
    case "plain-http":
      return {
        ...collected,
        collectionStatus: "Failed",
        lastSuccessfulCollectionAt: undefined,
        collectionErrorCode: "InsecureEndpoint",
        collectionError: PLAIN_HTTP_MESSAGE,
        collectionSummary: undefined,
      };
    default:
      return {
        ...collected,
        collectionStatus: "Succeeded",
        collectionSummary: SUMMARY,
      };
  }
}

// The estate's cloud, with what a probe's connection saves.
export function probeCollectedCloud(cloud, collection, at) {
  return {
    ...cloud,
    agentVersion: undefined,
    collectionMethod: "Probe",
    authUrl: "https://keystone.acme-cloud.example:5000",
    endpointInterface: "public",
    collectionRegions: ["RegionOne"],
    credentialKind: "applicationCredential",
    applicationCredentialId: "4f6d2c1e9b7a4d3f8e2a1c0b5d6e7f80",
    keystoneUsername: null,
    userDomainName: null,
    projectName: null,
    projectDomainName: null,
    isCredentialSet: true,
    credentialsUpdatedAt: new Date(at - 3 * 24 * 60 * MINUTE),
    collectionProbeId: PROBES[0]._id,
    collectionProbe: { _id: PROBES[0]._id, name: PROBES[0].name },
    trustedCertificateFingerprints: null,
    collectionIntervalInMinutes: 2,
    collectionOptions: null,
    ...collectionOf(collection, at),
  };
}

const CATALOG = {
  credentialKind: "applicationCredential",
  projectName: "oneuptime-monitoring",
  roleNames: ["reader", "oneuptime_monitoring"],
  hasAccessRules: true,
  isUnrestricted: false,
  canProbablyWrite: false,
  regionsInCatalog: ["RegionOne", "RegionTwo"],
  servicesByRegion: { RegionOne: ["compute", "network"] },
  warnings: [],
};

const FULL_READS = [
  {
    regionName: "RegionOne",
    service: "compute",
    read: "hypervisors",
    access: "ReadsEverything",
  },
  {
    regionName: "RegionOne",
    service: "compute",
    read: "servers",
    access: "ReadsEverything",
  },
  {
    regionName: "RegionOne",
    service: "network",
    read: "networks",
    access: "ReadsEverything",
  },
];

// What a connection test ends as, by the name a walk asks for it.
export function connectionTestOutcome(name) {
  switch (name) {
    case "project":
      return {
        status: "Succeeded",
        summary: {
          ...CATALOG,
          accessLevel: "ProjectView",
          reads: [
            ...FULL_READS.slice(1, 2),
            {
              regionName: "RegionOne",
              service: "compute",
              read: "hypervisors",
              access: "Refused",
              reason: "HTTP 403",
              goesWithout: "The Hypervisors page and its alerts",
              fix: "openstack role add --user oneuptime --project oneuptime-monitoring oneuptime_monitoring",
            },
            {
              regionName: "RegionOne",
              service: "network",
              read: "networks",
              access: "OwnProjectOnly",
              reason: "1 project in 14 rows",
              goesWithout: "Every other project's networks",
            },
          ],
          warnings: ["Keystone's list_limit cut the project list at 100."],
        },
      };
    case "untrusted":
      return {
        status: "Failed",
        errorCode: "UntrustedCertificate",
        errorMessage:
          "nova.acme-cloud.example's certificate is not trusted by the probe, so nothing was sent to it.",
        presentedCertificate: UNTRUSTED_CERTIFICATE,
        summary: { ...CATALOG, accessLevel: "Other", reads: [] },
      };
    case "plain-http":
      return {
        status: "Failed",
        errorCode: "InsecureEndpoint",
        errorMessage: PLAIN_HTTP_MESSAGE,
        summary: {
          ...CATALOG,
          accessLevel: "Other",
          reads: [
            {
              regionName: "RegionOne",
              service: "compute",
              read: "servers",
              access: "Failing",
              reason:
                "Use https://. OneUptime never sends a credential or a token unencrypted.",
              fix: "Turn on TLS for this API, pick another endpoint interface, or use the OpenStack agent for this cloud.",
            },
          ],
        },
      };
    case "refused":
      return {
        status: "Failed",
        errorCode: "InvalidCredential",
        errorMessage: "Keystone answered HTTP 401 to the application credential.",
      };
    case "not-found":
      return {
        status: "Failed",
        errorCode: "AddressNotFound",
        errorMessage: "The probe's DNS has no address for keystone.acme.invalid.",
      };
    case "no-probe":
      return {
        status: "Failed",
        errorCode: "ProbeNotAvailable",
        errorMessage: "acme-dc-probe did not pick the test up in time.",
      };
    default:
      return {
        status: "Succeeded",
        summary: { ...CATALOG, accessLevel: "FullView", reads: FULL_READS },
      };
  }
}

// What a form or a page asked to save, as the request would carry it.
export function getWrittenValues(model, modelType) {
  const json = BaseModel.toJSONObject(model, modelType);
  const values = {};

  for (const [key, value] of Object.entries(json)) {
    if (value === null || value === undefined) {
      values[key] = value;
    } else if (value instanceof BaseModel) {
      values[key] = { _id: value._id };
    } else if (typeof value === "object" && !Array.isArray(value)) {
      // A wrapped password or an ObjectID is its text. A JSON column is itself.
      values[key] =
        value.constructor === Object ? value : String(value.toString());
    } else {
      values[key] = value;
    }
  }

  return values;
}

/*
 * A save of a cloud's row, as far as a page reads it back: a secret goes in and never comes out,
 * a new cloud is named after its address, a relation's name is the probe's, and new settings mean
 * the probe tries again.
 */
export function writeCloud(clouds, id, data, probes) {
  const written = { ...data };
  const secret = written.credentialSecret;
  delete written.credentialSecret;

  let cloud = clouds.find((candidate) => {
    return candidate._id === id;
  });

  if (!cloud) {
    cloud = {
      _id: id || uuid("71000000", 100 + clouds.length),
      otelCollectorStatus: "disconnected",
      labels: [],
      isArchived: false,
    };
    clouds.push(cloud);
  }

  if (written.authUrl) {
    written.authUrl = OpenStackAuthUrl.normalize(written.authUrl).address.url;
  }

  if (!cloud.name && !written.name) {
    written.name = OpenStackAuthUrl.getDefaultName(written.authUrl);
  }

  if (written.collectionProbe) {
    const probeId = String(written.collectionProbe._id);
    const probe = probes.find((candidate) => {
      return candidate._id === probeId;
    });
    written.collectionProbeId = probeId;
    written.collectionProbe = { _id: probeId, name: probe?.name };
  }

  if (written.collectionMethod === "Agent") {
    Object.assign(cloud, written, {
      isCredentialSet: false,
      credentialsUpdatedAt: undefined,
      collectionStatus: undefined,
      collectionErrorCode: undefined,
      collectionError: undefined,
      presentedCertificate: undefined,
      collectionSummary: undefined,
    });
    return cloud;
  }

  const isConnectionChanged =
    Boolean(secret) ||
    ["authUrl", "collectionMethod", "collectionRegions", "collectionProbeId"]
      .concat(["trustedCertificateFingerprints", "endpointInterface"])
      .some((column) => {
        return (
          written[column] !== undefined &&
          JSON.stringify(written[column]) !== JSON.stringify(cloud[column])
        );
      });

  Object.assign(cloud, written);

  if (secret) {
    cloud.isCredentialSet = true;
    cloud.credentialsUpdatedAt = new Date();
  }

  if (isConnectionChanged) {
    Object.assign(cloud, collectionOf("checking", Date.now()));
  }

  return cloud;
}
