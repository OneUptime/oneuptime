import User from 'Model/Models/User';
import Faker from 'Common/Tests/TestingUtils/Faker';
import CompanySize from 'Common/Types/Company/CompanySize';
import JobRole from 'Common/Types/Company/JobRole';
import PostgresDatabase from '../../../Infrastructure/PostgresDatabase';
import { Service as UserService } from '../../../Services/UserService';

export default class UserTestService {
    private database: PostgresDatabase;
    public constructor(database: PostgresDatabase) {
        this.database = database;
    }
    public async generateRandomUser(): Promise<User> {
        const user: User = new User();
        user.name = Faker.generateUserFullName();
        user.email = Faker.generateEmail();
        user.companyName = Faker.generateCompanyName();
        user.companySize = CompanySize.OneToTen;
        user.jobRole = JobRole.CEO;
        user.companyPhoneNumber = Faker.generatePhone();
        user.twoFactorAuthEnabled = false;
        user.lastActive = new Date();
        user.isDisabled = false;
        user.isBlocked = false;
        user.isMasterAdmin = false;
        const userService: UserService = new UserService(this.database);
        const savedUser: User = await userService.create({
            data: user,
            props: { isRoot: true },
        });

        return savedUser;
    }
}
