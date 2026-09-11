import Email from "../Types/Email";
import Name from "../Types/Name";
import ObjectID from "../Types/ObjectID";
import Phone from "../Types/Phone";

/*
 * Random values for tests and seed data.
 *
 * This deliberately does NOT use @faker-js/faker. The advisory on that package
 * (GHSA-qxc2-j82w-r537, arbitrary code execution through helpers.fake) is only
 * fixed in v10.6+, and every version from v10 ships as ESM only - which Jest,
 * running CommonJS here, cannot load. Importing it from this file therefore
 * took down whole suites in Home, App and Common, none of which use faker for
 * anything beyond the four generators below.
 *
 * They are four generators. Owning them costs less than carrying a dependency
 * with a remote-code-execution advisory into every test process, and none of
 * this needs to be cryptographically random: it exists to make one test's row
 * distinguishable from another's.
 */

const ALPHANUMERIC: string =
  "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";

const FIRST_NAMES: Array<string> = [
  "Ada",
  "Grace",
  "Alan",
  "Edsger",
  "Barbara",
  "Ken",
  "Margaret",
  "Donald",
  "Radia",
  "Leslie",
];

const LAST_NAMES: Array<string> = [
  "Lovelace",
  "Hopper",
  "Turing",
  "Dijkstra",
  "Liskov",
  "Thompson",
  "Hamilton",
  "Knuth",
  "Perlman",
  "Lamport",
];

const COMPANY_ADJECTIVES: Array<string> = [
  "Northern",
  "Atlantic",
  "Granite",
  "Harbour",
  "Meridian",
  "Copper",
];

const COMPANY_NOUNS: Array<string> = [
  "Logistics",
  "Systems",
  "Analytics",
  "Foundry",
  "Networks",
  "Works",
];

type PickFunction = <T>(values: Array<T>) => T;

const pick: PickFunction = <T>(values: Array<T>): T => {
  return values[Math.floor(Math.random() * values.length)] as T;
};

export default class Faker {
  public static generateRandomString(length?: number | undefined): string {
    const size: number = length || 10;
    let value: string = "";

    for (let index: number = 0; index < size; index++) {
      value += ALPHANUMERIC.charAt(
        Math.floor(Math.random() * ALPHANUMERIC.length),
      );
    }

    return value;
  }

  public static getNumberBetweenMinAndMax(data: {
    min: number;
    max: number;
  }): number {
    // pick a random number between min and max
    return Math.floor(Math.random() * (data.max - data.min + 1) + data.min);
  }

  public static generateName(): string {
    return this.generateRandomString(10);
  }

  public static generateCompanyName(): string {
    return `${pick(COMPANY_ADJECTIVES)} ${pick(COMPANY_NOUNS)}`;
  }

  public static generateRandomObjectID(): ObjectID {
    return ObjectID.generate();
  }

  public static getRandomNumbers(count: number): number {
    const randomNumbers: Array<number> = [];
    for (let i: number = 0; i < count; i++) {
      // pick a random number between 1 and 9
      randomNumbers.push(Math.floor(Math.random() * 9) + 1);
    }
    return parseInt(randomNumbers.join(""));
  }

  public static generateUserFullName(): Name {
    return new Name(`${pick(FIRST_NAMES)} ${pick(LAST_NAMES)}`);
  }

  public static generateEmail(): Email {
    /*
     * Lowercased, and the local part always starts with a letter: Email
     * validates what it is given and throws on anything it does not accept, so
     * a generator that can emit an invalid address would fail a caller at
     * random rather than at a fixed input.
     */
    const localPart: string = `${pick(FIRST_NAMES).toLowerCase()}.${this.generateRandomString(
      8,
    ).toLowerCase()}`;

    return new Email(`${localPart}@example.com`);
  }

  public static generatePhone(): Phone {
    return new Phone(this.getRandomNumbers(10).toString());
  }
}
