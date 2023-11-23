import DatabaseProperty from "../Database/DatabaseProperty";

export default class RestrictionTime extends DatabaseProperty {
    public static getDefault() {
        return new RestrictionTime();
    }
}