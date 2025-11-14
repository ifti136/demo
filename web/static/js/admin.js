// --- MODIFICATION: Added global-like state variables ---
let allUsers = [];
let filteredUsers = [];
let currentPage = 1;
let rowsPerPage = 15;
let sortColumn = "username";
let sortDirection = "asc";
// --- END MODIFICATION ---

document.addEventListener("DOMContentLoaded", () => {
  // Check if user is actually an admin (simple check, backend does the real security)
  fetch("/api/user")
    .then((res) => res.json())
    .then((user) => {
      if (user.role !== "admin") {
        // Not an admin, redirect them out
        window.location.href = "/";
      } else {
        // User is an admin, load all data
        loadAdminStats();
        loadUsers();
      }
    });

  // Setup listeners
  document
    .getElementById("setBroadcastBtn")
    .addEventListener("click", setBroadcast);
  document
    .getElementById("userSearch")
    .addEventListener("input", filterUserTable);
});

// --- API Call Helper ---
async function apiCall(endpoint, method = "GET", body = null) {
  try {
    const options = {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
      },
    };
    if (body) options.body = JSON.stringify(body);
    const response = await fetch(endpoint, options);

    if (response.status === 401) {
      window.location.href = "/login";
      return null;
    }

    const responseData = await response.json();
    if (!response.ok) {
      throw new Error(
        responseData.error || `HTTP error! status: ${response.status}`
      );
    }
    return responseData;
  } catch (error) {
    showToast(error.message || "An error occurred.", "error");
    return null;
  }
}

// --- Data Loading Functions ---
async function loadAdminStats() {
  const data = await apiCall("/api/admin/stats");
  if (!data) return;

  document.getElementById("totalUsers").textContent = data.stats.total_users;
  document.getElementById("totalCoins").textContent =
    data.stats.total_coins.toLocaleString();
  document.getElementById("totalTransactions").textContent =
    data.stats.total_transactions.toLocaleString();

  // Render chart
  renderNewUsersChart(data.chart_data);
}

async function loadUsers() {
  const data = await apiCall("/api/admin/users");
  if (!data) return;

  // --- MODIFICATION: Store data and render first page ---
  allUsers = data.users;
  filteredUsers = [...allUsers];

  setupSorters(); // Set up click listeners on headers
  sortUsers(); // Perform initial sort
  renderTablePage(); // Render the first page and pagination
  // --- END MODIFICATION ---
}

// --- MODIFICATION: New function to render a page of the table ---
function renderTablePage() {
  const tableBody = document.getElementById("userTableBody");
  tableBody.innerHTML = ""; // Clear table

  const startIndex = (currentPage - 1) * rowsPerPage;
  const endIndex = startIndex + rowsPerPage;
  const pageUsers = filteredUsers.slice(startIndex, endIndex);

  pageUsers.forEach((user) => {
    const tr = document.createElement("tr");
    tr.dataset.username = user.username.toLowerCase();

    const lastUpdated =
      user.last_updated === "N/A"
        ? "N/A"
        : new Date(user.last_updated).toLocaleString();

    const createdOn =
      user.created_at === "N/A"
        ? "N/A"
        : new Date(user.created_at).toLocaleDateString();

    const balanceClass =
      user.balance > 0
        ? "amount-positive"
        : user.balance < 0
        ? "amount-negative"
        : "";

    tr.innerHTML = `
      <td>${user.username}</td>
      <td class="${balanceClass}">${user.balance.toLocaleString()}</td>
      <td>${user.txn_count}</td>
      <td>${lastUpdated}</td>
      <td>${createdOn}</td>
      <td>
          <button class="btn secondary" data-uid="${user.user_id}">View</button>
          <button class="btn danger" data-uid="${
            user.user_id
          }" data-username="${user.username}">Delete</button>
      </td>
    `;

    tr.querySelector(".btn.danger").addEventListener("click", (e) => {
      const userId = e.currentTarget.dataset.uid;
      const username = e.currentTarget.dataset.username;
      if (
        confirm(
          `Are you sure you want to delete ${username}?\nThis is permanent and will delete all their data.`
        )
      ) {
        deleteUser(userId, tr);
      }
    });

    tr.querySelector(".btn.secondary").addEventListener("click", (e) => {
      showToast(`User 'View' feature coming soon!`, "success");
    });

    tableBody.appendChild(tr);
  });

  renderPaginationControls();
}
// --- END MODIFICATION ---

