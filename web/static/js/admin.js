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

  const tableBody = document.getElementById("userTableBody");
  tableBody.innerHTML = ""; // Clear

  data.users.forEach((user) => {
    const tr = document.createElement("tr");
    tr.dataset.username = user.username.toLowerCase();

    // --- MODIFIED: Format and render all the new data ---
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
                <button class="btn secondary" data-uid="${
                  user.user_id
                }">View</button>
                <button class="btn danger" data-uid="${
                  user.user_id
                }" data-username="${user.username}">Delete</button>
            </td>
        `;
    // --- END MODIFICATION ---

    // Add listeners for buttons
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
}

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
    tableRow.remove(); // Remove from UI
    // --- NEW: Refresh stats after delete ---
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

function filterUserTable() {
  const searchTerm = document.getElementById("userSearch").value.toLowerCase();
  const rows = document.querySelectorAll("#userTableBody tr");

  rows.forEach((row) => {
    const username = row.dataset.username;
    if (username.includes(searchTerm)) {
      row.style.display = "";
    } else {
      row.style.display = "none";
    }
  });
}

// --- Toast Function ---
function showToast(message, type = "success") {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.className = `toast ${type} show`;
  setTimeout(() => toast.classList.remove("show"), 3000);
}
