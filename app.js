const CONFIG_KEY = "pmprojects.web.supabase.config";
const CACHE_KEY = "pmprojects.web.workspace.cache";
const WORKSPACE_CACHE_VERSION = 10;
const DEFAULT_CONFIG = {
    projectUrl: "https://sxwnyztslfyozxxlqxjd.supabase.co",
    apiKey: "sb_publishable_Vdbds2yta-ZMBEQ2ap6wsw_lebc8C52",
    workspaceId: "pmprojects-main"
};
const PROJECT_STATUS_ORDER = [
    "Planning - Waiting for PO",
    "Planning",
    "In-Progress",
    "Done",
    "On-Hold",
    "Cancelled"
];
const HIDDEN_PROJECT_STATUSES = new Set(["Done", "On-Hold"]);

const state = {
    config: loadConfig(),
    projects: [],
    tasks: [],
    equipment: [],
    cursor: null,
    selectedProjectId: null,
    hasFreshWorkspaceCache: false,
    filters: {
        search: "",
        status: "",
        customer: "",
        mrb: ""
    }
};

const elements = {
    refreshButton: document.getElementById("refreshButton"),
    logoutButton: document.getElementById("logoutButton"),
    workspaceSummary: document.getElementById("workspaceSummary"),
    syncStatus: document.getElementById("syncStatus"),
    searchInput: document.getElementById("searchInput"),
    statusFilter: document.getElementById("statusFilter"),
    customerFilter: document.getElementById("customerFilter"),
    mrbFilter: document.getElementById("mrbFilter"),
    workspaceSelector: document.getElementById("workspaceSelector"),
    workspaceGrid: document.getElementById("workspaceGrid"),
    projectCount: document.getElementById("projectCount"),
    projectsBody: document.getElementById("projectsBody"),
    metricProjects: document.getElementById("metricProjects"),
    metricActive: document.getElementById("metricActive"),
    metricDone: document.getElementById("metricDone"),
    metricTasks: document.getElementById("metricTasks")
};

window.PMProjectsAuth.requireAuth(initialise);

function initialise() {
    bindEvents();
    renderWorkspaceSelector();
    loadCachedWorkspace();
    render();

    if (isConfigured()) {
        refreshWorkspace({ force: false });
    }
}

function bindEvents() {
    elements.refreshButton.addEventListener("click", () => refreshWorkspace({ force: true }));
    elements.logoutButton.addEventListener("click", () => window.PMProjectsAuth.logout());
    elements.searchInput.addEventListener("input", event => {
        state.filters.search = event.target.value.trim().toLowerCase();
        renderProjects();
    });
    elements.statusFilter.addEventListener("change", event => {
        state.filters.status = event.target.value;
        renderProjects();
    });
    elements.customerFilter.addEventListener("change", event => {
        state.filters.customer = event.target.value;
        renderProjects();
    });
    elements.mrbFilter.addEventListener("change", event => {
        state.filters.mrb = event.target.value;
        renderProjects();
    });
    elements.workspaceSelector.addEventListener("change", event => {
        const selected = window.PMProjectsAuth.selectWorkspace(event.target.value);
        state.config = loadConfig();
        state.projects = [];
        state.tasks = [];
        state.equipment = [];
        state.cursor = null;
        state.selectedProjectId = null;
        state.hasFreshWorkspaceCache = false;
        render();
        refreshWorkspace({ force: true });
        setStatus(`Workspace changed to ${workspaceDisplayName(selected)}`);
    });
}

function renderWorkspaceSelector() {
    const workspaces = window.PMProjectsAuth.workspaces();
    elements.workspaceSelector.innerHTML = "";
    workspaces.forEach(workspace => {
        const option = document.createElement("option");
        option.value = workspace.workspace_id;
        option.textContent = workspaceDisplayName(workspace);
        elements.workspaceSelector.appendChild(option);
    });
    elements.workspaceSelector.value = state.config.workspaceId || window.PMProjectsAuth.selectedWorkspaceId();
    elements.workspaceSelector.hidden = workspaces.length <= 1;
}

