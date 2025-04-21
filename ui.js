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
      chrome.storage.local.set({ jobKeywords: keywords }, () => {
        // Update global settings
        window.linkedInAutoApply.settings.jobKeywords = keywords;
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
