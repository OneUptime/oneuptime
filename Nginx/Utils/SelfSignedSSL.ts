import Exec from "Common/Server/Utils/Execute";

export default class SelfSignedSSL {
  public static async generate(path: string, host: string): Promise<void> {
    await Exec.executeCommand(
      `mkdir -p ${path} && openssl req -new -x509 -nodes -subj "/C=US/ST=NY/L=NYC/O=Global Security/OU=IT Department/CN=example.com" -out ${path}/${host}.crt -keyout ${path}/${host}.key -days 99999 && chmod -R 777 ${path}`,
    );
  }
}
