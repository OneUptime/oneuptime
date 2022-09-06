export class Logger {
    public static warn(text: string): void {
        //eslint-disable-next-line
        console.warn(text);
    }

    public static error(text: string): void {
        //eslint-disable-next-line
        console.error(text);
    }

    public static log(text: string): void {
        //eslint-disable-next-line
        console.log(text);
    }

    public static info(text: string): void {
        //eslint-disable-next-line
        this.log(text);
    }
}
