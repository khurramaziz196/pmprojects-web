const CONFIG_KEY = "pmprojects.web.supabase.config";
const CACHE_KEY = "pmprojects.web.workspace.cache";
const TASK_CACHE_PREFIX = "pmprojects.web.task.cache";
const TASK_COLUMN_WIDTHS_KEY = "pmprojects.web.task.columnWidths";
const POD_SAVED_DELIVERY_NOTES_KEY_PREFIX = "pmprojects.web.podSavedDeliveryNotes";
const TASK_CACHE_VERSION = 5;
const TASK_STATUS_OPTIONS = [
    "Not Started",
    "In-Progress",
    "Done",
    "Rejected"
];
const TASK_MRB_STATUS_OPTIONS = [
    "Waiting from ARF",
    "Under Review",
    "Uploaded to the Portal",
    "Hard Copy Ready",
    "Hard copy delivered"
];
const TASK_EDITABLE_FIELDS = new Set(["status", "mrb_status"]);
const DEFAULT_CONFIG = {
    projectUrl: "https://sxwnyztslfyozxxlqxjd.supabase.co",
    apiKey: "sb_publishable_Vdbds2yta-ZMBEQ2ap6wsw_lebc8C52",
    workspaceId: "pmprojects-main"
};

const state = {
    config: loadConfig(),
    projects: [],
    tasks: [],
    equipment: [],
    cursor: null,
    projectId: new URLSearchParams(window.location.search).get("id"),
    hasFreshTaskCache: false,
    collapsedTaskIds: new Set(),
    didApplyInitialCollapse: false
};

const elements = {
    backToProjectsButton: document.getElementById("backToProjectsButton"),
    logoutButton: document.getElementById("logoutButton"),
    generatePODButton: document.getElementById("generatePODButton"),
    expandAllTasksButton: document.getElementById("expandAllTasksButton"),
    collapseAllTasksButton: document.getElementById("collapseAllTasksButton"),
    taskUserLabel: document.getElementById("taskUserLabel"),
    workspaceProjectTitle: document.getElementById("workspaceProjectTitle"),
    workspaceProjectSubtitle: document.getElementById("workspaceProjectSubtitle"),
    workspaceTaskStatus: document.getElementById("workspaceTaskStatus"),
    workspaceHero: document.getElementById("workspaceHero"),
    workspaceTaskCount: document.getElementById("workspaceTaskCount"),
    workspaceTasksBody: document.getElementById("workspaceTasksBody"),
    workspaceTasksTable: document.getElementById("workspaceTasksTable")
};

window.PMProjectsAuth.requireAuth(initialiseTaskPage);

function initialiseTaskPage() {
    state.config = loadConfig();
    elements.backToProjectsButton.addEventListener("click", () => {
        window.location.href = "index.html";
    });
    elements.logoutButton.addEventListener("click", () => window.PMProjectsAuth.logout());
    elements.generatePODButton.addEventListener("click", openPODPanel);
    elements.expandAllTasksButton.addEventListener("click", () => {
        state.collapsedTaskIds.clear();
        renderTaskPage();
    });
    elements.collapseAllTasksButton.addEventListener("click", () => {
        const projectRows = buildTaskRows(state.projectId);
        projectRows
            .filter(row => row.hasChildren)
            .forEach(row => state.collapsedTaskIds.add(row.task.id));
        renderTaskPage();
    });

    loadCachedWorkspace();
    initialiseResizableTaskColumns();
    renderTaskPage();

    if (isConfigured()) {
        refreshWorkspace({ force: false });
    }
}

async function refreshWorkspace({ force }) {
    try {
        const cursor = await fetchSyncCursor();
        const hasRemoteChange = !state.cursor?.last_snapshot_updated_at
            || cursor?.last_snapshot_updated_at !== state.cursor.last_snapshot_updated_at;

        if (!force && cursor && !hasRemoteChange && state.projects.length > 0 && state.tasks.length > 0 && state.hasFreshTaskCache) {
            return;
        }

        const projects = await fetchProjects();
        const allowedProject = projects.some(project => project.id === state.projectId);
        const [projectFields, tasks] = allowedProject
            ? await Promise.all([
                fetchProjectCustomFields(projects.map(project => project.id).filter(Boolean)),
                fetchTasks()
            ])
            : [[], []];
        const [taskFields, equipment] = await Promise.all([
            fetchTaskCustomFieldsForTasks(tasks),
            fetchEquipmentForTasks(tasks)
        ]);

        state.cursor = cursor;
        state.projects = attachProjectFields(projects, projectFields);
        state.tasks = attachTaskFields(tasks, taskFields);
        state.equipment = equipment;
        state.hasFreshTaskCache = true;
        state.didApplyInitialCollapse = false;
        saveCachedWorkspace();
        renderTaskPage();
    } catch (error) {
        elements.workspaceProjectSubtitle.textContent = error.message || "Unable to load workspace.";
        console.error(error);
    }
}

async function fetchSyncCursor() {
    const rows = await supabaseGet("workspace_sync_cursors", {
        workspace_id: `eq.${state.config.workspaceId}`,
        select: "workspace_id,last_snapshot_updated_at,last_snapshot_actor,last_normalized_import_at",
        limit: "1"
    });
    return rows[0] || null;
}

async function fetchProjects() {
    const query = {
        workspace_id: `eq.${state.config.workspaceId}`,
        select: "id,parent_project_id,linked_equipment_id,name,start_date,end_date,actual_start_date,actual_end_date,po_number,so_number,rig_number,arf_ref,status,customer,category,serial_number,completion_percent,priority,arf,estimated_completion_date,mrb_status,remarks,sort_order",
        order: "sort_order.asc"
    };
    const scope = currentArfScope();
    if (scope) {
        query.arf = `eq.${scope}`;
        query.status = "eq.In-Progress";
    }
    return supabaseGetAll("projects_normalized", query);
}

async function fetchProjectCustomFields(projectIds = []) {
    if (currentArfScope() && !projectIds.length) {
        return [];
    }
    const query = {
        workspace_id: `eq.${state.config.workspaceId}`,
        select: "project_id,field_key,field_value"
    };
    if (projectIds.length) {
        query.project_id = `in.(${projectIds.join(",")})`;
    }
    return supabaseGetAll("project_custom_fields", query);
}

async function fetchTasks() {
    return supabaseGetAll("tasks_normalized", {
        workspace_id: `eq.${state.config.workspaceId}`,
        project_id: `eq.${state.projectId}`,
        select: "id,project_id,parent_task_id,linked_equipment_id,icon_name,comment,title,status,mrb_status,serial_number,part_number,size,rwp,category,depth,sort_order",
        order: "depth.asc,sort_order.asc"
    });
}

async function fetchTaskCustomFieldsForTasks(tasks) {
    const taskIds = tasks.map(task => task.id).filter(Boolean);
    if (!taskIds.length) {
        return [];
    }

    const chunks = [];
    for (let index = 0; index < taskIds.length; index += 150) {
        chunks.push(taskIds.slice(index, index + 150));
    }

    const pages = await Promise.all(chunks.map(chunk => supabaseGetAll("task_custom_fields", {
        workspace_id: `eq.${state.config.workspaceId}`,
        task_id: `in.(${chunk.join(",")})`,
        select: "task_id,field_key,field_value"
    })));
    return pages.flat();
}

async function fetchEquipmentForTasks(tasks) {
    const equipmentIds = [...new Set(tasks.map(task => task.linked_equipment_id).filter(Boolean))];
    if (!equipmentIds.length) {
        return [];
    }

    const chunks = [];
    for (let index = 0; index < equipmentIds.length; index += 150) {
        chunks.push(equipmentIds.slice(index, index + 150));
    }

    const pages = await Promise.all(chunks.map(chunk => supabaseGetAll("equipment_items_normalized", {
        workspace_id: `eq.${state.config.workspaceId}`,
        id: `in.(${chunk.join(",")})`,
        select: "id,serial_number,part_number,category,size,rwp,customer,arf"
    })));
    return pages.flat();
}

async function supabaseGetAll(table, query, pageSize = 1000) {
    const rows = [];
    let offset = 0;
    while (true) {
        const page = await supabaseGet(table, {
            ...query,
            limit: String(pageSize),
            offset: String(offset)
        });
        rows.push(...page);
        if (page.length < pageSize) {
            return rows;
        }
        offset += pageSize;
    }
}

async function supabaseGet(table, query) {
    const url = new URL(`${state.config.projectUrl}/rest/v1/${table}`);
    Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value));

    const response = await fetch(url, {
        headers: {
            apikey: state.config.apiKey,
            Authorization: `Bearer ${window.PMProjectsAuth.accessToken() || state.config.apiKey}`,
            Accept: "application/json"
        }
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`${table} failed (${response.status}) ${body}`.trim());
    }

    return response.json();
}

async function supabasePatch(table, query, payload) {
    const url = new URL(`${state.config.projectUrl}/rest/v1/${table}`);
    Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value));

    const response = await fetch(url, {
        method: "PATCH",
        headers: {
            apikey: state.config.apiKey,
            Authorization: `Bearer ${window.PMProjectsAuth.accessToken() || state.config.apiKey}`,
            Accept: "application/json",
            "Content-Type": "application/json",
            Prefer: "return=minimal"
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`${table} update failed (${response.status}) ${body}`.trim());
    }
}

async function supabaseUpsert(table, query, payload) {
    const url = new URL(`${state.config.projectUrl}/rest/v1/${table}`);
    Object.entries(query).forEach(([key, value]) => url.searchParams.set(key, value));

    const response = await fetch(url, {
        method: "POST",
        headers: {
            apikey: state.config.apiKey,
            Authorization: `Bearer ${window.PMProjectsAuth.accessToken() || state.config.apiKey}`,
            Accept: "application/json",
            "Content-Type": "application/json",
            Prefer: "resolution=merge-duplicates,return=minimal"
        },
        body: JSON.stringify(payload)
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`${table} upsert failed (${response.status}) ${body}`.trim());
    }
}

async function updateTaskEditableField(taskId, field, value) {
    if (!TASK_EDITABLE_FIELDS.has(field)) {
        throw new Error("Only task Status and MRB Status can be changed from the web app.");
    }

    const previousTasks = state.tasks.map(task => ({
        ...task,
        customFields: { ...(task.customFields || {}) }
    }));
    const task = state.tasks.find(item => item.id === taskId);
    if (!task) {
        throw new Error("Task not found.");
    }

    const changedTasks = new Map();
    task[field] = value;
    changedTasks.set(task.id, { [field]: value });

    if (field === "status") {
        rollUpParentTaskStatuses(task.id, changedTasks);
    }

    renderTaskPage();

    try {
        for (const [changedTaskId, payload] of changedTasks.entries()) {
            await supabasePatch("tasks_normalized", {
                workspace_id: `eq.${state.config.workspaceId}`,
                id: `eq.${changedTaskId}`
            }, payload);
        }
        await touchWorkspaceSyncCursor();
        saveCachedWorkspace();
    } catch (error) {
        state.tasks = previousTasks;
        renderTaskPage();
        throw error;
    }
}

