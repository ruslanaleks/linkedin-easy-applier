// ui.js - Contains UI-related functionality for LinkedIn Auto Apply

// Initialize the global namespace for our extension
window.linkedInAutoApply = window.linkedInAutoApply || {};

/**
 * Creates and styles a button with the given properties
 * @param {string} text - Button text
 * @param {string} position - Position from bottom in pixels
 * @param {function} clickHandler - Function to call when button is clicked
 * @returns {HTMLButtonElement} - The created button
 */
function createButton(text, position, clickHandler) {
  const button = document.createElement("button");
  button.innerText = text;
  button.style.position = "fixed";
  button.style.bottom = position;
  button.style.right = "20px";
  button.style.zIndex = "9999";
  button.style.padding = "10px 15px";
  button.style.backgroundColor = "#0073b1";
  button.style.color = "#fff";
  button.style.border = "none";
  button.style.borderRadius = "5px";
  button.style.cursor = "pointer";
  button.style.fontWeight = "bold";
  button.style.boxShadow = "0 2px 5px rgba(0, 0, 0, 0.2)";
  button.style.transition = "background-color 0.3s";

  // Add hover effect
  button.addEventListener("mouseover", () => {
    button.style.backgroundColor = "#005582";
  });

  button.addEventListener("mouseout", () => {
    button.style.backgroundColor = "#0073b1";
  });

  // Add click handler
  button.addEventListener("click", clickHandler);

  return button;
}

/**
 * Creates the Auto Apply button
 * @param {function} applyCallback - Function to call when button is clicked
 * @returns {HTMLButtonElement} - The created button
 */
function createAutoApplyButton(applyCallback) {
  const button = createButton("Auto Apply", "100px", () => {
    console.log("Auto Apply button clicked!");
    applyCallback();
  });

  document.body.appendChild(button);
  return button;
}

/**
 * Creates the Stats button
 * @returns {HTMLButtonElement} - The created button
 */
function createStatsButton() {
  const button = createButton("Stats", "150px", () => {
    chrome.runtime.sendMessage({ action: "getStats" }, (response) => {
      if (response && response.stats) {
        const stats = response.stats;
        alert(`Application Statistics:
        Total Applied: ${stats.totalApplied}
        This Session: ${stats.sessionsApplied}
        Last Applied: ${
          stats.lastApplied
            ? new Date(stats.lastApplied).toLocaleString()
            : "Never"
        }`);
      }
    });
  });

  document.body.appendChild(button);
  return button;
}

/**
 * Creates the Settings button
 * @returns {HTMLButtonElement} - The created button
 */
