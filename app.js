const CONFIG_KEY = "pmprojects.web.supabase.config";
const CACHE_KEY = "pmprojects.web.workspace.cache";
const PROJECT_COLUMN_WIDTHS_KEY = "pmprojects.web.project.columnWidths";
const DASHBOARD_PROGRESS_COLUMN_WIDTHS_KEY = "pmprojects.web.dashboardProgress.columnWidths";
const EQUIPMENT_COLUMN_WIDTHS_KEY = "pmprojects.web.equipment.columnWidths";
const DELIVERY_TICKET_RECORDS_KEY = "pmprojects.web.deliveryTicket.records";
const DELIVERY_TICKET_COUNTER_KEY = "pmprojects.web.deliveryTicket.counter";
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
const DASHBOARD_COLORS = ["#2f86ff", "#2bbf63", "#ff8a2a", "#d83df0", "#0f9aa8", "#5967e8"];
const DASHBOARD_CUSTOMER_COLORS = new Map([
    ["SANAD", "#78c64b"],
    ["ADC", "#ff5050"],
    ["ARO", "#1f7a46"],
    ["ADES", "#0f5f9f"],
    ["BORR", "#b08a67"],
    ["HP", "#0f9aa8"],
    ["OTHER", "#9aa1aa"],
    ["OTHERS", "#9aa1aa"],
    ["UNASSIGNED", "#9aa1aa"]
]);
const state = {
    config: loadConfig(),
    projects: [],
    tasks: [],
    equipment: [],
    deliveryTickets: loadDeliveryTicketRecords(),
    deliveryTicketDraft: null,
    deliveryTicketPushQueue: Promise.resolve(),
    selectedDeliveryTicketId: null,
    cursor: null,
    selectedProjectId: null,
    hasFreshWorkspaceCache: false,
    activeView: "dashboard",
    filters: {
        search: "",
        status: "",
        customer: "",
        mrb: ""
    }
};

const elements = {
    dashboardViewButton: document.getElementById("dashboardViewButton"),
    projectsViewButton: document.getElementById("projectsViewButton"),
    equipmentViewButton: document.getElementById("equipmentViewButton"),
    deliveryTicketViewButton: document.getElementById("deliveryTicketViewButton"),
    refreshButton: document.getElementById("refreshButton"),
    logoutButton: document.getElementById("logoutButton"),
    userLabel: document.getElementById("userLabel"),
    localUserSelector: document.getElementById("localUserSelector"),
    workspaceSummary: document.getElementById("workspaceSummary"),
    syncStatus: document.getElementById("syncStatus"),
    searchInput: document.getElementById("searchInput"),
    statusFilter: document.getElementById("statusFilter"),
    customerFilter: document.getElementById("customerFilter"),
    mrbFilter: document.getElementById("mrbFilter"),
    workspaceSelector: document.getElementById("workspaceSelector"),
    dashboardView: document.getElementById("dashboardView"),
    dashboardSubtitle: document.getElementById("dashboardSubtitle"),
    dashboardHeroMetrics: document.getElementById("dashboardHeroMetrics"),
    dashboardDistribution: document.getElementById("dashboardDistribution"),
    dashboardProgressCount: document.getElementById("dashboardProgressCount"),
    dashboardProgressScroll: document.getElementById("dashboardProgressScroll"),
    dashboardScrollLeftButton: document.getElementById("dashboardScrollLeftButton"),
    dashboardScrollRightButton: document.getElementById("dashboardScrollRightButton"),
    dashboardProgressTable: document.getElementById("dashboardProgressTable"),
    dashboardProgressBody: document.getElementById("dashboardProgressBody"),
    dashboardEquipmentFocus: document.getElementById("dashboardEquipmentFocus"),
    workspaceGrid: document.getElementById("workspaceGrid"),
    equipmentView: document.getElementById("equipmentView"),
    equipmentCount: document.getElementById("equipmentCount"),
    equipmentTable: document.getElementById("equipmentTable"),
    equipmentBody: document.getElementById("equipmentBody"),
    deliveryTicketView: document.getElementById("deliveryTicketView"),
    deliveryTicketRecordCount: document.getElementById("deliveryTicketRecordCount"),
    deliveryTicketRecordList: document.getElementById("deliveryTicketRecordList"),
    deliveryTicketStatus: document.getElementById("deliveryTicketStatus"),
    deliveryTicketNewButton: document.getElementById("deliveryTicketNewButton"),
    deliveryTicketNewSmallButton: document.getElementById("deliveryTicketNewSmallButton"),
    deliveryTicketSaveButton: document.getElementById("deliveryTicketSaveButton"),
    deliveryTicketSubmitButton: document.getElementById("deliveryTicketSubmitButton"),
    deliveryTicketApproveButton: document.getElementById("deliveryTicketApproveButton"),
    deliveryTicketRejectButton: document.getElementById("deliveryTicketRejectButton"),
    deliveryTicketGenerateButton: document.getElementById("deliveryTicketGenerateButton"),
    deliveryTicketDeleteButton: document.getElementById("deliveryTicketDeleteButton"),
    deliveryTicketAddItemButton: document.getElementById("deliveryTicketAddItemButton"),
    deliveryTicketApprovalBanner: document.getElementById("deliveryTicketApprovalBanner"),
    deliveryTicketItemsBody: document.getElementById("deliveryTicketItemsBody"),
    dtTicketNumber: document.getElementById("dtTicketNumber"),
    dtIssueDate: document.getElementById("dtIssueDate"),
    dtTransportDate: document.getElementById("dtTransportDate"),
    dtPriority: document.getElementById("dtPriority"),
    dtOrderReference: document.getElementById("dtOrderReference"),
    dtPickupLocation: document.getElementById("dtPickupLocation"),
    dtDeliveryLocation: document.getElementById("dtDeliveryLocation"),
    dtPickupContact: document.getElementById("dtPickupContact"),
    dtPickupPhone: document.getElementById("dtPickupPhone"),
    dtDeliveryContact: document.getElementById("dtDeliveryContact"),
    dtDeliveryPhone: document.getElementById("dtDeliveryPhone"),
    dtGoodsDetails: document.getElementById("dtGoodsDetails"),
    dtTransportVendor: document.getElementById("dtTransportVendor"),
    dtDriverName: document.getElementById("dtDriverName"),
    dtDriverPhone: document.getElementById("dtDriverPhone"),
    dtVehicleNumber: document.getElementById("dtVehicleNumber"),
    dtVendorAcknowledgement: document.getElementById("dtVendorAcknowledgement"),
    dtAuthorizedBy: document.getElementById("dtAuthorizedBy"),
    dtRequesterSignature: document.getElementById("dtRequesterSignature"),
    dtApproverSignature: document.getElementById("dtApproverSignature"),
    dtRemarks: document.getElementById("dtRemarks"),
    projectCount: document.getElementById("projectCount"),
    projectsTable: document.getElementById("projectsTable"),
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
    renderLocalUserSelector();
    initialiseResizableProjectColumns();
    initialiseResizableDashboardProgressColumns();
    initialiseResizableEquipmentColumns();
    initialiseDashboardProgressScrolling();
    loadCachedWorkspace();
    render();

    if (isConfigured()) {
        refreshWorkspace({ force: false });
    }
}

