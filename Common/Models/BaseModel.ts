import { DeleteDateColumn, UpdateDateColumn, CreateDateColumn, VersionColumn, PrimaryGeneratedColumn, BaseEntity } from 'typeorm';

export default class BaseModel extends BaseEntity {
    @PrimaryGeneratedColumn("uuid")
    id!: string;

    @CreateDateColumn()
    created!: Date;
  
    @UpdateDateColumn()
    updated!: Date;
  
    @DeleteDateColumn()
    deletedAt?: Date;

    @VersionColumn()
    version!: number; 
}