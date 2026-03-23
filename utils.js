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
    chrome.storage.local.get(["jobKeywords", "applicationStats", "phoneNumber", "englishLevel", "awsExperience", "hispanicOption", "awsYearsExperience", "javaYearsExperience", "languages", "userProfile", "authorizedToWorkInSpain", "preferredLocation"], (data) => {
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
        phoneNumber: data.phoneNumber || "",
        englishLevel: data.englishLevel || "",
        awsExperience: data.awsExperience || "",
        hispanicOption: data.hispanicOption || "",
        awsYearsExperience: data.awsYearsExperience || "",
        javaYearsExperience: data.javaYearsExperience || "",
        // languages: array of { name: string, level: string }
        languages: Array.isArray(data.languages) ? data.languages : [],
        userProfile: data.userProfile || null,
        authorizedToWorkInSpain: data.authorizedToWorkInSpain || "",
        preferredLocation: data.preferredLocation || "",
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
  /**
   * Set value on input/textarea and dispatch input/change events
   * @param {HTMLInputElement|HTMLTextAreaElement|HTMLSelectElement} element
   * @param {string} value
   */
  setFormControlValue(element, value) {
    if (!element) return;
    const tag = (element.tagName || "").toLowerCase();
    if (tag === "select") {
      element.value = value;
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    const proto = Object.getPrototypeOf(element);
    const valueSetter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    const nativeInputValueSetter =
      valueSetter || Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    nativeInputValueSetter?.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  },
  /**
   * Find likely phone inputs within a root element
   * @param {Element|Document} root
   * @returns {HTMLInputElement[]}
   */
  findPhoneInputs(root) {
    const scope = root || document;
    const selectors = [
      "input[type='tel']",
      "input[name*='phone' i]",
      "input[id*='phone' i]",
      "input[aria-label*='phone' i]",
      "input[placeholder*='phone' i]",
      "input[name*='mobile' i]",
      "input[id*='mobile' i]",
      "input[aria-label*='mobile' i]",
      "input[placeholder*='mobile' i]",
    ];
    const nodes = new Set();
    selectors.forEach((sel) => {
      scope.querySelectorAll(sel).forEach((el) => nodes.add(el));
    });
    return Array.from(nodes);
  },
  /**
   * Select an option in a <select> by visible text (case-insensitive contains)
   * @param {HTMLSelectElement} select
   * @param {string} desiredText
   * @returns {boolean}
   */
  selectOptionByText(select, desiredText) {
    if (!select) return false;
    const needle = (desiredText || "").toLowerCase();
    for (let i = 0; i < select.options.length; i++) {
      const opt = select.options[i];
      if ((opt.textContent || "").toLowerCase().includes(needle)) {
        select.selectedIndex = i;
        select.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
    }
    return false;
  },
  /**
   * Check a radio input by matching its associated label text
   * @param {Element|Document} root
   * @param {string} groupNameOrSelector
   * @param {string} desiredText
   * @returns {boolean}
   */
  checkRadioByLabel(root, groupNameOrSelector, desiredText) {
    const scope = root || document;
    let radios = [];
    if (groupNameOrSelector && groupNameOrSelector.includes("[")) {
      radios = Array.from(scope.querySelectorAll(groupNameOrSelector));
    } else if (groupNameOrSelector) {
      radios = Array.from(scope.querySelectorAll(`input[type='radio'][name='${groupNameOrSelector}']`));
    } else {
      radios = Array.from(scope.querySelectorAll("input[type='radio']"));
    }
    const needle = (desiredText || "").toLowerCase();
    for (const r of radios) {
      let labelText = "";
      if (r.id) {
        const label = scope.querySelector(`label[for='${r.id}']`);
        if (label) labelText = label.textContent || "";
      }
      if (!labelText) {
        const parentLabel = r.closest("label");
        if (parentLabel) labelText = parentLabel.textContent || "";
      }
      if (!labelText) {
        labelText = (r.getAttribute("aria-label") || "");
      }
      if ((labelText || "").toLowerCase().includes(needle)) {
        r.checked = true;
        r.dispatchEvent(new Event("input", { bubbles: true }));
        r.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
    }
    return false;
  },
  /**
   * Simulate typing into an input to satisfy React/Ember listeners
   * @param {HTMLInputElement} input
   * @param {string} value
   */
  async typeIntoInput(input, value) {
    if (!input) return;
    input.focus();
    input.dispatchEvent(new Event("focus", { bubbles: true }));
    input.value = "";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    for (const ch of String(value)) {
      const prev = input.value;
      window.linkedInAutoApply.utils.setFormControlValue(input, prev + ch);
      await window.linkedInAutoApply.utils.delay(10);
    }
    input.dispatchEvent(new Event("blur", { bubbles: true }));
  },
};
