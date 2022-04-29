import { Column, Entity, Index } from 'typeorm';
import Role from '../Types/Role';
import BaseModel from './BaseModel';
import SSO from './SsoConfig';

@Entity({
       name: "User"
})
export default class User extends BaseModel {

       @Column({ type: "text", length: 100 })
       name!: string;

       @Column({ type: "text", length: 200, unique: true })
       email!: string;

       @Column({ type: "text", length: 200 })
       temporaryEmail!: string;

       @Column({ type: "text", length: 200 })
       password!: string;

       @Column({ type: "boolean" })
       isEmailVerified!: boolean;

       @Column()
       sso!: SSO

       @Column({ type: "text", length: 200 })
       companyName!: string;

       @Column({ type: "text", length: 100 })
       companyRole!: string;

       @Column({ type: "text", length: 100 })
       companySize!: string;

       @Column({ type: "text", length: 100 })
       referral!: string;

       @Column({ type: "text", length: 200 })
       companyPhoneNumber!: string;

       @Column({ type: "text", length: 200 })
       profilePic!: string;


       @Column()
       twoFactorAuthEnabled!: boolean;

       @Column()
       twoFactorSecretCode!: string;

       @Column()
       otpauth_url!: URL;

       @Column()
       backupCodes!: Array<string>;

       @Column()
       jwtRefreshToken!: string;

       @Column()
       stripeCustomer!: string;

       @Column()
       resetPasswordToken!: string;

       @Column()
       resetPasswordExpires!: string;

       @Column()
       timezone!: string;

       @Column()
       lastActive!: Date;

       @Column()
       coupon!: string;

       @Column()
       disabled!: boolean;

       @Column()
       paymentFailedDate!: Date

       @Column()
       role!: Role

       @Column()
       isBlocked!: boolean;






       @Column()
       deletedByUser!: User;

       @Column()
       alertPhoneNumber!: string

       @Column()
       alertPhoneVerificationCode!: string

       @Column()
       alertPhoneVerificationCodeRequestTime!: Date

       @Column()
       tempAlertPhoneNumber!: string;


       @Column()
       createdBy: User;

}