function rollUpParentTaskStatuses(changedTaskId, changedTasks) {
    let parentId = state.tasks.find(task => task.id === changedTaskId)?.parent_task_id || "";

    while (parentId) {
        const parent = state.tasks.find(task => task.id === parentId);
        if (!parent) return;

        const childStatuses = state.tasks
            .filter(task => task.parent_task_id === parent.id && !isTaskInactive(task))
            .map(task => task.status);
        const rolledStatus = rolledParentStatus(childStatuses);

        if (parent.status !== rolledStatus) {
            parent.status = rolledStatus;
            changedTasks.set(parent.id, {
                ...(changedTasks.get(parent.id) || {}),
                status: rolledStatus
            });
        }
        parentId = parent.parent_task_id || "";
    }
}

function rolledParentStatus(childStatuses) {
    if (!childStatuses.length) {
        return "Not Started";
    }
    if (childStatuses.every(status => status === "Done")) {
        return "Done";
    }
    return "In-Progress";
}

function isTaskInactive(task) {
    const value = task.customFields?.["Task Active"];
    return value === false || String(value || "").toLowerCase() === "false";
}

async function touchWorkspaceSyncCursor() {
    const timestamp = new Date().toISOString();
    await supabaseUpsert("workspace_sync_cursors", {
        on_conflict: "workspace_id"
    }, [{
        workspace_id: state.config.workspaceId,
        last_snapshot_updated_at: timestamp,
        last_snapshot_actor: "PMProjects Web",
        last_normalized_import_at: timestamp
    }]);
    state.cursor = {
        ...(state.cursor || {}),
        workspace_id: state.config.workspaceId,
        last_snapshot_updated_at: timestamp,
        last_snapshot_actor: "PMProjects Web",
        last_normalized_import_at: timestamp
    };
}

function renderTaskPage() {
    document.body.classList.toggle("arf-scoped", Boolean(currentArfScope()));
    renderTaskUserLabel();
    const project = state.projects.find(item => item.id === state.projectId);
    if (!project) {
        elements.workspaceProjectTitle.textContent = "Project not loaded";
        elements.workspaceProjectSubtitle.textContent = isConfigured()
            ? "Refresh the project workspace, then open the project again."
            : "Configure Supabase from the project workspace first.";
        elements.workspaceHero.innerHTML = "";
        elements.workspaceTaskStatus.innerHTML = "";
        elements.workspaceTaskCount.textContent = "0 tasks";
        elements.workspaceTasksBody.innerHTML = "";
        elements.workspaceTasksBody.appendChild(emptyRow(11, "No project data available."));
        return;
    }

    const taskRows = buildTaskRows(project.id);
    applyInitialCollapse(taskRows);
    const doneTasks = taskRows.filter(row => row.task.status === "Done").length;
    const inProgressTasks = taskRows.filter(row => row.task.status === "In-Progress").length;
    const notStartedTasks = taskRows.filter(row => row.task.status === "Not Started").length;
    const rejectedTasks = taskRows.filter(row => row.task.status === "Rejected").length;
    const valveSummary = valveSummaryForTasks(taskRows.map(row => row.task));
    const progress = progressForProject(project);

    elements.workspaceProjectTitle.textContent = project.name || "Untitled Project";
    elements.workspaceProjectSubtitle.textContent = compactJoin([project.arf_ref, project.customer, project.status], " · ");
    elements.workspaceTaskStatus.innerHTML = "";
    elements.workspaceTaskStatus.hidden = true;

    elements.workspaceHero.innerHTML = "";
    elements.workspaceHero.appendChild(taskSummaryWidget({
        progress,
        taskRows,
        notStartedTasks,
        inProgressTasks,
        doneTasks,
        rejectedTasks,
        valveSummary,
        project
    }));

    renderTasks(taskRows);
}

function renderTaskUserLabel() {
    if (!elements.taskUserLabel) return;
    const label = window.PMProjectsAuth.userLabel?.() || "";
    const scope = currentArfScope();
    elements.taskUserLabel.textContent = scope ? `Signed in as ${label} • ARF ${scope}` : `Signed in as ${label}`;
}

function renderTasks(taskRows) {
    const visibleRows = visibleTaskRows(taskRows);
    elements.workspaceTaskCount.textContent = `${taskRows.length} tasks`;
    elements.workspaceTasksBody.innerHTML = "";

    if (!taskRows.length) {
        elements.workspaceTasksBody.appendChild(emptyRow(11, "No tasks for this project."));
        return;
    }

    const fragment = document.createDocumentFragment();
    visibleRows.forEach(row => {
        const tr = document.createElement("tr");
        tr.append(
            textCell(row.wbs),
            taskTitleCell(row, taskRows),
            editableTaskSelectCell(row.task, "status", TASK_STATUS_OPTIONS, statusClass(row.task.status)),
            editableTaskSelectCell(row.task, "mrb_status", TASK_MRB_STATUS_OPTIONS, "status"),
            taskProgressCell(row, taskRows),
            textCell(row.task.serial_number),
            textCell(row.task.part_number),
            textCell(row.task.size),
            textCell(row.task.rwp),
            categoryCell(row.task.category),
            textCell(row.task.comment)
        );
        fragment.appendChild(tr);
    });
    elements.workspaceTasksBody.appendChild(fragment);
}

