import { Column, Entity } from 'typeorm';
import BaseModel from './BaseModel';

import User from './User';
import Incident, { IncidentState } from './Incident';

export enum IncidentMessageType {
    Investogation = 'Investigation',
    Internam = 'Internal',
}

@Entity({
    name: 'IncidentNote',
})
export default class IncidentNote extends BaseModel {
    @Column()
    public incident!: Incident;

    @Column()
    public content!: string;

    @Column()
    public type!: IncidentMessageType;

    @Column()
    public incidentState!: IncidentState;

    @Column()
    public createdByUser!: User;

    @Column()
    public deletedByUser!: User;

    @Column()
    public postOnStatusPage!: boolean;
}