// --- MODIFICATION: New function to render pagination controls ---
function renderPaginationControls() {
  const controlsTop = document.getElementById("paginationControlsTop");
  const controlsBottom = document.getElementById("paginationControlsBottom");
  const totalPages = Math.ceil(filteredUsers.length / rowsPerPage);

  if (totalPages <= 1) {
    controlsTop.innerHTML = "";
    controlsBottom.innerHTML = "";
    return;
  }

  let html = "";
  html += `<button class="btn secondary" ${
    currentPage === 1 ? "disabled" : ""
  } data-page="${currentPage - 1}">Previous</button>`;

  let startPage = Math.max(1, currentPage - 2);
  let endPage = Math.min(totalPages, currentPage + 2);

  if (startPage > 1)
    html += `<button class="btn secondary" data-page="1">1</button><span>...</span>`;
  for (let i = startPage; i <= endPage; i++) {
    html += `<button class="btn ${
      i === currentPage ? "primary" : "secondary"
    }" data-page="${i}">${i}</button>`;
  }
  if (endPage < totalPages)
    html += `<span>...</span><button class="btn secondary" data-page="${totalPages}">${totalPages}</button>`;

  html += `<button class="btn secondary" ${
    currentPage === totalPages ? "disabled" : ""
  } data-page="${currentPage + 1}">Next</button>`;

  controlsTop.innerHTML = html;
  controlsBottom.innerHTML = html;

  document.querySelectorAll(".pagination-controls button").forEach((btn) => {
    btn.addEventListener("click", (e) => {
      const page = parseInt(e.currentTarget.dataset.page);
      if (page && page !== currentPage) {
        currentPage = page;
        renderTablePage();
      }
    });
  });
}
// --- END MODIFICATION ---

// --- MODIFICATION: New functions for sorting ---
function setupSorters() {
  document.querySelectorAll("th[data-sort]").forEach((header) => {
    header.addEventListener("click", () => {
      const column = header.dataset.sort;
      if (sortColumn === column) {
        sortDirection = sortDirection === "asc" ? "desc" : "asc";
      } else {
        sortColumn = column;
        sortDirection = "asc";
      }
      sortUsers();
      currentPage = 1; // Reset to first page after sorting
      renderTablePage();
    });
  });
}

function sortUsers() {
  filteredUsers.sort((a, b) => {
    let valA = a[sortColumn];
    let valB = b[sortColumn];

    // Handle different data types
    if (sortColumn === "balance" || sortColumn === "txn_count") {
      valA = Number(valA) || 0;
      valB = Number(valB) || 0;
    } else if (sortColumn === "last_updated" || sortColumn === "created_at") {
      valA = valA === "N/A" ? 0 : new Date(valA).getTime();
      valB = valB === "N/A" ? 0 : new Date(valB).getTime();
    } else {
      valA = valA.toLowerCase();
      valB = valB.toLowerCase();
    }

    if (valA < valB) return sortDirection === "asc" ? -1 : 1;
    if (valA > valB) return sortDirection === "asc" ? 1 : -1;
    return 0;
  });

  // Update header classes for visual indicators
  document.querySelectorAll("th[data-sort]").forEach((header) => {
    header.classList.remove("sort-asc", "sort-desc");
    if (header.dataset.sort === sortColumn) {
      header.classList.add(sortDirection === "asc" ? "sort-asc" : "sort-desc");
    }
  });
}
// --- END MODIFICATION ---

function renderNewUsersChart(chartData) {
  const ctx = document.getElementById("newUsersChart").getContext("2d");

  const textColor = getComputedStyle(document.documentElement).getPropertyValue(
    "--text-color"
  );
  const gridColor = getComputedStyle(document.documentElement).getPropertyValue(
    "--border-color"
  );
  const primaryColor = getComputedStyle(
    document.documentElement
  ).getPropertyValue("--primary-color");

  new Chart(ctx, {
    type: "line",
    data: {
      labels: chartData.labels, // Dates
      datasets: [
        {
          label: "New Users",
          data: chartData.data, // Counts
          backgroundColor: "rgba(59, 130, 246, 0.1)",
          borderColor: primaryColor,
          borderWidth: 2,
          tension: 0.1,
          fill: true,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false } },
      scales: {
        y: { ticks: { color: textColor }, grid: { color: gridColor } },
        x: { ticks: { color: textColor }, grid: { display: false } },
      },
    },
  });
}

// --- Action Functions ---

async function deleteUser(userId, tableRow) {
  const result = await apiCall("/api/admin/delete-user", "POST", {
    user_id: userId,
  });
  if (result && result.success) {
    showToast("User deleted successfully.", "success");
    // --- MODIFICATION: Refilter and render after delete ---
    allUsers = allUsers.filter((u) => u.user_id !== userId);
    filterUserTable(); // This will re-filter, re-sort, and re-render
    // --- END MODIFICATION ---
    loadAdminStats();
  }
}

async function setBroadcast() {
  const message = document.getElementById("broadcastMessage").value;
  const result = await apiCall("/api/admin/broadcast", "POST", { message });
  if (result && result.success) {
    showToast("Broadcast message updated!", "success");
  }
}

// --- MODIFICATION: Updated search to work with client-side pagination ---
function filterUserTable() {
  const searchTerm = document.getElementById("userSearch").value.toLowerCase();

  if (!searchTerm) {
    filteredUsers = [...allUsers];
  } else {
    filteredUsers = allUsers.filter((user) =>
      user.username.toLowerCase().includes(searchTerm)
    );
  }

  sortUsers(); // Re-apply current sort
  currentPage = 1; // Reset to first page
  renderTablePage(); // Render the filtered, sorted, and paginated result
}
// --- END MODIFICATION ---

// --- Toast Function ---
function showToast(message, type = "success") {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.className = `toast ${type} show`;
  setTimeout(() => toast.classList.remove("show"), 3000);
}
