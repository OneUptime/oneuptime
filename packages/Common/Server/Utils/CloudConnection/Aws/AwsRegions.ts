import BadDataException from "../../../../Types/Exception/BadDataException";

/*
 * The AWS Regions a connection reads when it is not told which: every
 * commercial Region, the ones every account has and the ones an account
 * opts in to. A Region the account has not opted in to answers every call
 * as an unknown credential, and is skipped without a word; GovCloud and
 * China are separate partitions an access key of their own reads, named in
 * the connection's Regions.
 */

export const AWS_DEFAULT_REGIONS: ReadonlyArray<string> = [
  "us-east-1",
  "us-east-2",
  "us-west-1",
  "us-west-2",
  "ca-central-1",
  "sa-east-1",
  "eu-west-1",
  "eu-west-2",
  "eu-west-3",
  "eu-central-1",
  "eu-north-1",
  "ap-south-1",
  "ap-northeast-1",
  "ap-northeast-2",
  "ap-northeast-3",
  "ap-southeast-1",
  "ap-southeast-2",
];

export const AWS_OPT_IN_REGIONS: ReadonlyArray<string> = [
  "af-south-1",
  "ap-east-1",
  "ap-east-2",
  "ap-south-2",
  "ap-southeast-3",
  "ap-southeast-4",
  "ap-southeast-5",
  "ap-southeast-6",
  "ap-southeast-7",
  "ca-west-1",
  "eu-central-2",
  "eu-south-1",
  "eu-south-2",
  "il-central-1",
  "me-central-1",
  "me-south-1",
  "mx-central-1",
];

export const AWS_ALL_COMMERCIAL_REGIONS: ReadonlyArray<string> = [
  ...AWS_DEFAULT_REGIONS,
  ...AWS_OPT_IN_REGIONS,
];

/*
 * A Region code: two to four letter groups and a number, such as
 * us-east-1, eu-central-2 or us-gov-west-1. Read part by part.
 */
export function isAwsRegion(value: string): boolean {
  const parts: Array<string> = value.trim().toLowerCase().split("-");

  if (parts.length < 3 || parts.length > 4 || value.length > 25) {
    return false;
  }

  const number: string = parts[parts.length - 1]!;

  if (!number || number.length > 2) {
    return false;
  }

  for (const character of number) {
    if (character < "0" || character > "9") {
      return false;
    }
  }

  for (const part of parts.slice(0, -1)) {
    if (!part) {
      return false;
    }

    for (const character of part) {
      if (character < "a" || character > "z") {
        return false;
      }
    }
  }

  return true;
}

// The Regions a connection names, checked; at most 40.
export function validateAwsRegions(regions: Array<string>): void {
  if (regions.length > 40) {
    throw new BadDataException("Regions can list at most 40 Regions.");
  }

  for (const region of regions) {
    if (!isAwsRegion(region)) {
      throw new BadDataException(
        `"${region.slice(0, 40)}" is not an AWS Region. Use codes such as us-east-1 or eu-central-1.`,
      );
    }
  }
}
