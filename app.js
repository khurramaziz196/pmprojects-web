const CONFIG_KEY = "pmprojects.web.supabase.config";
const CACHE_KEY = "pmprojects.web.workspace.cache";

const state = {
    config: loadConfig(),
    projects: [],
    tasks: [],
    cursor: null,
    selectedProjectId: null,
    view: "projects",
    filters: {
        search: "",
        status: "",
        customer: "",
        mrb: ""
    }
};

const elements = {
    configureButton: document.getElementById("configureButton"),
    refreshButton: document.getElementById("refreshButton"),
    configPanel: document.getElementById("configPanel"),
    projectUrlInput: document.getElementById("projectUrlInput"),
    apiKeyInput: document.getElementById("apiKeyInput"),
    workspaceIdInput: document.getElementById("workspaceIdInput"),
    saveConfigButton: document.getElementById("saveConfigButton"),
    workspaceSummary: document.getElementById("workspaceSummary"),
    syncStatus: document.getElementById("syncStatus"),
    searchInput: document.getElementById("searchInput"),
    statusFilter: document.getElementById("statusFilter"),
    customerFilter: document.getElementById("customerFilter"),
    mrbFilter: document.getElementById("mrbFilter"),
    workspaceGrid: document.getElementById("workspaceGrid"),
    projectCount: document.getElementById("projectCount"),
    projectsBody: document.getElementById("projectsBody"),
    projectWorkspaceView: document.getElementById("projectWorkspaceView"),
    backToProjectsButton: document.getElementById("backToProjectsButton"),
    workspaceProjectTitle: document.getElementById("workspaceProjectTitle"),
    workspaceProjectSubtitle: document.getElementById("workspaceProjectSubtitle"),
    workspaceHero: document.getElementById("workspaceHero"),
    taskWorkspacePanel: document.getElementById("taskWorkspacePanel"),
    workspaceTaskCount: document.getElementById("workspaceTaskCount"),
    workspaceTasksBody: document.getElementById("workspaceTasksBody"),
    metricProjects: document.getElementById("metricProjects"),
    metricActive: document.getElementById("metricActive"),
    metricDone: document.getElementById("metricDone"),
    metricTasks: document.getElementById("metricTasks")
};

initialise();

function initialise() {
    fillConfigInputs();
    bindEvents();
    loadCachedWorkspace();
    render();

    if (isConfigured()) {
        refreshWorkspace({ force: false });
    } else {
        elements.configPanel.hidden = false;
    }
}

function bindEvents() {
    elements.configureButton.addEventListener("click", () => {
        elements.configPanel.hidden = !elements.configPanel.hidden;
    });

    elements.saveConfigButton.addEventListener("click", () => {
        state.config = {
            projectUrl: elements.projectUrlInput.value.trim().replace(/\/$/, ""),
            apiKey: elements.apiKeyInput.value.trim(),
            workspaceId: elements.workspaceIdInput.value.trim() || "primary"
        };
        localStorage.setItem(CONFIG_KEY, JSON.stringify(state.config));
        elements.configPanel.hidden = true;
        refreshWorkspace({ force: true });
    });

    elements.refreshButton.addEventListener("click", () => refreshWorkspace({ force: true }));
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
    elements.backToProjectsButton.addEventListener("click", () => {
        state.view = "projects";
        render();
    });
}

