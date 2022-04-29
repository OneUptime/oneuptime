import { Column, Entity, Index } from 'typeorm';
import BaseModel from './BaseModel';
import DockerCredential from './DockerCredential';
import Component from './Component';
import ResourceLabel from './ResourceLabel';


@Entity({
       name: "UserAlerts"
})
export default class Model extends BaseModel {

       @Column()
       name!: string;

       @Column()
       slug!: string;

       @Column()
       dockerCredential!: DockerCredential

       @Column()
       imagePath!: string;

       @Column()
       imageTags!: string;

       @Column()
       component!: Component

       @Column()
       resourceLabel!: ResourceLabel

       @Column()
       deleteAt!: Date;

       @Column()
       lastScan!: Date;

       @Column()
       scanned!: boolean;

       @Column()
       scanning!: boolean;
}








