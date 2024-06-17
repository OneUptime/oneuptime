import React, { FunctionComponent, ReactElement, useEffect } from "react";
import Toast, { ComponentProps as ToastComponentProps } from "./Toast";
import GlobalEvents from "../../Utils/GlobalEvents";


export const ShowToastNotification = (toast: ToastComponentProps): void => {
    GlobalEvents.dispatchEvent("toast", toast as any);
}

const ToastLayout: FunctionComponent = (
    
): ReactElement => {

    const [currentToasts, setCurrentToasts] = React.useState<ToastComponentProps[]>([]);


    const addToastNotification = (event: CustomEvent) => {
        const toast: ToastComponentProps = event.detail;
        setCurrentToasts([...currentToasts, toast]);
    }

    useEffect(() => {
        GlobalEvents.addEventListener("toast", addToastNotification);

        return ()=>{
            GlobalEvents.removeEventListener("toast", addToastNotification);
        }

    }, []);


    return (<div>
        {currentToasts.map((toast: ToastComponentProps, index: number) => {
            return (<Toast
                key={index}
                title={toast.title}
                description={toast.description}
                type={toast.type}
                onClose={()=>{

                    if(toast.onClose){
                        toast.onClose();
                    }

                    const newToasts = [...currentToasts];
                    newToasts.splice(index, 1);
                    setCurrentToasts(newToasts);
                
                }}
                createdAt={toast.createdAt}
            />
        )})}
    </div>
    );
};

export default ToastLayout;
