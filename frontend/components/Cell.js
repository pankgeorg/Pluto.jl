import { html, useState, useEffect, useLayoutEffect, useRef, useContext } from "../imports/Preact.js"

import { CellOutput } from "./CellOutput.js"
import { CellInput } from "./CellInput.js"
import { RunArea, useMillisSinceTruthy } from "./RunArea.js"
import { cl } from "../common/ClassTable.js"
import { PlutoContext } from "../common/PlutoContext.js"

// /**
//  * @typedef {Object} CodeState
//  * @property {string} body
//  * @property {number} [timestamp]
//  * @property {boolean} [submitted_by_me]
//  */

// /**
//  * Cell as it could be loaded from the .jl file,
//  * owned by the user, thus the Pluto frontend
//  * @typedef CellData
//  * @type {{
//  *  id: string,
//  *  code: string,
//  *  folded: boolean,
//  * }}
//  */

// /**
//  * Running state of a cell,
//  * owned by the worker
//  * @typedef CellStateData
//  * @type {{
//  *  queued: boolean,
//  *  running: boolean,
//  *  errored: boolean,
//  *  runtime?: number,
//  *  output: {
//  *      body: string,
//  *      timestamp: number,
//  *      mime: string,
//  *      rootassignee: ?string,
//  *  }
//  * }}
//  */

// /**
//  * A cell!
//  * @typedef {Object} CellState
//  * @property {string} cell_id
//  * @property {CodeState} remote_code
//  * @property {CodeState} local_code
//  * @property {boolean} code_folded
//  * @property {boolean} queued
//  * @property {boolean} running
//  * @property {?number} runtime
//  * @property {boolean} errored
//  * @property {{body: string, timestamp: number, mime: string, rootassignee: ?string}} output
//  * @property {boolean} selected
//  * @property {boolean} pasted
//  */

/**
 * @param {{
 *  cell: import("./Editor.js").CellData,
 *  cell_state: import("./Editor.js").CellState,
 *  cell_local: import("./Editor.js").CellData,
 *  selected: boolean,
 *  focus_after_creation: boolean,
 *  selected_cells: Array<string>,
 *  [key: string]: any,
 * }} props
 * */
export const Cell = ({
    cell: { cell_id, code, code_folded },
    cell_state: { queued, running, runtime, errored, output },
    cell_local,
    selected,
    on_change,
    on_update_doc_query,
    on_focus_neighbor,
    disable_input,
    focus_after_creation,
    selected_cells,
    notebook_id,
}) => {
    let pluto_actions = useContext(PlutoContext)

    // cm_forced_focus is null, except when a line needs to be highlighted because it is part of a stack trace
    const [cm_forced_focus, set_cm_forced_focus] = useState(null)
    const localTimeRunning = 10e5 * useMillisSinceTruthy(running)
    useEffect(() => {
        const focusListener = (e) => {
            if (e.detail.cell_id === cell_id) {
                if (e.detail.line != null) {
                    const ch = e.detail.ch
                    if (ch == null) {
                        set_cm_forced_focus([{ line: e.detail.line, ch: 0 }, { line: e.detail.line, ch: Infinity }, { scroll: true }])
                    } else {
                        set_cm_forced_focus([{ line: e.detail.line, ch: ch }, { line: e.detail.line, ch: ch }, { scroll: true }])
                    }
                }
            }
        }
        window.addEventListener("cell_focus", focusListener)
        // cleanup
        return () => {
            window.removeEventListener("cell_focus", focusListener)
        }
    }, [])

    const class_code_differs = code !== (cell_local?.code ?? code)
    const class_code_folded = code_folded && cm_forced_focus == null

    let show_input = errored || class_code_differs || !class_code_folded

    return html`
        <pluto-cell
            class=${cl({
                queued: queued,
                running: running,
                errored: errored,
                selected: selected,
                code_differs: class_code_differs,
                code_folded: class_code_folded,
            })}
            id=${cell_id}
        >
            <pluto-shoulder draggable="true" title="Drag to move cell">
                <button
                    onClick=${() => {
                        let cells_to_fold = selected ? selected_cells : [cell_id]
                        pluto_actions.update_notebook((notebook) => {
                            for (let cell_id of cells_to_fold) {
                                notebook.cell_dict[cell_id].code_folded = !code_folded
                            }
                        })
                    }}
                    class="foldcode"
                    title="Show/hide code"
                >
                    <span></span>
                </button>
            </pluto-shoulder>
            <pluto-trafficlight></pluto-trafficlight>
            <button
                onClick=${() => {
                    pluto_actions.add_remote_cell(cell_id, "before")
                }}
                class="add_cell before"
                title="Add cell"
            >
                <span></span>
            </button>
            <${CellOutput} ...${output} cell_id=${cell_id} />
            ${show_input &&
            html`<${CellInput}
                local_code=${cell_local?.code ?? code}
                remote_code=${code}
                disable_input=${disable_input}
                focus_after_creation=${focus_after_creation}
                cm_forced_focus=${cm_forced_focus}
                set_cm_forced_focus=${set_cm_forced_focus}
                on_submit=${(new_code) => {
                    pluto_actions.change_remote_cell(cell_id, new_code)
                }}
                on_delete=${() => {
                    let cells_to_delete = selected ? selected_cells : [cell_id]
                    pluto_actions.confirm_delete_multiple("Delete", cells_to_delete)
                }}
                on_add_after=${() => {
                    pluto_actions.add_remote_cell(cell_id, "after")
                }}
                on_fold=${(new_folded) => pluto_actions.fold_remote_cell(cell_id, new_folded)}
                on_change=${(new_code) => {
                    if (code_folded && cm_forced_focus != null) {
                        pluto_actions.fold_remote_cell(cell_id, false)
                    }
                    on_change(new_code)
                }}
                on_update_doc_query=${on_update_doc_query}
                on_focus_neighbor=${on_focus_neighbor}
                cell_id=${cell_id}
                notebook_id=${notebook_id}
            />`}
            <${RunArea}
                onClick=${() => {
                    if (running || queued) {
                        pluto_actions.interrupt_remote(cell_id)
                    } else {
                        let cell_to_run = selected ? selected_cells : [cell_id]
                        pluto_actions.set_and_run_multiple(cell_to_run)
                    }
                }}
                runtime=${localTimeRunning || runtime}
            />
            <button
                onClick=${() => {
                    pluto_actions.add_remote_cell(cell_id, "after")
                }}
                class="add_cell after"
                title="Add cell"
            >
                <span></span>
            </button>
        </pluto-cell>
    `
}
