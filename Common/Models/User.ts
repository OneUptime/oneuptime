import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import SSO from './SsoConfig';

@Entity({
       name: "User"
})
export default class Model extends BaseModel {
    {

       @Column({type: "text", length: 100})
       name!: string;

       @Column({type: "text", length: 200, unique: true})
       email!: string;

       @Column({type: "text", length: 200})
       temporaryEmail!: string;

       @Column({type: "text", length: 200})
       password!: string;

       @Column({type: "boolean"})
       isEmailVerified!: boolean;

       @Column()
       sso: SSO

       @Column({type: "text", length: 200})
       companyName!: string;

       @Column({type: "text", length: 100})
       companyRole!: string;

       @Column({type: "text", length: 100})
       companySize!: string;

       @Column({type: "text", length: 100})
       referral!: string;

       @Column({type: "text", length: 200})
       companyPhoneNumber!: string;


       @Column()
       onCallAlert!: Array;

       @Column({type: "text", length: 200})
       profilePic!: string;


       @Column()
       twoFactorAuthEnabled!: boolean;

       @Column()
       twoFactorSecretCode!: string;

       @Column()
       otpauth_url!: URL;

       @Column()
       backupCodes!: Array;


       @Column()
       jwtRefreshToken!: string;

       @Column()
       stripeCustomerId!: string;

       @Column()
       resetPasswordToken!: string;

       @Column()
       resetPasswordExpires!: string;

       @Column()
       timezone!: string;

       @Column()
       lastActive!: {

              @Column()
                     type!: Date;

              @Column()
            default !: Date.now;
       };

       @Column()
       coupon!: string;


       @Column()
       disabled!: boolean;

       @Column()
       paymentFailedDate!: {

              @Column()
                     type!: Date;

              @Column()
            default !: null;
       };

       @Column()
       role!: {

              @Column()
                     type!: string;

              @Column()
                     enum!: ['master-admin', 'user'];
       };

       @Column()
       isBlocked!: boolean;






@Column()
deletedByUser!: User;

@Column()
alertPhoneNumber!: {

       @Column()
              type!: string;

       @Column()
            default !: '';
};

@Column()
alertPhoneVerificationCode!: {

       @Column()
              type!: string;

       @Column()
            default !: '';
};

@Column()
alertPhoneVerificationCodeRequestTime!: {

       @Column()
              type!: Date;
};

@Column()
tempAlertPhoneNumber!: string;

@Column()
tutorial!: Object;

@Column()
createdBy: { type: string, ref!: 'User' };

@Column()
identification!: [
       {
 
 @Column()
subscription!: Object;

@Column()
userAgent!: string;
            };
        ];

@Column()
source!: Object;

@Column()
cachedPassword!: {
       // Store original password here in "admin mode"

       @Column()
              type!: string;

       @Column()
            default !: null;
};

@Column()
isAdminMode!: {

       @Column()
              type!: Boolean; // Currently in admin mode

       @Column()
            default !: false;
};
    };

@Column()
{ timestamps!: true }
}









