# PMProjects Web Workspace

This is a lightweight browser version of the PMProjects workspace. The first version is intentionally focused on:

- Project Workspace in tabular form
- Task Workspace for the selected project

It reads the same normalized Supabase tables used by the Mac app:

- `workspace_sync_cursors`
- `projects_normalized`
- `project_custom_fields`
- `tasks_normalized`
- `task_custom_fields`

## Run Locally

Open `Web/index.html` in a browser.

Enter:

- Supabase project URL
- Supabase anon key
- Workspace ID, normally `primary`

The config is stored in browser `localStorage` on that computer.

## Egress Control

The web app checks `workspace_sync_cursors` first. It only downloads the project/task tables when:

- the cursor changed,
- the user presses `Refresh`, or
- there is no cached data yet.

## Remote Sharing

To share with a Windows colleague, host this `Web/` folder as a static site. The Supabase anon key must be safe to expose, and Row Level Security policies should only allow the intended workspace access.
