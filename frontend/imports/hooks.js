import {useEffect, useState} from "./Preact.js";

const UPDATE_RUNNING_TIME = 50
export const useUSecSinceTruthy = truthy => {
    const [now, setNow] = useState(0)
    const [startRunning, setStartRunning] = useState(0)
    useEffect(() => {
        let interval;
        if(truthy){
            const now = +new Date();
            setStartRunning(now);
            interval = setInterval(
                () => setNow(+new Date()),
                UPDATE_RUNNING_TIME
            )
        }
        return () => {
            interval && clearInterval(interval)
        }
    }, [truthy])
    return truthy ? 10e5 * (now - startRunning) : undefined
}