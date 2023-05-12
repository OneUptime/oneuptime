import axios from "axios";

export default class WebRequest { 
    public static get(url: URL, headers: Headers, options: any): Promise<any> {
        // make a web request to the page like google.com and return the response
        return new Promise((resolve, reject) => {
            axios.get(url.toString(), options)
            .then((response) => {
                resolve(response);
            })
            .catch((error) => {
                reject(error);
            });
        }
        
    }
}