function bindEvents() {
    elements.dashboardViewButton.addEventListener("click", () => {
        if (!canViewPage("dashboard")) return;
        state.activeView = "dashboard";
        render();
    });
    elements.projectsViewButton.addEventListener("click", () => {
        if (!canViewPage("projects")) return;
        state.activeView = "projects";
        render();
    });
    elements.equipmentViewButton.addEventListener("click", () => {
        if (!canViewPage("equipment")) return;
        state.activeView = "equipment";
        render();
    });
    elements.deliveryTicketViewButton.addEventListener("click", () => {
        if (!canViewPage("deliveryTicket")) return;
        state.activeView = "deliveryTicket";
        ensureSelectedDeliveryTicket();
        render();
    });
    elements.dashboardScrollLeftButton.addEventListener("click", () => scrollDashboardProgressBy(-420));
    elements.dashboardScrollRightButton.addEventListener("click", () => scrollDashboardProgressBy(420));
    elements.refreshButton.addEventListener("click", () => refreshWorkspace({ force: true }));
    elements.logoutButton.addEventListener("click", () => window.PMProjectsAuth.logout());
    elements.localUserSelector?.addEventListener("change", event => {
        window.PMProjectsAuth.selectLocalTestUser?.(event.target.value);
        state.config = loadConfig();
        state.activeView = firstAllowedView();
        renderUserLabel();
        render();
        setDeliveryTicketStatus(`Local test user: ${window.PMProjectsAuth.userLabel?.() || event.target.value}`);
    });
    elements.searchInput.addEventListener("input", event => {
        state.filters.search = event.target.value.trim().toLowerCase();
        renderProjects();
        renderEquipment();
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
    elements.deliveryTicketNewButton.addEventListener("click", createNewDeliveryTicket);
    elements.deliveryTicketNewSmallButton.addEventListener("click", createNewDeliveryTicket);
    elements.deliveryTicketSaveButton.addEventListener("click", () => saveDeliveryTicketFromForm(true));
    elements.deliveryTicketSubmitButton.addEventListener("click", submitDeliveryTicketForApproval);
    elements.deliveryTicketApproveButton.addEventListener("click", approveDeliveryTicket);
    elements.deliveryTicketRejectButton.addEventListener("click", rejectDeliveryTicket);
    elements.deliveryTicketGenerateButton.addEventListener("click", generateDeliveryTicketPDF);
    elements.deliveryTicketDeleteButton.addEventListener("click", deleteSelectedDeliveryTicket);
    elements.deliveryTicketAddItemButton.addEventListener("click", () => {
        const record = collectDeliveryTicketForm();
        record.items.push(makeDeliveryTicketItem(record.items.length + 1));
        applyDeliveryTicketForm(record);
        setDeliveryTicketStatus("");
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

function renderLocalUserSelector() {
    if (!elements.localUserSelector || !window.PMProjectsAuth.isLocalDevelopmentHost?.()) return;
    const users = window.PMProjectsAuth.localTestUsers?.() || [];
    const currentEmail = deliveryTicketCurrentUserEmail();
    elements.localUserSelector.innerHTML = "";
    users.forEach(user => {
        const option = document.createElement("option");
        option.value = user.email;
        option.textContent = user.label;
        elements.localUserSelector.appendChild(option);
    });
    elements.localUserSelector.value = currentEmail || users[0]?.email || "";
    elements.localUserSelector.hidden = false;
}

async function refreshWorkspace({ force }) {
    await window.PMProjectsAuth.refreshWorkspaceAccess?.();
    state.config = loadConfig();
    renderWorkspaceSelector();

    if (!isConfigured()) {
        setStatus("Supabase access key is not embedded.");
        return;
    }

    try {
        setStatus(force ? "Refreshing..." : "Checking for changes...");
        await state.deliveryTicketPushQueue.catch(() => {});
        const cursor = await fetchSyncCursor();
        const hasRemoteChange = !state.cursor?.last_snapshot_updated_at
            || cursor?.last_snapshot_updated_at !== state.cursor.last_snapshot_updated_at;

        if (!force && cursor && !hasRemoteChange && state.projects.length > 0 && state.tasks.length > 0 && state.hasFreshWorkspaceCache) {
            setStatus(`Up to date · ${formatDateTime(cursor.last_snapshot_updated_at)}`);
            return;
        }

        const projects = await fetchProjects();
        const projectIds = projects.map(project => project.id).filter(Boolean);
        const [projectFields, tasks, equipment, deliveryTickets] = await Promise.all([
            fetchProjectCustomFields(projectIds),
            fetchTasks(projectIds),
            fetchEquipment().catch(error => {
                console.warn("Equipment detail unavailable", error);
                return [];
            }),
            fetchDeliveryTickets().catch(error => {
                console.warn("Delivery tickets unavailable", error);
                return null;
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
        if (Array.isArray(deliveryTickets)) {
            state.deliveryTickets = mergeFetchedDeliveryTickets(deliveryTickets.map(deliveryTicketFromSupabase));
            if (!state.selectedDeliveryTicketId || !state.deliveryTickets.some(record => record.id === state.selectedDeliveryTicketId)) {
                state.selectedDeliveryTicketId = state.deliveryTickets[0]?.id || null;
            }
            saveDeliveryTicketRecords();
        }
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
    const query = {
        workspace_id: `eq.${state.config.workspaceId}`,
        select: "id,parent_project_id,linked_equipment_id,name,start_date,end_date,actual_start_date,actual_end_date,po_number,so_number,rig_number,arf_ref,status,customer,category,serial_number,completion_percent,priority,arf,estimated_completion_date,mrb_status,remarks,sort_order",
        order: "sort_order.asc"
    };
    return supabaseGetAll("projects_normalized", query);
}

async function fetchProjectCustomFields(projectIds = []) {
    if (hasProjectDataScope() && !projectIds.length) {
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

async function fetchTasks(projectIds = []) {
    if (hasProjectDataScope() && !projectIds.length) {
        return [];
    }
    const query = {
        workspace_id: `eq.${state.config.workspaceId}`,
        select: "id,project_id,parent_task_id,linked_equipment_id,title,status,serial_number,part_number,category",
        order: "project_id.asc,depth.asc,sort_order.asc"
    };
    if (projectIds.length) {
        query.project_id = `in.(${projectIds.join(",")})`;
    }
    return supabaseGetAll("tasks_normalized", query);
}

async function fetchEquipment() {
    return supabaseGetAll("equipment_items_normalized", {
        workspace_id: `eq.${state.config.workspaceId}`,
        select: "id,parent_equipment_id,serial_number,part_number,size,rwp,category,model,rig_number,manifold_number,manifold_part_number,sawcm_edition,service_type,location,cycle,recert_date,customer,arf,sri_ref,customer_po_number,arf_ref,sort_order",
        order: "sort_order.asc"
    });
}

async function fetchDeliveryTickets() {
    return supabaseGetAll("delivery_tickets_normalized", {
        workspace_id: `eq.${state.config.workspaceId}`,
        select: "*",
        order: "updated_at.desc"
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

async function supabaseUpsert(table, rows, conflictColumns = "id") {
    if (!rows.length) return;
    const response = await fetch(`${state.config.projectUrl}/rest/v1/${table}?on_conflict=${encodeURIComponent(conflictColumns)}`, {
        method: "POST",
        headers: {
            apikey: state.config.apiKey,
            Authorization: `Bearer ${window.PMProjectsAuth.accessToken() || state.config.apiKey}`,
            "Content-Type": "application/json",
            Prefer: "resolution=merge-duplicates,return=minimal"
        },
        body: JSON.stringify(rows)
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`${table} upsert failed (${response.status}) ${body}`.trim());
    }
}

async function supabaseDeleteByID(table, id) {
    const url = new URL(`${state.config.projectUrl}/rest/v1/${table}`);
    url.searchParams.set("workspace_id", `eq.${state.config.workspaceId}`);
    url.searchParams.set("id", `eq.${id}`);
    const response = await fetch(url, {
        method: "DELETE",
        headers: {
            apikey: state.config.apiKey,
            Authorization: `Bearer ${window.PMProjectsAuth.accessToken() || state.config.apiKey}`,
            Prefer: "return=minimal"
        }
    });

    if (!response.ok) {
        const body = await response.text();
        throw new Error(`${table} delete failed (${response.status}) ${body}`.trim());
    }
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
    document.body.classList.toggle("arf-scoped", Boolean(currentArfScope()));
    if (!canViewPage(state.activeView)) {
        state.activeView = firstAllowedView();
    }
    renderUserLabel();
    renderActiveView();
    renderFilters();
    renderMetrics();
    renderDashboard();
    renderProjects();
    renderEquipment();
    renderDeliveryTicketPage();
    const visibleCount = visibleBaseProjects().length;
    elements.workspaceSummary.textContent = visibleCount
        ? `${visibleCount} projects loaded from workspace ${state.config?.workspaceId || "primary"}.`
        : "Connect to Supabase to load projects and tasks.";
}

function renderActiveView() {
    setPageButtonVisibility(elements.dashboardViewButton, canViewPage("dashboard"));
    setPageButtonVisibility(elements.projectsViewButton, canViewPage("projects"));
    setPageButtonVisibility(elements.equipmentViewButton, canViewPage("equipment"));
    setPageButtonVisibility(elements.deliveryTicketViewButton, canViewPage("deliveryTicket"));
    elements.dashboardViewButton.classList.toggle("active", state.activeView === "dashboard");
    elements.projectsViewButton.classList.toggle("active", state.activeView === "projects");
    elements.equipmentViewButton.classList.toggle("active", state.activeView === "equipment");
    elements.deliveryTicketViewButton.classList.toggle("active", state.activeView === "deliveryTicket");
    elements.dashboardView.hidden = state.activeView !== "dashboard";
    elements.workspaceGrid.hidden = state.activeView !== "projects";
    elements.equipmentView.hidden = state.activeView !== "equipment";
    elements.deliveryTicketView.hidden = state.activeView !== "deliveryTicket";
}

function setPageButtonVisibility(button, isVisible) {
    button.hidden = !isVisible;
    button.style.display = isVisible ? "" : "none";
}

function currentWorkspacePermissions() {
    return window.PMProjectsAuth.currentWorkspace?.() || {};
}

function hasWorkspacePermission(key, fallback = false) {
    const workspace = currentWorkspacePermissions();
    if (Object.prototype.hasOwnProperty.call(workspace, key)) {
        return permissionValueIsEnabled(workspace[key]);
    }
    if (workspace.role === "admin") return true;
    return fallback;
}

function permissionValueIsEnabled(value) {
    if (typeof value === "boolean") return value;
    if (typeof value === "number") return value !== 0;
    const normalized = String(value ?? "").trim().toLowerCase();
    if (["true", "t", "yes", "y", "1"].includes(normalized)) return true;
    if (["false", "f", "no", "n", "0", ""].includes(normalized)) return false;
    return Boolean(value);
}

function canViewPage(page) {
    switch (page) {
        case "dashboard": return hasWorkspacePermission("can_view_dashboard", true);
        case "projects": return hasWorkspacePermission("can_view_projects", true);
        case "equipment": return hasWorkspacePermission("can_view_equipment_db", true);
        case "deliveryTicket": return hasWorkspacePermission("can_view_delivery_ticket", false);
        default: return false;
    }
}

function firstAllowedView() {
    return ["dashboard", "projects", "equipment", "deliveryTicket"].find(canViewPage) || "dashboard";
}

function renderUserLabel() {
    if (!elements.userLabel) return;
    const label = window.PMProjectsAuth.userLabel?.() || "";
    const scope = currentScopeLabel();
    elements.userLabel.textContent = scope ? `Signed in as ${label} • ${scope}` : `Signed in as ${label}`;
}

function renderDashboard() {
    const projects = visibleBaseProjects();
    const activeProjects = dashboardActiveProjects(projects);
    const planningProjects = projects.filter(project => project.status === "Planning");
    const completedProjects = state.projects.filter(project => project.status === "Done" && projectMatchesDataScope(project));
    const equipmentRows = visibleEquipmentRows();
    const avgDone = activeProjects.length
        ? Math.round(activeProjects.reduce((sum, project) => sum + progressForProject(project), 0) / activeProjects.length)
        : 0;

    elements.dashboardSubtitle.textContent = `${projects.length} visible projects . ${equipmentRows.length} equipment rows . ${state.config?.workspaceId || "primary"}`;
    elements.dashboardHeroMetrics.innerHTML = "";
    [
        ["Active Projects", activeProjects.length, "blue"],
        ["Planning Projects", planningProjects.length, "orange"],
        ["Completed Projects", completedProjects.length, "green"],
        ["Equipment Rows", equipmentRows.length, "purple"],
        ["Average Progress", `${avgDone}%`, "green"]
    ].forEach(([title, value, tone]) => {
        const tile = document.createElement("div");
        tile.className = `dashboard-metric ${tone}`;
        tile.innerHTML = `<span></span><strong></strong>`;
        tile.querySelector("span").textContent = title;
        tile.querySelector("strong").textContent = value;
        elements.dashboardHeroMetrics.appendChild(tile);
    });

    renderDashboardDistributions([
        ["Planning", "Customer mix across projects in planning.", planningProjects],
        ["Active", "Customer mix across projects in execution.", activeProjects],
        ["Completed", "Customer mix across delivered work.", completedProjects]
    ]);
    renderDashboardProgress(activeProjects);
    renderEquipmentFocus();
}

function renderDashboardDistributions(sections) {
    elements.dashboardDistribution.innerHTML = "";
    sections.forEach(([title, subtitle, rows]) => {
        const card = document.createElement("section");
        card.className = "dashboard-panel dashboard-donut-card";
        const slices = customerDistribution(rows);
        card.innerHTML = `
            <div class="dashboard-card-header">
                <div>
                    <h2>${escapeHTML(title)}</h2>
                    <p>${escapeHTML(subtitle)}</p>
                </div>
            </div>
            <p class="dashboard-total">Total Projects: <strong>${rows.length}</strong></p>
            <div class="dashboard-donut-layout">
                <div class="dashboard-donut" aria-hidden="true">
                    <div><strong>${rows.length}</strong><span>projects</span></div>
                </div>
                <div class="dashboard-legend"></div>
            </div>
        `;
        const donut = card.querySelector(".dashboard-donut");
        const legend = card.querySelector(".dashboard-legend");
        if (!slices.length) {
            donut.style.setProperty("--donut-gradient", "#e7edf5 0 360deg");
            legend.appendChild(emptyDashboardMessage("No project data available."));
        } else {
            donut.style.setProperty("--donut-gradient", dashboardDonutGradient(slices, rows.length));
            slices.forEach((slice, index) => {
                const row = document.createElement("div");
                row.className = "dashboard-legend-row";
                row.style.setProperty("--legend-color", dashboardCustomerColor(slice.label, index));
                row.innerHTML = `<span></span><strong></strong><b></b>`;
                row.querySelector("strong").textContent = slice.label;
                row.querySelector("b").textContent = String(slice.count);
                legend.appendChild(row);
            });
        }
        elements.dashboardDistribution.appendChild(card);
    });
}

function renderDashboardProgress(activeProjects) {
    const rows = [...activeProjects].sort((left, right) => String(left.name || "").localeCompare(String(right.name || "")));
    elements.dashboardProgressCount.textContent = `${rows.length} rows`;
    elements.dashboardProgressBody.innerHTML = "";
    if (!rows.length) {
        elements.dashboardProgressBody.appendChild(emptyRow(9, "No active project data available."));
        return;
    }

    const fragment = document.createDocumentFragment();
    rows.forEach(project => {
        const tr = document.createElement("tr");
        tr.addEventListener("dblclick", () => openProjectWorkspace(project.id));
        tr.append(
            textCell(String(project.name || "").toUpperCase()),
            textCell(project.po_number),
            textCell(project.rig_number),
            textCell(project.arf_ref),
            textCell(project.customer),
            categoryCell(project),
            textCell(project.serial_number),
            progressCell(progressForProject(project)),
            pillCell(project.arf, "purple")
        );
        fragment.appendChild(tr);
    });
    elements.dashboardProgressBody.appendChild(fragment);
    applyDashboardProgressColumnWidthsFromHeaders();
}

function renderEquipmentFocus() {
    elements.dashboardEquipmentFocus.innerHTML = "";
    const rows = equipmentFocusRows();
    if (!rows.length) {
        elements.dashboardEquipmentFocus.appendChild(emptyDashboardMessage("No equipment rows available."));
        return;
    }

    rows.forEach((row, index) => {
        const item = document.createElement("div");
        item.className = "dashboard-focus-item";
        item.style.setProperty("--focus-color", DASHBOARD_COLORS[index % DASHBOARD_COLORS.length]);
        item.innerHTML = `<div><strong></strong><span></span></div><b></b>`;
        item.querySelector("strong").textContent = row.label;
        item.querySelector("span").textContent = row.detail;
        item.querySelector("b").textContent = String(row.count);
        elements.dashboardEquipmentFocus.appendChild(item);
    });
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
    applyProjectColumnWidthsFromHeaders();
}

function renderEquipment() {
    const rows = filteredEquipment();
    elements.equipmentCount.textContent = `${rows.length} rows`;
    elements.equipmentBody.innerHTML = "";

    if (!rows.length) {
        elements.equipmentBody.appendChild(emptyRow(15, state.equipment.length ? "No equipment rows match the current filters." : "No equipment loaded."));
        return;
    }

    const fragment = document.createDocumentFragment();
    rows.forEach(item => {
        const tr = document.createElement("tr");
        tr.append(
            textCell(item.serial_number),
            textCell(item.part_number),
            textCell(item.size),
            textCell(item.rwp),
            pillCell(item.category, statusClass(item.category)),
            textCell(item.model),
            textCell(item.rig_number || item.manifold_number),
            textCell(item.sawcm_edition),
            textCell(item.cycle),
            textCell(formatDate(item.recert_date)),
            textCell(item.customer),
            pillCell(item.arf, "purple"),
            textCell(item.sri_ref),
            textCell(item.customer_po_number),
            textCell(item.arf_ref)
        );
        fragment.appendChild(tr);
    });

    elements.equipmentBody.appendChild(fragment);
    applyEquipmentColumnWidthsFromHeaders();
}

function renderDeliveryTicketPage() {
    if (!elements.deliveryTicketView) return;
    if (state.activeView !== "deliveryTicket" && !state.deliveryTickets.length) {
        return;
    }
    ensureSelectedDeliveryTicket();
    renderDeliveryTicketRecordList();
    const selected = selectedDeliveryTicket();
    if (selected && state.activeView === "deliveryTicket") {
        applyDeliveryTicketForm(selected);
    }
    updateDeliveryTicketApprovalControls(selected);
}

function ensureSelectedDeliveryTicket() {
    if (state.selectedDeliveryTicketId && state.deliveryTickets.some(record => record.id === state.selectedDeliveryTicketId)) {
        return;
    }
    if (state.deliveryTicketDraft && state.selectedDeliveryTicketId === state.deliveryTicketDraft.id) {
        return;
    }
    if (state.deliveryTickets.length) {
        state.selectedDeliveryTicketId = [...state.deliveryTickets].sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")))[0].id;
        return;
    }
    const record = makeDeliveryTicketRecord();
    state.deliveryTicketDraft = record;
    state.selectedDeliveryTicketId = record.id;
}

function selectedDeliveryTicket() {
    return state.deliveryTickets.find(record => record.id === state.selectedDeliveryTicketId)
        || (state.deliveryTicketDraft?.id === state.selectedDeliveryTicketId ? state.deliveryTicketDraft : null);
}

function renderDeliveryTicketRecordList() {
    elements.deliveryTicketRecordCount.textContent = `${state.deliveryTickets.length} ${state.deliveryTickets.length === 1 ? "record" : "records"}`;
    elements.deliveryTicketRecordList.innerHTML = "";
    if (!state.deliveryTickets.length) {
        const empty = document.createElement("div");
        empty.className = "delivery-ticket-empty";
        empty.textContent = "No saved delivery tickets.";
        elements.deliveryTicketRecordList.appendChild(empty);
        return;
    }

    [...state.deliveryTickets]
        .sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")))
        .forEach(record => {
            const button = document.createElement("button");
            button.type = "button";
            button.className = [
                "delivery-ticket-record",
                `status-${deliveryTicketApprovalStatus(record)}`,
                record.id === state.selectedDeliveryTicketId ? "selected" : ""
            ].filter(Boolean).join(" ");
            button.innerHTML = `
                <strong>${escapeHTML(record.ticketNumber)}</strong>
                <span>${escapeHTML(deliveryTicketApprovalLabel(record))}</span>
                <small>${escapeHTML(record.orderReference || "-")}</small>
                <small>Needed ${escapeHTML(formatDate(record.requiredTransportDate))}</small>
            `;
            button.addEventListener("click", () => {
                state.selectedDeliveryTicketId = record.id;
                applyDeliveryTicketForm(record);
                renderDeliveryTicketRecordList();
                updateDeliveryTicketApprovalControls(record);
                setDeliveryTicketStatus("");
            });
            elements.deliveryTicketRecordList.appendChild(button);
        });
}

function applyDeliveryTicketForm(record) {
    const normalized = normalizeDeliveryTicketRecord(record);
    elements.dtTicketNumber.value = normalized.ticketNumber;
    elements.dtIssueDate.value = normalized.issueDate;
    elements.dtTransportDate.value = normalized.requiredTransportDate;
    elements.dtPriority.value = normalized.priority || "Normal";
    elements.dtOrderReference.value = normalized.orderReference;
    elements.dtPickupLocation.value = normalized.pickupLocation;
    elements.dtDeliveryLocation.value = normalized.deliveryLocation;
    elements.dtPickupContact.value = normalized.pickupContact;
    elements.dtPickupPhone.value = normalized.pickupPhone;
    elements.dtDeliveryContact.value = normalized.deliveryContact;
    elements.dtDeliveryPhone.value = normalized.deliveryPhone;
    elements.dtGoodsDetails.value = normalized.goodsDetails;
    elements.dtTransportVendor.value = normalized.transportVendor;
    elements.dtDriverName.value = normalized.driverName;
    elements.dtDriverPhone.value = normalized.driverPhone;
    elements.dtVehicleNumber.value = normalized.vehicleNumber;
    elements.dtVendorAcknowledgement.value = normalized.vendorAcknowledgement;
    elements.dtAuthorizedBy.value = normalized.authorizedBy;
    elements.dtRequesterSignature.value = normalized.requesterSignature;
    elements.dtApproverSignature.value = normalized.approverSignature;
    elements.dtRemarks.value = normalized.remarks;
    renderDeliveryTicketItems(normalized.items);
    updateDeliveryTicketApprovalControls(normalized);
}

function renderDeliveryTicketItems(items) {
    elements.deliveryTicketItemsBody.innerHTML = "";
    items.forEach((item, index) => {
        const row = document.createElement("tr");
        row.innerHTML = `
            <td>${index + 1}</td>
            <td><input data-field="description" type="text" value="${escapeAttribute(item.description)}"></td>
            <td><input data-field="quantity" type="text" value="${escapeAttribute(item.quantity)}" placeholder="Qty"></td>
            <td><input data-field="uom" type="text" value="${escapeAttribute(item.uom || "Each")}"></td>
            <td><input data-field="remarks" type="text" value="${escapeAttribute(item.remarks)}" placeholder="Remarks"></td>
            <td><button type="button" data-action="delete-item">⌫</button></td>
        `;
        row.querySelector("[data-action='delete-item']").addEventListener("click", () => {
            const record = collectDeliveryTicketForm();
            record.items.splice(index, 1);
            if (!record.items.length) record.items.push(makeDeliveryTicketItem(1));
            record.items = record.items.map((nextItem, nextIndex) => ({ ...nextItem, itemNumber: nextIndex + 1 }));
            applyDeliveryTicketForm(record);
        });
        elements.deliveryTicketItemsBody.appendChild(row);
    });
}

function collectDeliveryTicketForm() {
    const current = selectedDeliveryTicket() || makeDeliveryTicketRecord();
    return normalizeDeliveryTicketRecord({
        ...current,
        ticketNumber: elements.dtTicketNumber.value.trim() || current.ticketNumber || nextDeliveryTicketNumber(),
        issueDate: elements.dtIssueDate.value || currentDateInputValue(),
        requiredTransportDate: elements.dtTransportDate.value || currentDateInputValue(),
        priority: elements.dtPriority.value || "Normal",
        orderReference: elements.dtOrderReference.value.trim(),
        pickupLocation: elements.dtPickupLocation.value.trim(),
        deliveryLocation: elements.dtDeliveryLocation.value.trim(),
        pickupContact: elements.dtPickupContact.value.trim(),
        pickupPhone: elements.dtPickupPhone.value.trim(),
        deliveryContact: elements.dtDeliveryContact.value.trim(),
        deliveryPhone: elements.dtDeliveryPhone.value.trim(),
        goodsDetails: elements.dtGoodsDetails.value.trim(),
        transportVendor: elements.dtTransportVendor.value.trim(),
        driverName: elements.dtDriverName.value.trim(),
        driverPhone: elements.dtDriverPhone.value.trim(),
        vehicleNumber: elements.dtVehicleNumber.value.trim(),
        vendorAcknowledgement: elements.dtVendorAcknowledgement.value.trim(),
        authorizedBy: elements.dtAuthorizedBy.value.trim(),
        requesterSignature: elements.dtRequesterSignature.value.trim(),
        approverSignature: elements.dtApproverSignature.value.trim(),
        remarks: elements.dtRemarks.value.trim(),
        items: collectDeliveryTicketItems()
    });
}

function deliveryTicketCurrentUserEmail() {
    const workspace = window.PMProjectsAuth.currentWorkspace?.() || {};
    return String(workspace.user_email || "").trim().toLowerCase();
}

function deliveryTicketCurrentUserSignature() {
    const label = window.PMProjectsAuth.userLabel?.() || deliveryTicketCurrentUserEmail();
    return String(label || "").trim();
}

function canInitiateDeliveryTickets() {
    return hasWorkspacePermission("can_create_delivery_ticket", false);
}

function canApproveDeliveryTickets() {
    return hasWorkspacePermission("can_approve_delivery_ticket", false);
}

function canGenerateDeliveryTicketPDF() {
    return hasWorkspacePermission("can_generate_delivery_ticket_pdf", false);
}

function deliveryTicketApprovalStatus(record) {
    const status = String(record?.approvalStatus || "draft").trim().toLowerCase();
    return ["draft", "submitted", "approved", "rejected"].includes(status) ? status : "draft";
}

function deliveryTicketApprovalLabel(record) {
    switch (deliveryTicketApprovalStatus(record)) {
        case "submitted": return "Submitted";
        case "approved": return "Approved";
        case "rejected": return "Rejected";
        default: return "Draft";
    }
}

function updateDeliveryTicketApprovalControls(record = selectedDeliveryTicket()) {
    if (!elements.deliveryTicketGenerateButton) return;
    const normalized = record ? normalizeDeliveryTicketRecord(record) : null;
    const status = deliveryTicketApprovalStatus(normalized);
    const canInitiate = canInitiateDeliveryTickets();
    const canApprove = canApproveDeliveryTickets();
    const canGenerate = canGenerateDeliveryTicketPDF();
    const isApproved = status === "approved";
    const isSubmitted = status === "submitted";
    const isDraftLike = status === "draft" || status === "rejected";

    elements.deliveryTicketSaveButton.disabled = !canInitiate && !canApprove;
    elements.deliveryTicketNewButton.disabled = !canInitiate && !canApprove;
    elements.deliveryTicketNewSmallButton.disabled = !canInitiate && !canApprove;
    elements.deliveryTicketDeleteButton.disabled = !state.selectedDeliveryTicketId || (!canInitiate && !canApprove);
    elements.deliveryTicketAddItemButton.disabled = !canInitiate && !canApprove;
    elements.deliveryTicketSubmitButton.hidden = !canInitiate;
    elements.deliveryTicketSubmitButton.disabled = !normalized || !isDraftLike;
    elements.deliveryTicketApproveButton.hidden = !canApprove;
    elements.deliveryTicketRejectButton.hidden = !canApprove;
    elements.deliveryTicketApproveButton.disabled = !normalized || !isSubmitted;
    elements.deliveryTicketRejectButton.disabled = !normalized || !isSubmitted;
    elements.deliveryTicketGenerateButton.disabled = !normalized || !isApproved || !canGenerate;
    elements.deliveryTicketGenerateButton.title = !isApproved
        ? "Approval required before PDF generation"
        : (canGenerate ? "Generate PDF" : "This user cannot generate delivery ticket PDFs");

    if (elements.deliveryTicketApprovalBanner) {
        elements.deliveryTicketApprovalBanner.dataset.status = status;
        if (!normalized) {
            elements.deliveryTicketApprovalBanner.textContent = "No delivery ticket selected.";
        } else {
            const details = [];
            if (normalized.initiatedBy && normalized.initiatedAt) {
                details.push(`submitted by ${normalized.initiatedBy} on ${formatDate(normalized.initiatedAt)}`);
            }
            if (normalized.approvedBy && normalized.approvedAt) {
                details.push(`approved by ${normalized.approvedBy} on ${formatDate(normalized.approvedAt)}`);
            }
            if (normalized.rejectedBy && normalized.rejectedAt) {
                details.push(`rejected by ${normalized.rejectedBy} on ${formatDate(normalized.rejectedAt)}`);
            }
            if (normalized.approvalComment) {
                details.push(normalized.approvalComment);
            }
            elements.deliveryTicketApprovalBanner.textContent = `Approval: ${deliveryTicketApprovalLabel(normalized)}${details.length ? ` - ${details.join(" - ")}` : ""}`;
        }
    }
}

function updateSelectedDeliveryTicket(record, message) {
    const normalized = normalizeDeliveryTicketRecord({
        ...record,
        updatedAt: new Date().toISOString()
    });
    const index = state.deliveryTickets.findIndex(item => item.id === normalized.id);
    if (index >= 0) {
        state.deliveryTickets.splice(index, 1, normalized);
    } else {
        state.deliveryTickets.unshift(normalized);
    }
    if (state.deliveryTicketDraft?.id === normalized.id) {
        state.deliveryTicketDraft = null;
    }
    state.selectedDeliveryTicketId = normalized.id;
    saveDeliveryTicketRecords();
    applyDeliveryTicketForm(normalized);
    renderDeliveryTicketRecordList();
    setDeliveryTicketStatus(message);
    pushDeliveryTicketToSupabase(normalized, false);
    return normalized;
}

function submitDeliveryTicketForApproval() {
    if (!canInitiateDeliveryTickets()) {
        setDeliveryTicketStatus("This user cannot submit delivery tickets.");
        return;
    }
    const now = new Date().toISOString();
    const user = deliveryTicketCurrentUserEmail() || window.PMProjectsAuth.userLabel?.() || "local user";
    const record = {
        ...collectDeliveryTicketForm(),
        approvalStatus: "submitted",
        initiatedBy: user,
        initiatedAt: now,
        requesterSignature: collectDeliveryTicketForm().requesterSignature || deliveryTicketCurrentUserSignature(),
        approvedBy: "",
        approvedAt: "",
        rejectedBy: "",
        rejectedAt: "",
        approvalComment: ""
    };
    updateSelectedDeliveryTicket(record, "Delivery ticket submitted for approval.");
}

function approveDeliveryTicket() {
    if (!canApproveDeliveryTickets()) {
        setDeliveryTicketStatus("This user cannot approve delivery tickets.");
        return;
    }
    const now = new Date().toISOString();
    const user = deliveryTicketCurrentUserEmail() || window.PMProjectsAuth.userLabel?.() || "local approver";
    const record = {
        ...collectDeliveryTicketForm(),
        approvalStatus: "approved",
        approvedBy: user,
        approvedAt: now,
        approverSignature: collectDeliveryTicketForm().approverSignature || deliveryTicketCurrentUserSignature(),
        rejectedBy: "",
        rejectedAt: "",
        approvalComment: ""
    };
    updateSelectedDeliveryTicket(record, "Delivery ticket approved. PDF generation is enabled.");
}

function rejectDeliveryTicket() {
    if (!canApproveDeliveryTickets()) {
        setDeliveryTicketStatus("This user cannot reject delivery tickets.");
        return;
    }
    const comment = window.prompt("Rejection comment", "") || "";
    const now = new Date().toISOString();
    const user = deliveryTicketCurrentUserEmail() || window.PMProjectsAuth.userLabel?.() || "local approver";
    const record = {
        ...collectDeliveryTicketForm(),
        approvalStatus: "rejected",
        rejectedBy: user,
        rejectedAt: now,
        approvedBy: "",
        approvedAt: "",
        approvalComment: comment.trim()
    };
    updateSelectedDeliveryTicket(record, "Delivery ticket rejected.");
}

function collectDeliveryTicketItems() {
    const rows = [...elements.deliveryTicketItemsBody.querySelectorAll("tr")];
    const items = rows.map((row, index) => {
        const field = name => row.querySelector(`[data-field='${name}']`)?.value.trim() || "";
        return {
            itemNumber: index + 1,
            description: field("description"),
            quantity: field("quantity"),
            uom: field("uom") || "Each",
            remarks: field("remarks")
        };
    }).filter(item => item.description || item.quantity || item.remarks);
    return items.length ? items : [makeDeliveryTicketItem(1)];
}

function createNewDeliveryTicket() {
    if (!canInitiateDeliveryTickets() && !canApproveDeliveryTickets()) {
        setDeliveryTicketStatus("This user cannot create delivery tickets.");
        return;
    }
    const record = makeDeliveryTicketRecord();
    state.deliveryTicketDraft = record;
    state.selectedDeliveryTicketId = record.id;
    applyDeliveryTicketForm(record);
    renderDeliveryTicketRecordList();
    updateDeliveryTicketApprovalControls(record);
    setDeliveryTicketStatus("New delivery ticket ready. Click Save to add it to Saved Tickets.");
}

function saveDeliveryTicketFromForm(showStatus = false) {
    if (!canInitiateDeliveryTickets() && !canApproveDeliveryTickets()) {
        setDeliveryTicketStatus("This user cannot save delivery tickets.");
        return selectedDeliveryTicket() || makeDeliveryTicketRecord();
    }
    const record = {
        ...collectDeliveryTicketForm(),
        updatedAt: new Date().toISOString()
    };
    const index = state.deliveryTickets.findIndex(item => item.id === record.id);
    if (index >= 0) {
        state.deliveryTickets.splice(index, 1, record);
    } else {
        state.deliveryTickets.unshift(record);
    }
    if (state.deliveryTicketDraft?.id === record.id) {
        state.deliveryTicketDraft = null;
    }
    state.selectedDeliveryTicketId = record.id;
    saveDeliveryTicketRecords();
    renderDeliveryTicketRecordList();
    updateDeliveryTicketApprovalControls(record);
    if (showStatus) setDeliveryTicketStatus("Delivery ticket saved.");
    pushDeliveryTicketToSupabase(record, showStatus);
    return record;
}

function deleteSelectedDeliveryTicket() {
    if (!state.selectedDeliveryTicketId) return;
    if (!canInitiateDeliveryTickets() && !canApproveDeliveryTickets()) {
        setDeliveryTicketStatus("This user cannot delete delivery tickets.");
        return;
    }
    const deletedID = state.selectedDeliveryTicketId;
    if (state.deliveryTicketDraft?.id === deletedID) {
        state.deliveryTicketDraft = null;
    }
    state.deliveryTickets = state.deliveryTickets.filter(record => record.id !== state.selectedDeliveryTicketId);
    state.selectedDeliveryTicketId = null;
    ensureSelectedDeliveryTicket();
    saveDeliveryTicketRecords();
    renderDeliveryTicketRecordList();
    applyDeliveryTicketForm(selectedDeliveryTicket());
    setDeliveryTicketStatus("Delivery ticket deleted.");
    deleteDeliveryTicketFromSupabase(deletedID);
}

function generateDeliveryTicketPDF() {
    const record = saveDeliveryTicketFromForm(false);
    if (deliveryTicketApprovalStatus(record) !== "approved") {
        setDeliveryTicketStatus("Delivery ticket must be approved before PDF generation.");
        return;
    }
    if (!canGenerateDeliveryTicketPDF()) {
        setDeliveryTicketStatus("This user cannot generate delivery ticket PDFs.");
        return;
    }
    const html = deliveryTicketPrintableHTML(record);
    const printWindow = window.open("", "_blank", "width=980,height=760");
    if (!printWindow) {
        setDeliveryTicketStatus("Popup blocked. Allow popups to generate Delivery Ticket PDF.");
        return;
    }
    printWindow.document.open();
    printWindow.document.write(html);
    printWindow.document.close();
    setDeliveryTicketStatus(`Opened PDF preview: ${record.ticketNumber}`);
}

function deliveryTicketPrintableHTML(record) {
    const assetBaseURL = new URL("./", window.location.href).href;
    const logoURL = new URL("sri-energy-logo.jpg", assetBaseURL).href;
    const rows = record.items.map((item, index) => `
        <tr>
            <td class="center bold">${index + 1}</td>
            <td>${escapeHTML(item.description || "-")}</td>
            <td class="center">${escapeHTML(item.quantity || "-")}</td>
            <td class="center">${escapeHTML((item.uom || "Each").toUpperCase())}</td>
            <td>${escapeHTML(item.remarks || "-")}</td>
        </tr>
    `).join("");

    return `<!doctype html>
<html>
<head>
    <meta charset="utf-8">
    <title></title>
    <style>
        @page { size: A4 portrait; margin: 10mm; }
        * { -webkit-print-color-adjust: exact; print-color-adjust: exact; box-sizing: border-box; }
        html, body { width: 100%; min-height: 0; overflow: visible; }
        body { margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif; color: #000; font-size: 8.4pt; }
        .document { width: 100%; max-width: 190mm; margin: 0 auto; display: block; overflow: visible; }
        .document-header { height: 38px; display: grid; grid-template-columns: 185px 1fr; align-items: center; gap: 12px; }
        .logo { width: 170px; height: 34px; object-fit: contain; object-position: left center; }
        .title { color: #c70816; text-align: right; font-size: 25pt; font-weight: 850; line-height: 1; }
        table { width: 100%; border-collapse: collapse; table-layout: fixed; }
        th, td { border: 1px solid #b7b7b7; padding: 5px 6px; vertical-align: top; }
        th { background: #d9d9d9 !important; font-weight: 850; }
        .company-table { margin-top: 3px; }
        .company-title { background: #d9d9d9 !important; font-weight: 850; }
        .company-address { font-weight: 750; line-height: 1.14; }
        .email { color: #1267c4; font-weight: 850; text-align: center; }
        .section-table { margin-top: 12px; }
        .section-table td { height: 42px; white-space: pre-line; font-weight: 750; }
        .reference-table { margin-top: 12px; }
        .reference-table td { height: 32px; text-align: center; vertical-align: middle; font-weight: 800; }
        .items-table { margin-top: 14px; }
        .items-table th:nth-child(1), .items-table td:nth-child(1) { width: 48px; }
        .items-table th:nth-child(3), .items-table td:nth-child(3) { width: 76px; }
        .items-table th:nth-child(4), .items-table td:nth-child(4) { width: 82px; }
        .items-table th:nth-child(5), .items-table td:nth-child(5) { width: 180px; }
        .items-table td { min-height: 28px; }
        .footer { margin-top: 18mm; break-inside: avoid; page-break-inside: avoid; }
        .footer td { height: 20px; }
        .signature td { height: 52px; text-align: center; font-size: 9pt; font-weight: 850; }
        .page-label { margin-top: 6px; text-align: right; font-size: 8pt; font-weight: 800; break-before: avoid; page-break-before: avoid; }
        .center { text-align: center; }
        .bold { font-weight: 850; }
        .red { color: #c70816; font-weight: 850; }
    </style>
</head>
<body>
    <main class="document">
        <div class="document-header">
            <img class="logo" src="${escapeHTML(logoURL)}" alt="SRI Energy">
            <div class="title">Delivery Ticket</div>
        </div>
        <table class="company-table">
            <colgroup><col style="width:54%"><col style="width:15%"><col style="width:23%"><col style="width:8%"></colgroup>
            <tbody>
                <tr>
                    <td class="company-title">SRI ENERGY COMPANY LIMITED</td>
                    <th>Date</th>
                    <th>Delivery Ticket #</th>
                    <th>Priority</th>
                </tr>
                <tr>
                    <td class="company-address">Building No. 2529, Al Dammam 893 Street<br>2nd Industrial City Dammam<br>Kingdom of Saudi Arabia <span class="email">Email<br>kaziz@srienergy.com</span></td>
                    <td class="center bold">${escapeHTML(formatDate(record.issueDate))}</td>
                    <td class="center red">${escapeHTML(record.ticketNumber)}</td>
                    <td class="center bold">${escapeHTML(record.priority || "Normal")}</td>
                </tr>
            </tbody>
        </table>
        <table class="section-table">
            <colgroup><col style="width:50%"><col style="width:50%"></colgroup>
            <thead><tr><th>Pickup Location</th><th>Delivery Location</th></tr></thead>
            <tbody><tr><td>${escapeHTML(record.pickupLocation || "-")}</td><td>${escapeHTML(record.deliveryLocation || "-")}</td></tr></tbody>
        </table>
        <table class="reference-table">
            <colgroup><col style="width:25%"><col style="width:25%"><col style="width:25%"><col style="width:25%"></colgroup>
            <thead><tr><th>Order Reference</th><th>Transport Needed</th><th>Vendor</th><th>Vehicle / Driver</th></tr></thead>
            <tbody><tr><td>${escapeHTML(record.orderReference || "-")}</td><td>${escapeHTML(formatDate(record.requiredTransportDate))}</td><td>${escapeHTML(record.transportVendor || "-")}</td><td>${escapeHTML(compactJoin([record.vehicleNumber, record.driverName], " / ") || "-")}</td></tr></tbody>
        </table>
        <table class="items-table">
            <thead><tr><th>Item</th><th>Description</th><th>Qty</th><th>UOM</th><th>Remarks</th></tr></thead>
            <tbody>${rows || `<tr><td colspan="5">No items entered.</td></tr>`}</tbody>
        </table>
        <table class="footer">
            <tbody>
                <tr><td colspan="2" style="text-align:right;font-weight:850;">Please forward any discrepancies to kaziz@srienergy.com</td></tr>
                <tr><td colspan="2"><strong>Notes:</strong> ${escapeHTML(record.remarks || "-")}</td></tr>
                <tr class="signature">
                    <td>Requester / Customer Signatory<br>${escapeHTML(record.requesterSignature || "")}</td>
                    <td>Authorized Signatory<br>${escapeHTML(record.approverSignature || record.authorizedBy || "")}</td>
                </tr>
            </tbody>
        </table>
        <div class="page-label">Page 1 of 1</div>
    </main>
    <script>
        function waitForImages() {
            var images = Array.prototype.slice.call(document.images || []);
            return Promise.all(images.map(function (image) {
                if (image.complete && image.naturalWidth > 0) return Promise.resolve();
                return new Promise(function (resolve) {
                    image.addEventListener("load", resolve, { once: true });
                    image.addEventListener("error", resolve, { once: true });
                });
            }));
        }
        window.addEventListener("load", function () {
            waitForImages().then(function () { window.print(); });
        });
    </script>
</body>
</html>`;
}

function makeDeliveryTicketRecord() {
    const now = new Date().toISOString();
    return normalizeDeliveryTicketRecord({
        id: deliveryTicketIdentifier(),
        ticketNumber: nextDeliveryTicketNumber(),
        issueDate: currentDateInputValue(),
        requiredTransportDate: currentDateInputValue(),
        priority: "Normal",
        items: [makeDeliveryTicketItem(1)],
        createdAt: now,
        updatedAt: now
    });
}

function makeDeliveryTicketItem(itemNumber) {
    return { itemNumber, description: "", quantity: "", uom: "Each", remarks: "" };
}

function normalizeDeliveryTicketRecord(record) {
    const source = record || {};
    return {
        id: source.id || deliveryTicketIdentifier(),
        ticketNumber: source.ticketNumber || nextDeliveryTicketNumber(),
        issueDate: source.issueDate || currentDateInputValue(),
        requiredTransportDate: source.requiredTransportDate || currentDateInputValue(),
        priority: source.priority || "Normal",
        orderReference: source.orderReference || "",
        pickupLocation: source.pickupLocation || "",
        deliveryLocation: source.deliveryLocation || "",
        pickupContact: source.pickupContact || "",
        pickupPhone: source.pickupPhone || "",
        deliveryContact: source.deliveryContact || "",
        deliveryPhone: source.deliveryPhone || "",
        goodsDetails: source.goodsDetails || "",
        transportVendor: source.transportVendor || "",
        driverName: source.driverName || "",
        driverPhone: source.driverPhone || "",
        vehicleNumber: source.vehicleNumber || "",
        vendorAcknowledgement: source.vendorAcknowledgement || "",
        authorizedBy: source.authorizedBy || "",
        requesterSignature: source.requesterSignature || "",
        approverSignature: source.approverSignature || "",
        remarks: source.remarks || "",
        items: Array.isArray(source.items) && source.items.length
            ? source.items.map((item, index) => ({ ...makeDeliveryTicketItem(index + 1), ...item, itemNumber: index + 1 }))
            : [makeDeliveryTicketItem(1)],
        approvalStatus: deliveryTicketApprovalStatus(source),
        initiatedBy: source.initiatedBy || "",
        initiatedAt: source.initiatedAt || "",
        approvedBy: source.approvedBy || "",
        approvedAt: source.approvedAt || "",
        rejectedBy: source.rejectedBy || "",
        rejectedAt: source.rejectedAt || "",
        approvalComment: source.approvalComment || "",
        createdAt: source.createdAt || new Date().toISOString(),
        updatedAt: source.updatedAt || new Date().toISOString()
    };
}

function nextDeliveryTicketNumber() {
    const year = new Date().getFullYear();
    const prefix = `DT-${year}-`;
    const usedNumbers = new Set([
        ...loadDeliveryTicketRecords().map(record => record.ticketNumber),
        state.deliveryTicketDraft?.ticketNumber || ""
    ].map(value => {
        const ticketNumber = String(value || "").trim();
        if (!ticketNumber.startsWith(prefix)) return null;
        const number = Number(ticketNumber.slice(prefix.length));
        return Number.isInteger(number) && number > 0 ? number : null;
    }).filter(Boolean));

    let counter = 1;
    while (usedNumbers.has(counter)) {
        counter += 1;
    }
    return `${prefix}${String(counter).padStart(4, "0")}`;
}

function loadDeliveryTicketRecords() {
    try {
        const records = JSON.parse(localStorage.getItem(DELIVERY_TICKET_RECORDS_KEY)) || [];
        return Array.isArray(records) ? records.map(normalizeDeliveryTicketRecord) : [];
    } catch {
        return [];
    }
}

function saveDeliveryTicketRecords() {
    localStorage.setItem(DELIVERY_TICKET_RECORDS_KEY, JSON.stringify(state.deliveryTickets.map(normalizeDeliveryTicketRecord)));
}

function mergeFetchedDeliveryTickets(remoteRecords) {
    const localByID = new Map(state.deliveryTickets.map(record => [record.id, normalizeDeliveryTicketRecord(record)]));
    const merged = remoteRecords.map(remoteRecord => {
        const localRecord = localByID.get(remoteRecord.id);
        if (!localRecord) return remoteRecord;
        const localUpdated = Date.parse(localRecord.updatedAt || "");
        const remoteUpdated = Date.parse(remoteRecord.updatedAt || "");
        if (!Number.isNaN(localUpdated) && !Number.isNaN(remoteUpdated) && localUpdated > remoteUpdated) {
            pushDeliveryTicketToSupabase(localRecord, false);
            return localRecord;
        }
        return remoteRecord;
    });

    remoteRecords.forEach(record => localByID.delete(record.id));
    localByID.forEach(record => {
        merged.push(record);
        pushDeliveryTicketToSupabase(record, false);
    });

    return merged.sort((left, right) => String(right.updatedAt || "").localeCompare(String(left.updatedAt || "")));
}

function pushDeliveryTicketToSupabase(record, showStatus = false) {
    if (!isConfigured()) return Promise.resolve();
    state.deliveryTicketPushQueue = state.deliveryTicketPushQueue
        .catch(() => {})
        .then(() => supabaseUpsert("delivery_tickets_normalized", [deliveryTicketToSupabase(record)]))
        .then(() => {
            if (showStatus) setDeliveryTicketStatus("Delivery ticket saved and synced.");
        })
        .catch(error => {
            console.error("Delivery ticket sync failed", error);
            setDeliveryTicketStatus(`Delivery ticket saved locally, but sync failed: ${error.message}`);
        });
    return state.deliveryTicketPushQueue;
}

function deleteDeliveryTicketFromSupabase(id) {
    if (!isConfigured() || !id) return;
    supabaseDeleteByID("delivery_tickets_normalized", id)
        .catch(error => {
            console.error("Delivery ticket delete sync failed", error);
            setDeliveryTicketStatus(`Delivery ticket deleted locally, but remote delete failed: ${error.message}`);
        });
}

function deliveryTicketFromSupabase(row) {
    return normalizeDeliveryTicketRecord({
        id: row.id,
        ticketNumber: row.ticket_number,
        issueDate: dateValueToInput(row.issue_date),
        requiredTransportDate: dateValueToInput(row.required_transport_date),
        priority: row.priority,
        orderReference: row.order_reference,
        pickupLocation: row.pickup_location,
        deliveryLocation: row.delivery_location,
        pickupContact: row.pickup_contact_name,
        pickupPhone: row.pickup_contact_phone,
        deliveryContact: row.delivery_contact_name,
        deliveryPhone: row.delivery_contact_phone,
        goodsDetails: row.goods_details,
        transportVendor: row.transport_vendor,
        driverName: row.driver_name,
        driverPhone: row.driver_phone,
        vehicleNumber: row.vehicle_number,
        vendorAcknowledgement: row.vendor_acknowledgement,
        authorizedBy: row.authorized_by,
        requesterSignature: row.requester_signature,
        approverSignature: row.approver_signature,
        remarks: row.remarks,
        items: Array.isArray(row.items) ? row.items : [],
        approvalStatus: row.approval_status,
        initiatedBy: row.initiated_by,
        initiatedAt: row.initiated_at,
        approvedBy: row.approved_by,
        approvedAt: row.approved_at,
        rejectedBy: row.rejected_by,
        rejectedAt: row.rejected_at,
        approvalComment: row.approval_comment,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    });
}

function deliveryTicketToSupabase(record) {
    const normalized = normalizeDeliveryTicketRecord(record);
    return {
        id: normalized.id,
        workspace_id: state.config.workspaceId,
        ticket_number: normalized.ticketNumber,
        issue_date: dateInputToISOString(normalized.issueDate),
        required_transport_date: dateInputToISOString(normalized.requiredTransportDate),
        priority: normalized.priority || "Normal",
        order_reference: normalized.orderReference || "",
        pickup_location: normalized.pickupLocation || "",
        delivery_location: normalized.deliveryLocation || "",
        pickup_contact_name: normalized.pickupContact || "",
        pickup_contact_phone: normalized.pickupPhone || "",
        delivery_contact_name: normalized.deliveryContact || "",
        delivery_contact_phone: normalized.deliveryPhone || "",
        goods_details: normalized.goodsDetails || "",
        transport_vendor: normalized.transportVendor || "",
        driver_name: normalized.driverName || "",
        driver_phone: normalized.driverPhone || "",
        vehicle_number: normalized.vehicleNumber || "",
        vendor_acknowledgement: normalized.vendorAcknowledgement || "",
        authorized_by: normalized.authorizedBy || "",
        requester_signature: normalized.requesterSignature || "",
        approver_signature: normalized.approverSignature || "",
        remarks: normalized.remarks || "",
        items: normalized.items || [],
        approval_status: deliveryTicketApprovalStatus(normalized),
        initiated_by: normalized.initiatedBy || null,
        initiated_at: normalized.initiatedAt || null,
        approved_by: normalized.approvedBy || null,
        approved_at: normalized.approvedAt || null,
        rejected_by: normalized.rejectedBy || null,
        rejected_at: normalized.rejectedAt || null,
        approval_comment: normalized.approvalComment || "",
        created_at: normalized.createdAt || new Date().toISOString(),
        updated_at: normalized.updatedAt || new Date().toISOString()
    };
}

function setDeliveryTicketStatus(message) {
    elements.deliveryTicketStatus.textContent = message || "";
}

function currentDateInputValue() {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function dateValueToInput(value) {
    if (!value) return currentDateInputValue();
    if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return currentDateInputValue();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
}

function dateInputToISOString(value) {
    const input = dateValueToInput(value);
    return new Date(`${input}T00:00:00.000Z`).toISOString();
}

function escapeAttribute(value) {
    return escapeHTML(value).replaceAll("\n", "&#10;");
}

function deliveryTicketIdentifier() {
    return globalThis.crypto?.randomUUID?.() || `dt-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function openProjectWorkspace(projectId) {
    state.selectedProjectId = projectId;
    window.location.href = `task.html?id=${encodeURIComponent(projectId)}`;
}

function filteredEquipment() {
    return visibleEquipmentRows().filter(item => {
        if (!state.filters.search) return true;
        const haystack = [
            item.serial_number,
            item.part_number,
            item.size,
            item.rwp,
            item.category,
            item.model,
            item.rig_number,
            item.manifold_number,
            item.sawcm_edition,
            item.cycle,
            item.customer,
            item.arf,
            item.sri_ref,
            item.customer_po_number,
            item.arf_ref
        ].join(" ").toLowerCase();
        return haystack.includes(state.filters.search);
    });
}

function visibleEquipmentRows() {
    if (!hasProjectDataScope()) {
        return state.equipment;
    }

    const visibleProjectIds = new Set(visibleBaseProjects().map(project => project.id));
    const linkedEquipmentIds = new Set();
    const serials = new Set();

    state.projects.forEach(project => {
        if (!visibleProjectIds.has(project.id)) return;
        if (project.linked_equipment_id) linkedEquipmentIds.add(project.linked_equipment_id);
        const normalized = normalizeSerial(project.serial_number);
        if (normalized) serials.add(normalized);
    });
    state.tasks.forEach(task => {
        if (!visibleProjectIds.has(task.project_id)) return;
        if (task.linked_equipment_id) linkedEquipmentIds.add(task.linked_equipment_id);
        taskSerialTokens(task).map(normalizeSerial).filter(Boolean).forEach(serial => serials.add(serial));
    });

    return state.equipment.filter(item => (
        linkedEquipmentIds.has(item.id)
        || serials.has(normalizeSerial(item.serial_number))
        || itemMatchesEquipmentScope(item)
    ));
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
    return state.projects.filter(project => !HIDDEN_PROJECT_STATUSES.has(project.status) && projectMatchesDataScope(project));
}

function dashboardActiveProjects(projects) {
    return projects.filter(project => (
        project.status === "In-Progress"
        && !dashboardProjectHasDoneAncestor(project)
    ));
}

function dashboardProjectHasDoneAncestor(project) {
    const projectsById = new Map(state.projects.map(item => [item.id, item]));
    let parentId = project.parent_project_id;
    const visited = new Set();

    while (parentId && !visited.has(parentId)) {
        visited.add(parentId);
        const parent = projectsById.get(parentId);
        if (!parent) return false;
        if (parent.status === "Done") return true;
        parentId = parent.parent_project_id;
    }

    return false;
}

function customerDistribution(projects) {
    const counts = new Map();
    projects.forEach(project => {
        const customer = String(project.customer || "Unassigned").trim() || "Unassigned";
        counts.set(customer, (counts.get(customer) || 0) + 1);
    });

    const rows = [...counts.entries()]
        .map(([label, count]) => ({ label, count }))
        .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label));
    const visible = rows.slice(0, 5);
    const other = rows.slice(5).reduce((sum, row) => sum + row.count, 0);
    if (other > 0) {
        visible.push({ label: "Other", count: other });
    }
    return visible;
}

function dashboardDonutGradient(slices, total) {
    let cursor = 0;
    const segments = slices.map((slice, index) => {
        const start = cursor;
        const size = total > 0 ? (slice.count / total) * 360 : 0;
        cursor += size;
        const color = dashboardCustomerColor(slice.label, index);
        return `${color} ${start.toFixed(2)}deg ${cursor.toFixed(2)}deg`;
    });
    return segments.join(", ");
}

function dashboardCustomerColor(customer, index = 0) {
    const key = String(customer || "").trim().toUpperCase();
    return DASHBOARD_CUSTOMER_COLORS.get(key) || DASHBOARD_COLORS[index % DASHBOARD_COLORS.length];
}

function equipmentFocusRows() {
    const groups = new Map();
    state.equipment.forEach(item => {
        const category = String(item.category || "Unassigned").trim() || "Unassigned";
        const key = category.toUpperCase();
        const existing = groups.get(key) || { label: category, count: 0, sizes: new Set(), rwps: new Set() };
        existing.count += 1;
        if (item.size) existing.sizes.add(item.size);
        if (item.rwp) existing.rwps.add(item.rwp);
        groups.set(key, existing);
    });

    return [...groups.values()]
        .sort((left, right) => right.count - left.count || left.label.localeCompare(right.label))
        .slice(0, 8)
        .map(row => ({
            label: row.label,
            count: row.count,
            detail: `${row.sizes.size || 0} sizes . ${row.rwps.size || 0} RWP ratings`
        }));
}

function emptyDashboardMessage(message) {
    const item = document.createElement("div");
    item.className = "dashboard-empty";
    item.textContent = message;
    return item;
}

function escapeHTML(value) {
    return String(value || "")
        .replaceAll("&", "&amp;")
        .replaceAll("<", "&lt;")
        .replaceAll(">", "&gt;")
        .replaceAll('"', "&quot;")
        .replaceAll("'", "&#039;");
}

function projectMatchesArfScope(project) {
    return projectMatchesDataScope(project);
}

function projectMatchesDataScope(project) {
    const arfScope = currentArfScopeValues();
    const customerScope = currentCustomerScopeValues();
    const projectScope = currentProjectScopeValues();

    if (arfScope.length && !scopeIncludes(arfScope, project.arf)) return false;
    if (customerScope.length && !scopeIncludes(customerScope, project.customer)) return false;
    if (projectScope.length && ![
        project.name,
        project.po_number,
        project.so_number,
        project.arf_ref,
        project.serial_number
    ].some(value => scopeIncludes(projectScope, value))) return false;

    return true;
}

function itemMatchesEquipmentScope(item) {
    const arfScope = currentArfScopeValues();
    const customerScope = currentCustomerScopeValues();
    const projectScope = currentProjectScopeValues();

    if (arfScope.length && !scopeIncludes(arfScope, item.arf)) return false;
    if (customerScope.length && !scopeIncludes(customerScope, item.customer)) return false;
    if (projectScope.length && ![
        item.serial_number,
        item.sri_ref,
        item.customer_po_number,
        item.arf_ref
    ].some(value => scopeIncludes(projectScope, value))) return false;

    return true;
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
    const scope = workspace?.arf_scope || "";
    const label = workspace?.workspaces?.name || workspace?.workspace_id || "Workspace";
    return scope ? `${label} · ${scope}` : label;
}

function currentArfScope() {
    return currentArfScopeValues()[0] || "";
}

function currentArfScopeValues() {
    const workspace = window.PMProjectsAuth.currentWorkspace?.() || {};
    return parseScopeValues(workspace.arf_scope || state.config?.arfScope || "");
}

function currentCustomerScopeValues() {
    const workspace = window.PMProjectsAuth.currentWorkspace?.() || {};
    return parseScopeValues(workspace.customer_scope || "");
}

function currentProjectScopeValues() {
    const workspace = window.PMProjectsAuth.currentWorkspace?.() || {};
    return parseScopeValues(workspace.project_scope || "");
}

function hasProjectDataScope() {
    return currentArfScopeValues().length > 0
        || currentCustomerScopeValues().length > 0
        || currentProjectScopeValues().length > 0;
}

function parseScopeValues(value) {
    return String(value || "")
        .split(",")
        .map(item => item.trim().toUpperCase())
        .filter(Boolean);
}

function scopeIncludes(scopeValues, value) {
    return scopeValues.includes(String(value || "").trim().toUpperCase());
}

function currentScopeLabel() {
    const parts = [];
    const arf = currentArfScopeValues();
    const customer = currentCustomerScopeValues();
    const project = currentProjectScopeValues();
    if (arf.length) parts.push(`ARF ${arf.join(", ")}`);
    if (customer.length) parts.push(`Customer ${customer.join(", ")}`);
    if (project.length) parts.push(`Project ${project.join(", ")}`);
    return parts.join(" • ");
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
        state.projects = (cached.projects || []).filter(projectMatchesArfScope);
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

function initialiseResizableProjectColumns() {
    const table = elements.projectsTable;
    if (!table) return;

    const headers = [...table.querySelectorAll("thead th")];
    const savedWidths = loadProjectColumnWidths();
    headers.forEach((header, index) => {
        const width = savedWidths[index];
        if (width) {
            setProjectColumnWidth(index, width);
        }

        const handle = document.createElement("span");
        handle.className = "column-resize-handle";
        handle.addEventListener("mousedown", event => beginProjectColumnResize(event, index, header));
        header.appendChild(handle);
    });
    updateProjectTableWidth();
}

function initialiseResizableDashboardProgressColumns() {
    const table = elements.dashboardProgressTable;
    if (!table) return;

    const headers = [...table.querySelectorAll("thead th")];
    const savedWidths = loadDashboardProgressColumnWidths();
    headers.forEach((header, index) => {
        const width = savedWidths[index];
        if (width) {
            setDashboardProgressColumnWidth(index, width);
        }

        const handle = document.createElement("span");
        handle.className = "column-resize-handle";
        handle.addEventListener("mousedown", event => beginDashboardProgressColumnResize(event, index, header));
        header.appendChild(handle);
    });
    updateDashboardProgressTableWidth();
}

function initialiseDashboardProgressScrolling() {
    const scroll = elements.dashboardProgressScroll;
    if (!scroll) return;

    let isDragging = false;
    let startX = 0;
    let startScrollLeft = 0;

    scroll.addEventListener("mousedown", event => {
        if (event.target.closest(".column-resize-handle")) return;
        isDragging = true;
        startX = event.clientX;
        startScrollLeft = scroll.scrollLeft;
        scroll.classList.add("is-dragging");
    });

    document.addEventListener("mousemove", event => {
        if (!isDragging) return;
        scroll.scrollLeft = startScrollLeft - (event.clientX - startX);
    });

    document.addEventListener("mouseup", () => {
        if (!isDragging) return;
        isDragging = false;
        scroll.classList.remove("is-dragging");
    });
}

function scrollDashboardProgressBy(delta) {
    elements.dashboardProgressScroll?.scrollBy({
        left: delta,
        behavior: "smooth"
    });
}

function beginDashboardProgressColumnResize(event, index, header) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = header.getBoundingClientRect().width;

    const onMove = moveEvent => {
        const nextWidth = Math.max(70, Math.round(startWidth + moveEvent.clientX - startX));
        setDashboardProgressColumnWidth(index, nextWidth);
        updateDashboardProgressTableWidth();
    };

    const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        saveDashboardProgressColumnWidths();
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
}

function setDashboardProgressColumnWidth(index, width) {
    const columnIndex = index + 1;
    const cells = elements.dashboardProgressTable.querySelectorAll(
        `thead th:nth-child(${columnIndex}), tbody tr:not(.empty-row) td:nth-child(${columnIndex})`
    );
    cells.forEach(cell => {
        cell.style.width = `${width}px`;
        cell.style.minWidth = `${width}px`;
        cell.style.maxWidth = `${width}px`;
    });
}

function updateDashboardProgressTableWidth() {
    const headers = [...elements.dashboardProgressTable.querySelectorAll("thead th")];
    const totalWidth = headers.reduce((sum, header) => sum + Math.round(header.getBoundingClientRect().width), 0);
    if (totalWidth > 0) {
        elements.dashboardProgressTable.style.width = `${totalWidth}px`;
    }
}

function applyDashboardProgressColumnWidthsFromHeaders() {
    const headers = [...elements.dashboardProgressTable.querySelectorAll("thead th")];
    headers.forEach((header, index) => {
        const width = Math.round(header.getBoundingClientRect().width);
        if (width) {
            setDashboardProgressColumnWidth(index, width);
        }
    });
    updateDashboardProgressTableWidth();
}

function saveDashboardProgressColumnWidths() {
    const headers = [...elements.dashboardProgressTable.querySelectorAll("thead th")];
    const widths = headers.map(header => Math.round(header.getBoundingClientRect().width));
    try {
        localStorage.setItem(DASHBOARD_PROGRESS_COLUMN_WIDTHS_KEY, JSON.stringify(widths));
    } catch {
        // Column resizing still works for the current session.
    }
}

function loadDashboardProgressColumnWidths() {
    try {
        return JSON.parse(localStorage.getItem(DASHBOARD_PROGRESS_COLUMN_WIDTHS_KEY)) || [];
    } catch {
        return [];
    }
}

function initialiseResizableEquipmentColumns() {
    const table = elements.equipmentTable;
    if (!table) return;

    const headers = [...table.querySelectorAll("thead th")];
    const savedWidths = loadEquipmentColumnWidths();
    headers.forEach((header, index) => {
        const width = savedWidths[index];
        if (width) {
            setEquipmentColumnWidth(index, width);
        }

        const handle = document.createElement("span");
        handle.className = "column-resize-handle";
        handle.addEventListener("mousedown", event => beginEquipmentColumnResize(event, index, header));
        header.appendChild(handle);
    });
    updateEquipmentTableWidth();
}

function beginEquipmentColumnResize(event, index, header) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = header.getBoundingClientRect().width;

    const onMove = moveEvent => {
        const nextWidth = Math.max(70, Math.round(startWidth + moveEvent.clientX - startX));
        setEquipmentColumnWidth(index, nextWidth);
        updateEquipmentTableWidth();
    };

    const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        saveEquipmentColumnWidths();
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
}

function setEquipmentColumnWidth(index, width) {
    const columnIndex = index + 1;
    const cells = elements.equipmentTable.querySelectorAll(
        `thead th:nth-child(${columnIndex}), tbody tr:not(.empty-row) td:nth-child(${columnIndex})`
    );
    cells.forEach(cell => {
        cell.style.width = `${width}px`;
        cell.style.minWidth = `${width}px`;
        cell.style.maxWidth = `${width}px`;
    });
}

function updateEquipmentTableWidth() {
    const headers = [...elements.equipmentTable.querySelectorAll("thead th")];
    const totalWidth = headers.reduce((sum, header) => sum + Math.round(header.getBoundingClientRect().width), 0);
    if (totalWidth > 0) {
        elements.equipmentTable.style.width = `${totalWidth}px`;
    }
}

function applyEquipmentColumnWidthsFromHeaders() {
    const headers = [...elements.equipmentTable.querySelectorAll("thead th")];
    headers.forEach((header, index) => {
        const width = Math.round(header.getBoundingClientRect().width);
        if (width) {
            setEquipmentColumnWidth(index, width);
        }
    });
    updateEquipmentTableWidth();
}

function saveEquipmentColumnWidths() {
    const headers = [...elements.equipmentTable.querySelectorAll("thead th")];
    const widths = headers.map(header => Math.round(header.getBoundingClientRect().width));
    try {
        localStorage.setItem(EQUIPMENT_COLUMN_WIDTHS_KEY, JSON.stringify(widths));
    } catch {
        // Column resizing still works for the current session.
    }
}

function loadEquipmentColumnWidths() {
    try {
        return JSON.parse(localStorage.getItem(EQUIPMENT_COLUMN_WIDTHS_KEY)) || [];
    } catch {
        return [];
    }
}

function beginProjectColumnResize(event, index, header) {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = header.getBoundingClientRect().width;

    const onMove = moveEvent => {
        const nextWidth = Math.max(70, Math.round(startWidth + moveEvent.clientX - startX));
        setProjectColumnWidth(index, nextWidth);
        updateProjectTableWidth();
    };

    const onUp = () => {
        document.removeEventListener("mousemove", onMove);
        document.removeEventListener("mouseup", onUp);
        saveProjectColumnWidths();
    };

    document.addEventListener("mousemove", onMove);
    document.addEventListener("mouseup", onUp);
}

function setProjectColumnWidth(index, width) {
    const columnIndex = index + 1;
    const cells = elements.projectsTable.querySelectorAll(
        `thead th:nth-child(${columnIndex}), tbody tr:not(.group-row):not(.empty-row) td:nth-child(${columnIndex})`
    );
    cells.forEach(cell => {
        cell.style.width = `${width}px`;
        cell.style.minWidth = `${width}px`;
        cell.style.maxWidth = `${width}px`;
    });
}

function updateProjectTableWidth() {
    const headers = [...elements.projectsTable.querySelectorAll("thead th")];
    const totalWidth = headers.reduce((sum, header) => sum + Math.round(header.getBoundingClientRect().width), 0);
    if (totalWidth > 0) {
        elements.projectsTable.style.width = `${totalWidth}px`;
    }
}

function applyProjectColumnWidthsFromHeaders() {
    const headers = [...elements.projectsTable.querySelectorAll("thead th")];
    headers.forEach((header, index) => {
        const width = Math.round(header.getBoundingClientRect().width);
        if (width) {
            setProjectColumnWidth(index, width);
        }
    });
    updateProjectTableWidth();
}

function saveProjectColumnWidths() {
    const headers = [...elements.projectsTable.querySelectorAll("thead th")];
    const widths = headers.map(header => Math.round(header.getBoundingClientRect().width));
    try {
        localStorage.setItem(PROJECT_COLUMN_WIDTHS_KEY, JSON.stringify(widths));
    } catch {
        // Column resizing still works for the current session.
    }
}

function loadProjectColumnWidths() {
    try {
        return JSON.parse(localStorage.getItem(PROJECT_COLUMN_WIDTHS_KEY)) || [];
    } catch {
        return [];
    }
}
