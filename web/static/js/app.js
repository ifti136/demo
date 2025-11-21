class CoinTrackerApp {
  constructor() {
    this.data = {
      transactions: [],
      settings: {},
      profile: "Default",
      analytics: {},
      dashboard_stats: {},
      achievements: [], // Added
    };
    this.charts = {};

    this.historyPage = {
      currentPage: 1,
      totalPages: 1,
    };
  }

  async init() {
    this.setupEventListeners();
    await this.loadInitialData();
    this.createHiddenFileInput();
  }

  setupEventListeners() {
    document
      .getElementById("hamburgerBtn")
      .addEventListener("click", () => this.toggleMobileNav());

    document.querySelectorAll("nav.nav > .nav-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        this.showPage(e.currentTarget.dataset.page);
        if (
          document.querySelector(".sidebar").classList.contains("nav-expanded")
        ) {
          this.toggleMobileNav();
        }
      });
    });

    // --- Core App Listeners ---
    document
      .getElementById("themeToggle")
      .addEventListener("click", () => this.toggleTheme());
    document
      .getElementById("profileSelect")
      .addEventListener("change", (e) => this.switchProfile(e.target.value));
    document
      .getElementById("newProfileBtn")
      .addEventListener("click", () => this.showProfileModal());
    document
      .getElementById("addCoinsBtn")
      .addEventListener("click", () => this.addFromDashboard());
    document
      .getElementById("spendCoinsBtn")
      .addEventListener("click", () => this.spendFromDashboard());
    document
      .getElementById("setGoalBtn")
      .addEventListener("click", () => this.setGoal());
    document
      .querySelectorAll(".tab-header")
      .forEach((tab) =>
        tab.addEventListener("click", (e) => this.switchTab(e.currentTarget))
      );

    // --- History Filters ---
    document
      .getElementById("dateFrom")
      .addEventListener("change", () => this.loadHistoryPage(1));
    document
      .getElementById("dateTo")
      .addEventListener("change", () => this.loadHistoryPage(1));
    document
      .getElementById("historySourceFilter")
      .addEventListener("change", () => this.loadHistoryPage(1));
    document
      .getElementById("historySearch")
      .addEventListener("input", () => this.loadHistoryPage(1));

    // --- Settings Page ---
    const addQuickActionBtn = document.getElementById("addQuickActionBtn");
    if (addQuickActionBtn) {
      addQuickActionBtn.addEventListener("click", () =>
        this.addNewQuickAction()
      );
    }
    const customizeBtn = document.getElementById("customizeQuickActions");
    if (customizeBtn) {
      customizeBtn.addEventListener("click", () => this.showPage("settings"));
    }

    // --- Data Management ---
    document
      .getElementById("exportDataBtn")
      .addEventListener("click", () => this.exportData());
    document
      .getElementById("importDataBtn")
      .addEventListener("click", () => this.triggerImport());

    // --- Logout Button ---
    const logoutBtn = document.getElementById("logoutBtn");
    if (logoutBtn) {
      logoutBtn.addEventListener("click", () => this.logout());
    }

    // --- Support Modal Listener ---
    const supportBtns = document.querySelectorAll("#supportBtn");
    supportBtns.forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.preventDefault(); // Prevent any default behavior
        this.showSupportModal();
      });
    });

    // --- Click-to-Copy for Donation Cards ---
    document.querySelectorAll(".donation-card").forEach((card) => {
      card.addEventListener("click", (e) => {
        const number = card.querySelector(".card-number").textContent.trim();
        navigator.clipboard
          .writeText(number)
          .then(() => {
            this.showToast(`Copied: ${number}`, "success");

            // Visual feedback
            card.style.transform = "scale(0.96)";
            setTimeout(() => (card.style.transform = ""), 150);
          })
          .catch((err) => {
            console.error("Copy failed: ", err);
          });
      });
    });
  }

  // --- Import/Export Methods ---
  createHiddenFileInput() {
    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.id = "jsonImporter";
    fileInput.accept = ".json,application/json";
    fileInput.style.display = "none";
    fileInput.addEventListener("change", (e) => this.handleFileImport(e));
    document.body.appendChild(fileInput);
  }

  triggerImport() {
    document.getElementById("jsonImporter").click();
  }

  handleFileImport(event) {
    const file = event.target.files[0];
    if (!file) {
      return;
    }

    const reader = new FileReader();
    reader.onload = (e) => {
      try {
        const data = JSON.parse(e.target.result);
        this.processImportedData(data);
      } catch (error) {
        this.showToast("Invalid or corrupt JSON file.", "error");
        console.error("Failed to parse imported file:", error);
      }
    };
    reader.readAsText(file);

    event.target.value = null;
  }

  async processImportedData(data) {
    if (
      !data ||
      typeof data.transactions === "undefined" ||
      typeof data.settings === "undefined"
    ) {
      this.showToast(
        "Invalid file format. Missing 'transactions' or 'settings'.",
        "error"
      );
      return;
    }

    this.showToast("Importing data...", "success");

    const result = await this.apiCall("/api/import-data", "POST", data);

    if (result && result.success) {
      this.data = result;
      this.updateAllUI();

      const profilesData = await this.apiCall("/api/profiles");
      if (profilesData) {
        this.updateProfileDropdown(
          profilesData.profiles,
          profilesData.current_profile
        );
      }

      this.showToast("Data imported successfully!", "success");
    }
  }
  exportData() {
    try {
      const dataToExport = {
        settings: this.data.settings,
        transactions: this.data.transactions,
      };

      const dataStr = JSON.stringify(dataToExport, null, 2);
      const blob = new Blob([dataStr], { type: "application/json" });
      const url = URL.createObjectURL(blob);

      const a = document.createElement("a");
      const profileName = this.data.profile || "Default";
      const date = new Date().toISOString().split("T")[0];
      a.href = url;
      a.download = `coin_tracker_export_${profileName}_${date}.json`;

      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      URL.revokeObjectURL(url);
      this.showToast("Data exported successfully!", "success");
    } catch (error) {
      this.showToast("Failed to export data.", "error");
      console.error("Export error:", error);
    }
  }

  // --- Core Class Methods ---

  toggleMobileNav() {
    const sidebar = document.querySelector(".sidebar");
    const hamburger = document.getElementById("hamburgerBtn");
    sidebar.classList.toggle("nav-expanded");
    hamburger.classList.toggle("open");
    hamburger.setAttribute(
      "aria-expanded",
      sidebar.classList.contains("nav-expanded")
    );
  }

  async apiCall(endpoint, method = "GET", body = null) {
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
        this.showToast("Session expired. Please log in.", "error");
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
      console.error(`API call to ${endpoint} failed:`, error);
      this.showToast(
        error.message || "An error occurred. Please try again.",
        "error"
      );
      return null;
    }
  }

  async loadInitialData() {
    const data = await this.apiCall("/api/data");
    if (data) {
      this.data = data;
    } else {
      return;
    }

    const profilesData = await this.apiCall("/api/profiles");
    if (profilesData)
      this.updateProfileDropdown(
        profilesData.profiles,
        profilesData.current_profile
      );

    const userData = await this.apiCall("/api/user");
    const usernameDisplay = document.getElementById("usernameDisplay");
    if (userData && userData.username && usernameDisplay) {
      usernameDisplay.textContent = userData.username;
    }
    if (userData && userData.role === "admin") {
      const adminBtn = document.getElementById("adminPanelBtnContainer");
      if (adminBtn) adminBtn.style.display = "block";
    }

    const broadcastData = await this.apiCall("/api/broadcast");
    if (broadcastData && broadcastData.message) {
      this.showToast(broadcastData.message, "broadcast");
    }

    this.updateAllUI();
    this.loadHistoryPage(1);
  }

  updateAllUI() {
    if (!this.data) {
      console.error("No data available to update UI.");
      return;
    }
    this.applyTheme(this.data.settings.dark_mode);
    this.updateBalanceAndGoalUI(
      this.data.balance,
      this.data.goal,
      this.data.progress,
      this.data.estimated_days
    );
    this.updateDashboardStatsUI(this.data.dashboard_stats);
    this.updateQuickActionsUI(this.data.settings.quick_actions);
    this.updateAnalyticsUI(this.data.analytics);
    this.updateSettingsPageUI(
      this.data.settings,
      this.data.goal,
      this.data.progress
    );
    this.populateHistoryFilter(this.data.settings.all_sources);
    this.updateAchievementsUI(this.data.achievements); // Added
  }

  populateHistoryFilter(sources) {
    if (!sources) return;
    const select = document.getElementById("historySourceFilter");
    const currentValue = select.value;
    select.innerHTML = '<option value="all">All</option>'; // Reset
    sources.forEach((source) => {
      const option = document.createElement("option");
      option.value = source;
      option.textContent = source;
      select.appendChild(option);
    });
    select.value = currentValue;
  }

  applyTheme(isDarkMode) {
    // MODIFICATION: Set theme in localStorage
    const theme = isDarkMode ? "dark" : "light";
    document.documentElement.setAttribute("data-theme", theme);
    localStorage.setItem("theme", theme); // Save setting

    document.getElementById("themeToggle").textContent = isDarkMode
      ? "☀️ Light Mode"
      : "🌙 Dark Mode";
    if (this.data.analytics && Object.keys(this.charts).length > 0) {
      this.updateAnalyticsUI(this.data.analytics);
    }
  }

  // --- TARGETED UI UPDATE FUNCTIONS ---

  updateBalanceAndGoalUI(balance, goal, progress, estimated_days) {
    document.getElementById(
      "balanceAmount"
    ).textContent = `${balance.toLocaleString()} coins`;
    document.getElementById(
      "goalText"
    ).textContent = `Goal: ${goal.toLocaleString()} coins`;
    document.getElementById("progressBar").style.width = `${progress}%`;
    document.getElementById("progressPercent").textContent = `${progress}%`;

    const estimateEl = document.getElementById("goalEstimate");
    if (estimated_days === 0) {
      estimateEl.textContent = "🎉 Goal Complete! 🎉";
    } else if (estimated_days === "N/A") {
      estimateEl.textContent = "Add earnings to see your estimate";
    } else {
      estimateEl.textContent = `Estimated time to reach goal: ${estimated_days} days`;
    }
  }

  updateDashboardStatsUI(stats) {
    if (!stats) return;
    document.getElementById(
      "todayEarnings"
    ).textContent = `+${stats.today.toLocaleString()}`;
    document.getElementById(
      "weekEarnings"
    ).textContent = `+${stats.week.toLocaleString()}`;
    document.getElementById(
      "monthEarnings"
    ).textContent = `+${stats.month.toLocaleString()}`;
  }

  updateQuickActionsUI(quick_actions) {
    if (!quick_actions) return;
    const grid = document.querySelector(".quick-actions-grid");
    grid.innerHTML = "";
    quick_actions.forEach((action) => {
      const btn = document.createElement("button");
      btn.className = `quick-btn ${
        action.is_positive ? "positive" : "negative"
      }`;
      btn.innerHTML = `<div class="quick-text">${
        action.text
      }</div><div class="quick-amount">${action.is_positive ? "+" : "-"}${
        action.value
      }</div>`;

      btn.onclick = async () => {
        btn.classList.add("is-processing");
        const amount = action.is_positive ? action.value : -action.value;
        const result = await this.apiCall("/api/add-transaction", "POST", {
          amount,
          source: action.text,
          date: new Date().toISOString(),
        });
        btn.classList.remove("is-processing");

        if (result && result.success) {
          this.showToast(`Quick action '${action.text}' recorded.`, "success");
          this.data = result;
          this.updateAllUI();

          if (document.getElementById("history").classList.contains("active")) {
            this.loadHistoryPage(this.historyPage.currentPage);
          }
        }
      };
      grid.appendChild(btn);
    });
  }

  updateHistoryTableUI(transactions) {
    if (!transactions) return;
    const tbody = document.getElementById("historyTableBody");
    tbody.innerHTML = ""; // Clear table

    transactions.forEach((t) => {
      const tr = document.createElement("tr");
      tr.dataset.id = t.id;
      const amountClass = t.amount >= 0 ? "amount-positive" : "amount-negative";

      const balanceAfter = (t.previous_balance || 0) + t.amount;

      // MODIFICATION: Added Actions column (td)
      tr.innerHTML = `
        <td>${new Date(t.date).toLocaleString()}</td>
        <td>${t.amount >= 0 ? "Income" : "Expense"}</td>
        <td>${t.source}</td>
        <td class="${amountClass}">${
        t.amount >= 0 ? "+" : ""
      }${t.amount.toLocaleString()}</td>
        <td>${balanceAfter.toLocaleString()}</td>
        <td class="history-actions">
            <button class="btn secondary btn-edit" data-id="${
              t.id
            }">✎ Edit</button>
            <button class="btn danger btn-delete" data-id="${
              t.id
            }">🗑️ Delete</button>
        </td>
      `;
      tbody.appendChild(tr);

      // --- MODIFICATION: Add listeners for new buttons ---
      tr.querySelector(".btn-edit").addEventListener("click", (e) => {
        const transactionId = e.currentTarget.dataset.id;
        const transaction = this.data.transactions.find(
          (t) => t.id === transactionId
        );
        if (transaction) {
          this.showTransactionModal(transaction.amount > 0, transactionId);
        }
      });

      tr.querySelector(".btn-delete").addEventListener("click", (e) => {
        const transactionId = e.currentTarget.dataset.id;
        this.confirmDeleteTransaction(transactionId); // Use a helper to confirm
      });
      // --- END MODIFICATION ---
    });
  }

  updateAnalyticsUI(analytics) {
    if (!analytics) return;
    document.getElementById(
      "totalEarnings"
    ).textContent = `+${analytics.total_earnings.toLocaleString()}`;
    document.getElementById(
      "totalSpending"
    ).textContent = `-${analytics.total_spending.toLocaleString()}`;
    document.getElementById("netBalance").textContent = `${
      analytics.net_balance >= 0 ? "+" : ""
    }${analytics.net_balance.toLocaleString()}`;
    this.createOrUpdateChart(
      "earningsChart",
      "doughnut",
      Object.keys(analytics.earnings_breakdown),
      Object.values(analytics.earnings_breakdown)
    );
    this.createOrUpdateChart(
      "spendingChart",
      "bar",
      Object.keys(analytics.spending_breakdown),
      Object.values(analytics.spending_breakdown)
    );
    this.createOrUpdateChart(
      "timelineChart",
      "line",
      analytics.timeline.map((p) => new Date(p.date).toLocaleDateString()),
      analytics.timeline.map((p) => p.balance)
    );
  }

  updateSettingsPageUI(settings, goal, progress) {
    if (!settings) return;
    document.getElementById("goalInput").value = settings.goal;
    document.getElementById(
      "currentGoalText"
    ).textContent = `Current Goal: ${goal.toLocaleString()} coins`;
    document.getElementById(
      "goalProgressText"
    ).textContent = `You are ${progress}% of the way towards your current goal.`;
    document.getElementById("onlineStatus").textContent =
      settings.firebase_available
        ? "✅ Online (Firebase)"
        : "❌ Offline (Local Storage)";
    this.renderQuickActionSettingsList();
  }

  // --- NEW: Function to render achievements ---
  updateAchievementsUI(achievements) {
    if (!achievements) return;
    const grid = document.getElementById("achievements-grid");
    const noMsg = document.getElementById("no-achievements-msg");
    if (!grid || !noMsg) return;

    grid.innerHTML = ""; // Clear old achievements

    if (achievements.length === 0) {
      grid.appendChild(noMsg);
      noMsg.style.display = "block";
    } else {
      noMsg.style.display = "none";
      achievements.forEach((ach) => {
        const item = document.createElement("div");
        item.className = "achievement-item";
        item.innerHTML = `
          <div class="achievement-icon">${ach.icon}</div>
          <div class="achievement-name">${ach.name}</div>
          <div class="achievement-desc">${ach.desc}</div>
        `;
        grid.appendChild(item);
      });
    }
  }
  // --- END NEW FUNCTION ---

  // --- History Pagination Functions ---

  async loadHistoryPage(page) {
    if (page < 1) page = 1;
    this.historyPage.currentPage = page;

    const fromDate = document.getElementById("dateFrom").value;
    const toDate = document.getElementById("dateTo").value;
    const searchTerm = document.getElementById("historySearch").value;
    const sourceFilter = document.getElementById("historySourceFilter").value;

    let query = `?page=${page}&limit=20`;
    if (fromDate) query += `&date_from=${fromDate}`;
    if (toDate) query += `&date_to=${toDate}`;
    if (searchTerm) query += `&search=${encodeURIComponent(searchTerm)}`;
    if (sourceFilter !== "all")
      query += `&source=${encodeURIComponent(sourceFilter)}`;

    const data = await this.apiCall(`/api/history${query}`);

    if (data) {
      this.historyPage.totalPages = data.total_pages;
      this.updateHistoryTableUI(data.transactions);
      this.renderPaginationControls(data.total_pages, data.current_page);

      const summaryEl = document.getElementById("periodSummary");
      if (summaryEl) {
        summaryEl.innerHTML = `
          <span class="amount-positive">Earned: +${data.total_earned.toLocaleString()}</span> / 
          <span class="amount-negative">Spent: ${data.total_spent.toLocaleString()}</span>
        `;
      }
    }
  }

  renderPaginationControls(totalPages, currentPage) {
    const controlsTop = document.getElementById("paginationControlsTop");
    const controlsBottom = document.getElementById("paginationControlsBottom");

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
        if (page) {
          this.loadHistoryPage(page);
        }
      });
    });
  }

  async addFromDashboard() {
    const amountEl = document.getElementById("addAmount");
    const sourceEl = document.getElementById("addSource");
    const amount = parseInt(amountEl.value);
    const source = sourceEl.options[sourceEl.selectedIndex].text;

    if (!amount || amount <= 0 || !source)
      return this.showToast(
        "Please provide a valid amount and source.",
        "error"
      );

    const result = await this.apiCall("/api/add-transaction", "POST", {
      amount,
      source,
      date: new Date().toISOString(),
    });

    if (result && result.success) {
      this.showToast(`Added ${amount} coins!`, "success");
      amountEl.value = "";
      this.data = result;
      this.updateAllUI();
      this.loadHistoryPage(1);
    }
  }

  async spendFromDashboard() {
    const amountEl = document.getElementById("spendAmount");
    const sourceEl = document.getElementById("spendCategory");
    const amount = parseInt(amountEl.value);
    const source = sourceEl.options[sourceEl.selectedIndex].text;

    if (!amount || amount <= 0 || !source)
      return this.showToast(
        "Please provide a valid amount and category.",
        "error"
      );

    const result = await this.apiCall("/api/add-transaction", "POST", {
      amount: -amount,
      source,
      date: new Date().toISOString(),
    });

    if (result && result.success) {
      this.showToast(`Spent ${amount} coins!`, "success");
      amountEl.value = "";
      this.data = result;
      this.updateAllUI();
      this.loadHistoryPage(1);
    }
  }

  async setGoal() {
    const goalInput = document.getElementById("goalInput");
    const goal = parseInt(goalInput.value);
    if (!isNaN(goal) && goal >= 0) {
      const result = await this.apiCall("/api/update-settings", "POST", {
        goal,
      });
      if (result && result.success) {
        this.showToast("Goal updated!", "success");
        this.data = result;
        this.updateBalanceAndGoalUI(
          this.data.balance,
          this.data.goal,
          this.data.progress,
          this.data.estimated_days
        );
        this.updateSettingsPageUI(
          this.data.settings,
          this.data.goal,
          this.data.progress
        );
      }
    } else {
      this.showToast("Please enter a valid goal amount.", "error");
      goalInput.value = this.data.goal;
    }
  }

  async switchProfile(profileName) {
    this.showToast(`Loading profile: ${profileName}...`, "success");
    const result = await this.apiCall("/api/switch-profile", "POST", {
      profile_name: profileName,
    });
    if (result && result.success) {
      await this.loadInitialData();
      this.showToast(`Switched to profile: ${profileName}`, "success");
    }
  }

  async toggleTheme() {
    // MODIFICATION: Save theme to localStorage
    const newDarkMode = !this.data.settings.dark_mode;
    this.data.settings.dark_mode = newDarkMode;

    // This will also save to localStorage
    this.applyTheme(newDarkMode);

    try {
      const result = await this.apiCall("/api/update-settings", "POST", {
        dark_mode: newDarkMode,
      });
      if (!result || !result.success) {
        this.showToast("Failed to save theme. Reverting.", "error");
        this.data.settings.dark_mode = !newDarkMode;
        this.applyTheme(!newDarkMode); // This will revert localStorage too
      }
    } catch (error) {
      this.showToast("Failed to save theme. Reverting.", "error");
      this.data.settings.dark_mode = !newDarkMode;
      this.applyTheme(!newDarkMode);
    }
  }

  createOrUpdateChart(canvasId, type, labels, data) {
    if (this.charts[canvasId]) {
      this.charts[canvasId].destroy();
    }
    const ctx = document.getElementById(canvasId);
    if (!ctx) return;
    const textColor = getComputedStyle(
      document.documentElement
    ).getPropertyValue("--text-color");
    const gridColor = getComputedStyle(
      document.documentElement
    ).getPropertyValue("--border-color");
    const primaryColor = getComputedStyle(
      document.documentElement
    ).getPropertyValue("--primary-color");
    const successColor = getComputedStyle(
      document.documentElement
    ).getPropertyValue("--success-color");
    const dangerColor = getComputedStyle(
      document.documentElement
    ).getPropertyValue("--danger-color");

    this.charts[canvasId] = new Chart(ctx, {
      type,
      data: {
        labels,
        datasets: [
          {
            data,
            backgroundColor:
              type === "doughnut"
                ? [
                    primaryColor,
                    successColor,
                    "#f59e0b",
                    dangerColor,
                    "#8b5cf6",
                  ]
                : type === "line"
                ? "rgba(59, 130, 246, 0.1)"
                : dangerColor,
            borderColor: type === "line" ? primaryColor : "transparent",
            borderWidth: 2,
            tension: 0.1,
            fill: type === "line",
          },
        ],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        plugins: {
          legend: {
            display: type === "doughnut",
            position: "bottom",
            labels: { color: textColor },
          },
        },
        scales:
          type !== "doughnut"
            ? {
                y: { ticks: { color: textColor }, grid: { color: gridColor } },
                x: { ticks: { color: textColor }, grid: { color: gridColor } },
              }
            : {},
      },
    });
  }

  showPage(pageId) {
    if (!pageId) {
      console.error("showPage called with no pageId");
      return;
    }
    document
      .querySelectorAll(".page")
      .forEach((p) => p.classList.remove("active"));
    const pageElement = document.getElementById(pageId);
    if (pageElement) {
      pageElement.classList.add("active");
    } else {
      console.error(`Page with id "${pageId}" not found.`);
    }
    document
      .querySelectorAll("nav.nav > .nav-btn")
      .forEach((btn) =>
        btn.classList.toggle("active", btn.dataset.page === pageId)
      );
    if (pageId === "history") {
      this.loadHistoryPage(1);
    }
  }

  switchTab(tabElement) {
    const parent = tabElement.parentElement;
    parent
      .querySelectorAll(".tab-header")
      .forEach((t) => t.classList.remove("active"));
    tabElement.classList.add("active");
    parent.nextElementSibling
      .querySelectorAll(".tab-pane")
      .forEach((p) => p.classList.remove("active"));
    document.getElementById(tabElement.dataset.tab).classList.add("active");
  }

  // --- Modals and Context Menus ---

  showTransactionModal(isIncome, transactionId = null) {
    const modal = document.getElementById("transactionModal");
    const transaction = transactionId
      ? this.data.transactions.find((t) => t.id === transactionId)
      : null;
    modal.querySelector(".modal-title").textContent = transaction
      ? "Edit Transaction"
      : isIncome
      ? "Add Coins"
      : "Spend Coins";
    modal.querySelector("#sourceLabel").textContent = isIncome
      ? "Source"
      : "Category";
    document.getElementById("transactionId").value = transactionId || "";
    document.getElementById("transactionAmount").value = transaction
      ? Math.abs(transaction.amount)
      : "";
    document.getElementById("transactionSource").value = transaction
      ? transaction.source
      : "";
    const date = transaction ? new Date(transaction.date) : new Date();
    date.setMinutes(date.getMinutes() - date.getTimezoneOffset());
    document.getElementById("transactionDate").value = date
      .toISOString()
      .slice(0, 16);

    modal.querySelector(".close").onclick = () =>
      (modal.style.display = "none");
    modal.querySelector("#saveTransactionBtn").onclick = () =>
      this.saveTransaction(isIncome);
    modal.style.display = "block";
  }

  async saveTransaction(isIncomeDefault) {
    const id = document.getElementById("transactionId").value;
    let amount = parseInt(document.getElementById("transactionAmount").value);
    const source = document.getElementById("transactionSource").value;
    const date = new Date(
      document.getElementById("transactionDate").value
    ).toISOString();
    if (isNaN(amount) || amount <= 0 || !source)
      return this.showToast("Please fill all fields correctly.", "error");

    let isIncome = isIncomeDefault;
    if (id) {
      const originalTransaction = this.data.transactions.find(
        (t) => t.id === id
      );
      if (originalTransaction) {
        isIncome = originalTransaction.amount > 0;
      }
    }

    if (!isIncome) amount = -amount;

    const endpoint = id
      ? `/api/update-transaction/${id}`
      : "/api/add-transaction";
    const result = await this.apiCall(endpoint, "POST", {
      amount,
      source,
      date,
    });

    if (result && result.success) {
      this.showToast(
        id ? "Transaction updated" : "Transaction added",
        "success"
      );
      document.getElementById("transactionModal").style.display = "none";
      this.data = result;
      this.updateAllUI();
      this.loadHistoryPage(this.historyPage.currentPage);
    }
  }

  // --- MODIFICATION: Added new helper function for delete confirmation ---
  async confirmDeleteTransaction(transactionId) {
    if (confirm("Are you sure you want to delete this transaction?")) {
      this.showToast("Deleting transaction...", "success");
      const result = await this.apiCall(
        `/api/delete-transaction/${transactionId}`,
        "POST"
      );
      if (result && result.success) {
        this.showToast("Transaction deleted", "success");
        this.data = result;
        this.updateAllUI();
        // Check if we deleted the last item on a page
        const { currentPage, totalPages } = this.historyPage;
        const transactionsOnPage =
          this.data.transactions.filter((t) => {
            // This is a simplified filter, a full reload is safer
            return true;
          }).length % 20; // 20 is page limit

        if (
          transactionsOnPage === 0 &&
          currentPage > 1 &&
          currentPage === totalPages
        ) {
          this.loadHistoryPage(currentPage - 1); // Go to previous page
        } else {
          this.loadHistoryPage(currentPage); // Reload current page
        }
      }
    }
  }

  updateProfileDropdown(profiles, currentProfile) {
    const select = document.getElementById("profileSelect");
    select.innerHTML = profiles
      .map(
        (p) =>
          `<option value="${p}" ${
            p === currentProfile ? "selected" : ""
          }>${p}</option>`
      )
      .join("");
  }

  showProfileModal() {
    const modal = document.getElementById("profileModal");
    modal.querySelector(".close").onclick = () =>
      (modal.style.display = "none");
    modal.querySelector("#createProfileBtn").onclick = () =>
      this.createProfile();
    modal.style.display = "block";
    document.getElementById("newProfileName").value = "";
  }

  async createProfile() {
    const name = document.getElementById("newProfileName").value;
    if (!name || name.length < 2) {
      return this.showToast(
        "Profile name must be at least 2 characters.",
        "error"
      );
    }

    const result = await this.apiCall("/api/create-profile", "POST", {
      profile_name: name,
    });
    if (result && result.success) {
      document.getElementById("profileModal").style.display = "none";
      this.showToast(`Profile '${name}' created!`, "success");
      await this.loadInitialData();
      this.updateProfileDropdown(result.profiles, result.current_profile);
    }
  }

  renderQuickActionSettingsList() {
    const listEl = document.getElementById("quickActionList");
    if (!listEl) return;

    const actions = this.data.settings.quick_actions || [];
    listEl.innerHTML = "";

    if (actions.length === 0) {
      listEl.innerHTML = "<p>No quick actions added yet.</p>";
      return;
    }

    actions.forEach((action, index) => {
      const item = document.createElement("div");
      item.className = "quick-action-list-item";
      const isPositive = action.is_positive;
      const amountClass = isPositive ? "positive" : "negative";
      const amountSign = isPositive ? "+" : "-";

      item.innerHTML = `
        <div class="quick-action-details">
          <span class="quick-action-text">${action.text}</span>
          <span class="quick-action-amount ${amountClass}">
            ${amountSign}${action.value}
          </span>
        </div>
        <button class="delete-btn" data-index="${index}">Delete</button>
      `;

      item.querySelector(".delete-btn").addEventListener("click", () => {
        this.deleteQuickAction(index);
      });

      listEl.appendChild(item);
    });
  }

  async addNewQuickAction() {
    const textEl = document.getElementById("quickActionText");
    const amountEl = document.getElementById("quickActionAmount");
    const typeEl = document.getElementById("quickActionType");
    const text = textEl.value;
    const amount = parseInt(amountEl.value);
    const isPositive = typeEl.value === "positive";

    if (!text || !amount || amount <= 0) {
      this.showToast("Please enter valid text and amount.", "error");
      return;
    }

    const newAction = {
      text: text,
      value: amount,
      is_positive: isPositive,
    };

    const result = await this.apiCall(
      "/api/add-quick-action",
      "POST",
      newAction
    );

    if (result && result.success) {
      this.showToast("Quick Action added!", "success");
      this.data = result;
      this.updateAllUI();
      textEl.value = "";
      amountEl.value = "";
    }
  }

  async deleteQuickAction(index) {
    this.showToast("Deleting action...", "success");
    const result = await this.apiCall("/api/delete-quick-action", "POST", {
      index,
    });

    if (result && result.success) {
      this.showToast("Quick Action removed!", "success");
      this.data = result;
      this.updateAllUI();
    }
  }

  async logout() {
    this.showToast("Logging out...", "success");
    const result = await this.apiCall("/api/logout", "POST");
    if (result && result.success) {
      window.location.href = "/login";
    }
  }

  showSupportModal() {
    const modal = document.getElementById("supportModal");
    if (!modal) return;

    modal.style.display = "block";

    // Setup close button logic
    const closeBtn = modal.querySelector(".close");
    if (closeBtn) {
      closeBtn.onclick = () => (modal.style.display = "none");
    }

    // Close if clicking outside the modal content
    window.onclick = (event) => {
      if (event.target == modal) {
        modal.style.display = "none";
      }
    };
  }

  showToast(message, type = "success") {
    const toast = document.getElementById("toast");
    if (!toast) return;
    toast.textContent = message;
    toast.className = `toast ${type} show`;
    if (type === "broadcast") {
      toast.classList.add("broadcast");
    }
    setTimeout(() => toast.classList.remove("show"), 3000);
  }
}

document.addEventListener("DOMContentLoaded", () => {
  const app = new CoinTrackerApp();
  app.init();
});