function createSettingsButton() {
  const button = createButton("Settings", "200px", () => {
    // Create a settings popup
    const popup = document.createElement("div");
    popup.style.position = "fixed";
    popup.style.top = "50%";
    popup.style.left = "50%";
    popup.style.transform = "translate(-50%, -50%)";
    popup.style.backgroundColor = "#fff";
    popup.style.padding = "20px";
    popup.style.borderRadius = "8px";
    popup.style.boxShadow = "0 4px 12px rgba(0, 0, 0, 0.15)";
    popup.style.zIndex = "10000";
    popup.style.minWidth = "300px";
    popup.style.width = "90vw";
    popup.style.maxWidth = "600px";
    popup.style.maxHeight = "80vh";
    popup.style.overflowY = "auto";

    // Add title
    const title = document.createElement("h2");
    title.innerText = "LinkedIn Auto Apply Settings";
    title.style.marginTop = "0";
    title.style.color = "#0073b1";
    popup.appendChild(title);

    // Add close button
    const closeButton = document.createElement("button");
    closeButton.innerText = "×";
    closeButton.style.position = "absolute";
    closeButton.style.top = "10px";
    closeButton.style.right = "10px";
    closeButton.style.backgroundColor = "transparent";
    closeButton.style.border = "none";
    closeButton.style.fontSize = "20px";
    closeButton.style.cursor = "pointer";
    closeButton.addEventListener("click", () => {
      document.body.removeChild(popup);
    });
    popup.appendChild(closeButton);

    // Add settings content
    const content = document.createElement("div");

    // Add keyword settings
    const keywordLabel = document.createElement("label");
    keywordLabel.innerText = "Job Keywords (comma-separated):";
    keywordLabel.style.display = "block";
    keywordLabel.style.marginBottom = "5px";
    content.appendChild(keywordLabel);

    // Get current keywords from settings
    const keywordInput = document.createElement("input");
    keywordInput.type = "text";
    keywordInput.style.width = "100%";
    keywordInput.style.padding = "8px";
    keywordInput.style.marginBottom = "15px";
    keywordInput.style.borderRadius = "4px";
    keywordInput.style.border = "1px solid #ddd";

    // Set value from global settings
    const keywords = window.linkedInAutoApply.settings.jobKeywords;
    keywordInput.value = keywords.join(", ");

    content.appendChild(keywordInput);

    // Add phone number settings
    const phoneLabel = document.createElement("label");
    phoneLabel.innerText = "Phone Number:";
    phoneLabel.style.display = "block";
    phoneLabel.style.marginBottom = "5px";
    content.appendChild(phoneLabel);

    const phoneInput = document.createElement("input");
    phoneInput.type = "tel";
    phoneInput.style.width = "100%";
    phoneInput.style.padding = "8px";
    phoneInput.style.marginBottom = "15px";
    phoneInput.style.borderRadius = "4px";
    phoneInput.style.border = "1px solid #ddd";
    phoneInput.placeholder = "+1 555 123 4567";
    phoneInput.value = window.linkedInAutoApply.settings.phoneNumber || "";

    content.appendChild(phoneInput);

    // Add English level (select)
    const englishLabel = document.createElement("label");
    englishLabel.innerText = "English Level:";
    englishLabel.style.display = "block";
    englishLabel.style.marginBottom = "5px";
    content.appendChild(englishLabel);

    const englishSelect = document.createElement("select");
    englishSelect.style.width = "100%";
    englishSelect.style.padding = "8px";
    englishSelect.style.marginBottom = "15px";
    englishSelect.style.borderRadius = "4px";
    englishSelect.style.border = "1px solid #ddd";
    const levels = [
      "",
      "Native / Bilingual",
      "Fluent",
      "Upper Intermediate (B2)",
      "Intermediate (B1)",
      "Elementary (A2)",
      "Beginner (A1)",
    ];
    levels.forEach((lvl) => {
      const opt = document.createElement("option");
      opt.value = lvl;
      opt.textContent = lvl || "Select...";
      if ((window.linkedInAutoApply.settings.englishLevel || "") === lvl) opt.selected = true;
      englishSelect.appendChild(opt);
    });
    content.appendChild(englishSelect);

    // Custom English level text (for localized labels/options)
    const englishAltLabel = document.createElement("label");
    englishAltLabel.innerText = "Custom English Level Text (optional):";
    englishAltLabel.style.display = "block";
    englishAltLabel.style.marginBottom = "5px";
    content.appendChild(englishAltLabel);

    const englishAltInput = document.createElement("input");
    englishAltInput.type = "text";
    englishAltInput.style.width = "100%";
    englishAltInput.style.padding = "8px";
    englishAltInput.style.marginBottom = "15px";
    englishAltInput.style.borderRadius = "4px";
    englishAltInput.style.border = "1px solid #ddd";
    englishAltInput.placeholder = "e.g., Profesional";
    englishAltInput.value = window.linkedInAutoApply.settings.englishLevelAlt || "";

    content.appendChild(englishAltInput);

    // Add AWS experience (textarea)
    const awsLabel = document.createElement("label");
    awsLabel.innerText = "AWS Experience (short summary):";
    awsLabel.style.display = "block";
    awsLabel.style.marginBottom = "5px";
    content.appendChild(awsLabel);

    const awsTextarea = document.createElement("textarea");
    awsTextarea.style.width = "100%";
    awsTextarea.style.minHeight = "90px";
    awsTextarea.style.padding = "8px";
    awsTextarea.style.marginBottom = "15px";
    awsTextarea.style.borderRadius = "4px";
    awsTextarea.style.border = "1px solid #ddd";
    awsTextarea.placeholder = "e.g., 3+ years architecting on AWS (EC2, S3, Lambda, RDS)";
    awsTextarea.value = window.linkedInAutoApply.settings.awsExperience || "";

    content.appendChild(awsTextarea);

    // Add AWS years of experience (number)
    const awsYearsLabel = document.createElement("label");
    awsYearsLabel.innerText = "AWS Years of Experience:";
    awsYearsLabel.style.display = "block";
    awsYearsLabel.style.marginBottom = "5px";
    content.appendChild(awsYearsLabel);

    const awsYearsInput = document.createElement("input");
    awsYearsInput.type = "number";
    awsYearsInput.min = "0";
    awsYearsInput.step = "1";
    awsYearsInput.style.width = "100%";
    awsYearsInput.style.padding = "8px";
    awsYearsInput.style.marginBottom = "15px";
    awsYearsInput.style.borderRadius = "4px";
    awsYearsInput.style.border = "1px solid #ddd";
    awsYearsInput.placeholder = "e.g., 3";
    awsYearsInput.value = window.linkedInAutoApply.settings.awsYearsExperience || "";

    content.appendChild(awsYearsInput);

    // Java years of experience
    const javaYearsLabel = document.createElement("label");
    javaYearsLabel.innerText = "Java Years of Experience:";
    javaYearsLabel.style.display = "block";
    javaYearsLabel.style.marginBottom = "5px";
    content.appendChild(javaYearsLabel);

    const javaYearsInput = document.createElement("input");
    javaYearsInput.type = "number";
    javaYearsInput.min = "0";
    javaYearsInput.step = "1";
    javaYearsInput.style.width = "100%";
    javaYearsInput.style.padding = "8px";
    javaYearsInput.style.marginBottom = "15px";
    javaYearsInput.style.borderRadius = "4px";
    javaYearsInput.style.border = "1px solid #ddd";
    javaYearsInput.placeholder = "e.g., 2";
    javaYearsInput.value = window.linkedInAutoApply.settings.javaYearsExperience || "";

    content.appendChild(javaYearsInput);

    // Languages (JSON)
    const langLabel = document.createElement("label");
    langLabel.innerText = "Languages (JSON array of { name, level }):";
    langLabel.style.display = "block";
    langLabel.style.marginBottom = "5px";
    content.appendChild(langLabel);

    const langTextarea = document.createElement("textarea");
    langTextarea.style.width = "100%";
    langTextarea.style.minHeight = "90px";
    langTextarea.style.padding = "8px";
    langTextarea.style.marginBottom = "15px";
    langTextarea.style.borderRadius = "4px";
    langTextarea.style.border = "1px solid #ddd";
    langTextarea.placeholder = '[\n  { "name": "English", "level": "Profesional" },\n  { "name": "Spanish", "level": "Nativo" }\n]';
    try {
      langTextarea.value = JSON.stringify(window.linkedInAutoApply.settings.languages || [], null, 2);
    } catch (_) {
      langTextarea.value = "[]";
    }

    content.appendChild(langTextarea);

    // User Profile JSON (import)
    const profileLabel = document.createElement("label");
    profileLabel.innerText = "User Profile (JSON):";
    profileLabel.style.display = "block";
    profileLabel.style.marginBottom = "5px";
    content.appendChild(profileLabel);

    const profileTextarea = document.createElement("textarea");
    profileTextarea.style.width = "100%";
    profileTextarea.style.minHeight = "120px";
    profileTextarea.style.padding = "8px";
    profileTextarea.style.marginBottom = "10px";
    profileTextarea.style.borderRadius = "4px";
    profileTextarea.style.border = "1px solid #ddd";
    try {
      profileTextarea.value = window.linkedInAutoApply.settings.userProfile
        ? JSON.stringify(window.linkedInAutoApply.settings.userProfile, null, 2)
        : "";
    } catch (_) {
      profileTextarea.value = "";
    }
    content.appendChild(profileTextarea);

    const fileInput = document.createElement("input");
    fileInput.type = "file";
    fileInput.accept = ".json,application/json";
    fileInput.style.display = "block";
    fileInput.style.marginBottom = "15px";
    fileInput.addEventListener("change", (e) => {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = () => {
        try {
          const parsed = JSON.parse(reader.result);
          profileTextarea.value = JSON.stringify(parsed, null, 2);
        } catch (err) {
          alert("Invalid JSON file");
        }
      };
      reader.readAsText(file);
    });
    content.appendChild(fileInput);

    // Add Hispanic/Latino selector
    const hispLabel = document.createElement("label");
    hispLabel.innerText = "Hispanic/Latino:";
    hispLabel.style.display = "block";
    hispLabel.style.marginBottom = "5px";
    content.appendChild(hispLabel);

    const hispSelect = document.createElement("select");
    hispSelect.style.width = "100%";
    hispSelect.style.padding = "8px";
    hispSelect.style.marginBottom = "15px";
    hispSelect.style.borderRadius = "4px";
    hispSelect.style.border = "1px solid #ddd";
    const hispOptions = ["", "Prefer not to say", "Yes", "No"];
    hispOptions.forEach((optText) => {
      const opt = document.createElement("option");
      opt.value = optText;
      opt.textContent = optText || "Select...";
      if ((window.linkedInAutoApply.settings.hispanicOption || "") === optText) opt.selected = true;
      hispSelect.appendChild(opt);
    });
    content.appendChild(hispSelect);

    // Authorized to work in Spain
    const authEsLabel = document.createElement("label");
    authEsLabel.innerText = "Authorized to work in Spain:";
    authEsLabel.style.display = "block";
    authEsLabel.style.marginBottom = "5px";
    content.appendChild(authEsLabel);

    const authEsSelect = document.createElement("select");
    authEsSelect.style.width = "100%";
    authEsSelect.style.padding = "8px";
    authEsSelect.style.marginBottom = "15px";
    authEsSelect.style.borderRadius = "4px";
    authEsSelect.style.border = "1px solid #ddd";
    ["", "Yes", "No"].forEach((optText) => {
      const opt = document.createElement("option");
      opt.value = optText;
      opt.textContent = optText || "Select...";
      if ((window.linkedInAutoApply.settings.authorizedToWorkInSpain || "") === optText) opt.selected = true;
      authEsSelect.appendChild(opt);
    });
    content.appendChild(authEsSelect);

    // Preferred Location
    const locLabel = document.createElement("label");
    locLabel.innerText = "Preferred Location:";
    locLabel.style.display = "block";
    locLabel.style.marginBottom = "5px";
    content.appendChild(locLabel);

    const locInput = document.createElement("input");
    locInput.type = "text";
    locInput.style.width = "100%";
    locInput.style.padding = "8px";
    locInput.style.marginBottom = "15px";
    locInput.style.borderRadius = "4px";
    locInput.style.border = "1px solid #ddd";
    locInput.placeholder = "e.g., Madrid, Spain";
    locInput.value = window.linkedInAutoApply.settings.preferredLocation || "";
    content.appendChild(locInput);

    // Add save button
    const saveButton = document.createElement("button");
    saveButton.innerText = "Save Settings";
    saveButton.style.backgroundColor = "#0073b1";
    saveButton.style.color = "#fff";
    saveButton.style.border = "none";
    saveButton.style.borderRadius = "4px";
    saveButton.style.padding = "8px 16px";
    saveButton.style.cursor = "pointer";
    saveButton.addEventListener("click", () => {
      // Save keywords to storage
      const keywords = keywordInput.value
        .split(",")
        .map((k) => k.trim().toLowerCase())
        .filter((k) => k);
      const phoneNumber = (phoneInput.value || "").trim();
      const englishLevel = englishSelect.value || "";
      const awsExperience = awsTextarea.value || "";
      const englishLevelAlt = englishAltInput.value || "";
      const javaYearsExperience = javaYearsInput.value || "";
      let languagesParsed = [];
      try {
        const parsed = JSON.parse(langTextarea.value || "[]");
        if (Array.isArray(parsed)) languagesParsed = parsed.filter((x) => x && x.name);
      } catch (_) {}
      let userProfileParsed = null;
      try {
        const parsed = JSON.parse(profileTextarea.value || "null");
        if (parsed && typeof parsed === "object") userProfileParsed = parsed;
      } catch (_) {}
      chrome.storage.local.set({ jobKeywords: keywords, phoneNumber, englishLevel, englishLevelAlt, awsExperience, hispanicOption: hispSelect.value || "", awsYearsExperience: awsYearsInput.value || "", javaYearsExperience, languages: languagesParsed, userProfile: userProfileParsed, authorizedToWorkInSpain: authEsSelect.value || "", preferredLocation: (locInput.value || "").trim() }, () => {
        // Update global settings
        window.linkedInAutoApply.settings.jobKeywords = keywords;
        window.linkedInAutoApply.settings.phoneNumber = phoneNumber;
        window.linkedInAutoApply.settings.englishLevel = englishLevel;
        window.linkedInAutoApply.settings.englishLevelAlt = englishLevelAlt;
        window.linkedInAutoApply.settings.awsExperience = awsExperience;
        window.linkedInAutoApply.settings.hispanicOption = hispSelect.value || "";
        window.linkedInAutoApply.settings.awsYearsExperience = awsYearsInput.value || "";
        window.linkedInAutoApply.settings.javaYearsExperience = javaYearsExperience;
        window.linkedInAutoApply.settings.languages = languagesParsed;
        window.linkedInAutoApply.settings.userProfile = userProfileParsed;
        window.linkedInAutoApply.settings.authorizedToWorkInSpain = authEsSelect.value || "";
        window.linkedInAutoApply.settings.preferredLocation = (locInput.value || "").trim();
        // Notify background script
        chrome.runtime.sendMessage({
          action: "updateKeywords",
          keywords: keywords,
        });
        alert("Settings saved!");
        document.body.removeChild(popup);
      });
    });

    content.appendChild(saveButton);
    popup.appendChild(content);
    document.body.appendChild(popup);
  });

  document.body.appendChild(button);
  return button;
}

/**
 * Initialize all UI elements
 * @param {function} applyCallback - Function to call when Auto Apply button is clicked
 */
window.linkedInAutoApply.createUI = function (applyCallback) {
  createAutoApplyButton(applyCallback);
  createStatsButton();
  createSettingsButton();
};

// Initialize UI when the document is loaded
document.addEventListener("DOMContentLoaded", () => {
  // Make sure the apply function is available
  if (window.linkedInAutoApply && window.linkedInAutoApply.apply) {
    window.linkedInAutoApply.createUI(window.linkedInAutoApply.apply);
  }
});
