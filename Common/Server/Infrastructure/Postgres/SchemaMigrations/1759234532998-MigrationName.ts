import { MigrationInterface, QueryRunner } from "typeorm";

export class RenameUserTwoFactorAuthToUserTotpAuth1759234532998 implements MigrationInterface {
    public name = 'RenameUserTwoFactorAuthToUserTotpAuth1759234532998'

    public async up(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.renameTable("UserTwoFactorAuth", "UserTotpAuth");
    }

    public async down(queryRunner: QueryRunner): Promise<void> {
        await queryRunner.renameTable("UserTotpAuth", "UserTwoFactorAuth");
    }

}
