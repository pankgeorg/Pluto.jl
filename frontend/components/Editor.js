import { html, Component, useState, useEffect } from "../imports/Preact.js"
import immer, { applyPatches, produceWithPatches } from "../imports/immer.js"
import { v4 as uuidv4 } from "../imports/uuid.js"
import _ from "../imports/lodash.js"

import { create_pluto_connection, resolvable_promise } from "../common/PlutoConnection.js"
import { create_counter_statistics, send_statistics_if_enabled, store_statistics_sample, finalize_statistics, init_feedback } from "../common/Feedback.js"

import { FilePicker } from "./FilePicker.js"
import { NotebookMemo as Notebook } from "./Notebook.js"
import { LiveDocs } from "./LiveDocs.js"
import { DropRuler } from "./DropRuler.js"
import { SelectionArea } from "./SelectionArea.js"
import { UndoDelete } from "./UndoDelete.js"
import { SlideControls } from "./SlideControls.js"
import { Scroller } from "./Scroller.js"

import { link_open_path } from "./Welcome.js"

import { offline_html } from "../common/OfflineHTMLExport.js"
import { slice_utf8, length_utf8 } from "../common/UnicodeTools.js"
import { has_ctrl_or_cmd_pressed, ctrl_or_cmd_name, is_mac_keyboard, in_textarea_or_input } from "../common/KeyboardShortcuts.js"
import { handle_log } from "../common/Logging.js"
import { PlutoContext } from "../common/PlutoContext.js"

const default_path = "..."

/**
 * Serialize an array of cells into a string form (similar to the .jl file).
 *
 * Used for implementing clipboard functionality. This isn't in topological
 * order, so you won't necessarily be able to run it directly.
 *
 * @param {Array<CellData>} cells
 * @return {String}
 */
function serialize_cells(cells) {
    return cells.map((cell) => `# ╔═╡ ${cell.cell_id}\n` + cell.code + "\n").join("\n")
}

/**
 * @typedef {import('../imports/immer').Patch} Patch
 * */

/**
 * Deserialize a Julia program or output from `serialize_cells`.
 *
 * If a Julia program, it will return a single String containing it. Otherwise,
 * it will split the string into cells based on the special delimiter.
 *
 * @param {String} serialized_cells
 * @return {Array<String>}
 */
