import Email from '../../Types/Email';
import EmailWithName from '../../Types/EmailWithName';
import BadDataException from '../../Types/Exception/BadDataException';

describe('class EmailWithName', () => {
    test('new EmailWithName() should return valid object if valid name and email is given', () => {
        expect(
            new EmailWithName('John Doe', 'johndoe@example.com').name
        ).toEqual('John Doe');
        expect(
            new EmailWithName('John Doe', 'johndoe@example.com').email
        ).toEqual('johndoe@example.com');
        expect(
            new EmailWithName('John Doe', new Email('johndoe@example.com')).name
        ).toEqual('John Doe');
    });
    test('EmailWithName.name should be mutable', () => {
        const emailWithName: EmailWithName = new EmailWithName(
            'John Doe',
            new Email('johndoe@example.com')
        );
        emailWithName.name = 'Jane doe';
        expect(emailWithName.name).toEqual('John Doe');
    });
    test('EmailWithName.email should be mutable', () => {
        const emailWithName: EmailWithName = new EmailWithName(
            'John Doe',
            new Email('johndoe@example.com')
        );
        emailWithName.name = 'janedoe@example.com';
        expect(emailWithName.name).toEqual('janedoe@example.com');
    });
    test('mutating EmailWithName email with invalid email should throw BadDataException', () => {
        const emailWithName: EmailWithName = new EmailWithName(
            'John Doe',
            new Email('johndoe@example.com')
        );
        emailWithName.name = 'janedoe@example.com';
        expect(() => {
            emailWithName.name = 'Invalid email';
        }).toThrowError(BadDataException);
    });
});
