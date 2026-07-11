const CONFIG_KEY = "pmprojects.web.supabase.config";
const CACHE_KEY = "pmprojects.web.workspace.cache";
const TASK_CACHE_PREFIX = "pmprojects.web.task.cache";
const TASK_COLUMN_WIDTHS_KEY = "pmprojects.web.task.columnWidths";
const TASK_CACHE_VERSION = 4;
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
    expandAllTasksButton: document.getElementById("expandAllTasksButton"),
    collapseAllTasksButton: document.getElementById("collapseAllTasksButton"),
    workspaceProjectTitle: document.getElementById("workspaceProjectTitle"),
    workspaceProjectSubtitle: document.getElementById("workspaceProjectSubtitle"),
    workspaceTaskStatus: document.getElementById("workspaceTaskStatus"),
    workspaceHero: document.getElementById("workspaceHero"),
    workspaceTaskCount: document.getElementById("workspaceTaskCount"),
    workspaceTasksBody: document.getElementById("workspaceTasksBody"),
    workspaceTasksTable: document.getElementById("workspaceTasksTable")
};

initialiseTaskPage();

function initialiseTaskPage() {
    elements.backToProjectsButton.addEventListener("click", () => {
        window.location.href = "index.html";
    });
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

        const [projects, projectFields, tasks] = await Promise.all([
            fetchProjects(),
            fetchProjectCustomFields(),
            fetchTasks()
        ]);
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
    return supabaseGetAll("projects_normalized", {
        workspace_id: `eq.${state.config.workspaceId}`,
        select: "id,parent_project_id,linked_equipment_id,name,start_date,end_date,actual_start_date,actual_end_date,po_number,so_number,rig_number,arf_ref,status,customer,category,serial_number,completion_percent,priority,arf,estimated_completion_date,mrb_status,remarks,sort_order",
        order: "sort_order.asc"
    });
}

async function fetchProjectCustomFields() {
    return supabaseGetAll("project_custom_fields", {
        workspace_id: `eq.${state.config.workspaceId}`,
        select: "project_id,field_key,field_value"
    });
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
        select: "id,serial_number,category,size,rwp"
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
            Authorization: `Bearer ${state.config.apiKey}`,
            Accept: "application/json"
        }
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`${table} failed (${response.status}) ${body}`.trim());
    }

    return response.json();
}

function renderTaskPage() {
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
            taskTitleCell(row),
            pillCell(row.task.status, statusClass(row.task.status)),
            textCell(row.task.mrb_status),
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
            state.projects = cached.projects || [];
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

function taskTitleCell(row) {
    const td = document.createElement("td");
    td.className = "task-name-cell";
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
    const deliveryState = taskDeliveryState(row.task);
    deliveryIcon.classList.add(deliveryState);
    deliveryIcon.hidden = deliveryState === "none";
    deliveryIcon.textContent = "◆";
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

function parsedSerials(value) {
    return String(value || "")
        .split(/[,;\n]+/)
        .map(item => item.trim())
        .filter(Boolean);
}

function normalizeSerial(value) {
    return String(value || "").trim().toLowerCase();
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
    const storedProgress = Number(project.completion_percent || 0);
    if (storedProgress > 0 || project.status === "Done") {
        return project.status === "Done" ? Math.max(storedProgress, 100) : storedProgress;
    }

    const projectTasks = state.tasks.filter(task => task.project_id === project.id);
    if (!projectTasks.length) {
        return storedProgress;
    }

    const completedTasks = projectTasks.filter(task => task.status === "Done").length;
    return Math.round((completedTasks / projectTasks.length) * 100);
}

function progressForTaskRow(row, taskRows) {
    const stored = storedProgressForTask(row.task);
    if (stored !== null) {
        return stored;
    }

    const descendants = taskRows.filter(candidate => candidate.wbs.startsWith(`${row.wbs}.`));
    const progressRows = descendants.length ? descendants.filter(candidate => !candidate.hasChildren) : [row];
    if (!progressRows.length) {
        return row.task.status === "Done" ? 100 : 0;
    }

    const completed = progressRows.filter(candidate => candidate.task.status === "Done").length;
    return Math.round((completed / progressRows.length) * 100);
}

function storedProgressForTask(task) {
    const fields = task.customFields || {};
    const candidates = [
        task.completion_percent,
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

function taskWasDelivered(task) {
    return task.customFields?.["Task Delivery State"] === "Delivered";
}

function taskIsReady(task) {
    return task.status === "Done" || taskProgressForStatusAndFields(task) >= 100;
}

function taskHasSerial(task) {
    return Boolean(String(task.serial_number || "").trim());
}

function taskProgressForStatusAndFields(task) {
    const stored = storedProgressForTask(task);
    if (stored !== null) return stored;
    if (task.status === "Done") return 100;
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
