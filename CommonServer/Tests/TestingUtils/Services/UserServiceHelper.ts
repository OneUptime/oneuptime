import CreateBy from "../../../Types/Database/CreateBy";
import CompanySize from "Common/Types/Company/CompanySize";
import JobRole from "Common/Types/Company/JobRole";
import Faker from "Common/Utils/Faker";
import User from "Common/Models/DatabaseModels/User";

export default class UserTestService {
  public static generateRandomUser(): CreateBy<User> {
    const user: User = new User();
    user.name = Faker.generateUserFullName();
    user.slug = user.name.toString();
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
    user.isEmailVerified = true;

    return {
      data: user,
      props: { isRoot: true },
    };
  }
}
