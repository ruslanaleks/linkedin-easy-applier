// utils.js - Utility functions for LinkedIn Auto Apply

// Initialize the global namespace for our extension
window.linkedInAutoApply = window.linkedInAutoApply || {};

/**
 * Delay function that returns a promise which resolves after the specified time
 * @param {number} ms - Time to delay in milliseconds
 * @returns {Promise} - Promise that resolves after the delay
 */
function delay(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Check if a job description contains any of the specified keywords
 * @param {string} description - Job description text
 * @param {Array<string>} keywords - Array of keywords to check for
 * @returns {boolean} - True if any keyword is found in the description
 */
function containsKeywords(description, keywords) {
  const lowerDescription = description.toLowerCase();
  return keywords.some((keyword) =>
    lowerDescription.includes(keyword.toLowerCase())
  );
}

/**
 * Get the current date and time in a readable format
 * @returns {string} - Formatted date and time
 */
function getCurrentDateTime() {
  const now = new Date();
  return now.toLocaleString();
}

/**
 * Format job application statistics for display
 * @param {Object} stats - Statistics object
 * @returns {string} - Formatted statistics string
 */
function formatStats(stats) {
  return `Application Statistics:
  Total Applied: ${stats.totalApplied}
  This Session: ${stats.sessionsApplied}
  Last Applied: ${
    stats.lastApplied ? new Date(stats.lastApplied).toLocaleString() : "Never"
  }`;
}

/**
 * Find and click a button with the specified text
 * @param {string} buttonText - Text to look for in buttons
 * @returns {boolean} - True if button was found and clicked
 */
function clickButtonWithText(buttonText) {
  const buttons = Array.from(document.querySelectorAll("button"));
  const button = buttons.find((btn) => btn.innerText.includes(buttonText));

  if (button) {
    button.click();
    return true;
  }

  return false;
}

/**
 * Load settings from storage
 * @returns {Promise<Object>} - Promise that resolves with the settings object
 */
window.linkedInAutoApply.loadSettings = function () {
  return new Promise((resolve) => {
    chrome.storage.local.get(["jobKeywords", "applicationStats"], (data) => {
      const settings = {
        jobKeywords: data.jobKeywords || [
          "javascript",
          "node.js",
          "react",
          "angular",
          "nest.js",
          "next.js",
          "keystone.js",
          "typescript",
        ],
        stats: data.applicationStats || {
          totalApplied: 0,
          sessionsApplied: 0,
          lastApplied: null,
        },
      };

      // Store settings in global namespace
      window.linkedInAutoApply.settings = settings;

      resolve(settings);
    });
  });
};

// Attach utility functions to global namespace
window.linkedInAutoApply.utils = {
  delay,
  containsKeywords,
  getCurrentDateTime,
  formatStats,
  clickButtonWithText,
};
