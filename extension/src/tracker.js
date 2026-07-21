// tracker.js - Script for standalone ATS Tracker Page

let currentApplications = [];

document.addEventListener("DOMContentLoaded", () => {
  // Load initial data
  loadApplications();

  // Search & Filter Listeners
  const searchInput = document.getElementById("tracker-search");
  const filterSelect = document.getElementById("tracker-status-filter");

  searchInput.addEventListener("input", filterAndRenderApplications);
  filterSelect.addEventListener("change", filterAndRenderApplications);

  // Manual Job Application Modal Trigger
  const addAppBtn = document.getElementById("add-manual-app-btn");
  const appModal = document.getElementById("app-modal");
  const appModalTitle = document.getElementById("app-modal-title");
  const closeAppBtn = document.getElementById("close-app-modal");
  const cancelAppBtn = document.getElementById("cancel-app-btn");
  const saveAppBtn = document.getElementById("save-app-btn");

  addAppBtn.addEventListener("click", () => {
    appModalTitle.textContent = "Add Tracked Application";
    document.getElementById("manual-app-id").value = "";
    document.getElementById("manual-company").value = "";
    document.getElementById("manual-role").value = "";
    document.getElementById("manual-url").value = "";
    document.getElementById("manual-status").value = "Not Applied";
    document.getElementById("manual-notes").value = "";
    appModal.classList.add("active");
  });

  const closeApp = () => appModal.classList.remove("active");
  closeAppBtn.addEventListener("click", closeApp);
  cancelAppBtn.addEventListener("click", closeApp);

  saveAppBtn.addEventListener("click", async () => {
    const id = document.getElementById("manual-app-id").value;
    const company = document.getElementById("manual-company").value.trim();
    const role = document.getElementById("manual-role").value.trim();
    const url = document.getElementById("manual-url").value.trim();
    const status = document.getElementById("manual-status").value;
    const notes = document.getElementById("manual-notes").value.trim();

    if (!company || !role) {
      alert("Company and Role are required.");
      return;
    }

    let res;
    if (id) {
      // Edit existing application
      res = await chrome.runtime.sendMessage({
        action: "UPDATE_APPLICATION",
        payload: { id, company, role, url, status, notes }
      });
    } else {
      // Create new application
      res = await chrome.runtime.sendMessage({
        action: "ADD_APPLICATION",
        payload: { company, role, url, status, notes }
      });
    }

    if (res && res.success) {
      loadApplications();
      closeApp();
    } else {
      alert("Failed to track application.");
    }
  });
});

// Load applications from Chrome Extension storage
async function loadApplications() {
  const apps = await chrome.runtime.sendMessage({ action: "GET_APPLICATIONS" });
  currentApplications = apps || [];
  
  // Update KPI counters
  renderKPIs(currentApplications);
  
  // Render applications in table
  filterAndRenderApplications();
}

function renderKPIs(apps) {
  document.getElementById("metric-total").textContent = apps.length;
  document.getElementById("metric-in-progress").textContent = apps.filter(a => a.status === 'In Progress').length;
  document.getElementById("metric-applied").textContent = apps.filter(a => a.status === 'Applied').length;
  document.getElementById("metric-interviews").textContent = apps.filter(a => a.status === 'Interviewing').length;
  document.getElementById("metric-rejections").textContent = apps.filter(a => a.status === 'Rejected').length;
}

// Filters applications list according to Search input and Status dropdown, then renders them
function filterAndRenderApplications() {
  const query = document.getElementById("tracker-search").value.toLowerCase().trim();
  const filter = document.getElementById("tracker-status-filter").value;
  const tbody = document.getElementById("tracker-table-body");

  // Apply filters
  const filtered = currentApplications.filter(app => {
    const matchesSearch = app.company.toLowerCase().includes(query) || app.role.toLowerCase().includes(query);
    const matchesStatus = filter === "ALL" || app.status === filter;
    return matchesSearch && matchesStatus;
  });

  if (filtered.length === 0) {
    tbody.innerHTML = `<tr><td colspan="6" class="table-empty-row">No matching job applications found.</td></tr>`;
    return;
  }

  tbody.innerHTML = filtered.map(app => {
    const formattedDate = app.createdAt ? new Date(app.createdAt).toLocaleDateString(undefined, {
      month: 'short', day: 'numeric', year: 'numeric'
    }) : 'N/A';

    return `
      <tr>
        <td class="cell-company">${app.company}</td>
        <td>
          <div class="cell-role">${app.role}</div>
          ${app.url ? `<a href="${app.url}" target="_blank" class="cell-link">🔗 Job Link</a>` : ''}
        </td>
        <td class="cell-date">${formattedDate}</td>
        <td>
          <select class="app-status-dropdown table-select" data-id="${app.id}">
            <option value="Not Applied" ${app.status === 'Not Applied' ? 'selected' : ''}>Not Applied</option>
            <option value="In Progress" ${app.status === 'In Progress' ? 'selected' : ''}>In Progress</option>
            <option value="Applied" ${app.status === 'Applied' ? 'selected' : ''}>Applied</option>
            <option value="Interviewing" ${app.status === 'Interviewing' ? 'selected' : ''}>Interviewing</option>
            <option value="Offer" ${app.status === 'Offer' ? 'selected' : ''}>Offer</option>
            <option value="Rejected" ${app.status === 'Rejected' ? 'selected' : ''}>Rejected</option>
          </select>
        </td>
        <td class="cell-notes" title="${app.notes || ''}">
          ${app.notes || '<span class="notes-empty">No notes</span>'}
        </td>
        <td class="cell-actions">
          <div class="actions-flex-end">
            <button class="btn btn-secondary edit-app-btn btn-table-action" data-id="${app.id}">Edit</button>
            <button class="btn btn-danger delete-app-btn btn-table-action" data-id="${app.id}">Remove</button>
          </div>
        </td>
      </tr>
    `;
  }).join("");

  // Edit Button Event Listeners
  document.querySelectorAll(".edit-app-btn").forEach(btn => {
    btn.addEventListener("click", (e) => {
      const id = e.target.getAttribute("data-id");
      const app = currentApplications.find(a => a.id === id);
      if (app) {
        document.getElementById("app-modal-title").textContent = "Edit Tracked Application";
        document.getElementById("manual-app-id").value = app.id;
        document.getElementById("manual-company").value = app.company;
        document.getElementById("manual-role").value = app.role;
        document.getElementById("manual-url").value = app.url;
        document.getElementById("manual-status").value = app.status;
        document.getElementById("manual-notes").value = app.notes || "";
        document.getElementById("app-modal").classList.add("active");
      }
    });
  });

  // Status Change Event Listeners
  document.querySelectorAll(".app-status-dropdown").forEach(select => {
    select.addEventListener("change", async (e) => {
      const id = e.target.getAttribute("data-id");
      const status = e.target.value;
      await chrome.runtime.sendMessage({
        action: "UPDATE_APPLICATION",
        payload: { id, status }
      });
      loadApplications(); // Reload analytics and list
    });
  });

  // Delete/Remove Event Listeners
  document.querySelectorAll(".delete-app-btn").forEach(btn => {
    btn.addEventListener("click", async (e) => {
      const id = e.target.getAttribute("data-id");
      if (confirm("Remove this tracked job application?")) {
        await chrome.runtime.sendMessage({
          action: "DELETE_APPLICATION",
          payload: { id }
        });
        loadApplications();
      }
    });
  });
}