async function refreshWorkspace({ force }) {
    if (!isConfigured()) {
        setStatus("Supabase access key is not embedded.");
        return;
    }

    try {
        setStatus(force ? "Refreshing..." : "Checking for changes...");
        const cursor = await fetchSyncCursor();
        const hasRemoteChange = !state.cursor?.last_snapshot_updated_at
            || cursor?.last_snapshot_updated_at !== state.cursor.last_snapshot_updated_at;

        if (!force && cursor && !hasRemoteChange && state.projects.length > 0 && state.tasks.length > 0 && state.hasFreshWorkspaceCache) {
            setStatus(`Up to date · ${formatDateTime(cursor.last_snapshot_updated_at)}`);
            return;
        }

        const [projects, projectFields, tasks, equipment] = await Promise.all([
            fetchProjects(),
            fetchProjectCustomFields(),
            fetchTasks(),
            fetchEquipment().catch(error => {
                console.warn("Equipment detail unavailable", error);
                return [];
            })
        ]);
        const taskFields = await fetchTaskProgressFieldsForTasks(tasks).catch(error => {
            console.warn("Task progress fields unavailable", error);
            return [];
        });

        state.cursor = cursor;
        state.projects = attachProjectFields(projects, projectFields);
        state.tasks = attachTaskFields(tasks, taskFields);
        state.equipment = equipment;
        state.hasFreshWorkspaceCache = true;

        if (!state.selectedProjectId || !state.projects.some(project => project.id === state.selectedProjectId)) {
            state.selectedProjectId = state.projects[0]?.id || null;
        }

        render();
        saveCachedWorkspace();
        setStatus(cursor ? `Loaded · ${formatDateTime(cursor.last_snapshot_updated_at)}` : "Loaded");
    } catch (error) {
        setStatus(error.message || "Refresh failed");
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
        select: "id,project_id,parent_task_id,linked_equipment_id,title,status,serial_number,part_number,category",
        order: "project_id.asc,depth.asc,sort_order.asc"
    });
}

async function fetchEquipment() {
    return supabaseGetAll("equipment_items_normalized", {
        workspace_id: `eq.${state.config.workspaceId}`,
        select: "id,serial_number,category,size,rwp",
        order: "sort_order.asc"
    });
}

