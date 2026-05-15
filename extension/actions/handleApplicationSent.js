// handleApplicationSent.js - Contains the action to handle application sent confirmation

// Initialize the global namespace for our extension
window.linkedInAutoApply = window.linkedInAutoApply || {};

/**
 * Action to handle the application sent confirmation
 * @returns {boolean} - True if action was successful, false otherwise
 */
window.linkedInAutoApply.handleApplicationSent = () => {
  console.log("Application Sent");
  if (document.querySelector("#post-apply-modal")) {
    document
      .querySelector(
        ".artdeco-button.artdeco-button--2.artdeco-button--primary.ember-view"
      )
      .click();
    console.log("Application Sent DONE");

    // Notify the background script that an application was sent
    chrome.runtime.sendMessage(
      { action: "applicationSent" },
      (response) => {
        if (response && response.success) {
          console.log(
            "Background script notified of successful application"
          );
        }
      }
    );

    return true;
  }
  return false;
};
