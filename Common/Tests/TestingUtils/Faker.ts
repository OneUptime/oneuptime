import { faker } from '@faker-js/faker';
import Email from '../../Types/Email';
import Name from '../../Types/Name';
import Phone from '../../Types/Phone';

export default class Faker {
    public static generateName(): string {
        return faker.name.firstName();
    }

    public static generateCompanyName(): string {
        return faker.company.companyName();
    }

    public static random16Numbers(): string {
        return faker.random.numeric(16);
    }

    public static generateUserFullName(): Name {
        return new Name(faker.name.firstName() + ' ' + faker.name.lastName());
    }

    public static generateEmail(): Email {
        return new Email(faker.internet.email());
    }

    public static generatePhone(): Phone {
        return new Phone(faker.phone.phoneNumber());
    }
}
