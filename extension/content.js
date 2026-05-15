// content.js - Main content script for LinkedIn Auto Apply extension

// Global variable to track if an action is in progress
let isProcessing = false;

// Initialize the global namespace for our extension
window.linkedInAutoApply = window.linkedInAutoApply || {};

/**
 * Main apply function that processes all actions
 */
function apply() {
  if (isProcessing) {
    console.log("Already processing an action, please wait...");
    return;
  }

  isProcessing = true;
  console.log("Applying...");

  // Process each action
  for (let action of window.linkedInAutoApply.actions) {
    const result = action();
    console.log("Action result:", result);

    if (result) {
      // If action was successful, wait before continuing to next action
      isProcessing = false;
      return setTimeout(apply, 2500);
    }
  }

  console.log("All actions completed!");
  isProcessing = false;
}

/**
 * Initialize the extension
 */
function initialize() {
  console.log("Initializing LinkedIn Auto Apply extension...");

  // Expose the apply function to the global namespace
  window.linkedInAutoApply.apply = apply;

  // Load settings
  window.linkedInAutoApply.loadSettings().then(() => {
    // Initialize actions
    window.linkedInAutoApply.actions = window.linkedInAutoApply.createActions();

    // Initialize UI
    window.linkedInAutoApply.createUI(apply);

    console.log("LinkedIn Auto Apply extension initialized!");
  });

  // Bridge: allow page context to set phone via postMessage
  try {
    window.addEventListener("message", (event) => {
      if (!event || !event.data || event.source !== window) return;
      const { type, payload } = event.data || {};
      if (type === "LINKEDIN_APPLIER_SET_PHONE" && payload && typeof payload.phone === "string") {
        chrome.storage.local.set({ phoneNumber: payload.phone }, () => {
          // Refresh in-memory settings
          window.linkedInAutoApply.loadSettings();
          console.log("Phone number saved via bridge.");
        });
      }
    });
  } catch (e) {
    console.warn("Bridge init failed", e);
  }
}

// Initialize the extension when the page is ready
if (document.readyState === "loading") {
  document.addEventListener("DOMContentLoaded", initialize);
} else {
  initialize();
}
