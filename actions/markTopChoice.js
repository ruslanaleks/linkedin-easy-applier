// markTopChoice.js - Contains the action to mark a job as a top choice

// Initialize the global namespace for our extension
window.linkedInAutoApply = window.linkedInAutoApply || {};

// Mark this job as top choice strings
window.linkedInAutoApply.markThisJob = ["Mark this job as a top choice (Optional)"];

/**
 * Action to handle the "Mark this job as a top choice" step
 * @returns {boolean} - True if action was successful, false otherwise
 */
window.linkedInAutoApply.markTopChoice = () => {
  console.log("Mark this job as a top choice...");
  if (
    document.querySelector("form .ph5 .text-heading-medium") &&
    window.linkedInAutoApply.markThisJob.includes(
      document.querySelector("form .ph5 .text-heading-medium").innerText
    )
  ) {
    document.querySelector(".artdeco-button--primary").click();
    console.log("Mark this job as a top choice... DONE");
    return true;
  }
  return false;
};
