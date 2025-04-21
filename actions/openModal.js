// openModal.js - Contains the function to open and handle job modals

// Initialize the global namespace for our extension
window.linkedInAutoApply = window.linkedInAutoApply || {};

/**
 * Function to open a job modal and start the application process
 * @returns {boolean} - Always returns false to continue processing
 */
window.linkedInAutoApply.openModal = () => {
  console.log("Waiting for modal...");
  if (
    !document.querySelector(".jobs-easy-apply-modal") &&
    !document.querySelector("#post-apply-modal")
  ) {
    const items = document.querySelectorAll(".scaffold-layout__list-item");
    const item = Array.from(items).find((item) =>
      item.querySelector(
        ".job-card-container__footer-item.inline-flex.align-items-center"
      )
    );

    if (item) {
      const close = item.querySelector(
        ".job-card-container__action.job-card-container__action-small.artdeco-button.artdeco-button--muted.artdeco-button--2.artdeco-button--tertiary.ember-view"
      );

      const easyApply = item.querySelector(
        ".job-card-container__footer-item.inline-flex.align-items-center"
      );

      easyApply.click();

      setTimeout(() => {
        const text = document.querySelector(
          ".jobs-description-content__text--stretch"
        ).innerText;

        // Get keywords from settings
        const jsKeywords = window.linkedInAutoApply.settings.jobKeywords;

        const isJobRelatedToJavaScript = jsKeywords.some((keyword) =>
          text.toLowerCase().includes(keyword)
        );

        if (!isJobRelatedToJavaScript) {
          close.click();
        } else {
          document
            .querySelector(
              ".jobs-apply-button.artdeco-button.artdeco-button--3.artdeco-button--primary.ember-view"
            )
            .click();
        }
        // Call the apply function from the global namespace
        window.linkedInAutoApply.apply();
      }, 3000);
    }

    console.log("Waiting for modal... DONE");
    return false;
  }
  return false;
};