function openPODPanel() {
    const project = state.projects.find(item => item.id === state.projectId);
    if (!project) return;
    const taskRows = buildTaskRows(project.id);
    const taskOptions = podWBSOptions(taskRows);
    const draft = {
        ...(loadPODDraft(project) || makePODDraft(project)),
        deliveryDate: localDateInputValue()
    };
    let savedNoteRecords = loadSavedPODDeliveryNoteRecords(project);
    let selectedSavedNoteID = matchingSavedPODDeliveryNoteID(draft, savedNoteRecords);

    const overlay = document.createElement("section");
    overlay.className = "pod-overlay";
    overlay.innerHTML = `
        <div class="pod-panel has-saved-notes">
            <div class="pod-panel-header">
                <div>
                    <h2>Generate POD</h2>
                    <p></p>
                </div>
                <button type="button" data-action="close">Close</button>
            </div>
            <div class="pod-panel-body">
                <aside class="pod-saved-notes">
                    <div class="pod-saved-notes-header">
                        <div>
                            <h3>Saved Notes</h3>
                            <span data-role="pod-saved-count">0 records</span>
                        </div>
                        <button type="button" data-action="new-saved-note" aria-label="New delivery note">+</button>
                    </div>
                    <div class="pod-saved-notes-list" data-role="pod-saved-list"></div>
                    <div class="pod-saved-notes-actions">
                        <button type="button" data-action="save-saved-note">Save Current</button>
                        <button type="button" data-action="delete-saved-note">Delete Selected</button>
                    </div>
                </aside>
                <div class="pod-document">
                    <section class="pod-section">
                        <h3>Header Details</h3>
                        <div class="pod-grid three">
                            ${podFieldHTML("Date", "deliveryDate", "date", draft.deliveryDate)}
                            ${podFieldHTML("Delivery Note #", "deliveryNoteNumber", "text", draft.deliveryNoteNumber)}
                            ${podFieldHTML("Rev#", "revisionNumber", "text", draft.revisionNumber)}
                        </div>
                        <div class="pod-grid two">
                            ${podFieldHTML("ARF", "arf", "text", draft.arf)}
                            ${podFieldHTML("Ship To", "shipTo", "text", draft.shipTo)}
                        </div>
                    </section>
                    <section class="pod-section">
                        <h3>Project Data</h3>
                        <div class="pod-grid three">
                            ${podFieldHTML("Quote #", "quoteNumber", "text", draft.quoteNumber)}
                            ${podFieldHTML("Customer PO #", "customerPONumber", "text", draft.customerPONumber)}
                            ${podFieldHTML("Sales Order", "salesOrder", "text", draft.salesOrder)}
                        </div>
                        <div class="pod-grid two">
                            ${podFieldHTML("Reference", "reference", "text", draft.reference)}
                            ${podFieldHTML("ARF Reference", "arfReference", "text", draft.arfReference)}
                        </div>
                    </section>
                    <section class="pod-section">
                        <div class="pod-section-title">
                            <h3>Items</h3>
                            <button type="button" data-action="add-row">Add Row</button>
                        </div>
                        <div class="pod-items"></div>
                    </section>
                    <section class="pod-section">
                        <h3>Notes</h3>
                        <textarea name="notes" rows="4"></textarea>
                    </section>
                </div>
            </div>
            <div class="pod-panel-actions">
                <label class="pod-delivered"><input type="checkbox" name="delivered"> Delivered</label>
                <button type="button" data-action="save">Save Draft</button>
                <button type="button" data-action="generate" class="primary-action">Generate PDF</button>
            </div>
        </div>
    `;
    overlay.querySelector(".pod-panel-header p").textContent = project.name || "Project";
    overlay.querySelector('textarea[name="notes"]').value = draft.notes || "";
    overlay.querySelector('input[name="delivered"]').checked = Boolean(draft.delivered);
    document.body.appendChild(overlay);

    let items = normalizePODItems(draft.items);
    const itemContainer = overlay.querySelector(".pod-items");
    const savedNotesCount = overlay.querySelector("[data-role='pod-saved-count']");
    const savedNotesList = overlay.querySelector("[data-role='pod-saved-list']");
    const renderItems = () => {
        itemContainer.innerHTML = "";
        itemContainer.appendChild(podItemHeaderRow());
        items.forEach((item, index) => itemContainer.appendChild(podItemRow(item, index, taskOptions)));
    };
    renderItems();

    const renderSavedNotes = () => {
        savedNotesCount.textContent = `${savedNoteRecords.length} ${savedNoteRecords.length === 1 ? "record" : "records"}`;
        if (!savedNoteRecords.length) {
            savedNotesList.innerHTML = `<div class="pod-saved-empty">No saved delivery notes.</div>`;
            return;
        }
        savedNotesList.innerHTML = savedNoteRecords.map(record => {
            const recordDraft = normalizePODDraft(record.draft);
            const selectedClass = record.id === selectedSavedNoteID ? " selected" : "";
            const title = recordDraft.deliveryNoteNumber || "Delivery Note";
            const subtitle = [
                recordDraft.deliveryDate ? podSavedNoteDateText(recordDraft.deliveryDate) : "",
                recordDraft.shipTo || ""
            ].filter(Boolean).join(" - ");
            return `
                <button type="button" class="pod-saved-note${selectedClass}" data-action="select-saved-note" data-note-id="${escapeHTML(record.id)}">
                    <strong>${escapeHTML(title)}</strong>
                    <span>${escapeHTML(subtitle || "Saved delivery note")}</span>
                </button>
            `;
        }).join("");
    };

    const applyDraftToPanel = nextDraft => {
        const normalizedDraft = normalizePODDraft(nextDraft);
        Object.entries({
            deliveryDate: normalizedDraft.deliveryDate,
            deliveryNoteNumber: normalizedDraft.deliveryNoteNumber,
            revisionNumber: normalizedDraft.revisionNumber,
            arf: normalizedDraft.arf,
            shipTo: normalizedDraft.shipTo,
            quoteNumber: normalizedDraft.quoteNumber,
            customerPONumber: normalizedDraft.customerPONumber,
            salesOrder: normalizedDraft.salesOrder,
            reference: normalizedDraft.reference,
            arfReference: normalizedDraft.arfReference,
            notes: normalizedDraft.notes
        }).forEach(([name, value]) => {
            const field = overlay.querySelector(`[name='${name}']`);
            if (field) field.value = value || "";
        });
        overlay.querySelector("[name='delivered']").checked = Boolean(normalizedDraft.delivered);
        items = normalizePODItems(normalizedDraft.items);
        renderItems();
    };

    const saveCurrentPODDeliveryNoteRecord = () => {
        const nextDraft = collectPODDraft(overlay, project);
        savePODDraft(project, nextDraft);
        const timestamp = new Date().toISOString();
        if (selectedSavedNoteID) {
            savedNoteRecords = savedNoteRecords.map(record => (
                record.id === selectedSavedNoteID
                    ? { ...record, draft: nextDraft, updatedAt: timestamp }
                    : record
            ));
        } else {
            selectedSavedNoteID = makeLocalRecordID();
            savedNoteRecords = [
                {
                    id: selectedSavedNoteID,
                    draft: nextDraft,
                    createdAt: timestamp,
                    updatedAt: timestamp
                },
                ...savedNoteRecords
            ];
        }
        savedNoteRecords = sortedPODDeliveryNoteRecords(savedNoteRecords);
        saveSavedPODDeliveryNoteRecords(project, savedNoteRecords);
        renderSavedNotes();
        return nextDraft;
    };

    renderSavedNotes();

    overlay.addEventListener("click", async event => {
        const action = event.target.closest("[data-action]")?.dataset.action;
        if (!action) return;
        if (action === "close") {
            overlay.remove();
            return;
        }
        if (action === "add-row") {
            items = collectPODItems(overlay);
            items.push(makePODDraftItem(items.length + 1));
            renderItems();
            return;
        }
        if (action === "delete-row") {
            items = collectPODItems(overlay).filter((_, index) => index !== Number(event.target.dataset.index));
            if (!items.length) items = [makePODDraftItem(1)];
            renderItems();
            return;
        }
        if (action === "new-saved-note") {
            const baseDraft = makePODDraft(project);
            selectedSavedNoteID = null;
            applyDraftToPanel({
                ...baseDraft,
                deliveryDate: localDateInputValue(),
                deliveryNoteNumber: nextPODDeliveryNoteNumber(baseDraft.deliveryNoteNumber, savedNoteRecords)
            });
            renderSavedNotes();
            return;
        }
        if (action === "select-saved-note") {
            const noteID = event.target.closest("[data-note-id]")?.dataset.noteId;
            const record = savedNoteRecords.find(item => item.id === noteID);
            if (!record) return;
            selectedSavedNoteID = record.id;
            const nextDraft = normalizePODDraft(record.draft);
            savePODDraft(project, nextDraft);
            applyDraftToPanel(nextDraft);
            renderSavedNotes();
            return;
        }
        if (action === "save-saved-note") {
            saveCurrentPODDeliveryNoteRecord();
            return;
        }
        if (action === "delete-saved-note") {
            if (!selectedSavedNoteID) return;
            savedNoteRecords = savedNoteRecords.filter(record => record.id !== selectedSavedNoteID);
            selectedSavedNoteID = savedNoteRecords[0]?.id || null;
            saveSavedPODDeliveryNoteRecords(project, savedNoteRecords);
            const nextDraft = selectedSavedNoteID
                ? normalizePODDraft(savedNoteRecords.find(record => record.id === selectedSavedNoteID)?.draft || makePODDraft(project))
                : makePODDraft(project);
            savePODDraft(project, nextDraft);
            applyDraftToPanel(nextDraft);
            renderSavedNotes();
            return;
        }
        if (action === "save" || action === "generate") {
            const nextDraft = saveCurrentPODDeliveryNoteRecord();
            if (action === "generate") {
                if (nextDraft.delivered) {
                    try {
                        await markPODDraftItemsDelivered(project, nextDraft);
                    } catch (error) {
                        elements.workspaceProjectSubtitle.textContent = error.message || "POD delivered update failed";
                        console.error(error);
                        return;
                    }
                }
                await generatePODPrintWindow(project, nextDraft);
            }
        }
    });

    overlay.addEventListener("change", event => {
        const taskSelect = event.target.closest("select[data-role='pod-task']");
        if (taskSelect) {
            const row = taskSelect.closest(".pod-item-row");
            const option = taskOptions.find(item => item.id === taskSelect.value);
            if (!row || !option) return;
            row.querySelector("[name='linkedWBS']").value = option.wbs;
            row.querySelector("[name='itemDescription']").value = option.description;
            row.querySelector("[name='linkedTaskID']").value = option.id;
            const currentSerials = selectedPODSerialsForRow(row).filter(serial => option.serialOptions.includes(serial));
            const nextSerials = option.serialOptions.length === 1 ? [option.serialOptions[0]] : currentSerials;
            setPODSelectedSerials(row, nextSerials);
            populatePODSerialMenu(row.querySelector("[data-role='pod-serial-menu']"), option, nextSerials);
            updatePODPartNumber(row, option);
            updatePODItemQuantity(row);
            return;
        }

        const serialMenu = event.target.closest("[data-role='pod-serial-menu']");
        if (serialMenu) {
            const row = serialMenu.closest(".pod-item-row");
            const option = taskOptions.find(item => item.id === row?.querySelector("[data-role='pod-task']")?.value);
            if (!row || !option) return;
            populatePODSerialMenu(serialMenu, option, selectedPODSerialsForRow(row));
            updatePODPartNumber(row, option);
            updatePODItemQuantity(row);
        }
    });

    overlay.addEventListener("click", event => {
        const menuToggle = event.target.closest("summary[data-serial-toggle]");
        if (menuToggle) {
            const menu = menuToggle.closest("[data-role='pod-serial-menu']");
            overlay.querySelectorAll(".pod-serial-menu[open]").forEach(openMenu => {
                if (openMenu !== menu) openMenu.removeAttribute("open");
            });
            return;
        }

        const menuAction = event.target.closest("[data-serial-action]");
        if (menuAction) {
            const row = menuAction.closest(".pod-item-row");
            const option = taskOptions.find(item => item.id === row?.querySelector("[data-role='pod-task']")?.value);
            if (!row || !option) return;
            if (menuAction.dataset.serialAction === "clear") {
                setPODSelectedSerials(row, []);
            } else {
                const serial = menuAction.dataset.serial || "";
                const selected = selectedPODSerialsForRow(row);
                setPODSelectedSerials(
                    row,
                    selected.includes(serial)
                        ? selected.filter(item => item !== serial)
                        : [...selected, serial]
                );
            }
            populatePODSerialMenu(row.querySelector("[data-role='pod-serial-menu']"), option, selectedPODSerialsForRow(row));
            updatePODPartNumber(row, option);
            updatePODItemQuantity(row);
            row.querySelector("[data-role='pod-serial-menu']")?.setAttribute("open", "");
            return;
        }

        if (!event.target.closest(".pod-serial-menu")) {
            overlay.querySelectorAll(".pod-serial-menu[open]").forEach(menu => menu.removeAttribute("open"));
        }
    });
}

function podFieldHTML(label, name, type, value) {
    return `<label><span>${escapeHTML(label)}</span><input name="${name}" type="${type}" value="${escapeHTML(value || "")}"></label>`;
}

function podItemHeaderRow() {
    const row = document.createElement("div");
    row.className = "pod-item-row pod-item-header";
    row.innerHTML = "<span>WBS</span><span>Part No</span><span>Description</span><span>Serial#</span><span>Qty</span><span>UOM</span><span></span>";
    return row;
}

function podItemRow(item, index, taskOptions) {
    const row = document.createElement("div");
    row.className = "pod-item-row";
    row.innerHTML = `
        <select data-role="pod-task"></select>
        <input name="partNumber" type="text" readonly>
        <textarea name="itemDescription" rows="2" readonly></textarea>
        <details class="pod-serial-menu" data-role="pod-serial-menu">
            <summary data-serial-toggle>Select Serial#</summary>
            <div class="pod-serial-options"></div>
            <input name="selectedSerialNumbers" type="hidden">
        </details>
        <input name="quantity" type="text" readonly>
        <input name="uom" type="text">
        <button type="button" data-action="delete-row" data-index="${index}">Delete</button>
        <input name="linkedWBS" type="hidden">
        <input name="linkedTaskID" type="hidden">
    `;
    const taskSelect = row.querySelector("select[data-role='pod-task']");
    taskSelect.appendChild(new Option(item.linkedWBS || "Select WBS", ""));
    taskOptions.forEach(option => {
        const menuLabel = `${"  ".repeat(option.level)}${option.wbs} ${option.title}`;
        taskSelect.appendChild(new Option(menuLabel, option.id));
    });
    taskSelect.value = item.linkedTaskID || "";

    const serialMenu = row.querySelector("[data-role='pod-serial-menu']");
    const option = taskOptions.find(entry => entry.id === item.linkedTaskID);
    if (option) {
        const selectedSerials = migratedPODSerialSelection(item, option);
        setPODSelectedSerials(row, selectedSerials);
        populatePODSerialMenu(serialMenu, option, selectedPODSerialsForRow(row));
    } else {
        setPODSelectedSerials(row, item.selectedSerialNumbers);
        populatePODSerialMenu(serialMenu, null, item.selectedSerialNumbers);
    }

    row.querySelector("[name='partNumber']").value = item.partNumber || "";
    row.querySelector("[name='itemDescription']").value = item.itemDescription || "";
    row.querySelector("[name='quantity']").value = item.quantity || "";
    row.querySelector("[name='uom']").value = item.uom || "";
    row.querySelector("[name='linkedWBS']").value = item.linkedWBS || "";
    row.querySelector("[name='linkedTaskID']").value = item.linkedTaskID || "";
    if (option) {
        updatePODPartNumber(row, option);
        updatePODItemQuantity(row);
    }
    return row;
}

function updatePODItemQuantity(row) {
    if (!row) return;
    const count = selectedPODSerialsForRow(row).length;
    row.querySelector("[name='quantity']").value = count > 0 ? String(count).padStart(2, "0") : "";
}

function populatePODSerialMenu(menu, option, selectedSerials = []) {
    if (!menu) return;
    const summary = menu.querySelector("[data-serial-toggle]");
    const optionsContainer = menu.querySelector(".pod-serial-options");
    const availableSerials = option?.serialOptions || [];
    const deliveredSerials = new Set((option?.deliveredSerialOptions || []).map(normalizeSerial));
    const selected = selectedSerials.filter(serial => availableSerials.includes(serial));
    setPODSelectedSerials(menu.closest(".pod-item-row"), selected);

    if (!availableSerials.length) {
        summary.textContent = "-";
        menu.classList.add("no-options");
        optionsContainer.innerHTML = "";
        menu.removeAttribute("open");
        return;
    }

    menu.classList.remove("no-options");
    summary.textContent = podSerialMenuTitle(selected);
    const clearHTML = selected.length
        ? `<button type="button" class="pod-serial-clear" data-serial-action="clear">Clear Serial Selection</button>`
        : "";
    optionsContainer.innerHTML = `
        ${clearHTML}
        ${availableSerials.map(serial => `
            <label data-serial-action="toggle" data-serial="${escapeHTML(serial)}">
                <input type="checkbox" tabindex="-1" ${selected.includes(serial) ? "checked" : ""}>
                <span>${escapeHTML(serial)}${deliveredSerials.has(normalizeSerial(serial)) ? " (Delivered)" : ""}</span>
            </label>
        `).join("")}
    `;
}

