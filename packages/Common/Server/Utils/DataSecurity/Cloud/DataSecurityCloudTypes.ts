import { DataStoreAccessEntry } from "../../../../Types/DataSecurity/DataStoreAccess";
import { DataStoreKind } from "../../../../Types/DataSecurity/DataStoreKind";
import { DataStorePostureFacts } from "../../../../Types/DataSecurity/DataStorePosture";

/*
 * WHAT A CLOUD'S DATA SECURITY READER RETURNS.
 *
 * One reader per provider (Aws/AwsDataSecurityReader.ts,
 * Azure/AzureDataSecurityReader.ts, Gcp/GcpDataSecurityReader.ts) reads,
 * with the connection's opt-in data-security permissions, every data store
 * of the connection's accounts: its configuration as posture facts
 * (Types/DataSecurity/DataStorePosture.ts), who can reach it, its tags and
 * size. What it could not read - a permission the role lacks, an API not
 * enabled - becomes a null fact and a warning, never a guess and never a
 * failed read.
 *
 * A reader that can sample content also hands out an ObjectStoreReader per
 * bucket or container, so the content scanner (ObjectStoreSampler.ts)
 * never needs to know which cloud it reads.
 */

export interface CloudDataStoreIdentity {
  kind: DataStoreKind;
  // The bucket, database, dataset or account name.
  name: string;
  // An ARN, an Azure resource id, a Google Cloud resource name.
  providerResourceId: string;
  // The AWS account id, Azure subscription id or Google Cloud project id.
  accountNumber: string;
  region?: string | undefined;
}

export interface CloudDataStoreRead {
  identity: CloudDataStoreIdentity;
  posture: DataStorePostureFacts;
  access: Array<DataStoreAccessEntry>;
  tags?: Record<string, string> | undefined;
  sizeInBytes?: number | undefined;
  objectCount?: number | undefined;
  lastActivityAt?: Date | undefined;
}

export interface CloudDataSecurityReadResult {
  stores: Array<CloudDataStoreRead>;
  warnings: Array<string>;
  // Whether every account and region the connection covers was read.
  complete: boolean;
}

export interface ObjectStoreObject {
  key: string;
  sizeInBytes: number;
  lastModified?: Date | undefined;
  etag?: string | undefined;
}

export interface ObjectStoreListPage {
  objects: Array<ObjectStoreObject>;
  nextToken?: string | undefined;
}

/*
 * One bucket or container, read: a page of its object names, or the first
 * bytes of one object. Implementations bound every request and throw the
 * provider's own errors, which the sampler records as warnings.
 */
export interface ObjectStoreReader {
  // What the reader reads, for scan logs: "s3://bucket", "gs://bucket".
  readonly description: string;
  listObjects(options: {
    prefix?: string | undefined;
    nextToken?: string | undefined;
    maxKeys: number;
  }): Promise<ObjectStoreListPage>;
  // The first maxBytes of an object: a ranged read, never the whole object.
  readObjectStart(key: string, maxBytes: number): Promise<Uint8Array>;
}

/*
 * What a response action did to a store - block its public access, revoke
 * its sharing - in every cloud: whether anything changed (false when it was
 * already safe), and a sentence for the playbook run's log.
 */
export interface DataSecurityResponseOutcome {
  changed: boolean;
  summary: string;
}
