import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import User from './User';
import Project from './Project';

export enum ScriptType {
       JavaScript = "JavaScript",
       Bash = "Bash"
}

@Entity({
       name: "AutomatedScripts"
})
export default class AutomatedScripts extends BaseModel {

       @Column()
       name!: string;

       @Column()
       script!: string;

       @Column()
       scriptType!: ScriptType;

       @Column()
       slug!: string;

       @Column()
       project!: Project

       @Column()
       deletedByUser!: User

       @Column()
       successEvent!: [
              {
 
 @Column()
       automatedScript!: {

              @Column()
                     type!: Schema.Types.ObjectId;

              @Column()
              ref!: 'AutomationSript';

              @Column()
              index!: true;
       };

       @Column()
       callSchedule!: {

              @Column()
                     type!: Schema.Types.ObjectId;

              @Column()
              ref!: 'Schedule';

              @Column()
              index!: true;
       };
};
        ];

@Column()
failureEvent!: [
       {
 
 @Column()
automatedScript!: {

       @Column()
              type!: Schema.Types.ObjectId;

       @Column()
       ref!: 'AutomationSript';

       @Column()
       index!: true;
};

@Column()
callSchedule!: {

       @Column()
              type!: Schema.Types.ObjectId;

       @Column()
       ref!: 'Schedule';

       @Column()
       index!: true;
};
            };
        ];
    };









