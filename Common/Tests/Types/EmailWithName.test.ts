import type Email from '../../Types/Email';
import EmailWithName from '../../Types/EmailWithName';
import BadDataException from '../../Types/Exception/BadDataException';
import Faker from '../../Utils/Faker';

describe('class EmailWithName', () => {
    test('new EmailWithName() should return valid object if valid name and email is given', () => {
        const name: string = Faker.generateName();
        const email: Email = Faker.generateEmail();
        expect(new EmailWithName(name, email).name).toEqual(name);
        expect(new EmailWithName(name, email).email).toEqual(email);
    });
    test('EmailWithName.name should be mutable', () => {
        const newName: string = Faker.generateName();
        const emailWithName: EmailWithName = new EmailWithName(
            Faker.generateName(),
            Faker.generateEmail().toString()
        );
        emailWithName.name = newName;
        expect(emailWithName.name).toEqual(newName);
    });
    test('EmailWithName.email should be mutable', () => {
        const newEmail: Email = Faker.generateEmail();
        const emailWithName: EmailWithName = new EmailWithName(
            Faker.generateName(),
            Faker.generateEmail()
        );
        emailWithName.email = newEmail;
        expect(emailWithName.email).toEqual(newEmail);
    });
    test('mutating EmailWithName.email with invalid email should throw BadDataException', () => {
        const emailWithName: EmailWithName = new EmailWithName(
            Faker.generateName(),
            Faker.generateEmail()
        );
        emailWithName.email = 'janedoe@example.com';
        expect(() => {
            emailWithName.email = 'Invalid email';
        }).toThrowError(BadDataException);
    });

    test('EmailWithName.toString() should return the name with email', () => {
        const name: string = Faker.generateName();
        const email: Email = Faker.generateEmail();
        expect(new EmailWithName(name, email).toString()).toEqual(
            `"${name}" <${email}>`
        );
    });
});
