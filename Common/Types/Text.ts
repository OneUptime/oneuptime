export default class Text {
  public static convertBase64ToHex(textInBase64: string): string {
    if (!textInBase64) {
      return textInBase64;
    }

    if (!this.isBase64(textInBase64)) {
      return textInBase64;
    }

    const hex: string = Buffer.from(textInBase64, "base64").toString("hex");
    return hex;
  }

  public static getFirstWord(text: string): string {
    if (!text || text.length === 0) {
      return text;
    }

    const textArr: Array<string> = text.split(" ");

    let firstIndex: number = 0;

    while (firstIndex < textArr.length && !textArr[firstIndex]) {
      firstIndex++;
    }

    return textArr[firstIndex] || text;
  }

  public static getLastWord(text: string): string {
    if (!text || text.length === 0) {
      return text;
    }

    const textArr: Array<string> = text.split(" ");

    let lastIndex: number = textArr.length - 1;

    while (lastIndex >= 0 && !textArr[lastIndex]) {
      lastIndex--;
    }

    return textArr[lastIndex] || text;
  }

  public static trimStartUntilThisWord(text: string, word: string): string {
    if (!text || text.length === 0) {
      return text;
    }

    const index: number = text.indexOf(word);
    if (index === -1) {
      return text;
    }

    return text.substring(index);
  }

  public static trimUpQuotesFromStartAndEnd(text: string): string {
    if (!text || text.length === 0) {
      return text;
    }

    if (text.startsWith('"') && !text.endsWith('"')) {
      text = text.substring(1);
    }

    if (text.endsWith('"') && !text.startsWith('"')) {
      text = text.substring(0, text.length - 1);
    }

    // check for single quotes

    if (text.startsWith("'") && !text.endsWith("'")) {
      text = text.substring(1);
    }

    if (text.endsWith("'") && !text.startsWith("'")) {
      text = text.substring(0, text.length - 1);
    }

    return text;
  }

  public static trimEndUntilThisWord(text: string, word: string): string {
    if (!text || text.length === 0) {
      return text;
    }

    const index: number = text.lastIndexOf(word);
    if (index === -1) {
      return text;
    }

    return text.substring(0, index + word.length);
  }

  public static isBase64(text: string): boolean {
    const regex: RegExp = /^[a-zA-Z0-9+/]*={0,2}$/;
    return regex.test(text);
  }

  public static generateRandomText(length?: number): string {
    if (!length) {
      length = 10;
    }

    let result: string = "";
    const characters: string =
      "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz";
    const charactersLength: number = characters.length;
    for (let i: number = 0; i < length; i++) {
      result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
  }

  public static trimLines(text: string): string {
    return text
      .split("\n")
      .map((line: string) => {
        return line.trim();
      })
      .join("\n");
  }

  public static generateRandomNumber(length?: number): string {
    if (!length) {
      length = 10;
    }

    let result: string = "";
    const characters: string = "12134567890";
    const charactersLength: number = characters.length;
    for (let i: number = 0; i < length; i++) {
      result += characters.charAt(Math.floor(Math.random() * charactersLength));
    }
    return result;
  }

  public static convertNumberToWords(num: number): string {
    const words: Array<string> = [
      "first",
      "second",
      "third",
      "fourth",
      "fifth",
      "sixth",
      "seventh",
      "eighth",
      "ninth",
      "tenth",
      "eleventh",
      "twelfth",
      "thirteenth",
      "fourteenth",
      "fifteenth",
      "sixteenth",
      "seventeenth",
      "eighteenth",
      "nineteenth",
      "twentieth",
    ];

    if (num <= 20) {
      return words[num - 1]!;
    }

    if (num % 10 === 0) {
      return `${words[19]} ${words[num / 10 - 2]}`;
    }

    return `${words[19]} ${words[Math.floor(num / 10) - 2]}-${
      words[(num % 10) - 1]
    }`;
  }

  public static uppercaseFirstLetter(word: string): string {
    if (word.length > 0) {
      return word.charAt(0).toUpperCase() + word.slice(1);
    }
    return word;
  }

  public static fromDashesToPascalCase(word: string): string {
    let tempWord: string = word.replace(/-/g, " ");
    tempWord = tempWord.replace(/\b\w/g, (m: string): string => {
      return m.toUpperCase();
    });
    return tempWord;
  }

  public static pascalCaseToDashes(word: string): string {
    let tempWord: string = word.replace(/[A-Z]/g, (m: string): string => {
      return "-" + m.toLowerCase();
    });
    while (tempWord.includes(" ")) {
      tempWord = tempWord.replace(" ", "-");
    }

    if (tempWord.startsWith("-")) {
      tempWord = this.replaceAt(0, tempWord, " ");
    }

    if (tempWord.endsWith("-")) {
      tempWord = this.replaceAt(tempWord.length - 1, tempWord, " ");
    }

    return tempWord.toLowerCase().trim();
  }

  public static replaceAt(
    index: number,
    word: string,
    replacement: string,
  ): string {
    return (
      word.substring(0, index) +
      replacement +
      word.substring(index + replacement.length)
    );
  }

  public static replaceAll(
    sentence: string,
    search: string,
    replaceBy: string,
  ): string {
    return sentence.split(search).join(replaceBy);
  }
}