function deserialize_cells(serialized_cells) {
    const segments = serialized_cells.replace(/\r\n/g, "\n").split(/# ╔═╡ \S+\n/)
    return segments.map((s) => s.trim()).filter((s) => s !== "")
}

const Circle = ({ fill }) => html`
    <svg
        width="48"
        height="48"
        viewBox="0 0 48 48"
        style="
            height: .7em;
            width: .7em;
            margin-left: .3em;
            margin-right: .2em;
        "
    >
        <circle cx="24" cy="24" r="24" fill=${fill}></circle>
    </svg>
`
const Triangle = ({ fill }) => html`
    <svg width="48" height="48" viewBox="0 0 48 48" style="height: .7em; width: .7em; margin-left: .3em; margin-right: .2em; margin-bottom: -.1em;">
        <polygon points="24,0 48,40 0,40" fill=${fill} stroke="none" />
    </svg>
`

let ExportBanner = ({ notebook, pluto_version, onClose, open }) => {
    // let [html_export, set_html_export] = useState(null)

    // useEffect(() => {
    //     if (open) {
    //         offline_html({
    //             pluto_version: pluto_version,
    //             head: document.head,
    //             body: document.body,
    //         }).then((html) => {
    //             set_html_export(html)
    //         })
    //     } else {
    //         set_html_export(null)
    //     }
    // }, [notebook, open, set_html_export])

    // @ts-ignore
    let is_chrome = window.chrome == null

    return html`
        <aside id="export">
            <div id="container">
                <div class="export_title">export</div>
                <a href="./notebookfile?id=${notebook.notebook_id}" target="_blank" class="export_card">
                    <header><${Triangle} fill="#a270ba" /> Notebook file</header>
                    <section>Download a copy of the <b>.jl</b> script.</section>
                </a>
                <a
                    href="#"
                    class="export_card"
                    onClick=${(e) => {
                        offline_html({
                            pluto_version: pluto_version,
                            head: document.head,
                            body: document.body,
                        }).then((html) => {
                            if (html != null) {
                                const fake_anchor = document.createElement("a")
                                fake_anchor.setAttribute("download", `${notebook.shortpath}.html`)
                                fake_anchor.setAttribute(
                                    "href",
                                    URL.createObjectURL(
                                        new Blob([html], {
                                            type: "text/html",
                                        })
                                    )
                                )
                                document.body.appendChild(fake_anchor)
                                setTimeout(() => {
                                    fake_anchor.click()
                                    document.body.removeChild(fake_anchor)
                                }, 100)
                            }
                        })
                    }}
                >
                    <header><${Circle} fill="#E86F51" /> Static HTML</header>
                    <section>An <b>.html</b> file for your web page, or to share online.</section>
                </a>
                <a
                    href="#"
                    class="export_card"
                    style=${!is_chrome ? "opacity: .7;" : ""}
                    onClick=${() => {
                        if (!is_chrome) {
                            alert("PDF generation works best on Google Chome.\n\n(We're working on it!)")
                        }
                        window.print()
                    }}
                >
                    <header><${Circle} fill="#3D6117" /> Static PDF</header>
                    <section>A static <b>.pdf</b> file for print or email.</section>
                </a>
                <!--<div class="export_title">
                    future
                </div>
                <a class="export_card" style="border-color: #00000021; opacity: .7;">
                    <header>mybinder.org</header>
                    <section>Publish an interactive notebook online.</section>
                </a>-->
                <button title="Close" class="toggle_export" onClick=${() => onClose()}>
                    <span></span>
                </button>
            </div>
        </aside>
    `
}

/**
 * @typedef CellData
 * @type {{
 *  cell_id: string,
 *  code: string,
 *  code_folded: boolean,
 * }}
 */

/**
 * Running state of a cell,
 * owned by the worker
 * @typedef CellState
 * @type {{
 *  cell_id: string,
 *  queued: boolean,
 *  running: boolean,
 *  errored: boolean,
 *  runtime?: number,
 *  output: {
 *      body: string,
 *      persist_js_state: boolean,
 *      last_run_timestamp: number,
 *      mime: string,
 *      rootassignee: ?string,
 *  }
 * }}
 */

/**
 * @typedef NotebookData
 * @type {{
 *  path: string,
 *  shortpath: string,
 *  in_temp_dir: boolean,
 *  notebook_id: string,
 *  cell_dict: { [uuid: string]: CellData },
 *  cells_running: { [uuid: string]: CellState }
 *  cell_order: Array<string>,
 *  bonds: { [name: string]: any },
 * }}
 */

export class Editor extends Component {
    constructor() {
        super()

        this.state = {
            notebook: /** @type {NotebookData} */ ({
                notebook_id: new URLSearchParams(window.location.search).get("id"),
                path: default_path,
                shortpath: "",
                in_temp_dir: true,
                cell_dict: {},
                cells_running: {},
                cell_order: [],
            }),
            cells_local: /** @type {{ [id: string]: CellData }} */ ({}),
            desired_doc_query: null,
            recently_deleted: /** @type {Array<{ index: number, cell: CellData }>} */ (null),
            connected: false,
            loading: true,
            scroller: {
                up: false,
                down: false,
            },
            export_menu_open: false,

            last_created_cell: null,
            selected_cells: [],

            update_is_ongoing: false,
        }

        // statistics that are accumulated over time
        this.counter_statistics = create_counter_statistics()

        // these are things that can be done to the local notebook
        this.actions = {
            send: (...args) => this.client.send(...args),
            update_notebook: this.update_notebook,
            set_doc_query: (query) => this.setState({ desired_doc_query: query }),
            set_local_cell: (cell_id, new_val) => {
                this.setState(
                    immer((state) => {
                        state.cells_local[cell_id] = {
                            code: new_val,
                        }
                    })
                )
            },
            focus_on_neighbor: (cell_id, delta, line = delta === -1 ? Infinity : -1, ch) => {
                const i = this.state.notebook.cell_order.indexOf(cell_id)
                const new_i = i + delta
                if (new_i >= 0 && new_i < this.state.notebook.cell_order.length) {
                    window.dispatchEvent(
                        new CustomEvent("cell_focus", {
                            detail: {
                                cell_id: this.state.notebook.cell_order[new_i],
                                line: line,
                                ch: ch,
                            },
                        })
                    )
                }
            },
            set_scroller: (enabled) => {
                this.setState({ scroller: enabled })
            },
            // Not really an action, but sure - DRAL
            serialize_selected: (cell_id) => {
                const cells_to_serialize = cell_id == null || this.state.selected_cells.includes(cell_id) ? this.state.selected_cells : [cell_id]
                if (cells_to_serialize.length) {
                    return serialize_cells(cells_to_serialize.map((id) => this.state.notebook.cell_dict[id]))
                }
            },
            add_deserialized_cells: async (data, index) => {
                let new_codes = deserialize_cells(data)
                /** @type {Array<CellData>} */
                let new_cells = new_codes.map((code) => {
                    return {
                        cell_id: uuidv4(),
                        code: code,
                        code_folded: false,
                    }
                })
                if (index === -1) {
                    index = this.state.notebook.cell_order.length
                }

                this.setState(
                    immer((state) => {
                        for (let cell of new_cells) {
                            state.cells_local[cell.cell_id] = cell
                            state.last_created_cell = cell.cell_id
                        }
                    })
                )
                update_notebook((notebook) => {
                    for (const cell of new_cells) {
                        notebook.cell_dict[cell.cell_id] = {
                            ...cell,
                            // Fill the cell with empty code remotely, so it doesn't run unsafe code
                            code: "",
                        }
                    }
                    notebook.cell_order = [
                        ...notebook.cell_order.slice(0, index),
                        ...new_cells.map((x) => x.cell_id),
                        ...notebook.cell_order.slice(index, Infinity),
                    ]
                })
            },
            change_remote_cell: async (cell_id, new_code, create_promise = false) => {
                this.counter_statistics.numEvals++

                await update_notebook((notebook) => {
                    notebook.cell_dict[cell_id].code = new_code
                })
                // Just making sure there is no local state to overwrite left
                // TODO I'm not sure if this is useful/necessary/required actually
                this.setState(
                    immer((state) => {
                        delete state.cells_local[cell_id]
                    })
                )
                console.log("RUN MULTIPLE CELLS", cell_id)
                await this.client.send("run_multiple_cells", { cells: [cell_id] }, { notebook_id: this.state.notebook.notebook_id })
            },
            wrap_remote_cell: (cell_id, block = "begin") => {
                const cell = this.state.notebook.cell_dict[cell_id]
                const new_code = block + "\n\t" + cell.code.replace(/\n/g, "\n\t") + "\n" + "end"
                this.actions.change_remote_cell(cell_id, new_code)
            },
            split_remote_cell: async (cell_id, boundaries, submit = false) => {
                const cell = this.state.notebook.cell_dict[cell_id]

                const old_code = cell.code
                const padded_boundaries = [0, ...boundaries]
                /** @type {Array<String>} */
                const parts = boundaries.map((b, i) => slice_utf8(old_code, padded_boundaries[i], b).trim()).filter((x) => x !== "")
                /** @type {Array<CellData>} */
                const cells_to_add = parts.map((code) => {
                    return {
                        cell_id: uuidv4(),
                        code: code,
                        code_folded: false,
                    }
                })

                update_notebook((notebook) => {
                    delete notebook.cell_dict[cell_id]
                    for (let cell of cells_to_add) {
                        notebook.cell_dict[cell.cell_id] = cell
                    }
                    notebook.cell_order = notebook.cell_order.flatMap((c) => {
                        if (cell_id === c) {
                            return cells_to_add.map((x) => x.cell_id)
                        } else {
                            return [c]
                        }
                    })
                })

                if (submit) {
                    await this.actions.set_and_run_multiple([cell_id, ...cells_to_add.map((x) => x.cell_id)])
                }
            },
            interrupt_remote: (cell_id) => {
                // TODO Make this cooler
                // set_notebook_state((prevstate) => {
                //     return {
                //         cells: prevstate.cells.map((c) => {
                //             return { ...c, errored: c.errored || c.running || c.queued }
                //         }),
                //     }
                // })
                this.client.send("interrupt_all", {}, { notebook_id: this.state.notebook.notebook_id }, false)
            },
            move_remote_cells: (cell_ids, new_index) => {
                update_notebook((notebook) => {
                    let before = notebook.cell_order.slice(0, new_index).filter((x) => !cell_ids.includes(x))
                    let after = notebook.cell_order.slice(new_index, Infinity).filter((x) => !cell_ids.includes(x))
                    notebook.cell_order = [...before, ...cell_ids, ...after]
                })
            },
            add_remote_cell_at: async (index) => {
                let id = uuidv4()
                this.setState({ last_created_cell: id })
                await update_notebook((notebook) => {
                    notebook.cell_dict[id] = {
                        cell_id: id,
                        code: "",
                        code_folded: false,
                    }
                    notebook.cell_order = [...notebook.cell_order.slice(0, index), id, ...notebook.cell_order.slice(index, Infinity)]
                })
                await this.client.send("run_multiple_cells", { cells: [id] }, { notebook_id: this.state.notebook.notebook_id })
            },
            add_remote_cell: async (cell_id, before_or_after) => {
                const index = this.state.notebook.cell_order.indexOf(cell_id)
                const delta = before_or_after == "before" ? 0 : 1

                let uuid = uuidv4()
                this.setState({ last_created_cell: uuid })
                await update_notebook((notebook) => {
                    notebook.cell_dict[uuid] = {
                        cell_id: uuid,
                        code: "",
                        code_folded: false,
                    }
                    notebook.cell_order = [...notebook.cell_order.slice(0, index + delta), uuid, ...notebook.cell_order.slice(index + delta, Infinity)]
                })
                await this.client.send("run_multiple_cells", { cells: [uuid] }, { notebook_id: this.state.notebook.notebook_id })
            },
            confirm_delete_multiple: async (verb, cell_ids) => {
                if (cell_ids.length <= 1 || confirm(`${verb} ${cell_ids.length} cells?`)) {
                    if (cell_ids.some((cell_id) => this.state.notebook.cells_running[cell_id].running || this.state.notebook.cells_running[cell_id].queued)) {
                        if (confirm("This cell is still running - would you like to interrupt the notebook?")) {
                            this.actions.interrupt_remote(cell_ids[0])
                        }
                    } else {
                        this.setState({
                            recently_deleted: cell_ids.map((cell_id) => {
                                return {
                                    index: this.state.notebook.cell_order.indexOf(cell_id),
                                    cell: this.state.notebook.cell_dict[cell_id],
                                }
                            }),
                        })
                        await update_notebook((notebook) => {
                            for (let cell_id of cell_ids) {
                                delete notebook.cell_dict[cell_id]
                            }
                            notebook.cell_order = notebook.cell_order.filter((cell_id) => !cell_ids.includes(cell_id))
                        })
                        await this.client.send("run_multiple_cells", { cells: [] }, { notebook_id: this.state.notebook.notebook_id })
                    }
                }
            },
            fold_remote_cell: (cell_id, newFolded) => {
                if (!newFolded) {
                    this.setState({ last_created_cell: cell_id })
                }
                update_notebook((notebook) => {
                    notebook.cell_dict[cell_id].code_folded = newFolded
                })
            },
            set_and_run_all_changed_remote_cells: () => {
                const changed = this.state.notebook.cell_order.filter(
                    (cell_id) =>
                        this.state.cells_local[cell_id] != null && this.state.notebook.cell_dict[cell_id].code !== this.state.cells_local[cell_id]?.code
                )
                this.actions.set_and_run_multiple(changed)
                return changed.length > 0
            },
            set_and_run_multiple: async (cells_ids) => {
                await update_notebook((notebook) => {
                    for (let cell_id of cells_ids) {
                        if (this.state.cells_local[cell_id]) {
                            notebook.cell_dict[cell_id].code = this.state.cells_local[cell_id].code
                        }
                    }
                })
                console.log(`run_multiple_cells cells_ids:`, cells_ids)
                await this.client.send("run_multiple_cells", { cells: cells_ids }, { notebook_id: this.state.notebook.notebook_id })
            },
            set_bond: async (symbol, value, is_first_value) => {
                this.counter_statistics.numBondSets++

                await update_notebook((notebook) => {
                    notebook.bonds[symbol] = value
                })
            },
            reshow_cell: (cell_id, objectid, dim) => {
                this.client.send(
                    "reshow_cell",
                    {
                        objectid: objectid,
                        dim: dim,
                    },
                    { notebook_id: this.state.notebook.notebook_id, cell_id: cell_id },
                    false
                )
            },
        }

        const on_remote_notebooks = ({ message }) => {
            const old_path = this.state.notebook.path

            for (let notebook of message.notebooks) {
                if (notebook.notebook_id == this.state.notebook.notebook_id) {
                    // TODO This is now stored locally, lets store it somewhere central 😈
                    update_stored_recent_notebooks(notebook.path, old_path)
                }
            }
        }

        // these are update message that are _not_ a response to a `send(*, *, {create_promise: true})`
        const on_update = (update, by_me) => {
            if (update.notebook_id == null) {
                switch (update.type) {
                    case "notebook_list":
                        on_remote_notebooks(update)
                        break
                }
            } else if (this.state.notebook.notebook_id === update.notebook_id) {
                const message = update.message
                switch (update.type) {
                    case "notebook_diff":
                        if (message.length !== 0) {
                            this.setState((state) => {
                                let new_notebook = applyPatches(state.notebook, message)

                                // console.group("Update!")
                                // for (let patch of message) {
                                //     console.group(`Patch :${patch.op}`)
                                //     console.log(`patch.path:`, patch.path)
                                //     console.log(`patch.value:`, patch.value)
                                //     console.groupEnd()
                                // }
                                // console.log(`message:`, message)
                                // console.log(`new_notebook:`, new_notebook)
                                // console.groupEnd()

                                return {
                                    notebook: new_notebook,
                                }
                            })
                        }
                        break
                    case "log":
                        handle_log(message, this.state.notebook.path)
                        break
                    default:
                        console.error("Received unknown update type!")
                        console.log(update)
                        // alert("Something went wrong 🙈\n Try clearing your browser cache and refreshing the page")
                        break
                }
            } else {
                // Update for a different notebook, TODO maybe log this as it shouldn't happen
            }
        }

        const on_establish_connection = async (client) => {
            // nasty
            Object.assign(this.client, client)

            // @ts-ignore
            window.version_info = this.client.version_info // for debugging

            const run_all = this.client.session_options.evaluation.run_notebook_on_load
            // on socket success
            this.client.send("get_all_notebooks", {}, {}).then(on_remote_notebooks)

            this.client.send("update_notebook", { updates: [] }, { notebook_id: this.state.notebook.notebook_id }, false).then(() => {
                this.setState({ loading: false })
            })

            // do one autocomplete to trigger its precompilation
            // TODO Do this from julia itself
            this.client.send("complete", { query: "sq" }, { notebook_id: this.state.notebook.notebook_id })
        }

        const on_connection_status = (val) => this.setState({ connected: val })

        const on_reconnect = () => {
            console.warn("Reconnected! Checking states")

            return true
        }

        this.client = {}
        create_pluto_connection({
            on_unrequested_update: on_update,
            on_connection_status: on_connection_status,
            on_reconnect: on_reconnect,
            connect_metadata: { notebook_id: this.state.notebook.notebook_id },
        }).then(on_establish_connection)

        // Not completely happy with this yet, but it will do for now - DRAL
        this.bonds_changes_to_apply_when_done = []
        this.notebook_is_idle = () =>
            !Object.values(this.state.notebook.cells_running).some((cell) => cell.running || cell.queued) && !this.state.update_is_ongoing

        /** @param {(notebook: NotebookData) => void} mutate_fn */
        let update_notebook = async (mutate_fn) => {
            // if (this.state.loading) {
            //     console.error("Update notebook done during loading, strange")
            //     return
            // }

            let [new_notebook, changes, inverseChanges] = produceWithPatches(this.state.notebook, (notebook) => {
                mutate_fn(notebook)
            })

            // If "notebook is not idle" I seperate and store the bonds updates,
            // to send when the notebook is idle. This delays the updating of the bond for performance,
            // but when the server can discard bond updates itself (now it executes them one by one, even if there is a newer update ready)
            // this will no longer be necessary
            if (!this.notebook_is_idle()) {
                let changes_involving_bonds = changes.filter((x) => x.path[0] === "bonds")
                this.bonds_changes_to_apply_when_done = [...this.bonds_changes_to_apply_when_done, ...changes_involving_bonds]
                changes = changes.filter((x) => x.path[0] !== "bonds")
            }

            if (changes.length === 0) {
                return
            }

            try {
                let previous_function_name = new Error().stack.split("\n")[2].trim().split(" ")[1]
                console.log(`Changes to send to server from "${previous_function_name}":`, changes)
            } catch (error) {}

            for (let change of changes) {
                if (change.path.some((x) => typeof x === "number")) {
                    throw new Error("This sounds like it is editting an array!!!")
                }
            }

            this.setState({ update_is_ongoing: true })
            await Promise.all([
                this.client.send("update_notebook", { updates: changes }, { notebook_id: this.state.notebook.notebook_id }, false),
                new Promise((resolve) => {
                    this.setState(
                        {
                            notebook: new_notebook,
                        },
                        resolve
                    )
                }),
            ])
            this.setState({ update_is_ongoing: false })
        }
        this.update_notebook = update_notebook

        this.submit_file_change = (new_path, reset_cm_value) => {
            const old_path = this.state.notebook.path
            if (old_path === new_path) {
                return
            }
            console.log(`this.state.notebook.in_temp_dir:`, this.state.notebook.in_temp_dir)
            if (this.state.notebook.in_temp_dir || confirm("Are you sure? Will move from\n\n" + old_path + "\n\nto\n\n" + new_path)) {
                // this.setState({ loading: true })
                update_notebook((notebook) => {
                    notebook.in_temp_dir = false
                    notebook.path = new_path
                })
                // this.client
                //     .send(
                //         "move_notebook_file",
                //         {
                //             path: new_path,
                //         },
                //         { notebook_id: this.state.notebook.notebook_id }
                //     )
                //     .then((u) => {
                //         this.setState({
                //             loading: false,
                //         })
                //         if (u.message.success) {
                //             this.setState({
                //                 path: new_path,
                //             })
                //             // @ts-ignore
                //             document.activeElement.blur()
                //         } else {
                //             this.setState({
                //                 path: old_path,
                //             })
                //             reset_cm_value()
                //             alert("Failed to move file:\n\n" + u.message.reason)
                //         }
                //     })
            } else {
                this.setState({
                    path: old_path,
                })
                reset_cm_value()
            }
        }

        this.delete_selected = (verb) => {
            if (this.state.selected_cells.length > 0) {
                this.actions.confirm_delete_multiple(verb, this.state.selected_cells)
                return true
            }
        }

        this.run_selected = () => {
            return this.actions.set_and_run_multiple(this.state.selected_cells)
        }

        document.addEventListener("keydown", (e) => {
            if (e.key === "q" && has_ctrl_or_cmd_pressed(e)) {
                // This one can't be done as cmd+q on mac, because that closes chrome - Dral
                if (Object.values(this.state.notebook.cells_running).some((c) => c.running || c.queued)) {
                    this.actions.interrupt_remote()
                }
                e.preventDefault()
            } else if (e.key === "s" && has_ctrl_or_cmd_pressed(e)) {
                const some_cells_ran = this.actions.set_and_run_all_changed_remote_cells()
                if (!some_cells_ran) {
                    // all cells were in sync allready
                    // TODO: let user know that the notebook autosaves
                }
                e.preventDefault()
            } else if (e.key === "Backspace" || e.key === "Delete") {
                if (this.delete_selected("Delete")) {
                    e.preventDefault()
                }
            } else if (e.key === "Enter" && e.shiftKey) {
                this.run_selected()
            } else if ((e.key === "?" && has_ctrl_or_cmd_pressed(e)) || e.key === "F1") {
                // On mac "cmd+shift+?" is used by chrome, so that is why this needs to be ctrl as well on mac
                // Also pressing "ctrl+shift" on mac causes the key to show up as "/", this madness
                // I hope we can find a better solution for this later - Dral
                alert(
                    `Shortcuts 🎹

    Shift+Enter:   run cell
    ${ctrl_or_cmd_name}+Enter:   run cell and add cell below
    Delete or Backspace:   delete empty cell

    PageUp or fn+Up:   select cell above
    PageDown or fn+Down:   select cell below

    ${ctrl_or_cmd_name}+Q:   interrupt notebook
    ${ctrl_or_cmd_name}+S:   submit all changes

    ${ctrl_or_cmd_name}+C:   copy selected cells
    ${ctrl_or_cmd_name}+X:   cut selected cells
    ${ctrl_or_cmd_name}+V:   paste selected cells

    The notebook file saves every time you run`
                )
                e.preventDefault()
            }
        })

        document.addEventListener("copy", (e) => {
            if (!in_textarea_or_input()) {
                const serialized = this.actions.serialize_selected()
                if (serialized) {
                    navigator.clipboard.writeText(serialized).catch((err) => {
                        alert(`Error copying cells: ${e}`)
                    })
                }
            }
        })

        // Disabled until we solve https://github.com/fonsp/Pluto.jl/issues/482
        // or we can enable it with a prompt
        // Even better would be excel style: grey out until you paste it. If you paste within the same notebook, then it is just a move.
        // document.addEventListener("cut", (e) => {
        //     if (!in_textarea_or_input()) {
        //         const serialized = this.actions.serialize_selected()
        //         if (serialized) {
        //             navigator.clipboard
        //                 .writeText(serialized)
        //                 .then(() => this.delete_selected("Cut"))
        //                 .catch((err) => {
        //                     alert(`Error cutting cells: ${e}`)
        //                 })
        //         }
        //     }
        // })

        document.addEventListener("paste", async (e) => {
            if (!in_textarea_or_input()) {
                // Deselect everything first, to clean things up
                this.setState({
                    selected_cells: [],
                })

                // Paste in the cells at the end of the notebook
                const data = e.clipboardData.getData("text/plain")
                this.actions.add_deserialized_cells(data, -1)
                e.preventDefault()
            }
        })

        window.addEventListener("beforeunload", (event) => {
            const unsaved_cells = this.state.notebook.cell_order.filter(
                (id) => this.state.cells_local[id] && this.state.notebook.cell_dict[id].code !== this.state.cells_local[id].code
            )
            const first_unsaved = unsaved_cells[0]
            if (first_unsaved != null) {
                window.dispatchEvent(new CustomEvent("cell_focus", { detail: { cell_id: first_unsaved } }))
                // } else if (this.state.notebook.in_temp_dir) {
                //     window.scrollTo(0, 0)
                //     // TODO: focus file picker
                console.log("Preventing unload")
                event.stopImmediatePropagation()
                event.preventDefault()
                event.returnValue = ""
            } else {
                console.warn("unloading 👉 disconnecting websocket")
                // and don't prevent the unload
            }
        })

        setTimeout(() => {
            init_feedback()
            finalize_statistics(this.state, this.client, this.counter_statistics).then(store_statistics_sample)

            setInterval(() => {
                finalize_statistics(this.state, this.client, this.counter_statistics).then((statistics) => {
                    store_statistics_sample(statistics)
                    send_statistics_if_enabled(statistics)
                })
                this.counter_statistics = create_counter_statistics()
            }, 10 * 60 * 1000) // 10 minutes - statistics interval
        }, 20 * 1000) // 20 seconds - load feedback a little later for snappier UI
    }

    componentDidUpdate() {
        document.title = "🎈 " + this.state.notebook.shortpath + " ⚡ Pluto.jl ⚡"

        // TODO Local state
        const any_code_differs = false // this.state.notebook.cells.some((cell) => code_differs(cell))
        document.body.classList.toggle("code_differs", any_code_differs)
        document.body.classList.toggle("loading", this.state.loading)
        if (this.state.connected) {
            // @ts-ignore
            document.querySelector("meta[name=theme-color]").content = "#fff"
            document.body.classList.remove("disconnected")
        } else {
            // @ts-ignore
            document.querySelector("meta[name=theme-color]").content = "#DEAF91"
            document.body.classList.add("disconnected")
        }

        if (this.notebook_is_idle() && this.bonds_changes_to_apply_when_done) {
            this.update_notebook((notebook) => {
                applyPatches(notebook, this.bonds_changes_to_apply_when_done)
            })
        }
    }

    render() {
        let { export_menu_open } = this.state
        return html`
            <${PlutoContext.Provider} value=${this.actions}>
                <${Scroller} active=${this.state.scroller} />
                <header className=${export_menu_open ? "show_export" : ""}>
                    <${ExportBanner}
                        pluto_version=${this.client?.version_info?.pluto}
                        notebook=${this.state.notebook}
                        open=${export_menu_open}
                        onClose=${() => this.setState({ export_menu_open: false })}
                    />
                    <nav id="at_the_top">
                        <a href="./">
                            <h1><img id="logo-big" src="img/logo.svg" alt="Pluto.jl" /><img id="logo-small" src="img/favicon_unsaturated.svg" /></h1>
                        </a>
                        <${FilePicker}
                            client=${this.client}
                            value=${this.state.notebook.in_temp_dir ? "" : this.state.notebook.path}
                            on_submit=${this.submit_file_change}
                            suggest_new_file=${{
                                base: this.client.session_options == null ? "" : this.client.session_options.server.notebook_path_suggestion,
                                name: this.state.notebook.shortpath,
                            }}
                            placeholder="Save notebook..."
                            button_label=${this.state.notebook.in_temp_dir ? "Choose" : "Move"}
                        />
                        <button class="toggle_export" title="Export..." onClick=${() => this.setState({ export_menu_open: !export_menu_open })}>
                            <span></span>
                        </button>
                    </nav>
                </header>
                <main>
                    <preamble>
                        <button
                            onClick=${() => {
                                this.actions.set_and_run_all_changed_remote_cells()
                            }}
                            class="runallchanged"
                            title="Save and run all changed cells"
                        >
                            <span></span>
                        </button>
                    </preamble>
                    <${Notebook}
                        is_loading=${this.state.loading}
                        notebook=${this.state.notebook}
                        selected_cells=${this.state.selected_cells}
                        cells_local=${this.state.cells_local}
                        on_update_doc_query=${this.actions.set_doc_query}
                        on_cell_input=${this.actions.set_local_cell}
                        on_focus_neighbor=${this.actions.focus_on_neighbor}
                        disable_input=${!this.state.connected}
                        last_created_cell=${this.state.last_created_cell}
                    />

                    <${DropRuler} actions=${this.actions} selected_cells=${this.state.selected_cells} />

                    <${SelectionArea}
                        actions=${this.actions}
                        cell_order=${this.state.notebook.cell_order}
                        selected_cell_ids=${this.state.selected_cell_ids}
                        on_selection=${(selected_cell_ids) => {
                            // @ts-ignore
                            if (
                                selected_cell_ids.length !== this.state.selected_cells ||
                                _.difference(selected_cell_ids, this.state.selected_cells).length !== 0
                            ) {
                                this.setState({
                                    selected_cells: selected_cell_ids,
                                })
                            }
                        }}
                    />
                </main>
                <${LiveDocs}
                    desired_doc_query=${this.state.desired_doc_query}
                    on_update_doc_query=${this.actions.set_doc_query}
                    notebook=${this.state.notebook}
                />
                <${UndoDelete}
                    recently_deleted=${this.state.recently_deleted}
                    on_click=${() => {
                        this.update_notebook((notebook) => {
                            for (let { index, cell } of this.state.recently_deleted) {
                                notebook.cell_dict[cell.cell_id] = cell
                                notebook.cell_order = [...notebook.cell_order.slice(0, index), cell.cell_id, ...notebook.cell_order.slice(index, Infinity)]
                            }
                        })
                    }}
                />
                <${SlideControls} />
                <footer>
                    <div id="info">
                        <form id="feedback" action="#" method="post">
                            <a href="statistics-info">Statistics</a>
                            <a href="https://github.com/fonsp/Pluto.jl/wiki">FAQ</a>
                            <span style="flex: 1"></span>
                            <label for="opinion">🙋 How can we make <a href="https://github.com/fonsp/Pluto.jl">Pluto.jl</a> better?</label>
                            <input type="text" name="opinion" id="opinion" autocomplete="off" placeholder="Instant feedback..." />
                            <button>Send</button>
                        </form>
                    </div>
                </footer>
            </${PlutoContext.Provider}>
        `
    }
}

/* LOCALSTORAGE NOTEBOOKS LIST */

export const update_stored_recent_notebooks = (recent_path, also_delete = undefined) => {
    const storedString = localStorage.getItem("recent notebooks")
    const storedList = !!storedString ? JSON.parse(storedString) : []
    const oldpaths = storedList
    const newpaths = [recent_path].concat(
        oldpaths.filter((path) => {
            return path != recent_path && path != also_delete
        })
    )
    localStorage.setItem("recent notebooks", JSON.stringify(newpaths.slice(0, 50)))
}