function migratedPODSerialSelection(item, option) {
    const availableSerials = option.serialOptions || [];
    const selectedSerials = (item.selectedSerialNumbers || []).filter(serial => availableSerials.includes(serial));
    const quantity = Number.parseInt(item.quantity || "", 10);
    if (
        availableSerials.length > 1
        && selectedSerials.length === availableSerials.length
        && quantity === availableSerials.length
    ) {
        return [];
    }
    return selectedSerials;
}

function podSerialMenuTitle(selectedSerials) {
    if (!selectedSerials.length) return "Select Serial#";
    if (selectedSerials.length === 1) return selectedSerials[0];
    return `${selectedSerials[0]} +${selectedSerials.length - 1}`;
}

function selectedPODSerialsForRow(row) {
    if (!row) return [];
    const input = row.querySelector("[name='selectedSerialNumbers']");
    try {
        return uniqueValues(JSON.parse(input?.value || "[]"));
    } catch {
        return uniqueValues(String(input?.value || "").split(","));
    }
}

function setPODSelectedSerials(row, serials) {
    if (!row) return;
    const input = row.querySelector("[name='selectedSerialNumbers']");
    if (!input) return;
    input.value = JSON.stringify(uniqueValues(serials || []));
}

function updatePODPartNumber(row, option) {
    if (!row || !option) return;
    const selectedSerials = selectedPODSerialsForRow(row);
    const resolvedParts = selectedSerials.length
        ? uniqueValues(selectedSerials.map(serial => {
            const match = (option.serialPartOptions || []).find(item => normalizeSerial(item.serial) === normalizeSerial(serial));
            return match?.partNumber || "";
        }))
        : option.uniquePartNumbers;
    row.querySelector("[name='partNumber']").value = resolvedParts.join(", ");
}

function buildTaskRows(projectId) {
    const all = state.tasks
        .filter(task => task.project_id === projectId)
        .sort((a, b) => {
            const depthDelta = Number(a.depth || 0) - Number(b.depth || 0);
            if (depthDelta !== 0) return depthDelta;
            return Number(a.sort_order || 0) - Number(b.sort_order || 0);
        });

    if (!all.length) {
        return [];
    }

    const storedRows = buildStoredWBSRows(all);
    const maxStoredLevel = Math.max(0, ...storedRows.map(row => row.level));
    const maxTaskDepth = Math.max(0, ...all.map(task => Number(task.depth || 0)));
    if (storedRows.length === all.length && maxStoredLevel >= maxTaskDepth) {
        return storedRows;
    }

    const childrenByParent = new Map();
    all.forEach(task => {
        const key = task.parent_task_id || "";
        if (!childrenByParent.has(key)) {
            childrenByParent.set(key, []);
        }
        childrenByParent.get(key).push(task);
    });

    const rows = [];
    const walk = (parentId, prefix) => {
        const children = childrenByParent.get(parentId || "") || [];
        children.forEach((task, index) => {
            const wbs = prefix ? `${prefix}.${index + 1}` : `${index + 1}`;
            rows.push({
                task,
                wbs,
                level: prefix ? prefix.split(".").length : 0,
                hasChildren: (childrenByParent.get(task.id) || []).length > 0
            });
            walk(task.id, wbs);
        });
    };
    walk(null, "");

    const maxLinkedLevel = Math.max(0, ...rows.map(row => row.level));
    if (rows.length === all.length && maxLinkedLevel >= maxTaskDepth) {
        return rows;
    }

    const depthRows = buildDepthFallbackRows(all);
    const maxDepthLevel = Math.max(0, ...depthRows.map(row => row.level));
    if (depthRows.length >= rows.length && maxDepthLevel >= maxLinkedLevel) {
        return depthRows;
    }

    const included = new Set(rows.map(row => row.task.id));
    const orphanRows = buildDepthFallbackRows(all.filter(task => !included.has(task.id)));
    return [...rows, ...orphanRows];
}

function buildStoredWBSRows(tasks) {
    const rows = tasks
        .map(task => {
            const wbs = storedWBSForTask(task);
            if (!wbs) return null;
            return {
                task,
                wbs,
                level: Math.max(0, wbs.split(".").length - 1),
                hasChildren: false
            };
        })
        .filter(Boolean)
        .sort((a, b) => compareWBS(a.wbs, b.wbs));

    rows.forEach(row => {
        row.hasChildren = rows.some(candidate => candidate.wbs.startsWith(`${row.wbs}.`));
    });
    return rows;
}

function buildDepthFallbackRows(tasks) {
    const counters = [];
    const rows = tasks.map(task => {
        const depth = Math.max(0, Number(task.depth || 0));
        counters[depth] = (counters[depth] || 0) + 1;
        counters.length = depth + 1;
        const wbs = counters.slice(0, depth + 1).join(".");
        return {
            task,
            wbs,
            level: depth,
            hasChildren: tasks.some(candidate => candidate.parent_task_id === task.id)
        };
    });
    rows.forEach(row => {
        row.hasChildren ||= rows.some(candidate => candidate.wbs.startsWith(`${row.wbs}.`));
    });
    return rows;
}

function makePODDraft(project) {
    return {
        deliveryDate: localDateInputValue(),
        deliveryNoteNumber: suggestedPODDeliveryNoteNumber(project),
        revisionNumber: "0",
        delivered: false,
        arf: project.arf || "",
        shipTo: project.customer || "",
        quoteNumber: project.name || "",
        customerPONumber: project.po_number || "",
        salesOrder: project.so_number || "",
        reference: project.rig_number || "",
        arfReference: project.arf_ref || "",
        notes: "Goods received in good condition.",
        items: [makePODDraftItem(1)]
    };
}

function localDateInputValue(date = new Date()) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function makePODDraftItem(itemNumber) {
    return {
        itemNumber,
        linkedTaskID: "",
        linkedWBS: "",
        partNumber: "",
        itemDescription: "",
        selectedSerialNumbers: [],
        quantity: "",
        uom: "Each"
    };
}

function suggestedPODDeliveryNoteNumber(project) {
    const name = String(project.name || "").trim();
    if (!name) return "DN-";
    if (name.startsWith("Q-")) return `DN-${name.slice(2)}`;
    if (name.startsWith("Q")) return `DN-${name.slice(1)}`;
    return `DN-${name}`;
}

function podDraftStorageKey(project) {
    return `pmprojects.web.podDraft.${project.id}`;
}

function loadPODDraft(project) {
    try {
        const draft = JSON.parse(localStorage.getItem(podDraftStorageKey(project)));
        return draft ? normalizePODDraft(draft) : null;
    } catch {
        return null;
    }
}

function savePODDraft(project, draft) {
    try {
        localStorage.setItem(podDraftStorageKey(project), JSON.stringify(normalizePODDraft(draft)));
    } catch {
        // Draft persistence is local convenience only; generation still works.
    }
}

function podSavedDeliveryNotesStorageKey(project) {
    return `${POD_SAVED_DELIVERY_NOTES_KEY_PREFIX}.${project.id}`;
}

function loadSavedPODDeliveryNoteRecords(project) {
    try {
        const records = JSON.parse(localStorage.getItem(podSavedDeliveryNotesStorageKey(project)) || "[]");
        return sortedPODDeliveryNoteRecords((Array.isArray(records) ? records : []).map(normalizePODDeliveryNoteRecord).filter(Boolean));
    } catch {
        return [];
    }
}

function saveSavedPODDeliveryNoteRecords(project, records) {
    try {
        localStorage.setItem(
            podSavedDeliveryNotesStorageKey(project),
            JSON.stringify(sortedPODDeliveryNoteRecords(records).map(normalizePODDeliveryNoteRecord).filter(Boolean))
        );
    } catch {
        // Saved notes are local convenience only; POD generation can continue without them.
    }
}

function normalizePODDeliveryNoteRecord(record) {
    if (!record || typeof record !== "object") return null;
    const timestamp = record.updatedAt || record.createdAt || new Date().toISOString();
    return {
        id: String(record.id || makeLocalRecordID()),
        draft: normalizePODDraft(record.draft || {}),
        createdAt: record.createdAt || timestamp,
        updatedAt: timestamp
    };
}

function sortedPODDeliveryNoteRecords(records) {
    return [...records]
        .map(normalizePODDeliveryNoteRecord)
        .filter(Boolean)
        .sort((a, b) => String(b.updatedAt || "").localeCompare(String(a.updatedAt || "")));
}

function matchingSavedPODDeliveryNoteID(draft, records) {
    const deliveryNoteNumber = String(draft.deliveryNoteNumber || "").trim();
    if (!deliveryNoteNumber) return null;
    return records.find(record => String(record.draft?.deliveryNoteNumber || "").trim() === deliveryNoteNumber)?.id || null;
}

function nextPODDeliveryNoteNumber(baseNumber, records) {
    const base = String(baseNumber || "DN-").trim() || "DN-";
    const existing = new Set(records.map(record => String(record.draft?.deliveryNoteNumber || "").trim()));
    if (!existing.has(base)) return base;
    for (let index = 2; index < 1000; index += 1) {
        const candidate = `${base}-${String(index).padStart(2, "0")}`;
        if (!existing.has(candidate)) return candidate;
    }
    return `${base}-${Date.now()}`;
}

function podSavedNoteDateText(value) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) {
        const [year, month, day] = String(value).split("-");
        return `${day}/${month}/${year}`;
    }
    return formatDate(value);
}

