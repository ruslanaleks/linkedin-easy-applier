// passReviewStep.js - Contains the action to pass the review step in the application process

// Initialize the global namespace for our extension
window.linkedInAutoApply = window.linkedInAutoApply || {};

/**
 * Action to handle the review application step
 * @returns {boolean} - True if action was successful, false otherwise
 */
window.linkedInAutoApply.passReviewStep = () => {
  console.log("Passing review step...");
  if (
    document.querySelector(".ph5 .t-18") &&
    document.querySelector(".ph5 .t-18").innerText ===
      "Review your application"
  ) {
    document
      .querySelector(
        ".artdeco-button.artdeco-button--2.artdeco-button--primary.ember-view"
      )
      .click();
    console.log("Passing review step... DONE");
    return true;
  }
  return false;
};
