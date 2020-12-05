import { html, useState, useEffect } from "../imports/Preact.js"

export const FullScreen = () => {
    const initialId = window.location.hash
    const [id, setId] = useState(initialId)

    useEffect(() => {
        const onHashChange = () => {
            setId(location.hash)
        }
        const onclose = (e) => {
            if (e.key === "Escape") document.getElementById("exit-full-screen").click()
        }
        window.addEventListener("hashchange", onHashChange)
        window.addEventListener("keydown", onclose)
        return () => {
            window.removeEventListener("hashchange", onHashChange)
            window.removeEventListener("keydown", onclose)
        }
    }, [setId])

    return (
        (id &&
            html` <a id="exit-full-screen" href="#"></a>
                <style>
                    #exit-full-screen {
                        position: fixed;
                        top: 0;
                        right: 0;
                        width: 24px;
                        height: 24px;
                        background-image: url(https://cdn.jsdelivr.net/gh/ionic-team/ionicons@5.0.0/src/svg/close-outline.svg);
                        background-size: 24px 24px;
                        z-index: 10000;
                    }
                    pluto-cell[id="${id.replace("#", "")}"] pluto-output {
                        position: fixed;
                        top: 0;
                        left: 0;
                        width: 100vw;
                        height: 100vh;
                        z-index: 9999;
                    }
                </style>`) ||
        null
    )
}