async function fetchTaskProgressFieldsForTasks(tasks) {
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
    return pages
        .flat()
        .filter(row => row.field_key === "Task Progress Percent" || row.field_key === "Task Active" || row.field_key === "Task Delivery State");
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

function render() {
    renderFilters();
    renderMetrics();
    renderProjects();
    const visibleCount = visibleBaseProjects().length;
    elements.workspaceSummary.textContent = visibleCount
        ? `${visibleCount} projects loaded from workspace ${state.config?.workspaceId || "primary"}.`
        : "Connect to Supabase to load projects and tasks.";
}

function renderFilters() {
    const visibleProjects = visibleBaseProjects();
    fillSelect(elements.statusFilter, "All Status", uniqueValues(visibleProjects.map(project => project.status)), state.filters.status);
    fillSelect(elements.customerFilter, "All Customers", uniqueValues(visibleProjects.map(project => project.customer)), state.filters.customer);
    fillSelect(elements.mrbFilter, "All MRB", uniqueValues(visibleProjects.map(project => project.mrb_status)), state.filters.mrb);
}

function renderMetrics() {
    const visibleProjects = visibleBaseProjects();
    const active = visibleProjects.filter(project => !["Done", "Cancelled"].includes(project.status)).length;
    const avgDone = visibleProjects.length
        ? Math.round(visibleProjects.reduce((sum, project) => sum + progressForProject(project), 0) / visibleProjects.length)
        : 0;

    elements.metricProjects.textContent = String(visibleProjects.length);
    elements.metricActive.textContent = String(active);
    elements.metricDone.textContent = `${avgDone}%`;
    elements.metricTasks.textContent = String(state.tasks.length);
}

function renderProjects() {
    const rows = filteredProjects();
    elements.projectCount.textContent = `${rows.length} rows`;
    elements.projectsBody.innerHTML = "";

    if (!rows.length) {
        elements.projectsBody.appendChild(emptyRow(14, state.projects.length ? "No projects match the current filters." : "No projects loaded."));
        return;
    }

    const fragment = document.createDocumentFragment();
    groupedProjects(rows).forEach(group => {
        fragment.appendChild(groupHeaderRow(group.status, group.projects.length));
        group.projects.forEach(project => {
        const tr = document.createElement("tr");
        tr.className = project.id === state.selectedProjectId ? "selected" : "";
        tr.addEventListener("click", () => {
            state.selectedProjectId = project.id;
            renderProjects();
        });
        tr.addEventListener("dblclick", () => openProjectWorkspace(project.id));

        tr.append(
            projectNameCell(project),
            textCell(project.po_number),
            textCell(project.so_number),
            textCell(project.rig_number),
            textCell(project.arf_ref),
            pillCell(project.status, statusClass(project.status)),
            textCell(project.customer),
            categoryCell(project),
            progressCell(progressForProject(project)),
            textCell(project.serial_number),
            textCell(project.priority),
            pillCell(project.arf, "purple"),
            textCell(formatDate(project.estimated_completion_date)),
            pillCell(project.mrb_status, "status")
        );
        fragment.appendChild(tr);
        });
    });

    elements.projectsBody.appendChild(fragment);
}

function openProjectWorkspace(projectId) {
    state.selectedProjectId = projectId;
    window.location.href = `task.html?id=${encodeURIComponent(projectId)}`;
}


function filteredProjects() {
    return visibleBaseProjects().filter(project => {
        if (state.filters.status && project.status !== state.filters.status) return false;
        if (state.filters.customer && project.customer !== state.filters.customer) return false;
        if (state.filters.mrb && project.mrb_status !== state.filters.mrb) return false;

        if (!state.filters.search) return true;
        const haystack = [
            project.name,
            project.po_number,
            project.so_number,
            project.rig_number,
            project.arf_ref,
            project.customer,
            project.category,
            project.serial_number,
            project.arf,
            project.mrb_status
        ].join(" ").toLowerCase();
        return haystack.includes(state.filters.search);
    });
}

function visibleBaseProjects() {
    return state.projects.filter(project => !HIDDEN_PROJECT_STATUSES.has(project.status));
}

function groupedProjects(projects) {
    const byStatus = new Map();
    projects.forEach(project => {
        const status = project.status || "No Status";
        if (!byStatus.has(status)) {
            byStatus.set(status, []);
        }
        byStatus.get(status).push(project);
    });

    const knownGroups = PROJECT_STATUS_ORDER
        .filter(status => byStatus.has(status))
        .map(status => ({ status, projects: byStatus.get(status) }));

    const customGroups = [...byStatus.entries()]
        .filter(([status]) => !PROJECT_STATUS_ORDER.includes(status))
        .sort(([left], [right]) => left.localeCompare(right))
        .map(([status, rows]) => ({ status, projects: rows }));

    return [...knownGroups, ...customGroups];
}

function groupHeaderRow(status, count) {
    const tr = document.createElement("tr");
    tr.className = `group-row ${statusClass(status)}`;
    const td = document.createElement("td");
    td.colSpan = 14;
    td.innerHTML = `<span class="group-pill"></span><strong></strong>`;
    td.querySelector(".group-pill").textContent = status;
    td.querySelector("strong").textContent = `${count} ${count === 1 ? "project" : "projects"}`;
    tr.appendChild(td);
    return tr;
}

function projectNameCell(project) {
    const td = document.createElement("td");
    td.className = "project-name-cell";
    const subline = compactJoin([project.po_number && `PO ${project.po_number}`, project.customer], " · ");
    td.innerHTML = `
        <div class="project-name-row">
            <div class="project-title-block">
                <span class="project-name"></span>
                <span class="subtext"></span>
            </div>
            <button class="project-add-button" type="button" aria-label="Add child project">+</button>
            <button class="open-button" type="button">OPEN</button>
        </div>
    `;
    td.querySelector(".project-name").textContent = project.name || "Untitled Project";
    td.querySelector(".subtext").textContent = subline;
    td.querySelector(".project-add-button").addEventListener("click", event => {
        event.stopPropagation();
    });
    td.querySelector(".open-button").addEventListener("click", event => {
        event.stopPropagation();
        openProjectWorkspace(project.id);
    });
    return td;
}

function taskTitleCell(row) {
    const td = document.createElement("td");
    td.style.paddingLeft = `${10 + Math.max(0, row.wbs.split(".").length - 1) * 18}px`;
    td.innerHTML = `<span class="task-title"></span><span class="subtext"></span>`;
    td.querySelector(".task-title").textContent = row.task.title || "Untitled Task";
    td.querySelector(".subtext").textContent = row.task.comment || row.task.rwp || "";
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

function categoryCell(project) {
    const entries = projectCategoryDisplayEntries(project);
    const td = document.createElement("td");
    td.className = "category-display-cell";
    entries.forEach(entry => {
        const block = document.createElement("div");
        block.className = "category-display";
        block.innerHTML = `
            <span class="category-dot"></span>
            <div class="category-lines">
                <span class="category-title"></span>
                <span class="category-detail"></span>
            </div>
        `;
        block.querySelector(".category-dot").style.background = categoryColor(entry.category);
        block.querySelector(".category-title").style.color = categoryColor(entry.category);
        block.querySelector(".category-title").textContent = entry.category || "—";
        const detailElement = block.querySelector(".category-detail");
        detailElement.textContent = entry.detail || "";
        detailElement.hidden = !entry.detail;
        td.appendChild(block);
    });
    return td;
}

function projectCategoryDisplayEntries(project) {
    const linkedItems = linkedEquipmentForProject(project);
    const summary = project.customFields?.["Category Summary"]
        || project.customFields?.["Project Category Summary"]
        || project.customFields?.["Valve Summary"]
        || "";

    const entries = linkedItems
        .map(item => ({
            category: (item.category || "").trim(),
            detail: compactJoin([item.size, item.rwp], " · ")
        }))
        .filter(entry => entry.category)
        .reduce((result, entry) => {
            const key = `${entry.category}|${entry.detail}`;
            if (!result.keys.has(key)) {
                result.keys.add(key);
                result.entries.push(entry);
            }
            return result;
        }, { keys: new Set(), entries: [] }).entries;

    if (!entries.length) {
        const fallbackCategory = (project.category || "").trim() || "—";
        entries.push({
            category: fallbackCategory,
            detail: summary || (fallbackCategory.toLowerCase().includes("loose") ? looseValveSummaryLine(project) : "")
        });
    } else if (entries.some(entry => entry.category.toLowerCase().includes("loose"))) {
        const looseEntry = entries.find(entry => entry.category.toLowerCase().includes("loose"));
        looseEntry.detail = summary || looseValveSummaryLine(project);
    }

    return entries;
}

function looseValveSummaryLine(project) {
    const tasks = state.tasks.filter(task => task.project_id === project.id);
    const readySerials = new Set();
    const deliveredSerials = new Set();
    const rejectedSerials = new Set();
    const allSerials = new Set();

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
            }
        });
    });

    if (!allSerials.size) {
        return "";
    }

    const acceptedTotal = Math.max(0, allSerials.size - rejectedSerials.size);
    const pendingReady = [...readySerials].filter(serial => !deliveredSerials.has(serial)).length;
    const rejectedText = rejectedSerials.size ? ` . ${rejectedSerials.size} rejected` : "";
    return `${acceptedTotal} total . ${pendingReady} ready . ${deliveredSerials.size} delivered${rejectedText}`;
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

