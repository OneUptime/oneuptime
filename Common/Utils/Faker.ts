import Email from "../Types/Email";
import Name from "../Types/Name";
import ObjectID from "../Types/ObjectID";
import Phone from "../Types/Phone";
import { faker } from "@faker-js/faker";

export default class Faker {

  public static generateRandomString(length?: number | undefined): string {
    return faker.string.alphanumeric(length || 10);
  }

  public static getNumberBetweenMinAndMax(data: {min: number, max: number}): number {
    // pick a random number between min and max
    return Math.floor(Math.random() * (data.max - data.min + 1) + data.min);
  }

  public static generateName(): string {
    return faker.string.alphanumeric(10);
  }

  public static generateCompanyName(): string {
    return faker.company.name();
  }

  public static generateRandomObjectID(): ObjectID{
    return ObjectID.generate();
  }

  public static getRandomNumbers(count: number): number {
    const randomNumbers: Array<number> = [];
    for (let i: number = 0; i < count; i++) {
      randomNumbers.push(Math.floor(Math.random() * 10)); // You can adjust the range as needed
    }
    return parseInt(randomNumbers.join(""));
  }

  public static generateUserFullName(): Name {
    return new Name(faker.person.fullName());
  }

  public static generateEmail(): Email {
    return new Email(faker.internet.email());
  }

  public static generatePhone(): Phone {
    return new Phone(this.getRandomNumbers(10).toString());
  }
}
