export default class Sleep {
    public static async sleep(ms: number): Promise<void> {
        return new Promise((resolve: () => void) => {
            setTimeout(resolve, ms);
        });
    }
}
