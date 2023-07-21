import Phone from '../Phone';


export  interface SMSMessage {
    message: string;
}

export default interface SMS extends SMSMessage {
    to: Phone;
}


