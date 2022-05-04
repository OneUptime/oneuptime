import { faker } from '@faker-js/faker';

export default class Faker {
    public static generateName(): string {
        return faker.name.firstName();
    }
}