async function refreshWorkspace({ force }) {
    if (!isConfigured()) {
        setStatus("Configure Supabase first");
        elements.configPanel.hidden = false;
        return;
    }

    try {
        setStatus(force ? "Refreshing..." : "Checking for changes...");
        const cursor = await fetchSyncCursor();
        const hasRemoteChange = !state.cursor?.last_snapshot_updated_at
            || cursor?.last_snapshot_updated_at !== state.cursor.last_snapshot_updated_at;

        if (!force && cursor && !hasRemoteChange && state.projects.length > 0) {
            setStatus(`Up to date · ${formatDateTime(cursor.last_snapshot_updated_at)}`);
            return;
        }

        const [projects, projectFields, tasks, taskFields] = await Promise.all([
            fetchProjects(),
            fetchProjectCustomFields(),
            fetchTasks(),
            fetchTaskCustomFields()
        ]);

        state.cursor = cursor;
        state.projects = attachProjectFields(projects, projectFields);
        state.tasks = attachTaskFields(tasks, taskFields);

        if (!state.selectedProjectId || !state.projects.some(project => project.id === state.selectedProjectId)) {
            state.selectedProjectId = state.projects[0]?.id || null;
        }

        saveCachedWorkspace();
        render();
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
    return supabaseGet("projects_normalized", {
        workspace_id: `eq.${state.config.workspaceId}`,
        select: "id,parent_project_id,linked_equipment_id,name,start_date,end_date,actual_start_date,actual_end_date,po_number,so_number,rig_number,arf_ref,status,customer,category,serial_number,completion_percent,priority,arf,estimated_completion_date,mrb_status,remarks,sort_order",
        order: "sort_order.asc"
    });
}

async function fetchProjectCustomFields() {
    return supabaseGet("project_custom_fields", {
        workspace_id: `eq.${state.config.workspaceId}`,
        select: "project_id,field_key,field_value"
    });
}

async function fetchTasks() {
    return supabaseGet("tasks_normalized", {
        workspace_id: `eq.${state.config.workspaceId}`,
        select: "id,project_id,parent_task_id,linked_equipment_id,icon_name,comment,title,status,mrb_status,serial_number,part_number,size,rwp,category,depth,sort_order",
        order: "depth.asc,sort_order.asc"
    });
}

async function fetchTaskCustomFields() {
    return supabaseGet("task_custom_fields", {
        workspace_id: `eq.${state.config.workspaceId}`,
        select: "task_id,field_key,field_value"
    });
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
    elements.workspaceGrid.hidden = state.view !== "projects";
    elements.projectWorkspaceView.hidden = state.view !== "workspace";
    renderFilters();
    renderMetrics();
    renderProjects();
    renderProjectWorkspace();
    elements.workspaceSummary.textContent = state.projects.length
        ? `${state.projects.length} projects loaded from workspace ${state.config?.workspaceId || "primary"}.`
        : "Connect to Supabase to load projects and tasks.";
}

function renderFilters() {
    fillSelect(elements.statusFilter, "All Status", uniqueValues(state.projects.map(project => project.status)), state.filters.status);
    fillSelect(elements.customerFilter, "All Customers", uniqueValues(state.projects.map(project => project.customer)), state.filters.customer);
    fillSelect(elements.mrbFilter, "All MRB", uniqueValues(state.projects.map(project => project.mrb_status)), state.filters.mrb);
}

function renderMetrics() {
    const active = state.projects.filter(project => !["Done", "Cancelled"].includes(project.status)).length;
    const avgDone = state.projects.length
        ? Math.round(state.projects.reduce((sum, project) => sum + Number(project.completion_percent || 0), 0) / state.projects.length)
        : 0;

    elements.metricProjects.textContent = String(state.projects.length);
    elements.metricActive.textContent = String(active);
    elements.metricDone.textContent = `${avgDone}%`;
    elements.metricTasks.textContent = String(state.tasks.length);
}

function renderProjects() {
    const rows = filteredProjects();
    elements.projectCount.textContent = `${rows.length} rows`;
    elements.projectsBody.innerHTML = "";

    if (!rows.length) {
        elements.projectsBody.appendChild(emptyRow(15, state.projects.length ? "No projects match the current filters." : "No projects loaded."));
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
            openButtonCell(project),
            projectNameCell(project),
            textCell(project.po_number),
            textCell(project.so_number),
            textCell(project.rig_number),
            textCell(project.arf_ref),
            pillCell(project.status, statusClass(project.status)),
            textCell(project.customer),
            categoryCell(project.category),
            progressCell(project.completion_percent),
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
    state.view = "workspace";
    render();
}

function renderProjectWorkspace() {
    const project = state.projects.find(item => item.id === state.selectedProjectId);

    if (!project) {
        elements.workspaceProjectTitle.textContent = "Project";
        elements.workspaceProjectSubtitle.textContent = "Select a project";
        elements.workspaceHero.innerHTML = "";
        elements.workspaceTasksBody.innerHTML = "";
        elements.workspaceTaskCount.textContent = "0 tasks";
        return;
    }

    const taskRows = buildTaskRows(project.id);
    const doneTasks = taskRows.filter(row => row.task.status === "Done").length;
    elements.workspaceProjectTitle.textContent = project.name || "Untitled Project";
    elements.workspaceProjectSubtitle.textContent = compactJoin([project.arf_ref, project.customer, project.status], " · ");
    elements.workspaceHero.innerHTML = "";
    elements.workspaceHero.append(
        heroStat("Progress", `${Math.round(Number(project.completion_percent || 0))}%`),
        heroStat("Task Status", `${doneTasks} of ${taskRows.length} Done`),
        heroStat("Schedule", `${formatDate(project.start_date)} to ${formatDate(project.end_date)}`),
        heroStat("Valves", project.customFields?.["Valves"] || project.category || "—"),
        heroStat("MRB", project.mrb_status || "—"),
        heroStat("PO / SO", compactJoin([project.po_number, project.so_number], " / ") || "—"),
        heroStat("ARF Ref", project.arf_ref || "—")
    );

    renderWorkspaceTasks(taskRows);
}

function renderWorkspaceTasks(taskRows) {
    elements.workspaceTaskCount.textContent = `${taskRows.length} tasks`;
    elements.workspaceTasksBody.innerHTML = "";

    if (!taskRows.length) {
        elements.workspaceTasksBody.appendChild(emptyRow(10, "No tasks for this project."));
        return;
    }

    const fragment = document.createDocumentFragment();
    taskRows.forEach(row => {
        const tr = document.createElement("tr");
        tr.append(
            textCell(row.wbs),
            taskTitleCell(row),
            pillCell(row.task.status, statusClass(row.task.status)),
            textCell(row.task.mrb_status),
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
        .sort((a, b) => Number(a.sort_order || 0) - Number(b.sort_order || 0));

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
            rows.push({ task, wbs });
            walk(task.id, wbs);
        });
    };
    walk(null, "");
    return rows;
}

function filteredProjects() {
    return state.projects.filter(project => {
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

function groupedProjects(projects) {
    const groups = [];
    const indexByStatus = new Map();
    projects.forEach(project => {
        const status = project.status || "No Status";
        if (!indexByStatus.has(status)) {
            indexByStatus.set(status, groups.length);
            groups.push({ status, projects: [] });
        }
        groups[indexByStatus.get(status)].projects.push(project);
    });
    return groups;
}

function groupHeaderRow(status, count) {
    const tr = document.createElement("tr");
    tr.className = `group-row ${statusClass(status)}`;
    const td = document.createElement("td");
    td.colSpan = 15;
    td.innerHTML = `<span class="group-pill"></span><strong></strong>`;
    td.querySelector(".group-pill").textContent = status;
    td.querySelector("strong").textContent = `${count} ${count === 1 ? "project" : "projects"}`;
    tr.appendChild(td);
    return tr;
}

function projectNameCell(project) {
    const td = document.createElement("td");
    const subline = compactJoin([project.po_number && `PO ${project.po_number}`, project.customer], " · ");
    td.innerHTML = `<span class="project-name"></span><span class="subtext"></span>`;
    td.querySelector(".project-name").textContent = project.name || "Untitled Project";
    td.querySelector(".subtext").textContent = subline;
    return td;
}

function openButtonCell(project) {
    const td = document.createElement("td");
    const button = document.createElement("button");
    button.type = "button";
    button.className = "open-button";
    button.textContent = "Open";
    button.addEventListener("click", event => {
        event.stopPropagation();
        openProjectWorkspace(project.id);
    });
    td.appendChild(button);
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

function categoryCell(value) {
    const className = value?.toLowerCase().includes("loose") ? "alert" : "info";
    return pillCell(value, className);
}

function progressCell(value) {
    const numeric = Math.max(0, Math.min(100, Math.round(Number(value || 0))));
    const td = document.createElement("td");
    td.className = "progress-cell";
    td.style.setProperty("--progress", `${numeric}%`);
    td.innerHTML = `<span>${numeric}%</span>`;
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

function detailSection(title, rows) {
    const section = document.createElement("section");
    section.className = "detail-section";
    const heading = document.createElement("h3");
    heading.textContent = title;
    section.appendChild(heading);

    rows.forEach(([label, value]) => {
        const row = document.createElement("div");
        row.className = "detail-row";
        const labelElement = document.createElement("span");
        const valueElement = document.createElement("strong");
        labelElement.textContent = label;
        valueElement.textContent = value || "—";
        row.append(labelElement, valueElement);
        section.appendChild(row);
    });

    return section;
}

function statusClass(value) {
    if (value === "Done") return "done";
    if (value === "Rejected" || value === "Cancelled") return "alert";
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

function loadConfig() {
    try {
        return JSON.parse(localStorage.getItem(CONFIG_KEY)) || {};
    } catch {
        return {};
    }
}

function fillConfigInputs() {
    elements.projectUrlInput.value = state.config.projectUrl || "";
    elements.apiKeyInput.value = state.config.apiKey || "";
    elements.workspaceIdInput.value = state.config.workspaceId || "primary";
}

function isConfigured() {
    return Boolean(state.config?.projectUrl && state.config?.apiKey && state.config?.workspaceId);
}

function loadCachedWorkspace() {
    try {
        const cached = JSON.parse(localStorage.getItem(CACHE_KEY));
        if (!cached || cached.workspaceId !== state.config.workspaceId) return;
        state.projects = cached.projects || [];
        state.tasks = cached.tasks || [];
        state.cursor = cached.cursor || null;
        state.selectedProjectId = state.projects[0]?.id || null;
    } catch {
        localStorage.removeItem(CACHE_KEY);
    }
}

function saveCachedWorkspace() {
    localStorage.setItem(CACHE_KEY, JSON.stringify({
        workspaceId: state.config.workspaceId,
        cursor: state.cursor,
        projects: state.projects,
        tasks: state.tasks
    }));
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
