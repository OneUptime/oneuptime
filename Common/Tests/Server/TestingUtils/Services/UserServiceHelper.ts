import CompanySize from "Common/Types/Company/CompanySize";
import JobRole from "Common/Types/Company/JobRole";
import Faker from "Common/Utils/Faker";
import User from "Common/Models/DatabaseModels/User";
import Email from "../../../../Types/Email";
import DatabaseCommonInteractionProps from "../../../../Types/BaseDatabase/DatabaseCommonInteractionProps";
import UserService from "../../../../Server/Services/UserService";

export interface UserData {
  email?: Email;
}

export default class UserTestService {
  public static async genrateAndSaveRandomUser(
    data: UserData | null,
    props: DatabaseCommonInteractionProps,
  ): Promise<User> {
    const user: User = UserTestService.generateRandomUser(data || undefined);

    return await UserService.create({
      data: user,
      props,
    });
  }

  public static generateRandomUser(userData?: UserData | undefined): User {
    const user: User = new User();
    user.name = Faker.generateUserFullName();
    user.slug = user.name.toString();

    if (userData?.email) {
      user.email = userData.email;
    } else {
      user.email = Faker.generateEmail();
    }

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

    return user;
  }
}
