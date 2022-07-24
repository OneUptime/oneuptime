export default class Text {
    public static generateRandomText(length?: number): string {
        if (!length) {
            length = 10;
        }

        let result: string = '';
        const characters: string =
            'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz';
        const charactersLength: number = characters.length;
        for (let i: number = 0; i < length; i++) {
            result += characters.charAt(
                Math.floor(Math.random() * charactersLength)
            );
        }
        return result;
    }

    public static uppercaseFirstLetter(word: string): string {
        if (word.length > 0) {
            return word.charAt(0).toUpperCase() + word.slice(1);
        }
        return word;
    }
}