function makeLocalRecordID() {
    if (window.crypto?.randomUUID) {
        return window.crypto.randomUUID();
    }
    return `${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

function normalizePODDraft(draft) {
    return {
        ...draft,
        revisionNumber: String(draft.revisionNumber || "0"),
        notes: draft.notes || "Goods received in good condition.",
        items: normalizePODItems(draft.items)
    };
}

function normalizePODItems(items) {
    const source = Array.isArray(items) && items.length ? items : [makePODDraftItem(1)];
    return source.map((item, index) => ({
        ...makePODDraftItem(index + 1),
        ...item,
        itemNumber: index + 1,
        uom: item.uom || "Each",
        selectedSerialNumbers: Array.isArray(item.selectedSerialNumbers) ? item.selectedSerialNumbers : []
    }));
}

function collectPODDraft(overlay, project) {
    const value = name => overlay.querySelector(`[name='${name}']`)?.value || "";
    return normalizePODDraft({
        deliveryDate: value("deliveryDate"),
        deliveryNoteNumber: value("deliveryNoteNumber"),
        revisionNumber: value("revisionNumber"),
        delivered: overlay.querySelector("[name='delivered']")?.checked || false,
        arf: value("arf"),
        shipTo: value("shipTo"),
        quoteNumber: value("quoteNumber"),
        customerPONumber: value("customerPONumber"),
        salesOrder: value("salesOrder"),
        reference: value("reference"),
        arfReference: value("arfReference"),
        notes: value("notes"),
        items: collectPODItems(overlay)
    });
}

function collectPODItems(overlay) {
    return [...overlay.querySelectorAll(".pod-item-row:not(.pod-item-header)")].map((row, index) => {
        const selectedTaskID = row.querySelector("[data-role='pod-task']").value || row.querySelector("[name='linkedTaskID']").value || "";
        const taskRow = buildTaskRows(state.projectId).find(candidate => candidate.task.id === selectedTaskID);
        return {
            itemNumber: index + 1,
            linkedTaskID: selectedTaskID,
            linkedWBS: row.querySelector("[name='linkedWBS']").value || taskRow?.wbs || "",
            partNumber: row.querySelector("[name='partNumber']").value || "",
            itemDescription: row.querySelector("[name='itemDescription']").value || "",
            selectedSerialNumbers: selectedPODSerialsForRow(row),
            quantity: row.querySelector("[name='quantity']").value || "",
            uom: row.querySelector("[name='uom']").value || ""
        };
    });
}

function podWBSOptions(taskRows) {
    return taskRows.map(row => {
        const serialOptions = podSerialOptionsForRow(row, taskRows);
        const deliveredSerialOptions = podDeliveredSerialOptionsForRow(row, taskRows);
        const serialPartOptions = podSerialPartOptionsForRow(row, taskRows);
        const uniquePartNumbers = uniquePODPartNumbersForRow(row, taskRows);
        return {
            id: row.task.id,
            wbs: row.wbs,
            title: row.task.title || "Untitled Task",
            level: row.level,
            description: row.task.title || "",
            serialOptions,
            deliveredSerialOptions,
            serialPartOptions,
            uniquePartNumbers
        };
    });
}

function podSerialOptionsForRow(row, taskRows) {
    const serials = [];
    const seen = new Set();
    const treeRows = [row, ...taskDescendantRows(row, taskRows)];
    treeRows.forEach(candidate => {
        if (!taskIsReadyForDeliveryIcon(candidate.task)) return;
        taskSerialTokens(candidate.task).forEach(serial => {
            const normalized = normalizeSerial(serial);
            if (!normalized || seen.has(normalized)) return;
            seen.add(normalized);
            serials.push(serial);
        });
    });
    return serials;
}

function podDeliveredSerialOptionsForRow(row, taskRows) {
    const serials = [];
    const seen = new Set();
    const treeRows = [row, ...taskDescendantRows(row, taskRows)];
    treeRows.forEach(candidate => {
        if (!taskWasDeliveredWithTreeInheritance(candidate, treeRows)) return;
        taskSerialTokens(candidate.task).forEach(serial => {
            const normalized = normalizeSerial(serial);
            if (!normalized || seen.has(normalized)) return;
            seen.add(normalized);
            serials.push(serial);
        });
    });
    return serials;
}

function podSerialPartOptionsForRow(row, taskRows) {
    const output = [];
    const seen = new Set();
    const treeRows = [row, ...taskDescendantRows(row, taskRows)];
    treeRows.forEach(candidate => {
        if (!taskIsReadyForDeliveryIcon(candidate.task)) return;
        const partNumber = effectiveTaskPartNumber(candidate.task);
        taskSerialTokens(candidate.task).forEach(serial => {
            const key = `${normalizeSerial(serial)}|${partNumber}`;
            if (!partNumber || !normalizeSerial(serial) || seen.has(key)) return;
            seen.add(key);
            output.push({ serial, partNumber });
        });
    });
    return output;
}

function uniquePODPartNumbersForRow(row, taskRows) {
    const treeRows = [row, ...taskDescendantRows(row, taskRows)];
    return uniqueValues(treeRows.map(candidate => effectiveTaskPartNumber(candidate.task)));
}

function taskWasDeliveredWithTreeInheritance(row, treeRows) {
    if (taskWasExplicitlyUndelivered(row.task)) {
        return false;
    }
    if (taskWasDeliveredForRow(row, treeRows)) {
        return true;
    }
    return treeRows.some(candidate => (
        candidate !== row
        && row.wbs.startsWith(`${candidate.wbs}.`)
        && taskWasDeliveredForRow(candidate, treeRows)
    ));
}

async function generatePODPrintWindow(project, draft) {
    const printWindow = window.open("", "_blank", "width=1100,height=850");
    if (!printWindow) {
        elements.workspaceProjectSubtitle.textContent = "Popup blocked. Allow popups to generate POD PDF.";
        return;
    }

    try {
        const [logoURL, stampURL] = await Promise.all([
            podAssetDataURL("sri-energy-logo.png"),
            podAssetDataURL("sri-energy-stamp.png")
        ]);
        const html = podPrintableHTML(project, normalizePODDraft(draft), { logoURL, stampURL });
        printWindow.document.open();
        printWindow.document.write(html);
        printWindow.document.close();
        printWindow.focus();
    } catch (error) {
        printWindow.close();
        elements.workspaceProjectSubtitle.textContent = error.message || "POD asset loading failed.";
        console.error(error);
    }
}

async function podAssetDataURL(filename) {
    const assetBaseURL = new URL("./", window.location.href).href;
    const assetURL = new URL(filename, assetBaseURL).href;
    const response = await fetch(assetURL, { cache: "force-cache" });
    if (!response.ok) {
        throw new Error(`POD asset not found: ${filename}`);
    }
    return blobToDataURL(await response.blob());
}

function blobToDataURL(blob) {
    return new Promise((resolve, reject) => {
        const reader = new FileReader();
        reader.addEventListener("load", () => resolve(reader.result));
        reader.addEventListener("error", () => reject(reader.error || new Error("Image conversion failed.")));
        reader.readAsDataURL(blob);
    });
}

function podPrintableHTML(project, draft, assets) {
    const logoURL = assets.logoURL;
    const stampURL = assets.stampURL;
    const arfDisplay = podResolvedARFDisplayValue(draft.arf);
    const shipToDisplay = podResolvedCustomerDisplayValue(draft.shipTo);
    const pages = paginatePODPrintPages(draft.items);
    const pageCount = pages.length;
    const pageHTML = pages.map((page, index) => podPrintPageHTML({
        draft,
        logoURL,
        stampURL,
        arfDisplay,
        shipToDisplay,
        items: page.items,
        includeFooter: page.includeFooter,
        pageNumber: index + 1,
        pageCount
    })).join("");

    return `<!doctype html>
<html>
<head>
    <meta charset="utf-8">
    <title>${escapeHTML(draft.deliveryNoteNumber || "Delivery Note")}</title>
    <style>
        @page { size: A4 portrait; margin: 12px; }
        * { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
        body { margin: 0; padding-bottom: 8px; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; color: #000; font-size: 7.4pt; }
        h1, h2, p { margin: 0; }
        .page { display: block; box-sizing: border-box; }
        .page.page-break-before { break-before: page; page-break-before: always; }
        .page-content { display: block; }
        .print-page-label { padding-top: 6px; text-align: center; font-size: 7.4pt; color: #777; }
        .document-header { height: 44px; display: grid; grid-template-columns: 180px 1fr; align-items: center; gap: 12px; }
        .logo { width: 165px; height: 36px; object-fit: contain; object-position: left center; }
        .title { color: #c70816; text-align: right; font-size: 25pt; font-weight: 800; }
        table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        tr { break-inside: avoid; page-break-inside: avoid; }
        th, td { border: 1px solid #b7b7b7; padding: 3px 5px; vertical-align: top; }
        th { background-color: #b9b9b9 !important; color: #333; font-weight: 800; text-align: center; }
        .company-table th, .company-table td { height: 18px; }
        .company-table .label-row th { vertical-align: middle; }
        .company-cell { background-color: #b9b9b9 !important; font-size: 7.4pt; line-height: 1.15; text-align: left; }
        .company-name { display: block; font-weight: 800; font-size: 8.7pt; margin-bottom: 1px; }
        .company-email-label { display: inline-block; margin-left: 34px; }
        .company-email { display: inline-block; margin-left: 185px; }
        .email { color: #1267c4; }
        .center { text-align: center; }
        .bold { font-weight: 800; }
        .red { color: #c70816; font-weight: 800; }
        .address-table { margin-top: 12px; }
        .address-table th { text-align: left; padding-left: 8px; }
        .address-table td { height: 38px; white-space: pre-line; font-weight: 800; line-height: 1.15; padding: 5px 7px; }
        .summary-table { margin-top: 16px; }
        .summary-table th { vertical-align: middle; }
        .summary-table td { height: 19px; text-align: center; vertical-align: middle; padding: 4px 4px; }
        .items-table { margin-top: 16px; }
        .items-table th:nth-child(1), .items-table td:nth-child(1) { width: 38px; }
        .items-table th:nth-child(2), .items-table td:nth-child(2) { width: 92px; }
        .items-table th:nth-child(4), .items-table td:nth-child(4) { width: 42px; }
        .items-table th:nth-child(5), .items-table td:nth-child(5) { width: 55px; }
        .items-table th { height: 18px; vertical-align: middle; }
        .items-table td { min-height: 20px; line-height: 1.14; padding: 3px 5px; }
        .items-table .description { white-space: pre-line; }
        .footer-block { margin-top: 10px; break-inside: avoid; page-break-inside: avoid; }
        .footer-table { break-inside: avoid; page-break-inside: avoid; }
        .footer-table tr,
        .footer-table td { break-inside: avoid; page-break-inside: avoid; }
        .footer-table .discrepancy { height: 17px; text-align: right; vertical-align: middle; padding-right: 8px; }
        .footer-table .notes { min-height: 18px; white-space: pre-line; vertical-align: middle; }
        .signature-cell { position: relative; height: 58px; text-align: center; font-size: 8.8pt; font-weight: 800; padding-top: 6px; }
        .stamp { position: absolute; left: 20px; top: 17px; width: 40px; height: 40px; object-fit: contain; opacity: 0.9; }
        @media print {
            th,
            .company-cell {
                background-color: #b9b9b9 !important;
                -webkit-print-color-adjust: exact;
                print-color-adjust: exact;
            }
            .footer-block,
            .footer-table,
            .footer-table tr,
            .footer-table td {
                break-inside: avoid;
                page-break-inside: avoid;
            }
        }
    </style>
</head>
<body>
    ${pageHTML}
    <script>
        function waitForImages() {
            var images = Array.prototype.slice.call(document.images || []);
            return Promise.all(images.map(function (image) {
                if (image.complete && image.naturalWidth > 0) {
                    return Promise.resolve();
                }
                return new Promise(function (resolve) {
                    image.addEventListener("load", resolve, { once: true });
                    image.addEventListener("error", resolve, { once: true });
                });
            }));
        }
        window.addEventListener("load", function () {
            waitForImages().then(function () {
                window.print();
            });
        });
    </script>
</body>
</html>`;
}

function podPrintPageHTML({ draft, logoURL, stampURL, arfDisplay, shipToDisplay, items, includeFooter, pageNumber, pageCount }) {
    const itemRows = items.map(item => podPrintItemRowHTML(item)).join("");
    const shouldShowItemsTable = items.length || !includeFooter;

    return `
    <div class="page${pageNumber > 1 ? " page-break-before" : ""}">
        <div class="page-content">
        <div class="document-header">
            <img class="logo" src="${escapeHTML(logoURL)}" alt="SRI Energy">
            <div class="title">Delivery Note</div>
        </div>
        <table class="company-table">
            <colgroup>
                <col style="width: 50%">
                <col style="width: 13%">
                <col style="width: 22%">
                <col style="width: 15%">
            </colgroup>
	            <thead>
	                <tr class="label-row">
	                    <th rowspan="2" class="company-cell">
	                        <span class="company-name">SRI ENERGY COMPANY LIMITED</span>
	                        Building No. 2529, Al Dammam 893 Street<br>
	                        2ⁿᵈ Industrial City Dammam<br>
	                        Kingdom of Saudi Arabia
	                        <span class="company-email-label">Email</span><br>
	                        <span class="email company-email">kaziz@srienergy.com</span>
	                    </th>
                    <th>Date</th>
                    <th>Delivery Note #</th>
                    <th>Rev#</th>
                </tr>
                <tr>
                    <td class="center bold">${escapeHTML(formatDate(draft.deliveryDate))}</td>
                    <td class="center red">${escapeHTML(draft.deliveryNoteNumber)}</td>
                    <td class="center bold">${escapeHTML(podPDFDisplayValue(draft.revisionNumber))}</td>
                </tr>
            </thead>
        </table>
        <table class="address-table">
            <colgroup><col style="width:50%"><col style="width:50%"></colgroup>
            <thead><tr><th>ARF</th><th>Ship To</th></tr></thead>
            <tbody><tr><td>${escapeHTML(arfDisplay)}</td><td>${escapeHTML(shipToDisplay)}</td></tr></tbody>
        </table>
        <table class="summary-table">
            <colgroup>
                <col style="width: 17%">
                <col style="width: 19%">
                <col style="width: 20%">
                <col style="width: 22%">
                <col style="width: 22%">
            </colgroup>
            <thead><tr><th>Quote #</th><th>Customer PO #</th><th>Sales Order</th><th>Reference</th><th>ARF Reference</th></tr></thead>
            <tbody>
                <tr>
                    <td>${escapeHTML(podPDFDisplayValue(draft.quoteNumber))}</td>
                    <td>${escapeHTML(podPDFDisplayValue(draft.customerPONumber))}</td>
                    <td>${escapeHTML(podPDFDisplayValue(draft.salesOrder))}</td>
                    <td>${escapeHTML(podPDFDisplayValue(draft.reference))}</td>
                    <td>${escapeHTML(podPDFDisplayValue(draft.arfReference))}</td>
                </tr>
            </tbody>
        </table>
        ${shouldShowItemsTable ? `<table class="items-table">
            <thead><tr><th>Item</th><th>Part No</th><th>Description</th><th>Qty</th><th>UOM</th></tr></thead>
            <tbody>${itemRows || `<tr><td colspan="5">No items selected.</td></tr>`}</tbody>
        </table>` : ""}
        ${includeFooter ? `
        <div class="footer-block">
            <table class="footer-table">
                <colgroup><col style="width:50%"><col style="width:50%"></colgroup>
                <tbody>
                    <tr><td colspan="2" class="discrepancy">Please forward any discrepancies to kaziz@srienergy.com</td></tr>
                    <tr><td colspan="2" class="notes">Notes: ${escapeHTML(draft.notes || "")}</td></tr>
                    <tr><td class="signature-cell">Customer Authorized Signatory</td><td class="signature-cell"><img class="stamp" src="${escapeHTML(stampURL)}" alt="">Authorized Signatory</td></tr>
                </tbody>
            </table>
        </div>` : ""}
        </div>
        <div class="print-page-label">Page ${pageNumber} of ${pageCount}</div>
    </div>`;
}

function podPrintItemRowHTML(item) {
    return `
        <tr>
            <td class="center">${escapeHTML(podPDFItemLabel(item))}</td>
            <td>${escapeHTML(item.partNumber)}</td>
            <td class="description">${escapeHTML(podPDFItemDescription(item))}</td>
            <td class="center">${escapeHTML(podPDFDisplayValue(item.quantity))}</td>
            <td class="center">${escapeHTML(podPDFDisplayValue(item.uom).toUpperCase())}</td>
        </tr>`;
}

function paginatePODPrintPages(items) {
    const sourceItems = Array.isArray(items) && items.length ? items : [];
    if (!sourceItems.length) {
        return [{ items: [], includeFooter: true }];
    }

    const pageItemCapacity = 470;
    const finalPageItemCapacity = 328;
    const footerCapacity = 142;
    const pages = [];
    let currentItems = [];
    let currentHeight = 0;

    sourceItems.forEach(item => {
        const itemHeight = podPrintItemHeight(item);
        if (currentItems.length && currentHeight + itemHeight > pageItemCapacity) {
            pages.push({ items: currentItems, includeFooter: false, height: currentHeight });
            currentItems = [];
            currentHeight = 0;
        }
        currentItems.push(item);
        currentHeight += itemHeight;
    });

    if (!pages.length && currentHeight <= finalPageItemCapacity) {
        return [{ items: currentItems, includeFooter: true }];
    }

    if (currentHeight <= finalPageItemCapacity) {
        pages.push({ items: currentItems, includeFooter: true, height: currentHeight });
    } else {
        pages.push({ items: currentItems, includeFooter: false, height: currentHeight });
        pages.push({ items: [], includeFooter: true, height: footerCapacity });
    }

    return pages;
}

function podPrintItemHeight(item) {
    const partLines = estimatedPrintLines(item.partNumber, 18);
    const descriptionLines = estimatedPrintLines(podPDFItemDescription(item), 88);
    const lineCount = Math.max(1, partLines, descriptionLines);
    return Math.max(24, (lineCount * 8.2) + 8);
}

function estimatedPrintLines(value, charactersPerLine) {
    const lines = String(value || "")
        .split("\n")
        .map(line => Math.max(1, Math.ceil(line.length / charactersPerLine)));
    return lines.reduce((sum, lineCount) => sum + lineCount, 0);
}

function podPrintCell(label, value) {
    return `<div class="cell"><span class="label">${escapeHTML(label)}</span><span class="value">${escapeHTML(value)}</span></div>`;
}

function podPDFItemLabel(item) {
    const wbs = String(item.linkedWBS || "").trim();
    return wbs || String(item.itemNumber || "");
}

function podPDFItemDescription(item) {
    const base = String(item.itemDescription || "").trim();
    const serials = (item.selectedSerialNumbers || [])
        .map(serial => String(serial || "").trim())
        .filter(Boolean)
        .filter(serial => !base.toLowerCase().includes(serial.toLowerCase()));
    if (!serials.length) return base;
    const serialBlock = `SN: ${serials.join(", ")}`;
    return base ? `${base}\n${serialBlock}` : serialBlock;
}

function podPDFDisplayValue(value) {
    const trimmed = String(value || "").trim();
    return trimmed || "-";
}

function podResolvedARFDisplayValue(value) {
    const key = String(value || "").trim().toUpperCase();
    const references = {
        SASIB: "SASIB Molds, Dies & Spare parts Mfg. Co.\n2nd Industrial City, PO Box 2304, Dammam 34334 Kingdom of Saudi Arabia"
    };
    return references[key] || podPDFDisplayValue(value);
}

function podResolvedCustomerDisplayValue(value) {
    const key = String(value || "").trim().toUpperCase();
    const references = {
        SANAD: "Saudi Aramco Nabors Drilling Company\nOld Abqaiq Road, 31952 Dhahran Kingdom of Saudi Arabia"
    };
    return references[key] || podPDFDisplayValue(value);
}

async function markPODDraftItemsDelivered(project, draft) {
    const taskRows = buildTaskRows(project.id);
    const rowsByTaskId = new Map(taskRows.map(row => [row.task.id, row]));
    const deliveredTaskIds = new Set();

    draft.items.forEach(item => {
        if (!item.linkedTaskID) return;
        const rootRow = rowsByTaskId.get(item.linkedTaskID);
        if (!rootRow) return;
        taskIdsForPODDelivery(rootRow, taskRows, item.selectedSerialNumbers).forEach(taskId => deliveredTaskIds.add(taskId));
    });

    if (!deliveredTaskIds.size) {
        return;
    }

    const deliveredDate = new Date(draft.deliveryDate || Date.now()).toISOString();
    const rows = [];
    deliveredTaskIds.forEach(taskId => {
        rows.push(
            taskCustomFieldRow(taskId, "Task Delivery State", "Delivered"),
            taskCustomFieldRow(taskId, "Task Delivery Delivered Date", deliveredDate),
            taskCustomFieldRow(taskId, "Task Delivery Note Number", draft.deliveryNoteNumber)
        );
    });

    await supabaseUpsert("task_custom_fields", {
        on_conflict: "workspace_id,task_id,field_key"
    }, rows);

    deliveredTaskIds.forEach(taskId => {
        const task = state.tasks.find(item => item.id === taskId);
        if (!task) return;
        task.customFields ||= {};
        task.customFields["Task Delivery State"] = "Delivered";
        task.customFields["Task Delivery Delivered Date"] = deliveredDate;
        task.customFields["Task Delivery Note Number"] = draft.deliveryNoteNumber;
    });
    await touchWorkspaceSyncCursor();
    saveCachedWorkspace();
    renderTaskPage();
}

function taskCustomFieldRow(taskId, fieldKey, fieldValue) {
    return {
        workspace_id: state.config.workspaceId,
        task_id: taskId,
        field_key: fieldKey,
        field_value: fieldValue
    };
}

function taskIdsForPODDelivery(rootRow, taskRows, selectedSerials) {
    const normalizedSelectedSerials = new Set(
        (selectedSerials || []).map(normalizeSerial).filter(Boolean)
    );
    const result = new Set();
    [rootRow, ...taskDescendantRows(rootRow, taskRows)].forEach(row => {
        const taskSerials = taskSerialTokens(row.task).map(normalizeSerial).filter(Boolean);
        if (!normalizedSelectedSerials.size) {
            result.add(row.task.id);
        } else if (taskSerials.some(serial => normalizedSelectedSerials.has(serial))) {
            result.add(row.task.id);
        }
    });

    if (!result.size && !normalizedSelectedSerials.size) {
        result.add(rootRow.task.id);
    }
    return result;
}

function storedWBSForTask(task) {
    const fields = task.customFields || {};
    const candidates = [
        task.wbs,
        fields.WBS,
        fields.wbs,
        fields["WBS #"],
        fields["WBS Number"],
        fields["Outline"],
        fields["Outline Number"]
    ];
    return candidates
        .map(value => String(value || "").trim())
        .find(value => /^\d+(\.\d+)*$/.test(value));
}

function compareWBS(left, right) {
    const leftParts = left.split(".").map(Number);
    const rightParts = right.split(".").map(Number);
    const count = Math.max(leftParts.length, rightParts.length);
    for (let index = 0; index < count; index += 1) {
        const delta = (leftParts[index] || 0) - (rightParts[index] || 0);
        if (delta !== 0) return delta;
    }
    return 0;
}

function visibleTaskRows(taskRows) {
    const hiddenPrefixes = [];
    return taskRows.filter(row => {
        const isHidden = hiddenPrefixes.some(prefix => row.wbs.startsWith(`${prefix}.`));
        if (row.hasChildren && state.collapsedTaskIds.has(row.task.id)) {
            hiddenPrefixes.push(row.wbs);
        }
        return !isHidden;
    });
}

function applyInitialCollapse(taskRows) {
    if (state.didApplyInitialCollapse) {
        return;
    }

    state.collapsedTaskIds = new Set(
        taskRows
            .filter(row => row.hasChildren)
            .map(row => row.task.id)
    );
    state.didApplyInitialCollapse = true;
}

function attachProjectFields(projects, fields) {
    const byProject = groupCustomFields(fields, "project_id");
    return projects.map(project => ({
        ...project,
        customFields: byProject[project.id] || {}
    }));
}

function attachTaskFields(tasks, fields) {
    const byTask = groupCustomFields(fields, "task_id");
    return tasks.map(task => ({
        ...task,
        customFields: byTask[task.id] || {}
    }));
}

function groupCustomFields(rows, idKey) {
    return rows.reduce((output, row) => {
        output[row[idKey]] ||= {};
        output[row[idKey]][row.field_key] = row.field_value;
        return output;
    }, {});
}

function loadConfig() {
    try {
        return {
            ...DEFAULT_CONFIG,
            ...(JSON.parse(localStorage.getItem(CONFIG_KEY)) || {})
        };
    } catch {
        return { ...DEFAULT_CONFIG };
    }
}

function isConfigured() {
    return Boolean(state.config?.projectUrl && state.config?.apiKey && state.config?.workspaceId);
}

function loadCachedWorkspace() {
    try {
        const cached = JSON.parse(localStorage.getItem(CACHE_KEY));
        if (cached && cached.workspaceId === state.config.workspaceId) {
            state.projects = (cached.projects || []).filter(projectMatchesArfScope);
            state.tasks = (cached.tasks || []).filter(task => task.project_id === state.projectId);
            state.cursor = cached.cursor || null;
        }

        const taskCache = JSON.parse(localStorage.getItem(taskCacheKey()));
        if (taskCache && taskCache.version === TASK_CACHE_VERSION && taskCache.workspaceId === state.config.workspaceId && taskCache.projectId === state.projectId) {
            state.tasks = taskCache.tasks || state.tasks;
            state.equipment = taskCache.equipment || state.equipment;
            state.cursor = taskCache.cursor || state.cursor;
            state.hasFreshTaskCache = true;
        }
    } catch {
        localStorage.removeItem(taskCacheKey());
    }
}

function saveCachedWorkspace() {
    let existing = {};
    try {
        existing = JSON.parse(localStorage.getItem(CACHE_KEY)) || {};
    } catch {
        existing = {};
    }

    try {
        localStorage.setItem(CACHE_KEY, JSON.stringify({
            version: existing.version,
            workspaceId: state.config.workspaceId,
            cursor: state.cursor,
            projects: state.projects
        }));
    } catch (error) {
        console.warn("Workspace cache unavailable", error);
    }

    try {
        localStorage.setItem(taskCacheKey(), JSON.stringify({
            version: TASK_CACHE_VERSION,
            workspaceId: state.config.workspaceId,
            projectId: state.projectId,
            cursor: state.cursor,
            tasks: state.tasks,
            equipment: state.equipment
        }));
    } catch (error) {
        console.warn("Task cache unavailable", error);
        try {
            localStorage.removeItem(taskCacheKey());
        } catch {
            // Rendering uses in-memory data after fetch.
        }
    }
}

function taskCacheKey() {
    return `${TASK_CACHE_PREFIX}.${state.config.workspaceId || "default"}.${state.projectId || "none"}`;
}

function taskTitleCell(row, taskRows) {
    const td = document.createElement("td");
    td.className = "task-name-cell";
    td.classList.toggle("parent-task-cell", row.hasChildren);
    td.style.setProperty("--task-indent", `${Math.max(0, row.level) * 18}px`);
    td.innerHTML = `<div class="task-name-wrap"><button class="task-disclosure" type="button"></button><span class="delivery-icon"></span><div><span class="task-title"></span></div></div>`;
    const disclosure = td.querySelector(".task-disclosure");
    disclosure.textContent = row.hasChildren ? (state.collapsedTaskIds.has(row.task.id) ? "▸" : "▾") : "";
    disclosure.disabled = !row.hasChildren;
    disclosure.addEventListener("click", event => {
        event.stopPropagation();
        if (state.collapsedTaskIds.has(row.task.id)) {
            state.collapsedTaskIds.delete(row.task.id);
        } else {
            state.collapsedTaskIds.add(row.task.id);
        }
        const project = state.projects.find(item => item.id === state.projectId);
        renderTasks(project ? buildTaskRows(project.id) : []);
    });
    const deliveryIcon = td.querySelector(".delivery-icon");
    const deliveryState = taskDeliveryStateForRow(row, taskRows);
    const markerState = deliveryState === "none" && row.hasChildren ? "parent" : deliveryState;
    deliveryIcon.classList.add(markerState);
    deliveryIcon.hidden = markerState === "none";
    deliveryIcon.title = markerState === "delivered" ? "Delivered" : markerState === "ready" ? "Ready" : row.hasChildren ? "Parent task" : "";
    td.querySelector(".task-title").textContent = row.task.title || "Untitled Task";
    return td;
}

function textCell(value) {
    const td = document.createElement("td");
    td.textContent = value || "";
    return td;
}

function pillCell(value, className) {
    const td = document.createElement("td");
    const span = document.createElement("span");
    span.className = `pill ${className || "info"}`;
    span.textContent = value || "—";
    td.appendChild(span);
    return td;
}

function editableTaskSelectCell(task, field, baseOptions, className) {
    const td = document.createElement("td");
    td.className = "editable-select-cell";
    const select = document.createElement("select");
    select.className = `editable-status-select ${className || "status"}`;

    const currentValue = String(task[field] || "").trim();
    const options = uniqueValues([...baseOptions, currentValue].filter(Boolean));
    options.forEach(optionValue => {
        select.appendChild(new Option(optionValue, optionValue));
    });
    select.value = currentValue;

    select.addEventListener("click", event => event.stopPropagation());
    select.addEventListener("dblclick", event => event.stopPropagation());
    select.addEventListener("change", async event => {
        event.stopPropagation();
        const nextValue = event.target.value;
        const previousValue = task[field] || "";
        if (nextValue === previousValue) return;

        select.disabled = true;
        try {
            await updateTaskEditableField(task.id, field, nextValue);
        } catch (error) {
            select.value = previousValue;
            elements.workspaceProjectSubtitle.textContent = error.message || "Task update failed";
            console.error(error);
        } finally {
            select.disabled = false;
        }
    });

    td.appendChild(select);
    return td;
}

function categoryCell(value) {
    const className = value?.toLowerCase().includes("loose") ? "alert" : "info";
    return pillCell(value, className);
}

function taskProgressCell(row, taskRows) {
    const progress = progressForTaskRow(row, taskRows);
    const td = document.createElement("td");
    td.className = "progress-cell";
    td.style.setProperty("--progress", `${progress}%`);
    td.style.setProperty("--progress-min", progress > 0 ? "3px" : "0");
    td.innerHTML = "<span></span>";
    td.querySelector("span").textContent = `${progress}%`;
    return td;
}

function emptyRow(colspan, message) {
    const tr = document.createElement("tr");
    tr.className = "empty-row";
    const td = document.createElement("td");
    td.colSpan = colspan;
    td.textContent = message;
    tr.appendChild(td);
    return tr;
}

function heroStat(label, value) {
    const item = document.createElement("div");
    item.className = "hero-stat";
    item.innerHTML = `<span></span><strong></strong>`;
    item.querySelector("span").textContent = label;
    item.querySelector("strong").textContent = value || "—";
    return item;
}

function taskSummaryWidget(summary) {
    const widget = document.createElement("div");
    widget.className = "task-summary-widget";
    widget.append(
        progressWidget(summary.progress),
        taskStatusWidget(summary),
        scheduleWidget(summary.project, summary.progress),
        valvesWidget(summary)
    );
    return widget;
}

function progressWidget(progress) {
    const item = document.createElement("section");
    item.className = "summary-progress";
    item.innerHTML = `
        <span class="summary-label">Progress</span>
        <div class="summary-progress-row">
            <strong>${progress}%</strong>
            <span class="progress-ring" style="--progress:${progress}"></span>
        </div>
        <div class="timeline-control"><button type="button" disabled>-</button><span>100%</span><button type="button" disabled>+</button></div>
    `;
    return item;
}

function taskStatusWidget(summary) {
    const item = document.createElement("section");
    item.className = "summary-task-status";
    item.innerHTML = `<span class="summary-label">Task Status</span><div class="status-columns"></div>`;
    const columns = item.querySelector(".status-columns");
    [
        ["NS", summary.notStartedTasks, "neutral"],
        ["IP", summary.inProgressTasks, "status"],
        ["D", summary.doneTasks, "done"],
        ["R", summary.rejectedTasks, "alert"]
    ].forEach(([label, value, tone]) => columns.appendChild(statusColumn(label, value, tone)));
    return item;
}

function statusColumn(label, value, tone) {
    const column = document.createElement("div");
    column.className = `status-column ${tone}`;
    const height = Math.max(16, Math.min(40, 14 + Number(value || 0) / 4));
    column.innerHTML = `<strong>${value}</strong><span class="status-bar" style="height:${height}px"></span><span>${label}</span>`;
    return column;
}

function scheduleWidget(project, progress) {
    const item = document.createElement("section");
    item.className = "summary-schedule";
    const planned = schedulePlannedPercent(project);
    const timing = scheduleTimingText(project);
    item.innerHTML = `
        <span class="summary-label">Schedule</span>
        <div class="date-pair">
            <span><small>Start date</small>${formatDate(project.start_date) || "—"}</span>
            <span><small>End date</small>${formatDate(project.end_date) || "—"}</span>
        </div>
        ${scheduleBar("ACTUAL", progress, progress >= planned ? "done" : "status")}
        ${scheduleBar("PLANNED", planned, "done")}
        <p class="${timing.tone}">${timing.label} <span>${timing.detail}</span></p>
    `;
    return item;
}

function scheduleBar(label, value, tone) {
    const safeValue = Math.max(0, Math.min(100, Math.round(Number(value || 0))));
    return `<div class="schedule-bar-row"><span>${label}</span><div class="schedule-track"><i class="${tone}" style="width:${safeValue}%"></i></div><strong>${safeValue}%</strong></div>`;
}

function schedulePlannedPercent(project) {
    const start = parseDate(project.start_date);
    const end = parseDate(project.end_date);
    if (!start || !end || end <= start) {
        return 0;
    }
    const now = new Date();
    return Math.max(0, Math.min(100, Math.round(((now - start) / (end - start)) * 100)));
}

function scheduleTimingText(project) {
    const end = parseDate(project.end_date);
    if (!end) {
        return { label: "No Schedule", detail: "", tone: "neutral" };
    }
    const today = startOfDay(new Date());
    const finish = startOfDay(end);
    const days = Math.round((finish - today) / 86400000);
    if (days < 0) {
        return { label: "Delayed", detail: `ETA ${formatDate(project.end_date)}`, tone: "delayed" };
    }
    return { label: "On Track", detail: `ETA ${formatDate(project.end_date)}`, tone: "on-track" };
}

function valvesWidget(summary) {
    const valves = summary.valveSummary;
    const item = document.createElement("section");
    item.className = "summary-valves";
    item.innerHTML = `
        <span class="summary-label">Valves</span>
        <div class="valve-counts">
            ${valveCount("Total", valves.total, "total")}
            ${valveCount("In-Prog...", valves.inProgress, "status")}
            ${valveCount("Ready", valves.ready, "info")}
            ${valveCount("Rejected", valves.rejected, "alert")}
            ${valveCount("Delivered", valves.delivered, "done")}
        </div>
    `;
    return item;
}

function valveCount(label, value, tone) {
    return `<div class="${tone}"><strong>${value}</strong><span>${label}</span></div>`;
}

function compactSummaryWidget(label, value) {
    const item = document.createElement("section");
    item.className = "summary-compact";
    item.innerHTML = `<span class="summary-label"></span><strong></strong>`;
    item.querySelector(".summary-label").textContent = label;
    item.querySelector("strong").textContent = value;
    return item;
}

function valveSummaryForTasks(tasks) {
    const allSerials = new Set();
    const inProgressSerials = new Set();
    const readySerials = new Set();
    const deliveredSerials = new Set();
    const rejectedSerials = new Set();

    tasks.forEach(task => {
        if (!isValveTask(task)) {
            return;
        }

        taskSerialTokens(task).forEach(serial => {
            const normalized = normalizeSerial(serial);
            if (!normalized) return;

            allSerials.add(normalized);
            if (task.status === "Rejected") {
                rejectedSerials.add(normalized);
            } else if (taskWasDelivered(task)) {
                deliveredSerials.add(normalized);
            } else if (taskIsReady(task)) {
                readySerials.add(normalized);
            } else if (task.status === "In-Progress" || task.status === "In Progress") {
                inProgressSerials.add(normalized);
            }
        });
    });

    const ready = [...readySerials].filter(serial => !deliveredSerials.has(serial)).length;
    const inProgress = [...inProgressSerials].filter(serial => (
        !readySerials.has(serial)
        && !deliveredSerials.has(serial)
        && !rejectedSerials.has(serial)
    )).length;

    return {
        total: Math.max(0, allSerials.size - rejectedSerials.size),
        inProgress,
        ready,
        rejected: rejectedSerials.size,
        delivered: deliveredSerials.size
    };
}

function isValveTask(task) {
    const linked = task.linked_equipment_id
        ? state.equipment.find(item => item.id === task.linked_equipment_id)
        : null;
    const descriptor = [task.category, linked?.category, task.title, task.part_number]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
    return descriptor.includes("valve")
        || descriptor.includes("manual")
        || descriptor.includes("hcr")
        || descriptor.includes("choke");
}

function taskSerialTokens(task) {
    const linked = task.linked_equipment_id
        ? state.equipment.find(item => item.id === task.linked_equipment_id)
        : null;
    return parsedSerials(task.serial_number || linked?.serial_number || "");
}

function effectiveTaskPartNumber(task) {
    const linked = task.linked_equipment_id
        ? state.equipment.find(item => item.id === task.linked_equipment_id)
        : null;
    return String(task.part_number || linked?.part_number || "").trim();
}

function parsedSerials(value) {
    return String(value || "")
        .split(/[,;\n]+/)
        .map(item => item.trim())
        .filter(Boolean);
}

function normalizeSerial(value) {
    return String(value || "")
        .replace(/[\s\u00a0\u200b]+/g, "")
        .toLowerCase();
}

function escapeHTML(value) {
    return String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function taskStatusCount(label, value, className) {
    const item = document.createElement("div");
    item.className = `task-status-count ${className || ""}`;
    item.innerHTML = `<strong></strong><span></span>`;
    item.querySelector("strong").textContent = value;
    item.querySelector("span").textContent = label;
    return item;
}

function progressForProject(project) {
    const projectTasks = state.tasks.filter(task => task.project_id === project.id);
    if (!projectTasks.length) {
        return Number(project.completion_percent || 0);
    }

    const childrenByParent = new Map();
    projectTasks.forEach(task => {
        const key = task.parent_task_id || "";
        if (!childrenByParent.has(key)) {
            childrenByParent.set(key, []);
        }
        childrenByParent.get(key).push(task);
    });

    const leafTasks = projectTasks.filter(task => !(childrenByParent.get(task.id) || []).length && !isTaskInactive(task));
    if (!leafTasks.length) {
        return Number(project.completion_percent || 0);
    }

    const total = leafTasks.reduce((sum, task) => sum + taskProgressForStatusAndFields(task), 0);
    return Math.round(total / leafTasks.length);
}

function progressForTaskRow(row, taskRows) {
    const descendants = taskRows.filter(candidate => candidate.wbs.startsWith(`${row.wbs}.`));
    const progressRows = descendants.length
        ? descendants.filter(candidate => !candidate.hasChildren && !isTaskInactive(candidate.task))
        : [row];

    if (!progressRows.length) {
        return row.task.status === "Done" ? 100 : 0;
    }

    const total = progressRows.reduce((sum, candidate) => sum + taskProgressForStatusAndFields(candidate.task), 0);
    return Math.round(total / progressRows.length);
}

function storedProgressForTask(task) {
    const fields = task.customFields || {};
    const candidates = [
        task.completion_percent,
        fields["Task Progress Percent"],
        fields.Progress,
        fields.progress,
        fields["% Done"],
        fields["Percent Done"],
        fields["Completion Percent"]
    ];
    for (const value of candidates) {
        if (value === undefined || value === null || value === "") {
            continue;
        }
        const numeric = Number(String(value).replace("%", ""));
        if (Number.isFinite(numeric) && numeric >= 0) {
            return Math.max(0, Math.min(100, Math.round(numeric)));
        }
    }
    return null;
}

function taskDeliveryState(task) {
    if (!taskHasSerial(task)) {
        return "none";
    }
    if (taskWasDelivered(task)) {
        return "delivered";
    }
    if (taskIsReady(task)) {
        return "ready";
    }
    return "none";
}

function taskDeliveryStateForRow(row, taskRows) {
    if (taskWasDeliveredForRow(row, taskRows)) {
        return "delivered";
    }
    if (taskDeliveryIconStateForRow(row, taskRows) !== "none" || taskDeliverableType(row.task) === 1) {
        return "ready";
    }
    return "none";
}

function taskDeliveryIconStateForRow(row, taskRows) {
    const descendants = taskDescendantRows(row, taskRows);
    if (!descendants.length) {
        return taskIsReadyForDeliveryIcon(row.task) ? "complete" : "none";
    }

    const counts = taskSerialDeliveryCountsForRows(descendants);
    if (counts.total > 0) {
        if (counts.ready === counts.total) return "complete";
        return counts.ready > 0 ? "partial" : "none";
    }

    return taskIsReadyForDeliveryIcon(row.task) ? "complete" : "none";
}

function taskWasDeliveredForRow(row, taskRows) {
    if (taskWasExplicitlyUndelivered(row.task)) {
        return false;
    }
    return taskWasDelivered(row.task) || taskAllDeliverableChildrenDelivered(row, taskRows);
}

function taskAllDeliverableChildrenDelivered(row, taskRows) {
    const counts = taskDeliveredSerialCountsForRows(taskDescendantRows(row, taskRows));
    return counts.total > 0 && counts.delivered === counts.total;
}

function taskSerialDeliveryCountsForRows(rows) {
    return rows.reduce((counts, row) => {
        if (taskHasSerial(row.task)) {
            counts.total += 1;
            if (taskIsReadyForDeliveryIcon(row.task)) {
                counts.ready += 1;
            }
        }
        return counts;
    }, { ready: 0, total: 0 });
}

function taskDeliveredSerialCountsForRows(rows) {
    let delivered = 0;
    let total = 0;

    rows.forEach(row => {
        if (!taskHasSerial(row.task)) {
            return;
        }
        total += 1;
        if (taskWasDeliveredWithRowInheritance(row, rows)) {
            delivered += 1;
        }
    });

    return { delivered, total };
}

function taskWasDeliveredWithRowInheritance(row, peerRows) {
    if (taskWasExplicitlyUndelivered(row.task)) {
        return false;
    }
    if (taskWasDelivered(row.task)) {
        return true;
    }
    return peerRows.some(candidate => (
        candidate !== row
        && row.wbs.startsWith(`${candidate.wbs}.`)
        && taskWasDelivered(candidate.task)
    ));
}

function taskDescendantRows(row, taskRows) {
    return taskRows.filter(candidate => candidate.wbs.startsWith(`${row.wbs}.`));
}

function taskWasDelivered(task) {
    return task.customFields?.["Task Delivery State"] === "Delivered";
}

function taskWasExplicitlyUndelivered(task) {
    return task.customFields?.["Task Delivery State"] === "Undelivered";
}

function taskIsReady(task) {
    return task.status === "Done" || taskProgressForStatusAndFields(task) >= 100;
}

function taskIsReadyForDeliveryIcon(task) {
    return taskHasSerial(task) && taskIsReady(task);
}

function taskDeliverableType(task) {
    return Number(task.customFields?.["Task Deliverable Type"] || 0);
}

function taskHasSerial(task) {
    return taskSerialTokens(task).length > 0;
}

function taskProgressForStatusAndFields(task) {
    if (task.status === "Done") return 100;

    const stored = storedProgressForTask(task);
    if (stored !== null) return stored;
    if (task.status === "In-Progress" || task.status === "In Progress") return 50;
    return 0;
}

function statusClass(value) {
    if (value === "Done") return "done";
    if (value === "Rejected" || value === "Cancelled") return "alert";
    if (value === "On-Hold") return "alert";
    if (value === "Planning - Waiting for PO") return "purple";
    if (value === "Planning") return "info";
    return "status";
}

function formatDate(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("en-GB").format(date);
}

function parseDate(value) {
    if (!value) return null;
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? null : date;
}

function startOfDay(date) {
    return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function compactJoin(values, separator) {
    return values.filter(Boolean).join(separator);
}

function currentArfScope() {
    return String(window.PMProjectsAuth.arfScope?.() || state.config?.arfScope || "").trim().toUpperCase();
}

function projectMatchesArfScope(project) {
    const scope = currentArfScope();
    return !scope || (
        String(project.arf || "").trim().toUpperCase() === scope
        && project.status === "In-Progress"
    );
}

function uniqueValues(values) {
    return values.filter((value, index, all) => value && all.indexOf(value) === index);
}

function initialiseResizableTaskColumns() {
    const table = elements.workspaceTasksTable;
    if (!table) return;

    const headers = [...table.querySelectorAll("thead th")];
    const savedWidths = loadTaskColumnWidths();
    headers.forEach((header, index) => {
        const width = savedWidths[index];
        if (width) {
            setTaskColumnWidth(index, width);
        }

        const handle = document.createElement("span");
        handle.className = "column-resize-handle";
        handle.addEventListener("mousedown", event => beginColumnResize(event, index, header));
        header.appendChild(handle);
    });
}

function beginColumnResize(event, index, header) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = header.getBoundingClientRect().width;

    const onMove = moveEvent => {
        const nextWidth = Math.max(60, Math.round(startWidth + moveEvent.clientX - startX));
        setTaskColumnWidth(index, nextWidth);
    };

    const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        saveTaskColumnWidths();
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
}

function setTaskColumnWidth(index, width) {
    const table = elements.workspaceTasksTable;
    const cells = table.querySelectorAll(`th:nth-child(${index + 1}), td:nth-child(${index + 1})`);
    cells.forEach(cell => {
        cell.style.width = `${width}px`;
        cell.style.maxWidth = `${width}px`;
    });
}

function saveTaskColumnWidths() {
    const headers = [...elements.workspaceTasksTable.querySelectorAll("thead th")];
    const widths = headers.map(header => Math.round(header.getBoundingClientRect().width));
    try {
        localStorage.setItem(TASK_COLUMN_WIDTHS_KEY, JSON.stringify(widths));
    } catch {
        // Column resizing still works for the current session.
    }
}

function loadTaskColumnWidths() {
    try {
        return JSON.parse(localStorage.getItem(TASK_COLUMN_WIDTHS_KEY)) || [];
    } catch {
        return [];
    }
}
