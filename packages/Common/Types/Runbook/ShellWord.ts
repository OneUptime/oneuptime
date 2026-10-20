/*
 * A word as bash reads it back: as it is when it holds only characters bash
 * never reads specially (letters, digits, "-", ".", "_", "/"), otherwise in
 * single quotes, a single quote inside written '\''. Inside single quotes
 * bash reads nothing specially, so the word reaches the command exactly as
 * it is, whatever it holds.
 *
 * Used where a runbook step's own text becomes part of a command line: the
 * kubectl command a step written before kubectl scripts becomes
 * (RunbookLegacySteps), and the `bash -c <script>` an SSH step runs on its
 * machine (the Runner's SSHExecutor).
 */
export function shellQuote(word: string): string {
  if (word.length > 0 && isPlainShellWord(word)) {
    return word;
  }

  return `'${word.split("'").join(`'\\''`)}'`;
}

function isPlainShellWord(word: string): boolean {
  for (let index: number = 0; index < word.length; index++) {
    const code: number = word.charCodeAt(index);

    const isPlain: boolean =
      (code >= 48 && code <= 57) || // 0-9
      (code >= 65 && code <= 90) || // A-Z
      (code >= 97 && code <= 122) || // a-z
      code === 45 || // -
      code === 46 || // .
      code === 95 || // _
      code === 47; // /

    if (!isPlain) {
      return false;
    }
  }

  return true;
}
