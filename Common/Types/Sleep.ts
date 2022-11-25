export default class Sleep {
    public static async sleep(ms: number): Promise<void> {
        return new Promise((resolve: Function) => {
            return setTimeout(resolve, ms);
        });
    }
}
