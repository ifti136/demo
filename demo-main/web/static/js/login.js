document.addEventListener("DOMContentLoaded", () => {
  // --- MODIFICATION: Added theme toggle logic ---
  const themeToggleBtn = document.getElementById("themeToggleBtn");
  let currentTheme =
    document.documentElement.getAttribute("data-theme") || "light";

  // Set initial icon
  themeToggleBtn.textContent = currentTheme === "light" ? "🌙" : "☀️";

  themeToggleBtn.addEventListener("click", () => {
    // Toggle theme
    currentTheme = currentTheme === "light" ? "dark" : "light";

    // Apply theme to HTML tag
    document.documentElement.setAttribute("data-theme", currentTheme);

    // Save to localStorage so the main app and admin panel pick it up
    localStorage.setItem("theme", currentTheme);

    // Update button icon
    themeToggleBtn.textContent = currentTheme === "light" ? "🌙" : "☀️";
  });
  // --- END MODIFICATION ---

  let isRegisterMode = false;

  const title = document.getElementById("auth-title");
  const submitBtn = document.getElementById("auth-submit-btn");
  const toggleBtn = document.getElementById("auth-toggle-btn");
  const errorEl = document.getElementById("auth-error");
  const usernameEl = document.getElementById("username");
  const passwordEl = document.getElementById("password");

  const toggleAuthMode = () => {
    isRegisterMode = !isRegisterMode;
    title.textContent = isRegisterMode ? "Register" : "Login";
    submitBtn.textContent = isRegisterMode ? "Create Account" : "Login";
    toggleBtn.textContent = isRegisterMode
      ? "Already have an account? Login"
      : "Need an account? Register";
    errorEl.textContent = "";
    usernameEl.value = "";
    passwordEl.value = "";
  };

  const handleAuthSubmit = async () => {
    const username = usernameEl.value;
    const password = passwordEl.value;

    if (!username || !password) {
      errorEl.textContent = "Username and password are required.";
      return;
    }

    submitBtn.disabled = true;
    submitBtn.textContent = isRegisterMode ? "Creating..." : "Logging in...";
    errorEl.textContent = "";

    const endpoint = isRegisterMode ? "/api/register" : "/api/login";

    try {
      const response = await fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });

      const result = await response.json();

      if (result.success) {
        if (isRegisterMode) {
          showToast("Registration successful! Please log in.", "success");
          toggleAuthMode();
        } else {
          showToast(`Welcome, ${result.username}!`, "success");
          const redirectUrl = result.redirect || "/";
          setTimeout(() => {
            window.location.href = redirectUrl;
          }, 1000);
        }
      } else {
        errorEl.textContent = result.error || "An unknown error occurred.";
      }
    } catch (error) {
      errorEl.textContent = "Could not connect to server. Please try again.";
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = isRegisterMode ? "Create Account" : "Login";
    }
  };

  submitBtn.addEventListener("click", handleAuthSubmit);
  toggleBtn.addEventListener("click", toggleAuthMode);

  passwordEl.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      handleAuthSubmit();
    }
  });
  usernameEl.addEventListener("keypress", (e) => {
    if (e.key === "Enter") {
      handleAuthSubmit();
    }
  });
});

function showToast(message, type = "success") {
  const toast = document.getElementById("toast");
  if (!toast) return;
  toast.textContent = message;
  toast.className = `toast ${type} show`;
  setTimeout(() => toast.classList.remove("show"), 3000);
}
