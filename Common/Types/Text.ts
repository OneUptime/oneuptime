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

    public static pascalCaseToDashes(word: string): string {
        let tempWord: string = word.replace(/[A-Z]/g, (m: string): string => {
            return '-' + m.toLowerCase();
        });
        while (tempWord.includes(' ')) {
            tempWord = tempWord.replace(' ', '-');
        }

        if (tempWord.startsWith('-')) {
            tempWord = this.replaceAt(0, tempWord, ' ');
        }

        if (tempWord.endsWith('-')) {
            tempWord = this.replaceAt(tempWord.length - 1, tempWord, ' ');
        }

        return tempWord.toLowerCase().trim();
    }

    public static replaceAt(
        index: number,
        word: string,
        replacement: string
    ): string {
        return (
            word.substring(0, index) +
            replacement +
            word.substring(index + replacement.length)
        );
    }
}
