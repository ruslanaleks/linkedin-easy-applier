// actions.js - Contains all the actions for LinkedIn Auto Apply

// Initialize the global namespace for our extension
window.linkedInAutoApply = window.linkedInAutoApply || {};

/**
 * Creates the actions array with the apply callback
 * @returns {Array} - Array of action functions
 */
window.linkedInAutoApply.createActions = function () {
  // Define all actions
  const actions = [
    // Action 1: Wait for modal and click on Easy Apply
    window.linkedInAutoApply.openModal,

    // Action 2: Pass default steps
    window.linkedInAutoApply.passDefaultSteps,

    // Action 3: Mark this job as a top choice
    window.linkedInAutoApply.markTopChoice,

    // Action 4: Handle additional steps that require user input
    window.linkedInAutoApply.handleAdditionalSteps,

    // Action 5: Pass review step
    window.linkedInAutoApply.passReviewStep,

    // Action 6: Handle application sent
    window.linkedInAutoApply.handleApplicationSent,
  ];

  return actions;
};

// Initialize actions when the document is loaded
document.addEventListener("DOMContentLoaded", () => {
  // Make sure the apply function is available
  if (window.linkedInAutoApply && window.linkedInAutoApply.apply) {
    window.linkedInAutoApply.actions =
      window.linkedInAutoApply.createActions();
  } else {
    // If apply function is not available yet, wait for it
    const checkInterval = setInterval(() => {
      if (window.linkedInAutoApply && window.linkedInAutoApply.apply) {
        window.linkedInAutoApply.actions =
          window.linkedInAutoApply.createActions();
        clearInterval(checkInterval);
      }
    }, 100);
  }
});
