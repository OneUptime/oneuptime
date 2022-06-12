import {
    useState,
    useEffect,
    useRef,
    MouseEventHandler,
    MouseEvent,
} from 'react';

const useComponentOutsideClick: Function = (
    isVisible: boolean
): {
    ref: any;
    isComponentVisible: boolean;
    setIsComponentVisible: Function;
} => {
    const [isComponentVisible, setIsComponentVisible] =
        useState<boolean>(isVisible);
    const ref: any = useRef<any>(null);

    const handleClickOutside: MouseEventHandler = (event: MouseEvent) => {
        if (ref.current && !ref.current.contains(event.target)) {
            setIsComponentVisible(false);
        }
    };

    useEffect(() => {
        document.addEventListener('click', handleClickOutside as any, true);
        return () => {
            document.removeEventListener(
                'click',
                handleClickOutside as any,
                true
            );
        };
    }, []);

    return { ref, isComponentVisible, setIsComponentVisible };
};

export default useComponentOutsideClick;
