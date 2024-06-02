import Email from '../Types/Email';
import Name from '../Types/Name';
import Phone from '../Types/Phone';
import { faker } from '@faker-js/faker';

export default class Faker {
    public static generateName(): string {
        return faker.string.alphanumeric(10);
    }

    public static generateCompanyName(): string {
        return faker.company.name();
    }

    public static randomNumbers(count: number): string {
        const randomNumbers: Array<number> = [];
        for (let i: number = 0; i < count; i++) {
            randomNumbers.push(Math.floor(Math.random() * 10)); // You can adjust the range as needed
        }
        return randomNumbers.join('');
    }

    public static generateUserFullName(): Name {
        return new Name(faker.person.fullName());
    }

    public static generateEmail(): Email {
        return new Email(faker.internet.email());
    }

    public static generatePhone(): Phone {
        let phoneNumber: string = faker.phone.number();
        // remove "-" and " " from the phone number
        phoneNumber = phoneNumber.replace(/-/g, '');

        if (phoneNumber.includes(' ')) {
            // get the first part, second part is usually the extension. We don't need that.
            phoneNumber = phoneNumber.split(' ')[0] as string;
        }

        return new Phone(phoneNumber);
    }
}