function taskWasDelivered(task) {
    return task.customFields?.["Task Delivery State"] === "Delivered";
}

function taskIsReady(task) {
    return task.status === "Done" || taskProgress(task) >= 100;
}

function linkedEquipmentForProject(project) {
    const linked = [];
    if (project.linked_equipment_id) {
        const direct = state.equipment.find(item => item.id === project.linked_equipment_id);
        if (direct) linked.push(direct);
    }

    parsedSerials(project.serial_number).forEach(serial => {
        const normalized = normalizeSerial(serial);
        const match = state.equipment.find(item => normalizeSerial(item.serial_number) === normalized);
        if (match && !linked.some(item => item.id === match.id)) {
            linked.push(match);
        }
    });

    return linked;
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

function categoryColor(value) {
    const normalized = String(value || "").toLowerCase();
    if (normalized.includes("loose")) return "var(--red)";
    if (normalized.includes("civil")) return "#ff7a00";
    if (normalized.includes("choke")) return "#00b7c7";
    return "var(--blue)";
}

function progressCell(value) {
    const numeric = Math.max(0, Math.min(100, Math.round(Number(value || 0))));
    const td = document.createElement("td");
    td.className = "progress-cell";
    td.style.setProperty("--progress", `${numeric}%`);
    td.style.setProperty("--progress-min", numeric > 0 ? "18px" : "0");
    td.innerHTML = `<span>${numeric}%</span>`;
    return td;
}

function progressForProject(project) {
    const childProjects = state.projects.filter(candidate => candidate.parent_project_id === project.id);
    if (childProjects.length) {
        const progressValues = [];
        if (state.tasks.some(task => task.project_id === project.id)) {
            progressValues.push(computeProjectTaskProgress(project.id));
        }
        childProjects.forEach(childProject => {
            progressValues.push(progressForProject(childProject));
        });
        if (!progressValues.length) {
            return Number(project.completion_percent || 0);
        }
        return Math.round(progressValues.reduce((sum, value) => sum + value, 0) / progressValues.length);
    }

    return Math.round(computeProjectTaskProgress(project.id, project));
}

function computeProjectTaskProgress(projectId, project = null) {
    const projectTasks = state.tasks.filter(task => task.project_id === projectId);
    if (!projectTasks.length) {
        return Number(project?.completion_percent || 0);
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
        return Number(project?.completion_percent || 0);
    }

    const total = leafTasks.reduce((sum, task) => sum + taskProgress(task), 0);
    return total / leafTasks.length;
}

function taskProgress(task) {
    const fields = task.customFields || {};
    const explicit = Number(fields["Task Progress Percent"]);
    if (Number.isFinite(explicit)) {
        return Math.max(0, Math.min(100, explicit));
    }
    if (task.status === "Done") return 100;
    if (task.status === "In-Progress" || task.status === "In Progress") return 50;
    if (task.status === "Not Started") return 0;
    return 0;
}

function isTaskInactive(task) {
    return task.customFields?.["Task Active"] === "false";
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

function statusClass(value) {
    if (value === "Done") return "done";
    if (value === "Rejected" || value === "Cancelled") return "alert";
    if (value === "On-Hold") return "alert";
    if (value === "Planning - Waiting for PO") return "purple";
    if (value === "Planning") return "info";
    return "status";
}

function fillSelect(select, emptyLabel, values, selectedValue) {
    const currentValue = selectedValue || "";
    select.innerHTML = "";
    select.appendChild(new Option(emptyLabel, ""));
    values.forEach(value => select.appendChild(new Option(value, value)));
    select.value = values.includes(currentValue) ? currentValue : "";
}

function uniqueValues(values) {
    return [...new Set(values.filter(Boolean))].sort((a, b) => a.localeCompare(b));
}

function workspaceDisplayName(workspace) {
    return workspace?.workspaces?.name || workspace?.workspace_id || "Workspace";
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
        if (!cached || cached.version !== WORKSPACE_CACHE_VERSION || cached.workspaceId !== state.config.workspaceId) return;
        state.projects = cached.projects || [];
        state.tasks = [];
        state.equipment = [];
        state.cursor = cached.cursor || null;
        state.selectedProjectId = state.projects[0]?.id || null;
        state.hasFreshWorkspaceCache = false;
    } catch {
        localStorage.removeItem(CACHE_KEY);
    }
}

function saveCachedWorkspace() {
    const payload = JSON.stringify({
        version: WORKSPACE_CACHE_VERSION,
        workspaceId: state.config.workspaceId,
        cursor: state.cursor,
        projects: state.projects
    });

    try {
        localStorage.setItem(CACHE_KEY, payload);
    } catch (error) {
        console.warn("Workspace cache unavailable", error);
        try {
            localStorage.removeItem(CACHE_KEY);
            localStorage.setItem(CACHE_KEY, payload);
        } catch {
            // Display should never depend on local cache.
        }
    }
}

function setStatus(message) {
    elements.syncStatus.textContent = message;
}

function formatDate(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("en-GB").format(date);
}

function formatDateTime(value) {
    if (!value) return "";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("en-GB", {
        dateStyle: "short",
        timeStyle: "short"
    }).format(date);
}

function compactJoin(values, separator) {
    return values.filter(Boolean).join(separator);
}
